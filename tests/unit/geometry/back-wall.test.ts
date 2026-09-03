import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { BackPanelMount, Furniture, Part, SplitNode } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Задняя стенка как деталь (PROMPT 14 §22, тесты 1–10).
 *
 * До этого этапа задняя стенка вычиталась из глубины корпуса, но детали не
 * давала: в деталировке её просто не было. Тесты фиксируют обе стороны —
 * что деталь появилась и что расчёт глубины при этом не изменился.
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

function withBack(input: GeometryInput, mount: BackPanelMount, segmentation: 'single' | 'per-section' = 'single'): GeometryInput {
  const furniture: Furniture = {
    ...input.furniture,
    carcass: { ...input.furniture.carcass, back: { ...input.furniture.carcass.back, mount, segmentation } },
  };
  return { ...input, furniture };
}

const backParts = (parts: readonly Part[]): readonly Part[] => parts.filter((p) => p.role === 'back');

// ── Тесты 1–5: наличие, материал, толщина, положение ─────────────────────────

describe('Test 1 (§22): задняя стенка отключена — деталей нет', () => {
  it('mount.kind = none не даёт ни одной детали задней стенки', () => {
    const result = buildGeometry(withBack(makeGeometryInput(DIMS), { kind: 'none' }));
    expect(backParts(result.parts)).toHaveLength(0);
  });

  it('и при этом глубина корпуса равна габаритной: вычитать нечего', () => {
    const result = buildGeometry(withBack(makeGeometryInput(DIMS), { kind: 'none' }));
    const side = result.parts.find((p) => p.role === 'side');
    expect(side?.size.z).toBe(500);
  });
});

