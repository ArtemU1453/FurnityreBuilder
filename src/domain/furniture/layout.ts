import type { Mm } from '../units.js';
import { roundMm, sumMm } from '../units.js';
import type { SizeSpec } from './types.js';

/**
 * Раскладка детей одного деления вдоль его оси.
 *
 *   usable   = L − thickness × (n − 1)
 *   fixedSum = Σ значений fixed
 *   rest     = usable − fixedSum, делится между flex пропорционально весам
 *
 * Инвариант, проверяемый property-тестом: сумма полученных размеров плюс
 * толщины разделителей в точности равна L (с точностью до допуска).
 */
export interface ResolvedSpan {
  /** Смещение начала ячейки от начала родителя вдоль оси деления. */
  readonly offset: Mm;
  readonly length: Mm;
}

export interface LayoutResult {
  readonly spans: readonly ResolvedSpan[];
  /** Свободное место после раскладки. Отрицательное — деление переопределено. */
  readonly rest: Mm;
  readonly overconstrained: boolean;
}

export function resolveSizes(
  sizes: readonly SizeSpec[],
  rawAvailable: Mm,
  rawDividerThickness: Mm,
): LayoutResult {
  // Нормализуем ВХОД, а не только выход.
  //
  // Инвариант «сумма ячеек и разделителей равна доступной длине» иначе держится
  // только для уже нормализованных аргументов: ненормализованная толщина
  // (например, пришедшая из пользовательского материала 3.14 мм) даёт
  // расхождение в десятые доли, которое накапливается по числу разделителей.
  // Это нашёл property-тест — случай, который перебором примеров не поймать.
  const available = roundMm(rawAvailable);
  const dividerThickness = roundMm(rawDividerThickness);

  const n = sizes.length;
  if (n === 0) {
    return { spans: [], rest: available, overconstrained: false };
  }

  const usable = roundMm(available - dividerThickness * (n - 1));

  const fixedSum = sumMm(sizes.filter((s) => s.mode === 'fixed').map((s) => s.value));
  const flexWeight = sizes.reduce((acc, s) => (s.mode === 'flex' ? acc + Math.max(0, s.weight) : acc), 0);

  const rest = roundMm(usable - fixedSum);
  const overconstrained = rest < 0;

  // Распределяем остаток между flex-детьми. Последнему отдаём то, что реально
  // осталось, а не расчётную долю: иначе накопленное округление уводит сумму
  // на десятые доли и деталировка перестаёт сходиться.
  const lengths: Mm[] = [];
  let distributed = 0;
  const flexIndices = sizes.map((s, i) => (s.mode === 'flex' ? i : -1)).filter((i) => i >= 0);
  const lastFlex = flexIndices.at(-1);

  sizes.forEach((size, i) => {
    if (size.mode === 'fixed') {
      lengths[i] = roundMm(size.value);
      return;
    }
    if (flexWeight <= 0) {
      lengths[i] = 0;
      return;
    }
    if (i === lastFlex) {
      lengths[i] = roundMm(Math.max(0, rest) - distributed);
      return;
    }
    const share = roundMm((Math.max(0, rest) * Math.max(0, size.weight)) / flexWeight);
    lengths[i] = share;
    distributed = roundMm(distributed + share);
  });

  const spans: ResolvedSpan[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i += 1) {
    const length = lengths[i] ?? 0;
    spans.push({ offset: roundMm(cursor), length });
    cursor = roundMm(cursor + length + (i < n - 1 ? dividerThickness : 0));
  }

  return { spans, rest, overconstrained };
}

/** Смещение i-го разделителя от начала родителя. */
export function dividerOffset(spans: readonly ResolvedSpan[], index: number): Mm {
  const span = spans[index];
  if (span === undefined) return 0;
  return roundMm(span.offset + span.length);
}
