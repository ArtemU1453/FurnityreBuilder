import type { NodeId } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';

/**
 * Человекочитаемое имя ячейки и секции (PROMPT 54 §7, §10).
 *
 * ## Зачем
 *
 * До PROMPT 54 ячейка называлась своим машинным идентификатором:
 * селектор шага «Фасады» перечислял
 * `184c6b41-fb86-42ab-b1d4-b5716ca6a0a0 (578.7 × 2168)`, а инспектор
 * писал `${nodeId} · секция ${sectionId}`. Три ячейки одного шкафа
 * различались только UUID и округлением до 0.1 мм — то есть на практике
 * не различались вовсе.
 *
 * ## Имя НЕ хранится
 *
 * Как и всё остальное производное в этом проекте, имя вычисляется из
 * уже посчитанного движком и нигде не лежит. `CellBox` несёт `sectionId`,
 * `row` и `column`, `SectionBox` — `index`; этого достаточно. Завести
 * поле «имя» в домене значило бы получить вторую правду о структуре и
 * обязанность её мигрировать.
 *
 * ## Почему ряды считаются сверху
 *
 * `row` приходит из обхода дерева и растёт вместе с координатой Y, то
 * есть СНИЗУ ВВЕРХ: `row === 0` — самый нижний ряд. Человек, глядя на
 * шкаф, считает полки сверху. Показывать «ряд 1» для нижнего ряда
 * значило бы спорить с тем, что человек видит, поэтому для подписи
 * порядок переворачивается. Направление закреплено проверкой
 * (`tests/unit/app/cell-identity.test.ts`), а не комментарием.
 *
 * ## Чего здесь нет
 *
 * Ни React, ни DOM, ни обращения к документу. Файл чистый — тот же
 * приём, что у `selection.ts`, `resize.ts` и `grid-replacement.ts`
 * (`docs/ARCHITECTURE.md`).
 */

/** Разбор положения ячейки в её секции — всё, из чего складывается имя. */
interface CellPlace {
  /** Номер секции для человека, от 1. `undefined` — секция одна. */
  readonly section: number | undefined;
  /** Номер ряда сверху, от 1. `undefined` — ряд один. */
  readonly row: number | undefined;
  /** Номер колонки слева, от 1. `undefined` — колонка одна. */
  readonly column: number | undefined;
}

function placeOf(nodeId: NodeId, geometry: GeometryResult): CellPlace | undefined {
  const cell = geometry.cells.find((item) => item.nodeId === nodeId);
  if (cell === undefined) return undefined;

  const section = geometry.sections.find((item) => item.nodeId === cell.sectionId);
  const siblings = geometry.cells.filter((item) => item.sectionId === cell.sectionId);
  const rows = new Set(siblings.map((item) => item.row)).size;
  const columns = new Set(siblings.map((item) => item.column)).size;

  return {
    // Секция называется только тогда, когда их несколько: «Секция 1» у
    // изделия без деления — лишнее слово, а не уточнение.
    section: geometry.sections.length > 1 && section !== undefined ? section.index + 1 : undefined,
    row: rows > 1 ? rows - cell.row : undefined,
    column: columns > 1 ? cell.column + 1 : undefined,
  };
}

/** Имя секции: «Секция 2». */
export function sectionName(nodeId: NodeId, geometry: GeometryResult): string {
  const section = geometry.sections.find((item) => item.nodeId === nodeId);
  if (section === undefined) return 'Секция';
  return `Секция ${String(section.index + 1)}`;
}

/**
 * Имя ячейки — то, чем человек её называет.
 *
 * Называются только те измерения, по которым ячейку вообще можно
 * спутать с соседней. У шкафа из трёх секций по одной ячейке это
 * «Секция 2»; у одной секции с тремя рядами — «Ряд 1»; у сетки —
 * «Секция 2 · ряд 1 · колонка 2». Единственная ячейка неделённого
 * изделия не нуждается ни в номере, ни в координате.
 */
export function cellName(nodeId: NodeId, geometry: GeometryResult): string {
  const place = placeOf(nodeId, geometry);
  if (place === undefined) return 'Ячейка';

  const parts: string[] = [];
  if (place.section !== undefined) parts.push(`Секция ${String(place.section)}`);
  if (place.row !== undefined) parts.push(`ряд ${String(place.row)}`);
  if (place.column !== undefined) parts.push(`колонка ${String(place.column)}`);

  if (parts.length === 0) return 'Всё внутреннее пространство';

  const name = parts.join(' · ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Имена всех ячеек разом.
 *
 * Нужно там, где подписать надо каждую: схема рисует все прямоугольники
 * за один проход, и искать секцию заново для каждого — лишняя работа на
 * каждый кадр.
 */
export function cellNames(geometry: GeometryResult): ReadonlyMap<NodeId, string> {
  const names = new Map<NodeId, string>();
  for (const cell of geometry.cells) names.set(cell.nodeId, cellName(cell.nodeId, geometry));
  return names;
}
