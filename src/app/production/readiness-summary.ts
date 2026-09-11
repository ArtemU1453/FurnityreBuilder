import type { ConfirmationItem, ConfirmationSeverity } from '../../bom/index.js';
import type { ProductionReadinessResult } from '../../workflow/index.js';

/**
 * Компактное состояние производственного результата (PROMPT 63 §8, §16).
 *
 * ## Зачем отдельный модуль
 *
 * До `FR-20` раздел «Производство» открывался «Сводкой», к которой был
 * приклеен ВЕСЬ чеклист готовности со списком неподтверждённых правил.
 * Измерено на собранном приложении: список занимал 80.0 %, 81.6 % и
 * 82.3 % высоты страницы при окнах 1280 × 800, 1440 × 900 и
 * 1920 × 1080. Человек, пришедший за раскроем, первым делом читал, какие
 * внутренние правила ещё не подтверждены.
 *
 * Список никуда не девается — он переезжает в свой раздел, а на входе
 * остаётся строка состояния. Чтобы её содержимое можно было проверить
 * без отрисовки, разбор живёт здесь: чистая функция над уже посчитанным
 * результатом.
 *
 * ## Ничего не считает заново
 *
 * Ни одной производственной величины: всё приходит из
 * `ProductionReadinessResult`. Сводка, которая считает сама, рано или
 * поздно разойдётся с тем, что обещает.
 */

export interface ReadinessSummary {
  /** Ошибки расчёта: результату нельзя верить, пока они есть. */
  readonly blocking: number;
  /** Позиций или деталей НЕТ в результате — их нельзя купить и распилить. */
  readonly actionRequired: number;
  /** Результат посчитан; неподтверждённым осталось значение. */
  readonly informational: number;
  /** Замечания расчёта, не являющиеся ошибками. */
  readonly warnings: number;
  /** Есть ли вообще о чём говорить. */
  readonly clean: boolean;
}

/**
 * Замечания, которые ПОВТОРЯЮТ неподтверждённое правило.
 *
 * Правило со статусом `needs-confirmation` или `ambiguous` порождает
 * сразу две записи: строку в списке допущений и `Issue`-замечание о том
 * же самом. Считать обе — значит удвоить тревогу: в целевом проекте это
 * давало «13 замечаний · 13 правил без результата», где 13 замечаний
 * были теми же тринадцатью правилами.
 *
 * Замечания, у которых своей причины нет, из счёта исключаются. Те, что
 * говорят о чём-то ещё (`MATERIAL_NOT_ASSIGNED`), считаются как были.
 * Проверяется тестом: каждое исключённое замечание обязано иметь пару в
 * списке допущений, иначе исключение прячет настоящий риск (§11).
 */
export const RULE_STATUS_WARNING_CODES: readonly string[] = [
  'HARDWARE_RULE_NEEDS_CONFIRMATION',
  'HARDWARE_RULE_AMBIGUOUS',
  'DRILLING_RELATION_NOT_MODELLED',
  'DRILLING_PARAMETERS_NOT_CONFIRMED',
];

const bySeverity = (
  items: readonly ConfirmationItem[],
  severity: ConfirmationSeverity,
): number => items.filter((item) => item.severity === severity).length;

export function summarizeReadiness(readiness: ProductionReadinessResult): ReadinessSummary {
  const blocking = readiness.errors.length;
  const actionRequired = bySeverity(readiness.needsConfirmation, 'action-required');
  const informational = bySeverity(readiness.needsConfirmation, 'informational');
  const warnings = readiness.warnings.filter(
    (issue) => !RULE_STATUS_WARNING_CODES.includes(issue.code),
  ).length;
  return {
    blocking,
    actionRequired,
    informational,
    warnings,
    clean: blocking + actionRequired + informational + warnings === 0,
  };
}

/**
 * Строка состояния для человека.
 *
 * Порядок обязателен (§8): сначала то, что мешает изготовить, потом то,
 * что стоит знать. Ноль не произносится — «0 ошибок» заставляет искать
 * ошибки там, где их нет.
 */
export function describeReadiness(summary: ReadinessSummary): readonly string[] {
  const out: string[] = [];
  if (summary.blocking > 0) out.push(`${plural(summary.blocking, 'ошибка', 'ошибки', 'ошибок')} расчёта`);
  if (summary.warnings > 0) out.push(`${plural(summary.warnings, 'замечание', 'замечания', 'замечаний')}`);
  if (summary.actionRequired > 0) {
    out.push(`${plural(summary.actionRequired, 'правило', 'правила', 'правил')} без результата`);
  }
  if (summary.informational > 0) {
    out.push(`${plural(summary.informational, 'допущение', 'допущения', 'допущений')} к сведению`);
  }
  return out;
}

/**
 * Русское склонение по числу.
 *
 * Нужно ровно здесь и нигде больше: «3 правила», а не «3 правило».
 * Заводить ради этого зависимость не за чем — правило одно и короткое.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${String(count)} ${word}`;
}

/**
 * Что показывать первым в разделе «Готовность»: смысл, потом источник
 * (§9, §10).
 *
 * `ConfirmationItem.source` — путь к месту в коде. Он остаётся
 * доступным, но перестаёт быть первым, что человек читает: сначала
 * какое правило неизвестно и на что это влияет.
 */
export interface ConfirmationView {
  readonly id: string;
  readonly rule: string;
  readonly impact: string;
  readonly severity: ConfirmationSeverity;
  readonly severityLabel: string;
  /** Техническая ссылка. Показывается только по требованию. */
  readonly source: string;
}

const SEVERITY_LABELS: Readonly<Record<ConfirmationSeverity, string>> = {
  'action-required': 'нужно уточнить до заказа',
  informational: 'к сведению',
};

export function severityLabel(severity: ConfirmationSeverity): string {
  return SEVERITY_LABELS[severity];
}

/**
 * Допущения в порядке чтения: сначала те, из-за которых чего-то НЕТ в
 * результате.
 */
export function orderConfirmations(
  items: readonly ConfirmationItem[],
): readonly ConfirmationView[] {
  const weight = (item: ConfirmationItem): number => (item.severity === 'action-required' ? 0 : 1);
  return [...items]
    .sort((a, b) => weight(a) - weight(b))
    .map((item) => ({
      id: item.id,
      rule: item.rule,
      impact: item.impact,
      severity: item.severity,
      severityLabel: severityLabel(item.severity),
      source: item.source,
    }));
}
