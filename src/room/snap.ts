import { roundMm } from '../domain/index.js';
import type { Mm, Room, Vec3, Wall, WallId } from '../domain/index.js';
import { footprintOf, normalizeRotation, roomFootprint } from './placement.js';
import type { Footprint } from './placement.js';

/**
 * Привязка мебели к стенам и углам (PROMPT 24 §15–§16).
 *
 * ## Никаких магических координат
 *
 * Каждый кандидат привязки выводится из ФАКТИЧЕСКОЙ геометрии комнаты:
 * внутренняя грань стены, угол между двумя стенами, край проёма. Ни одна
 * позиция не задана числом «обычно шкаф ставят на 50 мм от стены» —
 * такое число было бы производственным правилом, которого референс не
 * подтверждает (`ASSUMPTION(T-ROOM-02)`).
 *
 * ## Порог привязки задан в пикселях, а не в миллиметрах
 *
 * Иначе на разных масштабах магнит ведёт себя по-разному: вплотную к
 * стене можно поставить только при сильном приближении, а на общем виде
 * шкаф прилипает к стене за полметра. Порог в пикселях экрана —
 * то же решение и та же причина, что у `snapToCandidates`
 * (`src/interaction/snapping.ts`, PROMPT 2), и радиус берётся оттуда же.
 */

/** К чему привязались. Нужно интерфейсу, чтобы объяснить срабатывание. */
export type SnapKind = 'wall' | 'corner';

export interface SnapCandidate {
  readonly kind: SnapKind;
  /** Положение левого-нижнего-заднего угла изделия ДО поворота. */
  readonly position: Vec3;
  /** Поворот, при котором изделие стоит «спиной» к стене. */
  readonly rotation: number;
  readonly wallId: WallId;
  /** Вторая стена угла. Есть только у углового кандидата. */
  readonly secondWallId?: WallId;
  readonly label: string;
}

export interface SnapResult {
  readonly position: Vec3;
  readonly rotation: number;
  readonly snapped: SnapCandidate | undefined;
}

/**
 * Стена, приведённая к оси.
 *
 * Привязка реализована для стен, параллельных осям: это покрывает
 * прямоугольные комнаты, ниши и выступы с прямыми углами, то есть всё,
 * что сегодня умеет строить интерфейс. Для наклонной стены кандидат не
 * выдаётся вовсе — вместо того, чтобы поставить шкаф «примерно вдоль»
 * и выдать это за привязку.
 */
interface AxisWall {
  readonly wall: Wall;
  readonly axis: 'x' | 'z';
  /** Координата внутренней грани стены по нормали. */
  readonly inner: Mm;
  /** В какую сторону от стены лежит свободное пространство: +1 или −1. */
  readonly direction: 1 | -1;
  readonly rotation: number;
}

const HALF_PI = Math.PI / 2;

function axisWalls(room: Room): AxisWall[] {
  const print = roomFootprint(room);
  const centerX = print.x + print.width / 2;
  const centerZ = print.z + print.depth / 2;
  const result: AxisWall[] = [];

  for (const wall of room.walls) {
    const half = wall.thickness / 2;
    const horizontal = wall.a.z === wall.b.z;
    const vertical = wall.a.x === wall.b.x;
    if (horizontal === vertical) continue; // наклонная или вырожденная

    if (horizontal) {
      // Свободное пространство — со стороны центра комнаты.
      const direction: 1 | -1 = centerZ >= wall.a.z ? 1 : -1;
      result.push({
        wall,
        axis: 'z',
        inner: wall.a.z + direction * half,
        direction,
        // Изделие смотрит фасадом в комнату: спина к стене. Фасад
        // направлен по +Z, поэтому у задней стены поворот нулевой.
        rotation: direction === 1 ? 0 : Math.PI,
      });
    } else {
      const direction: 1 | -1 = centerX >= wall.a.x ? 1 : -1;
      result.push({
        wall,
        axis: 'x',
        inner: wall.a.x + direction * half,
        direction,
        rotation: direction === 1 ? HALF_PI : -HALF_PI,
      });
    }
  }
  return result;
}

/**
 * Положение изделия, поставленного спиной вплотную к стене.
 *
 * Считается через след с УЖЕ применённым поворотом: у повёрнутого шкафа
 * к стене прилегает другая сторона, и брать исходную глубину значило бы
 * утопить его в стену на разницу.
 */
