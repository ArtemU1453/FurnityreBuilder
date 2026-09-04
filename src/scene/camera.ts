import type { Vec3 } from '../domain/index.js';
import { add, cross, identity, invert, lookAt, multiply, normalize, orthographic, perspective, scale, sub, transformPoint } from './math.js';
import type { Mat4 } from './math.js';
import type { SceneModel } from './types.js';

/**
 * Орбитальная камера (PROMPT 23 §17).
 *
 * ## Состояние камеры — сферические координаты, а не матрица
 *
 * Хранится «куда смотрим, с какой стороны и с какого расстояния», а
 * матрица собирается из этого на каждом кадре. Хранить матрицу и править
 * её приращениями значит копить погрешность: через сотню кадров орбиты
 * базис перестаёт быть ортонормированным, и картинка едет.
 *
 * ## Почему азимут и высота, а не кватернион
 *
 * Кватернион даёт свободное вращение, в том числе «горизонт завален».
 * Для мебели это дезориентирует: пользователь всегда должен понимать, где
 * верх шкафа. Ограничение высоты полюсами (см. `clampElevation`) — не
 * упрощение, а сознательное сохранение пространственной опоры.
 */

export type ProjectionKind = 'perspective' | 'orthographic';

export interface Camera {
  /** Точка, вокруг которой вращается камера, мм. */
  readonly target: Vec3;
  /** Расстояние до цели, мм. */
  readonly distance: number;
  /** Азимут: 0 — строго спереди, растёт против часовой стрелки, радианы. */
  readonly azimuth: number;
  /** Высота над горизонтом: 0 — на уровне цели, +π/2 — сверху, радианы. */
  readonly elevation: number;
  readonly projection: ProjectionKind;
  /** Вертикальный угол зрения, радианы. Применяется только к перспективе. */
  readonly fovY: number;
}

/** Стандартные виды (§17). */
export type ViewPreset = 'perspective' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/**
 * Предел высоты: почти полюс, но не полюс.
 *
 * Ровно на полюсе направление взгляда совпадает с `up`, базис вида
 * вырождается и картинка схлопывается. Зазор в 0.001 радиана дешевле
 * любой особой обработки полюса и незаметен глазу.
 */
const POLE_EPSILON = 1e-3;
const HALF_PI = Math.PI / 2;

export const MIN_DISTANCE_FACTOR = 0.35;
export const MAX_DISTANCE_FACTOR = 12;
export const DEFAULT_FOV_Y = (35 * Math.PI) / 180;

export function clampElevation(elevation: number): number {
  return Math.min(HALF_PI - POLE_EPSILON, Math.max(-HALF_PI + POLE_EPSILON, elevation));
}

/**
 * Расстояние, при котором сцена радиуса `radius` целиком помещается в кадр.
 *
 * Считается по вертикальному углу и по горизонтальному отдельно, берётся
 * большее: узкое высокое окно обрезает изделие по ширине, широкое низкое —
 * по высоте, и учитывать нужно тот случай, который хуже.
 */
export function fitDistance(radius: number, aspect: number, fovY = DEFAULT_FOV_Y): number {
  if (radius <= 0) return 1;
  const safeAspect = aspect > 0 ? aspect : 1;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * safeAspect);
  const vertical = radius / Math.sin(fovY / 2);
  const horizontal = radius / Math.sin(fovX / 2);
  return Math.max(vertical, horizontal);
}

/** Углы стандартных видов. Перспектива — три четверти сверху слева. */
const PRESET_ANGLES: Readonly<Record<ViewPreset, { azimuth: number; elevation: number; projection: ProjectionKind }>> = {
  perspective: { azimuth: -Math.PI / 5, elevation: Math.PI / 9, projection: 'perspective' },
  front: { azimuth: 0, elevation: 0, projection: 'orthographic' },
  back: { azimuth: Math.PI, elevation: 0, projection: 'orthographic' },
  right: { azimuth: HALF_PI, elevation: 0, projection: 'orthographic' },
  left: { azimuth: -HALF_PI, elevation: 0, projection: 'orthographic' },
  top: { azimuth: 0, elevation: HALF_PI, projection: 'orthographic' },
  bottom: { azimuth: 0, elevation: -HALF_PI, projection: 'orthographic' },
};

