import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * FR-10: у последних шагов разные задачи (PROMPT 64 §16, §17).
 *
 * ## Дефект, который здесь сторожится
 *
 * Шаги 10 «Проверка» и 11 «Производство» объявляли один и тот же экран и
 * открывали один и тот же его раздел. Замер на собранном приложении:
 * текст `main` без лестницы шагов — **1817 знаков у обоих, совпадающих
 * посимвольно**, 19 общих органов управления, ноль своих. Одиннадцать
 * шагов обещали одиннадцать задач, а последние две были одной.
 *
 * ## Что проверяется
 *
 * Смысловое различие, а не смена номера шага: разные панели, разные
 * основные действия, разные исходы. И то, что FR-20 цел: производство
 * по-прежнему открывается результатом.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const schema = (page: Page) => page.getByRole('application', { name: /Схема изделия/ });

/** Виден ли элемент без прокрутки: координаты, а не `toBeVisible`. */
async function inFirstViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight;
  });
}

/** Содержимое шага без лестницы: то, чем шаг отличается от соседа. */
async function stepContent(
  page: Page,
): Promise<{ text: string; panels: string[]; primary: string[] }> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (main === null) return { text: '', panels: [], primary: [] };
    const clone = main.cloneNode(true) as HTMLElement;
    for (const nav of clone.querySelectorAll('nav')) nav.remove();
    return {
      text: (clone.textContent ?? '').replace(/\s+/g, ' ').trim(),
      panels: [...main.querySelectorAll('section')]
        .filter((s) => s.querySelector('h2') && s.checkVisibility())
        .map((s) => s.querySelector('h2')?.textContent?.trim() ?? ''),
      primary: [...main.querySelectorAll('button')]
        .filter((b) => b.checkVisibility() && b.closest('nav') === null && /primary/.test(b.className))
        .map((b) => b.textContent?.trim() ?? ''),
    };
  });
}

/** Целевое изделие: 1800 × 2200 × 600, три секции, полки, ящик, дверь. */
async function buildFurniture(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2200');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('600');
  await rail(page).getByRole('button', { name: 'Секции' }).click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await schema(page).getByRole('button', { name: /^Секция 1/ }).click();
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await rail(page).getByRole('button', { name: 'Полки' }).click();
  await page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true }).fill('4');
  await schema(page).getByRole('button', { name: /^Секция 2/ }).click();
  await page.getByRole('button', { name: 'Добавить ящики' }).click();
  await schema(page).getByRole('button', { name: /^Секция 3/ }).click();
  await page.getByRole('button', { name: 'Добавить дверь' }).click();
  await expect(page.getByText('Фасадов ящиков')).toBeVisible();
}

/** §16 A, C — у шагов разное содержимое, и первый ведёт ко второму. */
test('шаги 10 и 11 показывают разное, и обзор ведёт к производству (§16 A, C)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);

  await rail(page).getByRole('button', { name: 'Обзор' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор изделия' })).toBeVisible();
  const tenth = await stepContent(page);

  await rail(page).getByRole('button', { name: 'Производство' }).click();
  await expect(page.getByRole('heading', { name: 'Сводка', exact: true })).toBeVisible();
  const eleventh = await stepContent(page);

  // Главное: тексты больше не совпадают.
  expect(tenth.text).not.toBe(eleventh.text);

  // И панели разные, а не «похожие».
  expect(tenth.panels).toContain('Обзор изделия');
  expect(eleventh.panels).toContain('Сводка');
  expect(tenth.panels.filter((title) => eleventh.panels.includes(title))).toEqual([]);
});

/** §16 B — основные действия ведут к разным исходам. */
test('основные действия шагов не совпадают (§16 B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);

  await rail(page).getByRole('button', { name: 'Обзор' }).click();
  const tenth = await stepContent(page);
  expect(tenth.primary).toContain('Перейти к производству');

  await rail(page).getByRole('button', { name: 'Производство' }).click();
  const eleventh = await stepContent(page);
  expect(eleventh.primary).toContain('Скачать PDF');

  // Пересечения нет: одно действие — переход между задачами, второе —
  // выдача результата.
  expect(tenth.primary.filter((text) => eleventh.primary.includes(text))).toEqual([]);
});

