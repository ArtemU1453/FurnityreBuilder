import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { hasErrors, isFiniteBox3, MM_EPSILON } from '../../../src/domain/index.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты сетки (PROMPT 4 §22). Дополняют пример-ориентированные
 * тесты `layout.test.ts`: там — конкретные, обсуждаемые числа, здесь —
 * утверждение для тысяч случайно сгенерированных допустимых конфигураций.
 * Метод уже дважды находил реальные дефекты на предыдущих этапах
 * (docs/TESTING_STRATEGY.md §4) — применяем его и к сетке с первого дня.
 */

/**
 * Толщина материала небольшая и фиксированная (проверка чувствительности
 * толщины к раскладке уже покрыта `properties.test.ts` для каркаса);
 * здесь варьируем именно сеточные параметры — rows, columns, W, H —
 * и требуем, чтобы КАЖДАЯ комбинация давала физически осмысленную ячейку
 * не меньше 20 мм, иначе перебор обязательно найдёт вырожденный случай
 * «0 ячеек с ошибкой», что является легитимным, но другим сценарием
 * (см. `layout.test.ts`, Test 11).
 */
const gridInput = fc
  .record({
    rows: fc.integer({ min: 1, max: 6 }),
    columns: fc.integer({ min: 1, max: 6 }),
  })
  .chain(({ rows, columns }) =>
    fc.record({
      rows: fc.constant(rows),
      columns: fc.constant(columns),
      // Каждой ячейке — не менее 20 мм на сторону сверх перегородок.
      width: fc.integer({ min: columns * 20 + (columns - 1) * 16 + 32, max: 5900 }),
      height: fc.integer({ min: rows * 20 + (rows - 1) * 16 + 32, max: 2900 }),
      depth: fc.integer({ min: 100, max: 1150 }),
    }),
  );

describe('property: допустимая сетка всегда даёт валидную геометрию', () => {
  it('нет NaN/Infinity, размеры положительны, координаты неотрицательны, id уникальны', () => {
    fc.assert(
      fc.property(gridInput, ({ rows, columns, width, height, depth }) => {
        const input = makeGeometryInputWithRoot(
          (ids) => createUniformGrid(ids, rows, columns, 16, 16),
          { width, height, depth, panelThickness: 16 },
        );
        const result = buildGeometry(input);

        expect(hasErrors(result.diagnostics)).toBe(false);
        expect(result.cells).toHaveLength(rows * columns);

        const ids = new Set<string>();
        for (const part of result.parts) {
          expect(isFiniteBox3({ min: part.position, size: part.size })).toBe(true);
          expect(part.size.x).toBeGreaterThan(0);
          expect(part.size.y).toBeGreaterThan(0);
          expect(part.size.z).toBeGreaterThan(0);
          expect(part.position.x).toBeGreaterThanOrEqual(0);
          expect(part.position.y).toBeGreaterThanOrEqual(0);
          expect(ids.has(part.id)).toBe(false);
          ids.add(part.id);
        }

        const cellIds = new Set<string>();
        for (const cell of result.cells) {
          expect(isFiniteBox3(cell.box)).toBe(true);
          expect(cell.box.size.x).toBeGreaterThan(0);
          expect(cell.box.size.y).toBeGreaterThan(0);
          expect(cell.box.size.z).toBeGreaterThan(0);
          expect(cell.box.min.x).toBeGreaterThanOrEqual(0);
          expect(cell.box.min.y).toBeGreaterThanOrEqual(0);
          expect(cellIds.has(cell.nodeId)).toBe(false);
          cellIds.add(cell.nodeId);
          // row/column в допустимых границах сетки.
          expect(cell.row).toBeGreaterThanOrEqual(0);
          expect(cell.row).toBeLessThan(rows);
          expect(cell.column).toBeGreaterThanOrEqual(0);
          expect(cell.column).toBeLessThan(columns);
        }
      }),
    );
  });

  it('ячейки не выходят за номинальный габарит изделия', () => {
    fc.assert(
      fc.property(gridInput, ({ rows, columns, width, height, depth }) => {
        const input = makeGeometryInputWithRoot(
          (ids) => createUniformGrid(ids, rows, columns, 16, 16),
          { width, height, depth, panelThickness: 16 },
        );
        const result = buildGeometry(input);

        for (const cell of result.cells) {
          expect(cell.box.min.x + cell.box.size.x).toBeLessThanOrEqual(width + MM_EPSILON);
          expect(cell.box.min.y + cell.box.size.y).toBeLessThanOrEqual(height + MM_EPSILON);
        }
      }),
    );
  });

  it('детерминизм: одинаковый вход даёт побайтово одинаковый результат', () => {
    fc.assert(
      fc.property(gridInput, ({ rows, columns, width, height, depth }) => {
        const input = makeGeometryInputWithRoot(
          (ids) => createUniformGrid(ids, rows, columns, 16, 16),
          { width, height, depth, panelThickness: 16 },
        );
        expect(buildGeometry(input)).toEqual(buildGeometry(input));
      }),
    );
  });
});
