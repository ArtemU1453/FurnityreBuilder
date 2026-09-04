/**
 * Режим раскладки (PROMPT 28 §2, §3).
 *
 * ## Один слой, три режима
 *
 * Домен, геометрия, хранение и рендерер не знают о размере экрана и
 * знать не должны. Здесь — единственное место, где ширина окна
 * превращается в решение «как показывать», и решение это трёхзначное:
 * телефон, планшет, десктоп.
 *
 * `MobileDomain`, `MobileGeometry`, `MobileProject` и `MobileRenderer` не
 * существуют и существовать не могут: мобильная версия — режим показа
 * того же приложения, а не второе приложение.
 *
 * ## Значения не выдуманы
 *
 * 600 / 900 / 1200 px уже жили в `design-system/tokens.css` с PROMPT 26 и
 * уже управляли раскладкой в CSS. Здесь они не заведены заново, а
 * названы: одни и те же числа в `@media` и в TypeScript — иначе CSS
 * считал бы экран телефоном, а React в тот же момент — планшетом.
 *
 * Граница `desktop` (1200 px) внутри режима «десктоп» отвечает только за
 * третью колонку и отдельным режимом не является: и там, и там раскладка
 * остаётся многоколоночной, а поведение — указательным.
 *
 * ## Высота тоже решает
 *
 * Телефон в альбомной ориентации — это 844×390. По ширине это «планшет»,
 * и до PROMPT 28 он его и получал: две колонки, страница 1879 px при
 * 390 px экрана. Замер на планшете в той же ориентации (1024×768) —
 * 958 px. Разница не в ширине, а в высоте: боковая колонка не
 * помещается по вертикали, и работа снова превращается в прокрутку.
 *
 * Поэтому «телефон» — это узкий экран ИЛИ низкий и не широкий. Третьего
 * режима из этого не заводится: раскладка та же самая, что у телефона в
 * портрете.
 *
 * ## Файл чистый
 *
 * Ни React, ни DOM, ни `window`. Поэтому разбор ширины на режимы
 * проверяется обычным тестом, а не запуском браузера.
 */

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

/** Границы из `design-system/tokens.css`. В `@media` переменные не подставляются. */
export const BREAKPOINTS = {
  /** Телефон: ширина не больше этой. */
  mobile: 600,
  /** Планшет: ширина не больше этой (и больше телефонной). */
  tablet: 900,
  /** Десктоп с тремя колонками: ширина больше этой. */
  desktop: 1200,
} as const;

/**
 * Режим по размеру окна в CSS-пикселях.
 *
 * Высота необязательна: без неё решает только ширина — так же, как
 * решала до PROMPT 28.
 */
export function layoutModeOf(width: number, height?: number): LayoutMode {
  if (!Number.isFinite(width)) return 'desktop';
  if (width <= BREAKPOINTS.mobile) return 'mobile';
  // Низкий и не широкий экран — это телефон в альбомной ориентации.
  if (height !== undefined && Number.isFinite(height) && height <= BREAKPOINTS.mobile) {
    if (width <= BREAKPOINTS.tablet) return 'mobile';
  }
  if (width <= BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

/**
 * Медиазапрос режима — тот же, что в CSS.
 *
 * Строится из тех же чисел, поэтому CSS и React переключаются на одном
 * и том же пикселе, а не «примерно там же».
 */
export function mediaQueryOf(mode: LayoutMode): string {
  const narrow = `(max-width: ${String(BREAKPOINTS.mobile)}px)`;
  const short = `(max-width: ${String(BREAKPOINTS.tablet)}px) and (max-height: ${String(BREAKPOINTS.mobile)}px)`;
  if (mode === 'mobile') return `${narrow}, ${short}`;
  if (mode === 'tablet')
    return `(min-width: ${String(BREAKPOINTS.mobile + 1)}px) and (max-width: ${String(BREAKPOINTS.tablet)}px) and (min-height: ${String(BREAKPOINTS.mobile + 1)}px)`;
  return `(min-width: ${String(BREAKPOINTS.tablet + 1)}px)`;
}

/**
 * Показывать ли параметры листом снизу.
 *
 * На телефоне — да: постоянная боковая колонка отнимает у холста
 * большую часть экрана. На планшете и десктопе колонка помещается, и
 * лист там был бы лишним щелчком (PROMPT 28 §7).
 */
export function usesSheets(mode: LayoutMode): boolean {
  return mode === 'mobile';
}

/**
 * Показывать ли лестницу шагов целиком.
 *
 * На телефоне одиннадцать шагов подряд занимают 139 px по вертикали и
 * не помещаются по горизонтали даже на 320 px — поэтому там остаётся
 * текущий шаг с переходами, а весь список открывается листом
 * (PROMPT 28 §24).
 */
export function usesFullStepRail(mode: LayoutMode): boolean {
  return mode !== 'mobile';
}
