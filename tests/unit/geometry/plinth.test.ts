import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { resolveBasePlacement } from '../../../src/geometry/stages/carcass.js';
import {
  createDrawer,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { validateProject } from '../../../src/validation/index.js';
import type { BaseSpec, Dimensions, Furniture, LeafNode, Part } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Цоколь (PROMPT 14 §22, тесты 11–16 и интеграция 19–20).
 *
 * Ключевое, что здесь проверяется, — цоколь НЕ учитывается дважды: высота
 * поднимает корпус ровно один раз (`resolveBasePlacement`), а царги строятся
 * под ним и ни с чем не пересекаются.
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

function withBase(input: GeometryInput, base: BaseSpec | undefined): GeometryInput {
  const carcass = { ...input.furniture.carcass };
  if (base === undefined) delete (carcass as { base?: BaseSpec }).base;
  else carcass.base = base;
  const furniture: Furniture = { ...input.furniture, carcass };
  return { ...input, furniture };
}

const plinthParts = (parts: readonly Part[]): readonly Part[] => parts.filter((p) => p.role === 'plinth');

// ── Тесты 11–12: наличие и состав ────────────────────────────────────────────

describe('Test 11 (§22): цоколя нет — деталей нет и корпус стоит на полу', () => {
  it('без основания деталей цоколя нет', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(plinthParts(result.parts)).toHaveLength(0);
    expect(result.parts.find((p) => p.role === 'bottom')?.position.y).toBe(0);
  });

  it('kind = none тоже не даёт деталей и не двигает корпус', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), { kind: 'none', height: 100, setback: 0 }));
    expect(plinthParts(result.parts)).toHaveLength(0);
    expect(result.parts.find((p) => p.role === 'bottom')?.position.y).toBe(0);
  });

  it('ножки высоту учитывают, но деталей не дают: это фурнитура', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), { kind: 'legs', height: 100, setback: 0 }));
    expect(plinthParts(result.parts)).toHaveLength(0);
    expect(result.parts.find((p) => p.role === 'bottom')?.position.y).toBe(100);
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_LEGS_NOT_IMPLEMENTED')).toBe(true);
  });

  it('цоколь без состава царг: высота учтена, деталей нет, статус явный', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), { kind: 'plinth', height: 100, setback: 0 }));
    expect(plinthParts(result.parts)).toHaveLength(0);
    expect(result.parts.find((p) => p.role === 'bottom')?.position.y).toBe(100);
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_PARTS_NOT_SPECIFIED')).toBe(true);
  });
});

describe('Test 12 (§22): включённый цоколь даёт корректные детали', () => {
  const result = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(100)));
  const front = plinthParts(result.parts)[0];

  it('одна передняя царга по умолчанию', () => {
    expect(plinthParts(result.parts)).toHaveLength(1);
    expect(front?.label).toBe('Царга цоколя передняя');
  });

  it('стоит на полу, высотой в цоколь, шириной в изделие', () => {
    expect(front?.position.y).toBe(0);
    expect(front?.size.y).toBe(100);
    expect(front?.size.x).toBe(1000);
  });

  it('материал — из Material Registry, а не собственный справочник цоколя', () => {
    const library = makeGeometryInput(DIMS).materials;
    expect(front?.materialId).toBeDefined();
    expect(library.items[front!.materialId]).toBeDefined();
  });

  it('боковые царги добавляются явно и встают по краям', () => {
    const withSides = buildGeometry(
      withBase(makeGeometryInput(DIMS), { ...createPlinthBase(100), parts: ['front', 'left', 'right'] }),
    );
    const parts = plinthParts(withSides.parts);
    expect(parts).toHaveLength(3);
    const left = parts.find((p) => p.label.includes('левая'))!;
    const right = parts.find((p) => p.label.includes('правая'))!;
    expect(left.position.x).toBe(0);
    expect(right.position.x + right.size.x).toBe(1000);
    // Передняя царга встаёт МЕЖДУ боковыми, а не поверх них.
    const frontBoard = parts.find((p) => p.label.includes('передняя'))!;
    expect(frontBoard.position.x).toBe(left.size.x);
    expect(findPartOverlaps(withSides.parts)).toHaveLength(0);
  });
});

// ── Тесты 13–14: высота и отступ ─────────────────────────────────────────────

