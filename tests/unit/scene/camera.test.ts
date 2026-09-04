import { describe, expect, it } from 'vitest';
import {
  cameraForPreset,
  clampElevation,
  eyeOf,
  fitDistance,
  orbit,
  pan,
  rayFromNdc,
  viewProjection,
  zoom,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
} from '../../../src/scene/camera.js';
import { invert, multiply, identity, transformPoint } from '../../../src/scene/math.js';
import type { SceneModel } from '../../../src/scene/types.js';

/**
 * Камера и матрицы (PROMPT 23 §17).
 *
 * Проверяется без браузера: камера — это арифметика, и её ошибки
 * («изделие уехало за экран», «на виде сверху ничего не видно»)
 * находятся сравнением чисел, а не разглядыванием картинки.
 */

const scene: SceneModel = {
  objects: [],
  center: { x: 500, y: 1000, z: 250 },
  size: { x: 1000, y: 2000, z: 500 },
  radius: Math.hypot(1000, 2000, 500) / 2,
};

describe('матрицы', () => {
  it('единичная матрица не меняет точку', () => {
    expect(transformPoint(identity(), { x: 3, y: -4, z: 5 })).toEqual({ x: 3, y: -4, z: 5 });
  });

  it('произведение матрицы на её обратную даёт единичную', () => {
    const m = viewProjection(cameraForPreset('perspective', scene, 16 / 9), 16 / 9);
    const inverse = invert(m)!;
    const product = multiply(m, inverse);
    for (let i = 0; i < 16; i += 1) {
      expect(product[i]!).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4);
    }
  });

  it('вырожденная матрица не обращается, а сообщает об этом', () => {
    // Ноль вместо матрицы возможен, пока холст не получил размер. Тихо
    // вернуть мусор — значит выбирать деталь в случайной точке.
    expect(invert(new Float32Array(16))).toBeUndefined();
  });
});

describe('стандартные виды', () => {
  it('вид спереди смотрит вдоль оси Z, из положительного Z', () => {
    const eye = eyeOf(cameraForPreset('front', scene, 1));
    expect(eye.x).toBeCloseTo(scene.center.x, 6);
    expect(eye.y).toBeCloseTo(scene.center.y, 6);
    expect(eye.z).toBeGreaterThan(scene.center.z);
  });

  it('вид сверху смотрит вниз', () => {
    const eye = eyeOf(cameraForPreset('top', scene, 1));
    expect(eye.y).toBeGreaterThan(scene.center.y);
    expect(eye.x).toBeCloseTo(scene.center.x, 3);
  });

  it('вид справа стоит с положительного X', () => {
    const eye = eyeOf(cameraForPreset('right', scene, 1));
    expect(eye.x).toBeGreaterThan(scene.center.x);
    expect(eye.z).toBeCloseTo(scene.center.z, 3);
  });

  it('плоские виды ортографические: иначе по картинке нельзя сравнить два размера', () => {
    for (const preset of ['front', 'back', 'left', 'right', 'top', 'bottom'] as const) {
      expect(cameraForPreset(preset, scene, 1).projection).toBe('orthographic');
    }
    expect(cameraForPreset('perspective', scene, 1).projection).toBe('perspective');
  });

  it('камера всегда целится в центр охвата сцены', () => {
    expect(cameraForPreset('perspective', scene, 1).target).toEqual(scene.center);
  });
});

describe('вписывание в кадр', () => {
  it('узкое окно требует большего расстояния, чем широкое', () => {
    // Иначе изделие обрезается по ширине именно там, где окно узкое.
    expect(fitDistance(scene.radius, 0.5)).toBeGreaterThan(fitDistance(scene.radius, 2));
  });

  it('вписанная сцена целиком попадает в кадр', () => {
    const aspect = 4 / 3;
    const camera = cameraForPreset('perspective', scene, aspect);
    const m = viewProjection(camera, aspect);
    const half = { x: scene.size.x / 2, y: scene.size.y / 2, z: scene.size.z / 2 };
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ndc = transformPoint(m, {
            x: scene.center.x + sx * half.x,
            y: scene.center.y + sy * half.y,
            z: scene.center.z + sz * half.z,
          });
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1.001);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1.001);
        }
      }
    }
  });

  it('вырожденная сцена не даёт нулевого расстояния', () => {
    expect(fitDistance(0, 1)).toBeGreaterThan(0);
  });
});

