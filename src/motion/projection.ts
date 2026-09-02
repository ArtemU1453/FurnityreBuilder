/**
 * Проекция момента и резиновые границы.
 *
 * Формулы — из образцов Apple к «Designing Fluid Interfaces», а не из учебника
 * физики: экспоненциальное затухание, а не v²/(2a). Разница заметна на глаз.
 */

/**
 * Куда доедет объект, брошенный с данной скоростью.
 *
 * Нужно, чтобы цель выбиралась по спроецированной точке остановки, а не по
 * точке отпускания: именно это превращает короткий флик в бросок.
 *
 * @param initialVelocity px/s
 * @param decelerationRate 0.998 — обычная прокрутка, 0.99 — резче
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  if (!Number.isFinite(initialVelocity)) return 0;
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Ближайшая точка привязки к спроецированной остановке. */
export function nearestSnapPoint(value: number, points: readonly number[]): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

/**
 * Прогрессивное сопротивление за границей.
 *
 * Жёсткий стоп читается как «зависло», непрерывное сопротивление — как
 * «отзывается, но дальше ничего нет».
 *
 * ВАЖНО: в этом продукте резиновость применяется к viewport и планировщику,
 * но НЕ к перегородкам, полкам и габаритам. Там значение — производственный
 * размер, и показывать «немного зашло дальше предела» значит врать
 * о конструкции. См. docs/INTERACTION_MODEL.md §2.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Применяет резиновость к значению, вышедшему за [min, max]. */
export function applyRubberband(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min - rubberband(min - value, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}
