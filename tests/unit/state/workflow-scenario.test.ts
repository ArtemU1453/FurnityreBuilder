import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createDrawersLeaf,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { validateProductionReadiness } from '../../../src/workflow/index.js';
import { toJson, fromJson } from '../../../src/persistence/serialization.js';
import type { GeometryResult } from '../../../src/geometry/index.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * Сквозной сценарий конструктора (PROMPT 27 §39).
 *
 * Проходит весь путь «новый проект → размеры → секции → ячейки → полки →
 * наполнение → фасады → материалы → кромка → корпус → проверка →
 * производство» теми же командами, которыми его проходит интерфейс.
 * Смысл не в том, что «всё вызывается», а в свойствах, которые ломаются
 * молча: геометрия пересчитывается, деталей не дублируется, ячейки не
 * попадают в деталировку, отмена возвращает ровно один шаг, сохранение
 * переживает круговой путь.
 *
 * Шаги здесь — те же одиннадцать, что в `src/app/workflow/steps.ts`, но
 * тест зависит не от них, а от домена: экранная последовательность может
 * поменяться, инварианты изделия — нет.
 */

const scenario = () =>
  createDocumentStore(
    createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' }),
  );

type Store = ReturnType<typeof scenario>;

const project = (s: Store): Project => s.getState().project;

const geometryOf = (s: Store): GeometryResult => {
  const p = project(s);
  const furniture = p.furniture[0]!;
  return buildGeometry({
    furniture,
    scheme: p.settings.construction,
    tolerances: p.settings.tolerances,
    materials: p.materials,
    edgeSizing: p.settings.edgeSizing,
  });
};

const cells = (s: Store): GeometryResult['cells'] => geometryOf(s).cells;

const shelves = (s: Store): number =>
  geometryOf(s).parts.filter((part) => part.role.startsWith('shelf-')).length;

const facades = (s: Store): number =>
  geometryOf(s).parts.filter((part) => part.role === 'facade' || part.role === 'drawer-front')
    .length;

/** Секции создаются той же командой, что и в интерфейсе: id и толщина — снаружи. */
function setSectionCount(s: Store, count: number, prefix: string): void {
  const ids = createSequentialIdFactory(prefix);
  s.getState().execute(
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count,
      splitId: ids.next<'Node'>(),
      newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
      dividerThickness: project(s).furniture[0]!.dimensions.panelThickness,
    },
    `Секций: ${String(count)}`,
  );
}

