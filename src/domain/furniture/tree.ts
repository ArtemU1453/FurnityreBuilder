import type { NodeId } from '../ids.js';
import type { LeafNode, SectionNode, SplitNode } from './types.js';

export const isSplit = (node: SectionNode): node is SplitNode => node.kind === 'split';
export const isLeaf = (node: SectionNode): node is LeafNode => node.kind === 'leaf';

/** Обход дерева сверху вниз. Порядок детерминирован: узел, затем дети слева направо. */
export function visitNodes(root: SectionNode, visit: (node: SectionNode, path: readonly number[]) => void): void {
  const walk = (node: SectionNode, path: readonly number[]): void => {
    visit(node, path);
    if (isSplit(node)) {
      node.children.forEach((child, i) => {
        walk(child.node, [...path, i]);
      });
    }
  };
  walk(root, []);
}

export function findNode(root: SectionNode, id: NodeId): SectionNode | undefined {
  let found: SectionNode | undefined;
  visitNodes(root, (node) => {
    if (found === undefined && node.id === id) found = node;
  });
  return found;
}

export function collectNodeIds(root: SectionNode): NodeId[] {
  const ids: NodeId[] = [];
  visitNodes(root, (node) => ids.push(node.id));
  return ids;
}

export function collectLeaves(root: SectionNode): LeafNode[] {
  const leaves: LeafNode[] = [];
  visitNodes(root, (node) => {
    if (isLeaf(node)) leaves.push(node);
  });
  return leaves;
}

export function countNodes(root: SectionNode): number {
  let n = 0;
  visitNodes(root, () => {
    n += 1;
  });
  return n;
}

/**
 * Заменяет узел по идентификатору, возвращая новое дерево.
 * Неизменённые поддеревья сохраняют ссылку — это даёт дешёвую мемоизацию
 * пересчёта геометрии.
 */
export function replaceNode(
  root: SectionNode,
  id: NodeId,
  replacement: (node: SectionNode) => SectionNode,
): SectionNode {
  if (root.id === id) return replacement(root);
  if (!isSplit(root)) return root;

  let changed = false;
  const children = root.children.map((child) => {
    const next = replaceNode(child.node, id, replacement);
    if (next === child.node) return child;
    changed = true;
    return { ...child, node: next };
  });

  return changed ? { ...root, children } : root;
}

/** Путь индексов от корня до узла. Основа детерминированных идентификаторов деталей. */
export function pathToNode(root: SectionNode, id: NodeId): readonly number[] | undefined {
  let result: readonly number[] | undefined;
  visitNodes(root, (node, path) => {
    if (result === undefined && node.id === id) result = path;
  });
  return result;
}
