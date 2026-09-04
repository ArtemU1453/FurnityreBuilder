import type { Vec3 } from '../domain/index.js';
import { add, scale } from './math.js';
import type { Ray } from './camera.js';
import type { SceneModel, SceneObject } from './types.js';

/**
 * Попадание луча в объект сцены (PROMPT 23 §19).
 *
 * ## Почему пересечение с коробкой, а не с треугольниками
 *
 * Все объекты сцены — прямоугольные параллелепипеды, выровненные по осям
 * изделия (`SceneObject` не имеет поворота, и это следствие модели, а не
 * упрощение — см. `types.ts`). Для такого случая существует точное
 * решение в шесть сравнений: метод плит. Оно и быстрее перебора
 * треугольников, и — что важнее — ТОЧНО: пользователь не промахивается
 * мимо кромки полки из-за приблизительной оболочки.
 *
 * Ускоряющая структура не нужна: даже большое изделие — это сотни
 * объектов, а не миллионы, и линейный перебор укладывается в доли
 * миллисекунды. Строить BVH ради этого значило бы поддерживать индекс,
 * который нужно перестраивать при каждом пересчёте геометрии.
 */

/** Пересечение луча с коробкой. `undefined` — промах. */
export function intersectBox(ray: Ray, center: Vec3, size: Vec3): number | undefined {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (const axis of ['x', 'y', 'z'] as const) {
    const half = size[axis] / 2;
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    const min = center[axis] - half;
    const max = center[axis] + half;

    if (Math.abs(direction) < 1e-9) {
      // Луч параллелен паре граней: либо он внутри плиты, либо мимо неё
      // навсегда. Делить на ноль здесь означало бы получить NaN и
      // «попадание» в каждую деталь сразу.
      if (origin < min || origin > max) return undefined;
      continue;
    }

    const t1 = (min - origin) / direction;
    const t2 = (max - origin) / direction;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMax < tMin) return undefined;
  }

  // Камера может оказаться внутри корпуса: тогда ближняя граница позади,
  // и правильный ответ — выход из коробки, а не отсутствие попадания.
  if (tMax < 0) return undefined;
  return tMin >= 0 ? tMin : tMax;
}

export interface Hit {
  readonly object: SceneObject;
  /** Расстояние вдоль луча, мм. */
  readonly distance: number;
  readonly point: Vec3;
}

export interface PickOptions {
  /**
   * Разрешено ли попадать в невидимые объекты — ячейки и секции.
   *
   * По умолчанию нет: щелчок должен выбирать то, что человек видит.
   * Ячейка выбирается отдельным действием, иначе указатель всегда
   * попадал бы сначала в невидимую коробку ячейки, накрывающую полки
   * внутри неё (§21: «не выделять случайно весь корпус»).
   */
  readonly includeVolumes?: boolean;
  /** Виды объектов, которые вообще участвуют в выборе. */
  readonly kinds?: readonly SceneObject['kind'][];
}

function candidates(scene: SceneModel, options: PickOptions): readonly SceneObject[] {
  const kinds = options.kinds;
  return scene.objects.filter((object) => {
    if (!object.selectable) return false;
    if (kinds !== undefined && !kinds.includes(object.kind)) return false;
    if (object.visible) return true;
    return options.includeVolumes === true;
  });
}

/**
 * Ближайший объект под лучом.
 *
 * При равном расстоянии выигрывает объект МЕНЬШЕГО объёма. Это не
 * произвол: грань полки и грань ячейки, в которой она стоит, совпадают,
 * и без этого правила щелчок по краю полки доставался бы ячейке —
 * ровно та ошибка, которую §21 требует не допускать.
 */
export function pick(scene: SceneModel, ray: Ray, options: PickOptions = {}): Hit | undefined {
  let best: Hit | undefined;
  let bestVolume = Infinity;

  for (const object of candidates(scene, options)) {
    const distance = intersectBox(ray, object.position, object.size);
    if (distance === undefined) continue;

    const volume = object.size.x * object.size.y * object.size.z;
    const closer = best === undefined || distance < best.distance - 1e-6;
    const sameDepthButSmaller = best !== undefined && Math.abs(distance - best.distance) <= 1e-6 && volume < bestVolume;
    if (!closer && !sameDepthButSmaller) continue;

    best = { object, distance, point: add(ray.origin, scale(ray.direction, distance)) };
    bestVolume = volume;
  }

  return best;
}

/**
 * Все объекты под лучом, от ближнего к дальнему.
 *
 * Нужно там, где выбор зависит не только от расстояния: например,
 * «выбрать ячейку под указателем» игнорирует детали перед ней.
 */
export function pickAll(scene: SceneModel, ray: Ray, options: PickOptions = {}): readonly Hit[] {
  const hits: Hit[] = [];
  for (const object of candidates(scene, options)) {
    const distance = intersectBox(ray, object.position, object.size);
    if (distance === undefined) continue;
    hits.push({ object, distance, point: add(ray.origin, scale(ray.direction, distance)) });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}
