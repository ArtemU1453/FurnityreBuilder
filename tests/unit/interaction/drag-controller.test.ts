import { describe, expect, it, vi } from 'vitest';
import {
  DragController,
  grabOffset,
  DRAG_THRESHOLD_MOUSE,
} from '../../../src/interaction/drag-controller.js';
import type { CapturableElement, PointerLike } from '../../../src/interaction/drag-controller.js';

/** Минимальный элемент с захватом указателя: без него jsdom не даёт setPointerCapture. */
function fakeElement(): CapturableElement & { captured: number[] } {
  const captured: number[] = [];
  return {
    captured,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: (id: number) => {
      captured.push(id);
    },
    releasePointerCapture: (id: number) => {
      const i = captured.indexOf(id);
      if (i >= 0) captured.splice(i, 1);
    },
    hasPointerCapture: (id: number) => captured.includes(id),
  };
}

const pointer = (x: number, y: number, id = 1): PointerLike => ({
  pointerId: id,
  clientX: x,
  clientY: y,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
});

function makeController() {
  const handlers = {
    onStart: vi.fn(() => ({ base: 500 })),
    onMove: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
  };
  return { handlers, controller: new DragController(handlers) };
}

describe('контроллер перетаскивания', () => {
  it('захватывает указатель на нажатии', () => {
    const { controller } = makeController();
    const el = fakeElement();
    controller.pointerDown(pointer(100, 100), el, 0);
    expect(el.captured).toEqual([1]);
  });

  it('не начинает жест до порога — короткое движение остаётся кликом', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(100, 100), fakeElement(), 0);
    controller.pointerMove(pointer(100 + DRAG_THRESHOLD_MOUSE - 1, 100), 10);
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(controller.isDragging).toBe(false);
  });

  it('начинает жест после порога и отдаёт кадры движения', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(100, 100), fakeElement(), 0);
    controller.pointerMove(pointer(120, 100), 16);
    controller.pointerMove(pointer(140, 100), 32);
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onMove).toHaveBeenCalledTimes(2);
    expect(handlers.onMove.mock.calls[1]?.[0]).toMatchObject({ dx: 40, dy: 0 });
  });

  it('передаёт смещение от точки НАЖАТИЯ, а не абсолютную позицию', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(300, 200), fakeElement(), 0);
    controller.pointerMove(pointer(310, 260), 16);
    expect(handlers.onMove.mock.calls[0]?.[0]).toMatchObject({ dx: 10, dy: 60 });
  });

  it('фиксирует один раз на отпускании и освобождает захват', () => {
    const { handlers, controller } = makeController();
    const el = fakeElement();
    controller.pointerDown(pointer(100, 100), el, 0);
    controller.pointerMove(pointer(150, 100), 16);
    controller.pointerUp(pointer(160, 100), 32);
    expect(handlers.onCommit).toHaveBeenCalledTimes(1);
    expect(el.captured).toEqual([]);
    expect(controller.isDragging).toBe(false);
  });

  it('нажатие без движения не фиксирует ничего', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(100, 100), fakeElement(), 0);
    controller.pointerUp(pointer(100, 100), 8);
    expect(handlers.onCommit).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('отмена возвращает базовое состояние и не фиксирует', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(100, 100), fakeElement(), 0);
    controller.pointerMove(pointer(200, 100), 16);
    controller.cancel();
    expect(handlers.onCancel).toHaveBeenCalledWith({ base: 500 });
    expect(handlers.onCommit).not.toHaveBeenCalled();
  });

  it('передаёт скорость на отпускании — иначе между жестом и анимацией виден шов', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(0, 0), fakeElement(), 0);
    // 100 px за 100 мс = 1000 px/s
    controller.pointerMove(pointer(50, 0), 50);
    controller.pointerMove(pointer(100, 0), 100);
    controller.pointerUp(pointer(100, 0), 100);
    const end = handlers.onCommit.mock.calls[0]?.[0] as { velocity: { x: number } };
    expect(end.velocity.x).toBeGreaterThan(500);
  });

  it('игнорирует события другого указателя — мультитач не ломает жест', () => {
    const { handlers, controller } = makeController();
    controller.pointerDown(pointer(100, 100, 1), fakeElement(), 0);
    controller.pointerMove(pointer(400, 400, 2), 16);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('точка захвата сохраняется: объект не прыгает центром под указатель', () => {
    expect(grabOffset(320, 300)).toBe(20);
  });
});
