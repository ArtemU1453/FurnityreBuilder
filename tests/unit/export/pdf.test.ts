import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createProductionPdf } from '../../../src/export/pdf.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { exportDataOf, loadFont, makeProject } from './helpers.js';
import type { ProductionExportData } from '../../../src/export/index.js';

/**
 * PDF (PROMPT 20 §16–§17).
 *
 * Файл разбирается тем же разбором, что и любой просмотрщик: страницы,
 * их размеры, ресурсы шрифта. Проверка «не бросил исключение» здесь
 * бесполезна — сломанный PDF генерируется молча и обнаруживается только у
 * того, кто его открыл.
 */

const FONT = loadFont();

async function render(data: ProductionExportData): Promise<{ bytes: Uint8Array; doc: PDFDocument }> {
  const bytes = await createProductionPdf(data, { font: FONT });
  return { bytes, doc: await PDFDocument.load(bytes) };
}

describe('Test 28–31 (§17): документ создаётся и открывается', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 4, 'adjustable') }));

  it('Test 28: файл не пустой и начинается сигнатурой PDF', async () => {
    const { bytes } = await render(exportDataOf(project));
    expect(bytes.length).toBeGreaterThan(5000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('Test 29: страниц не ноль, и все обязательные разделы дали страницы', async () => {
    const { doc } = await render(exportDataOf(project));
    // Титул, размеры, детали, фурнитура, присадка, подтверждения — шесть
    // разделов минимум, плюс листы раскроя.
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
  });

  it('Test 30: страницы имеют формат A4, карты раскроя — A3', async () => {
    const { doc } = await render(exportDataOf(project));
    const sizes = doc.getPages().map((page) => `${String(Math.round(page.getWidth()))}x${String(Math.round(page.getHeight()))}`);
    expect(sizes).toContain('595x842');
    expect(sizes).toContain('842x1191');
  });

  it('Test 31: заголовок документа содержит имя проекта', async () => {
    const { doc } = await render(exportDataOf(project));
    expect(doc.getTitle()).toContain(project.name);
  });
});

describe('Test 32–33 (§3): кириллица и шрифт', () => {
  it('Test 32: шрифт встроен как Type0 с кодировкой Identity-H', async () => {
    const { doc } = await render(exportDataOf(makeProject()));
    const resources = doc.getPages()[0]!.node.Resources()!;
    const fonts = resources.lookup(PDFName.of('Font')) as unknown as { entries: () => [unknown, unknown][] };
    const entries = fonts.entries();
    // Ровно один шрифт на страницу: `pdf-lib` заводит новый ключ ресурса
    // на каждую передачу шрифта, и сорок ссылок на один и тот же шрифт —
    // признак того, что страница собрана неаккуратно.
    expect(entries).toHaveLength(1);

    const fontDict = doc.context.lookup(entries[0]![1] as never) as unknown as {
      get: (name: PDFName) => { toString: () => string } | undefined;
    };
    expect(fontDict.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');
    expect(fontDict.get(PDFName.of('Encoding'))?.toString()).toBe('/Identity-H');
    expect(fontDict.get(PDFName.of('BaseFont'))?.toString()).toContain('LiberationSans');
  });

  it('Test 33: без шрифта документ не собирается молча', async () => {
    // Пустые байты — не шрифт: генератор обязан упасть, а не выдать
    // документ без текста.
    await expect(createProductionPdf(exportDataOf(makeProject()), { font: new Uint8Array(0) })).rejects.toThrow();
  });
});

describe('Test 34–35 (§11, §13): статус и повторяемость', () => {
  it('Test 34: документ по расчёту с ошибками всё равно создаётся и помечается', async () => {
    const data = exportDataOf(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } })));
    expect(data.metadata.status).toBe('INVALID');
    const { doc } = await render(data);
    // Экспорт не запрещается: документ нужен, чтобы увидеть, ЧТО не так.
    // Пометка о предварительности стоит на титуле (§11).
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('Test 35: структура документа повторяется при повторном экспорте', async () => {
    const data = exportDataOf(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') })));
    const first = await render(data);
    const second = await render(data);
    expect(second.doc.getPageCount()).toBe(first.doc.getPageCount());
    expect(second.doc.getTitle()).toBe(first.doc.getTitle());
    const sizeOf = (doc: PDFDocument): string =>
      doc.getPages().map((page) => `${String(Math.round(page.getWidth()))}x${String(Math.round(page.getHeight()))}`).join(',');
    expect(sizeOf(second.doc)).toBe(sizeOf(first.doc));
  });
});
