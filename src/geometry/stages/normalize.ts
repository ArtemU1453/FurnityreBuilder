import { DIMENSION_LIMITS, gtMm, isFiniteMm, lteMm } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';

/**
 * Первый этап конвейера: убедиться, что вход пригоден для расчёта.
 *
 * Разделение ролей: здесь ловятся только те дефекты, при которых дальнейший
 * расчёт даст мусор (NaN, ноль, отрицательная толщина). Мягкие правила
 * («полка слишком длинная») — задача слоя валидации, а не движка.
 */
export const normalizeStage: GeometryStage = {
  name: 'normalize',
  run(ctx: GeometryContext): void {
    const { dimensions } = ctx.input.furniture;
    const entries = [
      ['width', dimensions.width],
      ['height', dimensions.height],
      ['depth', dimensions.depth],
      ['panelThickness', dimensions.panelThickness],
    ] as const;

    for (const [name, value] of entries) {
      if (!isFiniteMm(value)) {
        ctx.report(
          'DIMENSION_NOT_FINITE',
          'error',
          `Габарит «${name}» не является числом.`,
          { path: `dimensions.${name}` },
        );
        continue;
      }
      if (lteMm(value, 0)) {
        ctx.report('DIMENSION_NOT_POSITIVE', 'error', `Габарит «${name}» должен быть больше нуля.`, {
          path: `dimensions.${name}`,
        });
      }
    }

    const t = dimensions.panelThickness;
    if (isFiniteMm(t) && isFiniteMm(dimensions.width) && !gtMm(dimensions.width, t * 2)) {
      ctx.report(
        'WIDTH_BELOW_CARCASS',
        'error',
        'Ширина меньше суммарной толщины боковин: внутреннего пространства не остаётся.',
        { path: 'dimensions.width' },
      );
    }
    if (isFiniteMm(t) && isFiniteMm(dimensions.height) && !gtMm(dimensions.height, t * 2)) {
      ctx.report(
        'HEIGHT_BELOW_CARCASS',
        'error',
        'Высота меньше суммарной толщины горизонтальных деталей.',
        { path: 'dimensions.height' },
      );
    }

    // ASSUMPTION(T-DIM-01): границы референса не установлены, поэтому выход
    // за диапазон — предупреждение, а не запрет. Пользователь не теряет управление.
    const soft = [
      ['width', dimensions.width, DIMENSION_LIMITS.width],
      ['height', dimensions.height, DIMENSION_LIMITS.height],
      ['depth', dimensions.depth, DIMENSION_LIMITS.depth],
    ] as const;

    for (const [name, value, limit] of soft) {
      if (!isFiniteMm(value)) continue;
      if (value < limit.min || value > limit.max) {
        ctx.report(
          'DIMENSION_OUT_OF_RECOMMENDED_RANGE',
          'warning',
          `Габарит «${name}» вне рекомендуемого диапазона ${String(limit.min)}–${String(limit.max)} мм.`,
          { path: `dimensions.${name}` },
        );
      }
    }
  },
};
