import { describe, expect, it } from 'vitest';
import { buildDebugView } from '../../../src/render/debug-view.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from '../geometry/helpers.js';

/**
 * `buildDebugView` — чистая проекция уже посчитанной геометрии. Тесты
 * проверяют, что она НЕ вычисляет собственную математику (PROMPT 4 §20):
 * каждое число здесь должно быть прослеживаемо к конкретному полю
 * `GeometryResult`, а не к формуле, написанной заново.
 */

describe('buildDebugView: базовый корпус', () => {
  const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
  const view = buildDebugView(geometry);

  it('общие размеры совпадают с boundingBox геометрии, а не пересчитаны заново', () => {
    expect(view.totalWidth).toBe(geometry.boundingBox.totalWidth);
    expect(view.totalHeight).toBe(geometry.boundingBox.totalHeight);
  });

  it('каждая деталь становится прямоугольником — проекция XY, Z отброшена', () => {
    const partRects = view.rects.filter((r) => r.kind === 'part');
    expect(partRects).toHaveLength(geometry.parts.length);
    const left = partRects.find((r) => r.label === 'Боковина левая')!;
    expect(left).toMatchObject({ x: 0, y: 0, width: 16, height: 2000 });
  });

  it('каждая ячейка становится прямоугольником', () => {
    const cellRects = view.rects.filter((r) => r.kind === 'cell');
    expect(cellRects).toHaveLength(geometry.cells.length);
  });

  it('размерная линия общей ширины и высоты присутствует', () => {
    expect(view.dimensions.some((d) => d.id === 'dim-total-width' && d.text === '1000 мм')).toBe(true);
    expect(view.dimensions.some((d) => d.id === 'dim-total-height' && d.text === '2000 мм')).toBe(true);
  });

  it('для одной секции нет отдельной размерной линии секции — она совпадает с общей', () => {
    expect(view.dimensions.some((d) => d.id.startsWith('dim-section-'))).toBe(false);
  });
});

describe('buildDebugView: несколько секций', () => {
  const geometry = buildGeometry(
    makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 3, 16, 16), {
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    }),
  );
  const view = buildDebugView(geometry);

  it('по одной размерной линии на секцию', () => {
    const sectionDims = view.dimensions.filter((d) => d.id.startsWith('dim-section-'));
    expect(sectionDims).toHaveLength(3);
  });

  it('ширина каждой линии секции совпадает с реальной шириной её ячеек', () => {
    const sectionDims = view.dimensions.filter((d) => d.id.startsWith('dim-section-'));
    for (const dim of sectionDims) {
      const width = dim.to - dim.from;
      const matchingCell = geometry.cells.find((c) => Math.abs(c.box.min.x - dim.from) < 0.1);
      expect(matchingCell).toBeDefined();
      expect(width).toBeCloseTo(matchingCell?.box.size.x ?? -1, 1);
    }
  });
});

describe('buildDebugView: полки (PROMPT 6 §26–27)', () => {
  const geometry = buildGeometry(
    makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 3, 'adjustable'), {
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    }),
  );
  const view = buildDebugView(geometry);

  it('полка попадает в схему как деталь со своей ролью — рендерер отличит её от пустого пространства ячейки', () => {
    const shelfRects = view.rects.filter((r) => r.role === 'shelf-adjustable');
    expect(shelfRects).toHaveLength(3);
    expect(shelfRects.every((r) => r.kind === 'part')).toBe(true);
  });

  it('подпись полки берёт глубину и секцию из GeometryResult, а не пересчитывает их', () => {
    const shelf = view.rects.find((r) => r.role === 'shelf-adjustable');
    const geometryShelf = geometry.parts.find((p) => p.role === 'shelf-adjustable');
    expect(shelf?.depth).toBe(geometryShelf?.size.z);
    // Толщина полки — это её размер по Y, то есть height прямоугольника.
    expect(shelf?.height).toBe(geometryShelf?.size.y);
    expect(shelf?.sectionId).toBe(geometry.cells[0]?.sectionId);
  });

  it('у деталей корпуса секции нет: они не принадлежат ни одной ячейке', () => {
    const side = view.rects.find((r) => r.role === 'side');
    expect(side?.sectionId).toBeUndefined();
  });
});

describe('buildDebugView: пустой результат (фатальная ошибка входа)', () => {
  it('не падает, отдаёт вырожденный вид без прямоугольников и линий', () => {
    const geometry = buildGeometry(makeGeometryInput({ width: -100 }));
    const view = buildDebugView(geometry);
    expect(view.rects).toHaveLength(0);
    expect(view.dimensions).toHaveLength(0);
    expect(view.totalWidth).toBe(0);
    expect(view.totalHeight).toBe(0);
  });
});
