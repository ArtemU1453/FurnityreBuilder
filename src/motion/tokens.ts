/**
 * Токены движения.
 *
 * Параметризация Apple: `damping` (перерегулирование) и `response` (за сколько
 * секунд значение практически доходит до цели). Это не «длительность» —
 * у пружины её нет, время установления вытекает из параметров.
 *
 * Правило проекта: damping 1.0 по умолчанию; отскок только там, где жесту
 * предшествовал импульс. Панель, открытая по клику, отскакивать не должна.
 */
export interface SpringConfig {
  readonly damping: number;
  readonly response: number;
}

export const spring = {
  /** Микрореакция: нажатие, hover-масштаб. */
  instant: { damping: 1.0, response: 0.15 },
  /** База интерфейса: панели, переезд активной вкладки. */
  ui: { damping: 1.0, response: 0.32 },
  /** Перемещение объекта, доводка после drag. */
  move: { damping: 1.0, response: 0.4 },
  /** Sheet и drawer. */
  sheet: { damping: 0.85, response: 0.3 },
  /** Импульс: бросок, возврат карточки. */
  momentum: { damping: 0.8, response: 0.38 },
  /** Резиновый возврат к границе. */
  rubber: { damping: 1.0, response: 0.28 },
} as const satisfies Record<string, SpringConfig>;

export type SpringToken = keyof typeof spring;

/**
 * Не-жестовые переходы. Для смены цвета пружина избыточна.
 * Для всего, что можно схватить пальцем, CSS-переходы запрещены:
 * их нельзя перехватить и развернуть от текущего значения.
 */
export const ease = {
  color: { duration: 120, curve: 'cubic-bezier(.2,0,.2,1)' },
  fade: { duration: 180, curve: 'cubic-bezier(.2,0,.2,1)' },
  theme: { duration: 180, curve: 'cubic-bezier(.4,0,.2,1)' },
} as const;

/** Длительность замены анимации при prefers-reduced-motion, мс. */
export const REDUCED_MOTION_DURATION = 150;
