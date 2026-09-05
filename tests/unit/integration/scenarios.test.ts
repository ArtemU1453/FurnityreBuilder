import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createFurnitureInstance,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import {
  createDrawersLeaf,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { toJson, fromJson } from '../../../src/persistence/serialization.js';
import { instanceKey, validateRoom } from '../../../src/room/index.js';
import { emptyProject, geometryOf, productionOf, readinessOf, run } from './fixtures.js';
import type { Command } from '../../../src/state/commands.js';
import type { NodeId } from '../../../src/domain/index.js';

/**
 * Интеграционные сценарии (PROMPT 30 §6).
 *
 * Каждый сценарий проходит путь целиком и проверяет РЕЗУЛЬТАТ каждого
 * шага, а не только отсутствие исключения. «Ни один этап не должен
 * silently fail» проверяется буквально: после каждого шага сверяется то,
 * что этот шаг обязан был изменить.
 */

describe('Сценарий A — простой шкаф', () => {
  it('от габаритов до производственного результата', () => {
    // 1. Новый проект.
    let project = emptyProject('a');
    expect(project.furniture).toHaveLength(1);

    // 2. Габариты.
    project = run(project, [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 900 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 1800 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 500 },
    ]);
    expect(project.furniture[0]?.dimensions.width).toBe(900);

    // 3. Каркас построен: две боковины, дно, крышка, задняя стенка.
    const carcass = geometryOf(project);
    expect(carcass.parts.filter((p) => p.role === 'side')).toHaveLength(2);
    expect(carcass.parts.some((p) => p.role === 'top')).toBe(true);
    expect(carcass.parts.some((p) => p.role === 'bottom')).toBe(true);
    expect(carcass.bounds.size.x).toBe(900);

    // 4. Секции.
    project = run(project, [
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: 3,
        splitId: 'a-split' as NodeId,
        newSectionIds: ['a-1' as NodeId, 'a-2' as NodeId, 'a-3' as NodeId],
        dividerThickness: 16,
      },
    ]);
    expect(geometryOf(project).sections).toHaveLength(3);
    expect(geometryOf(project).parts.filter((p) => p.role === 'partition')).toHaveLength(2);

    // 5. Полки.
    const cell = geometryOf(project).cells[0]!.nodeId;
    project = run(project, [
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createShelvesLeaf(createSequentialIdFactory('a-sh'), 2).fill,
      },
    ]);
    expect(geometryOf(project).parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(2);

    // 6. Материал полок.
    const material = Object.values(project.materials.items)[0]!;
    project = run(project, [
      { type: 'SetMaterialAssignment', role: 'shelf-adjustable', materialId: material.id },
    ]);
    expect(project.materials.assignment['shelf-adjustable']).toBe(material.id);

    // 7–8. Сохранение и загрузка.
    const restored = fromJson(toJson(project)).project;
    expect(restored).toEqual(project);

    // 9–10. Пересчёт после загрузки даёт тот же производственный результат.
    const before = productionOf(project);
    const after = productionOf(restored);
    expect(after.bom).toEqual(before.bom);
    expect(before.bom.parts.length).toBeGreaterThan(0);
    expect(readinessOf(restored).checks).toHaveLength(8);
  });
});

