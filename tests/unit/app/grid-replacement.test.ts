import { describe, expect, it } from 'vitest';
import {
  describeGridReplacement,
  gridReplacementLoss,
  losesWork,
} from '../../../src/app/editor/grid-replacement.js';
import { createProject } from '../../../src/domain/index.js';
import { applyCommand } from '../../../src/state/index.js';
import { createRandomIdFactory } from '../../../src/domain/index.js';
import { produce } from 'immer';

/**
 * Что теряется при замене дерева сеткой (PROMPT 46 §18).
 *
 * Дефект, ради которого модуль появился: «Применить сетку» выполняет
 * `SetRoot` и стирает секции, набранные на предыдущем шаге сценария, —
 * молча. Проверяется не текст диалога, а то, что предупреждение
 * появляется ровно тогда, когда терять действительно есть что.
 */

function withSections(count: number) {
  const ids = createRandomIdFactory();
  const project = createProject({ name: 'Аудит' });
  // `applyCommand` правит черновик Immer — так же, как это делает store.
  const next = produce(project, (draft) => {
    applyCommand(draft, {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count,
      splitId: ids.next<'Node'>(),
      newSectionIds: Array.from({ length: count }, () => ids.next<'Node'>()),
      dividerThickness: 16,
    });
  });
  return next.furniture[0];
}

describe('замена дерева сеткой', () => {
  it('пустое изделие терять нечего — вопроса не будет', () => {
    const loss = gridReplacementLoss(createProject({ name: 'Пустой' }).furniture[0]);
    expect(losesWork(loss)).toBe(false);
    expect(describeGridReplacement(loss)).toBe('');
  });

  it('три секции — это потеря, и она названа числом', () => {
    const loss = gridReplacementLoss(withSections(3));
    expect(loss.sections).toBe(3);
    expect(losesWork(loss)).toBe(true);
    expect(describeGridReplacement(loss)).toContain('3 секции');
  });

  it('одна секция потерей не считается: делить нечего', () => {
    const loss = gridReplacementLoss(withSections(1));
    expect(loss.sections).toBe(0);
  });

  it('изделия нет — терять нечего и падать не на чем', () => {
    expect(losesWork(gridReplacementLoss(undefined))).toBe(false);
  });

  it('перечисляется только то, что есть, без «0 фасадов»', () => {
    const text = describeGridReplacement({ sections: 2, filledCells: 0, facades: 0 });
    expect(text).toBe('2 секции');
    expect(text).not.toContain('фасад');
    expect(text).not.toContain('ячеек');
  });

  it('числительные согласованы: 1, 2 и 5 звучат по-разному', () => {
    expect(describeGridReplacement({ sections: 0, filledCells: 1, facades: 0 })).toContain(
      'наполнение 1 ячейки',
    );
    expect(describeGridReplacement({ sections: 0, filledCells: 0, facades: 1 })).toContain('1 фасад');
    expect(describeGridReplacement({ sections: 0, filledCells: 0, facades: 2 })).toContain('2 фасада');
    expect(describeGridReplacement({ sections: 0, filledCells: 0, facades: 5 })).toContain('5 фасадов');
    expect(describeGridReplacement({ sections: 11, filledCells: 0, facades: 0 })).toContain('11 секций');
  });
});
