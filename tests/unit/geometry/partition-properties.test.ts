import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf } from '../../../src/domain/furniture/defaults.js';
import { boxContains, hasErrors, isFiniteBox3, sumMm } from '../../../src/domain/index.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты секций и вертикальных перегородок (PROMPT 7 §24).
 *
 * Дополняют пример-ориентированный `partitions.test.ts`: там конкретные,
 * обсуждаемые числа, здесь — утверждение для тысяч случайных допустимых
 * конфигураций. Метод уже дважды находил реальные дефекты на PROMPT 2–3
 * (docs/TESTING_STRATEGY.md §4).
 */

const partitionInput = fc
  .record({
    sectionCount: fc.integer({ min: 1, max: 8 }),
    panelThickness: fc.integer({ min: 8, max: 24 }),
  })
  .chain(({ sectionCount, panelThickness }) =>
    fc.record({
      sectionCount: fc.constant(sectionCount),
      panelThickness: fc.constant(panelThickness),
      // Каждой секции — не меньше 20 мм сверх боковин и перегородок, иначе
      // перебор непременно найдёт переопределённое деление: легитимный,
      // но другой сценарий (он покрыт layout.test.ts, Test 11).
      width: fc.integer({
        min: sectionCount * 20 + (sectionCount - 1) * panelThickness + panelThickness * 2,
        max: 5900,
      }),
      height: fc.integer({ min: panelThickness * 2 + 100, max: 2900 }),
      depth: fc.integer({ min: 100, max: 1150 }),
    }),
  );

describe('property: любая допустимая конфигурация секций даёт валидную геометрию', () => {
  it('partitionCount = sectionCount − 1, размеры положительны, id уникальны, нет NaN/Infinity', () => {
    fc.assert(
      fc.property(partitionInput, ({ sectionCount, width, height, depth, panelThickness }) => {
        const dims = { width, height, depth, panelThickness };
        const input =
          sectionCount <= 1
            ? makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), dims)
            : makeGeometryInputWithRoot((ids) => createSections(ids, sectionCount, panelThickness), dims);
        const result = buildGeometry(input);

        expect(hasErrors(result.diagnostics)).toBe(false);
        expect(result.sections).toHaveLength(sectionCount);

        const partitions = result.parts.filter((p) => p.role === 'partition');
        expect(partitions).toHaveLength(sectionCount - 1);
        expect(partitions.length).toBeGreaterThanOrEqual(0);

        const sectionIds = new Set<string>();
        for (const section of result.sections) {
          expect(isFiniteBox3(section.box)).toBe(true);
          expect(section.box.size.x).toBeGreaterThan(0);
          expect(section.box.size.y).toBeGreaterThan(0);
          expect(section.box.size.z).toBeGreaterThan(0);
          expect(sectionIds.has(section.nodeId)).toBe(false);
          sectionIds.add(section.nodeId);
        }

        for (const partition of partitions) {
          expect(isFiniteBox3({ min: partition.position, size: partition.size })).toBe(true);
          expect(partition.size.x).toBeGreaterThan(0);
          expect(partition.size.y).toBeGreaterThan(0);
          expect(partition.size.z).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('секции и перегородки лежат внутри корпуса, а их сумма с боковинами равна W', () => {
    fc.assert(
      fc.property(partitionInput, ({ sectionCount, width, height, depth, panelThickness }) => {
        const dims = { width, height, depth, panelThickness };
        const input =
          sectionCount <= 1
            ? makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), dims)
            : makeGeometryInputWithRoot((ids) => createSections(ids, sectionCount, panelThickness), dims);
        const result = buildGeometry(input);

        for (const section of result.sections) {
          expect(boxContains(result.innerVolume, section.box)).toBe(true);
        }
        for (const partition of result.parts.filter((p) => p.role === 'partition')) {
          expect(boxContains(result.innerVolume, { min: partition.position, size: partition.size })).toBe(true);
        }

        const sectionsWidth = sumMm(result.sections.map((s) => s.box.size.x));
        const partitionsWidth = sumMm(result.parts.filter((p) => p.role === 'partition').map((p) => p.size.x));
        const sidesWidth = sumMm(result.parts.filter((p) => p.role === 'side').map((p) => p.size.x));
        expect(sectionsWidth + partitionsWidth + sidesWidth).toBe(width);
      }),
    );
  });

  it('ни одна деталь не пересекает другую', () => {
    fc.assert(
      fc.property(partitionInput, ({ sectionCount, width, height, depth, panelThickness }) => {
        const dims = { width, height, depth, panelThickness };
        const input =
          sectionCount <= 1
            ? makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), dims)
            : makeGeometryInputWithRoot((ids) => createSections(ids, sectionCount, panelThickness), dims);
        expect(findPartOverlaps(buildGeometry(input).parts)).toEqual([]);
      }),
    );
  });
});
