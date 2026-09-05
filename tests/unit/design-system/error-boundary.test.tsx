/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ErrorBoundary } from '../../../src/design-system/ErrorBoundary.js';

/**
 * Граница ошибки (PROMPT 30 §20).
 *
 * Проверяется не «компонент рендерится», а три свойства, ради которых он
 * существует: падение не выходит за границу, сообщение видно человеку, и
 * повтор возможен.
 */

function Boom({ fail }: { readonly fail: boolean }): React.JSX.Element {
  if (fail) throw new Error('WebGL context lost');
  return <p>рабочее содержимое</p>;
}

function render(node: React.ReactNode): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('граница ошибки', () => {
  it('исправное поддерево показывается как есть', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, cleanup } = render(
      <ErrorBoundary title="Раздел" description="Пояснение">
        <Boom fail={false} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('рабочее содержимое');
    cleanup();
    spy.mockRestore();
  });

  it('ошибка не выходит за границу и объясняется словами', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    const { container, cleanup } = render(
      <ErrorBoundary title="Трёхмерный вид недоступен" description="Пояснение" onError={onError}>
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('Трёхмерный вид недоступен');
    // Текст ошибки показывается: с ним можно прийти за помощью.
    expect(container.textContent).toContain('WebGL context lost');
    // И обещание, которое приложение обязано сдержать.
    expect(container.textContent).toContain('Проект не потерян');
    expect(onError).toHaveBeenCalledOnce();
    cleanup();
    spy.mockRestore();
  });

  it('смена ключа возвращает границу в рабочее состояние', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ErrorBoundary title="Раздел" description="Пояснение" resetKey="a">
          <Boom fail />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('Раздел');

    // Другой раздел — другая попытка: прошлая ошибка к нему не относится.
    act(() => {
      root.render(
        <ErrorBoundary title="Раздел" description="Пояснение" resetKey="b">
          <Boom fail={false} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('рабочее содержимое');

    act(() => {
      root.unmount();
    });
    container.remove();
    spy.mockRestore();
  });

  it('кнопка «Попробовать снова» действительно повторяет отрисовку', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    function Flaky(): React.JSX.Element {
      if (fail) throw new Error('временный сбой');
      return <p>получилось</p>;
    }

    const { container, cleanup } = render(
      <ErrorBoundary title="Раздел" description="Пояснение">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('временный сбой');

    fail = false;
    const button = [...container.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Попробовать снова'),
    );
    expect(button).toBeDefined();
    act(() => {
      button?.click();
    });
    expect(container.textContent).toContain('получилось');

    cleanup();
    spy.mockRestore();
  });

  it('StrictMode не мешает: граница переживает двойную отрисовку', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, cleanup } = render(
      <StrictMode>
        <ErrorBoundary title="Раздел" description="Пояснение">
          <Boom fail />
        </ErrorBoundary>
      </StrictMode>,
    );
    expect(container.textContent).toContain('Раздел');
    cleanup();
    spy.mockRestore();
  });
});
