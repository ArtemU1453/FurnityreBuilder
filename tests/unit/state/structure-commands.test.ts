import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createPlinthBase } from '../../../src/domain/furniture/defaults.js';
import type { MaterialId } from '../../../src/domain/index.js';

/**
 * Команды задней стенки и цоколя (PROMPT 14 §18, §22 тест 21).
 *
 * Из буквального списка задания (`setBackWallConfig`, `setBackWallMaterial`,
 * `setBackWallPosition`, `setBackWallSplitMode`, `setPlinthConfig`,
 * `setPlinthHeight`, `setPlinthSetback`, `setPlinthCutout`) заведены три
 * команды, а не восемь: `SetBackPanel` (патч по `BackPanelSpec`), `SetBase`
 * (основание целиком или его снятие) и `UpdateBase` (патч по `BaseSpec`).
 * Восемь команд писали бы в три поля восемью путями — тот же довод, каким
 * PROMPT 12 обошёлся полем `patch.opening`, а PROMPT 13 — патчем материала.
 */

const store = () =>
  createDocumentStore(createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' }));

const carcassOf = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.carcass;
const MISSING: MaterialId = asId<'Material'>('no-such-material');

describe('SetBackPanel: монтаж, материал и разделение (§18)', () => {
  it('меняет монтаж (он же положение и толщина), undo возвращает прежний', () => {
    const s = store();
    const before = carcassOf(s).back.mount;
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { mount: { kind: 'inset-flush', thickness: 4 } } });
    expect(carcassOf(s).back.mount).toEqual({ kind: 'inset-flush', thickness: 4 });

    s.getState().undo();
    expect(carcassOf(s).back.mount).toEqual(before);
    s.getState().redo();
    expect(carcassOf(s).back.mount).toEqual({ kind: 'inset-flush', thickness: 4 });
  });

  it('отключение задней стенки — тот же патч монтажа', () => {
    const s = store();
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { mount: { kind: 'none' } } });
    expect(carcassOf(s).back.mount.kind).toBe('none');
  });

  it('неположительная толщина не принимается: истории нет', () => {
    const s = store();
    const before = carcassOf(s).back.mount;
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { mount: { kind: 'overlay', thickness: 0 } } });
    expect(carcassOf(s).back.mount).toEqual(before);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('меняет материал стенки на существующий', () => {
    const s = store();
    const id = asId<'Material'>(Object.keys(s.getState().project.materials.items)[0]!);
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { materialId: id } });
    expect(carcassOf(s).back.materialId).toBe(id);
  });

  it('несуществующий материал стенке не назначается', () => {
    const s = store();
    const before = carcassOf(s).back.materialId;
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { materialId: MISSING } });
    expect(carcassOf(s).back.materialId).toBe(before);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('меняет способ разделения, undo возвращает', () => {
    const s = store();
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { segmentation: 'per-section' } });
    expect(carcassOf(s).back.segmentation).toBe('per-section');
    s.getState().undo();
    expect(carcassOf(s).back.segmentation).toBe('single');
  });

  it('патч частичный: не указанные поля не трогаются', () => {
    const s = store();
    const material = carcassOf(s).back.materialId;
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { segmentation: 'per-section' } });
    expect(carcassOf(s).back.materialId).toBe(material);
    expect(carcassOf(s).back.mount.kind).toBe('overlay');
  });
});

describe('SetBase / UpdateBase: цоколь (§18)', () => {
  it('добавляет цоколь и убирает его через base: null', () => {
    const s = store();
    expect(carcassOf(s).base).toBeUndefined();

    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    expect(carcassOf(s).base?.height).toBe(100);

    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: null });
    expect(carcassOf(s).base).toBeUndefined();

    s.getState().undo();
    expect(carcassOf(s).base?.height).toBe(100);
  });

  it('setPlinthHeight: меняет высоту, undo/redo восстанавливают', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { height: 150 } });
    expect(carcassOf(s).base?.height).toBe(150);

    s.getState().undo();
    expect(carcassOf(s).base?.height).toBe(100);
    s.getState().redo();
    expect(carcassOf(s).base?.height).toBe(150);
  });

  it('отрицательная высота и отступ не принимаются', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { height: -10 } });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { setback: -5 } });
    expect(carcassOf(s).base?.height).toBe(100);
    expect(carcassOf(s).base?.setback).toBe(0);
  });

  it('setPlinthSetback: меняет отступ', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { setback: 40 } });
    expect(carcassOf(s).base?.setback).toBe(40);
  });

  it('setPlinthCutout: задаёт вырез и снимает его через null', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { cutout: { left: 100, right: 100, height: 60 } } });
    expect(carcassOf(s).base?.cutout).toEqual({ left: 100, right: 100, height: 60 });

    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { cutout: null } });
    expect(carcassOf(s).base?.cutout).toBeUndefined();

    s.getState().undo();
    expect(carcassOf(s).base?.cutout).toEqual({ left: 100, right: 100, height: 60 });
  });

  it('недопустимый вырез не принимается', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { cutout: { left: -1, right: 100, height: 60 } } });
    expect(carcassOf(s).base?.cutout).toBeUndefined();
  });

  it('состав царг задаётся явно', () => {
    const s = store();
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { parts: ['front', 'left', 'right'] } });
    expect(carcassOf(s).base?.parts).toEqual(['front', 'left', 'right']);
  });

  it('материал цоколя проверяется на существование и снимается через null', () => {
    const s = store();
    const id = asId<'Material'>(Object.keys(s.getState().project.materials.items)[0]!);
    s.getState().execute({ type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) });

    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { materialId: MISSING } });
    expect(carcassOf(s).base?.materialId).toBeUndefined();

    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { materialId: id } });
    expect(carcassOf(s).base?.materialId).toBe(id);

    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { materialId: null } });
    expect(carcassOf(s).base?.materialId).toBeUndefined();
  });

  it('UpdateBase без цоколя — no-op, история не пишется', () => {
    const s = store();
    s.getState().execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { height: 100 } });
    expect(carcassOf(s).base).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('несуществующее изделие — no-op для обеих команд', () => {
    const s = store();
    s.getState().execute({ type: 'SetBackPanel', furnitureIndex: 7, patch: { segmentation: 'per-section' } });
    s.getState().execute({ type: 'SetBase', furnitureIndex: 7, base: createPlinthBase(100) });
    expect(s.getState().history.past).toHaveLength(0);
  });
});
