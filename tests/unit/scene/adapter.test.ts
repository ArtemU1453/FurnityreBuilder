import { describe, expect, it } from 'vitest';
import { buildScene, cellsOfSection, findSceneObject } from '../../../src/scene/adapter.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createDrawersLeaf, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from '../geometry/helpers.js';
import type { GeometryInput } from '../../../src/geometry/types.js';

/**
 * Адаптер сцены (PROMPT 23 §3, §5–§11).
 *
 * Главное, что здесь проверяется, — что адаптер НИЧЕГО не считает.
 * Каждое число объекта сцены обязано быть прослеживаемо к полю уже
 * построенной детали; единственное допустимое преобразование — перевод
 * минимального угла в центр коробки.
 */

const sceneOf = (input: GeometryInput) => buildScene(buildGeometry(input), input.materials);

describe('buildScene: корпус', () => {
  const input = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
  const geometry = buildGeometry(input);
  const scene = buildScene(geometry, input.materials);

  it('переносит КАЖДУЮ деталь движка, без списка ролей', () => {
    // Список ролей в адаптере означал бы, что новая роль молча исчезает
    // со сцены. Проверяется равенство множеств, а не «есть боковина».
    const partIds = scene.objects.filter((o) => o.kind === 'part').map((o) => o.id);
    expect(new Set(partIds)).toEqual(new Set(geometry.parts.map((p) => p.id)));
  });

  it('идентификатор объекта — это PartId, а не третий параллельный id', () => {
    const part = geometry.parts[0]!;
    expect(findSceneObject(scene, part.id)?.label).toBe(part.label);
  });

  it('переводит минимальный угол в центр коробки и не трогает размер', () => {
    const part = geometry.parts.find((p) => p.role === 'side')!;
    const object = findSceneObject(scene, part.id)!;
    expect(object.position).toEqual({
      x: part.position.x + part.size.x / 2,
      y: part.position.y + part.size.y / 2,
      z: part.position.z + part.size.z / 2,
    });
    expect(object.size).toEqual(part.size);
  });

  it('сохраняет толщину каждой детали такой, какой её посчитал движок (§5)', () => {
    for (const part of geometry.parts) {
      expect(findSceneObject(scene, part.id)?.size).toEqual(part.size);
    }
  });

  it('не добавляет объектов, которых нет в GeometryResult', () => {
    // Секция без деления — тот же узел, что и ячейка: изделие из одной
    // ячейки даёт объект ячейки и НЕ даёт отдельного объекта секции.
    const sectionsThatAreNotCells = geometry.sections.filter(
      (section) => !geometry.cells.some((cell) => cell.nodeId === section.nodeId),
    );
    const expected = geometry.parts.length + geometry.cells.length + sectionsThatAreNotCells.length;
    expect(scene.objects).toHaveLength(expected);
  });

  it('идентификаторы объектов сцены уникальны', () => {
    // Дубликат id ломает и поиск объекта, и попадание луча, и выделение.
    const ids = scene.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('берёт охват из измеренного boundingBox, а не из заявленного bounds', () => {
    expect(scene.size).toEqual({
      x: geometry.boundingBox.totalWidth,
      y: geometry.boundingBox.totalHeight,
      z: geometry.boundingBox.totalDepth,
    });
  });

  it('центр охвата лежит посередине между границами', () => {
    expect(scene.center.x).toBeCloseTo((geometry.boundingBox.minX + geometry.boundingBox.maxX) / 2, 6);
    expect(scene.center.y).toBeCloseTo((geometry.boundingBox.minY + geometry.boundingBox.maxY) / 2, 6);
  });

  it('радиус описанной сферы покрывает половину диагонали охвата', () => {
    expect(scene.radius).toBeCloseTo(Math.hypot(scene.size.x, scene.size.y, scene.size.z) / 2, 6);
  });
});

describe('buildScene: ячейки и секции — не детали (§6)', () => {
  const input = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 3, 16, 16), {
    width: 1600,
    height: 2000,
    depth: 500,
    panelThickness: 16,
  });
  const geometry = buildGeometry(input);
  const scene = buildScene(geometry, input.materials);

  it('ячейка попадает в сцену невидимой', () => {
    const cell = geometry.cells[0]!;
    const object = findSceneObject(scene, cell.nodeId)!;
    expect(object.kind).toBe('cell');
    expect(object.visible).toBe(false);
    expect(object.selectable).toBe(true);
  });

  it('коробка ячейки — та же, что посчитал движок', () => {
    const cell = geometry.cells[0]!;
    const object = findSceneObject(scene, cell.nodeId)!;
    expect(object.size).toEqual(cell.box.size);
  });

  it('у ячейки нет материала: рисовать её как деталь нечем', () => {
    const cell = geometry.cells[0]!;
    expect(findSceneObject(scene, cell.nodeId)?.material).toBeUndefined();
  });

  it('принадлежность ячейки секции берётся из движка, а не определяется заново', () => {
    const cell = geometry.cells[0]!;
    expect(findSceneObject(scene, cell.nodeId)?.parentId).toBe(cell.sectionId);
    expect(cellsOfSection(scene, cell.sectionId).map((o) => o.id)).toContain(cell.nodeId);
  });
});

