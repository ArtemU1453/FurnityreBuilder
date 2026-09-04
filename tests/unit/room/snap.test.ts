import { describe, expect, it } from 'vitest';
import { applySnap, instanceFootprint, roomFootprint, snapCandidates } from '../../../src/room/index.js';
import { createRectangularRoom } from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Vec3 } from '../../../src/domain/index.js';

/**
 * Привязка к стенам и углам (PROMPT 24 §15–§16).
 *
 * Проверяется главное: каждая позиция выводится из фактической геометрии
 * комнаты. Ни одного числа «обычно ставят на столько-то» в ожиданиях
 * тоже нет — они считаются из толщины стены и габарита изделия.
 */

const room = (width = 4000, depth = 3000, thickness = 100) =>
  createRectangularRoom({ ids: createSequentialIdFactory('r'), width, depth, height: 2700, wallThickness: thickness });

const extent: Vec3 = { x: 1000, y: 2000, z: 600 };
const box = (position: Vec3, rotation = 0) =>
  instanceFootprint({ id: 'i' as never, projectId: 'p' as never, furnitureId: 'f' as never, position, rotation, locked: false, visible: true }, extent);

describe('кандидаты привязки', () => {
  const r = room();

  it('на каждую осевую стену есть кандидат', () => {
    const candidates = snapCandidates(r, extent, { x: 1000, y: 0, z: 1000 });
    const walls = new Set(candidates.filter((c) => c.kind === 'wall').map((c) => c.wallId));
    expect(walls.size).toBe(4);
  });

  it('углы предлагаются и помечены отдельно', () => {
    const corners = snapCandidates(r, extent, { x: 100, y: 0, z: 100 }).filter((c) => c.kind === 'corner');
    expect(corners.length).toBeGreaterThan(0);
    for (const corner of corners) expect(corner.secondWallId).toBeDefined();
  });

  it('наклонная стена кандидата не даёт: «примерно вдоль» — это не привязка', () => {
    const skewed = { ...r, walls: [{ ...r.walls[0]!, b: { x: 4000, z: 700 } }] };
    expect(snapCandidates(skewed, extent, { x: 0, y: 0, z: 0 })).toEqual([]);
  });
});

describe('привязка к стене', () => {
  const r = room();
  const inner = r.walls[0]!.thickness / 2;

  it('прижимает изделие вплотную к внутренней грани задней стены', () => {
    const result = applySnap(r, extent, { x: 1500, y: 0, z: 90 }, 0, 200);
    expect(result.snapped?.kind).toBe('wall');
    expect(box(result.position, result.rotation).z).toBeCloseTo(inner, 3);
  });

  it('разворачивает изделие спиной к стене', () => {
    // У правой стены изделие обязано встать боком к оси X.
    const print = roomFootprint(r);
    const result = applySnap(r, extent, { x: print.width - 700, y: 0, z: 1000 }, 0, 300);
    expect(result.snapped).toBeDefined();
    expect(Math.abs(Math.cos(result.rotation))).toBeLessThan(0.01);
  });

  it('не срабатывает за пределами радиуса', () => {
    const result = applySnap(r, extent, { x: 1500, y: 0, z: 1400 }, 0, 100);
    expect(result.snapped).toBeUndefined();
    expect(result.position).toEqual({ x: 1500, y: 0, z: 1400 });
  });

  it('нулевой радиус отключает привязку', () => {
    expect(applySnap(r, extent, { x: 0, y: 0, z: 0 }, 0, 0).snapped).toBeUndefined();
  });

  it('привязанное изделие не заходит в стену', () => {
    const result = applySnap(r, extent, { x: 1500, y: 0, z: 20 }, 0, 400);
    expect(box(result.position, result.rotation).z).toBeGreaterThanOrEqual(inner - 0.5);
  });
});

describe('привязка в угол', () => {
  const r = room();
  const inner = r.walls[0]!.thickness / 2;

  it('угол побеждает стену при равном расстоянии', () => {
    const result = applySnap(r, extent, { x: inner, y: 0, z: inner }, 0, 500);
    expect(result.snapped?.kind).toBe('corner');
  });

  it('в углу изделие касается обеих стен', () => {
    const result = applySnap(r, extent, { x: 60, y: 0, z: 60 }, 0, 600);
    const print = box(result.position, result.rotation);
    expect(Math.min(print.x, print.z)).toBeCloseTo(inner, 1);
  });

  it('в дальнем углу изделие тоже помещается внутри комнаты', () => {
    const size = roomFootprint(r);
    const result = applySnap(r, extent, { x: size.width - 900, y: 0, z: size.depth - 900 }, 0, 900);
    const print = box(result.position, result.rotation);
    expect(print.x + print.width).toBeLessThanOrEqual(size.width - inner + 0.5);
    expect(print.z + print.depth).toBeLessThanOrEqual(size.depth - inner + 0.5);
  });
});

describe('привязка не зависит от масштаба модели', () => {
  it('в комнате с другой толщиной стен позиция считается от неё же', () => {
    const thin = room(4000, 3000, 60);
    const thick = room(4000, 3000, 240);
    const a = applySnap(thin, extent, { x: 1500, y: 0, z: 100 }, 0, 400);
    const b = applySnap(thick, extent, { x: 1500, y: 0, z: 100 }, 0, 400);
    expect(box(a.position).z).toBeCloseTo(30, 3);
    expect(box(b.position).z).toBeCloseTo(120, 3);
  });
});
