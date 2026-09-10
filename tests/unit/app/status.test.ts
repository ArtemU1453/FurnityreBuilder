import { describe, expect, it } from 'vitest';
import {
  CHECK_MARK,
  CHECK_STATUS,
  dedupeIssues,
  PRODUCTION_STATUS,
  PROJECT_STATUS,
  ROOM_STATUS,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  STORAGE_STATUS,
  summarizeIssues,
} from '../../../src/app/status.js';

/**
 * Единый язык состояний (PROMPT 26 §14–§17).
 *
 * Смысл этих проверок не в том, что «строки не пустые», а в том, что
 * словарь один. До этого этапа один и тот же `ProductionStatus`
 * подписывался тремя разными наборами слов одновременно на одном экране.
 */

const ALL = [PRODUCTION_STATUS, ROOM_STATUS, PROJECT_STATUS, STORAGE_STATUS, CHECK_STATUS];

describe('полнота словаря', () => {
  it('у каждого состояния есть подпись, короткая подпись и тон', () => {
    for (const table of ALL) {
      for (const [key, view] of Object.entries(table)) {
        expect(view.label, key).not.toBe('');
        expect(view.short, key).not.toBe('');
        expect(['neutral', 'info', 'success', 'warning', 'danger']).toContain(view.tone);
      }
    }
  });

  it('короткая подпись действительно короче или равна полной', () => {
    // Короткая живёт в тулбаре, где места на предложение нет.
    for (const table of ALL) {
      for (const [key, view] of Object.entries(table)) {
        expect(view.short.length, key).toBeLessThanOrEqual(view.label.length);
      }
    }
  });
});

