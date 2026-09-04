import { hasErrors, issue, roundMm } from '../domain/index.js';
import type { Issue, Room, Vec3 } from '../domain/index.js';
import { detectCollisions } from './collision.js';
import type { ClearanceRule, ExtentLookup } from './collision.js';
import { instanceKey, roomFootprint } from './placement.js';

/**
 * Проверка помещения (PROMPT 24 §19–§20).
 *
 * ## Статус — тот же четырёхуровневый, что и у производства
 *
 * `RoomStatus` повторяет уровни `ProductionStatus` (PROMPT 21) и выводится
 * тем же правилом: ошибка перевешивает всё, затем неподтверждённые
 * правила, затем предупреждения. Имена уровней взяты из задания §20, но
 * система остаётся одной и той же — второй, несовместимой, здесь не
 * заводится.
 *
 * | Помещение | Производство | Когда |
 * | --- | --- | --- |
 * | `INVALID` | `INVALID` | есть ошибки |
 * | `NEEDS_CONFIRMATION` | `NEEDS_CONFIRMATION` | правила не подтверждены |
 * | `WARNING` | `HAS_WARNINGS` | есть предупреждения |
 * | `VALID` | `READY_FOR_PRODUCTION` | чисто |
 *
 * ## Статус не хранится
 *
 * Как и всё производное в этом проекте, он вычисляется от комнаты в
 * момент запроса. Кэша нет — значит нет и устаревшего статуса.
 */

export type RoomStatus = 'VALID' | 'WARNING' | 'INVALID' | 'NEEDS_CONFIRMATION';

export const ROOM_CODES = {
  noWalls: 'ROOM_NO_WALLS',
  wallDegenerate: 'ROOM_WALL_DEGENERATE',
  wallThickness: 'ROOM_WALL_THICKNESS_INVALID',
  wallHeight: 'ROOM_WALL_HEIGHT_INVALID',
  ceilingHeight: 'ROOM_CEILING_HEIGHT_INVALID',
  wallTallerThanCeiling: 'ROOM_WALL_TALLER_THAN_CEILING',
  floorElevation: 'ROOM_FLOOR_ELEVATION_INVALID',
  openingWallMissing: 'ROOM_OPENING_WALL_NOT_FOUND',
  openingOutside: 'ROOM_OPENING_OUTSIDE_WALL',
  openingTooTall: 'ROOM_OPENING_TALLER_THAN_WALL',
  openingSize: 'ROOM_OPENING_SIZE_INVALID',
  obstacleSize: 'ROOM_OBSTACLE_SIZE_INVALID',
  instanceFurnitureMissing: 'ROOM_INSTANCE_FURNITURE_NOT_FOUND',
  instanceProjectMissing: 'ROOM_INSTANCE_PROJECT_NOT_FOUND',
  instanceTooTall: 'ROOM_INSTANCE_TALLER_THAN_CEILING',
  duplicateId: 'ROOM_DUPLICATE_ID',
} as const;

export interface RoomValidationOptions {
  /** Габариты изделий по `FurnitureId`. Планировщик их не считает. */
  readonly extents: ExtentLookup;
  readonly clearanceRules?: readonly ClearanceRule[];
}

export interface RoomValidationResult {
  readonly status: RoomStatus;
  readonly issues: readonly Issue[];
  readonly clearanceRulesKnown: boolean;
}

const at = (path: string): { path: string } => ({ path });

function checkStructure(room: Room, issues: Issue[]): void {
  if (room.walls.length === 0) {
    issues.push(issue(ROOM_CODES.noWalls, 'error', 'В помещении нет стен', at('room.walls')));
  }

  if (!Number.isFinite(room.ceilingHeight) || room.ceilingHeight <= 0) {
    issues.push(
      issue(ROOM_CODES.ceilingHeight, 'error', 'Высота потолка должна быть больше нуля', at('room.ceilingHeight')),
    );
  }

  if (!Number.isFinite(room.floor.elevation)) {
    issues.push(
      issue(ROOM_CODES.floorElevation, 'error', 'Уровень пола задан неверно', at('room.floor.elevation')),
    );
  }

  for (const wall of room.walls) {
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    if (length <= 0) {
      issues.push(issue(ROOM_CODES.wallDegenerate, 'error', 'Стена нулевой длины', at(`room.walls.${wall.id}`)));
    }
    if (!Number.isFinite(wall.thickness) || wall.thickness <= 0) {
      issues.push(
        issue(ROOM_CODES.wallThickness, 'error', 'Толщина стены должна быть больше нуля', at(`room.walls.${wall.id}`)),
      );
    }
    if (!Number.isFinite(wall.height) || wall.height <= 0) {
      issues.push(
        issue(ROOM_CODES.wallHeight, 'error', 'Высота стены должна быть больше нуля', at(`room.walls.${wall.id}`)),
      );
    } else if (wall.height > room.ceilingHeight) {
      // Не ошибка: стена выше потолка физически возможна (потолок
      // подвесной). Но это почти всегда опечатка, и сказать об этом надо.
      issues.push(
        issue(
          ROOM_CODES.wallTallerThanCeiling,
          'warning',
          'Стена выше потолка',
          at(`room.walls.${wall.id}`),
        ),
      );
    }
  }
}

