import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { hasErrors, isFiniteBox3 } from '../../../src/domain/index.js';
import type { IdFactory, LeafNode, Shelf } from '../../../src/domain/index.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Тесты этапа наполнения — полки (PROMPT 6 §28). Каждый Test N из задания —
 * один `describe`/`it`, как и в `layout.test.ts` для PROMPT 4.
 *
 * «rowCount» из задания (Test 8) в архитектуре этого проекта — не
 * структурное деление дерева (то уже проверено в layout.test.ts), а число
 * полок ВНУТРИ одной ячейки (`LeafFill.shelves.length`): полки не создают
 * новых ячеек, они — детали внутри уже существующей (PROMPT 6 §5).
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

function shelfParts(result: ReturnType<typeof buildGeometry>) {
  return result.parts.filter((p) => p.role === 'shelf-fixed' || p.role === 'shelf-adjustable');
}

describe('Test 1: корпус без внутренних полок', () => {
  const result = buildGeometry(makeGeometryInput(DIMS));

  it('нет ни одной полки', () => {
    expect(shelfParts(result)).toHaveLength(0);
  });

  it('без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('Test 2: 1 секция + полки', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), DIMS));

  it('3 полки построены как Part с ролью shelf-adjustable', () => {
    const shelves = shelfParts(result);
    expect(shelves).toHaveLength(3);
    expect(shelves.every((p) => p.role === 'shelf-adjustable')).toBe(true);
  });

  it('полки равномерно делят внутреннюю высоту на 4 промежутка', () => {
    const shelves = [...shelfParts(result)].sort((a, b) => a.position.y - b.position.y);
    const gap0 = shelves[0]!.position.y - result.innerVolume.min.y;
    const gap1 = shelves[1]!.position.y - (shelves[0]!.position.y + shelves[0]!.size.y);
    const gap2 = shelves[2]!.position.y - (shelves[1]!.position.y + shelves[1]!.size.y);
    const gap3 = result.innerVolume.min.y + result.innerVolume.size.y - (shelves[2]!.position.y + shelves[2]!.size.y);
    expect(gap0).toBe(gap1);
    expect(gap1).toBe(gap2);
    expect(gap2).toBe(gap3);
  });

  it('ширина и глубина полки равны внутренним размерам ячейки — без произвольных зазоров', () => {
    for (const p of shelfParts(result)) {
      expect(p.size.x).toBe(result.innerVolume.size.x);
      expect(p.size.z).toBe(result.innerVolume.size.z);
      expect(p.position.x).toBe(result.innerVolume.min.x);
      expect(p.position.z).toBe(result.innerVolume.min.z);
    }
  });

  it('без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('Test 3: 2 секции + полки', () => {
  const buildRoot = (ids: IdFactory) => ({
    id: ids.next<'Node'>(),
    kind: 'split' as const,
    axis: 'x' as const,
    divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
    children: [
      { size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 2, 'adjustable') },
      { size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 3, 'fixed') },
    ],
  });
  const result = buildGeometry(makeGeometryInputWithRoot(buildRoot, DIMS));

  it('2 + 3 = 5 полок, каждая секция сохраняет свой mounting', () => {
    expect(shelfParts(result)).toHaveLength(5);
    expect(result.parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(2);
    expect(result.parts.filter((p) => p.role === 'shelf-fixed')).toHaveLength(3);
  });

  it('полки каждой секции не выходят за её ширину', () => {
    const cellsBySectionId = new Map(result.cells.map((c) => [c.nodeId, c.sectionId]));
    for (const p of shelfParts(result)) {
      const sectionId = p.origin.nodeId !== undefined ? cellsBySectionId.get(p.origin.nodeId) : undefined;
      const cell = result.cells.find((c) => c.sectionId === sectionId && c.nodeId === p.origin.nodeId);
      expect(cell).toBeDefined();
      expect(p.position.x).toBe(cell?.box.min.x);
      expect(p.size.x).toBe(cell?.box.size.x);
    }
  });
});

describe('Test 4: 3 секции + полки', () => {
  const buildRoot = (ids: IdFactory) => ({
    id: ids.next<'Node'>(),
    kind: 'split' as const,
    axis: 'x' as const,
    divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
    children: [1, 2, 3].map((count) => ({
      size: { mode: 'flex' as const, weight: 1 },
      node: createShelvesLeaf(ids, count, 'adjustable'),
    })),
  });
  const result = buildGeometry(makeGeometryInputWithRoot(buildRoot, DIMS));

  it('1 + 2 + 3 = 6 полок', () => {
    expect(shelfParts(result)).toHaveLength(6);
  });

  it('без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('Test 5: изменение H пересчитывает положение полок', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), { ...DIMS, height: 2000 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), { ...DIMS, height: 2200 }));

  it('Y-позиции полок меняются вместе с H', () => {
    const beforeY = shelfParts(before).map((p) => p.position.y);
    const afterY = shelfParts(after).map((p) => p.position.y);
    expect(afterY).not.toEqual(beforeY);
  });

  it('количество и толщина полок не меняются', () => {
    expect(shelfParts(after)).toHaveLength(shelfParts(before).length);
    expect(shelfParts(after).map((p) => p.size.y)).toEqual(shelfParts(before).map((p) => p.size.y));
  });
});

describe('Test 6: изменение W пересчитывает ширину полок', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), { ...DIMS, width: 800 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), { ...DIMS, width: 1000 }));

  it('ширина полок меняется вместе с W', () => {
    expect(shelfParts(after)[0]?.size.x).not.toBe(shelfParts(before)[0]?.size.x);
    expect(shelfParts(after)[0]?.size.x).toBe(after.innerVolume.size.x);
  });

  it('толщина полки не зависит от ширины', () => {
    expect(shelfParts(after).map((p) => p.size.y)).toEqual(shelfParts(before).map((p) => p.size.y));
  });

  it('количество рядов (полок) не меняется', () => {
    expect(shelfParts(after)).toHaveLength(shelfParts(before).length);
  });
});

