import { expect, test } from '@playwright/test';
import { cp, rm } from 'node:fs/promises';

/**
 * Обновление развёрнутого приложения: версия A → версия B (PROMPT 36 §10).
 *
 * Проверяется то, чего не видно ни на одной сборке по отдельности: что
 * после ВЫКЛАДКИ новой версии пользователь получает именно её, старый и
 * новый код не смешиваются, а сохранённые проекты остаются на месте.
 *
 * Сценарий работает только когда каталог, который отдаёт сервер, задан
 * через `DEPLOY_LIVE_DIR`, а рядом лежат две настоящие сборки
 * (`DEPLOY_VER_A`, `DEPLOY_VER_B`). Без них проверять нечего, и тест
 * честно пропускается, а не притворяется пройденным.
 */

const LIVE = process.env.DEPLOY_LIVE_DIR;
const VER_A = process.env.DEPLOY_VER_A;
const VER_B = process.env.DEPLOY_VER_B;

test.skip(
  LIVE === undefined || VER_A === undefined || VER_B === undefined,
  'нужны DEPLOY_LIVE_DIR, DEPLOY_VER_A и DEPLOY_VER_B — две настоящие сборки',
);

/** Заменить содержимое отдаваемого каталога указанной сборкой. */
async function deploy(source: string): Promise<void> {
  await rm(LIVE as string, { recursive: true, force: true });
  await cp(source, LIVE as string, { recursive: true });
}

test('выкладка новой версии доходит до пользователя и не теряет проекты', async ({ page }) => {
  test.slow();
  await deploy(VER_A as string);

  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });

  const cacheA = await page.evaluate(async () =>
    (await caches.keys()).find((name) => name.startsWith('furniture-builder-')),
  );
  expect(cacheA, 'версия A не создала своего кэша').toBeTruthy();

  // Проект пользователя: он обязан пережить смену версии.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1666');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  // Выкладка версии B поверх той же площадки.
  await deploy(VER_B as string);

  const failures: string[] = [];
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? '';
    if (error.includes('net::ERR_ABORTED')) return;
    failures.push(`${request.url()} — ${error}`);
  });
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  // Перезагрузка: страница берётся из сети (навигация — сеть первой),
  // поэтому HTML уже новый, а воркер обнаруживает обновление.
  await page.reload();

  // Приложение предлагает обновиться, а не подменяет код молча.
  // Отдельного ожидания «воркер встал в очередь» здесь нет намеренно:
  // предложение и есть наблюдаемый признак того, что он встал, а
  // проверка промежуточного состояния лишь повторяла бы его хуже.
  const banner = page.getByText('Доступна новая версия приложения');
  await expect(banner).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Обновить' }).click();

  // После активации остаётся ровно один кэш — новой версии.
  await page.waitForFunction(
    async (previous) => {
      const names = (await caches.keys()).filter((name) => name.startsWith('furniture-builder-'));
      return names.length === 1 && names[0] !== previous;
    },
    cacheA,
    { timeout: 30_000 },
  );

  // Проект на месте: кэш держит код, IndexedDB — данные.
  await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toHaveAttribute(
    'aria-label',
    /1666/,
    { timeout: 20_000 },
  );

  // Ни одного битого чанка: старый HTML со ссылками на исчезнувшие файлы
  // — самая частая поломка выкладки, и её здесь быть не должно.
  expect(failures, `неудачные запросы после выкладки:\n${failures.join('\n')}`).toEqual([]);
});
