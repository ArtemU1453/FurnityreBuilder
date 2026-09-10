import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /*
    Повторов нет — ни в CI, ни локально (PROMPT 39 §11).

    Повтор допустим только против подтверждённой нестабильности
    инфраструктуры. Такой здесь не подтверждено, а `retries: 1` в CI
    означал бы, что упавший с первого раза детерминированный сценарий
    пройдёт со второго и никто об этом не узнает. Ворота, которые
    пропускают через раз, — не ворота.
  */
  retries: 0,
  /*
    В CI два докладчика: `list` пишет ход прогона прямо в журнал, а
    `html` оставляет отчёт, который выгружается артефактом при падении.
    Без второго от упавшего прогона остаётся только строка «failed».
  */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
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
    /*
      Трасса сохраняется при падении, а не «при первом повторе»:
      повторов больше нет, и прежняя настройка не дала бы ни одной
      трассы вообще.
    */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Технический debug-renderer существует только в режиме разработки
      // (import.meta.env.DEV, docs/GEOMETRY_RULES.md §12) и в этот прогон,
      // построенный на production-сборке, не попадает — для него отдельный
      // проект ниже, направленный на dev-сервер.
      // Дымовая проверка выкладки сюда не входит: она идёт по
      // ОПУБЛИКОВАННОМУ адресу и своим проектом (PROMPT 41).
      testIgnore: ['**/debug-schema.spec.ts', '**/production-smoke.spec.ts'],
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
    {
      /*
        Дымовая проверка опубликованного приложения (PROMPT 41).

        Отдельный проект, а не файл в общем наборе: цель у него другая.
        Общий набор отвечает на вопрос «работает ли продукт» и идёт до
        выкладки; этот — на вопрос «доехало ли то, что мы выложили», и
        идёт по живому адресу. Смешав их, пришлось бы гонять четыре
        минуты функциональных сценариев ради ответа, который даётся за
        двадцать секунд.

        Адрес обязателен и приходит снаружи — из вывода самой выкладки:

          PLAYWRIGHT_BASE_URL=<адрес> npm run smoke
      */
      name: 'production-smoke',
      testMatch: '**/production-smoke.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
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
      /*
        `--host 127.0.0.1` обязателен, и это не украшение.

        Без него Vite слушает `localhost`, а `localhost` — имя, а не
        адрес. Node 17+ больше не ставит IPv4 первым: на машине с двойным
        стеком имя разрешается в `::1`, сервер поднимается только там, а
        Playwright всё это время стучится в `127.0.0.1` и не достучится
        никогда. Ровно это и происходило в CI: сборка отрабатывала за
        тринадцать секунд, после чего прогон честно ждал сто восемьдесят
        секунд и падал с `Timed out waiting from config.webServer`. E2E в
        CI не запускались НИ РАЗУ (PROMPT 39).

        Здесь адрес и `url` ниже — одно и то же, буквально. Догадываться
        не о чем.
      */
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