describe('buildScene: наполнение и фасады', () => {
  it('полки попадают на сцену отдельными объектами со своими размерами (§7)', () => {
    const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3), {
      width: 800,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });
    const geometry = buildGeometry(input);
    const scene = buildScene(geometry, input.materials);
    const shelves = geometry.parts.filter((p) => p.role.startsWith('shelf'));
    expect(shelves.length).toBeGreaterThan(0);
    for (const shelf of shelves) {
      const object = findSceneObject(scene, shelf.id)!;
      expect(object.size).toEqual(shelf.size);
      expect(object.material?.materialId).toBe(shelf.materialId);
    }
  });

  it('перегородки — детали, а не секции (§8)', () => {
    const input = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 3, 16, 16), {
      width: 1600,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });
    const geometry = buildGeometry(input);
    const scene = buildScene(geometry, input.materials);
    const partition = geometry.parts.find((p) => p.role === 'partition')!;
    const object = findSceneObject(scene, partition.id)!;
    expect(object.kind).toBe('part');
    // Толщина перегородки — по X: это вертикальная стойка, а не область.
    expect(object.size.x).toBe(partition.size.x);
    expect(scene.objects.find((o) => o.id === partition.id && o.kind === 'section')).toBeUndefined();
  });

  it('фасады ящиков попадают на сцену (§10)', () => {
    const input = makeGeometryInputWithRoot((ids) => createDrawersLeaf(ids, 3), {
      width: 800,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });
    const geometry = buildGeometry(input);
    const scene = buildScene(geometry, input.materials);
    const facades = geometry.parts.filter((p) => p.role === 'facade');
    expect(facades.length).toBe(3);
    for (const facade of facades) expect(findSceneObject(scene, facade.id)).toBeDefined();
  });

  it('прозрачные объекты рисуются последними: иначе стекло скрывает то, что за ним (§30)', () => {
    const input = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
    const glassId = Object.values(input.materials.items).find((m) => m.kind === 'glass')?.id;
    if (glassId === undefined) return;
    const materials = { ...input.materials, assignment: { ...input.materials.assignment, facade: glassId } };
    const scene = sceneOf({ ...input, materials });
    const opacities = scene.objects.map((o) => o.material?.opacity ?? 1);
    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i]!).toBeLessThanOrEqual(opacities[i - 1]!);
    }
  });
});

describe('buildScene: вырожденный вход', () => {
  it('пустая геометрия даёт пустую сцену без NaN', () => {
    const scene = sceneOf(makeGeometryInput({ width: -100, height: 2000, depth: 500, panelThickness: 16 }));
    expect(Number.isFinite(scene.radius)).toBe(true);
    expect(Number.isFinite(scene.center.x)).toBe(true);
  });

  it('одинаковый вход даёт одинаковую сцену', () => {
    const input = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
    const a = sceneOf(input);
    const b = sceneOf(input);
    expect(a.objects.map((o) => o.id)).toEqual(b.objects.map((o) => o.id));
  });

  it('дверь на ячейке попадает на сцену со своей толщиной (§9)', () => {
    const ids = createSequentialIdFactory('door');
    const base = makeGeometryInput({ width: 800, height: 2000, depth: 500, panelThickness: 16 });
    const furniture = {
      ...base.furniture,
      facades: [createHingedFacade(ids, base.furniture.root.id, 1)],
    };
    const input = { ...base, furniture };
    const geometry = buildGeometry(input);
    const scene = buildScene(geometry, input.materials);
    const door = geometry.parts.find((p) => p.role === 'facade')!;
    const object = findSceneObject(scene, door.id)!;
    expect(object.size.z).toBe(door.size.z);
    expect(object.material).toBeDefined();
  });
});
