import type { SpringConfig } from './tokens.js';

/**
 * Пружина с прерыванием и переносом скорости.
 *
 * Ключевое свойство: смена цели не сбрасывает состояние. Значение и скорость
 * сохраняются, поэтому анимация всегда продолжается ОТ ТЕКУЩЕГО положения.
 * Именно этого не умеют CSS transition и @keyframes, и именно поэтому они
 * не годятся для жестов.
 *
 * Интегратор — полунеявный Эйлер с фиксированным подшагом. Фиксированный шаг
 * обязателен: при плавающем dt (пропущенный кадр, вкладка ушла в фон) явная
 * схема расходится, и элемент улетает за экран.
 */
const SUB_STEP = 1 / 240;
const REST_DISPLACEMENT = 0.01;
const REST_VELOCITY = 0.05;

export interface SpringState {
  value: number;
  velocity: number;
  target: number;
}

export class Spring {
  private state: SpringState;
  private config: SpringConfig;

  constructor(initial: number, config: SpringConfig, velocity = 0) {
    this.state = { value: initial, velocity, target: initial };
    this.config = config;
  }

  get value(): number {
    return this.state.value;
  }

  get velocity(): number {
    return this.state.velocity;
  }

  get target(): number {
    return this.state.target;
  }

  get settled(): boolean {
    return (
      Math.abs(this.state.target - this.state.value) < REST_DISPLACEMENT &&
      Math.abs(this.state.velocity) < REST_VELOCITY
    );
  }

  /**
   * Новая цель без разрыва: текущие значение и скорость сохраняются.
   * Это и есть прерываемость — жест можно развернуть в любой момент.
   */
  setTarget(target: number, config?: SpringConfig): void {
    this.state.target = target;
    if (config !== undefined) this.config = config;
  }

  /** Передача скорости из жеста в анимацию: без неё виден шов на отпускании. */
  setVelocity(velocity: number): void {
    this.state.velocity = velocity;
  }

  /** Жёсткая установка: используется, когда пользователь тянет объект 1:1. */
  jumpTo(value: number, velocity = 0): void {
    this.state.value = value;
    this.state.velocity = velocity;
    this.state.target = value;
  }

  step(dt: number): number {
    if (!Number.isFinite(dt) || dt <= 0) return this.state.value;

    // Ограничение сверху: после сворачивания вкладки dt может быть секундами.
    const clamped = Math.min(dt, 0.064);
    const omega = (2 * Math.PI) / this.config.response;
    const zeta = this.config.damping;

    let remaining = clamped;
    while (remaining > 0) {
      const h = Math.min(SUB_STEP, remaining);
      const displacement = this.state.value - this.state.target;
      const acceleration = -2 * zeta * omega * this.state.velocity - omega * omega * displacement;
      this.state.velocity += acceleration * h;
      this.state.value += this.state.velocity * h;
      remaining -= h;
    }

    if (this.settled) {
      this.state.value = this.state.target;
      this.state.velocity = 0;
    }
    return this.state.value;
  }
}

/**
 * Двумерное движение — две независимые пружины.
 *
 * Одна пружина на двумерное расстояние рассинхронизируется, когда по осям
 * разные скорости: траектория «схлопывается» и выглядит неестественно.
 */
export class Spring2D {
  readonly x: Spring;
  readonly y: Spring;

  constructor(initial: { x: number; y: number }, config: SpringConfig) {
    this.x = new Spring(initial.x, config);
    this.y = new Spring(initial.y, config);
  }

  setTarget(target: { x: number; y: number }, config?: SpringConfig): void {
    this.x.setTarget(target.x, config);
    this.y.setTarget(target.y, config);
  }

  setVelocity(v: { x: number; y: number }): void {
    this.x.setVelocity(v.x);
    this.y.setVelocity(v.y);
  }

  step(dt: number): { x: number; y: number } {
    return { x: this.x.step(dt), y: this.y.step(dt) };
  }

  get settled(): boolean {
    return this.x.settled && this.y.settled;
  }
}
