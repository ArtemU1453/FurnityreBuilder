import type {
  Box3,
  DividerSpec,
  EdgeSpec,
  MaterialLibrary,
  NodeId,
  PartOrientation,
  PartRole,
  SectionNode,
  SplitAxis,
} from '../../domain/index.js';
import {
  DEFAULT_EDGE,
  MIN_CELL_SIZE,
  dividerOffset,
  extentAlong,
  isLeaf,
  resolveSizes,
  roundMm,
  sliceAlong,
  vec3,
} from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveMaterial } from '../parts.js';

/**
 * Раскладка дерева секций: превращает `Furniture.root` (уже существующее
 * дерево `SplitNode`/`LeafNode`, docs/DATA_MODEL.md §5) в реальную геометрию —
 * ячейки (`CellBox`) и детали перегородок/разделителей (`Part`).
 *
 * Формально это два этапа исходного плана (`layout` и `dividers`,
 * docs/ARCHITECTURE.md §5.2) — здесь они объединены в один, потому что обе
 * задачи вычисляются ИЗ ОДНОГО вызова `resolveSizes` на каждом делении:
 * посчитать позиции ячеек и посчитать позиции перегородок отдельными
 * проходами значило бы дважды решать одну и ту же задачу или протаскивать
 * результат первого прохода во второй окольным путём. Решение
 * задокументировано в docs/GEOMETRY_RULES.md §10.
 *
 * Источник истины — дерево. Количество секций, строк и колонок нигде не
 * хранится отдельным числом: это структура дерева, а перегородки и границы
 * ячеек — её прямое следствие, вычисляемое здесь и никогда не хранимое
 * заранее (PROMPT 4 §12).
 */

/** 'x' → вертикальная перегородка (стойка), 'y' → горизонтальный разделитель (полка). */
function dividerRole(axis: SplitAxis, divider: DividerSpec): PartRole {
  if (axis === 'x') return 'partition';
  return divider.mounting === 'adjustable' ? 'shelf-adjustable' : 'shelf-fixed';
}

function dividerOrientation(axis: SplitAxis): PartOrientation {
  return axis === 'x' ? 'vertical-yz' : 'horizontal-xz';
}

interface ResolvedDividerMaterial {
  readonly materialId: ReturnType<typeof resolveMaterial>['materialId'];
  readonly edge: EdgeSpec;
}

function resolveDividerMaterial(
  materials: MaterialLibrary,
  role: PartRole,
  divider: DividerSpec,
  onFallback: () => void,
): ResolvedDividerMaterial {
  if (divider.materialId !== undefined) {
    return { materialId: divider.materialId, edge: divider.edge ?? DEFAULT_EDGE };
  }
  const resolved = resolveMaterial(materials, role);
  if (!resolved.resolved) onFallback();
  return { materialId: resolved.materialId, edge: divider.edge ?? DEFAULT_EDGE };
}

/** Секция ребёнка при первом (и единственном) делении верхнего уровня по X. */
function sectionIdFor(
  parentSectionId: NodeId | undefined,
  parentAxis: SplitAxis,
  parentNodeId: NodeId,
  childId: NodeId,
): NodeId {
  if (parentSectionId !== undefined) return parentSectionId;
  return parentAxis === 'x' ? childId : parentNodeId;
}

export const layoutStage: GeometryStage = {
  name: 'layout',
  run(ctx: GeometryContext): void {
    const { furniture, materials, edgeSizing } = ctx.input;
    let dividersReported = false;

    const reportMaterialFallback = (): void => {
      if (dividersReported) return;
      dividersReported = true;
      ctx.report(
        'MATERIAL_NOT_ASSIGNED',
        'warning',
        'Материал для перегородки не назначен, взят первый из библиотеки.',
      );
    };

    const walk = (
      node: SectionNode,
      box: Box3,
      row: number,
      column: number,
      sectionId: NodeId | undefined,
    ): void => {
      if (isLeaf(node)) {
        const effectiveSectionId = sectionId ?? node.id;
        ctx.addCell({ nodeId: node.id, box, row, column, sectionId: effectiveSectionId, fill: node.fill });
        return;
      }

      const available = extentAlong(box, node.axis);
      const result = resolveSizes(
        node.children.map((c) => c.size),
        available,
        node.divider.thickness,
      );

      // Одна испорченная ветка дерева останавливает только себя — соседние
      // секции и уже построенный каркас остаются валидными и видимыми.
      // Обоснование и сравнение с политикой между этапами —
      // docs/GEOMETRY_RULES.md §10.
      if (result.overconstrained) {
        ctx.report(
          'SPLIT_OVERCONSTRAINED',
          'error',
          'Деление не помещается в доступное пространство: перегородки и фиксированные ячейки в сумме превышают доступный размер.',
          { nodeId: node.id },
        );
        return;
      }
      if (result.spans.some((span) => span.length <= 0)) {
        ctx.report(
          'CELL_SPAN_NOT_POSITIVE',
          'error',
          'Одна из ячеек деления получила неположительный размер.',
          { nodeId: node.id },
        );
        return;
      }

      node.children.forEach((child, i) => {
        const span = result.spans[i];
        if (span === undefined) return;
        const childBox = sliceAlong(box, node.axis, span.offset, span.length);
        const childRow = node.axis === 'y' ? i : row;
        const childColumn = node.axis === 'x' ? i : column;
        const childSectionId = sectionIdFor(sectionId, node.axis, node.id, child.node.id);

        walk(child.node, childBox, childRow, childColumn, childSectionId);

        if (childBox.size.x < MIN_CELL_SIZE || childBox.size.y < MIN_CELL_SIZE) {
          if (isLeaf(child.node)) {
            ctx.report(
              'CELL_BELOW_MIN_SIZE',
              'warning',
              `Ячейка меньше рекомендуемого минимума (${String(MIN_CELL_SIZE)} мм).`,
              { nodeId: child.node.id },
            );
          }
        }
      });

      // Перегородки: N детей дают N−1 границ между ними.
      if (node.divider.material === 'panel') {
        const role = dividerRole(node.axis, node.divider);
        const mat = resolveDividerMaterial(materials, role, node.divider, reportMaterialFallback);

        for (let i = 0; i < node.children.length - 1; i += 1) {
          const offset = dividerOffset(result.spans, i);
          const position =
            node.axis === 'x'
              ? vec3(roundMm(box.min.x + offset), box.min.y, box.min.z)
              : vec3(box.min.x, roundMm(box.min.y + offset), box.min.z);
          const size =
            node.axis === 'x'
              ? vec3(node.divider.thickness, box.size.y, box.size.z)
              : vec3(box.size.x, node.divider.thickness, box.size.z);

          ctx.addPart(
            makePart({
              furnitureId: furniture.id,
              role,
              label: node.axis === 'x' ? `Вертикальная перегородка ${String(i + 1)}` : `Горизонтальный разделитель ${String(i + 1)}`,
              index: i,
              position,
              size,
              orientation: dividerOrientation(node.axis),
              materialId: mat.materialId,
              edge: mat.edge,
              edgeSizing,
              nodeId: node.id,
            }),
          );
        }
      }
    };

    walk(furniture.root, ctx.innerVolume, 0, 0, undefined);
  },
};
