import { describe, expect, it } from 'vitest';
import {
  constructionOverview,
  describeOverview,
} from '../../../src/app/editor/construction-overview.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createDrawersLeaf,
  createHingedFacade,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { applyCommand } from '../../../src/state/commands.js';
import { produce } from 'immer';
import type { Command } from '../../../src/state/commands.js';
import type { NodeId, Project } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/index.js';

/**
 * Обзор изделия — содержимое шага 10 (PROMPT 64, FR-10).
 *
 * Проверяется РАЗБОР, а не вёрстка: что считается занятым, что открытым
 * и как это произносится. Шаг 10 отвечает на вопрос конструктора, и
 * ни одной производственной величины здесь нет.
 */

function run(project: Project, commands: readonly Command[]): Project {
  return commands.reduce(
    (current, command) =>
      produce(current, (draft) => {
        applyCommand(draft, command);
      }),
    project,
  );
}

function geometryOf(project: Project): GeometryResult {
  const furniture = project.furniture[0]!;
  return buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
}

const empty = (seed = 'o'): Project =>
  createProject({ ids: createSequentialIdFactory(seed), now: () => '2026-01-01T00:00:00.000Z' });

/** Корпус, разделённый на три секции. */
function threeSections(seed = 'o'): Project {
  const ids = createSequentialIdFactory(`${seed}-n`);
  return run(empty(seed), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2200 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 600 },
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

const overviewOf = (project: Project) =>
  constructionOverview(project.furniture[0], geometryOf(project));

describe('состав изделия', () => {
  it('без изделия обзора нет — и это не пустой обзор, а его отсутствие', () => {
    expect(constructionOverview(undefined, undefined)).toBeUndefined();
    expect(constructionOverview(empty().furniture[0], undefined)).toBeUndefined();
  });

  it('пустой корпус: одно отделение, ничего не занято и ничем не закрыто', () => {
    const view = overviewOf(empty());
    expect(view?.cells).toBe(1);
    expect(view?.filled).toBe(0);
    expect(view?.empty).toHaveLength(1);
    expect(view?.open).toHaveLength(1);
    expect(view?.facades).toBe(0);
    expect(view?.complete).toBe(false);
  });

  it('три секции — три отделения, все пока открыты', () => {
    const view = overviewOf(threeSections());
    expect(view?.sections).toBe(3);
    expect(view?.cells).toBe(3);
    expect(view?.empty).toHaveLength(3);
    expect(view?.open).toHaveLength(3);
  });

  it('наполненное отделение считается занятым и исчезает из пустых', () => {
    const base = threeSections('f');
    const cell = geometryOf(base).cells[0]!.nodeId;
    const filled = run(base, [
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createShelvesLeaf(createSequentialIdFactory('sh'), 4).fill,
      },
    ]);
    const view = overviewOf(filled);
    expect(view?.filled).toBe(1);
    expect(view?.empty).toHaveLength(2);
    expect(view?.empty.map((spot) => spot.nodeId)).not.toContain(cell);
  });

  it('ящик — тоже наполнение: отделение занято', () => {
    const base = threeSections('d');
    const cell = geometryOf(base).cells[0]!.nodeId;
    const filled = run(base, [
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cell,
        fill: createDrawersLeaf(createSequentialIdFactory('dr'), 1).fill,
      },
    ]);
    expect(overviewOf(filled)?.filled).toBe(1);
  });

  it('дверь закрывает отделение: оно уходит из открытых', () => {
    const base = threeSections('c');
    const cell = geometryOf(base).cells[0]!.nodeId;
    const closed = run(base, [
      {
        type: 'AddFacade',
        furnitureIndex: 0,
        facade: createHingedFacade(createSequentialIdFactory('fa'), cell, 1),
      },
    ]);
    const view = overviewOf(closed);
    expect(view?.facades).toBe(1);
    expect(view?.open).toHaveLength(2);
    expect(view?.open.map((spot) => spot.nodeId)).not.toContain(cell);
  });

  /**
   * Пустое и открытое — два РАЗНЫХ решения: что положить внутрь и чем
   * закрыть снаружи. Отделение может быть в обоих списках сразу.
   */
  it('пустое и открытое — разные списки, и они пересекаются', () => {
    const view = overviewOf(threeSections('x'));
    expect(view?.empty.map((s) => s.nodeId)).toEqual(view?.open.map((s) => s.nodeId));
  });

  it('отделения названы словами, а не идентификаторами', () => {
    const view = overviewOf(threeSections('n'));
    for (const spot of view?.empty ?? []) {
      expect(spot.name).toMatch(/^Секция \d$/);
      expect(spot.name).not.toContain('-');
    }
  });

  it('всё занято и всё закрыто — дополнять нечего', () => {
    let project = threeSections('k');
    const shelfIds = createSequentialIdFactory('ks');
    const facadeIds = createSequentialIdFactory('kf');
    for (const cell of geometryOf(project).cells) {
      project = run(project, [
        {
          type: 'SetFill',
          furnitureIndex: 0,
          nodeId: cell.nodeId,
          fill: createShelvesLeaf(shelfIds, 2).fill,
        },
      ]);
    }
    for (const cell of geometryOf(project).cells) {
      project = run(project, [
        {
          type: 'AddFacade',
          furnitureIndex: 0,
          facade: createHingedFacade(facadeIds, cell.nodeId, 1),
        },
      ]);
    }
    const view = overviewOf(project);
    expect(view?.empty).toHaveLength(0);
    expect(view?.open).toHaveLength(0);
    expect(view?.complete).toBe(true);
  });
});

describe('describeOverview — тон утвердительный, а не укоризненный', () => {
  it('незавершённость названа решением, а не ошибкой', () => {
    const text = describeOverview({
      sections: 3,
      cells: 3,
      parts: 10,
      empty: [{ nodeId: 'a' as NodeId, name: 'Секция 1' }],
      open: [
        { nodeId: 'a' as NodeId, name: 'Секция 1' },
        { nodeId: 'b' as NodeId, name: 'Секция 2' },
      ],
      filled: 2,
      facades: 1,
      complete: false,
    });
    expect(text).toEqual([
      '1 отделение без наполнения — останутся открытыми нишами',
      '2 отделения без фасада — останутся открытыми',
    ]);
    // Слова «ошибка» здесь нет и быть не должно: открытая ниша — мебель.
    for (const line of text) expect(line).not.toMatch(/ошиб|не забудь|нужно исправ/i);
  });

  it('склонение по числу, а не «3 отделение»', () => {
    const of = (n: number): string =>
      describeOverview({
        sections: 1,
        cells: n,
        parts: 0,
        empty: Array.from({ length: n }, (_, i) => ({
          nodeId: String(i) as NodeId,
          name: `Секция ${String(i + 1)}`,
        })),
        open: [],
        filled: 0,
        facades: 0,
        complete: false,
      })[0] ?? '';
    expect(of(1)).toContain('1 отделение');
    expect(of(2)).toContain('2 отделения');
    expect(of(5)).toContain('5 отделений');
    expect(of(11)).toContain('11 отделений');
    expect(of(21)).toContain('21 отделение');
  });

  it('когда всё закрыто — говорить не о чем', () => {
    expect(
      describeOverview({
        sections: 1,
        cells: 1,
        parts: 5,
        empty: [],
        open: [],
        filled: 1,
        facades: 1,
        complete: true,
      }),
    ).toEqual([]);
  });
});
