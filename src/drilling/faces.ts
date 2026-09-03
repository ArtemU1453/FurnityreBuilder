import { rawCutSize } from '../geometry/index.js';
import { vec3 } from '../domain/index.js';
import type { Axis, DrillFace, Mm, Part, PartOrientation, Vec3 } from '../domain/index.js';
import type { DrillDirection, DrillingOperation, WorldHole } from './types.js';

/**
 * Локальная система детали и переход в мировую (PROMPT 18 §4–§5, §16–§17).
 *
 * ## Одна система координат, а не вторая
 *
 * Соответствие «локальные длина/ширина/толщина → мировые оси» уже задано
 * `PartOrientation` и функцией `rawCutSize` (`docs/COORDINATE_SYSTEM.md`
 * §5). Здесь оно не переопределяется, а читается: своя таблица осей рядом
 * с существующей означала бы зеркальные детали при первом же расхождении.
 *
 * ## Почему источник истины — локальные координаты
 *
 * Отверстие принадлежит ДЕТАЛИ, а не пространству. Деталь переезжает при
 * любом изменении габарита, ширины секции или высоты цоколя; хранимая
 * мировая координата отверстия устаревала бы каждый раз, а локальная —
 * никогда. Поэтому мировая точка здесь ВЫЧИСЛЯЕТСЯ и нигде не хранится.
 */

/** Мировые оси локальных измерений детали. */
export interface LocalFrame {
  readonly lengthAxis: Axis;
  readonly widthAxis: Axis;
  readonly thicknessAxis: Axis;
  readonly length: Mm;
  readonly width: Mm;
  readonly thickness: Mm;
}

/** Оси ориентации — та же таблица, что в `rawCutSize`, прочитанная по осям. */
function axesOf(orientation: PartOrientation): Pick<LocalFrame, 'lengthAxis' | 'widthAxis' | 'thicknessAxis'> {
  switch (orientation) {
    case 'vertical-yz':
      return { lengthAxis: 'y', widthAxis: 'z', thicknessAxis: 'x' };
    case 'horizontal-xz':
      return { lengthAxis: 'x', widthAxis: 'z', thicknessAxis: 'y' };
    case 'frontal-xy':
      return { lengthAxis: 'y', widthAxis: 'x', thicknessAxis: 'z' };
  }
}

/**
 * Локальная система КОНКРЕТНОЙ детали.
 *
 * Размеры берутся из `part.size` — детали, как она стоит в изделии, а не
 * из `part.cut`: мировая точка отверстия должна попадать в установленную
 * панель. Когда политика кромки вычитает её толщину из размера заготовки
 * (`subtractFromPartSize`), заготовка меньше установленной детали на
 * толщину кромки — это отличие описано в `docs/DRILLING_RULES.md` §3.
 */
export function localFrame(part: Part): LocalFrame {
  const raw = rawCutSize(part.size, part.orientation);
  return { ...axesOf(part.orientation), length: raw.length, width: raw.width, thickness: raw.thickness };
}

/**
 * Как устроена грань: вдоль каких локальных измерений идут её оси `x` и `y`
 * и куда направлено сверление.
 *
 *   `top`/`bottom`  — пласти: x вдоль длины, y вдоль ширины;
 *   `left`/`right`  — торцы по длине: x вдоль ширины, y вдоль толщины;
 *   `front`/`back`  — торцы по ширине: x вдоль длины, y вдоль толщины.
 *
 * Сверление всегда идёт ВНУТРЬ детали, поэтому направление — внутренняя
 * нормаль грани.
 */
export interface FaceFrame {
  /** Максимальные координаты на грани: отверстие обязано лежать внутри. */
  readonly extentX: Mm;
  readonly extentY: Mm;
  /** Сколько материала под гранью: предел глубины глухого отверстия. */
  readonly available: Mm;
  readonly direction: DrillDirection;
}

