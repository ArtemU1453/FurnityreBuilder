import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Библиотека проектов в настоящем браузере (PROMPT 25 §32).
 *
 * Здесь проверяется только то, чего нельзя проверить без браузера:
 * настоящий IndexedDB, переживание перезагрузки, скачивание файла и
 * связь библиотеки с планировщиком. Поиск, сортировка, дублирование и
 * превью проверены модульно (`tests/unit/library/`,
 * `tests/unit/domain/project-operations.test.ts`).
 */

const library = (page: Page) => page.getByLabel('Библиотека проектов');
/** Сами карточки: в панели есть ещё список недавних, тоже из <li>. */
const cards = (page: Page) => library(page).getByRole('list', { name: 'Проекты', exact: true }).getByRole('listitem');

async function openLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Мои проекты' }).click();
  await expect(library(page)).toBeVisible();
}

async function saveCurrent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Отдельного стирания базы не нужно: у каждого сценария Playwright
  // свой контекст, а значит и своё хранилище. Удалять базу у уже
  // открывшего её приложения нельзя — запрос повисает заблокированным и
  // срабатывает позже, посреди следующего сценария.
  await page.goto('/');
});

test('пустая библиотека объясняет, что делать дальше', async ({ page }) => {
  await openLibrary(page);
  await expect(library(page).getByText('Проектов пока нет')).toBeVisible();
});

test('сохранённый проект появляется в библиотеке с превью и габаритом (§6, §7)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);

  const card = cards(page).filter({ hasText: 'Новый проект' }).first();
  await expect(card).toBeVisible();
  // Превью строится из настоящей геометрии при сохранении, а не рисуется
  // заглушкой.
  await expect(card.getByRole('img', { name: /Превью проекта/ })).toBeVisible();
  await expect(card.getByText(/× .* мм/)).toBeVisible();
  await expect(card.getByText(/Изделий: 1 · открыт/)).toBeVisible();
});

test('проект переживает перезагрузку вкладки: хранилище настоящее (§5)', async ({ page }) => {
  await saveCurrent(page);
  await page.reload();
  await openLibrary(page);
  await expect(cards(page).filter({ hasText: 'Новый проект' })).toHaveCount(1);
});

test('переименование сохраняет проект тем же, а не создаёт второй (§10)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);

  await library(page).getByRole('button', { name: 'Переименовать' }).first().click();
  await library(page).getByLabel('Новое имя проекта').fill('Шкаф в прихожую');
  await library(page).getByRole('button', { name: 'Сохранить имя' }).click();

  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).getByRole('heading', { name: 'Шкаф в прихожую' })).toBeVisible();
});

test('дубликат становится отдельным проектом (§11)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);

  await library(page).getByRole('button', { name: 'Дублировать' }).first().click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).getByRole('heading', { name: 'Новый проект (копия)' })).toBeVisible();
});

test('поиск отбирает по имени, а не прячет всё (§15)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);
  await library(page).getByRole('button', { name: 'Дублировать' }).first().click();
  await expect(cards(page)).toHaveCount(2);

  await library(page).getByRole('searchbox').fill('копия');
  await expect(cards(page)).toHaveCount(1);

  await library(page).getByRole('searchbox').fill('такого нет');
  await expect(library(page).getByText('Ничего не найдено')).toBeVisible();
});

test('удаление спрашивает подтверждение, а не стирает по одному нажатию (§12)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);

  await library(page).getByRole('button', { name: 'Удалить' }).first().click();
  // Проект ещё на месте: нажата первая кнопка, а не последняя.
  await expect(cards(page)).toHaveCount(1);
  await expect(library(page).getByText(/будет удалён без возможности вернуть/)).toBeVisible();

  await library(page).getByRole('button', { name: 'Да, удалить' }).click();
  await expect(library(page).getByText('Проектов пока нет')).toBeVisible();
});

test('новый проект создаётся и открывается, не затирая прежний (§9)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);
  await library(page).getByRole('button', { name: 'Создать проект' }).click();

  // Библиотека закрывается: пользователь оказывается в новом проекте.
  await expect(library(page)).toBeHidden();
  await openLibrary(page);
  await expect(cards(page)).toHaveCount(2);
});

test('экспорт отдаёт файл проекта, и он же импортируется обратно (§19–§20)', async ({ page }) => {
  await saveCurrent(page);
  await openLibrary(page);

  const download = page.waitForEvent('download');
  await library(page).getByRole('button', { name: 'Экспорт' }).first().click();
  const file = await download;
  const path = await file.path();
  // Имя файла проверяется модульно (`exportFileName`): в этой сборке
  // Chromium отбрасывает кириллицу из атрибута `download` и называет
  // любой такой файл «download». Здесь важно другое — что скачался
  // именно проект и что он читается обратно.
  expect(path).not.toBe(null);
  await library(page).getByLabel('Файл проекта').setInputFiles(path);

  // Идентификатор тот же, поэтому импорт обновляет проект, а не плодит
  // копии: файл — это тот же самый проект, а не новый.
  await expect(library(page)).toBeHidden();
  await openLibrary(page);
  await expect(cards(page)).toHaveCount(1);
});

test('испорченный файл объясняется словами, а не молча ничего не делает (§22)', async ({ page }) => {
  await openLibrary(page);
  await library(page).getByLabel('Файл проекта').setInputFiles({
    name: 'сломанный.json',
    mimeType: 'application/json',
    buffer: Buffer.from('это не проект'),
  });
  await expect(library(page).getByRole('alert')).toContainText('JSON');
});

test('проект из библиотеки размещается в помещении дважды (§13–§14)', async ({ page }) => {
  await saveCurrent(page);

  await page.getByRole('button', { name: 'Помещение', exact: true }).click();
  const canvas = page.getByRole('img', { name: /Помещение/ });
  await expect(canvas).toBeVisible();

  await page.getByLabel('Проект для размещения').selectOption({ label: 'Новый проект' });
  const place = page.getByRole('button', { name: 'Разместить в помещении' });
  await place.click();
  await expect(canvas).toHaveAttribute('aria-label', /Мебели: 1/);
  await place.click();
  await expect(canvas).toHaveAttribute('aria-label', /Мебели: 2/);
});
