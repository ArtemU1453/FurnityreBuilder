import type { ReactNode } from 'react';
import styles from './Panel.module.css';

/**
 * Панель — прямоугольник содержимого с заголовком (PROMPT 26 §8).
 *
 * До этого этапа панелей было два вида: `.panel` из оболочки приложения
 * (PROMPT 5) и `.panel`/`.sidebar` из редактора (PROMPT 22), с разными
 * радиусами, тенями и заголовками. Ни один из них не был «неправильным»
 * — их просто было два, и на одном экране это видно.
 *
 * Заголовок связан с областью через `aria-labelledby`, а не подписан
 * `aria-label`: тогда он остаётся видимым текстом, а не спрятанной
 * строкой, и одно и то же слово читают и глазами, и скринридером.
 *
 * Постоянное имя ориентира — забота того, кто панель размещает: у
 * инспектора заголовок меняется с выделением, поэтому он лежит внутри
 * `<aside aria-label="Свойства объекта">`. Область, которая
 * переименовывается при каждом щелчке, бесполезна: в списке ориентиров
 * скринридера её невозможно найти.
 */

export type PanelTone = 'default' | 'sunken';

export interface PanelProps {
  readonly title?: string;
  /** Пояснение под заголовком: зачем эта панель. */
  readonly subtitle?: string;
  /** Кнопки и переключатели в правом верхнем углу. */
  readonly actions?: ReactNode;
  readonly tone?: PanelTone;
  /** Занять всю ширину рабочей области, а не колонку. */
  readonly wide?: boolean;
  readonly children: ReactNode;
  readonly id?: string;
}

export function Panel(props: PanelProps): React.JSX.Element {
  const titleId = props.id === undefined ? undefined : `${props.id}-title`;

  return (
    <section
      className={styles.panel}
      data-tone={props.tone ?? 'default'}
      data-wide={props.wide === true ? '' : undefined}
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props.title !== undefined && titleId !== undefined
        ? { 'aria-labelledby': titleId }
        : {})}
    >
      {props.title === undefined ? null : (
        <header className={styles.header}>
          <div className={styles.headings}>
            <h2 className={styles.title} {...(titleId === undefined ? {} : { id: titleId })}>
              {props.title}
            </h2>
            {props.subtitle === undefined ? null : (
              <p className={styles.subtitle}>{props.subtitle}</p>
            )}
          </div>
          {props.actions === undefined ? null : (
            <div className={styles.actions}>{props.actions}</div>
          )}
        </header>
      )}
      {props.children}
    </section>
  );
}

/** Разделитель. Отдельный компонент, чтобы толщина и цвет были одни. */
export function Divider(): React.JSX.Element {
  return <hr className={styles.divider} />;
}
