import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFTS, draftsOf } from '../../../src/app/editor/drafts.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createSections, createSizedSplit, createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { emptyProject, run } from '../integration/fixtures.js';
import type { Furniture, SectionNode } from '../../../src/domain/index.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * Черновики полей конструктора выводятся из дерева (PROMPT 31 §5).
 *
 * Проверяется не «функция возвращает число», а то, ради чего она заведена:
 * значение на экране должно описывать ОТКРЫТЫЙ проект. Пока черновики были
 * константами, кнопка «Применить секций: 1» на трёхсекционном шкафу
 * схлопывала его структуру — по значению, которое пользователь видел.
 */

const ids = () => createSequentialIdFactory('d');

function withRoot(root: SectionNode): Furniture {
  const project = emptyProject();
  const furniture = project.furniture[0]!;
  return { ...furniture, root };
}

describe('draftsOf: изделия нет', () => {
  it('пустой проект даёт значения пустого проекта, а не прошлые', () => {
    expect(draftsOf(undefined)).toEqual(EMPTY_DRAFTS);
  });
});

describe('draftsOf: секции', () => {
  it('лист — одна секция без заданных ширин', () => {
    const drafts = draftsOf(withRoot(createEmptyLeaf(ids())));
    expect(drafts.sections).toBe(1);
    expect(drafts.sectionWidths).toBe('');
  });

  it('деление корня по X даёт число секций', () => {
    const drafts = draftsOf(withRoot(createSections(ids(), 3, 16)));
    expect(drafts.sections).toBe(3);
  });

  it('равные секции — пустая строка ширин, а не «0, 0, 0»', () => {
    expect(draftsOf(withRoot(createSections(ids(), 3, 16))).sectionWidths).toBe('');
  });

  it('фиксированные ширины выводятся строкой, которую понимает поле ввода', () => {
    const root = createSizedSplit(
      ids(),
      'x',
      [
        { mode: 'fixed', value: 300 },
        { mode: 'fixed', value: 500 },
        { mode: 'fixed', value: 400 },
      ],
      16,
    );
    expect(draftsOf(withRoot(root)).sectionWidths).toBe('300, 500, 400');
  });

  it('смешанный случай сохраняет пустое место у растягиваемой секции', () => {
    const root = createSizedSplit(
      ids(),
      'x',
      [
        { mode: 'fixed', value: 300 },
        { mode: 'flex', weight: 1 },
      ],
      16,
    );
    expect(draftsOf(withRoot(root)).sectionWidths).toBe('300, ');
  });

  it('деление по Y — это одна секция: строки секциями не являются', () => {
    expect(draftsOf(withRoot(createUniformGrid(ids(), 3, 1, 16, 16))).sections).toBe(1);
  });
});

describe('draftsOf: сетка', () => {
  it('деление корня по X — это секции, а не колонки: неоднозначность разрешена в пользу секций', () => {
    // Одно и то же дерево строится и «4 секции», и «сетка 1 × 4». Различия
    // в модели нет, поэтому правило выбрано явно: корневое деление по X
    // читают команды секций — значит и поля показывают секции.
    const drafts = draftsOf(withRoot(createUniformGrid(ids(), 1, 4, 16, 16)));
    expect(drafts.sections).toBe(4);
    expect(drafts.columns).toBe(EMPTY_DRAFTS.columns);
  });

  it('колонки читаются внутри секции', () => {
    const factory = ids();
    const root = createSections(factory, 2, 16, (inner) => createUniformGrid(inner, 1, 4, 16, 16));
    const drafts = draftsOf(withRoot(root));
    expect(drafts.sections).toBe(2);
    expect(drafts.rows).toBe(1);
    expect(drafts.columns).toBe(4);
  });

  it('чистые строки читаются как N × 1', () => {
    const drafts = draftsOf(withRoot(createUniformGrid(ids(), 3, 1, 16, 16)));
    expect(drafts.rows).toBe(3);
    expect(drafts.columns).toBe(1);
  });

  it('полная сетка читается как rows × columns', () => {
    const drafts = draftsOf(withRoot(createUniformGrid(ids(), 2, 3, 16, 16)));
    expect(drafts.rows).toBe(2);
    expect(drafts.columns).toBe(3);
  });

  it('сетка читается внутри ПЕРВОЙ секции, а не поверх секций', () => {
    const factory = ids();
    const root = createSections(factory, 2, 16, (inner) => createUniformGrid(inner, 2, 2, 16, 16));
    const drafts = draftsOf(withRoot(root));
    expect(drafts.sections).toBe(2);
    expect(drafts.rows).toBe(2);
    expect(drafts.columns).toBe(2);
  });

  it('неравное число колонок в строках сеткой не считается: показывается 1 × 1', () => {
    const factory = ids();
    const root: SectionNode = {
      id: factory.next<'Node'>(),
      kind: 'split',
      axis: 'y',
      divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
      children: [
        { size: { mode: 'flex', weight: 1 }, node: createUniformGrid(factory, 1, 2, 16, 16) },
        { size: { mode: 'flex', weight: 1 }, node: createUniformGrid(factory, 1, 3, 16, 16) },
      ],
    };
    const drafts = draftsOf(withRoot(root));
    expect(drafts.rows).toBe(EMPTY_DRAFTS.rows);
    expect(drafts.columns).toBe(EMPTY_DRAFTS.columns);
  });
});

describe('draftsOf: полки', () => {
  it('одинаковое число полок во всех ячейках выводится', () => {
    const drafts = draftsOf(
      withRoot(createUniformGrid(ids(), 2, 2, 16, 16, (inner) => createShelvesLeaf(inner, 2, 'adjustable'))),
    );
    expect(drafts.shelves).toBe(2);
  });

  it('ячейки без полок дают 0', () => {
    expect(draftsOf(withRoot(createUniformGrid(ids(), 2, 2, 16, 16))).shelves).toBe(0);
  });

  it('разное число полок не выводится: показанное число было бы неправдой', () => {
    const factory = ids();
    let count = 1;
    const root = createUniformGrid(factory, 2, 2, 16, 16, (inner) =>
      createShelvesLeaf(inner, count++, 'adjustable'),
    );
    expect(draftsOf(withRoot(root)).shelves).toBe(EMPTY_DRAFTS.shelves);
  });

  it('полки считаются по всему дереву, а не по первой секции', () => {
    const factory = ids();
    const root = createSections(factory, 2, 16, (inner) => createShelvesLeaf(inner, 2, 'adjustable'));
    expect(draftsOf(withRoot(root)).shelves).toBe(2);
  });
});

describe('регрессия PROMPT 31 §5: открытый проект и поля не расходятся', () => {
  /**
   * Сценарий ровно тот, что ломался: пользователь строит три секции,
   * сохраняет, закрывает вкладку и открывает снова. Приложение
   * восстанавливает документ — и поле обязано показать три, а не одну.
   */
  it('после SetSectionCount черновик показывает столько же секций, сколько в модели', () => {
    const factory = createSequentialIdFactory('s');
    const project: Project = run(emptyProject(), [
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: 3,
        splitId: factory.next<'Node'>(),
        newSectionIds: [factory.next<'Node'>(), factory.next<'Node'>(), factory.next<'Node'>()],
        dividerThickness: 16,
      },
    ]);
    expect(draftsOf(project.furniture[0]).sections).toBe(3);
  });
});
