/**
 * Система координат изделия.
 *
 * Полное описание с иллюстрациями — docs/COORDINATE_SYSTEM.md.
 * Здесь — исполняемая часть контракта.
 *
 *   origin  левый–нижний–задний угол габарита изделия
 *   +x      вправо, если смотреть на фасад   → ширина  W
 *   +y      вверх                            → высота  H
 *   +z      от задней стенки к пользователю  → глубина D
 *
 * Тройка правая. `position` детали — её минимальный угол (min-x, min-y, min-z),
 * никогда не центр. Экранная инверсия оси Y — задача слоя отрисовки; домен
 * про экран ничего не знает.
 */
import type { Mm } from './units.js';
import { eqMm, roundMm } from './units.js';

export type Axis = 'x' | 'y' | 'z';

/** Ось, вдоль которой делится секция. Глубина не делится. */
export type SplitAxis = Extract<Axis, 'x' | 'y'>;

export interface Vec3 {
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
}

/** Осепараллельный параллелепипед, заданный минимальным углом и габаритом. */
export interface Box3 {
  readonly min: Vec3;
  readonly size: Vec3;
}

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

export function vec3(x: Mm, y: Mm, z: Mm): Vec3 {
  return { x: roundMm(x), y: roundMm(y), z: roundMm(z) };
}

export function box3(min: Vec3, size: Vec3): Box3 {
  return { min, size };
}

/** Максимальный угол: min + size. */
export function boxMax(box: Box3): Vec3 {
  return vec3(box.min.x + box.size.x, box.min.y + box.size.y, box.min.z + box.size.z);
}

export function boxCenter(box: Box3): Vec3 {
  return vec3(
    box.min.x + box.size.x / 2,
    box.min.y + box.size.y / 2,
    box.min.z + box.size.z / 2,
  );
}

export function boxVolume(box: Box3): number {
  return box.size.x * box.size.y * box.size.z;
}

export function translate(box: Box3, delta: Vec3): Box3 {
  return box3(vec3(box.min.x + delta.x, box.min.y + delta.y, box.min.z + delta.z), box.size);
}

/** Объём пересечения. Ноль, если тела не перекрываются. */
export function intersectionVolume(a: Box3, b: Box3): number {
  const aMax = boxMax(a);
  const bMax = boxMax(b);
  const dx = Math.min(aMax.x, bMax.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(aMax.y, bMax.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(aMax.z, bMax.z) - Math.max(a.min.z, b.min.z);
  if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
  return dx * dy * dz;
}

/** Лежит ли `inner` целиком внутри `outer` с учётом допуска на размер. */
export function boxContains(outer: Box3, inner: Box3): boolean {
  const oMax = boxMax(outer);
  const iMax = boxMax(inner);
  const ge = (a: Mm, b: Mm): boolean => a > b || eqMm(a, b);
  return (
    ge(inner.min.x, outer.min.x) &&
    ge(inner.min.y, outer.min.y) &&
    ge(inner.min.z, outer.min.z) &&
    ge(oMax.x, iMax.x) &&
    ge(oMax.y, iMax.y) &&
    ge(oMax.z, iMax.z)
  );
}

export function axisValue(v: Vec3, axis: Axis): Mm {
  return v[axis];
}

/** Длина коробки вдоль оси. */
export function extentAlong(box: Box3, axis: Axis): Mm {
  return box.size[axis];
}

/**
 * Вырезает из коробки отрезок [offset, offset + length] вдоль оси.
 * Базовая операция раскладки дерева секций.
 */
export function sliceAlong(box: Box3, axis: Axis, offset: Mm, length: Mm): Box3 {
  const min = { ...box.min } as { x: Mm; y: Mm; z: Mm };
  const size = { ...box.size } as { x: Mm; y: Mm; z: Mm };
  min[axis] = roundMm(box.min[axis] + offset);
  size[axis] = roundMm(length);
  return box3(vec3(min.x, min.y, min.z), vec3(size.x, size.y, size.z));
}

/** Все ли компоненты конечны. Ловит NaN и Infinity до попадания в результат. */
export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteBox3(b: Box3): boolean {
  return isFiniteVec3(b.min) && isFiniteVec3(b.size);
}
