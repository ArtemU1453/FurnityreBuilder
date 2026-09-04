import type { FurnitureId, Room, Vec3 } from '../domain/index.js';
import { detectCollisions } from './collision.js';
import type { ExtentLookup } from './collision.js';
import { roomFootprint } from './placement.js';
import { snapCandidates } from './snap.js';

/**
 * Куда поставить мебель, которую только что добавили (PROMPT 24 §12).
 *
 * ## Почему не «в начало координат»
 *
 * Начало координат лежит на осевой линии стен, и изделие, поставленное
 * туда, оказывается наполовину внутри двух стен: новая мебель появлялась
 * бы сразу с двумя ошибками размещения. Пользователь при этом ничего
 * неправильного не сделал — это мы поставили её в стену.
 *
 * ## Почему не «ближайшая привязка от нуля»
 *
 * Тоже пробовали: `applySnap` от точки (0,0,0) выбирает БЛИЖАЙШЕГО
 * кандидата, а ближайшая к нулю — стена, а не угол. Для перетаскивания
 * это правильно (тянут к тому, что ближе), для первой постановки — нет:
 * изделие снова попадало в стену, только в одну.
 *
 * Здесь задача другая и решается прямо: перебрать углы, затем стены, и
 * взять первое место, где изделие ни с чем не пересекается. Все позиции
 * при этом — те же кандидаты привязки, то есть выведены из фактической
 * геометрии комнаты, а не подобранные числа.
 */

export interface Placement {
  readonly position: Vec3;
  readonly rotation: number;
  /** Нашлось ли свободное место. `false` — изделие поставлено, но мешает. */
  readonly free: boolean;
}

/**
 * Первое свободное место для изделия.
 *
 * Если свободного нет вовсе (комната заставлена), изделие всё равно
 * ставится — в центр — и помечается `free: false`. Отказаться добавить
 * было бы хуже: пользователь нажал «добавить» и обязан увидеть
 * результат, а о пересечении ему скажет проверка размещения.
 */
export function findPlacement(
  room: Room,
  furnitureId: FurnitureId,
  extent: Vec3,
  extents: ExtentLookup,
): Placement {
  const candidates = snapCandidates(room, extent, { x: 0, y: 0, z: 0 });
  // Углы раньше стен: у стены изделие стоит «где-то посередине», а угол —
  // определённое место, и именно туда его обычно и ставят первым.
  const ordered = [...candidates].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'corner' ? -1 : 1));

  for (const candidate of ordered) {
    const probe: Room = {
      ...room,
      furnitureInstances: [
        ...room.furnitureInstances,
        {
          id: 'probe' as Room['furnitureInstances'][number]['id'],
          furnitureId,
          position: candidate.position,
          rotation: candidate.rotation,
          locked: false,
          visible: true,
        },
      ],
    };
    const blocking = detectCollisions(probe, { extents }).issues.some(
      (item) => item.severity === 'error' && item.target?.path === 'room.furnitureInstances.probe',
    );
    if (!blocking) return { position: candidate.position, rotation: candidate.rotation, free: true };
  }

  const print = roomFootprint(room);
  return {
    position: {
      x: print.x + (print.width - extent.x) / 2,
      y: 0,
      z: print.z + (print.depth - extent.z) / 2,
    },
    rotation: 0,
    free: false,
  };
}