/** §16 C — переход между шагами живой, а не только через лестницу. */
test('кнопка обзора открывает производство (§16 C)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);

  await rail(page).getByRole('button', { name: 'Обзор' }).click();
  await page.getByRole('button', { name: 'Перейти к производству' }).click();

  await expect(page.getByRole('radio', { name: 'Производство' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Сводка', exact: true })).toBeVisible();
});

/** §16 D, E, F — FR-20 цел. */
test('производство по-прежнему открывается результатом (§16 D, E, F)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await rail(page).getByRole('button', { name: 'Производство' }).click();

  await expect(page.getByRole('radio', { name: 'Сводка', exact: true })).toBeChecked();
  const positions = page.getByRole('button', { name: 'Позиций деталировки', exact: true });
  expect(await inFirstViewport(positions), 'результат за краем экрана').toBe(true);

  // Готовность — одно нажатие, как установил FR-20.
  await page.getByRole('radio', { name: 'Готовность', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Готовность к производству' })).toBeVisible();
});

/** §16 G — слово «Проверка» больше не адресует ничего. */
test('навигация не предлагает двух мест с именем «Проверка» (§16 G)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);

  const stepTitles = await rail(page).evaluate((nav) =>
    [...nav.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? ''),
  );
  expect(stepTitles.some((title) => /Проверка/.test(title))).toBe(false);

  await rail(page).getByRole('button', { name: 'Производство' }).click();
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('main label')].map((l) => l.textContent?.trim() ?? ''),
  );
  expect(sections.filter((title) => title === 'Проверка')).toEqual([]);
});

/** §14, §16 H — на всех настольных размерах заголовок и действие видны сразу. */
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`оба шага называют себя и своё действие без прокрутки на ${String(viewport.width)} × ${String(viewport.height)} (§14, §16 H)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await buildFurniture(page);

    await rail(page).getByRole('button', { name: 'Обзор' }).click();
    const tenthTitle = page.getByRole('heading', { name: 'Обзор изделия' });
    expect(await inFirstViewport(tenthTitle), 'заголовок шага 10 за краем').toBe(true);
    const tenthAction = page.getByRole('button', { name: 'Перейти к производству' });
    expect(await inFirstViewport(tenthAction), 'действие шага 10 за краем').toBe(true);

    await rail(page).getByRole('button', { name: 'Производство' }).click();
    const eleventhTitle = page.getByRole('heading', { name: 'Сводка', exact: true });
    expect(await inFirstViewport(eleventhTitle), 'заголовок шага 11 за краем').toBe(true);
  });
}

/** §15, §16 I — на телефоне видно, на каком этапе человек и что дальше. */
test('на телефоне оба шага называют себя и своё действие (§15, §16 I)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // Шаг 10 — через лист этапов, тем же путём, что и человек: в полосе
  // на телефоне только текущий шаг, весь список — в листе.
  const bar = page.getByRole('navigation', { name: 'Этапы конструктора' });
  await bar.getByRole('button', { name: /Шаг \d+ из 11/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Этапы' });
  await sheet.getByRole('button', { name: 'Обзор' }).click();
  await expect(sheet).toBeHidden();

  /*
    На телефоне панели шага живут в листе снизу (PROMPT 28 §7): холст
    занимает экран, параметры открываются по требованию. Поэтому «на
    каком этапе человек» отвечает полоса шагов, а «что это за этап и что
    дальше» — лист, который открывается кнопкой с именем шага.
  */
  await expect(bar).toContainText('Шаг 10 из 11');
  await expect(bar).toContainText('Обзор');
  expect(await inFirstViewport(bar), 'полоса шагов за краем экрана телефона').toBe(true);

  const openStep = page.getByRole('button', { name: 'Обзор', exact: true });
  expect(await inFirstViewport(openStep), 'кнопка шага за краем экрана телефона').toBe(true);
  await openStep.click();

  const title = page.getByRole('heading', { name: 'Обзор изделия' });
  expect(await inFirstViewport(title), 'заголовок шага 10 за краем экрана телефона').toBe(true);
  const action = page.getByRole('button', { name: 'Перейти к производству' });
  expect(await inFirstViewport(action), 'действие шага 10 за краем экрана телефона').toBe(true);

  await action.click();
  await expect(page.getByRole('radio', { name: 'Производство' })).toBeChecked();
  const summary = page.getByRole('heading', { name: 'Сводка', exact: true });
  expect(await inFirstViewport(summary), 'сводка за краем экрана телефона').toBe(true);
});
