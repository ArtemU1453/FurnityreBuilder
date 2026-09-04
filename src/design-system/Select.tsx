import { Field } from './Field.js';
import styles from './Select.module.css';

/**
 * Выбор из списка (PROMPT 26 §8).
 *
 * Нативный `<select>`, а не собственный выпадающий список. Причина не в
 * экономии: нативный уже умеет клавиатуру, поиск по первым буквам,
 * прокрутку длинного списка, и на телефоне открывается системным
 * барабаном, который человек знает. Собственный список пришлось бы
 * доводить до этого месяцами и всё равно проиграть.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly hint?: string;
}

export function Select(props: SelectProps): React.JSX.Element {
  return (
    <Field label={props.label} {...(props.hint === undefined ? {} : { hint: props.hint })}>
      {({ id }) => (
        <div className={styles.wrap}>
          <select
            id={id}
            className={styles.select}
            value={props.value}
            disabled={props.disabled ?? false}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
          >
            {props.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled ?? false}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={styles.chevron} aria-hidden="true" />
        </div>
      )}
    </Field>
  );
}
