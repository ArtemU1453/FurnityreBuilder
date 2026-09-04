import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createFurnitureInstance,
  createObstacle,
  createOpening,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { roomFootprint } from '../../../src/room/index.js';
import type { Room } from '../../../src/domain/index.js';

/**
 * Команды планировщика (PROMPT 24 §12, §29).
 *
 * Отдельной системы отмены для комнаты нет: команды идут через тот же
 * `applyCommand`, и история хранит патчи, не зная, что именно изменилось.
 * Поэтому здесь проверяется не «работает ли undo», а то, что команды
 * ведут себя как команды: не создают битых ссылок и не молчат об отказе.
 */

const ids = createSequentialIdFactory('t');
const store = () => {
  const s = createDocumentStore(createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' }));
  const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700, wallThickness: 100 });
  s.getState().execute({ type: 'SetRoom', room }, 'Создать помещение');
  return s;
};
const roomOf = (s: ReturnType<typeof store>): Room => s.getState().project.room!;
const furnitureId = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.id;

describe('создание и габарит', () => {
  it('SetRoom добавляет комнату в проект', () => {
    expect(roomOf(store()).walls).toHaveLength(4);
  });

  it('SetRoom с undefined убирает комнату', () => {
    const s = store();
    s.getState().execute({ type: 'SetRoom', room: undefined });
    expect(s.getState().project.room).toBeUndefined();
  });

  it('SetRoomSize перестраивает прямоугольник', () => {
    const s = store();
    s.getState().execute({ type: 'SetRoomSize', width: 5000, depth: 3500, height: 2500 });
    expect(roomFootprint(roomOf(s))).toMatchObject({ width: 5000, depth: 3500 });
    expect(roomOf(s).ceilingHeight).toBe(2500);
  });

  it('идентификаторы стен переживают изменение габарита', () => {
    // Иначе проём, привязанный к стене, терял бы ссылку при каждом
    // изменении ширины комнаты.
    const s = store();
    const before = roomOf(s).walls.map((w) => w.id);
    s.getState().execute({ type: 'SetRoomSize', width: 5000, depth: 3500, height: 2700 });
    expect(roomOf(s).walls.map((w) => w.id)).toEqual(before);
  });

  it('отрицательный габарит команда не принимает', () => {
    const s = store();
    s.getState().execute({ type: 'SetRoomSize', width: -100, depth: 3000, height: 2700 });
    expect(roomFootprint(roomOf(s)).width).toBe(4000);
  });

  it('непрямоугольную комнату команда не трогает', () => {
    // «Ширина» произвольного контура не определена, и превратить его в
    // прямоугольник значило бы уничтожить ниши и выступы.
    const s = store();
    const room = roomOf(s);
    s.getState().execute({ type: 'SetRoom', room: { ...room, walls: room.walls.slice(0, 3) } });
    s.getState().execute({ type: 'SetRoomSize', width: 9000, depth: 9000, height: 2700 });
    expect(roomFootprint(roomOf(s)).width).toBe(4000);
  });
});

describe('пол, потолок, стены', () => {
  it('уровень пола меняется', () => {
    const s = store();
    s.getState().execute({ type: 'SetFloor', patch: { elevation: 150 } });
    expect(roomOf(s).floor.elevation).toBe(150);
  });

  it('видимость потолка переключается', () => {
    const s = store();
    s.getState().execute({ type: 'SetCeiling', patch: { visible: true } });
    expect(roomOf(s).ceiling.visible).toBe(true);
  });

  it('толщина стены меняется, нулевая — нет', () => {
    const s = store();
    const wallId = roomOf(s).walls[0]!.id;
    s.getState().execute({ type: 'UpdateWall', wallId, patch: { thickness: 250 } });
    expect(roomOf(s).walls[0]!.thickness).toBe(250);
    s.getState().execute({ type: 'UpdateWall', wallId, patch: { thickness: 0 } });
    expect(roomOf(s).walls[0]!.thickness).toBe(250);
  });
});

