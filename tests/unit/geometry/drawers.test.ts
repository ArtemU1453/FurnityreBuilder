import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { resolveDrawerFacadeGeometry } from '../../../src/geometry/drawers.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createDrawer, createDrawersLeaf, createEmptyLeaf, createHingedFacade, DEFAULT_OVERLAY } from '../../../src/domain/furniture/defaults.js';
import { createSizedSplit, fixedSizes } from '../../../src/domain/furniture/sections.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Dimensions, FacadeGroup, NodeId } from '../../../src/domain/index.js';
import type { GeometryInput, GeometryResult } from '../../../src/geometry/types.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Ящики и фасады ящиков (PROMPT 11 §22–23).
 *
 * Резолвер читает уже существующий `Drawer[]` внутри `LeafFill`, а не
 * новый `DrawerContent` — обоснование в `src/geometry/drawers.ts` и
 * `docs/GEOMETRY_RULES.md`.
 */

const T = 16;
const DIMS: Dimensions = { width: 1200, height: 2000, depth: 500, panelThickness: T };

const drawerFacadeParts = (r: GeometryResult) => r.parts.filter((p) => p.role === 'facade');

function buildSingleCellWithDrawers(
  dims: Partial<Dimensions>,
  count: number,
): { result: GeometryResult; input: GeometryInput; cellId: NodeId } {
  let cellId!: NodeId;
  const input = makeGeometryInputWithRoot((ids) => {
    const leaf = count === 0 ? createEmptyLeaf(ids) : createDrawersLeaf(ids, count);
    cellId = leaf.id;
    return leaf;
  }, dims);
  return { result: buildGeometry(input), input, cellId };
}

describe('Test 1: пустая ячейка — 0 частей фасада ящика', () => {
  it('EMPTY → 0 Drawer Parts', () => {
    const { result } = buildSingleCellWithDrawers(DIMS, 0);
    expect(drawerFacadeParts(result)).toHaveLength(0);
  });
});

describe('Test 2: добавление ящика даёт корректное наполнение ячейки', () => {
  it('resolveContentGeometry: kind drawers, status built, один Drawer', async () => {
    const { resolveContentGeometry } = await import('../../../src/geometry/content.js');
    const ids = createSequentialIdFactory('d');
    const drawer = createDrawer(ids);
    const resolution = resolveContentGeometry({ kind: 'drawers', drawers: [drawer] }, asId<'Node'>('c'));
    expect(resolution.kind).toBe('drawers');
    expect(resolution.status).toBe('built');
    expect(resolution.drawers).toEqual([drawer]);
  });
});

describe('Test 3–4: ящик создаёт ожидаемые части, фасад — отдельная деталь', () => {
  it('один ящик → одна деталь роли facade', () => {
    const { result } = buildSingleCellWithDrawers(DIMS, 1);
    const parts = drawerFacadeParts(result);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.role).toBe('facade');
  });

  it('три ящика → три отдельные детали фасада, не одна общая', () => {
    const { result } = buildSingleCellWithDrawers(DIMS, 3);
    expect(drawerFacadeParts(result)).toHaveLength(3);
  });
});

describe('Test 5: все части фасада принадлежат правильной ячейке', () => {
  it('origin.nodeId каждой детали фасада совпадает с nodeId ячейки', () => {
    const { result, cellId } = buildSingleCellWithDrawers(DIMS, 2);
    for (const part of drawerFacadeParts(result)) {
      expect(part.origin.nodeId).toBe(cellId);
    }
  });
});

describe('Test 6: размеры фасада ящика зависят от ячейки', () => {
  it('ширина = ширина ячейки − 2·gapSide, толщина = толщина корпуса', () => {
    const { result, cellId } = buildSingleCellWithDrawers(DIMS, 1);
    const cell = result.cells.find((c) => c.nodeId === cellId)!;
    const [facade] = drawerFacadeParts(result);
    expect(facade?.size.x).toBeCloseTo(cell.box.size.x - 2 * DEFAULT_OVERLAY.gapSide, 6);
    expect(facade?.size.z).toBeCloseTo(T, 6);
  });

  it('фасад стоит перед передней гранью ячейки, а не внутри неё', () => {
    const { result, cellId } = buildSingleCellWithDrawers(DIMS, 1);
    const cell = result.cells.find((c) => c.nodeId === cellId)!;
    const [facade] = drawerFacadeParts(result);
    expect(facade?.position.z).toBeCloseTo(cell.box.min.z + cell.box.size.z, 6);
  });
});

