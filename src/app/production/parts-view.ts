import { formatMm } from '../../domain/index.js';
import type { MaterialId, PartId } from '../../domain/index.js';
import type { PartBOMItem } from '../../bom/index.js';
import type { ProductionPartType } from '../../production/index.js';

/**
 * Поиск, фильтр и сортировка деталировки (PROMPT 29 §27, §28).
 *
 * ## `ProductionBOM` не меняется
 *
 * Группировка позиций — правило спецификации, и оно остаётся там, где
 * было: две одинаковые боковины уже пришли сюда ОДНОЙ строкой с
 * количеством 2. Здесь только выбирается, какие из готовых строк
 * показать и в каком порядке — это забота интерфейса, а не расчёта
 * (§7, §28).
 *
 * ## Чистый модуль
 *
 * Ни React, ни DOM. Поиск по большому проекту и порядок строк
 * проверяются обычным тестом, а не кликами. Серверного поиска нет и не
 * предполагается: весь проект уже в памяти.
 */

export type PartSortKey = 'index' | 'name' | 'type' | 'size' | 'material' | 'quantity';

export interface PartFilter {
  /** Свободный текст: имя, идентификатор, материал, размер. */
  readonly query: string;
  /** Материал или `undefined` — любой. */
  readonly materialId: MaterialId | undefined;
  readonly partType: ProductionPartType | undefined;
  readonly sort: PartSortKey;
  readonly descending: boolean;
}

export const DEFAULT_PART_FILTER: PartFilter = {
  query: '',
  materialId: undefined,
  partType: undefined,
  sort: 'index',
  descending: false,
};

/** Строка деталировки вместе с её порядковым номером в спецификации. */
export interface PartRow {
  readonly index: number;
  readonly item: PartBOMItem;
  /** Габарит одной строкой: то, что человек читает первым. */
  readonly size: string;
  readonly edge: string;
}

const EDGE_SIDES = ['front', 'back', 'left', 'right'] as const;

function edgeText(item: PartBOMItem): string {
  const sides = EDGE_SIDES.filter((side) => item.edgeBanding[side] > 0);
  if (sides.length === 0) return 'нет';
  return sides.map((side) => `${side} ${formatMm(item.edgeBanding[side])}`).join(', ');
}

/** Нумерация — по порядку спецификации, и она не зависит от фильтра. */
export function partRows(items: readonly PartBOMItem[]): readonly PartRow[] {
  return items.map((item, index) => ({
    index: index + 1,
    item,
    size: `${formatMm(item.length)} × ${formatMm(item.width)} × ${formatMm(item.thickness)}`,
    edge: edgeText(item),
  }));
}

/** Площадь позиции: нужна только сортировке «по размеру». */
function areaOf(item: PartBOMItem): number {
  return item.length * item.width;
}

function matches(row: PartRow, query: string): boolean {
  if (query === '') return true;
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = [
    String(row.index),
    row.item.name,
    row.item.id,
    row.item.partType,
    row.item.materialName,
    row.size,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

const COMPARATORS: Readonly<Record<PartSortKey, (a: PartRow, b: PartRow) => number>> = {
  index: (a, b) => a.index - b.index,
  name: (a, b) => a.item.name.localeCompare(b.item.name, 'ru'),
  type: (a, b) => a.item.partType.localeCompare(b.item.partType),
  size: (a, b) => areaOf(a.item) - areaOf(b.item),
  material: (a, b) => a.item.materialName.localeCompare(b.item.materialName, 'ru'),
  quantity: (a, b) => a.item.quantity - b.item.quantity,
};

/**
 * Отфильтрованные и упорядоченные строки.
 *
 * Сортировка устойчива: при равных ключах порядок остаётся
 * спецификационным, поэтому список не «дрожит» между перерисовками.
 */
export function visibleRows(rows: readonly PartRow[], filter: PartFilter): readonly PartRow[] {
  const filtered = rows.filter(
    (row) =>
      matches(row, filter.query) &&
      (filter.materialId === undefined || row.item.materialId === filter.materialId) &&
      (filter.partType === undefined || row.item.partType === filter.partType),
  );

  const compare = COMPARATORS[filter.sort];
  const sorted = [...filtered].sort((a, b) => {
    const primary = compare(a, b);
    return primary !== 0 ? primary : a.index - b.index;
  });
  return filter.descending ? sorted.reverse() : sorted;
}

/** Материалы, встречающиеся в деталировке: список для фильтра. */
export function materialOptions(
  items: readonly PartBOMItem[],
): readonly { readonly id: MaterialId; readonly name: string }[] {
  const seen = new Map<MaterialId, string>();
  for (const item of items)
    if (!seen.has(item.materialId)) seen.set(item.materialId, item.materialName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Типы деталей, встречающиеся в деталировке. */
export function typeOptions(items: readonly PartBOMItem[]): readonly ProductionPartType[] {
  return [...new Set(items.map((item) => item.partType))];
}

/**
 * Позиция деталировки, которой принадлежит физическая деталь (§29, §30).
 *
 * Связь уже существует — `PartBOMItem.sourcePartIds`, — и второй копии
 * для неё не заводится. Возвращается идентификатор позиции, а не сама
 * позиция: вызывающему обычно нужно именно сравнение.
 */
export function itemOfSourcePart(
  items: readonly PartBOMItem[],
  partId: PartId,
): PartBOMItem | undefined {
  return items.find((item) => item.sourcePartIds.includes(partId));
}
