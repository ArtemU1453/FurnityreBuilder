import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../../src/app/diagnostics.js';
import type { DiagnosticInput } from '../../../src/app/diagnostics.js';
import { createProject } from '../../../src/domain/index.js';

/**
 * Приватность отчёта об ошибке (PROMPT 45 §8, §15).
 *
 * Проверяется не намерение, а фактический текст: то, что человек увидит
 * на экране и скопирует в сообщение об ошибке. Обещание «мы не собираем
 * лишнего» без такой проверки — это обещание, которое разойдётся с кодом
 * при первой же правке.
 */

const INPUT: DiagnosticInput = {
  version: '0.1.0',
  build: '0.1.0 (2026-09-10)',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  category: 'production',
  message: 'Cannot read properties of undefined',
  stack: 'at calculate (index-abc.js:1:2)\nat render (index-abc.js:3:4)',
  at: '2026-09-10T14:00:00.000Z',
};

describe('данные для отчёта об ошибке', () => {
  it('содержат ровно то, что нужно для расследования', () => {
    const report = formatDiagnostics(INPUT);
    expect(report).toContain('0.1.0');
    expect(report).toContain('0.1.0 (2026-09-10)');
    expect(report).toContain('Mozilla/5.0 (X11; Linux x86_64)');
    expect(report).toContain('Производство');
    expect(report).toContain('Cannot read properties of undefined');
    expect(report).toContain('2026-09-10T14:00:00.000Z');
  });

  it('не содержат ни одного значения из проекта пользователя', () => {
    /*
      Проект берётся настоящий, а не выдуманный: список полей, которые
      «нельзя раскрывать», расходится с моделью, а сама модель — нет.
    */
    const project = createProject({ name: 'Шкаф в прихожую' });
    const furniture = project.furniture[0];
    expect(furniture, 'проект по умолчанию без изделия — проверять нечего').toBeDefined();

    const report = formatDiagnostics(INPUT);
    const secrets = [
      project.name,
      project.id,
      String(furniture?.dimensions.width),
      String(furniture?.dimensions.height),
      String(furniture?.dimensions.depth),
      ...Object.values(project.materials.items).map((material) => material.name),
    ];

    for (const secret of secrets) {
      if (secret === '' || secret === 'undefined') continue;
      expect(report, `в отчёт попало значение из проекта: ${secret}`).not.toContain(secret);
    }
  });

  it('не содержат ни адреса, ни признака отправки наружу', () => {
    const report = formatDiagnostics(INPUT);
    expect(report).not.toMatch(/https?:\/\//i);
    expect(report).not.toMatch(/sentry|telemetry|analytics|tracking/i);
    // И прямо говорят человеку, что никуда не уходят.
    expect(report).toContain('никуда их не отправляет');
  });

  it('обрезают стек: отчёт читают перед отправкой, а не пролистывают', () => {
    const long = Array.from({ length: 40 }, (_, index) => `at frame${String(index)} (a.js:1:1)`);
    const report = formatDiagnostics({ ...INPUT, stack: long.join('\n') });
    expect(report).toContain('at frame0 (a.js:1:1)');
    expect(report).toContain('at frame7 (a.js:1:1)');
    expect(report).not.toContain('at frame8 (a.js:1:1)');
  });

  it('без стека отчёт остаётся корректным, а не показывает пустой раздел', () => {
    const report = formatDiagnostics({ ...INPUT, stack: undefined });
    expect(report).not.toContain('Стек:');
    expect(report).toContain('Cannot read properties of undefined');
  });
});
