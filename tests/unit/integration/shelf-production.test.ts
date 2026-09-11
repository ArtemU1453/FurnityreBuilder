import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawersLeaf } from '../../../src/domain/furniture/defaults.js';
import { findNode } from '../../../src/domain/index.js';
import {
  acceptsShelfCount,
  makeShelvesFill,
  shelfCountFill,
  shelfCountOf,
} from '../../../src/app/editor/shelf-model.js';
import { emptyProject, geometryOf, productionOf, run } from './fixtures.js';
import type { LeafFill, NodeId, Project } from '../../../src/domain/index.js';

/**
 * FR-08 — производственные последствия одной модели полок
 * (PROMPT 60 §10, §13).
 *
 * Задание требует не верить, что «объединение только в интерфейсе»
 * безопасно. Здесь оба пути прогоняются ЧЕРЕЗ ВЕСЬ конвейер — геометрия,
 * деталировка, кромка, раскрой, фурнитура — и результаты сверяются
 * между собой. Идентификаторы полок у путей разные (каждая команда
 * создаёт новые `Shelf`), поэтому сверяется то, что уходит в
 * производство: состав, размеры, количества.
 */

/** Корпус с тремя секциями — деление нужно, чтобы ячейка была отдельным узлом. */
function carcass(seed: string): Project {
  const ids = createSequentialIdFactory(`${seed}-n`);
  return run(emptyProject(seed), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 500 },
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: ids.next<'Node'>(),
      newSectionIds: [ids.next<'Node'>(), ids.next<'Node'>(), ids.next<'Node'>()],
      dividerThickness: 16,
    },
  ]);
}

function cellId(project: Project): NodeId {
  return geometryOf(project).cells[0]!.nodeId;
}

function fillOf(project: Project, nodeId: NodeId): LeafFill {
  const node = findNode(project.furniture[0]!.root, nodeId);
  return node?.kind === 'leaf' ? node.fill : { kind: 'empty' };
}

/** Отправить наполнение той же командой, что и интерфейс. */
function setFill(project: Project, nodeId: NodeId, fill: LeafFill | undefined): Project {
  if (fill === undefined) return project;
  return run(project, [{ type: 'SetFill', furnitureIndex: 0, nodeId, fill }]);
}