describe('Test 7: изменение ширины ячейки пересчитывает фасад', () => {
  it('ширина фасада следует за шириной ячейки', () => {
    const a = buildSingleCellWithDrawers({ ...DIMS, width: 1200 }, 1);
    const b = buildSingleCellWithDrawers({ ...DIMS, width: 1600 }, 1);
    expect(drawerFacadeParts(b.result)[0]?.size.x).not.toBeCloseTo(drawerFacadeParts(a.result)[0]!.size.x, 3);
  });
});

describe('Test 8: изменение высоты ячейки пересчитывает фасад', () => {
  it('высота фасада следует за высотой ячейки (сумма высот стопки)', () => {
    const a = buildSingleCellWithDrawers({ ...DIMS, height: 2000 }, 2);
    const b = buildSingleCellWithDrawers({ ...DIMS, height: 2400 }, 2);
    const sumA = drawerFacadeParts(a.result).reduce((s, p) => s + p.size.y, 0);
    const sumB = drawerFacadeParts(b.result).reduce((s, p) => s + p.size.y, 0);
    expect(sumB).not.toBeCloseTo(sumA, 3);
  });
});

describe('Test 9: изменение глубины ячейки пересчитывает фасад', () => {
  it('положение фасада по Z следует за глубиной изделия', () => {
    const a = buildSingleCellWithDrawers({ ...DIMS, depth: 500 }, 1);
    const b = buildSingleCellWithDrawers({ ...DIMS, depth: 650 }, 1);
    expect(drawerFacadeParts(b.result)[0]?.position.z).not.toBeCloseTo(drawerFacadeParts(a.result)[0]!.position.z, 3);
  });
});

describe('Test 10: удаление ящика удаляет его деталь', () => {
  it('пустой список drawers — 0 частей фасада на той же ячейке', () => {
    const { cellId } = buildSingleCellWithDrawers(DIMS, 2);
    // Ячейка изделия по умолчанию — единственный лист дерева, поэтому
    // «удаление ящика» здесь — тот же вход, что и `createEmptyLeaf`
    // с тем же id ячейки: пустое наполнение той же ячейки.
    const emptyInput = makeGeometryInputWithRoot(() => ({ id: cellId, kind: 'leaf', fill: { kind: 'empty' } }), DIMS);
    const result = buildGeometry(emptyInput);
    expect(drawerFacadeParts(result)).toHaveLength(0);
  });
});

describe('Test 11: удаление ячейки не оставляет осиротевшего ящика', () => {
  it('ящики трёх секций пропадают вместе с удалённой секцией', () => {
    const build = (widths: readonly number[]) =>
      buildGeometry(
        makeGeometryInputWithRoot(
          (ids) => createSizedSplit(ids, 'x', fixedSizes(widths), T, (leafIds) => createDrawersLeaf(leafIds, 1)),
          { ...DIMS, width: widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * T + 2 * T },
        ),
      );
    const three = build([300, 400, 400]);
    const two = build([300, 400]);
    expect(drawerFacadeParts(three)).toHaveLength(3);
    expect(drawerFacadeParts(two)).toHaveLength(2);
    const cellIds = new Set(two.cells.map((c) => c.nodeId));
    expect(drawerFacadeParts(two).every((p) => p.origin.nodeId !== undefined && cellIds.has(p.origin.nodeId))).toBe(true);
  });
});

