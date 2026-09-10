import { expect, test } from '@playwright/test';
import { openScene, scene } from './open-scene.js';
import { applyGrid } from './apply-grid.js';
import type { Page } from '@playwright/test';

/**
 * Пробелы интерфейса, закрытые на PROMPT 33 (§14, §22).
 *
 * Оба дефекта одного рода: модель, команды и расчёт существовали, а точки
 * входа из интерфейса не было — возможность оставалась недостижимой для
 * человека. Поэтому и проверка здесь браузерная: убедиться, что до неё
 * можно ДОЙТИ, а не что функция существует в коде.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await openScene(page);
});

test('конвенции габарита доступны и меняют изделие (§14, Д-002)', async ({ page }) => {
  // Цоколь 100 мм: без него вычитать нечего и флаг ничего не покажет.
  await step(page, 'Корпус').click();
  await page.getByRole('spinbutton', { name: 'Высота цоколя', exact: true }).fill('100');

  await step(page, 'Конструкция').click();
  const toggle = page.getByRole('switch', { name: 'Цоколь входит в высоту' });
  await expect(toggle).toBeVisible();

  // Пояснение говорит, что именно произойдёт, а не просто «вкл/выкл».
  await expect(page.getByText(/Высота задаёт изделие целиком/)).toBeVisible();

  const before = await scene(page).getAttribute('aria-label');
  await toggle.click();
  await expect(page.getByText(/Высота задаёт только корпус/)).toBeVisible();

  // Геометрия изменилась: корпус стал выше на высоту цоколя.
  await expect(scene(page)).not.toHaveAttribute('aria-label', before ?? '');
});

test('все три конвенции габарита названы своими словами (§14)', async ({ page }) => {
  await step(page, 'Конструкция').click();
  for (const name of [
    'Цоколь входит в высоту',
    'Задняя стенка входит в глубину',
    'Накладной фасад входит в глубину',
  ]) {
    await expect(page.getByRole('switch', { name })).toBeVisible();
  }
});

test('конвенция габарита отменяется через Ctrl+Z (§14)', async ({ page }) => {
  await step(page, 'Конструкция').click();
  // Переключатель — настоящий чекбокс с role="switch": состояние читается
  // свойством `checked`, а не атрибутом aria-checked.
  const toggle = page.getByRole('switch', { name: 'Цоколь входит в высоту' });
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(toggle).not.toBeChecked();

  await page.keyboard.press('Control+z');
  await expect(toggle).toBeChecked();
});

test('Ctrl+Shift+Z возвращает отменённое (§29, Д-003)', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1700');
  await expect(scene(page)).toHaveAttribute('aria-label', /1700/);

  await page.keyboard.press('Control+z');
  await expect(scene(page)).not.toHaveAttribute('aria-label', /1700/);

  await page.keyboard.press('Control+Shift+z');
  await expect(scene(page)).toHaveAttribute('aria-label', /1700/);
});

test('Ctrl+Z не перехватывается у текстового поля: там отменяют набор (§29)', async ({ page }) => {
  await step(page, 'Секции').click();
  const widths = page.getByLabel('Ширины секций, мм');
  await widths.fill('500, 700');
  await widths.focus();

  // Поле не пустеет и проект не откатывается: сочетание осталось браузеру.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
});

test('проём добавляется из интерфейса, а не только командой (§22, Д-001)', async ({ page }) => {
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();

  await expect(page.getByRole('heading', { name: 'Проёмы и препятствия' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Стена', exact: true }).selectOption({ index: 1 });
  await page.getByRole('combobox', { name: 'Вид проёма', exact: true }).selectOption('door');
  await page.getByRole('button', { name: 'Добавить проём' }).click();

  // Проём попал в помещение и виден списком.
  await expect(page.getByLabel('Проёмы помещения').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByLabel('Проёмы помещения')).toContainText('Дверь');
});

test('окно отличается от двери размерами, а не только названием (§22)', async ({ page }) => {
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();
  await page.getByRole('combobox', { name: 'Стена', exact: true }).selectOption({ index: 1 });

  await page.getByRole('combobox', { name: 'Вид проёма', exact: true }).selectOption('door');
  const doorSill = await page
    .getByRole('spinbutton', { name: 'Высота низа проёма', exact: true })
    .inputValue();

  await page.getByRole('combobox', { name: 'Вид проёма', exact: true }).selectOption('window');
  const windowSill = await page
    .getByRole('spinbutton', { name: 'Высота низа проёма', exact: true })
    .inputValue();

  expect(Number(doorSill)).toBe(0);
  expect(Number(windowSill)).toBeGreaterThan(0);
});

test('проём шире стены не добавляется и объясняет почему (§22)', async ({ page }) => {
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();
  await page.getByRole('combobox', { name: 'Стена', exact: true }).selectOption({ index: 1 });

  await page.getByRole('spinbutton', { name: 'Ширина проёма', exact: true }).fill('99000');
  await expect(page.getByText('Проём не помещается в стену')).toBeVisible();
  // Кнопка заблокирована: команда отказала бы молча, и нажатие выглядело
  // бы поломкой.
  await expect(page.getByRole('button', { name: 'Добавить проём' })).toBeDisabled();
});

test('препятствие добавляется и убирается (§22, Д-001)', async ({ page }) => {
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();

  await page.getByRole('combobox', { name: /Вид препятствия/ }).selectOption('column');
  await page.getByRole('button', { name: 'Добавить препятствие' }).click();
  await expect(page.getByLabel('Препятствия помещения')).toContainText('Колонна');

  await page.getByLabel('Препятствия помещения').getByRole('button', { name: 'Убрать' }).click();
  await expect(page.getByLabel('Препятствия помещения')).toHaveCount(0);
});

test('проём переживает перезагрузку: он часть документа (§22)', async ({ page }) => {
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();
  await page.getByRole('combobox', { name: 'Стена', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить проём' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  await page.reload();

  await openScene(page);
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await expect(page.getByLabel('Проёмы помещения').getByRole('listitem')).toHaveCount(1);
});

/**
 * Выбрать ячейку и задать ей наполнение «ящики».
 *
 * Ячейка выбирается через список на шаге «Двери» — тем же путём, что в
 * сквозном сценарии: щелчок по сцене в фиксированную точку зависит от
 * ракурса камеры и потому ненадёжен.
 */
