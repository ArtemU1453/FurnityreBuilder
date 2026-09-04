import { VelocityTracker } from './velocity-tracker.js';

/**
 * Контроллер перетаскивания — один на все жесты приложения.
 *
 * Реализует контракт docs/INTERACTION_MODEL.md §2:
 *   • pointer capture — отслеживание не теряется за границей элемента;
 *   • точка захвата — объект не прыгает центром под указатель;
 *   • непрерывная обратная связь на каждом кадре;
 *   • отмена по Esc и pointercancel;
 *   • фиксация одной командой на pointerup;
 *   • скорость на отпускании для передачи в пружину.
 *
 * Критично для производительности: во время движения контроллер НЕ трогает
 * доменное состояние. Он отдаёт транзиентное значение подписчику, который
 * пишет его прямо в transform, минуя React. Домен меняется один раз, на
 * фиксации. См. docs/STATE_ARCHITECTURE.md §4.
 */

/**
 * Минимальная поверхность DOM, нужная контроллеру. Упрощает тесты.
 *
 * Требуются ровно три метода захвата указателя — те, которые контроллер
 * действительно вызывает. Объявленные здесь ранее `addEventListener` и
 * `removeEventListener` контроллер не использует, а их присутствие делало
 * интерфейс несовместимым с настоящим DOM-элементом: сигнатура
 * `addEventListener` в lib.dom шире, и React-элемент не проходил проверку
 * типов (найдено при подключении холста, PROMPT 22).
 */
export interface CapturableElement {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
}

export interface PointerLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  preventDefault?: () => void;
}

export interface DragFrame {
  /** Смещение от точки нажатия, в пикселях экрана. */
  readonly dx: number;
  readonly dy: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface DragEnd extends DragFrame {
  /** Скорость на отпускании, px/s. Передаётся в пружину без изменений. */
  readonly velocity: { x: number; y: number };
}

export interface DragHandlers<TBase> {
  /** Снимок базового состояния. Берётся из ДОМЕНА, не из DOM. */
  onStart(frame: DragFrame): TBase;
  /** Каждый кадр движения. Домен трогать нельзя. */
  onMove(frame: DragFrame, base: TBase): void;
  /** Фиксация: здесь и только здесь отправляется команда. */
  onCommit(end: DragEnd, base: TBase): void;
  /** Откат к базовому состоянию. */
  onCancel(base: TBase): void;
}

export interface DragOptions {
  /** Порог начала жеста в пикселях. До него это клик, а не перетаскивание. */
  readonly threshold?: number;
}

/** 4 px для мыши: в конструкторе высокая точность, 10 px при большом зуме — уже десятки мм. */
export const DRAG_THRESHOLD_MOUSE = 4;
export const DRAG_THRESHOLD_TOUCH = 8;

type Phase = 'idle' | 'pending' | 'dragging';

export class DragController<TBase> {
  private readonly handlers: DragHandlers<TBase>;
  private readonly threshold: number;
  private readonly tracker = new VelocityTracker();

  private phase: Phase = 'idle';
  private pointerId: number | undefined;
  private element: CapturableElement | undefined;
  private startX = 0;
  private startY = 0;
  private base: TBase | undefined;

  constructor(handlers: DragHandlers<TBase>, options: DragOptions = {}) {
    this.handlers = handlers;
    this.threshold = options.threshold ?? DRAG_THRESHOLD_MOUSE;
  }

  get isDragging(): boolean {
    return this.phase === 'dragging';
  }

  pointerDown(event: PointerLike, element: CapturableElement, now = performance.now()): void {
    if (this.phase !== 'idle') return;

    this.element = element;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.phase = 'pending';
    this.tracker.reset();
    this.tracker.add(event.clientX, event.clientY, now);

    // Захват указателя: движение продолжает приходить, даже когда курсор
    // ушёл далеко за пределы тонкой линии разделителя.
    element.setPointerCapture(event.pointerId);
  }

  pointerMove(event: PointerLike, now = performance.now()): void {
    if (this.phase === 'idle' || event.pointerId !== this.pointerId) return;

    this.tracker.add(event.clientX, event.clientY, now);
    const frame = this.frame(event);

    if (this.phase === 'pending') {
      if (Math.hypot(frame.dx, frame.dy) < this.threshold) return;
      this.phase = 'dragging';
      this.base = this.handlers.onStart(frame);
    }

    if (this.base !== undefined) this.handlers.onMove(frame, this.base);
  }

  pointerUp(event: PointerLike, now = performance.now()): void {
    if (this.phase === 'idle' || event.pointerId !== this.pointerId) return;

    const wasDragging = this.phase === 'dragging';
    const base = this.base;
    this.tracker.add(event.clientX, event.clientY, now);
    const end: DragEnd = { ...this.frame(event), velocity: this.tracker.velocity() };

    this.release();

    // Нажатие без движения — это клик, а не пустой жест. Никакой фиксации,
    // никакой записи в историю.
    if (wasDragging && base !== undefined) this.handlers.onCommit(end, base);
  }

  cancel(): void {
    if (this.phase === 'idle') return;
    const base = this.base;
    const wasDragging = this.phase === 'dragging';
    this.release();
    if (wasDragging && base !== undefined) this.handlers.onCancel(base);
  }

  private frame(event: PointerLike): DragFrame {
    return {
      dx: event.clientX - this.startX,
      dy: event.clientY - this.startY,
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
  }

  private release(): void {
    if (this.element !== undefined && this.pointerId !== undefined) {
      try {
        if (this.element.hasPointerCapture(this.pointerId)) {
          this.element.releasePointerCapture(this.pointerId);
        }
      } catch {
        // Захват мог быть снят браузером — это не ошибка.
      }
    }
    this.phase = 'idle';
    this.pointerId = undefined;
    this.element = undefined;
    this.base = undefined;
    this.tracker.reset();
  }
}

/**
 * Точка захвата.
 *
 * Обязательна: объект должен остаться взятым там, где его взяли.
 * Прыжок центром под указатель разрушает ощущение прямого управления мгновенно.
 */
export function grabOffset(pointer: number, elementOrigin: number): number {
  return pointer - elementOrigin;
}
