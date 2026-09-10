import { expect, test } from '@playwright/test';
import { openScene, scene } from './open-scene.js';

/**
 * Управляемые отказы в собранном приложении (PROMPT 45 §14, §18).
 *
 * ## Почему это E2E, а не модульные тесты
 *
 * Модульные тесты границы ошибки проверяют компонент. Здесь проверяется
 * другое: что в НАСТОЯЩЕЙ production-сборке настоящий отказ приводит к
 * тому экрану, который мы обещали. Между «компонент показывает
 * сообщение» и «пользователь его увидел» помещается вся сборка целиком.
 *
 * ## Ни одного тестового люка в приложении
 *
 * Все три отказа вызываются снаружи и по-настоящему: чанк подменяется на
 * ответ хостинга, исключение бросается в контексте страницы. В коде
 * приложения нет ни одной ветки «если тест — сломайся»: такой люк из
 * теста однажды выполняется в production (§18).
 */

/*
  Service worker выключен для всего файла.

  Он предзагружает чанки экспорта, и с ним подменить ответ хостинга
  невозможно: запрос до сети не дойдёт. Проверяется же именно поведение
  при отказе загрузки — значит загрузка обязана идти через сеть.
*/
test.use({ serviceWorkers: 'block' });

test('не доехавший чанк экспорта объясняется словами и даёт перезагрузку (§5, §13)', async ({
  page,
}) => {
  /*
    Ровно то, что происходит после выкладки: вкладка открыта со старой
    разметкой, чанка с прежним именем на хостинге уже нет, и хостинг
    отдаёт на его месте страницу 404. Браузер получает HTML там, где
    ждал модуль.
  */
  await page.route('**/assets/pdf-*.js', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>404</title>',
    });
  });

  await page.goto('./');

  await openScene(page);
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('button', { name: /PDF/ }).click();

  // Человеку сказано, что произошло и что делать, — а не «Failed to
  // fetch dynamically imported module».
  const message = page.getByText('Часть приложения не загрузилась');
  await expect(message).toBeVisible({ timeout: 20_000 });
  await expect(message).toContainText('Перезагрузите страницу');
  await expect(page.getByText('Failed to fetch')).toHaveCount(0);

  // Перезагрузка предлагается ровно здесь: она эту ошибку действительно
  // чинит. Нажимать её незачем — проверяется наличие выхода, а не сам
  // браузер.
  await expect(page.getByRole('button', { name: 'Перезагрузить приложение' })).toBeVisible();
});

test('ошибка вне отрисовки не проходит молча (§11)', async ({ page }) => {
  await page.goto('./');
  await openScene(page);
  await expect(scene(page)).toBeVisible();

  /*
    Настоящее необработанное исключение в контексте страницы: именно то,
    чего не ловит ни одна граница React. До PROMPT 45 такой сбой не
    оставлял на экране ничего.
  */
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Controlled failure: обработчик события');
    }, 0);
  });

  const banner = page.getByText('Приложение столкнулось с непредвиденной ошибкой');
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // Сообщение информирует, а не блокирует: работа продолжается.
  await expect(scene(page)).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(banner).toHaveCount(0);
});

test('отклонённое обещание замечается так же, как исключение (§11)', async ({ page }) => {
  await page.goto('./');
  await openScene(page);
  await expect(scene(page)).toBeVisible();

  await page.evaluate(() => {
    void Promise.reject(new Error('Controlled failure: обещание'));
  });

  await expect(page.getByText('Приложение столкнулось с непредвиденной ошибкой')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Одно из действий не завершилось')).toBeVisible();
});

test('сохранённый проект переживает непредвиденную ошибку (§6, §14)', async ({ page }) => {
  await page.goto('./');
  await openScene(page);
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1777');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  // Сбой ПОСЛЕ записи: именно здесь обработка ошибок могла бы стереть
  // или перезаписать проект — и не должна.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Controlled failure: после сохранения');
    }, 0);
  });
  await expect(page.getByText('Приложение столкнулось с непредвиденной ошибкой')).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();

  await openScene(page);

  // Проект вернулся тем же. Код лежит в кэше, данные — в IndexedDB, и
  // ошибка не касается ни того, ни другого.
  await expect(scene(page)).toHaveAttribute('aria-label', /1777/, { timeout: 20_000 });
});

