import type { GeometryResult } from '../geometry/index.js';
import { formatMm, type EdgeSpec, type MaterialLibrary, type Mm, type PartRole } from '../domain/index.js';
import { contentKindOf, contentLabel } from '../geometry/index.js';

/**
 * Domain Geometry → Render Model.
 *
 * Чистое преобразование `GeometryResult` в набор примитивов, которые умеет
 * рисовать `DebugSchema.tsx`: прямоугольники и размерные линии, всё ещё
 * в миллиметрах и в доменной системе координат (Y вверх). Инверсия оси Y
 * под экран — задача компонента отрисовки, не этого модуля
 * (docs/COORDINATE_SYSTEM.md §1: «домен про экран ничего не знает»).
 *
 * Смысл существования файла — PROMPT 4 §20: «не заставляй renderer понимать
 * мебельные формулы». Здесь нет ни одной геометрической формулы — только
 * проекция уже посчитанных 3D-объёмов на плоскость XY (вид спереди, ось Z
 * отбрасывается) и форматирование чисел для подписей.
 */

export interface DebugRect {
  readonly id: string;
  readonly label: string;
  readonly kind: 'part' | 'cell';
  readonly role?: PartRole;
  readonly x: Mm;
  readonly y: Mm;
  readonly width: Mm;
  readonly height: Mm;
  /**
   * Третий размер детали (глубина, ось Z), отброшенный видом спереди —
   * нужен только для подписи в режиме debug-инфо (PROMPT 6 §27: «для
   * полки — ширину, глубину, толщину, Y»), саму проекцию не меняет.
   */
  readonly depth?: Mm;
  /** Секция, к которой относится деталь — только если она принадлежит ровно одной ячейке. */
  readonly sectionId?: string;
  /**
   * Наполнение ячейки (PROMPT 9 §15) — только у прямоугольников-ячеек.
   * Показывается всегда, а не только в debug-инфо: «что стоит в этой
   * ячейке» — то, ради чего смотрят на схему, а не служебная подробность.
   */
  readonly content?: string;
  /**
   * Готовая строка для режима debug-инфо (PROMPT 8 §24): id, координаты и
   * размеры объекта. Собирается здесь, а не в компоненте, по той же причине,
   * по которой здесь же живут размерные линии: строка состоит из чисел
   * `GeometryResult`, и её состав нужно уметь проверить тестом, а не глазами
   * на экране.
   */
  readonly detail: string;
}

export interface DebugDimensionLine {
  readonly id: string;
  readonly axis: 'x' | 'y';
  /** Положение линии вдоль ДРУГОЙ оси (для горизонтальной линии — Y, и наоборот). */
  readonly at: Mm;
  readonly from: Mm;
  readonly to: Mm;
  readonly text: string;
}

/**
 * Подпись секции для проверки движка (PROMPT 7 §22): «SECTION 1» с её
 * шириной, X и id. Ни одно из этих чисел здесь не вычисляется — все
 * приходят из `GeometryResult.sections`.
 */
export interface DebugSectionLabel {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** Центр секции по X и её низ по Y — куда ставить подпись. */
  readonly centerX: Mm;
  readonly bottomY: Mm;
}

export interface DebugSchemaView {
  readonly totalWidth: Mm;
  readonly totalHeight: Mm;
  readonly rects: readonly DebugRect[];
  readonly dimensions: readonly DebugDimensionLine[];
  readonly sectionLabels: readonly DebugSectionLabel[];
}

/** Кромка по четырём сторонам одной строкой: «перед/зад/лево/право». */
function edgeSummary(edge: EdgeSpec): string {
  return `${String(edge.front)}/${String(edge.back)}/${String(edge.left)}/${String(edge.right)}`;
}

/**
 * Материал/толщина/кромка детали одной подстрокой (PROMPT 13 §22): имя
 * материала — из `MaterialLibrary` по `part.materialId`, толщина — уже
 * посчитанная `part.cut.thickness` (не пересчитывается здесь заново, тот
 * же принцип «рендерер не знает мебельных формул»), кромка — `edgeSummary`.
 * Показывается для ЛЮБОЙ физической детали, включая двери и фасады ящиков.
 */
function materialSuffix(part: GeometryResult['parts'][number], materials: MaterialLibrary): string {
  const material = materials.items[part.materialId];
  const materialName = material?.name ?? `? (${part.materialId})`;
  return ` · Материал: ${materialName} · Т ${formatMm(part.cut.thickness)} мм · Кромка ${edgeSummary(part.edge)}`;
}

/**
 * Состав подписи детали в режиме debug-инфо (PROMPT 8 §24). У каждого вида
 * детали свой набор: у перегородки важна толщина, у полки — глубина, у
 * остальных достаточно координаты. Роль стоит первой, чтобы подпись
 * оставалась узнаваемой с одного взгляда. Материал/толщина/кромка (PROMPT
 * 13 §22) добавлены суффиксом ко всем веткам одинаково.
 */
