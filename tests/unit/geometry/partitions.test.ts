import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { boxContains, hasErrors, isFiniteBox3, sumMm } from '../../../src/domain/index.js';
import type { IdFactory } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Вертикальные перегородки и независимые секции (PROMPT 7 §23).
 *
 * Перегородки как детали существуют с PROMPT 4; этот файл проверяет то,
 * чего до PROMPT 7 в проекте не было: секцию как геометрическую область
 * (`GeometryResult.sections`), связку «перегородка ↔ секция ↔ ячейка ↔
 * полка» и отсутствие физических пересечений деталей.
 */

const T = 16;
/** Без `as const`: тесты меняют отдельные габариты через `{ ...DIMS, width: … }`. */
const DIMS: { width: number; height: number; depth: number; panelThickness: number } = {
  width: 1200,
  height: 2000,
  depth: 500,
  panelThickness: T,
};

const partitions = (r: GeometryResult) => r.parts.filter((p) => p.role === 'partition');
const shelves = (r: GeometryResult) => r.parts.filter((p) => p.role === 'shelf-adjustable' || p.role === 'shelf-fixed');

/** Изделие из N равных секций; при `shelvesPerSection > 0` в каждой секции ещё и полки. */
function build(sectionCount: number, dims = DIMS, shelvesPerSection = 0): GeometryResult {
  const leaf = (ids: IdFactory) =>
    shelvesPerSection > 0 ? createShelvesLeaf(ids, shelvesPerSection, 'adjustable') : createEmptyLeaf(ids);
  return buildGeometry(
    sectionCount <= 1
      ? makeGeometryInputWithRoot(leaf, dims)
      : makeGeometryInputWithRoot((ids) => createSections(ids, sectionCount, T, leaf), dims),
  );
}

