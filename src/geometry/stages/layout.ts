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
import type { resolveMaterial } from '../parts.js';
import { makePart, resolveEffectiveMaterial } from '../parts.js';

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
  readonly roleNotAssigned: boolean;
  readonly danglingMaterialId: boolean;
  readonly danglingEdgeMaterialId: boolean;
  readonly structuralGlassOrMirror: boolean;
}

/**
 * Материал перегородки/разделителя. Толщина здесь НЕ пересчитывается через
 * материал (в отличие от полки, PROMPT 13 §9): `DividerSpec.thickness` —
 * обязательное поле, то есть уже explicit override верхнего уровня
 * приоритета, и именно по нему считает `resolveSizes` деление ячейки —
 * заводить второй, материал-зависимый источник толщины здесь означало бы
 * разойтись с уже посчитанными границами ячеек. Материал здесь только
 * назначает `materialId`/`edge` детали и проверяется на битую ссылку.
 */
function resolveDividerMaterial(materials: MaterialLibrary, role: PartRole, divider: DividerSpec): ResolvedDividerMaterial {
  const resolved = resolveEffectiveMaterial({
    materials,
    role,
    explicitMaterialId: divider.materialId,
    explicitEdge: divider.edge,
    thicknessOverride: divider.thickness,
    corpusThickness: divider.thickness,
  });
  return {
    materialId: resolved.materialId,
    edge: resolved.edge,
    roleNotAssigned: resolved.roleNotAssigned,
    danglingMaterialId: resolved.danglingMaterialId,
    danglingEdgeMaterialId: resolved.danglingEdgeMaterialId,
    structuralGlassOrMirror: resolved.structuralGlassOrMirror,
  };
}

/**
 * Диагностики результата `resolveDividerMaterial` — тот же приём, что
 * в `stages/fill.ts`/`stages/facades.ts` (PROMPT 13 §15/§20).
 */
function reportMaterialIssues(ctx: GeometryContext, nodeId: NodeId, label: string, resolved: ResolvedDividerMaterial): void {
  if (resolved.danglingMaterialId) {
    ctx.report(
      'MATERIAL_REFERENCE_BROKEN',
      'error',
      `${label}: указанный материал не найден в библиотеке, взят материал роли.`,
      { nodeId },
    );
  }
  if (resolved.danglingEdgeMaterialId) {
    ctx.report('MATERIAL_REFERENCE_BROKEN', 'error', `${label}: материал кромки не найден в библиотеке.`, { nodeId });
  }
  if (resolved.structuralGlassOrMirror) {
    ctx.report(
      'GLASS_MIRROR_STRUCTURAL_ROLE',
      'warning',
      `${label}: стекло/зеркало назначено на несущую роль — деталь построена, проверьте выбор материала.`,
      { nodeId },
    );
  }
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

/**
 * Секция становится геометрической областью ровно там, где решается её
 * идентичность (`sectionIdFor`), и ровно тогда, когда впервые становится
 * известен её объём — то есть на верхнем делении по X, а для дерева без
 * такого деления один раз на весь внутренний объём. Второго места, знающего
 * «где проходит граница секции», в проекте нет: рендерер и тесты читают
 * `GeometryResult.sections` (PROMPT 7 §9–10).
 */
function isNewSection(parentSectionId: NodeId | undefined, parentAxis: SplitAxis): boolean {
  return parentSectionId === undefined && parentAxis === 'x';
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
      if (result.underconstrained) {
        // Симметрично `overconstrained`: размеры заданы, но не сходятся
        // с доступным местом — только в другую сторону. Строить геометрию
        // с невидимым зазором у дальнего края нельзя, поэтому поддерево
        // не строится, а пользователь получает внятную диагностику
        // (PROMPT 8 §4, docs/GEOMETRY_RULES.md §16.4).
        ctx.report(
          'SPLIT_UNDERCONSTRAINED',
          'error',
          'Заданные размеры не заполняют доступное пространство: сделайте один из размеров растягиваемым или увеличьте размеры так, чтобы их сумма сошлась.',
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

        if (isNewSection(sectionId, node.axis)) {
          ctx.addSection({ nodeId: childSectionId, index: i, box: childBox });
        }

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
        const mat = resolveDividerMaterial(materials, role, node.divider);
        if (mat.roleNotAssigned) reportMaterialFallback();
        reportMaterialIssues(ctx, node.id, node.axis === 'x' ? 'Перегородка' : 'Разделитель', mat);

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

    // Дерево без верхнего деления по X — одна секция на весь внутренний
    // объём, и её id — id корня: ровно то, что вернёт `sectionIdFor` ячейкам
    // такого дерева (лист → `node.id`, деление по Y → `node.id` корня).
    // Секции для деления по X выпускает сам обход, по одной на ребёнка.
    const root = furniture.root;
    if (isLeaf(root) || root.axis !== 'x') {
      ctx.addSection({ nodeId: root.id, index: 0, box: ctx.innerVolume });
    }

    walk(root, ctx.innerVolume, 0, 0, undefined);
  },
};
