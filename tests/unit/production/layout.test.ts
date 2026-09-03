import { describe, expect, it } from 'vitest';
import { expandInstances, layoutGroup, usableAreaOf, validateLayout, validateStock } from '../../../src/production/index.js';
import type { ProductionPart } from '../../../src/production/index.js';
import { makeProductionPart, makeStock } from './helpers.js';

/**
 * Раскладка деталей на листах (PROMPT 17 §31, раздел Layout).
 *
 * Каждый тест проверяет ровно одно правило раскроя и делает это на
 * листах простых размеров: цель — поймать ошибку в арифметике пропила и
 * обрезной кромки, а не воспроизвести реальный шкаф.
 */

const byId = (parts: readonly ProductionPart[]): ReadonlyMap<string, ProductionPart> =>
  new Map(parts.map((p) => [p.id, p]));

describe('Test 23 (§15): одна деталь', () => {
  const parts = [makeProductionPart({ id: 'a', length: 400, width: 300 })];
  const result = layoutGroup(makeStock(), parts);

  it('лист один, размещение одно, деталь в начале рабочей области', () => {
    expect(result.layouts).toHaveLength(1);
    const placement = result.layouts[0]!.placements[0]!;
    expect(placement).toMatchObject({ x: 0, y: 0, width: 400, height: 300, rotation: 0 });
    expect(result.unplaced).toHaveLength(0);
  });

  it('и раскладка проходит собственную проверку', () => {
    expect(validateLayout(result.layouts[0]!, byId(parts))).toHaveLength(0);
  });
});

