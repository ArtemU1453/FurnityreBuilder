import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createSizedSplit, fixedSizes } from '../../../src/domain/furniture/sections.js';
import { boxContains, hasErrors, isFiniteBox3, sumMm } from '../../../src/domain/index.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты индивидуальных размеров (PROMPT 8 §29).
 *
 * Генерируются массивы РАЗНЫХ размеров, а габарит подбирается под них так,
 * чтобы сумма сходилась точно. Проверяется, что движок отдаёт ровно
 * заданные размеры при любом их сочетании, а не только на аккуратных
 * примерах вроде [300, 500, 400].
 */

const T = 16;

/** Массив из 1–6 разных размеров и габарит, при котором их сумма сходится. */
const sizesInput = fc
  .array(fc.integer({ min: 60, max: 900 }), { minLength: 1, maxLength: 6 })
  .map((sizes) => ({
    sizes,
    // Габарит = сумма проёмов + разделители между ними + две наружные детали.
    total: sumMm(sizes) + (sizes.length - 1) * T + 2 * T,
  }));

describe('property: неравномерные секции', () => {
  it('движок отдаёт ровно заданные ширины, без NaN, пересечений и потерянного места', () => {
    fc.assert(
      fc.property(sizesInput, ({ sizes, total }) => {
        const result = buildGeometry(
          makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'x', fixedSizes(sizes), T), {
            width: total,
            height: 2000,
            depth: 500,
            panelThickness: T,
          }),
        );

        expect(hasErrors(result.diagnostics)).toBe(false);
        expect(result.sections.map((s) => s.box.size.x)).toEqual(sizes);
        expect(result.cells).toHaveLength(sizes.length);
        expect(result.parts.filter((p) => p.role === 'partition')).toHaveLength(sizes.length - 1);

        const ids = new Set<string>();
        for (const section of result.sections) {
          expect(isFiniteBox3(section.box)).toBe(true);
          expect(section.box.size.x).toBeGreaterThan(0);
          expect(boxContains(result.innerVolume, section.box)).toBe(true);
          expect(ids.has(section.nodeId)).toBe(false);
          ids.add(section.nodeId);
        }

        // Уравнение ширины сходится при ЛЮБОМ наборе размеров, а не только
        // при равных секциях.
        const sectionsWidth = sumMm(result.sections.map((s) => s.box.size.x));
        const partitionsWidth = sumMm(result.parts.filter((p) => p.role === 'partition').map((p) => p.size.x));
        const sidesWidth = sumMm(result.parts.filter((p) => p.role === 'side').map((p) => p.size.x));
        expect(sectionsWidth + partitionsWidth + sidesWidth).toBe(total);

        expect(findPartOverlaps(result.parts)).toEqual([]);
      }),
    );
  });

  it('несходящаяся сумма всегда даёт диагностику, а не геометрию с зазором', () => {
    fc.assert(
      fc.property(sizesInput, fc.integer({ min: 1, max: 400 }), ({ sizes, total }, delta) => {
        // Габарит намеренно смещён: сумма размеров больше не сходится ни в ту,
        // ни в другую сторону — движок обязан сообщить об этом, а не строить.
        for (const width of [total + delta, total - delta]) {
          if (width < 200) continue;
          const result = buildGeometry(
            makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'x', fixedSizes(sizes), T), {
              width,
              height: 2000,
              depth: 500,
              panelThickness: T,
            }),
          );
          expect(hasErrors(result.diagnostics)).toBe(true);
          expect(result.cells).toHaveLength(0);
        }
      }),
    );
  });
});

describe('property: неравномерные ряды', () => {
  it('движок отдаёт ровно заданные высоты, и сумма сходится с H', () => {
    fc.assert(
      fc.property(sizesInput, ({ sizes, total }) => {
        const result = buildGeometry(
          makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'y', fixedSizes(sizes), T), {
            width: 1000,
            height: total,
            depth: 500,
            panelThickness: T,
          }),
        );

        expect(hasErrors(result.diagnostics)).toBe(false);
        const sorted = [...result.cells].sort((a, b) => a.box.min.y - b.box.min.y);
        expect(sorted.map((c) => c.box.size.y)).toEqual(sizes);

        const rowsHeight = sumMm(result.cells.map((c) => c.box.size.y));
        const dividersHeight = sumMm(result.parts.filter((p) => p.role === 'shelf-fixed').map((p) => p.size.y));
        expect(rowsHeight + dividersHeight + 2 * T).toBe(total);

        expect(findPartOverlaps(result.parts)).toEqual([]);
      }),
    );
  });
});
