import { Button } from '../../design-system/index.js';
import { WORKFLOW_STEPS, nextStep, previousStep, stepPosition } from './steps.js';
import type { StepId, StepView } from './steps.js';
import styles from './WorkflowNav.module.css';

/**
 * Лестница шагов (PROMPT 27 §27, §29).
 *
 * ## Что показывает
 *
 * Где я, куда можно пойти и где проблема. Не «сколько процентов
 * готово»: у шагов нет критерия завершённости, и выдуманная галочка
 * ничем не лучше выдуманного процента (см. `steps.ts`).
 *
 * ## Ни один шаг не заблокирован (§28)
 *
 * Перейти можно куда угодно и когда угодно. Проект с самого начала
 * считается и изготавливается, и запрещать открыть «Материалы» до
 * «Секций» значило бы придумать зависимость, которой в модели нет.
 * Блокирует только производство — и блокирует его существующая проверка
 * готовности, а не эта лестница.
 *
 * ## Список, а не полоса прогресса
 *
 * Разметка — `<ol>`: шаги упорядочены, и скринридер обязан сообщить
 * «3 из 11», а не читать одиннадцать самостоятельных кнопок.
 */

export interface WorkflowNavProps {
  readonly steps: readonly StepView[];
  readonly current: StepId;
  readonly onStep: (id: StepId) => void;
}

const STATE_MARK: Readonly<Record<StepView['state'], string>> = {
  error: '✕',
  warning: '!',
  current: '●',
  visited: '✓',
  pending: '○',
};

const STATE_LABEL: Readonly<Record<StepView['state'], string>> = {
  error: 'есть ошибка',
  warning: 'есть замечание',
  current: 'текущий шаг',
  visited: 'пройден',
  pending: 'не открывали',
};

export function WorkflowNav(props: WorkflowNavProps): React.JSX.Element {
  const back = previousStep(props.current);
  const forward = nextStep(props.current);

  return (
    <nav className={styles.nav} aria-label="Этапы конструктора">
      <p className={styles.position}>Шаг {stepPosition(props.current)}</p>

      <ol className={styles.list}>
        {props.steps.map((view) => {
          const active = view.step.id === props.current;
          const problems =
            view.errors > 0
              ? `ошибок: ${String(view.errors)}`
              : view.warnings > 0
                ? `замечаний: ${String(view.warnings)}`
                : undefined;

          return (
            <li key={view.step.id}>
              <button
                type="button"
                className={styles.step}
                data-tone={view.tone}
                data-active={active ? '' : undefined}
                aria-current={active ? 'step' : undefined}
                onClick={() => {
                  props.onStep(view.step.id);
                }}
              >
                {/* Значок дублирует тон формой: цвет не единственный
                    носитель смысла. Состояние читается и словами — оно
                    в доступном имени кнопки. */}
                <span className={styles.mark} aria-hidden="true">
                  {STATE_MARK[view.state]}
                </span>
                <span className={styles.index} aria-hidden="true">
                  {view.step.index}
                </span>
                <span className={styles.title}>{view.step.title}</span>
                <span className={styles.state}>{problems ?? STATE_LABEL[view.state]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={styles.moves}>
        <Button
          disabled={back === undefined}
          onClick={() => {
            if (back !== undefined) props.onStep(back);
          }}
        >
          Назад
        </Button>
        <Button
          variant="primary"
          disabled={forward === undefined}
          onClick={() => {
            if (forward !== undefined) props.onStep(forward);
          }}
        >
          Далее
        </Button>
      </div>
    </nav>
  );
}

/** Все шаги в порядке сценария. Экспорт для мест, где нужен только список. */
export const ALL_STEPS = WORKFLOW_STEPS;
