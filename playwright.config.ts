import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    /*
      Адрес проверяемого приложения.

      По умолчанию — локальная production-сборка, поднятая `webServer`
      ниже. `PLAYWRIGHT_BASE_URL` перенаправляет тот же набор сценариев на
      УЖЕ РАЗВЁРНУТОЕ приложение: на статический сервер, на площадку
      предпросмотра или на боевой адрес. Отдельного набора «проверок
      после выкладки» не заводится — иначе их пришлось бы поддерживать
      наравне с основными, и они разошлись бы при первой же правке
      (docs/DEPLOYMENT.md §8).
    */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // Технический debug-renderer существует только в режиме разработки
      // (import.meta.env.DEV, docs/GEOMETRY_RULES.md §12) и в этот прогон,
      // построенный на production-сборке, не попадает — для него отдельный
      // проект ниже, направленный на dev-сервер.
      testIgnore: '**/debug-schema.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Средам с предустановленным браузером (контейнеры разработки) можно
        // указать его путь и не скачивать второй экземпляр. В CI переменная
        // не задана, и используется браузер из `playwright install`.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined
          ? {}
          : { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }),
      },
    },
    {
      name: 'chromium-dev',
      testMatch: '**/debug-schema.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174',
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined
          ? {}
          : { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }),
      },
    },
  ],
  /*
    Локальные серверы поднимаются только тогда, когда цель не задана
    снаружи: при проверке развёрнутого приложения поднимать нечего.
  */
  webServer: process.env.PLAYWRIGHT_BASE_URL !== undefined ? [] : [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -- --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
