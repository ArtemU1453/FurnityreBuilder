import { issue } from '../domain/index.js';
import type { Issue, Mm, Room, Vec3 } from '../domain/index.js';
import {
  boxesOverlap,
  footprintGap,
  instanceBox,
  instanceFootprint,
  obstacleBox,
  wallBox,
} from './placement.js';
import type { Footprint } from './placement.js';

/**
 * Проверка размещения (PROMPT 24 §17–§18).
 *
 * ## Три уровня, а не два
 *
 * ERROR   — объекты физически пересекаются. Это невозможно собрать.
 * WARNING — нарушен зазор, заданный правилом.
 * INFO    — объект стоит близко к чему-то; это не нарушение, но
 *           пользователю стоит об этом знать.
 *
 * Разделение существенно: «шкаф в стене» и «между шкафами 40 мм» —
 * разные события, и показывать их одинаково значит либо пугать, либо
 * прятать настоящую ошибку.
 *
 * ## Норм прохода здесь нет
 *
 * `ClearanceRule` — архитектура, а не таблица значений. Набор правил
 * ПУСТ намеренно: минимальные проходы зависят от назначения помещения и
 * региональных норм, референс их не подтверждает
 * (`ASSUMPTION(T-ROOM-01)`), а выдуманное число выглядело бы
 * производственным требованием. Пустой набор означает, что предупреждений
 * о зазорах не будет, и проверка честно сообщает об этом отдельным
 * пунктом, вместо того чтобы молча промолчать.
 */

/** Что с чем проверяется. Нужно интерфейсу для группировки. */
export type CollisionPair = 'wall' | 'furniture' | 'obstacle' | 'opening';

export const COLLISION_CODES = {
  wall: 'ROOM_FURNITURE_INTERSECTS_WALL',
  furniture: 'ROOM_FURNITURE_INTERSECTS_FURNITURE',
  obstacle: 'ROOM_FURNITURE_INTERSECTS_OBSTACLE',
  opening: 'ROOM_FURNITURE_BLOCKS_OPENING',
  outside: 'ROOM_FURNITURE_OUTSIDE',
  clearance: 'ROOM_CLEARANCE_VIOLATED',
  proximity: 'ROOM_OBJECT_CLOSE',
  clearanceUnknown: 'ROOM_CLEARANCE_RULES_UNKNOWN',
} as const;

/**
 * Правило зазора (§18).
 *
 * Значение обязательно и не имеет умолчания: правило без числа
 * бессмысленно, а число без подтверждения — вымысел. Правила задаёт
 * вызывающая сторона, когда они у неё появятся.
 */
export interface ClearanceRule {
  readonly id: string;
  readonly title: string;
  /** Что с чем: между мебелью, до стены, до препятствия. */
  readonly between: Extract<CollisionPair, 'wall' | 'furniture' | 'obstacle'>;
  readonly minimum: Mm;
  /** Идентификатор неизвестного, если правило введено предположительно. */
  readonly unknownId?: string;
}

/**
 * Набор правил зазоров по умолчанию — ПУСТОЙ.
 *
 * Это не заглушка «на потом», а содержательный ответ: подтверждённых
 * норм нет, и проект их не придумывает. Ровно так же поступает таблица
 * количества петель (`HINGE_COUNT_TABLE`, PROMPT 16) — она тоже пуста, и
 * по той же причине.
 */
export const DEFAULT_CLEARANCE_RULES: readonly ClearanceRule[] = [];

/**
 * Расстояние, ближе которого объекты считаются «рядом», мм.
 *
 * Это НЕ норма прохода и не производственное требование: чисто
 * информационный порог, чтобы подсказать, что объект вплотную к
 * соседу. Нарушением он не является и в статус помещения не влияет.
 */
export const PROXIMITY_MM: Mm = 50;

/** Габарит одного изделия. Планировщик получает их готовыми, а не считает. */
export type ExtentLookup = ReadonlyMap<string, Vec3>;

export interface CollisionOptions {
  readonly extents: ExtentLookup;
  readonly clearanceRules?: readonly ClearanceRule[];
}