describe('проёмы и препятствия', () => {
  it('проём добавляется и удаляется', () => {
    const s = store();
    const opening = createOpening(ids, roomOf(s).walls[0]!.id, 'door', 500, 900, 2100, 0);
    s.getState().execute({ type: 'AddOpening', opening });
    expect(roomOf(s).openings).toHaveLength(1);
    s.getState().execute({ type: 'RemoveOpening', openingId: opening.id });
    expect(roomOf(s).openings).toHaveLength(0);
  });

  it('проём на несуществующей стене команда не создаёт', () => {
    // Иначе команда сама порождала бы ошибку, которую потом ловит проверка.
    const s = store();
    const opening = createOpening(ids, 'нет-такой' as never, 'door', 500, 900, 2100, 0);
    s.getState().execute({ type: 'AddOpening', opening });
    expect(roomOf(s).openings).toHaveLength(0);
  });

  it('препятствие добавляется, правится и удаляется', () => {
    const s = store();
    const obstacle = createObstacle(ids, 'column', { x: 500, y: 0, z: 500 }, { x: 300, y: 2700, z: 300 });
    s.getState().execute({ type: 'AddObstacle', obstacle });
    s.getState().execute({ type: 'UpdateObstacle', obstacleId: obstacle.id, patch: { rotation: 0.5 } });
    expect(roomOf(s).obstacles[0]!.rotation).toBe(0.5);
    s.getState().execute({ type: 'RemoveObstacle', obstacleId: obstacle.id });
    expect(roomOf(s).obstacles).toHaveLength(0);
  });
});

describe('экземпляры мебели', () => {
  const withInstance = () => {
    const s = store();
    const instance = createFurnitureInstance(ids, s.getState().project.id, s.getState().project.furniture[0]!, { x: 500, y: 0, z: 500 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance }, 'Добавить мебель');
    return { s, instance };
  };

  it('экземпляр добавляется и ссылается на существующее изделие', () => {
    const { s, instance } = withInstance();
    expect(roomOf(s).furnitureInstances).toHaveLength(1);
    expect(roomOf(s).furnitureInstances[0]!.furnitureId).toBe(furnitureId(s));
    expect(instance.furnitureId).toBe(furnitureId(s));
  });

  it('ссылку в никуда команда не создаёт', () => {
    const s = store();
    const orphan = createFurnitureInstance(ids, s.getState().project.id, { id: 'нет-такого' } as never, { x: 0, y: 0, z: 0 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance: orphan });
    expect(roomOf(s).furnitureInstances).toHaveLength(0);
  });

  it('мебель не копируется в комнату: экземпляр хранит только ссылку', () => {
    const { s } = withInstance();
    const stored = roomOf(s).furnitureInstances[0]!;
    expect(Object.keys(stored).sort()).toEqual(
      ['projectId', 'furnitureId', 'id', 'locked', 'position', 'rotation', 'visible'].sort(),
    );
    expect(JSON.stringify(stored)).not.toContain('dimensions');
  });

  it('один и тот же шкаф размещается дважды', () => {
    const { s } = withInstance();
    const second = createFurnitureInstance(ids, s.getState().project.id, s.getState().project.furniture[0]!, { x: 2000, y: 0, z: 500 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance: second });
    const instances = roomOf(s).furnitureInstances;
    expect(instances).toHaveLength(2);
    expect(instances[0]!.furnitureId).toBe(instances[1]!.furnitureId);
    expect(instances[0]!.id).not.toBe(instances[1]!.id);
  });

  it('перемещение и поворот меняют только положение', () => {
    const { s, instance } = withInstance();
    s.getState().execute({
      type: 'TransformFurnitureInstance',
      instanceId: instance.id,
      position: { x: 1200, y: 0, z: 900 },
      rotation: Math.PI / 2,
    });
    const moved = roomOf(s).furnitureInstances[0]!;
    expect(moved.position).toEqual({ x: 1200, y: 0, z: 900 });
    expect(moved.rotation).toBeCloseTo(Math.PI / 2, 9);
    // Габариты изделия остались в изделии.
    expect(s.getState().project.furniture[0]!.dimensions.width).toBe(1000);
  });

  it('заблокированный экземпляр не двигается', () => {
    const { s, instance } = withInstance();
    s.getState().execute({ type: 'SetInstanceFlags', instanceId: instance.id, locked: true });
    s.getState().execute({
      type: 'TransformFurnitureInstance',
      instanceId: instance.id,
      position: { x: 3000, y: 0, z: 100 },
    });
    expect(roomOf(s).furnitureInstances[0]!.position).toEqual({ x: 500, y: 0, z: 500 });
  });

  it('видимость переключается', () => {
    const { s, instance } = withInstance();
    s.getState().execute({ type: 'SetInstanceFlags', instanceId: instance.id, visible: false });
    expect(roomOf(s).furnitureInstances[0]!.visible).toBe(false);
  });

  it('нечисловое положение команда не принимает', () => {
    const { s, instance } = withInstance();
    s.getState().execute({
      type: 'TransformFurnitureInstance',
      instanceId: instance.id,
      position: { x: Number.NaN, y: 0, z: 0 },
    });
    expect(roomOf(s).furnitureInstances[0]!.position.x).toBe(500);
  });

  it('удаление убирает экземпляр, не трогая изделие', () => {
    const { s, instance } = withInstance();
    s.getState().execute({ type: 'RemoveFurnitureInstance', instanceId: instance.id });
    expect(roomOf(s).furnitureInstances).toHaveLength(0);
    expect(s.getState().project.furniture).toHaveLength(1);
  });
});

