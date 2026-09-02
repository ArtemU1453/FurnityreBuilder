import type { BackPanelMount, EdgeSpec, PartRole, Vec3 } from '../../domain/index.js';
import { DEFAULT_EDGE, box3, roundMm, vec3 } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveMaterial } from '../parts.js';

/**
 * Каркас: боковины, верх, низ, внутренний объём.
 *
 * Реализует три схемы стыка из docs/ARCHITECTURE.md §5.3. Какая из них
 * используется референсом — неизвестно (ASSUMPTION(T-CAR-01)), поэтому
 * поддерживаются все три и выбор остаётся параметром проекта. Когда тест
 * будет проведён, изменится значение по умолчанию, а не этот код.
 */

interface BackGeometry {
  /** Толщина задней стенки, 0 если её нет. */
  readonly thickness: number;
  /** Смещение передней плоскости корпуса от начала координат по Z. */
  readonly carcassZ0: number;
  /** Глубина корпусных деталей. */
  readonly carcassDepth: number;
  /** Передняя граница внутреннего объёма по Z. */
  readonly innerZ0: number;
}

export function resolveBackGeometry(
  mount: BackPanelMount,
  depth: number,
  depthIncludesBackPanel: boolean,
): BackGeometry {
  if (mount.kind === 'none') {
    return { thickness: 0, carcassZ0: 0, carcassDepth: roundMm(depth), innerZ0: 0 };
  }

  const thickness = mount.thickness;

  if (mount.kind === 'overlay') {
    // Накладная стенка прибивается к заднему торцу корпуса и стоит ПЕРЕД ним
    // по оси Z: начало координат — задняя плоскость изделия целиком.
    const carcassDepth = depthIncludesBackPanel ? roundMm(depth - thickness) : roundMm(depth);
    return { thickness, carcassZ0: thickness, carcassDepth, innerZ0: thickness };
  }

  // Вкладная стенка находится внутри глубины корпуса.
  const innerOffset = mount.kind === 'inset-groove' ? mount.grooveOffsetFromRear + thickness : thickness;
  return {
    thickness,
    carcassZ0: 0,
    carcassDepth: roundMm(depth),
    innerZ0: roundMm(innerOffset),
  };
}

/** Идут ли горизонтали на всю ширину изделия при данной схеме. */
function horizontalsSpanFullWidth(ctx: GeometryContext): { top: boolean; bottom: boolean } {
  const { scheme } = ctx.input;
  switch (scheme.verticalPriority) {
    case 'horizontals-through':
      return { top: true, bottom: true };
    case 'sides-through':
      return { top: false, bottom: false };
    case 'mixed':
      return { top: scheme.topOverlaysSides, bottom: scheme.bottomOverlaysSides };
  }
}

export const carcassStage: GeometryStage = {
  name: 'carcass',
  run(ctx: GeometryContext): void {
    const { furniture, tolerances, edgeSizing, materials } = ctx.input;
    const { width: W, height: H, depth: D, panelThickness: T } = furniture.dimensions;
    const { hasTop, hasBottom, back } = furniture.carcass;

    const backGeom = resolveBackGeometry(back.mount, D, tolerances.depthIncludesBackPanel);
    const Dc = backGeom.carcassDepth;
    const z0 = backGeom.carcassZ0;

    if (Dc <= 0) {
      ctx.report(
        'CARCASS_DEPTH_NOT_POSITIVE',
        'error',
        'Глубина корпуса после вычета задней стенки не положительна.',
        { path: 'dimensions.depth' },
      );
      return;
    }

    const full = horizontalsSpanFullWidth(ctx);
    const topFull = full.top && hasTop;
    const bottomFull = full.bottom && hasBottom;

    // Боковины укорачиваются там, где горизонталь идёт поверх них.
    const sideY0 = bottomFull ? T : 0;
    const sideY1 = topFull ? roundMm(H - T) : H;
    const sideHeight = roundMm(sideY1 - sideY0);

    const material = (role: PartRole): { materialId: ReturnType<typeof resolveMaterial>['materialId']; edge: EdgeSpec } => {
      const resolved = resolveMaterial(materials, role);
      if (!resolved.resolved) {
        ctx.report(
          'MATERIAL_NOT_ASSIGNED',
          'warning',
          `Материал для роли «${role}» не назначен, взят первый из библиотеки.`,
        );
      }
      return { materialId: resolved.materialId, edge: DEFAULT_EDGE };
    };

    // ── Боковины ──────────────────────────────────────────────────────────
    const sideSize: Vec3 = vec3(T, sideHeight, Dc);
    const sideMat = material('side');
    ctx.addPart(
      makePart({
        furnitureId: furniture.id,
        role: 'side',
        label: 'Боковина левая',
        index: 0,
        position: vec3(0, sideY0, z0),
        size: sideSize,
        orientation: 'vertical-yz',
        materialId: sideMat.materialId,
        edge: sideMat.edge,
        edgeSizing,
      }),
    );
    ctx.addPart(
      makePart({
        furnitureId: furniture.id,
        role: 'side',
        label: 'Боковина правая',
        index: 1,
        position: vec3(roundMm(W - T), sideY0, z0),
        size: sideSize,
        orientation: 'vertical-yz',
        materialId: sideMat.materialId,
        edge: sideMat.edge,
        edgeSizing,
      }),
    );

    // ── Горизонтали ───────────────────────────────────────────────────────
    const horizontal = (
      role: 'top' | 'bottom',
      label: string,
      spansFullWidth: boolean,
      y: number,
    ): void => {
      const x0 = spansFullWidth ? 0 : T;
      const w = spansFullWidth ? W : roundMm(W - 2 * T);
      if (w <= 0) {
        ctx.report('HORIZONTAL_WIDTH_NOT_POSITIVE', 'error', `Деталь «${label}» имеет нулевую ширину.`);
        return;
      }
      const mat = material(role);
      ctx.addPart(
        makePart({
          furnitureId: furniture.id,
          role,
          label,
          index: 0,
          position: vec3(x0, y, z0),
          size: vec3(w, T, Dc),
          orientation: 'horizontal-xz',
          materialId: mat.materialId,
          edge: mat.edge,
          edgeSizing,
        }),
      );
    };

    if (hasBottom) horizontal('bottom', 'Дно', bottomFull, 0);
    if (hasTop) horizontal('top', 'Крышка', topFull, roundMm(H - T));

    // ── Габарит и внутренний объём ────────────────────────────────────────
    ctx.bounds = box3(vec3(0, 0, 0), vec3(W, H, roundMm(z0 + Dc)));

    const innerX0 = T;
    const innerWidth = roundMm(W - 2 * T);
    const innerY0 = hasBottom ? T : 0;
    const innerY1 = hasTop ? roundMm(H - T) : H;
    const innerZ0 = roundMm(z0 + (backGeom.innerZ0 - z0 > 0 ? backGeom.innerZ0 - z0 : 0));
    const innerDepth = roundMm(z0 + Dc - innerZ0);

    ctx.innerVolume = box3(
      vec3(innerX0, innerY0, innerZ0),
      vec3(innerWidth, roundMm(innerY1 - innerY0), innerDepth),
    );

    if (innerWidth <= 0 || innerY1 - innerY0 <= 0 || innerDepth <= 0) {
      ctx.report(
        'INNER_VOLUME_EMPTY',
        'error',
        'Внутреннего пространства не остаётся: проверьте габариты и толщину материала.',
      );
    }
  },
};
