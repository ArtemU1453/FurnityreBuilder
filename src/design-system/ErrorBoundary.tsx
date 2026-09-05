import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './Button.js';
import { Panel } from './Panel.js';
import styles from './ErrorBoundary.module.css';

/**
 * Граница ошибки вокруг части экрана (PROMPT 30 §20).
 *
 * ## Зачем
 *
 * До этого этапа границ не было ни одной: исключение в сцене, в
 * планировщике помещения или в любом разделе производства снимало ВСЁ
 * приложение — вместе с несохранённым проектом. Пользователь видел белый
 * экран и терял работу, а причина не сообщалась никому.
 *
 * ## Что она делает и чего НЕ делает
 *
 * Она ограничивает область поражения одним разделом и показывает, что
 * именно сломалось. Она НЕ чинит состояние и не притворяется, что всё в
 * порядке: молчаливое проглатывание ошибки хуже падения — оно оставляет
 * человека работать с приложением, которое уже считает неправильно.
 *
 * Проект при этом остаётся в памяти и в хранилище: документ живёт в
 * своём store, а не внутри упавшего поддерева, поэтому переход в другой
 * раздел возвращает рабочее приложение.
 *
 * ## Классовый компонент — не выбор стиля
 *
 * Ловить ошибки рендера умеет только он: хука с такой возможностью в
 * React нет. Это единственный класс в приложении, и он существует
 * ровно по этой причине.
 *
 * ## `resetKey`
 *
 * Смена ключа сбрасывает границу. Ключом служит то, при изменении чего
 * повтор осмыслен — например открытый раздел: уходя со сломанного
 * раздела и возвращаясь, человек получает новую попытку, а не
 * запомненную навсегда ошибку.
 */

export interface ErrorBoundaryProps {
  /** Что сломалось — словами, для человека. */
  readonly title: string;
  /** Что это значит и что делать дальше. */
  readonly description: string;
  readonly children: ReactNode;
  /** Смена значения возвращает границу в рабочее состояние. */
  readonly resetKey?: string;
  /** Вызывается при ошибке: наружу сообщается факт, а не подробности. */
  readonly onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
  readonly resetKey: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: undefined, resetKey: undefined };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  public static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (state.resetKey === props.resetKey) return null;
    // Ключ изменился: это другой раздел или другой проект — прошлая
    // ошибка к нему не относится.
    return { error: undefined, resetKey: props.resetKey };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error);
    // Консоль — единственный получатель подробностей: телеметрии в
    // приложении нет и не будет (docs/BRAND_INDEPENDENCE_AUDIT.md).
    console.error('Ошибка в разделе:', this.props.title, error, info.componentStack);
  }

  public override render(): ReactNode {
    const error = this.state.error;
    if (error === undefined) return this.props.children;

    return (
      <Panel id="error-boundary" title={this.props.title} wide>
        <p className={styles.description}>{this.props.description}</p>
        {/*
          Текст ошибки показывается как есть. Он техничен, но это
          единственное, что отличает «что-то пошло не так» от сообщения,
          с которым можно прийти за помощью.
        */}
        <pre className={styles.detail}>{error.message}</pre>
        <p className={styles.description}>
          Проект не потерян: он остаётся в памяти и в сохранённых данных. Другие разделы работают.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            this.setState({ error: undefined });
          }}
        >
          Попробовать снова
        </Button>
      </Panel>
    );
  }
}
