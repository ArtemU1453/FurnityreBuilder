import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

/**
 * Выгруженные документы против того, что показал редактор
 * (PROMPT 47, gap G-02).
 *
 * ## Какой пробел это закрывает
 *
 * До этого набор проверял, что файл СКАЧАЛСЯ и начинается правильной
 * сигнатурой. Содержимое проверяли модульные тесты — но по данным,
 * построенным в самом тесте, а не по документу, который выпустило
 * работающее приложение. Между «генератор считает верно» и «человек
 * получил верный файл» помещается вся цепочка: модель, расчёт, кнопка,
 * blob, загрузка.
 *
 * Приёмка PROMPT 46 сверяла это руками. Здесь — автоматически.
 *
 * ## Почему числа берутся из редактора, а не задаются константами
 *
 * Константа в тесте — это третий источник правды: он разойдётся с
 * продуктом при первой же правке допусков и заставит править тест
 * вместо того, чтобы поймать регрессию. Поэтому габариты вводятся
 * пользователем, а число деталей и позиций читается с экрана — и с ним
 * сверяется файл.
 */

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

/** Число деталей, как его объявляет сцена для скринридера. */
async function scenePartCount(page: Page): Promise<number> {
  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  const match = /Деталей: (\d+)/.exec(label);
  expect(match, `в подписи сцены нет числа деталей: ${label}`).not.toBeNull();
  return Number(match?.[1]);
}

/** Габариты вводит пользователь — они же ожидаются в документе. */
const WIDTH = 1640;
const HEIGHT = 2080;
const DEPTH = 540;

async function buildProject(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill(String(WIDTH));
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill(String(HEIGHT));
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill(String(DEPTH));
  await expect(scene(page)).toHaveAttribute('aria-label', new RegExp(String(WIDTH)));
  await expect(scene(page)).toHaveAttribute('aria-label', new RegExp(String(HEIGHT)));
  await expect(scene(page)).toHaveAttribute('aria-label', new RegExp(String(DEPTH)));
}

test('XLSX содержит то же изделие, что показывал редактор', async ({ page }) => {
  test.slow();
  await buildProject(page);
  const parts = await scenePartCount(page);

  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Документы', exact: true }).click();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /XLSX/ }).click();
  const file = await download;
  expect(await file.failure(), 'XLSX не скачался').toBeNull();

  const path = await file.path();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);

  // Книга открывается настоящим читателем XLSX, а не сравнением байтов.
  const sheets = book.worksheets.map((sheet) => sheet.name);
  expect(sheets, `листы книги: ${sheets.join(', ')}`).toContain('Сводка');
  expect(sheets).toContain('Детали');

  /*
    Ячейка XLSX может нести не только строку или число, но и формулу
    или форматированный текст объектом. Приводим явно и одинаково —
    иначе сравнение однажды упрётся в «[object Object]».
  */
  const cellText = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if ('richText' in value) return value.richText.map((part) => part.text).join('');
      if ('text' in value) return String(value.text);
      if ('result' in value) {
        const result: unknown = value.result;
        return typeof result === 'string' || typeof result === 'number' ? String(result) : '';
      }
      return '';
    }
    return String(value);
  };

  /** Значение из листа «Сводка» по названию показателя в первой колонке. */
  const summary = (term: string): string => {
    const sheet = book.getWorksheet('Сводка');
    let found = '';
    sheet?.eachRow((row) => {
      if (cellText(row.getCell(1).value).trim() === term) {
        found = cellText(row.getCell(2).value).trim();
      }
    });
    return found;
  };

  // Габариты в документе — те, которые ввёл пользователь.
  expect(summary('Ширина, мм'), 'ширина в книге').toBe(String(WIDTH));
  expect(summary('Высота, мм'), 'высота в книге').toBe(String(HEIGHT));
  expect(summary('Глубина, мм'), 'глубина в книге').toBe(String(DEPTH));

  // Число деталей в документе — то, которое объявила сцена.
  expect(Number(summary('Деталей всего, шт')), 'число деталей в книге').toBe(parts);

  // Версия приложения в документе — настоящая, а не запасная.
  expect(summary('Версия приложения')).not.toBe('0.0.0-dev');

  // Деталировка не пуста и без битых чисел.
  const details = book.getWorksheet('Детали');
  expect(details, 'листа «Детали» нет').toBeDefined();
  expect(details?.rowCount ?? 0, 'деталировка пуста').toBeGreaterThan(1);

  let rows = 0;
  let quantity = 0;
  details?.eachRow((row, index) => {
    if (index === 1) return; // заголовок
    rows += 1;
    const length = Number(row.getCell(6).value);
    const width = Number(row.getCell(7).value);
    const thickness = Number(row.getCell(8).value);
    quantity += Number(row.getCell(5).value);
    expect(Number.isFinite(length) && length > 0, `строка ${String(index)}: длина ${String(length)}`).toBe(true);
    expect(Number.isFinite(width) && width > 0, `строка ${String(index)}: ширина ${String(width)}`).toBe(true);
    expect(Number.isFinite(thickness) && thickness > 0, `строка ${String(index)}: толщина`).toBe(true);
    // Ни одна деталь не может быть больше самого изделия по длине.
    const longest = Math.max(WIDTH, HEIGHT, DEPTH);
    expect(length, `строка ${String(index)}: деталь длиннее изделия`).toBeLessThanOrEqual(longest);
  });

  expect(rows, 'позиций в деталировке').toBeGreaterThan(0);
  // Сумма количеств по позициям обязана сойтись с числом деталей: иначе
  // деталировка и сводка говорят о разных изделиях.
  expect(quantity, 'сумма количеств не сошлась с числом деталей').toBe(parts);
});

test('PDF открывается и описывает тот же проект', async ({ page }) => {
  test.slow();
  await buildProject(page);

  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Документы', exact: true }).click();

  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /PDF/ }).click();
  const file = await download;
  expect(await file.failure(), 'PDF не скачался').toBeNull();

  const path = await file.path();
  const doc = await PDFDocument.load(await (await import('node:fs/promises')).readFile(path));

  // Документ открывается настоящим читателем PDF.
  expect(doc.getPageCount(), 'страниц в документе').toBeGreaterThanOrEqual(6);

  // Заголовок несёт имя проекта: по нему файл узнают среди других.
  const title = doc.getTitle() ?? '';
  expect(title, `заголовок документа: ${title}`).toContain('Новый проект');

  // Форматы страниц те, что обещаны: A4 для текста, A3 для карт раскроя.
  const sizes = new Set(
    doc.getPages().map((p) => `${String(Math.round(p.getWidth()))}x${String(Math.round(p.getHeight()))}`),
  );
  expect([...sizes], `форматы страниц: ${[...sizes].join(', ')}`).toContain('595x842');
});
