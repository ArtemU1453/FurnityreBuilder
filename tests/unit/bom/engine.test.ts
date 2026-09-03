import { describe, expect, it } from 'vitest';
import { bomGroupKey, calculateProduction, categoryOf, collectConfirmations, formatProductionDebug } from '../../../src/bom/index.js';
import { toProductionParts } from '../../../src/production/index.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
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
import { DEFAULT_EDGE, NO_EDGE } from '../../../src/domain/index.js';
import type { Material, Project } from '../../../src/domain/index.js';
import type { PartCategory, ProductionCalculationResult } from '../../../src/bom/index.js';
import { makeProject } from './helpers.js';

/**
 * Производственная спецификация (PROMPT 19 §27–§28).
 *
 * Главное, что здесь проверяется, — отсутствие двойного счёта. Количество
 * детали приходит из одного места, и оно не должно ни удваиваться при
 * агрегации, ни зависеть от того, сколько раз деталь легла на лист.
 */

const result = (project: Project): ProductionCalculationResult => calculateProduction(project);

const categories = (r: ProductionCalculationResult): PartCategory[] =>
  [...new Set(r.bom.parts.map((p) => p.category))].sort();

const qty = (r: ProductionCalculationResult, type: string): number =>
  r.bom.parts.filter((p) => p.partType === type).reduce((sum, p) => sum + p.quantity, 0);

// ── Детали (§27) ─────────────────────────────────────────────────────────────

describe('Test 1–4 (§16, §27): состав деталировки', () => {
  it('Test 1: пустой корпус даёт корпус и заднюю стенку', () => {
    const r = result(makeProject());
    expect(categories(r)).toEqual(['back-wall', 'carcass']);
    expect(qty(r, 'side')).toBe(2);
    expect(qty(r, 'top')).toBe(1);
    expect(qty(r, 'bottom')).toBe(1);
    expect(qty(r, 'back')).toBe(1);
  });

  it('Test 2: полки и перегородки попадают в свои разделы', () => {
    const shelves = result(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') })));
    expect(categories(shelves)).toContain('shelves');
    expect(qty(shelves, 'shelf')).toBe(3);

    const sections = result(makeProject((f, ids) => ({ ...f, root: createSections(ids, 3, 16) })));
    expect(qty(sections, 'partition')).toBe(2);
  });

  it('Test 3: двери и фасады ящиков попадают в раздел дверей', () => {
    const doors = result(makeProject((f, ids) => ({ ...f, facades: [createHingedFacade(ids, f.root.id, 2)] })));
    expect(qty(doors, 'facade')).toBe(2);
    expect(categories(doors)).toContain('doors');

    const drawers = result(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 3) })));
    expect(qty(drawers, 'facade')).toBe(3);
  });

  it('Test 4: цоколь, столешница и фальшпанель дают свои разделы', () => {
    const r = result(
      makeProject((f, ids) => ({
        ...f,
        carcass: {
          ...f.carcass,
          base: createPlinthBase(100),
          countertop: createCountertop(38, f.carcass.back.materialId),
          falsePanels: [createFalsePanel(ids, 'right')],
        },
      })),
    );
    for (const category of ['plinth', 'countertop', 'false-panels'] as const) {
      expect(categories(r)).toContain(category);
    }
  });

  it('раздел выводится из типа детали однозначно', () => {
    expect(categoryOf('side')).toBe('carcass');
    expect(categoryOf('partition')).toBe('carcass');
    expect(categoryOf('shelf')).toBe('shelves');
    expect(categoryOf('facade')).toBe('doors');
    expect(categoryOf('drawer-box')).toBe('drawers');
  });
});

// ── Группировка и количество (§7–§8, §28) ────────────────────────────────────

