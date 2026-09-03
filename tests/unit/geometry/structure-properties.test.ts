import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createPlinthBase, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { hasErrors } from '../../../src/domain/index.js';
import type { BackPanelMount, BaseSpec, Furniture } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты конструктивных элементов корпуса (PROMPT 14 §23).
 *
 *   ∀ validBackWall: thickness > 0
 *   ∀ validPlinth:   height >= 0
 *   ∀ validProject:  запрещённых конструктивных пересечений нет
 *   ∀ serialize/deserialize: equivalent(original, restored)
 */

const mountArb: fc.Arbitrary<BackPanelMount> = fc.oneof(
  fc.constant<BackPanelMount>({ kind: 'none' }),
  fc.integer({ min: 3, max: 20 }).map<BackPanelMount>((thickness) => ({ kind: 'overlay', thickness })),
  fc.integer({ min: 3, max: 20 }).map<BackPanelMount>((thickness) => ({ kind: 'inset-flush', thickness })),
  fc
    .record({ thickness: fc.integer({ min: 3, max: 16 }), grooveDepth: fc.integer({ min: 1, max: 10 }) })
    .map<BackPanelMount>(({ thickness, grooveDepth }) => ({
      kind: 'inset-groove',
      thickness,
      grooveDepth,
      grooveOffsetFromRear: 10,
    })),
);

const plinthArb: fc.Arbitrary<BaseSpec | undefined> = fc.oneof(
  fc.constant(undefined),
  fc
    .record({ height: fc.integer({ min: 0, max: 300 }), setback: fc.integer({ min: 0, max: 60 }) })
    .map(({ height, setback }): BaseSpec => ({ ...createPlinthBase(height, setback), parts: ['front', 'left', 'right'] })),
);

function build(
  mount: BackPanelMount,
  base: BaseSpec | undefined,
  segmentation: 'single' | 'per-section',
  sections: number,
): GeometryInput {
  const input = makeGeometryInputWithRoot(
    (ids) => (sections <= 1 ? createShelvesLeaf(ids, 2, 'adjustable') : createSections(ids, sections, 16, (i) => createShelvesLeaf(i, 1, 'adjustable'))),
    { width: 400 * Math.max(sections, 2), height: 2000, depth: 500, panelThickness: 16 },
  );
  const carcass = { ...input.furniture.carcass, back: { ...input.furniture.carcass.back, mount, segmentation } };
  if (base === undefined) delete (carcass as { base?: BaseSpec }).base;
  else carcass.base = base;
  const furniture: Furniture = { ...input.furniture, carcass };
  return { ...input, furniture };
}

describe('∀ validBackWall: толщина детали задней стенки больше нуля', () => {
  it('при любом монтаже и любом разделении', () => {
    fc.assert(
      fc.property(mountArb, fc.constantFrom('single' as const, 'per-section' as const), fc.integer({ min: 1, max: 4 }), (mount, seg, sections) => {
        const result = buildGeometry(build(mount, undefined, seg, sections));
        for (const part of result.parts.filter((p) => p.role === 'back')) {
          expect(part.size.z).toBeGreaterThan(0);
          expect(part.cut.thickness).toBeGreaterThan(0);
        }
        if (mount.kind === 'none') expect(result.parts.some((p) => p.role === 'back')).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});

describe('∀ validPlinth: высота неотрицательна, детали цоколя положительны', () => {
  it('при любой высоте и отступе в допустимом диапазоне', () => {
    fc.assert(
      fc.property(plinthArb, mountArb, (base, mount) => {
        const result = buildGeometry(build(mount, base, 'single', 2));
        for (const part of result.parts.filter((p) => p.role === 'plinth')) {
          expect(part.size.x).toBeGreaterThan(0);
          expect(part.size.y).toBeGreaterThan(0);
          expect(part.size.z).toBeGreaterThan(0);
          expect(part.position.y).toBe(0);
        }
        // Нулевая высота цоколя деталей не даёт вовсе.
        if (base !== undefined && base.height === 0) {
          expect(result.parts.some((p) => p.role === 'plinth')).toBe(false);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('∀ validProject: запрещённых конструктивных пересечений нет', () => {
  it('задняя стенка, цоколь, каркас, перегородки и полки не накладываются друг на друга', () => {
    fc.assert(
      fc.property(
        mountArb,
        plinthArb,
        fc.constantFrom('single' as const, 'per-section' as const),
        fc.integer({ min: 1, max: 3 }),
        (mount, base, seg, sections) => {
          const result = buildGeometry(build(mount, base, seg, sections));
          if (hasErrors(result.diagnostics)) return; // недопустимый вход — не предмет этого свойства

          // Монтаж в паз исключён намеренно и с известной причиной: деталь в
          // пазу физически ЗАХОДИТ в габарит боковин, крышки и дна — ровно
          // туда, где у них выбран паз. Сам паз прямоугольная модель `Part`
          // не выражает, поэтому проверка пересечений видит здесь наложение,
          // которого в реальной сборке нет. Движок сообщает об этом
          // диагностикой `BACK_WALL_GROOVE_NOT_IMPLEMENTED` — это найдено
          // именно этим property-тестом (docs/GEOMETRY_RULES.md §22.5).
          if (mount.kind === 'inset-groove') {
            expect(result.diagnostics.some((d) => d.code === 'BACK_WALL_GROOVE_NOT_IMPLEMENTED')).toBe(true);
            return;
          }

          expect(findPartOverlaps(result.parts)).toHaveLength(0);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('∀ serialize/deserialize: конструктивная конфигурация эквивалентна', () => {
  it('детали задней стенки и цоколя после round-trip те же', () => {
    fc.assert(
      fc.property(mountArb, plinthArb, fc.constantFrom('single' as const, 'per-section' as const), (mount, base, seg) => {
        const input = build(mount, base, seg, 2);
        const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
        const stored = { ...project, furniture: [input.furniture], materials: input.materials };
        const restored = fromJson(toJson(stored)).project;

        const before = buildGeometry(input);
        const after = buildGeometry({ ...input, furniture: restored.furniture[0]!, materials: restored.materials });
        const structural = (r: typeof before) =>
          r.parts.filter((p) => p.role === 'back' || p.role === 'plinth').map((p) => `${p.id}|${String(p.size.x)}×${String(p.size.y)}×${String(p.size.z)}`);
        expect(structural(after)).toEqual(structural(before));
      }),
      { numRuns: 40 },
    );
  });
});