describe('новый проект → производство', () => {
  it('весь путь проходится существующими командами и даёт непротиворечивый результат', () => {
    const s = scenario();
    const run = s.getState().execute;

    // ── 01 Размеры ────────────────────────────────────────────────────────
    run({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 }, 'Ширина');
    run({ type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 }, 'Высота');
    run({ type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 600 }, 'Глубина');
    expect(project(s).furniture[0]?.dimensions.width).toBe(1800);
    // Габарит доходит до геометрии, а не остаётся числом в поле ввода.
    expect(geometryOf(s).bounds.size.x).toBe(1800);

    // ── 03 Секции ─────────────────────────────────────────────────────────
    setSectionCount(s, 3, 'sec');
    expect(geometryOf(s).sections).toHaveLength(3);

    // Ширина второй секции — по идентификатору ребёнка, а не по позиции.
    const root = project(s).furniture[0]!.root;
    const second = root.kind === 'split' ? root.children[1] : undefined;
    expect(second).toBeDefined();
    run(
      {
        type: 'SetChildSize',
        furnitureIndex: 0,
        childId: second!.node.id,
        size: { mode: 'fixed', value: 700 },
      },
      'Ширина секции 2',
    );
    const widths = geometryOf(s).sections.map((section) => Math.round(section.box.size.x));
    expect(widths[1]).toBe(700);
    // Остальные секции поделили остаток поровну: сумма не изменилась.
    expect(widths[0]).toBe(widths[2]);
    expect(geometryOf(s).bounds.size.x).toBe(1800);

    // ── 04 Ячейки: ряды внутри изделия ────────────────────────────────────
    const gridIds = createSequentialIdFactory('g');
    const thickness = project(s).furniture[0]!.dimensions.panelThickness;
    run(
      {
        type: 'SetRoot',
        furnitureIndex: 0,
        root: createUniformGrid(gridIds, 2, 2, thickness, thickness),
      },
      'Сетка 2×2',
    );
    expect(cells(s)).toHaveLength(4);

    // ── 05 Полки ──────────────────────────────────────────────────────────
    // Отсчёт от текущего значения, а не от нуля: горизонтальный разделитель
    // сетки — тоже полка (`shelf-fixed`), и полки ячейки к нему добавляются.
    const beforeShelves = shelves(s);
    const shelfCell = cells(s)[0]!.nodeId;
    run(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: shelfCell,
        fill: createShelvesLeaf(createSequentialIdFactory('sh'), 2).fill,
      },
      'Полки',
    );
    expect(shelves(s)).toBe(beforeShelves + 2);

    // ── 06 Наполнение: ящики в другой ячейке ──────────────────────────────
    const drawerCell = cells(s).find((cell) => cell.nodeId !== shelfCell)!.nodeId;
    run(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: drawerCell,
        fill: createDrawersLeaf(createSequentialIdFactory('dr'), 2).fill,
      },
      'Ящики',
    );
    const withDrawers = facades(s);
    expect(withDrawers).toBeGreaterThan(0);
    // Полки соседней ячейки от этого не исчезли: ячейки независимы.
    expect(shelves(s)).toBe(beforeShelves + 2);

    // ── 07 Фасады: дверь на третью ячейку ─────────────────────────────────
    const doorCell = cells(s).find(
      (cell) => cell.nodeId !== shelfCell && cell.nodeId !== drawerCell,
    )!.nodeId;
    run(
      {
        type: 'AddFacade',
        furnitureIndex: 0,
        facade: createHingedFacade(createSequentialIdFactory('fa'), doorCell, 1),
      },
      'Дверь',
    );
    expect(facades(s)).toBeGreaterThan(withDrawers);

    // ── 08 Материалы и кромка ─────────────────────────────────────────────
    const material = Object.values(project(s).materials.items)[0]!;
    run(
      { type: 'SetMaterialAssignment', role: 'shelf-adjustable', materialId: material.id },
      'Материал полок',
    );
    expect(project(s).materials.assignment['shelf-adjustable']).toBe(material.id);
    run({ type: 'SetEdgeSizingPolicy', policy: { subtractFromPartSize: true } }, 'Кромка');
    expect(project(s).settings.edgeSizing.subtractFromPartSize).toBe(true);

    // ── 02/09 Корпус: задняя стенка и цоколь ──────────────────────────────
    run(
      {
        type: 'SetBackPanel',
        furnitureIndex: 0,
        patch: { mount: { kind: 'overlay', thickness: 4 } },
      },
      'Задняя стенка',
    );
    run(
      {
        type: 'SetBase',
        furnitureIndex: 0,
        base: createPlinthBase(100),
      },
      'Цоколь',
    );
    expect(geometryOf(s).parts.some((part) => part.role === 'back')).toBe(true);
    expect(geometryOf(s).parts.some((part) => part.role === 'plinth')).toBe(true);

    // ── Инварианты деталировки ────────────────────────────────────────────
    const result = geometryOf(s);
    expect(result.diagnostics.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    const partIds = result.parts.map((part) => part.id);
    // Ни одной детали дважды: дублирование ломает раскрой и спецификацию.
    expect(new Set(partIds).size).toBe(partIds.length);
    // Ячейки — пространство, а не деталь: в деталировку они не попадают (§9).
    const cellIds = new Set(result.cells.map((cell) => cell.nodeId as string));
    expect(partIds.some((id) => cellIds.has(id as string))).toBe(false);
    // «Сирот» нет: каждая деталь принадлежит существующему изделию.
    const furnitureIds = new Set(project(s).furniture.map((item) => item.id as string));
    expect(result.parts.every((part) => furnitureIds.has(part.origin.furnitureId as string))).toBe(
      true,
    );

    // ── 10 Проверка и 11 Производство ─────────────────────────────────────
    const furniture = project(s).furniture[0]!;
    const calculation = calculateProduction(project(s), {
      geometry: new Map([[furniture.id, result]]),
    });
    const readiness = validateProductionReadiness(project(s), { calculation });
    expect(readiness.checks).toHaveLength(8);
    // Расчёт доходит до конца и описывает то же изделие, что показано.
    // Строк в спецификации меньше, чем деталей: одинаковые детали сведены
    // в одну строку с количеством. Сверяется поэтому трассируемость, а не
    // длина списка — каждая деталь учтена и учтена ровно один раз (§39).
    const traced = calculation.bom.parts.flatMap((item) => item.sourcePartIds as readonly string[]);
    expect(new Set(traced).size).toBe(traced.length);
    expect(new Set(traced)).toEqual(new Set(partIds as readonly string[]));

    // ── Сохранение и восстановление ───────────────────────────────────────
    const restored = fromJson(toJson(project(s))).project;
    expect(restored.furniture[0]?.dimensions.width).toBe(1800);
    const restoredGeometry = buildGeometry({
      furniture: restored.furniture[0]!,
      scheme: restored.settings.construction,
      tolerances: restored.settings.tolerances,
      materials: restored.materials,
      edgeSizing: restored.settings.edgeSizing,
    });
    expect(restoredGeometry.parts).toHaveLength(result.parts.length);
    expect(restoredGeometry.cells).toHaveLength(result.cells.length);
  });

  it('отмена возвращает ровно один шаг на каждом этапе сценария', () => {
    const s = scenario();
    const run = s.getState().execute;

    run({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1400 }, 'Ширина');
    setSectionCount(s, 2, 'u');
    const cell = cells(s)[0]!.nodeId;
    run(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createShelvesLeaf(createSequentialIdFactory('sh'), 1).fill,
      },
      'Полки',
    );
    expect(shelves(s)).toBe(1);

    // Отмена снимает наполнение, но не деление и не габарит.
    s.getState().undo();
    expect(shelves(s)).toBe(0);
    expect(geometryOf(s).sections).toHaveLength(2);
    expect(project(s).furniture[0]?.dimensions.width).toBe(1400);

    // Ещё одна — снимает деление.
    s.getState().undo();
    expect(geometryOf(s).sections).toHaveLength(1);
    expect(project(s).furniture[0]?.dimensions.width).toBe(1400);

    // И последняя — габарит.
    s.getState().undo();
    expect(project(s).furniture[0]?.dimensions.width).not.toBe(1400);

    // Повтор возвращает всё обратно тем же порядком.
    s.getState().redo();
    s.getState().redo();
    s.getState().redo();
    expect(project(s).furniture[0]?.dimensions.width).toBe(1400);
    expect(geometryOf(s).sections).toHaveLength(2);
    expect(shelves(s)).toBe(1);
  });

  it('смена наполнения не оставляет деталей от прежнего', () => {
    // Ящики → полки: фасадов ящиков после этого быть не должно.
    const s = scenario();
    const run = s.getState().execute;
    const cell = cells(s)[0]!.nodeId;

    run(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createDrawersLeaf(createSequentialIdFactory('dr'), 3).fill,
      },
      'Ящики',
    );
    expect(facades(s)).toBeGreaterThan(0);

    run(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createShelvesLeaf(createSequentialIdFactory('sh'), 1).fill,
      },
      'Полки',
    );
    expect(facades(s)).toBe(0);
    expect(shelves(s)).toBe(1);
    // Ящиков не осталось и в боковинах/дне: удалено всё поддерево, а не фасад.
    expect(geometryOf(s).parts.some((part) => part.role.startsWith('drawer-'))).toBe(false);
  });
});
