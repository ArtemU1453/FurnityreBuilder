import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { resolveEffectiveMaterial } from '../../../src/geometry/parts.js';
import {
  createDrawer,
  createEmptyLeaf,
  createHingedFacade,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import type {
  Drawer,
  Furniture,
  LeafNode,
  Material,
  MaterialId,
  MaterialLibrary,
  Part,
  Shelf,
  SplitNode,
} from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Материалы, толщины и кромление (PROMPT 13).
 *
 * Главная проверяемая здесь вещь — то, чего до PROMPT 13 не было:
 * `Material.thickness` и фактическая толщина детали были ДВУМЯ независимыми
 * числами. Полка с назначенным материалом «стекло 4 мм» получала толщину
 * 16 мм (толщину корпуса), потому что геометрия считала
 * `Shelf.thickness ?? panelThickness` и `Material.thickness` не читала
 * вообще. Тесты ниже фиксируют единый приоритет
 * (`explicit override → material.thickness → panelThickness`,
 * `docs/GEOMETRY_RULES.md`, раздел «ЭФФЕКТИВНАЯ ТОЛЩИНА») и то, что битая
 * ссылка на материал даёт явную ошибку, а не тихий подбор случайного
 * материала.
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

function material(id: string, overrides: Partial<Material> = {}): Material {
  return {
    id: asId<'Material'>(id),
    name: `Материал ${id}`,
    kind: 'chipboard',
    thickness: 16,
    displayColor: '#D9CBB4',
    grain: 'none',
    ...overrides,
  };
}

const GLASS = material('glass-4', { name: 'Стекло 4 мм', kind: 'glass', thickness: 4 });
const MIRROR = material('mirror-4', { name: 'Зеркало 4 мм', kind: 'mirror', thickness: 4 });
const MDF_18 = material('mdf-18', { name: 'МДФ 18 мм', kind: 'mdf', thickness: 18 });
const MISSING: MaterialId = asId<'Material'>('no-such-material');

function withMaterials(library: MaterialLibrary, ...items: readonly Material[]): MaterialLibrary {
  return {
    items: { ...library.items, ...Object.fromEntries(items.map((m) => [m.id, m])) },
    assignment: library.assignment,
  };
}

/** Ставит полкам ячейки-листа заданные поля, сохраняя их id и placement. */
function patchShelves(root: LeafNode, patch: Partial<Shelf>): LeafNode {
  if (root.fill.kind !== 'shelves') throw new Error('ожидался лист с полками');
  return {
    ...root,
    fill: { kind: 'shelves', shelves: root.fill.shelves.map((shelf) => ({ ...shelf, ...patch })) },
  };
}

function shelfLeafInput(patch: Partial<Shelf>, ...extra: readonly Material[]): GeometryInput {
  const input = makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 1, 'adjustable'), DIMS);
  const root = input.furniture.root as LeafNode;
  return {
    ...input,
    furniture: { ...input.furniture, root: patchShelves(root, patch) },
    materials: withMaterials(input.materials, ...extra),
  };
}

function shelfPart(parts: readonly Part[]): Part | undefined {
  return parts.find((p) => p.role === 'shelf-adjustable' || p.role === 'shelf-fixed');
}

function facadeParts(parts: readonly Part[]): readonly Part[] {
  return parts.filter((p) => p.role === 'facade');
}

function drawerLeafInput(facadePatch: Partial<Drawer['facade']>, ...extra: readonly Material[]): GeometryInput {
  const input = makeGeometryInputWithRoot((ids) => {
    const drawer = createDrawer(ids);
    const leaf: LeafNode = {
      id: ids.next<'Node'>(),
      kind: 'leaf',
      fill: { kind: 'drawers', drawers: [{ ...drawer, facade: { ...drawer.facade, ...facadePatch } }] },
    };
    return leaf;
  }, DIMS);
  return { ...input, materials: withMaterials(input.materials, ...extra) };
}