function checkOpenings(room: Room, issues: Issue[]): void {
  for (const opening of room.openings) {
    const wall = room.walls.find((item) => item.id === opening.wallId);
    if (wall === undefined) {
      issues.push(
        issue(
          ROOM_CODES.openingWallMissing,
          'error',
          'Проём ссылается на несуществующую стену',
          at(`room.openings.${opening.id}`),
        ),
      );
      continue;
    }

    if (opening.width <= 0 || opening.height <= 0 || !Number.isFinite(opening.sillHeight)) {
      issues.push(
        issue(ROOM_CODES.openingSize, 'error', 'Размеры проёма заданы неверно', at(`room.openings.${opening.id}`)),
      );
      continue;
    }

    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    if (opening.position < 0 || opening.position + opening.width > length) {
      issues.push(
        issue(
          ROOM_CODES.openingOutside,
          'error',
          'Проём выходит за пределы стены',
          at(`room.openings.${opening.id}`),
        ),
      );
    }

    if (opening.sillHeight + opening.height > wall.height) {
      issues.push(
        issue(
          ROOM_CODES.openingTooTall,
          'error',
          'Проём выше стены',
          at(`room.openings.${opening.id}`),
        ),
      );
    }
  }
}

function checkObstacles(room: Room, issues: Issue[]): void {
  for (const obstacle of room.obstacles) {
    const size = obstacle.size;
    if (size.x <= 0 || size.y <= 0 || size.z <= 0 || !Number.isFinite(obstacle.rotation)) {
      issues.push(
        issue(
          ROOM_CODES.obstacleSize,
          'error',
          'Размеры препятствия должны быть больше нуля',
          at(`room.obstacles.${obstacle.id}`),
        ),
      );
    }
  }
}

function checkInstances(room: Room, extents: ExtentLookup, issues: Issue[]): void {
  // Какие проекты вообще известны: по ним различаются «нет проекта» и
  // «проект есть, но такого изделия в нём нет». Для пользователя это
  // разные события и разные действия.
  const knownProjects = new Set([...extents.keys()].map((key) => key.split('/')[0]));
  for (const instance of room.furnitureInstances) {
    const extent = extents.get(instanceKey(instance));
    if (extent === undefined) {
      // Ссылочная целостность: экземпляр указывает на проект или изделие,
      // которого нет. Молча убрать экземпляр нельзя — пользователь
      // потеряет расстановку, не поняв почему (PROMPT 25 §12, вариант C).
      const projectKnown = knownProjects.has(instance.projectId);
      issues.push(
        issue(
          projectKnown ? ROOM_CODES.instanceFurnitureMissing : ROOM_CODES.instanceProjectMissing,
          'error',
          projectKnown
            ? 'Экземпляр ссылается на несуществующее изделие'
            : 'Проект, размещённый в помещении, недоступен: он удалён или не загружен',
          at(`room.furnitureInstances.${instance.id}`),
        ),
      );
      continue;
    }

    const top = instance.position.y + room.floor.elevation + extent.y;
    if (top > room.ceilingHeight) {
      issues.push(
        issue(
          ROOM_CODES.instanceTooTall,
          'error',
          `Изделие не помещается по высоте: ${String(roundMm(top))} мм при потолке ${String(room.ceilingHeight)} мм`,
          at(`room.furnitureInstances.${instance.id}`),
        ),
      );
    }
  }
}

function checkUniqueIds(room: Room, issues: Issue[]): void {
  const seen = new Set<string>();
  const all: string[] = [
    ...room.walls.map((w) => w.id),
    ...room.openings.map((o) => o.id),
    ...room.obstacles.map((o) => o.id),
    ...room.furnitureInstances.map((i) => i.id),
  ];
  for (const id of all) {
    if (seen.has(id)) {
      issues.push(issue(ROOM_CODES.duplicateId, 'error', `Повторяющийся идентификатор: ${id}`, at('room')));
    }
    seen.add(id);
  }
}

/** Полная проверка помещения. */
export function validateRoom(room: Room, options: RoomValidationOptions): RoomValidationResult {
  const issues: Issue[] = [];

  checkStructure(room, issues);
  checkOpenings(room, issues);
  checkObstacles(room, issues);
  checkInstances(room, options.extents, issues);
  checkUniqueIds(room, issues);

  const collisions = detectCollisions(room, {
    extents: options.extents,
    ...(options.clearanceRules === undefined ? {} : { clearanceRules: options.clearanceRules }),
  });
  issues.push(...collisions.issues);

  return {
    status: statusOf(issues, collisions.clearanceRulesKnown),
    issues,
    clearanceRulesKnown: collisions.clearanceRulesKnown,
  };
}

/**
 * Статус по списку проблем.
 *
 * Порядок приоритетов тот же, что у производственного статуса: ошибка
 * важнее неподтверждённого правила, неподтверждённое правило важнее
 * предупреждения. `NEEDS_CONFIRMATION` выше `WARNING` намеренно —
 * «мы не знаем, нарушено ли требование» хуже, чем «требование нарушено
 * и мы это видим».
 */
export function statusOf(issues: readonly Issue[], clearanceRulesKnown: boolean): RoomStatus {
  if (hasErrors(issues)) return 'INVALID';
  if (!clearanceRulesKnown) return 'NEEDS_CONFIRMATION';
  return issues.some((item) => item.severity === 'warning') ? 'WARNING' : 'VALID';
}

/** Габарит комнаты для интерфейса. Производная величина, не поле модели. */
export function roomSize(room: Room): { width: number; depth: number; height: number } {
  const print = roomFootprint(room);
  return { width: print.width, depth: print.depth, height: room.ceilingHeight };
}

/** Пустой словарь габаритов: комната без изделий. */
export const NO_EXTENTS: ExtentLookup = new Map<string, Vec3>();