export function faceFrame(part: Part, face: DrillFace): FaceFrame {
  const frame = localFrame(part);
  switch (face) {
    case 'bottom':
      return { extentX: frame.length, extentY: frame.width, available: frame.thickness, direction: { axis: frame.thicknessAxis, sign: 1 } };
    case 'top':
      return { extentX: frame.length, extentY: frame.width, available: frame.thickness, direction: { axis: frame.thicknessAxis, sign: -1 } };
    case 'left':
      return { extentX: frame.width, extentY: frame.thickness, available: frame.length, direction: { axis: frame.lengthAxis, sign: 1 } };
    case 'right':
      return { extentX: frame.width, extentY: frame.thickness, available: frame.length, direction: { axis: frame.lengthAxis, sign: -1 } };
    case 'back':
      return { extentX: frame.length, extentY: frame.thickness, available: frame.width, direction: { axis: frame.widthAxis, sign: 1 } };
    case 'front':
      return { extentX: frame.length, extentY: frame.thickness, available: frame.width, direction: { axis: frame.widthAxis, sign: -1 } };
  }
}

/** Смещения по трём локальным измерениям для точки на грани. */
function offsetsFor(
  frame: LocalFrame,
  face: DrillFace,
  x: Mm,
  y: Mm,
): { length: Mm; width: Mm; thickness: Mm } {
  switch (face) {
    case 'bottom':
      return { length: x, width: y, thickness: 0 };
    case 'top':
      return { length: x, width: y, thickness: frame.thickness };
    case 'left':
      return { length: 0, width: x, thickness: y };
    case 'right':
      return { length: frame.length, width: x, thickness: y };
    case 'back':
      return { length: x, width: 0, thickness: y };
    case 'front':
      return { length: x, width: frame.width, thickness: y };
  }
}

function addAlong(base: { x: Mm; y: Mm; z: Mm }, axis: Axis, value: Mm): void {
  base[axis] += value;
}

/**
 * Мировая точка отверстия и направление сверления (§17).
 *
 * Локальные оси сонаправлены со своими мировыми: локальное начало — тот же
 * минимальный угол детали, что и `Part.position` (`docs/COORDINATE_SYSTEM.md`
 * §2), поэтому переход — сложение трёх смещений, без матриц и без поворотов.
 */
export function toWorld(part: Part, face: DrillFace, x: Mm, y: Mm): WorldHole {
  const frame = localFrame(part);
  const offsets = offsetsFor(frame, face, x, y);
  const point = { x: part.position.x, y: part.position.y, z: part.position.z };
  addAlong(point, frame.lengthAxis, offsets.length);
  addAlong(point, frame.widthAxis, offsets.width);
  addAlong(point, frame.thicknessAxis, offsets.thickness);
  return { point: vec3(point.x, point.y, point.z), direction: faceFrame(part, face).direction };
}

/** Мировая проекция операции — та же функция, но по готовой операции. */
export function operationToWorld(operation: DrillingOperation, part: Part): WorldHole {
  return toWorld(part, operation.face, operation.x, operation.y);
}

/** Точка дна глухого отверстия: нужна проверке глубины и отладке. */
export function holeBottom(hole: WorldHole, depth: Mm): Vec3 {
  const point = { x: hole.point.x, y: hole.point.y, z: hole.point.z };
  addAlong(point, hole.direction.axis, hole.direction.sign * depth);
  return vec3(point.x, point.y, point.z);
}

/** Текстовая запись направления: «+x», «−z». Для отладки и документации. */
export function formatDirection(direction: DrillDirection): string {
  return `${direction.sign === 1 ? '+' : '−'}${direction.axis}`;
}

/**
 * Обратный переход: мировая точка → координаты на грани детали.
 *
 * Нужен правилам, у которых положение уже посчитано геометрией в мировых
 * координатах (ручка, push-механизм): пересчитывать его формулой заново
 * значило бы завести второй источник положения — тот самый, который
 * разъедется с первым при следующей правке `resolveOpeningSystemGeometry`.
 */
export function toLocal(part: Part, face: DrillFace, point: Vec3): { x: Mm; y: Mm } {
  const frame = localFrame(part);
  const rel = {
    x: point.x - part.position.x,
    y: point.y - part.position.y,
    z: point.z - part.position.z,
  };
  const along = (axis: Axis): Mm => rel[axis];
  switch (face) {
    case 'top':
    case 'bottom':
      return { x: along(frame.lengthAxis), y: along(frame.widthAxis) };
    case 'left':
    case 'right':
      return { x: along(frame.widthAxis), y: along(frame.thicknessAxis) };
    case 'back':
    case 'front':
      return { x: along(frame.lengthAxis), y: along(frame.thicknessAxis) };
  }
}
