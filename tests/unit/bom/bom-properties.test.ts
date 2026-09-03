import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateProduction } from '../../../src/bom/index.js';
import { toProductionParts } from '../../../src/production/index.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import {
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';
import { makeProject } from './helpers.js';

/**
 * Property-тесты производственной спецификации (PROMPT 19 §29).
 *
 * Проверяются ровно те инварианты, которые перечисляет задание. Главный из
 * них — количество: ошибка в агрегации не выглядит как ошибка, она
 * выглядит как лишняя деталь в заказе, и заметить её примером почти
 * невозможно.
 */

const config = fc.record({
  fill: fc.constantFrom<'empty' | 'shelves' | 'drawers' | 'sections'>('empty', 'shelves', 'drawers', 'sections'),
  count: fc.integer({ min: 1, max: 4 }),
  doors: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
  handle: fc.boolean(),
  width: fc.integer({ min: 400, max: 2400 }),
  height: fc.integer({ min: 700, max: 2400 }),
  depth: fc.integer({ min: 250, max: 700 }),
});

type Config = {
  fill: 'empty' | 'shelves' | 'drawers' | 'sections';
  count: number;
  doors: 0 | 1 | 2;
  handle: boolean;
  width: number;
  height: number;
  depth: number;
};

function projectOf(cfg: Config): Project {
  return makeProject((furniture: Furniture, ids: IdFactory) => {
    const root =
      cfg.fill === 'drawers'
        ? createDrawersLeaf(ids, cfg.count)
        : cfg.fill === 'shelves'
          ? createShelvesLeaf(ids, cfg.count, 'adjustable')
          : cfg.fill === 'sections'
            ? createSections(ids, cfg.count + 1, 16)
            : furniture.root;
    const withRoot: Furniture = {
      ...furniture,
      root,
      dimensions: { ...furniture.dimensions, width: cfg.width, height: cfg.height, depth: cfg.depth },
    };
    if (cfg.doors === 0) return withRoot;
    const facade = createHingedFacade(ids, root.id, cfg.doors);
    const leaves = facade.leaves.map((leaf) =>
      cfg.handle ? { ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) } : leaf,
    );
    return { ...withRoot, facades: [{ ...facade, leaves }] };
  });
}

describe('property 1 (§29): строки спецификации ссылаются на существующие детали', () => {
  it('и производственные, и физические', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const geometry = buildGeometry({
          furniture: project.furniture[0]!,
          scheme: project.settings.construction,
          tolerances: project.settings.tolerances,
          materials: project.materials,
          edgeSizing: project.settings.edgeSizing,
        });
        if (geometry.diagnostics.some((d) => d.severity === 'error')) return;
        const production = toProductionParts(geometry, project.materials, project.settings.cutting).parts;
        const productionIds = new Set(production.map((p) => p.id));
        const partIds = new Set(geometry.parts.map((p) => p.id));

        const r = calculateProduction(project, { geometry: new Map([[project.furniture[0]!.id, geometry]]) });
        for (const item of r.bom.parts) {
          for (const id of item.productionPartIds) expect(productionIds.has(id)).toBe(true);
          for (const id of item.sourcePartIds) expect(partIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 2 (§29): фурнитура и присадка ссылаются на существующее', () => {
  it('позиции фурнитуры имеют источник, операции присадки — производственную деталь', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const r = calculateProduction(projectOf(cfg));
        const productionIds = new Set(r.bom.parts.flatMap((p) => p.productionPartIds));

        for (const item of r.hardware.items) {
          expect(item.sourcePartId !== undefined || item.sourceNodeId !== undefined).toBe(true);
        }
        for (const operation of r.drilling.operations) {
          expect(productionIds.has(operation.productionPartId)).toBe(true);
        }
        for (const summary of r.bom.drilling.items) {
          expect(productionIds.has(summary.productionPartId)).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 3 (§29): количества неотрицательны и не удваиваются', () => {
  it('сумма количеств равна числу физических деталей, попавших в производство', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const r = calculateProduction(projectOf(cfg));
        let total = 0;
        for (const item of r.bom.parts) {
          expect(item.quantity).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(item.quantity)).toBe(true);
          // Количество строки равно числу её деталей-источников: именно
          // так двойной счёт становится невозможным.
          expect(item.quantity).toBe(item.sourcePartIds.length);
          total += item.quantity;
        }
        // И то же число — сумма размещённых и неразмещённых экземпляров.
        expect(total).toBe(r.bom.cutting.placedParts + r.bom.cutting.unplacedParts);
      }),
      { numRuns: 120 },
    );
  });

  it('одна физическая деталь входит ровно в одну строку спецификации', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const r = calculateProduction(projectOf(cfg));
        const sources = r.bom.parts.flatMap((p) => p.sourcePartIds);
        expect(new Set(sources).size).toBe(sources.length);
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 4 (§29): одинаковый проект — одинаковый результат', () => {
  it('расчёт детерминирован целиком, вместе со сводками', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        expect(JSON.stringify(calculateProduction(project))).toBe(JSON.stringify(calculateProduction(project)));
      }),
      { numRuns: 60 },
    );
  });
});

describe('property 5 (§29): сериализация не меняет результат', () => {
  it('проект после сохранения и загрузки даёт ту же спецификацию', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const restored = fromJson(toJson(project)).project;
        expect(JSON.stringify(calculateProduction(restored))).toBe(JSON.stringify(calculateProduction(project)));
      }),
      { numRuns: 50 },
    );
  });
});

describe('property 6 (§22): постороннее изменение не меняет спецификацию', () => {
  it('переименование проекта не трогает ни одной строки', () => {
    fc.assert(
      fc.property(config, fc.string({ minLength: 1, maxLength: 20 }), (cfg, name) => {
        const project = projectOf(cfg);
        const renamed: Project = { ...project, name, furniture: project.furniture.map((f) => ({ ...f, name })) };
        const before = calculateProduction(project).bom;
        const after = calculateProduction(renamed).bom;
        expect(after.parts.map((p) => `${p.id}:${String(p.quantity)}`)).toEqual(
          before.parts.map((p) => `${p.id}:${String(p.quantity)}`),
        );
        expect(after.edgeBanding).toEqual(before.edgeBanding);
      }),
      { numRuns: 50 },
    );
  });
});
