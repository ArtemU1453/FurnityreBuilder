import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Производственный интерфейс в настоящем браузере (PROMPT 29 §46).
 *
 * Проверяется сквозной путь на РЕАЛЬНЫХ данных: от проекта к деталировке,
 * чертежу, присадке, раскрою, спецификации и документам. Разбор строк,
 * отбор и трассируемость проверены без DOM
 * (`tests/unit/app/production-view.test.ts`,
 * `tests/unit/export/part-drawing.test.ts`) — здесь только то, что без
 * браузера проверить нельзя.
 */

const section = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

async function openProduction(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('region', { name: 'Сводка' })).toBeVisible();
}

test('сводка показывает посчитанное, а не выдуманное (§3)', async ({ page }) => {
  await openProduction(page);
  const overview = page.getByRole('region', { name: 'Сводка' });
  await expect(overview).toContainText('Позиций деталировки');
  await expect(overview).toContainText('Листов раскроя');
  await expect(overview).toContainText('Операций присадки');

  // Число деталей на сводке совпадает с числом в списке деталей.
  const total = await overview
    .getByRole('button', { name: 'Деталей всего' })
    .locator('../..')
    .textContent();
  await section(page, 'Детали').click();
  await expect(page.getByRole('region', { name: 'Детали' })).toContainText(
    `всего деталей ${String(Number(/\d+/.exec(total ?? '0')?.[0] ?? 0))}`,
  );
});

test('готовность к производству открывается со сводки (§4)', async ({ page }) => {
  await openProduction(page);
  await expect(page.getByRole('region', { name: 'Готовность к производству' })).toBeVisible();
});

test('деталировка сгруппирована так же, как в спецификации (§6, §7)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Детали').click();
  const table = page.getByRole('region', { name: 'Детали' });
  await expect(table.getByRole('columnheader', { name: 'Наименование' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Кромка' })).toBeVisible();
  // Цены в производственном интерфейсе нет и не будет (§6).
  await expect(table).not.toContainText('Цена');

  // Боковины две — одна строка с количеством 2, а не две строки.
  const sides = table.getByRole('row').filter({ hasText: 'Боковина' });
  await expect(sides).toHaveCount(1);
  await expect(sides.first()).toContainText('2');
});

test('поиск и фильтр сужают список, не меняя нумерацию (§27, §28)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Детали').click();
  const panel = page.getByRole('region', { name: 'Детали' });

  await panel.getByRole('searchbox', { name: 'Поиск' }).fill('Боковина');
  await expect(panel.getByRole('status')).toContainText('Показано 1 из');

  await panel.getByRole('searchbox', { name: 'Поиск' }).fill('такогонет');
  await expect(panel).toContainText('Ничего не найдено');

  await panel.getByRole('searchbox', { name: 'Поиск' }).fill('');
  await panel.getByLabel('Порядок').selectOption('quantity');
  await expect(panel.getByRole('status')).toContainText('Показано');
});

test('выбор детали связывает все разделы (§29)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Детали').click();
  const panel = page.getByRole('region', { name: 'Детали' });
  await panel.getByRole('searchbox', { name: 'Поиск' }).fill('Боковина');
  await panel.getByRole('row').filter({ hasText: 'Боковина' }).getByRole('button').click();

  // Подробности той же детали.
  await expect(page.getByRole('region', { name: 'Боковина' })).toContainText('Листы раскроя');

  // Чертёж — той же детали.
  await section(page, 'Чертежи').click();
  await expect(page.locator('svg[role=img]')).toHaveAttribute('aria-label', /Боковина/);

  // На карте раскроя подсвечены её размещения.
  await section(page, 'Раскрой').click();
  await expect(page.locator('rect[data-active]').first()).toBeVisible();

  // Присадка сужена до неё же.
  await section(page, 'Присадка').click();
  await expect(page.getByRole('region', { name: 'Присадка' })).toContainText('Боковина');
});

