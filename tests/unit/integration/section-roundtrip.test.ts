import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { emptyProject, geometryOf, run } from './fixtures.js';
import { draftsOf } from '../../../src/app/editor/drafts.js';
import type { Command } from '../../../src/state/commands.js';
import { isSplit } from '../../../src/domain/index.js';
import type { NodeId, Project, SectionNode } from '../../../src/domain/index.js';

/**
 * Круговой обход по числу секций: 1 → 2 → 3 → 4 → 3 → 2 → 1 (PROMPT 31 §10).
 *
 * Отдельные шаги проверены давно; здесь проверяется именно ВОЗВРАТ. Рост
 * структуры почти всегда безопасен — опасно сокращение: удалённая секция
 * может оставить за собой детали, которые движок продолжит строить, ячейки,
 * на которые больше никто не ссылается, или повторно выданный идентификатор.
 * Ни одно из этих последствий не видно на одном шаге вперёд.
 */

const ids = createSequentialIdFactory('rt');

function setSectionCount(count: number): Command {
  return {
    type: 'SetSectionCount',
    furnitureIndex: 0,
    count,
    splitId: ids.next<'Node'>(),
    newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
    dividerThickness: 16,
  };
}

const PATH = [1, 2, 3, 4, 3, 2, 1] as const;

/** Все идентификаторы узлов дерева — в порядке обхода. */
function nodeIds(project: Project): readonly NodeId[] {
  const collect = (node: SectionNode): NodeId[] =>
    isSplit(node) ? [node.id, ...node.children.flatMap((child) => collect(child.node))] : [node.id];
  const furniture = project.furniture[0];
  return furniture === undefined ? [] : collect(furniture.root);
}

describe('PROMPT 31 §10: 1 → 2 → 3 → 4 и обратно', () => {
  it('на каждом шаге число секций совпадает с заказанным', () => {
    let project = emptyProject('rt');
    for (const count of PATH) {
      project = run(project, [setSectionCount(count)]);
      expect(draftsOf(project.furniture[0]).sections).toBe(count);
    }
  });

  it('идентификаторы узлов не повторяются ни на одном шаге', () => {
    let project = emptyProject('rt');
    for (const count of PATH) {
      project = run(project, [setSectionCount(count)]);
      const all = nodeIds(project);
      expect(new Set(all).size, `дубликат id при ${String(count)} секциях`).toBe(all.length);
    }
  });

  it('осиротевших деталей не остаётся: каждая деталь принадлежит живому узлу или корпусу', () => {
    let project = emptyProject('rt');
    for (const count of PATH) {
      project = run(project, [setSectionCount(count)]);
      const alive = new Set(nodeIds(project));
      const geometry = geometryOf(project);
      for (const part of geometry.parts) {
        // Деталь корпуса узлу не принадлежит — у неё `nodeId` нет вовсе.
        const nodeId = part.origin.nodeId;
        if (nodeId === undefined) continue;
        expect(alive.has(nodeId), `деталь ${part.id} ссылается на исчезнувший узел`).toBe(true);
      }
    }
  });

  it('каждая ячейка ссылается на существующий узел', () => {
    let project = emptyProject('rt');
    for (const count of PATH) {
      project = run(project, [setSectionCount(count)]);
      const alive = new Set(nodeIds(project));
      for (const cell of geometryOf(project).cells) {
        expect(alive.has(cell.nodeId), `ячейка ссылается на исчезнувший узел при ${String(count)}`).toBe(true);
      }
    }
  });

  it('возврат к одной секции даёт ту же структуру, что и исходная', () => {
    const start = emptyProject('rt');
    let project = start;
    for (const count of PATH) project = run(project, [setSectionCount(count)]);

    // Одна секция — это лист, а не деление с единственным ребёнком:
    // вырожденное деление осталось бы в дереве и в деталировке лишней
    // перегородкой нулевой толщины.
    expect(project.furniture[0]?.root.kind).toBe(start.furniture[0]?.root.kind);
    expect(geometryOf(project).sections).toHaveLength(geometryOf(start).sections.length);
  });

  it('обход не наращивает дерево: 1 → 4 → 1 не оставляет мусора', () => {
    const start = emptyProject('rt');
    const there = run(start, [setSectionCount(4)]);
    const back = run(there, [setSectionCount(1)]);
    expect(nodeIds(back).length).toBeLessThan(nodeIds(there).length);
    expect(nodeIds(back).length).toBe(nodeIds(start).length);
  });
});
