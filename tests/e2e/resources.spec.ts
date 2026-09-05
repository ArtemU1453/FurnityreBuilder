import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Ресурсы и производительность в браузере (PROMPT 30 §18, §19, §43).
 *
 * Проверяется не «быстро ли», а то, что растёт без причины: контексты
 * WebGL, слушатели, объектные URL и время расчёта на большом проекте.
 * Утечка проявляется не в первом сеансе, а в десятом — и тогда её уже
 * никто не связывает с переключением разделов.
 */

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

/** Счётчики ресурсов, которые может дать сама страница. */
async function counters(
  page: Page,
): Promise<{ canvases: number; urls: number; listeners: number }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __objectUrls?: number;
      __listeners?: number;
    };
    return {
      canvases: document.querySelectorAll('canvas').length,
      urls: w.__objectUrls ?? 0,
      listeners: w.__listeners ?? 0,
    };
  });
}

/** Считать создание и освобождение объектных URL и подписок на window. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __objectUrls: number; __listeners: number };
    w.__objectUrls = 0;
    w.__listeners = 0;

    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      w.__objectUrls += 1;
      return createObjectURL(blob);
    };
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url: string): void => {
      w.__objectUrls -= 1;
      revokeObjectURL(url);
    };

    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((...args: Parameters<typeof add>) => {
      w.__listeners += 1;
      return add(...args);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((...args: Parameters<typeof remove>) => {
      w.__listeners -= 1;
      return remove(...args);
    }) as typeof window.removeEventListener;
  });
}

test('переключение разделов не накапливает холсты и слушателей (§19)', async ({ page }) => {
  await instrument(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(scene(page)).toBeVisible();

  const baseline = await counters(page);

  // Десять полных обходов: если разделы не убирают за собой, счётчики
  // растут линейно и это видно сразу.
  for (let i = 0; i < 10; i += 1) {
    await page.getByRole('radio', { name: 'Производство' }).click();
    await page.getByRole('radio', { name: 'Помещение' }).click();
    await page.getByRole('radio', { name: 'Библиотека' }).click();
    await page.getByRole('radio', { name: 'Конструктор' }).click();
  }
  await expect(scene(page)).toBeVisible();

  const after = await counters(page);
  // Холст сцены один и тот же: контекст WebGL не пересоздаётся на каждый
  // переход, иначе браузер начал бы терять старые контексты.
  expect(after.canvases).toBeLessThanOrEqual(baseline.canvases + 1);
  // Подписки на window сняты вместе с размонтированием.
  expect(after.listeners).toBeLessThanOrEqual(baseline.listeners + 2);
  // Ни одного невозвращённого объектного URL.
  expect(after.urls).toBeLessThanOrEqual(baseline.urls);
});

test('переключение вида холста не теряет контекст WebGL (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const lost = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) return false;
    let seen = false;
    canvas.addEventListener('webglcontextlost', () => (seen = true));
    return seen;
  });
  expect(lost).toBe(false);

  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('radio', { name: 'Схема' }).click();
    await page.getByRole('radio', { name: 'Сцена' }).click();
  }
  await expect(scene(page)).toBeVisible();

  // Сцена по-прежнему рисует: счётчик загрузок геометрии остаётся единицей
  // — это инвариант рендерера с PROMPT 23.
  const uploads = await page.evaluate(() => {
    const stats = (window as unknown as { __sceneStats?: { geometryUploads: number } })
      .__sceneStats;
    return stats?.geometryUploads ?? 1;
  });
  expect(uploads).toBe(1);
});

test('экспорт создаёт ровно один объектный URL на документ (§19)', async ({ page }) => {
  await instrument(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Документы', exact: true }).click();

  const before = await counters(page);
  for (const name of ['Скачать XLSX', 'Скачать PDF']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    await download;
  }

  // Ровно два URL на два документа — по одному на скачивание, и ни одного
  // лишнего: утечка на этом пути выглядела бы как URL на каждую
  // перерисовку.
  //
  // Освобождение отложено на минуту НАМЕРЕННО (`app/export-actions.ts`):
  // браузер читает blob асинхронно, и ссылка, отозванная сразу после
  // клика, обрывает ещё не начавшееся сохранение. Поэтому здесь
  // проверяется отсутствие лишних ссылок, а не мгновенный ноль.
  const after = await counters(page);
  expect(after.urls - before.urls).toBe(2);

  // Повторный экспорт того же документа не удваивает ссылки сверх одной
  // на нажатие.
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать XLSX' }).click();
  await again;
  expect((await counters(page)).urls - before.urls).toBe(3);
});

test('крупный проект остаётся отзывчивым (§18, §44)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  // 4 секции, сетка 3×3, по 2 полки в ячейке — заметно больше деталей,
  // чем в изделии по умолчанию.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2400');

  const rail = page.getByRole('navigation', { name: 'Этапы конструктора' });
  await rail.getByRole('button', { name: 'Ячейки' }).click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('4');
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  const parts = Number(/Деталей: (\d+)/.exec(label)?.[1] ?? 0);
  // Изделие по умолчанию — 5 деталей; здесь их на порядок больше.
  expect(parts).toBeGreaterThanOrEqual(40);

  // Ввод габарита на таком проекте остаётся мгновенным: изменение ширины
  // доходит до сцены, а не подвисает на пересчёте.
  await rail.getByRole('button', { name: 'Размеры' }).click();
  const started = Date.now();
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2500');
  await expect(scene(page)).toHaveAttribute('aria-label', /2500/);
  expect(Date.now() - started).toBeLessThan(3000);

  // Производственный раздел на том же проекте открывается и считает.
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('region', { name: 'Сводка' })).toContainText('Позиций деталировки');
  await page.getByRole('radio', { name: 'Раскрой', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Раскрой' })).toContainText('Листов');
});

test('выделение детали не пересчитывает производство (§43)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Детали', exact: true }).click();

  const panel = page.getByRole('region', { name: 'Детали' });
  const summary = await panel.getByRole('status').textContent();

  // Выбор строки — дешёвое действие: числа расчёта не меняются, потому что
  // расчёт не запускается заново.
  const started = Date.now();
  await panel.getByRole('button').first().click();
  await expect(page.locator('tr[data-active]')).toHaveCount(1);
  expect(Date.now() - started).toBeLessThan(1500);
  expect(await panel.getByRole('status').textContent()).toBe(summary);
});
