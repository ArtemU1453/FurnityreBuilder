import type { CellBox } from '../types.js';
import type { HingeSide, NodeId, OpeningSystem, PartRole } from '../../domain/index.js';
import { DEFAULT_EDGE, findNode, isLeaf, roundMm } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveEffectiveMaterial, resolveMaterial } from '../parts.js';
import { resolveDoorGeometry } from '../doors.js';
import { resolveOpeningSystemGeometry } from '../opening-system.js';

const DOOR_ROLE: PartRole = 'facade';

/**
 * Сторона петель в подписи детали (PROMPT 10 §18: «Orientation: LEFT»).
 * Кодируется в `label`/`detail`, а не в отдельном поле `Part` — у детали
 * уже есть эти два свободных текстовых поля именно для такой информации
 * (тот же приём, каким `partDetail` в `render/debug-view.ts` показывает
 * толщину перегородки или глубину полки, не расширяя `Part`).
 */
function hingeLabel(side: HingeSide): string {
  switch (side) {
    case 'left':
      return 'слева';
    case 'right':
      return 'справа';
    case 'top':
      return 'сверху';
    case 'bottom':
      return 'снизу';
    case 'none':
      return 'без петель';
  }
}

/** Русская подпись способа открывания для debug-схемы (PROMPT 12 §18). */
function openingLabel(kind: OpeningSystem['kind']): string {
  switch (kind) {
    case 'none':
      return 'нет';
    case 'handle':
      return 'ручка';
    case 'push-to-open':
      return 'push-to-open';
  }
}

/**
 * Единые диагностики результата `resolveEffectiveMaterial` (PROMPT 13
 * §15/§20) — тот же приём, что в `stages/fill.ts`: битая ссылка на материал
 * двери — явная `error`, а не тихий откат на материал роли.
 */
function reportMaterialIssues(
  ctx: GeometryContext,
  nodeId: NodeId,
  label: string,
  resolved: { readonly danglingMaterialId: boolean; readonly danglingEdgeMaterialId: boolean },
): void {
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
}

/**
 * Фасады: `Furniture.facades: FacadeGroup[]` → двери-детали (PROMPT 10).
 *
 * Этап 22 плана (`docs/ARCHITECTURE.md` §5.2, `engine.ts` PIPELINE),
 * реализован только для базового случая — одного фасада, целиком
 * покрывающего один лист дерева (одну ячейку). Что означает фасад,
 * решает резолвер `../doors.ts`; этот этап только находит покрываемую
 * ячейку и размещает то, что резолвер вернул — тот же принцип разделения,
 * что и у `fill.ts` §... (резолвер решает «что», этап решает «где»).
 *
 * Источник истины по-прежнему `Furniture.facades` и дерево секций: этап не
 * хранит своих X/Y/Z — они выводятся заново на каждом пересчёте из
 * `cell.box`, уже построенного `layout` (PROMPT 10 §15).
 */
