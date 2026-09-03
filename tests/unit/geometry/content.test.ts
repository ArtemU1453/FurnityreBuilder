import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { contentKindOf, resolveContentGeometry } from '../../../src/geometry/content.js';
import { createSections, createSizedSplit, fixedSizes } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { collectLeaves, hasErrors } from '../../../src/domain/index.js';
import type { IdFactory, LeafFill, LeafNode } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Наполнение ячеек (PROMPT 9 §16–17).
 *
 * Модель наполнения — существующий `LeafFill`, размеченное объединение на
 * листе дерева. Второй сущности `Content` с полем `cellId` не заводится:
 * наполнение ЛЕЖИТ внутри ячейки, поэтому связь структурная, а не
 * поддерживаемая вручную. Обоснование — `src/geometry/content.ts`.
 */

const T = 16;
const DIMS = { width: 1200, height: 2000, depth: 500, panelThickness: T };

const shelfParts = (r: GeometryResult) =>
  r.parts.filter((p) => p.role === 'shelf-adjustable' || p.role === 'shelf-fixed');

const leafWith = (ids: IdFactory, fill: LeafFill): LeafNode => ({
  id: ids.next<'Node'>(),
  kind: 'leaf',
  fill,
});

const rod = (ids: IdFactory) => ({
  id: ids.next<'Node'>(),
  profile: 'round-25' as const,
  offsetFromTop: 60,
  offsetFromFront: 30,
  mount: 'flange' as const,
});

describe('Test 1: новая ячейка пуста', () => {
  it('createEmptyLeaf даёт наполнение empty', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.cells).toHaveLength(1);
    expect(contentKindOf(result.cells[0]!.fill)).toBe('empty');
  });

  it('каждая секция, созданная делением, тоже пуста', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createSections(ids, 3, T), DIMS));
    expect(result.cells).toHaveLength(3);
    expect(result.cells.every((c) => contentKindOf(c.fill) === 'empty')).toBe(true);
  });
});

describe('Test 2: пустое наполнение не создаёт деталей', () => {
  it('в изделии из пустых ячеек есть только детали корпуса и перегородки', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createSections(ids, 3, T), DIMS));
    expect(shelfParts(result)).toHaveLength(0);
    const roles = new Set(result.parts.map((p) => p.role));
    expect([...roles].sort()).toEqual(['bottom', 'partition', 'side', 'top']);
  });

  it('резолвер для empty возвращает статус empty и ни одной полки', () => {
    const resolution = resolveContentGeometry({ kind: 'empty' }, asId<'Node'>('cell-1'));
    expect(resolution).toEqual({
      cellId: 'cell-1',
      kind: 'empty',
      status: 'empty',
      shelves: [],
      drawers: [],
    });
  });
});

describe('контракт резолвера: нереализованные виды получают явный статус', () => {
  it('пустой список ящиков — статус empty, а не not-implemented (PROMPT 11, симметрично shelves)', () => {
    const fill: LeafFill = { kind: 'drawers', drawers: [] };
    const resolution = resolveContentGeometry(fill, asId<'Node'>('c'));
    expect(resolution.status).toBe('empty');
    expect(resolution.drawers).toEqual([]);
    expect(resolution.missing).toBeUndefined();
  });

  it('штанга с полкой: полка строится, штанга — нет, и это видно в статусе', () => {
    const ids = createSequentialIdFactory('r');
    const shelf = { id: asId<'Node'>('sh'), placement: { mode: 'manual' as const, offsetFromBottom: 100 }, mounting: 'fixed' as const };
    const resolution = resolveContentGeometry({ kind: 'rod+shelf', rod: rod(ids), shelfAbove: shelf }, asId<'Node'>('c'));
    expect(resolution.status).toBe('not-implemented');
    expect(resolution.missing).toBe('штанга');
    expect(resolution.shelves).toEqual([shelf]);
  });

  it('движок сообщает о нереализованном наполнении, а не молчит', () => {
    const ids = createSequentialIdFactory('r');
    const result = buildGeometry(
      makeGeometryInputWithRoot((leafIds) => leafWith(leafIds, { kind: 'rod', rod: rod(ids) }), DIMS),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('CONTENT_NOT_IMPLEMENTED');
    // Это не ошибка: модель корректна, просто геометрия для неё ещё не написана.
    expect(hasErrors(result.diagnostics)).toBe(false);
  });

  it('одна диагностика на вид наполнения, а не на каждую ячейку', () => {
    const ids = createSequentialIdFactory('r');
    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (leafIds) => createSizedSplit(leafIds, 'x', fixedSizes([300, 400]), T, (cellIds) => leafWith(cellIds, { kind: 'rod', rod: rod(ids) })),
        { ...DIMS, width: 300 + 400 + T + 2 * T },
      ),
    );
    const notImplemented = result.diagnostics.filter((d) => d.code === 'CONTENT_NOT_IMPLEMENTED');
    expect(result.cells).toHaveLength(2);
    expect(notImplemented).toHaveLength(1);
  });

  it('резолвер детерминирован: одинаковый вход даёт одинаковый результат', () => {
    const fill: LeafFill = { kind: 'drawers', drawers: [] };
    expect(resolveContentGeometry(fill, asId<'Node'>('c'))).toEqual(resolveContentGeometry(fill, asId<'Node'>('c')));
  });
});

