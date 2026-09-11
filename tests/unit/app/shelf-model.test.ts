import { describe, expect, it } from 'vitest';
import {
  acceptsShelfCount,
  makeShelvesFill,
  shelfCountFill,
  shelfCountOf,
} from '../../../src/app/editor/shelf-model.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawersLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import type { LeafFill } from '../../../src/domain/index.js';

/**
 * Одна модель полок (PROMPT 60, FR-08).
 *
 * Проверяется РАЗДЕЛЕНИЕ, ради которого модуль и заведён: «сколько
 * полок» — параметр, «сделать отделение полочным» — действие. Пока они
 * жили в двух обработчиках с одинаковыми подписями, одна и та же на вид
 * кнопка то добавляла полку, то не делала ничего, то уничтожала ящик.
 */

const ids = (): ReturnType<typeof createSequentialIdFactory> =>
  createSequentialIdFactory('sh');

const shelves = (count: number): LeafFill => createShelvesLeaf(ids(), count).fill;
const drawers = (count: number): LeafFill => createDrawersLeaf(ids(), count).fill;

describe('shelfCountOf — количество читается из модели, а не хранится рядом', () => {
  it('пустое отделение — ноль полок', () => {
    expect(shelfCountOf({ kind: 'empty' })).toBe(0);
  });

  it('число полок равно длине списка деталей', () => {
    const fill = shelves(4);
    expect(shelfCountOf(fill)).toBe(4);
    if (fill.kind !== 'shelves') throw new Error('ожидались полки');
    expect(shelfCountOf(fill)).toBe(fill.shelves.length);
  });

  it('у ящиков полок нет', () => {
    expect(shelfCountOf(drawers(3))).toBe(0);
  });
});

describe('acceptsShelfCount — где вопрос «сколько полок» вообще осмыслен', () => {
  it('пустое отделение принимает количество: полки туда поставить можно', () => {
    expect(acceptsShelfCount({ kind: 'empty' })).toBe(true);
  });

  it('полочное отделение принимает количество', () => {
    expect(acceptsShelfCount(shelves(2))).toBe(true);
  });

  it('отделение с ящиком количества полок не имеет — показывать 0 было бы ложью', () => {
    expect(acceptsShelfCount(drawers(1))).toBe(false);
  });
});

describe('shelfCountFill — параметр «сколько полок» (§9)', () => {
  it('0 → N создаёт полочное наполнение', () => {
    const fill = shelfCountFill(ids(), { kind: 'empty' }, 3);
    expect(fill?.kind).toBe('shelves');
    expect(shelfCountOf(fill ?? { kind: 'empty' })).toBe(3);
  });

  it('N → M меняет число', () => {
    const fill = shelfCountFill(ids(), shelves(3), 5);
    expect(shelfCountOf(fill ?? { kind: 'empty' })).toBe(5);
  });

  it('N → 0 делает отделение пустым: полок нет — значит и вида наполнения нет', () => {
    expect(shelfCountFill(ids(), shelves(3), 0)).toEqual({ kind: 'empty' });
  });

  it('то же число командой не оборачивается', () => {
    expect(shelfCountFill(ids(), shelves(3), 3)).toBeUndefined();
    expect(shelfCountFill(ids(), { kind: 'empty' }, 0)).toBeUndefined();
  });

  /** §18 E — главный дефект FR-08. */
  it('на отделении с ящиком количество не применяется: чужое наполнение не теряется', () => {
    expect(shelfCountFill(ids(), drawers(1), 2)).toBeUndefined();
    expect(shelfCountFill(ids(), drawers(1), 0)).toBeUndefined();
  });

  it('отрицательное число читается как ноль, дробное округляется', () => {
    expect(shelfCountFill(ids(), shelves(2), -5)).toEqual({ kind: 'empty' });
    expect(shelfCountOf(shelfCountFill(ids(), shelves(2), 3.4) ?? { kind: 'empty' })).toBe(3);
  });
});

describe('makeShelvesFill — действие «сделать отделение полочным» (0 → N)', () => {
  it('пустое отделение становится полочным с одной полкой', () => {
    const fill = makeShelvesFill(ids(), { kind: 'empty' });
    expect(shelfCountOf(fill ?? { kind: 'empty' })).toBe(1);
  });

  it('на отделении, где полки уже есть, действия нет — кнопка не должна предлагаться', () => {
    expect(makeShelvesFill(ids(), shelves(3))).toBeUndefined();
  });

  it('ящик заменяется полками только явным выбором вида наполнения', () => {
    const fill = makeShelvesFill(ids(), drawers(2));
    expect(shelfCountOf(fill ?? { kind: 'empty' })).toBe(1);
  });

  it('действие не задаёт количество: у него всегда одна полка', () => {
    expect(shelfCountOf(makeShelvesFill(ids(), { kind: 'empty' }) ?? { kind: 'empty' })).toBe(1);
  });
});
