import { describe, expect, it } from 'vitest';
import {
  RULE_STATUS_WARNING_CODES,
  describeReadiness,
  orderConfirmations,
  severityLabel,
  summarizeReadiness,
} from '../../../src/app/production/readiness-summary.js';
import { collectConfirmations } from '../../../src/bom/confirmations.js';
import { validateProductionReadiness } from '../../../src/workflow/index.js';
import { FIXTURES } from '../integration/fixtures.js';
import { calculateProduction } from '../../../src/bom/index.js';
import type { ConfirmationItem } from '../../../src/bom/index.js';
import type { ProductionReadinessResult } from '../../../src/workflow/index.js';

/**
 * Состояние производственного результата одной строкой (PROMPT 63 §8, §16).
 *
 * Проверяется РАЗБОР, а не вёрстка: сколько правил требует действия,
 * сколько к сведению, что из этого произносится и в каком порядке.
 * Раскладка панелей меряется отдельно — сквозными сценариями.
 */

const item = (over: Partial<ConfirmationItem> = {}): ConfirmationItem => ({
  id: 'T-X-01',
  category: 'HARDWARE',
  rule: 'Правило',
  source: 'src/hardware/rules/x',
  impact: 'Влияние',
  severity: 'informational',
  ...over,
});

const readiness = (over: Partial<ProductionReadinessResult> = {}): ProductionReadinessResult => ({
  status: 'NEEDS_CONFIRMATION',
  calculationStatus: 'NEEDS_CONFIRMATION',
  checks: [],
  errors: [],
  warnings: [],
  needsConfirmation: [],
  ...over,
});

