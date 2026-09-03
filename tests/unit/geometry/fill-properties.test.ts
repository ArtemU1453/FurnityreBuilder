import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { hasErrors, isFiniteBox3, MM_EPSILON } from '../../../src/domain/index.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты полок (PROMPT 6 §29). Тот же метод, что уже дважды нашёл
 * реальные дефекты на PROMPT 2/3 и один раз не нашёл (PROMPT 4, см.
 * `docs/TESTING_STRATEGY.md` §4) — применяется к новой геометрии с первого
 * дня, а не добавляется по факту найденного дефекта.
 */

const shelfInput = fc
  .record({
    shelfCount: fc.integer({ min: 1, max: 8 }),
  })
  .chain(({ shelfCount }) =>
    fc.record({
      shelfCount: fc.constant(shelfCount),
      // Каждой полке — не менее 20 мм на промежуток сверх толщины самих полок,
      // иначе перебор обязательно найдёт SHELF_AUTO_OVERCONSTRAINED — легитимный,
      // но другой сценарий (уже покрыт tests/unit/geometry/fill.test.ts).
      height: fc.integer({ min: (shelfCount + 1) * 20 + shelfCount * 16 + 32, max: 2900 }),
      width: fc.integer({ min: 100, max: 5900 }),
      depth: fc.integer({ min: 100, max: 1150 }),
    }),
  );

describe('property: допустимая конфигурация полок всегда даёт валидную геометрию', () => {
  it('нет NaN/Infinity, размеры положительны, id уникальны', () => {
    fc.assert(
      fc.property(shelfInput, ({ shelfCount, width, height, depth }) => {
        const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, shelfCount, 'adjustable'), {
          width,
          height,
          depth,
          panelThickness: 16,
        });
        const result = buildGeometry(input);

        expect(hasErrors(result.diagnostics)).toBe(false);
        const shelves = result.parts.filter((p) => p.role === 'shelf-adjustable');
        expect(shelves).toHaveLength(shelfCount);

        const ids = new Set<string>();
        for (const shelf of shelves) {
          expect(isFiniteBox3({ min: shelf.position, size: shelf.size })).toBe(true);
          expect(shelf.size.x).toBeGreaterThan(0);
          expect(shelf.size.y).toBeGreaterThan(0);
          expect(shelf.size.z).toBeGreaterThan(0);
          expect(ids.has(shelf.id)).toBe(false);
          ids.add(shelf.id);
        }
      }),
    );
  });

  it('каждая полка лежит внутри своей ячейки/секции и внутри bounds корпуса', () => {
    fc.assert(
      fc.property(shelfInput, ({ shelfCount, width, height, depth }) => {
        const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, shelfCount, 'adjustable'), {
          width,
          height,
          depth,
          panelThickness: 16,
        });
        const result = buildGeometry(input);
        const cellByNodeId = new Map(result.cells.map((c) => [c.nodeId, c]));

        for (const shelf of result.parts.filter((p) => p.role === 'shelf-adjustable')) {
          const cell = shelf.origin.nodeId !== undefined ? cellByNodeId.get(shelf.origin.nodeId) : undefined;
          expect(cell).toBeDefined();
          if (cell === undefined) continue;
          expect(shelf.position.x).toBeGreaterThanOrEqual(cell.box.min.x - MM_EPSILON);
          expect(shelf.position.x + shelf.size.x).toBeLessThanOrEqual(cell.box.min.x + cell.box.size.x + MM_EPSILON);
          expect(shelf.position.y).toBeGreaterThanOrEqual(cell.box.min.y - MM_EPSILON);
          expect(shelf.position.y + shelf.size.y).toBeLessThanOrEqual(cell.box.min.y + cell.box.size.y + MM_EPSILON);

          expect(shelf.position.x + shelf.size.x).toBeLessThanOrEqual(width + MM_EPSILON);
          expect(shelf.position.y + shelf.size.y).toBeLessThanOrEqual(height + MM_EPSILON);
        }
      }),
    );
  });

  it('детерминизм: одинаковый вход даёт побайтово одинаковый результат', () => {
    fc.assert(
      fc.property(shelfInput, ({ shelfCount, width, height, depth }) => {
        const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, shelfCount, 'adjustable'), {
          width,
          height,
          depth,
          panelThickness: 16,
        });
        expect(buildGeometry(input)).toEqual(buildGeometry(input));
      }),
    );
  });
});
