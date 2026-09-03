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

/**
 * Политика идентичности при изменении числа секций (PROMPT 7 §14–15).
 * До этой команды сетку меняли через `SetRoot`, который подменял дерево
 * целиком — и потому менял id даже у секций, которых пользователь не
 * касался. Здесь проверяется именно сохранение идентичности, а не сам
 * факт изменения количества.
 */
describe('стор документа: SetSectionCount и идентичность секций', () => {
  const sectionIds = (s: ReturnType<typeof store>): string[] => {
    const root = s.getState().project.furniture[0]!.root;
    return isSplit(root) ? root.children.map((c) => c.node.id) : [root.id];
  };

  const setCount = (s: ReturnType<typeof store>, count: number, prefix: string): void => {
    s.getState().execute({
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count,
      splitId: asId<'Node'>(`${prefix}-split`),
      newSectionIds: [0, 1, 2, 3, 4].map((i) => asId<'Node'>(`${prefix}-${String(i)}`)),
      dividerThickness: 16,
    });
  };

  it('1 → 3: исходная секция остаётся первой и сохраняет свой id', () => {
    const s = store();
    const originalRootId = s.getState().project.furniture[0]!.root.id;

    setCount(s, 3, 'a');

    const ids = sectionIds(s);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(originalRootId);
  });

  it('3 → 4: id существующих трёх секций не меняются, добавляется одна новая', () => {
    const s = store();
    setCount(s, 3, 'a');
    const before = sectionIds(s);

    setCount(s, 4, 'b');
    const after = sectionIds(s);

    expect(after).toHaveLength(4);
    expect(after.slice(0, 3)).toEqual(before);
    expect(before).not.toContain(after[3]);
  });

  it('4 → 3: исчезает последняя секция, оставшиеся сохраняют id и порядок', () => {
    const s = store();
    setCount(s, 4, 'a');
    const before = sectionIds(s);

    setCount(s, 3, 'b');
    const after = sectionIds(s);

    expect(after).toEqual(before.slice(0, 3));
  });

  it('3 → 1: остаётся первая секция целиком, вместе со своим наполнением', () => {
    const s = store();
    setCount(s, 3, 'a');
    const firstId = sectionIds(s)[0];

    // Наполним первую секцию, чтобы проверить, что схлопывание сохраняет
    // не только id, но и содержимое секции.
    s.getState().execute({
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: asId<'Node'>(firstId!),
      fill: { kind: 'shelves', shelves: [{ id: asId<'Node'>('sh-1'), placement: { mode: 'manual', offsetFromBottom: 500 }, mounting: 'adjustable' }] },
    });

    setCount(s, 1, 'b');

    const root = s.getState().project.furniture[0]!.root;
    expect(root.id).toBe(firstId);
    expect(isLeaf(root) ? root.fill.kind : 'split').toBe('shelves');
  });

  it('изменение числа секций — один шаг истории, и undo возвращает прежнюю структуру', () => {
    const s = store();
    setCount(s, 3, 'a');
    const before = sectionIds(s);

    setCount(s, 4, 'b');
    expect(sectionIds(s)).toHaveLength(4);

    s.getState().undo();
    expect(sectionIds(s)).toEqual(before);
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

/**
 * Изменение размера отдельной секции или ряда (PROMPT 8 §18–19, §22).
 * Команда одна на все три случая — секция, ряд, колонка: чем является
 * ребёнок, определяет ось его родителя, а не тип команды.
 */
describe('стор документа: SetChildSize по идентификатору', () => {
  const threeSections = (s: ReturnType<typeof store>): { ids: string[] } => {
    s.getState().execute({
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: asId<'Node'>('split'),
      newSectionIds: [asId<'Node'>('s2'), asId<'Node'>('s3')],
      dividerThickness: 16,
    });
    const root = s.getState().project.furniture[0]!.root;
    return { ids: isSplit(root) ? root.children.map((c) => c.node.id) : [] };
  };

  const sizeOf = (s: ReturnType<typeof store>, childId: string) => {
    const root = s.getState().project.furniture[0]!.root;
    return isSplit(root) ? root.children.find((c) => c.node.id === childId)?.size : undefined;
  };

  it('меняет размер именно той секции, которая названа по id', () => {
    const s = store();
    const { ids } = threeSections(s);

    s.getState().execute({
      type: 'SetChildSize',
      furnitureIndex: 0,
      childId: asId<'Node'>(ids[1]!),
      size: { mode: 'fixed', value: 500 },
    });

    expect(sizeOf(s, ids[1]!)).toEqual({ mode: 'fixed', value: 500 });
    // Соседей команда не трогает: они остаются растягиваемыми.
    expect(sizeOf(s, ids[0]!)).toEqual({ mode: 'flex', weight: 1 });
    expect(sizeOf(s, ids[2]!)).toEqual({ mode: 'flex', weight: 1 });
  });

  it('идентификаторы секций не меняются от изменения размера', () => {
    const s = store();
    const { ids } = threeSections(s);

    s.getState().execute({
      type: 'SetChildSize',
      furnitureIndex: 0,
      childId: asId<'Node'>(ids[0]!),
      size: { mode: 'fixed', value: 300 },
    });

    const after = s.getState().project.furniture[0]!.root;
    expect(isSplit(after) ? after.children.map((c) => c.node.id) : []).toEqual(ids);
  });

  it('undo возвращает прежний размер, redo — новый', () => {
    const s = store();
    const { ids } = threeSections(s);
    const target = asId<'Node'>(ids[0]!);

    s.getState().execute({ type: 'SetChildSize', furnitureIndex: 0, childId: target, size: { mode: 'fixed', value: 300 } });
    expect(sizeOf(s, ids[0]!)).toEqual({ mode: 'fixed', value: 300 });

    s.getState().execute({ type: 'SetChildSize', furnitureIndex: 0, childId: target, size: { mode: 'fixed', value: 350 } });
    expect(sizeOf(s, ids[0]!)).toEqual({ mode: 'fixed', value: 350 });

    s.getState().undo();
    expect(sizeOf(s, ids[0]!)).toEqual({ mode: 'fixed', value: 300 });

    s.getState().redo();
    expect(sizeOf(s, ids[0]!)).toEqual({ mode: 'fixed', value: 350 });
  });

  it('история хранит параметр, а не снимок геометрии: после undo пересчёт даёт прежние размеры', async () => {
    const { buildGeometry } = await import('../../../src/geometry/engine.js');
    const geometryOf = (st: ReturnType<typeof store>) => {
      const p = st.getState().project;
      return buildGeometry({
        furniture: p.furniture[0]!,
        scheme: p.settings.construction,
        tolerances: p.settings.tolerances,
        materials: p.materials,
        edgeSizing: p.settings.edgeSizing,
      });
    };

    const s = store();
    const { ids } = threeSections(s);
    const target = asId<'Node'>(ids[0]!);

    s.getState().execute({ type: 'SetChildSize', furnitureIndex: 0, childId: target, size: { mode: 'fixed', value: 300 } });
    const at300 = geometryOf(s).sections.map((sec) => sec.box.size.x);

    s.getState().execute({ type: 'SetChildSize', furnitureIndex: 0, childId: target, size: { mode: 'fixed', value: 350 } });
    expect(geometryOf(s).sections[0]!.box.size.x).toBe(350);

    s.getState().undo();
    // Геометрия не хранилась и не восстанавливалась — она пересчитана заново
    // из вернувшегося параметра.
    expect(geometryOf(s).sections.map((sec) => sec.box.size.x)).toEqual(at300);
  });

  it('команда с неизвестным id ничего не меняет', () => {
    const s = store();
    const { ids } = threeSections(s);
    const before = ids.map((id) => sizeOf(s, id));

    s.getState().execute({
      type: 'SetChildSize',
      furnitureIndex: 0,
      childId: asId<'Node'>('нет-такого-узла'),
      size: { mode: 'fixed', value: 999 },
    });

    expect(ids.map((id) => sizeOf(s, id))).toEqual(before);
  });
});

/**
 * Наполнение ячейки через команды (PROMPT 9 §13, тесты 3, 4, 10).
 *
 * Отдельных команд `setCellContent`/`clearCellContent`/`updateContentConfig`
 * не заводится: все три — это одна операция «положить в ячейку такое
 * наполнение», и `SetFill` её уже выражает. Очистка — наполнение `empty`,
 * правка конфигурации — новое значение того же вида: `LeafFill` неизменяем,
 * поэтому «изменить поле внутри» и «положить обновлённое наполнение» —
 * одно и то же действие.
 */
describe('стор документа: наполнение ячейки', () => {
  const cellId = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.root.id;
  const fillOf = (s: ReturnType<typeof store>) => {
    const root = s.getState().project.furniture[0]!.root;
    return isLeaf(root) ? root.fill : undefined;
  };

  const shelvesFill = (id: string) =>
    ({
      kind: 'shelves' as const,
      shelves: [{ id: asId<'Node'>(id), placement: { mode: 'auto' as const, index: 0, count: 1 }, mounting: 'adjustable' as const }],
    });

  it('Test 3: SetFill кладёт наполнение в существующую ячейку', () => {
    const s = store();
    expect(fillOf(s)?.kind).toBe('empty');

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: asId<'Node'>(cellId(s)), fill: shelvesFill('sh-1') });

    const fill = fillOf(s);
    expect(fill?.kind).toBe('shelves');
    expect(fill?.kind === 'shelves' ? fill.shelves[0]?.id : undefined).toBe('sh-1');
  });

  it('Test 4: очистка — это наполнение empty, а не удаление ячейки', () => {
    const s = store();
    const target = asId<'Node'>(cellId(s));
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: shelvesFill('sh-1') });

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: { kind: 'empty' } });

    expect(fillOf(s)?.kind).toBe('empty');
    // Ячейка на месте: очистили наполнение, а не структуру.
    expect(cellId(s)).toBe(target);
  });

  it('Test 10: undo и redo восстанавливают наполнение', () => {
    const s = store();
    const target = asId<'Node'>(cellId(s));

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: shelvesFill('sh-1') });
    expect(fillOf(s)?.kind).toBe('shelves');

    s.getState().undo();
    expect(fillOf(s)?.kind).toBe('empty');

    s.getState().redo();
    expect(fillOf(s)?.kind).toBe('shelves');
    const fill = fillOf(s);
    expect(fill?.kind === 'shelves' ? fill.shelves[0]?.id : undefined).toBe('sh-1');
  });

  it('правка конфигурации наполнения — то же SetFill с новым значением', () => {
    const s = store();
    const target = asId<'Node'>(cellId(s));
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: shelvesFill('sh-1') });

    const updated = {
      kind: 'shelves' as const,
      shelves: [
        { id: asId<'Node'>('sh-1'), placement: { mode: 'auto' as const, index: 0, count: 2 }, mounting: 'fixed' as const },
        { id: asId<'Node'>('sh-2'), placement: { mode: 'auto' as const, index: 1, count: 2 }, mounting: 'fixed' as const },
      ],
    };
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: target, fill: updated });

    const fill = fillOf(s);
    expect(fill?.kind === 'shelves' ? fill.shelves.map((sh) => sh.id) : []).toEqual(['sh-1', 'sh-2']);
    // Идентичность первой полки сохранена: обновление конфигурации не
    // пересоздаёт то, что пользователь не трогал.
    s.getState().undo();
    const back = fillOf(s);
    expect(back?.kind === 'shelves' ? back.shelves.map((sh) => sh.id) : []).toEqual(['sh-1']);
  });

  it('наполнение нельзя положить в узел деления — только в ячейку', () => {
    const s = store();
    s.getState().execute({
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 2,
      splitId: asId<'Node'>('split'),
      newSectionIds: [asId<'Node'>('s2')],
      dividerThickness: 16,
    });
    const root = s.getState().project.furniture[0]!.root;
    expect(isSplit(root)).toBe(true);

    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: asId<'Node'>(root.id), fill: shelvesFill('sh-1') });

    // Узел деления остался делением: наполнение к нему не прилипло.
    const after = s.getState().project.furniture[0]!.root;
    expect(isSplit(after)).toBe(true);
  });

  it('наполнение несуществующей ячейки не меняет проект', () => {
    const s = store();
    const before = s.getState().project;
    s.getState().execute({ type: 'SetFill', furnitureIndex: 0, nodeId: asId<'Node'>('нет-такой'), fill: shelvesFill('sh-1') });
    expect(s.getState().project).toBe(before);
  });
});
