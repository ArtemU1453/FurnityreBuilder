import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { drawersOf } from '../../../scripts/research/b3d-drawers.mjs';

/**
 * Проверки разбора ящиков по одному (FR-04, многообразцовый анализ).
 *
 * Проверяется ровно то, что установлено фактически, и ничего сверх:
 * ящики выделяются по координате, детали группируются по ним, а
 * одинаковые образцы отличаются от независимых. Правил геометрии
 * ящика здесь нет — их и не существует подтверждённых.
 *
 * Без `B3D_FIXTURE` проверки ПРОПУСКАЮТСЯ: проектный файл заказчика в
 * репозиторий не кладётся (`docs/BRAND_INDEPENDENCE_AUDIT.md`).
 */

const fixture = process.env['B3D_FIXTURE'];
const real = fixture !== undefined && fixture !== '' && existsSync(fixture);

describe.skipIf(!real)('ящики выделяются по одному', () => {
  const drawers = (): ReturnType<typeof drawersOf> => drawersOf(fixture ?? '');

  it('в изделии четыре ящика, у каждого пять деталей', () => {
    const list = drawers();
    expect(list).toHaveLength(4);
    for (const d of list) expect(d.partCount).toBe(5);
  });

  it('ящики сгруппированы по координате, а не по имени детали', () => {
    // Имя несёт номер ОТСЕКА, а не ящика: «ящик.фасад (9)» встречается
    // дважды. Если бы группировка шла по имени, ящиков вышло бы два.
    const list = drawers();
    const bays = new Set(list.map((d) => d.bay));
    expect(bays.size).toBe(2);
    expect(list.length).toBeGreaterThan(bays.size);
  });

  it('у каждого ящика своя направляющая и своя ручка', () => {
    const list = drawers();
    for (const d of list) {
      expect(d.slide).not.toBeNull();
      expect(d.handle).not.toBeNull();
    }
    const ys = list.map((d) => d.slide?.y);
    expect(new Set(ys).size).toBe(4);
  });

  /** §4: четыре ящика — четыре ПОВТОРЕНИЯ одного размерного случая. */
  it('все четыре ящика размерно идентичны', () => {
    const list = drawers();
    const shape = (d: (typeof list)[number]): string =>
      [d.facade, d.back, d.left, d.right, d.bottom]
        .map((p) => (p === null ? '-' : `${String(p.L)}x${String(p.W)}`))
        .join('|');
    expect(new Set(list.map(shape)).size).toBe(1);
  });

  /** §7: направляющая на середине высоты боковины — на всех четырёх. */
  it('направляющая стоит на середине высоты боковины', () => {
    for (const d of drawers()) {
      const side = d.left;
      const slide = d.slide;
      expect(side).not.toBeNull();
      expect(slide).not.toBeNull();
      if (side === null || slide === null) return;
      expect(slide.y - side.y).toBeCloseTo(side.W / 2, 6);
    }
  });

  /**
   * §5: единственная независимая переменная — высота отсека.
   * Отсеки различаются (400 и 401 мм), а высота фасада в обоих 196.
   * Это и опровергает деление без округления.
   */
  it('фасады одинаковы, хотя отсеки разной высоты', () => {
    const list = drawers();
    const heights = list.map((d) => d.facade?.W);
    expect(new Set(heights)).toEqual(new Set([196]));

    // Шаг между ящиками внутри отсека: 199 против 200 — именно эта
    // разница и есть тот самый лишний миллиметр.
    const byBay = new Map<number | null, number[]>();
    for (const d of list) {
      const ys = byBay.get(d.bay) ?? [];
      ys.push(d.facade?.y ?? 0);
      byBay.set(d.bay, ys);
    }
    const steps = [...byBay.values()].map((ys) => {
      const s = [...ys].sort((a, b) => a - b);
      return (s[1] ?? 0) - (s[0] ?? 0);
    }).sort();
    expect(steps).toEqual([199, 200]);
  });
});
