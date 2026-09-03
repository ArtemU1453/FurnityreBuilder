import { issue } from '../../domain/index.js';
import type { FacadeGroup, Mm } from '../../domain/index.js';
import type { HardwareRule, HardwareRuleContext, HardwareRuleResult } from '../types.js';
import { HW_HINGE, HW_HINGE_FASTENER } from '../registry.js';

/**
 * Петли распашных дверей (PROMPT 16 §6–7).
 *
 * ## Почему количество не считается
 *
 * Число петель зависит от высоты и веса створки по ступенчатой таблице
 * («до 900 — две, до 1600 — три, дальше — четыре» и подобные). Ни один
 * порог референсом не подтверждён: `T-DOOR-05` в реестре так и записан —
 * «Пороги количества петель по высоте фасада: не задано». Поставить сюда
 * «2» или чью-то отраслевую таблицу значило бы выдать догадку за расчёт,
 * что PROMPT 16 §6 запрещает прямым текстом.
 *
 * ## Что вместо этого сделано
 *
 * Реализован ИНТЕРФЕЙС правила: `HingeCountTable` описывает ровно ту
 * форму, в которой ответ придёт после теста T-DOOR-05 — список порогов
 * «высота створки → количество». Пока таблица пуста, правило собирает все
 * створки, которым петли нужны, и сообщает, чего не хватает, с их
 * размерами: когда таблица появится, менять придётся одну константу, а не
 * алгоритм.
 */

/** Порог таблицы: створка не выше `maxHeight` получает `quantity` петель. */
export interface HingeCountThreshold {
  readonly maxHeight: Mm;
  readonly quantity: number;
}

/**
 * Таблица порогов. ПУСТА намеренно: `UNKNOWN (T-DOOR-05)`.
 * Заполнение таблицы — единственное, что нужно, чтобы правило заработало.
 */
export const HINGE_COUNT_TABLE: readonly HingeCountThreshold[] = [];

/** Количество петель по таблице; `undefined`, пока таблица не подтверждена. */
export function hingeCountForHeight(height: Mm, table = HINGE_COUNT_TABLE): number | undefined {
  for (const threshold of table) {
    if (height <= threshold.maxHeight) return threshold.quantity;
  }
  return table.length === 0 ? undefined : table[table.length - 1]?.quantity;
}

/** Нужны ли створке петли: у купе, подъёмных и складных фасадов механика другая. */
function needsHinges(facade: FacadeGroup): boolean {
  return facade.type === 'hinged';
}

export const hingeRule: HardwareRule = {
  id: 'hinge',
  title: 'Петли распашных дверей',
  status: 'needs-confirmation',
  unknownId: 'T-DOOR-05',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    // Створки, которым петли нужны: распашной фасад с реальной стороной
    // петель. `hingeSide: 'none'` — створка без петель (например, вставка).
    const leaves = ctx.furniture.facades
      .filter(needsHinges)
      .flatMap((facade) => facade.leaves.filter((leaf) => leaf.hingeSide !== 'none'));

    if (leaves.length === 0) return { items: [], warnings: [], errors: [] };

    // Высоты берутся у уже построенных дверных деталей, а не пересчитываются:
    // деталь роли `facade` для этой створки уже знает свою высоту.
    const doorParts = ctx.geometry.parts.filter((p) => p.role === 'facade');
    const heights = leaves
      .map((leaf) => doorParts.find((p) => p.id.includes(leaf.id))?.size.y)
      .filter((h): h is number => h !== undefined);

    const resolved = heights.map((h) => hingeCountForHeight(h));
    if (resolved.every((q) => q !== undefined)) {
      // Ветка на будущее: как только таблица заполнена, правило считает
      // без единой правки алгоритма.
      const items = leaves.flatMap((leaf, i) => {
        const quantity = resolved[i];
        const height = heights[i];
        if (quantity === undefined || height === undefined) return [];
        return [
          {
            id: `hw:hinge/${leaf.id}/${String(HW_HINGE)}`,
            definitionId: HW_HINGE,
            kind: 'hinge' as const,
            unit: 'pcs' as const,
            quantity,
            sourceNodeId: leaf.id,
            ruleId: 'hinge',
            reason: `${String(quantity)} петель на створку высотой ${String(height)} мм по таблице порогов`,
          },
        ];
      });
      return { items, warnings: [], errors: [] };
    }

    return {
      items: [],
      warnings: [
        issue(
          'HARDWARE_RULE_NEEDS_CONFIRMATION',
          'warning',
          `Петли не рассчитаны: пороги количества петель по высоте створки референсом не подтверждены (T-DOOR-05). Створок, которым нужны петли: ${String(leaves.length)}${heights.length > 0 ? `, высоты: ${heights.map((h) => String(h)).join(', ')} мм` : ''}. Позиция «${String(HW_HINGE)}» ждёт таблицы порогов.`,
        ),
      ],
      errors: [],
    };
  },
};

/**
 * Крепёж петель — отдельная позиция от самой петли (§7).
 *
 * Количество производно от количества петель, а его нет: пока не
 * подтверждена таблица T-DOOR-05, считать не от чего. Плюс само число
 * шурупов на петлю (`T-HW-03` — «правило количества крепежа») тоже не
 * установлено. Правило существует и объясняет обе недостающие величины.
 */
export const hingeFastenerRule: HardwareRule = {
  id: 'hinge-fastener',
  title: 'Крепёж петель',
  status: 'needs-confirmation',
  unknownId: 'T-HW-03',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const hingedLeaves = ctx.furniture.facades
      .filter(needsHinges)
      .flatMap((facade) => facade.leaves.filter((leaf) => leaf.hingeSide !== 'none'));
    if (hingedLeaves.length === 0) return { items: [], warnings: [], errors: [] };

    return {
      items: [],
      warnings: [
        issue(
          'HARDWARE_RULE_NEEDS_CONFIRMATION',
          'warning',
          `Крепёж петель не рассчитан: количество производно от числа петель (T-DOOR-05, не подтверждено) и от числа точек крепления на петлю (T-HW-03, не подтверждено). Позиция «${String(HW_HINGE_FASTENER)}» ждёт обоих правил.`,
        ),
      ],
      errors: [],
    };
  },
};
