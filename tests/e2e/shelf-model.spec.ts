import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * FR-08: одна модель полок (PROMPT 60 §12–§14, §18).
 *
 * ## Дефекты, которые здесь сторожатся
 *
 * Разбор PROMPT 60 измерил на собранном приложении три расхождения:
 *
 * 1. инспектор говорил «Наполнение: полки», но не сколько их — узнать
 *    число можно было только уйдя на шаг «Полки»;
 * 2. «Добавить полки» на отделении с тремя полками оставляла три, то
 *    есть молча не делала ничего, обещая подписью добавление;
 * 3. поле шага «Полки» показывало `0` на отделении с ЯЩИКОМ, а ввод
 *    числа этот ящик уничтожал без вопроса.
 *
 * ## Что проверяется
 *
 * Весь путь целиком — от габаритов до пустого отделения — и то, что
 * оба входа приводят к ОДНОМУ состоянию модели, а не к похожему.
 */

const schema = (page: Page) => page.getByRole('application', { name: /Схема изделия/ });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });
const shelfCountField = (page: Page) =>
  page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true });

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

/** Строка «Наполнение» из инспектора — там, где выбрано отделение. */
async function inspectorFill(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('dt, li > span:first-child')];
    const row = rows.find((el) => el.textContent?.trim() === 'Наполнение');
    return row?.nextElementSibling?.textContent?.trim() ?? row?.parentElement?.lastElementChild?.textContent?.trim() ?? '';
  });
}

async function threeSections(page: Page): Promise<void> {
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect.poll(async () => metric(page, 'Ячеек')).toBe(3);
}

/**
 * §12 — путь целиком: открыть, задать габариты, разделить, выбрать
 * отделение, сделать его полочным, задать число, проверить, изменить,
 * проверить, убрать, проверить пустоту.
 */
test('полный путь: полки появляются, меняются и убираются одной моделью (§12)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // 1. Габариты.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2200');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('600');

  // 2. Отделения.
  await threeSections(page);

  // 3. Выбрать отделение.
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await expect(page.getByText('Что сделать с этим отделением:')).toBeVisible();

  // 4. Сделать полочным — кнопкой у изделия.
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(1);

  // 5. Задать число — там, где оно задаётся.
  await step(page, 'Полки').click();
  await shelfCountField(page).fill('4');
  await expect.poll(async () => metric(page, 'Полок')).toBe(4);

  // 6. Проверить: поле и деталировка согласны.
  await expect(shelfCountField(page)).toHaveValue('4');

  // 7. Изменить.
  await shelfCountField(page).fill('2');
  await expect.poll(async () => metric(page, 'Полок')).toBe(2);
  await expect(shelfCountField(page)).toHaveValue('2');

  // 8. Убрать.
  await shelfCountField(page).fill('0');
  await expect.poll(async () => metric(page, 'Полок')).toBe(0);

  // 9. Отделение пусто — и снова предлагает сделать себя полочным.
  await expect(shelfCountField(page)).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Добавить полки' })).toBeVisible();

  // Секции целы: правка полок ничего вокруг не заменила.
  expect(await metric(page, 'Секций')).toBe(3);
});

/** §8 — сколько полок видно там, где выбрано отделение. */
test('количество полок видно в инспекторе, без похода на другой шаг (§8)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await threeSections(page);

  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await step(page, 'Полки').click();
  await shelfCountField(page).fill('3');
  await expect.poll(async () => metric(page, 'Полок')).toBe(3);

  // Уйти со шага «Полки» — число всё равно должно быть видно.
  await step(page, 'Секции').click();
  await expect.poll(async () => inspectorFill(page)).toBe('полки, 3 шт');
});