test('недоступный WebGL объясняется, а не превращается в ошибку (§2, §4)', async ({ page }) => {
  /*
    Отказ вызывается настоящий и снаружи: браузер перестаёт выдавать
    WebGL. Ровно это происходит при потере контекста, на старом драйвере
    и в среде без аппаратного ускорения.

    Проверяется здесь не граница ошибки — и это выяснилось замером, а не
    предположением. Сцена обрабатывает такой отказ САМА и показывает
    объяснение вместо изделия (`Scene3D.tsx`, §34). Это лучше границы:
    объяснение конкретное, а редактор остаётся целым, без разговора об
    «ошибке». Дублировать поверх этого ещё и границу незачем — §1 прямо
    запрещает заводить второй механизм там, где работает первый.
  */
  await page.addInitScript(() => {
    // Метод берётся через `Reflect`, а не ссылкой на прототип: линтер
    // справедливо не любит оторванные от объекта методы, а вызывается он
    // ниже всё равно через `apply` с явным получателем.
    const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as (
      ...rest: unknown[]
    ) => unknown;
    HTMLCanvasElement.prototype.getContext = function patched(
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      if (typeof args[0] === 'string' && args[0].startsWith('webgl')) {
        throw new Error('Controlled failure: WebGL недоступен');
      }
      return original.apply(this, args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto('./');

  /*
    Здесь `openScene` не годится: он ждёт холст сцены, а холста в этом
    сценарии не будет — WebGL отказал, и вместо изделия появится
    объяснение. Переключатель нажимается напрямую, а ожидание — то, что
    на самом деле должно появиться.
  */
  await page.getByRole('radio', { name: 'Сцена', exact: true }).check();

  await expect(page.getByText('Трёхмерный просмотр недоступен')).toBeVisible({ timeout: 20_000 });

  // Приложение при этом целое: правка доходит до модели, производство
  // считается. Отказ ограничен одним холстом.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1888');
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByText(/Деталей/).first()).toBeVisible();
});

test('данные для отчёта собираются локально и показываются целиком (§8, §9, §15)', async ({
  page,
}) => {
  await page.goto('./');
  await openScene(page);
  // Габарит вводится ДО ошибки: он не должен попасть в отчёт.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1888');

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Controlled failure: сбор диагностики');
    }, 0);
  });
  await expect(page.getByText('Приложение столкнулось с непредвиденной ошибкой')).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole('button', { name: 'Данные для диагностики' }).click();

  const report = page.getByRole('dialog', { name: 'Данные для отчёта об ошибке' });
  await expect(report).toBeVisible();
  const text = (await report.textContent()) ?? '';

  expect(text, 'в отчёте нет версии').toMatch(/Версия: \d+\.\d+\.\d+/);
  expect(text, 'в отчёте нет причины').toContain('Controlled failure: сбор диагностики');
  expect(text, 'в отчёте нет браузера').toContain('Mozilla/');

  // Ничего из проекта: габарит, только что введённый человеком, в отчёт
  // не попадает. Это и есть проверка §15 на фактической реализации.
  expect(text, 'в отчёт попал габарит проекта').not.toContain('1888');
  expect(text, 'в отчёте появился адрес').not.toMatch(/https?:\/\//);
  expect(text, 'в отчёте появился сервис отслеживания').not.toMatch(
    /sentry|telemetry|analytics/i,
  );

  await expect(page.getByRole('button', { name: 'Скопировать' })).toBeVisible();
});
