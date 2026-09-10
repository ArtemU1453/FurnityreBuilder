/**
 * Разбор отказов отложенной загрузки (PROMPT 45 §5, §12, §13).
 *
 * ## Какую именно поломку это ловит
 *
 * Приложение разбито на чанки: генератор PDF и генератор XLSX едут по
 * нажатию, а не при открытии (`docs/PERFORMANCE_BUDGETS.md`). У такого
 * разбиения есть своя, вполне production-ная поломка:
 *
 *   вкладка открыта со старой версией
 *     → выложена новая
 *     → человек нажимает «PDF»
 *     → старая разметка просит чанк, которого на хостинге уже нет
 *     → 404
 *
 * Браузер сообщает об этом строкой вроде «Failed to fetch dynamically
 * imported module». Показать её как есть — значит сказать человеку
 * ничего: он не виноват, ничего не сломал, и перезагрузка всё чинит.
 *
 * ## Почему не автоматическая перезагрузка
 *
 * Потому что отличить «чанка нет» от «сеть моргнула» по строке ошибки
 * нельзя, а перезагрузка при моргнувшей сети — это цикл: страница
 * грузится, падает, перезагружается. Решение принимает человек, кнопкой.
 * Автоматического повтора здесь нет ни одного.
 */

/** Что именно произошло — в терминах причины, а не текста браузера. */
export type LoadFailureKind = 'chunk' | 'offline' | 'unknown';

export interface LoadFailure {
  readonly kind: LoadFailureKind;
  /** Что произошло — словами, которые можно прочесть. */
  readonly message: string;
  /** Что делать. `reload` — только там, где перезагрузка действительно чинит. */
  readonly action: 'reload' | 'retry' | 'none';
}

/**
 * Признаки несостоявшегося динамического импорта.
 *
 * Формулировки разные у разных движков, и общего кода ошибки у них нет —
 * поэтому сравнение по тексту. Это неприятно, но честно: другого признака
 * браузеры не дают.
 */
const CHUNK_PATTERNS = [
  // Chrome, Edge
  /failed to fetch dynamically imported module/i,
  /failed to load module script/i,
  // Safari
  /importing a module script failed/i,
  // Firefox
  /error loading dynamically imported module/i,
  /'?text\/html'? is not a valid javascript mime type/i,
  /unable to preload css/i,
];

const OFFLINE_PATTERNS = [/failed to fetch/i, /networkerror/i, /load failed/i];

export function describeLoadFailure(error: unknown): LoadFailure {
  const text = error instanceof Error ? error.message : String(error);

  if (CHUNK_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      kind: 'chunk',
      message:
        'Часть приложения не загрузилась. Обычно так бывает, когда вкладка была открыта до выхода новой версии. Перезагрузите страницу — проекты останутся на месте.',
      action: 'reload',
    };
  }

  if (OFFLINE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      kind: 'offline',
      message:
        'Не удалось получить нужные данные. Проверьте соединение и попробуйте ещё раз — проект не затронут.',
      action: 'retry',
    };
  }

  return { kind: 'unknown', message: text, action: 'none' };
}
