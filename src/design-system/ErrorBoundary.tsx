import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './Button.js';
import { Panel } from './Panel.js';
import styles from './ErrorBoundary.module.css';

/**
 * Граница ошибки (PROMPT 30 §20, PROMPT 45 §3–§4, §7, §9, §12).
 *
 * ## Зачем
 *
 * До PROMPT 30 границ не было ни одной: исключение в сцене, в
 * планировщике помещения или в любом разделе производства снимало ВСЁ
 * приложение — вместе с несохранённым проектом. Пользователь видел белый
 * экран и терял работу, а причина не сообщалась никому.
 *
 * Один и тот же компонент стоит и вокруг раздела, и вокруг всего
 * приложения. Разницу задают свойства, а не второй класс рядом: сообщение
 * своё, а действия — те, которые в этом месте действительно помогают.
 *
 * ## Что она делает и чего НЕ делает
 *
 * Она ограничивает область поражения и показывает, что именно сломалось.
 * Она НЕ чинит состояние и не притворяется, что всё в порядке:
 * молчаливое проглатывание ошибки хуже падения — оно оставляет человека
 * работать с приложением, которое уже считает неправильно.
 *
 * Проект при этом остаётся в памяти и в хранилище: документ живёт в
 * своём store, а не внутри упавшего поддерева. Граница ничего не удаляет
 * и ничего не перезаписывает — ни одного обращения к хранилищу здесь
 * нет вовсе (PROMPT 45 §6).
 *
 * ## Классовый компонент — не выбор стиля
 *
 * Ловить ошибки рендера умеет только он: хука с такой возможностью в
 * React нет. Это единственный класс в приложении, и он существует
 * ровно по этой причине.
 *
 * ## Чего она не перехватывает
 *
 * Ничего асинхронного: обработчик события, `setTimeout`, отклонённое
 * обещание. Это ограничение React, а не недоделка — для них есть
 * `useGlobalErrors` (`src/app/use-global-errors.ts`).
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
  /**
   * Текст для отчёта об ошибке.
   *
   * Приходит функцией, а не готовой строкой, по двум причинам. Первая:
   * считать его до ошибки незачем. Вторая важнее — design-system не
   * знает ни о версии приложения, ни о его разделах, и знать не должен;
   * состав отчёта задаёт тот, кто ставит границу
   * (`src/app/diagnostics.ts`).
   *
   * Пока свойство не передано, блока диагностики нет вовсе.
   */
  readonly diagnostics?: (error: Error) => string;
  /**
   * Перезагрузить приложение.
   *
   * Показывается ТОЛЬКО когда передано (PROMPT 45 §12): перезагрузка
   * помогает при испорченном состоянии и устаревшем чанке, а при
   * сломавшемся разделе она лишь заставит человека заново открыть то же
   * место. Предлагать её всегда — значит приучить, что это единственный
   * ответ приложения на любую беду.
   */
  readonly onReload?: () => void;
}

interface ErrorBoundaryState {
  readonly error: Error | undefined;
  readonly resetKey: string | undefined;
  /** Отчёт показан целиком: человек читает то, что скопирует. */
  readonly showDiagnostics: boolean;
  /** Что ответил буфер обмена на последнее нажатие. */
  readonly copied: 'idle' | 'done' | 'failed';
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    error: undefined,
    resetKey: undefined,
    showDiagnostics: false,
    copied: 'idle',
  };

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
    return { error: undefined, resetKey: props.resetKey, showDiagnostics: false, copied: 'idle' };
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

    const report = this.props.diagnostics?.(error);

    return (
      <Panel id="error-boundary" title={this.props.title} wide>
        <p className={styles.description}>{this.props.description}</p>
        {/*
          Текст ошибки показывается как есть. Он техничен, но это
          единственное, что отличает «что-то пошло не так» от сообщения,
          с которым можно прийти за помощью. Основной текст при этом —
          человеческий: тут одна строка, а не стек (PROMPT 45 §7).
        */}
        <pre className={styles.detail}>{error.message}</pre>
        <p className={styles.description}>
          Проект не потерян: он остаётся в памяти и в сохранённых данных. Другие разделы работают.
        </p>

        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => {
              this.setState({ error: undefined, copied: 'idle' });
            }}
          >
            Попробовать снова
          </Button>

          {this.props.onReload === undefined ? null : (
            <Button variant="secondary" onClick={this.props.onReload}>
              Перезагрузить приложение
            </Button>
          )}

          {report === undefined ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                this.setState((state) => ({ showDiagnostics: !state.showDiagnostics }));
              }}
            >
              {this.state.showDiagnostics ? 'Скрыть данные' : 'Данные для диагностики'}
            </Button>
          )}
        </div>

        {report === undefined || !this.state.showDiagnostics ? null : (
          <div className={styles.diagnostics}>
            {/*
              Отчёт показан целиком и до копирования: человек обязан
              видеть, что именно он собирается кому-то отправить.
              «Скопировать» без «прочитать» — это отправка вслепую.
            */}
            <pre className={styles.report}>{report}</pre>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => {
                  void this.copy(report);
                }}
              >
                Скопировать
              </Button>
              <span className={styles.description} role="status">
                {this.state.copied === 'done'
                  ? 'Скопировано в буфер обмена.'
                  : this.state.copied === 'failed'
                    ? 'Буфер обмена недоступен — выделите текст выше и скопируйте вручную.'
                    : ''}
              </span>
            </div>
          </div>
        )}
      </Panel>
    );
  }

  /**
   * Кладёт отчёт в буфер обмена и говорит, получилось ли.
   *
   * Отказ здесь не исключение, а обычный случай: в незащищённом
   * контексте буфера обмена нет вовсе. Поэтому нажатие обязано ответить
   * словами — молчание после нажатия неотличимо от сломанной кнопки, а
   * текст рядом всё равно доступен для выделения руками.
   */
  private async copy(report: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) {
        this.setState({ copied: 'failed' });
        return;
      }
      await navigator.clipboard.writeText(report);
      this.setState({ copied: 'done' });
    } catch {
      this.setState({ copied: 'failed' });
    }
  }
}
