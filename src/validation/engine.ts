import type { Issue, Project, Severity } from '../domain/index.js';
import { countBySeverity } from '../domain/index.js';
import { referencesRule } from './rules/references.js';
import { structureRule } from './rules/structure.js';
import { valuesRule } from './rules/values.js';
import type { ValidationReport, ValidationRule } from './types.js';

/**
 * Набор правил фундамента. Мебельные правила (пролёт полки, длина направляющей,
 * количество петель) добавляются позже отдельными правилами — здесь важно,
 * что для этого не нужно менять ни движок, ни вызывающий код.
 */
export const BASE_RULES: readonly ValidationRule[] = [valuesRule, referencesRule, structureRule];

export function validateProject(
  project: Project,
  rules: readonly ValidationRule[] = BASE_RULES,
): ValidationReport {
  const issues: Issue[] = [];
  for (const rule of rules) issues.push(...rule.run(project));

  const counts: Record<Severity, number> = countBySeverity(issues);

  return {
    issues,
    errors: counts.error,
    warnings: counts.warning,
    infos: counts.info,
    canExport: counts.error === 0,
  };
}
