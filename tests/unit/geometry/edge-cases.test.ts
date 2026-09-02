import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { hasErrors } from '../../../src/domain/index.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Явные граничные случаи (PROMPT 3 §11), по одному сценарию на класс.
 * Дополняют property-тест: там перебор, здесь — конкретные, обсуждаемые
 * на ревью числа.
 */

describe('минимальные размеры', () => {
  it('минимально допустимая мебель строится и даёт положительный внутренний объём', () => {
    const result = buildGeometry(makeGeometryInput({ width: 100, height: 100, depth: 80, panelThickness: 8 }));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.parts).toHaveLength(4);
    expect(result.innerVolume.size.x).toBeGreaterThan(0);
  });

  it('размер на грани минимума (T×2 + 0.1) — валиден', () => {
    // W чуть больше 2T: 32.1 > 32 = 2×16.
    const result = buildGeometry(makeGeometryInput({ width: 32.1, height: 200, depth: 100, panelThickness: 16 }));
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('большие размеры', () => {
  it('большая мебель на верхней границе рекомендуемого диапазона строится без ошибок', () => {
    const result = buildGeometry(makeGeometryInput({ width: 5900, height: 2900, depth: 1150, panelThickness: 30 }));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.parts).toHaveLength(4);
  });

  it('размер за пределами рекомендуемого диапазона — предупреждение, не ошибка', () => {
    // ASSUMPTION(T-DIM-01): границы референса не установлены; выход за
    // рекомендуемый диапазон не должен отбирать у пользователя управление.
    const result = buildGeometry(makeGeometryInput({ width: 9000 }));
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_OUT_OF_RECOMMENDED_RANGE');
  });
});

describe('увеличенная толщина материала', () => {
  it('толстый материал пропорционально уменьшает внутренний проём', () => {
    const thin = buildGeometry(makeGeometryInput({ panelThickness: 16 }));
    const thick = buildGeometry(makeGeometryInput({ panelThickness: 40 }));
    expect(thick.innerVolume.size.x).toBeLessThan(thin.innerVolume.size.x);
    expect(thick.innerVolume.size.y).toBeLessThan(thin.innerVolume.size.y);
  });

  it('толщина материала, съедающая весь внутренний объём, — ошибка', () => {
    // Толщина у верхней границы DIMENSION_LIMITS, ширина рассчитана так,
    // чтобы после вычета боковин почти ничего не осталось.
    const result = buildGeometry(makeGeometryInput({ width: 60, height: 500, depth: 200, panelThickness: 30 }));
    // 60 - 2×30 = 0: внутреннего пространства нет.
    expect(hasErrors(result.diagnostics)).toBe(true);
    expect(result.parts).toHaveLength(0);
  });
});

describe('несовместимые размеры', () => {
  it('несовместимая комбинация возвращает validation error, а не мусорную геометрию', () => {
    const result = buildGeometry(makeGeometryInput({ width: 30, panelThickness: 20 }));
    expect(result.parts).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
    expect(result.diagnostics.every((d) => typeof d.code === 'string' && d.code.length > 0)).toBe(true);
  });
});

describe('нулевые значения', () => {
  it.each([
    ['ширина', { width: 0 }],
    ['высота', { height: 0 }],
    ['глубина', { depth: 0 }],
  ] as const)('нулевая %s — ошибка', (_label, dims) => {
    const result = buildGeometry(makeGeometryInput(dims));
    expect(result.parts).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
  });
});

describe('отрицательные значения', () => {
  it.each([
    ['ширина', { width: -500 }],
    ['высота', { height: -500 }],
    ['глубина', { depth: -500 }],
    ['толщина материала', { panelThickness: -16 }],
  ] as const)('отрицательная %s — ошибка', (_label, dims) => {
    const result = buildGeometry(makeGeometryInput(dims));
    expect(result.parts).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
  });
});

describe('NaN', () => {
  it.each([
    ['ширина', { width: Number.NaN }],
    ['высота', { height: Number.NaN }],
    ['глубина', { depth: Number.NaN }],
    ['толщина материала', { panelThickness: Number.NaN }],
  ] as const)('NaN в поле «%s» — ошибка', (_label, dims) => {
    const result = buildGeometry(makeGeometryInput(dims));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_FINITE');
  });
});

describe('Infinity', () => {
  it.each([
    ['ширина', { width: Number.POSITIVE_INFINITY }],
    ['высота', { height: Number.POSITIVE_INFINITY }],
    ['глубина', { depth: Number.POSITIVE_INFINITY }],
    ['толщина материала', { panelThickness: Number.POSITIVE_INFINITY }],
  ] as const)('+Infinity в поле «%s» — ошибка', (_label, dims) => {
    const result = buildGeometry(makeGeometryInput(dims));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_FINITE');
  });
});

describe('тихая коррекция запрещена', () => {
  it('отрицательное значение не превращается в положительное автоматически', () => {
    // PROMPT 3 §12: width = -100 не должно молча стать width = 100.
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    // Если бы значение «исправлялось», получилось бы 4 детали корпуса
    // шириной 100. Правильный ответ — ноль деталей и явная ошибка.
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'DIMENSION_NOT_POSITIVE')).toBe(true);
  });

  it('вход, вызвавший ошибку, не искажается: диагностика ссылается на реальное поле', () => {
    const result = buildGeometry(makeGeometryInput({ height: -250 }));
    const heightIssue = result.diagnostics.find((d) => d.code === 'DIMENSION_NOT_POSITIVE');
    expect(heightIssue?.target?.path).toBe('dimensions.height');
  });
});
