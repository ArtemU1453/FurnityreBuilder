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

export interface DebugSchemaView {
  readonly totalWidth: Mm;
  readonly totalHeight: Mm;
  readonly rects: readonly DebugRect[];
  readonly dimensions: readonly DebugDimensionLine[];
}

/** Секция для целей отрисовки: только то, что нужно, чтобы подписать её ширину. */
interface SectionSpan {
  readonly id: string;
  readonly minX: Mm;
  readonly maxX: Mm;
}

/**
 * Секции для подписи — тот же вывод, что `deriveSections` дал бы
 * агрегированием по `cell.sectionId`, но без отдельного публичного API:
 * здесь нужна только ширина для одной размерной линии на секцию.
 */
function collectSectionSpans(geometry: GeometryResult): SectionSpan[] {
  const bySection = new Map<string, { minX: number; maxX: number }>();
  for (const cell of geometry.cells) {
    const span = bySection.get(cell.sectionId);
    const minX = cell.box.min.x;
    const maxX = cell.box.min.x + cell.box.size.x;
    if (span === undefined) {
      bySection.set(cell.sectionId, { minX, maxX });
    } else {
      span.minX = Math.min(span.minX, minX);
      span.maxX = Math.max(span.maxX, maxX);
    }
  }
  return [...bySection.entries()]
    .map(([id, span]) => ({ id, minX: span.minX, maxX: span.maxX }))
    .sort((a, b) => a.minX - b.minX);
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

  const sections = collectSectionSpans(geometry);
  if (sections.length > 1) {
    sections.forEach((section, i) => {
      dimensions.push({
        id: `dim-section-${String(i)}`,
        axis: 'x',
        at: totalHeight + SECTION_DIMENSION_OFFSET,
        from: section.minX,
        to: section.maxX,
        text: `${formatMm(section.maxX - section.minX)} мм`,
      });
    });
  }

  return {
    totalWidth,
    totalHeight,
    rects: [...partRects, ...cellRects],
    dimensions,
  };
}

/** Отступ размерной линии секций от общей линии ширины, чтобы они не сливались. */
const SECTION_DIMENSION_OFFSET: Mm = 24;