describe('Test 7: изменение D пересчитывает глубину полок', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), { ...DIMS, depth: 400 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), { ...DIMS, depth: 500 }));

  it('глубина полки меняется вместе с D и равна внутренней глубине ячейки', () => {
    expect(shelfParts(after)[0]?.size.z).not.toBe(shelfParts(before)[0]?.size.z);
    expect(shelfParts(after)[0]?.size.z).toBe(after.innerVolume.size.z);
  });

  it('ширина и Y-позиция полки не зависят от глубины', () => {
    expect(shelfParts(after).map((p) => p.size.x)).toEqual(shelfParts(before).map((p) => p.size.x));
    expect(shelfParts(after).map((p) => p.position.y)).toEqual(shelfParts(before).map((p) => p.position.y));
  });
});

describe('Test 8: изменение числа полок в ячейке («rowCount» задания)', () => {
  const two = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS));
  const four = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 4, 'adjustable'), DIMS));

  it('число полок и, как следствие, число промежутков между ними меняется', () => {
    expect(shelfParts(two)).toHaveLength(2);
    expect(shelfParts(four)).toHaveLength(4);
  });

  it('4 полки при той же высоте ячейки — более узкие промежутки, чем у 2', () => {
    const gapOf = (r: typeof two) => {
      const sorted = [...shelfParts(r)].sort((a, b) => a.position.y - b.position.y);
      return sorted[0]!.position.y - r.innerVolume.min.y;
    };
    expect(gapOf(four)).toBeLessThan(gapOf(two));
  });
});

describe('Test 9: изменение числа секций автоматически распределяет полки', () => {
  it('1 → 2 → 3 секции: каждая получает свой набор полок независимо', () => {
    const one = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS));
    expect(shelfParts(one)).toHaveLength(2);

    const two = buildGeometry(
      makeGeometryInputWithRoot((ids) => ({
        id: ids.next<'Node'>(),
        kind: 'split' as const,
        axis: 'x' as const,
        divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
        children: [0, 1].map(() => ({ size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 2, 'adjustable') })),
      }), DIMS),
    );
    expect(shelfParts(two)).toHaveLength(4);

    const three = buildGeometry(
      makeGeometryInputWithRoot((ids) => ({
        id: ids.next<'Node'>(),
        kind: 'split' as const,
        axis: 'x' as const,
        divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
        children: [0, 1, 2].map(() => ({ size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 2, 'adjustable') })),
      }), DIMS),
    );
    expect(shelfParts(three)).toHaveLength(6);
  });
});

