import { roundMm } from '../domain/index.js';
import type { FurnitureInstance, Mm, Obstacle, Room, Vec3, Wall } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';

/**
 * Размещение объектов в помещении (PROMPT 24 §2, §11).
 *
 * ## Планировщик не считает мебель
 *
 * Ни одна функция этого файла не знает, из чего собрано изделие. Ей
 * нужен только его ГАБАРИТ, и габарит приходит из уже посчитанной
 * геометрии (`GeometryResult.boundingBox`). Пересчитывать конструкцию
 * при перемещении шкафа по комнате незачем: от того, что шкаф подвинули,
 * его детали не меняются.
 *
 * Отсюда же следует главное свойство перетаскивания: во время жеста
 * достаточно габаритной коробки, и производственный конвейер не
 * запускается вовсе (§13, §32).
 *
 * ## Поворот — только вокруг вертикали
 *
 * Мебель стоит на полу. Наклонить шкаф модель не выражает, и заводить
 * три угла поворота ради двух всегда нулевых значило бы обещать
 * возможность, которой нет. Тот же довод, по которому у `SceneObject`
 * нет поворота вовсе (`docs/3D_RENDERER_ARCHITECTURE.md` §5).
 */

/** Прямоугольник на плане: минимальный угол и размер по X и Z. */
export interface Footprint {
  readonly x: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly depth: Mm;
}

/** Коробка в координатах комнаты. */
export interface RoomBox {
  readonly min: Vec3;
  readonly size: Vec3;
}

/**
 * Габарит изделия для размещения.
 *
 * Берётся ИЗМЕРЕННЫЙ охват (`boundingBox`), а не заявленные W/H/D:
 * столешница со свесом и ручка выступают за номинальный габарит, и
 * шкаф, поставленный вплотную к стене по номиналу, упирался бы в неё
 * ручкой. Та же величина и по той же причине, что используется камерой
 * сцены (`docs/3D_COORDINATE_SYSTEM.md` §5).
 */
export function furnitureExtent(geometry: GeometryResult): Vec3 {
  const box = geometry.boundingBox;
  return { x: box.totalWidth, y: box.totalHeight, z: box.totalDepth };
}

/** Поворот на кратный прямому углу: 0, 90, 180, 270 градусов. */
const QUARTER = Math.PI / 2;

/**
 * Приводит поворот к диапазону 0…2π.
 *
 * Нужно, чтобы «повернуть четыре раза по 90°» возвращало ровно тот же
 * угол, что был, а не 2π: иначе сравнение положений после четырёх
 * поворотов ложно показывало бы изменение.
 */
export function normalizeRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  const full = Math.PI * 2;
  const value = rotation % full;
  return value < 0 ? value + full : value;
}

/** Ближайший поворот, кратный прямому углу. */
export function snapRotationToQuarter(rotation: number): number {
  return normalizeRotation(Math.round(normalizeRotation(rotation) / QUARTER) * QUARTER);
}

/**
 * Меняет ли поворот местами ширину и глубину.
 *
 * Только для поворотов, кратных прямому углу. Для произвольного угла
 * ответ «частично», и такой габарит описывается уже не прямоугольником,
 * а его описанной коробкой — см. `instanceFootprint`.
 */
export function swapsAxes(rotation: number): boolean {
  const quarters = Math.round(normalizeRotation(rotation) / QUARTER) % 4;
  return quarters === 1 || quarters === 3;
}

/**
 * След изделия на плане с учётом поворота.
 *
 * Для произвольного угла возвращается ОПИСАННЫЙ прямоугольник, а не
 * повёрнутый: проверка пересечений по осям тогда остаётся точной в
 * безопасную сторону — она может сообщить о столкновении там, где его
 * ещё нет на пару миллиметров, но никогда не пропустит настоящее.
 * Ложное «нельзя» пользователь видит и обходит; пропущенное пересечение
 * он обнаружит на сборке.
 *
 * Поворот происходит вокруг ЦЕНТРА следа, а не вокруг угла: иначе шкаф
 * при повороте уезжает из-под курсора, и жест перестаёт быть прямым.
 */
export function footprintOf(position: Vec3, extent: Vec3, rotation: number): Footprint {
  const angle = normalizeRotation(rotation);
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));

  const width = extent.x * cos + extent.z * sin;
  const depth = extent.x * sin + extent.z * cos;

  const centerX = position.x + extent.x / 2;
  const centerZ = position.z + extent.z / 2;

  return {
    x: roundMm(centerX - width / 2),
    z: roundMm(centerZ - depth / 2),
    width: roundMm(width),
    depth: roundMm(depth),
  };
}

/** След экземпляра. Габарит изделия передаётся, а не вычисляется здесь. */
export function instanceFootprint(instance: FurnitureInstance, extent: Vec3): Footprint {
  return footprintOf(instance.position, extent, instance.rotation);
}

