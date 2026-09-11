import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { inventoryXlsx } from '../../../scripts/research/xlsx-inventory.mjs';

/**
 * Проверки структурной описи .xlsx (PROMPT 66 §13).
 *
 * ## Что здесь проверяется и что НЕ проверяется
 *
 * Проверяется РАЗБОР ФАЙЛА: что опись видит листы, скрытые листы,
 * скрытые строки и столбцы, объединения, формулы, именованные диапазоны
 * и свойства документа. Не проверяется ничего о мебели: приложенный
 * источник не подтвердил ни одного правила (`docs/
 * HARDWARE_REFERENCE_EVIDENCE_VERIFICATION.md`), поэтому теста вида
 * «шаг крепежа = X» здесь нет и быть не может.
 *
 * ## Почему синтетический файл, а не приложенный
 *
 * Приложенный .xlsx в репозиторий не кладётся
 * (`docs/BRAND_INDEPENDENCE_AUDIT.md`: чужие данные не копируются).
 * Поэтому разбор проверяется на файле, собранном здесь же.
 *
 * Главный из этих тестов — «находит спрятанное». Вывод аудита звучит
 * как «в файле ничего не скрыто», и такой вывод стоит чего-то только
 * если тот же код на файле СО спрятанным это спрятанное находит.
 *
 * Факты о самом приложенном файле проверяются отдельно и только если
 * путь к нему передан через `HARDWARE_XLSX_FIXTURE`. Без переменной эти
 * проверки пропускаются: тест не притворяется, что видел данные.
 */

async function build(fill: (wb: ExcelJS.Workbook) => void): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'тест';
  fill(wb);
  const path = join(mkdtempSync(join(tmpdir(), 'xlsx-inv-')), 'case.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}

describe('структурная опись .xlsx', () => {
  it('читает лист, ячейки и границы заполненного диапазона', async () => {
    const path = await build((wb) => {
      const ws = wb.addWorksheet('Крепёж');
      ws.getCell('A1').value = 'Наименование';
      ws.getCell('B1').value = 'Размер';
      ws.getCell('B2').value = '7х50';
    });

    const inv = inventoryXlsx(path);
    expect(inv.sheets).toHaveLength(1);
    expect(inv.sheets[0]?.name).toBe('Крепёж');
    expect(inv.sheets[0]?.maxRow).toBe(2);
    expect(inv.sheets[0]?.maxColumn).toBe(2);
    expect(inv.sheets[0]?.nonEmptyCells).toBe(3);
    expect(inv.sheets[0]?.cells.find((c) => c.ref === 'B2')?.value).toBe('7х50');
  });

  it('находит спрятанное: скрытый лист, veryHidden, скрытые строку и столбец', async () => {
    const path = await build((wb) => {
      wb.addWorksheet('Видимый').getCell('A1').value = 'виден';
      const hidden = wb.addWorksheet('Скрытый', { state: 'hidden' });
      hidden.getCell('A1').value = 'скрыт';
      const very = wb.addWorksheet('Совсем скрытый', { state: 'veryHidden' });
      very.getCell('A1').value = 'не показывается интерфейсом';
      const ws = wb.addWorksheet('Со скрытым');
      ws.getCell('A1').value = 'видимая строка';
      ws.getCell('A2').value = 'скрытая строка';
      ws.getRow(2).hidden = true;
      ws.getColumn(3).hidden = true;
      ws.getCell('C1').value = 'скрытый столбец';
    });

    const inv = inventoryXlsx(path);
    const state = Object.fromEntries(inv.sheets.map((s) => [s.name, s.state]));
    expect(state).toEqual({
      Видимый: 'visible',
      Скрытый: 'hidden',
      'Совсем скрытый': 'veryHidden',
      'Со скрытым': 'visible',
    });

    // Содержимое скрытого листа читается, а не пропускается.
    expect(inv.sheets.find((s) => s.name === 'Скрытый')?.cells[0]?.value).toBe('скрыт');

    const mixed = inv.sheets.find((s) => s.name === 'Со скрытым');
    expect(mixed?.hiddenRows).toEqual([2]);
    expect(mixed?.hiddenColumns).toEqual(['3:3']);
  });

  it('находит формулы, объединения и именованные диапазоны', async () => {
    const path = await build((wb) => {
      const ws = wb.addWorksheet('Счёт');
      ws.getCell('A1').value = 4;
      ws.getCell('A2').value = 7;
      ws.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 11 };
      ws.mergeCells('C1:D1');
      ws.getCell('C1').value = 'шапка';
      wb.definedNames.add('Счёт!A1', 'СтартоваяЯчейка');
    });

    const inv = inventoryXlsx(path);
    const sheet = inv.sheets[0];
    expect(sheet?.formulas).toEqual(['A3']);
    expect(sheet?.cells.find((c) => c.ref === 'A3')?.formula).toBe('SUM(A1:A2)');
    // Кэшированное значение формулы читается отдельно от самой формулы.
    expect(sheet?.cells.find((c) => c.ref === 'A3')?.value).toBe('11');
    expect(sheet?.mergedRanges).toEqual(['C1:D1']);
    expect(inv.definedNames.map((d) => d.name)).toEqual(['СтартоваяЯчейка']);
  });

  it('читает свойства документа: по ним видно происхождение файла', async () => {
    const path = await build((wb) => {
      wb.creator = 'кто-то';
      wb.title = 'заголовок';
      wb.addWorksheet('Лист').getCell('A1').value = 1;
    });

    const inv = inventoryXlsx(path);
    expect(inv.creator).toBe('кто-то');
    expect(inv.title).toBe('заголовок');
    expect(inv.macros).toBe(false);
    expect(inv.customXml).toEqual([]);
    expect(inv.embeddedObjects).toEqual([]);
  });

  it('перечисляет все части контейнера, а не только листы', async () => {
    const path = await build((wb) => {
      wb.addWorksheet('Лист').getCell('A1').value = 'строка';
    });

    const inv = inventoryXlsx(path);
    const names = inv.parts.map((p) => p.name);
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('docProps/core.xml');
    // Записи каталогов (`xl/`) в ZIP пустые по определению — размер
    // проверяется у настоящих частей.
    expect(inv.parts.filter((p) => !p.name.endsWith('/')).every((p) => p.size > 0)).toBe(true);
  });
});

