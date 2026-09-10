import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Приёмочные пользовательские сценарии A–H (PROMPT 35 §3).
 *
 * Прогон идёт на production-сборке — на том же артефакте, который поедет
 * на хостинг. Каждый сценарий проверяет РЕЗУЛЬТАТ действия, а не то, что
 * приложение не упало: сценарий, прошедший потому, что ничего не
 * сломалось, не проверяет ничего.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });
const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

/** Число деталей, как его объявляет сцена для скринридера. */
async function partCount(page: Page): Promise<number> {
  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  const match = /Деталей: (\d+)/.exec(label);
  expect(match, `в подписи сцены нет числа деталей: ${label}`).not.toBeNull();
  return Number(match?.[1]);
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('FLOW A — первый проект: габариты, секции, полки, сохранение', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
  const initial = await partCount(page);

  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1600');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('520');
  await expect(scene(page)).toHaveAttribute('aria-label', /1600/);
  await expect(scene(page)).toHaveAttribute('aria-label', /2000/);
  await expect(scene(page)).toHaveAttribute('aria-label', /520/);

  // Две секции — одна перегородка: деталей становится больше.
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  expect(await partCount(page)).toBeGreaterThan(initial);

  // Полки: каждая — физическая деталь.
  await step(page, 'Ячейки').click();
  const withSections = await partCount(page);
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  expect(await partCount(page)).toBeGreaterThan(withSections);

  await save(page);
});

test('FLOW B — сложное изделие: ни NaN, ни пустого расчёта', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2200');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('600');

  // Неравные секции.
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await page.getByLabel('Ширины секций, мм').fill('700, 900, 800');
  await page.getByRole('button', { name: 'Применить ширины' }).click();

  // Сетка с полками.
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  // Дверь и ящики.
  await step(page, 'Фасады').click();
  const cell = page.getByLabel('Двери').getByLabel('Ячейка');
  await cell.selectOption({ index: 1 });
  await page.getByLabel('Двери').getByRole('button', { name: 'Добавить дверь' }).click();

  await cell.selectOption({ index: 2 });
  await step(page, 'Наполнение').click();
  await page.getByRole('radio', { name: 'ящики', exact: true }).click();

  // Цоколь и задняя стенка.
  await step(page, 'Корпус').click();
  await page.getByRole('spinbutton', { name: 'Высота цоколя', exact: true }).fill('100');

  // Подпись сцены — самый прямой признак живого расчёта: там числа.
  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  expect(label).not.toMatch(/NaN|Infinity|undefined/);
  expect(await partCount(page)).toBeGreaterThan(10);

  // Производство считает то же изделие и не молчит.
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Детали', exact: true }).click();
  const parts = page.getByRole('table').first();
  await expect(parts).toBeVisible();
  await expect(parts).not.toContainText('NaN');
});

test('FLOW C — сохранение и перезагрузка не меняют проект', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1750');
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();

  const before = await partCount(page);
  await save(page);
  await page.reload();

  // Тот же проект: габарит, число деталей и структура на месте.
  await expect(scene(page)).toHaveAttribute('aria-label', /1750/);
  expect(await partCount(page)).toBe(before);
  await step(page, 'Секции').click();
  await expect(page.getByRole('spinbutton', { name: 'Секций', exact: true })).toHaveValue('3');
});

test('FLOW D — отмена и повтор возвращают ровно те же состояния', async ({ page }) => {
  const start = await partCount(page);

  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1400');
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  const afterSections = await partCount(page);
  expect(afterSections).toBeGreaterThan(start);

  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  const afterShelves = await partCount(page);

  // Назад: сетка, затем секции.
  await page.keyboard.press('Control+z');
  expect(await partCount(page)).toBe(afterSections);
  await page.keyboard.press('Control+z');
  expect(await partCount(page)).toBe(start);

  // Вперёд: те же два состояния в том же порядке.
  await page.keyboard.press('Control+Shift+z');
  expect(await partCount(page)).toBe(afterSections);
  await page.keyboard.press('Control+Shift+z');
  expect(await partCount(page)).toBe(afterShelves);
});

test('FLOW E — производство: все разделы отвечают об одном изделии', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  await page.getByRole('radio', { name: 'Производство' }).click();
  for (const section of ['Детали', 'Раскрой', 'Фурнитура', 'Присадка']) {
    await page.getByRole('radio', { name: section, exact: true }).click();
    // Раздел открылся и что-то говорит: пустой экран без объяснения —
    // тоже дефект, поэтому проверяется наличие содержимого.
    await expect(page.getByRole('main')).not.toBeEmpty();
  }
});

test('FLOW F — экспорт: оба файла скачиваются и с правильным именем', async ({ page }) => {
  /*
    Имя файла проверяется НЕ через `download.suggestedFilename()`.

    Проверка приёмки показала, что для blob-адресов headless-Chromium
    возвращает туда «download» независимо от атрибута: при этом сам
    атрибут в момент клика заполнен верно. Утверждать по такому
    показателю, что приложение теряет имя, значило бы обвинить продукт в
    дефекте окружения — сначала так и вышло, и это было ошибкой.

    Поэтому имя читается там, где оно действительно задаётся: у якоря в
    момент клика. Это же и есть то, что браузер пользователя прочитает.
  */
  // Наблюдатель, а не подмена метода: якорь для загрузки добавляется в
  // документ, и это видно снаружи, не трогая прототипы браузера.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __downloads: string[] }).__downloads = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLAnchorElement)) continue;
          if (node.download === '') continue;
          seen.push(`${node.download}|${String(node.isConnected)}`);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByRole('radio', { name: 'Производство' }).click();

  for (const format of ['PDF', 'XLSX']) {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: new RegExp(format) }).click();
    const file = await download;
    expect(await file.failure(), `${format}: загрузка не удалась`).toBeNull();
  }

  const anchors = await page.evaluate(
    () => (window as unknown as { __downloads: string[] }).__downloads,
  );
  expect(anchors).toHaveLength(2);
  for (const entry of anchors) {
    const [name, connected] = entry.split('|');
    // Имя осмысленное и с расширением — не «download».
    expect(name).toMatch(/\.(pdf|xlsx)$/i);
    // Якорь в документе: у оторванного браузер атрибут игнорирует.
    expect(connected, `якорь ${String(name)} не в документе`).toBe('true');
  }
});

test('FLOW G — 3D: сцена показывает изделие и отвечает на выбор', async ({ page }) => {
  await expect(scene(page)).toBeVisible();
  const before = (await scene(page).getAttribute('aria-label')) ?? '';

  // Правка габарита меняет то, что показывает сцена.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1234');
  await expect(scene(page)).toHaveAttribute('aria-label', /1234/);
  expect((await scene(page).getAttribute('aria-label')) ?? '').not.toBe(before);

  // Выбор детали щелчком доходит до инспектора.
  await scene(page).click({ position: { x: 220, y: 200 } });
  await expect(page.getByLabel('Свойства объекта')).toBeVisible();
});

test('FLOW H — помещение: расстановка переживает перезагрузку', async ({ page }) => {
  await save(page);

  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();

  await page.getByLabel('Проект из библиотеки').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Разместить в помещении' }).click();
  await expect(page.getByLabel('Свойства помещения')).toBeVisible();

  // Проём: он часть документа, а не украшение сцены.
  await page.getByRole('combobox', { name: 'Стена', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить проём' }).click();
  await expect(page.getByLabel('Проёмы помещения').getByRole('listitem')).toHaveCount(1);

  await save(page);
  await page.reload();
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await expect(page.getByLabel('Проёмы помещения').getByRole('listitem')).toHaveCount(1);
});