function placeAgainst(axisWall: AxisWall, extent: Vec3, position: Vec3, rotation: number): Vec3 {
  const print = footprintOf(position, extent, rotation);
  if (axisWall.axis === 'z') {
    const z = axisWall.direction === 1 ? axisWall.inner : axisWall.inner - print.depth;
    // Возвращается положение УГЛА ДО поворота: сдвигаем на разницу между
    // текущим следом и нужным.
    return { x: position.x, y: position.y, z: roundMm(position.z + (z - print.z)) };
  }
  const x = axisWall.direction === 1 ? axisWall.inner : axisWall.inner - print.width;
  return { x: roundMm(position.x + (x - print.x)), y: position.y, z: position.z };
}

/**
 * Прижать изделие к внутренней грани ПЕРПЕНДИКУЛЯРНОЙ стены.
 *
 * Выравнивание идёт именно по внутренней грани (`inner`), а не по концу
 * отрезка стены: конец отрезка лежит на осевой линии, и изделие,
 * поставленное по нему, оказалось бы наполовину в стене — на половину её
 * толщины. Найдено тестом углового кандидата: кандидатов не появлялось
 * вовсе, потому что изделие никогда не касалось второй стены.
 */
function alignAlong(other: AxisWall, print: Footprint, position: Vec3): Vec3 {
  if (other.axis === 'x') {
    const target = other.direction === 1 ? other.inner : other.inner - print.width;
    return { x: roundMm(position.x + (target - print.x)), y: position.y, z: position.z };
  }
  const target = other.direction === 1 ? other.inner : other.inner - print.depth;
  return { x: position.x, y: position.y, z: roundMm(position.z + (target - print.z)) };
}

/**
 * Кандидаты привязки для текущего положения.
 *
 * Возвращаются ВСЕ применимые, а выбор ближайшего делает `applySnap`:
 * так интерфейс может показать, куда ещё можно прижаться, а тест —
 * проверить набор, не завися от порога.
 *
 * Текущий поворот изделия среди аргументов отсутствует намеренно:
 * привязка к стене САМА задаёт ориентацию — изделие встаёт спиной к
 * стене (§15). Учитывать прежний угол значило бы прижимать шкаф к стене
 * боком, если пользователь до этого его повернул.
 */
export function snapCandidates(room: Room, extent: Vec3, position: Vec3): SnapCandidate[] {
  const walls = axisWalls(room);
  const candidates: SnapCandidate[] = [];

  for (const axisWall of walls) {
    const wallRotation = axisWall.rotation;
    const against = placeAgainst(axisWall, extent, position, wallRotation);
    candidates.push({
      kind: 'wall',
      position: against,
      rotation: wallRotation,
      wallId: axisWall.wall.id,
      label: 'К стене',
    });

    // Углы: та же стена плюс каждая перпендикулярная ей. Каждая пара
    // даёт РОВНО ОДИН угол — тот, к внутренней грани которого изделие
    // прижимается второй стороной.
    const print = footprintOf(against, extent, wallRotation);
    for (const other of walls) {
      if (other.wall.id === axisWall.wall.id || other.axis === axisWall.axis) continue;
      const aligned = alignAlong(other, print, against);
      candidates.push({
        kind: 'corner',
        position: aligned,
        rotation: wallRotation,
        wallId: axisWall.wall.id,
        secondWallId: other.wall.id,
        label: 'В угол',
      });
    }
  }

  return candidates;
}

/**
 * Ближайший кандидат в пределах радиуса.
 *
 * @param radiusMm радиус притяжения, уже переведённый из пикселей экрана
 *                 вызывающей стороной: слой не знает ни о камере, ни о
 *                 масштабе, и знать не должен.
 *
 * Угол побеждает стену при равном расстоянии: пользователь, подводящий
 * шкаф к углу, целится именно в угол, а не в одну из двух стен.
 */
export function applySnap(
  room: Room,
  extent: Vec3,
  position: Vec3,
  rotation: number,
  radiusMm: Mm,
): SnapResult {
  if (radiusMm <= 0) return { position, rotation, snapped: undefined };

  let best: SnapCandidate | undefined;
  let bestDistance = Infinity;

  for (const candidate of snapCandidates(room, extent, position)) {
    const distance = Math.hypot(candidate.position.x - position.x, candidate.position.z - position.z);
    if (distance > radiusMm) continue;
    const better =
      distance < bestDistance - 1e-6 ||
      (Math.abs(distance - bestDistance) <= 1e-6 && candidate.kind === 'corner' && best?.kind !== 'corner');
    if (!better) continue;
    best = candidate;
    bestDistance = distance;
  }

  if (best === undefined) return { position, rotation, snapped: undefined };
  return { position: best.position, rotation: normalizeRotation(best.rotation), snapped: best };
}
