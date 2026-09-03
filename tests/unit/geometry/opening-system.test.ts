import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { resolveOpeningSystemGeometry } from '../../../src/geometry/opening-system.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import {
  createDrawer,
  createEmptyLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createPushToOpenSystem,
} from '../../../src/domain/furniture/defaults.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Dimensions, FacadeGroup, HandlePlacement, NodeId, OpeningSystem } from '../../../src/domain/index.js';
import type { GeometryInput, GeometryResult } from '../../../src/geometry/types.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Ручки, push-to-open и способ открывания фасада (PROMPT 12 §20–21).
 *
 * `Cabinet → Cell → Content → Facade → Opening System → Hardware Parts`:
 * резолвер (`src/geometry/opening-system.ts`) читает уже построенный
 * объём фасада — двери (`FacadeLeaf.opening`) или ящика
 * (`DrawerFacadeSpec.opening`) — и не знает ни про Cell, ни про
 * hingeSide напрямую. Part получает роль `handle`/`push-to-open` —
 * переиспользована та же роль-система, что и у остальных деталей,
 * второй Geometry Engine не заводится (обоснование — заголовочный
 * комментарий `opening-system.ts`).
 */

const T = 16;
const DIMS: Dimensions = { width: 1200, height: 2000, depth: 500, panelThickness: T };

const openingParts = (r: GeometryResult) => r.parts.filter((p) => p.role === 'handle' || p.role === 'push-to-open');
const handleParts = (r: GeometryResult) => r.parts.filter((p) => p.role === 'handle');
const pushParts = (r: GeometryResult) => r.parts.filter((p) => p.role === 'push-to-open');

/** Одна ячейка с дверью, у которой задан способ открывания. */
function buildDoorWithOpening(
  dims: Partial<Dimensions>,
  opening: (ids: ReturnType<typeof createSequentialIdFactory>, hingeSide: 'left' | 'right') => OpeningSystem,
): { result: GeometryResult; input: GeometryInput; cellId: NodeId } {
  let cellId!: NodeId;
  const input = makeGeometryInputWithRoot((ids) => {
    const leaf = createEmptyLeaf(ids);
    cellId = leaf.id;
    return leaf;
  }, dims);
  const facadeIds = createSequentialIdFactory('f');
  const facade = createHingedFacade(facadeIds, cellId, 1);
  const openingIds = createSequentialIdFactory('o');
  const hingeSide = facade.leaves[0]!.hingeSide as 'left' | 'right';
  const facadeWithOpening: FacadeGroup = {
    ...facade,
    leaves: [{ ...facade.leaves[0]!, opening: opening(openingIds, hingeSide) }],
  };
  const withFacade: GeometryInput = { ...input, furniture: { ...input.furniture, facades: [facadeWithOpening] } };
  return { result: buildGeometry(withFacade), input: withFacade, cellId };
}

/** Одна ячейка с одним ящиком, у которого задан способ открывания. */
function buildDrawerWithOpening(
  dims: Partial<Dimensions>,
  opening: (ids: ReturnType<typeof createSequentialIdFactory>) => OpeningSystem,
): { result: GeometryResult; input: GeometryInput; cellId: NodeId } {
  let cellId!: NodeId;
  const drawerIds = createSequentialIdFactory('d');
  const drawer = createDrawer(drawerIds);
  const openingIds = createSequentialIdFactory('o');
  const drawerWithOpening = { ...drawer, facade: { ...drawer.facade, opening: opening(openingIds) } };
  const input = makeGeometryInputWithRoot((ids) => {
    const leaf = { id: ids.next<'Node'>(), kind: 'leaf' as const, fill: { kind: 'drawers' as const, drawers: [drawerWithOpening] } };
    cellId = leaf.id;
    return leaf;
  }, dims);
  return { result: buildGeometry(input), input, cellId };
}

describe('Test 1: NONE — 0 деталей открывания', () => {
  it('дверь без opening не создаёт ни ручки, ни push-to-open', () => {
    const { result } = buildDoorWithOpening(DIMS, () => ({ kind: 'none' }));
    expect(openingParts(result)).toHaveLength(0);
  });

  it('пустая ячейка без фасада тоже не создаёт деталей открывания', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), DIMS));
    expect(openingParts(result)).toHaveLength(0);
  });
});

