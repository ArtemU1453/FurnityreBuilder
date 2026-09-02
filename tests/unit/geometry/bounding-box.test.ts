import { describe, expect, it } from 'vitest';
import { computeBoundingBox, EMPTY_BOUNDING_BOX } from '../../../src/geometry/bounding-box.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { Part } from '../../../src/domain/index.js';
import { asId, vec3 } from '../../../src/domain/index.js';
import { makeGeometryInput } from './helpers.js';

function fakePart(position: { x: number; y: number; z: number }, size: { x: number; y: number; z: number }): Part {
  return {
    id: asId<'Part'>('part:test'),
    role: 'other',
    label: 'тест',
    position: vec3(position.x, position.y, position.z),
    size: vec3(size.x, size.y, size.z),
    orientation: 'horizontal-xz',
    cut: { length: size.x, width: size.z, thickness: size.y },
    materialId: asId<'Material'>('material:test'),
    edge: { front: 0, back: 0, left: 0, right: 0 },
    grainLocked: false,
    origin: { furnitureId: asId<'Furniture'>('furniture:test') },
    drilling: [],
    quantityGroupKey: 'test',
  };
}

describe('computeBoundingBox: пустой набор', () => {
  it('вырождается в точку в начале координат', () => {
    expect(computeBoundingBox([])).toEqual(EMPTY_BOUNDING_BOX);
  });
});

describe('computeBoundingBox: один прямоугольник', () => {
  it('охват совпадает с самой деталью', () => {
    const bb = computeBoundingBox([fakePart({ x: 10, y: 20, z: 30 }, { x: 100, y: 200, z: 50 })]);
    expect(bb).toEqual({
      minX: 10,
      maxX: 110,
      minY: 20,
      maxY: 220,
      minZ: 30,
      maxZ: 80,
      totalWidth: 100,
      totalHeight: 200,
      totalDepth: 50,
    });
  });
});

describe('computeBoundingBox: несколько деталей', () => {
  it('охватывает крайние точки всех деталей, а не первой/последней', () => {
    const parts = [
      fakePart({ x: 0, y: 0, z: 0 }, { x: 16, y: 2000, z: 500 }),
      fakePart({ x: 984, y: 0, z: 0 }, { x: 16, y: 2000, z: 500 }),
      // Деталь в середине не должна расширять bounding box — проверяет,
      // что берётся именно min/max, а не сумма или последнее значение.
      fakePart({ x: 200, y: 900, z: 100 }, { x: 50, y: 50, z: 50 }),
    ];
    expect(computeBoundingBox(parts)).toEqual({
      minX: 0,
      maxX: 1000,
      minY: 0,
      maxY: 2000,
      minZ: 0,
      maxZ: 500,
      totalWidth: 1000,
      totalHeight: 2000,
      totalDepth: 500,
    });
  });

  it('не путает min с максимальным по модулю значением при отрицательных координатах', () => {
    // Отрицательные координаты недопустимы в GeometryResult (проверяется
    // отдельным инвариантом), но computeBoundingBox — низкоуровневая функция
    // общего назначения и обязана быть корректной для любых чисел.
    const parts = [
      fakePart({ x: -50, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }),
      fakePart({ x: 100, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }),
    ];
    const bb = computeBoundingBox(parts);
    expect(bb.minX).toBe(-50);
    expect(bb.maxX).toBe(110);
    expect(bb.totalWidth).toBe(160);
  });
});

describe('computeBoundingBox: интеграция с buildGeometry', () => {
  it('для цельного корпуса совпадает с номинальным габаритом', () => {
    const result = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
    expect(result.boundingBox).toEqual({
      minX: 0,
      maxX: 1000,
      minY: 0,
      maxY: 2000,
      minZ: 3, // задняя стенка накладная и стоит перед корпусом, z0 = 3
      maxZ: 500,
      totalWidth: 1000,
      totalHeight: 2000,
      totalDepth: 497,
    });
  });

  it('для пустого результата (фатальная ошибка входа) вырождается в точку', () => {
    const result = buildGeometry(makeGeometryInput({ width: Number.NaN }));
    expect(result.boundingBox).toEqual(EMPTY_BOUNDING_BOX);
  });
});
