import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { resolveVerticalLayout } from '../../../src/geometry/stages/carcass.js';
import {
  createCountertop,
  createFalsePanel,
  createPlinthBase,
  createShelvesLeaf,
  createTopSection,
} from '../../../src/domain/furniture/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import type { CarcassSpec, Furniture, MaterialId, OverhangSpec, Part } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Конструктивные модификаторы корпуса (PROMPT 15 §17).
 *
 * Главное, что здесь проверяется: все шесть модификаторов делят ОДИН
 * вертикальный бюджет и одну рамку корпуса, а не заводят свою геометрию.
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

function withCarcass(input: GeometryInput, patch: Partial<CarcassSpec>): GeometryInput {
  const carcass: CarcassSpec = { ...input.furniture.carcass, ...patch };
  const furniture: Furniture = { ...input.furniture, carcass };
  return { ...input, furniture };
}

const byRole = (parts: readonly Part[], role: Part['role']): readonly Part[] => parts.filter((p) => p.role === role);
const materialId = (input: GeometryInput): MaterialId =>
  Object.keys(input.materials.items)[0] as MaterialId;

// ── Свесы (§17) ──────────────────────────────────────────────────────────────

describe('Свес: 0, положительный, несколько направлений (§17)', () => {
  const overhang = (over: Partial<OverhangSpec>): OverhangSpec => ({
    front: 0,
    back: 0,
    left: 0,
    right: 0,
    appliesTo: ['top'],
    ...over,
  });

  it('нулевой свес не меняет ни одной детали', () => {
    const without = buildGeometry(makeGeometryInput(DIMS));
    const zero = buildGeometry(withCarcass(makeGeometryInput(DIMS), { overhang: overhang({}) }));
    expect(byRole(zero.parts, 'top')[0]).toEqual(byRole(without.parts, 'top')[0]);
  });

  it('боковой свес вкладной горизонтали не применяется: она стоит МЕЖДУ боковин', () => {
    // При схеме `sides-through` крышка вкладная. Расширить её вбок значило
    // бы ввести её в тело боковины — движок отказывается и объясняет причину
    // (docs/GEOMETRY_RULES.md §26.2).
    const without = buildGeometry(makeGeometryInput(DIMS));
    const with_ = buildGeometry(withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ left: 20, right: 30 }) }));
    expect(byRole(with_.parts, 'top')[0]?.size.x).toBe(byRole(without.parts, 'top')[0]!.size.x);
    expect(with_.diagnostics.some((d) => d.code === 'OVERHANG_INCOMPATIBLE_WITH_SCHEME')).toBe(true);
    expect(findPartOverlaps(with_.parts)).toHaveLength(0);
  });

  it('боковой свес сквозной горизонтали упирается в начало координат — явная ошибка', () => {
    // При `horizontals-through` крышка лежит поверх боковин и выступать за
    // них МОГЛА БЫ, но её левый край уже стоит на x = 0: свес влево уводит
    // деталь за начало координат, которое по определению — левый край
    // изделия (docs/COORDINATE_SYSTEM.md §1). Ограничение системы координат,
    // а не формулы свеса; см. docs/STRUCTURAL_MODIFIERS.md §2.
    const input = makeGeometryInput(DIMS, { verticalPriority: 'horizontals-through' });
    const result = buildGeometry(withCarcass(input, { overhang: overhang({ left: 20 }) }));
    expect(result.diagnostics.some((d) => d.code === 'OVERHANG_OUT_OF_BOUNDS' && d.severity === 'error')).toBe(true);
  });

  it('свес вперёд расширяет крышку по глубине, назад — тоже', () => {
    const without = buildGeometry(makeGeometryInput(DIMS));
    const with_ = buildGeometry(withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ front: 25, back: 3 }) }));
    const a = byRole(without.parts, 'top')[0]!;
    const b = byRole(with_.parts, 'top')[0]!;
    expect(b.size.z).toBe(a.size.z + 28);
    expect(b.position.z).toBe(a.position.z - 3);
  });

  it('свес НЕ распространяется автоматически: дно и боковины не тронуты', () => {
    const without = buildGeometry(makeGeometryInput(DIMS));
    const with_ = buildGeometry(withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ left: 50, right: 50 }) }));
    expect(byRole(with_.parts, 'bottom')[0]).toEqual(byRole(without.parts, 'bottom')[0]);
    expect(byRole(with_.parts, 'side')).toEqual(byRole(without.parts, 'side'));
  });

  it('appliesTo решает применимость: свес на дно не трогает крышку', () => {
    const without = buildGeometry(makeGeometryInput(DIMS));
    const with_ = buildGeometry(
      withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ front: 30, appliesTo: ['bottom'] }) }),
    );
    expect(byRole(with_.parts, 'bottom')[0]!.size.z).toBe(byRole(without.parts, 'bottom')[0]!.size.z + 30);
    expect(byRole(with_.parts, 'top')[0]!.size.z).toBe(byRole(without.parts, 'top')[0]!.size.z);
  });

  it('изменение габарита пересчитывает деталь со свесом', () => {
    const a = buildGeometry(withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ front: 25 }) }));
    const b = buildGeometry(
      withCarcass(makeGeometryInput({ ...DIMS, width: 1400 }), { overhang: overhang({ front: 25 }) }),
    );
    expect(byRole(b.parts, 'top')[0]!.size.x - byRole(a.parts, 'top')[0]!.size.x).toBe(400);
    // Свес при этом не «уехал»: он по-прежнему ровно 25 мм вперёд.
    const plain = buildGeometry(makeGeometryInput({ ...DIMS, width: 1400 }));
    expect(byRole(b.parts, 'top')[0]!.size.z - byRole(plain.parts, 'top')[0]!.size.z).toBe(25);
  });

  it('свес наружу за начало координат — явная ошибка', () => {
    const result = buildGeometry(
      withCarcass(makeGeometryInput(DIMS), { overhang: overhang({ back: 50, appliesTo: ['top'] }) }),
    );
    // Задняя стенка стоит в z ∈ [0, 3], поэтому свес назад больше 3 мм
    // выводит крышку за начало координат.
    expect(result.diagnostics.some((d) => d.code === 'OVERHANG_OUT_OF_BOUNDS' && d.severity === 'error')).toBe(true);
  });
});

