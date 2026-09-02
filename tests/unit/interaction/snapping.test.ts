import { describe, expect, it } from 'vitest';
import {
  equalShareCandidates,
  snapToCandidates,
  snapToStep,
  stepForModifiers,
  system32Candidates,
} from '../../../src/interaction/snapping.js';
import { VelocityTracker, median } from '../../../src/interaction/velocity-tracker.js';
import { arrowDelta, matchBinding, KEY_BINDINGS } from '../../../src/interaction/keyboard.js';

describe('привязка', () => {
  it('шаг зависит от модификаторов', () => {
    expect(stepForModifiers({})).toBe(1);
    expect(stepForModifiers({ shift: true })).toBe(10);
    expect(stepForModifiers({ alt: true })).toBe(0.1);
  });

  it('округляет к шагу', () => {
    expect(snapToStep(1234, 10)).toBe(1230);
    expect(snapToStep(1236, 10)).toBe(1240);
  });

  it('радиус притяжения задан в пикселях экрана, а не в миллиметрах', () => {
    const candidates = [{ value: 500, kind: 'equal' as const }];
    // При масштабе 1 px/мм 6 мм попадают в радиус 6 px.
    expect(snapToCandidates(505, candidates, 1).value).toBe(500);
    // При масштабе 0.1 px/мм тот же радиус — это 60 мм.
    expect(snapToCandidates(550, candidates, 0.1).value).toBe(500);
    // А при сильном увеличении магнит перестаёт дотягиваться.
    expect(snapToCandidates(505, candidates, 10).value).toBe(505);
  });

  it('выбирает ближайший магнит', () => {
    const result = snapToCandidates(
      502,
      [
        { value: 500, kind: 'equal' },
        { value: 505, kind: 'center' },
      ],
      1,
    );
    expect(result.snapped?.value).toBe(500);
  });

  it('без магнитов в радиусе значение не меняется', () => {
    const result = snapToCandidates(400, [{ value: 500, kind: 'equal' }], 1);
    expect(result.value).toBe(400);
    expect(result.snapped).toBeUndefined();
  });

  it('строит равные доли отрезка', () => {
    expect(equalShareCandidates(900, 3).map((c) => c.value)).toEqual([300, 600]);
  });

  it('строит сетку системы 32', () => {
    expect(system32Candidates(0, 100)).toHaveLength(4);
    expect(system32Candidates(0, 100).map((c) => c.value)).toEqual([0, 32, 64, 96]);
  });
});

describe('скорость указателя', () => {
  it('без выборки скорость нулевая', () => {
    expect(new VelocityTracker().velocity()).toEqual({ x: 0, y: 0 });
  });

  it('берёт медиану, а не последнюю дельту', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0, 0);
    tracker.add(10, 0, 10);
    tracker.add(20, 0, 20);
    // Палец замер перед подъёмом: последняя дельта нулевая и обманула бы анимацию.
    tracker.add(20, 0, 30);
    expect(tracker.velocity().x).toBeGreaterThan(0);
  });

  it('не переполняется: хранит ограниченное окно', () => {
    const tracker = new VelocityTracker(3);
    for (let i = 0; i < 20; i += 1) tracker.add(i, 0, i * 10);
    expect(tracker.size).toBe(3);
  });

  it('медиана устойчива к выбросу', () => {
    expect(median([1, 2, 1000])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('клавиатура', () => {
  it('стрелки дают шаг, совпадающий с шагом привязки', () => {
    const base = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    expect(arrowDelta({ ...base, key: 'ArrowUp' })).toBe(1);
    expect(arrowDelta({ ...base, key: 'ArrowDown', shiftKey: true })).toBe(-10);
    expect(arrowDelta({ ...base, key: 'ArrowRight', altKey: true })).toBe(0.1);
    expect(arrowDelta({ ...base, key: 'a' })).toBe(0);
  });

  it('Mod соответствует Cmd и Ctrl', () => {
    const undo = KEY_BINDINGS.find((b) => b.id === 'undo')!;
    expect(matchBinding({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, undo)).toBe(true);
    expect(matchBinding({ key: 'z', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, undo)).toBe(true);
    expect(matchBinding({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, undo)).toBe(false);
  });

  it('различает отмену и возврат по Shift', () => {
    const redo = KEY_BINDINGS.find((b) => b.id === 'redo')!;
    expect(matchBinding({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, redo)).toBe(true);
    expect(matchBinding({ key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, redo)).toBe(false);
  });

  it('каждое сочетание описано для окна справки', () => {
    for (const binding of KEY_BINDINGS) {
      expect(binding.description.length).toBeGreaterThan(0);
    }
  });
});
