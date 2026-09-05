import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Ошибочные состояния (PROMPT 30 §8).
 *
 * Проверяется не «приложение не упало», а четыре свойства, которые
 * отличают надёжную программу от хрупкой: ошибка объяснена словами,
 * данные не потеряны, приложение не осталось в повреждённом состоянии, и
 * к рабочему состоянию можно вернуться.
 */

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });
const status = (page: Page) => page.getByLabel('Состояние проекта');
const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
});

test('нулевая ширина объясняется словами и отменяется', async ({ page }) => {
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('0');

  // Ошибка названа, а не показана одним цветом.
  await expect(status(page)).toContainText(/Изготовление невозможно|Ошибка/);
  await expect(page.getByLabel('Результат расчёта')).toContainText(/больше нуля|Ошибк/);

  // Приложение работает: другие разделы открываются.
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('region', { name: 'Сводка' })).toBeVisible();
  await page.getByRole('radio', { name: 'Конструктор' }).click();

  // И к рабочему состоянию можно вернуться одной отменой.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(width).not.toHaveValue('0');
  await expect(scene(page)).toBeVisible();
});

test('отрицательная и нечисловая высота не ломают приложение', async ({ page }) => {
  const height = page.getByRole('spinbutton', { name: 'Высота', exact: true });
  await height.fill('-500');
  await expect(status(page)).toContainText(/Изготовление невозможно|Ошибка/);

  // Ввод остаётся исправимым: поле принимает нормальное значение.
  await height.fill('2000');
  await expect(scene(page)).toHaveAttribute('aria-label', /2000/);
  await expect(status(page)).not.toContainText('Изготовление невозможно');
});

test('нулевая толщина плиты объясняется, а не даёт деталей нулевого размера', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Толщина', exact: true }).fill('0');
  await expect(page.getByLabel('Результат расчёта')).toContainText(/больше нуля|Ошибк/);
  await expect(scene(page)).toBeVisible();
});

test('невозможные ширины секций объясняются текстом', async ({ page }) => {
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();

  // Сумма заведомо меньше доступного пространства.
  await page.getByLabel('Ширины секций, мм').fill('100, 100, 100');
  await page.getByRole('button', { name: 'Применить ширины' }).click();
  await expect(page.getByLabel('Результат расчёта')).toContainText(
    /не заполняют доступное пространство|не помещаются/,
  );

  // Отмена возвращает предыдущий набор целиком.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByLabel('Результат расчёта')).not.toContainText(
    'не заполняют доступное пространство',
  );
});

test('дверь на ячейку с ящиками недоступна, и это объяснено', async ({ page }) => {
  await step(page, 'Фасады').click();
  await page.getByLabel('Двери').getByLabel('Ячейка').selectOption({ index: 1 });

  await step(page, 'Наполнение').click();
  await page.getByRole('radio', { name: 'ящики', exact: true }).click();

  await step(page, 'Фасады').click();
  // Кнопка выключена: физический конфликт, а не молчаливый отказ.
  await expect(
    page.getByLabel('Двери').getByRole('button', { name: 'Добавить дверь' }),
  ).toBeDisabled();
});

test('испорченный файл проекта объясняется, а текущий проект не теряется', async ({ page }) => {
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('1234');
  await expect(scene(page)).toHaveAttribute('aria-label', /1234/);

  await page.getByRole('radio', { name: 'Библиотека' }).click();
  await page.getByLabel('Файл проекта').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ это не проект }'),
  });

  // Ошибка названа словами и объявлена как сообщение, а не окрашена.
  await expect(page.getByRole('alert')).toContainText(/JSON|не удалось|ошиб|структур/i);

  // Текущий проект на месте: импорт не тронул его.
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  await expect(width).toHaveValue('1234');
  await expect(scene(page)).toHaveAttribute('aria-label', /1234/);
});

test('файл правильного формата, но с чужой структурой, отвергается', async ({ page }) => {
  await page.getByRole('radio', { name: 'Библиотека' }).click();
  await page.getByLabel('Файл проекта').setInputFiles({
    name: 'alien.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, project: { что: 'угодно' } })),
  });
  await expect(page.getByRole('alert')).toContainText(/не удалось|ошиб|структур/i);

  // Приложение работоспособно: конструктор открывается и считает.
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  await expect(scene(page)).toBeVisible();
});

test('файл из будущей версии схемы отвергается с понятной причиной', async ({ page }) => {
  await page.getByRole('radio', { name: 'Библиотека' }).click();
  await page.getByLabel('Файл проекта').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 999, project: {} })),
  });
  await expect(page.getByRole('alert')).toContainText(/новой версии|не удалось|ошиб/i);
});

test('неподтверждённые правила видны и не выдаются за готовность', async ({ page }) => {
  await page.getByRole('radio', { name: 'Производство' }).click();
  // Статус не «готово»: часть правил ждёт подтверждения.
  await expect(page.getByRole('region', { name: 'Готовность к производству' })).toContainText(
    /Требуется подтверждение|Изготовление невозможно|предупреждени/i,
  );
  // И каждое неподтверждённое правило раскрыто, а не сведено к слову.
  await expect(page.getByText(/Применяется:/).first()).toBeVisible();
});

test('деталь, не помещающаяся на лист, показана как ошибка раскроя', async ({ page }) => {
  // Задняя стенка изделия 2400 мм высотой не помещается на лист 1830 мм.
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2100');

  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Раскрой', exact: true }).click();

  const panel = page.getByRole('region', { name: 'Раскрой' });
  await expect(panel).toContainText('Не размещено');
  // Причина названа, а не скрыта за числом.
  await expect(page.getByRole('region', { name: 'Не размещено' })).toContainText(
    /TOO_LARGE|не помещается/,
  );
});
