import type { Box3, EdgeSpec, LeafFill, MaterialLibrary, Mm, NodeId, PartRole, Shelf } from '../../domain/index.js';
import {
  DEFAULT_EDGE,
  dividerOffset,
  findNode,
  gtMm,
  isLeaf,
  ltMm,
  resolveSizes,
  roundMm,
  vec3,
} from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveMaterial } from '../parts.js';

/**
 * Наполнение ячеек: полки (PROMPT 6). Первая часть этапа `fill`
 * (`docs/GEOMETRY_RULES.md` §10) — ящики и штанга остаются `LeafFill`-видами
 * без геометрии до своих этапов плана (21, 23); эта функция их просто
 * пропускает, не считая отсутствие геометрии ошибкой.
 *
 * Источник истины — `LeafNode.fill`, как и раньше: полка не хранит своих
 * X/Y/Z/width/height/depth — они вычисляются здесь из объёма ячейки,
 * которую уже построил `layout` (§9). Cell — пространство, Shelf — деталь;
 * ни одна ячейка сама по себе этим этапом не создаётся и не меняется
 * (PROMPT 6 §5, `docs/DATA_MODEL.md` §5.6 и §6.1).
 */

function shelfRole(mounting: Shelf['mounting']): PartRole {
  return mounting === 'adjustable' ? 'shelf-adjustable' : 'shelf-fixed';
}

/** Полки одной ячейки, независимо от того, в каком `LeafFill.kind` они лежат. */
function shelvesOf(fill: LeafFill): readonly Shelf[] {
  if (fill.kind === 'shelves') return fill.shelves;
  if (fill.kind === 'rod+shelf') return [fill.shelfAbove];
  return [];
}

interface ResolvedShelfMaterial {
  readonly materialId: ReturnType<typeof resolveMaterial>['materialId'];
  readonly edge: EdgeSpec;
}

function resolveShelfMaterial(
  materials: MaterialLibrary,
  role: PartRole,
  shelf: Shelf,
  onFallback: () => void,
): ResolvedShelfMaterial {
  if (shelf.materialId !== undefined) {
    return { materialId: shelf.materialId, edge: shelf.edge ?? DEFAULT_EDGE };
  }
  const resolved = resolveMaterial(materials, role);
  if (!resolved.resolved) onFallback();
  return { materialId: resolved.materialId, edge: shelf.edge ?? DEFAULT_EDGE };
}

/** Одна вычисленная полка до создания `Part`: только то, что нужно для геометрии и для проверки пересечений. */
interface ShelfPlan {
  readonly shelf: Shelf;
  readonly y: Mm;
  readonly thickness: Mm;
  readonly depth: Mm;
}

/**
 * `count` полок делят высоту ячейки на `count + 1` равных промежутков —
 * ровно та же задача, что `resolveSizes` уже решает для структурных рядов
 * (`docs/GEOMETRY_RULES.md` §9.2): `count + 1` одинаковых flex-детей,
 * разделённых `count` "перегородками" толщиной с полку. Переиспользуется
 * тот же алгоритм и та же функция `dividerOffset`, а не пишется заново.
 *
 * Все полки одной auto-группы используют ОДНУ эффективную толщину (толщину
 * первой полки группы или толщину корпуса) — инженерное решение этого
 * этапа: `resolveSizes` берёт одну толщину разделителя на всё деление,
 * а `count` независимо заданных `Shelf.thickness` внутри одной равномерной
 * группы физически противоречили бы самой идее «равномерно». Полное
 * обоснование — `docs/GEOMETRY_RULES.md`, «Shelf Calculation Rules».
 */
function planAutoShelves(ctx: GeometryContext, box: Box3, nodeId: NodeId, autoShelves: readonly Shelf[], thicknessDefault: Mm): ShelfPlan[] {
  const count = autoShelves.length;
  const declaredCounts = new Set(
    autoShelves.map((s) => (s.placement.mode === 'auto' ? s.placement.count : -1)),
  );
  const indices = autoShelves.map((s) => (s.placement.mode === 'auto' ? s.placement.index : -1));
  const indicesValid = new Set(indices).size === count && indices.every((i) => i >= 0 && i < count);

  if (declaredCounts.size !== 1 || !declaredCounts.has(count) || !indicesValid) {
    ctx.report(
      'SHELF_AUTO_PLACEMENT_INCONSISTENT',
      'error',
      'Полки с автоматическим размещением в одной ячейке имеют несогласованные index/count: полки этой группы не построены.',
      { nodeId },
    );
    return [];
  }

  const thickness = autoShelves[0]?.thickness ?? thicknessDefault;
  const result = resolveSizes(
    Array.from({ length: count + 1 }, () => ({ mode: 'flex' as const, weight: 1 })),
    box.size.y,
    thickness,
  );

  if (result.overconstrained || result.spans.some((span) => span.length <= 0)) {
    ctx.report(
      'SHELF_AUTO_OVERCONSTRAINED',
      'error',
      'Равномерные полки не помещаются в высоту ячейки: полки этой группы не построены.',
      { nodeId },
    );
    return [];
  }

  const byIndex = new Map(autoShelves.map((s) => [s.placement.mode === 'auto' ? s.placement.index : -1, s]));

  const plans: ShelfPlan[] = [];
  for (let i = 0; i < count; i += 1) {
    const shelf = byIndex.get(i);
    if (shelf === undefined) continue;
    const shelfThickness = shelf.thickness ?? thickness;
    const y = roundMm(box.min.y + dividerOffset(result.spans, i));
    const frontSetback = shelf.frontSetback ?? 0;
    const depth = roundMm(box.size.z - frontSetback);
    if (!gtMm(depth, 0)) {
      ctx.report('SHELF_DEPTH_NOT_POSITIVE', 'error', 'Отступ от фасада полки не меньше глубины ячейки: полка не построена.', { nodeId });
      continue;
    }
    plans.push({ shelf, y, thickness: shelfThickness, depth });
  }
  return plans;
}

