import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateCutting, layoutGroup, usableAreaOf, validateLayout } from '../../../src/production/index.js';
import type { ProductionPart } from '../../../src/production/index.js';
import { createDrawersLeaf, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';
import { makeProductionPart, makeProject, makeStock } from './helpers.js';

/**
 * Property-тесты раскроя (PROMPT 17 §32).
 *
 * Проверяются ровно те инварианты, которые перечисляет задание. Они
 * сильнее любого набора примеров: раскладку легко «починить» под
 * конкретный лист и сломать на соседнем, а инвариант «ни одна деталь не
 * выходит за лист» обязан держаться на любом входе.
 */

const EPSILON = 0.001;

// ── Раскладка на случайных листах и деталях ──────────────────────────────────

const layoutInput = fc.record({
  stockLength: fc.integer({ min: 400, max: 3000 }),
  stockWidth: fc.integer({ min: 400, max: 2100 }),
  kerf: fc.integer({ min: 0, max: 10 }),
  trim: fc.integer({ min: 0, max: 20 }),
  parts: fc.array(
    fc.record({
      length: fc.integer({ min: 50, max: 1200 }),
      width: fc.integer({ min: 50, max: 900 }),
      quantity: fc.integer({ min: 1, max: 4 }),
      rotationAllowed: fc.boolean(),
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

type LayoutInput = {
  stockLength: number;
  stockWidth: number;
  kerf: number;
  trim: number;
  parts: { length: number; width: number; quantity: number; rotationAllowed: boolean }[];
};

function partsOf(input: LayoutInput): ProductionPart[] {
  return input.parts.map((p, i) =>
    makeProductionPart({
      id: `p${String(i)}`,
      length: p.length,
      width: p.width,
      quantity: p.quantity,
      rotationAllowed: p.rotationAllowed,
    }),
  );
}

describe('property 1 (§32): все размещения внутри рабочей области листа', () => {
  it('ни одна деталь не выходит за лист и не заходит в обрезную кромку', () => {
    fc.assert(
      fc.property(layoutInput, (input) => {
        const stock = makeStock({
          length: input.stockLength,
          width: input.stockWidth,
          kerf: input.kerf,
          trimLeft: input.trim,
          trimRight: input.trim,
          trimTop: input.trim,
          trimBottom: input.trim,
        });
        const usable = usableAreaOf(stock);
        const result = layoutGroup(stock, partsOf(input));
        for (const layout of result.layouts) {
          for (const p of layout.placements) {
            expect(p.x).toBeGreaterThanOrEqual(usable.x - EPSILON);
            expect(p.y).toBeGreaterThanOrEqual(usable.y - EPSILON);
            expect(p.x + p.width).toBeLessThanOrEqual(usable.x + usable.length + EPSILON);
            expect(p.y + p.height).toBeLessThanOrEqual(usable.y + usable.width + EPSILON);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('property 2 (§32): размещения не пересекаются', () => {
  it('на любом листе любые две детали не накладываются друг на друга', () => {
    fc.assert(
      fc.property(layoutInput, (input) => {
        const stock = makeStock({
          length: input.stockLength,
          width: input.stockWidth,
          kerf: input.kerf,
          trimLeft: input.trim,
          trimRight: input.trim,
          trimTop: input.trim,
          trimBottom: input.trim,
        });
        const parts = partsOf(input);
        const byId = new Map(parts.map((p) => [p.id, p]));
        for (const layout of layoutGroup(stock, parts).layouts) {
          expect(validateLayout(layout, byId)).toHaveLength(0);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('property 3 (§32): размещённые и неразмещённые в сумме дают требуемое количество', () => {
  it('ни один экземпляр не теряется и не дублируется', () => {
    fc.assert(
      fc.property(layoutInput, (input) => {
        const stock = makeStock({
          length: input.stockLength,
          width: input.stockWidth,
          kerf: input.kerf,
          trimLeft: input.trim,
          trimRight: input.trim,
          trimTop: input.trim,
          trimBottom: input.trim,
        });
        const parts = partsOf(input);
        const required = parts.reduce((sum, p) => sum + p.quantity, 0);
        const result = layoutGroup(stock, parts);
        const placed = result.layouts.flatMap((l) => l.placements);
        expect(placed.length + result.unplaced.length).toBe(required);

        const keys = [
          ...placed.map((p) => `${p.productionPartId}#${String(p.instanceIndex)}`),
          ...result.unplaced.map((u) => `${u.productionPartId}#${String(u.instanceIndex)}`),
        ];
        expect(new Set(keys).size).toBe(required);
      }),
      { numRuns: 150 },
    );
  });
});

describe('property 4 (§32): поворот никогда не нарушает запрет', () => {
  it('деталь с запрещённым поворотом всегда лежит под 0°', () => {
    fc.assert(
      fc.property(layoutInput, (input) => {
        const stock = makeStock({ length: input.stockLength, width: input.stockWidth, kerf: input.kerf });
        const parts = partsOf(input);
        const byId = new Map(parts.map((p) => [p.id, p]));
        for (const layout of layoutGroup(stock, parts).layouts) {
          for (const p of layout.placements) {
            if (byId.get(p.productionPartId)?.rotationAllowed === false) expect(p.rotation).toBe(0);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('property 5 (§32): одинаковый вход — одинаковая раскладка', () => {
  it('расчёт детерминирован', () => {
    fc.assert(
      fc.property(layoutInput, (input) => {
        const stock = makeStock({ length: input.stockLength, width: input.stockWidth, kerf: input.kerf });
        const parts = partsOf(input);
        expect(JSON.stringify(layoutGroup(stock, parts))).toBe(JSON.stringify(layoutGroup(stock, parts)));
      }),
      { numRuns: 80 },
    );
  });
});

// ── Полный расчёт на случайных изделиях ──────────────────────────────────────

const projectInput = fc.record({
  fill: fc.constantFrom<'empty' | 'shelves' | 'drawers' | 'sections'>('empty', 'shelves', 'drawers', 'sections'),
  count: fc.integer({ min: 1, max: 4 }),
  withFacade: fc.boolean(),
  width: fc.integer({ min: 400, max: 2400 }),
  height: fc.integer({ min: 600, max: 2400 }),
  depth: fc.integer({ min: 250, max: 700 }),
});

type ProjectInput = {
  fill: 'empty' | 'shelves' | 'drawers' | 'sections';
  count: number;
  withFacade: boolean;
  width: number;
  height: number;
  depth: number;
};

function projectOf(cfg: ProjectInput): Project {
  return makeProject((furniture: Furniture, ids: IdFactory) => {
    const root =
      cfg.fill === 'drawers'
        ? createDrawersLeaf(ids, cfg.count)
        : cfg.fill === 'shelves'
          ? createShelvesLeaf(ids, cfg.count, 'adjustable')
          : cfg.fill === 'sections'
            ? createSections(ids, cfg.count + 1, 16)
            : furniture.root;
    const withRoot: Furniture = {
      ...furniture,
      root,
      dimensions: { ...furniture.dimensions, width: cfg.width, height: cfg.height, depth: cfg.depth },
    };
    return cfg.withFacade ? { ...withRoot, facades: [createHingedFacade(ids, root.id, 1)] } : withRoot;
  });
}

describe('property 6 (§32): все размещения ссылаются на существующие позиции', () => {
  it('и каждая позиция — на существующие физические детали', () => {
    fc.assert(
      fc.property(projectInput, (cfg) => {
        const result = calculateCutting(projectOf(cfg));
        const ids = new Set(result.productionParts.map((p) => p.id));
        for (const layout of result.layouts) {
          for (const placement of layout.placements) {
            expect(ids.has(placement.productionPartId)).toBe(true);
            const part = result.productionParts.find((p) => p.id === placement.productionPartId);
            expect(part?.sourcePartIds).toContain(placement.sourcePartId);
          }
        }
        // Ошибок валидации быть не должно: движок проверяет сам себя,
        // а property-тест утверждает, что проверять нечего.
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('property 7 (§32): сериализация не меняет расчёт', () => {
  it('проект после сохранения и загрузки даёт ту же карту раскроя', () => {
    fc.assert(
      fc.property(projectInput, (cfg) => {
        const project = projectOf(cfg);
        const restored = fromJson(toJson(project)).project;
        expect(JSON.stringify(calculateCutting(restored))).toBe(JSON.stringify(calculateCutting(project)));
      }),
      { numRuns: 60 },
    );
  });
});
