import type { Mm, Part } from '../domain/index.js';
import { roundMm } from '../domain/index.js';

/**
 * Общий bounding box результата — фактические границы того, что реально
 * построено, а не номинальный габарит изделия.
 *
 * Отличие от `GeometryResult.bounds`: `bounds` — это ЗАЯВЛЕННЫЙ габарит
 * корпуса (то, что должно получиться по W/H/D), доступный уже на этапе
 * `carcass`. `boundingBox` — это ИЗМЕРЕННЫЙ охват всех реально построенных
 * деталей. Для одного корпуса без выступающих элементов они совпадают;
 * когда появятся столешница со свесом или фурнитура, выступающая за
 * номинальный габарит (этапы 22–23 плана), `boundingBox` покажет это,
 * а `bounds` — нет. Нужен планировщику и рендереру (этапы 07, 33), поэтому
 * вычисляется уже сейчас.
 */
export interface BoundingBox {
  readonly minX: Mm;
  readonly maxX: Mm;
  readonly minY: Mm;
  readonly maxY: Mm;
  readonly minZ: Mm;
  readonly maxZ: Mm;
  readonly totalWidth: Mm;
  readonly totalHeight: Mm;
  readonly totalDepth: Mm;
}

/** Bounding box пустого набора деталей: вырожденная точка в начале координат. */
export const EMPTY_BOUNDING_BOX: BoundingBox = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
  totalWidth: 0,
  totalHeight: 0,
  totalDepth: 0,
};

/**
 * Вычисляет охват набора деталей. Чистая функция: не знает о `Furniture`,
 * только о положении и размере уже посчитанных деталей.
 */
export function computeBoundingBox(parts: readonly Part[]): BoundingBox {
  if (parts.length === 0) return EMPTY_BOUNDING_BOX;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const part of parts) {
    minX = Math.min(minX, part.position.x);
    minY = Math.min(minY, part.position.y);
    minZ = Math.min(minZ, part.position.z);
    maxX = Math.max(maxX, part.position.x + part.size.x);
    maxY = Math.max(maxY, part.position.y + part.size.y);
    maxZ = Math.max(maxZ, part.position.z + part.size.z);
  }

  return {
    minX: roundMm(minX),
    maxX: roundMm(maxX),
    minY: roundMm(minY),
    maxY: roundMm(maxY),
    minZ: roundMm(minZ),
    maxZ: roundMm(maxZ),
    totalWidth: roundMm(maxX - minX),
    totalHeight: roundMm(maxY - minY),
    totalDepth: roundMm(maxZ - minZ),
  };
}