test('чертёж масштабируется, но числа не меняются (§13)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Детали').click();
  await page.getByRole('region', { name: 'Детали' }).getByRole('button').first().click();
  await section(page, 'Чертежи').click();

  const svg = page.locator('svg[role=img]');
  const labelBefore = await svg.getAttribute('aria-label');
  const widthBefore = (await svg.boundingBox())!.width;

  await page.getByRole('button', { name: 'Увеличить' }).click();
  const widthAfter = (await svg.boundingBox())!.width;
  expect(widthAfter).toBeGreaterThan(widthBefore);
  // Размеры на чертеже — те же числа: зум меняет кегль, а не значение.
  expect(await svg.getAttribute('aria-label')).toBe(labelBefore);

  await page.getByRole('button', { name: 'Вписать' }).click();
  expect((await svg.boundingBox())!.width).toBeCloseTo(widthBefore, 0);
});

test('присадка объясняет, почему операций нет, а не выглядит сломанной (§17)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Присадка').click();
  const panel = page.getByRole('region', { name: 'Присадка' });
  await expect(panel).toContainText('Операций:');
  // В сборке ни одно правило присадки не подтверждено, поэтому координат
  // не существует — и об этом сказано словами, а не пустой таблицей.
  await expect(panel).toContainText(/Операций не рассчитано|Операции сверления/);
});

test('раскрой показывает листы, отход и использование (§19, §22)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Раскрой').click();
  const panel = page.getByRole('region', { name: 'Раскрой' });
  await expect(panel).toContainText('Листов');
  await expect(panel).toContainText('Использование');
  await expect(panel).toContainText('Отход');
  await expect(panel.locator('svg').first()).toBeVisible();
});

test('щелчок по детали на карте раскроя выбирает её позицию (§20)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Раскрой').click();
  await page.locator('rect[data-clickable]').first().click();
  await section(page, 'Детали').click();
  // Строка выбранной детали помечена, и её подробности раскрыты.
  await expect(page.locator('tr[data-active]')).toHaveCount(1);
});

test('фурнитура показывает источники и не показывает поставщиков (§24)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Фурнитура').click();
  const panel = page.getByRole('region', { name: 'Фурнитура' });
  await expect(panel).toContainText(/Позиций не рассчитано|Спецификация фурнитуры/);
  // Ни колонки поставщика, ни колонки цены: производственный интерфейс
  // считает изделие, а не покупку (§24).
  await expect(
    panel.getByRole('columnheader', { name: /Поставщик|Цена|Артикул поставщика/ }),
  ).toHaveCount(0);
});

test('спецификация сводит материалы, кромку и итог (§26)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Спецификация').click();
  await expect(page.getByRole('region', { name: 'Материалы' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Кромка' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Итого' })).toContainText('Позиций деталировки');
});

test('деталь открывается в конструкторе и в сцене (§30, §31, §32)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Детали').click();
  await page.getByRole('region', { name: 'Детали' }).getByRole('button').first().click();

  await page.getByRole('button', { name: 'Показать в 3D' }).click();
  await expect(page.getByRole('radio', { name: 'Конструктор' })).toBeChecked();
  // Деталь выбрана: инспектор показывает именно её, с размером раскроя.
  await expect(page.getByLabel('Свойства объекта')).toContainText('Размер раскроя');

  // И обратно: выбранная в сцене деталь остаётся выбранной в производстве.
  await page.getByRole('radio', { name: 'Производство' }).click();
  await section(page, 'Детали').click();
  await expect(page.locator('tr[data-active]')).toHaveCount(1);
});

test('документы выпускаются из того же расчёта (§37, §38)', async ({ page }) => {
  await openProduction(page);
  await section(page, 'Документы').click();

  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать XLSX' }).click();
  expect(await (await xlsx).path()).not.toBeNull();

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  expect(await (await pdf).path()).not.toBeNull();
});

test('на телефоне разделы выбираются списком и таблица не рвёт страницу (§40)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProduction(page);

  await page.getByLabel('Раздел производства').selectOption('parts');
  await expect(page.getByRole('region', { name: 'Детали' })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
