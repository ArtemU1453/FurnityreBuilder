import { describe, expect, it } from 'vitest';
import { buildScene } from '../../../src/scene/adapter.js';
import { buildGizmos } from '../../../src/scene/gizmos.js';
import { pick } from '../../../src/scene/raycast.js';
import { cameraForPreset, rayFromNdc } from '../../../src/scene/camera.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { makeGeometryInputWithRoot } from '../geometry/helpers.js';

/**
 * Производительность чистых слоёв сцены (PROMPT 23 §31–§32).
 *
 * Проверяется то, что можно проверить детерминированно и без браузера:
 * сборка сцены и попадание луча. Скорость самой отрисовки измеряется
 * в браузере (`tests/e2e/scene-3d.spec.ts`) — в среде без GPU её
 * абсолютные числа ничего не значат.
 *
 * Бюджеты намеренно щедрые: тест ловит не «стало на 10% медленнее», а
 * появление квадратичной сложности — единственное, что реально ломает
 * большой проект.
 */

function scene(rows: number, columns: number, shelves: number) {
  const input = makeGeometryInputWithRoot(
    (ids) => createUniformGrid(ids, rows, columns, 16, 16, (leafIds) => createShelvesLeaf(leafIds, shelves)),
    { width: 400 * columns + 100, height: 400 * rows + 200, depth: 500, panelThickness: 16 },
  );
  const geometry = buildGeometry(input);
  return { input, geometry };
}

const measure = (fn: () => void, runs = 5): number => {
  fn();
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  return (performance.now() - started) / runs;
};

describe('размеры проектов (§32)', () => {
  const sizes: ReadonlyArray<{ label: string; rows: number; columns: number; shelves: number }> = [
    { label: '1 секция', rows: 1, columns: 1, shelves: 3 },
    { label: '4 секции', rows: 1, columns: 4, shelves: 4 },
    { label: 'сетка 4×4 с полками', rows: 4, columns: 4, shelves: 3 },
    { label: 'сетка 6×6 с полками', rows: 6, columns: 6, shelves: 4 },
  ];

  for (const size of sizes) {
    it(`${size.label}: сцена строится и остаётся корректной`, () => {
      const { input, geometry } = scene(size.rows, size.columns, size.shelves);
      const model = buildScene(geometry, input.materials);

      expect(model.objects.length).toBeGreaterThan(0);
      // Идентификаторы уникальны на любом размере: дубликат ломает и
      // выбор, и подсветку, и его легко не заметить на маленьком проекте.
      const ids = model.objects.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(Number.isFinite(model.radius)).toBe(true);
    });
  }

  it('сборка сцены растёт линейно, а не квадратично', () => {
    const small = scene(2, 2, 3);
    const large = scene(6, 6, 4);

    const smallCount = small.geometry.parts.length + small.geometry.cells.length;
    const largeCount = large.geometry.parts.length + large.geometry.cells.length;
    expect(largeCount).toBeGreaterThan(smallCount * 3);

    const smallMs = measure(() => buildScene(small.geometry, small.input.materials));
    const largeMs = measure(() => buildScene(large.geometry, large.input.materials));

    // Допуск на порядок: при квадратичной сложности рост объектов в 4 раза
    // дал бы 16-кратное замедление, и запас в 8 его не спрячет.
    const ratio = largeMs / Math.max(smallMs, 0.001);
    expect(ratio).toBeLessThan((largeCount / smallCount) * 8);
  });

  it('большой проект собирается за разумное время', () => {
    const { input, geometry } = scene(6, 6, 4);
    expect(measure(() => buildScene(geometry, input.materials))).toBeLessThan(50);
  });

  it('попадание луча на большом проекте укладывается в кадр', () => {
    const { input, geometry } = scene(6, 6, 4);
    const model = buildScene(geometry, input.materials);
    const camera = cameraForPreset('perspective', model, 4 / 3);
    const ray = rayFromNdc(camera, 4 / 3, 0.1, 0.1)!;
    // Один кадр при 60 fps — 16 мс. Выбор обязан быть заметно дешевле:
    // он случается на каждом движении указателя.
    expect(measure(() => pick(model, ray), 20)).toBeLessThan(4);
  });

  it('ручки не размножаются: их число равно числу внутренних границ плюс два', () => {
    // Иначе на большой сетке сцена заросла бы ручками, и попасть в деталь
    // стало бы невозможно.
    const { input, geometry } = scene(4, 4, 3);
    const gizmos = buildGizmos(input.furniture, geometry);
    const splits = geometry.cells.length;
    expect(gizmos.length).toBeLessThan(splits + 8);
  });
});
