import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
  webServer: [
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
