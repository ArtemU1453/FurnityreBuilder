import { describe, expect, it } from 'vitest';
import { ROOM_PREFIX, buildRoomScene, instanceIdOf } from '../../../src/scene/room-scene.js';
import {
  createFurnitureInstance,
  createObstacle,
  createOpening,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { extentKey } from '../../../src/room/index.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { makeGeometryInput } from '../geometry/helpers.js';
import type { Room } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/index.js';

/**
 * Сцена помещения (PROMPT 24 §21–§22).
 *
 * Второго рендерера нет: комната собирается в ту же `SceneModel`, что и
 * мебель. Здесь проверяется именно это — что стены, пол и мебель
 * оказываются обычными объектами сцены с корректными координатами.
 */

const ids = createSequentialIdFactory('s');
const input = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
const geometry: GeometryResult = buildGeometry(input);
const FURNITURE_ID = input.furniture.id;
const PROJECT_ID = 'project:test';
const geometries = new Map<string, GeometryResult>([[extentKey(PROJECT_ID, FURNITURE_ID), geometry]]);

const room = (): Room =>
  createRectangularRoom({ ids: createSequentialIdFactory('r'), width: 4000, depth: 3000, height: 2700, wallThickness: 100 });

const scene = (r: Room, cutaway = true) =>
  buildRoomScene(r, { geometries, materials: input.materials, cutawayWalls: cutaway });

describe('оболочка помещения', () => {
  it('каждая стена становится объектом сцены со своей толщиной', () => {
    const r = room();
    const objects = scene(r).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.wall));
    expect(objects).toHaveLength(4);
    for (const object of objects) {
      expect(Math.min(object.size.x, object.size.z)).toBeCloseTo(100, 6);
      expect(object.size.y).toBe(2700);
    }
  });

  it('пол лежит ниже нулевой отметки и не мешает мебели', () => {
    const floor = scene(room()).objects.find((o) => o.id === ROOM_PREFIX.floor)!;
    expect(floor.position.y).toBeLessThan(0);
  });

  it('потолок по умолчанию скрыт: иначе он закрывает вид сверху', () => {
    expect(scene(room()).objects.find((o) => o.id === ROOM_PREFIX.ceiling)).toBeUndefined();
    const visible = scene({ ...room(), ceiling: { visible: true } });
    expect(visible.objects.find((o) => o.id === ROOM_PREFIX.ceiling)).toBeDefined();
  });

  it('режим прозрачных стен меняет только показ, но не модель', () => {
    const opaque = scene(room(), false).objects.find((o) => o.id.startsWith(ROOM_PREFIX.wall))!;
    const cutaway = scene(room(), true).objects.find((o) => o.id.startsWith(ROOM_PREFIX.wall))!;
    expect(opaque.material?.opacity).toBe(1);
    expect(cutaway.material?.opacity).toBeLessThan(1);
    expect(opaque.size).toEqual(cutaway.size);
  });

  it('комната без стен даёт пустую сцену, а не NaN', () => {
    const empty = scene({ ...room(), walls: [] });
    expect(empty.objects).toEqual([]);
    expect(Number.isFinite(empty.radius)).toBe(true);
  });
});

describe('проёмы и препятствия', () => {
  it('проём показан вставкой в толще стены и привязан к ней', () => {
    const r = room();
    const opening = createOpening(ids, r.walls[0]!.id, 'window', 500, 1200, 1400, 800);
    const object = scene({ ...r, openings: [opening] }).objects.find((o) => o.id.startsWith(ROOM_PREFIX.opening))!;
    expect(object.parentId).toBe(`${ROOM_PREFIX.wall}${r.walls[0]!.id}`);
    // Низ проёма на высоте подоконника от пола.
    expect(object.position.y - object.size.y / 2).toBeCloseTo(800, 6);
    expect(object.size.x).toBeCloseTo(1200, 6);
  });

  it('препятствие попадает на сцену со своим поворотом', () => {
    const obstacle = createObstacle(ids, 'column', { x: 500, y: 0, z: 500 }, { x: 400, y: 2700, z: 200 }, Math.PI / 2);
    const object = scene({ ...room(), obstacles: [obstacle] }).objects.find((o) =>
      o.id.startsWith(ROOM_PREFIX.obstacle),
    )!;
    expect(object.size.x).toBeCloseTo(200, 6);
    expect(object.size.z).toBeCloseTo(400, 6);
    expect(object.label).toBe('Колонна');
  });
});

