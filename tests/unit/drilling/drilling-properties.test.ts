import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateDrilling, faceFrame } from '../../../src/drilling/index.js';
import { toProductionParts } from '../../../src/production/index.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import {
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createPushToOpenSystem,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';
import { geometryOf, HYPOTHETICAL_PARAMETERS, makeProject } from './helpers.js';

/**
 * Property-тесты присадки (PROMPT 18 §30).
 *
 * Проверяются ровно те инварианты, которые перечисляет задание. Они
 * сильнее примеров: отверстие, вылезшее за деталь на одной конфигурации из
 * ста, — это одна испорченная заготовка в партии, и найти её примером
 * почти невозможно.
 *
 * Параметры присадки здесь гипотетические (`HYPOTHETICAL_PARAMETERS`):
 * иначе движок честно не выдал бы ни одной операции и проверять было бы
 * нечего. В приложение эти числа не попадают.
 */

const config = fc.record({
  fill: fc.constantFrom<'empty' | 'shelves' | 'drawers' | 'sections'>('empty', 'shelves', 'drawers', 'sections'),
  count: fc.integer({ min: 1, max: 4 }),
  opening: fc.constantFrom<'none' | 'handle' | 'push'>('none', 'handle', 'push'),
  doors: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
  width: fc.integer({ min: 400, max: 2400 }),
  height: fc.integer({ min: 700, max: 2400 }),
  depth: fc.integer({ min: 250, max: 700 }),
});

type Config = {
  fill: 'empty' | 'shelves' | 'drawers' | 'sections';
  count: number;
  opening: 'none' | 'handle' | 'push';
  doors: 0 | 1 | 2;
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
    const leaves = facade.leaves.map((leaf) => {
      if (cfg.opening === 'none') return leaf;
      const opening = cfg.opening === 'handle' ? createHandleOpeningSystem(ids, leaf.hingeSide) : createPushToOpenSystem(ids, leaf.hingeSide);
      return { ...leaf, opening };
    });
    return { ...withRoot, facades: [{ ...facade, leaves }] };
  });
}

const planOf = (project: Project): ReturnType<typeof calculateDrilling> =>
  calculateDrilling(project, { parameters: HYPOTHETICAL_PARAMETERS });

describe('property 1 (§30): каждая операция принадлежит существующей детали', () => {
  it('и физической, и производственной', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const geometry = geometryOf(project);
        if (geometry.diagnostics.some((d) => d.severity === 'error')) return;
        const production = toProductionParts(geometry, project.materials, project.settings.cutting).parts;
        const partIds = new Set(geometry.parts.map((p) => p.id));
        const productionIds = new Set(production.map((p) => p.id));

        for (const op of planOf(project).operations) {
          expect(partIds.has(op.sourcePartId)).toBe(true);
          expect(productionIds.has(op.productionPartId)).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 2 (§30): координаты и глубины всегда допустимы', () => {
  it('отверстие целиком внутри грани, глухое не глубже материала', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const geometry = geometryOf(project);
        if (geometry.diagnostics.some((d) => d.severity === 'error')) return;
        const partsById = new Map(geometry.parts.map((p) => [p.id, p]));

        const plan = planOf(project);
        for (const op of plan.operations) {
          const part = partsById.get(op.sourcePartId);
          expect(part).toBeDefined();
          if (part === undefined) continue;
          const frame = faceFrame(part, op.face);
          const radius = op.diameter / 2;
          expect(op.x - radius).toBeGreaterThanOrEqual(-0.001);
          expect(op.y - radius).toBeGreaterThanOrEqual(-0.001);
          expect(op.x + radius).toBeLessThanOrEqual(frame.extentX + 0.001);
          expect(op.y + radius).toBeLessThanOrEqual(frame.extentY + 0.001);
          expect(op.depth).toBeGreaterThan(0);
          if (op.through === 'blind') expect(op.depth).toBeLessThanOrEqual(frame.available + 0.001);
        }
        // Движок проверяет сам себя; property-тест утверждает, что
        // проверять нечего.
        expect(plan.errors).toHaveLength(0);
      }),
      { numRuns: 120 },
    );
  });
});

describe('property 3 (§30): одинаковый вход — одинаковый план', () => {
  it('расчёт детерминирован', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        expect(JSON.stringify(planOf(project).operations)).toBe(JSON.stringify(planOf(project).operations));
      }),
      { numRuns: 80 },
    );
  });
});

describe('property 4 (§30): сериализация не меняет план', () => {
  it('проект после сохранения и загрузки даёт ту же присадку', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const restored = fromJson(toJson(project)).project;
        expect(JSON.stringify(planOf(restored).operations)).toBe(JSON.stringify(planOf(project).operations));
      }),
      { numRuns: 60 },
    );
  });
});

describe('property 5 (§30): изменение, не относящееся к присадке, не создаёт отверстий', () => {
  it('переименование проекта и изделия оставляет план прежним', () => {
    fc.assert(
      fc.property(config, fc.string({ minLength: 1, maxLength: 20 }), (cfg, name) => {
        const project = projectOf(cfg);
        const renamed: Project = { ...project, name, furniture: project.furniture.map((f) => ({ ...f, name })) };
        expect(planOf(renamed).operations.map((o) => o.id)).toEqual(planOf(project).operations.map((o) => o.id));
      }),
      { numRuns: 60 },
    );
  });

  it('смена политики раскроя не добавляет и не убирает отверстий', () => {
    fc.assert(
      fc.property(config, (cfg) => {
        const project = projectOf(cfg);
        const other: Project = {
          ...project,
          settings: { ...project.settings, cutting: { ...project.settings.cutting, rotationPolicy: 'never' } },
        };
        expect(planOf(other).operations.length).toBe(planOf(project).operations.length);
      }),
      { numRuns: 40 },
    );
  });
});

describe('property 6 (§26): изменение габарита пересчитывает присадку', () => {
  it('отверстия остаются внутри детали при любой ширине изделия', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 2400 }), (width) => {
        const project = projectOf({ fill: 'empty', count: 1, opening: 'handle', doors: 1, width, height: 2000, depth: 500 });
        const plan = planOf(project);
        expect(plan.errors).toHaveLength(0);
      }),
      { numRuns: 60 },
    );
  });
});
