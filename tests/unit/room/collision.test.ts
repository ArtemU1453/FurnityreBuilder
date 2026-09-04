import { describe, expect, it } from 'vitest';
import { COLLISION_CODES, PROXIMITY_MM, detectCollisions, extentKey } from '../../../src/room/index.js';
import type { ClearanceRule, ExtentLookup } from '../../../src/room/index.js';
import {
  createFurnitureInstance,
  createObstacle,
  createOpening,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Furniture, ProjectId, Room, Vec3 } from '../../../src/domain/index.js';

/**
 * Проверка размещения (PROMPT 24 §17–§18).
 *
 * Три уровня разделены содержательно: пересечение — ошибка, нарушенный
 * зазор — предупреждение, близость — сообщение. Норм проходов среди
 * ожиданий нет, потому что их нет и в коде (`T-ROOM-01`).
 */

const ids = createSequentialIdFactory('c');
const furniture = (id: string): Furniture => ({ id } as unknown as Furniture);
const EXTENT: Vec3 = { x: 1000, y: 2000, z: 600 };
const PROJECT = 'project:test' as ProjectId;
const extents: ExtentLookup = new Map([
  [extentKey(PROJECT, 'f-1'), EXTENT],
  [extentKey(PROJECT, 'f-2'), EXTENT],
]);

const base = (): Room =>
  createRectangularRoom({ ids: createSequentialIdFactory('r'), width: 4000, depth: 3000, height: 2700, wallThickness: 100 });

const withInstances = (room: Room, ...instances: ReturnType<typeof createFurnitureInstance>[]): Room => ({
  ...room,
  furnitureInstances: instances,
});

const place = (furnitureId: string, x: number, z: number, rotation = 0) =>
  createFurnitureInstance(ids, PROJECT, furniture(furnitureId), { x, y: 0, z }, rotation);

const codes = (room: Room, rules?: readonly ClearanceRule[]) =>
  detectCollisions(room, { extents, ...(rules === undefined ? {} : { clearanceRules: rules }) }).issues.map((i) => i.code);

describe('мебель ↔ стена', () => {
  it('изделие внутри комнаты ошибок не даёт', () => {
    expect(codes(withInstances(base(), place('f-1', 500, 500)))).not.toContain(COLLISION_CODES.wall);
  });

  it('изделие, заехавшее в стену, — ошибка', () => {
    expect(codes(withInstances(base(), place('f-1', 500, -60)))).toContain(COLLISION_CODES.wall);
  });

  it('изделие за пределами комнаты — ошибка, даже если стены не задело', () => {
    expect(codes(withInstances(base(), place('f-1', 6000, 6000)))).toContain(COLLISION_CODES.outside);
  });
});

describe('мебель ↔ мебель', () => {
  it('пересечение — ошибка', () => {
    const room = withInstances(base(), place('f-1', 500, 500), place('f-2', 900, 500));
    expect(codes(room)).toContain(COLLISION_CODES.furniture);
  });

  it('пара проверяется один раз, а не дважды', () => {
    const room = withInstances(base(), place('f-1', 500, 500), place('f-2', 900, 500));
    expect(codes(room).filter((c) => c === COLLISION_CODES.furniture)).toHaveLength(1);
  });

  it('разнесённые изделия ошибок не дают', () => {
    const room = withInstances(base(), place('f-1', 200, 500), place('f-2', 2000, 500));
    expect(codes(room)).not.toContain(COLLISION_CODES.furniture);
  });

  it('стоящие вплотную дают сообщение, а не ошибку', () => {
    const room = withInstances(base(), place('f-1', 200, 500), place('f-2', 1200 + PROXIMITY_MM - 10, 500));
    const issues = detectCollisions(room, { extents }).issues;
    const proximity = issues.find((i) => i.code === COLLISION_CODES.proximity);
    expect(proximity?.severity).toBe('info');
  });

  it('скрытый экземпляр в проверке не участвует', () => {
    const hidden = { ...place('f-2', 900, 500), visible: false };
    const room = withInstances(base(), place('f-1', 500, 500), hidden);
    expect(codes(room)).not.toContain(COLLISION_CODES.furniture);
  });
});