export interface CollisionResult {
  readonly issues: readonly Issue[];
  /**
   * Зависит ли этот результат от НЕПОДТВЕРЖДЁННЫХ правил зазоров.
   *
   * `false` означает «правил нет, и они здесь были бы нужны» — тогда
   * интерфейс обязан сказать об этом, а не молчать. Пустая комната
   * возвращает `true`: проверять зазоры не между чем, и требовать
   * подтверждения правил не за что.
   *
   * Флаг и информационное сообщение выводятся из ОДНОГО условия. Пока
   * они считались по-разному, пустая комната получала статус
   * «требуется подтверждение» без единого сообщения о том, чего именно
   * не хватает.
   */
  readonly clearanceRulesKnown: boolean;
}

const target = (instanceId: string): { path: string } => ({ path: `room.furnitureInstances.${instanceId}` });

/**
 * Лежит ли след целиком внутри свободного контура комнаты.
 *
 * Проверяется отдельно от стен: шкаф, вынесенный за пределы комнаты,
 * может не пересекать ни одной стены (например, стоит за её торцом), и
 * без этой проверки такое размещение выглядело бы допустимым.
 */
function insideRoom(print: Footprint, room: Footprint): boolean {
  return (
    print.x >= room.x - 1 &&
    print.z >= room.z - 1 &&
    print.x + print.width <= room.x + room.width + 1 &&
    print.z + print.depth <= room.z + room.depth + 1
  );
}

/** Прямоугольник проёма на плане: полоса вдоль стены на ширину проёма. */
function openingFootprint(room: Room, openingId: string): Footprint | undefined {
  const opening = room.openings.find((item) => item.id === openingId);
  if (opening === undefined) return undefined;
  const wall = room.walls.find((item) => item.id === opening.wallId);
  if (wall === undefined) return undefined;

  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return undefined;

  const ux = dx / length;
  const uz = dz / length;
  const startX = wall.a.x + ux * opening.position;
  const startZ = wall.a.z + uz * opening.position;
  const endX = startX + ux * opening.width;
  const endZ = startZ + uz * opening.width;
  const half = wall.thickness / 2;

  return {
    x: Math.min(startX, endX) - half,
    z: Math.min(startZ, endZ) - half,
    width: Math.abs(endX - startX) + wall.thickness,
    depth: Math.abs(endZ - startZ) + wall.thickness,
  };
}

/**
 * Все проблемы размещения в комнате.
 *
 * Функция чистая и не зависит ни от порядка объектов, ни от того, что
 * происходило раньше: один и тот же вход всегда даёт один и тот же
 * список. Именно поэтому её можно вызывать на каждом кадре
 * перетаскивания, не рискуя накопить состояние.
 */
