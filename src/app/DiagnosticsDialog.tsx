import { useState } from 'react';
import { Button, Dialog } from '../design-system/index.js';
import { collectDiagnostics } from './diagnostics.js';
import type { DiagnosticCategory } from './diagnostics.js';
import styles from './DiagnosticsDialog.module.css';

/**
 * Данные для отчёта об ошибке — отдельным листом (PROMPT 45 §9).
 *
 * ## Зачем отдельно от границы ошибки
 *
 * Граница показывает панель, и отчёт помещается прямо в неё. Ошибка вне
 * отрисовки панели не показывает: она сообщает о себе полосой наверху, а
 * полоса — не место для двадцати строк текста. Лист решает обе задачи
 * одинаково и не заводит второго вида диагностики: текст собирает та же
 * `collectDiagnostics`.
 *
 * ## Почему текст показан, а не просто скопирован
 *
 * Потому что это данные о человеке и его браузере. Кнопка «отправить
 * диагностику», после которой неизвестно, что ушло, — ровно то, чего
 * этот продукт не делает. Здесь видно всё, что будет скопировано, до
 * того как это произойдёт, и копирование выполняет сам человек.
 *
 * Наружу отсюда не уходит ничего: ни запроса, ни адреса в коде нет.
 */

export interface DiagnosticsDialogProps {
  readonly open: boolean;
  readonly error: unknown;
  readonly category: DiagnosticCategory;
  readonly onClose: () => void;
}

export function DiagnosticsDialog(props: DiagnosticsDialogProps): React.JSX.Element | null {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  if (!props.open) return null;

  const report = collectDiagnostics({ category: props.category, error: props.error });

  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) {
        setCopied('failed');
        return;
      }
      await navigator.clipboard.writeText(report);
      setCopied('done');
    } catch {
      // Буфер обмена недоступен в незащищённом контексте. Это не сбой:
      // текст выше можно выделить и скопировать руками, о чём и сказано.
      setCopied('failed');
    }
  };

  return (
    <Dialog
      open
      title="Данные для отчёта об ошибке"
      description="Эти сведения помогают понять, что произошло. Приложение никуда их не отправляет: скопировать и приложить к сообщению об ошибке можете только вы."
      onClose={() => {
        setCopied('idle');
        props.onClose();
      }}
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => {
              void copy();
            }}
          >
            Скопировать
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCopied('idle');
              props.onClose();
            }}
          >
            Закрыть
          </Button>
        </>
      }
    >
      <pre className={styles.report}>{report}</pre>
      <p className={styles.note} role="status">
        {copied === 'done'
          ? 'Скопировано в буфер обмена.'
          : copied === 'failed'
            ? 'Буфер обмена недоступен — выделите текст выше и скопируйте вручную.'
            : ''}
      </p>
    </Dialog>
  );
}