describe('Test 5: изменение размеров ячейки не меняет её идентичность', () => {
  it('id ячейки — он же идентичность наполнения — переживает изменение габарита', () => {
    const build = (width: number) =>
      buildGeometry(
        makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), { ...DIMS, width }),
      );
    const before = build(1200);
    const after = build(1600);

    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.cells.map((c) => contentKindOf(c.fill))).toEqual(before.cells.map((c) => contentKindOf(c.fill)));
    // Полки внутри наполнения сохраняют свои id.
    expect(shelfParts(after).map((p) => p.id)).toEqual(shelfParts(before).map((p) => p.id));
    expect(after.cells[0]!.box.size.x).not.toBe(before.cells[0]!.box.size.x);
  });
});

describe('Test 6–7: изменение размеров секций и рядов не рвёт связь ячейка → наполнение', () => {
  const buildWithWidths = (widths: readonly number[]) =>
    buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => createSizedSplit(ids, 'x', fixedSizes(widths), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
        { ...DIMS, width: widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * T + 2 * T },
      ),
    );

  it('изменение sectionWidths: у тех же ячеек то же наполнение', () => {
    const before = buildWithWidths([300, 500, 400]);
    const after = buildWithWidths([200, 300, 700]);

    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.cells.map((c) => contentKindOf(c.fill))).toEqual(before.cells.map((c) => contentKindOf(c.fill)));
    expect(after.cells.map((c) => c.box.size.x)).not.toEqual(before.cells.map((c) => c.box.size.x));
  });

  it('изменение rowHeights: у тех же ячеек то же наполнение', () => {
    const buildWithHeights = (heights: readonly number[]) =>
      buildGeometry(
        makeGeometryInputWithRoot(
          (ids) => createSizedSplit(ids, 'y', fixedSizes(heights), T, (leafIds) => createShelvesLeaf(leafIds, 1, 'adjustable')),
          { ...DIMS, height: heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * T + 2 * T },
        ),
      );
    const before = buildWithHeights([500, 700, 500]);
    const after = buildWithHeights([400, 400, 900]);

    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.cells.map((c) => contentKindOf(c.fill))).toEqual(before.cells.map((c) => contentKindOf(c.fill)));
  });
});

describe('Test 8: удаление ячейки не оставляет осиротевшего наполнения', () => {
  it('наполнение исчезает вместе со своей ячейкой, потому что лежит внутри неё', () => {
    // Три секции с полками; удаляем третью, оставляя дерево из двух.
    const withThree = createSizedSplit;
    const three = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => withThree(ids, 'x', fixedSizes([300, 400, 400]), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
        { ...DIMS, width: 300 + 400 + 400 + 2 * T + 2 * T },
      ),
    );
    const two = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => withThree(ids, 'x', fixedSizes([300, 400]), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
        { ...DIMS, width: 300 + 400 + T + 2 * T },
      ),
    );

    expect(three.cells).toHaveLength(3);
    expect(two.cells).toHaveLength(2);
    // Полок ровно по числу ячеек × 2 — ни одной «ничьей».
    expect(shelfParts(three)).toHaveLength(6);
    expect(shelfParts(two)).toHaveLength(4);
    // Каждая полка принадлежит существующей ячейке.
    const cellIds = new Set(two.cells.map((c) => c.nodeId));
    expect(shelfParts(two).every((p) => p.origin.nodeId !== undefined && cellIds.has(p.origin.nodeId))).toBe(true);
  });

  it('в дереве нет наполнения без листа: оно и есть поле листа', () => {
    const input = makeGeometryInputWithRoot(
      (ids) => createSizedSplit(ids, 'x', fixedSizes([300, 400]), T, (leafIds) => createShelvesLeaf(leafIds, 1, 'adjustable')),
      { ...DIMS, width: 300 + 400 + T + 2 * T },
    );
    const leaves = collectLeaves(input.furniture.root);
    // Каждое наполнение достижимо ровно через один лист: списка наполнений,
    // который мог бы разойтись с деревом, в модели нет.
    expect(leaves.every((leaf) => leaf.fill !== undefined)).toBe(true);
    expect(leaves).toHaveLength(2);
  });
});

