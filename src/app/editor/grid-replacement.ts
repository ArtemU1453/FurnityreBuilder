import { isSplit } from '../../domain/index.js';
import type { Furniture, LeafNode, SectionNode } from '../../domain/index.js';

/**
 * Что потеряет изделие, если применить сетку (PROMPT 46 §5, §18).
 *
 * ## Найденный дефект
 *
 * «Применить сетку» выполняет команду `SetRoot` — она заменяет ВСЁ дерево
 * изделия целиком. Значит секции, набранные на предыдущем шаге сценария,
 * наполнение ячеек и фасады исчезают. Приложение об этом не сообщало
 * ничем: число деталей после замены могло даже вырасти, и потеря
 * выглядела как обычный пересчёт.
 *
 * Путь при этом самый обычный: лестница шагов ведёт «Секции» → «Ячейки»,
 * то есть прямо в него.
 *
 * ## Почему предупреждение, а не другое поведение сетки
 *
 * Потому что «применить сетку внутри выбранной секции» — это другая
 * функция, а не исправление этой. Она требует иной команды, иного
 * выделения и иной проверки, и вводить её под видом починки дефекта
 * значит менять продукт на аудите. Дефект здесь — не в том, ЧТО делает
 * кнопка, а в том, что она делает это МОЛЧА.
 *
 * Модуль чистый: ни React, ни DOM. Он отвечает на один вопрос и
 * проверяется обычным тестом.
 */

/** Все листья поддерева — то есть ячейки. */
function leavesOf(node: SectionNode): readonly LeafNode[] {
  if (!isSplit(node)) return [node];
  return node.children.flatMap((child) => leavesOf(child.node));
}

/** Секции верхнего уровня: деление корня по X. Лист — одна секция. */
function sectionCount(root: SectionNode): number {
  return isSplit(root) && root.axis === 'x' ? root.children.length : 1;
}

export interface GridReplacementLoss {
  /** Секций верхнего уровня, которые исчезнут (2 и больше — это потеря). */
  readonly sections: number;
  /** Ячеек с наполнением: полки, ящики. */
  readonly filledCells: number;
  /** Групп фасадов: они привязаны к ячейкам и переживут замену не все. */
  readonly facades: number;
}

/**
 * Что именно исчезнет при замене дерева.
 *
 * Ноль по всем полям означает, что терять нечего: пустое изделие с одной
 * ячейкой заменяется сеткой без потерь, и спрашивать не о чем.
 */
export function gridReplacementLoss(furniture: Furniture | undefined): GridReplacementLoss {
  if (furniture === undefined) return { sections: 0, filledCells: 0, facades: 0 };
  const sections = sectionCount(furniture.root);
  const filledCells = leavesOf(furniture.root).filter((leaf) => leaf.fill.kind !== 'empty').length;
  return {
    sections: sections > 1 ? sections : 0,
    filledCells,
    facades: furniture.facades.length,
  };
}

/** Есть ли что терять. */
export function losesWork(loss: GridReplacementLoss): boolean {
  return loss.sections > 0 || loss.filledCells > 0 || loss.facades > 0;
}

/** Склонение по числу: «3 секции», «1 полка». */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Что потеряется — словами, для человека.
 *
 * Пустая строка означает, что предупреждать не о чем. Перечисляется
 * только то, что действительно есть: «и 0 фасадов» — это не
 * предупреждение, а шум.
 */
export function describeGridReplacement(loss: GridReplacementLoss): string {
  const parts: string[] = [];
  if (loss.sections > 0) {
    parts.push(`${String(loss.sections)} ${plural(loss.sections, 'секция', 'секции', 'секций')}`);
  }
  if (loss.filledCells > 0) {
    parts.push(
      `наполнение ${String(loss.filledCells)} ${plural(loss.filledCells, 'ячейки', 'ячеек', 'ячеек')}`,
    );
  }
  if (loss.facades > 0) {
    parts.push(`${String(loss.facades)} ${plural(loss.facades, 'фасад', 'фасада', 'фасадов')}`);
  }
  return parts.join(', ');
}