// ── Верхняя секция и зазор до потолка (§17) ──────────────────────────────────

describe('Верхняя секция: выключена, включена, изменение высоты (§17)', () => {
  it('без антресоли деталей каркаса ровно четыре', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(byRole(result.parts, 'side')).toHaveLength(2);
    expect(byRole(result.parts, 'top')).toHaveLength(1);
    expect(byRole(result.parts, 'bottom')).toHaveLength(1);
  });

  it('включённая антресоль удваивает оболочку и ужимает основной корпус', () => {
    const without = buildGeometry(makeGeometryInput(DIMS));
    const with_ = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(400) }));

    expect(byRole(with_.parts, 'side')).toHaveLength(4);
    expect(byRole(with_.parts, 'top')).toHaveLength(2);
    expect(with_.innerVolume.size.y).toBe(without.innerVolume.size.y - 400);
    // Габарит не изменился: антресоль входит в H.
    expect(with_.boundingBox.totalHeight).toBe(2000);
    expect(findPartOverlaps(with_.parts)).toHaveLength(0);
  });

  it('антресоль стоит НАД основным корпусом, а не внутри него', () => {
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(400) }));
    const mainTop = byRole(result.parts, 'top').find((p) => !p.label.includes('антресоль'))!;
    const topSectionBottom = byRole(result.parts, 'bottom').find((p) => p.label.includes('антресоль'))!;
    expect(topSectionBottom.position.y).toBeGreaterThanOrEqual(mainTop.position.y + mainTop.size.y);
  });

  it('изменение высоты антресоли перераспределяет высоту основного корпуса', () => {
    const a = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(300) }));
    const b = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(500) }));
    expect(b.innerVolume.size.y).toBe(a.innerVolume.size.y - 200);
  });

  it('зазор между корпусом и антресолью физически пуст', () => {
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(300, 50) }));
    const mainTop = byRole(result.parts, 'top').find((p) => !p.label.includes('антресоль'))!;
    const tsBottom = byRole(result.parts, 'bottom').find((p) => p.label.includes('антресоль'))!;
    expect(tsBottom.position.y - (mainTop.position.y + mainTop.size.y)).toBe(50);
  });

  it('наполнение антресоли пока не строится — статус явный', () => {
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { topSection: createTopSection(300) }));
    expect(result.diagnostics.some((d) => d.code === 'TOP_SECTION_CONTENT_NOT_IMPLEMENTED')).toBe(true);
  });
});

