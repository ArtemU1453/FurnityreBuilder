import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import {
  calculateCutting,
  classifyPart,
  groupForCutting,
  isManufacturable,
  productionTypeOf,
  rotationAllowedFor,
  toProductionParts,
} from '../../../src/production/index.js';
import {
  createCountertop,
  createDrawersLeaf,
  createFalsePanel,
  createHandleOpeningSystem,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { DEFAULT_CUTTING_SETTINGS } from '../../../src/domain/index.js';
import type { Material, Part, Project } from '../../../src/domain/index.js';
import type { ProductionPart } from '../../../src/production/index.js';
import { makeProject } from './helpers.js';

/**
 * Физическая деталь → производственная позиция (PROMPT 17 §31).
 *
 * Проверяется главное разделение этапа: в раскрой попадает только то, что
 * действительно пилят из листа, каждая позиция знает свой материал и свою
 * толщину, а фурнитура и виртуальные объекты в раскрой не попадают вовсе.
 */

function geometryOf(project: Project): ReturnType<typeof buildGeometry> {
  return buildGeometry({
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
}

function productionOf(project: Project): readonly ProductionPart[] {
  return toProductionParts(geometryOf(project), project.materials, project.settings.cutting).parts;
}

const typesOf = (parts: readonly ProductionPart[]): string[] => [...new Set(parts.map((p) => p.partType))].sort();

// ── Что попадает в производство (§4–§5) ──────────────────────────────────────

describe('Test 1–3 (§4–§5): корпус, задняя стенка и статус объекта', () => {
  const parts = productionOf(makeProject());

  it('Test 1: боковины, крышка, дно и задняя стенка становятся позициями', () => {
    expect(typesOf(parts)).toEqual(['back', 'bottom', 'side', 'top']);
  });

  it('Test 2: боковины одинаковы, поэтому это одна позиция количеством 2', () => {
    const sides = parts.find((p) => p.partType === 'side');
    expect(sides?.quantity).toBe(2);
    expect(sides?.sourcePartIds).toHaveLength(2);
  });

  it('Test 3: статус объекта выводится из роли и разделяет пилимое и покупное', () => {
    expect(classifyPart('side')).toBe('physical');
    expect(classifyPart('handle')).toBe('hardware');
    expect(classifyPart('push-to-open')).toBe('hardware');
    expect(productionTypeOf('shelf-fixed')).toBe('shelf');
    expect(productionTypeOf('shelf-adjustable')).toBe('shelf');
  });
});

describe('Test 4 (§7): ручки и механизмы деталями раскроя не считаются', () => {
  const project = makeProject((furniture, ids) => {
    const facade = createHingedFacade(ids, furniture.root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...furniture,
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
    };
  });

  it('деталь ручки в геометрии есть, а в раскрое её нет', () => {
    const geometry = geometryOf(project);
    expect(geometry.parts.some((p: Part) => p.role === 'handle')).toBe(true);
    const parts = productionOf(project);
    expect(parts.some((p) => p.role === 'handle')).toBe(false);
    expect(parts.some((p) => p.partType === 'facade')).toBe(true);
  });

  it('и ни одна деталь не попадает в раскрой дважды', () => {
    const parts = productionOf(project);
    const allSources = parts.flatMap((p) => p.sourcePartIds);
    expect(new Set(allSources).size).toBe(allSources.length);
  });
});

describe('Test 5–8 (§4): наполнение, фасады и модификаторы корпуса', () => {
  it('Test 5: полки становятся позициями с количеством', () => {
    const parts = productionOf(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') })));
    const shelves = parts.find((p) => p.partType === 'shelf');
    expect(shelves?.quantity).toBe(3);
  });

  it('Test 6: перегородки секций становятся позициями', () => {
    const parts = productionOf(makeProject((f, ids) => ({ ...f, root: createSections(ids, 3, 16) })));
    expect(parts.some((p) => p.partType === 'partition')).toBe(true);
  });

  it('Test 7: дверь и фасады ящиков становятся позициями', () => {
    const withDoor = productionOf(makeProject((f, ids) => ({ ...f, facades: [createHingedFacade(ids, f.root.id, 2)] })));
    expect(withDoor.find((p) => p.partType === 'facade')?.quantity).toBe(2);

    // Три фасада ящиков дают три экземпляра, но НЕ обязательно одну
    // позицию: равные доли высоты ячейки округляются до десятой
    // миллиметра, и 652.7/652.7/652.6 — три детали, из которых одинаковы
    // только две. Объединять их в одну позицию было бы неправдой: по
    // такой спецификации распилили бы деталь не того размера.
    const withDrawers = productionOf(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 3) })));
    const facades = withDrawers.filter((p) => p.partType === 'facade');
    expect(facades.reduce((sum, p) => sum + p.quantity, 0)).toBe(3);
    expect(new Set(facades.map((p) => p.length)).size).toBe(facades.length);
  });

  it('Test 8: цоколь, столешница и фальшпанель становятся позициями', () => {
    const project = makeProject((f, ids) => ({
      ...f,
      carcass: {
        ...f.carcass,
        base: createPlinthBase(100),
        countertop: createCountertop(38, f.carcass.back.materialId),
        falsePanels: [createFalsePanel(ids, 'right')],
      },
    }));
    const types = typesOf(productionOf(project));
    expect(types).toContain('plinth');
    expect(types).toContain('countertop');
    expect(types).toContain('false-panel');
  });
});

