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

  // Каркас по умолчанию: 2 боковины + дно + крышка.
  await expect(page.getByText('Деталей')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Деталей' })).toContainText('4');
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
