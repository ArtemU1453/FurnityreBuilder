import { issue, isLeaf, visitNodes } from '../../domain/index.js';
import type { Drawer, SlideType } from '../../domain/index.js';
import type { HardwareItem, HardwareRule, HardwareRuleContext, HardwareRuleResult } from '../types.js';
import { buildHardwareItemId } from '../types.js';
import { HW_SLIDE } from '../registry.js';

/**
 * Направляющие ящиков (PROMPT 16 §8).
 *
 * ## Откуда берётся количество
 *
 * Из типа направляющей, а не из константы в коде. Все четыре типа,
 * которые знает модель (`SlideType`), — боковые или скрытые парные:
 * комплект ставится с двух сторон короба, то есть две штуки на ящик.
 * Это следствие конструкции самой направляющей, а не выдуманный порог,
 * поэтому число живёт в одной функции `slidesPerDrawer`, которую и нужно
 * будет менять, если появится непарный тип (например, центральная
 * подвесная направляющая одного экземпляра на ящик).
 *
 * Единица — штуки, а не пары: в спецификации цеха направляющие считают
 * поштучно, а «пара» скрыла бы нечётные остатки при заказе.
 *
 * `ASSUMPTION(T-DRW-01)`: модель и длина направляющей референсом не
 * подтверждены — здесь считается только количество, а не артикул.
 */

/** Сколько направляющих на один ящик при данном типе. */
export function slidesPerDrawer(type: SlideType): number {
  switch (type) {
    case 'roller':
    case 'ball-full':
    case 'ball-partial':
    case 'hidden-soft-close':
      // Все известные модели парные: по одной на каждую сторону короба.
      return 2;
  }
}

/** Все ящики изделия вместе с ячейкой, в которой они стоят. */
function collectDrawers(ctx: HardwareRuleContext): { drawer: Drawer; cellId: string }[] {
  const found: { drawer: Drawer; cellId: string }[] = [];
  visitNodes(ctx.furniture.root, (node) => {
    if (!isLeaf(node) || node.fill.kind !== 'drawers') return;
    for (const drawer of node.fill.drawers) found.push({ drawer, cellId: node.id });
  });
  return found;
}

export const slideRule: HardwareRule = {
  id: 'slide',
  title: 'Направляющие ящиков',
  status: 'ambiguous',
  unknownId: 'T-DRW-01',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const drawers = collectDrawers(ctx);
    if (drawers.length === 0) return { items: [], warnings: [], errors: [] };

    const items: HardwareItem[] = drawers.map(({ drawer, cellId }) => ({
      id: buildHardwareItemId('slide', drawer.id, HW_SLIDE),
      definitionId: HW_SLIDE,
      kind: 'slide' as const,
      unit: 'pcs' as const,
      quantity: slidesPerDrawer(drawer.slide.type),
      sourceNodeId: drawer.id,
      ruleId: 'slide',
      reason: `${String(slidesPerDrawer(drawer.slide.type))} направляющие на ящик: тип «${drawer.slide.type}» парный, по одной на сторону короба (ячейка ${cellId})`,
    }));

    return {
      items,
      warnings: [
        issue(
          'HARDWARE_RULE_AMBIGUOUS',
          'info',
          `Направляющие посчитаны по количеству ящиков (${String(drawers.length)}); модель и длина направляющей референсом не подтверждены (T-DRW-01) и в позицию не входят.`,
        ),
      ],
      errors: [],
    };
  },
};
