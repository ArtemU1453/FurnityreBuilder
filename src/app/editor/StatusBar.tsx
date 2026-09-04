import type { Issue } from '../../domain/index.js';
import type { ProductionStatus } from '../../workflow/index.js';
import type { StorageStatus } from '../use-project-storage.js';
import styles from './EditorPanels.module.css';

/**
 * Строка состояния (PROMPT 22 §27–§29).
 *
 * Три вещи, которые пользователь обязан видеть постоянно: сколько ошибок
 * в проекте, готов ли он к производству и сохранён ли. Статус
 * производства берётся из того же расчёта, что и всё остальное, поэтому
 * устаревшим он быть не может (PROMPT 21): показывать «актуально на
 * момент N» здесь нечего.
 */

const PRODUCTION_LABELS: Readonly<Record<ProductionStatus, string>> = {
  READY_FOR_PRODUCTION: 'Готово к производству',
  HAS_WARNINGS: 'Готово с замечаниями',
  NEEDS_CONFIRMATION: 'Требуется подтверждение правил',
  INVALID: 'Изготовление невозможно',
};

const STORAGE_LABELS: Readonly<Record<StorageStatus, string>> = {
  saved: 'Сохранено',
  unsaved: 'Есть несохранённые изменения',
  saving: 'Сохранение…',
  error: 'Ошибка сохранения',
};

export interface StatusBarProps {
  readonly issues: readonly Issue[];
  readonly production: ProductionStatus | undefined;
  readonly storage: StorageStatus;
  readonly storageMessage: string;
  readonly ephemeral: boolean;
  readonly onSelectIssue: (issue: Issue) => void;
}

export function StatusBar(props: StatusBarProps): React.JSX.Element {
  const errors = props.issues.filter((issue) => issue.severity === 'error');
  const warnings = props.issues.filter((issue) => issue.severity === 'warning');
  const first = errors[0] ?? warnings[0];

  return (
    <footer className={styles.statusBar} aria-label="Состояние проекта">
      <span className={styles.statusItem} data-tone={errors.length > 0 ? 'error' : 'muted'}>
        Ошибок: {errors.length} · предупреждений: {warnings.length}
      </span>

      <span className={styles.statusItem} data-tone={props.production === 'INVALID' ? 'error' : 'muted'}>
        {props.production === undefined ? 'Расчёт недоступен' : PRODUCTION_LABELS[props.production]}
      </span>

      <span className={styles.statusItem} data-tone={props.storage === 'error' ? 'error' : 'muted'}>
        {STORAGE_LABELS[props.storage]}
        {props.ephemeral ? ' · хранилище недоступно, только память вкладки' : ''}
      </span>

      {/*
        Первая проблема — кликабельна: она переводит выделение на
        затронутый объект, чтобы от текста ошибки можно было дойти до
        детали, а не искать её глазами (§29).
      */}
      {first === undefined ? null : (
        <button
          type="button"
          className={styles.statusIssue}
          onClick={() => {
            props.onSelectIssue(first);
          }}
        >
          {first.message}
        </button>
      )}
    </footer>
  );
}