/** Полка с ручным положением: `offsetFromBottom` — прямой ввод, без распределения. */
function planManualShelf(ctx: GeometryContext, box: Box3, nodeId: NodeId, shelf: Shelf, thicknessDefault: Mm): ShelfPlan | undefined {
  if (shelf.placement.mode !== 'manual') return undefined;
  const { offsetFromBottom } = shelf.placement;
  const thickness = shelf.thickness ?? thicknessDefault;

  if (ltMm(offsetFromBottom, 0)) {
    ctx.report('SHELF_OUT_OF_CELL_BOUNDS', 'error', 'Отступ полки от низа ячейки отрицателен: полка не построена.', { nodeId });
    return undefined;
  }
  if (gtMm(roundMm(offsetFromBottom + thickness), box.size.y)) {
    ctx.report('SHELF_OUT_OF_CELL_BOUNDS', 'error', 'Полка с ручным положением выходит за пределы ячейки: полка не построена.', { nodeId });
    return undefined;
  }

  const frontSetback = shelf.frontSetback ?? 0;
  const depth = roundMm(box.size.z - frontSetback);
  if (!gtMm(depth, 0)) {
    ctx.report('SHELF_DEPTH_NOT_POSITIVE', 'error', 'Отступ от фасада полки не меньше глубины ячейки: полка не построена.', { nodeId });
    return undefined;
  }

  return { shelf, y: roundMm(box.min.y + offsetFromBottom), thickness, depth };
}

/**
 * Полки внутри одной ячейки по построению (auto — через `resolveSizes`)
 * либо по вводу пользователя (manual) не пересекаются сами с собой — но
 * комбинация manual+manual или manual+auto не гарантирована формулой и
 * проверяется здесь явно (PROMPT 6 §16). Обе полки остаются в результате —
 * подсветить проблему в debug-схеме полезнее, чем молча убрать одну
 * из деталей.
 */
function reportOverlaps(ctx: GeometryContext, nodeId: NodeId, plans: readonly ShelfPlan[]): void {
  const sorted = [...plans].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (gtMm(roundMm(prev.y + prev.thickness), cur.y)) {
      ctx.report('SHELF_OVERLAP', 'error', 'Две полки одной ячейки пересекаются по высоте.', { nodeId });
    }
  }
}

export const fillStage: GeometryStage = {
  name: 'fill',
  run(ctx: GeometryContext): void {
    const { furniture, materials, edgeSizing } = ctx.input;
    const T = roundMm(furniture.dimensions.panelThickness);

    let fallbackReported = false;
    const reportMaterialFallback = (): void => {
      if (fallbackReported) return;
      fallbackReported = true;
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для полки не назначен, взят первый из библиотеки.');
    };

    for (const cell of ctx.getCells()) {
      const node = findNode(furniture.root, cell.nodeId);
      if (node === undefined || !isLeaf(node)) continue;

      const allShelves = shelvesOf(node.fill);
      if (allShelves.length === 0) continue;

      const autoShelves = allShelves.filter((s) => s.placement.mode === 'auto');
      const manualShelves = allShelves.filter((s) => s.placement.mode === 'manual');

      const plans: ShelfPlan[] = [];
      if (autoShelves.length > 0) {
        plans.push(...planAutoShelves(ctx, cell.box, cell.nodeId, autoShelves, T));
      }
      for (const shelf of manualShelves) {
        const plan = planManualShelf(ctx, cell.box, cell.nodeId, shelf, T);
        if (plan !== undefined) plans.push(plan);
      }

      reportOverlaps(ctx, cell.nodeId, plans);

      plans.forEach((plan, i) => {
        const role = shelfRole(plan.shelf.mounting);
        const mat = resolveShelfMaterial(materials, role, plan.shelf, reportMaterialFallback);
        ctx.addPart(
          makePart({
            furnitureId: furniture.id,
            role,
            label: `Полка ${String(i + 1)}`,
            index: plan.shelf.id,
            position: vec3(cell.box.min.x, plan.y, cell.box.min.z),
            size: vec3(cell.box.size.x, plan.thickness, plan.depth),
            orientation: 'horizontal-xz',
            materialId: mat.materialId,
            edge: mat.edge,
            edgeSizing,
            nodeId: cell.nodeId,
          }),
        );
      });
    }
  },
};
