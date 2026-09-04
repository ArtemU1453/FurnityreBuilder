import { Button } from '../../design-system/index.js';
import type { ProductionStatus } from '../../workflow/index.js';
import type { StorageStatus } from '../use-project-storage.js';
import styles from './EditorPanels.module.css';

/**
 * Тулбар редактора (PROMPT 22 §3).
 *
 * Действия документа: отмена, повтор, сохранение и экспорт. Состояние
 * сохранения и статус производства показаны здесь же — это то, что
 * пользователь должен видеть, не открывая панелей.
 */

const PRODUCTION_SHORT: Readonly<Record<ProductionStatus, string>> = {
  READY_FOR_PRODUCTION: 'Готово',
  HAS_WARNINGS: 'Замечания',
  NEEDS_CONFIRMATION: 'Нужно подтверждение',
  INVALID: 'Ошибки',
};

export interface ToolbarProps {
  readonly projectName: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly storage: StorageStatus;
  readonly storageMessage: string;
  readonly production: ProductionStatus | undefined;
  readonly exporting: 'pdf' | 'xlsx' | null;
  /** Открыта ли библиотека проектов (PROMPT 25 §6). */
  readonly libraryOpen: boolean;
  readonly onToggleLibrary: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSave: () => void;
  readonly onExport: (kind: 'pdf' | 'xlsx') => void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  return (
    <header className={styles.toolbar}>
      <h1 className={styles.toolbarTitle}>{props.projectName}</h1>

      {props.production === undefined ? null : (
        <span className={styles.chip} data-status={props.production}>
          {PRODUCTION_SHORT[props.production]}
        </span>
      )}

      <span className={styles.toolbarSpacer} />

      {/*
        Библиотека — переключатель, а не отдельный экран со своим
        адресом: маршрутизации в приложении нет, и заводить её ради
        одной панели значило бы построить вторую навигацию рядом с
        существующим переключателем видов (PROMPT 25 §1).
      */}
      <Button onClick={props.onToggleLibrary} pressed={props.libraryOpen} aria-expanded={props.libraryOpen}>
        Мои проекты
      </Button>
      <Button onClick={props.onUndo} disabled={!props.canUndo} aria-label="Отменить">
        Отменить
      </Button>
      <Button onClick={props.onRedo} disabled={!props.canRedo} aria-label="Вернуть">
        Вернуть
      </Button>
      <Button
        variant="primary"
        onClick={props.onSave}
        loading={props.storage === 'saving'}
        disabled={props.storage === 'saving' || props.storage === 'saved'}
      >
        {props.storage === 'saved' ? 'Сохранено' : 'Сохранить'}
      </Button>
      <Button
        onClick={() => {
          props.onExport('pdf');
        }}
        loading={props.exporting === 'pdf'}
        disabled={props.exporting !== null}
      >
        PDF
      </Button>
      <Button
        onClick={() => {
          props.onExport('xlsx');
        }}
        loading={props.exporting === 'xlsx'}
        disabled={props.exporting !== null}
      >
        XLSX
      </Button>

      {/* Состояние сохранения — текстом и для скринридера: «кнопка стала
          неактивной» само по себе ничего не объясняет. */}
      <span className={styles.toolbarState} role="status" aria-live="polite">
        {props.storageMessage}
      </span>
    </header>
  );
}
