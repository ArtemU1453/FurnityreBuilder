import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { asId } from '../../../src/domain/ids.js';
import { isLeaf, isSplit } from '../../../src/domain/furniture/tree.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const store = () => createDocumentStore(project());

describe('стор документа: команды', () => {
  it('изменяет модель через команду, а не прямой мутацией', () => {
    const s = store();
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 });
    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1200);
  });

  it('не пишет в историю команду, ничего не изменившую', () => {
    const s = store();
    s.getState().execute({ type: 'SetProjectName', name: s.getState().project.name });
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('сохраняет неизменённые поддеревья по ссылке — основа мемоизации расчёта', () => {
    const s = store();
    const before = s.getState().project.materials;
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 });
    expect(s.getState().project.materials).toBe(before);
  });

  it('делит секцию, заменяя лист узлом деления', () => {
    const s = store();
    const rootId = s.getState().project.furniture[0]!.root.id;
    s.getState().execute({
      type: 'SplitNode',
      furnitureIndex: 0,
      nodeId: rootId,
      axis: 'x',
      childIds: [asId<'Node'>('c1'), asId<'Node'>('c2')],
      dividerThickness: 16,
    });
    const root = s.getState().project.furniture[0]!.root;
    expect(isSplit(root)).toBe(true);
    expect(isSplit(root) ? root.children.length : 0).toBe(2);
  });

  it('SetRoot заменяет дерево секций целиком одним шагом истории', () => {
    const s = store();
    const newRoot = createUniformGrid(createSequentialIdFactory('g'), 2, 3, 16, 16);

    s.getState().execute({ type: 'SetRoot', furnitureIndex: 0, root: newRoot }, 'Сетка 2×3');

    expect(s.getState().project.furniture[0]!.root).toBe(newRoot);
    expect(s.getState().history.past).toHaveLength(1);

    s.getState().undo();
    expect(isLeaf(s.getState().project.furniture[0]!.root)).toBe(true);
  });
});

describe('стор документа: история', () => {
  it('отменяет и возвращает изменение', () => {
    const s = store();
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 });
    s.getState().undo();
    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1000);
    s.getState().redo();
    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1200);
  });

  it('новая команда очищает ветку возврата', () => {
    const s = store();
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 });
    s.getState().undo();
    expect(s.getState().canRedo()).toBe(true);
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 1800 });
    expect(s.getState().canRedo()).toBe(false);
  });

  it('undo на пустой истории безопасен', () => {
    const s = store();
    expect(() => {
      s.getState().undo();
      s.getState().redo();
    }).not.toThrow();
  });

  it('ограничивает глубину истории', () => {
    const s = createDocumentStore(project());
    for (let i = 0; i < 250; i += 1) {
      s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1000 + i });
    }
    expect(s.getState().history.past.length).toBeLessThanOrEqual(s.getState().history.limit);
  });
});

describe('стор документа: транзакции', () => {
  it('серия команд внутри жеста даёт один шаг отмены', () => {
    const s = store();
    s.getState().beginTransaction('Перетаскивание габарита');
    for (const value of [1100, 1150, 1200, 1250]) {
      s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value });
    }
    s.getState().endTransaction();

    expect(s.getState().history.past).toHaveLength(1);
    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1250);

    // Один Ctrl+Z возвращает к состоянию до жеста, а не на один кадр назад.
    s.getState().undo();
    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1000);
  });

  it('отмена жеста возвращает базовое состояние и не оставляет следа в истории', () => {
    const s = store();
    s.getState().beginTransaction('Перетаскивание');
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1400 });
    s.getState().cancelTransaction();

    expect(s.getState().project.furniture[0]?.dimensions.width).toBe(1000);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('жест без изменений не оставляет пустого шага', () => {
    const s = store();
    s.getState().beginTransaction('Нажал и отпустил');
    s.getState().endTransaction();
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('замена документа сбрасывает историю: чужой проект нельзя «отменить»', () => {
    const s = store();
    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 });
    s.getState().replaceProject(project());
    expect(s.getState().history.past).toHaveLength(0);
    expect(s.getState().canUndo()).toBe(false);
  });
});