describe('Test 24 (§15, §22): несколько деталей и количество', () => {
  it('пять экземпляров одной позиции дают пять размещений', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 300, quantity: 5 })];
    expect(expandInstances(parts)).toHaveLength(5);
    const result = layoutGroup(makeStock(), parts);
    expect(result.layouts.flatMap((l) => l.placements)).toHaveLength(5);
  });

  it('каждый экземпляр размещён ровно один раз', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 300, quantity: 4 })];
    const placements = layoutGroup(makeStock(), parts).layouts.flatMap((l) => l.placements);
    const keys = placements.map((p) => `${p.productionPartId}#${String(p.instanceIndex)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('и каждое размещение знает свою физическую деталь-источник', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 300, quantity: 3 })];
    const placements = layoutGroup(makeStock(), parts).layouts.flatMap((l) => l.placements);
    expect(new Set(placements.map((p) => p.sourcePartId)).size).toBe(3);
  });
});

describe('Test 25 (§18): поворот', () => {
  it('деталь, не влезающая по длине, кладётся поперёк, если поворот разрешён', () => {
    // Лист 1000×400; деталь 900×300 влезает как есть, а 350×900 — только
    // повёрнутой: 900 больше ширины листа 400, но меньше его длины.
    const parts = [makeProductionPart({ id: 'a', length: 350, width: 900, rotationAllowed: true })];
    const result = layoutGroup(makeStock({ length: 1000, width: 400 }), parts);
    const placement = result.layouts[0]?.placements[0];
    expect(placement?.rotation).toBe(90);
    expect(placement?.width).toBe(900);
    expect(placement?.height).toBe(350);
  });

  it('при запрете поворота та же деталь не размещается, а не поворачивается тайком', () => {
    const parts = [makeProductionPart({ id: 'a', length: 350, width: 900, rotationAllowed: false })];
    const result = layoutGroup(makeStock({ length: 1000, width: 400 }), parts);
    expect(result.layouts).toHaveLength(0);
    expect(result.unplaced[0]?.reason).toBe('TOO_LARGE');
    expect(result.unplaced[0]?.detail).toContain('поворот запрещён');
  });

  it('повёрнутое размещение не проходит проверку, если поворот запрещён позицией', () => {
    // Прямая проверка §19: даже если бы алгоритм ошибся, валидация ловит.
    const part = makeProductionPart({ id: 'a', length: 350, width: 900, rotationAllowed: false });
    const layout = layoutGroup(makeStock({ length: 1000, width: 1000 }), [{ ...part, rotationAllowed: true }]).layouts[0]!;
    const forged = { ...layout, placements: layout.placements.map((p) => ({ ...p, rotation: 90 as const })) };
    expect(validateLayout(forged, byId([part])).some((i) => i.code === 'CUTTING_ROTATION_FORBIDDEN')).toBe(true);
  });
});

describe('Test 26 (§16): ширина пропила', () => {
  it('без пропила две детали по 500 мм ложатся на лист 1000 мм', () => {
    const parts = [makeProductionPart({ id: 'a', length: 500, width: 200, quantity: 2 })];
    const result = layoutGroup(makeStock({ length: 1000, width: 200, kerf: 0 }), parts);
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0]!.placements).toHaveLength(2);
  });

  it('с пропилом 4 мм вторая деталь на тот же лист уже не помещается', () => {
    const parts = [makeProductionPart({ id: 'a', length: 500, width: 200, quantity: 2 })];
    const result = layoutGroup(makeStock({ length: 1000, width: 200, kerf: 4 }), parts);
    expect(result.layouts).toHaveLength(2);
  });

  it('пропил вычитается между деталями, а не прибавляется к их размеру', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 200, quantity: 2 })];
    const result = layoutGroup(makeStock({ length: 1000, width: 200, kerf: 10 }), parts);
    const placements = result.layouts[0]!.placements;
    expect(placements[0]).toMatchObject({ x: 0, width: 400 });
    expect(placements[1]).toMatchObject({ x: 410, width: 400 });
  });
});

describe('Test 27 (§17): обрезная кромка', () => {
  const stock = makeStock({ length: 1000, width: 1000, trimLeft: 10, trimRight: 10, trimTop: 20, trimBottom: 20 });

  it('рабочая область меньше листа на обрезную кромку', () => {
    expect(usableAreaOf(stock)).toEqual({ x: 10, y: 20, length: 980, width: 960 });
  });

  it('деталь начинается от края рабочей области, а не от края листа', () => {
    const result = layoutGroup(stock, [makeProductionPart({ id: 'a', length: 400, width: 300 })]);
    expect(result.layouts[0]!.placements[0]).toMatchObject({ x: 10, y: 20 });
  });

  it('деталь размером с лист в рабочую область уже не помещается', () => {
    const result = layoutGroup(stock, [makeProductionPart({ id: 'a', length: 1000, width: 1000, rotationAllowed: false })]);
    expect(result.layouts).toHaveLength(0);
    expect(result.unplaced[0]?.reason).toBe('TOO_LARGE');
  });

  it('обрезная кромка больше листа делает раскрой невозможным', () => {
    const bad = makeStock({ length: 100, width: 100, trimLeft: 60, trimRight: 60 });
    expect(validateStock(bad).some((i) => i.code === 'CUTTING_USABLE_AREA_INVALID')).toBe(true);
    const result = layoutGroup(bad, [makeProductionPart({ id: 'a' })]);
    expect(result.unplaced[0]?.reason).toBe('INVALID_STOCK');
  });
});

describe('Test 28 (§20): невозможное размещение', () => {
  it('слишком большая деталь получает причину TOO_LARGE и не теряется', () => {
    const result = layoutGroup(makeStock({ length: 500, width: 500 }), [makeProductionPart({ id: 'a', length: 900, width: 900 })]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]?.reason).toBe('TOO_LARGE');
  });

  it('деталь с неположительным размером получает причину INVALID_DIMENSIONS', () => {
    const result = layoutGroup(makeStock(), [makeProductionPart({ id: 'a', length: 0, width: 300 })]);
    expect(result.unplaced[0]?.reason).toBe('INVALID_DIMENSIONS');
  });
});

describe('Test 29 (§15): несколько листов', () => {
  const parts = [makeProductionPart({ id: 'a', length: 600, width: 600, quantity: 5 })];
  const result = layoutGroup(makeStock({ length: 1000, width: 1000 }), parts);

  it('на лист 1000×1000 влезает одна деталь 600×600, значит листов пять', () => {
    expect(result.layouts).toHaveLength(5);
    expect(result.unplaced).toHaveLength(0);
  });

  it('ни один лист не остаётся пустым', () => {
    for (const layout of result.layouts) expect(layout.placements.length).toBeGreaterThan(0);
  });

  it('у каждого листа свой идентификатор', () => {
    expect(new Set(result.layouts.map((l) => l.id)).size).toBe(result.layouts.length);
  });
});

describe('Test 30 (§19): детали не пересекаются', () => {
  it('плотная раскладка проходит проверку пересечений', () => {
    const parts = [
      makeProductionPart({ id: 'a', length: 500, width: 500, quantity: 4 }),
      makeProductionPart({ id: 'b', length: 250, width: 250, quantity: 6 }),
      makeProductionPart({ id: 'c', length: 120, width: 800, quantity: 3 }),
    ];
    const result = layoutGroup(makeStock({ length: 1000, width: 1000, kerf: 4 }), parts);
    for (const layout of result.layouts) expect(validateLayout(layout, byId(parts))).toHaveLength(0);
  });

  it('подделанное пересечение проверка ловит', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 300, quantity: 2 })];
    const layout = layoutGroup(makeStock(), parts).layouts[0]!;
    const first = layout.placements[0]!;
    const forged = { ...layout, placements: [first, { ...first, id: 'pl:forged', instanceIndex: 1 }] };
    expect(validateLayout(forged, byId(parts)).some((i) => i.code === 'CUTTING_PLACEMENTS_OVERLAP')).toBe(true);
  });

  it('выход за пределы листа проверка тоже ловит', () => {
    const parts = [makeProductionPart({ id: 'a', length: 400, width: 300 })];
    const layout = layoutGroup(makeStock({ length: 1000, width: 1000 }), parts).layouts[0]!;
    const forged = { ...layout, placements: layout.placements.map((p) => ({ ...p, x: 900 })) };
    expect(validateLayout(forged, byId(parts)).some((i) => i.code === 'CUTTING_PLACEMENT_OUT_OF_BOUNDS')).toBe(true);
  });
});

describe('Test 31 (§21): отход и процент использования', () => {
  it('формулы считаются от площадей, а не на глаз', () => {
    const parts = [makeProductionPart({ id: 'a', length: 500, width: 500 })];
    const layout = layoutGroup(makeStock({ length: 1000, width: 1000 }), parts).layouts[0]!;
    expect(layout.usedArea).toBe(250_000);
    expect(layout.stockArea).toBe(1_000_000);
    expect(layout.wasteArea).toBe(750_000);
    expect(layout.utilization).toBeCloseTo(0.25, 10);
  });

  it('рабочая область учитывается отдельно от полной площади листа', () => {
    const parts = [makeProductionPart({ id: 'a', length: 500, width: 500 })];
    const layout = layoutGroup(makeStock({ length: 1000, width: 1000, trimLeft: 10, trimRight: 10, trimTop: 10, trimBottom: 10 }), parts).layouts[0]!;
    expect(layout.stockArea).toBe(1_000_000);
    expect(layout.usableArea).toBe(980 * 980);
    // Обрезная кромка входит в отход: её нельзя превратить в деталь.
    expect(layout.wasteArea).toBe(1_000_000 - 250_000);
  });
});

describe('Test 32 (§15): детерминизм раскладки', () => {
  it('одинаковый вход даёт побайтово одинаковую раскладку', () => {
    const parts = [
      makeProductionPart({ id: 'a', length: 500, width: 300, quantity: 3 }),
      makeProductionPart({ id: 'b', length: 300, width: 300, quantity: 4 }),
    ];
    const stock = makeStock({ length: 1200, width: 900, kerf: 4 });
    expect(JSON.stringify(layoutGroup(stock, parts))).toBe(JSON.stringify(layoutGroup(stock, parts)));
  });

  it('порядок позиций на входе не меняет результат', () => {
    const a = makeProductionPart({ id: 'a', length: 500, width: 300, quantity: 3 });
    const b = makeProductionPart({ id: 'b', length: 300, width: 300, quantity: 4 });
    const stock = makeStock({ length: 1200, width: 900, kerf: 4 });
    const forward = layoutGroup(stock, [a, b]).layouts.flatMap((l) => l.placements).map((p) => p.id).sort();
    const backward = layoutGroup(stock, [b, a]).layouts.flatMap((l) => l.placements).map((p) => p.id).sort();
    expect(backward).toEqual(forward);
  });
});