function doorInput(leafPatch: { materialId?: MaterialId; thickness?: number }, ...extra: readonly Material[]): GeometryInput {
  const input = makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), DIMS);
  const ids = createSequentialIdFactory('f');
  const base = createHingedFacade(ids, input.furniture.root.id, 1);
  const facade = { ...base, leaves: base.leaves.map((leaf) => ({ ...leaf, ...leafPatch })) };
  const furniture: Furniture = { ...input.furniture, facades: [facade] };
  return { ...input, furniture, materials: withMaterials(input.materials, ...extra) };
}

// ── 1. Приоритет эффективной толщины (§9) ────────────────────────────────────

describe('Test 1–3 (PROMPT 13 §9): единый приоритет эффективной толщины', () => {
  const library = makeGeometryInput().materials;
  const withGlass = withMaterials(library, GLASS);

  it('явный override поля детали побеждает и толщину материала, и толщину корпуса', () => {
    const resolved = resolveEffectiveMaterial({
      materials: withGlass,
      role: 'shelf-adjustable',
      explicitMaterialId: GLASS.id,
      thicknessOverride: 20,
      corpusThickness: 16,
    });
    expect(resolved.thickness).toBe(20);
  });

  it('без override берётся толщина назначенного материала, а не корпуса', () => {
    const resolved = resolveEffectiveMaterial({
      materials: withGlass,
      role: 'shelf-adjustable',
      explicitMaterialId: GLASS.id,
      corpusThickness: 16,
    });
    expect(resolved.thickness).toBe(4);
  });

  it('толщина корпуса — только аварийный вариант: материал не определён совсем', () => {
    const empty: MaterialLibrary = { items: {}, assignment: {} };
    const resolved = resolveEffectiveMaterial({ materials: empty, role: 'shelf-adjustable', corpusThickness: 16 });
    expect(resolved.thickness).toBe(16);
  });
});

describe('Test 4 (PROMPT 13 §5): материал по роли тоже даёт свою толщину', () => {
  it('роль-материал 18 мм при корпусе 16 мм — полка 18 мм, без override на полке', () => {
    const library = makeGeometryInput().materials;
    const materials: MaterialLibrary = {
      items: { ...library.items, [MDF_18.id]: MDF_18 },
      assignment: { ...library.assignment, 'shelf-adjustable': MDF_18.id },
    };
    const resolved = resolveEffectiveMaterial({ materials, role: 'shelf-adjustable', corpusThickness: 16 });
    expect(resolved.materialId).toBe(MDF_18.id);
    expect(resolved.thickness).toBe(18);
  });
});

// ── 2. Битые ссылки на материал (§15, §20) ───────────────────────────────────

describe('Test 5–7 (PROMPT 13 §15/§20): отсутствующий материал не приводит к тихому fallback', () => {
  const library = makeGeometryInput().materials;

  it('несуществующий materialId помечается danglingMaterialId, а не подменяется молча', () => {
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'shelf-adjustable',
      explicitMaterialId: MISSING,
      corpusThickness: 16,
    });
    expect(resolved.danglingMaterialId).toBe(true);
    // Деталь всё равно получает годный материал — но вызывающая сторона знает,
    // что ссылка была битой, и обязана сообщить об этом ошибкой.
    expect(library.items[resolved.materialId]).toBeDefined();
  });

  it('существующий materialId битым не помечается', () => {
    const good = Object.keys(library.items)[0]!;
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'shelf-adjustable',
      explicitMaterialId: asId<'Material'>(good),
      corpusThickness: 16,
    });
    expect(resolved.danglingMaterialId).toBe(false);
    expect(resolved.materialId).toBe(good);
  });

  it('несуществующий материал кромки помечается отдельно', () => {
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'shelf-adjustable',
      explicitEdge: { front: 2, back: 0, left: 0.4, right: 0.4, materialId: MISSING },
      corpusThickness: 16,
    });
    expect(resolved.danglingEdgeMaterialId).toBe(true);
  });
});

