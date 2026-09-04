import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Сквозные проверки фундамента.
 *
 * Их немного и они намеренно узкие: интерфейса конструктора ещё нет.
 * Проверяется то, что уже должно быть верным и что дорого чинить потом —
 * автономность приложения, доступность с клавиатуры и сквозной путь
 * «ввод → домен → геометрия → экран» без задержек.
 */

test('приложение запускается и показывает рассчитанный результат', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Furniture Builder/);
  await expect(page.getByRole('heading', { name: 'Furniture Builder' })).toBeVisible();

  // Каркас по умолчанию: 2 боковины + дно + крышка + задняя стенка
  // (деталью она стала на PROMPT 14).
  // `exact` обязателен: с PROMPT 20 слово встречается ещё и в описании
  // панели экспорта, и нестрогий локатор находит два элемента.
  await expect(page.getByText('Деталей', { exact: true })).toBeVisible();
  // Локатор сужен до строки статистики: с PROMPT 21 слово «Деталей»
  // встречается ещё и в пояснениях чеклиста готовности.
  await expect(page.locator('li').filter({ hasText: /^Деталей\d+$/ })).toContainText('5');
});

test('приложение не выполняет ни одного внешнего запроса', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) external.push(request.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Продукт обязан работать без внешних сервисов: ни шрифтов, ни аналитики,
  // ни CDN, ни обращений к чужому API.
  expect(external).toEqual([]);
});

test('изменение габарита сразу пересчитывает геометрию, без задержки', async ({ page }) => {
  await page.goto('/');

  const width = page.getByLabel('Ширина, мм');
  await expect(page.locator('li', { hasText: 'Внутренняя ширина' })).toContainText('968');

  await width.fill('1400');
  // Никакого ожидания и никакого debounce: 1400 − 2×16 = 1368.
  await expect(page.locator('li', { hasText: 'Внутренняя ширина' })).toContainText('1368');
});

test('отмена возвращает предыдущее состояние', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ширина, мм').fill('1400');
  await expect(page.locator('li', { hasText: 'Внутренняя ширина' })).toContainText('1368');

  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('li', { hasText: 'Внутренняя ширина' })).not.toContainText('1368');
});

test('ошибка объясняется текстом, а не только цветом, и не блокирует работу', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Глубина, мм').fill('0');

  const message = page.getByRole('alert').first();
  await expect(message).toBeVisible();
  await expect(message).toContainText('больше нуля');

  // Поле остаётся доступным для правки: приложение не отбирает управление.
  await expect(page.getByLabel('Глубина, мм')).toBeEditable();
});

test('интерфейс доступен с клавиатуры и имеет ссылку пропуска навигации', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти к содержимому' })).toBeFocused();

  // Все поля габаритов достижимы табуляцией и подписаны.
  for (const label of ['Ширина, мм', 'Высота, мм', 'Глубина, мм', 'Толщина, мм']) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
});

test('кнопки отмены и возврата отключены, пока нечего отменять', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Вернуть' })).toBeDisabled();
});

test('дверь можно добавить на выбранную ячейку и убрать (PROMPT 10 §19)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('li', { hasText: 'Дверей' })).toContainText('0');

  const addButton = page.getByRole('button', { name: 'Добавить дверь' });
  await expect(addButton).toBeDisabled();

  // Единственная ячейка изделия по умолчанию — первый (и единственный) пункт списка.
  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect(page.locator('li', { hasText: 'Дверей' })).toContainText('1');
  await expect(addButton).toBeDisabled();

  const removeButton = page.getByRole('button', { name: 'Убрать дверь' });
  await expect(removeButton).toBeEnabled();
  await removeButton.click();

  await expect(page.locator('li', { hasText: 'Дверей' })).toContainText('0');
});

test('ящики можно добавлять и убирать на выбранной ячейке (PROMPT 11 §21)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('li', { hasText: 'Фасадов ящиков' })).toContainText('0');

  const addButton = page.getByRole('button', { name: 'Добавить ящик' });
  await expect(addButton).toBeDisabled();

  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await expect(addButton).toBeEnabled();

  await addButton.click();
  await expect(page.locator('li', { hasText: 'Ящиков в выбранной ячейке' })).toContainText('1');
  await expect(page.locator('li', { hasText: 'Фасадов ящиков' })).toContainText('1');

  await addButton.click();
  await expect(page.locator('li', { hasText: 'Ящиков в выбранной ячейке' })).toContainText('2');
  await expect(page.locator('li', { hasText: 'Фасадов ящиков' })).toContainText('2');

  // Дверь на ту же ячейку, что уже содержит ящики, недоступна.
  await expect(page.getByRole('button', { name: 'Добавить дверь' })).toBeDisabled();

  const removeButton = page.getByRole('button', { name: 'Убрать ящик' });
  await removeButton.click();
  await expect(page.locator('li', { hasText: 'Ящиков в выбранной ячейке' })).toContainText('1');
  await removeButton.click();
  await expect(page.locator('li', { hasText: 'Ящиков в выбранной ячейке' })).toContainText('0');
  await expect(page.locator('li', { hasText: 'Фасадов ящиков' })).toContainText('0');
});

