/**
 * Версия приложения (PROMPT 32 §26).
 *
 * Значения подставляются сборщиком из `package.json` и даты сборки —
 * см. `vite.config.ts`. Второго места, где написан номер версии, в
 * проекте нет: два таких места расходятся при первом же выпуске.
 *
 * Значения по умолчанию нужны модульным тестам: они выполняются без
 * Vite, и подставлять там нечему. Запасное значение намеренно НЕ похоже
 * на настоящий номер версии (`0.0.0-dev`, а не `0.0.0`): увидев его в
 * интерфейсе, сразу понятно, что сборка шла мимо обычного пути, а не что
 * это первая версия продукта.
 */

declare const __APP_VERSION__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'dev';

/** Одной строкой — для подписи в интерфейсе и для отчётов об ошибках. */
export const BUILD_ID = `${APP_VERSION} (${BUILD_DATE})`;
