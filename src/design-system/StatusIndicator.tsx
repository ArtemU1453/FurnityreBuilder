import styles from './StatusIndicator.module.css';

/**
 * Показ состояния: точка, подпись и — по необходимости — пояснение
 * (PROMPT 26 §14).
 *
 * ## Один язык состояний
 *
 * До этого этапа один и тот же `ProductionStatus` подписывался тремя
 * разными наборами слов: «Готово» в тулбаре, «Готово к производству» в
 * строке состояния и «Готово к производству» с другим оттенком зелёного
 * в чеклисте. Пользователь видел все три на одном экране и не мог знать,
 * что это одно и то же. Здесь описан ПОКАЗ; сами слова живут в одном
 * месте — `src/app/status.ts`.
 *
 * ## Цвет не единственный носитель смысла
 *
 * Рядом с точкой всегда стоит подпись словами. Точка отличается не
 * только цветом, но и формой: у «ошибки» она сплошная, у
 * «подтверждения» — с обводкой. Иначе состояние теряется при
 * дальтонизме и в монохромной печати.
 */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusIndicatorProps {
  readonly tone: Tone;
  readonly label: string;
  /** Уточнение: почему такое состояние. Читается вместе с подписью. */
  readonly detail?: string;
  /** Компактный вид для тулбара: только точка и короткая подпись. */
  readonly compact?: boolean;
  /**
   * Живая область: строка состояния обязана сообщать об изменениях.
   *
   * Роль выводится из тона, а не задаётся отдельно: `danger` — это
   * `alert`, он перебивает то, что скринридер читает сейчас; остальное —
   * `status`, о нём сообщают в паузе. Решать это на месте вызова значило
   * бы полагаться на то, что автор каждый раз вспомнит разницу.
   */
  readonly live?: boolean;
}

export function StatusIndicator(props: StatusIndicatorProps): React.JSX.Element {
  return (
    <span
      className={styles.status}
      data-tone={props.tone}
      data-compact={props.compact === true ? '' : undefined}
      {...(props.live === true
        ? props.tone === 'danger'
          ? { role: 'alert' }
          : { role: 'status', 'aria-live': 'polite' }
        : {})}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{props.label}</span>
      {props.detail === undefined ? null : <span className={styles.detail}>{props.detail}</span>}
    </span>
  );
}
