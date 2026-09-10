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

/**
 * Диагностика и восстановление (PROMPT 45 §3, §7, §9, §12).
 *
 * Проверяется то, за что отвечает именно граница: что отчёт показывается
 * ЦЕЛИКОМ до копирования, что перезагрузка предлагается только там, где
 * её попросили показать, и что основной текст остаётся человеческим —
 * стек не подменяет собой сообщение.
 */
describe('граница ошибки: действия и диагностика', () => {
  it('без свойства diagnostics блока диагностики нет вовсе', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, cleanup } = render(
      <ErrorBoundary title="Раздел" description="Пояснение">
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(container.textContent).not.toContain('Данные для диагностики');
    cleanup();
    spy.mockRestore();
  });

  it('перезагрузка предлагается только когда действие передано', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const without = render(
      <ErrorBoundary title="Раздел" description="Пояснение">
        <Boom fail />
      </ErrorBoundary>,
    );
    expect(without.container.textContent).not.toContain('Перезагрузить приложение');
    without.cleanup();

    const reload = vi.fn();
    const withAction = render(
      <ErrorBoundary title="Раздел" description="Пояснение" onReload={reload}>
        <Boom fail />
      </ErrorBoundary>,
    );
    const button = [...withAction.container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Перезагрузить приложение',
    );
    expect(button, 'кнопки перезагрузки нет').toBeDefined();
    act(() => {
      button?.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    withAction.cleanup();
    spy.mockRestore();
  });

  it('отчёт показывается целиком до копирования, а не прячется за кнопку', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, cleanup } = render(
      <ErrorBoundary
        title="Раздел"
        description="Пояснение"
        diagnostics={(error) => `ОТЧЁТ: ${error.message}`}
      >
        <Boom fail />
      </ErrorBoundary>,
    );

    // До нажатия отчёта на экране нет: он нужен не всем и занимал бы место.
    expect(container.textContent).not.toContain('ОТЧЁТ:');

    const open = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Данные для диагностики',
    );
    expect(open, 'кнопки диагностики нет').toBeDefined();
    act(() => {
      open?.click();
    });

    // Человек видит ровно то, что скопирует. Копирование вслепую —
    // не то, что предлагается (§9).
    expect(container.textContent).toContain('ОТЧЁТ: WebGL context lost');
    expect(
      [...container.querySelectorAll('button')].some((item) => item.textContent === 'Скопировать'),
      'кнопки копирования нет',
    ).toBe(true);

    cleanup();
    spy.mockRestore();
  });

  it('основной текст — сообщение, а не стек', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, cleanup } = render(
      <ErrorBoundary
        title="Трёхмерный вид недоступен"
        description="Сцена прервалась ошибкой."
        diagnostics={(error) => `stack:\n${error.stack ?? ''}`}
      >
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('Трёхмерный вид недоступен');
    expect(container.textContent).toContain('WebGL context lost');
    // Стек лежит в отчёте и появляется только по запросу.
    expect(container.textContent).not.toContain('stack:');
    cleanup();
    spy.mockRestore();
  });
});
