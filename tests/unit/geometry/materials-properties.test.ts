import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createDrawer, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import type { LeafNode, Material, MaterialLibrary, SplitNode } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Property-тесты материалов и толщин (PROMPT 13 §25). Проверяются четыре
 * свойства, которые обязаны держаться при ЛЮБОЙ комбинации толщины
 * корпуса, толщины материала и назначений:
 *
 *   ∀ построенная деталь: эффективная толщина > 0
 *   ∀ построенная деталь: её материал существует в библиотеке
 *   ∀ round-trip: эффективный материал детали не меняется
 *   ∀ смена толщины: id деталей стабильны
 */

const materialArb = fc
  .record({
    thickness: fc.integer({ min: 3, max: 30 }),
    kind: fc.constantFrom('chipboard' as const, 'mdf' as const, 'plywood' as const, 'glass' as const, 'mirror' as const),
  })
  .map(
    ({ thickness, kind }): Material => ({
      id: asId<'Material'>('prop-material'),
      name: `Материал ${String(thickness)} мм`,
      kind,
      thickness,
      displayColor: '#D9CBB4',
      grain: 'none',
    }),
  );

/**
 * Шкаф со всеми видами физических деталей сразу: каркас, перегородка,
 * полки, дверь, фасад ящика — чтобы свойство проверялось на всех ролях,
 * а не только на полке.
 */
function wardrobe(panelThickness: number, extra: Material | undefined, assignToShelves: boolean): GeometryInput {
  const base = makeGeometryInput({ width: 1200, height: 2000, depth: 500, panelThickness });
  const ids = createSequentialIdFactory('p');
  const shelvesLeaf = createShelvesLeaf(ids, 2, 'adjustable');
  const drawer = createDrawer(ids);
  const drawersLeaf: LeafNode = {
    id: ids.next<'Node'>(),
    kind: 'leaf',
    fill: { kind: 'drawers', drawers: [drawer] },
  };
  const root: SplitNode = {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis: 'x',
    divider: { material: 'panel', thickness: panelThickness, mounting: 'fixed', frontSetback: 0 },
    children: [
      { size: { mode: 'flex', weight: 1 }, node: shelvesLeaf },
      { size: { mode: 'flex', weight: 1 }, node: drawersLeaf },
    ],
  };
  const facade = createHingedFacade(ids, shelvesLeaf.id, 1);

  const materials: MaterialLibrary =
    extra === undefined
      ? base.materials
      : {
          items: { ...base.materials.items, [extra.id]: extra },
          assignment: assignToShelves
            ? { ...base.materials.assignment, 'shelf-adjustable': extra.id, facade: extra.id }
            : base.materials.assignment,
        };

  return {
    ...base,
    furniture: {
      ...base.furniture,
      dimensions: { ...base.furniture.dimensions, panelThickness },
      root,
      facades: [facade],
    },
    materials,
  };
}

describe('∀ построенная деталь: эффективная толщина больше нуля', () => {
  it('при любой толщине корпуса и любой толщине назначенного материала', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 40 }), materialArb, (panelThickness, extraMaterial) => {
        const result = buildGeometry(wardrobe(panelThickness, extraMaterial, true));
        for (const part of result.parts) {
          expect(part.cut.thickness).toBeGreaterThan(0);
          expect(part.size.x).toBeGreaterThan(0);
          expect(part.size.y).toBeGreaterThan(0);
          expect(part.size.z).toBeGreaterThan(0);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('∀ построенная деталь: её материал существует в библиотеке', () => {
  it('движок никогда не выдаёт деталь со ссылкой на отсутствующий материал', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 40 }), materialArb, fc.boolean(), (panelThickness, extraMaterial, assign) => {
        const input = wardrobe(panelThickness, extraMaterial, assign);
        const result = buildGeometry(input);
        for (const part of result.parts) {
          expect(input.materials.items[part.materialId]).toBeDefined();
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('∀ round-trip: эффективный материал и толщина детали не меняются', () => {
  it('сериализация и обратно дают ту же деталировку', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 40 }), materialArb, (panelThickness, extraMaterial) => {
        const input = wardrobe(panelThickness, extraMaterial, true);
        const project = createProject({
          ids: createSequentialIdFactory('t'),
          now: () => '2026-01-01T00:00:00.000Z',
        });
        const stored = { ...project, furniture: [input.furniture], materials: input.materials };
        const restored = fromJson(toJson(stored)).project;

        const before = buildGeometry(input);
        const after = buildGeometry({
          ...input,
          furniture: restored.furniture[0]!,
          materials: restored.materials,
        });

        expect(after.parts.map((p) => `${p.id}|${p.materialId}|${String(p.cut.thickness)}`)).toEqual(
          before.parts.map((p) => `${p.id}|${p.materialId}|${String(p.cut.thickness)}`),
        );
      }),
      { numRuns: 25 },
    );
  });
});

describe('∀ смена толщины: id деталей стабильны', () => {
  it('изменение толщины корпуса не создаёт новых деталей и не теряет старых', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 25 }), fc.integer({ min: 10, max: 25 }), (thicknessA, thicknessB) => {
        const a = buildGeometry(wardrobe(thicknessA, undefined, false));
        const b = buildGeometry(wardrobe(thicknessB, undefined, false));
        expect(b.parts.map((p) => p.id).sort()).toEqual(a.parts.map((p) => p.id).sort());
      }),
      { numRuns: 30 },
    );
  });
});
