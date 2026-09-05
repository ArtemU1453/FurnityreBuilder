export * from './types.js';
export { buildProductionExportData } from './data.js';
export type { BuildExportDataOptions } from './data.js';
export {
  areaM2,
  edgeText,
  lengthM,
  mmText,
  mmValue,
  percentValue,
  sizeText,
  MM_PRECISION,
} from './format.js';
export { buildPartDrawing, buildPartDrawings, operationsOfItem } from './part-drawing.js';
export type {
  PartDrawingView,
  DrawingHole,
  DrawingEdgeHole,
  DrawingDimension,
  DrawingEdge,
} from './part-drawing.js';
export { createZip, crc32 } from './zip.js';
export type { ZipEntry } from './zip.js';

/*
 * Генераторов документов здесь НЕТ намеренно (PROMPT 30 §17).
 *
 * `createProductionPdf` тянет pdf-lib и fontkit, `createProductionXlsx` —
 * exceljs. Пока они лежали в этом файле, любой импорт барреля затягивал
 * их в сборку целиком: `workflow/readiness.ts` импортирует
 * `buildProductionExportData` и вычисляется на КАЖДОЕ изменение модели,
 * поэтому обе библиотеки оказывались в главном чанке, а `import()` в
 * `app/export-actions.ts` не делил ничего — делить было уже нечего.
 * Главный чанк весил 1.81 МБ при том, что документ выпускает не каждый
 * сеанс и не каждый пользователь.
 *
 * Импортировать их следует НАПРЯМУЮ и динамически:
 *
 *   const { createProductionPdf } = await import('../export/pdf.js');
 *   const { createProductionXlsx } = await import('../export/xlsx.js');
 *
 * Тесты, которым генератор нужен статически, тоже импортируют модуль
 * напрямую — сборки приложения это не касается.
 */
