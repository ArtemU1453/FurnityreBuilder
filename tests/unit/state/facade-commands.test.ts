import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory, asId } from '../../../src/domain/ids.js';
import { createHingedFacade } from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { NodeId } from '../../../src/domain/index.js';

/**
 * Команды фасада: `AddFacade`/`RemoveFacade`/`UpdateFacadeLeaf` (PROMPT 10 §17).
 *
 * Имена — уже существовавшие `PLANNED_COMMANDS` (`src/state/commands.ts`),
 * а не `addDoorToCell`/`removeDoorFromCell`/`updateDoorConfig` из буквальной
 * формулировки задания: архитектура уже держала для них место с более
 * ранних этапов (`docs/DATA_MODEL.md` §7), заводить вторую пару имён для
 * того же действия смысла не было.
 */

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const store = () => createDocumentStore(project());

const cellId = (s: ReturnType<typeof store>): NodeId => s.getState().project.furniture[0]!.root.id;
const facadesOf = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.facades;

describe('AddFacade', () => {
  it('добавляет фасад в Furniture.facades', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);

    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });

    expect(facadesOf(s)).toHaveLength(1);
    expect(facadesOf(s)[0]?.id).toBe(facade.id);
  });

  it('одна команда — один шаг истории, геометрия строит дверную деталь', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);

    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });

    const furniture = s.getState().project.furniture[0]!;
    const result = buildGeometry({
      furniture,
      scheme: s.getState().project.settings.construction,
      tolerances: s.getState().project.settings.tolerances,
      materials: s.getState().project.materials,
      edgeSizing: s.getState().project.settings.edgeSizing,
    });
    expect(result.parts.filter((p) => p.role === 'facade')).toHaveLength(1);
  });

  it('не назначает второй фасад на уже покрытую ячейку', () => {
    const s = store();
    const target = cellId(s);
    const ids = createSequentialIdFactory('f');
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade: createHingedFacade(ids, target, 1) });
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade: createHingedFacade(ids, target, 1) });

    expect(facadesOf(s)).toHaveLength(1);
  });

  it('игнорирует фасад, ссылающийся на несуществующий узел', () => {
    const s = store();
    const facade = createHingedFacade(createSequentialIdFactory('f'), asId<'Node'>('no-such-node'), 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    expect(facadesOf(s)).toHaveLength(0);
  });
});

describe('RemoveFacade', () => {
  it('убирает фасад по id', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });

    s.getState().execute({ type: 'RemoveFacade', furnitureIndex: 0, facadeId: facade.id });

    expect(facadesOf(s)).toHaveLength(0);
  });

  it('неизвестный id — no-op, история не пишется', () => {
    const s = store();
    s.getState().execute({ type: 'RemoveFacade', furnitureIndex: 0, facadeId: asId<'Node'>('nope') });
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe('UpdateFacadeLeaf', () => {
  it('меняет сторону петель одной створки', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });

    s.getState().execute({
      type: 'UpdateFacadeLeaf',
      furnitureIndex: 0,
      facadeId: facade.id,
      leafId: facade.leaves[0]!.id,
      patch: { hingeSide: 'right' },
    });

    expect(facadesOf(s)[0]?.leaves[0]?.hingeSide).toBe('right');
  });

  it('меняет материал створки через существующий materialId, без второй системы материалов', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    const materialId = Object.keys(s.getState().project.materials.items)[0]!;

    s.getState().execute({
      type: 'UpdateFacadeLeaf',
      furnitureIndex: 0,
      facadeId: facade.id,
      leafId: facade.leaves[0]!.id,
      patch: { materialId: asId<'Material'>(materialId) },
    });

    expect(facadesOf(s)[0]?.leaves[0]?.materialId).toBe(materialId);
  });
});

describe('Test 10 (PROMPT 10 §20): undo/redo восстанавливают дверь', () => {
  it('AddFacade → undo убирает фасад → redo возвращает его с тем же id', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);

    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    expect(facadesOf(s)).toHaveLength(1);

    s.getState().undo();
    expect(facadesOf(s)).toHaveLength(0);

    s.getState().redo();
    expect(facadesOf(s)).toHaveLength(1);
    expect(facadesOf(s)[0]?.id).toBe(facade.id);
  });

  it('RemoveFacade → undo возвращает фасад', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });

    s.getState().execute({ type: 'RemoveFacade', furnitureIndex: 0, facadeId: facade.id });
    expect(facadesOf(s)).toHaveLength(0);

    s.getState().undo();
    expect(facadesOf(s)).toHaveLength(1);
    expect(facadesOf(s)[0]?.id).toBe(facade.id);
  });

  it('UpdateFacadeLeaf → undo восстанавливает прежнюю сторону петель', () => {
    const s = store();
    const target = cellId(s);
    const facade = createHingedFacade(createSequentialIdFactory('f'), target, 1);
    s.getState().execute({ type: 'AddFacade', furnitureIndex: 0, facade });
    const leafId = facade.leaves[0]!.id;

    s.getState().execute({ type: 'UpdateFacadeLeaf', furnitureIndex: 0, facadeId: facade.id, leafId, patch: { hingeSide: 'right' } });
    expect(facadesOf(s)[0]?.leaves[0]?.hingeSide).toBe('right');

    s.getState().undo();
    expect(facadesOf(s)[0]?.leaves[0]?.hingeSide).toBe('left');
  });
});