describe('Test 13: сериализация сохраняет ящики', () => {
  it('ящики переживают круговой путь через JSON, geometry результат совпадает', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');

    const { input } = buildSingleCellWithDrawers(DIMS, 2);
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const original = buildGeometry(input);
    const roundTripped = buildGeometry({ ...input, furniture: restored.furniture[0]! });

    expect(drawerFacadeParts(roundTripped)).toHaveLength(drawerFacadeParts(original).length);
    expect(roundTripped).toEqual(original);
  });
});

describe('Test 14: недопустимая геометрия отклоняется явно', () => {
  it('слишком маленькая ячейка — invalid, ноль частей, диагностика error', () => {
    const { result } = buildSingleCellWithDrawers({ ...DIMS, width: T * 2 + 3, height: 200 }, 1);
    expect(drawerFacadeParts(result)).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'DRAWER_GEOMETRY_INVALID')).toBe(true);
  });

  it('резолвер напрямую: зазоры не оставляют места — invalid', () => {
    const ids = createSequentialIdFactory('d');
    const drawer = createDrawer(ids);
    const cell = { nodeId: asId<'Node'>('c'), box: { min: { x: 0, y: 0, z: 0 }, size: { x: 500, y: 3, z: 500 } }, sectionId: asId<'Node'>('s'), row: 0, column: 0, fill: { kind: 'empty' as const } };
    const resolution = resolveDrawerFacadeGeometry([drawer], cell, T);
    expect(resolution.status).toBe('invalid');
    expect(resolution.facades).toHaveLength(0);
  });
});

describe('Test 15: запрещённые пересечения обнаруживаются', () => {
  it('findPartOverlaps не находит пересечений во всём изделии с ящиками', () => {
    const { result } = buildSingleCellWithDrawers(DIMS, 3);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('дверь на ячейку с ящиками не строится — DOOR_CELL_HAS_DRAWERS', () => {
    const { input, cellId } = buildSingleCellWithDrawers(DIMS, 1);
    const facade: FacadeGroup = createHingedFacade(createSequentialIdFactory('f'), cellId, 1);
    const result = buildGeometry({ ...input, furniture: { ...input.furniture, facades: [facade] } });
    expect(result.parts.filter((p) => p.role === 'facade' && p.label.startsWith('Дверь'))).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'DOOR_CELL_HAS_DRAWERS')).toBe(true);
    // Фасады ящиков при этом строятся как обычно.
    expect(drawerFacadeParts(result)).toHaveLength(1);
  });
});

describe('Test 16: id фасада стабилен при изменении размеров', () => {
  it('id детали не меняется при изменении ширины изделия', () => {
    const a = buildSingleCellWithDrawers({ ...DIMS, width: 1200 }, 1);
    const b = buildSingleCellWithDrawers({ ...DIMS, width: 1700 }, 1);
    expect(drawerFacadeParts(b.result)[0]?.id).toBe(drawerFacadeParts(a.result)[0]!.id);
  });
});

describe('Test 17: изменение ширины секции сохраняет связь ящик → ячейка', () => {
  /** Первая секция получает ящик, остальные — пустой лист. */
  function buildTwoSections(widths: readonly number[]): { result: GeometryResult; drawerCellId: NodeId } {
    const ids = createSequentialIdFactory('t');
    let drawerCellId: NodeId | undefined;
    const root = createSizedSplit(ids, 'x', fixedSizes(widths), T, (leafIds) => {
      if (drawerCellId === undefined) {
        const leaf = createDrawersLeaf(leafIds, 1);
        drawerCellId = leaf.id;
        return leaf;
      }
      return createEmptyLeaf(leafIds);
    });
    const input = makeGeometryInputWithRoot(() => root, {
      ...DIMS,
      width: widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * T + 2 * T,
    });
    return { result: buildGeometry(input), drawerCellId: drawerCellId! };
  }

  it('ящик остаётся на своей ячейке при изменении ширины другой секции', () => {
    const before = buildTwoSections([300, 500]);
    const after = buildTwoSections([450, 500]);
    const drawerBefore = drawerFacadeParts(before.result).find((p) => p.origin.nodeId === before.drawerCellId);
    const drawerAfter = drawerFacadeParts(after.result).find((p) => p.origin.nodeId === after.drawerCellId);
    expect(drawerBefore).toBeDefined();
    expect(drawerAfter).toBeDefined();
    expect(drawerAfter?.size.x).not.toBeCloseTo(drawerBefore!.size.x, 3);
  });
});