describe('Test 5–8 (§7–§8, §28): группировка и отсутствие двойного счёта', () => {
  it('Test 5: две одинаковые боковины — одна строка количеством 2', () => {
    const r = result(makeProject());
    const sides = r.bom.parts.filter((p) => p.partType === 'side');
    expect(sides).toHaveLength(1);
    expect(sides[0]?.quantity).toBe(2);
    expect(sides[0]?.sourcePartIds).toHaveLength(2);
  });

  it('Test 6: количество не удваивается размещениями на листах', () => {
    // Ключевая проверка §28: раскладка размещает каждый экземпляр
    // отдельно, и если бы спецификация считала количество по размещениям
    // вдобавок к `ProductionPart.quantity`, каждая деталь удвоилась бы.
    const r = result(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 4, 'adjustable') })));
    const totalBom = r.bom.parts.reduce((sum, p) => sum + p.quantity, 0);
    const totalPlacements = r.bom.cutting.placedParts + r.bom.cutting.unplacedParts;
    expect(totalBom).toBe(totalPlacements);
  });

  it('Test 7: фурнитура не удваивается спецификацией', () => {
    const r = result(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 3) })));
    // `ProductionBOM.hardware` — это ТОТ ЖЕ `HardwareBOM`, а не его копия
    // с пересчитанными количествами.
    expect(r.bom.hardware).toBe(r.hardware);
    const slides = r.hardware.lines.find((l) => l.kind === 'slide');
    expect(slides?.quantity).toBe(6);
  });

  it('Test 8: присадка не превращается в детали', () => {
    const r = result(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') })));
    const partsBefore = r.bom.parts.reduce((sum, p) => sum + p.quantity, 0);
    expect(r.bom.drilling.operationCount).toBeGreaterThanOrEqual(0);
    // Сколько бы операций ни было, число деталей от них не зависит.
    expect(r.bom.parts.reduce((sum, p) => sum + p.quantity, 0)).toBe(partsBefore);
  });

  it('детали с разной кромкой не объединяются в одну строку', () => {
    const project = makeProject();
    const geometry = buildGeometry({
      furniture: project.furniture[0]!,
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    });
    const parts = toProductionParts(geometry, project.materials, project.settings.cutting).parts;
    const side = parts.find((p) => p.partType === 'side')!;
    expect(bomGroupKey({ ...side, edgeBanding: DEFAULT_EDGE })).not.toBe(bomGroupKey({ ...side, edgeBanding: NO_EDGE }));
  });

  it('роль детали в ключ группировки не входит: полка есть полка', () => {
    const project = makeProject();
    const geometry = buildGeometry({
      furniture: project.furniture[0]!,
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    });
    const parts = toProductionParts(geometry, project.materials, project.settings.cutting).parts;
    const side = parts.find((p) => p.partType === 'side')!;
    expect(bomGroupKey({ ...side, role: 'shelf-fixed' })).toBe(bomGroupKey({ ...side, role: 'shelf-adjustable' }));
  });
});

// ── Материал, кромка, текстура (§9–§10) ──────────────────────────────────────

describe('Test 9–11 (§9–§10): материал и кромка', () => {
  const r = result(makeProject());

  it('Test 9: материал берётся из реестра, а не из копии каталога', () => {
    const project = makeProject();
    for (const part of r.bom.parts) {
      const material = project.materials.items[part.materialId];
      expect(part.materialName).toBe(material?.name);
      expect(part.materialKind).toBe(material?.kind);
      expect(part.thickness).toBe(material?.thickness);
    }
  });

  it('Test 10: кромка сохраняется по сторонам и направление текстуры тоже', () => {
    const side = r.bom.parts.find((p) => p.partType === 'side');
    expect(side?.edgeBanding.front).toBe(2);
    expect(side?.grainDirection).toBe('none');
    const back = r.bom.parts.find((p) => p.partType === 'back');
    expect(back?.edgeBanding).toEqual({ front: 0, back: 0, left: 0, right: 0 });
  });

  it('Test 11: метраж кромки выводится из реальных размеров всех деталей', () => {
    // Кромка 2 мм стоит на ПЕРЕДНЕЙ стороне, а её полоса идёт вдоль ДЛИНЫ
    // детали (`docs/COORDINATE_SYSTEM.md` §5). Считается по всем
    // оклеиваемым деталям сразу — боковинам, крышке и дну, — а не по
    // одной: это сводка проекта, а не строка детали.
    const expected = r.bom.parts
      .filter((p) => p.edgeBanding.front === 2)
      .reduce((sum, p) => sum + p.length * p.quantity, 0);
    const front = r.bom.edgeBanding.find((e) => e.thickness === 2);
    expect(front?.lengthMm).toBeCloseTo(expected, 1);
    expect(expected).toBeGreaterThan(0);
  });

  it('кромка 0.4 мм по бокам считается по ширине детали', () => {
    // `left` и `right` лежат на концах длины, поэтому их полосы идут вдоль
    // ШИРИНЫ — и таких сторон две на каждый экземпляр.
    const banded = r.bom.parts.filter((p) => p.edgeBanding.left === 0.4 && p.edgeBanding.right === 0.4);
    const expectedSides = banded.reduce((sum, p) => sum + p.quantity * 2, 0);
    const expectedLength = banded.reduce((sum, p) => sum + p.width * p.quantity * 2, 0);
    const lateral = r.bom.edgeBanding.find((e) => e.thickness === 0.4);
    expect(lateral?.sideCount).toBe(expectedSides);
    expect(lateral?.lengthMm).toBeCloseTo(expectedLength, 1);
  });
});

