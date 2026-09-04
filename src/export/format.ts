import { roundMm } from '../domain/index.js';
import type { EdgeSpec, Mm } from '../domain/index.js';

/**
 * Единицы и округление в документах (PROMPT 20 §10).
 *
 * ## Одно правило на оба формата
 *
 * PDF и XLSX обязаны показывать одно и то же число одинаково. Если бы
 * каждый экспортёр форматировал сам, рано или поздно в PDF оказалось бы
 * «497», а в XLSX — «497.0000000001»: производственный документ, которому
 * нельзя доверить размер, бесполезен.
 *
 * ## Точность расчёта не меняется
 *
 * Округление здесь — только для ОТОБРАЖЕНИЯ и для числовых ячеек
 * документа. Внутренние величины остаются как есть: экспорт не имеет
 * права «подправлять» геометрию под красивый вид (§10).
 */

/** Знаков после запятой в линейных размерах документа. */
export const MM_PRECISION = 1;

/**
 * Число для ЧИСЛОВОЙ ячейки XLSX и для подписи в PDF.
 *
 * `roundMm` — та же функция, которой пользуется геометрия
 * (`docs/UNITS_AND_PRECISION.md`): второго правила округления не заводится.
 * Дополнительно снимается «минус ноль»: `-0` в ячейке выглядит как ошибка
 * расчёта, хотя это всего лишь знак нуля в IEEE 754.
 */
export function mmValue(value: Mm): number {
  const rounded = roundMm(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Тот же размер строкой: без хвоста «.0», с запятой не заигрываем. */
export function mmText(value: Mm): string {
  const rounded = mmValue(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(MM_PRECISION);
}

/** Площадь в квадратных метрах: производственная единица для листов. */
export function areaM2(areaMm2: number): number {
  return Math.round((areaMm2 / 1_000_000) * 1000) / 1000;
}

/** Длина в погонных метрах: производственная единица для кромки. */
export function lengthM(lengthMm: number): number {
  return Math.round((lengthMm / 1000) * 1000) / 1000;
}

/** Доля 0…1 в проценты с одним знаком. */
export function percentValue(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

/** Кромка одной строкой: «2/0/0.4/0.4» — перёд/зад/лево/право. */
export function edgeText(edge: EdgeSpec): string {
  return `${mmText(edge.front)}/${mmText(edge.back)}/${mmText(edge.left)}/${mmText(edge.right)}`;
}

/** Габарит одной строкой: «2000 × 497 × 16». */
export function sizeText(length: Mm, width: Mm, thickness?: Mm): string {
  const base = `${mmText(length)} × ${mmText(width)}`;
  return thickness === undefined ? base : `${base} × ${mmText(thickness)}`;
}
