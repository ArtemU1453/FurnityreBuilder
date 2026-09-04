import styles from './SegmentedControl.module.css';

/**
 * Переключатель из нескольких взаимоисключающих вариантов (PROMPT 26 §8).
 *
 * Используется там, где вариантов немного и все они должны быть видны
 * сразу: вид холста, экран приложения. Отличие от `Select` содержательное,
 * а не стилистическое — список прячет варианты до нажатия, а здесь
 * важно, что человек видит, между чем выбирает, не открывая ничего.
 *
 * Разметка — `radiogroup`: это выбор одного из нескольких, и скринридер
 * обязан сообщить «2 из 4», а не читать четыре независимые кнопки.
 * Стрелки работают благодаря нативным радиокнопкам, спрятанным под
 * подписями, — своей обработки клавиш здесь нет и не нужно.
 */

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Имя группы для скринридера. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  /** Растянуть по ширине контейнера: для навигации, а не для тулбара. */
  readonly stretch?: boolean;
}

export function SegmentedControl<T extends string>(
  props: SegmentedControlProps<T>,
): React.JSX.Element {
  return (
    <div
      className={styles.group}
      role="radiogroup"
      aria-label={props.label}
      data-stretch={props.stretch === true ? '' : undefined}
    >
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <label
            key={option.value}
            className={styles.segment}
            data-selected={selected ? '' : undefined}
          >
            <input
              className={styles.radio}
              type="radio"
              name={props.label}
              value={option.value}
              checked={selected}
              disabled={option.disabled ?? false}
              onChange={() => {
                props.onChange(option.value);
              }}
            />
            <span className={styles.text}>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
