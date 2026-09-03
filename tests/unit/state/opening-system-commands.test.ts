import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory, asId } from '../../../src/domain/ids.js';
import { createDrawer, createHandleOpeningSystem, createHingedFacade, createPushToOpenSystem } from '../../../src/domain/furniture/defaults.js';
import type { NodeId, OpeningSystem } from '../../../src/domain/index.js';

/** Извлекает `placement` из `OpeningSystem`, если это ручка — иначе `undefined`. */
function placementOf(opening: OpeningSystem | undefined) {
  return opening?.kind === 'handle' ? opening.placement : undefined;
}

/**
 * Способ открывания через команды (PROMPT 12 §15–16).
 *
 * Ни одна новая команда не заведена: `setOpeningSystem`/`removeOpeningSystem`/
 * `addHandle`/`removeHandle`/`updateHandleConfig` из буквальной формулировки
 * задания покрыты полем `patch.opening` уже существующей `UpdateFacadeLeaf`
 * (дверь) и уже существующим `SetFill` (ящик) — тот же приём, каким PROMPT 10
 * и 11 обошлись без вторых командных слоёв. Обоснование —
 * `docs/GEOMETRY_RULES.md` §20.6.
 */

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const store = () => createDocumentStore(project());

const cellId = (s: ReturnType<typeof store>): NodeId => s.getState().project.furniture[0]!.root.id;
const facadesOf = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.facades;
const openingOf = (s: ReturnType<typeof store>): OpeningSystem | undefined => facadesOf(s)[0]?.leaves[0]?.opening;

describe('PROMPT 12 §16: дверь — добавить ручку → undo → redo → изменить → undo → redo → удалить → undo', () => {
  it('полный цикл истории сохраняет id ручки и восстанавливает каждый шаг', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    const leafId = facade.leaves[0]!.id;

    // 1. Добавить ручку.
    const handle = createHandleOpeningSystem(createSequentialIdFactory('h'), 'left');
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { opening: handle } });
    const afterAdd = openingOf(s);
    expect(afterAdd?.kind).toBe('handle');
    const handleId = afterAdd?.kind === 'handle' ? afterAdd.id : undefined;
    expect(handleId).toBe(handle.kind === 'handle' ? handle.id : undefined);

    // 2. Undo.
    s.getState().undo();
    expect(openingOf(s)).toBeUndefined();

    // 3. Redo.
    s.getState().redo();
    const afterRedo = openingOf(s);
    expect(afterRedo?.kind).toBe('handle');
    expect(afterRedo?.kind === 'handle' ? afterRedo.id : undefined).toBe(handleId);

    // 4. Изменить положение — тот же id ручки, другой offsetY.
    const current = openingOf(s);
    const currentPlacement = placementOf(current);
    const moved: OpeningSystem =
      current?.kind === 'handle' && currentPlacement !== undefined
        ? { ...current, placement: { ...currentPlacement, offsetY: 50 } }
        : handle;
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { opening: moved } });
    expect(placementOf(openingOf(s))?.offsetY).toBe(50);

    // 5. Undo.
    s.getState().undo();
    expect(placementOf(openingOf(s))?.offsetY).toBe(0);

    // 6. Redo.
    s.getState().redo();
    expect(placementOf(openingOf(s))?.offsetY).toBe(50);

    // 7. Удалить ручку.
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { opening: { kind: 'none' } } });
    expect(openingOf(s)?.kind).toBe('none');

    // 8. Undo.
    s.getState().undo();
    expect(placementOf(openingOf(s))?.offsetY).toBe(50);
  });
});

describe('PROMPT 12 §16: push-to-open — тот же цикл истории', () => {
  it('добавить → undo → redo → удалить → undo', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    const leafId = facade.leaves[0]!.id;

    const push = createPushToOpenSystem(createSequentialIdFactory('p'), 'left');
    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { opening: push } });
    expect(openingOf(s)?.kind).toBe('push-to-open');

    s.getState().undo();
    expect(openingOf(s)).toBeUndefined();

    s.getState().redo();
    expect(openingOf(s)?.kind).toBe('push-to-open');

    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { opening: { kind: 'none' } } });
    expect(openingOf(s)?.kind).toBe('none');

    s.getState().undo();
    expect(openingOf(s)?.kind).toBe('push-to-open');
  });
});

describe('Ящик: способ открывания через SetFill, undo/redo', () => {
  it('добавить ручку → undo → redo', () => {
    const s = store();
    const target = cellId(s);
    const drawer = createDrawer(createSequentialIdFactory('d'));
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [drawer] } });

    const handle = createHandleOpeningSystem(createSequentialIdFactory('h'));
    const withHandle = { ...drawer, facade: { ...drawer.facade, opening: handle } };
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [withHandle] } });

    const fillOf = () => {
      const root = s.getState().project.furniture[0]!.root;
      return root.kind === 'leaf' ? root.fill : undefined;
    };
    const fill1 = fillOf();
    expect(fill1?.kind === 'drawers' ? fill1.drawers[0]?.facade.opening?.kind : undefined).toBe('handle');

    s.getState().undo();
    const fill2 = fillOf();
    expect(fill2?.kind === 'drawers' ? fill2.drawers[0]?.facade.opening : undefined).toBeUndefined();

    s.getState().redo();
    const fill3 = fillOf();
    expect(fill3?.kind === 'drawers' ? fill3.drawers[0]?.facade.opening?.kind : undefined).toBe('handle');
  });
});

describe('Валидация: несуществующая ячейка/фасад — no-op', () => {
  it('UpdateFacadeLeaf с несуществующим facadeId не пишет историю', () => {
    const s = store();
    s.getState().execute({
      type: 'UpdateFacadeLeaf',
      furnitureIndex: 0,
      facadeId: asId<'Node'>('no-such-facade'),
      leafId: asId<'Node'>('no-such-leaf'),
      patch: { opening: { kind: 'none' } },
    });
    expect(s.getState().history.past).toHaveLength(0);
  });
});
