import type { ProjectSummary } from '../persistence/index.js';

/**
 * Поиск и сортировка библиотеки (PROMPT 25 §15–§17).
 *
 * ## Почему это отдельный чистый модуль
 *
 * Поиск по имени и порядок карточек — правила, а не отрисовка. Написать
 * их внутри компонента значило бы проверять их кликами в браузере;
 * здесь они проверяются обычным тестом, а компонент только показывает
 * результат.
 */

/**
 * Нормализация строки для сравнения.
 *
 * Регистр и `ё`/`е` не должны мешать найти «Шкаф в прихожую»: человек не
 * помнит, как он назвал проект полгода назад, с точностью до буквы.
 * `localeCompare` здесь не подходит — он сравнивает, а не ищет подстроку.
 */
export function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replace(/ё/gu, 'е');
}

/** Совпадает ли имя проекта с запросом. Пустой запрос совпадает со всем. */
export function matchesQuery(summary: ProjectSummary, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return true;
  return normalizeQuery(summary.name).includes(needle);
}

export function searchProjects(
  summaries: readonly ProjectSummary[],
  query: string,
): ProjectSummary[] {
  return summaries.filter((summary) => matchesQuery(summary, query));
}

/**
 * Порядок списка (§16).
 *
 * Список закрыт намеренно: «по размеру» или «по количеству деталей»
 * выглядят разумно, но требуют посчитать геометрию всех проектов ради
 * сортировки — цена, которой сортировка не стоит (§33).
 */
export type SortOrder = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'created-desc';

export const SORT_LABELS: Readonly<Record<SortOrder, string>> = {
  'updated-desc': 'Сначала недавние',
  'updated-asc': 'Сначала старые',
  'name-asc': 'По имени, А→Я',
  'name-desc': 'По имени, Я→А',
  'created-desc': 'Сначала новые',
};

const byName = (a: ProjectSummary, b: ProjectSummary): number =>
  a.name.localeCompare(b.name, 'ru');

/**
 * Сортировка не изменяет исходный массив: он приходит из хранилища и
 * может быть показан ещё где-то. Ключ сортировки при равенстве —
 * идентификатор, иначе порядок двух проектов с одинаковым временем
 * зависел бы от реализации `sort` и «прыгал» между показами.
 */
export function sortProjects(
  summaries: readonly ProjectSummary[],
  order: SortOrder,
): ProjectSummary[] {
  const tie = (a: ProjectSummary, b: ProjectSummary, primary: number): number =>
    primary !== 0 ? primary : a.id.localeCompare(b.id);

  return [...summaries].sort((a, b) => {
    switch (order) {
      case 'updated-desc':
        return tie(a, b, b.updatedAt.localeCompare(a.updatedAt));
      case 'updated-asc':
        return tie(a, b, a.updatedAt.localeCompare(b.updatedAt));
      case 'created-desc':
        return tie(a, b, b.createdAt.localeCompare(a.createdAt));
      case 'name-asc':
        return tie(a, b, byName(a, b));
      case 'name-desc':
        return tie(a, b, byName(b, a));
    }
  });
}

/**
 * Недавние проекты (§17).
 *
 * Отдельного списка «последних открытых» нет намеренно: он был бы
 * вторым состоянием, которое нужно поддерживать в согласии с
 * библиотекой и чинить, когда проект удалён. `updatedAt` уже отвечает
 * на вопрос «над чем я работал последним», и ответ этот не может
 * разойтись с самими проектами.
 */
export const RECENT_LIMIT = 5;

export function recentProjects(
  summaries: readonly ProjectSummary[],
  limit = RECENT_LIMIT,
): ProjectSummary[] {
  return sortProjects(summaries, 'updated-desc').slice(0, Math.max(0, limit));
}
