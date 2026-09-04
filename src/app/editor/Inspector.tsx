import { Button } from '../../design-system/index.js';
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
      Имя области — постоянное «Свойства объекта», а не заголовок
      выбранного. Область навигации, которая переименовывается при каждом
      щелчке, бесполезна: в списке ориентиров скринридера она каждый раз
      называется по-разному, и найти её невозможно. Что именно выбрано,
      сообщает заголовок внутри.
    */
    <aside className={styles.inspector} aria-label="Свойства объекта">
      <h2 className={styles.panelTitle}>
        {model.title}
      </h2>
      <p className={styles.subtitle}>{model.subtitle}</p>

      <dl className={styles.rows}>
        {model.rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            <dd className={styles.rowValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

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
    </aside>
  );
}
