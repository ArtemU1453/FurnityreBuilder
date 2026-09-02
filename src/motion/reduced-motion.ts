import { REDUCED_MOTION_DURATION } from './tokens.js';
import type { SpringConfig } from './tokens.js';

/**
 * Настройки доступности, влияющие на движение и материалы.
 *
 * Читаются в одном месте, а не разбросанными медиазапросами: иначе про
 * настройку рано или поздно забудут в отдельном компоненте.
 */
export interface MotionPreferences {
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  readonly increasedContrast: boolean;
}

const query = (media: string): boolean => {
  if (typeof globalThis.matchMedia !== 'function') return false;
  try {
    return globalThis.matchMedia(media).matches;
  } catch {
    return false;
  }
};

export function readMotionPreferences(): MotionPreferences {
  return {
    reducedMotion: query('(prefers-reduced-motion: reduce)'),
    reducedTransparency: query('(prefers-reduced-transparency: reduce)'),
    increasedContrast: query('(prefers-contrast: more)'),
  };
}

/** Подписка на изменение настроек: пользователь может переключить их на ходу. */
export function subscribeMotionPreferences(listener: (prefs: MotionPreferences) => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined;

  const medias = [
    '(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)',
    '(prefers-contrast: more)',
  ].map((m) => globalThis.matchMedia(m));

  const handler = (): void => {
    listener(readMotionPreferences());
  };
  medias.forEach((m) => {
    m.addEventListener('change', handler);
  });
  return () => {
    medias.forEach((m) => {
      m.removeEventListener('change', handler);
    });
  };
}

export type MotionPlan =
  | { readonly kind: 'spring'; readonly config: SpringConfig }
  | { readonly kind: 'tween'; readonly duration: number };

/**
 * Reduced motion — не «без обратной связи», а «без вестибулярной нагрузки»:
 * пружины и смещения заменяются коротким кроссфейдом, отскок снимается.
 * Само перетаскивание 1:1 при этом сохраняется — это прямое управление,
 * а не анимация.
 */
export function planMotion(config: SpringConfig, prefs: MotionPreferences): MotionPlan {
  if (prefs.reducedMotion) return { kind: 'tween', duration: REDUCED_MOTION_DURATION };
  return { kind: 'spring', config };
}
