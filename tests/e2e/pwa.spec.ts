import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * PWA и работа без сети на настоящей сборке (PROMPT 32 §5–§8).
 *
 * Прогон идёт в проекте `chromium`, направленном на `npm run preview`, —
 * то есть на тот же артефакт, который поедет на хостинг. Проверять
 * service worker на dev-сервере бессмысленно: там его нет, а список
 * предзагрузки собирается из `dist/`.
 *
 * Все сценарии здесь последовательные (`describe.serial` не нужен —
 * контекст у каждого свой), но каждый начинается с ожидания активации
 * воркера: без этого проверка офлайна проверяла бы кэш HTTP, а не наш.
 */

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

/** Дождаться, пока воркер встанет и возьмёт страницу под управление. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 20_000 },
  );
}

test('манифест отдаётся и описывает устанавливаемое приложение (§5)', async ({ page }) => {
  await page.goto('/');
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(href).toBe('/manifest.webmanifest');

  const response = await page.request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifest.name).toContain('Furniture Builder');
  // Подпись под значком на домашнем экране обрезается примерно после
  // двенадцати знаков. «Furniture Builder» превращалось в «Furniture B…»,
  // поэтому короткое имя — одно слово: рядом со значком оно однозначно.
  expect(manifest.short_name).toBe('Furniture');
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);

  // Каждая иконка обязана существовать: манифест со ссылкой в никуда
  // проходит валидатор, но приложение с ним не устанавливается.
  for (const icon of manifest.icons) {
    const icons = await page.request.get(icon.src);
    expect(icons.ok(), `иконка ${icon.src}`).toBe(true);
  }
});

test('iOS-теги на месте: манифест там не читают (§5)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Furniture Builder',
  );
  expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThan(0);
});

test('service worker регистрируется и предзагружает оболочку (§6)', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const ours = names.filter((n) => n.startsWith('furniture-builder-'));
    if (ours[0] === undefined) return { names: ours, urls: [] as string[] };
    const cache = await caches.open(ours[0]);
    return { names: ours, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
  });

  // Ровно один кэш приложения: старые версии удаляются на активации.
  expect(cached.names).toHaveLength(1);
  expect(cached.urls).toContain('/');
  expect(cached.urls.some((u) => /^\/assets\/index-.*\.js$/.test(u))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith('.css'))).toBe(true);
});

test('приложение открывается и работает без сети (§6)', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  await expect(scene(page)).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  // Открылось приложение, а не страница браузера об отсутствии сети.
  await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
  await expect(scene(page)).toBeVisible();

  // Создание и правка: расчёт идёт целиком на устройстве, сеть ему не нужна.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1600');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2000');
  await expect(scene(page)).toHaveAttribute('aria-label', /1600/);
  await expect(scene(page)).toHaveAttribute('aria-label', /2000/);

  // Сохранение в IndexedDB — тоже локальное действие.
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  await context.setOffline(false);
});

test('без сети доступны все разделы, включая производство (§6)', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();

  await page.getByRole('radio', { name: 'Помещение' }).click();
  // Помещения ещё нет — экран объясняет это и предлагает создать. Важно
  // здесь не наличие инспектора, а то, что раздел вообще открылся: без
  // сети он обязан работать так же, как с ней.
  await expect(page.getByRole('button', { name: 'Создать помещение' })).toBeVisible();

  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('radio', { name: 'Детали', exact: true })).toBeVisible();

  await page.getByRole('radio', { name: 'Библиотека' }).click();
  await expect(page.getByLabel('Библиотека проектов')).toBeVisible();

  await context.setOffline(false);
});

test('сохранённый проект переживает перезагрузку без сети (§8)', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('480');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(scene(page)).toHaveAttribute('aria-label', /480/);

  await context.setOffline(false);
});

test('обновление приложения не трогает проекты пользователя (§7, §8)', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1444');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  // Имитируем выкладку новой версии: кэш приложения стирается целиком,
  // как это сделала бы активация воркера с другим именем кэша.
  const removed = await page.evaluate(async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    return names.length;
  });
  expect(removed).toBeGreaterThan(0);

  await page.reload();
  // Проекты лежат в IndexedDB, которой кэш приложения не касается.
  await expect(scene(page)).toHaveAttribute('aria-label', /1444/);
});

test('экспорт PDF и XLSX работает без сети (§6)', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorker(page);

  // Догрузка тяжёлых ресурсов идёт после активации: шрифт для PDF и оба
  // чанка экспорта. Дожидаемся её, иначе проверялась бы гонка, а не
  // офлайн — и заодно это проверка, что догрузка вообще происходит.
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      const name = names.find((n) => n.startsWith('furniture-builder-'));
      if (name === undefined) return false;
      const urls = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
      return (
        urls.some((u) => /^\/assets\/pdf-/.test(u)) &&
        urls.some((u) => /^\/assets\/xlsx-/.test(u)) &&
        urls.some((u) => u.endsWith('.ttf'))
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('radio', { name: 'Производство' }).click();

  for (const format of ['PDF', 'XLSX']) {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: new RegExp(format) }).click();
    const file = await download;
    expect(await file.failure(), `${format} без сети`).toBeNull();
  }

  await context.setOffline(false);
});

test('неизвестный адрес отдаёт приложение, а не страницу хостинга (§11, §12)', async ({ page }) => {
  const response = await page.request.get('/404.html');
  expect(response.ok()).toBe(true);
  // 404.html — копия входной страницы: на хостингах без rewrite
  // приложение всё равно открывается.
  expect(await response.text()).toContain('<div id="root">');
});
