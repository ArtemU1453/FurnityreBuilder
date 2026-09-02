import type { NodeId, PartId } from './ids.js';

/**
 * Диагностика — доменное понятие, а не UI-сообщение: проблема принадлежит
 * изделию, а не экрану. Поэтому тип живёт в домене, и его одинаково используют
 * геометрический движок и слой валидации.
 */
export type Severity = 'error' | 'warning' | 'info';

export interface IssueTarget {
  readonly nodeId?: NodeId;
  readonly partId?: PartId;
  /** Путь к полю модели: 'furniture.0.dimensions.width'. */
  readonly path?: string;
}

/** Однозначно применимое исправление. Отсутствует, если решений несколько. */
export type IssueFix =
  | { readonly kind: 'clamp'; readonly label: string; readonly value: number }
  | { readonly kind: 'command'; readonly label: string; readonly command: string };

export interface Issue {
  /** Стабильный машинный код: 'DIMENSION_NOT_FINITE', 'CELL_TOO_SMALL'. */
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly target?: IssueTarget;
  readonly fix?: IssueFix;
}

export function issue(
  code: string,
  severity: Severity,
  message: string,
  target?: IssueTarget,
): Issue {
  return { code, severity, message, ...(target === undefined ? {} : { target }) };
}

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === 'error');

export function countBySeverity(issues: readonly Issue[]): Record<Severity, number> {
  const result: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) result[i.severity] += 1;
  return result;
}
