/**
 * Привязка значений при перетаскивании.
 *
 * Радиус притяжения задаётся в ПИКСЕЛЯХ экрана, а не в миллиметрах: иначе
 * на разных масштабах магнит ведёт себя по-разному и перестаёт быть предсказуемым.
 *
 * Привязка — не резиновость: значение встаёт на магнит мгновенно, без пружины
 * и отскока. Пружинящий производственный размер был бы ложью о конструкции.
 */
export interface SnapCandidate {
  readonly value: number;
  readonly kind: 'step' | 'center' | 'equal' | 'align' | 'system32';
  readonly label?: string;
}

export interface SnapResult {
  readonly value: number;
  readonly snapped: SnapCandidate | undefined;
}

export const SNAP_RADIUS_PX = 6;

/** Шаг ввода по модификаторам клавиатуры. См. docs/INTERACTION_MODEL.md §3. */
export function stepForModifiers(modifiers: { shift?: boolean; alt?: boolean }): number {
  if (modifiers.alt === true) return 0.1;
  if (modifiers.shift === true) return 10;
  return 1;
}

export function snapToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * @param value      текущее значение в миллиметрах
 * @param candidates магниты в миллиметрах
 * @param scale      пикселей экрана на миллиметр
 */
export function snapToCandidates(
  value: number,
  candidates: readonly SnapCandidate[],
  scale: number,
  radiusPx: number = SNAP_RADIUS_PX,
): SnapResult {
  if (scale <= 0 || candidates.length === 0) return { value, snapped: undefined };

  const radiusMm = radiusPx / scale;
  let best: SnapCandidate | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.value - value);
    if (distance <= radiusMm && distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best === undefined ? { value, snapped: undefined } : { value: best.value, snapped: best };
}

/** Система 32: стандартная сетка присадки корпусной мебели. */
export function system32Candidates(from: number, to: number, origin = 0): SnapCandidate[] {
  const result: SnapCandidate[] = [];
  const first = Math.ceil((from - origin) / 32) * 32 + origin;
  for (let v = first; v <= to; v += 32) {
    result.push({ value: v, kind: 'system32' });
  }
  return result;
}

/** Равные доли отрезка: самый частый магнит при делении секции. */
export function equalShareCandidates(total: number, parts: number): SnapCandidate[] {
  if (parts < 2) return [];
  const result: SnapCandidate[] = [];
  for (let i = 1; i < parts; i += 1) {
    result.push({ value: (total * i) / parts, kind: 'equal', label: `${String(i)}/${String(parts)}` });
  }
  return result;
}
