import { NO_EDGE, roundMm, vec3 } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveEffectiveMaterial } from '../parts.js';
import { resolveBackWallGeometry } from '../back-wall.js';
import { resolveBackGeometry, resolveVerticalLayout } from './carcass.js';

/**
 * Задняя стенка как деталь (PROMPT 14, этап 5 конвейера).
 *
 * До этого этапа задняя стенка УЖЕ влияла на геометрию — `resolveBackGeometry`
 * (`stages/carcass.ts`) с PROMPT 2 вычитал её из глубины корпуса, — но
 * собственной детали не давала: в деталировке её просто не было. Этот этап
 * закрывает разрыв, ничего в расчёте глубины не меняя: обе стороны читают
 * ОДНУ функцию `resolveBackGeometry`, второй формулы глубины не появляется.
 *
 * Что означает «задняя стенка», решает резолвер `../back-wall.ts`; этап
 * только собирает рамку из уже посчитанных корпусом чисел и размещает то,
 * что резолвер вернул — то же разделение «резолвер решает что, этап решает
 * где», что у `fill`/`facades` (PROMPT 6, 10).
 */
export const backStage: GeometryStage = {
  name: 'back',
  run(ctx: GeometryContext): void {
    const { furniture, tolerances, edgeSizing, materials } = ctx.input;
    const { back, base, countertop, topSection, ceilingGap } = furniture.carcass;

    const backGeom = resolveBackGeometry(back.mount, roundMm(furniture.dimensions.depth), tolerances.depthIncludesBackPanel);
    // Полосу по Y задняя стенка берёт из ТОГО ЖЕ вертикального бюджета, что
    // и корпус (PROMPT 15 §6). Раньше здесь стоял `resolveBasePlacement`,
    // знавший только про цоколь, — и при зазоре до потолка или антресоли
    // стенка оставалась высотой во весь габарит, перекрывая и то и другое.
    // Найдено тестом «положительный зазор ужимает корпус и остаётся пустым».
    const layout = resolveVerticalLayout({
      base,
      height: roundMm(furniture.dimensions.height),
      heightIncludesBase: tolerances.heightIncludesBase,
      countertop,
      topSection,
      ceilingGap,
    });

    // Материал и толщина — через тот же `resolveEffectiveMaterial`, что и у
    // остальных деталей (PROMPT 13 §9): отдельного справочника у задней
    // стенки нет. Толщина при этом остаётся за монтажом (`mount.thickness`):
    // она уже участвовала в расчёте глубины корпуса выше, и подменять её
    // толщиной материала здесь значило бы разойтись с этим расчётом — тот
    // же довод, что и у `DividerSpec.thickness` (`GEOMETRY_RULES.md` §21.3).
    const material = resolveEffectiveMaterial({
      materials,
      role: 'back',
      explicitMaterialId: back.materialId,
      // Задняя стенка не оклеивается кромкой: её торцы либо уходят в паз,
      // либо стоят у стены — это ровно то правило по умолчанию, которое
      // проект уже держит для задних торцов (`DEFAULT_EDGE.back = 0`,
      // `docs/DATA_MODEL.md` §9.3), просто здесь оно относится ко всем
      // четырём сторонам детали.
      explicitEdge: NO_EDGE,
      thicknessOverride: backGeom.thickness,
      corpusThickness: roundMm(furniture.dimensions.panelThickness),
    });

    if (material.danglingMaterialId) {
      ctx.report(
        'MATERIAL_REFERENCE_BROKEN',
        'error',
        'Задняя стенка: указанный материал не найден в библиотеке, взят материал роли.',
        { path: 'carcass.back.materialId' },
      );
    }
    if (material.roleNotAssigned) {
      ctx.report(
        'MATERIAL_NOT_ASSIGNED',
        'warning',
        'Материал для задней стенки не назначен, взят первый из библиотеки.',
      );
    }

    const resolution = resolveBackWallGeometry({
      mount: back.mount,
      segmentation: back.segmentation,
      materialId: material.materialId,
      sections: ctx.getSections(),
      frame: {
        carcassWidth: roundMm(furniture.dimensions.width),
        carcassY0: layout.carcassY0,
        carcassY1: roundMm(layout.carcassY0 + layout.carcassHeight),
        inner: ctx.innerVolume,
        innerZ0: backGeom.innerZ0,
      },
    });

    if (resolution.status === 'invalid') {
      ctx.report(
        'BACK_WALL_GEOMETRY_INVALID',
        'error',
        resolution.missing ?? 'задняя стенка не построена: геометрия недопустима.',
        { path: 'carcass.back' },
      );
      return;
    }

    if (back.mount.kind === 'inset-groove' && resolution.panels.length > 0) {
      // Деталь в пазу по построению заходит ВНУТРЬ габарита боковин, крышки
      // и дна — там, где у них выбран паз. Прямоугольная модель `Part` паз
      // не выражает, поэтому проверка пересечений (`findPartOverlaps`) видит
      // здесь наложение, которого физически нет. Явный статус вместо тихого
      // исключения из проверки: тот же приём, что у выреза цоколя.
      ctx.report(
        'BACK_WALL_GROOVE_NOT_IMPLEMENTED',
        'info',
        'Задняя стенка в пазу: сам паз в деталях корпуса не строится, поэтому стенка заходит в их габарит на глубину паза.',
        { path: 'carcass.back.mount' },
      );
    }

    resolution.panels.forEach((panel, i) => {
      const segmented = resolution.panels.length > 1;
      ctx.addPart(
        makePart({
          furnitureId: furniture.id,
          role: 'back',
          label: segmented ? `Задняя стенка ${String(i + 1)}` : 'Задняя стенка',
          // Идентичность сегмента — id его секции, а не порядковый номер:
          // при изменении ширин секций сегмент остаётся тем же (§20).
          index: panel.sectionId ?? 0,
          position: vec3(panel.x, panel.y, panel.z),
          size: vec3(panel.width, panel.height, panel.thickness),
          orientation: 'frontal-xy',
          materialId: material.materialId,
          edge: material.edge,
          edgeSizing,
          ...(panel.sectionId === undefined ? {} : { nodeId: panel.sectionId }),
        }),
      );
    });
  },
};
