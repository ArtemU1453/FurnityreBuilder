import { Button, IconButton, StatusIndicator } from '../../design-system/index.js';
import type { ProductionStatus } from '../../workflow/index.js';
import { PRODUCTION_STATUS } from '../status.js';
import type { StorageStatus } from '../use-project-storage.js';

/**
 * Глобальные действия верхней строки (PROMPT 26 §4, §21, §22).
 *
 * ## Отмена и повтор — иконками, но с именем
 *
 * Стрелки понятны без слов, и место в строке дорого. Но `label` — не
 * украшение: он уходит в `aria-label` и во всплывающую подсказку вместе
 * с сочетанием клавиш, поэтому кнопка остаётся и понятной, и доступной.
 * Отключённое состояние соответствует истории: отменять нечего —
 * кнопка неактивна, и это видно раньше, чем по ней нажали.
 *
 * ## Сохранение — одна кнопка с одним состоянием
 *
 * Слово на кнопке и есть обратная связь. Всплывающего уведомления после
 * записи нет намеренно (§22): подтверждение того, что и так очевидно,
 * превращается в шум, который перестают замечать — а вместе с ним
 * перестают замечать и сообщение о неудаче.
 */

export interface TopActionsProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly storage: StorageStatus;
  readonly production: ProductionStatus | undefined;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSave: () => void;
}

export function TopActions(props: TopActionsProps): React.JSX.Element {
  const production =
    props.production === undefined ? undefined : PRODUCTION_STATUS[props.production];

  return (
    <>
      {production === undefined ? null : (
        <StatusIndicator tone={production.tone} label={production.short} compact />
      )}

      <IconButton label="Отменить · Ctrl+Z" onClick={props.onUndo} disabled={!props.canUndo}>
        ↶
      </IconButton>
      <IconButton label="Вернуть · Ctrl+Shift+Z" onClick={props.onRedo} disabled={!props.canRedo}>
        ↷
      </IconButton>

      <Button
        variant="primary"
        onClick={props.onSave}
        loading={props.storage === 'saving'}
        disabled={props.storage === 'saving' || props.storage === 'saved'}
      >
        {props.storage === 'saved' ? 'Сохранено' : 'Сохранить'}
      </Button>
    </>
  );
}
