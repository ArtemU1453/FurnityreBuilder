import type { Issue, Project } from '../domain/index.js';

/**
 * Правило валидации — чистая функция от проекта к списку замечаний.
 *
 * Слой не знает про UI: он не форматирует HTML, не открывает панелей и не
 * решает, блокировать ли кнопку. Он сообщает, что не так; что с этим делать —
 * решает приложение.
 */
export interface ValidationRule {
  readonly code: string;
  run(project: Project): Issue[];
}

export interface ValidationReport {
  readonly issues: readonly Issue[];
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  /**
   * Редактирование не блокируется никогда (принцип Agency).
   * Блокируется только выгрузка производственных файлов.
   */
  readonly canExport: boolean;
}
