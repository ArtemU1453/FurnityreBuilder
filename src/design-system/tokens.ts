/**
 * Типизированное зеркало токенов из tokens.css.
 *
 * Нужно там, где значение требуется в JavaScript: расчёт зоны попадания,
 * геометрия отрисовки, тесты контраста. Дублирование сознательное и
 * ограниченное: CSS остаётся источником для стилей, здесь — только то,
 * что реально читает код.
 */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, full: 9999 } as const;

export const controlHeight = { sm: 28, md: 32, lg: 40, toolbar: 48 } as const;

/**
 * Минимальная зона попадания. Достигается прозрачным паддингом, а не
 * увеличением рисунка: тонкая линия разделителя остаётся тонкой,
 * но попасть в неё можно.
 */
export const MIN_HIT_TARGET = 44;

/** Расширение зоны попадания для тонких элементов схемы. */
export const THIN_HIT_PADDING = 12;

export const surfaceLevel = {
  canvas: 0,
  panel: 1,
  floating: 2,
  popover: 3,
  modal: 4,
} as const;

export type SurfaceLevel = keyof typeof surfaceLevel;
