import type { Issue, Project, SplitNode } from '../../domain/index.js';
import { isSplit, issue, visitNodes } from '../../domain/index.js';
import type { ValidationRule } from '../types.js';

/**
 * Инварианты дерева секций (docs/DATA_MODEL.md §15).
 *
 * Правило «нет вложенных делений по одной оси» существует ради единственности
 * представления: одну и ту же мебель нельзя описать двумя разными деревьями,
 * иначе undo и сравнение снапшотов перестают быть предсказуемыми.
 */
export const structureRule: ValidationRule = {
  code: 'STRUCTURE',
  run(project: Project): Issue[] {
    const issues: Issue[] = [];

    for (const furniture of project.furniture) {
      visitNodes(furniture.root, (node) => {
        if (!isSplit(node)) return;
        const split: SplitNode = node;

        if (split.children.length < 2) {
          issues.push(
            issue('SPLIT_TOO_FEW_CHILDREN', 'error', 'Деление должно содержать не менее двух ячеек.', {
              nodeId: split.id,
            }),
          );
        }

        for (const child of split.children) {
          if (isSplit(child.node) && child.node.axis === split.axis) {
            issues.push(
              issue(
                'NESTED_SPLIT_SAME_AXIS',
                'error',
                'Вложенное деление по той же оси: добавьте разделитель в существующий узел.',
                { nodeId: child.node.id },
              ),
            );
          }
        }

        // Все дети фиксированы — остаток при изменении габарита распределять
        // некуда. Точную доступную длину знает только геометрия, поэтому здесь
        // это сообщение, а не ошибка.
        const hasFlex = split.children.some((c) => c.size.mode === 'flex');
        if (!hasFlex) {
          issues.push(
            issue(
              'SPLIT_FULLY_FIXED',
              'info',
              'Все ячейки деления зафиксированы: при изменении габарита остаток не распределится.',
              { nodeId: split.id },
            ),
          );
        }

        for (const child of split.children) {
          if (child.size.mode === 'fixed' && !Number.isFinite(child.size.value)) {
            issues.push(
              issue('SPLIT_SIZE_NAN', 'error', 'Фиксированный размер ячейки не является числом.', {
                nodeId: split.id,
              }),
            );
          }
          if (child.size.mode === 'flex' && !(child.size.weight > 0)) {
            issues.push(
              issue('SPLIT_WEIGHT_INVALID', 'error', 'Вес растягиваемой ячейки должен быть больше нуля.', {
                nodeId: split.id,
              }),
            );
          }
        }
      });
    }

    return issues;
  },
};
