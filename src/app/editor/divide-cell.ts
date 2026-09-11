import { createShelvesLeaf, findNode, isSplit } from '../../domain/index.js';
import type { Furniture, IdFactory, NodeId, SplitAxis } from '../../domain/index.js';
import type { Command } from '../../state/index.js';

/**
 * Разделить ОДНО отделение на ряды и колонки (PROMPT 55 §4, §6).
 *
 * ## Дефект, ради которого модуль появился
 *
 * Шаг 4 «Ячейки» строил сетку командой `SetRoot` — заменой всего дерева
 * изделия. При значениях по умолчанию (1 × 1) новым деревом был ОДИН
 * пустой лист, и три секции, набранные шагом 3, исчезали:
 * 7 деталей / 3 секции / 2 перегородки → 5 / 1 / 0. Разрушительная
 * операция стояла действием по умолчанию следующего по счёту шага
 * (`docs/FR02_CONSTRUCTION_RESET_ANALYSIS.md`).
 *
 * Подпись самого шага при этом всегда обещала другое: «Ряды и колонки
 * ВНУТРИ СЕКЦИИ». Здесь и делается то, что было обещано.
 *
 * ## Почему список команд, а не одна новая команда
 *
 * `SplitNode` делит один узел по одной оси и существует с PROMPT 2.
 * Ряды и колонки — два деления, вложенных друг в друга, значит команд
 * несколько. Складываются они в ОДИН шаг истории транзакцией
 * (`beginTransaction` / `endTransaction`), которая тоже существует
 * давно. Ни новой команды, ни нового поля домена, ни миграции схемы для
 * исправления не потребовалось.
 *
 * ## Файл чистый
 *
 * Ни React, ни DOM, ни обращения к store: на входе изделие и намерение,
 * на выходе список команд. Поэтому «сохранится ли конструкция» проверяет
 * обычный тест, а не клики (`docs/ARCHITECTURE.md`).
 */

export interface DivideRequest {
  /** Отделение, которое делим. */
  readonly nodeId: NodeId;
  readonly rows: number;
  readonly columns: number;
  /** Полок в каждой получившейся ячейке. 0 — ячейки пустые. */
  readonly shelves: number;
}

/** Что деление сделает с этим отделением — до того, как оно произойдёт. */
export interface DivideEffect {
  /** Делить нечего: 1 × 1 и без полок. */
  readonly noop: boolean;
  /** У отделения уже есть собственное деление — оно будет заменено. */
  readonly replacesSplit: boolean;
  /** В отделении что-то стоит (полки, ящики) — оно будет заменено. */
  readonly replacesFill: boolean;
}

export function divideEffect(furniture: Furniture | undefined, request: DivideRequest): DivideEffect {
  const node = furniture === undefined ? undefined : findNode(furniture.root, request.nodeId);
  const divides = request.rows > 1 || request.columns > 1;
  // «1 × 1 и полок 0» не делает ничего: предлагать такое действие незачем.
  const noop = !divides && request.shelves <= 0;
  if (node === undefined) return { noop: true, replacesSplit: false, replacesFill: false };
  if (isSplit(node)) return { noop, replacesSplit: divides, replacesFill: false };
  return {
    noop,
    replacesSplit: false,
    // Деление занятого отделения заменяет то, что в нём стоит. Задание
    // числа полок — нет: это обычная правка наполнения, которую делает и
    // шаг «Полки».
    replacesFill: divides && node.fill.kind !== 'empty',
  };
}

/** Теряется ли при делении уже сделанная внутри отделения работа. */
export function losesCellWork(effect: DivideEffect): boolean {
  return effect.replacesSplit || effect.replacesFill;
}

/** Словами: что именно будет заменено внутри отделения. */
export function describeDivide(effect: DivideEffect): string {
  if (effect.replacesSplit) return 'Внутреннее деление этого отделения будет заменено.';
  if (effect.replacesFill) return 'То, что стоит в этом отделении, будет заменено.';
  return '';
}

/**
 * Команды деления — в том порядке, в котором их надо выполнить.
 *
 * Сначала ряды по оси Y, потом колонки по оси X внутри каждого ряда:
 * тот же порядок вложения, что у `createUniformGrid`, поэтому «ряд» и
 * «колонка» означают на схеме и в имени отделения одно и то же
 * (`cell-identity.ts`).
 *
 * Возвращается пустой список, когда делать нечего. Вызывающая сторона
 * тогда не открывает транзакцию и не оставляет пустого шага истории.
 */
export function divideCommands(
  furniture: Furniture | undefined,
  request: DivideRequest,
  ids: IdFactory,
  furnitureIndex = 0,
): readonly Command[] {
  if (furniture === undefined) return [];
  if (findNode(furniture.root, request.nodeId) === undefined) return [];

  const rows = Math.max(1, Math.round(request.rows));
  const columns = Math.max(1, Math.round(request.columns));
  const shelves = Math.max(0, Math.round(request.shelves));
  const thickness = furniture.dimensions.panelThickness;

  const commands: Command[] = [];
  const split = (nodeId: NodeId, axis: SplitAxis, count: number): readonly NodeId[] => {
    const childIds = Array.from({ length: count }, () => ids.next<'Node'>());
    commands.push({ type: 'SplitNode', furnitureIndex, nodeId, axis, childIds, dividerThickness: thickness });
    return childIds;
  };

  const rowIds = rows > 1 ? split(request.nodeId, 'y', rows) : [request.nodeId];

  const leafIds: NodeId[] = [];
  for (const rowId of rowIds) {
    if (columns > 1) leafIds.push(...split(rowId, 'x', columns));
    else leafIds.push(rowId);
  }

  if (shelves > 0) {
    // Полки задаются ПОСЛЕ деления: `SplitNode` создаёт пустые листья, а
    // «полок в каждой ячейке» — обещание про каждую из получившихся.
    for (const leafId of leafIds) {
      // Наполнение берётся у доменной фабрики, а не собирается здесь:
      // раскладка полок — доменное решение (`createShelvesLeaf`), и
      // второго её описания в приложении быть не должно.
      commands.push({
        type: 'SetFill',
        furnitureIndex,
        nodeId: leafId,
        fill: createShelvesLeaf(ids, shelves, 'adjustable').fill,
      });
    }
  }

  return commands;
}
