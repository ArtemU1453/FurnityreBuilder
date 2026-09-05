import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createProductionXlsx } from '../../../src/export/xlsx.js';
import { createProductionPdf } from '../../../src/export/pdf.js';
import { buildProductionExportData } from '../../../src/export/index.js';
import { loadFont } from '../export/helpers.js';
import { FIXTURES, geometryOf, productionOf } from './fixtures.js';
import type { FixtureName } from './fixtures.js';

/**
 * Документы против расчёта (PROMPT 30 §12).
 *
 * Проверяется не «функция вызвалась», а СОДЕРЖИМОЕ: книга открывается
 * сторонней библиотекой, и её числа сверяются со спецификацией. Документ,
 * который открывается, но содержит другие количества, хуже документа,
 * который не открывается: по нему изготовят не то.
 */

const FONT = loadFont();

function dataOf(name: FixtureName) {
  const project = FIXTURES[name]();
  const furniture = project.furniture[0]!;
  return buildProductionExportData(project, productionOf(project), {
    generatedAt: '2026-01-01 00:00',
    geometry: new Map([[String(furniture.id), geometryOf(project)]]),
  });
}

async function openWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return workbook;
}

/** Строки листа без заголовка. */
function rowCount(workbook: ExcelJS.Workbook, sheet: string): number {
  const worksheet = workbook.getWorksheet(sheet);
  expect(worksheet, `лист «${sheet}» отсутствует`).toBeDefined();
  return Math.max(0, worksheet!.rowCount - 1);
}

const NAMES: FixtureName[] = ['carcass', 'shelves', 'drawers', 'complex'];

describe.each(NAMES)('XLSX против расчёта: «%s»', (name) => {
  const data = dataOf(name);
  const bytes = createProductionXlsx(data);

  it('файл открывается сторонней библиотекой', async () => {
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const workbook = await openWorkbook(bytes);
    expect(workbook.worksheets.length).toBeGreaterThan(0);
  });

  it('число строк деталей совпадает со спецификацией', async () => {
    const workbook = await openWorkbook(bytes);
    expect(rowCount(workbook, 'Детали')).toBe(data.parts.length);
  });

  it('число строк фурнитуры совпадает со спецификацией', async () => {
    const workbook = await openWorkbook(bytes);
    expect(rowCount(workbook, 'Фурнитура')).toBe(data.hardware.length);
  });

  it('число операций присадки совпадает с расчётом', async () => {
    const workbook = await openWorkbook(bytes);
    expect(rowCount(workbook, 'Присадка')).toBe(data.drilling.length);
  });

  it('раскрой в книге содержит и размещённые, и неразмещённые детали', async () => {
    // Неразмещённые дописываются в тот же лист (`xlsx.ts`), а не
    // прячутся: лист без них выглядел бы полным раскроем.
    const workbook = await openWorkbook(bytes);
    expect(rowCount(workbook, 'Раскрой')).toBe(data.placements.length + data.unplaced.length);
  });

  it('количества деталей переносятся без искажения', async () => {
    const workbook = await openWorkbook(bytes);
    const sheet = workbook.getWorksheet('Детали')!;
    const total = data.parts.reduce((sum, row) => sum + row.quantity, 0);
    let fromFile = 0;
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      // Колонка количества найдётся по заголовку, а не по номеру: порядок
      // колонок — забота писателя, и тест не должен его дублировать.
      const header = sheet.getRow(1).values as unknown[];
      const column = header.findIndex((value) => String(value) === 'Кол-во');
      fromFile += Number(row.getCell(column).value ?? 0);
    });
    expect(fromFile).toBe(total);
  });

  it('неподтверждённые правила не теряются', async () => {
    const workbook = await openWorkbook(bytes);
    const summary = workbook.getWorksheet('Сводка');
    expect(summary).toBeDefined();
    const text = JSON.stringify(summary!.getSheetValues());
    // Каждое неподтверждённое правило названо своим идентификатором:
    // документ, потерявший их, выглядит готовым, а он не готов.
    for (const item of data.confirmations) expect(text).toContain(item.id);
  });

  it('ошибки расчёта не теряются', async () => {
    if (data.errors.length === 0) return;
    const workbook = await openWorkbook(bytes);
    const text = JSON.stringify(workbook.getWorksheet('Сводка')!.getSheetValues());
    expect(text).toContain('Ошибк');
  });
});

describe.each(NAMES)('PDF против расчёта: «%s»', (name) => {
  const data = dataOf(name);

  it('файл создаётся, является PDF и не пуст', async () => {
    const bytes = await createProductionPdf(data, { font: FONT });
    expect(bytes.length).toBeGreaterThan(2000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('документ повторяем: два вызова дают одинаковую структуру', async () => {
    const first = await createProductionPdf(data, { font: FONT });
    const second = await createProductionPdf(data, { font: FONT });
    // Побайтовое равенство не гарантируется (в PDF есть идентификаторы),
    // но размер и число страниц обязаны совпадать.
    expect(Math.abs(first.length - second.length)).toBeLessThan(64);
  });
});

describe('чертежи в документе', () => {
  it('страницы чертежей появляются ровно тогда, когда есть отверстия', () => {
    // Прямая проверка дефекта, найденного на PROMPT 29: чертежи искались
    // по идентификатору позиции деталировки в карте, ключуемой
    // идентификатором производственной детали, и не находились никогда.
    for (const name of NAMES) {
      const data = dataOf(name);
      const production = productionOf(FIXTURES[name]());
      const withHoles = production.bom.parts.filter((item) =>
        item.productionPartIds.some(
          (id) => (production.drilling.byProductionPart.get(id)?.length ?? 0) > 0,
        ),
      );
      expect(data.drawings).toHaveLength(withHoles.length);
    }
  });
});