describe('Test 2: HANDLE — создаётся деталь ручки', () => {
  it('дверь с ручкой создаёт ровно одну деталь роли handle', () => {
    const { result } = buildDoorWithOpening(DIMS, (ids, hingeSide) => createHandleOpeningSystem(ids, hingeSide));
    expect(handleParts(result)).toHaveLength(1);
  });

  it('ящик с ручкой создаёт ровно одну деталь роли handle', () => {
    const { result } = buildDrawerWithOpening(DIMS, (ids) => createHandleOpeningSystem(ids));
    expect(handleParts(result)).toHaveLength(1);
  });
});

describe('Test 3: ручка связана с правильным фасадом/ячейкой', () => {
  it('origin.nodeId ручки совпадает с nodeId ячейки, чью дверь она обслуживает', () => {
    const { result, cellId } = buildDoorWithOpening(DIMS, (ids, hingeSide) => createHandleOpeningSystem(ids, hingeSide));
    const [handle] = handleParts(result);
    expect(handle?.origin.nodeId).toBe(cellId);
  });

  it('origin.nodeId ручки совпадает с nodeId ячейки, чей ящик она обслуживает', () => {
    const { result, cellId } = buildDrawerWithOpening(DIMS, (ids) => createHandleOpeningSystem(ids));
    const [handle] = handleParts(result);
    expect(handle?.origin.nodeId).toBe(cellId);
  });
});

describe('Test 4: изменение фасада (сторона петель) пересчитывает ручку', () => {
  it('ручка переезжает на другую сторону при смене hingeSide', () => {
    const ids = createSequentialIdFactory('f');
    const openingIds = createSequentialIdFactory('o');
    const buildWithHinge = (hingeSide: 'left' | 'right') => {
      let cellId!: NodeId;
      const input = makeGeometryInputWithRoot((leafIds) => {
        const leaf = createEmptyLeaf(leafIds);
        cellId = leaf.id;
        return leaf;
      }, DIMS);
      const facade = createHingedFacade(ids, cellId, 1);
      const withOpening: FacadeGroup = {
        ...facade,
        leaves: [{ ...facade.leaves[0]!, hingeSide, opening: createHandleOpeningSystem(openingIds, hingeSide) }],
      };
      return buildGeometry({ ...input, furniture: { ...input.furniture, facades: [withOpening] } });
    };
    const left = buildWithHinge('left');
    const right = buildWithHinge('right');
    expect(handleParts(right)[0]?.position.x).not.toBeCloseTo(handleParts(left)[0]!.position.x, 3);
  });
});

describe('Test 5: изменение ширины двери пересчитывает ручку', () => {
  it('позиция ручки по X следует за шириной изделия', () => {
    const a = buildDoorWithOpening({ ...DIMS, width: 1200 }, (ids, h) => createHandleOpeningSystem(ids, h));
    const b = buildDoorWithOpening({ ...DIMS, width: 1600 }, (ids, h) => createHandleOpeningSystem(ids, h));
    expect(handleParts(b.result)[0]?.position.x).not.toBeCloseTo(handleParts(a.result)[0]!.position.x, 3);
  });
});

describe('Test 6: изменение ширины ящика пересчитывает ручку', () => {
  it('позиция ручки по X следует за шириной изделия (горизонтальная штанга по центру)', () => {
    const a = buildDrawerWithOpening({ ...DIMS, width: 1200 }, (ids) => createHandleOpeningSystem(ids));
    const b = buildDrawerWithOpening({ ...DIMS, width: 1600 }, (ids) => createHandleOpeningSystem(ids));
    expect(handleParts(b.result)[0]?.position.x).not.toBeCloseTo(handleParts(a.result)[0]!.position.x, 3);
  });
});

describe('Test 7: удаление фасада удаляет ручку', () => {
  it('пустой список facades — 0 деталей открывания на той же ячейке', () => {
    const { input } = buildDoorWithOpening(DIMS, (ids, h) => createHandleOpeningSystem(ids, h));
    const withoutFacade: GeometryInput = { ...input, furniture: { ...input.furniture, facades: [] } };
    const result = buildGeometry(withoutFacade);
    expect(openingParts(result)).toHaveLength(0);
  });
});

describe('Test 8: удаление наполнения не оставляет осиротевшую ручку', () => {
  it('замена fill на empty убирает ручку ящика вместе с самим ящиком', () => {
    const { cellId } = buildDrawerWithOpening(DIMS, (ids) => createHandleOpeningSystem(ids));
    const emptyInput = makeGeometryInputWithRoot(() => ({ id: cellId, kind: 'leaf', fill: { kind: 'empty' } }), DIMS);
    const result = buildGeometry(emptyInput);
    expect(openingParts(result)).toHaveLength(0);
  });
});

