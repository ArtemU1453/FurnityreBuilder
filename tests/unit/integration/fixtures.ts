import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { isSplit } from '../../../src/domain/index.js';
import {
  createDrawersLeaf,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { validateProductionReadiness } from '../../../src/workflow/index.js';
import { applyCommand } from '../../../src/state/commands.js';
import { produce } from 'immer';
import type { Command } from '../../../src/state/commands.js';
import type { GeometryResult } from '../../../src/geometry/index.js';
import type { NodeId, Project } from '../../../src/domain/index.js';
import type { ProductionCalculationResult } from '../../../src/bom/index.js';
import type { ProductionReadinessResult } from '../../../src/workflow/index.js';

/**
 * Детерминированные проекты для регрессии (PROMPT 30 §11).
 *
 * Идентификаторы последовательные, время фиксировано, случайности нет
 * нигде: два прогона обязаны дать побайтово один и тот же результат, и
 * именно это делает фикстуру регрессионной, а не «примером».
 *
 * Проекты собираются теми же командами, что и интерфейс: обходить
 * `applyCommand` значило бы проверять не то приложение, которым
 * пользуются.
 */

export function emptyProject(seed = 'f'): Project {
  return createProject({
    ids: createSequentialIdFactory(seed),
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

/** Выполнить команды поверх проекта — тем же путём, что и интерфейс. */
export function run(project: Project, commands: readonly Command[]): Project {
  return commands.reduce(
    (current, command) =>
      produce(current, (draft) => {
        applyCommand(draft, command);
      }),
    project,
  );
}

export function geometryOf(project: Project): GeometryResult {
  const furniture = project.furniture[0]!;
  return buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
}

export function productionOf(project: Project): ProductionCalculationResult {
  const furniture = project.furniture[0]!;
  return calculateProduction(project, {
    geometry: new Map([[furniture.id, geometryOf(project)]]),
  });
}

export function readinessOf(project: Project): ProductionReadinessResult {
  return validateProductionReadiness(project, { calculation: productionOf(project) });
}

// ── Фикстуры ────────────────────────────────────────────────────────────────

/** 1. Простой корпус: только каркас и задняя стенка. */
export function fixtureCarcass(): Project {
  return run(emptyProject('c'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 1800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 500 },
  ]);
}

/** 2. Корпус с полками. */
export function fixtureShelves(): Project {
  const project = fixtureCarcass();
  const cell = geometryOf(project).cells[0]!.nodeId;
  return run(project, [
    {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: cell,
      fill: createShelvesLeaf(createSequentialIdFactory('sh'), 3).fill,
    },
  ]);
}

/** 3. Секции с дверью. */
export function fixtureDoors(): Project {
  const base = run(emptyProject('d'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1600 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 },
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 2,
      splitId: 'd-split' as NodeId,
      newSectionIds: ['d-s1' as NodeId, 'd-s2' as NodeId],
      dividerThickness: 16,
    },
  ]);
  const cell = geometryOf(base).cells[0]!.nodeId;
  return run(base, [
    {
      type: 'AddFacade',
      furnitureIndex: 0,
      facade: createHingedFacade(createSequentialIdFactory('fa'), cell, 1),
    },
  ]);
}

/** 4. Секции с ящиками и ручками. */
export function fixtureDrawers(): Project {
  const base = run(emptyProject('w'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1200 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 900 },
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 2,
      splitId: 'w-split' as NodeId,
      newSectionIds: ['w-s1' as NodeId, 'w-s2' as NodeId],
      dividerThickness: 16,
    },
  ]);
  const cells = geometryOf(base).cells;
  return run(base, [
    {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: cells[0]!.nodeId,
      fill: createDrawersLeaf(createSequentialIdFactory('dr'), 3).fill,
    },
    {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: cells[1]!.nodeId,
      fill: createDrawersLeaf(createSequentialIdFactory('dq'), 2).fill,
    },
  ]);
}

/**
 * 5. Сложный производственный проект: сетка, полки, дверь, ящики,
 * задняя стенка, цоколь, кромка.
 */
