import type { Box3, EdgeSpec, MaterialLibrary, Mm, NodeId, PartRole, Shelf } from '../../domain/index.js';
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
import { makePart, resolveEffectiveMaterial, resolveMaterial } from '../parts.js';
import { contentLabel, resolveContentGeometry } from '../content.js';
import { resolveDrawerFacadeGeometry } from '../drawers.js';
import { resolveOpeningSystemGeometry } from '../opening-system.js';

/**
 * Наполнение ячеек: полки (PROMPT 6) и фасады ящиков (PROMPT 11). Штанга
 * остаётся `LeafFill`-видом без геометрии до своего этапа плана (23).
 *
 * Что означает наполнение ячейки, решает резолвер `../content.ts`; этот
 * этап только размещает то, что резолвер вернул. Виды без геометрии
 * получают статус `not-implemented` и попадают в диагностику: до PROMPT 9
 * они пропускались молча, и «штанга есть в модели, но деталей нет» ничем
 * не отличалось от «ячейка пуста».
 *
 * Источник истины — `LeafNode.fill`, как и раньше: ни полка, ни фасад
 * ящика не хранят своих X/Y/Z/width/height/depth — они вычисляются здесь
 * из объёма ячейки, которую уже построил `layout` (§9). Cell — пространство,
 * Shelf/Drawer — наполнение, Part — деталь; ни одна ячейка сама по себе
 * этим этапом не создаётся и не меняется (PROMPT 6 §5, `docs/DATA_MODEL.md`
 * §5.6 и §6.1).
 */

/** Роль фасада ящика — та же, что и у двери (PROMPT 10): фасад остаётся фасадом независимо от того, что за ним. */
const DRAWER_FACADE_ROLE: PartRole = 'facade';

function shelfRole(mounting: Shelf['mounting']): PartRole {
  return mounting === 'adjustable' ? 'shelf-adjustable' : 'shelf-fixed';
}

/** Русская подпись способа открывания для debug-схемы (PROMPT 12 §18) — та же, что в `stages/facades.ts`. */
function openingLabel(kind: 'none' | 'handle' | 'push-to-open'): string {
  switch (kind) {
    case 'none':
      return 'нет';
    case 'handle':
      return 'ручка';
    case 'push-to-open':
      return 'push-to-open';
  }
}

interface ResolvedShelfMaterial {
  readonly materialId: ReturnType<typeof resolveMaterial>['materialId'];
  readonly edge: EdgeSpec;
  readonly thickness: Mm;
  readonly roleNotAssigned: boolean;
  readonly danglingMaterialId: boolean;
  readonly danglingEdgeMaterialId: boolean;
  readonly structuralGlassOrMirror: boolean;
}

/**
 * Единая точка входа «материал + эффективная толщина» полки (PROMPT 13
 * §9): толщина полки — `Shelf.thickness ?? material.thickness ?? T`, а не
 * `Shelf.thickness ?? T`, как было до PROMPT 13 — материал перестаёт быть
 * декорацией и становится источником геометрии, если override не задан.
 */
