import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { findPartOverlaps } from '../../../src/geometry/overlaps.js';
import { createSections, createSizedSplit, fixedSizes } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { boxContains, hasErrors, sumMm } from '../../../src/domain/index.js';
import type { IdFactory, SizeSpec } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/types.js';
import { makeGeometryInputWithRoot } from './helpers.js';

/**
 * Неравномерные секции и ряды (PROMPT 8 §26–27).
 *
 * Механизм размеров (`SizeSpec` с режимами `fixed`/`flex`) существует
 * с PROMPT 1 и здесь не заменяется — проверяется то, что до PROMPT 8 не
 * было ни задействовано, ни покрыто: индивидуальные размеры на реальной
 * геометрии и диагностика несходящейся суммы.
 *
 * **Что такое «ширина секции» в этих тестах.** Это ПРОЁМ — чистое
 * пространство между соседними конструктивными деталями. Поэтому габарит
 * изделия шире суммы секций на боковины и перегородки:
 * `W = Σ секций + (N−1)·T + 2·T` (уравнение из `docs/GEOMETRY_RULES.md`
 * §13.1 и §15.8). Задание пишет «1200 → [300, 500, 400]», подразумевая
 * деление отвлечённого отрезка; в физической модели те же три секции
 * требуют `W = 1264`.
 */

const T = 16;
const H = 2000;
const DEPTH = 500;

/** Габарит, при котором заданные ширины секций сходятся точно. */
const widthFor = (sectionWidths: readonly number[]): number =>
  sumMm(sectionWidths) + (sectionWidths.length - 1) * T + 2 * T;

/** Габарит, при котором заданные высоты рядов сходятся точно (дно и крышка тоже T). */
const heightFor = (rowHeights: readonly number[]): number =>
  sumMm(rowHeights) + (rowHeights.length - 1) * T + 2 * T;

const partitions = (r: GeometryResult) => r.parts.filter((p) => p.role === 'partition');
const rowDividers = (r: GeometryResult) => r.parts.filter((p) => p.role === 'shelf-fixed');

function buildSections(sizes: readonly SizeSpec[], width: number, leaf?: (ids: IdFactory) => ReturnType<typeof createEmptyLeaf>): GeometryResult {
  return buildGeometry(
    makeGeometryInputWithRoot(
      (ids) => createSizedSplit(ids, 'x', sizes, T, leaf ?? createEmptyLeaf),
      { width, height: H, depth: DEPTH, panelThickness: T },
    ),
  );
}

function buildRows(sizes: readonly SizeSpec[], height: number): GeometryResult {
  return buildGeometry(
    makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'y', sizes, T), {
      width: 1000,
      height,
      depth: DEPTH,
      panelThickness: T,
    }),
  );
}

// ── СЕКЦИИ (§26) ────────────────────────────────────────────────────────────

describe('§26.1 равные секции: режим по умолчанию не сломан', () => {
  it('createSections по-прежнему даёт равные секции и ноль ошибок', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createSections(ids, 3, T), {
        width: 1200,
        height: H,
        depth: DEPTH,
        panelThickness: T,
      }),
    );
    expect(hasErrors(result.diagnostics)).toBe(false);
    const widths = result.sections.map((s) => s.box.size.x);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.1);
  });
});

