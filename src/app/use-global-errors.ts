import { useEffect, useState } from 'react';

/**
 * Ошибки, которые не поймал никто (PROMPT 45 §11).
 *
 * ## Что остаётся за пределами границ ошибки
 *
 * Граница ошибки React ловит только то, что случилось во время
 * отрисовки. Она НЕ ловит: исключение в обработчике события, отказ в
 * `setTimeout`, отклонённое обещание, ошибку внутри `requestAnimationFrame`
 * — то есть всё асинхронное. Такой сбой не показывает ни белого экрана,
 * ни сообщения: приложение просто перестаёт отвечать на одно конкретное
 * действие, и человек решает, что «не нажимается».
 *
 * ## Что делает этот хук — и чего не делает
 *
 * Замечает и показывает. Восстановить состояние он не пытается: после
 * необработанного исключения неизвестно, что успело выполниться, а что
 * нет, и «починка» вслепую опаснее честного сообщения. Поэтому
 * предлагается одно действие — перезагрузка, и предлагается человеку, а
 * не выполняется сама.
 *
 * Сообщение можно закрыть: оно информирует, а не блокирует работу.
 * Проект остаётся в памяти и в хранилище — сбой в обработчике его не
 * трогает.
 *
 * Наружу ничего не уходит. Единственный получатель подробностей — консоль
 * браузера и текст, который пользователь копирует сам.
 */

export interface GlobalError {
  readonly error: unknown;
  /** Отклонённое обещание или брошенное исключение: причина у них разная. */
  readonly source: 'exception' | 'rejection';
}

export interface GlobalErrors {
  readonly latest: GlobalError | undefined;
  readonly dismiss: () => void;
}

export function useGlobalErrors(): GlobalErrors {
  const [latest, setLatest] = useState<GlobalError | undefined>(undefined);

  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      /*
        Ошибки загрузки ресурсов всплывают тем же событием, но без
        `error` и с целью-элементом. Это не сбой приложения: значок или
        картинка, не доехавшая по сети, не повод пугать человека.
      */
      if (event.error === undefined || event.error === null) return;
      setLatest({ error: event.error, source: 'exception' });
    };

    const onRejection = (event: PromiseRejectionEvent): void => {
      setLatest({ error: event.reason, source: 'rejection' });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return {
    latest,
    dismiss: () => {
      setLatest(undefined);
    },
  };
}
