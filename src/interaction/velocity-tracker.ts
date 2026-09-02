/**
 * История точек указателя и скорость на отпускании.
 *
 * Медиана по нескольким последним отсчётам, а не последняя дельта. Последняя
 * дельта на отпускании часто нулевая (палец замер до подъёма) или шумная —
 * объект «залипает» либо выстреливает. Медиана убирает и то и другое.
 */
export interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

export const VELOCITY_SAMPLES = 5;

export class VelocityTracker {
  private readonly samples: Sample[] = [];
  private readonly capacity: number;

  constructor(capacity: number = VELOCITY_SAMPLES) {
    this.capacity = Math.max(2, capacity);
  }

  add(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  reset(): void {
    this.samples.length = 0;
  }

  get size(): number {
    return this.samples.length;
  }

  /** Скорость в px/s по осям. */
  velocity(): { x: number; y: number } {
    if (this.samples.length < 2) return { x: 0, y: 0 };

    const vx: number[] = [];
    const vy: number[] = [];
    for (let i = 1; i < this.samples.length; i += 1) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      if (a === undefined || b === undefined) continue;
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      vx.push((b.x - a.x) / dt);
      vy.push((b.y - a.y) / dt);
    }
    return { x: median(vx), y: median(vy) };
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