/**
 * Камера для вида и сцены.
 *
 * Ортографическая проекция у плоских видов не украшение: на «виде спереди»
 * перспектива делает боковины разной ширины, и по картинке нельзя
 * сравнить два размера. Плоский вид обязан быть измеримым.
 */
export function cameraForPreset(preset: ViewPreset, scene: SceneModel, aspect: number): Camera {
  const angles = PRESET_ANGLES[preset];
  return {
    target: scene.center,
    distance: fitDistance(scene.radius, aspect),
    azimuth: angles.azimuth,
    elevation: clampElevation(angles.elevation),
    projection: angles.projection,
    fovY: DEFAULT_FOV_Y,
  };
}

/** Положение камеры в мире. */
export function eyeOf(camera: Camera): Vec3 {
  const cosE = Math.cos(camera.elevation);
  return add(camera.target, {
    x: camera.distance * cosE * Math.sin(camera.azimuth),
    y: camera.distance * Math.sin(camera.elevation),
    z: camera.distance * cosE * Math.cos(camera.azimuth),
  });
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function viewMatrix(camera: Camera): Mat4 {
  return lookAt(eyeOf(camera), camera.target, UP);
}

/**
 * Матрица проекции.
 *
 * Плоскости отсечения привязаны к расстоянию, а не к постоянным
 * миллиметрам: шкаф 400 мм и гардеробная 4000 мм требуют разного
 * ближнего плана, и фиксированные значения дают либо обрезанный передний
 * фасад, либо z-fighting на тонких деталях.
 */
export function projectionMatrix(camera: Camera, aspect: number): Mat4 {
  const near = Math.max(camera.distance * 0.01, 0.1);
  const far = camera.distance * 10 + 1000;
  if (camera.projection === 'orthographic') {
    const halfHeight = camera.distance * Math.tan(camera.fovY / 2);
    return orthographic(halfHeight, aspect, -far, far);
  }
  return perspective(camera.fovY, aspect, near, far);
}

export function viewProjection(camera: Camera, aspect: number): Mat4 {
  return multiply(projectionMatrix(camera, aspect), viewMatrix(camera));
}

/** Орбита: перевод смещения указателя в приращение углов. */
export function orbit(camera: Camera, dxPx: number, dyPx: number, viewportHeightPx: number): Camera {
  const height = viewportHeightPx > 0 ? viewportHeightPx : 1;
  // Полный оборот за высоту окна по вертикали и за неё же по горизонтали:
  // одинаковая чувствительность по обеим осям — иначе жест «по диагонали»
  // ощущается кривым.
  const perPixel = Math.PI / height;
  return {
    ...camera,
    azimuth: camera.azimuth - dxPx * perPixel,
    elevation: clampElevation(camera.elevation + dyPx * perPixel),
  };
}

/**
 * Панорама: сдвиг цели в плоскости экрана.
 *
 * Переводится в миллиметры через видимую высоту кадра, поэтому изделие
 * идёт ровно за указателем на любом расстоянии — то самое соответствие
 * 1:1, без которого прямое манипулирование перестаёт быть прямым.
 */
export function pan(camera: Camera, dxPx: number, dyPx: number, viewportHeightPx: number): Camera {
  const height = viewportHeightPx > 0 ? viewportHeightPx : 1;
  const visibleHeight = 2 * camera.distance * Math.tan(camera.fovY / 2);
  const mmPerPixel = visibleHeight / height;

  const forward = normalize(sub(camera.target, eyeOf(camera)));
  const right = normalize(cross(forward, UP));
  const up = cross(right, forward);

  const delta = add(scale(right, -dxPx * mmPerPixel), scale(up, dyPx * mmPerPixel));
  return { ...camera, target: add(camera.target, delta) };
}

/**
 * Зум: умножение расстояния.
 *
 * Именно умножение, а не вычитание: шаг «минус 100 мм» у далёкой камеры
 * незаметен, а у близкой протыкает изделие насквозь. Границы привязаны к
 * радиусу сцены — уехать в бесконечность или внутрь панели нельзя.
 */
export function zoom(camera: Camera, factor: number, sceneRadius: number): Camera {
  const radius = sceneRadius > 0 ? sceneRadius : 1;
  const distance = camera.distance * (factor > 0 ? factor : 1);
  return {
    ...camera,
    distance: Math.min(radius * MAX_DISTANCE_FACTOR, Math.max(radius * MIN_DISTANCE_FACTOR, distance)),
  };
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/**
 * Луч из точки холста в мир.
 *
 * Точка задаётся в нормализованных координатах устройства: x и y в
 * диапазоне −1…1, y вверх. Перевод из пикселей делает вызывающая сторона,
 * потому что только она знает `getBoundingClientRect` — а этому слою
 * DOM недоступен.
 *
 * Возвращает `undefined`, если матрицу нельзя обратить (холст ещё не
 * получил размер). Тихо вернуть луч из начала координат означало бы
 * выбирать случайную деталь при первом же щелчке.
 */
export function rayFromNdc(camera: Camera, aspect: number, ndcX: number, ndcY: number): Ray | undefined {
  const inverse = invert(viewProjection(camera, aspect));
  if (inverse === undefined) return undefined;
  const near = transformPoint(inverse, { x: ndcX, y: ndcY, z: -1 });
  const far = transformPoint(inverse, { x: ndcX, y: ndcY, z: 1 });
  const direction = normalize(sub(far, near));
  return { origin: near, direction };
}

/**
 * Сколько пикселей экрана даёт один миллиметр вдоль мировой оси.
 *
 * Нужно ручкам изменения размера: пользователь тянет мышью в пикселях, а
 * команда принимает миллиметры, и коэффициент зависит и от расстояния до
 * камеры, и от того, под каким углом ось смотрит на экран. Считать его
 * «примерно по расстоянию» нельзя — при взгляде вдоль оси ручка
 * становилась бы бесконечно чувствительной.
 *
 * Метод прямой: проецируются две точки на оси, разнесённые на известное
 * расстояние, и измеряется, на сколько пикселей они разошлись. Это
 * работает одинаково для перспективы и для ортографии.
 *
 * Возвращает `undefined`, когда ось смотрит почти точно в камеру: тянуть
 * за такую ручку бессмысленно, и вызывающая сторона обязана этот жест не
 * начинать, а не делить на почти-ноль.
 */
export function pixelsPerMmAlong(
  camera: Camera,
  aspect: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  origin: Vec3,
  axis: Vec3,
  probeMm = 100,
): number | undefined {
  const m = viewProjection(camera, aspect);
  const a = transformPoint(m, origin);
  const b = transformPoint(m, add(origin, scale(normalize(axis), probeMm)));
  const dxPx = ((b.x - a.x) / 2) * viewportWidthPx;
  const dyPx = ((b.y - a.y) / 2) * viewportHeightPx;
  const perProbe = Math.hypot(dxPx, dyPx);
  const perMm = perProbe / probeMm;
  // Порог: меньше сотой доли пикселя на миллиметр означает, что за один
  // пиксель размер меняется на метр. Это не управление, а рулетка.
  return perMm < 0.01 ? undefined : perMm;
}

/**
 * Знак: в какую сторону экрана растёт мировая ось.
 *
 * Ручка правой грани при взгляде сзади должна тянуться влево, иначе
 * изделие сжимается, когда пользователь тянет «наружу». Знак берётся из
 * проекции оси на экран, а не из предположения о том, где сейчас камера.
 */
export function screenDirectionOf(
  camera: Camera,
  aspect: number,
  origin: Vec3,
  axis: Vec3,
): { x: number; y: number } {
  const m = viewProjection(camera, aspect);
  const a = transformPoint(m, origin);
  const b = transformPoint(m, add(origin, scale(normalize(axis), 100)));
  return { x: b.x - a.x, y: b.y - a.y };
}

/** Единичная матрица — для отрисовки, когда камера ещё не готова. */
export const IDENTITY: Mat4 = identity();