describe('отмена и повтор работают без своей системы', () => {
  it('добавление мебели отменяется одним шагом', () => {
    const s = store();
    const instance = createFurnitureInstance(ids, s.getState().project.id, s.getState().project.furniture[0]!, { x: 500, y: 0, z: 500 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance }, 'Добавить мебель');
    expect(roomOf(s).furnitureInstances).toHaveLength(1);
    s.getState().undo();
    expect(roomOf(s).furnitureInstances).toHaveLength(0);
    s.getState().redo();
    expect(roomOf(s).furnitureInstances).toHaveLength(1);
  });

  it('перемещение отменяется до исходного положения', () => {
    const s = store();
    const instance = createFurnitureInstance(ids, s.getState().project.id, s.getState().project.furniture[0]!, { x: 500, y: 0, z: 500 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance });
    s.getState().execute(
      { type: 'TransformFurnitureInstance', instanceId: instance.id, position: { x: 2000, y: 0, z: 900 } },
      'Переместить',
    );
    s.getState().undo();
    expect(roomOf(s).furnitureInstances[0]!.position).toEqual({ x: 500, y: 0, z: 500 });
  });

  it('серия кадров жеста складывается в один шаг истории', () => {
    // Ровно то, ради чего существуют транзакции: перетаскивание даёт
    // десятки команд, а отмена обязана вернуть в состояние до жеста.
    const s = store();
    const instance = createFurnitureInstance(ids, s.getState().project.id, s.getState().project.furniture[0]!, { x: 500, y: 0, z: 500 });
    s.getState().execute({ type: 'AddFurnitureInstance', instance });

    s.getState().beginTransaction('Переместить');
    for (let x = 600; x <= 1000; x += 100) {
      s.getState().execute({ type: 'TransformFurnitureInstance', instanceId: instance.id, position: { x, y: 0, z: 500 } });
    }
    s.getState().endTransaction();

    expect(roomOf(s).furnitureInstances[0]!.position.x).toBe(1000);
    s.getState().undo();
    expect(roomOf(s).furnitureInstances[0]!.position.x).toBe(500);
  });

  it('изменение габарита комнаты отменяется', () => {
    const s = store();
    s.getState().execute({ type: 'SetRoomSize', width: 6000, depth: 4000, height: 2700 }, 'Габарит комнаты');
    s.getState().undo();
    expect(roomFootprint(roomOf(s)).width).toBe(4000);
  });
});