describe('Test 13 (§22, §10): высота цоколя пересчитывает корпус', () => {
  it('при heightIncludesBase = true корпус ужимается на высоту цоколя', () => {
    const без = buildGeometry(makeGeometryInput(DIMS));
    const с = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(100)));
    expect(с.innerVolume.size.y).toBe(без.innerVolume.size.y - 100);
    expect(с.innerVolume.min.y).toBe(без.innerVolume.min.y + 100);
    // Габарит изделия при этом не изменился: цоколь входит в H.
    expect(с.boundingBox.totalHeight).toBe(2000);
  });

  it('при heightIncludesBase = false цоколь добавляется сверх H', () => {
    const input = withBase(makeGeometryInput(DIMS), createPlinthBase(100));
    const result = buildGeometry({ ...input, tolerances: { ...input.tolerances, heightIncludesBase: false } });
    expect(result.boundingBox.totalHeight).toBe(2100);
    // Корпус сохранил свою высоту целиком.
    const без = buildGeometry(makeGeometryInput(DIMS));
    expect(result.innerVolume.size.y).toBe(без.innerVolume.size.y);
  });

  it('чистая функция размещения: без цоколя сдвига нет', () => {
    expect(resolveBasePlacement(undefined, 2000, true)).toEqual({ plinthHeight: 0, carcassY0: 0, carcassHeight: 2000 });
    expect(resolveBasePlacement({ kind: 'plinth', height: 100, setback: 0 }, 2000, true)).toEqual({
      plinthHeight: 100,
      carcassY0: 100,
      carcassHeight: 1900,
    });
  });

  it('цоколь выше изделия — явная ошибка, а не отрицательная геометрия', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(2500)));
    expect(result.diagnostics.some((d) => d.code === 'CARCASS_HEIGHT_NOT_POSITIVE' && d.severity === 'error')).toBe(true);
    expect(result.parts.every((p) => p.size.y > 0)).toBe(true);
  });
});

describe('Test 14 (§22): отступ цоколя двигает его вглубь', () => {
  it('передняя царга уходит назад ровно на setback', () => {
    const a = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(100, 0)));
    const b = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(100, 50)));
    const frontA = plinthParts(a.parts)[0]!;
    const frontB = plinthParts(b.parts)[0]!;
    expect(frontA.position.z - frontB.position.z).toBe(50);
  });

  it('отступ больше глубины корпуса — явная ошибка', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), createPlinthBase(100, 600)));
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_GEOMETRY_INVALID' && d.severity === 'error')).toBe(true);
    expect(plinthParts(result.parts)).toHaveLength(0);
  });
});

// ── Тесты 15–16: вырез и отсутствие отрицательной геометрии ──────────────────

describe('Test 15 (§22, §11): вырез цоколя валидируется', () => {
  const base = (cutout: BaseSpec['cutout']): BaseSpec => ({ ...createPlinthBase(100), ...(cutout === undefined ? {} : { cutout }) });

  it('вырез на всю высоту делит переднюю царгу на две детали', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), base({ left: 200, right: 200, height: 100 })));
    const parts = plinthParts(result.parts);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.size.x).toBe(200);
    expect(parts[1]?.size.x).toBe(200);
    expect(findPartOverlaps(result.parts)).toHaveLength(0);
  });

  it('частичный вырез — паз в одной детали: царга целая, статус явный', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), base({ left: 200, right: 200, height: 60 })));
    expect(plinthParts(result.parts)).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_CUTOUT_NOT_IMPLEMENTED')).toBe(true);
  });

  it('вырез выше цоколя отклоняется', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), base({ left: 100, right: 100, height: 150 })));
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_GEOMETRY_INVALID')).toBe(true);
  });

  it('вырез шире самой царги отклоняется', () => {
    const result = buildGeometry(withBase(makeGeometryInput(DIMS), base({ left: 600, right: 600, height: 100 })));
    expect(result.diagnostics.some((d) => d.code === 'PLINTH_GEOMETRY_INVALID')).toBe(true);
  });

  it('валидация проекта ловит недопустимый вырез до расчёта', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const furniture = project.furniture[0]!;
    const broken = {
      ...project,
      furniture: [
        {
          ...furniture,
          carcass: { ...furniture.carcass, base: { ...createPlinthBase(100), cutout: { left: 10, right: 10, height: 500 } } },
        },
      ],
    };
    const report = validateProject(broken);
    expect(report.issues.some((i) => i.code === 'PLINTH_CUTOUT_INVALID' && i.severity === 'error')).toBe(true);
  });
});

describe('Test 16 (§22, §19): отрицательной геометрии не возникает', () => {
  it('все детали при цоколе имеют положительные размеры и неотрицательные координаты', () => {
    for (const height of [1, 50, 100, 300, 800]) {
      const result = buildGeometry(
        withBase(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS), {
          ...createPlinthBase(height, 10),
          parts: ['front', 'left', 'right'],
        }),
      );
      for (const part of result.parts) {
        expect(part.size.x).toBeGreaterThan(0);
        expect(part.size.y).toBeGreaterThan(0);
        expect(part.size.z).toBeGreaterThan(0);
        expect(part.position.x).toBeGreaterThanOrEqual(0);
        expect(part.position.y).toBeGreaterThanOrEqual(0);
        expect(part.position.z).toBeGreaterThanOrEqual(0);
      }
      expect(findPartOverlaps(result.parts)).toHaveLength(0);
    }
  });
});

// ── Тесты 19–20: цоколь не ломает двери и ящики ──────────────────────────────

