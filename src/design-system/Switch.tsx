import { useId } from 'react';
import styles from './Switch.module.css';

/**
 * Переключатель «включено/выключено» (PROMPT 26 §8).
 *
 * Нативный `<input type="checkbox">` под своим оформлением: клавиатура,
 * роль и объявление состояния достаются даром и работают правильно.
 * Отличие от флажка чисто смысловое — переключатель применяется сразу,
 * флажок ждёт подтверждения формой. В этом приложении форм нет, поэтому
 * флажка нет тоже: заводить второй компонент ради оформления значило бы
 * ровно ту дубликацию, которую этот этап убирает.
 */

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** Пояснение справа от подписи: что именно произойдёт. */
  readonly hint?: string;
}

export function Switch(props: SwitchProps): React.JSX.Element {
  const id = useId();
  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor={id}>
        <span>{props.label}</span>
        {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
      </label>
      <input
        id={id}
        className={styles.input}
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </div>
  );
}
