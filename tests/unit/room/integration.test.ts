import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createFurnitureInstance, createRectangularRoom } from '../../../src/domain/room/defaults.js';
import { findPlacement, furnitureExtent, roomFootprint, validateRoom } from '../../../src/room/index.js';
import type { ExtentLookup } from '../../../src/room/index.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { toJson, fromJson } from '../../../src/persistence/serialization.js';
import type { FurnitureId, Project, Room, Vec3 } from '../../../src/domain/index.js';

/**
 * Сквозной путь планировщика (PROMPT 24 §33):
 * создать комнату → добавить мебель → переместить → повернуть →
 * сохранить → загрузить.
 *
 * Проверяется главное свойство архитектуры: мебель НЕ копируется в
 * комнату. Изделие остаётся одно, экземпляров может быть сколько угодно,
 * и изменение изделия меняет их все сразу.
 */

const ids = createSequentialIdFactory('i');

const geometriesOf = (project: Project) => {
  const map = new Map<FurnitureId, ReturnType<typeof buildGeometry>>();
  for (const item of project.furniture) {
    map.set(
      item.id,
      buildGeometry({
        furniture: item,
        scheme: project.settings.construction,
        tolerances: project.settings.tolerances,
        materials: project.materials,
        edgeSizing: project.settings.edgeSizing,
      }),
    );
  }
  return map;
};

const extentsOf = (project: Project): ExtentLookup => {
  const map = new Map<string, Vec3>();
  for (const [id, geometry] of geometriesOf(project)) map.set(id, furnitureExtent(geometry));
  return map;
};

const scenario = () => {
  const s = createDocumentStore(
    createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' }),
  );
  s.getState().execute({
    type: 'SetRoom',
    room: createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700, wallThickness: 100 }),
  });
  return s;
};

const roomOf = (s: ReturnType<typeof scenario>): Room => s.getState().project.room!;

