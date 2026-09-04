import { create } from 'zustand';
import type { InstanceId, NodeId, PartId } from '../domain/index.js';

/**
 * Состояние интерфейса.
 *
 * Отделено от документа намеренно. Выделение ячейки, уровень зума и открытая
 * панель — не свойства мебели: они не сохраняются в файл проекта, не попадают
 * в деталировку и не отменяются по Ctrl+Z. Смешение этих уровней — типичная
 * причина того, что конструктор «тормозит и странно себя ведёт».
 *
 * Третий уровень — транзиентное состояние жеста — не живёт даже здесь:
 * см. src/interaction/drag-controller.ts.
 */
export type Tool = 'select' | 'split-x' | 'split-y' | 'measure' | 'pan';
export type ViewMode = 'front' | 'section' | 'plan' | '3d';
export type PanelId = 'structure' | 'properties' | 'issues' | 'parts' | 'materials';

export interface Viewport {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Notification {
  readonly id: string;
  readonly kind: 'status' | 'success' | 'warning' | 'error';
  readonly message: string;
  /** Обратимое действие вместо диалога подтверждения. */
  readonly undoable?: boolean;
}

export interface SessionState {
  readonly selectedNodes: readonly NodeId[];
  readonly selectedParts: readonly PartId[];
  /**
   * Выбранные экземпляры мебели в помещении (PROMPT 24 §19).
   *
   * Здесь же, а не в отдельном сторе планировщика: выделение — это одно
   * состояние сессии на всё приложение, и второе рядом означало бы, что
   * «выбрано» может быть верно в двух местах одновременно и по-разному.
   */
  readonly selectedInstances: readonly InstanceId[];
  readonly hoveredNode: NodeId | undefined;
  readonly activeTool: Tool;
  readonly viewMode: ViewMode;
  readonly openPanels: readonly PanelId[];
  readonly viewport: Viewport;
  readonly dialog: string | undefined;
  readonly notifications: readonly Notification[];
  /** Хранилище недоступно (приватный режим) — интерфейс обязан это показать. */
  readonly storageEphemeral: boolean;

  readonly selectNodes: (ids: readonly NodeId[]) => void;
  /**
   * Выделение ДЕТАЛЕЙ. Отдельно от узлов дерева: деталь производна, у неё
   * свой идентификатор, и выбор полки не должен означать выбор ячейки, в
   * которой она стоит (PROMPT 22 §5).
   */
  readonly selectParts: (ids: readonly PartId[]) => void;
  readonly selectInstances: (ids: readonly InstanceId[]) => void;
  readonly toggleNode: (id: NodeId) => void;
  readonly clearSelection: () => void;
  readonly setHovered: (id: NodeId | undefined) => void;
  readonly setTool: (tool: Tool) => void;
  readonly setViewMode: (mode: ViewMode) => void;
  readonly togglePanel: (panel: PanelId) => void;
  readonly setViewport: (viewport: Viewport) => void;
  readonly openDialog: (id: string | undefined) => void;
  readonly notify: (notification: Notification) => void;
  readonly dismissNotification: (id: string) => void;
  readonly setStorageEphemeral: (value: boolean) => void;
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0 };

export const createSessionStore = () =>
  create<SessionState>((set) => ({
    selectedNodes: [],
    selectedParts: [],
    selectedInstances: [],
    hoveredNode: undefined,
    activeTool: 'select',
    viewMode: 'front',
    openPanels: ['structure', 'properties'],
    viewport: IDENTITY_VIEWPORT,
    dialog: undefined,
    notifications: [],
    storageEphemeral: false,

    // Выбор узла снимает выбор детали и наоборот: одновременно выбранными
    // ячейкой и деталью инспектор показать не может, а «последний выбор
    // побеждает» — предсказуемое поведение прямого манипулирования.
    selectNodes: (ids) => set({ selectedNodes: [...ids], selectedParts: [], selectedInstances: [] }),
    selectParts: (ids) => set({ selectedParts: [...ids], selectedNodes: [], selectedInstances: [] }),
    selectInstances: (ids) => set({ selectedInstances: [...ids], selectedNodes: [], selectedParts: [] }),
    toggleNode: (id) =>
      set((state) => ({
        selectedNodes: state.selectedNodes.includes(id)
          ? state.selectedNodes.filter((n) => n !== id)
          : [...state.selectedNodes, id],
      })),
    clearSelection: () => set({ selectedNodes: [], selectedParts: [], selectedInstances: [] }),
    setHovered: (id) => set({ hoveredNode: id }),
    setTool: (activeTool) => set({ activeTool }),
    setViewMode: (viewMode) => set({ viewMode }),
    togglePanel: (panel) =>
      set((state) => ({
        openPanels: state.openPanels.includes(panel)
          ? state.openPanels.filter((p) => p !== panel)
          : [...state.openPanels, panel],
      })),
    setViewport: (viewport) => set({ viewport }),
    openDialog: (dialog) => set({ dialog }),
    notify: (notification) =>
      set((state) => ({ notifications: [...state.notifications, notification] })),
    dismissNotification: (id) =>
      set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
    setStorageEphemeral: (storageEphemeral) => set({ storageEphemeral }),
  }));

export const useSessionStore = createSessionStore();