describe('Test 9: сериализация сохраняет наполнение', () => {
  it('вид наполнения и его содержимое переживают круговой путь через JSON', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const input = makeGeometryInputWithRoot(
      (ids) => createSizedSplit(ids, 'x', fixedSizes([300, 400]), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
      { ...DIMS, width: 300 + 400 + T + 2 * T },
    );
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const original = buildGeometry(input);
    const roundTripped = buildGeometry({ ...input, furniture: restored.furniture[0]! });

    expect(roundTripped.cells.map((c) => contentKindOf(c.fill))).toEqual(original.cells.map((c) => contentKindOf(c.fill)));
    expect(roundTripped).toEqual(original);
  });

  it('пустое наполнение тоже переживает круговой путь и остаётся empty', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const restored = fromJson(toJson(base)).project;
    const leaves = collectLeaves(restored.furniture[0]!.root);
    expect(leaves.map((l) => l.fill.kind)).toEqual(['empty']);
  });
});

describe('Test 11: неизвестный вид наполнения отклоняется', () => {
  it('разбор проекта с неизвестным kind даёт ошибку, а не молчаливое «пусто»', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const raw = JSON.parse(toJson(base)) as Record<string, unknown>;
    const doc = raw as { project: { furniture: { root: { fill: { kind: string } } }[] } };
    doc.project.furniture[0]!.root.fill = { kind: 'teleporter' };

    expect(() => fromJson(JSON.stringify(raw))).toThrow();
  });

  it('повреждённое содержимое наполнения тоже отклоняется', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const raw = JSON.parse(toJson(base)) as Record<string, unknown>;
    const doc = raw as { project: { furniture: { root: { fill: unknown } }[] } };
    doc.project.furniture[0]!.root.fill = { kind: 'shelves', shelves: [{ id: 'x' }] };

    expect(() => fromJson(JSON.stringify(raw))).toThrow();
  });
});

describe('Test 12: детерминизм расчёта с наполнением', () => {
  it('одинаковый вход даёт побайтово одинаковый результат', () => {
    const make = () =>
      makeGeometryInputWithRoot(
        (ids) => createSizedSplit(ids, 'x', fixedSizes([300, 400]), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
        { ...DIMS, width: 300 + 400 + T + 2 * T },
      );
    expect(buildGeometry(make())).toEqual(buildGeometry(make()));
  });
});

// ── §17 property-проверки ───────────────────────────────────────────────────

describe('property: наполнение и ячейка', () => {
  const gridInput = fc
    .record({ count: fc.integer({ min: 1, max: 5 }), shelves: fc.integer({ min: 0, max: 3 }) })
    .chain(({ count, shelves }) =>
      fc.record({
        count: fc.constant(count),
        shelves: fc.constant(shelves),
        width: fc.integer({ min: count * 120 + (count - 1) * T + 2 * T, max: 5000 }),
      }),
    );

  it('пустое наполнение никогда не порождает деталей наполнения', () => {
    fc.assert(
      fc.property(gridInput, ({ count, width }) => {
        const result = buildGeometry(
          makeGeometryInputWithRoot(
            (ids) => (count === 1 ? createEmptyLeaf(ids) : createSections(ids, count, T)),
            { ...DIMS, width },
          ),
        );
        expect(result.cells.every((c) => contentKindOf(c.fill) === 'empty')).toBe(true);
        expect(shelfParts(result)).toHaveLength(0);
      }),
    );
  });

  it('каждая деталь наполнения принадлежит существующей ячейке', () => {
    fc.assert(
      fc.property(gridInput, ({ count, shelves, width }) => {
        const leaf = (ids: IdFactory) =>
          shelves === 0 ? createEmptyLeaf(ids) : createShelvesLeaf(ids, shelves, 'adjustable');
        const result = buildGeometry(
          makeGeometryInputWithRoot(
            (ids) => (count === 1 ? leaf(ids) : createSections(ids, count, T, leaf)),
            { ...DIMS, width },
          ),
        );

        const cellIds = new Set(result.cells.map((c) => c.nodeId));
        for (const part of shelfParts(result)) {
          expect(part.origin.nodeId).toBeDefined();
          expect(cellIds.has(part.origin.nodeId!)).toBe(true);
        }
        expect(shelfParts(result)).toHaveLength(count * shelves);
      }),
    );
  });

  it('изменение габарита сохраняет идентичность ячеек и вид их наполнения', () => {
    fc.assert(
      fc.property(gridInput, fc.integer({ min: 100, max: 900 }), ({ count, shelves, width }, delta) => {
        const leaf = (ids: IdFactory) =>
          shelves === 0 ? createEmptyLeaf(ids) : createShelvesLeaf(ids, shelves, 'adjustable');
        const build = (w: number) =>
          buildGeometry(
            makeGeometryInputWithRoot(
              (ids) => (count === 1 ? leaf(ids) : createSections(ids, count, T, leaf)),
              { ...DIMS, width: w },
            ),
          );
        const before = build(width);
        const after = build(width + delta);

        expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
        expect(after.cells.map((c) => contentKindOf(c.fill))).toEqual(before.cells.map((c) => contentKindOf(c.fill)));
      }),
    );
  });
});
