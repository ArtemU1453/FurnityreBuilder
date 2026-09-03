import type { Box3, Vec3 } from '../coordinates.js';
import type { FurnitureId, MaterialId, NodeId, PartId } from '../ids.js';
import type { Mm } from '../units.js';
import type { EdgeSpec } from '../materials/types.js';

/**
 * Роль детали в изделии. Определяет правила материала, кромки и присадки.
 */
export type PartRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'partition'
  | 'shelf-fixed'
  | 'shelf-adjustable'
  | 'back'
  | 'plinth'
  | 'countertop'
  | 'facade'
  | 'drawer-front'
  | 'drawer-side'
  | 'drawer-back'
  | 'drawer-bottom'
  | 'handle'
  | 'push-to-open'
  | 'filler'
  | 'other';

/**
 * Плоскость пласти детали. Определяет, какие два габарита являются
 * «длина × ширина» для раскроя, а какой — толщиной.
 *
 *   vertical-yz    пласть в плоскости YZ, толщина по X  (боковина, перегородка)
 *   horizontal-xz  пласть в плоскости XZ, толщина по Y  (полка, верх, низ)
 *   frontal-xy     пласть в плоскости XY, толщина по Z  (фасад, задняя стенка)
 */
export type PartOrientation = 'vertical-yz' | 'horizontal-xz' | 'frontal-xy';

export type DrillFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type DrillPurpose =
  | 'confirmat-face'
  | 'confirmat-end'
  | 'shelf-support'
  | 'hinge-cup'
  | 'hinge-plate'
  | 'slide'
  | 'handle'
  | 'dowel'
  | 'eccentric';

export interface DrillHole {
  readonly face: DrillFace;
  /** Координаты в локальной системе детали, от её минимального угла. */
  readonly u: Mm;
  readonly v: Mm;
  readonly diameter: Mm;
  readonly depth: Mm;
  readonly purpose: DrillPurpose;
}

/** Размеры для раскроя: длина × ширина × толщина. */
export interface CutSize {
  readonly length: Mm;
  readonly width: Mm;
  readonly thickness: Mm;
}

/**
 * Деталь — результат работы геометрического движка, а НЕ часть проекта.
 *
 * Детали не хранятся и не сериализуются: они выводятся из `Furniture`
 * при каждом пересчёте. Хранение означало бы два источника истины и
 * неизбежное расхождение между схемой и деталировкой.
 */
export interface Part {
  /** Детерминированный идентификатор — см. buildPartId(). Стабилен между пересчётами. */
  readonly id: PartId;
  readonly role: PartRole;
  /** Человекочитаемая метка: «Боковина левая», «Полка 2». */
  readonly label: string;
  /** Положение минимального угла в системе координат изделия. */
  readonly position: Vec3;
  /** Габарит по осям изделия. */
  readonly size: Vec3;
  readonly orientation: PartOrientation;
  /** Размеры раскроя с уже применённой EdgeSizingPolicy. */
  readonly cut: CutSize;
  readonly materialId: MaterialId;
  readonly edge: EdgeSpec;
  /** Деталь нельзя поворачивать при раскрое (направленная текстура). */
  readonly grainLocked: boolean;
  /** Трассируемость: какой узел модели породил деталь. */
  readonly origin: PartOrigin;
  readonly drilling: readonly DrillHole[];
  /** Ключ группировки одинаковых деталей в спецификации. */
  readonly quantityGroupKey: string;
}

export interface PartOrigin {
  readonly furnitureId: FurnitureId;
  readonly nodeId?: NodeId;
}

/** Габаритный ящик детали в координатах изделия. */
export function partBox(part: Part): Box3 {
  return { min: part.position, size: part.size };
}