describe('§26.2 фиксированные ширины секций', () => {
  const widths = [300, 500, 400];
  const result = buildSections(fixedSizes(widths), widthFor(widths));

  it('каждая секция получает ровно заданную ширину', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.sections.map((s) => s.box.size.x)).toEqual(widths);
  });

  it('позиции секций вычислены из предыдущих, а не заданы вручную', () => {
    // section[0].x = внутренняя левая граница; далее — правый край предыдущей
    // секции плюс толщина перегородки (PROMPT 8 §8).
    const [a, b, c] = result.sections;
    expect(a!.box.min.x).toBe(result.innerVolume.min.x);
    expect(b!.box.min.x).toBe(a!.box.min.x + a!.box.size.x + T);
    expect(c!.box.min.x).toBe(b!.box.min.x + b!.box.size.x + T);
  });

  it('перегородки встали между секциями сами', () => {
    const xs = partitions(result).map((p) => p.position.x);
    expect(xs).toEqual([
      result.sections[0]!.box.min.x + result.sections[0]!.box.size.x,
      result.sections[1]!.box.min.x + result.sections[1]!.box.size.x,
    ]);
  });

  it('уравнение ширины сходится и при разных секциях', () => {
    const sectionsWidth = sumMm(result.sections.map((s) => s.box.size.x));
    const partitionsWidth = sumMm(partitions(result).map((p) => p.size.x));
    const sidesWidth = sumMm(result.parts.filter((p) => p.role === 'side').map((p) => p.size.x));
    expect(sectionsWidth + partitionsWidth + sidesWidth).toBe(widthFor(widths));
  });
});

describe('§26.3–26.6 от одной до четырёх секций с индивидуальными ширинами', () => {
  it.each([[[500]], [[300, 700]], [[300, 500, 400]], [[200, 300, 700, 250]]])(
    'ширины %j дают столько же секций, столько же ячеек и на одну перегородку меньше',
    (widths) => {
      const result = buildSections(fixedSizes(widths), widthFor(widths));
      expect(hasErrors(result.diagnostics)).toBe(false);
      expect(result.sections.map((s) => s.box.size.x)).toEqual(widths);
      expect(result.cells).toHaveLength(widths.length);
      expect(partitions(result)).toHaveLength(widths.length - 1);
      expect(findPartOverlaps(result.parts)).toEqual([]);
    },
  );
});

describe('§26.7 изменение размера ОДНОЙ секции', () => {
  it('соседняя растягиваемая секция забирает разницу, габарит не меняется', () => {
    // [300 fixed, flex] в фиксированном габарите: меняем 300 → 350 и смотрим,
    // что вторая секция сузилась ровно на 50, а W осталась прежней.
    const width = 1264;
    const before = buildSections([{ mode: 'fixed', value: 300 }, { mode: 'flex', weight: 1 }], width);
    const after = buildSections([{ mode: 'fixed', value: 350 }, { mode: 'flex', weight: 1 }], width);

    expect(before.sections[0]!.box.size.x).toBe(300);
    expect(after.sections[0]!.box.size.x).toBe(350);
    expect(after.sections[1]!.box.size.x).toBe(before.sections[1]!.box.size.x - 50);
    expect(after.bounds.size.x).toBe(before.bounds.size.x);
  });

  it('если растягиваемых соседей нет, изменение одной секции ломает сумму и это ошибка, а не тихий зазор', () => {
    const width = widthFor([300, 500, 400]);
    const changed = buildSections(fixedSizes([350, 500, 400]), width);
    expect(hasErrors(changed.diagnostics)).toBe(true);
    expect(changed.diagnostics.map((d) => d.code)).toContain('SPLIT_OVERCONSTRAINED');
  });
});

describe('§26.8 изменение нескольких секций одновременно', () => {
  it('перегородки и ячейки следуют за новыми ширинами', () => {
    const width = widthFor([300, 500, 400]);
    const before = buildSections(fixedSizes([300, 500, 400]), width);
    const after = buildSections(fixedSizes([200, 300, 700]), width);

    expect(after.sections.map((s) => s.box.size.x)).toEqual([200, 300, 700]);
    expect(partitions(after).map((p) => p.position.x)).not.toEqual(partitions(before).map((p) => p.position.x));
    expect(after.cells.map((c) => c.box.size.x)).toEqual([200, 300, 700]);
    expect(findPartOverlaps(after.parts)).toEqual([]);
  });
});

