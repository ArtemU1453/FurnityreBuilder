import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Пошаговый сценарий конструктора в настоящем браузере (PROMPT 27 §42).
 *
 * Здесь проверяется только то, чего нельзя проверить без браузера:
 * что лестница действительно переключает панели, что шаг «Проверка»
 * действительно уводит на другой раздел, что из строки ошибки
 * действительно попадаешь к её причине и что на телефоне ничего не
 * вылезает за экран. Сам порядок шагов, разбор проблем по шагам и
 * сквозной путь по домену проверены без DOM
 * (`tests/unit/app/workflow-steps.test.ts`,
 * `tests/unit/state/workflow-scenario.test.ts`).
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });

const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

test('лестница показывает положение в сценарии, а не выдуманный процент (§29)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(rail(page)).toContainText('Шаг 1 из 11');
  // Процента нет нигде: его невозможно посчитать честно.
  await expect(rail(page)).not.toContainText('%');
});

test('каждый шаг открывает свою панель и только её (§27)', async ({ page }) => {
  await page.goto('/');

  const panels: readonly (readonly [string, string])[] = [
    ['Размеры', 'Размеры'],
    ['Корпус', 'Корпус'],
    ['Секции', 'Секции'],
    ['Ячейки', 'Ячейки'],
    ['Полки', 'Полки'],
    ['Наполнение', 'Наполнение'],
    ['Фасады', 'Двери'],
    ['Материалы', 'Материалы'],
    ['Конструкция', 'Конструкция'],
  ];

  for (const [title, panel] of panels) {
    await step(page, title).click();
    await expect(page.getByRole('region', { name: panel })).toBeVisible();
    // Панель предыдущего шага убрана, а не просто отодвинута вниз.
    await expect(page.getByRole('region', { name: 'Размеры' })).toBeVisible({
      visible: title === 'Размеры',
    });
  }
});

test('текущий шаг помечен для скринридера, а не только цветом (§27)', async ({ page }) => {
  await page.goto('/');
  await expect(step(page, 'Размеры')).toHaveAttribute('aria-current', 'step');
  await step(page, 'Материалы').click();
  await expect(step(page, 'Материалы')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'Размеры')).not.toHaveAttribute('aria-current', 'step');
});

test('шаг «Проверка» уводит на раздел производства и обратно возвращает туда же (§3)', async ({
  page,
}) => {
  await page.goto('/');
  await step(page, 'Материалы').click();

  await step(page, 'Проверка').click();
  await expect(page.getByRole('radio', { name: 'Производство' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Готовность к производству' })).toBeVisible();

  // Возврат в конструктор открывает ПОСЛЕДНИЙ его шаг, а не первый:
  // иначе место, где человек работал, теряется на каждом переходе.
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  await expect(page.getByRole('region', { name: 'Материалы' })).toBeVisible();
});

test('ни один шаг не заблокирован: с первого можно уйти на последний (§28)', async ({ page }) => {
  await page.goto('/');
  await step(page, 'Производство').click();
  await expect(page.getByRole('button', { name: 'Скачать PDF' })).toBeVisible();
});

test('кнопки «Назад» и «Далее» ведут по порядку и упираются в края', async ({ page }) => {
  await page.goto('/');
  const back = rail(page).getByRole('button', { name: 'Назад' });
  const forward = rail(page).getByRole('button', { name: 'Далее' });

  await expect(back).toBeDisabled();
  await forward.click();
  await expect(rail(page)).toContainText('Шаг 2 из 11');
  await expect(page.getByRole('region', { name: 'Корпус' })).toBeVisible();
  await back.click();
  await expect(rail(page)).toContainText('Шаг 1 из 11');
});

test('шаги доступны с клавиатуры и не перехватывают ввод чисел (§36)', async ({ page }) => {
  await page.goto('/');

  // Кнопка шага достижима табуляцией и открывается с клавиатуры.
  await step(page, 'Секции').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Секции' })).toBeVisible();

  // Стрелки и буквы в числовом поле остаются вводом, а не навигацией:
  // глобального перехвата клавиш сценарий не заводит.
  await step(page, 'Размеры').click();
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('1500');
  await width.press('ArrowUp');
  await expect(page.getByRole('region', { name: 'Размеры' })).toBeVisible();
  expect(Number(await width.inputValue())).toBeGreaterThan(1500);
});

test('ошибка ведёт к своему шагу, а не просто светится в статусе (§24)', async ({ page }) => {
  await page.goto('/');
  await step(page, 'Материалы').click();

  // Нулевая ширина — ошибка шага «Размеры».
  await step(page, 'Размеры').click();
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('0');
  await step(page, 'Материалы').click();

  // Лестница показывает, на каком шаге проблема.
  await expect(step(page, 'Размеры')).toContainText('ошиб');

  // Строка состояния ведёт к причине: шаг открывается сам.
  await page.getByLabel('Состояние проекта').getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Размеры' })).toBeVisible();
});

test('на телефоне шаги остаются доступны и ничего не вылезает за экран (§35)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // С PROMPT 28 на телефоне видна не вся лестница, а текущий шаг с
  // переходами: одиннадцать целей для пальца на 390 px не помещаются, а
  // на 320 px лента ещё и выносила страницу вбок на 12 px. Весь список
  // никуда не делся — он открывается листом, и это та же `WorkflowNav`
  // (`tests/e2e/mobile.spec.ts`).
  const bar = page.getByRole('navigation', { name: 'Этапы конструктора' });
  await expect(bar).toContainText('Шаг 1 из 11');
  await bar.getByRole('button', { name: 'Следующий этап' }).click();
  await expect(bar).toContainText('Шаг 2 из 11');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
