/**
 * Единицы измерения доменного слоя.
 *
 * Полное обоснование — docs/UNITS_AND_PRECISION.md.
 *
 * Короткая версия: доменная единица — миллиметр, представленный `number`
 * с инвариантом «кратно 0.1 мм». Целое число не подходит: два накладных фасада
 * на проёме 1000 мм при зазоре 3 мм дают 498.5 мм. Плавающая точка без
 * нормализации тоже не подходит: 0.1 + 0.2 !== 0.3, и деталировка начнёт
 * показывать 568.0000000000001.
 *
 * Поэтому каждая величина, попадающая в результат расчёта, проходит `roundMm`,
 * а сравнения выполняются через `eqMm`/`cmpMm`, никогда через `===` и `<`.
 */

/** Миллиметры. Инвариант: значение конечно и кратно {@link MM_PRECISION}. */
export type Mm = number;

/** Шаг доменной сетки значений: 0.1 мм. */
export const MM_PRECISION = 0.1;

/**
 * Допуск сравнения: половина шага. Две величины, отличающиеся меньше чем
 * на 0.05 мм, после нормализации неразличимы, значит равны.
 */
export const MM_EPSILON = 0.05;

/** Знаков после запятой при выводе значения пользователю. */
export const MM_DISPLAY_DECIMALS = 1;

/** Приводит произвольное число к доменной сетке значений. */
export function roundMm(value: number): Mm {
  return Math.round(value * 10) / 10;
}

/** true, если значение пригодно как размер: конечное, не NaN. */
export function isFiniteMm(value: unknown): value is Mm {
  return typeof value === 'number' && Number.isFinite(value);
}

/** true, если значение уже лежит на доменной сетке. */
export function isNormalizedMm(value: unknown): value is Mm {
  return isFiniteMm(value) && Math.abs(value - roundMm(value)) < Number.EPSILON * 16;
}

export function eqMm(a: Mm, b: Mm): boolean {
  return Math.abs(a - b) < MM_EPSILON;
}

/** −1, 0 или 1 с учётом допуска. Единственный законный способ упорядочить размеры. */
export function cmpMm(a: Mm, b: Mm): -1 | 0 | 1 {
  if (eqMm(a, b)) return 0;
  return a < b ? -1 : 1;
}

export const ltMm = (a: Mm, b: Mm): boolean => cmpMm(a, b) < 0;
export const gtMm = (a: Mm, b: Mm): boolean => cmpMm(a, b) > 0;
export const lteMm = (a: Mm, b: Mm): boolean => cmpMm(a, b) <= 0;
export const gteMm = (a: Mm, b: Mm): boolean => cmpMm(a, b) >= 0;

export function clampMm(value: Mm, min: Mm, max: Mm): Mm {
  return roundMm(Math.min(Math.max(value, min), max));
}

/**
 * Сумма с однократной нормализацией в конце.
 * Складывать уже округлённые значения по одному — значит копить ошибку.
 */
export function sumMm(values: readonly Mm[]): Mm {
  let total = 0;
  for (const v of values) total += v;
  return roundMm(total);
}

/**
 * Форматирование для интерфейса. Доменное значение не меняется —
 * UI волен показывать что угодно, домен остаётся в миллиметрах.
 */
export function formatMm(value: Mm, decimals: number = MM_DISPLAY_DECIMALS): string {
  const fixed = value.toFixed(decimals);
  // 568.0 → 568: пользователю не нужен ложный знак точности на круглом числе.
  return fixed.replace(/\.0+$/, '');
}

/** Единицы, доступные слою отображения. Домен всегда хранит миллиметры. */
export type DisplayUnit = 'mm' | 'cm' | 'm';

const DISPLAY_FACTOR: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000 };

/** Только для вывода. Обратное преобразование — {@link fromDisplay}. */
export function toDisplay(value: Mm, unit: DisplayUnit): number {
  return value / DISPLAY_FACTOR[unit];
}

/** Ввод пользователя в выбранных единицах → нормализованные миллиметры. */
export function fromDisplay(value: number, unit: DisplayUnit): Mm {
  return roundMm(value * DISPLAY_FACTOR[unit]);
}
