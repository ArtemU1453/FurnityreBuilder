import { useEffect } from 'react';

/**
 * Ctrl+Z и Ctrl+Shift+Z на всё приложение (PROMPT 33 §29, дефект Д-003).
 *
 * ## Почему это дефект, а не новая возможность
 *
 * Кнопки в верхней строке подписаны «Отменить · Ctrl+Z» и «Вернуть ·
 * Ctrl+Shift+Z» с PROMPT 26. Обработчика при этом не существовало нигде:
 * приложение обещало сочетание клавиш и не выполняло его. Подпись,
 * называющая несуществующее, хуже отсутствующей подписи — она заставляет
 * человека решить, что сломалось у него.
 *
 * ## Почему обработчик глобальный
 *
 * Отмена относится к документу, а не к экрану: правка габарита,
 * перестановка мебели в помещении и переключение конвенции габарита
 * ложатся в одну историю. Вешать сочетание на каждый экран значило бы
 * получить четыре обработчика одного действия.
 *
 * ## Где сочетание НЕ перехватывается
 *
 * В текстовом поле и в области редактируемого текста Ctrl+Z принадлежит
 * браузеру: там человек отменяет НАБОР, а не команду документа. Числовые
 * поля к этому исключению не относятся намеренно — каждое их изменение
 * уже является командой и попадает в историю, поэтому отменять там
 * нужно именно команду.
 */

export interface UndoShortcuts {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * Типы полей, где Ctrl+Z отменяет НАБОР ТЕКСТА и потому принадлежит
 * браузеру.
 *
 * Перечислены явно, а не «всё, кроме number». Отрицание оказалось
 * ловушкой: флажок — тоже `<input>`, и «не number» делало его текстовым
 * полем. Из-за этого сразу после переключения флажка, пока он ещё в
 * фокусе, Ctrl+Z не срабатывал — то есть ровно тогда, когда его и
 * нажимают.
 */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

/** Принадлежит ли Ctrl+Z полю ввода, а не документу. */
function editsText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

export function useUndoShortcuts(actions: UndoShortcuts): void {
  const { undo, redo, canUndo, canRedo } = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // `metaKey` — для macOS: там отменяют через Cmd+Z, и приложение,
      // знающее только Ctrl, выглядит там чужим.
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // `event.code`, а не `event.key`: на кириллической раскладке `key`
      // равен «я», и сочетание перестало бы работать ровно у тех, для
      // кого приложение написано.
      if (event.code !== 'KeyZ' && event.code !== 'KeyY') return;
      if (editsText(event.target)) return;

      // Ctrl+Y — второе общепринятое сочетание повтора (Windows).
      const wantsRedo = event.shiftKey || event.code === 'KeyY';
      if (wantsRedo ? !canRedo : !canUndo) {
        // Отменять нечего. Событие всё равно гасится: иначе браузер
        // отменил бы ввод в поле, которое пользователь только что
        // покинул, и это выглядело бы случайной правкой.
        event.preventDefault();
        return;
      }

      event.preventDefault();
      if (wantsRedo) redo();
      else undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [undo, redo, canUndo, canRedo]);
}
