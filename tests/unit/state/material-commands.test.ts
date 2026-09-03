import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createHingedFacade } from '../../../src/domain/furniture/defaults.js';
import type { Material, MaterialId, NodeId } from '../../../src/domain/index.js';

/**
 * Команды материалов и толщин (PROMPT 13 §18).
 *
 * Из буквального списка задания (`setProjectMaterial`, `setPartMaterial`,
 * `setPartThicknessOverride`, `setPartEdge`, `removePartEdge`) новой
 * заведена ровно одна — `SetDefaultMaterial`: остальные покрыты уже
 * существующими `SetMaterialAssignment`/`UpsertMaterial`/`RemoveMaterial`
 * (реестр и назначение по ролям), `UpdateFacadeLeaf` (материал, кромка,
 * толщина створки — включая их СНЯТИЕ через `null`) и `SetFill` (полки и
 * ящики, тем же приёмом, каким PROMPT 11/12 обошлись без вторых команд).
 * `SetDefaultMaterial` закрывает единственный реальный пробел: поле
 * `settings.defaultMaterialId` существовало и проверялось валидацией, а
 * изменить его было нечем.
 */

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const store = () => createDocumentStore(project());

const MDF_18: Material = {
  id: asId<'Material'>('mdf-18'),
  name: 'МДФ 18 мм',
  kind: 'mdf',
  thickness: 18,
  displayColor: '#E4D9C3',
  grain: 'none',
};

const MISSING: MaterialId = asId<'Material'>('no-such-material');

