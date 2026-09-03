import { issue } from '../../domain/index.js';
import type { DrillingRule, DrillingRuleContext, DrillingRuleResult } from '../types.js';
import { missingRelation } from './relations.js';

/**
 * Присадка крепежа задней стенки и корпуса (PROMPT 18 §11–§12, §15).
 */

/**
 * Задняя стенка (§11).
 *
 * Деталь задней стенки построена, её периметр известен точно. Не
 * подтверждён шаг крепления (`T-HW-03` — тот же, из-за которого PROMPT 16
 * не выдал количество крепежа) и параметры отверстия (`T-DRILL-05`).
 * Считать присадку по выдуманному шагу нельзя: §11 запрещает прямо.
 *
 * Накладная стенка на гвоздях присадки вообще не требует — а какой из
 * способов монтажа применяется, зависит от `BackPanelMount`, и связь
 * «монтаж → нужна ли сверловка» референсом тоже не подтверждена.
 */
export const backWallDrillingRule: DrillingRule = {
  id: 'back-wall',
  title: 'Присадка крепежа задней стенки',
  status: 'needs-confirmation',
  unknownId: 'T-HW-03',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const panels = ctx.geometry.parts.filter((p) => p.role === 'back');
    if (panels.length === 0) return { operations: [], warnings: [], errors: [] };
    if (ctx.parameters.backWall !== undefined) {
      // Ветка на будущее оставлена намеренно пустой: даже с параметрами
      // отверстия неизвестно, требует ли выбранный способ монтажа сверловки
      // вообще. Выдать здесь отверстия значило бы решить это за
      // производство.
      return {
        operations: [],
        warnings: [
          issue(
            'DRILLING_PARAMETERS_NOT_CONFIRMED',
            'warning',
            'Параметры отверстия задней стенки заданы, но не подтверждено, требует ли выбранный способ монтажа сверловки (T-HW-03).',
          ),
        ],
        errors: [],
      };
    }
    return {
      operations: [],
      warnings: [
        issue(
          'DRILLING_PARAMETERS_NOT_CONFIRMED',
          'warning',
          `Присадка крепежа задней стенки не рассчитана: не подтверждены шаг крепления по периметру и параметры отверстия (T-HW-03). Сегментов стенки: ${String(panels.length)}.`,
        ),
      ],
      errors: [],
    };
  },
};

/**
 * Корпусный крепёж (§12, §15).
 *
 * Здесь не хватает даже не размеров, а САМОГО ТИПА крепежа: конфирмат,
 * минификс, эксцентрик, шкант и Rafix требуют принципиально разной
 * присадки — от одного сквозного отверстия до трёх разных на одну деталь.
 * §15 прямо запрещает выбирать тип самостоятельно.
 *
 * Второе недостающее — модель стыков. `ConstructionScheme` задаёт, какая
 * деталь проходит насквозь, но перечня «эта боковина соединяется с этим
 * горизонтом» в модели нет, а выводить его из соседства деталей §12
 * запрещает.
 */
export const carcassFastenerDrillingRule: DrillingRule = {
  id: 'carcass-fastener',
  title: 'Присадка корпусного крепежа',
  status: 'needs-confirmation',
  unknownId: 'T-HW-03',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const structural = ctx.geometry.parts.filter(
      (p) => p.role === 'side' || p.role === 'top' || p.role === 'bottom' || p.role === 'partition',
    );
    if (structural.length === 0) return { operations: [], warnings: [], errors: [] };
    return {
      operations: [],
      warnings: [
        missingRelation(
          'Присадка корпусного крепежа',
          `не выбран тип крепежа (конфирмат, минификс, эксцентрик, шкант — §15 запрещает выбирать его самостоятельно) и в модели нет перечня стыков «боковина ↔ горизонт». Корпусных деталей: ${String(structural.length)}.`,
        ),
      ],
      errors: [],
    };
  },
};
