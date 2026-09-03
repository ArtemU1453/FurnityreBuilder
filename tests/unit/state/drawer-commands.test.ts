import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawer } from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { LeafFill, NodeId } from '../../../src/domain/index.js';

/**
 * Test 12 (PROMPT 11 §22): undo/redo для ящиков.
 *
 * Отдельной команды `addDrawerToCell`/`removeDrawerFromCell` не заводится:
 * ящик — уже существующий `LeafFill.kind === 'drawers'`, поэтому та же
 * команда `SetFill`, что уже обслуживает полки (`document-store.test.ts`,
 * «Test 10: undo и redo восстанавливают наполнение»), обслуживает и его —
 * без второй системы состояния (PROMPT 11 §17/§28).
 */

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const store = () => createDocumentStore(project());

const cellId = (s: ReturnType<typeof store>): NodeId => s.getState().project.furniture[0]!.root.id;
const fillOf = (s: ReturnType<typeof store>): LeafFill | undefined => {
  const root = s.getState().project.furniture[0]!.root;
  return root.kind === 'leaf' ? root.fill : undefined;
};

describe('SetFill с ящиками: команды и история', () => {
  it('SetFill добавляет ящик в ячейку', () => {
    const s = store();
    const target = cellId(s);
    const drawer = createDrawer(createSequentialIdFactory('d'));

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [drawer] } });

    const fill = fillOf(s);
    expect(fill?.kind).toBe('drawers');
    expect(fill?.kind === 'drawers' ? fill.drawers.map((d) => d.id) : []).toEqual([drawer.id]);
  });

  it('undo убирает ящик, redo возвращает его с тем же id', () => {
    const s = store();
    const target = cellId(s);
    const drawer = createDrawer(createSequentialIdFactory('d'));

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [drawer] } });
    expect(fillOf(s)?.kind).toBe('drawers');

    s.getState().undo();
    expect(fillOf(s)?.kind).toBe('empty');

    s.getState().redo();
    const fill = fillOf(s);
    expect(fill?.kind).toBe('drawers');
    expect(fill?.kind === 'drawers' ? fill.drawers[0]?.id : undefined).toBe(drawer.id);
  });

  it('добавление второго ящика и undo — тот же приоритет идентичности, что и у полок', () => {
    const s = store();
    const target = cellId(s);
    const ids = createSequentialIdFactory('d');
    const first = createDrawer(ids);
    const second = createDrawer(ids);

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [first] } });
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [first, second] } });

    const fill = fillOf(s);
    expect(fill?.kind === 'drawers' ? fill.drawers.map((d) => d.id) : []).toEqual([first.id, second.id]);

    s.getState().undo();
    const back = fillOf(s);
    expect(back?.kind === 'drawers' ? back.drawers.map((d) => d.id) : []).toEqual([first.id]);
  });

  it('удаление последнего ящика возвращает наполнение к empty, undo восстанавливает ящик', () => {
    const s = store();
    const target = cellId(s);
    const drawer = createDrawer(createSequentialIdFactory('d'));
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [drawer] } });

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'empty' } });
    expect(fillOf(s)?.kind).toBe('empty');

    s.getState().undo();
    expect(fillOf(s)?.kind).toBe('drawers');
  });

  it('после undo пересчёт геометрии не строит фасадов ящика', () => {
    const s = store();
    const target = cellId(s);
    const drawer = createDrawer(createSequentialIdFactory('d'));
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'drawers', drawers: [drawer] } });
    s.getState().undo();

    const furniture = s.getState().project.furniture[0]!;
    const result = buildGeometry({
      furniture,
      scheme: s.getState().project.settings.construction,
      tolerances: s.getState().project.settings.tolerances,
      materials: s.getState().project.materials,
      edgeSizing: s.getState().project.settings.edgeSizing,
    });
    expect(result.parts.filter((p) => p.role === 'facade')).toHaveLength(0);
  });
});