describe('мебель в комнате', () => {
  const withInstance = (x = 500, z = 500, rotation = 0): Room => {
    const r = room();
    return {
      ...r,
      furnitureInstances: [
        createFurnitureInstance(ids, PROJECT_ID as never, { id: FURNITURE_ID } as never, { x, y: 0, z }, rotation),
      ],
    };
  };

  it('детали изделия переносятся в координаты комнаты', () => {
    const objects = scene(withInstance()).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));
    expect(objects.length).toBe(geometry.parts.length);
    for (const object of objects) {
      expect(object.position.x).toBeGreaterThan(400);
      expect(object.position.x).toBeLessThan(1600);
    }
  });

  it('идентификатор объекта позволяет узнать экземпляр', () => {
    const r = withInstance();
    const instanceId = r.furnitureInstances[0]!.id;
    const object = scene(r).objects.find((o) => o.id.startsWith(ROOM_PREFIX.instance))!;
    expect(instanceIdOf(object.id)).toBe(instanceId);
    expect(instanceIdOf('room:wall:w-1')).toBeUndefined();
  });

  it('поворот на 90° меняет след изделия местами по осям', () => {
    const straight = scene(withInstance(500, 500, 0)).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));
    const turned = scene(withInstance(500, 500, Math.PI / 2)).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));

    const span = (objects: typeof straight, axis: 'x' | 'z') => {
      const min = Math.min(...objects.map((o) => o.position[axis] - o.size[axis] / 2));
      const max = Math.max(...objects.map((o) => o.position[axis] + o.size[axis] / 2));
      return max - min;
    };
    expect(span(straight, 'x')).toBeCloseTo(span(turned, 'z'), 3);
    expect(span(straight, 'z')).toBeCloseTo(span(turned, 'x'), 3);
  });

  it('скрытый экземпляр не рисуется', () => {
    const r = withInstance();
    const hidden = { ...r, furnitureInstances: [{ ...r.furnitureInstances[0]!, visible: false }] };
    const objects = scene(hidden).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));
    expect(objects.every((o) => !o.visible)).toBe(true);
  });

  it('ячейки и секции изделия в комнату не переносятся', () => {
    // В планировщике выбирают мебель целиком, а не полку внутри неё.
    const objects = scene(withInstance()).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));
    expect(objects.every((o) => o.kind === 'part')).toBe(true);
  });

  it('экземпляр без построенного изделия не рисуется примерной коробкой', () => {
    const r = room();
    const orphan = {
      ...r,
      furnitureInstances: [createFurnitureInstance(ids, PROJECT_ID as never, { id: 'нет-такого' } as never, { x: 0, y: 0, z: 0 })],
    };
    expect(scene(orphan).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance))).toEqual([]);
  });

  it('один и тот же шкаф трижды даёт втрое больше объектов и уникальные id', () => {
    const r = room();
    const three = {
      ...r,
      furnitureInstances: [
        createFurnitureInstance(ids, PROJECT_ID as never, { id: FURNITURE_ID } as never, { x: 200, y: 0, z: 200 }),
        createFurnitureInstance(ids, PROJECT_ID as never, { id: FURNITURE_ID } as never, { x: 1500, y: 0, z: 200 }),
        createFurnitureInstance(ids, PROJECT_ID as never, { id: FURNITURE_ID } as never, { x: 2800, y: 0, z: 200 }),
      ],
    };
    const objects = scene(three).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance));
    expect(objects).toHaveLength(geometry.parts.length * 3);
    expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
  });

  it('уровень пола поднимает мебель вместе с собой', () => {
    const r = withInstance();
    const podium = { ...r, floor: { elevation: 300 } };
    const low = Math.min(
      ...scene(r).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance)).map((o) => o.position.y),
    );
    const high = Math.min(
      ...scene(podium).objects.filter((o) => o.id.startsWith(ROOM_PREFIX.instance)).map((o) => o.position.y),
    );
    expect(high - low).toBeCloseTo(300, 6);
  });
});

describe('детерминизм и порядок', () => {
  it('одинаковая комната даёт одинаковую сцену', () => {
    const r = room();
    expect(scene(r).objects.map((o) => o.id)).toEqual(scene(r).objects.map((o) => o.id));
  });

  it('непрозрачное рисуется раньше прозрачного', () => {
    const opacities = scene(room()).objects.map((o) => o.material?.opacity ?? 1);
    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i]!).toBeLessThanOrEqual(opacities[i - 1]!);
    }
  });

  it('идентификаторы объектов сцены уникальны', () => {
    const r = room();
    const opening = createOpening(ids, r.walls[0]!.id, 'door', 500, 900, 2100, 0);
    const obstacle = createObstacle(ids, 'pipe', { x: 3000, y: 0, z: 2500 }, { x: 100, y: 2700, z: 100 });
    const full = {
      ...r,
      openings: [opening],
      obstacles: [obstacle],
      furnitureInstances: [createFurnitureInstance(ids, PROJECT_ID as never, { id: FURNITURE_ID } as never, { x: 500, y: 0, z: 500 })],
    };
    const idList = scene(full).objects.map((o) => o.id);
    expect(new Set(idList).size).toBe(idList.length);
  });
});
