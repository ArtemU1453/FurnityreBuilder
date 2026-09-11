import type { LayoutMode } from '../layout.js';

/**
 * Разделы производственного экрана (PROMPT 29 §2).
 *
 * ## Здесь только порядок и имена
 *
 * Ни одной производственной величины: всё, что показывают разделы, уже
 * посчитано `calculateProduction` и `validateProductionReadiness`. Тот же
 * приём, что у `workflow/steps.ts` — чистый модуль без React и DOM,
 * поэтому порядок и разбор проверяются обычным тестом.
 *
 * ## Это не второе приложение
 *
 * Разделы живут ВНУТРИ существующего экрана «Производство», рядом с
 * шагами сценария (`workflow/`). Своей навигации верхнего уровня, своего
 * состояния документа и своей истории у них нет.
 */

export type ProductionSectionId =
  | 'overview'
  | 'parts'
  | 'drawings'
  | 'drilling'
  | 'cutting'
  | 'hardware'
  | 'bom'
  | 'readiness'
  | 'documentation';

export interface ProductionSection {
  readonly id: ProductionSectionId;
  readonly title: string;
  /** Что в разделе — одной строкой. */
  readonly hint: string;
}

export const PRODUCTION_SECTIONS: readonly ProductionSection[] = [
  { id: 'overview', title: 'Сводка', hint: 'Готовность и количества одним экраном.' },
  { id: 'parts', title: 'Детали', hint: 'Позиции деталировки: размеры, материал, кромка.' },
  { id: 'drawings', title: 'Чертежи', hint: 'Контур, отверстия и размеры выбранной детали.' },
  {
    id: 'drilling',
    title: 'Присадка',
    hint: 'Операции сверления и правила, по которым они получены.',
  },
  { id: 'cutting', title: 'Раскрой', hint: 'Карты листов, размещение деталей и отход.' },
  { id: 'hardware', title: 'Фурнитура', hint: 'Спецификация позиций и их источники.' },
  { id: 'bom', title: 'Спецификация', hint: 'Детали, фурнитура, материалы и кромка вместе.' },
  /*
    Готовность — свой раздел с PROMPT 63 (FR-20).

    Чеклист со списком неподтверждённых правил рисовался ВМЕСТЕ со
    «Сводкой» и занимал 80…82 % высоты страницы: раздел производства
    начинался с того, какие внутренние правила ещё не подтверждены, а не
    с того, что получилось. Список не сокращён и не спрятан — у него
    теперь своё место, а на входе осталась строка состояния.

    Назван «Готовность», а не «Проверка»: слово «Проверка» уже занято
    шагом 10 конструктора, и третье место с тем же именем никому не
    помогло бы.
  */
  {
    id: 'readiness',
    title: 'Готовность',
    hint: 'Что посчитано, что требует уточнения и на что это влияет.',
  },
  { id: 'documentation', title: 'Документы', hint: 'PDF и XLSX: что уйдёт в файл.' },
];

export const SECTION_BY_ID: Readonly<Record<ProductionSectionId, ProductionSection>> =
  Object.fromEntries(PRODUCTION_SECTIONS.map((s) => [s.id, s])) as Record<
    ProductionSectionId,
    ProductionSection
  >;

export const FIRST_SECTION: ProductionSectionId = 'overview';

/**
 * Показывать ли разделы переключателем.
 *
 * На телефоне восемь сегментов в строку не помещаются, поэтому там
 * список — та же величина, тот же выбор, одна цель для пальца
 * (PROMPT 28 §17, PROMPT 29 §40).
 */
export function usesSectionList(mode: LayoutMode): boolean {
  return mode === 'mobile';
}
