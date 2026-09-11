import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { startingPoint } from '../../../src/app/editor/starting-point.js';
import { divideCommands } from '../../../src/app/editor/divide-cell.js';
import { createProject, createRandomIdFactory, createHingedFacade } from '../../../src/domain/index.js';
import { applyCommand } from '../../../src/state/index.js';
import { buildGeometry } from '../../../src/geometry/index.js';
import type { Command } from '../../../src/state/index.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * Что человек читает об объекте (PROMPT 57 §11, §16).
 *
 * Дефект `FR-06`: приложение показывало готовый объект и не говорило ни
 * что это, ни что делать дальше. Проверяется, что подпись выводится из
 * ФАКТИЧЕСКОГО состояния и меняется вместе с ним — иначе это была бы
 * заученная инструкция, а не ответ про конкретное изделие.
 */

const geo = (p: Project) =>
  buildGeometry({
    furniture: p.furniture[0]!,
    scheme: p.settings.construction,
    tolerances: p.settings.tolerances,
    materials: p.materials,
    edgeSizing: p.settings.edgeSizing,
  });

const run = (p: Project, commands: readonly Command[]): Project =>
  produce(p, (draft) => {
    for (const c of commands) applyCommand(draft, c);
  });

const at = (p: Project) => startingPoint(p.furniture[0], geo(p));

describe('с чего начинается изделие', () => {
  it('новый проект описан как пустой корпус, а не как «Изделие 1»', () => {
    const s = at(createProject({ name: 'Новый' }))!;
    expect(s.stage).toBe('carcass');
    expect(s.what).toContain('Пустой корпус');
    expect(s.what).toContain('1000 × 2000 × 500 мм');
    expect(s.next).toContain('разделите');
  });

  it('подпись следует за габаритом, а не повторяет заученное число', () => {
    const p = produce(createProject({ name: 'Размер' }), (draft) => {
      applyCommand(draft, { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 });
    });
    expect(at(p)!.what).toContain('1800 × 2000 × 500 мм');
  });

  it('после деления говорит о числе отделений и зовёт их наполнить', () => {
    const base = createProject({ name: 'Деление' });
    const target = geo(base).cells[0]!.nodeId;
    const p = run(
      base,
      divideCommands(base.furniture[0], { nodeId: target, rows: 3, columns: 1, shelves: 0 }, createRandomIdFactory()),
    );
    const s = at(p)!;
    expect(s.stage).toBe('divided');
    expect(s.what).toContain('3 отделения');
    expect(s.next).toContain('полки');
  });

  it('после наполнения зовёт к фасадам или сразу к производству', () => {
    const base = createProject({ name: 'Полки' });
    const target = geo(base).cells[0]!.nodeId;
    const p = run(
      base,
      divideCommands(base.furniture[0], { nodeId: target, rows: 2, columns: 1, shelves: 2 }, createRandomIdFactory()),
    );
    const s = at(p)!;
    expect(s.stage).toBe('filled');
    expect(s.what).toContain('занято');
    expect(s.next).toContain('производству');
  });

  it('с фасадом ведёт к материалам и производству', () => {
    const base = createProject({ name: 'Дверь' });
    const cell = geo(base).cells[0]!.nodeId;
    const p = produce(base, (draft) => {
      applyCommand(draft, {
        type: 'AddFacade',
        furnitureIndex: 0,
        facade: createHingedFacade(createRandomIdFactory(), cell, 1),
      });
    });
    const s = at(p)!;
    expect(s.stage).toBe('faced');
    expect(s.what).toContain('фасадов 1');
    expect(s.next).toContain('Производство');
  });

  it('ни на одном этапе не называет тип мебели, которого модель не различает', () => {
    const base = createProject({ name: 'Слова' });
    const target = geo(base).cells[0]!.nodeId;
    const stages = [
      at(base)!,
      at(run(base, divideCommands(base.furniture[0], { nodeId: target, rows: 2, columns: 1, shelves: 0 }, createRandomIdFactory())))!,
      at(run(base, divideCommands(base.furniture[0], { nodeId: target, rows: 2, columns: 1, shelves: 1 }, createRandomIdFactory())))!,
    ];
    for (const s of stages) {
      const text = `${s.what} ${s.next}`;
      for (const word of ['шкаф', 'Шкаф', 'тумб', 'комод', 'стеллаж', 'кухн']) {
        expect(text, `подпись обещает вид мебели, которого нет в модели: ${word}`).not.toContain(word);
      }
    }
  });

  it('без изделия или без геометрии подписи нет и падать не на чем', () => {
    expect(startingPoint(undefined, undefined)).toBeUndefined();
    expect(startingPoint(createProject({ name: 'x' }).furniture[0], undefined)).toBeUndefined();
  });
});
