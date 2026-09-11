import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  describeDivide,
  divideCommands,
  divideEffect,
  losesCellWork,
} from '../../../src/app/editor/divide-cell.js';
import { createProject, createRandomIdFactory } from '../../../src/domain/index.js';
import { applyCommand } from '../../../src/state/index.js';
import { buildGeometry } from '../../../src/geometry/index.js';
import type { Command } from '../../../src/state/index.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * FR-02: деление отделения не должно уничтожать конструкцию (PROMPT 55 §5, §12).
 *
 * Дефект, ради которого модуль появился, измерен на собранном
 * приложении: 7 деталей / 3 секции / 2 перегородки → 5 / 1 / 0 после
 * действия по умолчанию следующего шага. Здесь он воспроизводится на
 * модели — без браузера и без клика, поэтому регрессия ловится раньше и
 * дешевле.
 */

const run = (project: Project, commands: readonly Command[]): Project =>
  produce(project, (draft) => {
    for (const command of commands) applyCommand(draft, command);
  });

function withSections(count: number): Project {
  const ids = createRandomIdFactory();
  return produce(createProject({ name: 'FR-02' }), (draft) => {
    applyCommand(draft, {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count,
      splitId: ids.next<'Node'>(),
      newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
      dividerThickness: 16,
    });
  });
}

const shape = (project: Project) => {
  const furniture = project.furniture[0]!;
  const g = buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
  return {
    parts: g.parts.length,
    sections: g.sections.length,
    partitions: g.parts.filter((p) => p.role === 'partition').length,
    cells: g.cells.length,
    // Полки наполнения — съёмные; горизонтальный разделитель между
    // рядами тоже деталь с ролью «полка», но неподвижная, и к обещанию
    // «полок в каждой ячейке» отношения не имеет.
    shelves: g.parts.filter((p) => p.role === 'shelf-adjustable').length,
    dividerShelves: g.parts.filter((p) => p.role === 'shelf-fixed').length,
    width: furniture.dimensions.width,
    height: furniture.dimensions.height,
  };
};

describe('деление отделения сохраняет конструкцию', () => {
  it('исходный дефект: три секции, два разделителя — и они остаются', () => {
    const before = withSections(3);
    const beforeShape = shape(before);
    expect(beforeShape).toMatchObject({ parts: 7, sections: 3, partitions: 2, cells: 3 });

    // Действие по умолчанию шага «Ячейки» — деление ВЫБРАННОГО отделения.
    const g = buildGeometry({
      furniture: before.furniture[0]!,
      scheme: before.settings.construction,
      tolerances: before.settings.tolerances,
      materials: before.materials,
      edgeSizing: before.settings.edgeSizing,
    });
    const target = g.cells[0]!.nodeId;
    const after = run(
      before,
      divideCommands(before.furniture[0], { nodeId: target, rows: 1, columns: 1, shelves: 0 }, createRandomIdFactory()),
    );

    const afterShape = shape(after);
    expect(afterShape.sections).toBe(3);
    expect(afterShape.partitions).toBe(2);
    expect(afterShape.parts).toBe(7);
    expect(afterShape.width).toBe(beforeShape.width);
    expect(afterShape.height).toBe(beforeShape.height);
  });

  it('деление на 3 ряда добавляет ряды и НЕ трогает соседние секции', () => {
    const before = withSections(3);
    const g = buildGeometry({
      furniture: before.furniture[0]!,
      scheme: before.settings.construction,
      tolerances: before.settings.tolerances,
      materials: before.materials,
      edgeSizing: before.settings.edgeSizing,
    });
    const target = g.cells[1]!.nodeId;
    const untouched = [g.cells[0]!.nodeId, g.cells[2]!.nodeId];

    const after = run(
      before,
      divideCommands(before.furniture[0], { nodeId: target, rows: 3, columns: 1, shelves: 0 }, createRandomIdFactory()),
    );
    const afterShape = shape(after);

    expect(afterShape.sections).toBe(3);
    expect(afterShape.partitions).toBe(2);
    // Одно отделение из трёх стало тремя: ячеек 3 → 5.
    expect(afterShape.cells).toBe(5);

    // Соседние отделения — те же узлы, с теми же идентификаторами.
    const afterGeometry = buildGeometry({
      furniture: after.furniture[0]!,
      scheme: after.settings.construction,
      tolerances: after.settings.tolerances,
      materials: after.materials,
      edgeSizing: after.settings.edgeSizing,
    });
    const ids = new Set(afterGeometry.cells.map((c) => c.nodeId));
    for (const id of untouched) expect(ids.has(id)).toBe(true);
  });

  it('полки задаются в КАЖДОЙ получившейся ячейке', () => {
    const before = createProject({ name: 'Полки' });
    const g = buildGeometry({
      furniture: before.furniture[0]!,
      scheme: before.settings.construction,
      tolerances: before.settings.tolerances,
      materials: before.materials,
      edgeSizing: before.settings.edgeSizing,
    });
    const after = run(
      before,
      divideCommands(
        before.furniture[0],
        { nodeId: g.cells[0]!.nodeId, rows: 2, columns: 2, shelves: 1 },
        createRandomIdFactory(),
      ),
    );
    const afterShape = shape(after);
    expect(afterShape.cells).toBe(4);
    expect(afterShape.shelves).toBe(4);
    // Плюс один неподвижный разделитель между двумя рядами.
    expect(afterShape.dividerShelves).toBe(1);
  });

  it('сетка 2×3 внутри секции даёт шесть ячеек, а не заменяет изделие', () => {
    const before = withSections(2);
    const g = buildGeometry({
      furniture: before.furniture[0]!,
      scheme: before.settings.construction,
      tolerances: before.settings.tolerances,
      materials: before.materials,
      edgeSizing: before.settings.edgeSizing,
    });
    const after = run(
      before,
      divideCommands(
        before.furniture[0],
        { nodeId: g.cells[0]!.nodeId, rows: 2, columns: 3, shelves: 0 },
        createRandomIdFactory(),
      ),
    );
    const afterShape = shape(after);
    expect(afterShape.sections).toBe(2);
    // Одна из двух ячеек стала шестью: 2 → 1 + 6 = 7.
    expect(afterShape.cells).toBe(7);
  });

  it('несуществующее отделение не порождает ни одной команды', () => {
    const project = withSections(2);
    const ids = createRandomIdFactory();
    expect(
      divideCommands(project.furniture[0], { nodeId: ids.next<'Node'>(), rows: 2, columns: 2, shelves: 0 }, ids),
    ).toHaveLength(0);
  });

  it('изделия нет — команд нет и падать не на чем', () => {
    expect(
      divideCommands(undefined, { nodeId: createRandomIdFactory().next<'Node'>(), rows: 2, columns: 1, shelves: 0 }, createRandomIdFactory()),
    ).toHaveLength(0);
  });
});