/** То, что уходит в производство, без идентификаторов. */
function productionShape(project: Project): unknown {
  const result = productionOf(project);
  return {
    status: result.status,
    parts: result.bom.parts
      .map((part) => ({
        type: part.partType,
        category: part.category,
        material: part.materialName,
        thickness: part.thickness,
        length: part.length,
        width: part.width,
        quantity: part.quantity,
        edge: part.edgeBanding,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    edgeBanding: result.bom.edgeBanding
      .map((band) => ({ name: band.materialName, length: band.lengthMm, sides: band.sideCount }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    cutting: {
      stockCount: result.bom.cutting.stockCount,
      placedParts: result.bom.cutting.placedParts,
      unplacedParts: result.bom.cutting.unplacedParts,
      usedArea: result.bom.cutting.usedArea,
    },
    hardware: result.hardware.lines
      .map((line) => ({ kind: line.kind, name: line.name, quantity: line.quantity }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    drilling: result.bom.drilling,
  };
}

describe('FR-08 — оба входа приводят к одному состоянию модели (§13)', () => {
  /**
   * Путь 1 — кнопка у изделия «Добавить полки» (0 → 1), затем поле шага
   * «Полки» (1 → 3). Путь 2 — сразу поле шага (0 → 3).
   */
  it('«сделать полочным» + число даёт то же, что одно только число', () => {
    const viaAction = ((): Project => {
      const base = carcass('p1');
      const node = cellId(base);
      const step1 = setFill(base, node, makeShelvesFill(createSequentialIdFactory('p1a'), fillOf(base, node)));
      return setFill(step1, node, shelfCountFill(createSequentialIdFactory('p1b'), fillOf(step1, node), 3));
    })();

    const viaCount = ((): Project => {
      const base = carcass('p1');
      const node = cellId(base);
      return setFill(base, node, shelfCountFill(createSequentialIdFactory('p2'), fillOf(base, node), 3));
    })();

    expect(shelfCountOf(fillOf(viaAction, cellId(viaAction)))).toBe(3);
    expect(shelfCountOf(fillOf(viaCount, cellId(viaCount)))).toBe(3);
    expect(fillOf(viaAction, cellId(viaAction)).kind).toBe(fillOf(viaCount, cellId(viaCount)).kind);
  });

  it('геометрия полок от пути не зависит (§11)', () => {
    const shape = (project: Project): unknown =>
      geometryOf(project)
        .parts.filter((part) => part.role === 'shelf-adjustable' || part.role === 'shelf-fixed')
        .map((part) => ({
          role: part.role,
          size: part.size,
          position: part.position,
          cut: part.cut,
          edge: part.edge,
        }));

    const base = carcass('g');
    const node = cellId(base);
    const viaAction = ((): Project => {
      const step1 = setFill(base, node, makeShelvesFill(createSequentialIdFactory('ga'), fillOf(base, node)));
      return setFill(step1, node, shelfCountFill(createSequentialIdFactory('gb'), fillOf(step1, node), 4));
    })();
    const viaCount = setFill(base, node, shelfCountFill(createSequentialIdFactory('gc'), fillOf(base, node), 4));

    expect(shape(viaAction)).toEqual(shape(viaCount));
    expect(shape(viaCount)).toHaveLength(4);
  });

  it('деталировка, кромка, раскрой и фурнитура совпадают у обоих путей (§10)', () => {
    const base = carcass('pr');
    const node = cellId(base);
    const viaAction = ((): Project => {
      const step1 = setFill(base, node, makeShelvesFill(createSequentialIdFactory('pa'), fillOf(base, node)));
      return setFill(step1, node, shelfCountFill(createSequentialIdFactory('pb'), fillOf(step1, node), 3));
    })();
    const viaCount = setFill(base, node, shelfCountFill(createSequentialIdFactory('pc'), fillOf(base, node), 3));

    expect(productionShape(viaAction)).toEqual(productionShape(viaCount));
  });
});

describe('FR-08 — количество и производство (§10)', () => {
  it('каждая полка — деталь в деталировке: N полок дают N строк раскроя', () => {
    const base = carcass('n');
    const node = cellId(base);
    for (const count of [1, 2, 5]) {
      const project = setFill(base, node, shelfCountFill(createSequentialIdFactory(`n${String(count)}`), fillOf(base, node), count));
      const shelves = geometryOf(project).parts.filter(
        (part) => part.role === 'shelf-adjustable' || part.role === 'shelf-fixed',
      );
      expect(shelves).toHaveLength(count);
      const placed = productionOf(project).bom.parts
        .filter((part) => part.sourcePartIds.some((id) => shelves.some((shelf) => shelf.id === id)))
        .reduce((sum, part) => sum + part.quantity, 0);
      expect(placed).toBe(count);
    }
  });

  it('N → 0 убирает полки из деталировки целиком', () => {
    const base = carcass('z');
    const node = cellId(base);
    const filled = setFill(base, node, shelfCountFill(createSequentialIdFactory('za'), fillOf(base, node), 3));
    const cleared = setFill(filled, node, shelfCountFill(createSequentialIdFactory('zb'), fillOf(filled, node), 0));

    expect(fillOf(cleared, node).kind).toBe('empty');
    expect(
      geometryOf(cleared).parts.filter(
        (part) => part.role === 'shelf-adjustable' || part.role === 'shelf-fixed',
      ),
    ).toHaveLength(0);
    expect(productionShape(cleared)).toEqual(productionShape(base));
  });

  /**
   * §18 E. До FR-08 поле шага «Полки» показывало `0` на отделении с
   * ящиком, и ввод числа заменял ящик полками — фасад ящика исчезал из
   * деталировки молча. Проверяется не «кнопка скрыта», а то, что
   * производственный результат не изменился.
   */
  it('правка числа полок не трогает отделение с ящиком: производство не меняется', () => {
    const base = carcass('d');
    const node = cellId(base);
    const withDrawers = setFill(base, node, createDrawersLeaf(createSequentialIdFactory('dw'), 2).fill);
    const before = productionShape(withDrawers);

    expect(acceptsShelfCount(fillOf(withDrawers, node))).toBe(false);
    const attempted = shelfCountFill(createSequentialIdFactory('dx'), fillOf(withDrawers, node), 2);
    expect(attempted).toBeUndefined();

    const after = setFill(withDrawers, node, attempted);
    expect(fillOf(after, node).kind).toBe('drawers');
    expect(shelfCountOf(fillOf(after, node))).toBe(0);
    expect(productionShape(after)).toEqual(before);
    // Фасады ящиков на месте: именно они пропадали молча.
    expect(
      geometryOf(after).parts.filter((part) => part.role === 'facade'),
    ).toHaveLength(geometryOf(withDrawers).parts.filter((part) => part.role === 'facade').length);
    expect(geometryOf(after).parts.some((part) => part.role === 'facade')).toBe(true);
  });
});
