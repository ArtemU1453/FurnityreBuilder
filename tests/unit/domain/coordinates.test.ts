import { describe, expect, it } from 'vitest';
import {
  box3,
  boxContains,
  boxMax,
  boxVolume,
  intersectionVolume,
  isFiniteBox3,
  sliceAlong,
  vec3,
} from '../../../src/domain/coordinates.js';

describe('система координат', () => {
  const box = box3(vec3(0, 0, 0), vec3(1000, 2000, 500));

  it('максимальный угол складывается из минимального и габарита', () => {
    expect(boxMax(box)).toEqual({ x: 1000, y: 2000, z: 500 });
  });

  it('вырезает отрезок вдоль оси, не трогая остальные', () => {
    const slice = sliceAlong(box, 'x', 100, 300);
    expect(slice.min).toEqual({ x: 100, y: 0, z: 0 });
    expect(slice.size).toEqual({ x: 300, y: 2000, z: 500 });
  });

  it('вычисляет объём пересечения и ноль для непересекающихся тел', () => {
    const a = box3(vec3(0, 0, 0), vec3(100, 100, 100));
    const b = box3(vec3(50, 0, 0), vec3(100, 100, 100));
    const c = box3(vec3(200, 0, 0), vec3(100, 100, 100));
    expect(intersectionVolume(a, b)).toBe(50 * 100 * 100);
    expect(intersectionVolume(a, c)).toBe(0);
  });

  it('определяет вложенность с учётом допуска', () => {
    expect(boxContains(box, box3(vec3(16, 16, 0), vec3(968, 1968, 500)))).toBe(true);
    expect(boxContains(box, box3(vec3(-1, 0, 0), vec3(100, 100, 100)))).toBe(false);
  });

  it('ловит NaN и бесконечность в координатах', () => {
    expect(isFiniteBox3(box)).toBe(true);
    expect(isFiniteBox3(box3(vec3(Number.NaN, 0, 0), vec3(1, 1, 1)))).toBe(false);
    expect(isFiniteBox3(box3(vec3(0, 0, 0), vec3(Number.POSITIVE_INFINITY, 1, 1)))).toBe(false);
  });

  it('объём положителен для непустого тела', () => {
    expect(boxVolume(box)).toBe(1000 * 2000 * 500);
  });
});