function partDetail(part: GeometryResult['parts'][number], materials: MaterialLibrary): string {
  const role = part.role;
  const at = `X ${formatMm(part.position.x)} Y ${formatMm(part.position.y)}`;
  const mat = materialSuffix(part, materials);
  if (role === 'partition') {
    return `${role} · ${part.id} · ${at} · Т ${formatMm(part.size.x)} × В ${formatMm(part.size.y)}${mat}`;
  }
  if (role === 'shelf-fixed' || role === 'shelf-adjustable') {
    return `${role} · ${part.id} · ${at} · Ш ${formatMm(part.size.x)} × Г ${formatMm(part.size.z)} × Т ${formatMm(part.size.y)}${mat}`;
  }
  if (role === 'facade') {
    // Дверь (PROMPT 10 §18): та же геометрия, что и у остальных деталей,
    // плюс сторона петель — она уже закодирована в `part.label`
    // (`stages/facades.ts`), здесь не пересчитывается и не дублируется.
    return `${part.label} · ${part.id} · ${at} · Ш ${formatMm(part.size.x)} × В ${formatMm(part.size.y)} × Т ${formatMm(part.size.z)}${mat}`;
  }
  if (role === 'handle' || role === 'push-to-open') {
    // Ручка/push-to-open (PROMPT 12 §18): та же геометрия, что и у
    // остальных деталей — ширина/высота/вынос от плоскости фасада.
    return `${part.label} · ${part.id} · ${at} · Ш ${formatMm(part.size.x)} × В ${formatMm(part.size.y)} × вынос ${formatMm(part.size.z)}${mat}`;
  }
  return `${role} · ${part.id} · ${at}${mat}`;
}

