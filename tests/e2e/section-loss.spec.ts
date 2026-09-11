import { expect, test } from '@playwright/test';
import { applyGrid } from './apply-grid.js';
import type { Page } from '@playwright/test';

/**
 * Секции не исчезают молча (PROMPT 46 §5, §18).
 *
 * ## Что здесь нашёл аудит
 *
 * Лестница шагов ведёт «Секции» → «Ячейки». На шаге «Ячейки» кнопка
 * «Применить сетку» выполняет `SetRoot` — она заменяет ВСЁ дерево
 * изделия. Секции, набранные шагом раньше, исчезали, и приложение не
 * говорило об этом ничем: число деталей после замены могло даже
 * вырасти, и потеря выглядела как обычный пересчёт. Поле «Секций» при
 * этом продолжало показывать прежнее число — то есть врало.
 *
 * ## Почему проверка именно такая
 *
 * Число деталей здесь ничего не доказывает: до исправления оно
 * совпадало (7 и 7). Доказывает ДЕТАЛИРОВКА — перегородка либо есть в
 * списке позиций, либо её там нет. Прежний приёмочный сценарий
 * проверял, что деталей стало больше, и потому потерю не замечал.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

/** Сколько перегородок в деталировке — то есть сколько секций реально построено. */
async function partitions(page: Page): Promise<number> {
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Детали', exact: true }).click();
  const table = page.getByRole('table').first();
  await expect(table).toBeVisible();
  const text = await table.innerText();
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  return (text.match(/Перегородка/gi) ?? []).length;
}

async function makeSections(page: Page, count: string): Promise<void> {
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill(count);
  await page.getByRole('button', { name: /Применить секций/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

/**
 * Нажать «Пересобрать всё изделие сеткой», НЕ отвечая на вопрос.
 *
 * С PROMPT 55 это действие живёт за собственным раскрытием и больше не
 * является кнопкой по умолчанию шага «Ячейки» (FR-02). Предмет проверки
 * здесь — сам диалог, поэтому общий `applyGrid`, который на него
 * отвечает, не годится.
 */
async function applyGridWithoutConfirming(page: Page): Promise<void> {
  const rebuild = page.getByRole('button', { name: /Пересобрать всё изделие сеткой/ });
  if (!(await rebuild.isVisible())) {
    await page.getByText('Начать внутреннее устройство заново').click();
  }
  await rebuild.click();
}

test('сетка не стирает секции без предупреждения', async ({ page }) => {
  await makeSections(page, '3');
  expect(await partitions(page), 'три секции не построились').toBeGreaterThan(0);

  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await applyGridWithoutConfirming(page);

  // Приложение спрашивает — и называет, что именно исчезнет.
  const dialog = page.getByRole('dialog', { name: 'Сетка заменит внутреннее устройство' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('3 секции');

  // Отказ ничего не меняет: секции на месте.
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
  expect(await partitions(page), 'отказ от замены всё равно стёр секции').toBeGreaterThan(0);
});

test('согласие заменяет структуру и поле «Секций» перестаёт врать', async ({ page }) => {
  await makeSections(page, '3');
  await expect(page.getByRole('spinbutton', { name: 'Секций', exact: true })).toHaveValue('3');

  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await applyGrid(page);

  // Замена произошла: перегородок больше нет, полки появились.
  expect(await partitions(page)).toBe(0);

  // И поле показывает то, что есть на самом деле, а не то, что было.
  // Раньше здесь оставалась тройка — одно нажатие «Применить секций: 3»
  // по этому числу перестраивало изделие заново.
  await step(page, 'Секции').click();
  await expect(page.getByRole('spinbutton', { name: 'Секций', exact: true })).toHaveValue('1');
});

test('пустое изделие заменяется сеткой без лишнего вопроса', async ({ page }) => {
  // Терять нечего — спрашивать не о чем. Диалог на каждое нажатие
  // научил бы соглашаться не читая.
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await applyGridWithoutConfirming(page);
  await expect(page.getByRole('dialog', { name: 'Сетка заменит внутреннее устройство' })).toBeHidden();
});