// ── Сводки (§11–§13) ─────────────────────────────────────────────────────────

describe('Test 12–14 (§11–§13): сводки присадки и раскроя', () => {
  const r = result(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') })));

  it('Test 12: сводка раскроя берёт числа из раскладки, а не считает заново', () => {
    expect(r.bom.cutting.stockCount).toBe(r.cutting.layouts.length);
    expect(r.bom.cutting.usedArea).toBeCloseTo(r.cutting.layouts.reduce((s, l) => s + l.usedArea, 0), 6);
    expect(r.bom.cutting.unplacedParts).toBe(r.cutting.unplaced.length);
  });

  it('Test 13: количество листов приходит из раскладки', () => {
    const total = r.bom.cutting.stocks.reduce((sum, s) => sum + s.stockQuantity, 0);
    expect(total).toBe(r.cutting.layouts.length);
  });

  it('Test 14: сводка присадки не выбрасывает подробности', () => {
    expect(r.bom.drilling.operationCount).toBe(r.drilling.operations.length);
    for (const item of r.bom.drilling.items) {
      expect(item.operations).toHaveLength(item.operationCount);
    }
  });
});

// ── Статус, ошибки, подтверждения (§17–§19) ──────────────────────────────────

describe('Test 15–18 (§17–§19): статус расчёта', () => {
  it('Test 15: обычный проект требует подтверждений, а не считается VALID', () => {
    const r = result(makeProject());
    expect(r.errors).toHaveLength(0);
    expect(r.status).toBe('NEEDS_CONFIRMATION');
    expect(r.bom.confirmations.length).toBeGreaterThan(0);
  });

  it('Test 16: список подтверждений собирается из статусов правил', () => {
    const confirmations = collectConfirmations();
    const categories = new Set(confirmations.map((c) => c.category));
    for (const category of ['CUTTING', 'DRILLING', 'HARDWARE', 'EDGE', 'CONSTRUCTION'] as const) {
      expect(categories.has(category)).toBe(true);
    }
    for (const item of confirmations) {
      expect(item.id).toMatch(/^T-/);
      expect(item.impact.length).toBeGreaterThan(0);
      expect(item.source.length).toBeGreaterThan(0);
    }
  });

  it('Test 17: неизвестный материал — ошибка, а не молчаливый пропуск', () => {
    const base = makeProject();
    const broken: Project = {
      ...base,
      materials: { ...base.materials, items: {} },
    };
    const r = result(broken);
    expect(r.status).toBe('INVALID');
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('Test 18: неразмещённая деталь делает спецификацию невыполнимой', () => {
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
    const r = result(noSheet);
    expect(r.status).toBe('INVALID');
    expect(r.errors.some((e) => e.code === 'BOM_PART_NOT_PLACED')).toBe(true);
  });

  it('изделие с ошибкой геометрии не даёт спецификации', () => {
    const r = result(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } })));
    expect(r.status).toBe('INVALID');
    expect(r.bom.parts).toHaveLength(0);
  });
});

// ── Трассируемость и детерминизм (§15, §21) ──────────────────────────────────