export function detectCollisions(room: Room, options: CollisionOptions): CollisionResult {
  const rules = options.clearanceRules ?? DEFAULT_CLEARANCE_RULES;
  const issues: Issue[] = [];
  const floor = room.floor.elevation;

  const visible = room.furnitureInstances.filter((instance) => instance.visible);
  const extentOf = (furnitureId: string): Vec3 | undefined => options.extents.get(furnitureId);

  const roomPrint = ((): Footprint => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const wall of room.walls) {
      for (const point of [wall.a, wall.b]) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
    }
    return Number.isFinite(minX)
      ? { x: minX, z: minZ, width: maxX - minX, depth: maxZ - minZ }
      : { x: 0, z: 0, width: 0, depth: 0 };
  })();

  for (const instance of visible) {
    const extent = extentOf(instance.furnitureId);
    // Габарита нет — значит изделие, на которое ссылается экземпляр, не
    // построено. Это ошибка ссылочной целостности, и её сообщает
    // `validateRoom`; здесь такой экземпляр просто не участвует в
    // геометрических проверках, чтобы не выдать вторую ошибку о том же.
    if (extent === undefined) continue;

    const print = instanceFootprint(instance, extent);
    const box = instanceBox(instance, extent, floor);

    if (!insideRoom(print, roomPrint)) {
      issues.push(
        issue(COLLISION_CODES.outside, 'error', 'Изделие выходит за пределы помещения', target(instance.id)),
      );
    }

    for (const wall of room.walls) {
      if (!boxesOverlap(box, wallBox(wall, floor))) continue;
      issues.push(issue(COLLISION_CODES.wall, 'error', 'Изделие пересекает стену', target(instance.id)));
    }

    for (const obstacle of room.obstacles) {
      if (!boxesOverlap(box, obstacleBox(obstacle))) continue;
      issues.push(
        issue(COLLISION_CODES.obstacle, 'error', 'Изделие пересекает препятствие', target(instance.id)),
      );
    }

    for (const opening of room.openings) {
      const openingPrint = openingFootprint(room, opening.id);
      // Проём перекрыт, когда изделие СТОИТ ПЕРЕД ним, то есть касается
      // полосы проёма или заходит в неё. Проверяется именно касание
      // (зазор ≤ 0), а не только пересечение: полоса проёма имеет
      // толщину стены, и шкаф, придвинутый к стене вплотную, в неё не
      // заходит — он к ней прилегает.
      //
      // Глубина зоны, которую нужно держать свободной ПЕРЕД проёмом, —
      // это норма прохода, а её референс не подтверждает
      // (`ASSUMPTION(T-ROOM-01)`). Поэтому шкаф в полуметре от двери
      // здесь не отмечается: сказать, что полметра мало, значит ввести
      // норму, которой у нас нет. Когда правило появится, оно придёт
      // через `ClearanceRule`, а не через выдуманное число здесь.
      if (openingPrint === undefined || footprintGap(print, openingPrint) > 0) continue;
      // Дверь перекрывать нельзя по здравому смыслу, окно — можно и
      // делают часто. Но норму, запрещающую это, референс не
      // подтверждает (`ASSUMPTION(T-ROOM-03)`), поэтому оба случая —
      // предупреждение, а не запрет.
      issues.push(
        issue(
          COLLISION_CODES.opening,
          'warning',
          opening.kind === 'door' ? 'Изделие перекрывает дверной проём' : 'Изделие перекрывает проём',
          target(instance.id),
        ),
      );
    }
  }

  // Пары изделий: каждая пара проверяется один раз.
  for (let i = 0; i < visible.length; i += 1) {
    const a = visible[i];
    if (a === undefined) continue;
    const extentA = extentOf(a.furnitureId);
    if (extentA === undefined) continue;
    const printA = instanceFootprint(a, extentA);
    const boxA = instanceBox(a, extentA, floor);

    for (let j = i + 1; j < visible.length; j += 1) {
      const b = visible[j];
      if (b === undefined) continue;
      const extentB = extentOf(b.furnitureId);
      if (extentB === undefined) continue;
      const printB = instanceFootprint(b, extentB);

      if (boxesOverlap(boxA, instanceBox(b, extentB, floor))) {
        issues.push(
          issue(COLLISION_CODES.furniture, 'error', 'Изделия пересекаются', target(a.id)),
        );
        continue;
      }

      const gap = footprintGap(printA, printB);
      const rule = rules.find((item) => item.between === 'furniture');
      if (rule !== undefined && gap < rule.minimum) {
        issues.push(
          issue(
            COLLISION_CODES.clearance,
            'warning',
            `Зазор между изделиями ${String(gap)} мм меньше требуемых ${String(rule.minimum)} мм (${rule.title})`,
            target(a.id),
          ),
        );
      } else if (gap <= PROXIMITY_MM) {
        issues.push(
          issue(COLLISION_CODES.proximity, 'info', `Изделия стоят вплотную: зазор ${String(gap)} мм`, target(a.id)),
        );
      }
    }
  }

  // Правила зазоров применимы только там, где есть что с чем сравнивать.
  const clearanceApplies = visible.length > 0;
  if (rules.length === 0 && clearanceApplies) {
    issues.push(
      issue(
        COLLISION_CODES.clearanceUnknown,
        'info',
        'Правила минимальных проходов не заданы: проверяются только физические пересечения. ASSUMPTION(T-ROOM-01)',
      ),
    );
  }

  return { issues, clearanceRulesKnown: !clearanceApplies || rules.length > 0 };
}