describe('Test 10: Shelf находится внутри Section', () => {
  it('X-диапазон полки совпадает с X-диапазоном её ячейки/секции', () => {
    // createSections (PROMPT 4) сам по себе не создаёт полок — строим ту же
    // трёхсекционную структуру вручную, но с shelves на каждом листе, чтобы
    // проверить именно сочетание «секции + полки».
    const withShelves = buildGeometry(
      makeGeometryInputWithRoot((ids) => ({
        id: ids.next<'Node'>(),
        kind: 'split' as const,
        axis: 'x' as const,
        divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
        children: [0, 1, 2].map((count) => ({
          size: { mode: 'flex' as const, weight: 1 },
          node: createShelvesLeaf(ids, count + 1, 'adjustable'),
        })),
      }), DIMS),
    );
    for (const cell of withShelves.cells) {
      const shelvesOfCell = shelfParts(withShelves).filter((p) => p.origin.nodeId === cell.nodeId);
      for (const shelf of shelvesOfCell) {
        expect(shelf.position.x).toBeGreaterThanOrEqual(cell.box.min.x);
        expect(shelf.position.x + shelf.size.x).toBeLessThanOrEqual(cell.box.min.x + cell.box.size.x);
      }
    }
  });
});

describe('Test 11: Shelf не выходит за bounding box корпуса', () => {
  it('добавление полок не меняет внешний габарит', () => {
    const withoutShelves = buildGeometry(makeGeometryInput(DIMS));
    const withShelves = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 5, 'adjustable'), DIMS));
    expect(withShelves.boundingBox.totalWidth).toBe(withoutShelves.boundingBox.totalWidth);
    expect(withShelves.boundingBox.totalHeight).toBe(withoutShelves.boundingBox.totalHeight);
    expect(withShelves.boundingBox.totalDepth).toBe(withoutShelves.boundingBox.totalDepth);
  });

  it('каждая полка лежит внутри bounds корпуса', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 5, 'adjustable'), DIMS));
    for (const p of shelfParts(result)) {
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.y).toBeGreaterThanOrEqual(0);
      expect(p.position.z).toBeGreaterThanOrEqual(0);
      expect(p.position.x + p.size.x).toBeLessThanOrEqual(result.bounds.size.x);
      expect(p.position.y + p.size.y).toBeLessThanOrEqual(result.bounds.size.y);
      expect(p.position.z + p.size.z).toBeLessThanOrEqual(result.bounds.size.z);
    }
  });
});

describe('Test 12: Shelf не имеет отрицательных размеров', () => {
  it('каждая полка положительна по всем трём осям', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 4, 'fixed'), DIMS));
    for (const p of shelfParts(result)) {
      expect(p.size.x).toBeGreaterThan(0);
      expect(p.size.y).toBeGreaterThan(0);
      expect(p.size.z).toBeGreaterThan(0);
    }
  });
});

describe('Test 13: Shelf не содержит NaN/Infinity', () => {
  it('позиция и размер каждой полки конечны', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 4, 'adjustable'), DIMS));
    for (const p of shelfParts(result)) {
      expect(isFiniteBox3({ min: p.position, size: p.size })).toBe(true);
    }
  });
});

describe('Test 14: стабильность id полки', () => {
  it('id полки не зависит от порядка вычисления и переживает изменение других полок', () => {
    const buildRoot = (ids: IdFactory) => createShelvesLeaf(ids, 3, 'adjustable');
    const a = buildGeometry(makeGeometryInputWithRoot(buildRoot, DIMS));
    const b = buildGeometry(makeGeometryInputWithRoot(buildRoot, DIMS));
    expect(shelfParts(a).map((p) => p.id)).toEqual(shelfParts(b).map((p) => p.id));

    // Тот же корпус, изменена только высота — id полок не должны меняться,
    // хотя их Y-позиция меняется (id выведен из Shelf.id, а не из позиции).
    const resized = buildGeometry(makeGeometryInputWithRoot(buildRoot, { ...DIMS, height: 2400 }));
    expect(shelfParts(resized).map((p) => p.id).sort()).toEqual(shelfParts(a).map((p) => p.id).sort());
  });

  it('id уникальны среди всех полок изделия', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => ({
        id: ids.next<'Node'>(),
        kind: 'split' as const,
        axis: 'x' as const,
        divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
        children: [0, 1].map(() => ({ size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 3, 'adjustable') })),
      }), DIMS),
    );
    const ids = shelfParts(result).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Test 15: serialize → deserialize → geometry', () => {
  it('полки переживают круговой путь через JSON без изменений', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), DIMS);
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const restoredInput = { ...input, furniture: restored.furniture[0]! };

    expect(buildGeometry(restoredInput)).toEqual(buildGeometry(input));
  });
});

