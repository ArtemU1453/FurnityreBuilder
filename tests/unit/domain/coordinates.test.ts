import { describe, expect, it } from 'vitest';
import {
  box3,
  boxContains,
  boxMax,
  boxVolume,
  intersectionVolume,
  overlaps,
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

  /**
   * `overlaps` отличает пересечение от касания (PROMPT 7 §19). Для мебели это
   * не придирка: полка, стоящая вплотную к перегородке, и дно, примыкающее
   * к боковине, — законная конструкция, а не дефект.
   */
  describe('пересечение против касания', () => {
    const a = box3(vec3(0, 0, 0), vec3(100, 100, 100));

    it('касание гранью пересечением не считается', () => {
      expect(overlaps(a, box3(vec3(100, 0, 0), vec3(100, 100, 100)))).toBe(false);
    });

    it('настоящее перекрытие считается', () => {
      expect(overlaps(a, box3(vec3(50, 0, 0), vec3(100, 100, 100)))).toBe(true);
    });

    it('перекрытие тоньше допуска — след округления, а не пересечение', () => {
      // 0.04 мм меньше MM_EPSILON = 0.05: это шум округления, а не конструкция.
      expect(overlaps(a, box3(vec3(99.96, 0, 0), vec3(100, 100, 100)))).toBe(false);
      expect(overlaps(a, box3(vec3(99.9, 0, 0), vec3(100, 100, 100)))).toBe(true);
    });

    it('разъехавшиеся по одной оси тела не пересекаются, даже если совпадают по двум другим', () => {
      expect(overlaps(a, box3(vec3(50, 50, 200), vec3(100, 100, 100)))).toBe(false);
    });
  });
});
