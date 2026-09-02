import { describe, expect, it } from 'vitest';
import { Spring, Spring2D } from '../../../src/motion/spring.js';
import { spring } from '../../../src/motion/tokens.js';
import {
  applyRubberband,
  nearestSnapPoint,
  project,
  rubberband,
} from '../../../src/motion/projection.js';
import { planMotion, readMotionPreferences } from '../../../src/motion/reduced-motion.js';

const settle = (s: Spring, steps = 400): void => {
  for (let i = 0; i < steps && !s.settled; i += 1) s.step(1 / 60);
};

describe('пружина', () => {
  it('доходит до цели и останавливается', () => {
    const s = new Spring(0, spring.ui);
    s.setTarget(100);
    settle(s);
    expect(s.settled).toBe(true);
    expect(s.value).toBe(100);
    expect(s.velocity).toBe(0);
  });

  it('при damping 1.0 не перелетает цель', () => {
    const s = new Spring(0, spring.ui);
    s.setTarget(100);
    let overshoot = 0;
    for (let i = 0; i < 400 && !s.settled; i += 1) {
      s.step(1 / 60);
      overshoot = Math.max(overshoot, s.value - 100);
    }
    expect(overshoot).toBeLessThan(0.5);
  });

  it('при damping < 1.0 перелетает — отскок появляется только там, где он заказан', () => {
    const s = new Spring(0, spring.momentum);
    s.setTarget(100);
    let overshoot = 0;
    for (let i = 0; i < 400 && !s.settled; i += 1) {
      s.step(1 / 60);
      overshoot = Math.max(overshoot, s.value - 100);
    }
    expect(overshoot).toBeGreaterThan(0.5);
  });

  it('ПРЕРЫВАЕМОСТЬ: смена цели продолжает движение от текущего значения и скорости', () => {
    const s = new Spring(0, spring.ui);
    s.setTarget(1000);
    for (let i = 0; i < 10; i += 1) s.step(1 / 60);

    const valueAtInterrupt = s.value;
    const velocityAtInterrupt = s.velocity;
    expect(valueAtInterrupt).toBeGreaterThan(0);
    expect(velocityAtInterrupt).toBeGreaterThan(0);

    s.setTarget(0);
    // Скачка быть не должно: значение и скорость сохранились.
    expect(s.value).toBe(valueAtInterrupt);
    expect(s.velocity).toBe(velocityAtInterrupt);

    settle(s);
    expect(s.value).toBe(0);
  });

  it('принимает скорость из жеста', () => {
    const withVelocity = new Spring(0, spring.momentum);
    withVelocity.setTarget(100);
    withVelocity.setVelocity(2000);
    withVelocity.step(1 / 60);

    const without = new Spring(0, spring.momentum);
    without.setTarget(100);
    without.step(1 / 60);

    expect(withVelocity.value).toBeGreaterThan(without.value);
  });

  it('устойчива к огромному и некорректному шагу времени', () => {
    const s = new Spring(0, spring.ui);
    s.setTarget(100);
    s.step(5);
    s.step(Number.NaN);
    s.step(-1);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(1000);
  });

  it('двумерное движение — две независимые пружины', () => {
    const s = new Spring2D({ x: 0, y: 0 }, spring.move);
    s.setTarget({ x: 100, y: 10 });
    for (let i = 0; i < 400 && !s.settled; i += 1) s.step(1 / 60);
    expect(s.x.value).toBe(100);
    expect(s.y.value).toBe(10);
  });
});

describe('проекция момента и резиновые границы', () => {
  it('быстрый бросок улетает дальше медленного', () => {
    expect(project(2000)).toBeGreaterThan(project(500));
    expect(project(-2000)).toBeLessThan(0);
    expect(project(Number.NaN)).toBe(0);
  });

  it('выбирает ближайшую точку привязки к спроецированной остановке', () => {
    expect(nearestSnapPoint(310, [0, 300, 600])).toBe(300);
    expect(nearestSnapPoint(310, [])).toBeUndefined();
  });

  it('сопротивление растёт с выходом за границу, но не переходит в стену', () => {
    const near = rubberband(10, 800);
    const far = rubberband(200, 800);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThan(200);
  });

  it('внутри границ значение не искажается', () => {
    expect(applyRubberband(500, 0, 1000, 800)).toBe(500);
    expect(applyRubberband(-100, 0, 1000, 800)).toBeGreaterThan(-100);
    expect(applyRubberband(1100, 0, 1000, 800)).toBeLessThan(1100);
  });
});

describe('reduced motion', () => {
  it('без matchMedia настройки считаются выключенными, а не падают', () => {
    expect(readMotionPreferences()).toEqual({
      reducedMotion: false,
      reducedTransparency: false,
      increasedContrast: false,
    });
  });

  it('при reduced motion пружина заменяется коротким переходом', () => {
    const prefs = { reducedMotion: true, reducedTransparency: false, increasedContrast: false };
    expect(planMotion(spring.sheet, prefs)).toEqual({ kind: 'tween', duration: 150 });
  });

  it('без ограничения используется пружина из токенов', () => {
    const prefs = { reducedMotion: false, reducedTransparency: false, increasedContrast: false };
    expect(planMotion(spring.sheet, prefs)).toEqual({ kind: 'spring', config: spring.sheet });
  });
});
