/**
 * Библиотека проектов: публичная поверхность (PROMPT 25 §2).
 *
 * Слой чистый — ни React, ни DOM, ни хранилища. Он отвечает на вопросы
 * «какие проекты показать и в каком порядке» и «как выглядит проект»,
 * но не на вопрос «где они лежат»: на последний отвечает
 * `ProjectRepository`, и второго ответа на него не существует.
 */
export { normalizeQuery, matchesQuery, searchProjects, sortProjects, recentProjects, SORT_LABELS, RECENT_LIMIT } from './search.js';
export type { SortOrder } from './search.js';

export {
  generateProjectThumbnail,
  isPreviewStale,
  fingerprintProject,
  renderSceneSvg,
  shadeColor,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
} from './preview.js';