describe('Test 16 (не в задании, но требуется §16): коллизии и валидация ручного размещения', () => {
  function leafWithManualShelves(ids: IdFactory, shelves: readonly Shelf[]): LeafNode {
    return { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'shelves', shelves } };
  }

  it('две ручные полки, пересекающиеся по высоте, дают SHELF_OVERLAP и обе остаются видимыми', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) =>
          leafWithManualShelves(ids, [
            { id: ids.next<'Node'>(), placement: { mode: 'manual', offsetFromBottom: 500 }, mounting: 'adjustable' },
            { id: ids.next<'Node'>(), placement: { mode: 'manual', offsetFromBottom: 505 }, mounting: 'adjustable' },
          ]),
        DIMS,
      ),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('SHELF_OVERLAP');
    expect(shelfParts(result)).toHaveLength(2);
  });

  it('ручная полка за пределами ячейки не строится, но не роняет остальную геометрию', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) =>
          leafWithManualShelves(ids, [
            { id: ids.next<'Node'>(), placement: { mode: 'manual', offsetFromBottom: -10 }, mounting: 'adjustable' },
          ]),
        DIMS,
      ),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('SHELF_OUT_OF_CELL_BOUNDS');
    expect(shelfParts(result)).toHaveLength(0);
    // Каркас остаётся построенным — одна испорченная полка не должна прятать корпус.
    expect(result.parts.some((p) => p.role === 'side')).toBe(true);
  });

  it('слишком много равномерных полок для доступной высоты — SHELF_AUTO_OVERCONSTRAINED, ноль мусорных полок', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 200, 'adjustable'), DIMS),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('SHELF_AUTO_OVERCONSTRAINED');
    expect(shelfParts(result)).toHaveLength(0);
  });

  it('несогласованный count внутри одной auto-группы — SHELF_AUTO_PLACEMENT_INCONSISTENT', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) =>
          leafWithManualShelves(ids, [
            { id: ids.next<'Node'>(), placement: { mode: 'auto', index: 0, count: 2 }, mounting: 'adjustable' },
            { id: ids.next<'Node'>(), placement: { mode: 'auto', index: 1, count: 3 }, mounting: 'adjustable' },
          ]),
        DIMS,
      ),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('SHELF_AUTO_PLACEMENT_INCONSISTENT');
    expect(shelfParts(result)).toHaveLength(0);
  });

  it('rod+shelf: shelfAbove строится как обычная полка', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => ({
          id: ids.next<'Node'>(),
          kind: 'leaf' as const,
          fill: {
            kind: 'rod+shelf' as const,
            rod: { id: ids.next<'Node'>(), profile: 'round-25', offsetFromTop: 60, offsetFromFront: 30, mount: 'flange' },
            shelfAbove: { id: ids.next<'Node'>(), placement: { mode: 'manual', offsetFromBottom: 1800 }, mounting: 'fixed' },
          },
        }),
        DIMS,
      ),
    );
    expect(shelfParts(result)).toHaveLength(1);
    expect(shelfParts(result)[0]?.role).toBe('shelf-fixed');
  });

  it('TOP/BOTTOM остаются своей ролью и не превращаются в полки, даже когда в ячейке есть полки', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS));
    expect(result.parts.filter((p) => p.role === 'top')).toHaveLength(1);
    expect(result.parts.filter((p) => p.role === 'bottom')).toHaveLength(1);
  });
});
