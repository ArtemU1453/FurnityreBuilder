import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * FR-07: у действия над отделением один первичный путь
 * (PROMPT 59 §11–§12, §18).
 *
 * ## Дефект, который здесь сторожится
 *
 * Аудит PROMPT 53: действия над отделением предлагались и кнопками
 * инспектора, и шагами 5–7, а какой путь верный — нигде не сказано.
 * Разбор PROMPT 59 показал худшее: три из пяти действий инспектора
 * собирали СВОЙ вызов, и «Добавить полки» ставила ровно одну полку,
 * затирая заданное на шаге число. Две кнопки с одинаковой подписью
 * делали разное.
 *
 * ## Что проверяется
 *
 * Сквозной первичный путь и то, что вторичный ему не противоречит.
 * Тесты не «доказывают, что есть оба пути» (§11) — они проверяют, что
 * первичный работает целиком, а вторичный делегирует в ту же операцию.
 */

const schema = (page: Page) => page.getByRole('application', { name: /Схема изделия/ });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

/** Число из панели «Результат расчёта» — того же, что видит человек. */
async function metric(page: Page, label: string): Promise<number> {
  const value = await page.evaluate((name) => {
    const panel = [...document.querySelectorAll('section, div')].find(
      (el) => el.querySelector('h2')?.textContent?.trim() === 'Результат расчёта',
    );
    const row = [...(panel ?? document).querySelectorAll('li')].find(
      (li) => li.firstElementChild?.textContent?.trim() === name,
    );
    return row?.lastElementChild?.textContent?.trim() ?? '';
  }, label);
  return Number(value.replace(/\s/g, ''));
}

/** Три секции — минимум, на котором отделения различимы. */
async function threeSections(page: Page): Promise<void> {
  await page.goto('./');
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect.poll(async () => metric(page, 'Ячеек')).toBe(3);
}

test('первичный путь целиком: размеры → отделения → выбрать → полки, ящик, дверь (§11)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // 1. Размеры.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2200');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('600');

  // 2. Отделения.
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect.poll(async () => metric(page, 'Ячеек')).toBe(3);

  // 3. Выбрать отделение — и увидеть, что с ним делать.
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await expect(page.getByText('Что сделать с этим отделением:')).toBeVisible();

  // 4. Полки — первичной кнопкой.
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBeGreaterThan(0);

  // 5. Ящик — в другое отделение, тоже первичной кнопкой.
  await schema(page).getByRole('button', { name: /^Секция 2/ }).click();
  await page.getByRole('button', { name: 'Добавить ящики' }).click();
  await expect.poll(async () => metric(page, 'Фасадов ящиков')).toBe(1);

  // 6. Дверь — в третье.
  await schema(page).getByRole('button', { name: /^Секция 3/ }).click();
  await page.getByRole('button', { name: 'Добавить дверь' }).click();
  await expect.poll(async () => metric(page, 'Дверей')).toBe(1);

  // Секции целы: первичный путь ничего не заменил.
  expect(await metric(page, 'Секций')).toBe(3);
  expect(await metric(page, 'Перегородок')).toBe(2);
});

test('первичные действия выделены, снятие и очистка — нет (§6)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();

  const variantOf = async (name: string): Promise<string> =>
    (await page.getByRole('button', { name, exact: true }).getAttribute('class')) ?? '';

  // Созидательные — основные.
  for (const name of ['Добавить полки', 'Добавить ящики', 'Добавить дверь']) {
    expect(await variantOf(name), `«${name}» не выделено как основное`).toMatch(/primary/);
  }

  // Поставим дверь — появятся «убрать» и «очистить»: они вторичны.
  await page.getByRole('button', { name: 'Добавить дверь' }).click();
  await expect(page.getByRole('button', { name: 'Убрать дверь', exact: true })).toBeVisible();
  expect(await variantOf('Убрать дверь')).not.toMatch(/primary/);
});

test('кнопка инспектора и кнопка шага делают ОДНО И ТО ЖЕ (§7, §18 D)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  /*
    Проверяется именно то, что было сломано: «Добавить полки» в
    инспекторе ставила ровно одну полку и затирала число, заданное на
    шаге «Полки». Теперь она делегирует в тот же обработчик, а с
    PROMPT 60 предлагается только на ПУСТОМ отделении: её работа —
    «сделать отделение полочным» (0 → N), а число задаёт шаг.
  */
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await step(page, 'Полки').click();
  await page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true }).fill('4');
  await expect.poll(async () => metric(page, 'Полок')).toBe(4);

  // Очистить и снова сделать полочным — первичной кнопкой.
  await page.getByRole('button', { name: 'Очистить ячейку' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(0);
  await page.getByRole('button', { name: 'Добавить полки' }).click();

  // Отделение стало полочным, и число задаётся там же, где и раньше.
  await expect.poll(async () => metric(page, 'Полок')).toBeGreaterThan(0);
  await expect(
    page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true }),
  ).toBeVisible();
});

test('вторичный путь ведёт к той же операции, а не к своей (§12)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  // Дверь поставлена ШАГОМ.
  await schema(page).getByRole('button', { name: /^Секция 2/ }).click();
  await step(page, 'Фасады').click();
  await page.getByRole('button', { name: 'Добавить дверь', exact: true }).first().click();
  await expect.poll(async () => metric(page, 'Дверей')).toBe(1);

  // Убрана — кнопкой ИНСПЕКТОРА. Если бы это были две независимые
  // реализации, снятие не нашло бы поставленную шагом дверь.
  await page.getByRole('button', { name: 'Убрать дверь', exact: true }).first().click();
  await expect.poll(async () => metric(page, 'Дверей')).toBe(0);
});

test('шаги 5–7 называют свою роль, а не соперничают за неё (§9, §18 E)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();

  await step(page, 'Полки').click();
  await expect(page.locator('main')).toContainText('Единственное место, где задаётся их число');

  await step(page, 'Наполнение').click();
  await expect(page.locator('main')).toContainText('Сколько именно полок — на шаге «Полки»');

  await step(page, 'Фасады').click();
  await expect(page.locator('main')).toContainText('Настройка двери выбранного отделения');
});

/** §14: первичный путь работает и пальцем, и с клавиатуры. */
test('первичный путь на телефоне (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Выбранный объект' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Что сделать с этим отделением:');

  await sheet.getByRole('button', { name: 'Добавить полки' }).click();
  await expect(sheet).toContainText('полки');
});

test('первичный путь с клавиатуры (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  const cell = schema(page).getByRole('button', { name: /^Секция 1/ });
  await cell.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Секция 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBeGreaterThan(0);
});
