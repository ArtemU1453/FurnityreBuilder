import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Чистая консоль на production-сборке (PROMPT 32 §22).
 *
 * Проверяется не «нет ошибок в коде», а «пользователь, открывший
 * инструменты разработчика, не увидит ни одной жалобы» — включая
 * предупреждения React, битые запросы и необработанные отказы промисов.
 *
 * Прогон идёт на собранном приложении: предупреждения React в
 * production-сборке другие, чем в dev, и проверять надо то, что поедет
 * на хостинг.
 */

interface Collected {
  readonly messages: string[];
  readonly failures: string[];
}

function collect(page: Page): Collected {
  const messages: string[] = [];
  const failures: string[] = [];

  /**
   * Сообщения самого браузера, а не страницы.
   *
   * В headless-окружении WebGL идёт через программную реализацию, и
   * драйвер печатает советы по производительности вида «GPU stall due to
   * ReadPixels». Их источник — компоновщик Chromium, а не приложение: в
   * коде нет ни `readPixels`, ни `toDataURL`, ни `getImageData`. На
   * настоящей видеокарте этих сообщений нет вовсе, и считать их дефектом
   * продукта значило бы проверять окружение вместо продукта.
   */
  const BROWSER_NOISE = [/GL Driver Message/, /^\[\.WebGL-/];

  const onConsole = (message: ConsoleMessage): void => {
    const text = message.text();
    if (BROWSER_NOISE.some((re) => re.test(text))) return;
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`[${message.type()}] ${text}`);
    }
    // `log` в production-сборке быть не должно вообще: свой отладочный
    // вывод удалён, чужой недостижим (scripts/check-release.mjs).
    if (message.type() === 'log') messages.push(`[log] ${text}`);
  };

  page.on('console', onConsole);
  page.on('pageerror', (error) => {
    messages.push(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    // Прерванные самим приложением запросы (отменённая навигация) — не отказ.
    const failure = request.failure()?.errorText ?? '';
    if (failure.includes('net::ERR_ABORTED')) return;
    failures.push(`${request.method()} ${request.url()} — ${failure}`);
  });

  return { messages, failures };
}

test('основной путь не оставляет в консоли ни одной жалобы', async ({ page }) => {
  const { messages, failures } = collect(page);

  await page.goto('/');
  await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toBeVisible();

  // Проход по всем четырём экранам: React ругается на ключи и состояние
  // при монтировании, поэтому смонтировать надо всё.
  for (const screen of ['Помещение', 'Производство', 'Библиотека', 'Конструктор']) {
    await page.getByRole('radio', { name: screen }).click();
  }

  // Правка модели: перерисовка сцены и пересчёт конвейера.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1500');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  expect(messages, `консоль: ${messages.join('\n')}`).toEqual([]);
  expect(failures, `неудачные запросы: ${failures.join('\n')}`).toEqual([]);
});

test('экспорт PDF и XLSX не пишет в консоль (§22)', async ({ page }) => {
  const { messages, failures } = collect(page);

  await page.goto('/');
  await page.getByRole('radio', { name: 'Производство' }).click();

  for (const format of ['PDF', 'XLSX']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(format) }).click();
    await download;
  }

  // Отложенный чанк PDF содержит два недостижимых `console.log` чужой
  // библиотеки (scripts/check-release.mjs). Здесь проверяется, что они и
  // правда недостижимы: настоящий экспорт в настоящем браузере молчит.
  expect(messages, `консоль: ${messages.join('\n')}`).toEqual([]);
  expect(failures, `неудачные запросы: ${failures.join('\n')}`).toEqual([]);
});