describe('Test 2–5 (§22): включённая задняя стенка — деталь с материалом, толщиной и положением', () => {
  const input = makeGeometryInput(DIMS);
  const result = buildGeometry(input);
  const back = backParts(result.parts)[0];

  it('Test 2: деталь создана ровно одна', () => {
    expect(backParts(result.parts)).toHaveLength(1);
  });

  it('Test 3: материал — из Material Registry, назначенный роли back', () => {
    expect(back?.materialId).toBe(input.materials.assignment.back);
    expect(input.materials.items[back!.materialId]).toBeDefined();
  });

  it('Test 4: толщина детали равна толщине монтажа', () => {
    expect(back?.size.z).toBe(3);
    expect(back?.cut.thickness).toBe(3);
  });

  it('Test 5: накладная стенка стоит снаружи корпуса и закрывает его целиком', () => {
    expect(back?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(back?.size.x).toBe(1000);
    expect(back?.size.y).toBe(2000);
    // Корпус при этом начинается сразу за ней.
    const side = result.parts.find((p) => p.role === 'side');
    expect(side?.position.z).toBe(3);
  });

  it('Test 5 (вкладная): встаёт во внутренний проём, а не на габарит', () => {
    const inset = buildGeometry(withBack(makeGeometryInput(DIMS), { kind: 'inset-flush', thickness: 4 }));
    const panel = backParts(inset.parts)[0]!;
    expect(panel.size.x).toBe(inset.innerVolume.size.x);
    expect(panel.size.y).toBe(inset.innerVolume.size.y);
    expect(panel.position.z).toBe(0);
  });

  it('вкладная в паз шире проёма ровно на заход в паз с каждой стороны', () => {
    const groove = buildGeometry(
      withBack(makeGeometryInput(DIMS), { kind: 'inset-groove', thickness: 4, grooveDepth: 8, grooveOffsetFromRear: 10 }),
    );
    const panel = backParts(groove.parts)[0]!;
    expect(panel.size.x).toBe(groove.innerVolume.size.x + 16);
    expect(panel.size.y).toBe(groove.innerVolume.size.y + 16);
  });

  it('кромки у задней стенки нет: её торцы в пазу или у стены', () => {
    expect(back?.edge).toEqual({ front: 0, back: 0, left: 0, right: 0 });
  });
});

// ── Тесты 6–9: пересчёт при изменении габаритов и секций ─────────────────────

describe('Test 6–8 (§22): изменение D, W и H пересчитывает заднюю стенку', () => {
  it('Test 6: изменение глубины не меняет размер стенки, но двигает корпус', () => {
    const a = buildGeometry(makeGeometryInput({ ...DIMS, depth: 400 }));
    const b = buildGeometry(makeGeometryInput({ ...DIMS, depth: 600 }));
    // Накладная стенка — лист W×H: глубина на её размер не влияет.
    expect(backParts(b.parts)[0]?.size).toEqual(backParts(a.parts)[0]?.size);
    // А вот глубина корпуса меняется вместе с D.
    const sideA = a.parts.find((p) => p.role === 'side')!;
    const sideB = b.parts.find((p) => p.role === 'side')!;
    expect(sideB.size.z - sideA.size.z).toBe(200);
  });

  it('Test 7: изменение ширины меняет ширину стенки один в один', () => {
    const a = buildGeometry(makeGeometryInput({ ...DIMS, width: 1000 }));
    const b = buildGeometry(makeGeometryInput({ ...DIMS, width: 1400 }));
    expect(backParts(a.parts)[0]?.size.x).toBe(1000);
    expect(backParts(b.parts)[0]?.size.x).toBe(1400);
  });

  it('Test 8: изменение высоты меняет высоту стенки один в один', () => {
    const a = buildGeometry(makeGeometryInput({ ...DIMS, height: 2000 }));
    const b = buildGeometry(makeGeometryInput({ ...DIMS, height: 2400 }));
    expect(backParts(a.parts)[0]?.size.y).toBe(2000);
    expect(backParts(b.parts)[0]?.size.y).toBe(2400);
  });
});

describe('Test 9 (§22, §6–§7): разделение по секциям', () => {
  const threeSections = (width: number): GeometryInput =>
    withBack(
      makeGeometryInputWithRoot((ids) => createSections(ids, 3, 16), { ...DIMS, width }),
      { kind: 'overlay', thickness: 3 },
      'per-section',
    );

  it('по одному сегменту на секцию, каждый со своим id секции', () => {
    const result = buildGeometry(threeSections(1200));
    const segments = backParts(result.parts);
    expect(segments).toHaveLength(3);
    const sectionIds = segments.map((s) => s.origin.nodeId);
    expect(new Set(sectionIds).size).toBe(3);
    expect(sectionIds.every((id) => result.sections.some((s) => s.nodeId === id))).toBe(true);
  });

  it('сегменты покрывают всю ширину и не пересекаются между собой', () => {
    const result = buildGeometry(threeSections(1200));
    const segments = [...backParts(result.parts)].sort((a, b) => a.position.x - b.position.x);
    expect(segments[0]!.position.x).toBe(0);
    const last = segments.at(-1)!;
    expect(last.position.x + last.size.x).toBe(1200);
    for (let i = 1; i < segments.length; i += 1) {
      const prev = segments[i - 1]!;
      expect(segments[i]!.position.x).toBe(prev.position.x + prev.size.x);
    }
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('изменение ширин секций пересчитывает сегменты, сохраняя их идентичность', () => {
    const a = buildGeometry(threeSections(1200));
    const b = buildGeometry(threeSections(1800));
    const idsA = backParts(a.parts).map((p) => p.id).sort();
    const idsB = backParts(b.parts).map((p) => p.id).sort();
    expect(idsB).toEqual(idsA);
    // Сегменты стали шире вместе с изделием.
    const sumA = backParts(a.parts).reduce((acc, p) => acc + p.size.x, 0);
    const sumB = backParts(b.parts).reduce((acc, p) => acc + p.size.x, 0);
    expect(sumB).toBeGreaterThan(sumA);
  });

  it('одна секция: per-section вырождается в цельную панель, а не в сегмент-дубликат', () => {
    const result = buildGeometry(withBack(makeGeometryInput(DIMS), { kind: 'overlay', thickness: 3 }, 'per-section'));
    expect(backParts(result.parts)).toHaveLength(1);
    expect(backParts(result.parts)[0]?.size.x).toBe(1000);
  });
});

// ── Тест 10: сериализация ────────────────────────────────────────────────────

describe('Test 10 (§22, §25): конфигурация задней стенки переживает сериализацию', () => {
  it('монтаж, толщина и способ разделения восстанавливаются, геометрия совпадает', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const input = withBack(
      makeGeometryInputWithRoot((ids) => createSections(ids, 2, 16), DIMS),
      { kind: 'inset-groove', thickness: 4, grooveDepth: 8, grooveOffsetFromRear: 10 },
      'per-section',
    );
    const stored = { ...project, furniture: [input.furniture], materials: input.materials };

    const restored = fromJson(toJson(stored)).project;
    const back = restored.furniture[0]!.carcass.back;
    expect(back.mount).toEqual({ kind: 'inset-groove', thickness: 4, grooveDepth: 8, grooveOffsetFromRear: 10 });
    expect(back.segmentation).toBe('per-section');

    const before = buildGeometry(input);
    const after = buildGeometry({ ...input, furniture: restored.furniture[0]!, materials: restored.materials });
    expect(backParts(after.parts)).toEqual(backParts(before.parts));
  });
});

// ── Интеграция (§22, тесты 17–18) ────────────────────────────────────────────

describe('Test 17–18 (§22): задняя стенка не ломает полки и ящики', () => {
  it('полки строятся и не пересекаются с задней стенкой', () => {
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), DIMS));
    expect(result.parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(3);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('глубина полки считается от внутреннего объёма, который уже учитывает стенку', () => {
    const thick = withBack(
      makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 1, 'adjustable'), DIMS),
      { kind: 'overlay', thickness: 20 },
    );
    const result = buildGeometry(thick);
    const shelf = result.parts.find((p) => p.role === 'shelf-adjustable')!;
    expect(shelf.size.z).toBe(result.innerVolume.size.z);
    expect(shelf.size.z).toBe(480); // 500 − 20 мм стенки
  });

  it('битый материал задней стенки — явная ошибка, а не тихая подмена', () => {
    const input = makeGeometryInput(DIMS);
    const furniture: Furniture = {
      ...input.furniture,
      carcass: {
        ...input.furniture.carcass,
        back: { ...input.furniture.carcass.back, materialId: 'no-such-material' as never },
      },
    };
    const result = buildGeometry({ ...input, furniture });
    expect(result.diagnostics.some((d) => d.code === 'MATERIAL_REFERENCE_BROKEN' && d.severity === 'error')).toBe(true);
    expect(backParts(result.parts)).toHaveLength(1);
  });
});

describe('структура секций и стенка согласованы', () => {
  it('сегментов ровно столько же, сколько секций, при любой раскладке', () => {
    for (const count of [2, 3, 5]) {
      const input = withBack(
        makeGeometryInputWithRoot((ids) => createSections(ids, count, 16), { ...DIMS, width: 400 * count }),
        { kind: 'overlay', thickness: 3 },
        'per-section',
      );
      const result = buildGeometry(input);
      expect(backParts(result.parts)).toHaveLength(result.sections.length);
      expect((input.furniture.root as SplitNode).children).toHaveLength(count);
    }
  });
});
