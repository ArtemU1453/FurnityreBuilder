import { describe, expect, it } from 'vitest';
import { describeSelection, resolveSelection } from '../../../src/app/editor/selection.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawersLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { Furniture, LeafFill, NodeId, PartId, Project } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/index.js';

/**
 * Разбор выделения и модель инспектора (PROMPT 22 §5, §6, §12).
 *
 * Инспектор не считает мебель: он сопоставляет идентификатор с уже
 * посчитанным объектом. Здесь проверяется именно сопоставление и набор
 * доступных действий — то, что задание §12 требует делать зависимым от
 * состояния ячейки, а не показывать всегда.
 */

function scene(fill?: LeafFill): { project: Project; furniture: Furniture; geometry: GeometryResult } {
  const project = createProject({
    ids: createSequentialIdFactory('t'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  let furniture = project.furniture[0]!;
  if (fill !== undefined) {
    furniture = { ...furniture, root: { ...(furniture.root as { kind: 'leaf' }), fill } as typeof furniture.root };
  }
  const geometry = buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
  return { project, furniture, geometry };
}

/**
 * Изделие из нескольких секций, одна из которых поделена на ряды.
 *
 * Деление обязательно: секция БЕЗ деления — это одновременно и ячейка, тот
 * же узел дерева. Отдельным объектом секция становится ровно тогда, когда
 * внутри неё появляются собственные ячейки, и только тогда выбор секции
 * отличим от выбора ячейки.
 */
function sections(count: number): { project: Project; furniture: Furniture; geometry: GeometryResult } {
  const store = createDocumentStore(
    createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' }),
  );
  const ids = createSequentialIdFactory('sec');
  store.getState().execute({
    type: 'SetSectionCount',
    furnitureIndex: 0,
    count,
    splitId: ids.next<'Node'>(),
    newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
    dividerThickness: 16,
  });
  const split = store.getState().project.furniture[0]!.root;
  const target = split.kind === 'split' ? split.children[1]!.node.id : split.id;
  store.getState().execute({
    type: 'SplitNode',
    furnitureIndex: 0,
    nodeId: target,
    axis: 'y',
    childIds: [ids.next<'Node'>(), ids.next<'Node'>()],
    dividerThickness: 16,
  });
  const project = store.getState().project;
  const furniture = project.furniture[0]!;
  const geometry = buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
  return { project, furniture, geometry };
}

const actionKinds = (fill?: LeafFill): string[] => {
  const { project, furniture, geometry } = scene(fill);
  const cell = geometry.cells[0]!;
  const model = describeSelection({ kind: 'cell', nodeId: cell.nodeId }, furniture, geometry, project.materials);
  return model.actions.map((action) => action.kind);
};

describe('resolveSelection', () => {
  it('деталь конкретнее ячейки: выбор полки не подменяется секцией', () => {
    const { geometry } = scene();
    const part = geometry.parts[0]!;
    const cell = geometry.cells[0]!;
    expect(resolveSelection([cell.nodeId], [part.id], geometry)).toEqual({ kind: 'part', partId: part.id });
  });

  it('узел-ячейка распознаётся как ячейка', () => {
    const { geometry } = scene();
    const cell = geometry.cells[0]!;
    expect(resolveSelection([cell.nodeId], [], geometry)).toEqual({ kind: 'cell', nodeId: cell.nodeId });
  });

  it('узел-секция распознаётся как секция', () => {
    // Изделие из одной секции не годится: там секция и ячейка — один и тот
    // же узел, и проверка ничего не различала бы. Делим на три.
    const { furniture, geometry } = sections(3);
    const section = geometry.sections[1]!;
    expect(geometry.cells.some((cell) => cell.nodeId === section.nodeId)).toBe(false);
    expect(furniture.root.kind).toBe('split');
    expect(resolveSelection([section.nodeId], [], geometry)).toEqual({ kind: 'section', nodeId: section.nodeId });
  });

  it('пустое выделение — это изделие целиком, а не «ничего»', () => {
    const { geometry } = scene();
    expect(resolveSelection([], [], geometry)).toEqual({ kind: 'furniture' });
  });

  it('исчезнувшая деталь не оставляет выделение висеть в прошлом', () => {
    // Идентификаторы деталей переживают пересчёт не всегда: после смены
    // конструкции выбранной детали может уже не быть.
    const { geometry } = scene();
    expect(resolveSelection([], ['part:missing' as PartId], geometry)).toEqual({ kind: 'furniture' });
  });
});

describe('describeSelection', () => {
  it('для секции показывает её размер и состав, но не действия', () => {
    const { project, furniture, geometry } = sections(3);
    const section = geometry.sections[1]!;
    const model = describeSelection({ kind: 'section', nodeId: section.nodeId }, furniture, geometry, project.materials);
    expect(model.title).toBe('Секция 2');
    expect(model.rows.map((r) => r.label)).toContain('Ячеек');
    expect(model.actions).toEqual([]);
  });

  it('для изделия показывает габарит и итоги расчёта', () => {
    const { project, furniture, geometry } = scene();
    const model = describeSelection({ kind: 'furniture' }, furniture, geometry, project.materials);
    expect(model.title).toBe(furniture.name);
    expect(model.rows.map((r) => r.label)).toContain('Габарит');
    expect(model.rows.find((r) => r.label === 'Деталей')?.value).toBe(String(geometry.parts.length));
  });

  it('для детали показывает размер раскроя и материал, но не даёт править деталь', () => {
    const { project, furniture, geometry } = scene();
    const part = geometry.parts[0]!;
    const model = describeSelection({ kind: 'part', partId: part.id }, furniture, geometry, project.materials);
    expect(model.rows.map((r) => r.label)).toContain('Размер раскроя');
    // Деталь производна от конструкции: править её напрямую нельзя.
    expect(model.actions).toEqual([]);
  });

  it('несуществующий объект не роняет инспектор, а откатывает к изделию', () => {
    const { project, furniture, geometry } = scene();
    const model = describeSelection({ kind: 'cell', nodeId: 'nope' as NodeId }, furniture, geometry, project.materials);
    expect(model.subtitle).toBe('Изделие');
  });

  it('пустая ячейка предлагает дверь, ящики и полки', () => {
    expect(actionKinds()).toEqual(
      expect.arrayContaining(['add-door', 'add-drawers', 'add-shelves']),
    );
  });

  it('ячейка с ящиками не предлагает дверь: операция несовместима (§12)', () => {
    const kinds = actionKinds(createDrawersLeaf(createSequentialIdFactory('d'), 3).fill);
    // `clear-fill` подтверждает, что ячейка найдена: пустой список действий
    // получился бы и при откате к изделию, и тогда проверка ничего не значит.
    expect(kinds).toContain('clear-fill');
    expect(kinds).not.toContain('add-door');
  });

  it('ячейка с полками не предлагает ящики поверх них', () => {
    const kinds = actionKinds(createShelvesLeaf(createSequentialIdFactory('s'), 2).fill);
    expect(kinds).toContain('add-shelves');
    expect(kinds).not.toContain('add-drawers');
  });

  it('пустая ячейка не предлагает очистить наполнение', () => {
    expect(actionKinds()).not.toContain('clear-fill');
  });
});
