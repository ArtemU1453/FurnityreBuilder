import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

/**
 * Пустое состояние, ошибка и загрузка — одним компонентом
 * (PROMPT 26 §19).
 *
 * ## Почему один компонент, а не три
 *
 * «Проектов пока нет», «файл не прочитался» и «идёт расчёт» отвечают на
 * один и тот же вопрос: почему здесь ничего не показано и что делать
 * дальше. Разводить их по трём компонентам значило бы трижды писать
 * одну раскладку и получить три разных отступа. Отличается тон и
 * наличие действия — это параметры, а не разные вещи.
 *
 * ## Пустое состояние обязано предлагать действие
 *
 * Пустая панель без объяснения — это тупик: человек не знает, сломалось
 * ли что-то или он просто ещё ничего не сделал. Поэтому `action`
 * отделён от текста: его видно.
 */

export type EmptyStateTone = 'empty' | 'loading' | 'error';

export interface EmptyStateProps {
  readonly tone?: EmptyStateTone;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  /** Компактный вид: внутри узкой панели, а не на весь экран. */
  readonly compact?: boolean;
}

export function EmptyState(props: EmptyStateProps): React.JSX.Element {
  const tone = props.tone ?? 'empty';
  return (
    <div
      className={styles.empty}
      data-tone={tone}
      data-compact={props.compact === true ? '' : undefined}
      // Ошибку скринридер обязан объявить сразу; «пусто» и «загружается»
      // — обычный текст, о котором сообщать по своей инициативе незачем.
      {...(tone === 'error' ? { role: 'alert' } : {})}
      {...(tone === 'loading' ? { role: 'status', 'aria-live': 'polite' } : {})}
    >
      <p className={styles.title}>{props.title}</p>
      {props.description === undefined ? null : (
        <p className={styles.description}>{props.description}</p>
      )}
      {props.action === undefined ? null : <div className={styles.action}>{props.action}</div>}
    </div>
  );
}