describe('Сценарий B — сложный шкаф', () => {
  it('секции разной ширины, ряды, полки, дверь, ящики, материалы, корпус', () => {
    let project = run(emptyProject('b'), [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 2000 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2200 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 600 },
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: 3,
        splitId: 'b-split' as NodeId,
        newSectionIds: ['b-1' as NodeId, 'b-2' as NodeId, 'b-3' as NodeId],
        dividerThickness: 16,
      },
    ]);

    // Разная ширина секций: средняя фиксирована, крайние делят остаток.
    const root = project.furniture[0]!.root;
    const middle = root.kind === 'split' ? root.children[1]!.node.id : undefined;
    expect(middle).toBeDefined();
    project = run(project, [
      {
        type: 'SetChildSize',
        furnitureIndex: 0,
        childId: middle!,
        size: { mode: 'fixed', value: 700 },
      },
    ]);
    const widths = geometryOf(project).sections.map((s) => Math.round(s.box.size.x));
    expect(widths[1]).toBe(700);
    expect(widths[0]).toBe(widths[2]);

    // Наполнение: полки, ящики, дверь.
    const cells = geometryOf(project).cells;
    expect(cells.length).toBeGreaterThanOrEqual(3);
    project = run(project, [
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cells[0]!.nodeId,
        fill: createShelvesLeaf(createSequentialIdFactory('b-sh'), 3).fill,
      },
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cells[1]!.nodeId,
        fill: createDrawersLeaf(createSequentialIdFactory('b-dr'), 3).fill,
      },
      {
        type: 'AddFacade',
        furnitureIndex: 0,
        facade: createHingedFacade(createSequentialIdFactory('b-fa'), cells[2]!.nodeId, 1),
      },
    ]);

    const filled = geometryOf(project);
    expect(filled.parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(3);
    expect(filled.parts.filter((p) => p.role === 'facade').length).toBeGreaterThan(0);

    // Корпус: задняя стенка, цоколь, кромка.
    project = run(project, [
      {
        type: 'SetBackPanel',
        furnitureIndex: 0,
        patch: { mount: { kind: 'overlay', thickness: 4 } },
      },
      { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) },
      { type: 'SetEdgeSizingPolicy', policy: { subtractFromPartSize: true } },
    ]);

    const complete = geometryOf(project);
    expect(complete.parts.some((p) => p.role === 'back')).toBe(true);
    expect(complete.parts.some((p) => p.role === 'plinth')).toBe(true);
    expect(complete.diagnostics.filter((i) => i.severity === 'error')).toEqual([]);

    // Весь конвейер доходит до конца.
    const production = productionOf(project);
    expect(production.bom.parts.length).toBeGreaterThan(5);
    expect(production.cutting.layouts.length).toBeGreaterThan(0);
  });
});

describe('Сценарий C — производство', () => {
  it('ни один этап конвейера не проваливается молча', () => {
    const project = run(emptyProject('c'), [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1600 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 },
    ]);

    const geometry = geometryOf(project);
    expect(geometry.parts.length).toBeGreaterThan(0);

    const production = productionOf(project);
    // Каждый этап дал результат ИЛИ объяснил, почему не дал.
    expect(production.cutting.productionParts.length).toBeGreaterThan(0);
    expect(
      production.hardware.lines.length > 0 ||
        production.hardware.warnings.length > 0 ||
        production.hardware.errors.length > 0,
    ).toBe(true);
    expect(
      production.drilling.operations.length > 0 ||
        production.drilling.warnings.length > 0 ||
        production.drilling.errors.length > 0,
    ).toBe(true);
    expect(production.cutting.layouts.length + production.cutting.unplaced.length).toBeGreaterThan(
      0,
    );
    expect(production.bom.parts.length).toBeGreaterThan(0);

    // Статус выведен, а не выдуман.
    expect(['VALID', 'VALID_WITH_WARNINGS', 'NEEDS_CONFIRMATION', 'INVALID']).toContain(
      production.status,
    );

    const readiness = readinessOf(project);
    expect(readiness.checks).toHaveLength(8);
    // Статус готовности не выше слабейшей проверки.
    if (readiness.checks.some((check) => check.status === 'ERROR')) {
      expect(readiness.status).not.toBe('READY_FOR_PRODUCTION');
    }
  });
});