describe('Test 8 (PROMPT 13 §15): битая ссылка полки — error-диагностика движка', () => {
  it('MATERIAL_REFERENCE_BROKEN, и полка при этом всё равно построена', () => {
    const result = buildGeometry(shelfLeafInput({ materialId: MISSING }));
    const broken = result.diagnostics.filter((d) => d.code === 'MATERIAL_REFERENCE_BROKEN');
    expect(broken).toHaveLength(1);
    expect(broken[0]?.severity).toBe('error');
    expect(shelfPart(result.parts)).toBeDefined();
  });

  it('корректная ссылка не даёт ни одной диагностики о материале', () => {
    const result = buildGeometry(shelfLeafInput({ materialId: GLASS.id }, GLASS));
    expect(result.diagnostics.some((d) => d.code === 'MATERIAL_REFERENCE_BROKEN')).toBe(false);
  });
});

// ── 3. Стекло и зеркало (§3, §15) ────────────────────────────────────────────

describe('Test 9–11 (PROMPT 13 §3/§15): стекло и зеркало', () => {
  const library = withMaterials(makeGeometryInput().materials, GLASS, MIRROR);

  it('стекло на несущей роли помечается structuralGlassOrMirror', () => {
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'side',
      explicitMaterialId: GLASS.id,
      corpusThickness: 16,
    });
    expect(resolved.structuralGlassOrMirror).toBe(true);
  });

  it('зеркало на полке — тоже несущая роль', () => {
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'shelf-adjustable',
      explicitMaterialId: MIRROR.id,
      corpusThickness: 16,
    });
    expect(resolved.structuralGlassOrMirror).toBe(true);
  });

  it('стекло на фасаде — нормальный случай, не помечается', () => {
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'facade',
      explicitMaterialId: GLASS.id,
      corpusThickness: 16,
    });
    expect(resolved.structuralGlassOrMirror).toBe(false);
  });

  it('ЛДСП на боковине не помечается', () => {
    const good = Object.keys(library.items)[0]!;
    const resolved = resolveEffectiveMaterial({
      materials: library,
      role: 'side',
      explicitMaterialId: asId<'Material'>(good),
      corpusThickness: 16,
    });
    expect(resolved.structuralGlassOrMirror).toBe(false);
  });
});

describe('Test 12 (PROMPT 13 §15): стеклянная полка не получает толщину корпуса молча', () => {
  it('толщина детали — 4 мм материала, а не 16 мм корпуса, и выдано предупреждение', () => {
    const result = buildGeometry(shelfLeafInput({ materialId: GLASS.id }, GLASS));
    const shelf = shelfPart(result.parts);
    expect(shelf?.size.y).toBe(4);
    expect(shelf?.cut.thickness).toBe(4);
    const warning = result.diagnostics.find((d) => d.code === 'GLASS_MIRROR_STRUCTURAL_ROLE');
    expect(warning?.severity).toBe('warning');
  });

  it('явный override толщины на полке всё равно старше материала', () => {
    const result = buildGeometry(shelfLeafInput({ materialId: GLASS.id, thickness: 22 }, GLASS));
    expect(shelfPart(result.parts)?.size.y).toBe(22);
  });
});

// ── 4. Двери и ящики (§6, §7) ────────────────────────────────────────────────

describe('Test 13 (PROMPT 13 §6): толщина дверной створки следует материалу', () => {
  it('материал 18 мм при корпусе 16 мм — створка 18 мм', () => {
    const result = buildGeometry(doorInput({ materialId: MDF_18.id }, MDF_18));
    const door = facadeParts(result.parts)[0];
    expect(door?.size.z).toBe(18);
    expect(door?.materialId).toBe(MDF_18.id);
  });

  it('своя толщина створки переопределяет материал (не отменяется им)', () => {
    const result = buildGeometry(doorInput({ materialId: MDF_18.id, thickness: 10 }, MDF_18));
    expect(facadeParts(result.parts)[0]?.size.z).toBe(10);
  });

  it('битый материал створки — error-диагностика, дверь построена', () => {
    const result = buildGeometry(doorInput({ materialId: MISSING }));
    expect(result.diagnostics.some((d) => d.code === 'MATERIAL_REFERENCE_BROKEN' && d.severity === 'error')).toBe(true);
    expect(facadeParts(result.parts)).toHaveLength(1);
  });
});

