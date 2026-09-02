import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { hasErrors, isFiniteBox3, MM_EPSILON } from '../../../src/domain/index.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Property-based проверки геометрического движка (PROMPT 3 §17).
 *
 * Пример-ориентированные тесты (`invariants.test.ts`, `edge-cases.test.ts`)
 * проверяют конкретные значения, которые мы придумали заранее. Property-тест
 * проверяет УТВЕРЖДЕНИЕ для тысяч сгенерированных комбинаций и способен найти
 * контрпример, который никто не написал бы руками. Именно так на этапе
 * PROMPT 2 был найден дефект в `resolveSizes` — см. docs/TESTING_STRATEGY.md §4.
 */

const INVALID_AXES = ['width', 'height', 'depth', 'panelThickness'] as const;

const invalidValue = fc.oneof(
  fc.constant(0),
  fc.double({ min: -1e6, max: -0.001, noNaN: true }),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(Number.NEGATIVE_INFINITY),
);

describe('property: недопустимый вход никогда не даёт геометрию', () => {
  it('ровно один непригодный габарит ⇒ пустой результат с ошибкой, для любого значения', () => {
    fc.assert(
      fc.property(fc.constantFrom(...INVALID_AXES), invalidValue, (axis, value) => {
        const result = buildGeometry(makeGeometryInput({ [axis]: value }));

        expect(result.parts).toHaveLength(0);
        expect(hasErrors(result.diagnostics)).toBe(true);
        expect(result.boundingBox).toEqual({
          minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
          totalWidth: 0, totalHeight: 0, totalDepth: 0,
        });
      }),
    );
  });
});

/**
 * Валидная область: толщина материала небольшая, ширина и высота гарантированно
 * превышают удвоенную толщину с запасом (иначе горизонтали не поместятся —
 * это отдельный, уже проверенный случай отказа, а не «типичный успех»).
 * Диапазоны намеренно вложены внутрь DIMENSION_LIMITS, чтобы не подмешивать
 * предупреждения о выходе за рекомендуемый диапазон в проверку «успеха».
 */
const validDimensions = fc.double({ min: 1, max: 30, noNaN: true }).chain((thickness) =>
  fc.record({
    panelThickness: fc.constant(thickness),
    width: fc.double({ min: thickness * 2 + 20, max: 5900, noNaN: true }),
    height: fc.double({ min: thickness * 2 + 20, max: 2900, noNaN: true }),
    depth: fc.double({ min: 100, max: 1150, noNaN: true }),
  }),
);

const scheme = fc.oneof(
  fc.record({ verticalPriority: fc.constant('sides-through' as const) }),
  fc.record({ verticalPriority: fc.constant('horizontals-through' as const) }),
  fc.record({
    verticalPriority: fc.constant('mixed' as const),
    topOverlaysSides: fc.boolean(),
    bottomOverlaysSides: fc.boolean(),
  }),
);

describe('property: допустимый вход всегда даёт валидную геометрию', () => {
  it('для любых габаритов и любой из трёх схем стыка', () => {
    fc.assert(
      fc.property(validDimensions, scheme, (dimensions, schemeOverrides) => {
        const result = buildGeometry(makeGeometryInput(dimensions, schemeOverrides));

        // Расчёт прошёл: есть детали, ошибок нет.
        expect(result.parts.length).toBeGreaterThan(0);
        expect(hasErrors(result.diagnostics)).toBe(false);

        const ids = new Set<string>();
        for (const part of result.parts) {
          // Ни одна деталь не содержит NaN/Infinity.
          expect(isFiniteBox3({ min: part.position, size: part.size })).toBe(true);
          // Ни одна деталь не имеет неположительного размера.
          expect(part.size.x).toBeGreaterThan(0);
          expect(part.size.y).toBeGreaterThan(0);
          expect(part.size.z).toBeGreaterThan(0);
          // Ни одна деталь не выходит за начало координат изделия.
          expect(part.position.x).toBeGreaterThanOrEqual(0);
          expect(part.position.y).toBeGreaterThanOrEqual(0);
          expect(part.position.z).toBeGreaterThanOrEqual(0);
          // Идентификаторы стабильны и уникальны.
          expect(ids.has(part.id)).toBe(false);
          ids.add(part.id);

          // Деталь не выходит за номинальный габарит изделия (нет свесов
          // на этапе одного каркаса — они появятся вместе со столешницей).
          expect(part.position.x + part.size.x).toBeLessThanOrEqual(dimensions.width + MM_EPSILON);
          expect(part.position.y + part.size.y).toBeLessThanOrEqual(dimensions.height + MM_EPSILON);
        }

        // Bounding box лежит внутри номинального габарита.
        expect(result.boundingBox.maxX).toBeLessThanOrEqual(dimensions.width + MM_EPSILON);
        expect(result.boundingBox.maxY).toBeLessThanOrEqual(dimensions.height + MM_EPSILON);
        expect(result.boundingBox.minX).toBeGreaterThanOrEqual(0);
        expect(result.boundingBox.minY).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('внутренний объём положителен и вложен в номинальный габарит', () => {
    fc.assert(
      fc.property(validDimensions, scheme, (dimensions, schemeOverrides) => {
        const result = buildGeometry(makeGeometryInput(dimensions, schemeOverrides));

        expect(result.innerVolume.size.x).toBeGreaterThan(0);
        expect(result.innerVolume.size.y).toBeGreaterThan(0);
        expect(result.innerVolume.size.z).toBeGreaterThan(0);
        expect(result.innerVolume.min.x).toBeGreaterThanOrEqual(0);
        expect(result.innerVolume.min.y).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('property: детерминизм', () => {
  it('одинаковый вход даёт побайтово одинаковый результат', () => {
    fc.assert(
      fc.property(validDimensions, scheme, (dimensions, schemeOverrides) => {
        const input = makeGeometryInput(dimensions, schemeOverrides);
        expect(buildGeometry(input)).toEqual(buildGeometry(input));
      }),
    );
  });
});