async function fillCellWithDrawers(page: Page): Promise<void> {
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await applyGrid(page);

  // Список ячеек живёт в панели «Двери» на шаге «Фасады» — на шаге
  // «Наполнение» своего выбора нет, ячейка берётся из общего выделения.
  await step(page, 'Фасады').click();
  await page.getByLabel('Двери').getByLabel('Ячейка').selectOption({ index: 1 });

  await step(page, 'Наполнение').click();
  // Подписи вариантов берутся из доменного словаря и потому строчные.
  await page.getByRole('radio', { name: 'ящики', exact: true }).click();
}

test('подпись у ящиков не обещает короба, которого не будет (§10, Г-001)', async ({ page }) => {
  await fillCellWithDrawers(page);

  const fill = page.getByRole('region', { name: 'Наполнение' });
  await expect(fill).toContainText('Ящик добавляет фасад');
  await expect(fill).toContainText('Короб');
  await expect(fill).toContainText('не строится');
  // Прежний текст обещал короб как факт — его быть не должно.
  await expect(page.getByText('Ящик добавляет короб и фасад.')).toHaveCount(0);
});

test('ящик доходит до деталировки фасадом, а короба в ней нет (§7, Г-001)', async ({ page }) => {
  await fillCellWithDrawers(page);

  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Детали', exact: true }).click();

  const parts = page.getByRole('table').first();
  await expect(parts).toBeVisible();
  // Короба нет ни одной строкой: подпись это и обещает.
  await expect(parts).not.toContainText('Боковина ящика');
  await expect(parts).not.toContainText('Дно ящика');
});
