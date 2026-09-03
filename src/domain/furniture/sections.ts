import type { IdFactory } from '../ids.js';
import type { SplitAxis } from '../coordinates.js';
import { createDividerSpec, createEmptyLeaf } from './defaults.js';
import type { SectionChild, SectionNode, SizeSpec, SplitNode } from './types.js';

/**
 * Фабрики, строящие дерево секций программно, а не только последовательными
 * командами `SplitNode`. Возвращают готовое поддерево; вставка в
 * существующий `Furniture` — дело вызывающей стороны (замена корня или
 * команда). Домен не хранит «количество секций» отдельным числом — им
 * является само дерево (docs/DATA_MODEL.md §5): построив дерево здесь один
 * раз, дальше во всём проекте достаточно одного источника истины.
 */

/**
 * Как построить содержимое одной секции. По умолчанию — пустая ячейка;
 * наполнение (полки, PROMPT 6) или собственное деление секции на ряды
 * (PROMPT 7) передаётся вызывающей стороной, чтобы фабрики структуры не
 * начали ЗНАТЬ про виды наполнения: строение верхнего уровня и содержимое
 * секции — разные решения, и смешивать их в одной функции значило бы
 * заводить по фабрике на каждое сочетание «сетка × вид наполнения».
 *
 * Возвращает `SectionNode`, а не `LeafNode`: секция вправе быть не только
 * одним проёмом, но и собственным поддеревом — именно так выглядит цепочка
 * «секция → ряды → ячейки» из PROMPT 7.
 */
export type SectionContentFactory = (ids: IdFactory) => SectionNode;

function equalChildren(ids: IdFactory, count: number, createLeaf: SectionContentFactory): SectionChild[] {
  return Array.from({ length: count }, () => ({
    size: { mode: 'flex' as const, weight: 1 },
    node: createLeaf(ids),
  }));
}

/**
 * N равных вертикальных секций верхнего уровня (деление по оси X).
 * `count < 2` не имеет смысла как деление — вызывающая сторона должна
 * проверить это до вызова; функция ожидает `count ≥ 2`.
 */
export function createSections(
  ids: IdFactory,
  count: number,
  dividerThickness: number,
  createLeaf: SectionContentFactory = createEmptyLeaf,
): SplitNode {
  return {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis: 'x',
    divider: createDividerSpec(dividerThickness),
    children: equalChildren(ids, count, createLeaf),
  };
}

/**
 * Деление с ЯВНО заданными размерами детей (PROMPT 8 §3, §10).
 *
 * Обобщение `createSections`: там все дети равны и растягиваемы, здесь
 * размер каждого задаётся отдельно — `{mode:'fixed', value}` держит
 * абсолютный размер, `{mode:'flex', weight}` забирает остаток. Никакого
 * второго механизма размеров при этом не заводится: это тот же `SizeSpec`,
 * который лежит на `SectionChild` с PROMPT 1 и который уже умеет
 * раскладывать `resolveSizes`.
 *
 * Ось выбирает вызывающая сторона: `'x'` — секции и колонки по ширине,
 * `'y'` — ряды по высоте. Одна функция на обе оси не экономия строк, а
 * следствие модели: ряд и секция отличаются только осью деления
 * (docs/DATA_MODEL.md §5.2).
 *
 * Сумма `fixed`-размеров должна сходиться с доступным местом за вычетом
 * разделителей; если не сходится, движок сообщит об этом диагностикой
 * (`SPLIT_OVERCONSTRAINED` / `SPLIT_UNDERCONSTRAINED`), а не построит
 * геометрию с зазором. Проверять это здесь фабрика не может и не должна:
 * доступное место зависит от габаритов изделия, которых она не знает.
 */
export function createSizedSplit(
  ids: IdFactory,
  axis: SplitAxis,
  sizes: readonly SizeSpec[],
  dividerThickness: number,
  createLeaf: SectionContentFactory = createEmptyLeaf,
): SplitNode {
  return {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis,
    divider: createDividerSpec(dividerThickness),
    children: sizes.map((size) => ({ size, node: createLeaf(ids) })),
  };
}

/** Ширины секций в миллиметрах → `SizeSpec[]` с режимом `fixed`. */
export function fixedSizes(values: readonly number[]): SizeSpec[] {
  return values.map((value) => ({ mode: 'fixed', value }));
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
  createLeaf: SectionContentFactory = createEmptyLeaf,
): SectionNode {
  const buildRow = (): SectionNode =>
    columns <= 1
      ? createLeaf(ids)
      : {
          id: ids.next<'Node'>(),
          kind: 'split',
          axis: 'x',
          divider: createDividerSpec(columnDividerThickness),
          children: equalChildren(ids, columns, createLeaf),
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