export function buildDebugView(geometry: GeometryResult, materials: MaterialLibrary): DebugSchemaView {
  const { totalWidth, totalHeight } = geometry.boundingBox;

  const sectionIdByCellNodeId = new Map(geometry.cells.map((cell) => [cell.nodeId, cell.sectionId]));

  const partRects: DebugRect[] = geometry.parts.map((part) => {
    const sectionId = part.origin.nodeId === undefined ? undefined : sectionIdByCellNodeId.get(part.origin.nodeId);
    return {
      id: part.id,
      label: part.label,
      kind: 'part',
      role: part.role,
      x: part.position.x,
      y: part.position.y,
      width: part.size.x,
      height: part.size.y,
      depth: part.size.z,
      detail: partDetail(part, materials),
      ...(sectionId === undefined ? {} : { sectionId }),
    };
  });

  // Двери на ячейке (PROMPT 10 §18) — НЕ `LeafFill`: `FacadeGroup` живёт
  // отдельно (`Furniture.facades`, docs/GEOMETRY_RULES.md §17.4), поэтому
  // «есть ли дверь» здесь узнают по уже построенным деталям роли `facade`
  // с этой ячейкой как `origin.nodeId`, а не по `cell.fill`. Фасады ящиков
  // (PROMPT 11) используют ТУ ЖЕ роль `facade` (переиспользована, не
  // заведена вторая), поэтому исключаются здесь явно по `cell.fill.kind`:
  // у ячейки одно наполнение (§17.3), и когда это `drawers`, её facade-
  // детали — фасады ящиков, а не дверь; `CONTENT: ЯЩИКИ` эти детали уже
  // не нуждается — он и так виден в `fillContent` через `contentLabel`.
  const fillKindByCellNodeId = new Map(geometry.cells.map((cell) => [cell.nodeId, cell.fill.kind]));
  const doorPartsByCell = new Map<string, Array<GeometryResult['parts'][number]>>();
  for (const part of geometry.parts) {
    if (part.role !== 'facade' || part.origin.nodeId === undefined) continue;
    if (fillKindByCellNodeId.get(part.origin.nodeId) === 'drawers') continue;
    const list = doorPartsByCell.get(part.origin.nodeId);
    if (list === undefined) doorPartsByCell.set(part.origin.nodeId, [part]);
    else list.push(part);
  }

  // Способ открывания (PROMPT 12 §18) — детали ролей `handle`/`push-to-open`
  // сгруппированы по ячейке той же группировкой, что и двери/фасады ящиков
  // выше: обе роли лежат в `GeometryResult.parts` наравне с остальными
  // (обоснование — `src/geometry/opening-system.ts`), «Opening System» не
  // хранится отдельно — читается по факту построенных деталей.
  const openingPartsByCell = new Map<string, Array<GeometryResult['parts'][number]>>();
  for (const part of geometry.parts) {
    if ((part.role !== 'handle' && part.role !== 'push-to-open') || part.origin.nodeId === undefined) continue;
    const list = openingPartsByCell.get(part.origin.nodeId);
    if (list === undefined) openingPartsByCell.set(part.origin.nodeId, [part]);
    else list.push(part);
  }

  const cellRects: DebugRect[] = geometry.cells.map((cell) => {
    const doors = doorPartsByCell.get(cell.nodeId) ?? [];
    const openings = openingPartsByCell.get(cell.nodeId) ?? [];
    const fillContent = `CONTENT: ${contentLabel(contentKindOf(cell.fill)).toUpperCase()}`;
    const doorSuffix = doors.length === 0 ? '' : ` · ДВЕРЬ${doors.length > 1 ? ` ×${String(doors.length)}` : ''}: ${doors.map((d) => d.id).join(', ')}`;
    const openingSuffix =
      openings.length === 0
        ? ''
        : ` · Opening: ${openings.map((o) => `${o.role === 'handle' ? 'HANDLE' : 'PUSH_TO_OPEN'} (${o.id})`).join(', ')}`;
    const content = `${fillContent}${doorSuffix}${openingSuffix}`;
    return {
      id: cell.nodeId,
      label: `${formatMm(cell.box.size.x)} × ${formatMm(cell.box.size.y)}`,
      kind: 'cell',
      x: cell.box.min.x,
      y: cell.box.min.y,
      width: cell.box.size.x,
      height: cell.box.size.y,
      // Наполнение приходит из `GeometryResult.cells[].fill` — того же места,
      // откуда его берёт движок. Разбирать `LeafFill` рендерер не умеет
      // и не должен: вид наполнения отдаёт `contentKindOf` (для ящиков —
      // «ЯЩИКИ», без отдельной пометки: они, в отличие от двери, и есть
      // `fill`). Дверь к нему добавляется отдельно (см. `doorPartsByCell`
      // выше), потому что живёт не в `fill`, а в `Furniture.facades`.
      content,
      // Ячейка: id, X, Y, ширина, высота (PROMPT 8 §24), вид наполнения
      // (PROMPT 9 §15), id её дверей (PROMPT 10 §18) и способ открывания
      // (PROMPT 12 §18), если есть.
      detail: `${cell.nodeId} · X ${formatMm(cell.box.min.x)} Y ${formatMm(cell.box.min.y)} · Ш ${formatMm(cell.box.size.x)} × В ${formatMm(cell.box.size.y)} · ${contentKindOf(cell.fill)}${doors.length === 0 ? '' : ` · дверь: ${doors.map((d) => d.id).join(', ')}`}${openings.length === 0 ? '' : ` · opening: ${openings.map((o) => o.id).join(', ')}`}`,
    };
  });

  const dimensions: DebugDimensionLine[] = [];

  if (totalWidth > 0) {
    dimensions.push({
      id: 'dim-total-width',
      axis: 'x',
      at: totalHeight,
      from: 0,
      to: totalWidth,
      text: `${formatMm(totalWidth)} мм`,
    });
  }
  if (totalHeight > 0) {
    dimensions.push({
      id: 'dim-total-height',
      axis: 'y',
      at: 0,
      from: 0,
      to: totalHeight,
      text: `${formatMm(totalHeight)} мм`,
    });
  }

  // Секции приходят из движка готовыми областями (`GeometryResult.sections`).
  // Раньше рендерер восстанавливал их сам, агрегируя ячейки по `sectionId` —
  // то есть держал у себя знание о том, где проходит граница секции. Это
  // ровно то, что в проекте рендереру запрещено (docs/ARCHITECTURE.md §1);
  // теперь такого знания здесь нет, а формула живёт в одном месте — в
  // `stages/layout.ts` (docs/GEOMETRY_RULES.md §15.4).
  const { sections } = geometry;
  if (sections.length > 1) {
    for (const section of sections) {
      dimensions.push({
        id: `dim-section-${String(section.index)}`,
        axis: 'x',
        at: totalHeight + SECTION_DIMENSION_OFFSET,
        from: section.box.min.x,
        to: section.box.min.x + section.box.size.x,
        text: `${formatMm(section.box.size.x)} мм`,
      });
    }
  }

  const sectionLabels: DebugSectionLabel[] = sections.map((section) => ({
    id: section.nodeId,
    title: `SECTION ${String(section.index + 1)}`,
    detail: `Ш ${formatMm(section.box.size.x)} · X ${formatMm(section.box.min.x)} · ${section.nodeId}`,
    centerX: section.box.min.x + section.box.size.x / 2,
    bottomY: section.box.min.y,
  }));

  return {
    totalWidth,
    totalHeight,
    rects: [...partRects, ...cellRects],
    dimensions,
    sectionLabels,
  };
}

/** Отступ размерной линии секций от общей линии ширины, чтобы они не сливались. */
const SECTION_DIMENSION_OFFSET: Mm = 24;