const fixture = process.env['HARDWARE_XLSX_FIXTURE'];
const withFixture = fixture !== undefined && fixture !== '' && existsSync(fixture);

describe.skipIf(!withFixture)('приложенный справочник фурнитуры', () => {
  it('содержит ровно два видимых листа и ни одного скрытого', () => {
    const inv = inventoryXlsx(fixture as string);
    expect(inv.sheets.map((s) => s.name)).toEqual(['Крепежные элементы', 'Механизмы']);
    expect(inv.sheets.every((s) => s.state === 'visible')).toBe(true);
  });

  it('в обоих листах 8 × 4 ячейки, все заполнены и все — текст', () => {
    const inv = inventoryXlsx(fixture as string);
    for (const sheet of inv.sheets) {
      expect(sheet.dimension).toBe('A1:D8');
      expect(sheet.maxRow).toBe(8);
      expect(sheet.maxColumn).toBe(4);
      expect(sheet.nonEmptyCells).toBe(32);
      expect(sheet.cells.every((c) => c.type === 'inlineStr')).toBe(true);
    }
  });

  it('не содержит ничего скрытого, вычисляемого и внешнего', () => {
    const inv = inventoryXlsx(fixture as string);
    expect(inv.definedNames).toEqual([]);
    expect(inv.externalReferences).toBe(0);
    expect(inv.customXml).toEqual([]);
    expect(inv.embeddedObjects).toEqual([]);
    expect(inv.macros).toBe(false);
    for (const sheet of inv.sheets) {
      expect(sheet.formulas).toEqual([]);
      expect(sheet.mergedRanges).toEqual([]);
      expect(sheet.hiddenRows).toEqual([]);
      expect(sheet.hiddenColumns).toEqual([]);
      expect(sheet.dataValidations).toBe(0);
      expect(sheet.hyperlinks).toBe(0);
      expect(sheet.relatedParts).toEqual([]);
    }
  });

  it('не несёт происхождения: автор — библиотека, заказа и изделия в свойствах нет', () => {
    const inv = inventoryXlsx(fixture as string);
    expect(inv.creator).toBe('openpyxl');
    expect(inv.title).toBeNull();
    expect(inv.subject).toBeNull();
    expect(inv.lastModifiedBy).toBeNull();
  });

  it('не содержит ни одного числового правила количества или шага', () => {
    const inv = inventoryXlsx(fixture as string);
    const all = inv.sheets.flatMap((s) => s.cells.map((c) => c.value ?? ''));
    // Ни «шт.», ни «на стык», ни «шаг» — весь текст описывает изделия
    // фурнитуры, а не правила их расстановки. Слово ищется целиком:
    // «шт» внутри «штока» правилом количества не является.
    const vocabulary = /\bна стык|\bшаг\b|\bшт\.?\b|\bкол-во\b|\bколичеств|\bна метр|\bна погонн|\bчерез \d/i;
    expect(all.filter((t) => vocabulary.test(t))).toEqual([]);

    // И ни одного числа, выраженного как «N на что-то»: именно так
    // записывают правило количества там, где оно есть.
    expect(all.filter((t) => /\d+\s*(шт|на)\b/i.test(t))).toEqual([]);
  });
});
