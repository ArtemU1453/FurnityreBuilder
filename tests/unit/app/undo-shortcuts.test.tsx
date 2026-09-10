/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useUndoShortcuts } from '../../../src/app/use-undo-shortcuts.js';

// React требует этот флаг, иначе `act` предупреждает в консоль на каждом
// монтировании. Предупреждение не ложное: без флага React не знает, что
// обновления обёрнуты, и не ждёт их завершения.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Ctrl+Z на всё приложение (PROMPT 33 §29, дефект Д-003).
 *
 * Кнопки были подписаны сочетаниями с PROMPT 26, а обработчика не
 * существовало: приложение обещало то, чего не делало. Здесь сторожатся
 * два условия сразу — что сочетание работает и что оно НЕ отбирается у
 * текстового поля, где отменяют набор, а не команду документа.
 */

interface Harness {
  readonly undo: ReturnType<typeof vi.fn>;
  readonly redo: ReturnType<typeof vi.fn>;
  readonly cleanup: () => void;
}

function mount(options: { canUndo?: boolean; canRedo?: boolean } = {}): Harness {
  const undo = vi.fn();
  const redo = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  function Probe(): null {
    useUndoShortcuts({
      undo,
      redo,
      canUndo: options.canUndo ?? true,
      canRedo: options.canRedo ?? true,
    });
    return null;
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    undo,
    redo,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Нажатие с явным `code`: раскладка на него не влияет. */
function press(
  init: { code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyZ',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('сочетания отмены', () => {
  it('Ctrl+Z отменяет', () => {
    const h = mount();
    press({ ctrlKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('Cmd+Z отменяет: на macOS отменяют так', () => {
    const h = mount();
    press({ metaKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    h.cleanup();
  });

  it('Ctrl+Shift+Z возвращает', () => {
    const h = mount();
    press({ ctrlKey: true, shiftKey: true });
    expect(h.redo).toHaveBeenCalledTimes(1);
    expect(h.undo).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('Ctrl+Y тоже возвращает: второе общепринятое сочетание', () => {
    const h = mount();
    press({ ctrlKey: true, code: 'KeyY' });
    expect(h.redo).toHaveBeenCalledTimes(1);
    h.cleanup();
  });

  it('срабатывает по `code`, а не по `key`: на кириллице это «я»', () => {
    const h = mount();
    const event = new KeyboardEvent('keydown', {
      key: 'я',
      code: 'KeyZ',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(h.undo).toHaveBeenCalledTimes(1);
    h.cleanup();
  });

  it('без модификатора не срабатывает', () => {
    const h = mount();
    press({});
    expect(h.undo).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('с Alt не срабатывает: это чужое сочетание', () => {
    const h = mount();
    press({ ctrlKey: true, altKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    h.cleanup();
  });
});

describe('границы перехвата', () => {
  it('в текстовом поле сочетание остаётся браузеру', () => {
    const h = mount();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    press({ ctrlKey: true }, input);
    expect(h.undo).not.toHaveBeenCalled();
    input.remove();
    h.cleanup();
  });

  it('в области текста — тоже', () => {
    const h = mount();
    const area = document.createElement('textarea');
    document.body.append(area);
    press({ ctrlKey: true }, area);
    expect(h.undo).not.toHaveBeenCalled();
    area.remove();
    h.cleanup();
  });

  it('в числовом поле сочетание принадлежит документу: правка уже стала командой', () => {
    const h = mount();
    const input = document.createElement('input');
    input.type = 'number';
    document.body.append(input);
    press({ ctrlKey: true }, input);
    expect(h.undo).toHaveBeenCalledTimes(1);
    input.remove();
    h.cleanup();
  });

  it('на флажке сочетание работает: флажок не текстовое поле', () => {
    // Регрессия: первая версия проверяла «не number» и потому считала
    // флажок текстовым полем. Отмена не срабатывала сразу после
    // переключения — то есть ровно тогда, когда её нажимают.
    const h = mount();
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.append(input);
    press({ ctrlKey: true }, input);
    expect(h.undo).toHaveBeenCalledTimes(1);
    input.remove();
    h.cleanup();
  });
});

describe('пустая история', () => {
  it('отменять нечего — обработчик не зовут, но событие гасят', () => {
    const h = mount({ canUndo: false });
    const event = press({ ctrlKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    h.cleanup();
  });

  it('возвращать нечего — то же самое', () => {
    const h = mount({ canRedo: false });
    press({ ctrlKey: true, shiftKey: true });
    expect(h.redo).not.toHaveBeenCalled();
    h.cleanup();
  });
});

describe('уборка', () => {
  it('после размонтирования обработчик снят', () => {
    const h = mount();
    h.cleanup();
    press({ ctrlKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });
});
