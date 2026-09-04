import { describe, expect, it } from 'vitest';
import { ROOM_CODES, extentKey, roomSize, statusOf, validateRoom } from '../../../src/room/index.js';
import type { ExtentLookup } from '../../../src/room/index.js';
import {
  createFurnitureInstance,
  createObstacle,
  createOpening,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { issue } from '../../../src/domain/index.js';
import type { Furniture, ProjectId, Room, Vec3 } from '../../../src/domain/index.js';

/**
 * Проверка помещения и статус (PROMPT 24 §19–§20).
 *
 * Статус повторяет уровни производственного (PROMPT 21) и выводится тем
 * же правилом: ошибка важнее неподтверждённого правила, неподтверждённое
 * правило важнее предупреждения.
 */

const ids = createSequentialIdFactory('v');
const EXTENT: Vec3 = { x: 1000, y: 2000, z: 600 };
const PROJECT = 'project:test' as ProjectId;
const extents: ExtentLookup = new Map([[extentKey(PROJECT, 'f-1'), EXTENT]]);
const furniture = (id: string): Furniture => ({ id } as unknown as Furniture);

const room = (): Room =>
  createRectangularRoom({ ids: createSequentialIdFactory('r'), width: 4000, depth: 3000, height: 2700, wallThickness: 100 });

const codesOf = (r: Room, lookup: ExtentLookup = extents) => validateRoom(r, { extents: lookup }).issues.map((i) => i.code);

describe('структура помещения', () => {
  it('корректная комната ошибок не даёт', () => {
    expect(validateRoom(room(), { extents }).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('комната без стен — ошибка', () => {
    expect(codesOf({ ...room(), walls: [] })).toContain(ROOM_CODES.noWalls);
  });

  it('нулевая высота потолка — ошибка', () => {
    expect(codesOf({ ...room(), ceilingHeight: 0 })).toContain(ROOM_CODES.ceilingHeight);
  });

  it('стена нулевой длины — ошибка', () => {
    const r = room();
    const broken = { ...r, walls: [{ ...r.walls[0]!, b: { ...r.walls[0]!.a } }, ...r.walls.slice(1)] };
    expect(codesOf(broken)).toContain(ROOM_CODES.wallDegenerate);
  });

  it('нулевая толщина стены — ошибка', () => {
    const r = room();
    const broken = { ...r, walls: [{ ...r.walls[0]!, thickness: 0 }, ...r.walls.slice(1)] };
    expect(codesOf(broken)).toContain(ROOM_CODES.wallThickness);
  });

  it('стена выше потолка — предупреждение, а не ошибка: подвесной потолок законен', () => {
    const r = room();
    const tall = { ...r, walls: [{ ...r.walls[0]!, height: 3200 }, ...r.walls.slice(1)] };
    const found = validateRoom(tall, { extents }).issues.find((i) => i.code === ROOM_CODES.wallTallerThanCeiling);
    expect(found?.severity).toBe('warning');
  });

  it('повторяющийся идентификатор — ошибка', () => {
    const r = room();
    const duplicated = { ...r, walls: [...r.walls, r.walls[0]!] };
    expect(codesOf(duplicated)).toContain(ROOM_CODES.duplicateId);
  });
});

describe('проёмы', () => {
  it('проём на несуществующей стене — ошибка', () => {
    const r = room();
    const opening = createOpening(ids, 'нет-такой' as never, 'door', 100, 900, 2100, 0);
    expect(codesOf({ ...r, openings: [opening] })).toContain(ROOM_CODES.openingWallMissing);
  });

  it('проём за пределами стены — ошибка', () => {
    const r = room();
    const opening = createOpening(ids, r.walls[0]!.id, 'door', 3800, 900, 2100, 0);
    expect(codesOf({ ...r, openings: [opening] })).toContain(ROOM_CODES.openingOutside);
  });

  it('проём выше стены — ошибка', () => {
    const r = room();
    const opening = createOpening(ids, r.walls[0]!.id, 'window', 500, 1200, 2000, 1000);
    expect(codesOf({ ...r, openings: [opening] })).toContain(ROOM_CODES.openingTooTall);
  });

  it('нормальный проём ошибок не даёт', () => {
    const r = room();
    const opening = createOpening(ids, r.walls[0]!.id, 'door', 500, 900, 2100, 0);
    expect(codesOf({ ...r, openings: [opening] })).not.toContain(ROOM_CODES.openingOutside);
  });
});

describe('препятствия', () => {
  it('нулевой размер — ошибка', () => {
    const obstacle = createObstacle(ids, 'column', { x: 100, y: 0, z: 100 }, { x: 0, y: 2700, z: 300 });
    expect(codesOf({ ...room(), obstacles: [obstacle] })).toContain(ROOM_CODES.obstacleSize);
  });
});

describe('экземпляры мебели', () => {
  it('ссылка на несуществующее изделие — ошибка, а не тихое удаление', () => {
    // Молча убрать экземпляр нельзя: пользователь потеряет расстановку,
    // не поняв почему.
    const instance = createFurnitureInstance(ids, PROJECT, furniture('нет-такого'), { x: 500, y: 0, z: 500 });
    expect(codesOf({ ...room(), furnitureInstances: [instance] })).toContain(ROOM_CODES.instanceFurnitureMissing);
  });

  it('изделие выше потолка — ошибка', () => {
    const tall: ExtentLookup = new Map([[extentKey(PROJECT, 'f-1'), { x: 1000, y: 2900, z: 600 }]]);
    const instance = createFurnitureInstance(ids, PROJECT, furniture('f-1'), { x: 500, y: 0, z: 500 });
    expect(codesOf({ ...room(), furnitureInstances: [instance] }, tall)).toContain(ROOM_CODES.instanceTooTall);
  });

  it('удалённый проект — отдельная ошибка, а не «нет такого изделия» (PROMPT 25 §12)', () => {
    // Разные события и разные действия: одно чинится внутри проекта,
    // другое — возвращением проекта в библиотеку.
    const orphan = createFurnitureInstance(ids, 'project:удалён' as never, furniture('f-1'), {
      x: 500,
      y: 0,
      z: 500,
    });
    const codes = codesOf({ ...room(), furnitureInstances: [orphan] });
    expect(codes).toContain(ROOM_CODES.instanceProjectMissing);
    expect(codes).not.toContain(ROOM_CODES.instanceFurnitureMissing);
  });

  it('экземпляры разных проектов не путаются по совпадающему furnitureId', () => {
    // Ключ габарита — пара «проект + изделие», поэтому одинаковый
    // внутренний id в двух проектах ничему не мешает.
    const mine = createFurnitureInstance(ids, PROJECT, furniture('f-1'), { x: 500, y: 0, z: 500 });
    const theirs = createFurnitureInstance(ids, 'project:другой' as never, furniture('f-1'), {
      x: 2000,
      y: 0,
      z: 500,
    });
    const codes = codesOf({ ...room(), furnitureInstances: [mine, theirs] });
    expect(codes.filter((code) => code === ROOM_CODES.instanceProjectMissing)).toHaveLength(1);
  });

  it('уровень пола учитывается при проверке высоты', () => {
    // Подиум поднимает мебель: шкаф, помещавшийся на полу, на подиуме
    // может упереться в потолок.
    const r = room();
    const podium = { ...r, floor: { elevation: 800 } };
    const instance = createFurnitureInstance(ids, PROJECT, furniture('f-1'), { x: 500, y: 0, z: 500 });
    expect(codesOf({ ...podium, furnitureInstances: [instance] })).toContain(ROOM_CODES.instanceTooTall);
  });
});

describe('статус помещения', () => {
  it('без правил зазоров статус — NEEDS_CONFIRMATION', () => {
    const instance = createFurnitureInstance(ids, PROJECT, furniture('f-1'), { x: 500, y: 0, z: 500 });
    expect(validateRoom({ ...room(), furnitureInstances: [instance] }, { extents }).status).toBe('NEEDS_CONFIRMATION');
  });

  it('ошибка перевешивает всё', () => {
    expect(statusOf([issue('X', 'error', 'x')], true)).toBe('INVALID');
    expect(statusOf([issue('X', 'error', 'x')], false)).toBe('INVALID');
  });

  it('неподтверждённые правила важнее предупреждения', () => {
    expect(statusOf([issue('X', 'warning', 'x')], false)).toBe('NEEDS_CONFIRMATION');
    expect(statusOf([issue('X', 'warning', 'x')], true)).toBe('WARNING');
  });

  it('чистая проверка с известными правилами — VALID', () => {
    expect(statusOf([], true)).toBe('VALID');
    expect(statusOf([issue('X', 'info', 'x')], true)).toBe('VALID');
  });

  it('пустая комната без мебели не требует подтверждений', () => {
    expect(validateRoom(room(), { extents }).status).toBe('VALID');
  });
});

describe('габарит комнаты', () => {
  it('выводится из стен, а не хранится', () => {
    expect(roomSize(room())).toEqual({ width: 4000, depth: 3000, height: 2700 });
  });
});