describe('§26.9 недопустимая сумма', () => {
  it('сумма БОЛЬШЕ доступного места — SPLIT_OVERCONSTRAINED, геометрия не строится', () => {
    const result = buildSections(fixedSizes([600, 600, 600]), widthFor([300, 500, 400]));
    expect(result.diagnostics.map((d) => d.code)).toContain('SPLIT_OVERCONSTRAINED');
    expect(result.cells).toHaveLength(0);
    expect(result.sections).toHaveLength(0);
  });

  it('сумма МЕНЬШЕ доступного места — SPLIT_UNDERCONSTRAINED, а не невидимый зазор', () => {
    // До PROMPT 8 этот вход молча давал геометрию с неучтённым остатком:
    // resolveSizes возвращала rest > 0, и никто его не проверял.
    const result = buildSections(fixedSizes([200, 200, 200]), widthFor([300, 500, 400]));
    expect(result.diagnostics.map((d) => d.code)).toContain('SPLIT_UNDERCONSTRAINED');
    expect(result.cells).toHaveLength(0);
  });

  it('каркас при несходящейся сумме остаётся построенным: сломано деление, а не изделие', () => {
    const result = buildSections(fixedSizes([200, 200, 200]), widthFor([300, 500, 400]));
    expect(result.parts.filter((p) => p.role === 'side')).toHaveLength(2);
    expect(result.parts.filter((p) => p.role === 'top')).toHaveLength(1);
  });
});

describe('§26.10–26.11 отрицательная и нулевая ширина', () => {
  it('отрицательная ширина секции не даёт геометрии', () => {
    const result = buildSections([{ mode: 'fixed', value: -100 }, { mode: 'flex', weight: 1 }], 1264);
    expect(hasErrors(result.diagnostics)).toBe(true);
    expect(result.cells.every((c) => c.box.size.x > 0)).toBe(true);
  });

  it('нулевая ширина секции не даёт геометрии', () => {
    const result = buildSections([{ mode: 'fixed', value: 0 }, { mode: 'flex', weight: 1 }], 1264);
    expect(result.diagnostics.map((d) => d.code)).toContain('CELL_SPAN_NOT_POSITIVE');
    expect(result.cells).toHaveLength(0);
  });

  it('NaN и Infinity в размере секции не попадают в геометрию', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buildSections([{ mode: 'fixed', value: bad }, { mode: 'flex', weight: 1 }], 1264);
      expect(hasErrors(result.diagnostics)).toBe(true);
      for (const cell of result.cells) {
        expect(Number.isFinite(cell.box.size.x)).toBe(true);
        expect(cell.box.size.x).toBeGreaterThan(0);
      }
    }
  });
});

describe('§26.12 стабильность id при изменении размеров', () => {
  it('изменение ширины секции не меняет ни одного идентификатора', () => {
    const width = 1264;
    const build = (first: number) =>
      buildGeometry(
        makeGeometryInputWithRoot(
          (ids) =>
            createSizedSplit(ids, 'x', [{ mode: 'fixed', value: first }, { mode: 'flex', weight: 1 }], T, (leafIds) =>
              createShelvesLeaf(leafIds, 2, 'adjustable'),
            ),
          { width, height: H, depth: DEPTH, panelThickness: T },
        ),
      );
    const before = build(300);
    const after = build(350);

    expect(after.sections.map((s) => s.nodeId)).toEqual(before.sections.map((s) => s.nodeId));
    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.parts.map((p) => p.id)).toEqual(before.parts.map((p) => p.id));
    // Геометрия при этом действительно изменилась.
    expect(after.sections[0]!.box.size.x).not.toBe(before.sections[0]!.box.size.x);
  });
});

// ── РЯДЫ (§27) ──────────────────────────────────────────────────────────────

