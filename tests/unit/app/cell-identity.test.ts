import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { cellName, cellNames, sectionName } from '../../../src/app/editor/cell-identity.js';
import { createProject, createRandomIdFactory, createUniformGrid } from '../../../src/domain/index.js';
import { applyCommand } from '../../../src/state/index.js';
import { buildGeometry } from '../../../src/geometry/index.js';
import type { Project } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/index.js';

/**
 * Человекочитаемое имя ячейки (PROMPT 54 §7, §10).
 *
 * Дефект, ради которого модуль появился: селектор шага «Фасады»
 * перечислял ячейки строкой
 * `184c6b41-fb86-42ab-b1d4-b5716ca6a0a0 (578.7 × 2168)`, а три ячейки
 * одного шкафа отличались только UUID.
 *
 * Проверяется не текст ради текста, а два свойства: имя различает
 * соседей и НЕ содержит идентификатора.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sections(count: number): Project {
  const ids = createRandomIdFactory();
  const project = createProject({ name: 'Имена' });
  const next = produce(project, (draft) => {
    applyCommand(draft, {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count,
      splitId: ids.next<'Node'>(),
      newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
      dividerThickness: 16,
    });
  });
  return next;
}

function grid(rows: number, columns: number): Project {
  const ids = createRandomIdFactory();
  const project = createProject({ name: 'Сетка' });
  const next = produce(project, (draft) => {
    applyCommand(draft, {
      type: 'SetRoot',
      furnitureIndex: 0,
      root: createUniformGrid(ids, rows, columns, 16, 16),
    });
  });
  return next;
}

const geo = (project: Project): GeometryResult =>
  buildGeometry({
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });

describe('имя ячейки', () => {
  it('единственная ячейка неделёного изделия не нуждается ни в номере, ни в координате', () => {
    const g = geo(createProject({ name: 'Пустой' }));
    expect(g.cells).toHaveLength(1);
    expect(cellName(g.cells[0]!.nodeId, g)).toBe('Всё внутреннее пространство');
  });

  it('три секции — три РАЗНЫХ имени, и ни в одном нет идентификатора', () => {
    const g = geo(sections(3));
    const names = g.cells.map((cell) => cellName(cell.nodeId, g));
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).not.toMatch(UUID);
    expect(names).toContain('Секция 1');
    expect(names).toContain('Секция 3');
  });

  it('ряды считаются СВЕРХУ: «ряд 1» — самая верхняя ячейка, а не самая нижняя', () => {
    const g = geo(grid(3, 1));
    expect(g.cells).toHaveLength(3);
    const highest = [...g.cells].sort((a, b) => b.box.min.y - a.box.min.y)[0]!;
    const lowest = [...g.cells].sort((a, b) => a.box.min.y - b.box.min.y)[0]!;
    expect(cellName(highest.nodeId, g)).toBe('Ряд 1');
    expect(cellName(lowest.nodeId, g)).toBe('Ряд 3');
  });

  it('одна строка из трёх колонок — это ТРИ СЕКЦИИ, а не три колонки', () => {
    // Верхнее деление по оси X и есть деление на секции
    // (`sectionIdFor` в `stages/layout.ts`). Имя обязано повторять
    // модель, а не вводить рядом второе слово для того же самого.
    const g = geo(grid(1, 3));
    expect(g.sections).toHaveLength(3);
    const leftmost = [...g.cells].sort((a, b) => a.box.min.x - b.box.min.x)[0]!;
    const rightmost = [...g.cells].sort((a, b) => b.box.min.x - a.box.min.x)[0]!;
    expect(cellName(leftmost.nodeId, g)).toBe('Секция 1');
    expect(cellName(rightmost.nodeId, g)).toBe('Секция 3');
  });

  it('колонки считаются слева там, где они действительно колонки внутри ряда', () => {
    const g = geo(grid(2, 3));
    const topRow = [...g.cells]
      .filter((cell) => cell.box.min.y === Math.max(...g.cells.map((c) => c.box.min.y)))
      .sort((a, b) => a.box.min.x - b.box.min.x);
    expect(topRow).toHaveLength(3);
    expect(cellName(topRow[0]!.nodeId, g)).toBe('Ряд 1 · колонка 1');
    expect(cellName(topRow[2]!.nodeId, g)).toBe('Ряд 1 · колонка 3');
  });

  it('сетка называет и ряд, и колонку — иначе шесть ячеек делятся на три пары одинаковых', () => {
    const g = geo(grid(2, 3));
    const names = g.cells.map((cell) => cellName(cell.nodeId, g));
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
    for (const name of names) expect(name).toMatch(/ряд \d+ · колонка \d+/i);
  });

  it('имя не называет того, чего нет: у одной секции слова «секция» в имени нет', () => {
    const g = geo(grid(3, 1));
    for (const cell of g.cells) expect(cellName(cell.nodeId, g)).not.toContain('Секция');
  });

  it('несуществующая ячейка не роняет имя', () => {
    const g = geo(sections(2));
    const ids = createRandomIdFactory();
    expect(cellName(ids.next<'Node'>(), g)).toBe('Ячейка');
  });

  it('cellNames покрывает каждую ячейку геометрии и совпадает с cellName', () => {
    const g = geo(sections(4));
    const map = cellNames(g);
    expect(map.size).toBe(g.cells.length);
    for (const cell of g.cells) expect(map.get(cell.nodeId)).toBe(cellName(cell.nodeId, g));
  });
});

describe('имя секции', () => {
  it('секции нумеруются слева направо', () => {
    const g = geo(sections(3));
    const ordered = [...g.sections].sort((a, b) => a.box.min.x - b.box.min.x);
    expect(sectionName(ordered[0]!.nodeId, g)).toBe('Секция 1');
    expect(sectionName(ordered[2]!.nodeId, g)).toBe('Секция 3');
  });

  it('несуществующая секция не роняет имя', () => {
    const g = geo(sections(2));
    const ids = createRandomIdFactory();
    expect(sectionName(ids.next<'Node'>(), g)).toBe('Секция');
  });
});
