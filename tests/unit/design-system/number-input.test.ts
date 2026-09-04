import { describe, expect, it } from 'vitest';
import { formatNumeric, parseNumeric, rangeMessage } from '../../../src/design-system/NumberInput.js';

/**
 * Разбор и показ числа (PROMPT 26 §9).
 *
 * Проверяется здесь, а не кликами в браузере, потому что это чистые
 * функции: они не знают ни о React, ни о DOM. В браузере остаётся то,
 * чего без него не проверить, — фокус, вставка и клавиатура.
 */

describe('разбор ввода', () => {
  it('обычное число', () => {
    expect(parseNumeric('600')).toBe(600);
    expect(parseNumeric('16.5')).toBe(16.5);
  });

  it('запятая — тоже десятичный разделитель', () => {
    // Русская раскладка ставит запятую, и требовать точку — значит
    // требовать переключения раскладки ради одного символа.
    expect(parseNumeric('16,5')).toBe(16.5);
  });

  it('пробелы по краям не мешают', () => {
    expect(parseNumeric('  600  ')).toBe(600);
  });

  it('отрицательное число разбирается: диапазон — не дело разбора', () => {
    expect(parseNumeric('-100')).toBe(-100);
  });

  it('промежуточные состояния набора числом ещё не являются', () => {
    // Если бы они возвращали 0 или NaN, поле нельзя было бы очистить:
    // стирание последней цифры сразу подставляло бы значение обратно.
    for (const draft of ['', ' ', '-', '.', '-.']) {
      expect(parseNumeric(draft)).toBeUndefined();
    }
  });

  it('не-число не превращается в ноль', () => {
    expect(parseNumeric('шкаф')).toBeUndefined();
    expect(parseNumeric('12abc')).toBeUndefined();
  });

  it('бесконечность не проходит', () => {
    expect(parseNumeric('Infinity')).toBeUndefined();
  });
});

describe('показ значения', () => {
  it('без заданной точности показывается как есть', () => {
    expect(formatNumeric(600, undefined)).toBe('600');
    expect(formatNumeric(16.5, undefined)).toBe('16.5');
  });

  it('точность задаёт только ПОКАЗ, а не значение', () => {
    expect(formatNumeric(16.456, 1)).toBe('16.5');
    expect(formatNumeric(16, 2)).toBe('16.00');
  });

  it('пустое значение — пустая строка, а не ноль', () => {
    expect(formatNumeric(undefined, undefined)).toBe('');
    expect(formatNumeric(Number.NaN, undefined)).toBe('');
  });
});

describe('сообщение о диапазоне', () => {
  it('в диапазоне — молчит', () => {
    expect(rangeMessage(600, 1, 3000, 'мм')).toBeUndefined();
  });

  it('границы включаются', () => {
    expect(rangeMessage(1, 1, 3000, 'мм')).toBeUndefined();
    expect(rangeMessage(3000, 1, 3000, 'мм')).toBeUndefined();
  });

  it('ниже минимума — объясняет, а не молчит', () => {
    expect(rangeMessage(0, 1, undefined, 'мм')).toBe('Не меньше 1 мм.');
  });

  it('выше максимума — тоже', () => {
    expect(rangeMessage(4000, 1, 3000, 'мм')).toBe('Не больше 3000 мм.');
  });

  it('единица подставляется в текст', () => {
    expect(rangeMessage(0, 1, undefined, undefined)).toBe('Не меньше 1.');
  });

  it('отсутствующее значение — «введите число»', () => {
    expect(rangeMessage(undefined, 1, 3000, 'мм')).toBe('Введите число.');
  });

  it('без границ ничего не сообщается', () => {
    expect(rangeMessage(-500, undefined, undefined, 'мм')).toBeUndefined();
  });
});