/** Объём экземпляра в комнате: след плюс высота от уровня пола. */
export function instanceBox(instance: FurnitureInstance, extent: Vec3, floorElevation: Mm): RoomBox {
  const print = instanceFootprint(instance, extent);
  return {
    min: { x: print.x, y: instance.position.y + floorElevation, z: print.z },
    size: { x: print.width, y: extent.y, z: print.depth },
  };
}

/** Коробка препятствия. Поворот учитывается так же, как у мебели. */
export function obstacleBox(obstacle: Obstacle): RoomBox {
  const print = footprintOf(obstacle.position, obstacle.size, obstacle.rotation);
  return {
    min: { x: print.x, y: obstacle.position.y, z: print.z },
    size: { x: print.width, y: obstacle.size.y, z: print.depth },
  };
}

/**
 * Объём стены.
 *
 * Стена задана отрезком по средней линии, поэтому толщина откладывается
 * в обе стороны от неё. Для стен, идущих не по осям, возвращается
 * описанная коробка — с той же оговоркой, что и у повёрнутой мебели.
 */
export function wallBox(wall: Wall, floorElevation: Mm): RoomBox {
  const half = wall.thickness / 2;
  const minX = Math.min(wall.a.x, wall.b.x) - half;
  const maxX = Math.max(wall.a.x, wall.b.x) + half;
  const minZ = Math.min(wall.a.z, wall.b.z) - half;
  const maxZ = Math.max(wall.a.z, wall.b.z) + half;
  return {
    min: { x: minX, y: floorElevation, z: minZ },
    size: { x: maxX - minX, y: wall.height, z: maxZ - minZ },
  };
}

/**
 * Свободный контур комнаты: прямоугольник по внутренним граням стен.
 *
 * Хранить ширину и глубину в модели было бы вторым ответом на вопрос,
 * на который уже отвечают стены. Здесь они выводятся — и ровно поэтому
 * не могут разойтись с контуром.
 *
 * Для непрямоугольной комнаты это описанный прямоугольник свободного
 * пространства; отдельные ниши и выступы он не описывает, о чём прямо
 * сказано в `docs/ROOM_MODEL.md` §3.
 */
export function roomFootprint(room: Room): Footprint {
  if (room.walls.length === 0) return { x: 0, z: 0, width: 0, depth: 0 };

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
  return { x: minX, z: minZ, width: roundMm(maxX - minX), depth: roundMm(maxZ - minZ) };
}

/**
 * Прямоугольна ли комната.
 *
 * Проверяется буквально: четыре стены, каждая параллельна оси, и все они
 * образуют замкнутый контур. Нужно интерфейсу: поле «ширина комнаты»
 * имеет смысл только для прямоугольника, и для остальных случаев его
 * честнее выключить, чем молча искажать контур.
 */
export function isRectangular(room: Room): boolean {
  if (room.walls.length !== 4) return false;
  const axisAligned = room.walls.every((wall) => wall.a.x === wall.b.x || wall.a.z === wall.b.z);
  if (!axisAligned) return false;

  const print = roomFootprint(room);
  if (print.width <= 0 || print.depth <= 0) return false;

  // Замкнутость: конец каждой стены совпадает с началом следующей.
  return room.walls.every((wall, index) => {
    const next = room.walls[(index + 1) % room.walls.length];
    return next !== undefined && wall.b.x === next.a.x && wall.b.z === next.a.z;
  });
}

/** Пересечение двух прямоугольников на плане. Касание пересечением не считается. */
export function footprintsOverlap(a: Footprint, b: Footprint, tolerance: Mm = 0): boolean {
  return (
    a.x + a.width > b.x + tolerance &&
    b.x + b.width > a.x + tolerance &&
    a.z + a.depth > b.z + tolerance &&
    b.z + b.depth > a.z + tolerance
  );
}

/** Зазор между прямоугольниками: 0 при касании, отрицательный при пересечении. */
export function footprintGap(a: Footprint, b: Footprint): Mm {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dz = Math.max(b.z - (a.z + a.depth), a.z - (b.z + b.depth));
  if (dx >= 0 && dz >= 0) return roundMm(Math.hypot(dx, dz));
  if (dx >= 0) return roundMm(dx);
  if (dz >= 0) return roundMm(dz);
  return roundMm(Math.max(dx, dz));
}

/** Пересечение объёмов: то же, но с учётом высоты. */
export function boxesOverlap(a: RoomBox, b: RoomBox): boolean {
  return (
    a.min.x + a.size.x > b.min.x &&
    b.min.x + b.size.x > a.min.x &&
    a.min.y + a.size.y > b.min.y &&
    b.min.y + b.size.y > a.min.y &&
    a.min.z + a.size.z > b.min.z &&
    b.min.z + b.size.z > a.min.z
  );
}
