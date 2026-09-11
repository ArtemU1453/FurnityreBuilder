import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openScene } from './open-scene.js';

/**
 * P0 из аудита PROMPT 53: выбор отделения в основном сценарии
 * (PROMPT 54 §13, §18).
 *
 * ## Что именно сторожит этот файл
 *
 * Измеренный дефект: девять щелчков по изделию в открытом по умолчанию
 * виде дали пять раз заднюю стенку, четыре раза изделие целиком и НИ
 * РАЗУ ячейку. Шаги «Полки» и «Наполнение» при этом имели 1 и 0 органов
 * управления — то есть основной путь построения мебели упирался в
 * пустую панель.
 *
 * Здесь проверяется ПОВЕДЕНИЕ ПОЛЬЗОВАТЕЛЯ, а не внутреннее состояние:
 * человек открывает приложение, видит отделения, щёлкает одно, видит
 * подтверждение выбора и следующие действия, добавляет полки и видит
 * результат в расчёте. Ни одного обращения к store, ни одного
 * тестового люка в приложении.
 */

const cells = (page: Page) =>
  page.getByRole('application', { name: /Схема изделия/ }).getByRole('button', { name: /^Секция|^Ряд|^Колонка|^Всё внутреннее/ });

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

/** Изделие из трёх секций — минимум, на котором отделения различимы. */
async function threeSections(page: Page): Promise<void> {
  await page.goto('./');
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect(cells(page)).toHaveCount(3);
}

test('приложение открывается видом, в котором отделения видно и можно выбрать (§18 A)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // Схема — а не сцена: это основной вид построения.
  await expect(page.getByRole('application', { name: /Схема изделия/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Схема', exact: true })).toBeChecked();

  // Отделение существует как объект взаимодействия, а не как пустота.
  await expect(cells(page)).toHaveCount(1);
});

test('щелчок по отделению выбирает ИМЕННО отделение, а не заднюю стенку (§18 B)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  // Дефект PROMPT 53 воспроизводился щелчками по разным местам изделия.
  // Здесь щёлкают все три отделения подряд — и каждое достаётся ему.
  for (const index of [0, 1, 2]) {
    await cells(page).nth(index).click();
    await expect(
      page.getByRole('heading', { name: `Секция ${String(index + 1)}`, exact: true }),
    ).toBeVisible();
  }
});

test('выбранное отделение названо человеческим именем, а не идентификатором (§18 C, D)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);
  await cells(page).nth(1).click();

  // Что выбрано — видно словами.
  await expect(page.getByRole('heading', { name: 'Секция 2', exact: true })).toBeVisible();

  // И ни на одном экране конструктора нет UUID как подписи.
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  await expect(page.locator('main')).not.toContainText(uuid);

  // Включая селектор ячеек шага «Фасады» — место, где UUID был измерен.
  await step(page, 'Фасады').click();
  const options = await page.getByRole('combobox', { name: 'Ячейка' }).locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  for (const option of options) expect(option).not.toMatch(uuid);
  expect(options.join(' ')).toContain('Секция 2');
});

test('после выбора отделения видно, что можно сделать дальше (§18 E)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);
  await cells(page).nth(0).click();

  // Следующие действия предлагаются по месту, у выбранного объекта.
  await expect(page.getByRole('button', { name: 'Добавить полки' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить ящики' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить дверь' })).toBeVisible();
});

test('выбор отделения → полки → результат виден в расчёте (§18 F)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  const shelves = page.getByRole('term', { name: 'Полок' }).or(page.getByText('Полок', { exact: true }));
  await expect(shelves.first()).toBeVisible();

  await cells(page).nth(0).click();
  await page.getByRole('button', { name: 'Добавить полки' }).click();

  // Результат виден там же, где человек смотрит: в сводке расчёта.
  await expect(page.locator('main')).toContainText(/Полок/);
  await step(page, 'Полки').click();
  const count = page.getByRole('spinbutton', { name: 'Полок в выбранном отделении' });
  await expect(count).toBeVisible();
  await expect(count).not.toHaveValue('0');
});

test('шаги «Полки» и «Наполнение» перестают быть тупиком (§9)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  // Без выбора: подсказка НЕ обещает невозможного — про сцену не сказано.
  await step(page, 'Наполнение').click();
  const empty = page.getByText('Отделение не выбрано');
  await expect(empty).toBeVisible();
  await expect(page.locator('main')).toContainText('Щёлкните любое отделение на схеме');

  // С выбором: панель наполняется органами управления.
  await cells(page).nth(0).click();
  await expect(empty).toBeHidden();
  await expect(page.getByRole('radio', { name: 'ящики', exact: true })).toBeVisible();
});

test('в трёхмерной сцене инструкция не обещает невозможного и даёт выход (§12)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await openScene(page);
  await step(page, 'Ячейки').click();

  // Текст честен: он не зовёт выбирать ячейку в сцене.
  await expect(page.locator('main')).toContainText('Отделения выбираются на схеме');
  await expect(page.locator('main')).not.toContainText('на холсте или в сцене');

  // И даёт действие, а не только совет.
  await page.getByRole('button', { name: 'Открыть схему' }).click();
  await expect(page.getByRole('application', { name: /Схема изделия/ })).toBeVisible();
  await cells(page).first().click();
  await expect(page.getByRole('button', { name: 'Добавить полки' })).toBeVisible();
});

/**
 * §14: тот же путь на всех измеренных размерах окна.
 *
 * Аудит PROMPT 53 показал, что настольная и мобильная раскладки ведут
 * себя по-разному настолько, что вывод об одной ничего не говорит о
 * другой. Поэтому проверяется каждый, а не «репрезентативный».
 */
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  const name = `${String(viewport.width)} × ${String(viewport.height)}`;
  test(`отделение находится, выбирается и наполняется на ${name} (§18 G)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');

    // На телефоне холст занимает экран, на настольном — среднюю колонку.
    // Схема — основной вид построения в обоих случаях.
    await expect(page.getByRole('application', { name: /Схема изделия/ })).toBeVisible();

    // Отделение видно и выбирается щелчком.
    await cells(page).first().click();
    await expect(page.getByRole('heading', { name: 'Всё внутреннее пространство' })).toBeVisible();

    // Следующее действие доступно и выполняется.
    const add = page.getByRole('button', { name: 'Добавить полки' });
    await expect(add).toBeVisible();
    await add.click();
    await expect(page.locator('main')).toContainText(/Полок/);
  });
}
