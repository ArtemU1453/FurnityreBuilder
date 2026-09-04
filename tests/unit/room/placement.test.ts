import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  footprintGap,
  footprintOf,
  footprintsOverlap,
  furnitureExtent,
  instanceBox,
  instanceFootprint,
  isRectangular,
  normalizeRotation,
  obstacleBox,
  roomFootprint,
  snapRotationToQuarter,
  swapsAxes,
  wallBox,
} from '../../../src/room/index.js';
import { createRectangularRoom, createFurnitureInstance, createObstacle } from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { makeGeometryInput } from '../geometry/helpers.js';
import type { Vec3 } from '../../../src/domain/index.js';

/**
 * Размещение объектов (PROMPT 24 §11).
 *
 * Планировщик оперирует габаритами, а не конструкцией: ни одна функция
 * здесь не знает, из чего собран шкаф. Именно это и проверяется —
 * в том числе тем, что габарит приходит из уже посчитанной геометрии.
 */

const ids = () => createSequentialIdFactory('r');
const room = (width = 4000, depth = 3000) =>
  createRectangularRoom({ ids: ids(), width, depth, height: 2700, wallThickness: 100 });

const extent: Vec3 = { x: 1000, y: 2000, z: 500 };

describe('габарит изделия', () => {
  it('берётся из измеренного охвата движка, а не из заявленных W/H/D', () => {
    // Ручка и свес выступают за номинал, и шкаф, поставленный вплотную
    // по номиналу, упирался бы в стену тем, что за него выходит.
    const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
    expect(furnitureExtent(geometry)).toEqual({
      x: geometry.boundingBox.totalWidth,
      y: geometry.boundingBox.totalHeight,
      z: geometry.boundingBox.totalDepth,
    });
  });
});

describe('поворот', () => {
  it('приводится к диапазону 0…2π', () => {
    expect(normalizeRotation(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
    expect(normalizeRotation(Math.PI * 4)).toBeCloseTo(0, 9);
  });

  it('четыре поворота по 90° возвращают исходный угол', () => {
    let angle = 0;
    for (let i = 0; i < 4; i += 1) angle = normalizeRotation(angle + Math.PI / 2);
    expect(angle).toBeCloseTo(0, 9);
  });

  it('прижимается к прямому углу', () => {
    expect(snapRotationToQuarter(0.2)).toBeCloseTo(0, 9);
    expect(snapRotationToQuarter(1.4)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('прямой и развёрнутый углы по-разному меняют оси', () => {
    expect(swapsAxes(0)).toBe(false);
    expect(swapsAxes(Math.PI / 2)).toBe(true);
    expect(swapsAxes(Math.PI)).toBe(false);
    expect(swapsAxes((3 * Math.PI) / 2)).toBe(true);
  });
});

describe('след на плане', () => {
  const at: Vec3 = { x: 100, y: 0, z: 200 };

  it('без поворота совпадает с габаритом', () => {
    expect(footprintOf(at, extent, 0)).toEqual({ x: 100, z: 200, width: 1000, depth: 500 });
  });

  it('на 90° меняет ширину и глубину местами', () => {
    const print = footprintOf(at, extent, Math.PI / 2);
    expect(print.width).toBe(500);
    expect(print.depth).toBe(1000);
  });

  it('поворот происходит вокруг центра: иначе изделие уезжает из-под курсора', () => {
    const before = footprintOf(at, extent, 0);
    const after = footprintOf(at, extent, Math.PI / 2);
    expect(before.x + before.width / 2).toBeCloseTo(after.x + after.width / 2, 6);
    expect(before.z + before.depth / 2).toBeCloseTo(after.z + after.depth / 2, 6);
  });

  it('произвольный угол даёт ОПИСАННЫЙ прямоугольник, а не заниженный', () => {
    // Ошибаться безопасно можно только в сторону «нельзя»: ложный запрет
    // пользователь видит и обходит, пропущенное пересечение — нет.
    const print = footprintOf(at, extent, Math.PI / 4);
    expect(print.width).toBeGreaterThan(Math.max(extent.x, extent.z));
    expect(print.depth).toBeGreaterThan(Math.max(extent.x, extent.z));
  });

  it('след экземпляра считается по его собственному повороту', () => {
    const instance = createFurnitureInstance(ids(), { id: 'f-1' } as never, at, Math.PI / 2);
    expect(instanceFootprint(instance, extent).width).toBe(500);
  });
});

describe('объёмы', () => {
  it('объём экземпляра поднят на уровень пола', () => {
    const instance = createFurnitureInstance(ids(), { id: 'f-1' } as never, { x: 0, y: 0, z: 0 }, 0);
    expect(instanceBox(instance, extent, 150).min.y).toBe(150);
    expect(instanceBox(instance, extent, 150).size.y).toBe(extent.y);
  });

  it('стена откладывает толщину в обе стороны от средней линии', () => {
    const r = room();
    const wall = r.walls[0]!;
    const box = wallBox(wall, 0);
    expect(box.size.z).toBeCloseTo(wall.thickness, 6);
    expect(box.min.z).toBeCloseTo(wall.a.z - wall.thickness / 2, 6);
  });

  it('препятствие учитывает поворот так же, как мебель', () => {
    const obstacle = createObstacle(ids(), 'column', { x: 0, y: 0, z: 0 }, { x: 400, y: 2700, z: 200 }, Math.PI / 2);
    const box = obstacleBox(obstacle);
    expect(box.size.x).toBeCloseTo(200, 6);
    expect(box.size.z).toBeCloseTo(400, 6);
  });
});

describe('контур комнаты', () => {
  it('ширина и глубина выводятся из стен, а не хранятся', () => {
    const print = roomFootprint(room(4000, 3000));
    expect(print.width).toBe(4000);
    expect(print.depth).toBe(3000);
  });

  it('прямоугольная комната распознаётся', () => {
    expect(isRectangular(room())).toBe(true);
  });

  it('незамкнутый контур прямоугольным не считается', () => {
    const r = room();
    const broken = { ...r, walls: r.walls.slice(0, 3) };
    expect(isRectangular(broken)).toBe(false);
  });

  it('комната без стен даёт нулевой контур, а не NaN', () => {
    const r = room();
    expect(roomFootprint({ ...r, walls: [] })).toEqual({ x: 0, z: 0, width: 0, depth: 0 });
  });
});

describe('пересечения', () => {
  const a = { x: 0, z: 0, width: 1000, depth: 500 };

  it('касание пересечением не считается', () => {
    expect(footprintsOverlap(a, { x: 1000, z: 0, width: 500, depth: 500 })).toBe(false);
  });

  it('наложение обнаруживается', () => {
    expect(footprintsOverlap(a, { x: 900, z: 0, width: 500, depth: 500 })).toBe(true);
  });

  it('зазор равен нулю при касании и отрицателен при наложении', () => {
    expect(footprintGap(a, { x: 1000, z: 0, width: 500, depth: 500 })).toBe(0);
    expect(footprintGap(a, { x: 900, z: 0, width: 500, depth: 500 })).toBeLessThan(0);
    expect(footprintGap(a, { x: 1200, z: 0, width: 500, depth: 500 })).toBe(200);
  });

  it('объёмы, разнесённые по высоте, не пересекаются', () => {
    // Навесной шкаф над тумбой — законная и частая расстановка.
    const low = { min: { x: 0, y: 0, z: 0 }, size: { x: 1000, y: 800, z: 500 } };
    const high = { min: { x: 0, y: 1200, z: 0 }, size: { x: 1000, y: 700, z: 400 } };
    expect(boxesOverlap(low, high)).toBe(false);
  });
});