describe('Test 19–20 (§22, §14): цоколь не ломает двери и ящики', () => {
  function wardrobe(plinthHeight: number): GeometryInput {
    const base = makeGeometryInput(DIMS);
    const ids = createSequentialIdFactory('w');
    const drawer = createDrawer(ids);
    const leaf: LeafNode = { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'drawers', drawers: [drawer] } };
    const withRoot: Furniture = { ...base.furniture, root: leaf, facades: [] };
    // Дверь на ту же ячейку невозможна (в ней ящики, `DOOR_CELL_HAS_DRAWERS`),
    // поэтому её проверяет отдельный тест ниже.
    return withBase({ ...base, furniture: withRoot }, plinthHeight > 0 ? createPlinthBase(plinthHeight) : undefined);
  }

  it('Test 20: фасад ящика поднимается вместе с корпусом и остаётся в ячейке', () => {
    const без = buildGeometry(wardrobe(0));
    const с = buildGeometry(wardrobe(120));
    const facadeБез = без.parts.find((p) => p.role === 'facade')!;
    const facadeС = с.parts.find((p) => p.role === 'facade')!;
    expect(facadeС.position.y - facadeБез.position.y).toBe(120);
    expect(facadeС.size.y).toBe(facadeБез.size.y - 120);
    expect(findPartOverlaps(с.parts)).toHaveLength(0);
  });

  it('Test 19: дверь пересчитывается вместе с цоколем', () => {
    const build = (plinthHeight: number) => {
      const base = makeGeometryInput(DIMS);
      const ids = createSequentialIdFactory('d');
      const facade = createHingedFacade(ids, base.furniture.root.id, 1);
      const furniture: Furniture = { ...base.furniture, facades: [facade] };
      return buildGeometry(withBase({ ...base, furniture }, plinthHeight > 0 ? createPlinthBase(plinthHeight) : undefined));
    };
    const без = build(0);
    const с = build(120);
    const doorБез = без.parts.find((p) => p.role === 'facade')!;
    const doorС = с.parts.find((p) => p.role === 'facade')!;
    expect(doorС.position.y - doorБез.position.y).toBe(120);
    expect(doorС.size.y).toBe(doorБез.size.y - 120);
    // Идентичность двери не пострадала (§20).
    expect(doorС.id).toBe(doorБез.id);
    expect(findPartOverlaps(с.parts)).toHaveLength(0);
  });

  it('нижняя полка поднимается вместе с корпусом', () => {
    const build = (h: number) =>
      buildGeometry(
        withBase(makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), DIMS), h > 0 ? createPlinthBase(h) : undefined),
      );
    const без = build(0);
    const с = build(150);
    const lowestБез = [...без.parts.filter((p) => p.role === 'shelf-adjustable')].sort((a, b) => a.position.y - b.position.y)[0]!;
    const lowestС = [...с.parts.filter((p) => p.role === 'shelf-adjustable')].sort((a, b) => a.position.y - b.position.y)[0]!;
    expect(lowestС.position.y).toBeGreaterThan(lowestБез.position.y);
    expect(lowestС.id).toBe(lowestБез.id);
  });
});

// ── Тесты 22–23: идентичность и сериализация ─────────────────────────────────

describe('Test 22–23 (§22, §20, §25): идентичность и сериализация цоколя', () => {
  it('Test 22: id царг не меняются при изменении W, H, D и высоты цоколя', () => {
    const build = (over: Partial<Dimensions>, h: number) =>
      buildGeometry(withBase(makeGeometryInput({ ...DIMS, ...over }), { ...createPlinthBase(h), parts: ['front', 'left', 'right'] }));
    const a = build({}, 100);
    const b = build({ width: 1400, height: 2200, depth: 600 }, 150);
    expect(plinthParts(b.parts).map((p) => p.id).sort()).toEqual(plinthParts(a.parts).map((p) => p.id).sort());
  });

  it('Test 23: конфигурация цоколя переживает сериализацию, геометрия совпадает', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const input = withBase(makeGeometryInput(DIMS), {
      ...createPlinthBase(120, 30),
      parts: ['front', 'left', 'right'],
      cutout: { left: 150, right: 150, height: 120 },
    });
    const stored = { ...project, furniture: [input.furniture], materials: input.materials };

    const restored = fromJson(toJson(stored)).project;
    const base = restored.furniture[0]!.carcass.base;
    expect(base?.height).toBe(120);
    expect(base?.setback).toBe(30);
    expect(base?.parts).toEqual(['front', 'left', 'right']);
    expect(base?.cutout).toEqual({ left: 150, right: 150, height: 120 });

    const before = buildGeometry(input);
    const after = buildGeometry({ ...input, furniture: restored.furniture[0]!, materials: restored.materials });
    expect(plinthParts(after.parts)).toEqual(plinthParts(before.parts));
  });

  it('старый проект без полей PROMPT 14 читается и даёт прежнюю геометрию', () => {
    const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
    const document = JSON.parse(toJson(project)) as Record<string, unknown>;
    // В старом файле у карcass нет ни base, ни новых полей задней стенки.
    const restored = fromJson(JSON.stringify(document)).project;
    expect(restored.furniture[0]?.carcass.base).toBeUndefined();
    expect(plinthParts(buildGeometry({ ...makeGeometryInput(DIMS), furniture: restored.furniture[0]! }).parts)).toHaveLength(0);
  });
});