describe('Зазор до потолка: 0, положительный, изменение H (§17)', () => {
  it('нулевой зазор ничего не меняет', () => {
    const a = buildGeometry(makeGeometryInput(DIMS));
    const b = buildGeometry(withCarcass(makeGeometryInput(DIMS), { ceilingGap: 0 }));
    expect(b.innerVolume).toEqual(a.innerVolume);
  });

  it('положительный зазор ужимает корпус и остаётся пустым', () => {
    const a = buildGeometry(makeGeometryInput(DIMS));
    const b = buildGeometry(withCarcass(makeGeometryInput(DIMS), { ceilingGap: 150 }));
    expect(b.innerVolume.size.y).toBe(a.innerVolume.size.y - 150);
    // Над корпусом нет ни одной детали: зазор — пустое место.
    const highest = Math.max(...b.parts.map((p) => p.position.y + p.size.y));
    expect(b.structure.totalTop - highest).toBe(150);
  });

  it('увеличение H возвращает корпусу высоту при том же зазоре', () => {
    const a = buildGeometry(withCarcass(makeGeometryInput(DIMS), { ceilingGap: 150 }));
    const b = buildGeometry(withCarcass(makeGeometryInput({ ...DIMS, height: 2300 }), { ceilingGap: 150 }));
    expect(b.innerVolume.size.y).toBe(a.innerVolume.size.y + 300);
  });

  it('источник истины — H: сумма полос равна габариту', () => {
    const layout = resolveVerticalLayout({
      base: createPlinthBase(100),
      height: 2400,
      heightIncludesBase: true,
      countertop: createCountertop(38, 'm' as MaterialId),
      topSection: createTopSection(400, 20),
      ceilingGap: 60,
    });
    expect(layout.carcassHeight).toBe(2400 - 100 - 38 - 20 - 400 - 60);
    expect(layout.totalTop).toBe(2400);
  });
});

// ── Столешница (§17) ─────────────────────────────────────────────────────────

describe('Столешница: выключена, включена, толщина, свесы (§17)', () => {
  it('без столешницы деталей роли countertop нет', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(byRole(result.parts, 'countertop')).toHaveLength(0);
  });

  it('включённая столешница даёт деталь над корпусом', () => {
    const input = makeGeometryInput(DIMS);
    const result = buildGeometry(withCarcass(input, { countertop: createCountertop(38, materialId(input)) }));
    const top = byRole(result.parts, 'countertop')[0];
    expect(top).toBeDefined();
    expect(top?.size.y).toBe(38);
    // Столешница лежит ровно на верхе основного корпуса.
    expect(top?.position.y).toBe(result.structure.carcassY0 + result.structure.carcassHeight);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('толщина столешницы входит в бюджет высоты и ужимает корпус', () => {
    const input = makeGeometryInput(DIMS);
    const without = buildGeometry(input);
    const with_ = buildGeometry(withCarcass(input, { countertop: createCountertop(38, materialId(input)) }));
    expect(with_.innerVolume.size.y).toBe(without.innerVolume.size.y - 38);
  });

  it('передний свес столешницы расширяет её, не трогая корпус', () => {
    const input = makeGeometryInput(DIMS);
    const base = createCountertop(38, materialId(input));
    const plain = buildGeometry(withCarcass(input, { countertop: base }));
    const result = buildGeometry(withCarcass(input, { countertop: { ...base, overhangFront: 30 } }));
    const top = byRole(result.parts, 'countertop')[0]!;
    expect(top.size.z).toBe(byRole(plain.parts, 'countertop')[0]!.size.z + 30);
    expect(top.size.x).toBe(1000);
    // Корпус не изменился ни на миллиметр.
    expect(byRole(result.parts, 'side')).toEqual(byRole(plain.parts, 'side'));
  });

  it('боковой свес столешницы упирается в начало координат — явная ошибка', () => {
    const input = makeGeometryInput(DIMS);
    const base = createCountertop(38, materialId(input));
    const result = buildGeometry(withCarcass(input, { countertop: { ...base, overhangLeft: 20 } }));
    expect(result.diagnostics.some((d) => d.code === 'COUNTERTOP_GEOMETRY_INVALID' && d.severity === 'error')).toBe(true);
  });

  it('общий свес корпуса складывается с собственным свесом столешницы', () => {
    const input = makeGeometryInput(DIMS);
    const base = createCountertop(38, materialId(input));
    const result = buildGeometry(
      withCarcass(input, {
        countertop: { ...base, overhangFront: 10 },
        overhang: { front: 15, back: 0, left: 0, right: 0, appliesTo: ['countertop'] },
      }),
    );
    const plain = buildGeometry(withCarcass(input, { countertop: base }));
    expect(byRole(result.parts, 'countertop')[0]!.size.z).toBe(byRole(plain.parts, 'countertop')[0]!.size.z + 25);
  });
});

// ── Крепление к стене (§17) ──────────────────────────────────────────────────

describe('Крепление к стене: включение и смена режима (§17)', () => {
  it('по умолчанию напольная установка, деталей она не даёт', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.structure.wallMount).toBe('floor-standing');
  });

  it('смена режима меняет состояние, но не геометрию', () => {
    const floor = buildGeometry(makeGeometryInput(DIMS));
    const wall = buildGeometry(withCarcass(makeGeometryInput(DIMS), { wallMount: { mode: 'wall-mounted' } }));
    expect(wall.structure.wallMount).toBe('wall-mounted');
    expect(wall.parts).toEqual(floor.parts);
  });

  it('подвесной режим тоже только состояние', () => {
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { wallMount: { mode: 'suspended', elevation: 600 } }));
    expect(result.structure.wallMount).toBe('suspended');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });
});