/** §9 — кнопка, которая ничего бы не сделала, не предлагается. */
test('«Добавить полки» не предлагается там, где полки уже есть (§9)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await threeSections(page);

  const cell = schema(page).getByRole('button', { name: /^Секция 1/ });
  await cell.click();
  const add = page.getByRole('button', { name: 'Добавить полки' });
  await expect(add).toBeVisible();

  await add.click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(1);

  // Полки есть — действия «сделать полочным» больше нет.
  await expect(add).toHaveCount(0);
  // Зато есть то, чем полки убирают.
  await expect(page.getByRole('button', { name: 'Очистить ячейку' })).toBeVisible();

  // Освободили — предложение вернулось.
  await page.getByRole('button', { name: 'Очистить ячейку' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(0);
  await expect(add).toBeVisible();
});

/** §18 E — правка количества не уничтожает чужое наполнение. */
test('шаг «Полки» не врёт про отделение с ящиком и не уничтожает его (§18 E)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await threeSections(page);

  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await page.getByRole('button', { name: 'Добавить ящики' }).click();
  await expect.poll(async () => metric(page, 'Фасадов ящиков')).toBe(1);

  await step(page, 'Полки').click();

  // Поля с нулём, читающегося как «полок нет», здесь больше нет.
  await expect(shelfCountField(page)).toHaveCount(0);
  await expect(page.locator('p[data-shelves="foreign-fill"]')).toContainText('ящики');

  // Ящик цел.
  expect(await metric(page, 'Фасадов ящиков')).toBe(1);
  expect(await metric(page, 'Полок')).toBe(0);
});

/** §13 — оба входа приводят к одному состоянию, а не к похожему. */
test('кнопка у изделия и поле шага сходятся в одном состоянии (§13)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await threeSections(page);

  // Путь 1: кнопка, затем число.
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await step(page, 'Полки').click();
  await shelfCountField(page).fill('3');
  await expect.poll(async () => metric(page, 'Полок')).toBe(3);

  // Путь 2: сразу число, в соседнем отделении.
  await schema(page).getByRole('button', { name: /^Секция 2/ }).click();
  await shelfCountField(page).fill('3');
  await expect.poll(async () => metric(page, 'Полок')).toBe(6);

  // Оба отделения описаны одинаково — значит состояние одно.
  await expect.poll(async () => inspectorFill(page)).toBe('полки, 3 шт');

  /*
    Вернуться в первое отделение приходится с клавиатуры: полки на схеме
    нарисованы поверх отделения, и щелчок в середину выбирает полку, а не
    отделение — деталь конкретнее ячейки (`resolveSelection`). Это
    существующее поведение выбора, а не дефект FR-08.
  */
  const first = schema(page).getByRole('button', { name: /^Секция 1/ });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Секция 1', exact: true })).toBeVisible();
  await expect.poll(async () => inspectorFill(page)).toBe('полки, 3 шт');
});

/** §14 — отмена и повтор для обоих путей, по одному шагу истории. */
test('отмена и повтор возвращают ровно предыдущее число полок (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await threeSections(page);

  const undo = page.getByRole('button', { name: 'Отменить · Ctrl+Z' });
  const redo = page.getByRole('button', { name: 'Вернуть · Ctrl+Shift+Z' });

  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();

  // 0 → 1 кнопкой.
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(1);

  // 1 → 4 полем.
  await step(page, 'Полки').click();
  await shelfCountField(page).fill('4');
  await expect.poll(async () => metric(page, 'Полок')).toBe(4);

  // Один шаг назад — прежнее число, а не пустое отделение.
  await undo.click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(1);

  // Ещё шаг — отделение снова пусто.
  await undo.click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(0);

  // Вперёд — те же два состояния в том же порядке.
  await redo.click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(1);
  await redo.click();
  await expect.poll(async () => metric(page, 'Полок')).toBe(4);

  // Секции при этом не трогались ни разу.
  expect(await metric(page, 'Секций')).toBe(3);
});

/** §14 — то же на телефоне: органы те же, путь тот же. */
test('полки на телефоне: тот же путь и то же число (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Выбранный объект' });
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Добавить полки' }).click();
  await expect(sheet).toContainText('полки, 1 шт');

  // Действие, которое уже сделано, больше не предлагается.
  await expect(sheet.getByRole('button', { name: 'Добавить полки' })).toHaveCount(0);
});
