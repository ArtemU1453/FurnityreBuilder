import { useId } from 'react';
import type { ReactNode } from 'react';
import styles from './Field.module.css';

/**
 * Обёртка поля: подпись, состояние и связь через aria-describedby.
 *
 * Существует, чтобы доступность не приходилось помнить в каждом месте:
 * `aria-invalid` и связь сообщения с полем выставляются здесь один раз.
 *
 * Ошибка не блокирует ввод. Она объясняет проблему и показывает допустимый
 * диапазон — принцип Agency: пользователь сохраняет управление проектом.
 */
export type FieldStatus = 'default' | 'warning' | 'error';

export interface FieldProps {
  readonly label: string;
  readonly status?: FieldStatus;
  /** Пояснение или причина проблемы. Всегда текстом, не только цветом. */
  readonly message?: string;
  readonly hint?: string;
  readonly children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({
  label,
  status = 'default',
  message,
  hint,
  children,
}: FieldProps): React.JSX.Element {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = message !== undefined && message !== '';
  const invalid = status === 'error';

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        {children({ id, describedBy: hasMessage ? messageId : undefined, invalid })}
      </div>
      {hasMessage ? (
        <p
          id={messageId}
          className={[styles.message, status === 'error' ? styles.error : status === 'warning' ? styles.warning : styles.hint]
            .filter(Boolean)
            .join(' ')}
          role={status === 'error' ? 'alert' : undefined}
        >
          <span aria-hidden="true">{status === 'error' ? '✕' : status === 'warning' ? '!' : 'i'}</span>
          {message}
        </p>
      ) : hint !== undefined ? (
        <p className={[styles.message, styles.hint].join(' ')}>{hint}</p>
      ) : null}
    </div>
  );
}