describe('различимость уровней (§16–§17)', () => {
  it('ошибка и предупреждение — разные тона', () => {
    expect(PRODUCTION_STATUS.INVALID.tone).toBe('danger');
    expect(PRODUCTION_STATUS.HAS_WARNINGS.tone).toBe('warning');
    expect(PRODUCTION_STATUS.INVALID.tone).not.toBe(PRODUCTION_STATUS.HAS_WARNINGS.tone);
  });

  it('«нужно подтверждение» не выглядит ошибкой', () => {
    // Неизвестное правило — не поломка проекта, и красным оно быть не
    // должно: иначе исправлять начнут то, что исправно.
    expect(PRODUCTION_STATUS.NEEDS_CONFIRMATION.tone).not.toBe('danger');
    expect(ROOM_STATUS.NEEDS_CONFIRMATION.tone).not.toBe('danger');
    expect(CHECK_STATUS.NEEDS_CONFIRMATION.tone).not.toBe('danger');
  });

  it('«нужно подтверждение» объясняет, ЧТО неизвестно', () => {
    expect(PRODUCTION_STATUS.NEEDS_CONFIRMATION.hint).toContain('не подтверждена');
    expect(ROOM_STATUS.NEEDS_CONFIRMATION.hint).toContain('не подтверждены');
  });

  it('значок дублирует тон формой: цвет не единственный носитель смысла', () => {
    const marks = Object.values(CHECK_MARK);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('уровень проблемы отображается в тон и в слово', () => {
    expect(SEVERITY_TONE.error).toBe('danger');
    expect(SEVERITY_TONE.warning).toBe('warning');
    // info не выделяется цветом: сообщение уровня info действия не
    // требует, и звать к нему цветом незачем.
    expect(SEVERITY_TONE.info).toBe('neutral');
    expect(SEVERITY_LABEL.error).not.toBe(SEVERITY_LABEL.warning);
  });
});

describe('состояние сохранения (§22)', () => {
  it('«сохранено» показывается нейтрально, а не как достижение', () => {
    // Зелёная галочка после каждой записи превращается в шум, который
    // перестают замечать — вместе с сообщением о неудаче.
    expect(STORAGE_STATUS.saved.tone).toBe('neutral');
  });

  it('несохранённые изменения и ошибка записи различимы', () => {
    expect(STORAGE_STATUS.unsaved.tone).toBe('warning');
    expect(STORAGE_STATUS.error.tone).toBe('danger');
  });

  it('несохранённое объясняет, почему автосохранения нет', () => {
    expect(STORAGE_STATUS.unsaved.hint).toContain('Автосохранения нет');
  });
});

describe('сводка по проблемам', () => {
  const err = { severity: 'error' } as const;
  const warn = { severity: 'warning' } as const;
  const info = { severity: 'info' } as const;

  it('без проблем — успех', () => {
    expect(summarizeIssues([])).toMatchObject({ tone: 'success' });
    expect(summarizeIssues([info])).toMatchObject({ tone: 'success' });
  });

  it('ошибка перевешивает предупреждение', () => {
    const view = summarizeIssues([warn, err, warn]);
    expect(view.tone).toBe('danger');
    expect(view.label).toContain('1');
    expect(view.hint).toContain('2');
  });

  it('только предупреждения — предупреждающий тон', () => {
    expect(summarizeIssues([warn, warn])).toMatchObject({ tone: 'warning' });
  });

  it('сообщения уровня info в счёт не идут', () => {
    expect(summarizeIssues([info, info]).tone).toBe('success');
  });
});

describe('состояние записи не пугает раньше времени (PROMPT 38, дефект П-002)', () => {
  /*
    Новый проект и проект с несохранёнными правками — разные состояния, и
    разными их делает не оттенок, а утверждение. «Есть несохранённые
    изменения» говорит человеку, что он может потерять работу. Сказанное
    тому, кто только открыл приложение и ничего не трогал, оно ложно.

    Так и было: приложение объявляло об изменениях на первом же экране.
    Предупреждение, срабатывающее всегда, читать перестают — и не
    прочитают тогда, когда терять действительно есть что.
  */
  it('у нового проекта своё состояние, а не «несохранённые изменения»', () => {
    expect(STORAGE_STATUS.new).toBeDefined();
    expect(STORAGE_STATUS.new.label).not.toContain('изменени');
  });

  it('новый проект не тревожит: тон нейтральный', () => {
    // Предупреждающий тон приберегается для настоящей потери работы.
    expect(STORAGE_STATUS.new.tone).toBe('neutral');
    expect(STORAGE_STATUS.unsaved.tone).toBe('warning');
  });

  it('об изменениях говорит только состояние, где они есть', () => {
    expect(STORAGE_STATUS.unsaved.label).toContain('изменени');
  });

  it('состояния различимы: подписи не совпадают', () => {
    expect(STORAGE_STATUS.new.label).not.toBe(STORAGE_STATUS.unsaved.label);
    expect(STORAGE_STATUS.new.label).not.toBe(STORAGE_STATUS.saved.label);
  });
});

describe('одна проблема — одна строка (PROMPT 38, дефект П-005)', () => {
  /*
    Список проблем склеен из диагностики движка и отчёта валидации. Оба
    слоя проверяют вход независимо — это верно, и менять это незачем. Но
    пользователю доставалось одно и то же предложение дважды подряд, и
    вторую строку он читал как второй дефект.
  */
  const err = (message: string) => ({ severity: 'error' as const, message, code: 'X' });

  it('одинаковые сообщения одного уровня схлопываются', () => {
    const out = dedupeIssues([err('Ширина должна быть больше нуля.'), err('Ширина должна быть больше нуля.')]);
    expect(out).toHaveLength(1);
  });

  it('остаётся первое вхождение: у него привязка к шагу', () => {
    // Первой идёт диагностика движка — её путь ведёт к шагу конструктора.
    const first = { severity: 'error' as const, message: 'та же фраза', code: 'DIMENSION_NOT_POSITIVE' };
    const second = { severity: 'error' as const, message: 'та же фраза', code: 'VALUE_NOT_POSITIVE' };
    expect(dedupeIssues([first, second])[0]).toBe(first);
  });

  it('разные сообщения остаются оба', () => {
    expect(dedupeIssues([err('первое'), err('второе')])).toHaveLength(2);
  });

  it('один текст разного уровня — разные проблемы', () => {
    const out = dedupeIssues([
      { severity: 'error' as const, message: 'текст' },
      { severity: 'warning' as const, message: 'текст' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('порядок сохраняется', () => {
    const out = dedupeIssues([err('а'), err('б'), err('а'), err('в')]);
    expect(out.map((i) => i.message)).toEqual(['а', 'б', 'в']);
  });

  it('пустой список остаётся пустым', () => {
    expect(dedupeIssues([])).toEqual([]);
  });
});
