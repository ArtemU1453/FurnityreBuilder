import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { mmText, sizeText } from './format.js';
import type { ExportCuttingSheet, ExportPartDrawing, ProductionExportData } from './types.js';

/**
 * Экспорт PDF (PROMPT 20 §3–§8, §14).
 *
 * ## Почему pdf-lib и встроенный шрифт
 *
 * Стандартные 14 шрифтов PDF не содержат кириллицы: производственный
 * документ на русском без встроенного шрифта невозможен в принципе, каким
 * бы способом ни собирался файл. `pdf-lib` + `fontkit` берут на себя
 * подмножество (subset) шрифта — единственную по-настоящему сложную часть
 * задачи. Сам шрифт лежит в репозитории и отдаётся тем же сервером, что и
 * приложение: ни одного стороннего запроса (`docs/BRAND_INDEPENDENCE_AUDIT.md`).
 *
 * ## Экспорт ничего не считает
 *
 * Здесь нет ни одной производственной формулы: страницы собираются из
 * `ProductionExportData`. Единственная арифметика — вёрстка: перенос
 * строк, разбиение таблиц по страницам и масштаб чертежа.
 */

/** A4 в пунктах PDF (1 пункт = 1/72 дюйма). */
const A4 = { width: 595.28, height: 841.89 } as const;
/** A3 — для карт раскроя: лист 2750 мм на A4 нечитаем. */
const A3 = { width: 841.89, height: 1190.55 } as const;

const MARGIN = 36;
const TITLE_SIZE = 18;
const HEADING_SIZE = 13;
const TEXT_SIZE = 9;
const TABLE_SIZE = 8;
const LINE = 12;

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.78, 0.78, 0.8);
const FILL = rgb(0.93, 0.93, 0.95);
const ACCENT = rgb(0.85, 0.35, 0.15);

interface Column {
  readonly header: string;
  readonly width: number;
  readonly align?: 'right';
}

/**
 * Курсор вёрстки.
 *
 * Страницы добавляются по мере надобности, а заголовок таблицы
 * повторяется на каждой новой (§14): таблица, у которой шапка осталась на
 * предыдущем листе, на производстве читается наугад.
 */
class Layout {
  private page: PDFPage;
  private y: number;
  private readonly doc: PDFDocument;
  private readonly font: PDFFont;
  private readonly size: { width: number; height: number };

  constructor(doc: PDFDocument, font: PDFFont, size: { width: number; height: number }) {
    this.doc = doc;
    this.font = font;
    this.size = size;
    this.page = doc.addPage([size.width, size.height]);
    this.page.setFont(font);
    this.y = size.height - MARGIN;
  }

  get current(): PDFPage {
    return this.page;
  }

  get cursorY(): number {
    return this.y;
  }

  /**
   * Новая страница. Шрифт назначается ей ОДИН раз, а не при каждом
   * вызове рисования: `pdf-lib` на каждую передачу шрифта заводит в
   * ресурсах страницы отдельный ключ со случайным суффиксом, и страница
   * с сорока ссылками на один и тот же шрифт — не только лишние байты,
   * но и случайность там, где документ обязан быть предсказуемым.
   */
  newPage(): void {
    this.page = this.doc.addPage([this.size.width, this.size.height]);
    this.page.setFont(this.font);
    this.y = this.size.height - MARGIN;
  }

  /** Гарантирует, что на странице осталось `height` пунктов. */
  ensure(height: number): boolean {
    if (this.y - height >= MARGIN) return false;
    this.newPage();
    return true;
  }

  text(value: string, options: { size?: number; color?: typeof INK; indent?: number } = {}): void {
    const size = options.size ?? TEXT_SIZE;
    this.ensure(size + 4);
    this.page.drawText(value, {
      x: MARGIN + (options.indent ?? 0),
      y: this.y - size,
      size,
      color: options.color ?? INK,
    });
    this.y -= size + 4;
  }

