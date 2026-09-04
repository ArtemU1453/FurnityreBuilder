import { snapToCandidates, snapToStep, stepForModifiers } from '../../interaction/index.js';
import type { SnapCandidate, SnapResult } from '../../interaction/index.js';
import type { Mm } from '../../domain/index.js';

/**
 * Арифметика перетаскивания на холсте (PROMPT 22 §21, §23).
 *
 * ## Почему это отдельный чистый модуль
 *
 * Перевод «пиксели экрана → миллиметры изделия», шаг по модификаторам,
 * магниты и ограничение диапазона — правила, которые нужно проверять
 * тестами, а не разглядывать на экране. В React-компоненте они были бы
 * невидимы для тестов и обросли бы копиями при каждом новом жесте.
 *
 * Геометрии здесь нет: модуль не знает, что такое секция или полка. Он
 * знает только базовое значение, смещение указателя и допустимые границы.
 */

export interface ResizeInput {
  /** Значение до начала жеста, мм. Снимок домена, а не чтение из DOM. */
  readonly base: Mm;
  /** Смещение указателя от точки нажатия, пиксели экрана. */
  readonly deltaPx: number;
  /** Пикселей экрана на миллиметр. */
  readonly scale: number;
  /** Знак: тянем ли мы значение в ту же сторону, что и указатель. */
  readonly direction?: 1 | -1;
  readonly min: Mm;
  readonly max: Mm;
  readonly modifiers?: { readonly shift?: boolean; readonly alt?: boolean };
  readonly candidates?: readonly SnapCandidate[];
}

export interface ResizeResult extends SnapResult {
  /** Значение до применения границ: нужно, чтобы показать упор. */
  readonly raw: Mm;
  readonly clamped: boolean;
}

/**
 * Новое значение размера по жесту.
 *
 * Порядок операций не случаен: сначала перевод в миллиметры, затем шаг по
 * модификаторам, затем магниты, и только потом границы. Если ограничивать
 * раньше, магнит у самой границы перестаёт срабатывать; если применять шаг
 * после магнита, магнит немедленно сбивается округлением.
 */
export function resizeValue(input: ResizeInput): ResizeResult {
  const scale = input.scale > 0 ? input.scale : 1;
  const direction = input.direction ?? 1;
  const step = stepForModifiers(input.modifiers ?? {});

  const raw = input.base + (input.deltaPx / scale) * direction;
  const stepped = snapToStep(raw, step);
  const snap = snapToCandidates(stepped, input.candidates ?? [], scale);

  const clampedValue = Math.min(input.max, Math.max(input.min, snap.value));
  return {
    value: clampedValue,
    snapped: snap.snapped,
    raw,
    clamped: clampedValue !== snap.value,
  };
}

/**
 * Масштаб холста: пикселей экрана на миллиметр изделия.
 *
 * Считается по фактическому размеру SVG на экране, а не по атрибуту
 * `viewBox`: иначе при любом изменении окна перетаскивание начинает
 * «отставать» от курсора ровно во столько раз, во сколько изменился
 * размер.
 */
export function canvasScale(elementWidthPx: number, viewBoxWidthMm: number): number {
  if (viewBoxWidthMm <= 0 || elementWidthPx <= 0) return 1;
  return elementWidthPx / viewBoxWidthMm;
}
