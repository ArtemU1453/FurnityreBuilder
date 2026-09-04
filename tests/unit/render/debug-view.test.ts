import { describe, expect, it } from 'vitest';
import { buildDebugView } from '../../../src/render/debug-view.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createSections, createSizedSplit, createUniformGrid, fixedSizes } from '../../../src/domain/furniture/sections.js';
import { createDrawersLeaf, createEmptyLeaf, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { NodeId } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from '../geometry/helpers.js';

/**
 * Материалы по умолчанию (PROMPT 13 §22): все геометрии в этом файле
 * строятся через `makeGeometryInput`/`makeGeometryInputWithRoot`, обе
 * используют один и тот же стартовый `createDefaultMaterials()` — та же
 * библиотека, что и в геометрии, поэтому безопасно переиспользуется для
 * всех вызовов `buildDebugView` в файле.
 */
const DEFAULT_MATERIALS = makeGeometryInput().materials;

/**
 * `buildDebugView` — чистая проекция уже посчитанной геометрии. Тесты
 * проверяют, что она НЕ вычисляет собственную математику (PROMPT 4 §20):
 * каждое число здесь должно быть прослеживаемо к конкретному полю
 * `GeometryResult`, а не к формуле, написанной заново.
 */

describe('buildDebugView: базовый корпус', () => {
  const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);

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
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);

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
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);

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
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);

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
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);
  // Подпись ищется по id детали, а не по «первой с такой ролью»: с
  // PROMPT 22 порядок прямоугольников задан площадью (см. `byPaintOrder`),
  // и «первая полка в порядке движка» больше не совпадает с «первой
  // полкой в виде». Роль здесь и не нужна — id однозначен.
  const detailOf = (id: string) => view.rects.find((r) => r.id === id)?.detail ?? '';

  it('перегородка: id, X, толщина, высота', () => {
    const partition = geometry.parts.find((p) => p.role === 'partition')!;
    const detail = detailOf(partition.id);
    expect(detail).toContain(partition.id);
    expect(detail).toContain(`X ${String(partition.position.x)}`);
    expect(detail).toContain(`Т ${String(partition.size.x)}`);
    expect(detail).toContain(`В ${String(partition.size.y)}`);
  });

  it('полка: id, X, Y, ширина, глубина', () => {
    const shelf = geometry.parts.find((p) => p.role === 'shelf-adjustable')!;
    const detail = detailOf(shelf.id);
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
      const view = buildDebugView(geometry, DEFAULT_MATERIALS);

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
      const view = buildDebugView(geometry, DEFAULT_MATERIALS);
      const cellRects = view.rects.filter((r) => r.kind === 'cell').sort((a, b) => a.y - b.y);
      expect(cellRects.map((r) => r.height)).toEqual(heights);
    },
  );
});

