import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createFalsePanel,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import {
  createFurnitureInstance,
  createObstacle,
  createOpening,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { readFileSync } from 'node:fs';
import type { Command } from '../../../src/state/commands.js';
import type { NodeId, Project } from '../../../src/domain/index.js';

/**
 * Отмена и возврат КАЖДОЙ команды (PROMPT 30 §9).
 *
 * ## Зачем такой тест
 *
 * Отдельные команды проверялись поштучно, но семь из сорока четырёх не
 * выполнялись ни одним тестом вовсе. Отмена при этом устроена одинаково
 * для всех — история хранит патчи Immer и не знает, что именно
 * изменилось, — поэтому дыра в покрытии означает не «эта команда
 * отменяется иначе», а «мы не знаем, отменяется ли она».
 *
 * ## Что проверяется
 *
 * Для каждой команды: применить → отменить → состояние совпадает с
 * исходным → вернуть → состояние совпадает с тем, что было до отмены.
 * Дословно требование §9.
 *
 * ## Полнота проверяется машиной
 *
 * Список команд читается из самого `commands.ts`: добавив новую команду
 * и забыв про этот тест, автор получит красный тест, а не тихую дыру.
 * Перечислить объединение типов в рантайме нельзя, поэтому источником
 * служит исходник — тот же, из которого объединение и состоит.
 */

/** Все типы команд, как они объявлены в модели. */
function declaredCommandTypes(): string[] {
  const source = readFileSync(new URL('../../../src/state/commands.ts', import.meta.url), 'utf8');
  const declaration = source.slice(
    source.indexOf('export type Command ='),
    source.indexOf('export const PLANNED_COMMANDS'),
  );
  return [...declaration.matchAll(/readonly type: '([A-Za-z]+)'/g)].map((match) => match[1]!);
}

const ids = createSequentialIdFactory('u');

function baseProject(): Project {
  return createProject({
    ids: createSequentialIdFactory('p'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

/**
 * Проект с комнатой: командам планировщика нужна комната.
 *
 * Комната создаётся ОДИН раз и переиспользуется: иначе у каждой копии
 * были бы свои идентификаторы стен, и проём из фикстуры ссылался бы на
 * стену, которой в этом проекте нет — команда справедливо отказала бы, а
 * тест проверял бы отказ вместо отмены.
 */
const sharedRoom = createRectangularRoom({ ids, width: 4000, depth: 3000, wallThickness: 100 });

function withRoom(project: Project): Project {
  return { ...project, room: sharedRoom };
}

const store = (project: Project) => createDocumentStore(project);

const seed = baseProject();
const furniture = seed.furniture[0]!;
const rootLeafId = furniture.root.id;
type MaterialIdOf = (typeof seed.materials.items)[string]['id'];
const wallId = sharedRoom.walls[0]!.id;
const opening = createOpening(ids, wallId, 'door', 500, 900, 2100, 0);
const obstacle = createObstacle(
  ids,
  'column',
  { x: 500, y: 0, z: 500 },
  { x: 300, y: 2700, z: 300 },
);
const instance = createFurnitureInstance(ids, seed.id, furniture, { x: 100, y: 0, z: 100 });

/**
 * По одному представителю на каждый тип команды.
 *
 * `needsRoom` — команда планировщика: без комнаты она обязана ничего не
 * делать, и проверять на ней отмену бессмысленно.
 * `noop` — команда, которая на этом входе намеренно ничего не меняет
 * (например схлопывание листа, который и так лист): она проверяется на
 * то, что история не растёт от бездействия.
 */
interface Case {
  readonly command: Command;
  readonly needsRoom?: boolean;
  readonly noop?: boolean;
}

const CASES: Readonly<Record<string, Case>> = {
  SetProjectName: { command: { type: 'SetProjectName', name: 'Другое имя' } },
  SetFurnitureName: { command: { type: 'SetFurnitureName', furnitureIndex: 0, name: 'Шкаф' } },
  SetDimension: {
    command: { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1234 },
  },
  SetCarcassFlags: { command: { type: 'SetCarcassFlags', furnitureIndex: 0, hasTop: false } },
  SplitNode: {
    command: {
      type: 'SplitNode',
      furnitureIndex: 0,
      nodeId: rootLeafId,
      axis: 'x',
      childIds: ['u-c1' as NodeId, 'u-c2' as NodeId],
      dividerThickness: 16,
    },
  },
  CollapseNode: {
    // Схлопывание переименовывает узел в `leafId`, поэтому меняет модель
    // даже когда узел уже лист.
    command: {
      type: 'CollapseNode',
      furnitureIndex: 0,
      nodeId: rootLeafId,
      leafId: 'u-leaf' as NodeId,
    },
  },
  SetRoot: {
    command: {
      type: 'SetRoot',
      furnitureIndex: 0,
      root: createUniformGrid(createSequentialIdFactory('ug'), 2, 2, 16, 16),
    },
  },
  SetSectionCount: {
    command: {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: 'u-sc' as NodeId,
      newSectionIds: ['u-s1' as NodeId, 'u-s2' as NodeId, 'u-s3' as NodeId],
      dividerThickness: 16,
    },
  },
  SetChildSize: {
    // Требует деления: применяется после SetSectionCount внутри теста.
    command: {
      type: 'SetChildSize',
      furnitureIndex: 0,
      childId: 'u-s1' as NodeId,
      size: { mode: 'fixed', value: 400 },
    },
  },
  SetFill: {
    command: {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: rootLeafId,
      fill: createShelvesLeaf(createSequentialIdFactory('u-sh'), 2).fill,
    },
  },
  AddFacade: {
    command: {
      type: 'AddFacade',
      furnitureIndex: 0,
      facade: createHingedFacade(createSequentialIdFactory('u-fa'), rootLeafId, 1),
    },
  },
  RemoveFacade: {
    command: { type: 'RemoveFacade', furnitureIndex: 0, facadeId: 'u-fa-1' as NodeId },
    noop: true,
  },
  UpdateFacadeLeaf: {
    command: {
      type: 'UpdateFacadeLeaf',
      furnitureIndex: 0,
      facadeId: 'нет' as NodeId,
      leafId: 'нет' as NodeId,
      patch: { hingeSide: 'right' },
    },
    noop: true,
  },
  SetBackPanel: {
    command: {
      type: 'SetBackPanel',
      furnitureIndex: 0,
      patch: { mount: { kind: 'overlay', thickness: 4 } },
    },
  },
  SetBase: { command: { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) } },
  UpdateBase: { command: { type: 'UpdateBase', furnitureIndex: 0, patch: { height: 120 } } },
  SetStructuralModifiers: {
    command: { type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { ceilingGap: 100 } },
  },
  UpsertMaterial: {
    command: {
      type: 'UpsertMaterial',
      material: { ...Object.values(seed.materials.items)[0]!, thickness: 18 },
    },
  },
  RemoveMaterial: {
    command: { type: 'RemoveMaterial', materialId: 'нет-такого' as MaterialIdOf },
    noop: true,
  },
  SetMaterialAssignment: {
    command: {
      type: 'SetMaterialAssignment',
      role: 'shelf-adjustable',
      materialId: Object.values(seed.materials.items)[1]!.id,
    },
  },
  SetDefaultMaterial: {
    // Второй материал: первый уже назначен по умолчанию, и команда с ним
    // ничего не меняла бы — тест проверял бы бездействие.
    command: {
      type: 'SetDefaultMaterial',
      materialId: Object.values(seed.materials.items)[1]!.id,
    },
  },
  AddFalsePanel: {
    command: {
      type: 'AddFalsePanel',
      furnitureIndex: 0,
      panel: createFalsePanel(createSequentialIdFactory('u-fp'), 'left'),
    },
  },
  RemoveFalsePanel: {
    command: { type: 'RemoveFalsePanel', furnitureIndex: 0, panelId: 'нет' as NodeId },
    noop: true,
  },
  UpdateFalsePanel: {
    command: {
      type: 'UpdateFalsePanel',
      furnitureIndex: 0,
      panelId: 'нет' as NodeId,
      patch: { width: 100 },
    },
    noop: true,
  },
  SetConstructionScheme: {
    command: {
      type: 'SetConstructionScheme',
      scheme: { ...seed.settings.construction, verticalPriority: 'horizontals-through' },
    },
  },
  SetTolerances: {
    command: {
      type: 'SetTolerances',
      tolerances: { ...seed.settings.tolerances, depthIncludesBackPanel: false },
    },
  },
  SetEdgeSizingPolicy: {
    command: { type: 'SetEdgeSizingPolicy', policy: { subtractFromPartSize: true } },
  },
  SetCuttingSettings: { command: { type: 'SetCuttingSettings', patch: { kerf: 5.5 } } },
  SetRoom: { command: { type: 'SetRoom', room: undefined }, needsRoom: true },
  SetRoomName: { command: { type: 'SetRoomName', name: 'Кухня' }, needsRoom: true },
  SetRoomSize: {
    command: { type: 'SetRoomSize', width: 5000, depth: 3500, height: 2800 },
    needsRoom: true,
  },
  SetFloor: { command: { type: 'SetFloor', patch: { elevation: 50 } }, needsRoom: true },
  SetCeiling: { command: { type: 'SetCeiling', patch: { visible: true } }, needsRoom: true },
  UpdateWall: {
    command: { type: 'UpdateWall', wallId, patch: { thickness: 250 } },
    needsRoom: true,
  },
  AddOpening: { command: { type: 'AddOpening', opening }, needsRoom: true },
  RemoveOpening: { command: { type: 'RemoveOpening', openingId: opening.id }, needsRoom: true },
  UpdateOpening: {
    command: { type: 'UpdateOpening', openingId: opening.id, patch: { width: 1000 } },
    needsRoom: true,
  },
  AddObstacle: { command: { type: 'AddObstacle', obstacle }, needsRoom: true },
  RemoveObstacle: { command: { type: 'RemoveObstacle', obstacleId: obstacle.id }, needsRoom: true },
  UpdateObstacle: {
    command: { type: 'UpdateObstacle', obstacleId: obstacle.id, patch: { kind: 'pipe' } },
    needsRoom: true,
  },
  AddFurnitureInstance: { command: { type: 'AddFurnitureInstance', instance }, needsRoom: true },
  RemoveFurnitureInstance: {
    command: { type: 'RemoveFurnitureInstance', instanceId: instance.id },
    needsRoom: true,
  },
  TransformFurnitureInstance: {
    command: {
      type: 'TransformFurnitureInstance',
      instanceId: instance.id,
      position: { x: 900, y: 0, z: 900 },
    },
    needsRoom: true,
  },
  SetInstanceFlags: {
    command: { type: 'SetInstanceFlags', instanceId: instance.id, locked: true },
    needsRoom: true,
  },
};

describe('покрытие команд', () => {
  it('в таблице есть каждая команда: забыть новую нельзя', () => {
    // Список типов экспортируется доменом, поэтому дыра в покрытии
    // становится красным тестом, а не тихим пробелом.
    expect(Object.keys(CASES).sort()).toEqual([...new Set(declaredCommandTypes())].sort());
  });
});

describe.each(Object.entries(CASES))('отмена и возврат: %s', (name, entry) => {
  it('применить → отменить → вернуть возвращает то же состояние', () => {
    const start = entry.needsRoom === true ? withRoom(baseProject()) : baseProject();
    const s = store(start);

    // SetChildSize адресуется по id ребёнка: сначала создаём деление.
    if (name === 'SetChildSize') {
      s.getState().execute(CASES.SetSectionCount!.command, 'подготовка');
    }
    // Командам, работающим с уже существующим объектом, этот объект нужен.
    if (name === 'RemoveOpening' || name === 'UpdateOpening') {
      s.getState().execute({ type: 'AddOpening', opening }, 'подготовка');
    }
    if (name === 'RemoveObstacle' || name === 'UpdateObstacle') {
      s.getState().execute({ type: 'AddObstacle', obstacle }, 'подготовка');
    }
    if (
      name === 'RemoveFurnitureInstance' ||
      name === 'TransformFurnitureInstance' ||
      name === 'SetInstanceFlags'
    ) {
      s.getState().execute({ type: 'AddFurnitureInstance', instance }, 'подготовка');
    }
    if (name === 'RemoveFacade' || name === 'UpdateFacadeLeaf') {
      s.getState().execute(CASES.AddFacade!.command, 'подготовка');
    }
    if (name === 'UpdateBase') {
      s.getState().execute(CASES.SetBase!.command, 'подготовка');
    }

    const before = s.getState().project;
    s.getState().execute(entry.command, name);
    const after = s.getState().project;

    if (entry.noop !== true) {
      // Команда обязана что-то изменить: иначе тест ничего не проверяет.
      expect(after, `${name} ничего не изменила`).not.toEqual(before);
      expect(s.getState().canUndo()).toBe(true);

      s.getState().undo();
      expect(s.getState().project, `${name}: отмена не вернула состояние`).toEqual(before);

      s.getState().redo();
      expect(s.getState().project, `${name}: возврат не восстановил состояние`).toEqual(after);
    } else {
      // Команда, которая ничего не меняет, не должна попадать в историю:
      // иначе Ctrl+Z «съедал» бы шаг, которого пользователь не делал.
      expect(after).toEqual(before);
    }
  });
});
