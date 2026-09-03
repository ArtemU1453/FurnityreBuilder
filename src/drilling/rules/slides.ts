import { issue } from '../../domain/index.js';
import type { DrillingRule, DrillingRuleContext, DrillingRuleResult } from '../types.js';
import { missingRelation } from './relations.js';

/**
 * Присадка направляющих ящиков (PROMPT 18 §9).
 *
 * Направляющие посчитаны (PROMPT 16: две на ящик, по одной на сторону), и
 * левая со правой различаются самой конструкцией. Не хватает того же, что
 * и полкодержателям, плюс схемы отверстий:
 *
 * 1. Детали-приёмника: направляющая крепится к стенке ячейки, а связь
 *    «ячейка ↔ её боковина» в модели не выражена (см. `relations.ts`).
 * 2. Схемы присадки: отступ первого отверстия от переднего торца, шаг,
 *    число отверстий, диаметр и глубина — `T-DRILL-02`. У каждой модели
 *    направляющей своя схема, и сама модель тоже не подтверждена
 *    (`T-DRW-01`), поэтому придумать «типовую» нельзя вдвойне.
 */
export const slideDrillingRule: DrillingRule = {
  id: 'slide',
  title: 'Присадка направляющих',
  status: 'needs-confirmation',
  unknownId: 'T-DRILL-02',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const slides = ctx.hardware.items.filter((item) => item.kind === 'slide');
    if (slides.length === 0) return { operations: [], warnings: [], errors: [] };

    const total = slides.reduce((sum, item) => sum + item.quantity, 0);
    const warnings = [
      missingRelation(
        'Присадка направляющих',
        `модель не выражает, какая стенка ячейки принимает направляющую. Направляющих в изделии: ${String(total)}.`,
      ),
    ];
    if (ctx.parameters.slide === undefined) {
      warnings.push(
        issue(
          'DRILLING_PARAMETERS_NOT_CONFIRMED',
          'warning',
          'Не подтверждена также схема присадки направляющей: отступ от переднего торца, шаг, число отверстий, диаметр и глубина (T-DRILL-02, T-DRW-01).',
        ),
      );
    }
    return { operations: [], warnings, errors: [] };
  },
};