// ── Фальшпанели (§17) ────────────────────────────────────────────────────────

describe('Фальшпанели: добавление, удаление, размер, материал (§17)', () => {
  const panelIds = createSequentialIdFactory('fp');

  it('без панелей деталей роли filler нет', () => {
    expect(byRole(buildGeometry(makeGeometryInput(DIMS)).parts, 'filler')).toHaveLength(0);
  });

  it('панель слева упирается в начало координат — явная ошибка, а не отрицательная координата', () => {
    // Слева от корпуса места нет: x = 0 — это его левый край и одновременно
    // начало координат (docs/COORDINATE_SYSTEM.md §1). Панель отклоняется с
    // объяснением, а не строится с отрицательным x.
    const panel = createFalsePanel(panelIds, 'left');
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [panel] }));
    expect(byRole(result.parts, 'filler')).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'FALSE_PANEL_GEOMETRY_INVALID' && d.severity === 'error')).toBe(true);
  });

  it('панель справа встаёт за габарит корпуса', () => {
    const panel = createFalsePanel(panelIds, 'right');
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [panel] }));
    const built = byRole(result.parts, 'filler')[0]!;
    expect(built.position.x).toBe(1000);
    expect(built.size.x).toBe(16);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('панель сверху встаёт над изделием', () => {
    const panel = createFalsePanel(panelIds, 'top');
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [panel] }));
    const built = byRole(result.parts, 'filler')[0]!;
    expect(built.position.y).toBe(result.structure.totalTop);
    expect(built.size.x).toBe(1000);
  });

  it('несколько панелей строятся все и не пересекаются', () => {
    const result = buildGeometry(
      withCarcass(makeGeometryInput(DIMS), {
        falsePanels: [createFalsePanel(panelIds, 'right'), createFalsePanel(panelIds, 'top')],
      }),
    );
    expect(byRole(result.parts, 'filler')).toHaveLength(2);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('свои размеры панели переопределяют размеры корпуса', () => {
    const panel = { ...createFalsePanel(panelIds, 'right'), height: 500, depth: 300, thickness: 20 };
    const result = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [panel] }));
    const built = byRole(result.parts, 'filler')[0]!;
    expect(built.size.y).toBe(500);
    expect(built.size.z).toBe(300);
    expect(built.size.x).toBe(20);
  });

  it('материал берётся из Material Registry, а не из своего справочника', () => {
    const input = makeGeometryInput(DIMS);
    const panel = { ...createFalsePanel(panelIds, 'right'), materialId: materialId(input) };
    const result = buildGeometry(withCarcass(input, { falsePanels: [panel] }));
    expect(byRole(result.parts, 'filler')[0]!.materialId).toBe(materialId(input));
  });

  it('id детали панели выводится из её собственного id: удаление соседней не переименовывает', () => {
    const a = createFalsePanel(panelIds, 'right');
    const b = createFalsePanel(panelIds, 'top');
    const both = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [a, b] }));
    const onlyB = buildGeometry(withCarcass(makeGeometryInput(DIMS), { falsePanels: [b] }));
    const idOf = (r: typeof both, panelId: string) =>
      byRole(r.parts, 'filler').find((p) => p.id.includes(panelId))?.id;
    expect(idOf(onlyB, b.id)).toBe(idOf(both, b.id));
  });
});

// ── Комбинации (§17) ─────────────────────────────────────────────────────────