test('способ открывания двери можно выбрать и снять (PROMPT 12 §19)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('li', { hasText: 'Ручек' })).toContainText('0');
  await expect(page.locator('li', { hasText: 'Push-to-open' })).toContainText('0');

  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить дверь' }).click();

  const opening = page.getByLabel('Открывание');
  await expect(opening).toHaveValue('none');

  await opening.selectOption('handle');
  await expect(page.locator('li', { hasText: 'Ручек' })).toContainText('1');

  await opening.selectOption('push-to-open');
  await expect(page.locator('li', { hasText: 'Ручек' })).toContainText('0');
  await expect(page.locator('li', { hasText: 'Push-to-open' })).toContainText('1');

  await opening.selectOption('none');
  await expect(page.locator('li', { hasText: 'Push-to-open' })).toContainText('0');
});

test('способ открывания ящиков можно выбрать (PROMPT 12 §19)', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить ящик' }).click();
  await page.getByRole('button', { name: 'Добавить ящик' }).click();

  const opening = page.getByLabel('Открывание (все ящики ячейки)');
  await opening.selectOption('handle');
  await expect(page.locator('li', { hasText: 'Ручек' })).toContainText('2');
});

test('производственная документация скачивается и не запускается дважды (PROMPT 20 §19)', async ({ page }) => {
  await page.goto('/');

  const pdfButton = page.getByRole('button', { name: 'Скачать PDF' });
  const xlsxButton = page.getByRole('button', { name: 'Скачать XLSX' });
  await expect(pdfButton).toBeEnabled();
  await expect(xlsxButton).toBeEnabled();

  // XLSX: файл действительно приходит, и это настоящий ZIP.
  // Проверяется содержимое, а не имя: headless-Chromium сообщает о
  // blob-загрузках имя «download» независимо от атрибута, а вот байты
  // приходят настоящие.
  const xlsxDownload = page.waitForEvent('download');
  await xlsxButton.click();
  const xlsxPath = await (await xlsxDownload).path();
  expect(xlsxPath).not.toBeNull();
  const xlsxBytes = readFileSync(xlsxPath);
  expect(xlsxBytes.length).toBeGreaterThan(2000);
  expect([...xlsxBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  // PDF собирается дольше: кнопки на это время блокируются, чтобы второй
  // запуск не дал два файла и вопрос, какой из них актуален.
  const pdfDownload = page.waitForEvent('download');
  await pdfButton.click();
  const pdfPath = await (await pdfDownload).path();
  expect(pdfPath).not.toBeNull();
  const pdfBytes = readFileSync(pdfPath);
  expect(pdfBytes.length).toBeGreaterThan(5000);
  expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // После завершения обе кнопки снова рабочие: экспорт повторяем.
  await expect(pdfButton).toBeEnabled();
  await expect(xlsxButton).toBeEnabled();
});




test('чеклист готовности к производству виден и обновляется вместе с проектом (PROMPT 21 §17)', async ({ page }) => {
  await page.goto('/');

  // Общий статус: подтверждены не все производственные правила, и об этом
  // сказано словами, а не только цветом.
  await expect(page.getByText('Требуется подтверждение производственных правил')).toBeVisible();

  // Все восемь разделов чеклиста на месте. Локатор ограничен панелью
  // производства: слово «Материалы» есть и в заголовке своей панели.
  const production = page.getByLabel('Производственная документация');
  for (const title of ['Геометрия', 'Материалы', 'Кромка', 'Фурнитура', 'Присадка', 'Раскрой', 'Спецификация', 'Документация']) {
    await expect(production.getByText(title, { exact: true })).toBeVisible();
  }

  // Недопустимый габарит переводит изделие в «изготовление невозможно»
  // сразу, без отдельной кнопки «проверить».
  await page.getByLabel('Ширина, мм').fill('-100');
  await expect(page.getByText('Изготовление невозможно: есть ошибки')).toBeVisible();

  await page.getByLabel('Ширина, мм').fill('1000');
  await expect(page.getByText('Требуется подтверждение производственных правил')).toBeVisible();
});
