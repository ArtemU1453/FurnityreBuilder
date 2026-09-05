/**
 * Регистрация service worker'а и предложение обновиться (PROMPT 32 §6–§7).
 *
 * ## Почему обновление не молчаливое
 *
 * Подменить бандл под работающим приложением нельзя: открытая вкладка
 * уже загрузила старые модули, и ленивый импорт после подмены попал бы в
 * файл, которого больше нет, — ровно та поломка, которую §7 запрещает.
 * Поэтому новая версия ЖДЁТ, приложение показывает предложение, и
 * активация происходит только по согласию пользователя.
 *
 * ## Чего здесь нет
 *
 * Ни одного обращения к хранилищу проектов. Обновление приложения и
 * данные пользователя не связаны: кэш держит код, IndexedDB — проекты, и
 * ни одна ветка ниже вторую область не трогает (§8).
 */

/** Что сообщается приложению о состоянии обновления. */
export type UpdateState =
  | { readonly kind: 'idle' }
  /** Новая версия загружена и ждёт разрешения встать. */
  | { readonly kind: 'ready'; readonly apply: () => void };

export interface ServiceWorkerOptions {
  readonly onUpdate: (state: UpdateState) => void;
}

/**
 * Поддерживается ли установка вообще.
 *
 * Service worker требует защищённого контекста: `https://` или
 * `localhost`. На `http://` по сети его нет — и это не ошибка
 * приложения, а правило браузера (docs/DEPLOYMENT.md §4).
 */
export function serviceWorkerAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext;
}

export function registerServiceWorker(options: ServiceWorkerOptions): () => void {
  if (!serviceWorkerAvailable()) return () => undefined;

  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;

  /** Предложить обновление, если новая версия уже ждёт. */
  const announce = (waiting: ServiceWorker | null): void => {
    if (disposed || waiting === null) return;
    options.onUpdate({
      kind: 'ready',
      apply: () => {
        // Перезагрузка — не здесь: сначала воркер должен смениться,
        // иначе страница перезагрузится в старую версию. Ждём
        // controllerchange ниже.
        waiting.postMessage('SKIP_WAITING');
      },
    });
  };

  /*
    Перезагрузка при смене управляющего воркера — но НЕ при первой
    установке.

    На самом первом визите управляющего воркера нет, и `clients.claim()`
    в `activate` присылает `controllerchange` просто потому, что воркер
    впервые взял страницу под контроль. Перезагружаться в этот момент не
    от чего: приложение только что загружено с сервера и уже актуально.
    Без этой проверки первое открытие сайта заканчивалось мгновенной
    самопроизвольной перезагрузкой — на медленной связи вторым скачиванием
    всего, а на глазах у пользователя вспышкой без причины.

    `hadController` снимается ОДИН раз при регистрации: дальше он говорит
    «страницей уже управлял воркер», то есть смена контроллера означает
    именно новую версию.
  */
  const hadController = navigator.serviceWorker.controller !== null;
  // Флаг защищает от цикла, если браузер пришлёт событие дважды.
  let reloading = false;
  const onControllerChange = (): void => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      if (disposed) return;
      registration = reg;
      announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          // `controller` пуст при самой первой установке — тогда
          // обновлять нечего, приложение и так только что загружено.
          if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
            announce(reg.waiting ?? installing);
          }
        });
      });
    })
    .catch(() => {
      // Регистрация не удалась — приложение продолжает работать как
      // обычная страница. Сообщать об этом пользователю нечего: он не
      // просил устанавливать приложение и ничего не потерял.
    });

  return () => {
    disposed = true;
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    void registration;
  };
}
