import { describe, expect, it } from 'vitest';
import { buildDebugView } from '../../../src/render/debug-view.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createSections, createSizedSplit, createUniformGrid, fixedSizes } from '../../../src/domain/furniture/sections.js';
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

describe('buildDebugView: подписи секций (PROMPT 7 §22)', () => {
  const geometry = buildGeometry(
    makeGeometryInputWithRoot((ids) => createSections(ids, 3, 16), {
      width: 1200,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    }),
  );
  const view = buildDebugView(geometry);

  it('по одной подписи SECTION N на секцию, нумерация с единицы', () => {
    expect(view.sectionLabels.map((s) => s.title)).toEqual(['SECTION 1', 'SECTION 2', 'SECTION 3']);
  });

  it('ширина, X и id в подписи взяты из GeometryResult.sections, а не пересчитаны', () => {
    view.sectionLabels.forEach((label, i) => {
      const section = geometry.sections[i]!;
      expect(label.id).toBe(section.nodeId);
      expect(label.detail).toContain(String(section.box.size.x));
      expect(label.detail).toContain(section.nodeId);
      expect(label.centerX).toBe(section.box.min.x + section.box.size.x / 2);
    });
  });

  it('размерные линии секций тоже берутся из секций движка', () => {
    const sectionDims = view.dimensions.filter((d) => d.id.startsWith('dim-section-'));
    expect(sectionDims).toHaveLength(3);
    sectionDims.forEach((dim, i) => {
      const section = geometry.sections[i]!;
      expect(dim.from).toBe(section.box.min.x);
      expect(dim.to).toBe(section.box.min.x + section.box.size.x);
    });
  });
});

describe('buildDebugView: подписи объектов в debug-инфо (PROMPT 8 §24)', () => {
  const widths = [300, 500, 400];
  const width = widths.reduce((a, b) => a + b, 0) + 2 * 16 + 2 * 16;
  const geometry = buildGeometry(
    makeGeometryInputWithRoot(
      (ids) => createSizedSplit(ids, 'x', fixedSizes(widths), 16, (leafIds) => createShelvesLeaf(leafIds, 1, 'adjustable')),
      { width, height: 2000, depth: 500, panelThickness: 16 },
    ),
  );
  const view = buildDebugView(geometry);
  const detailOf = (role: string) => view.rects.find((r) => r.role === role)?.detail ?? '';

  it('перегородка: id, X, толщина, высота', () => {
    const partition = geometry.parts.find((p) => p.role === 'partition')!;
    const detail = detailOf('partition');
    expect(detail).toContain(partition.id);
    expect(detail).toContain(`X ${String(partition.position.x)}`);
    expect(detail).toContain(`Т ${String(partition.size.x)}`);
    expect(detail).toContain(`В ${String(partition.size.y)}`);
  });

  it('полка: id, X, Y, ширина, глубина', () => {
    const shelf = geometry.parts.find((p) => p.role === 'shelf-adjustable')!;
    const detail = detailOf('shelf-adjustable');
    expect(detail).toContain(shelf.id);
    expect(detail).toContain(`X ${String(shelf.position.x)}`);
    expect(detail).toContain(`Y ${String(shelf.position.y)}`);
    expect(detail).toContain(`Ш ${String(shelf.size.x)}`);
    expect(detail).toContain(`Г ${String(shelf.size.z)}`);
  });

  it('ячейка: id, X, Y, ширина, высота', () => {
    const cell = geometry.cells[0]!;
    const rect = view.rects.find((r) => r.kind === 'cell' && r.id === cell.nodeId)!;
    expect(rect.detail).toContain(cell.nodeId);
    expect(rect.detail).toContain(`X ${String(cell.box.min.x)}`);
    expect(rect.detail).toContain(`Y ${String(cell.box.min.y)}`);
    expect(rect.detail).toContain(`Ш ${String(cell.box.size.x)}`);
    expect(rect.detail).toContain(`В ${String(cell.box.size.y)}`);
  });

  it('секции с разными ширинами подписаны своими, а не усреднёнными размерами', () => {
    expect(view.sectionLabels.map((l) => l.title)).toEqual(['SECTION 1', 'SECTION 2', 'SECTION 3']);
    widths.forEach((w, i) => {
      expect(view.sectionLabels[i]!.detail).toContain(`Ш ${String(w)}`);
    });
  });
});

/**
 * Сценарии §25: то, что задание требует проверить глазами в debug-схеме,
 * проверяется здесь на данных — размеры в подписях обязаны совпадать
 * с расчётом, иначе визуальная сверка ничего не доказывает.
 */
describe('buildDebugView: сценарии визуальной проверки (PROMPT 8 §25)', () => {
  const T = 16;

  it.each([[[400, 400, 400]], [[300, 500, 400]], [[200, 300, 700]]])(
    'ширины %j: подписи секций и прямоугольники ячеек совпадают с расчётом',
    (widths) => {
      const width = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * T + 2 * T;
      const geometry = buildGeometry(
        makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'x', fixedSizes(widths), T), {
          width,
          height: 2000,
          depth: 500,
          panelThickness: T,
        }),
      );
      const view = buildDebugView(geometry);

      expect(geometry.sections.map((s) => s.box.size.x)).toEqual(widths);
      const cellRects = view.rects.filter((r) => r.kind === 'cell').sort((a, b) => a.x - b.x);
      expect(cellRects.map((r) => r.width)).toEqual(widths);
      widths.forEach((w, i) => {
        expect(view.sectionLabels[i]!.detail).toContain(`Ш ${String(w)}`);
      });
    },
  );

  it.each([[[500, 500, 500, 500]], [[300, 700, 500, 500]]])(
    'высоты %j: прямоугольники ячеек совпадают с расчётом',
    (heights) => {
      const height = heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * T + 2 * T;
      const geometry = buildGeometry(
        makeGeometryInputWithRoot((ids) => createSizedSplit(ids, 'y', fixedSizes(heights), T), {
          width: 1000,
          height,
          depth: 500,
          panelThickness: T,
        }),
      );
      const view = buildDebugView(geometry);
      const cellRects = view.rects.filter((r) => r.kind === 'cell').sort((a, b) => a.y - b.y);
      expect(cellRects.map((r) => r.height)).toEqual(heights);
    },
  );
});

describe('buildDebugView: пустой результат (фатальная ошибка входа)', () => {
  it('не падает, отдаёт вырожденный вид без прямоугольников и линий', () => {
    const geometry = buildGeometry(makeGeometryInput({ width: -100 }));
    const view = buildDebugView(geometry);
    expect(view.rects).toHaveLength(0);
    expect(view.dimensions).toHaveLength(0);
    expect(view.sectionLabels).toHaveLength(0);
    expect(view.totalWidth).toBe(0);
    expect(view.totalHeight).toBe(0);
  });
});
