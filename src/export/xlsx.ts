import { createZip } from './zip.js';
import type { ProductionExportData } from './types.js';

/**
 * Экспорт XLSX (PROMPT 20 §9, §15).
 *
 * Книга собирается напрямую в формате Office Open XML: лист — это XML,
 * книга — ZIP из нескольких таких файлов. Внешней библиотеки нет
 * намеренно (см. `zip.ts`), и это даёт три вещи, важные именно здесь:
 * побайтовый детерминизм, отсутствие транзитивных зависимостей у
 * приложения, которое обязано работать офлайн, и полный контроль над тем,
 * что число остаётся числом.
 *
 * ## Числа остаются числами
 *
 * Размер, количество и процент записываются как `<v>`, а не как строка:
 * иначе по деталировке нельзя ни отсортировать, ни просуммировать, и
 * первый же технолог получит «497» левым выравниванием и вопрос, почему
 * не считается сумма (§15).
 */

type CellValue = string | number;

export interface SheetColumn {
  readonly header: string;
  readonly width: number;
}

export interface Sheet {
  readonly name: string;
  readonly columns: readonly SheetColumn[];
  readonly rows: readonly (readonly CellValue[])[];
}

/**
 * Убирает управляющие символы, недопустимые в XML.
 *
 * Табуляция, перевод строки и возврат каретки остаются: они законны и в
 * производственных примечаниях осмысленны. Проверка сделана перебором
 * кодов, а не регулярным выражением с управляющими символами внутри:
 * такое выражение нечитаемо в исходнике и запрещено линтером — по той же
 * причине.
 */
function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const allowed = code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    if (allowed) result += char;
  }
  return result;
}