describe('Test 14 (PROMPT 13 §7): толщина фасада ящика следует материалу', () => {
  it('материал 18 мм — фасад 18 мм при корпусе 16 мм', () => {
    const result = buildGeometry(drawerLeafInput({ materialId: MDF_18.id }, MDF_18));
    const facade = facadeParts(result.parts)[0];
    expect(facade?.size.z).toBe(18);
    expect(facade?.materialId).toBe(MDF_18.id);
  });

  it('материал короба ящика отделён от материала фасада: фасаду он не подставляется', () => {
    const result = buildGeometry(drawerLeafInput({ materialId: MDF_18.id }, MDF_18));
    // Короб не строится (T-DRW-02), но `boxMaterial` уже отдельное поле —
    // фасад не обязан быть из того же материала, что короб.
    expect(facadeParts(result.parts)[0]?.materialId).toBe(MDF_18.id);
    expect(result.diagnostics.some((d) => d.code === 'DRAWER_BOX_NOT_IMPLEMENTED')).toBe(true);
  });

  it('битый материал фасада ящика — error-диагностика', () => {
    const result = buildGeometry(drawerLeafInput({ materialId: MISSING }));
    expect(result.diagnostics.some((d) => d.code === 'MATERIAL_REFERENCE_BROKEN' && d.severity === 'error')).toBe(true);
  });
});

// ── 5. Перегородки (§5) ──────────────────────────────────────────────────────

describe('Test 15 (PROMPT 13 §5): перегородка — обязательная толщина, но проверяемый материал', () => {
  function partitionInput(materialId: MaterialId | undefined, ...extra: readonly Material[]): GeometryInput {
    const input = makeGeometryInputWithRoot((ids) => createSections(ids, 2, 16), DIMS);
    const root = input.furniture.root as SplitNode;
    const divider = { ...root.divider, ...(materialId === undefined ? {} : { materialId }) };
    return {
      ...input,
      furniture: { ...input.furniture, root: { ...root, divider } },
      materials: withMaterials(input.materials, ...extra),
    };
  }

  it('толщина перегородки НЕ подменяется толщиной материала: она обязательное поле деления', () => {
    // Материал стекла 4 мм, а `DividerSpec.thickness` = 16: деление ячеек
    // уже посчитано по 16, и деталь обязана совпасть с этим расчётом.
    const result = buildGeometry(partitionInput(GLASS.id, GLASS));
    const partition = result.parts.find((p) => p.role === 'partition');
    expect(partition?.size.x).toBe(16);
  });

  it('битый материал перегородки — error-диагностика', () => {
    const result = buildGeometry(partitionInput(MISSING));
    expect(result.diagnostics.some((d) => d.code === 'MATERIAL_REFERENCE_BROKEN' && d.severity === 'error')).toBe(true);
  });

  it('стекло на перегородке — предупреждение о несущей роли', () => {
    const result = buildGeometry(partitionInput(GLASS.id, GLASS));
    expect(result.diagnostics.some((d) => d.code === 'GLASS_MIRROR_STRUCTURAL_ROLE')).toBe(true);
  });
});

// ── 6. Идентичность (§19) ────────────────────────────────────────────────────

describe('Test 16 (PROMPT 13 §19): смена материала не создаёт новую деталь', () => {
  it('id детали полки одинаков до и после смены материала и толщины', () => {
    const before = buildGeometry(shelfLeafInput({}));
    const after = buildGeometry(shelfLeafInput({ materialId: MDF_18.id }, MDF_18));
    const a = shelfPart(before.parts);
    const b = shelfPart(after.parts);
    expect(a?.id).toBe(b?.id);
    expect(a?.size.y).toBe(16);
    expect(b?.size.y).toBe(18);
  });
});

// ── 7. Полный конвейер (§16, §17) ────────────────────────────────────────────