  heading(value: string): void {
    this.ensure(HEADING_SIZE + 16);
    this.y -= 6;
    this.page.drawText(value, { x: MARGIN, y: this.y - HEADING_SIZE, size: HEADING_SIZE, color: INK });
    this.y -= HEADING_SIZE + 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: this.size.width - MARGIN, y: this.y },
      thickness: 0.7,
      color: RULE,
    });
    this.y -= 8;
  }

  gap(height = 8): void {
    this.y -= height;
  }

  /** Таблица с повторяющейся шапкой и без обрезанных строк. */
  table(columns: readonly Column[], rows: readonly (readonly string[])[]): void {
    const drawHeader = (): void => {
      const height = LINE + 2;
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - height + 3,
        width: this.size.width - MARGIN * 2,
        height,
        color: FILL,
      });
      let x = MARGIN + 3;
      for (const column of columns) {
        this.page.drawText(this.clip(column.header, column.width - 6, TABLE_SIZE), {
          x,
          y: this.y - TABLE_SIZE - 1,
          size: TABLE_SIZE,
          color: INK,
        });
        x += column.width;
      }
      this.y -= height + 2;
    };

    this.ensure(LINE * 3);
    drawHeader();

    for (const row of rows) {
      if (this.ensure(LINE + 2)) drawHeader();
      let x = MARGIN + 3;
      row.forEach((value, index) => {
        const column = columns[index];
        if (column === undefined) return;
        const clipped = this.clip(value, column.width - 6, TABLE_SIZE);
        const offset =
          column.align === 'right' ? column.width - 6 - this.font.widthOfTextAtSize(clipped, TABLE_SIZE) : 0;
        this.page.drawText(clipped, {
          x: x + Math.max(0, offset),
          y: this.y - TABLE_SIZE,
          size: TABLE_SIZE,
          color: INK,
        });
        x += column.width;
      });
      this.y -= LINE;
    }
    this.y -= 4;
  }

  /** Обрезает строку по ширине колонки: наложение текста читать нельзя. */
  clip(value: string, maxWidth: number, size: number): string {
    if (this.font.widthOfTextAtSize(value, size) <= maxWidth) return value;
    let result = value;
    while (result.length > 1 && this.font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result}…`;
  }

  /** Перенос длинного абзаца по словам. */
  paragraph(value: string, options: { size?: number; color?: typeof INK; indent?: number } = {}): void {
    const size = options.size ?? TEXT_SIZE;
    const maxWidth = this.size.width - MARGIN * 2 - (options.indent ?? 0);
    const words = value.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (this.font.widthOfTextAtSize(candidate, size) > maxWidth && line !== '') {
        this.text(line, options);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== '') this.text(line, options);
  }
}

function statusNote(status: string): string {
  switch (status) {
    case 'INVALID':
      return 'ПРЕДВАРИТЕЛЬНЫЙ ДОКУМЕНТ. Расчёт содержит ошибки — изготавливать по нему нельзя.';
    case 'NEEDS_CONFIRMATION':
      return 'ПРЕДВАРИТЕЛЬНЫЙ ДОКУМЕНТ. Часть производственных правил не подтверждена (см. раздел в конце).';
    case 'VALID_WITH_WARNINGS':
      return 'Расчёт выполнен с предупреждениями.';
    default:
      return 'Расчёт выполнен без замечаний.';
  }
}

function drawTitlePage(layout: Layout, data: ProductionExportData): void {
  const { metadata } = data;
  layout.text('Производственная документация', { size: TITLE_SIZE });
  layout.gap(6);
  layout.text(metadata.projectName, { size: HEADING_SIZE });
  layout.text(`Изделие: ${metadata.furnitureName}`);
  layout.gap(10);

  // Статус — на титуле и крупно: документ, по которому нельзя работать,
  // обязан объявлять это первым, а не в примечании на последней странице
  // (§11).
  layout.text(statusNote(metadata.status), {
    size: HEADING_SIZE,
    color: metadata.status === 'VALID' ? INK : ACCENT,
  });
  layout.gap(10);

  layout.table(
    [
      { header: 'Параметр', width: 200 },
      { header: 'Значение', width: 300 },
    ],
    [
      ['Дата генерации', metadata.generatedAt],
      ['Версия приложения', metadata.appVersion],
      ['Версия спецификации', String(metadata.bomVersion)],
      ['Статус расчёта', metadata.status],
      ['Габарит, мм', sizeText(data.dimensions.width, data.dimensions.height, data.dimensions.depth)],
      ['Позиций деталей', String(data.totals.partPositions)],
      ['Деталей всего, шт', String(data.totals.partQuantity)],
      ['Позиций фурнитуры', String(data.totals.hardwarePositions)],
      ['Операций присадки', String(data.totals.drillingOperations)],
      ['Листов раскроя', String(data.totals.sheetCount)],
      ['Использование листа, %', String(data.totals.utilization)],
      ['Не размещено деталей', String(data.totals.unplaced)],
    ],
  );

  if (data.errors.length > 0) {
    layout.heading('Ошибки расчёта');
    for (const error of data.errors.slice(0, 20)) layout.paragraph(`— ${error}`, { color: ACCENT });
    if (data.errors.length > 20) layout.text(`…и ещё ${String(data.errors.length - 20)}`, { color: MUTED });
  }
  if (data.warnings.length > 0) {
    layout.heading('Предупреждения');
    for (const warning of data.warnings.slice(0, 20)) layout.paragraph(`— ${warning}`, { color: MUTED });
    if (data.warnings.length > 20) layout.text(`…и ещё ${String(data.warnings.length - 20)}`, { color: MUTED });
  }
}

function drawDimensionsPage(layout: Layout, data: ProductionExportData): void {
  layout.newPage();
  layout.text('Общие размеры и конструкция', { size: TITLE_SIZE });
  layout.gap(10);
  layout.table(
    [
      { header: 'Параметр', width: 220 },
      { header: 'Значение', width: 280 },
    ],
    [
      ['Ширина, мм', mmText(data.dimensions.width)],
      ['Высота, мм', mmText(data.dimensions.height)],
      ['Глубина, мм', mmText(data.dimensions.depth)],
      ['Толщина материала корпуса, мм', mmText(data.dimensions.panelThickness)],
      ['Схема сборки', data.dimensions.constructionScheme],
      ['Задняя стенка', data.dimensions.backPanel],
      ['Цоколь', data.dimensions.base],
    ],
  );

  layout.heading('Материалы');
  layout.table(
    [
      { header: 'Материал', width: 150 },
      { header: 'Категория', width: 70 },
      { header: 'Толщина', width: 50, align: 'right' },
      { header: 'Позиций', width: 50, align: 'right' },
      { header: 'Деталей', width: 50, align: 'right' },
      { header: 'Площадь, м²', width: 65, align: 'right' },
      { header: 'Листов', width: 45, align: 'right' },
    ],
    data.materials.map((row) => [
      row.name,
      row.kind,
      mmText(row.thickness),
      String(row.partPositions),
      String(row.partQuantity),
      String(row.areaM2),
      String(row.sheetCount),
    ]),
  );

  layout.heading('Кромка');
  layout.table(
    [
      { header: 'Материал кромки', width: 260 },
      { header: 'Толщина', width: 60, align: 'right' },
      { header: 'Длина, м', width: 70, align: 'right' },
      { header: 'Сторон', width: 60, align: 'right' },
    ],
    data.edgeBanding.map((row) => [row.materialName, mmText(row.thickness), String(row.lengthM), String(row.sideCount)]),
  );
}

function drawPartsPage(layout: Layout, data: ProductionExportData): void {
  layout.newPage();
  layout.text('Спецификация деталей', { size: TITLE_SIZE });
  layout.gap(8);
  layout.table(
    [
      { header: '№', width: 22, align: 'right' },
      { header: 'Деталь', width: 110 },
      { header: 'Тип', width: 62 },
      { header: 'Кол-во', width: 38, align: 'right' },
      { header: 'Длина', width: 45, align: 'right' },
      { header: 'Ширина', width: 45, align: 'right' },
      { header: 'Толщ.', width: 38, align: 'right' },
      { header: 'Материал', width: 120 },
      { header: 'Кромка', width: 63 },
    ],
    data.parts.map((row) => [
      String(row.index),
      row.name,
      row.partType,
      String(row.quantity),
      mmText(row.length),
      mmText(row.width),
      mmText(row.thickness),
      row.materialName,
      row.edge,
    ]),
  );
}

function drawHardwarePage(layout: Layout, data: ProductionExportData): void {
  layout.newPage();
  layout.text('Фурнитура', { size: TITLE_SIZE });
  layout.gap(8);
  if (data.hardware.length === 0) {
    layout.paragraph(
      'Ни одной позиции не рассчитано: правила количества фурнитуры не подтверждены. Подробности — в разделе «Требует подтверждения».',
      { color: MUTED },
    );
    return;
  }
  layout.table(
    [
      { header: '№', width: 22, align: 'right' },
      { header: 'ID', width: 110 },
      { header: 'Название', width: 130 },
      { header: 'Категория', width: 90 },
      { header: 'Кол-во', width: 45, align: 'right' },
      { header: 'Ед.', width: 30 },
      { header: 'Назначение', width: 96 },
    ],
    data.hardware.map((row) => [
      String(row.index),
      row.definitionId,
      row.name,
      row.category,
      String(row.quantity),
      row.unit,
      row.purpose,
    ]),
  );
}

function drawDrillingPages(layout: Layout, data: ProductionExportData): void {
  layout.newPage();
  layout.text('Присадка', { size: TITLE_SIZE });
  layout.gap(8);
  if (data.drilling.length === 0) {
    layout.paragraph(
      'Ни одной операции не рассчитано: технологические параметры присадки не подтверждены. Подробности — в разделе «Требует подтверждения».',
      { color: MUTED },
    );
    return;
  }
  layout.table(
    [
      { header: '№', width: 22, align: 'right' },
      { header: 'Деталь', width: 100 },
      { header: 'Назначение', width: 78 },
      { header: 'Грань', width: 45 },
      { header: 'X', width: 40, align: 'right' },
      { header: 'Y', width: 40, align: 'right' },
      { header: 'Ø', width: 34, align: 'right' },
      { header: 'Глуб.', width: 38, align: 'right' },
      { header: 'Напр.', width: 34 },
      { header: 'Тип', width: 50 },
    ],
    data.drilling.map((row) => [
      String(row.index),
      row.partName,
      row.purpose,
      row.face,
      mmText(row.x),
      mmText(row.y),
      mmText(row.diameter),
      mmText(row.depth),
      row.direction,
      row.through,
    ]),
  );
}

/** Чертёж детали: габарит, кромка, текстура и отверстия в масштабе (§4). */
function drawPartDrawing(layout: Layout, drawing: ExportPartDrawing): void {
  layout.newPage();
  layout.text(`Чертёж детали: ${drawing.name}`, { size: HEADING_SIZE });
  layout.text(
    `${sizeText(drawing.length, drawing.width, drawing.thickness)} мм · ${drawing.materialName} · кромка ${drawing.edge} · текстура ${drawing.grain} · ${String(drawing.quantity)} шт`,
    { color: MUTED },
  );
  layout.gap(10);

  const page = layout.current;
  const boxWidth = A4.width - MARGIN * 2;
  const boxHeight = layout.cursorY - MARGIN - 120;
  const scale = Math.min(boxWidth / drawing.length, boxHeight / drawing.width);
  const width = drawing.length * scale;
  const height = drawing.width * scale;
  const originX = MARGIN;
  const originY = layout.cursorY - height;

  page.drawRectangle({ x: originX, y: originY, width, height, borderColor: INK, borderWidth: 1 });

  // Отверстия рисуются на пласти в масштабе детали; координаты — те же
  // локальные, что в таблице, поэтому чертёж и таблица не могут разойтись.
  for (const hole of drawing.holes) {
    if (hole.face !== 'top' && hole.face !== 'bottom') continue;
    const radius = Math.max(1.2, (hole.diameter / 2) * scale);
    page.drawCircle({
      x: originX + hole.x * scale,
      y: originY + hole.y * scale,
      size: radius,
      borderColor: ACCENT,
      borderWidth: 0.8,
    });
  }

  layout.gap(height + 14);
  layout.table(
    [
      { header: 'Отверстие', width: 150 },
      { header: 'Грань', width: 50 },
      { header: 'X', width: 45, align: 'right' },
      { header: 'Y', width: 45, align: 'right' },
      { header: 'Ø', width: 40, align: 'right' },
      { header: 'Глубина', width: 50, align: 'right' },
      { header: 'Тип', width: 60 },
      { header: 'Назначение', width: 80 },
    ],
    drawing.holes.map((hole) => [
      hole.id,
      hole.face,
      mmText(hole.x),
      mmText(hole.y),
      mmText(hole.diameter),
      mmText(hole.depth),
      hole.through,
      hole.purpose,
    ]),
  );
}

/** Карта раскроя на A3: лист, рабочая область, детали с подписями (§6). */
function drawCuttingSheet(doc: PDFDocument, font: PDFFont, sheet: ExportCuttingSheet): void {
  const page = doc.addPage([A3.width, A3.height]);
  page.setFont(font);
  const title = `Карта раскроя, лист ${String(sheet.sheetNumber)} · ${sheet.materialName} · ${sizeText(sheet.stockLength, sheet.stockWidth, sheet.thickness)} мм`;
  page.drawText(title, { x: MARGIN, y: A3.height - MARGIN - 14, size: HEADING_SIZE, color: INK });
  page.drawText(
    `Использование ${String(sheet.utilization)} % · отход ${String(sheet.wasteArea)} м² · пропил ${mmText(sheet.kerf)} мм · деталей ${String(sheet.placements.length)}`,
    { x: MARGIN, y: A3.height - MARGIN - 30, size: TEXT_SIZE, color: MUTED },
  );

  const areaTop = A3.height - MARGIN - 46;
  const areaHeight = areaTop - MARGIN;
  const areaWidth = A3.width - MARGIN * 2;
  const scale = Math.min(areaWidth / sheet.stockLength, areaHeight / sheet.stockWidth);
  const originX = MARGIN;
  const originY = areaTop - sheet.stockWidth * scale;

  page.drawRectangle({
    x: originX,
    y: originY,
    width: sheet.stockLength * scale,
    height: sheet.stockWidth * scale,
    borderColor: INK,
    borderWidth: 1,
  });
  page.drawRectangle({
    x: originX + sheet.usable.x * scale,
    y: originY + sheet.usable.y * scale,
    width: sheet.usable.length * scale,
    height: sheet.usable.width * scale,
    borderColor: RULE,
    borderWidth: 0.6,
  });

  for (const placement of sheet.placements) {
    const x = originX + placement.x * scale;
    const y = originY + placement.y * scale;
    const width = placement.width * scale;
    const height = placement.height * scale;
    page.drawRectangle({ x, y, width, height, color: FILL, borderColor: INK, borderWidth: 0.6 });

    const label = `${placement.partName} ${mmText(placement.width)}×${mmText(placement.height)}${placement.rotation === 90 ? ' ↻90°' : ''}`;
    // Подпись ставится только если она физически помещается в деталь:
    // текст, вылезающий за прямоугольник, делает карту нечитаемой (§14).
    if (font.widthOfTextAtSize(label, 7) < width - 4 && height > 12) {
      page.drawText(label, { x: x + 3, y: y + height / 2 - 3, size: 7, color: INK });
    }
  }
}

function drawConfirmationsPage(layout: Layout, data: ProductionExportData): void {
  layout.newPage();
  layout.text('Требует подтверждения', { size: TITLE_SIZE });
  layout.gap(6);
  layout.paragraph(
    'Перечисленные производственные правила референсом не подтверждены. Значения, зависящие от них, в документе либо отсутствуют, либо получены по временным техническим умолчаниям. Документ не является окончательной производственной документацией, пока эти правила не подтверждены.',
    { color: MUTED },
  );
  layout.gap(6);
  layout.table(
    [
      { header: 'Раздел', width: 70 },
      { header: 'ID', width: 60 },
      { header: 'Правило', width: 150 },
      { header: 'Последствие', width: 243 },
    ],
    data.confirmations.map((item) => [item.category, item.id, item.rule, item.impact]),
  );
}

export interface CreatePdfOptions {
  /** Байты шрифта с кириллицей. Обязателен: без него текста не будет. */
  readonly font: Uint8Array;
}

/**
 * Собирает производственный PDF.
 *
 * Возвращает байты, а не файл: сохранение — забота вызывающей стороны, и
 * генератор одинаково работает в браузере и в тесте.
 */
export async function createProductionPdf(data: ProductionExportData, options: CreatePdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(options.font, { subset: true });

  doc.setTitle(`Производственная документация — ${data.metadata.projectName}`);
  doc.setProducer('Furniture Builder');
  doc.setCreator('Furniture Builder');

  const layout = new Layout(doc, font, A4);
  drawTitlePage(layout, data);
  drawDimensionsPage(layout, data);
  drawPartsPage(layout, data);
  drawHardwarePage(layout, data);
  drawDrillingPages(layout, data);

  for (const drawing of data.drawings) drawPartDrawing(layout, drawing);
  for (const sheet of data.sheets) drawCuttingSheet(doc, font, sheet);

  if (data.unplaced.length > 0) {
    layout.newPage();
    layout.text('Неразмещённые детали', { size: TITLE_SIZE });
    layout.gap(8);
    layout.table(
      [
        { header: 'Деталь', width: 150 },
        { header: 'Экземпляр', width: 60, align: 'right' },
        { header: 'Причина', width: 90 },
        { header: 'Пояснение', width: 223 },
      ],
      data.unplaced.map((row) => [row.partName, String(row.instance), row.reason, row.detail]),
    );
  }

  drawConfirmationsPage(layout, data);
  return doc.save();
}