describe('мебель ↔ препятствие', () => {
  it('пересечение с колонной — ошибка', () => {
    const room = base();
    const obstacle = createObstacle(ids, 'column', { x: 600, y: 0, z: 600 }, { x: 400, y: 2700, z: 400 });
    expect(codes({ ...withInstances(room, place('f-1', 300, 400)), obstacles: [obstacle] })).toContain(
      COLLISION_CODES.obstacle,
    );
  });

  it('препятствие выше изделия, но в стороне — не ошибка', () => {
    const room = base();
    const obstacle = createObstacle(ids, 'pipe', { x: 3000, y: 0, z: 2000 }, { x: 100, y: 2700, z: 100 });
    expect(codes({ ...withInstances(room, place('f-1', 300, 400)), obstacles: [obstacle] })).not.toContain(
      COLLISION_CODES.obstacle,
    );
  });
});

describe('мебель ↔ проём', () => {
  it('изделие, придвинутое к стене перед дверью, перекрывает проём', () => {
    // Норму, запрещающую это, референс не подтверждает (T-ROOM-03),
    // поэтому предупреждение, а не запрет. Шкаф стоит вплотную к стене:
    // z = половина толщины стены.
    const room = base();
    const opening = createOpening(ids, room.walls[0]!.id, 'door', 500, 900, 2100, 0);
    const issues = detectCollisions(
      { ...withInstances(room, place('f-1', 600, room.walls[0]!.thickness / 2)), openings: [opening] },
      { extents },
    ).issues;
    const blocked = issues.find((i) => i.code === COLLISION_CODES.opening);
    expect(blocked?.severity).toBe('warning');
    expect(blocked?.message).toContain('дверной');
  });

  it('изделие в стороне по высоте комнаты проём не перекрывает', () => {
    // Тот же шкаф, но отодвинут от стены: глубина свободной зоны перед
    // проёмом — норма прохода, которой у нас нет (T-ROOM-01), и
    // придумывать её здесь нельзя.
    const room = base();
    const opening = createOpening(ids, room.walls[0]!.id, 'door', 500, 900, 2100, 0);
    expect(
      codes({ ...withInstances(room, place('f-1', 600, 800)), openings: [opening] }),
    ).not.toContain(COLLISION_CODES.opening);
  });

  it('изделие в стороне от проёма предупреждения не даёт', () => {
    const room = base();
    const opening = createOpening(ids, room.walls[0]!.id, 'window', 200, 1200, 1400, 800);
    expect(
      codes({ ...withInstances(room, place('f-1', 2500, 500)), openings: [opening] }),
    ).not.toContain(COLLISION_CODES.opening);
  });
});

describe('зазоры', () => {
  it('без правил зазоров проверка честно об этом сообщает', () => {
    const result = detectCollisions(withInstances(base(), place('f-1', 500, 500)), { extents });
    expect(result.clearanceRulesKnown).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(COLLISION_CODES.clearanceUnknown);
  });

  it('заданное правило превращает тесный зазор в предупреждение', () => {
    const rule: ClearanceRule = { id: 'pass', title: 'Проход', between: 'furniture', minimum: 600 };
    const room = withInstances(base(), place('f-1', 200, 500), place('f-2', 1400, 500));
    const issues = detectCollisions(room, { extents, clearanceRules: [rule] }).issues;
    const violated = issues.find((i) => i.code === COLLISION_CODES.clearance);
    expect(violated?.severity).toBe('warning');
    expect(violated?.message).toContain('600');
  });

  it('соблюдённый зазор предупреждения не даёт', () => {
    const rule: ClearanceRule = { id: 'pass', title: 'Проход', between: 'furniture', minimum: 600 };
    const room = withInstances(base(), place('f-1', 200, 500), place('f-2', 2000, 500));
    expect(codes(room, [rule])).not.toContain(COLLISION_CODES.clearance);
  });

  it('в пустой комнате о правилах не сообщается: сообщать не о чем', () => {
    expect(codes(base())).not.toContain(COLLISION_CODES.clearanceUnknown);
  });
});

describe('детерминизм', () => {
  it('один и тот же вход даёт один и тот же список', () => {
    const room = withInstances(base(), place('f-1', 500, 500), place('f-2', 2200, 500));
    expect(codes(room)).toEqual(codes(room));
  });

  it('экземпляр без построенного изделия в геометрических проверках не участвует', () => {
    const room = withInstances(base(), place('нет-такого', 500, 500));
    expect(detectCollisions(room, { extents }).issues.map((i) => i.code)).not.toContain(COLLISION_CODES.wall);
  });
});