export function fixtureComplex(): Project {
  const base = run(emptyProject('x'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 2400 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2200 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 600 },
    {
      type: 'SetRoot',
      furnitureIndex: 0,
      root: createUniformGrid(createSequentialIdFactory('g'), 3, 3, 16, 16),
    },
    {
      type: 'SetBackPanel',
      furnitureIndex: 0,
      patch: { mount: { kind: 'overlay', thickness: 4 } },
    },
    { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) },
    { type: 'SetEdgeSizingPolicy', policy: { subtractFromPartSize: true } },
  ]);

  const cells = geometryOf(base).cells;
  const shelfIds = createSequentialIdFactory('xs');
  const drawerIds = createSequentialIdFactory('xd');
  const commands: Command[] = [];
  cells.forEach((cell, index) => {
    if (index % 3 === 0) {
      commands.push({
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell.nodeId,
        fill: createShelvesLeaf(shelfIds, 2).fill,
      });
    } else if (index % 3 === 1) {
      commands.push({
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell.nodeId,
        fill: createDrawersLeaf(drawerIds, 2).fill,
      });
    }
  });

  const filled = run(base, commands);
  const doorCell = geometryOf(filled).cells[2]!.nodeId;
  return run(filled, [
    {
      type: 'AddFacade',
      furnitureIndex: 0,
      facade: createHingedFacade(createSequentialIdFactory('xf'), doorCell, 1),
    },
  ]);
}

/**
 * Приёмочная фикстура «Секции» (PROMPT 35 §4).
 *
 * Несколько секций НЕРАВНОЙ ширины: равные секции проверяются
 * `fixtureShelves`, а неравные — отдельный случай, потому что в них
 * работает `SizeSpec.fixed` и раскладка остатка, а не деление поровну.
 */
export function fixtureSections(): Project {
  const ids = createSequentialIdFactory('sec');
  const base = run(emptyProject('sec'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 },
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: ids.next<'Node'>(),
      newSectionIds: [ids.next<'Node'>(), ids.next<'Node'>(), ids.next<'Node'>()],
      dividerThickness: 16,
    },
  ]);

  // Ширины: 500 фиксированная, 700 фиксированная, третья забирает остаток.
  const root = base.furniture[0]!.root;
  const children = isSplit(root) ? root.children : [];
  return run(
    base,
    children.slice(0, 2).map((child, index) => ({
      type: 'SetChildSize' as const,
      furnitureIndex: 0,
      childId: child.node.id,
      size: { mode: 'fixed' as const, value: index === 0 ? 500 : 700 },
    })),
  );
}

/**
 * Приёмочная фикстура «Нагрузка» (PROMPT 35 §4).
 *
 * Сетка 5 × 4 с наполнением в каждой ячейке — двадцать ячеек против
 * девяти у `fixtureComplex`. Нужна не ради «побольше», а чтобы проверить
 * то, что на малом проекте не проявляется: устойчивость идентификаторов
 * при десятках объектов, отсутствие дублей в спецификации и поведение
 * раскроя, когда деталей больше, чем помещается на один лист.
 *
 * Ширина 2400, а не 3000, намеренно. При 3000 горизонтали изделия дают
 * 2968 мм против рабочей ширины листа 2730 — и раскрой честно отказывает
 * ВОСЬМИ деталям сразу. Отказ верный, но тогда фикстура проверяла бы
 * путь «деталь больше листа», который уже закреплён `fixtureComplex`, а
 * не то, ради чего заведена: поведение конвейера на десятках деталей.
 * Фикстура должна нагружать то, что обещает.
 */
export function fixtureStress(): Project {
  const base = run(emptyProject('st'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 2400 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2400 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 550 },
    {
      type: 'SetRoot',
      furnitureIndex: 0,
      root: createUniformGrid(createSequentialIdFactory('sg'), 5, 4, 16, 16),
    },
    { type: 'SetBackPanel', furnitureIndex: 0, patch: { mount: { kind: 'overlay', thickness: 4 } } },
    { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(100) },
  ]);

  const shelfIds = createSequentialIdFactory('ss');
  const drawerIds = createSequentialIdFactory('sd');
  const commands: Command[] = geometryOf(base).cells.map((cell, index) => ({
    type: 'SetFill' as const,
    furnitureIndex: 0,
    nodeId: cell.nodeId,
    fill:
      index % 2 === 0
        ? createShelvesLeaf(shelfIds, 3).fill
        : createDrawersLeaf(drawerIds, 2).fill,
  }));

  const filled = run(base, commands);
  const facadeIds = createSequentialIdFactory('sf');
  // Двери на ячейки с полками: на ячейку с ящиками дверь ставить нельзя.
  const doorCells = geometryOf(filled)
    .cells.filter((_, index) => index % 2 === 0)
    .slice(0, 4);
  return run(
    filled,
    doorCells.map((cell) => ({
      type: 'AddFacade' as const,
      furnitureIndex: 0,
      facade: createHingedFacade(facadeIds, cell.nodeId, 1),
    })),
  );
}

export const FIXTURES = {
  carcass: fixtureCarcass,
  sections: fixtureSections,
  shelves: fixtureShelves,
  doors: fixtureDoors,
  drawers: fixtureDrawers,
  complex: fixtureComplex,
  stress: fixtureStress,
} as const;

export type FixtureName = keyof typeof FIXTURES;
