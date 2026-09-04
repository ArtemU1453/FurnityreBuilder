import { buildGeometry } from '../geometry/index.js';
import type { GeometryResult } from '../geometry/index.js';
import { FALLBACK_MATERIAL, add, buildScene, lookAt, normalize, scale, transformPoint } from '../scene/index.js';
import type { SceneModel, SceneObject } from '../scene/index.js';
import type { Project, ProjectPreview, Vec3 } from '../domain/index.js';

/**
 * Превью проекта (PROMPT 25 §7–§8).
 *
 * ## Цепочка та же, что у настоящей сцены
 *
 *     Project → GeometryResult → SceneModel → SVG
 *
 * Первые два шага — уже существующие `buildGeometry` и `buildScene`, те
 * же самые, что рисуют изделие на экране. Второго способа посчитать
 * шкаф не появляется: картинка в карточке показывает ровно ту
 * геометрию, которую покажет редактор, и разойтись с ней не может.
 *
 * ## Почему SVG, а не WebGL
 *
 * Превью строится вне кадра — при сохранении проекта, для списка из
 * десятков карточек, в тестах и в Node. WebGL требует живого канваса и
 * контекста; получить их для двадцати проектов подряд нельзя, а
 * проверить результат тестом — тем более. SVG — текст: он
 * детерминирован, сравним посимвольно и хранится в том же JSON, что и
 * проект.
 *
 * Из этого же следует, что превью НЕ фотореалистично и не претендует на
 * это: три грани коробки с постоянным затенением. Задача картинки —
 * дать узнать свой проект в списке, а не заменить сцену.
 *
 * ## Детерминированность
 *
 * Ни одного обращения ко времени, случайности или окружению: при
 * одинаковом проекте получается посимвольно одинаковая строка. Момент
 * построения передаётся снаружи — по той же причине, по которой его
 * принимает `createProject`.
 */

/** Размер картинки. Постоянный: карточки в списке одинаковы. */
export const PREVIEW_WIDTH = 320;
export const PREVIEW_HEIGHT = 240;
const PADDING = 12;

/**
 * Направление взгляда: изометрия.
 *
 * Ровно (1, 1, 1) — классическая изометрия, у которой все три оси
 * укорочены одинаково. Она показывает и фасад, и бок, и верх, поэтому
 * по картинке видно, шкаф это или тумба; вид спереди этого не
 * различает.
 */
const EYE_DIRECTION: Vec3 = { x: 1, y: 1, z: 1 };

/** Затенение трёх видимых граней. Постоянное: источника света в модели нет. */
const FACE_SHADE = { top: 1.14, front: 1, side: 0.78 } as const;

interface Face {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly color: string;
  readonly opacity: number;
  readonly depth: number;
}

/** Восемь углов коробки, заданной центром и габаритом. */
function cornersOf(object: SceneObject): Vec3[] {
  const h = { x: object.size.x / 2, y: object.size.y / 2, z: object.size.z / 2 };
  const points: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        points.push({
          x: object.position.x + h.x * sx,
          y: object.position.y + h.y * sy,
          z: object.position.z + h.z * sz,
        });
      }
    }
  }
  return points;
}

/** Индексы углов в порядке, который даёт `cornersOf`: (sx, sy, sz) → номер. */
const corner = (sx: 0 | 1, sy: 0 | 1, sz: 0 | 1): number => sx * 4 + sy * 2 + sz;

/**
 * Три грани, обращённые к камере.
 *
 * Список постоянен, потому что постоянно направление взгляда: при
 * взгляде из (+1, +1, +1) видны верх, перёд и правый бок, и никогда —
 * остальные три. Считать видимость нормалями на каждый кадр здесь было
 * бы расчётом ради заранее известного ответа.
 */
const VISIBLE_FACES: readonly { readonly indices: readonly number[]; readonly shade: number }[] = [
  { indices: [corner(0, 1, 0), corner(0, 1, 1), corner(1, 1, 1), corner(1, 1, 0)], shade: FACE_SHADE.top },
  { indices: [corner(0, 0, 1), corner(0, 1, 1), corner(1, 1, 1), corner(1, 0, 1)], shade: FACE_SHADE.front },
  { indices: [corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1)], shade: FACE_SHADE.side },
];