describe('что деление заменит', () => {
  const cellOf = (project: Project, index = 0) =>
    buildGeometry({
      furniture: project.furniture[0]!,
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    }).cells[index]!.nodeId;

  it('1 × 1 без полок не делает ничего — действие незачем предлагать', () => {
    const project = withSections(3);
    const effect = divideEffect(project.furniture[0], {
      nodeId: cellOf(project),
      rows: 1,
      columns: 1,
      shelves: 0,
    });
    expect(effect.noop).toBe(true);
    expect(losesCellWork(effect)).toBe(false);
    expect(describeDivide(effect)).toBe('');
  });

  it('пустое отделение делится без потерь — вопроса не будет', () => {
    const project = withSections(3);
    const effect = divideEffect(project.furniture[0], {
      nodeId: cellOf(project),
      rows: 3,
      columns: 1,
      shelves: 0,
    });
    expect(effect.noop).toBe(false);
    expect(losesCellWork(effect)).toBe(false);
  });

  it('повторное деление уже делённого отделения заменяет его устройство — и говорит об этом', () => {
    const project = withSections(2);
    const target = cellOf(project);
    const divided = run(
      project,
      divideCommands(project.furniture[0], { nodeId: target, rows: 3, columns: 1, shelves: 0 }, createRandomIdFactory()),
    );
    const effect = divideEffect(divided.furniture[0], { nodeId: target, rows: 2, columns: 2, shelves: 0 });
    expect(effect.replacesSplit).toBe(true);
    expect(losesCellWork(effect)).toBe(true);
    expect(describeDivide(effect)).toContain('деление');
  });

  it('деление занятого отделения заменяет его наполнение — и говорит об этом', () => {
    const project = createProject({ name: 'Занято' });
    const target = cellOf(project);
    const filled = run(
      project,
      divideCommands(project.furniture[0], { nodeId: target, rows: 1, columns: 1, shelves: 2 }, createRandomIdFactory()),
    );
    const effect = divideEffect(filled.furniture[0], { nodeId: target, rows: 2, columns: 1, shelves: 0 });
    expect(effect.replacesFill).toBe(true);
    expect(describeDivide(effect)).toContain('стоит');
  });

  it('задание числа полок потерей не считается: это обычная правка наполнения', () => {
    const project = createProject({ name: 'Полки' });
    const target = cellOf(project);
    const filled = run(
      project,
      divideCommands(project.furniture[0], { nodeId: target, rows: 1, columns: 1, shelves: 2 }, createRandomIdFactory()),
    );
    const effect = divideEffect(filled.furniture[0], { nodeId: target, rows: 1, columns: 1, shelves: 5 });
    expect(losesCellWork(effect)).toBe(false);
  });
});
