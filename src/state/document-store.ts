import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import type { Patch } from 'immer';
import { create } from 'zustand';
import type { Project } from '../domain/index.js';
import { createProject } from '../domain/index.js';
import type { Command } from './commands.js';
import { applyCommand } from './commands.js';
import type { HistoryState } from './history.js';
import { canRedo, canUndo, emptyHistory, mergeIntoTop, pushEntry } from './history.js';

enablePatches();

/**
 * Транзакция объединяет серию команд в один шаг истории.
 *
 * Прямое отображение жеста из docs/INTERACTION_MODEL.md:
 *   pointerdown → begin, pointermove → execute, pointerup → end, Esc → cancel.
 */
interface OpenTransaction {
  readonly label: string;
  readonly inverse: Patch[];
}

export interface DocumentState {
  readonly project: Project;
  readonly history: HistoryState;
  readonly transaction: OpenTransaction | undefined;

  readonly execute: (command: Command, label?: string) => void;
  readonly beginTransaction: (label: string) => void;
  readonly endTransaction: () => void;
  readonly cancelTransaction: () => void;

  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;

  /** Полная замена документа: открытие или импорт проекта. Историю сбрасывает. */
  readonly replaceProject: (project: Project) => void;
}

export const createDocumentStore = (initial?: Project) =>
  create<DocumentState>((set, get) => ({
    project: initial ?? createProject(),
    history: emptyHistory(),
    transaction: undefined,

    execute: (command, label) => {
      const state = get();
      const [next, patches, inverse] = produceWithPatches(state.project, (draft) => {
        applyCommand(draft, command);
      });

      // Команда ничего не изменила — в истории ей делать нечего.
      if (patches.length === 0) return;

      if (state.transaction !== undefined) {
        set({
          project: next,
          history: mergeIntoTop(state.history, patches, inverse),
          transaction: { ...state.transaction, inverse: [...inverse, ...state.transaction.inverse] },
        });
        return;
      }

      set({
        project: next,
        history: pushEntry(state.history, {
          label: label ?? command.type,
          patches,
          inverse,
          selection: [],
        }),
      });
    },

    beginTransaction: (label) => {
      if (get().transaction !== undefined) return;
      // Пустая запись-якорь: последующие команды сливаются в неё.
      set((state) => ({
        transaction: { label, inverse: [] },
        history: pushEntry(state.history, { label, patches: [], inverse: [], selection: [] }),
      }));
    },

    endTransaction: () => {
      const state = get();
      if (state.transaction === undefined) return;
      const top = state.history.past.at(-1);
      // Жест, не изменивший ничего (нажал и отпустил), не должен оставлять шаг.
      if (top !== undefined && top.patches.length === 0) {
        set({ transaction: undefined, history: { ...state.history, past: state.history.past.slice(0, -1) } });
        return;
      }
      set({ transaction: undefined });
    },

    cancelTransaction: () => {
      const state = get();
      if (state.transaction === undefined) return;
      const project = applyPatches(state.project, state.transaction.inverse);
      set({
        project,
        transaction: undefined,
        history: { ...state.history, past: state.history.past.slice(0, -1) },
      });
    },

    undo: () => {
      const state = get();
      const entry = state.history.past.at(-1);
      if (entry === undefined) return;
      set({
        project: applyPatches(state.project, entry.inverse),
        history: {
          ...state.history,
          past: state.history.past.slice(0, -1),
          future: [entry, ...state.history.future],
        },
      });
    },

    redo: () => {
      const state = get();
      const entry = state.history.future[0];
      if (entry === undefined) return;
      set({
        project: applyPatches(state.project, entry.patches),
        history: {
          ...state.history,
          past: [...state.history.past, entry],
          future: state.history.future.slice(1),
        },
      });
    },

    canUndo: () => canUndo(get().history),
    canRedo: () => canRedo(get().history),

    replaceProject: (project) => {
      set({ project, history: emptyHistory(), transaction: undefined });
    },
  }));

/** Стор приложения. Тесты создают собственный экземпляр через createDocumentStore. */
export const useDocumentStore = createDocumentStore();
