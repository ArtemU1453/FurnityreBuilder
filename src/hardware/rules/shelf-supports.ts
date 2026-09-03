import { issue } from '../../domain/index.js';
import type { HardwareItem, HardwareRule, HardwareRuleContext, HardwareRuleResult } from '../types.js';
import { buildHardwareItemId } from '../types.js';
import { HW_SHELF_SUPPORT } from '../registry.js';

/**
 * Полкодержатели (PROMPT 16 §9).
 *
 * ## Только съёмные полки
 *
 * Съёмная полка (`mounting: 'adjustable'`, роль детали
 * `shelf-adjustable`) лежит на полкодержателях; стационарная
 * (`shelf-fixed`) крепится к боковинам корпусным крепежом и держателей не
 * требует. Правило §9 прямо запрещает добавлять крепёж стационарной полке
 * «на всякий случай», поэтому фильтр здесь по РОЛИ детали, а не по факту
 * «это полка».
 *
 * ## Откуда четыре
 *
 * Полка — прямоугольная пласть, лежащая на опорах по углам: четыре угла —
 * четыре опоры. Это следствие геометрии детали, а не отраслевая таблица,
 * поэтому число вычисляется функцией `supportsPerShelf`, читающей
 * количество углов, и меняется в одном месте, если подтвердится другая
 * схема (например, два держателя на сторону у широкой полки).
 *
 * Статус `ambiguous`, а не `implemented`: сама схема опирания
 * (полкодержатель против шкантов или планок) референсом не подтверждена —
 * `T-SHF-02`.
 */

/** Углов у прямоугольной полки — столько же и опор. */
const SHELF_CORNERS = 4;

export function supportsPerShelf(): number {
  return SHELF_CORNERS;
}

export const shelfSupportRule: HardwareRule = {
  id: 'shelf-support',
  title: 'Полкодержатели съёмных полок',
  status: 'ambiguous',
  unknownId: 'T-SHF-02',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const shelves = ctx.geometry.parts.filter((p) => p.role === 'shelf-adjustable');
    if (shelves.length === 0) return { items: [], warnings: [], errors: [] };

    const items: HardwareItem[] = shelves.map((part) => ({
      id: buildHardwareItemId('shelf-support', part.id, HW_SHELF_SUPPORT),
      definitionId: HW_SHELF_SUPPORT,
      kind: 'shelf-support' as const,
      unit: 'pcs' as const,
      quantity: supportsPerShelf(),
      sourcePartId: part.id,
      ...(part.origin.nodeId === undefined ? {} : { sourceNodeId: part.origin.nodeId }),
      ruleId: 'shelf-support',
      reason: `${String(supportsPerShelf())} держателя на съёмную полку: по одному на каждый угол пласти`,
    }));

    return {
      items,
      warnings: [
        issue(
          'HARDWARE_RULE_AMBIGUOUS',
          'info',
          `Полкодержатели посчитаны по углам съёмных полок (${String(shelves.length)} шт.); сама схема опирания (держатель, шкант или планка) референсом не подтверждена (T-SHF-02).`,
        ),
      ],
      errors: [],
    };
  },
};