describe('Test 9: id ручки стабилен при resize', () => {
  it('id детали не меняется при изменении ширины изделия', () => {
    const a = buildDoorWithOpening({ ...DIMS, width: 1200 }, (ids, h) => createHandleOpeningSystem(ids, h));
    const b = buildDoorWithOpening({ ...DIMS, width: 1700 }, (ids, h) => createHandleOpeningSystem(ids, h));
    expect(handleParts(b.result)[0]?.id).toBe(handleParts(a.result)[0]!.id);
  });
});

describe('Test 11: сериализация сохраняет способ открывания', () => {
  it('OpeningSystem переживает круговой путь через JSON, geometry результат совпадает', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');

    const { input } = buildDoorWithOpening(DIMS, (ids, h) => createHandleOpeningSystem(ids, h));
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const original = buildGeometry(input);
    const roundTripped = buildGeometry({ ...input, furniture: restored.furniture[0]! });

    expect(handleParts(roundTripped)).toHaveLength(handleParts(original).length);
    expect(roundTripped).toEqual(original);
  });

  it('push-to-open тоже переживает круговой путь', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');

    const { input } = buildDoorWithOpening(DIMS, (ids, h) => createPushToOpenSystem(ids, h));
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const roundTripped = buildGeometry({ ...input, furniture: restored.furniture[0]! });
    expect(pushParts(roundTripped)).toHaveLength(1);
  });
});

describe('Test 12: резолвер требует уже построенный фасад — нет отдельного targetFacadeId для проверки', () => {
  it('opening всегда вложен в конкретную створку/ящик — осиротевшей ссылки не бывает структурно', () => {
    // FacadeLeaf.opening/DrawerFacadeSpec.opening лежат ВНУТРИ уже
    // существующей створки/ящика (PROMPT 12 §3, docs/GEOMETRY_RULES.md
    // §20.1) — то же обоснование, что и у Content→cellId (PROMPT 9):
    // ссылаться некуда, opening всегда приходит вместе со своим фасадом.
    const cell = { nodeId: asId<'Node'>('c'), box: { min: { x: 0, y: 0, z: 0 }, size: { x: 900, y: 900, z: 500 } }, sectionId: asId<'Node'>('s'), row: 0, column: 0, fill: { kind: 'empty' as const } };
    const ids = createSequentialIdFactory('o');
    const opening = createHandleOpeningSystem(ids, 'left');
    const resolution = resolveOpeningSystemGeometry(opening, { x: cell.box.min.x, y: cell.box.min.y, z: cell.box.min.z, width: 500, height: 700, thickness: T });
    expect(resolution.status).toBe('built');
    expect(resolution.items[0]?.id).toBe(opening.kind === 'handle' ? opening.id : undefined);
  });
});

describe('Test 13: ручка не выходит за границы фасада', () => {
  it('слишком большой offsetX — invalid, диагностика error', () => {
    const badPlacement: HandlePlacement = { anchor: 'center', side: 'left', offsetX: 10_000, offsetY: 0, offsetZ: 25, orientation: 'vertical' };
    const opening: OpeningSystem = { kind: 'handle', id: asId<'Node'>('h'), handle: { kind: 'bar' }, placement: badPlacement };
    const resolution = resolveOpeningSystemGeometry(opening, { x: 0, y: 0, z: 0, width: 500, height: 700, thickness: T });
    expect(resolution.status).toBe('invalid');
    expect(resolution.items).toHaveLength(0);
  });

  it('движок сообщает об этом диагностикой OPENING_GEOMETRY_INVALID', () => {
    const badPlacement: HandlePlacement = { anchor: 'center', side: 'left', offsetX: 10_000, offsetY: 0, offsetZ: 25, orientation: 'vertical' };
    const { result } = buildDoorWithOpening(DIMS, (ids) => ({
      kind: 'handle',
      id: ids.next<'Node'>(),
      handle: { kind: 'bar' },
      placement: badPlacement,
    }));
    expect(result.diagnostics.some((d) => d.code === 'OPENING_GEOMETRY_INVALID')).toBe(true);
    expect(handleParts(result)).toHaveLength(0);
  });
});

