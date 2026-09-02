import type { Patch } from 'immer';

/**
 * История на патчах, а не на снимках.
 *
 * Снимок проекта на каждое движение ползунка — это мегабайты мусора за минуту
 * работы. Патч Immer описывает только изменившееся, сериализуем и одновременно
 * годится как дельта для автосохранения.
 *
 * Отменяется состояние ДОМЕНА, а не интерфейса: undo не должен возвращать
 * прокрутку панели или уровень зума.
 */
export interface HistoryEntry {
  readonly label: string;
  readonly patches: readonly Patch[];
  readonly inverse: readonly Patch[];
  /** Выделение на момент действия: undo без контекста дезориентирует. */
  readonly selection: readonly string[];
}

export interface HistoryState {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly limit: number;
}

export const HISTORY_LIMIT = 200;

export const emptyHistory = (limit: number = HISTORY_LIMIT): HistoryState => ({
  past: [],
  future: [],
  limit,
});

export function pushEntry(history: HistoryState, entry: HistoryEntry): HistoryState {
  const past = [...history.past, entry];
  return {
    ...history,
    past: past.length > history.limit ? past.slice(past.length - history.limit) : past,
    future: [],
  };
}

/**
 * Дописывает патчи в верхнюю запись — коалесценция.
 *
 * Один drag или одна серия правок в поле обязаны быть одним шагом отмены.
 * Иначе пользователь жмёт Ctrl+Z сорок раз, чтобы отменить одно движение.
 */
export function mergeIntoTop(history: HistoryState, patches: readonly Patch[], inverse: readonly Patch[]): HistoryState {
  const top = history.past.at(-1);
  if (top === undefined) return history;
  const merged: HistoryEntry = {
    ...top,
    patches: [...top.patches, ...patches],
    // Обратные патчи применяются в обратном порядке, поэтому новые идут вперёд.
    inverse: [...inverse, ...top.inverse],
  };
  return { ...history, past: [...history.past.slice(0, -1), merged], future: [] };
}

export const canUndo = (history: HistoryState): boolean => history.past.length > 0;
export const canRedo = (history: HistoryState): boolean => history.future.length > 0;
