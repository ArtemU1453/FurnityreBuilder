import { describe, expect, it } from 'vitest';
import { intersectBox, pick, pickAll } from '../../../src/scene/raycast.js';
import { buildScene } from '../../../src/scene/adapter.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { cameraForPreset, rayFromNdc } from '../../../src/scene/camera.js';
import { makeGeometryInput } from '../geometry/helpers.js';
import type { Ray } from '../../../src/scene/camera.js';
import type { SceneModel, SceneObject } from '../../../src/scene/types.js';

/**
 * Попадание луча (PROMPT 23 §19, §21).
 *
 * Все объекты сцены — коробки, выровненные по осям, поэтому пересечение
 * здесь ТОЧНОЕ. Это не оптимизация ради скорости: приблизительная
 * оболочка означала бы, что пользователь промахивается мимо кромки
 * полки, а промах в конструкторе мебели раздражает мгновенно.
 */

const ray = (origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): Ray => {
  const l = Math.hypot(direction.x, direction.y, direction.z);
  return { origin, direction: { x: direction.x / l, y: direction.y / l, z: direction.z / l } };
};

const box = (id: string, position: SceneObject['position'], size: SceneObject['size'], extra: Partial<SceneObject> = {}): SceneObject => ({
  id,
  kind: 'part',
  position,
  size,
  visible: true,
  selectable: true,
  label: id,
  ...extra,
});

const sceneOf = (objects: SceneObject[]): SceneModel => ({
  objects,
  center: { x: 0, y: 0, z: 0 },
  size: { x: 0, y: 0, z: 0 },
  radius: 1,
});

describe('пересечение луча с коробкой', () => {
  const center = { x: 0, y: 0, z: 0 };
  const size = { x: 10, y: 10, z: 10 };

  it('луч в лоб попадает на границу коробки', () => {
    expect(intersectBox(ray({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: -1 }), center, size)).toBeCloseTo(95, 6);
  });

  it('луч мимо не попадает', () => {
    expect(intersectBox(ray({ x: 100, y: 0, z: 100 }, { x: 0, y: 0, z: -1 }), center, size)).toBeUndefined();
  });

  it('луч, идущий от коробки, не считается попаданием', () => {
    expect(intersectBox(ray({ x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 1 }), center, size)).toBeUndefined();
  });

  it('камера внутри корпуса: возвращается выход из коробки, а не промах', () => {
    // Пользователь заезжает камерой внутрь шкафа — это законная ситуация,
    // и указатель обязан продолжать работать.
    expect(intersectBox(ray(center, { x: 0, y: 0, z: -1 }), center, size)).toBeCloseTo(5, 6);
  });

  it('луч, параллельный граням, не даёт NaN', () => {
    // Деление на ноль здесь превратило бы промах в «попадание во всё».
    expect(intersectBox(ray({ x: 100, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), center, size)).toBeUndefined();
    expect(intersectBox(ray({ x: 0, y: -100, z: 0 }, { x: 0, y: 1, z: 0 }), center, size)).toBeCloseTo(95, 6);
  });

  it('касание грани — попадание, а не промах', () => {
    expect(intersectBox(ray({ x: 5, y: 0, z: 100 }, { x: 0, y: 0, z: -1 }), center, size)).toBeCloseTo(95, 6);
  });
});

describe('выбор объекта', () => {
  const near = box('near', { x: 0, y: 0, z: 50 }, { x: 10, y: 10, z: 10 });
  const far = box('far', { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
  const straight = ray({ x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: -1 });

  it('выбирается ближний объект', () => {
    expect(pick(sceneOf([far, near]), straight)?.object.id).toBe('near');
  });

  it('невыбираемый объект пропускается', () => {
    const locked = { ...near, selectable: false };
    expect(pick(sceneOf([far, locked]), straight)?.object.id).toBe('far');
  });

  it('невидимые объёмы по умолчанию не участвуют в выборе (§21)', () => {
    // Коробка ячейки накрывает полки внутри себя. Если бы она попадала
    // под указатель наравне с ними, щелчок по полке всегда доставался
    // бы ячейке — и «случайно выделен весь корпус» было бы нормой.
    const cell = box('cell', { x: 0, y: 0, z: 25 }, { x: 100, y: 100, z: 100 }, { kind: 'cell', visible: false });
    expect(pick(sceneOf([cell, far]), straight)?.object.id).toBe('far');
    expect(pick(sceneOf([cell, far]), straight, { includeVolumes: true })?.object.id).toBe('cell');
  });

  it('при равном расстоянии выигрывает объект меньшего объёма', () => {
    // Грань полки и грань ячейки совпадают: без этого правила щелчок по
    // краю полки достался бы ячейке.
    const shelf = box('shelf', { x: 0, y: 0, z: 0 }, { x: 100, y: 16, z: 100 });
    const cell = box('cell', { x: 0, y: 0, z: 0 }, { x: 100, y: 500, z: 100 });
    const fromTop = ray({ x: 0, y: 300, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(pick(sceneOf([cell, shelf]), fromTop)?.object.id).toBe('cell');
    const fromSide = ray({ x: 200, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(pick(sceneOf([cell, shelf]), fromSide)?.object.id).toBe('shelf');
  });

  it('фильтр по виду объекта позволяет выбрать именно ячейку', () => {
    const cell = box('cell', { x: 0, y: 0, z: 25 }, { x: 100, y: 100, z: 100 }, { kind: 'cell', visible: false });
    const hit = pick(sceneOf([cell, far, near]), straight, { includeVolumes: true, kinds: ['cell'] });
    expect(hit?.object.id).toBe('cell');
  });

  it('промах возвращает undefined, а не первый попавшийся объект', () => {
    expect(pick(sceneOf([near, far]), ray({ x: 900, y: 0, z: 200 }, { x: 0, y: 0, z: -1 }))).toBeUndefined();
  });

  it('точка попадания лежит на луче', () => {
    const hit = pick(sceneOf([near]), straight)!;
    expect(hit.point.z).toBeCloseTo(straight.origin.z - hit.distance, 6);
  });

  it('pickAll возвращает все попадания по возрастанию расстояния', () => {
    const hits = pickAll(sceneOf([far, near]), straight);
    expect(hits.map((h) => h.object.id)).toEqual(['near', 'far']);
  });
});

describe('выбор на настоящей геометрии', () => {
  const input = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
  const geometry = buildGeometry(input);
  const scene = buildScene(geometry, input.materials);
  const aspect = 4 / 3;

  it('щелчок в центр вида спереди попадает в деталь изделия', () => {
    const camera = cameraForPreset('front', scene, aspect);
    const ray0 = rayFromNdc(camera, aspect, 0, 0)!;
    const hit = pick(scene, ray0);
    expect(hit).toBeDefined();
    expect(geometry.parts.some((p) => p.id === hit?.object.id)).toBe(true);
  });

  it('щелчок далеко за пределами изделия ни во что не попадает', () => {
    const camera = cameraForPreset('front', scene, aspect);
    const ray0 = rayFromNdc(camera, aspect, 0.999, 0.999)!;
    expect(pick(scene, ray0)).toBeUndefined();
  });
});