function resolveShelfMaterial(materials: MaterialLibrary, role: PartRole, shelf: Shelf, corpusThickness: Mm): ResolvedShelfMaterial {
  const resolved = resolveEffectiveMaterial({
    materials,
    role,
    explicitMaterialId: shelf.materialId,
    explicitEdge: shelf.edge,
    thicknessOverride: shelf.thickness,
    corpusThickness,
  });
  return {
    materialId: resolved.materialId,
    edge: resolved.edge,
    thickness: resolved.thickness,
    roleNotAssigned: resolved.roleNotAssigned,
    danglingMaterialId: resolved.danglingMaterialId,
    danglingEdgeMaterialId: resolved.danglingEdgeMaterialId,
    structuralGlassOrMirror: resolved.structuralGlassOrMirror,
  };
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
function planAutoShelves(
  ctx: GeometryContext,
  box: Box3,
  nodeId: NodeId,
  autoShelves: readonly Shelf[],
  materials: MaterialLibrary,
  corpusThickness: Mm,
): ShelfPlan[] {
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

  const firstShelf = autoShelves[0];
  const thickness =
    firstShelf === undefined
      ? corpusThickness
      : resolveShelfMaterial(materials, shelfRole(firstShelf.mounting), firstShelf, corpusThickness).thickness;
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
function planManualShelf(
  ctx: GeometryContext,
  box: Box3,
  nodeId: NodeId,
  shelf: Shelf,
  materials: MaterialLibrary,
  corpusThickness: Mm,
): ShelfPlan | undefined {
  if (shelf.placement.mode !== 'manual') return undefined;
  const { offsetFromBottom } = shelf.placement;
  const thickness = resolveShelfMaterial(materials, shelfRole(shelf.mounting), shelf, corpusThickness).thickness;

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

/**
 * Единые диагностики результата `resolveEffectiveMaterial` (PROMPT 13
 * §15/§20): битая ссылка на материал — явная `error`-диагностика, а не
 * тихий откат на материал роли («отсутствующий материал не приводит
 * к тихому fallback»); несущая роль со стеклом/зеркалом — `warning`
 * (`T-MAT-04`): деталь всё равно строится, это предупреждение о вероятной
 * ошибке ввода, а не производственный запрет.
 */
function reportMaterialIssues(
  ctx: GeometryContext,
  nodeId: NodeId,
  label: string,
  resolved: {
    readonly danglingMaterialId: boolean;
    readonly danglingEdgeMaterialId: boolean;
    readonly structuralGlassOrMirror: boolean;
  },
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
  if (resolved.structuralGlassOrMirror) {
    ctx.report(
      'GLASS_MIRROR_STRUCTURAL_ROLE',
      'warning',
      `${label}: стекло/зеркало назначено на несущую роль — деталь построена, проверьте выбор материала.`,
      { nodeId },
    );
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

    let drawerFallbackReported = false;
    const reportDrawerMaterialFallback = (): void => {
      if (drawerFallbackReported) return;
      drawerFallbackReported = true;
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для фасада ящика не назначен, взят первый из библиотеки.');
    };

    let drawerOpeningFallbackReported = false;
    const reportDrawerOpeningMaterialFallback = (): void => {
      if (drawerOpeningFallbackReported) return;
      drawerOpeningFallbackReported = true;
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для ручки/механизма открывания ящика не назначен, взят первый из библиотеки.');
    };

    // Виды наполнения, о которых уже сообщили: одна диагностика на вид,
    // а не по одной на каждую ячейку — иначе шкаф с шестью ящичными
    // секциями выдал бы шесть одинаковых сообщений.
    const reportedKinds = new Set<string>();
    let drawerBoxNotImplementedReported = false;

    for (const cell of ctx.getCells()) {
      const node = findNode(furniture.root, cell.nodeId);
      if (node === undefined || !isLeaf(node)) continue;

      // Что означает наполнение этой ячейки — решает резолвер
      // (`src/geometry/content.ts`), а не разбор `fill.kind` здесь.
      const content = resolveContentGeometry(node.fill, cell.nodeId);

      if (content.status === 'not-implemented' && !reportedKinds.has(content.kind)) {
        reportedKinds.add(content.kind);
        // Явный статус вместо тихого пропуска (PROMPT 9 §9): наполнение
        // в модели есть, деталей для него пока нет — и об этом видно.
        ctx.report(
          'CONTENT_NOT_IMPLEMENTED',
          'info',
          `Наполнение «${contentLabel(content.kind)}» пока не строится геометрией: ${content.missing ?? 'нет реализации'}.`,
          { nodeId: cell.nodeId },
        );
      }

      if (content.kind === 'drawers' && content.drawers.length > 0) {
        // Материал/толщина каждого фасада ящика — один расчёт (PROMPT 13
        // §9), переиспользованный и для `thicknessOf`, и для самой детали
        // ниже: тот же приём, что и у двери (`stages/facades.ts`).
        const drawerMaterials = new Map(
          content.drawers.map((drawer) => [
            drawer.id,
            resolveEffectiveMaterial({
              materials,
              role: DRAWER_FACADE_ROLE,
              explicitMaterialId: drawer.facade.materialId,
              explicitEdge: drawer.facade.edge,
              thicknessOverride: drawer.facade.thickness,
              corpusThickness: T,
            }),
          ]),
        );
        const resolution = resolveDrawerFacadeGeometry(
          content.drawers,
          cell,
          (drawer) => drawerMaterials.get(drawer.id)?.thickness ?? T,
        );

        if (resolution.status === 'invalid') {
          // Та же граница error/info, что и у двери (PROMPT 10
          // GEOMETRY_RULES.md §18.5): «зазоры не оставляют места при уже
          // заданных пользователем числах» — ошибка пользовательских
          // данных, а не «функция ещё не реализована».
          ctx.report(
            'DRAWER_GEOMETRY_INVALID',
            'error',
            resolution.missing ?? 'фасады ящиков не построены: геометрия недопустима.',
            { nodeId: cell.nodeId },
          );
        } else {
          if (!drawerBoxNotImplementedReported) {
            drawerBoxNotImplementedReported = true;
            // Короб (боковины/дно/задняя стенка) не строится — конструкция
            // не подтверждена (T-DRW-02). Явный статус, а не тихий пропуск:
            // фасад в результате есть, короба за ним — нет, и это видно.
            ctx.report(
              'DRAWER_BOX_NOT_IMPLEMENTED',
              'info',
              'Короб ящика (боковины, дно, задняя стенка) пока не строится геометрией: конструкция короба не подтверждена.',
              { nodeId: cell.nodeId },
            );
          }

          resolution.facades.forEach((facadeGeo, i) => {
            const resolvedMaterial = drawerMaterials.get(facadeGeo.drawerId);
            if (resolvedMaterial?.roleNotAssigned === true) reportDrawerMaterialFallback();
            const label = resolution.facades.length > 1 ? `Фасад ящика ${String(i + 1)}` : 'Фасад ящика';
            if (resolvedMaterial !== undefined) reportMaterialIssues(ctx, cell.nodeId, label, resolvedMaterial);

            ctx.addPart(
              makePart({
                furnitureId: furniture.id,
                role: DRAWER_FACADE_ROLE,
                label,
                index: facadeGeo.drawerId,
                position: vec3(facadeGeo.x, facadeGeo.y, facadeGeo.z),
                size: vec3(facadeGeo.width, facadeGeo.height, facadeGeo.thickness),
                orientation: 'frontal-xy',
                materialId: resolvedMaterial?.materialId ?? resolveMaterial(materials, DRAWER_FACADE_ROLE).materialId,
                edge: resolvedMaterial?.edge ?? DEFAULT_EDGE,
                edgeSizing,
                nodeId: cell.nodeId,
              }),
            );

            // Способ открывания (PROMPT 12): читает уже построенный объём
            // фасада ЯЩИКА, а не ячейки — «Facade → Opening System».
            // `content.drawers[i]` и `resolution.facades[i]` идут в одном
            // порядке (`resolveDrawerFacadeGeometry` строит их map'ом).
            const openingConfig = content.drawers[i]?.facade.opening ?? { kind: 'none' as const };
            const openingResolution = resolveOpeningSystemGeometry(openingConfig, {
              x: facadeGeo.x,
              y: facadeGeo.y,
              z: facadeGeo.z,
              width: facadeGeo.width,
              height: facadeGeo.height,
              thickness: facadeGeo.thickness,
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
              if (!resolvedOpeningMaterial.resolved) reportDrawerOpeningMaterialFallback();
              ctx.addPart(
                makePart({
                  furnitureId: furniture.id,
                  role: item.role,
                  label: openingLabel(openingConfig.kind),
                  index: item.id,
                  position: vec3(item.x, item.y, item.z),
                  size: vec3(item.width, item.height, item.thickness),
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
      }

      const allShelves = content.shelves;
      if (allShelves.length === 0) continue;

      const autoShelves = allShelves.filter((s) => s.placement.mode === 'auto');
      const manualShelves = allShelves.filter((s) => s.placement.mode === 'manual');

      const plans: ShelfPlan[] = [];
      if (autoShelves.length > 0) {
        plans.push(...planAutoShelves(ctx, cell.box, cell.nodeId, autoShelves, materials, T));
      }
      for (const shelf of manualShelves) {
        const plan = planManualShelf(ctx, cell.box, cell.nodeId, shelf, materials, T);
        if (plan !== undefined) plans.push(plan);
      }

      reportOverlaps(ctx, cell.nodeId, plans);

      plans.forEach((plan, i) => {
        const role = shelfRole(plan.shelf.mounting);
        const mat = resolveShelfMaterial(materials, role, plan.shelf, T);
        if (mat.roleNotAssigned) reportMaterialFallback();
        reportMaterialIssues(ctx, cell.nodeId, `Полка ${String(i + 1)}`, mat);
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
