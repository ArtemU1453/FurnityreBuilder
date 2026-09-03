import { describe, expect, it } from 'vitest';
import { faceFrame, formatDirection, holeBottom, localFrame, toLocal, toWorld } from '../../../src/drilling/index.js';
import type { DrillFace, Part } from '../../../src/domain/index.js';
import { geometryOf, makeProject, partOfRole } from './helpers.js';

/**
 * Локальная система детали и переход в мировую (PROMPT 18 §29, Coordinates).
 *
 * Самая дорогая ошибка присадки — зеркальная деталь: отверстие, посчитанное
 * не с той стороны, обнаруживается только после сверления. Поэтому переход
 * проверяется на всех трёх ориентациях и на всех шести гранях, а не на
 * одном удобном примере.
 */

const geometry = geometryOf(makeProject());
const side = partOfRole(geometry, 'side');
const top = partOfRole(geometry, 'top');
const back = partOfRole(geometry, 'back');

const ALL_FACES: readonly DrillFace[] = ['top', 'bottom', 'left', 'right', 'front', 'back'];

describe('Test 1 (§5): локальные измерения читаются из ориентации детали', () => {
  it('боковина: длина по высоте, ширина по глубине, толщина по ширине изделия', () => {
    const frame = localFrame(side);
    expect(frame).toMatchObject({ lengthAxis: 'y', widthAxis: 'z', thicknessAxis: 'x' });
    expect(frame.thickness).toBe(16);
  });

  it('крышка: длина по ширине изделия, толщина по высоте', () => {
    expect(localFrame(top)).toMatchObject({ lengthAxis: 'x', widthAxis: 'z', thicknessAxis: 'y' });
  });

  it('задняя стенка: длина по высоте, ширина по ширине изделия, толщина по глубине', () => {
    const frame = localFrame(back);
    expect(frame).toMatchObject({ lengthAxis: 'y', widthAxis: 'x', thicknessAxis: 'z' });
    expect(frame.thickness).toBe(3);
  });
});

describe('Test 2 (§5): грани и направление сверления', () => {
  it('пласти дают размер «длина × ширина», торцы — с толщиной', () => {
    const frame = localFrame(side);
    expect(faceFrame(side, 'top')).toMatchObject({ extentX: frame.length, extentY: frame.width, available: frame.thickness });
    expect(faceFrame(side, 'left')).toMatchObject({ extentX: frame.width, extentY: frame.thickness, available: frame.length });
    expect(faceFrame(side, 'front')).toMatchObject({ extentX: frame.length, extentY: frame.thickness, available: frame.width });
  });

  it('сверление всегда идёт внутрь детали', () => {
    expect(formatDirection(faceFrame(side, 'top').direction)).toBe('−x');
    expect(formatDirection(faceFrame(side, 'bottom').direction)).toBe('+x');
    expect(formatDirection(faceFrame(top, 'top').direction)).toBe('−y');
    expect(formatDirection(faceFrame(back, 'bottom').direction)).toBe('+z');
  });

  it('противоположные грани дают противоположные направления', () => {
    for (const [a, b] of [['top', 'bottom'], ['left', 'right'], ['front', 'back']] as const) {
      const first = faceFrame(side, a).direction;
      const second = faceFrame(side, b).direction;
      expect(first.axis).toBe(second.axis);
      expect(first.sign).toBe(-second.sign);
    }
  });
});

describe('Test 3 (§16): переход в мировые координаты', () => {
  it('начало грани bottom совпадает с минимальным углом детали', () => {
    expect(toWorld(side, 'bottom', 0, 0).point).toEqual(side.position);
  });

  it('пласть top отстоит от bottom ровно на толщину', () => {
    const bottom = toWorld(side, 'bottom', 100, 50).point;
    const above = toWorld(side, 'top', 100, 50).point;
    expect(above.x - bottom.x).toBe(localFrame(side).thickness);
    expect(above.y).toBe(bottom.y);
    expect(above.z).toBe(bottom.z);
  });

  it('координаты грани идут вдоль своих мировых осей', () => {
    const point = toWorld(side, 'bottom', 300, 120).point;
    expect(point.y).toBe(side.position.y + 300);
    expect(point.z).toBe(side.position.z + 120);
  });

  it('дно глухого отверстия уходит внутрь детали на глубину', () => {
    const hole = toWorld(side, 'top', 100, 50);
    expect(holeBottom(hole, 10).x).toBe(hole.point.x - 10);
  });
});

describe('Test 4 (§16): обратный переход', () => {
  it('мир → грань → мир возвращает ту же точку на всех гранях', () => {
    for (const part of [side, top, back]) {
      for (const face of ALL_FACES) {
        const there = toWorld(part, face, 30, 5);
        const backAgain = toLocal(part, face, there.point);
        expect(backAgain.x).toBeCloseTo(30, 6);
        expect(backAgain.y).toBeCloseTo(5, 6);
      }
    }
  });
});

describe('Test 5 (§4, §16): отверстие переезжает вместе с деталью', () => {
  const wider = geometryOf(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: 1400 } })));
  const movedSide = wider.parts.filter((p) => p.role === 'side')[1]!;
  const originalSide = geometry.parts.filter((p) => p.role === 'side')[1]!;

  it('локальные координаты не изменились, а мировые сдвинулись', () => {
    const before = toWorld(originalSide, 'bottom', 200, 100).point;
    const after = toWorld(movedSide, 'bottom', 200, 100).point;
    // Правая боковина уехала вместе с шириной изделия: локальная
    // координата отверстия та же, мировая — другая. Ровно поэтому
    // источником истины выбраны локальные координаты (§16).
    expect(after.x).not.toBe(before.x);
    expect(after.x - movedSide.position.x).toBe(before.x - originalSide.position.x);
  });

  it('изменение высоты не меняет локальные координаты, но меняет размер грани', () => {
    const taller = geometryOf(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, height: 2400 } })));
    const tallSide = taller.parts.find((p) => p.role === 'side')!;
    expect(faceFrame(tallSide, 'bottom').extentX).toBeGreaterThan(faceFrame(side, 'bottom').extentX);
    expect(toWorld(tallSide, 'bottom', 200, 100).point.y - tallSide.position.y).toBe(200);
  });
});

describe('Test 6: деталь-заглушка с нулевой позицией не ломает переход', () => {
  it('нулевые координаты и размеры дают конечные значения', () => {
    const flat = { ...side, position: { x: 0, y: 0, z: 0 } } as Part;
    const point = toWorld(flat, 'front', 10, 5).point;
    expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
  });
});