describe('Test 1: одна секция — ни одной внутренней перегородки', () => {
  const result = build(1);

  it('partitionCount = 0', () => {
    expect(partitions(result)).toHaveLength(0);
  });

  it('секция ровно одна и занимает весь внутренний объём', () => {
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.box).toEqual(result.innerVolume);
  });

  it('боковины остались боковинами и не стали перегородками', () => {
    // PROMPT 7 §8: LEFT_SIDE/RIGHT_SIDE — другая конструктивная сущность.
    expect(result.parts.filter((p) => p.role === 'side')).toHaveLength(2);
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('Test 2: две секции — одна перегородка', () => {
  const result = build(2);

  it('partitionCount = 1, секций 2', () => {
    expect(partitions(result)).toHaveLength(1);
    expect(result.sections).toHaveLength(2);
  });

  it('перегородка стоит ровно между секциями', () => {
    const [left, right] = result.sections;
    const partition = partitions(result)[0]!;
    expect(partition.position.x).toBe(left!.box.min.x + left!.box.size.x);
    expect(partition.position.x + partition.size.x).toBe(right!.box.min.x);
  });
});

describe('Test 3: три секции — две перегородки', () => {
  const result = build(3);

  it('partitionCount = 2, секций 3', () => {
    expect(partitions(result)).toHaveLength(2);
    expect(result.sections).toHaveLength(3);
  });

  it('секции равны по ширине с точностью до раздачи остатка', () => {
    const widths = result.sections.map((s) => s.box.size.x);
    const spread = Math.max(...widths) - Math.min(...widths);
    // Последняя секция получает фактический остаток (docs/UNITS_AND_PRECISION.md §4),
    // поэтому расхождение не превышает шага сетки.
    expect(spread).toBeLessThanOrEqual(0.1);
  });
});

describe('Test 4: четыре секции — три перегородки', () => {
  const result = build(4);

  it('partitionCount = 3, секций 4', () => {
    expect(partitions(result)).toHaveLength(3);
    expect(result.sections).toHaveLength(4);
  });

  it('секции идут слева направо, index соответствует порядку', () => {
    const byIndex = [...result.sections].sort((a, b) => a.index - b.index);
    for (let i = 1; i < byIndex.length; i += 1) {
      expect(byIndex[i]!.box.min.x).toBeGreaterThan(byIndex[i - 1]!.box.min.x);
    }
  });
});

describe('Test 5–7: изменение числа секций пересчитывает всё зависимое', () => {
  it('3 → 4: появляется перегородка, секции сужаются, ячейки следуют за ними', () => {
    const three = build(3);
    const four = build(4);

    expect(partitions(four)).toHaveLength(partitions(three).length + 1);
    expect(four.sections[0]!.box.size.x).toBeLessThan(three.sections[0]!.box.size.x);
    expect(four.cells).toHaveLength(4);
  });

  it('4 → 3: перегородка исчезает, лишних ячеек и деталей не остаётся', () => {
    const four = build(4);
    const three = build(3);

    expect(partitions(three)).toHaveLength(partitions(four).length - 1);
    expect(three.cells).toHaveLength(3);
    expect(three.sections).toHaveLength(3);
    // Ни одна ячейка не ссылается на исчезнувшую секцию.
    const sectionIds = new Set(three.sections.map((s) => s.nodeId));
    expect(three.cells.every((c) => sectionIds.has(c.sectionId))).toBe(true);
  });

  it('3 → 1: внутренних перегородок не остаётся, секция снова одна', () => {
    const one = build(1);
    expect(partitions(one)).toHaveLength(0);
    expect(one.sections).toHaveLength(1);
    expect(one.cells).toHaveLength(1);
  });
});

describe('Test 8–10: изменение габаритов', () => {
  it('W: ширина секций и позиции перегородок меняются, их количество — нет', () => {
    const before = build(3, { ...DIMS, width: 1200 });
    const after = build(3, { ...DIMS, width: 1600 });

    expect(after.sections).toHaveLength(before.sections.length);
    expect(partitions(after)).toHaveLength(partitions(before).length);
    expect(after.sections[0]!.box.size.x).toBeGreaterThan(before.sections[0]!.box.size.x);
    expect(partitions(after).map((p) => p.position.x)).not.toEqual(partitions(before).map((p) => p.position.x));
    // Толщина перегородки от габарита не зависит.
    expect(partitions(after).map((p) => p.size.x)).toEqual(partitions(before).map((p) => p.size.x));
  });

  it('H: высота секций и перегородок меняется, ширина — нет', () => {
    const before = build(3, { ...DIMS, height: 2000 });
    const after = build(3, { ...DIMS, height: 2400 });

    expect(after.sections[0]!.box.size.y).toBeGreaterThan(before.sections[0]!.box.size.y);
    expect(after.sections[0]!.box.size.x).toBe(before.sections[0]!.box.size.x);
    expect(partitions(after)[0]!.size.y).toBeGreaterThan(partitions(before)[0]!.size.y);
  });

  it('D: глубина секций и перегородок меняется, ширина и высота — нет', () => {
    const before = build(3, { ...DIMS, depth: 400 });
    const after = build(3, { ...DIMS, depth: 500 });

    expect(after.sections[0]!.box.size.z).toBeGreaterThan(before.sections[0]!.box.size.z);
    expect(after.sections[0]!.box.size.x).toBe(before.sections[0]!.box.size.x);
    expect(partitions(after)[0]!.size.z).toBeGreaterThan(partitions(before)[0]!.size.z);
  });
});

describe('Test 11–13: вложенность (containment)', () => {
  const result = build(3, DIMS, 2);

  it('Section ⊂ Carcass: каждая секция лежит внутри внутреннего объёма', () => {
    for (const section of result.sections) {
      expect(boxContains(result.innerVolume, section.box)).toBe(true);
    }
  });

  it('Cell ⊂ Section: каждая ячейка лежит внутри своей секции', () => {
    const sectionById = new Map(result.sections.map((s) => [s.nodeId, s]));
    for (const cell of result.cells) {
      const section = sectionById.get(cell.sectionId);
      expect(section).toBeDefined();
      expect(boxContains(section!.box, cell.box)).toBe(true);
    }
  });

  it('Shelf ⊂ Section: каждая полка лежит внутри секции своей ячейки', () => {
    const sectionById = new Map(result.sections.map((s) => [s.nodeId, s]));
    const cellById = new Map(result.cells.map((c) => [c.nodeId, c]));
    expect(shelves(result).length).toBeGreaterThan(0);
    for (const shelf of shelves(result)) {
      const cell = shelf.origin.nodeId === undefined ? undefined : cellById.get(shelf.origin.nodeId);
      expect(cell).toBeDefined();
      const section = sectionById.get(cell!.sectionId);
      expect(section).toBeDefined();
      expect(boxContains(section!.box, { min: shelf.position, size: shelf.size })).toBe(true);
    }
  });

  it('Partition ∈ Carcass: перегородка лежит внутри внутреннего объёма', () => {
    for (const partition of partitions(result)) {
      expect(boxContains(result.innerVolume, { min: partition.position, size: partition.size })).toBe(true);
    }
  });
});

describe('Test 14: геометрия перегородки', () => {
  const result = build(3);

  it('перегородка занимает полную высоту и глубину внутреннего объёма', () => {
    for (const partition of partitions(result)) {
      expect(partition.size.y).toBe(result.innerVolume.size.y);
      expect(partition.size.z).toBe(result.innerVolume.size.z);
      expect(partition.position.y).toBe(result.innerVolume.min.y);
      expect(partition.position.z).toBe(result.innerVolume.min.z);
    }
  });

  it('толщина перегородки равна заданной толщине разделителя, а не выводится из ширины', () => {
    for (const partition of partitions(result)) {
      expect(partition.size.x).toBe(T);
    }
  });

  it('перегородка — вертикальная деталь, а не полка', () => {
    for (const partition of partitions(result)) {
      expect(partition.orientation).toBe('vertical-yz');
    }
    expect(result.parts.filter((p) => p.role === 'shelf-fixed')).toHaveLength(0);
  });
});

describe('Test 15: стабильность идентификаторов', () => {
  it('одинаковый вход даёт одинаковые id секций, перегородок и ячеек', () => {
    const a = build(3);
    const b = build(3);
    expect(a.sections.map((s) => s.nodeId)).toEqual(b.sections.map((s) => s.nodeId));
    expect(partitions(a).map((p) => p.id)).toEqual(partitions(b).map((p) => p.id));
    expect(a.cells.map((c) => c.nodeId)).toEqual(b.cells.map((c) => c.nodeId));
  });

  it('изменение габарита не меняет ни одного id — меняются только координаты', () => {
    const before = build(3, { ...DIMS, width: 1200 });
    const after = build(3, { ...DIMS, width: 1600 });

    expect(after.sections.map((s) => s.nodeId)).toEqual(before.sections.map((s) => s.nodeId));
    expect(partitions(after).map((p) => p.id)).toEqual(partitions(before).map((p) => p.id));
    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.sections[0]!.box.size.x).not.toBe(before.sections[0]!.box.size.x);
  });

  it('id секции — это id узла дерева, а не порядковый номер', () => {
    const result = build(3);
    // Индексы 0,1,2 существуют как порядок, но идентичность несёт nodeId:
    // иначе перестановка секций «переименовала» бы их все.
    expect(new Set(result.sections.map((s) => s.nodeId)).size).toBe(3);
    expect(result.sections.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});

describe('Test 16: serialize → deserialize → geometry', () => {
  it('id секций, перегородок, ячеек и полок переживают круговой путь через JSON', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const input = makeGeometryInputWithRoot(
      (ids) => createSections(ids, 3, T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
      DIMS,
    );
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const restoredResult = buildGeometry({ ...input, furniture: restored.furniture[0]! });
    const original = buildGeometry(input);

    expect(restoredResult.sections.map((s) => s.nodeId)).toEqual(original.sections.map((s) => s.nodeId));
    expect(partitions(restoredResult).map((p) => p.id)).toEqual(partitions(original).map((p) => p.id));
    expect(restoredResult.cells.map((c) => c.nodeId)).toEqual(original.cells.map((c) => c.nodeId));
    expect(shelves(restoredResult).map((p) => p.id)).toEqual(shelves(original).map((p) => p.id));
    expect(restoredResult).toEqual(original);
  });
});

describe('§18: уравнение ширины с участием секций', () => {
  it.each([1, 2, 3, 4, 10])('sum(sections) + перегородки + боковины = W для %i секций', (count) => {
    const result = build(count);
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.sections).toHaveLength(count);

    const sectionsWidth = sumMm(result.sections.map((s) => s.box.size.x));
    const partitionsWidth = sumMm(partitions(result).map((p) => p.size.x));
    const sidesWidth = sumMm(result.parts.filter((p) => p.role === 'side').map((p) => p.size.x));

    expect(sectionsWidth + partitionsWidth + sidesWidth).toBe(DIMS.width);
    // Заодно фиксируем правило количества: N секций дают N−1 перегородку.
    expect(partitions(result)).toHaveLength(count - 1);
  });
});

describe('§19: физические пересечения деталей', () => {
  it('ни одна деталь не пересекает другую при секциях с полками', () => {
    const result = build(3, DIMS, 3);
    expect(findPartOverlaps(result.parts)).toEqual([]);
  });

  it('касание деталей пересечением не считается: полка стоит вплотную к перегородке', () => {
    const result = build(2, DIMS, 1);
    const partition = partitions(result)[0]!;
    const shelf = shelves(result)[0]!;
    // Полка первой секции упирается в перегородку — это законный контакт.
    expect(shelf.position.x + shelf.size.x).toBe(partition.position.x);
    expect(findPartOverlaps(result.parts)).toEqual([]);
  });

  it('деталей за пределами корпуса нет', () => {
    const result = build(4, DIMS, 2);
    for (const part of result.parts) {
      expect(part.position.x).toBeGreaterThanOrEqual(0);
      expect(part.position.x + part.size.x).toBeLessThanOrEqual(result.bounds.size.x);
      expect(part.position.y + part.size.y).toBeLessThanOrEqual(result.bounds.size.y);
      expect(part.position.z + part.size.z).toBeLessThanOrEqual(result.bounds.size.z);
    }
  });

  it('все объекты результата конечны и уникальны по id внутри своего вида', () => {
    const result = build(4, DIMS, 2);

    const sectionIds = result.sections.map((s) => s.nodeId);
    const cellIds = result.cells.map((c) => c.nodeId);
    const partIds = result.parts.map((p) => p.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    expect(new Set(cellIds).size).toBe(cellIds.length);
    expect(new Set(partIds).size).toBe(partIds.length);

    for (const section of result.sections) expect(isFiniteBox3(section.box)).toBe(true);
    for (const part of result.parts) {
      expect(isFiniteBox3({ min: part.position, size: part.size })).toBe(true);
    }
  });

  it('неразделённая секция и её единственная ячейка — один и тот же узел дерева', () => {
    // Не совпадение и не дефект: секция без внутреннего деления структурно
    // и есть свой единственный проём, поэтому id у них общий
    // (docs/GEOMETRY_RULES.md §9.4). Как только секцию делят по строкам,
    // ячейки получают собственные id — проверено ниже.
    const flat = build(4);
    expect(flat.sections.map((s) => s.nodeId)).toEqual(flat.cells.map((c) => c.nodeId));

    const divided = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) =>
          createSections(ids, 2, T, (leafIds) => ({
            id: leafIds.next<'Node'>(),
            kind: 'split' as const,
            axis: 'y' as const,
            divider: { material: 'panel' as const, thickness: T, mounting: 'fixed' as const, frontSetback: 0 },
            children: [0, 1].map(() => ({
              size: { mode: 'flex' as const, weight: 1 },
              node: createEmptyLeaf(leafIds),
            })),
          })),
        DIMS,
      ),
    );
    expect(divided.sections).toHaveLength(2);
    expect(divided.cells).toHaveLength(4);
    for (const section of divided.sections) {
      expect(divided.cells.map((c) => c.nodeId)).not.toContain(section.nodeId);
    }
  });
});

describe('секция без верхнего деления по X', () => {
  it('дерево из одного листа даёт одну секцию с id корня', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.nodeId).toBe(result.cells[0]?.sectionId);
  });

  it('деление по строкам (ось Y) не создаёт секций: всё изделие — одна секция', async () => {
    const { createUniformGrid } = await import('../../../src/domain/furniture/sections.js');
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 3, 1, T, T), DIMS));
    expect(result.sections).toHaveLength(1);
    expect(result.cells).toHaveLength(3);
    expect(new Set(result.cells.map((c) => c.sectionId)).size).toBe(1);
    // Горизонтальные разделители — не вертикальные перегородки.
    expect(partitions(result)).toHaveLength(0);
    expect(result.parts.filter((p) => p.role === 'shelf-fixed')).toHaveLength(2);
  });
});
