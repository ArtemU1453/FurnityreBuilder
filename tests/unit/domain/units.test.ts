import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cmpMm,
  eqMm,
  formatMm,
  fromDisplay,
  isFiniteMm,
  isNormalizedMm,
  MM_EPSILON,
  roundMm,
  sumMm,
  toDisplay,
} from '../../../src/domain/units.js';

describe('единицы измерения', () => {
  it('нормализует значение к сетке 0.1 мм', () => {
    expect(roundMm(568.04)).toBe(568);
    expect(roundMm(498.5)).toBe(498.5);
    expect(roundMm(0.1 + 0.2)).toBe(0.3);
  });

  it('складывает без накопления ошибки плавающей точки', () => {
    // Наивное сложение даёт 0.30000000000000004 и ломает деталировку.
    expect(sumMm([0.1, 0.1, 0.1])).toBe(0.3);
    expect(sumMm([333.3, 333.3, 333.4])).toBe(1000);
  });

  it('сравнивает с допуском, а не точным равенством', () => {
    expect(eqMm(568, 568.04)).toBe(true);
    expect(eqMm(568, 568.06)).toBe(false);
    expect(cmpMm(100, 200)).toBe(-1);
    expect(cmpMm(200, 100)).toBe(1);
    expect(cmpMm(100, 100.01)).toBe(0);
  });

  it('отличает пригодные значения от NaN и бесконечности', () => {
    expect(isFiniteMm(500)).toBe(true);
    expect(isFiniteMm(Number.NaN)).toBe(false);
    expect(isFiniteMm(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteMm('500')).toBe(false);
  });

  it('убирает ложный знак точности у круглых чисел', () => {
    expect(formatMm(568)).toBe('568');
    expect(formatMm(498.5)).toBe('498.5');
  });

  it('преобразует единицы отображения без потери значения', () => {
    expect(toDisplay(1500, 'cm')).toBe(150);
    expect(toDisplay(1500, 'm')).toBe(1.5);
    expect(fromDisplay(1.5, 'm')).toBe(1500);
  });

  it('после нормализации любое конечное число лежит на сетке', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (value) => {
        const rounded = roundMm(value);
        expect(isNormalizedMm(rounded)).toBe(true);
        expect(Math.abs(rounded - value)).toBeLessThanOrEqual(MM_EPSILON + 1e-9);
      }),
    );
  });
});