describe('Test 9 (§6): деталей короба ящика нет — конструкция не подтверждена', () => {
  it('ящик даёт только фасад: боковины, задник и дно короба геометрия не строит', () => {
    const parts = productionOf(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 2) })));
    // `T-DRW-02`: конструкция короба референсом не подтверждена, поэтому
    // деталей `drawer-*` не существует ни в геометрии, ни в раскрое.
    // Архитектура для них готова (роли и тип `drawer-box` заведены),
    // но фиктивных размеров здесь нет.
    expect(parts.some((p) => p.partType === 'drawer-box')).toBe(false);
    expect(productionTypeOf('drawer-side')).toBe('drawer-box');
  });
});

// ── Материал и толщина (§8) ──────────────────────────────────────────────────

describe('Test 10–12 (§8): материал и толщина позиции', () => {
  const project = makeProject();
  const parts = productionOf(project);

  it('Test 10: у каждой позиции есть материал из реестра', () => {
    for (const part of parts) expect(project.materials.items[part.materialId]).toBeDefined();
  });

  it('Test 11: толщина берётся у детали, а не подставляется 16 мм', () => {
    const back = parts.find((p) => p.partType === 'back');
    const side = parts.find((p) => p.partType === 'side');
    expect(back?.thickness).toBe(3);
    expect(side?.thickness).toBe(16);
  });

  it('Test 12: кромка детали переносится в позицию без потерь', () => {
    const side = parts.find((p) => p.partType === 'side');
    const back = parts.find((p) => p.partType === 'back');
    expect(side?.edgeBanding.front).toBe(2);
    // Задняя стенка не оклеивается — кромки не должно быть ни одной.
    expect(back?.edgeBanding).toEqual({ front: 0, back: 0, left: 0, right: 0 });
  });
});

// ── Группировка (§11, §13) ───────────────────────────────────────────────────

describe('Test 13–15 (§11, §13): группы раскроя', () => {
  const project = makeProject();
  const parts = productionOf(project);
  const groups = groupForCutting(parts, project.materials);

  it('Test 13: корпус 16 мм и задняя стенка 3 мм не объединяются', () => {
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.thickness))).toEqual(new Set([16, 3]));
  });

  it('Test 14: детали одного материала и толщины лежат в одной группе', () => {
    const corpus = groups.find((g) => g.thickness === 16);
    expect(corpus?.parts.length).toBeGreaterThan(1);
    expect(new Set(corpus?.parts.map((p) => p.materialId)).size).toBe(1);
  });

  it('Test 15: группа знает имя материала и направление текстуры', () => {
    for (const group of groups) {
      expect(group.materialName.length).toBeGreaterThan(0);
      expect(['none', 'along-length', 'along-width']).toContain(group.grain);
    }
  });
});

// ── Текстура и поворот (§10, §18) ────────────────────────────────────────────

