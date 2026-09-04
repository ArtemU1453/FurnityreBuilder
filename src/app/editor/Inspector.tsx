import { Button, EmptyState, Panel } from '../../design-system/index.js';
import type { InspectorAction, InspectorModel } from './selection.js';
import styles from './EditorPanels.module.css';

/**
 * Инспектор выбранного объекта (PROMPT 22 §6).
 *
 * Показывает то, что уже посчитано, и предлагает только применимые
 * действия: набор действий приходит из `describeSelection`, который знает
 * состояние ячейки. Кнопка «Добавить дверь» на ячейке с ящиками не
 * прячется условием в разметке — её просто нет в модели (§12).
 */

const ACTION_LABELS: Readonly<Record<InspectorAction['kind'], string>> = {
  'add-door': 'Добавить дверь',
  'remove-door': 'Убрать дверь',
  'add-drawers': 'Добавить ящики',
  'add-shelves': 'Добавить полки',
  'clear-fill': 'Очистить ячейку',
};

export interface InspectorProps {
  readonly model: InspectorModel;
  readonly onAction: (action: InspectorAction) => void;
}

export function Inspector({ model, onAction }: InspectorProps): React.JSX.Element {
  return (
    /*
      Панель, а не собственная разметка: заголовок, подзаголовок и
      отступы у инспектора те же, что у любой другой панели приложения
      (PROMPT 26 §12).

      Постоянное имя ориентира «Свойства объекта» задаёт `<aside>`
      вокруг: заголовок панели меняется с выделением, а область,
      которая переименовывается при каждом щелчке, в списке ориентиров
      скринридера ненаходима. Что именно выбрано, сообщает заголовок.
    */
    <Panel id="inspector" title={model.title} subtitle={model.subtitle}>
      <dl className={styles.rows}>
        {model.rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            <dd className={styles.rowValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {model.rows.length === 0 && model.actions.length === 0 ? (
        <EmptyState
          compact
          title="Ничего не выбрано"
          description="Выберите деталь, ячейку или секцию на холсте — здесь появятся её свойства и доступные действия."
        />
      ) : null}

      {model.actions.length === 0 ? null : (
        <div className={styles.actions}>
          {model.actions.map((action) => (
            <Button
              key={`${action.kind}-${'nodeId' in action ? String(action.nodeId) : String(action.facadeId)}`}
              onClick={() => {
                onAction(action);
              }}
            >
              {ACTION_LABELS[action.kind]}
            </Button>
          ))}
        </div>
      )}
    </Panel>
  );
}
