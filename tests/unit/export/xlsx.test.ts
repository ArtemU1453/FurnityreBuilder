import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createProductionXlsx, columnName, createZip, crc32 } from '../../../src/export/index.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { createDrawersLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { exportDataOf, makeProject } from './helpers.js';

/**
 * XLSX (PROMPT 20 §16–§17).
 *
 * Файл не просто «создался без исключения»: он открывается СТОРОННЕЙ
 * библиотекой (`exceljs`, только в тестах) и проверяется по существу —
 * листы, заголовки, число строк, типы ячеек. Проверять собственным
 * читателем было бы самообманом: он повторил бы ошибку писателя.
 */

const REQUIRED_SHEETS = ['Сводка', 'Детали', 'Фурнитура', 'Присадка', 'Раскрой', 'Материалы', 'Кромка'];

async function openWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

describe('Test 17–19 (§17): книга открывается и содержит нужные листы', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') }));
  const data = exportDataOf(project);
  const bytes = createProductionXlsx(data);

  it('Test 17: файл не пустой и является корректным ZIP', async () => {
    expect(bytes.length).toBeGreaterThan(2000);
    // Сигнатура локального заголовка ZIP: файл вообще является архивом.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const workbook = await openWorkbook(bytes);
    expect(workbook.worksheets.length).toBe(REQUIRED_SHEETS.length);
  });

  it('Test 18: все обязательные листы на месте и в нужном порядке', async () => {
    const workbook = await openWorkbook(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(REQUIRED_SHEETS);
  });

  it('Test 19: заголовки колонок листа деталей соответствуют спецификации', async () => {
    const workbook = await openWorkbook(bytes);
    const sheet = workbook.getWorksheet('Детали')!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header).toEqual([
      '№',
      'ID',
      'Деталь',
      'Тип',
      'Кол-во',
      'Длина, мм',
      'Ширина, мм',
      'Толщина, мм',
      'Материал',
      'Кромка',
      'Текстура',
    ]);
  });
});

describe('Test 20–23 (§15): качество книги', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 3) }));
  const data = exportDataOf(project);
  const bytes = createProductionXlsx(data);

  it('Test 20: число строк совпадает со спецификацией', async () => {
    const workbook = await openWorkbook(bytes);
    const result = calculateProduction(project);
    // Заголовок плюс строки: лишняя или потерянная строка в деталировке —
    // это лишняя или потерянная деталь в заказе.
    expect(workbook.getWorksheet('Детали')!.rowCount).toBe(result.bom.parts.length + 1);
    expect(workbook.getWorksheet('Фурнитура')!.rowCount).toBe(result.bom.hardware.lines.length + 1);
    expect(workbook.getWorksheet('Кромка')!.rowCount).toBe(result.bom.edgeBanding.length + 1);
  });

  it('Test 21: размеры и количества записаны числами, а не текстом', async () => {
    const workbook = await openWorkbook(bytes);
    const sheet = workbook.getWorksheet('Детали')!;
    const row = sheet.getRow(2);
    for (const column of [5, 6, 7, 8]) {
      expect(typeof row.getCell(column).value).toBe('number');
    }
    expect(typeof row.getCell(3).value).toBe('string');
  });

  it('Test 22: заголовок закреплён и включён фильтр', async () => {
    const workbook = await openWorkbook(bytes);
    const sheet = workbook.getWorksheet('Детали')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();
  });

  it('Test 23: значения ячеек совпадают с данными документа', async () => {
    const workbook = await openWorkbook(bytes);
    const sheet = workbook.getWorksheet('Детали')!;
    data.parts.forEach((part, index) => {
      const row = sheet.getRow(index + 2);
      expect(row.getCell(2).value).toBe(part.id);
      expect(row.getCell(5).value).toBe(part.quantity);
      expect(row.getCell(6).value).toBe(part.length);
      expect(row.getCell(9).value).toBe(part.materialName);
    });
  });
});

describe('Test 24–25 (§13): детерминизм книги', () => {
  it('Test 24: одинаковые данные дают побайтово одинаковый файл', () => {
    const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') }));
    const first = createProductionXlsx(exportDataOf(project));
    const second = createProductionXlsx(exportDataOf(project));
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('Test 25: архив не содержит отметок времени', () => {
    const bytes = createProductionXlsx(exportDataOf(makeProject()));
    // Поля даты и времени в заголовке записи зафиксированы на начале
    // эпохи DOS: иначе один и тот же проект давал бы разные файлы.
    expect(bytes[10]).toBe(0);
    expect(bytes[11]).toBe(0);
  });
});

describe('Test 26 (§9): служебные функции архива', () => {
  it('CRC32 совпадает с эталонным значением', () => {
    // Контрольная сумма строки «123456789» — общеизвестная проверка
    // реализации CRC32.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('имена столбцов считаются как в таблицах', () => {
    expect(columnName(1)).toBe('A');
    expect(columnName(26)).toBe('Z');
    expect(columnName(27)).toBe('AA');
    expect(columnName(52)).toBe('AZ');
  });

  it('пустой архив всё равно корректен', () => {
    const bytes = createZip([]);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});

describe('Test 27 (§11): неподтверждённые правила видны в книге', () => {
  it('лист «Сводка» несёт статус и перечень ограничений', async () => {
    const data = exportDataOf(makeProject());
    const workbook = await openWorkbook(createProductionXlsx(data));
    const sheet = workbook.getWorksheet('Сводка')!;
    const cells: string[] = [];
    sheet.eachRow((row) => {
      cells.push((row.values as unknown[]).slice(1).map(String).join(' '));
    });
    const text = cells.join('\n');
    expect(text).toContain('NEEDS_CONFIRMATION');
    expect(text).toContain('Требует подтверждения');
    expect(text).toContain('T-CUT-01');
  });
});