export const facadesStage: GeometryStage = {
  name: 'facades',
  run(ctx: GeometryContext): void {
    const { furniture, materials, edgeSizing } = ctx.input;
    const T = roundMm(furniture.dimensions.panelThickness);
    const cells = ctx.getCells();
    const cellsById = new Map<NodeId, CellBox>(cells.map((c) => [c.nodeId, c]));

    let fallbackReported = false;
    const reportMaterialFallback = (): void => {
      if (fallbackReported) return;
      fallbackReported = true;
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для двери не назначен, взят первый из библиотеки.');
    };

    let openingFallbackReported = false;
    const reportOpeningMaterialFallback = (): void => {
      if (openingFallbackReported) return;
      openingFallbackReported = true;
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для ручки/механизма открывания не назначен, взят первый из библиотеки.');
    };

    // Одна диагностика на вид непокрытого случая, а не на каждый фасад —
    // тот же приём, что у `fill.ts` для `CONTENT_NOT_IMPLEMENTED`.
    const reportedNotImplemented = new Set<string>();
    const reportNotImplemented = (kind: string, message: string, nodeId?: NodeId): void => {
      if (reportedNotImplemented.has(kind)) return;
      reportedNotImplemented.add(kind);
      ctx.report('DOOR_COVERAGE_NOT_IMPLEMENTED', 'info', message, nodeId === undefined ? undefined : { nodeId });
    };

    // Двумя разными `FacadeGroup` нельзя покрыть одну и ту же ячейку —
    // единственное правило коллизии, которое здесь нужно (PROMPT 10 §14):
    // дверь по построению лежит перед `cell.box` и не пересекается ни
    // с каркасом, ни с наполнением, ни с соседними ячейками (см. `doors.ts`).
    // Пересечение возможно только между двумя дверями одной и той же ячейки.
    const claimedCells = new Set<NodeId>();

    for (const facade of furniture.facades) {
      if (facade.covers.kind === 'carcass') {
        reportNotImplemented(
          'carcass',
          'Фасад, покрывающий весь корпус, пока не строится геометрией: поддержана только одна ячейка на фасад.',
        );
        continue;
      }

      const node = findNode(furniture.root, facade.covers.nodeId);
      if (node === undefined) {
        ctx.report(
          'DOOR_CELL_NOT_FOUND',
          'error',
          `Фасад «${facade.id}» ссылается на несуществующий узел дерева.`,
          { nodeId: facade.covers.nodeId },
        );
        continue;
      }
      if (!isLeaf(node)) {
        reportNotImplemented(
          'multi-cell',
          'Фасад, покрывающий несколько ячеек (узел-разделение), пока не строится геометрией: поддержана только одна ячейка на фасад.',
          node.id,
        );
        continue;
      }

      const cell = cellsById.get(node.id);
      if (cell === undefined) {
        // Лист есть в дереве, но `layout` не построил для него ячейку:
        // единственная причина — сама ячейка не прошла санитарную проверку
        // `GeometryContext.addCell` (нечисловые координаты/размер).
        continue;
      }

      if (node.fill.kind === 'drawers' && node.fill.drawers.length > 0) {
        // Дверь и ящики в одной ячейке физически не сочетаются: фасады
        // ящиков уже занимают переднюю плоскость ячейки (`stages/fill.ts`,
        // PROMPT 11), а дверь начинается ровно на той же границе — второй
        // слой перед уже видимыми фасадами ящиков не имеет функционального
        // смысла. Явное правило валидации (PROMPT 11 §14), а не догадка:
        // сочетание запрещено, потому что наполнение ячейки одно
        // (`docs/GEOMETRY_RULES.md` §17.3) и это оно, а дверь — второй,
        // конкурирующий фасад той же плоскости.
        ctx.report(
          'DOOR_CELL_HAS_DRAWERS',
          'error',
          'Ячейка уже содержит ящики: дверь на ту же ячейку не построена.',
          { nodeId: cell.nodeId },
        );
        continue;
      }

      if (claimedCells.has(cell.nodeId)) {
        ctx.report(
          'DOOR_CELL_ALREADY_COVERED',
          'error',
          'Две двери назначены на одну и ту же ячейку: вторая не построена.',
          { nodeId: cell.nodeId },
        );
        continue;
      }

      // Материал/толщина каждой створки считаются ОДИН раз (PROMPT 13 §9)
      // и переиспользуются и для формулы толщины (`thicknessOf`), и для
      // самой детали ниже — вместо того, чтобы резолвер повторно спрашивал
      // библиотеку материалов, а материал детали расходился с материалом,
      // по которому посчитана её же толщина.
      const leafMaterials = new Map(
        facade.leaves.map((leaf) => [
          leaf.id,
          resolveEffectiveMaterial({
            materials,
            role: DOOR_ROLE,
            explicitMaterialId: leaf.materialId,
            explicitEdge: leaf.edge,
            thicknessOverride: leaf.thickness,
            corpusThickness: T,
          }),
        ]),
      );

      const resolution = resolveDoorGeometry(facade, cell, (leaf) => leafMaterials.get(leaf.id)?.thickness ?? T);

      if (resolution.status === 'invalid') {
        // В отличие от «not-implemented» (вид фасада или охват ещё не
        // построены геометрией — это ожидаемо), «invalid» — это дверь,
        // которая не помещается в свою же ячейку при уже заданных зазорах:
        // такая же ошибка пользовательских данных, как `SHELF_OUT_OF_CELL_BOUNDS`
        // или `HORIZONTAL_WIDTH_NOT_POSITIVE`, поэтому `error`, а не `info`.
        ctx.report(
          'DOOR_GEOMETRY_INVALID',
          'error',
          resolution.missing ?? 'дверь не построена: геометрия недопустима.',
          { nodeId: cell.nodeId },
        );
        continue;
      }

      if (resolution.status === 'not-implemented') {
        reportNotImplemented(`facade-${facade.type}`, resolution.missing ?? 'дверь не построена', cell.nodeId);
        continue;
      }

      claimedCells.add(cell.nodeId);

      resolution.leaves.forEach((leaf, i) => {
        const resolvedMaterial = leafMaterials.get(leaf.leafId);
        if (resolvedMaterial?.roleNotAssigned === true) reportMaterialFallback();

        const label =
          (resolution.leaves.length > 1 ? `Дверь ${String(i + 1)}` : 'Дверь') + ` · петли ${hingeLabel(leaf.hingeSide)}`;

        if (resolvedMaterial !== undefined) reportMaterialIssues(ctx, cell.nodeId, label, resolvedMaterial);

        ctx.addPart(
          makePart({
            furnitureId: furniture.id,
            role: DOOR_ROLE,
            label,
            index: leaf.leafId,
            position: { x: leaf.x, y: leaf.y, z: leaf.z },
            size: { x: leaf.width, y: leaf.height, z: leaf.thickness },
            orientation: 'frontal-xy',
            materialId: resolvedMaterial?.materialId ?? resolveMaterial(materials, DOOR_ROLE).materialId,
            edge: resolvedMaterial?.edge ?? DEFAULT_EDGE,
            edgeSizing,
            nodeId: cell.nodeId,
          }),
        );

        // Способ открывания (PROMPT 12): читает уже построенный объём
        // ДВЕРНОГО ЛИСТА, а не ячейки — «Facade → Opening System», не
        // «Cell → Opening System». `facade.leaves[i]` и `resolution.leaves[i]`
        // идут в одном порядке (`resolveDoorGeometry` строит их map'ом).
        const openingConfig = facade.leaves[i]?.opening ?? { kind: 'none' as const };
        const openingResolution = resolveOpeningSystemGeometry(openingConfig, {
          x: leaf.x,
          y: leaf.y,
          z: leaf.z,
          width: leaf.width,
          height: leaf.height,
          thickness: leaf.thickness,
        });

        if (openingResolution.status === 'invalid') {
          ctx.report(
            'OPENING_GEOMETRY_INVALID',
            'error',
            openingResolution.missing ?? 'способ открывания не построен: геометрия недопустима.',
            { nodeId: cell.nodeId },
          );
        }

        for (const item of openingResolution.items) {
          const resolvedOpeningMaterial = resolveMaterial(materials, item.role);
          if (!resolvedOpeningMaterial.resolved) reportOpeningMaterialFallback();
          ctx.addPart(
            makePart({
              furnitureId: furniture.id,
              role: item.role,
              label: openingLabel(openingConfig.kind),
              index: item.id,
              position: { x: item.x, y: item.y, z: item.z },
              size: { x: item.width, y: item.height, z: item.thickness },
              orientation: 'frontal-xy',
              materialId: resolvedOpeningMaterial.materialId,
              edge: DEFAULT_EDGE,
              edgeSizing,
              nodeId: cell.nodeId,
            }),
          );
        }
      });
    }
  },
};
