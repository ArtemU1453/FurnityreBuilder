import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createSections, createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf } from '../../../src/domain/furniture/defaults.js';
import { hasErrors, sumMm } from '../../../src/domain/index.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Аудит PROMPT 5: явные end-to-end проверки уравнений из
 * docs/GEOMETRY_RULES.md, раздел «Carcass Calculation Rules».
 *
 * Отличие от уже существующих тестов: `layout.test.ts` проверяет раскладку
 * ПОСЛЕ того, как боковины уже вычтены (работает с `innerVolume`).
 * `properties.test.ts`/`grid-properties.test.ts` проверяют каждую половину
 * (каркас, раскладку) по отдельности. Здесь — одна цепочка от боковин до
 * внешнего габарита `W`/`H`, без пропущенных звеньев: это ровно то
 * уравнение, которое PROMPT 5 §12 требует зафиксировать явно.
 */

const T = 16;
const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: T } as const;

describe('constructedWidth/Height/Depth === заявленный габарит', () => {
  it('constructedWidth === W и constructedHeight === H для типового изделия', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.bounds.size.x).toBe(DIMS.width);
    expect(result.bounds.size.y).toBe(DIMS.height);
  });

  it('constructedDepth === D, когда толщина задней стенки входит в D (тюнинг по умолчанию)', () => {
    // DEFAULT_TOLERANCES.depthIncludesBackPanel === true — см. defaults.ts.
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.bounds.size.z).toBe(DIMS.depth);
  });

  it('constructedDepth === D + Tb, когда толщина задней стенки НЕ входит в D', () => {
    // tolerances.depthIncludesBackPanel = false — см. domain/furniture/types.ts:
    // «входит ли толщина задней стенки в габаритную глубину D». Если нет —
    // D описывает только глубину корпуса, а стенка добавляется СВЕРХ него.
    // Начало координат — задняя плоскость изделия ЦЕЛИКОМ, включая стенку
    // (docs/COORDINATE_SYSTEM.md §3), поэтому построенный габарит физически
    // больше заявленного D на толщину стенки Tb. Это не дефект: `bounds` —
    // измеренный физический охват, а не копия входного D. Ранее это никак
    // не было покрыто тестом — единственная существовавшая проверка
    // depthIncludesBackPanel использовала только значение true (по умолчанию).
    const input = makeGeometryInput(DIMS);
    const withFlag = { ...input, tolerances: { ...input.tolerances, depthIncludesBackPanel: false } };
    const result = buildGeometry(withFlag);
    const backThickness = 3; // DEFAULT_BACK_MOUNT.thickness
    expect(result.bounds.size.z).toBe(DIMS.depth + backThickness);
    // Корпус (и, соответственно, внутренний объём) остаётся полным D:
    // раз толщина стенки НЕ входит в D, D описывает собственную глубину
    // корпуса целиком, а стенка «приклеивается» снаружи, за его задней
    // гранью, не откусывая от D ничего.
    expect(result.innerVolume.size.z).toBe(DIMS.depth);
  });
});

describe('КЛЮЧЕВАЯ ПРОВЕРКА СЕКЦИЙ (PROMPT 5 §12): sum(section widths) + sum(partition thicknesses) + side construction = W', () => {
  it.each([1, 2, 3, 10])('выполняется для %i секций', (count) => {
    const root = count === 1 ? undefined : count;
    const result = buildGeometry(
      root === undefined
        ? makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), DIMS)
        : makeGeometryInputWithRoot((ids) => createSections(ids, count, T), DIMS),
    );
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.cells).toHaveLength(count);

    const sumOfSectionWidths = sumMm(result.cells.map((c) => c.box.size.x));
    const dividerCount = count - 1;
    const sumOfPartitionThicknesses = dividerCount * T;
    const sideConstruction = 2 * T; // левая + правая боковина

    expect(sumOfSectionWidths + sumOfPartitionThicknesses + sideConstruction).toBe(DIMS.width);

    // То же уравнение, но опирающееся на реально построенные детали, а не
    // на константу T — считает перегородки из GeometryResult.parts, а не
    // предполагает их количество.
    const partitionWidths = sumMm(result.parts.filter((p) => p.role === 'partition').map((p) => p.size.x));
    const sideWidths = sumMm(result.parts.filter((p) => p.role === 'side').map((p) => p.size.x));
    expect(sumOfSectionWidths + partitionWidths + sideWidths).toBe(DIMS.width);
  });
});

describe('КЛЮЧЕВАЯ ПРОВЕРКА СТРОК: sum(row heights) + sum(divider thicknesses) + top/bottom construction = H', () => {
  it.each([1, 2, 3, 10])('выполняется для %i строк', (rows) => {
    const root = rows === 1 ? undefined : rows;
    const result = buildGeometry(
      root === undefined
        ? makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), DIMS)
        : makeGeometryInputWithRoot((ids) => createUniformGrid(ids, rows, 1, T, T), DIMS),
    );
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.cells).toHaveLength(rows);

    const sumOfRowHeights = sumMm(result.cells.map((c) => c.box.size.y));
    const dividerCount = rows - 1;
    const sumOfDividerThicknesses = dividerCount * T;
    // Дно и крышка (`hasBottom`/`hasTop`) включены в изделие по умолчанию.
    const topBottomConstruction = 2 * T;

    expect(sumOfRowHeights + sumOfDividerThicknesses + topBottomConstruction).toBe(DIMS.height);
  });
});

describe('минимальная толщина материала вместе с несколькими секциями', () => {
  it('T = 0.1 (минимум сетки) не даёт NaN/отрицательной/нулевой геометрии', () => {
    const thinT = 0.1;
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createSections(ids, 3, thinT), {
        width: 100,
        height: 200,
        depth: 100,
        panelThickness: thinT,
      }),
    );
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.cells).toHaveLength(3);
    for (const cell of result.cells) {
      expect(cell.box.size.x).toBeGreaterThan(0);
      expect(cell.box.size.y).toBeGreaterThan(0);
      expect(cell.box.size.z).toBeGreaterThan(0);
      expect(Number.isFinite(cell.box.size.x)).toBe(true);
    }
    for (const part of result.parts) {
      expect(part.size.x).toBeGreaterThan(0);
      expect(part.size.y).toBeGreaterThan(0);
      expect(part.size.z).toBeGreaterThan(0);
    }
  });
});

describe('каждая деталь построенного каркаса лежит внутри bounds', () => {
  it('позиция и правый край каждой детали не выходят за заявленный габарит', () => {
    // На этом этапе (carcass + layout, без столешницы/фасадов со свесом)
    // ни одна деталь не обязана и не должна выступать за `bounds` — свесы
    // появятся отдельным, ещё не реализованным этапом (docs/GEOMETRY_RULES.md
    // §10) и тогда получат собственный тест, а не расширят этот молча.
    const result = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, T, T), DIMS));
    for (const part of result.parts) {
      expect(part.position.x).toBeGreaterThanOrEqual(0);
      expect(part.position.y).toBeGreaterThanOrEqual(0);
      expect(part.position.z).toBeGreaterThanOrEqual(0);
      expect(part.position.x + part.size.x).toBeLessThanOrEqual(result.bounds.size.x);
      expect(part.position.y + part.size.y).toBeLessThanOrEqual(result.bounds.size.y);
      expect(part.position.z + part.size.z).toBeLessThanOrEqual(result.bounds.size.z);
    }
  });
});