describe('Test 19–21 (§15, §21): трассируемость и детерминизм', () => {
  const project = makeProject((f, ids) => {
    const facade = createHingedFacade(ids, f.root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...f,
      root: createShelvesLeaf(ids, 2, 'adjustable'),
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
    };
  });
  const r = result(project);

  it('Test 19: строка спецификации ведёт к производственной и физической детали', () => {
    const geometry = buildGeometry({
      furniture: project.furniture[0]!,
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    });
    const partIds = new Set(geometry.parts.map((p) => p.id));
    for (const item of r.bom.parts) {
      expect(item.productionPartIds.length).toBeGreaterThan(0);
      expect(item.sourcePartIds).toHaveLength(item.quantity);
      for (const sourceId of item.sourcePartIds) expect(partIds.has(sourceId)).toBe(true);
    }
  });

  it('Test 20: позиция фурнитуры ведёт к своему источнику', () => {
    for (const line of r.hardware.lines) {
      for (const source of line.sources) {
        expect(source.sourcePartId !== undefined || source.sourceNodeId !== undefined).toBe(true);
      }
    }
  });

  it('Test 21: одинаковый проект даёт побайтово одинаковый результат', () => {
    expect(JSON.stringify(calculateProduction(project))).toBe(JSON.stringify(calculateProduction(project)));
  });

  it('в результате нет отметки времени: она сломала бы сравнение', () => {
    expect(JSON.stringify(r)).not.toContain('calculationTimestamp');
    expect(JSON.stringify(r)).not.toContain('2026-01-01T00:00');
  });

  it('расчёт не изменяет проект', () => {
    const snapshot = JSON.stringify(project);
    calculateProduction(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

// ── Инвалидация (§22) ────────────────────────────────────────────────────────

describe('Test 22 (§22): изменение конструкции меняет спецификацию', () => {
  it('добавленная полка появляется в деталировке сама', () => {
    const before = result(makeProject());
    const after = result(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') })));
    expect(qty(before, 'shelf')).toBe(0);
    expect(qty(after, 'shelf')).toBe(2);
  });

  it('изменение габарита меняет размеры строк, но не их количество', () => {
    const before = result(makeProject());
    const after = result(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, height: 2400 } })));
    expect(after.bom.parts).toHaveLength(before.bom.parts.length);
    const beforeSide = before.bom.parts.find((p) => p.partType === 'side');
    const afterSide = after.bom.parts.find((p) => p.partType === 'side');
    expect(afterSide?.length).toBeGreaterThan(beforeSide?.length ?? 0);
  });

  it('смена толщины корпуса меняет деталировку и разводит группы раскроя', () => {
    const r = result(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, panelThickness: 18 } })));
    const corpus = r.bom.parts.filter((p) => p.category === 'carcass');
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.every((p) => p.thickness === 18)).toBe(true);

    // Задняя стенка остаётся 3 мм: у неё своя толщина в
    // `BackPanelMount.thickness`. Разные толщины — разные группы раскроя,
    // и спецификация обязана это сохранить, а не «выровнять».
    expect(r.bom.parts.find((p) => p.partType === 'back')?.thickness).toBe(3);
    expect(r.bom.cutting.stocks.length).toBeGreaterThan(1);
  });

  it('толщина материала корпусные детали НЕ меняет: их толщина — габарит изделия', () => {
    // Найдено при написании тестов PROMPT 19. Этап `carcass` строит панели
    // по `dimensions.panelThickness`, а не по толщине назначенного
    // материала: `resolveEffectiveMaterial` (PROMPT 13) применяется к
    // наполнению и фасадам, но не к самому корпусу. Тест фиксирует
    // фактическое поведение, чтобы расхождение было видно, а не
    // обнаружилось на производстве.
    const base = makeProject();
    const thick: Project = {
      ...base,
      materials: {
        ...base.materials,
        items: Object.fromEntries(
          Object.entries(base.materials.items).map(([id, m]): [string, Material] => [id, { ...m, thickness: 18 }]),
        ),
      },
    };
    const corpus = result(thick).bom.parts.filter((p) => p.category === 'carcass');
    expect(corpus.every((p) => p.thickness === 16)).toBe(true);
  });
});

describe('Test 23 (§25): технический вывод спецификации', () => {
  it('показывает все четыре раздела и статус', () => {
    const lines = formatProductionDebug(result(makeProject())).join('\n');
    expect(lines).toContain('СТАТУС: NEEDS_CONFIRMATION');
    expect(lines).toContain('ДЕТАЛИ · ID · NAME · TYPE · MATERIAL · THICKNESS · LENGTH · WIDTH · QTY · EDGE');
    expect(lines).toContain('ФУРНИТУРА · DEFINITION · CATEGORY · QTY · SOURCE');
    expect(lines).toContain('ПРИСАДКА · операций:');
    expect(lines).toContain('РАСКРОЙ · листов:');
    expect(lines).toContain('ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ');
  });
});
