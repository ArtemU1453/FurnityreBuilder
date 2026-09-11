import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * FR-20: раздел «Производство» открывается результатом (PROMPT 63 §15).
 *
 * ## Дефект, который здесь сторожится
 *
 * Замер PROMPT 61 и повторный замер PROMPT 63: на «Сводке» вместе с
 * результатом рисовался ВЕСЬ чеклист готовности со списком
 * неподтверждённых правил. Он занимал 80.0 %, 81.6 % и 82.3 % высоты
 * страницы при окнах 1280 × 800, 1440 × 900 и 1920 × 1080, а внутри
 * него по умолчанию стояли пути к исходникам. Человек, пришедший за
 * раскроем, первым читал, какие внутренние правила ещё не подтверждены.
 *
 * ## Как здесь меряется видимость
 *
 * Не `toBeVisible()`: Playwright прокручивает элемент в поле зрения сам,
 * и проверка проходит для того, что человек без прокрутки не видит
 * (найдено в PROMPT 56). Меряются координаты в ПЕРВОМ экране.
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

/** Сколько пикселей панели попадает в первый экран. */
async function firstScreenHeight(page: Page, title: string): Promise<number> {
  return page.evaluate((name) => {
    const panel = [...document.querySelectorAll('main section')].find(
      (section) => section.querySelector('h2')?.textContent?.trim() === name,
    );
    if (panel === undefined) return 0;
    const rect = panel.getBoundingClientRect();
    return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  }, title);
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

async function openProduction(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: 'Производство' }).click();
  await expect(page.getByRole('heading', { name: 'Сводка', exact: true })).toBeVisible();
}

/** §15 A, B — вход открывает результат, и он виден без навигации. */
test('раздел открывается сводкой, и её числа видны сразу (§15 A, B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await openProduction(page);

  // Раздел по умолчанию — «Сводка».
  await expect(page.getByRole('radio', { name: 'Сводка', exact: true })).toBeChecked();

  // Конкретный производственный результат — в первом экране.
  for (const term of ['Позиций деталировки', 'Деталей всего', 'Листов раскроя', 'Не размещено']) {
    const row = page.getByRole('button', { name: term, exact: true });
    expect(await inFirstViewport(row), `«${term}» за краем экрана`).toBe(true);
  }
  expect(await firstScreenHeight(page, 'Сводка')).toBeGreaterThan(150);
});

/** §15 C — состояние видно, но не занимает экран. */
test('состояние расчёта видно рядом с результатом, а не вместо него (§15 C)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await openProduction(page);

  const status = page.getByRole('heading', { name: 'Состояние расчёта', exact: true });
  expect(await inFirstViewport(status), 'состояние за краем экрана').toBe(true);

  // Перечисление того, что требует внимания, — человеческими словами.
  await expect(page.locator('#production-status')).toContainText(/правил.* без результата/);
  await expect(page.locator('#production-status')).toContainText(/допущени.* к сведению/);

  /*
    Главное измерение FR-20: чеклист больше не рисуется на входе.
    Раньше «Готовность к производству» занимала 2663 px при окне 900 px.
  */
  expect(await firstScreenHeight(page, 'Готовность к производству')).toBe(0);
});

/** §15 E, F, G — остальные разделы достижимы одним нажатием. */
test('детали, раскрой и документы достижимы одним нажатием (§15 E, F, G)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await openProduction(page);

  // Документы — на том же экране, без перехода вовсе.
  const docs = page.getByRole('heading', { name: 'Документы', exact: true });
  expect(await inFirstViewport(docs), 'документы за краем экрана').toBe(true);
  await expect(page.getByRole('button', { name: /Скачать PDF/ })).toBeEnabled();

  await page.getByRole('radio', { name: 'Детали', exact: true }).check();
  await expect(page.locator('#production-parts')).toBeVisible();

  await page.getByRole('radio', { name: 'Раскрой', exact: true }).check();
  await expect(page.getByRole('heading', { name: 'Раскрой', exact: true }).first()).toBeVisible();
});

/** §15 D — допущения никуда не делись и разобраны по тяжести. */
test('допущения достижимы и названы по тяжести (§15 D, §11)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await openProduction(page);

  // Переход прямо из строки состояния.
  await page.getByRole('button', { name: 'Что требует внимания' }).click();
  await expect(page.getByRole('radio', { name: 'Готовность', exact: true })).toBeChecked();

  const panel = page.locator('#production-readiness');
  await expect(panel).toBeVisible();

  // Ни одно допущение не потеряно, и каждое названо по тяжести.
  const severities = await page.evaluate(() =>
    [...document.querySelectorAll('#production-readiness [data-severity]')].map((el) =>
      el.getAttribute('data-severity'),
    ),
  );
  expect(severities.length).toBeGreaterThan(0);
  expect(new Set(severities)).toEqual(new Set(['action-required', 'informational']));
  await expect(panel).toContainText('нужно уточнить до заказа');
  await expect(panel).toContainText('к сведению');
});

/** §15 (§10) — путь к исходнику не первое, что читают. */
test('техническая ссылка спрятана за раскрытием, но остаётся (§10)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await openProduction(page);
  await page.getByRole('radio', { name: 'Готовность', exact: true }).check();
  await expect(page.locator('#production-readiness')).toBeVisible();

  // По умолчанию путей к исходникам не видно нигде на экране.
  const visibleSources = await page.evaluate(() =>
    [...document.querySelectorAll('main *')].filter((el) => {
      if (el.children.length > 0) return false;
      if (!/src\//.test(el.textContent ?? '')) return false;
      return el.checkVisibility();
    }).length,
  );
  expect(visibleSources, 'путь к исходнику виден без раскрытия').toBe(0);

  // Но он на месте: раскрытие названо тем, что в нём лежит.
  const disclosure = page.locator('#production-readiness details summary').first();
  await expect(disclosure).toHaveText('Техническая ссылка');
  await disclosure.click();
  await expect(page.locator('#production-readiness')).toContainText(/Правило в коде: src\//);
});

/** §15 H, §14 — та же иерархия на телефоне. */
test('на телефоне результат и состояние видны в первом экране (§15 H, §14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildFurniture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('radio', { name: 'Производство' }).check();
  await expect(page.getByRole('heading', { name: 'Сводка', exact: true })).toBeVisible();

  // Есть посчитанный результат и видно, из чего он состоит.
  for (const term of ['Позиций деталировки', 'Деталей всего', 'Листов раскроя']) {
    const row = page.getByRole('button', { name: term, exact: true });
    expect(await inFirstViewport(row), `«${term}» за краем экрана телефона`).toBe(true);
  }

  // И видно, требует ли что-то внимания.
  const status = page.locator('#production-status [role="status"]').first();
  expect(await inFirstViewport(status), 'состояние за краем экрана телефона').toBe(true);

  // Чеклист по-прежнему не на входе.
  expect(await firstScreenHeight(page, 'Готовность к производству')).toBe(0);

  // Разделы достижимы списком.
  await expect(page.getByRole('combobox', { name: 'Раздел производства' })).toBeVisible();
});
