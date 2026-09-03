import { issue } from '../../domain/index.js';
import type { DrillingRule, DrillingRuleContext, DrillingRuleResult } from '../types.js';
import { missingRelation } from './relations.js';

/**
 * Присадка под полкодержатели (PROMPT 18 §10).
 *
 * Позиции держателей уже посчитаны (PROMPT 16: четыре на съёмную полку),
 * и высота каждой полки известна точно. Не хватает двух вещей, и обе
 * названы явно:
 *
 * 1. Детали-приёмника: отверстие идёт в боковину или перегородку,
 *    держащую полку, а такой связи в модели нет (см. `relations.ts`).
 * 2. Параметров отверстия: диаметр, глубина и отступ от переднего и
 *    заднего торца — `T-DRILL-03`. Ряд отверстий «система 32» тоже не
 *    подтверждён, а придумывать шаг присадки §10 запрещает.
 *
 * Параметры сюда уже проведены (`parameters.shelfSupport`), поэтому, когда
 * появится связь деталей, правило заработает без изменения архитектуры.
 */
export const shelfSupportDrillingRule: DrillingRule = {
  id: 'shelf-support',
  title: 'Присадка полкодержателей',
  status: 'needs-confirmation',
  unknownId: 'T-DRILL-03',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const supports = ctx.hardware.items.filter((item) => item.kind === 'shelf-support');
    if (supports.length === 0) return { operations: [], warnings: [], errors: [] };

    const total = supports.reduce((sum, item) => sum + item.quantity, 0);
    const warnings = [
      missingRelation(
        'Присадка полкодержателей',
        `модель не знает, какая боковина или перегородка держит полку, а сверлить «ближайшую» нельзя (§12). Держателей в изделии: ${String(total)}.`,
      ),
    ];
    if (ctx.parameters.shelfSupport === undefined) {
      warnings.push(
        issue(
          'DRILLING_PARAMETERS_NOT_CONFIRMED',
          'warning',
          'Не подтверждены также диаметр, глубина и отступ отверстия под полкодержатель от торцов боковины (T-DRILL-03).',
        ),
      );
    }
    return { operations: [], warnings, errors: [] };
  },
};
