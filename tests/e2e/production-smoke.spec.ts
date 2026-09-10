import { expect, test } from '@playwright/test';
import type { Request, Response } from '@playwright/test';

/**
 * Дымовая проверка ОПУБЛИКОВАННОГО приложения (PROMPT 41).
 *
 * ## Зачем она, если E2E уже прошли
 *
 * Успешная выкладка не доказывает, что приложение работает. Между
 * зелёным прогоном и живой страницей лежит всё, чего в прогоне не было:
 * чужой хостинг, его заголовки, его кэш и — чаще всего остального —
 * базовый путь. Сборка под неверную базу не падает: она отдаёт разметку
 * с ссылками, по которым ничего нет, и человек видит белый экран без
 * единого сообщения. Ни один тест на локальном сервере этого не поймает,
 * потому что там база верная.
 *
 * ## Почему это НЕ повтор всего набора
 *
 * Функциональность проверена до выкладки — гонять её второй раз значит
 * тратить минуты, чтобы узнать уже известное. Здесь ищутся дефекты
 * ИМЕННО ВЫКЛАДКИ: не открылось, не доехали файлы, пустая оболочка,
 * сломанный чанк, ошибка в консоли на живом адресе. Один сценарий,
 * десятки секунд.
 *
 * ## Как запускать
 *
 * ```bash
 * PLAYWRIGHT_BASE_URL=<адрес опубликованного приложения> npm run smoke
 * ```
 */

/** Что считаем ОБЯЗАТЕЛЬНЫМ ресурсом: без него приложение не работает. */
const CRITICAL = /\.(js|css|html)(\?|$)|\/$/;

/**
 * Предупреждения, которые не значат поломки.
 *
 * Список намеренно короткий и обоснованный. Всё остальное — критическая
 * ошибка: смысл проверки в том, чтобы ловить, а не прощать.
 */
const IGNORED_CONSOLE = [
  // Расширения браузера и политика кэша самого хостинга к приложению
  // отношения не имеют.
  /Download the React DevTools/i,
];

interface Findings {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly networkFailures: string[];
  readonly badResponses: string[];
}

test('опубликованное приложение открывается, отвечает и не жалуется', async ({ page }) => {
  test.slow();

  const found: Findings = {
    consoleErrors: [],
    pageErrors: [],
    networkFailures: [],
    badResponses: [],
  };
  const loaded = new Set<string>();

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    found.consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    found.pageErrors.push(`${error.name}: ${error.message}`);
  });
  page.on('requestfailed', (request: Request) => {
    const error = request.failure()?.errorText ?? 'неизвестно';
    // Прерванный запрос — не поломка: так браузер снимает то, что уже не
    // нужно странице.
    if (error.includes('net::ERR_ABORTED')) return;
    if (!CRITICAL.test(request.url())) return;
    found.networkFailures.push(`${request.url()} — ${error}`);
  });
  page.on('response', (response: Response) => {
    if (response.status() < 400) {
      loaded.add(response.url());
      return;
    }
    // Значок вкладки к работе приложения не относится: его отсутствие
    // видно, но ничего не ломает.
    if (/favicon|apple-touch-icon|icon-\d+\.png/.test(response.url())) return;
    found.badResponses.push(`${String(response.status())} ${response.url()}`);
  });

  // ── 1. Адрес отвечает и отдаёт приложение ──────────────────────────
  const response = await page.goto('./', { waitUntil: 'domcontentloaded' });
  expect(response, 'ответа на запрос страницы не пришло').not.toBeNull();
  expect(response!.status(), 'страница приложения').toBeLessThan(400);

  // ── 2. Оболочка не пустая ──────────────────────────────────────────
  // Белый экран при неверном базовом пути выглядит именно так: разметка
  // пришла, а корень приложения остался пустым.
  const root = page.locator('#root');
  await expect(root, 'корень приложения не найден').toHaveCount(1);
  await expect
    .poll(async () => (await root.innerHTML()).length, {
      message: 'оболочка приложения осталась пустой — похоже на неверный базовый путь',
      timeout: 30_000,
    })
    .toBeGreaterThan(200);

  // ── 3. Критические файлы действительно доехали ─────────────────────
  const origin = new URL(page.url()).origin;
  const own = [...loaded].filter((u) => u.startsWith(origin));
  expect(
    own.some((u) => /\/assets\/index-.*\.js$/.test(u)),
    `главный чанк не загрузился. Загружено:\n${own.join('\n')}`,
  ).toBe(true);
  expect(
    own.some((u) => /\.css$/.test(u)),
    'таблица стилей не загрузилась',
  ).toBe(true);

  // ── 4. Интерфейс на месте ──────────────────────────────────────────
  const scene = page.getByRole('img', { name: /Трёхмерный вид изделия/ });
  await expect(scene, 'сцена изделия не появилась').toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Этапы конструктора' })).toBeVisible();

  // ── 5. Одно настоящее действие ─────────────────────────────────────
  // Правка габарита проходит весь путь: интерфейс → команда → домен →
  // геометрия → сцена. Если жив он, живо приложение.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1234');
  await expect(scene, 'правка габарита не дошла до сцены').toHaveAttribute(
    'aria-label',
    /1234/,
    { timeout: 15_000 },
  );

  // ── 6. Приложение осталось пригодным ───────────────────────────────
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('main')).toContainText('Деталей', { timeout: 20_000 });

  // ── 7. Ни одной критической жалобы ─────────────────────────────────
  const report = [
    found.pageErrors.length > 0 ? `Необработанные ошибки:\n  ${found.pageErrors.join('\n  ')}` : '',
    found.consoleErrors.length > 0 ? `Ошибки консоли:\n  ${found.consoleErrors.join('\n  ')}` : '',
    found.networkFailures.length > 0
      ? `Неудачные запросы:\n  ${found.networkFailures.join('\n  ')}`
      : '',
    found.badResponses.length > 0 ? `Ответы 4xx/5xx:\n  ${found.badResponses.join('\n  ')}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  expect(report, `Опубликованное приложение жалуется:\n${report}`).toBe('');
});
