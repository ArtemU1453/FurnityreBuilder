import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

/**
 * Кнопка без подписи (PROMPT 26 §8, §18, §29).
 *
 * ## Подпись обязательна, даже когда её не видно
 *
 * `label` — не подсказка, а имя кнопки: оно уходит в `aria-label` и в
 * подсказку при наведении. Кнопка без подписи не существует: для
 * скринридера она была бы «кнопка», а для всех остальных — картинкой,
 * смысл которой надо угадать.
 *
 * Подсказка здесь — CSS-элемент, а не отдельный компонент с порталом и
 * позиционированием. Причина простая: она нужна только у кнопок-иконок,
 * и всплывающий слой ради одной строки текста был бы дороже задачи.
 * Появляется по наведению И по фокусу с клавиатуры — иначе подсказка
 * недоступна тем, кто не пользуется мышью.
 */

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Имя действия. Видно в подсказке, читается скринридером. */
  readonly label: string;
  readonly pressed?: boolean;
  readonly children: ReactNode;
}

export function IconButton({
  label,
  pressed,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <span className={styles.wrap}>
      <button
        {...rest}
        type="button"
        className={[styles.button, pressed === true ? styles.pressed : undefined, rest.className]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      >
        <span aria-hidden="true">{children}</span>
      </button>
      <span className={styles.tip} role="presentation">
        {label}
      </span>
    </span>
  );
}