describe('§27.1–27.2 ряды: равные и фиксированные', () => {
  it('равные ряды по-прежнему равны', () => {
    const result = buildRows([1, 2, 3, 4].map(() => ({ mode: 'flex' as const, weight: 1 })), 2000);
    expect(hasErrors(result.diagnostics)).toBe(false);
    const heights = result.cells.map((c) => c.box.size.y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(0.1);
  });

  it('фиксированные высоты рядов дают ровно заданные высоты ячеек', () => {
    const heights = [400, 600, 500, 500];
    const result = buildRows(fixedSizes(heights), heightFor(heights));
    expect(hasErrors(result.diagnostics)).toBe(false);
    // Ячейки идут снизу вверх, как и ось Y.
    const sorted = [...result.cells].sort((a, b) => a.box.min.y - b.box.min.y);
    expect(sorted.map((c) => c.box.size.y)).toEqual(heights);
  });

  it('уравнение высоты сходится: ряды + разделители + дно и крышка = H', () => {
    const heights = [300, 700, 500, 500];
    const totalHeight = heightFor(heights);
    const result = buildRows(fixedSizes(heights), totalHeight);
    const rowsHeight = sumMm(result.cells.map((c) => c.box.size.y));
    const dividersHeight = sumMm(rowDividers(result).map((p) => p.size.y));
    const topBottom = 2 * T;
    expect(rowsHeight + dividersHeight + topBottom).toBe(totalHeight);
  });

  it('горизонтальные разделители встали между рядами сами', () => {
    const heights = [300, 700, 500];
    const result = buildRows(fixedSizes(heights), heightFor(heights));
    const sortedCells = [...result.cells].sort((a, b) => a.box.min.y - b.box.min.y);
    const sortedDividers = [...rowDividers(result)].sort((a, b) => a.position.y - b.position.y);
    expect(sortedDividers.map((d) => d.position.y)).toEqual([
      sortedCells[0]!.box.min.y + sortedCells[0]!.box.size.y,
      sortedCells[1]!.box.min.y + sortedCells[1]!.box.size.y,
    ]);
  });
});

describe('§27.3–27.4 изменение высоты рядов', () => {
  it('изменение одного ряда сдвигает разделители и меняет высоту соседа', () => {
    const totalHeight = 2000;
    const before = buildRows([{ mode: 'fixed', value: 500 }, { mode: 'flex', weight: 1 }], totalHeight);
    const after = buildRows([{ mode: 'fixed', value: 700 }, { mode: 'flex', weight: 1 }], totalHeight);

    const lowestBefore = [...before.cells].sort((a, b) => a.box.min.y - b.box.min.y)[0]!;
    const lowestAfter = [...after.cells].sort((a, b) => a.box.min.y - b.box.min.y)[0]!;
    expect(lowestBefore.box.size.y).toBe(500);
    expect(lowestAfter.box.size.y).toBe(700);
    expect(rowDividers(after)[0]!.position.y).toBe(rowDividers(before)[0]!.position.y + 200);
    expect(after.bounds.size.y).toBe(before.bounds.size.y);
  });

  it('изменение нескольких рядов пересчитывает все Y без пересечений', () => {
    const heights = [300, 700, 500, 500];
    const result = buildRows(fixedSizes(heights), heightFor(heights));
    const changed = buildRows(fixedSizes([500, 500, 500, 500]), heightFor(heights));
    expect(changed.cells.map((c) => c.box.min.y)).not.toEqual(result.cells.map((c) => c.box.min.y));
    expect(findPartOverlaps(changed.parts)).toEqual([]);
  });
});

describe('§27.5–27.7 недопустимые высоты рядов', () => {
  it('сумма высот больше доступной — ошибка', () => {
    const result = buildRows(fixedSizes([900, 900, 900]), 2000);
    expect(result.diagnostics.map((d) => d.code)).toContain('SPLIT_OVERCONSTRAINED');
    expect(result.cells).toHaveLength(0);
  });

  it('сумма высот меньше доступной — ошибка, а не зазор под крышкой', () => {
    const result = buildRows(fixedSizes([300, 300, 300]), 2000);
    expect(result.diagnostics.map((d) => d.code)).toContain('SPLIT_UNDERCONSTRAINED');
    expect(result.cells).toHaveLength(0);
  });

  it('отрицательная и нулевая высота ряда не дают геометрии', () => {
    for (const bad of [-100, 0]) {
      const result = buildRows([{ mode: 'fixed', value: bad }, { mode: 'flex', weight: 1 }], 2000);
      expect(hasErrors(result.diagnostics)).toBe(true);
      expect(result.cells.every((c) => c.box.size.y > 0)).toBe(true);
    }
  });
});

describe('§27.8 и §15: полки следуют за высотой ряда, сохраняя идентичность', () => {
  it('Y полки меняется вместе с высотой ряда, id, роль и материал — нет', () => {
    const build = (firstRow: number) =>
      buildGeometry(
        makeGeometryInputWithRoot(
          (ids) =>
            createSizedSplit(ids, 'y', [{ mode: 'fixed', value: firstRow }, { mode: 'flex', weight: 1 }], T, (leafIds) =>
              createShelvesLeaf(leafIds, 2, 'adjustable'),
            ),
          { width: 1000, height: 2000, depth: DEPTH, panelThickness: T },
        ),
      );
    const shelvesOf = (r: GeometryResult) => r.parts.filter((p) => p.role === 'shelf-adjustable');

    const before = build(500);
    const after = build(700);

    expect(shelvesOf(after).map((p) => p.id)).toEqual(shelvesOf(before).map((p) => p.id));
    expect(shelvesOf(after).map((p) => p.role)).toEqual(shelvesOf(before).map((p) => p.role));
    expect(shelvesOf(after).map((p) => p.materialId)).toEqual(shelvesOf(before).map((p) => p.materialId));
    expect(shelvesOf(after).map((p) => p.position.y)).not.toEqual(shelvesOf(before).map((p) => p.position.y));
  });
});

// ── КОЛОНКИ (§28) ───────────────────────────────────────────────────────────

describe('§28 индивидуальные колонки внутри секции', () => {
  it('секция с колонками [150, 250] даёт две ячейки заданной ширины', () => {
    // Тот же механизм, что у секций: колонка — ребёнок деления по X,
    // просто не верхнего уровня. Отдельной системы размеров не заводится.
    const columnWidths = [150, 250];
    const sectionWidth = sumMm(columnWidths) + (columnWidths.length - 1) * T;
    const otherSection = 400;
    const width = widthFor([sectionWidth, otherSection]);

    const result = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => {
          const columns = createSizedSplit(ids, 'x', fixedSizes(columnWidths), T);
          return {
            id: ids.next<'Node'>(),
            kind: 'split' as const,
            axis: 'x' as const,
            divider: { material: 'panel' as const, thickness: T, mounting: 'fixed' as const, frontSetback: 0 },
            children: [
              { size: { mode: 'fixed' as const, value: sectionWidth }, node: columns },
              { size: { mode: 'fixed' as const, value: otherSection }, node: createEmptyLeaf(ids) },
            ],
          };
        },
        { width, height: H, depth: DEPTH, panelThickness: T },
      ),
    );

    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.box.size.x).toBe(sectionWidth);

    const inFirstSection = result.cells.filter((c) => c.sectionId === result.sections[0]!.nodeId);
    expect(inFirstSection.map((c) => c.box.size.x).sort((a, b) => a - b)).toEqual(columnWidths);
    for (const cell of inFirstSection) {
      expect(boxContains(result.sections[0]!.box, cell.box)).toBe(true);
    }
    expect(findPartOverlaps(result.parts)).toEqual([]);
  });
});

// ── СЕРИАЛИЗАЦИЯ (§30) ──────────────────────────────────────────────────────

describe('§30 serialize → deserialize → geometry с индивидуальными размерами', () => {
  it('размеры и идентификаторы переживают круговой путь через JSON', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');

    const widths = [300, 500, 400];
    const input = makeGeometryInputWithRoot(
      (ids) => createSizedSplit(ids, 'x', fixedSizes(widths), T, (leafIds) => createShelvesLeaf(leafIds, 2, 'adjustable')),
      { width: widthFor(widths), height: H, depth: DEPTH, panelThickness: T },
    );
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const original = buildGeometry(input);
    const roundTripped = buildGeometry({ ...input, furniture: restored.furniture[0]! });

    expect(roundTripped.sections.map((s) => s.box.size.x)).toEqual(widths);
    expect(roundTripped).toEqual(original);
  });
});
