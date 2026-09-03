import { expect, test } from '@playwright/test';

/**
 * Технический debug-renderer существует только в режиме разработки
 * (docs/GEOMETRY_RULES.md §12) — этот файл запускается отдельным
 * Playwright-проектом против `npm run dev`, а не против собранного
 * production-превью (см. playwright.config.ts).
 *
 * Проверяет ровно то, что unit-тесты `buildDebugView` проверить не могут:
 * реальную отрисовку SVG в браузере и полный интерактивный путь
 * «нажатие → команда → пересчёт → перерисовка схемы».
 */

test('схема появляется в режиме разработки и отражает реальную геометрию', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema).toBeVisible();

  // 4 детали каркаса + 1 нераздёленная ячейка = 5 прямоугольников.
  // CSS-модули хешируют имена классов — различать «деталь»/«ячейку» по
  // классу в E2E ненадёжно, поэтому здесь проверяется общее число
  // прямоугольников, а не их разбивка по виду (та проверена в
  // tests/unit/render/debug-view.test.ts на уровне данных).
  await expect(schema.locator('rect')).toHaveCount(5);
});

test('применение сетки перестраивает схему: перегородки и ячейки появляются вживую', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(5);

  await page.getByLabel('Строк').fill('2');
  await page.getByLabel('Колонок').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  // 2×3: 4 детали каркаса + 4 вертикальные перегородки (2 на ряд × 2 ряда)
  // + 1 горизонтальный разделитель = 9 деталей, плюс 6 ячеек = 15.
  await expect(schema.locator('rect')).toHaveCount(15);
});

test('переключатель debug-инфо показывает и скрывает подписи ID и координат', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByLabel('Показывать ID и координаты');
  await expect(toggle).not.toBeChecked();

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  const debugTextBefore = await schema.locator('text').filter({ hasText: 'side ·' }).count();
  expect(debugTextBefore).toBe(0);

  await toggle.check();
  await expect(schema.locator('text').filter({ hasText: 'side ·' }).first()).toBeVisible();

  await toggle.uncheck();
  await expect(schema.locator('text').filter({ hasText: 'side ·' })).toHaveCount(0);
});

test('полки появляются в схеме как отдельные детали и подписываются в debug-инфо', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(5);

  await page.getByLabel('Полок в ячейке').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  // 4 детали каркаса + 3 полки + 1 ячейка = 8 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(8);
  // Счётчик «Полок» в панели результата — точное совпадение текста, иначе
  // локатор поймал бы и подпись поля «Полок в ячейке».
  await expect(page.getByText('Полок', { exact: true }).locator('..')).toContainText('3');

  // Подпись полки в debug-инфо несёт ширину, глубину, толщину и Y
  // (PROMPT 6 §27) — и берёт их из GeometryResult, а не считает заново.
  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('text').filter({ hasText: 'shelf-adjustable ·' }).first()).toBeVisible();
});

test('изменение габарита в поле обновляет схему сразу, без перезагрузки', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  const widthDimBefore = await schema.getByText('1000 мм').count();
  expect(widthDimBefore).toBeGreaterThan(0);

  await page.getByLabel('Ширина, мм').fill('1400');

  await expect(schema.getByText('1400 мм').first()).toBeVisible();
});