describe('UpsertMaterial / RemoveMaterial: реестр материалов', () => {
  it('добавляет материал в реестр и откатывает добавление', () => {
    const s = store();
    s.getState().execute({ type: 'UpsertMaterial', material: MDF_18 });
    expect(s.getState().project.materials.items[MDF_18.id]?.thickness).toBe(18);

    s.getState().undo();
    expect(s.getState().project.materials.items[MDF_18.id]).toBeUndefined();

    s.getState().redo();
    expect(s.getState().project.materials.items[MDF_18.id]?.name).toBe('МДФ 18 мм');
  });

  it('меняет толщину уже существующего материала тем же Upsert, не заводя второй материал', () => {
    const s = store();
    const id = asId<'Material'>(Object.keys(s.getState().project.materials.items)[0]!);
    const before = s.getState().project.materials.items[id]!;
    const count = Object.keys(s.getState().project.materials.items).length;

    s.getState().execute({ type: 'UpsertMaterial', material: { ...before, thickness: 18 } });

    expect(s.getState().project.materials.items[id]?.thickness).toBe(18);
    expect(Object.keys(s.getState().project.materials.items)).toHaveLength(count);
  });

  it('неположительная толщина материала не принимается: истории нет', () => {
    const s = store();
    s.getState().execute({ type: 'UpsertMaterial', material: { ...MDF_18, thickness: 0 } });
    expect(s.getState().project.materials.items[MDF_18.id]).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('удаление материала оставляет ссылки битыми намеренно, а не подменяет их молча', () => {
    const s = store();
    const id = asId<'Material'>(Object.keys(s.getState().project.materials.items)[0]!);
    s.getState().execute({ type: 'RemoveMaterial', materialId: id });
    expect(s.getState().project.materials.items[id]).toBeUndefined();
    // Назначение роли осталось прежним — валидация покажет битую ссылку.
    expect(s.getState().project.materials.assignment.side).toBe(id);
  });
});

describe('SetMaterialAssignment: материал роли', () => {
  it('назначает существующий материал роли, undo возвращает прежний', () => {
    const s = store();
    const before = s.getState().project.materials.assignment['shelf-adjustable'];
    s.getState().execute({ type: 'UpsertMaterial', material: MDF_18 });
    s.getState().execute({ type: 'SetMaterialAssignment', role: 'shelf-adjustable', materialId: MDF_18.id });

    expect(s.getState().project.materials.assignment['shelf-adjustable']).toBe(MDF_18.id);
    s.getState().undo();
    expect(s.getState().project.materials.assignment['shelf-adjustable']).toBe(before);
  });

  it('несуществующий материал не назначается: команда не создаёт битую ссылку', () => {
    const s = store();
    s.getState().execute({ type: 'SetMaterialAssignment', role: 'shelf-adjustable', materialId: MISSING });
    expect(s.getState().project.materials.assignment['shelf-adjustable']).not.toBe(MISSING);
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe('SetDefaultMaterial: материал проекта по умолчанию (§18)', () => {
  it('меняет settings.defaultMaterialId, undo/redo восстанавливают', () => {
    const s = store();
    const before = s.getState().project.settings.defaultMaterialId;
    s.getState().execute({ type: 'UpsertMaterial', material: MDF_18 });
    s.getState().execute({ type: 'SetDefaultMaterial', materialId: MDF_18.id });

    expect(s.getState().project.settings.defaultMaterialId).toBe(MDF_18.id);
    s.getState().undo();
    expect(s.getState().project.settings.defaultMaterialId).toBe(before);
    s.getState().redo();
    expect(s.getState().project.settings.defaultMaterialId).toBe(MDF_18.id);
  });

  it('несуществующий материал не становится материалом проекта', () => {
    const s = store();
    s.getState().execute({ type: 'SetDefaultMaterial', materialId: MISSING });
    expect(s.getState().project.settings.defaultMaterialId).not.toBe(MISSING);
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe('UpdateFacadeLeaf: материал, толщина и кромка створки (§18)', () => {
  const withFacade = () => {
    const s = store();
    const cellId: NodeId = s.getState().project.furniture[0]!.root.id;
    const facade = createHingedFacade(createSequentialIdFactory('f'), cellId, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    return { s, facadeId: facade.id, leafId: facade.leaves[0]!.id };
  };

  const leafOf = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.facades[0]?.leaves[0];

  it('setPartMaterial: назначает существующий материал створке', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({ type: 'UpsertMaterial', material: MDF_18 });
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { materialId: MDF_18.id } });
    expect(leafOf(s)?.materialId).toBe(MDF_18.id);
  });

  it('битый материал створке не назначается', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { materialId: MISSING } });
    expect(leafOf(s)?.materialId).toBeUndefined();
  });

  it('setPartMaterial с null снимает переопределение материала', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({ type: 'UpsertMaterial', material: MDF_18 });
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { materialId: MDF_18.id } });
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { materialId: null } });
    expect(leafOf(s)?.materialId).toBeUndefined();

    s.getState().undo();
    expect(leafOf(s)?.materialId).toBe(MDF_18.id);
  });

  it('setPartThicknessOverride: положительная толщина принимается, неположительная — нет', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { thickness: 22 } });
    expect(leafOf(s)?.thickness).toBe(22);

    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { thickness: 0 } });
    expect(leafOf(s)?.thickness).toBe(22);
  });

  it('removePartThicknessOverride: null возвращает толщину материала', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { thickness: 22 } });
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { thickness: null } });
    expect(leafOf(s)?.thickness).toBeUndefined();
  });

  it('setPartEdge: кромка створки задаётся и снимается через null (removePartEdge)', () => {
    const { s, facadeId, leafId } = withFacade();
    const edge = { front: 2, back: 0, left: 0.4, right: 0.4 } as const;
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { edge } });
    expect(leafOf(s)?.edge?.front).toBe(2);

    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId, leafId, patch: { edge: null } });
    expect(leafOf(s)?.edge).toBeUndefined();

    s.getState().undo();
    expect(leafOf(s)?.edge?.front).toBe(2);
  });

  it('кромка с несуществующим материалом не принимается', () => {
    const { s, facadeId, leafId } = withFacade();
    s.getState().execute({
      type: 'UpdateFacadeLeaf',
      furnitureIndex: 0,
      facadeId,
      leafId,
      patch: { edge: { front: 2, back: 0, left: 0.4, right: 0.4, materialId: MISSING } },
    });
    expect(leafOf(s)?.edge).toBeUndefined();
  });
});
