import { Button } from '../../design-system/index.js';
import { STEP_BY_ID, nextStep, previousStep, stepPosition } from './steps.js';
import type { StepId, StepView } from './steps.js';
import styles from './MobileSteps.module.css';

/**
 * Шаги на телефоне (PROMPT 28 §23, §24).
 *
 * ## Почему не та же лестница
 *
 * Замер до изменения: одиннадцать шагов подряд занимали 139 px по
 * вертикали на экране 390×844 — при том что весь холст был 347 px. По
 * горизонтали лента не помещалась и на 320 px: страница ехала вбок на
 * 12 px. Уменьшать шрифт было бы починкой симптома: одиннадцать целей
 * для пальца на такой ширине не помещаются ни при каком кегле.
 *
 * Поэтому здесь показан один шаг — текущий, — его положение в сценарии и
 * два перехода. Весь список никуда не делся: он открывается листом, и в
 * листе это ТА ЖЕ `WorkflowNav`, а не её вторая копия.
 *
 * ## Модель шагов одна
 *
 * `steps.ts` не тронут: порядок, состояния и разбор проблем по шагам
 * общие с десктопом. Отличается только то, сколько шагов видно
 * одновременно.
 */

export interface MobileStepsProps {
  readonly current: StepId;
  readonly steps: readonly StepView[];
  readonly onStep: (id: StepId) => void;
  /** Открыть список всех этапов. */
  readonly onOpenList: () => void;
}

export function MobileSteps(props: MobileStepsProps): React.JSX.Element {
  const back = previousStep(props.current);
  const forward = nextStep(props.current);
  const view = props.steps.find((entry) => entry.step.id === props.current);
  const problems =
    view === undefined || (view.errors === 0 && view.warnings === 0)
      ? undefined
      : view.errors > 0
        ? `ошибок: ${String(view.errors)}`
        : `замечаний: ${String(view.warnings)}`;

  return (
    <nav className={styles.bar} aria-label="Этапы конструктора">
      <Button
        aria-label="Предыдущий этап"
        disabled={back === undefined}
        onClick={() => {
          if (back !== undefined) props.onStep(back);
        }}
      >
        ←
      </Button>

      {/*
        Середина — кнопка, а не подпись: за ней весь список этапов. Под
        пальцем она крупная, и это единственный способ увидеть все
        одиннадцать, не занимая ими экран постоянно.
      */}
      <button type="button" className={styles.current} onClick={props.onOpenList}>
        <span className={styles.position}>Шаг {stepPosition(props.current)}</span>
        <span className={styles.title}>{STEP_BY_ID[props.current].title}</span>
        {problems === undefined ? null : (
          <span className={styles.problems} data-tone={view?.tone}>
            {problems}
          </span>
        )}
      </button>

      <Button
        variant="primary"
        aria-label="Следующий этап"
        disabled={forward === undefined}
        onClick={() => {
          if (forward !== undefined) props.onStep(forward);
        }}
      >
        →
      </Button>
    </nav>
  );
}