function escapeXml(value: string): string {
  return stripControlCharacters(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Буквенное имя столбца: 1 → A, 27 → AA. */
export function columnName(index: number): string {
  let result = '';
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellXml(reference: string, value: CellValue, styleIndex: number): string {
  const style = styleIndex === 0 ? '' : ` s="${String(styleIndex)}"`;
  if (typeof value === 'number') {
    // Нечисловые «числа» (NaN, Infinity) в ячейку писать нельзя: файл
    // откроется повреждённым. Такого в расчёте быть не должно, но экспорт
    // не место для сюрпризов.
    const safe = Number.isFinite(value) ? value : 0;
    return `<c r="${reference}"${style}><v>${String(safe)}</v></c>`;
  }
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const columnCount = Math.max(sheet.columns.length, ...sheet.rows.map((row) => row.length), 1);
  const lastColumn = columnName(columnCount);
  const rowCount = sheet.rows.length + 1;

  const cols = sheet.columns
    .map(
      (column, index) =>
        `<col min="${String(index + 1)}" max="${String(index + 1)}" width="${String(column.width)}" customWidth="1"/>`,
    )
    .join('');

  const headerCells = sheet.columns.map((column, index) => cellXml(`${columnName(index + 1)}1`, column.header, 1)).join('');
  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2;
      const cells = row.map((value, columnIndex) => cellXml(`${columnName(columnIndex + 1)}${String(number)}`, value, 0)).join('');
      return `<row r="${String(number)}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${String(rowCount)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${
    cols === '' ? '' : `<cols>${cols}</cols>`
  }<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData><autoFilter ref="A1:${lastColumn}${String(rowCount)}"/></worksheet>`;
}

const contentTypes = (count: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')}</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/** Стиль 1 — жирный заголовок таблицы. Больше стилей документу не нужно. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function workbookXml(sheets: readonly Sheet[]): string {
  const items = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${items}</sheets></workbook>`;
}

function workbookRels(count: number): string {
  const sheetRels = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${String(count + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

/** Книга из готовых листов. Порядок листов — порядок массива. */
export function createWorkbook(sheets: readonly Sheet[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = [
    { path: '[Content_Types].xml', data: encoder.encode(contentTypes(sheets.length)) },
    { path: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { path: 'xl/workbook.xml', data: encoder.encode(workbookXml(sheets)) },
    { path: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels(sheets.length)) },
    { path: 'xl/styles.xml', data: encoder.encode(STYLES) },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${String(index + 1)}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];
  return createZip(entries);
}

/**
 * Листы производственной книги (§9).
 *
 * Состав и порядок листов фиксированы: сводка, детали, фурнитура,
 * присадка, раскрой, материалы, кромка. Ни один лист не считает ничего
 * сам — все строки приходят из `ProductionExportData`.
 */
export function buildProductionSheets(data: ProductionExportData): readonly Sheet[] {
  const summaryRows: (readonly CellValue[])[] = [
    ['Проект', data.metadata.projectName],
    ['Изделие', data.metadata.furnitureName],
    ['Дата генерации', data.metadata.generatedAt],
    ['Версия приложения', data.metadata.appVersion],
    ['Версия спецификации', data.metadata.bomVersion],
    ['Статус расчёта', data.metadata.status],
    ['Ширина, мм', data.dimensions.width],
    ['Высота, мм', data.dimensions.height],
    ['Глубина, мм', data.dimensions.depth],
    ['Толщина материала корпуса, мм', data.dimensions.panelThickness],
    ['Схема сборки', data.dimensions.constructionScheme],
    ['Задняя стенка', data.dimensions.backPanel],
    ['Цоколь', data.dimensions.base],
    ['Позиций деталей', data.totals.partPositions],
    ['Деталей всего, шт', data.totals.partQuantity],
    ['Позиций фурнитуры', data.totals.hardwarePositions],
    ['Операций присадки', data.totals.drillingOperations],
    ['Листов раскроя', data.totals.sheetCount],
    ['Использование листа, %', data.totals.utilization],
    ['Не размещено деталей', data.totals.unplaced],
    ['Требует подтверждения, правил', data.confirmations.length],
    ['Предупреждений', data.warnings.length],
    ['Ошибок', data.errors.length],
    ...data.confirmations.map((item): readonly CellValue[] => [
      `Требует подтверждения: ${item.category} ${item.id}`,
      `${item.rule} — ${item.impact}`,
    ]),
    ...data.warnings.map((text): readonly CellValue[] => ['Предупреждение', text]),
    ...data.errors.map((text): readonly CellValue[] => ['Ошибка', text]),
  ];

  return [
    {
      name: 'Сводка',
      columns: [
        { header: 'Показатель', width: 34 },
        { header: 'Значение', width: 80 },
      ],
      rows: summaryRows,
    },
    {
      name: 'Детали',
      columns: [
        { header: '№', width: 5 },
        { header: 'ID', width: 42 },
        { header: 'Деталь', width: 22 },
        { header: 'Тип', width: 14 },
        { header: 'Кол-во', width: 8 },
        { header: 'Длина, мм', width: 11 },
        { header: 'Ширина, мм', width: 11 },
        { header: 'Толщина, мм', width: 12 },
        { header: 'Материал', width: 26 },
        { header: 'Кромка', width: 16 },
        { header: 'Текстура', width: 14 },
      ],
      rows: data.parts.map((row) => [
        row.index,
        row.id,
        row.name,
        row.partType,
        row.quantity,
        row.length,
        row.width,
        row.thickness,
        row.materialName,
        row.edge,
        row.grain,
      ]),
    },
    {
      name: 'Фурнитура',
      columns: [
        { header: '№', width: 5 },
        { header: 'ID', width: 24 },
        { header: 'Название', width: 26 },
        { header: 'Категория', width: 18 },
        { header: 'Кол-во', width: 8 },
        { header: 'Ед.', width: 6 },
        { header: 'Назначение', width: 22 },
        { header: 'Источник', width: 60 },
      ],
      rows: data.hardware.map((row) => [
        row.index,
        row.definitionId,
        row.name,
        row.category,
        row.quantity,
        row.unit,
        row.purpose,
        row.sources.join(', '),
      ]),
    },
    {
      name: 'Присадка',
      columns: [
        { header: '№', width: 5 },
        { header: 'Деталь', width: 22 },
        { header: 'ID детали', width: 42 },
        { header: 'Операция', width: 34 },
        { header: 'Назначение', width: 16 },
        { header: 'Грань', width: 10 },
        { header: 'X, мм', width: 10 },
        { header: 'Y, мм', width: 10 },
        { header: 'Мир X', width: 10 },
        { header: 'Мир Y', width: 10 },
        { header: 'Мир Z', width: 10 },
        { header: 'Ø, мм', width: 8 },
        { header: 'Глубина, мм', width: 12 },
        { header: 'Направление', width: 12 },
        { header: 'Тип', width: 10 },
      ],
      rows: data.drilling.map((row) => [
        row.index,
        row.partName,
        row.partId,
        row.operationId,
        row.purpose,
        row.face,
        row.x,
        row.y,
        row.worldX,
        row.worldY,
        row.worldZ,
        row.diameter,
        row.depth,
        row.direction,
        row.through,
      ]),
    },
    {
      name: 'Раскрой',
      columns: [
        { header: '№', width: 5 },
        { header: 'Лист', width: 6 },
        { header: 'ID листа', width: 26 },
        { header: 'Лист, длина', width: 12 },
        { header: 'Лист, ширина', width: 13 },
        { header: 'Деталь', width: 22 },
        { header: 'ID детали', width: 42 },
        { header: 'X, мм', width: 10 },
        { header: 'Y, мм', width: 10 },
        { header: 'Ширина, мм', width: 11 },
        { header: 'Высота, мм', width: 11 },
        { header: 'Поворот, °', width: 11 },
        { header: 'Пропил, мм', width: 11 },
        { header: 'Использование, %', width: 17 },
        { header: 'Отход, м²', width: 11 },
      ],
      rows: [
        ...data.placements.map((row): readonly CellValue[] => [
          row.index,
          row.sheetNumber,
          row.stockId,
          row.stockLength,
          row.stockWidth,
          row.partName,
          row.partId,
          row.x,
          row.y,
          row.width,
          row.height,
          row.rotation,
          row.kerf,
          row.utilization,
          row.wasteArea,
        ]),
        // Неразмещённые детали идут тем же листом, а не отдельным файлом:
        // деталь, которую не на чем распилить, обязана попасться на глаза
        // там же, где смотрят раскрой (PROMPT 17 §20).
        ...data.unplaced.map((row): readonly CellValue[] => [
          0,
          0,
          'НЕ РАЗМЕЩЕНО',
          0,
          0,
          row.partName,
          row.partId,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ]),
      ],
    },
    {
      name: 'Материалы',
      columns: [
        { header: '№', width: 5 },
        { header: 'ID', width: 16 },
        { header: 'Материал', width: 30 },
        { header: 'Категория', width: 14 },
        { header: 'Толщина, мм', width: 12 },
        { header: 'Позиций', width: 10 },
        { header: 'Деталей, шт', width: 12 },
        { header: 'Площадь, м²', width: 12 },
        { header: 'Листов', width: 8 },
      ],
      rows: data.materials.map((row) => [
        row.index,
        row.materialId,
        row.name,
        row.kind,
        row.thickness,
        row.partPositions,
        row.partQuantity,
        row.areaM2,
        row.sheetCount,
      ]),
    },
    {
      name: 'Кромка',
      columns: [
        { header: '№', width: 5 },
        { header: 'Материал кромки', width: 44 },
        { header: 'Толщина, мм', width: 12 },
        { header: 'Длина, м', width: 11 },
        { header: 'Сторон', width: 9 },
      ],
      rows: data.edgeBanding.map((row) => [row.index, row.materialName, row.thickness, row.lengthM, row.sideCount]),
    },
  ];
}

/** Готовая книга производственной документации. */
export function createProductionXlsx(data: ProductionExportData): Uint8Array {
  return createWorkbook(buildProductionSheets(data));
}