describe('орбита, панорама, зум', () => {
  const camera = cameraForPreset('perspective', scene, 1);

  it('орбита меняет углы и не меняет цель', () => {
    const next = orbit(camera, 100, 40, 800);
    expect(next.azimuth).not.toBe(camera.azimuth);
    expect(next.elevation).not.toBe(camera.elevation);
    expect(next.target).toEqual(camera.target);
  });

  it('высота не доходит до полюса: там базис вида вырождается', () => {
    const up = orbit(camera, 0, 100_000, 800);
    const down = orbit(camera, 0, -100_000, 800);
    expect(Math.abs(up.elevation)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(down.elevation)).toBeLessThan(Math.PI / 2);
    expect(clampElevation(Math.PI)).toBeLessThan(Math.PI / 2);
  });

  it('панорама двигает цель и не трогает углы', () => {
    const next = pan(camera, 50, 0, 800);
    expect(next.target).not.toEqual(camera.target);
    expect(next.azimuth).toBe(camera.azimuth);
    expect(next.distance).toBe(camera.distance);
  });

  it('панорама идёт за указателем: вправо — изделие вправо', () => {
    // Смещение цели влево означает, что изделие уехало вправо, вслед за
    // рукой. Обратный знак ощущается «камера дёргается от меня».
    const next = pan(camera, 100, 0, 800);
    expect(next.target.x).toBeLessThan(camera.target.x);
  });

  it('зум умножает расстояние, а не вычитает из него', () => {
    const inZoom = zoom(camera, 0.5, scene.radius);
    const outZoom = zoom(camera, 2, scene.radius);
    expect(inZoom.distance).toBeCloseTo(camera.distance * 0.5, 6);
    expect(outZoom.distance).toBeCloseTo(camera.distance * 2, 6);
  });

  it('зум ограничен радиусом сцены с обеих сторон', () => {
    expect(zoom(camera, 0.0001, scene.radius).distance).toBeCloseTo(scene.radius * MIN_DISTANCE_FACTOR, 6);
    expect(zoom(camera, 10_000, scene.radius).distance).toBeCloseTo(scene.radius * MAX_DISTANCE_FACTOR, 6);
  });
});

describe('луч из точки экрана', () => {
  const aspect = 16 / 9;

  it('луч из центра кадра идёт в цель камеры', () => {
    const camera = cameraForPreset('perspective', scene, aspect);
    const ray = rayFromNdc(camera, aspect, 0, 0)!;
    const toTarget = {
      x: camera.target.x - ray.origin.x,
      y: camera.target.y - ray.origin.y,
      z: camera.target.z - ray.origin.z,
    };
    const l = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    expect(ray.direction.x).toBeCloseTo(toTarget.x / l, 4);
    expect(ray.direction.y).toBeCloseTo(toTarget.y / l, 4);
    expect(ray.direction.z).toBeCloseTo(toTarget.z / l, 4);
  });

  it('направление луча нормировано', () => {
    const ray = rayFromNdc(cameraForPreset('perspective', scene, aspect), aspect, 0.7, -0.3)!;
    expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1, 6);
  });

  it('луч строится и для ортографической камеры', () => {
    const ray = rayFromNdc(cameraForPreset('front', scene, aspect), aspect, 0.5, 0.5);
    expect(ray).toBeDefined();
  });

  it('точка экрана и обратно: луч попадает туда, куда спроецировалась точка', () => {
    const camera = cameraForPreset('perspective', scene, aspect);
    const world = { x: scene.center.x + 100, y: scene.center.y - 200, z: scene.center.z };
    const ndc = transformPoint(viewProjection(camera, aspect), world);
    const ray = rayFromNdc(camera, aspect, ndc.x, ndc.y)!;
    const toWorld = { x: world.x - ray.origin.x, y: world.y - ray.origin.y, z: world.z - ray.origin.z };
    const l = Math.hypot(toWorld.x, toWorld.y, toWorld.z);
    expect(ray.direction.x).toBeCloseTo(toWorld.x / l, 3);
    expect(ray.direction.y).toBeCloseTo(toWorld.y / l, 3);
  });
});
