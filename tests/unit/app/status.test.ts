import { describe, expect, it } from 'vitest';
import {
  CHECK_MARK,
  CHECK_STATUS,
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
