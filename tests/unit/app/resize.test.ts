import { describe, expect, it } from 'vitest';
import { canvasScale, resizeValue } from '../../../src/app/editor/resize.js';

/**
 * Арифметика жеста изменения габарита (PROMPT 22 §21, §23).
 *
 * Проверяется здесь, а не в браузере, ровно потому, что это правила, а не
 * рисование: перевод пикселей в миллиметры, шаг по модификаторам, магниты
 * и упор в границы. В E2E остаётся только то, что нельзя проверить без
 * настоящего указателя — захват и жизненный цикл жеста.
 */

const base = { base: 800, scale: 0.5, min: 100, max: 6000 } as const;

describe('resizeValue', () => {
  it('переводит пиксели экрана в миллиметры по масштабу', () => {
    // 50 px при 0.5 px/мм — это 100 мм изделия, а не 50.
    expect(resizeValue({ ...base, deltaPx: 50 }).value).toBe(900);
  });

  it('учитывает направление: ручка сверху тянется против оси Y', () => {
    expect(resizeValue({ ...base, deltaPx: 50, direction: -1 }).value).toBe(700);
  });

  it('округляет до миллиметра без модификаторов', () => {
    expect(resizeValue({ ...base, deltaPx: 3 }).value).toBe(806);
  });

  it('Shift даёт шаг 10 мм, Alt — 0.1 мм', () => {
    expect(resizeValue({ ...base, deltaPx: 7, modifiers: { shift: true } }).value).toBe(810);
    expect(resizeValue({ ...base, deltaPx: 7, modifiers: { alt: true } }).value).toBeCloseTo(814, 5);
  });

  it('притягивается к магниту и сообщает, к какому именно', () => {
    const result = resizeValue({
      ...base,
      deltaPx: 100,
      candidates: [{ value: 1002, kind: 'align', label: 'край соседа' }],
    });
    expect(result.value).toBe(1002);
    expect(result.snapped?.label).toBe('край соседа');
  });

  it('магнит не срабатывает дальше радиуса притяжения', () => {
    // Радиус 6 px при 0.5 px/мм — это 12 мм. Кандидат в 30 мм не берётся.
    const result = resizeValue({ ...base, deltaPx: 100, candidates: [{ value: 1030, kind: 'align' }] });
    expect(result.value).toBe(1000);
    expect(result.snapped).toBeUndefined();
  });

  it('ограничивает значение границами и сообщает об упоре', () => {
    const result = resizeValue({ ...base, deltaPx: 100_000 });
    expect(result.value).toBe(6000);
    expect(result.clamped).toBe(true);
  });

  it('сохраняет неограниченное значение: интерфейсу нужно показать упор', () => {
    const result = resizeValue({ ...base, deltaPx: -100_000 });
    expect(result.value).toBe(100);
    expect(result.raw).toBeLessThan(0);
  });

  it('не делит на ноль при вырожденном масштабе', () => {
    expect(Number.isFinite(resizeValue({ ...base, scale: 0, deltaPx: 10 }).value)).toBe(true);
  });

  it('нулевое смещение возвращает исходный размер: клик не меняет изделие', () => {
    const result = resizeValue({ ...base, deltaPx: 0 });
    expect(result.value).toBe(800);
    expect(result.clamped).toBe(false);
  });
});

describe('canvasScale', () => {
  it('считает масштаб по фактическому размеру холста на экране', () => {
    expect(canvasScale(600, 1200)).toBe(0.5);
  });

  it('возвращает нейтральный масштаб, пока холст не измерен', () => {
    // До первого layout getBoundingClientRect даёт нули: жест не должен
    // превращать смещение в бесконечность.
    expect(canvasScale(0, 1200)).toBe(1);
    expect(canvasScale(600, 0)).toBe(1);
  });
});
