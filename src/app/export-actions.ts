import type { Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { ProductionExportData } from '../export/index.js';

/**
 * Действия экспорта (PROMPT 20 §19).
 *
 * Здесь живёт всё, что генераторы документов знать не должны: загрузка
 * шрифта, обращение к DOM ради сохранения файла и динамический импорт.
 *
 * ## Почему динамический импорт
 *
 * Генератор PDF вместе с библиотекой встраивания шрифтов весит больше,
 * чем всё остальное приложение. Загружать его при открытии страницы ради
 * кнопки, которую нажимают раз в сеанс, — значит замедлить первый экран
 * всем. `import()` откладывает загрузку до нажатия и делает её видимой:
 * кнопка показывает состояние, пока чанк едет.
 *
 * ## Почему шрифт запрашивается, а не встраивается в код
 *
 * Файл лежит в `public/fonts` и отдаётся тем же сервером, что и
 * приложение: сторонних запросов нет (`docs/BRAND_INDEPENDENCE_AUDIT.md`).
 * Встроенный в JS шрифт раздул бы бандл на полмегабайта в base64 даже для
 * тех, кто ничего не экспортирует.
 */

const FONT_URL = '/fonts/LiberationSans-Regular.ttf';

/** Имя файла: без пробелов и без даты — дату несёт сам документ. */
export function exportFileName(project: Project, extension: string): string {
  const base = project.name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${base === '' ? 'project' : base}.${extension}`;
}

function saveFile(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  // Ссылка убирается следующим тиком: браузер обрабатывает клик
  // асинхронно, и удалять элемент прямо в обработчике незачем.
  setTimeout(() => {
    link.remove();
  }, 0);
  // Освобождение объекта URL обязательно: без него страница удерживает
  // документ в памяти до перезагрузки. Но не в том же тике: браузер
  // читает blob асинхронно, и ссылка, отозванная сразу после клика,
  // способна оборвать ещё не начавшееся сохранение.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

export interface ExportContext {
  readonly project: Project;
  readonly geometry: ReadonlyMap<string, GeometryResult>;
  /** Момент генерации передаётся снаружи: расчёт остаётся чистым. */
  readonly now: () => string;
}

async function buildData(context: ExportContext): Promise<ProductionExportData> {
  const [{ calculateProduction }, { buildProductionExportData }] = await Promise.all([
    import('../bom/index.js'),
    import('../export/index.js'),
  ]);
  const result = calculateProduction(context.project, {
    geometry: context.geometry as never,
  });
  return buildProductionExportData(context.project, result, { generatedAt: context.now() });
}

export async function exportXlsx(context: ExportContext): Promise<void> {
  const data = await buildData(context);
  const { createProductionXlsx } = await import('../export/xlsx.js');
  saveFile(
    createProductionXlsx(data),
    exportFileName(context.project, 'xlsx'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export async function exportPdf(context: ExportContext): Promise<void> {
  const data = await buildData(context);
  const [{ createProductionPdf }, response] = await Promise.all([
    import('../export/pdf.js'),
    fetch(FONT_URL),
  ]);
  if (!response.ok) {
    throw new Error(
      `Шрифт для PDF не загрузился (${String(response.status)}). Экспорт PDF без него невозможен.`,
    );
  }
  const font = new Uint8Array(await response.arrayBuffer());
  const pdf = await createProductionPdf(data, { font });
  saveFile(pdf, exportFileName(context.project, 'pdf'), 'application/pdf');
}
