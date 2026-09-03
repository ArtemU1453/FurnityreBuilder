import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createCountertop, createFalsePanel, createPlinthBase, createShelvesLeaf, createTopSection } from '../../../src/domain/furniture/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { hasErrors } from '../../../src/domain/index.js';
import type { CarcassSpec, FalsePanel, Furniture, MaterialId } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Property-тесты конструктивных модификаторов (PROMPT 15 §18).
 *
 *   ∀ модификатор: width/height/depth ≥ 0
 *   ∀ проект: boundingBox содержит все детали
 *   ∀ round-trip: serialize(deserialize(model)) эквивалентен модели
 *   ∀ изменение одного параметра: чужие детали не портятся и не осиротевают
 */

interface ModifierConfig {
  readonly plinth: number;
  readonly countertop: number;
  readonly topSection: number;
  readonly gap: number;
  readonly ceilingGap: number;
  readonly frontOverhang: number;
  readonly panels: number;
}

const configArb: fc.Arbitrary<ModifierConfig> = fc.record({
  plinth: fc.integer({ min: 0, max: 150 }),
  countertop: fc.integer({ min: 0, max: 60 }),
  topSection: fc.integer({ min: 0, max: 400 }),
  gap: fc.integer({ min: 0, max: 40 }),
  ceilingGap: fc.integer({ min: 0, max: 200 }),
  frontOverhang: fc.integer({ min: 0, max: 50 }),
  panels: fc.integer({ min: 0, max: 2 }),
});

function build(config: ModifierConfig, height = 2400): GeometryInput {
  const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), {
    width: 1000,
    height,
    depth: 500,
    panelThickness: 16,
  });
  const ids = createSequentialIdFactory('pp');
  const materialId = Object.keys(input.materials.items)[0] as MaterialId;

  // Фальшпанели ставятся только справа и сверху: слева и снизу они выходят
  // за начало координат, и это отдельное, уже покрытое правило
  // (docs/STRUCTURAL_MODIFIERS.md §2).
  const positions: readonly FalsePanel['position'][] = ['right', 'top'];
  const panels = Array.from({ length: config.panels }, (_, i) =>
    createFalsePanel(ids, positions[i % positions.length]!),
  );

  const carcass: CarcassSpec = {
    ...input.furniture.carcass,
    ...(config.plinth > 0 ? { base: createPlinthBase(config.plinth) } : {}),
    ...(config.countertop > 0 ? { countertop: createCountertop(config.countertop, materialId) } : {}),
    ...(config.topSection > 0 ? { topSection: createTopSection(config.topSection, config.gap) } : {}),
    ...(config.ceilingGap > 0 ? { ceilingGap: config.ceilingGap } : {}),
    ...(config.frontOverhang > 0
      ? { overhang: { front: config.frontOverhang, back: 0, left: 0, right: 0, appliesTo: ['top' as const, 'countertop' as const] } }
      : {}),
    ...(panels.length > 0 ? { falsePanels: panels } : {}),
  };
  const furniture: Furniture = { ...input.furniture, carcass };
  return { ...input, furniture };
}

describe('∀ модификатор: размеры деталей неотрицательны и координаты валидны', () => {
  it('при любой комбинации шести модификаторов', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = buildGeometry(build(config));
        for (const part of result.parts) {
          expect(part.size.x).toBeGreaterThan(0);
          expect(part.size.y).toBeGreaterThan(0);
          expect(part.size.z).toBeGreaterThan(0);
          expect(part.position.x).toBeGreaterThanOrEqual(0);
          expect(part.position.y).toBeGreaterThanOrEqual(0);
          expect(part.position.z).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('∀ проект: boundingBox содержит все детали', () => {
  it('охват не меньше крайних точек любой построенной детали', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = buildGeometry(build(config));
        if (result.parts.length === 0) return;
        const bb = result.boundingBox;
        for (const part of result.parts) {
          expect(part.position.x).toBeGreaterThanOrEqual(bb.minX);
          expect(part.position.y).toBeGreaterThanOrEqual(bb.minY);
          expect(part.position.z).toBeGreaterThanOrEqual(bb.minZ);
          expect(part.position.x + part.size.x).toBeLessThanOrEqual(bb.maxX);
          expect(part.position.y + part.size.y).toBeLessThanOrEqual(bb.maxY);
          expect(part.position.z + part.size.z).toBeLessThanOrEqual(bb.maxZ);
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('∀ проект: запрещённых пересечений нет', () => {
  it('модификаторы не накладываются ни друг на друга, ни на корпус', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = buildGeometry(build(config));
        if (hasErrors(result.diagnostics)) return;
        expect(findPartOverlaps(result.parts)).toHaveLength(0);
      }),
      { numRuns: 60 },
    );
  });
});

describe('∀ round-trip: модель после сериализации эквивалентна исходной', () => {
  it('детали совпадают побайтово по id, размеру и положению', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const input = build(config);
        const project = createProject({
          ids: createSequentialIdFactory('t'),
          now: () => '2026-01-01T00:00:00.000Z',
        });
        const stored = { ...project, furniture: [input.furniture], materials: input.materials };
        const restored = fromJson(toJson(stored)).project;

        const before = buildGeometry(input);
        const after = buildGeometry({ ...input, furniture: restored.furniture[0]!, materials: restored.materials });
        expect(after.parts).toEqual(before.parts);
      }),
      { numRuns: 40 },
    );
  });
});

describe('∀ изменение одного параметра: чужие детали не портятся', () => {
  it('добавление фальшпанели не трогает ни одну деталь корпуса', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const withoutPanels = buildGeometry(build({ ...config, panels: 0 }));
        const withPanels = buildGeometry(build({ ...config, panels: 2 }));
        const carcassOf = (r: typeof withoutPanels) => r.parts.filter((p) => p.role !== 'filler');
        expect(carcassOf(withPanels)).toEqual(carcassOf(withoutPanels));
      }),
      { numRuns: 40 },
    );
  });

  it('изменение зазора до потолка не создаёт и не теряет деталей', () => {
    fc.assert(
      fc.property(configArb, fc.integer({ min: 0, max: 200 }), (config, gap) => {
        const a = buildGeometry(build({ ...config, ceilingGap: 0 }));
        const b = buildGeometry(build({ ...config, ceilingGap: gap }));
        if (hasErrors(a.diagnostics) || hasErrors(b.diagnostics)) return;
        // Ни одной осиротевшей детали: набор идентичностей тот же.
        expect(b.parts.map((p) => p.id).sort()).toEqual(a.parts.map((p) => p.id).sort());
      }),
      { numRuns: 40 },
    );
  });
});