describe('buildDebugView: наполнение ячейки (PROMPT 9 §15)', () => {
  it('пустая ячейка подписана как CONTENT: ПУСТО', () => {
    const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cell = view.rects.find((r) => r.kind === 'cell');
    expect(cell?.content).toBe('CONTENT: ПУСТО');
  });

  it('ячейка с полками подписана своим видом наполнения, а не «пусто»', () => {
    const geometry = buildGeometry(
      makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 2, 'adjustable'), {
        width: 1000,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cell = view.rects.find((r) => r.kind === 'cell');
    expect(cell?.content).toBe('CONTENT: ПОЛКИ');
  });

  it('вид наполнения виден и в подробной подписи, вместе с id ячейки', () => {
    const geometry = buildGeometry(
      makeGeometryInputWithRoot((ids) => createShelvesLeaf(ids, 1, 'adjustable'), {
        width: 1000,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cell = view.rects.find((r) => r.kind === 'cell')!;
    expect(cell.detail).toContain(geometry.cells[0]!.nodeId);
    expect(cell.detail).toContain('shelves');
  });

  it('каждая ячейка получает свою подпись наполнения — связь Content → Cell не теряется', () => {
    const geometry = buildGeometry(
      makeGeometryInputWithRoot(
        (ids) => ({
          id: ids.next<'Node'>(),
          kind: 'split' as const,
          axis: 'x' as const,
          divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
          children: [
            { size: { mode: 'flex' as const, weight: 1 }, node: createShelvesLeaf(ids, 2, 'adjustable') },
            { size: { mode: 'flex' as const, weight: 1 }, node: createEmptyLeaf(ids) },
          ],
        }),
        { width: 1200, height: 2000, depth: 500, panelThickness: 16 },
      ),
    );
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cells = view.rects.filter((r) => r.kind === 'cell').sort((a, b) => a.x - b.x);
    expect(cells.map((c) => c.content)).toEqual(['CONTENT: ПОЛКИ', 'CONTENT: ПУСТО']);
    expect(cells.map((c) => c.id)).toEqual(geometry.cells.map((c) => c.nodeId));
  });
});

describe('buildDebugView: дверь на ячейке (PROMPT 10 §18)', () => {
  function buildWithDoor() {
    let cellId!: NodeId;
    const input = makeGeometryInputWithRoot((ids) => {
      const leaf = createEmptyLeaf(ids);
      cellId = leaf.id;
      return leaf;
    }, { width: 1000, height: 2000, depth: 500, panelThickness: 16 });
    const facade = createHingedFacade(createSequentialIdFactory('f'), cellId, 1);
    const withFacade: GeometryInput = { ...input, furniture: { ...input.furniture, facades: [facade] } };
    return { geometry: buildGeometry(withFacade), cellId };
  }

  it('дверь становится прямоугольником-деталью со своей ролью', () => {
    const { geometry } = buildWithDoor();
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const door = view.rects.find((r) => r.role === 'facade');
    expect(door).toBeDefined();
    expect(door?.kind).toBe('part');
  });

  it('подпись двери содержит id, координаты, ширину/высоту/толщину и сторону петель', () => {
    const { geometry } = buildWithDoor();
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const door = view.rects.find((r) => r.role === 'facade')!;
    expect(door.detail).toContain(door.id);
    expect(door.detail).toContain('петли слева');
    expect(door.detail).toMatch(/Ш \d/);
    expect(door.detail).toMatch(/В \d/);
    expect(door.detail).toMatch(/Т \d/);
  });

  it('ячейка с дверью показывает её в CONTENT и в подробной подписи', () => {
    const { geometry, cellId } = buildWithDoor();
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cell = view.rects.find((r) => r.kind === 'cell' && r.id === cellId)!;
    expect(cell.content).toContain('ДВЕРЬ');
    expect(cell.detail).toContain('дверь');
  });

  it('ячейка без двери не упоминает её в подписи', () => {
    const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    const cell = view.rects.find((r) => r.kind === 'cell')!;
    expect(cell.content).not.toContain('ДВЕРЬ');
    expect(cell.detail).not.toContain('дверь');
  });
});

describe('buildDebugView: фасады ящиков на ячейке (PROMPT 11)', () => {
  it('фасад ящика становится прямоугольником-деталью роли facade', () => {
    const geometry = buildGeometry(
      makeGeometryInputWithRoot((ids) => createDrawersLeaf(ids, 2), {
        width: 1000,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    const facadeRects = buildDebugView(geometry, DEFAULT_MATERIALS).rects.filter((r) => r.role === 'facade');
    expect(facadeRects).toHaveLength(2);
    expect(facadeRects.every((r) => r.kind === 'part')).toBe(true);
  });

  it('ячейка с ящиками подписана CONTENT: ЯЩИКИ, БЕЗ пометки ДВЕРЬ', () => {
    const geometry = buildGeometry(
      makeGeometryInputWithRoot((ids) => createDrawersLeaf(ids, 2), {
        width: 1000,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    const cell = buildDebugView(geometry, DEFAULT_MATERIALS).rects.find((r) => r.kind === 'cell')!;
    expect(cell.content).toBe('CONTENT: ЯЩИКИ');
    expect(cell.content).not.toContain('ДВЕРЬ');
    expect(cell.detail).not.toContain('дверь');
  });
});

describe('buildDebugView: пустой результат (фатальная ошибка входа)', () => {
  it('не падает, отдаёт вырожденный вид без прямоугольников и линий', () => {
    const geometry = buildGeometry(makeGeometryInput({ width: -100 }));
    const view = buildDebugView(geometry, DEFAULT_MATERIALS);
    expect(view.rects).toHaveLength(0);
    expect(view.dimensions).toHaveLength(0);
    expect(view.sectionLabels).toHaveLength(0);
    expect(view.totalWidth).toBe(0);
    expect(view.totalHeight).toBe(0);
  });
});

describe('порядок отрисовки: крупное под мелким (PROMPT 22 §5)', () => {
  const geometry = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));
  const view = buildDebugView(geometry, DEFAULT_MATERIALS);

  it('задняя стенка лежит ниже всего, что она перекрывает', () => {
    // В SVG порядок в документе — это и порядок наложения, и порядок
    // попадания указателя. Задняя стенка на фронтальном виде накрывает
    // изделие целиком: пока она рисовалась последней, щелчок по боковине
    // доставался ей, и выбрать боковину было невозможно (найдено сквозным
    // тестом выделения).
    const back = view.rects.findIndex((rect) => rect.role === 'back');
    const side = view.rects.findIndex((rect) => rect.role === 'side');
    expect(back).toBeGreaterThanOrEqual(0);
    expect(side).toBeGreaterThan(back);
  });

  it('площадь не возрастает вдоль порядка отрисовки', () => {
    const areas = view.rects.map((rect) => rect.width * rect.height);
    for (let i = 1; i < areas.length; i += 1) {
      expect(areas[i]!).toBeLessThanOrEqual(areas[i - 1]!);
    }
  });

  it('сортировка ничего не теряет и не добавляет', () => {
    const ids = new Set(view.rects.map((rect) => rect.id));
    expect(ids.size).toBe(view.rects.length);
    expect(view.rects.length).toBe(geometry.parts.length + geometry.cells.length);
  });

  it('порядок детерминирован: одинаковый вход — одинаковый вид', () => {
    const again = buildDebugView(geometry, DEFAULT_MATERIALS);
    expect(again.rects.map((rect) => rect.id)).toEqual(view.rects.map((rect) => rect.id));
  });
});
