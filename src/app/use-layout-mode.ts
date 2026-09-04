import { useEffect, useState } from 'react';
import { layoutModeOf, mediaQueryOf } from './layout.js';
import type { LayoutMode } from './layout.js';

/**
 * Текущий режим раскладки (PROMPT 28 §3, §42).
 *
 * ## Почему `matchMedia`, а не слушатель `resize`
 *
 * `resize` приходит на каждый пиксель — при повороте телефона и при
 * появлении экранной клавиатуры это десятки событий подряд, и каждое
 * перерисовывало бы дерево. `matchMedia` сообщает ровно о том, что
 * важно: пересечении границы режима.
 *
 * ## Состояние ТОЛЬКО интерфейса
 *
 * Режим не попадает ни в проект, ни в историю, ни в сохранение. Поворот
 * телефона не меняет ни одного миллиметра изделия — он меняет только
 * то, где стоят панели.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() =>
    typeof window === 'undefined' ? 'desktop' : layoutModeOf(window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const modes: readonly LayoutMode[] = ['mobile', 'tablet', 'desktop'];
    const lists = modes.map((value) => ({ value, list: window.matchMedia(mediaQueryOf(value)) }));
    const sync = (): void => {
      const match = lists.find((entry) => entry.list.matches);
      setMode(match?.value ?? layoutModeOf(window.innerWidth, window.innerHeight));
    };

    sync();
    for (const entry of lists) entry.list.addEventListener('change', sync);
    return () => {
      for (const entry of lists) entry.list.removeEventListener('change', sync);
    };
  }, []);

  return mode;
}

/**
 * Грубый ли указатель (PROMPT 28 §11, §19).
 *
 * Именно указатель, а не ширина экрана: планшет с пальцем и ноутбук с
 * мышью бывают одной ширины, а размер цели решает то, чем в неё
 * попадают. Тот же признак, по которому в `tokens.css` растут контролы.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia('(pointer: coarse)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia('(pointer: coarse)');
    const sync = (): void => {
      setCoarse(list.matches);
    };
    sync();
    list.addEventListener('change', sync);
    return () => {
      list.removeEventListener('change', sync);
    };
  }, []);

  return coarse;
}