describe('тяжесть допущений выведена из поведения правила (§7)', () => {
  it('правило без результата требует действия, правило с результатом — к сведению', () => {
    const items = collectConfirmations();
    const byId = new Map(items.map((entry) => [`${entry.id}|${entry.rule}`, entry]));

    // `needs-confirmation`: позиции в спецификации НЕТ.
    const hinge = [...byId.values()].find((entry) => entry.id === 'T-DOOR-05');
    expect(hinge?.severity).toBe('action-required');

    // `ambiguous`: количество посчитано, характеристика не подтверждена.
    const slides = [...byId.values()].find((entry) => entry.id === 'T-DRW-01');
    expect(slides?.severity).toBe('informational');

    // Короб ящика: деталей нет вовсе — значит действие требуется.
    const drawerBox = [...byId.values()].find((entry) => entry.id === 'T-DRW-02');
    expect(drawerBox?.severity).toBe('action-required');

    // Ширина пропила: листы посчитаны, расходится может только число.
    const kerf = [...byId.values()].find((entry) => entry.id === 'T-CUT-01');
    expect(kerf?.severity).toBe('informational');
  });

  it('у каждого допущения тяжесть проставлена', () => {
    for (const entry of collectConfirmations()) {
      expect(['action-required', 'informational'], entry.id).toContain(entry.severity);
    }
  });

  it('обе тяжести названы словами, а не значением перечисления', () => {
    expect(severityLabel('action-required')).toBe('нужно уточнить до заказа');
    expect(severityLabel('informational')).toBe('к сведению');
    for (const label of [severityLabel('action-required'), severityLabel('informational')]) {
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe('summarizeReadiness', () => {
  it('чистый результат назван чистым', () => {
    const summary = summarizeReadiness(readiness({ status: 'READY_FOR_PRODUCTION' }));
    expect(summary).toEqual({
      blocking: 0,
      actionRequired: 0,
      informational: 0,
      warnings: 0,
      clean: true,
    });
  });

  it('допущения разложены по тяжести', () => {
    const summary = summarizeReadiness(
      readiness({
        needsConfirmation: [
          item({ id: 'a', severity: 'action-required' }),
          item({ id: 'b', severity: 'action-required' }),
          item({ id: 'c', severity: 'informational' }),
        ],
      }),
    );
    expect(summary.actionRequired).toBe(2);
    expect(summary.informational).toBe(1);
    expect(summary.clean).toBe(false);
  });

  it('ошибки расчёта считаются отдельно от допущений', () => {
    const summary = summarizeReadiness(
      readiness({
        errors: [{ code: 'X', severity: 'error', message: 'нельзя' }],
        needsConfirmation: [item()],
      }),
    );
    expect(summary.blocking).toBe(1);
    expect(summary.informational).toBe(1);
  });
});

describe('describeReadiness — порядок и склонение', () => {
  it('сначала то, что мешает изготовить', () => {
    const text = describeReadiness({
      blocking: 1,
      warnings: 2,
      actionRequired: 3,
      informational: 4,
      clean: false,
    });
    expect(text).toEqual([
      '1 ошибка расчёта',
      '2 замечания',
      '3 правила без результата',
      '4 допущения к сведению',
    ]);
  });

  it('ноль не произносится: искать нечего — значит и говорить не о чем', () => {
    expect(
      describeReadiness({
        blocking: 0,
        warnings: 0,
        actionRequired: 2,
        informational: 0,
        clean: false,
      }),
    ).toEqual(['2 правила без результата']);
  });

  it('склонение по числу, а не «3 правило»', () => {
    const of = (n: number): string =>
      describeReadiness({ blocking: 0, warnings: 0, actionRequired: n, informational: 0, clean: false })[0] ?? '';
    expect(of(1)).toBe('1 правило без результата');
    expect(of(2)).toBe('2 правила без результата');
    expect(of(5)).toBe('5 правил без результата');
    expect(of(11)).toBe('11 правил без результата');
    expect(of(21)).toBe('21 правило без результата');
  });
});

describe('orderConfirmations', () => {
  it('сначала то, из-за чего чего-то нет в результате', () => {
    const ordered = orderConfirmations([
      item({ id: 'info', severity: 'informational' }),
      item({ id: 'act', severity: 'action-required' }),
      item({ id: 'info2', severity: 'informational' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['act', 'info', 'info2']);
  });

  it('техническая ссылка сохранена, но названа своим полем (§16)', () => {
    const [view] = orderConfirmations([item({ source: 'src/hardware/rules/hinge' })]);
    expect(view?.source).toBe('src/hardware/rules/hinge');
    expect(view?.impact).toBe('Влияние');
    expect(view?.severityLabel).toBe('к сведению');
  });
});

describe('замечания не удваивают допущения (§11)', () => {
  const project = FIXTURES.complex();
  const state = validateProductionReadiness(project, {
    calculation: calculateProduction(project),
  });

  /**
   * Исключение обязано быть безопасным: каждое пропущенное замечание
   * говорит о правиле, которое УЖЕ есть в списке допущений. Иначе
   * исключение прячет настоящий риск, а не убирает повтор.
   */
  it('каждое исключённое замечание имеет пару среди допущений', () => {
    const excluded = state.warnings.filter((issue) =>
      RULE_STATUS_WARNING_CODES.includes(issue.code),
    );
    expect(excluded.length).toBeGreaterThan(0);
    expect(state.needsConfirmation.length).toBeGreaterThanOrEqual(excluded.length);
  });

  it('замечания со своей причиной считаются как были', () => {
    const summary = summarizeReadiness(state);
    const own = state.warnings.filter(
      (issue) => !RULE_STATUS_WARNING_CODES.includes(issue.code),
    );
    expect(summary.warnings).toBe(own.length);
    expect(own.map((issue) => issue.code)).toContain('MATERIAL_NOT_ASSIGNED');
  });

  it('ни одно допущение не потеряно: их считают полностью', () => {
    const summary = summarizeReadiness(state);
    expect(summary.actionRequired + summary.informational).toBe(state.needsConfirmation.length);
  });
});

describe('разбор реального проекта', () => {
  const project = FIXTURES.complex();
  const result = calculateProduction(project);
  const state = validateProductionReadiness(project, { calculation: result });

  it('числа сводки сходятся с самим результатом', () => {
    const summary = summarizeReadiness(state);
    expect(summary.blocking).toBe(state.errors.length);
    expect(summary.actionRequired + summary.informational).toBe(state.needsConfirmation.length);
    expect(summary.clean).toBe(false);
  });

  it('в реальном проекте есть обе тяжести — значит деление не формальное', () => {
    const summary = summarizeReadiness(state);
    expect(summary.actionRequired).toBeGreaterThan(0);
    expect(summary.informational).toBeGreaterThan(0);
  });
});