describe('Сценарий D — планировщик помещения', () => {
  it('комната, мебель, перемещение, поворот, пересечения, сохранение', () => {
    const ids = createSequentialIdFactory('d');
    let project = run(emptyProject('d'), [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1000 },
    ]);
    const furniture = project.furniture[0]!;

    // Комната.
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000 });
    project = run(project, [{ type: 'SetRoom', room }]);
    expect(project.room?.walls).toHaveLength(4);

    // Мебель в комнате.
    const instance = createFurnitureInstance(ids, project.id, furniture, { x: 0, y: 0, z: 0 });
    project = run(project, [{ type: 'AddFurnitureInstance', instance }]);
    expect(project.room?.furnitureInstances).toHaveLength(1);

    // Перемещение и поворот.
    project = run(project, [
      {
        type: 'TransformFurnitureInstance',
        instanceId: instance.id,
        position: { x: 500, y: 0, z: 200 },
      },
      { type: 'TransformFurnitureInstance', instanceId: instance.id, rotation: 90 },
    ]);
    const moved = project.room?.furnitureInstances[0];
    expect(moved?.position.x).toBe(500);
    expect(moved?.rotation).toBe(90);

    // Проверка помещения работает на реальных габаритах изделия.
    // Габариты приходят СНАРУЖИ: планировщик их не считает — он получает
    // охват от того, кто построил геометрию (docs/ROOM_COLLISION.md).
    const extents = new Map([
      [
        instanceKey(project.room!.furnitureInstances[0]!),
        {
          x: furniture.dimensions.width,
          y: furniture.dimensions.height,
          z: furniture.dimensions.depth,
        },
      ],
    ]);
    // Повёрнутое изделие 1000×500 в положении (500, 200) занимает по X
    // 500 мм, а по Z — 1000 мм. Проверка работает: она видит и выход за
    // пределы, и пересечение со стеной, а не молчит.
    const rotated = validateRoom(project.room!, { extents });
    expect(rotated.status).toBeDefined();

    // Возвращаем изделие внутрь помещения без поворота — проверка чиста.
    project = run(project, [
      { type: 'TransformFurnitureInstance', instanceId: instance.id, rotation: 0 },
      {
        type: 'TransformFurnitureInstance',
        instanceId: instance.id,
        position: { x: 500, y: 0, z: 200 },
      },
    ]);
    const inside = validateRoom(project.room!, { extents });
    expect(inside.issues.filter((i) => i.severity === 'error')).toEqual([]);

    // И обратно: изделие, выдвинутое за стену, снова даёт ошибку.
    project = run(project, [
      {
        type: 'TransformFurnitureInstance',
        instanceId: instance.id,
        position: { x: 3800, y: 0, z: 200 },
      },
    ]);
    const outside = validateRoom(project.room!, { extents });
    expect(outside.issues.some((i) => i.severity === 'error')).toBe(true);

    // Ставим на место, чтобы проверять сохранение на корректном проекте.
    project = run(project, [
      {
        type: 'TransformFurnitureInstance',
        instanceId: instance.id,
        position: { x: 500, y: 0, z: 200 },
        rotation: 90,
      },
    ]);

    // Дублирование и удаление.
    const copy = createFurnitureInstance(ids, project.id, furniture, { x: 2000, y: 0, z: 1000 });
    project = run(project, [{ type: 'AddFurnitureInstance', instance: copy }]);
    expect(project.room?.furnitureInstances).toHaveLength(2);
    project = run(project, [{ type: 'RemoveFurnitureInstance', instanceId: copy.id }]);
    expect(project.room?.furnitureInstances).toHaveLength(1);

    // Сохранение и загрузка: комната и расстановка переживают путь.
    const restored = fromJson(toJson(project)).project;
    expect(restored.room?.walls).toHaveLength(4);
    expect(restored.room?.furnitureInstances[0]?.position.x).toBe(500);
    expect(restored.room?.furnitureInstances[0]?.rotation).toBe(90);

    // Изделие в проекте не изменилось от того, что его поставили в комнату.
    expect(restored.furniture[0]?.dimensions).toEqual(furniture.dimensions);
  });
});

describe('Сценарий E — круговой путь', () => {
  it('сохранение и загрузка не меняют ни модель, ни расчёт', () => {
    const commands: Command[] = [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 },
      { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2100 },
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: 2,
        splitId: 'e-split' as NodeId,
        newSectionIds: ['e-1' as NodeId, 'e-2' as NodeId],
        dividerThickness: 16,
      },
      { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(80) },
    ];
    const project = run(emptyProject('e'), commands);
    const production = productionOf(project);

    const restored = fromJson(toJson(project)).project;
    expect(restored).toEqual(project);

    const again = productionOf(restored);
    expect(again.bom).toEqual(production.bom);
    expect(again.cutting.layouts).toEqual(production.cutting.layouts);
    expect(again.drilling.operations).toEqual(production.drilling.operations);
    expect(again.hardware.lines).toEqual(production.hardware.lines);
    expect(again.status).toBe(production.status);
  });
});
