import type { PlinthPartKind } from '../../domain/index.js';
import { roundMm, vec3 } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveEffectiveMaterial } from '../parts.js';
import { resolvePlinthGeometry } from '../plinth.js';
import { resolveBackGeometry } from './carcass.js';

/** Русская подпись царги для деталировки и debug-схемы. */
function plinthLabel(kind: PlinthPartKind): string {
  switch (kind) {
    case 'front':
      return 'Царга цоколя передняя';
    case 'rear':
      return 'Царга цоколя задняя';
    case 'left':
      return 'Царга цоколя левая';
    case 'right':
      return 'Царга цоколя правая';
  }
}

/**
 * Цоколь как детали (PROMPT 14, этап 6 конвейера).
 *
 * Высота цоколя влияет на корпус не здесь, а в `stages/carcass.ts`
 * (`resolveBasePlacement`): корпус, ячейки, полки, двери и ящики уже стоят
 * на своих местах к моменту запуска этого этапа. Здесь строятся только сами
 * царги — поэтому двойного учёта высоты (PROMPT 14 §13) быть не может: одна
 * функция задаёт сдвиг, другая — детали под ним.
 *
 * `kind === 'legs'` деталей не даёт: ножки — фурнитура, а не пласть, их
 * место — в спецификации фурнитуры (`HW-*`), которая этим этапом не
 * реализуется (PROMPT 14 §28).
 */
export const baseStage: GeometryStage = {
  name: 'base',
  run(ctx: GeometryContext): void {
    const { furniture, tolerances, edgeSizing, materials } = ctx.input;
    const base = furniture.carcass.base;
    if (base === undefined || base.kind === 'none') return;

    if (base.kind === 'legs') {
      ctx.report(
        'PLINTH_LEGS_NOT_IMPLEMENTED',
        'info',
        'Ножки пока не строятся геометрией: это фурнитура, а не пласть — высота основания при этом учтена.',
        { path: 'carcass.base' },
      );
      return;
    }

    const backGeom = resolveBackGeometry(
      furniture.carcass.back.mount,
      roundMm(furniture.dimensions.depth),
      tolerances.depthIncludesBackPanel,
    );

    const material = resolveEffectiveMaterial({
      materials,
      role: 'plinth',
      explicitMaterialId: base.materialId,
      explicitEdge: base.edge,
      thicknessOverride: base.thickness,
      corpusThickness: roundMm(furniture.dimensions.panelThickness),
    });

    if (material.danglingMaterialId) {
      ctx.report(
        'MATERIAL_REFERENCE_BROKEN',
        'error',
        'Цоколь: указанный материал не найден в библиотеке, взят материал роли.',
        { path: 'carcass.base.materialId' },
      );
    }
    if (material.roleNotAssigned) {
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для цоколя не назначен, взят первый из библиотеки.');
    }

    const resolution = resolvePlinthGeometry(
      base,
      {
        carcassWidth: roundMm(furniture.dimensions.width),
        carcassZ0: backGeom.carcassZ0,
        carcassDepth: backGeom.carcassDepth,
      },
      material.thickness,
    );

    if (resolution.status === 'invalid') {
      ctx.report(
        'PLINTH_GEOMETRY_INVALID',
        'error',
        resolution.missing ?? 'цоколь не построен: геометрия недопустима.',
        { path: 'carcass.base' },
      );
      return;
    }

    if (resolution.cutoutNotImplemented) {
      // Явный статус вместо тихого пропуска (тот же приём, что у короба
      // ящика на PROMPT 11): вырез в модели есть, в геометрии — нет.
      ctx.report(
        'PLINTH_CUTOUT_NOT_IMPLEMENTED',
        'info',
        'Вырез ниже высоты цоколя — это паз в одной царге: прямоугольная модель детали его не выражает, царга построена целой.',
        { path: 'carcass.base.cutout' },
      );
    }

    if (resolution.status === 'built' && resolution.parts.length === 0) {
      ctx.report(
        'PLINTH_PARTS_NOT_SPECIFIED',
        'info',
        'Цоколь задан высотой, но состав царг не указан: высота учтена, деталей нет (конструкция цоколя не подтверждена).',
        { path: 'carcass.base.parts' },
      );
      return;
    }

    for (const part of resolution.parts) {
      ctx.addPart(
        makePart({
          furnitureId: furniture.id,
          role: 'plinth',
          label: plinthLabel(part.kind),
          index: `${part.kind}-${String(part.index)}`,
          position: vec3(part.x, part.y, part.z),
          size: vec3(part.width, part.height, part.depth),
          // Передняя и задняя царги стоят фронтально, боковые — как боковины.
          orientation: part.kind === 'left' || part.kind === 'right' ? 'vertical-yz' : 'frontal-xy',
          materialId: material.materialId,
          edge: material.edge,
          edgeSizing,
        }),
      );
    }
  },
};