describe('создать → добавить → переместить → повернуть', () => {
  it('сквозной сценарий проходит и оставляет размещение корректным', () => {
    const s = scenario();
    const project = s.getState().project;
    const furniture = project.furniture[0]!;
    const extents = extentsOf(project);
    const extent = extents.get(furniture.id)!;

    const placement = findPlacement(roomOf(s), furniture.id, extent, extents);
    expect(placement.free).toBe(true);

    const instance = {
      ...createFurnitureInstance(ids, furniture, placement.position),
      rotation: placement.rotation,
    };
    s.getState().execute({ type: 'AddFurnitureInstance', instance }, 'Добавить');

    // Новая мебель не появляется внутри стен: это была настоящая ошибка,
    // найденная при первой проверке планировщика в браузере.
    expect(validateRoom(roomOf(s), { extents }).issues.filter((i) => i.severity === 'error')).toEqual([]);

    s.getState().execute(
      { type: 'TransformFurnitureInstance', instanceId: instance.id, position: { x: 1500, y: 0, z: 1200 } },
      'Переместить',
    );
    s.getState().execute(
      { type: 'TransformFurnitureInstance', instanceId: instance.id, rotation: Math.PI / 2 },
      'Повернуть',
    );

    const moved = roomOf(s).furnitureInstances[0]!;
    expect(moved.position).toEqual({ x: 1500, y: 0, z: 1200 });
    expect(moved.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(validateRoom(roomOf(s), { extents }).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('мебель за пределами комнаты помечается ошибкой, а не запрещается молча', () => {
    // Показать проблему честнее, чем тихо не пустить: пользователь видит
    // красное и понимает, почему так нельзя.
    const s = scenario();
    const project = s.getState().project;
    const extents = extentsOf(project);
    const instance = createFurnitureInstance(ids, project.furniture[0]!, { x: 9000, y: 0, z: 9000 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance });
    const errors = validateRoom(roomOf(s), { extents }).issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('комната ↔ изделие', () => {
  it('изменение изделия меняет все его экземпляры сразу', () => {
    // Копии нет, поэтому и синхронизировать нечего.
    const s = scenario();
    const furniture = s.getState().project.furniture[0]!;
    for (const x of [200, 2200]) {
      s.getState().execute({
        type: 'AddFurnitureInstance',
        instance: createFurnitureInstance(ids, furniture, { x, y: 0, z: 100 }),
      });
    }

    const before = extentsOf(s.getState().project).get(furniture.id)!;
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1600 });
    const after = extentsOf(s.getState().project).get(furniture.id)!;

    expect(before.x).toBe(1000);
    expect(after.x).toBe(1600);
    // Экземпляры не менялись — изменился их источник.
    expect(roomOf(s).furnitureInstances.every((i) => i.furnitureId === furniture.id)).toBe(true);
  });

  it('изменение изделия пересчитывает размещение', () => {
    const s = scenario();
    const furniture = s.getState().project.furniture[0]!;
    s.getState().execute({
      type: 'AddFurnitureInstance',
      instance: createFurnitureInstance(ids, furniture, { x: 50, y: 0, z: 50 }),
    });
    expect(validateRoom(roomOf(s), { extents: extentsOf(s.getState().project) }).status).not.toBe('INVALID');

    // Шкаф во всю комнату упрётся в противоположную стену.
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 4500 });
    expect(validateRoom(roomOf(s), { extents: extentsOf(s.getState().project) }).status).toBe('INVALID');
  });

  it('удаление изделия оставляет экземпляр видимой ошибкой, а не тихо чинит', () => {
    const s = scenario();
    const furniture = s.getState().project.furniture[0]!;
    s.getState().execute({
      type: 'AddFurnitureInstance',
      instance: createFurnitureInstance(ids, furniture, { x: 200, y: 0, z: 100 }),
    });
    // Изделия в словаре габаритов больше нет — как если бы его удалили.
    const result = validateRoom(roomOf(s), { extents: new Map() });
    expect(result.issues.map((i) => i.code)).toContain('ROOM_INSTANCE_FURNITURE_NOT_FOUND');
  });
});

describe('сохранение и загрузка', () => {
  it('комната и расстановка переживают круговой путь', () => {
    const s = scenario();
    const furniture = s.getState().project.furniture[0]!;
    s.getState().execute({
      type: 'AddFurnitureInstance',
      instance: {
        ...createFurnitureInstance(ids, furniture, { x: 700, y: 0, z: 400 }),
        rotation: Math.PI / 2,
        locked: true,
      },
    });
    s.getState().execute({ type: 'SetFloor', patch: { elevation: 120 } });
    s.getState().execute({ type: 'SetCeiling', patch: { visible: true } });

    const restored = fromJson(toJson(s.getState().project)).project;
    const room = restored.room!;

    expect(roomFootprint(room)).toMatchObject({ width: 4000, depth: 3000 });
    expect(room.ceilingHeight).toBe(2700);
    expect(room.floor.elevation).toBe(120);
    expect(room.ceiling.visible).toBe(true);
    expect(room.furnitureInstances).toHaveLength(1);
    expect(room.furnitureInstances[0]!.position).toEqual({ x: 700, y: 0, z: 400 });
    expect(room.furnitureInstances[0]!.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(room.furnitureInstances[0]!.locked).toBe(true);
    expect(room.furnitureInstances[0]!.furnitureId).toBe(furniture.id);
  });

  it('проект БЕЗ комнаты читается без изменений: старые файлы не ломаются', () => {
    // Поля комнаты добавлены с `.default()`, поэтому версия схемы не
    // менялась и миграция не нужна.
    const s = createDocumentStore(
      createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' }),
    );
    const restored = fromJson(toJson(s.getState().project)).project;
    expect(restored.room).toBeUndefined();
    expect(restored.furniture).toHaveLength(1);
  });

  it('старый файл со СТАРОЙ формой комнаты читается и получает пустые поля', () => {
    const s = scenario();
    const json = JSON.parse(toJson(s.getState().project)) as {
      project: { room: Record<string, unknown> };
    };
    // Форма комнаты до PROMPT 24: только стены и высота потолка.
    json.project.room = {
      walls: json.project.room['walls'],
      ceilingHeight: 2700,
    };
    const restored = fromJson(JSON.stringify(json)).project;
    expect(restored.room?.furnitureInstances).toEqual([]);
    expect(restored.room?.openings).toEqual([]);
    expect(restored.room?.floor.elevation).toBe(0);
    expect(restored.room?.ceiling.visible).toBe(false);
  });
});