describe('Test 17 (PROMPT 13 §16): шкаф → секции → полки → дверь → ящики → смена материала → смена толщины', () => {
  /** Шаги 1–5: шкаф из двух секций, в левой полки, в правой ящики, на левой дверь. */
  function wardrobe(materials: MaterialLibrary, panelThickness: number): GeometryInput {
    const base = makeGeometryInput({ ...DIMS, panelThickness });
    const ids = createSequentialIdFactory('w');
    const shelvesLeaf = createShelvesLeaf(ids, 2, 'adjustable');
    const drawer = createDrawer(ids);
    const drawersLeaf: LeafNode = { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'drawers', drawers: [drawer] } };
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
    return {
      ...base,
      furniture: { ...base.furniture, dimensions: { ...base.furniture.dimensions, panelThickness }, root, facades: [facade] },
      materials,
    };
  }

  const library = makeGeometryInput().materials;

  it('шаги 1–5: построены секции, полки, дверь и фасад ящика', () => {
    const result = buildGeometry(wardrobe(library, 16));
    expect(result.sections).toHaveLength(2);
    expect(result.cells).toHaveLength(2);
    expect(result.parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(2);
    expect(facadeParts(result.parts)).toHaveLength(2); // дверь + фасад ящика
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('шаг 6: смена материала корпуса на 18 мм меняет толщины зависимых деталей', () => {
    const assigned: MaterialLibrary = {
      items: { ...library.items, [MDF_18.id]: MDF_18 },
      assignment: { ...library.assignment, 'shelf-adjustable': MDF_18.id, facade: MDF_18.id },
    };
    const before = buildGeometry(wardrobe(library, 16));
    const after = buildGeometry(wardrobe(assigned, 16));

    const shelfBefore = before.parts.find((p) => p.role === 'shelf-adjustable');
    const shelfAfter = after.parts.find((p) => p.role === 'shelf-adjustable');
    expect(shelfBefore?.size.y).toBe(16);
    expect(shelfAfter?.size.y).toBe(18);
    expect(facadeParts(after.parts).every((p) => p.size.z === 18)).toBe(true);

    // Ни одна деталь не потеряла идентичность из-за смены материала (§19).
    expect(shelfAfter?.id).toBe(shelfBefore?.id);
  });

  it('шаг 7 (§17): смена толщины корпуса 16 → 18 пересчитывает ВСЕ зависимые размеры', () => {
    const a = buildGeometry(wardrobe(library, 16));
    const b = buildGeometry(wardrobe(library, 18));

    // Внутренний объём.
    expect(b.innerVolume.size.x).toBe(a.innerVolume.size.x - 4);
    expect(b.innerVolume.size.y).toBe(a.innerVolume.size.y - 4);

    // Секции и ячейки — уже, потому что перегородка толще.
    const sectionA = a.sections[0]!.box.size.x;
    const sectionB = b.sections[0]!.box.size.x;
    expect(sectionB).toBeLessThan(sectionA);

    // Полки, дверь и фасад ящика — все следуют новой ширине ячейки.
    const shelfA = a.parts.find((p) => p.role === 'shelf-adjustable')!;
    const shelfB = b.parts.find((p) => p.role === 'shelf-adjustable')!;
    expect(shelfB.size.x).toBeLessThan(shelfA.size.x);
    const doorA = facadeParts(a.parts)[0]!;
    const doorB = facadeParts(b.parts)[0]!;
    expect(doorB.size.x).toBeLessThan(doorA.size.x);

    // Никакого частичного пересчёта: ни одной ошибки и ни одного
    // неположительного размера.
    expect(b.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(b.parts.every((p) => p.size.x > 0 && p.size.y > 0 && p.size.z > 0)).toBe(true);
  });
});

// ── 8. Сериализация (§20) ────────────────────────────────────────────────────

describe('Test 18 (PROMPT 13 §20): материал переживает сериализацию', () => {
  it('зеркало (новая категория) и назначенный полке материал восстанавливаются', () => {
    const project = createProject({
      ids: createSequentialIdFactory('t'),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const withMirror = {
      ...project,
      materials: withMaterials(project.materials, MIRROR),
    };

    const restored = fromJson(toJson(withMirror)).project;
    expect(restored.materials.items[MIRROR.id]?.kind).toBe('mirror');
    expect(restored.materials.items[MIRROR.id]?.thickness).toBe(4);
  });

  it('эффективный материал детали после round-trip тот же', () => {
    const input = shelfLeafInput({ materialId: MDF_18.id }, MDF_18);
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
    expect(shelfPart(after.parts)?.materialId).toBe(shelfPart(before.parts)?.materialId);
    expect(shelfPart(after.parts)?.size.y).toBe(shelfPart(before.parts)?.size.y);
  });
});
