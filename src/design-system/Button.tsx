import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * Матрица состояний из docs/DESIGN_SYSTEM.md §9.1:
 * REST → HOVER → PRESSED → ACTIVE → FOCUS → DISABLED → LOADING.
 *
 * SUCCESS и ERROR у кнопки сознательно отсутствуют: об ошибке сообщает форма
 * или панель проблем, а не элемент управления. Кнопка, окрашивающаяся
 * в красный, не объясняет, что именно не так.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variant?: ButtonVariant;
  /** Включённое состояние переключателя (панель открыта, инструмент выбран). */
  readonly pressed?: boolean;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export function Button({
  variant = 'secondary',
  pressed,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const className = [
    styles.button,
    styles[variant],
    pressed === true ? styles.pressed : undefined,
    rest.className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      {...rest}
      className={className}
      disabled={disabled === true || loading}
      // aria-pressed выставляется только для настоящих переключателей:
      // на обычной кнопке он вводит в заблуждение вспомогательные технологии.
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...(loading ? { 'aria-busy': true } : {})}
    >
      <span className={loading ? styles.loadingLabel : undefined}>{children}</span>
      {loading ? (
        <span className={styles.loadingOverlay}>
          <span className={styles.spinner} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}
