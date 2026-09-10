import { describe, expect, it } from 'vitest';
import { describeLoadFailure } from '../../../src/app/load-failure.js';

/**
 * Разбор отказов отложенной загрузки (PROMPT 45 §5, §12, §13).
 *
 * Проверяется главное различие, ради которого модуль существует: не
 * «ошибка распознана», а «предложено ли действие, которое действительно
 * чинит». Предложить перезагрузку там, где она не помогает, — значит
 * научить перезагружаться на любую беду.
 */

describe('отказ отложенной загрузки', () => {
  it('несостоявшийся динамический импорт объясняется устаревшей вкладкой', () => {
    const failure = describeLoadFailure(
      new Error('Failed to fetch dynamically imported module: /assets/pdf-Bha8qjkg.js'),
    );
    expect(failure.kind).toBe('chunk');
    expect(failure.action).toBe('reload');
    expect(failure.message).toContain('новой версии');
    // Ни адреса чанка, ни английской строки движка в тексте для человека.
    expect(failure.message).not.toContain('pdf-Bha8qjkg');
    expect(failure.message).not.toContain('Failed to fetch');
  });

  it('HTML вместо модуля — тот же случай: хостинг отдал 404-страницу', () => {
    const failure = describeLoadFailure(
      new Error(
        "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
      ),
    );
    expect(failure.kind).toBe('chunk');
    expect(failure.action).toBe('reload');
  });

  it('пропавшая сеть предлагает повтор, а не перезагрузку', () => {
    const failure = describeLoadFailure(new TypeError('Failed to fetch'));
    expect(failure.kind).toBe('offline');
    expect(failure.action).toBe('retry');
  });

  it('обычная ошибка расчёта не подменяется советом перезагрузиться', () => {
    const failure = describeLoadFailure(new Error('Шрифт для PDF не загрузился (404).'));
    expect(failure.kind).toBe('unknown');
    expect(failure.action).toBe('none');
    // Сообщение остаётся тем, что написал автор ошибки: оно уже понятно.
    expect(failure.message).toBe('Шрифт для PDF не загрузился (404).');
  });

  it('брошенное не-исключение не роняет разбор', () => {
    expect(describeLoadFailure('строка вместо ошибки').kind).toBe('unknown');
    expect(describeLoadFailure(undefined).action).toBe('none');
  });
});
