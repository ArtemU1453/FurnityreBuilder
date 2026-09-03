import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateHardware } from '../../../src/hardware/engine.js';
import {
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { visitNodes, isLeaf } from '../../../src/domain/index.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';
import { makeProject } from './helpers.js';

/**
 * Property-тесты расчёта фурнитуры (PROMPT 16 §24).
 *
 * Проверяются ровно те инварианты, которые перечисляет задание, и они
 * сильнее любого набора примеров: количество неотрицательно, каждый
 * источник существует, один и тот же проект даёт одну и ту же
 * спецификацию, сериализация её не меняет, а изменение, не относящееся к
 * фурнитуре, не создаёт новых позиций.
 */

type Fill = 'empty' | 'shelves' | 'drawers';

const config = fc.record({
  fill: fc.constantFrom<Fill>('empty', 'shelves', 'drawers'),
  count: fc.integer({ min: 1, max: 5 }),
  withFacade: fc.boolean(),
  width: fc.integer({ min: 300, max: 3000 }),
  height: fc.integer({ min: 600, max: 2500 }),
  depth: fc.integer({ min: 200, max: 800 }),
});

type Config = { fill: Fill; count: number; withFacade: boolean; width: number; height: number; depth: number };

function projectOf(cfg: Config): Project {
  return makeProject((furniture: Furniture, ids: IdFactory) => {
    const root =
      cfg.fill === 'drawers'
        ? createDrawersLeaf(ids, cfg.count)
        : cfg.fill === 'shelves'
          ? createShelvesLeaf(ids, cfg.count, 'adjustable')
          : furniture.root;
    const withRoot: Furniture = {
      ...furniture,
      root,
      dimensions: { ...furniture.dimensions, width: cfg.width, height: cfg.height, depth: cfg.depth },
    };
    if (!cfg.withFacade) return withRoot;
    const facade = createHingedFacade(ids, root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...withRoot,
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
    };
  });
}

function knownSourceIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const furniture of project.furniture) {
    visitNodes(furniture.root, (node) => {
      ids.add(node.id);
      if (isLeaf(node) && node.fill.kind === 'drawers') for (const d of node.fill.drawers) ids.add(d.id);
    });
    for (const facade of furniture.facades) {
      ids.add(facade.id);
      for (const leaf of facade.leaves) ids.add(leaf.id);
    }
  }
  return ids;
}

describe('property 1 (§24): количество всегда целое и неотрицательное', () => {
  it('ни одна конфигурация не даёт дробного или отрицательного количества', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const bom = calculateHardware(projectOf(cfg));
        for (const item of bom.items) {
          expect(Number.isInteger(item.quantity)).toBe(true);
          expect(item.quantity).toBeGreaterThanOrEqual(0);
        }
        for (const line of bom.lines) expect(line.quantity).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 2 (§24): каждая позиция ссылается на существующий источник', () => {
  it('нет ни одной ссылки на несуществующую деталь или узел', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const furniture = project.furniture[0]!;
        const geometry = buildGeometry({
          furniture,
          scheme: project.settings.construction,
          tolerances: project.settings.tolerances,
          materials: project.materials,
          edgeSizing: project.settings.edgeSizing,
        });
        const partIds = new Set(geometry.parts.map((p) => p.id));
        const nodeIds = knownSourceIds(project);
        const bom = calculateHardware(project, { geometry: new Map([[furniture.id, geometry]]) });

        // Ошибок валидации быть не должно: движок сам их и ловит,
        // а property-тест проверяет, что ловить нечего.
        expect(bom.errors).toHaveLength(0);
        for (const item of bom.items) {
          expect(item.sourcePartId === undefined && item.sourceNodeId === undefined).toBe(false);
          if (item.sourcePartId !== undefined) expect(partIds.has(item.sourcePartId)).toBe(true);
          if (item.sourceNodeId !== undefined) expect(nodeIds.has(item.sourceNodeId)).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 3 (§24): один и тот же проект даёт одну и ту же спецификацию', () => {
  it('расчёт детерминирован', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        expect(JSON.stringify(calculateHardware(project))).toBe(JSON.stringify(calculateHardware(project)));
      }),
      { numRuns: 80 },
    );
  });
});

describe('property 4 (§24): сериализация не меняет расчёт', () => {
  it('проект после сохранения и загрузки даёт ту же спецификацию', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const restored = fromJson(toJson(project)).project;
        expect(JSON.stringify(calculateHardware(restored))).toBe(JSON.stringify(calculateHardware(project)));
      }),
      { numRuns: 60 },
    );
  });
});

describe('property 5 (§24): изменение, не относящееся к фурнитуре, не создаёт позиций', () => {
  it('переименование проекта и изделия оставляет спецификацию прежней', () => {
    fc.assert(
      fc.property(config, fc.string({ minLength: 1, maxLength: 20 }), (cfg, name) => {
        const project = projectOf(cfg);
        const renamed: Project = {
          ...project,
          name,
          furniture: project.furniture.map((f) => ({ ...f, name })),
        };
        const before = calculateHardware(project);
        const after = calculateHardware(renamed);
        expect(after.items.map((i) => `${i.id}:${String(i.quantity)}`)).toEqual(
          before.items.map((i) => `${i.id}:${String(i.quantity)}`),
        );
      }),
      { numRuns: 60 },
    );
  });
});
