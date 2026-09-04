import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  layoutModeOf,
  mediaQueryOf,
  usesFullStepRail,
  usesSheets,
} from '../../../src/app/layout.js';
import type { LayoutMode } from '../../../src/app/layout.js';

/**
 * Разбор размера окна на режимы раскладки (PROMPT 28 §3).
 *
 * Модуль чистый, поэтому проверяется обычным тестом, а не запуском
 * браузера. Смысл проверок — не «функция возвращает строку», а границы:
 * ровно на них ломается раскладка, и ровно они должны совпадать с
 * `@media` в CSS.
 */

describe('режим раскладки', () => {
  it('границы — те же три числа, что в токенах', () => {
    expect(BREAKPOINTS).toEqual({ mobile: 600, tablet: 900, desktop: 1200 });
  });

  it.each([
    [320, 'mobile'],
    [390, 'mobile'],
    [600, 'mobile'],
    [601, 'tablet'],
    [768, 'tablet'],
    [900, 'tablet'],
    [901, 'desktop'],
    [1024, 'desktop'],
    [1440, 'desktop'],
  ])('ширина %i — это %s', (width, expected) => {
    expect(layoutModeOf(width, 1024)).toBe(expected);
  });

  it('телефон в альбомной ориентации — телефон, а не планшет', () => {
    // 844×390: по одной ширине это «планшет», и боковая колонка при
    // 390 px высоты не помещается — страница вырастала до 1879 px.
    expect(layoutModeOf(844, 390)).toBe('mobile');
    // Планшет в той же ориентации остаётся планшетом: высоты хватает.
    expect(layoutModeOf(1024, 768)).toBe('desktop');
    expect(layoutModeOf(900, 700)).toBe('tablet');
  });

  it('низкое окно на широком экране остаётся десктопом', () => {
    // Иначе развёрнутое во всю ширину, но низкое окно на мониторе
    // получило бы телефонную раскладку — там для колонок место есть.
    expect(layoutModeOf(1440, 400)).toBe('desktop');
  });

  it('без высоты решает только ширина', () => {
    expect(layoutModeOf(844)).toBe('tablet');
    expect(layoutModeOf(390)).toBe('mobile');
  });

  it('нечисловая ширина не превращает приложение в телефон', () => {
    expect(layoutModeOf(Number.NaN)).toBe('desktop');
  });

  it('медиазапросы режимов не пересекаются и покрывают всё', () => {
    // Проверяется на сетке размеров: ровно один режим на каждый.
    const modes: readonly LayoutMode[] = ['mobile', 'tablet', 'desktop'];
    for (const width of [320, 390, 600, 601, 768, 900, 901, 1200, 1440]) {
      for (const height of [390, 600, 601, 768, 1024]) {
        const matching = modes.filter((mode) => matches(mediaQueryOf(mode), width, height));
        expect(matching, `${String(width)}×${String(height)}`).toHaveLength(1);
        expect(matching[0]).toBe(layoutModeOf(width, height));
      }
    }
  });
});

describe('что зависит от режима', () => {
  it('листы — только на телефоне', () => {
    expect(usesSheets('mobile')).toBe(true);
    expect(usesSheets('tablet')).toBe(false);
    expect(usesSheets('desktop')).toBe(false);
  });

  it('полная лестница шагов — везде, кроме телефона', () => {
    expect(usesFullStepRail('mobile')).toBe(false);
    expect(usesFullStepRail('tablet')).toBe(true);
    expect(usesFullStepRail('desktop')).toBe(true);
  });
});

/**
 * Крошечный разбор медиазапроса: только те формы, которые строит
 * `mediaQueryOf`. Настоящий движок здесь не нужен — нужна уверенность,
 * что три запроса делят плоскость размеров без дыр и нахлёстов.
 */
function matches(query: string, width: number, height: number): boolean {
  return query.split(',').some((clause) =>
    clause.split(' and ').every((term) => {
      const parsed = /\((min|max)-(width|height):\s*(\d+)px\)/.exec(term.trim());
      if (parsed === null) return false;
      const [, bound, axis, raw] = parsed;
      const limit = Number(raw);
      const value = axis === 'width' ? width : height;
      return bound === 'min' ? value >= limit : value <= limit;
    }),
  );
}