describe('Комбинированные сценарии (§17)', () => {
  it('BackWall + Plinth + Overhang', () => {
    const result = buildGeometry(
      withCarcass(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS), {
        base: { ...createPlinthBase(100), parts: ['front'] },
        overhang: { front: 20, back: 0, left: 10, right: 10, appliesTo: ['top'] },
      }),
    );
    expect(byRole(result.parts, 'back')).toHaveLength(1);
    expect(byRole(result.parts, 'plinth')).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('TopSection + CeilingGap + Countertop', () => {
    const input = makeGeometryInput(DIMS);
    const result = buildGeometry(
      withCarcass(input, {
        topSection: createTopSection(350, 20),
        ceilingGap: 80,
        countertop: createCountertop(38, materialId(input)),
      }),
    );
    expect(result.innerVolume.size.y).toBe(buildGeometry(input).innerVolume.size.y - 350 - 20 - 80 - 38);
    expect(result.boundingBox.totalHeight).toBe(2000 - 80);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('FalsePanel + Overhang + BackWall', () => {
    const ids = createSequentialIdFactory('c');
    const result = buildGeometry(
      withCarcass(makeGeometryInput(DIMS), {
        falsePanels: [createFalsePanel(ids, 'right')],
        overhang: { front: 15, back: 0, left: 0, right: 0, appliesTo: ['top'] },
      }),
    );
    expect(byRole(result.parts, 'filler')).toHaveLength(1);
    expect(byRole(result.parts, 'back')).toHaveLength(1);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('WallMount + TopSection + FalsePanel', () => {
    const ids = createSequentialIdFactory('d');
    const result = buildGeometry(
      withCarcass(makeGeometryInput(DIMS), {
        wallMount: { mode: 'wall-mounted' },
        topSection: createTopSection(300),
        falsePanels: [createFalsePanel(ids, 'top')],
      }),
    );
    expect(result.structure.wallMount).toBe('wall-mounted');
    expect(byRole(result.parts, 'side')).toHaveLength(4);
    expect(byRole(result.parts, 'filler')).toHaveLength(1);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('невозможная комбинация высот — явная ошибка, а не отрицательная геометрия', () => {
    const input = makeGeometryInput(DIMS);
    const result = buildGeometry(
      withCarcass(input, {
        base: createPlinthBase(500),
        topSection: createTopSection(1200),
        ceilingGap: 400,
        countertop: createCountertop(38, materialId(input)),
      }),
    );
    expect(result.diagnostics.some((d) => d.code === 'CARCASS_HEIGHT_NOT_POSITIVE' && d.severity === 'error')).toBe(true);
    expect(result.parts.every((p) => p.size.y > 0)).toBe(true);
  });
});

// ── Сериализация (§19) ───────────────────────────────────────────────────────

describe('Сериализация модификаторов (§19)', () => {
  it('все шесть модификаторов переживают round-trip, геометрия совпадает', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const ids = createSequentialIdFactory('s');
    const input = withCarcass(makeGeometryInput(DIMS), {
      overhang: { front: 20, back: 0, left: 10, right: 10, appliesTo: ['top', 'countertop'] },
      topSection: createTopSection(300, 20),
      ceilingGap: 60,
      countertop: createCountertop(38, Object.keys(project.materials.items)[0] as MaterialId),
      wallMount: { mode: 'wall-mounted' },
      falsePanels: [createFalsePanel(ids, 'right')],
    });
    const stored = { ...project, furniture: [input.furniture], materials: input.materials };

    const restored = fromJson(toJson(stored)).project;
    const carcass = restored.furniture[0]!.carcass;
    expect(carcass.overhang?.appliesTo).toEqual(['top', 'countertop']);
    expect(carcass.topSection?.height).toBe(300);
    expect(carcass.ceilingGap).toBe(60);
    expect(carcass.countertop?.thickness).toBe(38);
    expect(carcass.wallMount?.mode).toBe('wall-mounted');
    expect(carcass.falsePanels).toHaveLength(1);

    const before = buildGeometry(input);
    const after = buildGeometry({ ...input, furniture: restored.furniture[0]!, materials: restored.materials });
    expect(after.parts).toEqual(before.parts);
  });

  it('старый проект без модификаторов читается и даёт прежнюю геометрию', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const restored = fromJson(toJson(project)).project;
    const carcass = restored.furniture[0]!.carcass;
    expect(carcass.overhang).toBeUndefined();
    expect(carcass.topSection).toBeUndefined();
    expect(carcass.ceilingGap).toBeUndefined();
    expect(carcass.falsePanels).toBeUndefined();

    const result = buildGeometry({ ...makeGeometryInput(DIMS), furniture: restored.furniture[0]! });
    expect(byRole(result.parts, 'countertop')).toHaveLength(0);
    expect(byRole(result.parts, 'filler')).toHaveLength(0);
  });
});
