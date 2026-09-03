import type { GeometryResult } from '../geometry/index.js';
import { formatMm, type Mm, type PartRole } from '../domain/index.js';

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

/**
 * Состав подписи детали в режиме debug-инфо (PROMPT 8 §24). У каждого вида
 * детали свой набор: у перегородки важна толщина, у полки — глубина, у
 * остальных достаточно координаты. Роль стоит первой, чтобы подпись
 * оставалась узнаваемой с одного взгляда.
 */
function partDetail(part: GeometryResult['parts'][number]): string {
  const role = part.role;
  const at = `X ${formatMm(part.position.x)} Y ${formatMm(part.position.y)}`;
  if (role === 'partition') {
    return `${role} · ${part.id} · ${at} · Т ${formatMm(part.size.x)} × В ${formatMm(part.size.y)}`;
  }
  if (role === 'shelf-fixed' || role === 'shelf-adjustable') {
    return `${role} · ${part.id} · ${at} · Ш ${formatMm(part.size.x)} × Г ${formatMm(part.size.z)} × Т ${formatMm(part.size.y)}`;
  }
  return `${role} · ${part.id} · ${at}`;
}

export function buildDebugView(geometry: GeometryResult): DebugSchemaView {
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
      detail: partDetail(part),
      ...(sectionId === undefined ? {} : { sectionId }),
    };
  });

  const cellRects: DebugRect[] = geometry.cells.map((cell) => ({
    id: cell.nodeId,
    label: `${formatMm(cell.box.size.x)} × ${formatMm(cell.box.size.y)}`,
    kind: 'cell',
    x: cell.box.min.x,
    y: cell.box.min.y,
    width: cell.box.size.x,
    height: cell.box.size.y,
    // Ячейка: id, X, Y, ширина, высота (PROMPT 8 §24).
    detail: `${cell.nodeId} · X ${formatMm(cell.box.min.x)} Y ${formatMm(cell.box.min.y)} · Ш ${formatMm(cell.box.size.x)} × В ${formatMm(cell.box.size.y)}`,
  }));

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