describe('Test 16–18 (§10, §18): направление текстуры и поворот', () => {
  const plain = { grainLocked: false } as Part;
  const locked = { grainLocked: true } as Part;

  it('Test 16: материал без текстуры разрешает поворот', () => {
    expect(rotationAllowedFor(plain, 'none', DEFAULT_CUTTING_SETTINGS)).toBe(true);
  });

  it('Test 17: направленная текстура запрещает поворот', () => {
    expect(rotationAllowedFor(plain, 'along-length', DEFAULT_CUTTING_SETTINGS)).toBe(false);
    expect(rotationAllowedFor(plain, 'along-width', DEFAULT_CUTTING_SETTINGS)).toBe(false);
  });

  it('Test 18: запрет от геометрии и политика проекта тоже запрещают поворот', () => {
    expect(rotationAllowedFor(locked, 'none', DEFAULT_CUTTING_SETTINGS)).toBe(false);
    expect(rotationAllowedFor(plain, 'none', { ...DEFAULT_CUTTING_SETTINGS, rotationPolicy: 'never' })).toBe(false);
  });

  it('текстурированный материал делает позиции неповорачиваемыми во всём проекте', () => {
    const base = makeProject();
    const textured: Project = {
      ...base,
      materials: {
        ...base.materials,
        items: Object.fromEntries(
          Object.entries(base.materials.items).map(([id, m]): [string, Material] => [id, { ...m, grain: 'along-length' }]),
        ),
      },
    };
    expect(productionOf(textured).every((p) => !p.rotationAllowed)).toBe(true);
  });
});

// ── Полный расчёт (§14, §24) ─────────────────────────────────────────────────

describe('Test 19–21 (§14, §24): расчёт проекта целиком', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 4, 'adjustable') }));
  const result = calculateCutting(project);

  it('Test 19: раскрой считается без ошибок и раскладывает детали', () => {
    expect(result.errors).toHaveLength(0);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(result.unplaced).toHaveLength(0);
  });

  it('Test 20: цепочка трассируемости проходит от размещения до ячейки', () => {
    const geometry = geometryOf(project);
    const placement = result.layouts.flatMap((l) => l.placements)[0]!;
    const productionPart = result.productionParts.find((p) => p.id === placement.productionPartId);
    const physical = geometry.parts.find((p) => p.id === placement.sourcePartId);
    expect(productionPart).toBeDefined();
    expect(physical).toBeDefined();
    expect(physical?.origin.furnitureId).toBe(project.furniture[0]!.id);
  });

  it('Test 21: расчёт не изменяет проект', () => {
    const snapshot = JSON.stringify(project);
    calculateCutting(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('изделие с ошибкой геометрии раскроя не получает', () => {
    const broken = makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } }));
    const brokenResult = calculateCutting(broken);
    expect(brokenResult.productionParts).toHaveLength(0);
    expect(brokenResult.warnings.some((w) => w.code === 'CUTTING_SKIPPED_BROKEN_GEOMETRY')).toBe(true);
  });
});

describe('Test 22 (§20): материал без формата листа не теряет детали', () => {
  it('детали уходят в unplaced с причиной INVALID_STOCK, а не исчезают', () => {
    const base = makeProject();
    const noSheet: Project = {
      ...base,
      materials: {
        ...base.materials,
        items: Object.fromEntries(
          Object.entries(base.materials.items).map(([id, m]): [string, Material] => {
            const { sheet: _sheet, ...rest } = m;
            return [id, rest];
          }),
        ),
      },
    };
    const result = calculateCutting(noSheet);
    expect(result.layouts).toHaveLength(0);
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(new Set(result.unplaced.map((u) => u.reason))).toEqual(new Set(['INVALID_STOCK']));
    // Ни один экземпляр не потерян: их столько же, сколько деталей.
    const required = result.productionParts.reduce((sum, p) => sum + p.quantity, 0);
    expect(result.unplaced).toHaveLength(required);
  });
});

describe('вспомогательное: isManufacturable совпадает с классификацией', () => {
  it('деталь считается производимой тогда и только тогда, когда она физическая', () => {
    const geometry = geometryOf(makeProject());
    for (const part of geometry.parts) {
      expect(isManufacturable(part)).toBe(classifyPart(part.role) === 'physical');
    }
  });
});
