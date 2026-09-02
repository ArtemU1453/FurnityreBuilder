import type { IdFactory } from '../ids.js';
import { createDividerSpec, createEmptyLeaf } from './defaults.js';
import type { SectionChild, SectionNode, SplitNode } from './types.js';

/**
 * Фабрики, строящие дерево секций программно, а не только последовательными
 * командами `SplitNode`. Возвращают готовое поддерево; вставка в
 * существующий `Furniture` — дело вызывающей стороны (замена корня или
 * команда). Домен не хранит «количество секций» отдельным числом — им
 * является само дерево (docs/DATA_MODEL.md §5): построив дерево здесь один
 * раз, дальше во всём проекте достаточно одного источника истины.
 */

function equalChildren(ids: IdFactory, count: number): SectionChild[] {
  return Array.from({ length: count }, () => ({
    size: { mode: 'flex' as const, weight: 1 },
    node: createEmptyLeaf(ids),
  }));
}

/**
 * N равных вертикальных секций верхнего уровня (деление по оси X).
 * `count < 2` не имеет смысла как деление — вызывающая сторона должна
 * проверить это до вызова; функция ожидает `count ≥ 2`.
 */
export function createSections(ids: IdFactory, count: number, dividerThickness: number): SplitNode {
  return {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis: 'x',
    divider: createDividerSpec(dividerThickness),
    children: equalChildren(ids, count),
  };
}

/**
 * Равномерная сетка `rows × columns` внутри одной секции.
 *
 * Внешнее деление — по строкам (ось Y), внутри каждой строки — по колонкам
 * (ось X): горизонтальные полки — главное деление мебели, вертикальные
 * простенки внутри ряда — вторичное. Обе оси вырождаются корректно:
 * `rows = columns = 1` возвращает лист без единого деления, `columns = 1`
 * даёт чистое деление на строки без внутренних вертикальных перегородок,
 * `rows = 1` — чистое деление на колонки без обёртывающего деления по Y
 * (лишний уровень дерева не создаётся, см. `docs/DATA_MODEL.md` §15,
 * инвариант о запрете вложенных делений по одной оси — здесь лишнего
 * деления нет вообще, а не «того же вида»).
 */
export function createUniformGrid(
  ids: IdFactory,
  rows: number,
  columns: number,
  rowDividerThickness: number,
  columnDividerThickness: number,
): SectionNode {
  const buildRow = (): SectionNode =>
    columns <= 1
      ? createEmptyLeaf(ids)
      : {
          id: ids.next<'Node'>(),
          kind: 'split',
          axis: 'x',
          divider: createDividerSpec(columnDividerThickness),
          children: equalChildren(ids, columns),
        };

  if (rows <= 1) return buildRow();

  return {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis: 'y',
    divider: createDividerSpec(rowDividerThickness),
    children: Array.from({ length: rows }, () => ({
      size: { mode: 'flex' as const, weight: 1 },
      node: buildRow(),
    })),
  };
}
