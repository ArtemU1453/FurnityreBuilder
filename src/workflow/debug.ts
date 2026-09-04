import type { ProductionPackage, ProductionReadinessResult } from './types.js';

/**
 * Технический вывод готовности (PROMPT 21 §17).
 *
 * Ни одной проверки здесь не выполняется: строки собираются из
 * `ProductionReadinessResult`. Это тот же принцип, что у остальных
 * технических выводов проекта, и та же причина: представление, которое
 * считает само, рано или поздно покажет не то, что посчитал домен.
 */

const CHECK_MARK: Readonly<Record<string, string>> = {
  PASS: '✓',
  WARNING: '!',
  ERROR: '✕',
  NEEDS_CONFIRMATION: '?',
};

export function formatReadinessDebug(readiness: ProductionReadinessResult): readonly string[] {
  const lines: string[] = [`СТАТУС: ${readiness.status} · расчёт: ${readiness.calculationStatus}`];

  for (const check of readiness.checks) {
    lines.push(`${CHECK_MARK[check.status] ?? '·'} ${check.title} · ${check.status} · ${check.details}`);
    for (const error of check.errors) lines.push(`    ОШИБКА · ${error.code} · ${error.message}`);
    for (const warning of check.warnings) lines.push(`    ПРЕДУПРЕЖДЕНИЕ · ${warning.code} · ${warning.message}`);
    for (const item of check.needsConfirmation) {
      lines.push(`    ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ · ${item.id} · ${item.rule}`);
    }
  }

  return lines;
}

export function formatPackageDebug(productionPackage: ProductionPackage): readonly string[] {
  return [
    `ПАКЕТ · ${productionPackage.projectName} · ${productionPackage.status}`,
    `Позиций деталей: ${String(productionPackage.exports.totals.partPositions)} · деталей: ${String(
      productionPackage.exports.totals.partQuantity,
    )} · фурнитуры: ${String(productionPackage.exports.totals.hardwarePositions)} · операций присадки: ${String(
      productionPackage.exports.totals.drillingOperations,
    )} · листов: ${String(productionPackage.exports.totals.sheetCount)}`,
    ...formatReadinessDebug(productionPackage.readiness),
  ];
}
