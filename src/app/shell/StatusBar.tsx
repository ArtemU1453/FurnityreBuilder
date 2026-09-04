import type { Issue } from '../../domain/index.js';
import type { ProductionStatus } from '../../workflow/index.js';
import { StatusIndicator } from '../../design-system/index.js';
import { PRODUCTION_STATUS, SEVERITY_LABEL, SEVERITY_TONE, summarizeIssues } from '../status.js';
import type { StorageStatus } from '../use-project-storage.js';
import styles from './StatusBar.module.css';

/**
 * Строка состояния (PROMPT 26 §3, §14, §15).
 *
 * Отвечает на три вопроса, которые пользователь обязан видеть всегда:
 * есть ли ошибки, готов ли проект к производству, сохранён ли он.
 * Слова и тона берутся из `src/app/status.ts` — того же места, откуда
 * их берут тулбар и инспектор, поэтому разойтись они не могут.
 *
 * Первая проблема — кнопка: нажатие переводит выделение на затронутый
 * объект, чтобы от текста ошибки можно было дойти до детали, а не
 * искать её глазами. Рядом стоит слово «Ошибка» или «Предупреждение»:
 * §16 требует, чтобы предупреждение не выглядело как ошибка, и цвета
 * для этого мало.
 */

export interface StatusBarProps {
  readonly issues: readonly Issue[];
  readonly production: ProductionStatus | undefined;
  readonly storage: StorageStatus;
  readonly onSelectIssue: (issue: Issue) => void;
}

export function StatusBar(props: StatusBarProps): React.JSX.Element {
  const summary = summarizeIssues(props.issues);
  const production =
    props.production === undefined ? undefined : PRODUCTION_STATUS[props.production];
  const first =
    props.issues.find((issue) => issue.severity === 'error') ??
    props.issues.find((issue) => issue.severity === 'warning');

  return (
    <footer className={styles.bar} aria-label="Состояние проекта">
      <StatusIndicator
        tone={summary.tone}
        label={summary.label}
        {...(summary.hint === undefined ? {} : { detail: summary.hint })}
        live
      />

      {production === undefined ? (
        <StatusIndicator tone="neutral" label="Расчёт недоступен" />
      ) : (
        <StatusIndicator tone={production.tone} label={production.label} />
      )}

      {first === undefined ? null : (
        <button
          type="button"
          className={styles.issue}
          data-tone={SEVERITY_TONE[first.severity]}
          onClick={() => {
            props.onSelectIssue(first);
          }}
        >
          <span className={styles.issueKind}>{SEVERITY_LABEL[first.severity]}:</span>{' '}
          {first.message}
        </button>
      )}
    </footer>
  );
}