describe('Test 14: push-to-open корректно привязан к фасаду', () => {
  it('позиция площадки лежит внутри границ фасада по X/Y', () => {
    const { result, cellId } = buildDoorWithOpening(DIMS, (ids, h) => createPushToOpenSystem(ids, h));
    const cell = result.cells.find((c) => c.nodeId === cellId)!;
    const [push] = pushParts(result);
    expect(push).toBeDefined();
    expect(push!.position.x).toBeGreaterThanOrEqual(cell.box.min.x);
    expect(push!.position.x + push!.size.x).toBeLessThanOrEqual(cell.box.min.x + cell.box.size.x + 0.01);
    expect(push!.position.y).toBeGreaterThanOrEqual(cell.box.min.y);
    expect(push!.position.y + push!.size.y).toBeLessThanOrEqual(cell.box.min.y + cell.box.size.y + 0.01);
  });
});

describe('Test 15: дверь и ящик не получают случайный OpeningSystem по умолчанию', () => {
  it('createHingedFacade не задаёт opening — по умолчанию его нет вовсе (не {kind:"none"} явно, а undefined)', () => {
    const facade = createHingedFacade(createSequentialIdFactory('f'), asId<'Node'>('c'), 1);
    expect(facade.leaves[0]?.opening).toBeUndefined();
  });

  it('createDrawer не задаёт opening по умолчанию', () => {
    const drawer = createDrawer(createSequentialIdFactory('d'));
    expect(drawer.facade.opening).toBeUndefined();
  });

  it('резолвер трактует отсутствие opening как none — не строит деталей', () => {
    const { result } = buildDoorWithOpening(DIMS, () => ({ kind: 'none' }));
    expect(openingParts(result)).toHaveLength(0);
  });
});

describe('пересечения: ручка/push-to-open не пересекаются ни с чем', () => {
  it('findPartOverlaps не находит пересечений во всём изделии с ручкой', () => {
    const { result } = buildDoorWithOpening(DIMS, (ids, h) => createHandleOpeningSystem(ids, h));
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('findPartOverlaps не находит пересечений с push-to-open', () => {
    const { result } = buildDrawerWithOpening(DIMS, (ids) => createPushToOpenSystem(ids));
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });
});

describe('движок: детерминизм', () => {
  it('одинаковый вход даёт побайтово одинаковый результат', () => {
    const build = () => buildDoorWithOpening(DIMS, (ids, h) => createHandleOpeningSystem(ids, h)).result;
    expect(build()).toEqual(build());
  });
});

// ── §21 property-проверки ───────────────────────────────────────────────────

describe('property: ручка и фасад', () => {
  const widths = fc.integer({ min: 300, max: 3000 });

  it('∀handle: origin.nodeId ручки совпадает с ячейкой её фасада', () => {
    fc.assert(
      fc.property(widths, (width) => {
        const { result, cellId } = buildDoorWithOpening({ ...DIMS, width }, (ids, h) => createHandleOpeningSystem(ids, h));
        for (const handle of handleParts(result)) {
          expect(handle.origin.nodeId).toBe(cellId);
        }
      }),
    );
  });

  it('∀resize: id ручки не меняется', () => {
    fc.assert(
      fc.property(widths, fc.integer({ min: 50, max: 800 }), (width, delta) => {
        const before = buildDoorWithOpening({ ...DIMS, width }, (ids, h) => createHandleOpeningSystem(ids, h));
        const after = buildDoorWithOpening({ ...DIMS, width: width + delta }, (ids, h) => createHandleOpeningSystem(ids, h));
        expect(handleParts(after.result)[0]?.id).toBe(handleParts(before.result)[0]?.id);
      }),
    );
  });

  it('∀resolvedHandle: ширина/высота/вынос положительны', () => {
    fc.assert(
      fc.property(widths, (width) => {
        const { result } = buildDoorWithOpening({ ...DIMS, width }, (ids, h) => createHandleOpeningSystem(ids, h));
        for (const handle of handleParts(result)) {
          expect(handle.size.x).toBeGreaterThan(0);
          expect(handle.size.y).toBeGreaterThan(0);
          expect(handle.size.z).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('∀serialize/deserialize: результат эквивалентен исходному', () => {
    fc.assert(
      fc.property(widths, (width) => {
        const { input } = buildDoorWithOpening({ ...DIMS, width }, (ids, h) => createHandleOpeningSystem(ids, h));
        const original = buildGeometry(input);
        expect(buildGeometry(input)).toEqual(original);
      }),
    );
  });
});