/** Осветление или затемнение цвета `#rrggbb`. */
export function shadeColor(color: string, factor: number): string {
  const match = /^#([0-9a-f]{6})$/iu.exec(color.trim());
  if (match === null) return color;
  const value = Number.parseInt(match[1] ?? '000000', 16);
  const channel = (shift: number): string => {
    const raw = (value >> shift) & 0xff;
    const scaled = Math.max(0, Math.min(255, Math.round(raw * factor)));
    return scaled.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Проекция сцены в плоские грани, вписанные в кадр.
 *
 * «Вписать» считается по самой сцене, а не по заранее заданному
 * масштабу: проект бывает и тумбой 400 мм, и шкафом-купе 3 м, и обе
 * карточки обязаны быть одинаково читаемыми.
 */
function projectScene(scene: SceneModel): Face[] {
  const direction = normalize(EYE_DIRECTION);
  const eye = add(scene.center, scale(direction, Math.max(scene.radius, 1) * 4));
  const view = lookAt(eye, scene.center, { x: 0, y: 1, z: 0 });

  const drawable = scene.objects.filter((object) => object.kind === 'part' && object.visible);

  // Первый проход — охват в координатах вида; второй — сама укладка.
  // Двух проходов не избежать: масштаб зависит от всех объектов сразу.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projected = drawable.map((object) => {
    const points = cornersOf(object).map((point) => transformPoint(view, point));
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    return { object, points };
  });

  if (projected.length === 0) return [];

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const k = Math.min((PREVIEW_WIDTH - PADDING * 2) / spanX, (PREVIEW_HEIGHT - PADDING * 2) / spanY);
  const offsetX = (PREVIEW_WIDTH - spanX * k) / 2;
  const offsetY = (PREVIEW_HEIGHT - spanY * k) / 2;

  const faces: Face[] = [];
  for (const { object, points } of projected) {
    const material = object.material ?? FALLBACK_MATERIAL;
    // Глубина берётся по центру коробки: детали корпуса не пересекаются
    // (это инвариант движка), поэтому порядка по центрам достаточно.
    const center = transformPoint(view, object.position);
    for (const face of VISIBLE_FACES) {
      faces.push({
        points: face.indices.map((index) => {
          const point = points[index] ?? { x: 0, y: 0, z: 0 };
          return {
            // Ось Y экрана направлена вниз, доменная — вверх. Инверсия
            // здесь, а не в модели: `docs/COORDINATE_SYSTEM.md` §1.
            x: round2(offsetX + (point.x - minX) * k),
            y: round2(PREVIEW_HEIGHT - offsetY - (point.y - minY) * k),
          };
        }),
        color: shadeColor(material.color, face.shade),
        opacity: material.opacity,
        depth: center.z,
      });
    }
  }

  // Художников алгоритм: дальние грани рисуются первыми. В координатах
  // вида ближе к камере — больше z, поэтому порядок по возрастанию.
  return faces.sort((a, b) => a.depth - b.depth);
}

/** Готовая картинка сцены. Отдельно от проекта — чтобы её можно было проверить. */
export function renderSceneSvg(scene: SceneModel): string {
  const faces = projectScene(scene);
  const body = faces
    .map((face) => {
      const points = face.points.map((point) => `${String(point.x)},${String(point.y)}`).join(' ');
      const opacity = face.opacity >= 1 ? '' : ` fill-opacity="${String(round2(face.opacity))}"`;
      return `<polygon points="${points}" fill="${face.color}"${opacity}/>`;
    })
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(PREVIEW_WIDTH)} ${String(PREVIEW_HEIGHT)}" ` +
    `width="${String(PREVIEW_WIDTH)}" height="${String(PREVIEW_HEIGHT)}" role="img">${body}</svg>`
  );
}

/**
 * Отпечаток состояния, из которого построено превью.
 *
 * Нужен ровно затем, чтобы производное не выдавало себя за текущее:
 * если отпечаток проекта не совпал с сохранённым, картинка устарела и
 * помечается устаревшей, а не показывается как правда (§8).
 *
 * В отпечаток входит только то, от чего картинка зависит: изделия,
 * материалы и настройки построения. Имя проекта и время правки в него
 * не входят — переименование картинку не меняет, и перестраивать её
 * из-за переименования было бы работой впустую.
 */
export function fingerprintProject(project: Project): string {
  const source = JSON.stringify({
    furniture: project.furniture,
    materials: project.materials,
    settings: project.settings,
  });
  // FNV-1a: короткая, детерминированная и не требует зависимостей.
  // Криптографической стойкости здесь не нужно — это не подпись, а
  // ответ на вопрос «то же самое состояние или уже другое».
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}:${String(source.length)}`;
}

/** Геометрия изделия, которое показывает превью. */
function previewGeometry(project: Project): GeometryResult | undefined {
  // Показывается первое изделие. Проект из нескольких изделий (кухня)
  // потребовал бы раскладки «как они стоят рядом» — а такой раскладки в
  // модели нет: их взаимное положение задаётся уже в помещении.
  // Придумывать её ради картинки значило бы показать расстановку,
  // которой нет. Количество изделий карточка сообщает числом.
  const furniture = project.furniture[0];
  if (furniture === undefined) return undefined;
  return buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
}

/**
 * Превью проекта (§8).
 *
 * Функция чистая: тот же проект даёт ту же строку. Кто и когда её
 * вызывает — решает приложение; здесь нет ни эффекта, ни подписки, и
 * поэтому нет и цикла обновлений, о котором предупреждает §8.
 */
export function generateProjectThumbnail(project: Project, now: () => string): ProjectPreview | undefined {
  const geometry = previewGeometry(project);
  if (geometry === undefined) return undefined;
  const scene = buildScene(geometry, project.materials);
  return {
    svg: renderSceneSvg(scene),
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    sourceFingerprint: fingerprintProject(project),
    generatedAt: now(),
  };
}

/** Устарело ли сохранённое превью относительно проекта. */
export function isPreviewStale(project: Project): boolean {
  const preview = project.preview;
  if (preview === undefined) return true;
  return preview.sourceFingerprint !== fingerprintProject(project);
}