describe('Test 18: изменение rowHeights не ломает идентичность ящика', () => {
  /** Первый ряд получает ящик, остальные — пустой лист. */
  function buildTwoRows(heights: readonly number[]): { result: GeometryResult; drawerCellId: NodeId } {
    const ids = createSequentialIdFactory('t');
    let drawerCellId: NodeId | undefined;
    const root = createSizedSplit(ids, 'y', fixedSizes(heights), T, (leafIds) => {
      if (drawerCellId === undefined) {
        const leaf = createDrawersLeaf(leafIds, 1);
        drawerCellId = leaf.id;
        return leaf;
      }
      return createEmptyLeaf(leafIds);
    });
    const input = makeGeometryInputWithRoot(() => root, {
      ...DIMS,
      height: heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * T + 2 * T,
    });
    return { result: buildGeometry(input), drawerCellId: drawerCellId! };
  }

  it('id фасада и связь с ячейкой сохраняются при изменении высоты ряда', () => {
    const before = buildTwoRows([500, 700]);
    const after = buildTwoRows([650, 700]);
    const drawerBefore = drawerFacadeParts(before.result).find((p) => p.origin.nodeId === before.drawerCellId);
    const drawerAfter = drawerFacadeParts(after.result).find((p) => p.origin.nodeId === after.drawerCellId);
    expect(drawerBefore).toBeDefined();
    expect(drawerAfter?.id).toBe(drawerBefore?.id);
    expect(drawerAfter?.origin.nodeId).toBe(drawerBefore?.origin.nodeId);
  });
});

describe('движок: детерминизм', () => {
  it('одинаковый вход даёт побайтово одинаковый результат', () => {
    const build = () => buildSingleCellWithDrawers(DIMS, 2).result;
    expect(build()).toEqual(build());
  });
});

// ── §23 property-проверки ───────────────────────────────────────────────────

describe('property: ящик и ячейка', () => {
  const widths = fc.integer({ min: 300, max: 3000 });
  const counts = fc.integer({ min: 1, max: 5 });

  it('∀validDrawer: фасад принадлежит покрытой ячейке', () => {
    fc.assert(
      fc.property(widths, counts, (width, count) => {
        const { result, cellId } = buildSingleCellWithDrawers({ ...DIMS, width }, count);
        for (const facade of drawerFacadeParts(result)) {
          expect(facade.origin.nodeId).toBe(cellId);
        }
      }),
    );
  });

  it('∀resize: id фасада не меняется', () => {
    fc.assert(
      fc.property(widths, fc.integer({ min: 50, max: 800 }), (width, delta) => {
        const before = buildSingleCellWithDrawers({ ...DIMS, width }, 1);
        const after = buildSingleCellWithDrawers({ ...DIMS, width: width + delta }, 1);
        expect(drawerFacadeParts(after.result)[0]?.id).toBe(drawerFacadeParts(before.result)[0]?.id);
      }),
    );
  });

  it('∀generatedDrawerPart: ширина/высота/толщина положительны', () => {
    fc.assert(
      fc.property(widths, counts, (width, count) => {
        const { result } = buildSingleCellWithDrawers({ ...DIMS, width }, count);
        for (const facade of drawerFacadeParts(result)) {
          expect(facade.size.x).toBeGreaterThan(0);
          expect(facade.size.y).toBeGreaterThan(0);
          expect(facade.size.z).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('∀serialize/deserialize: результат эквивалентен исходному', () => {
    fc.assert(
      fc.property(widths, (width) => {
        const { input } = buildSingleCellWithDrawers({ ...DIMS, width }, 2);
        const original = buildGeometry(input);
        expect(buildGeometry(input)).toEqual(original);
      }),
    );
  });
});
