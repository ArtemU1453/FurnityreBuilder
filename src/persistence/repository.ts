import type { Project, ProjectDocument, ProjectId } from '../domain/index.js';

/**
 * Краткая запись для списка проектов: читается без разбора всего документа.
 */
export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: string;
  readonly createdAt: string;
}

/**
 * Хранилище проектов.
 *
 * Интерфейс существует, чтобы интерфейс приложения никогда не обращался
 * к IndexedDB напрямую:
 *
 *   UI → Application layer → ProjectRepository → Storage
 *
 * Из этого следуют три вещи: тесты идут в памяти без эмуляции браузера,
 * приватный режим без IndexedDB деградирует до режима в памяти без единого
 * изменения в UI, а смена движка хранения не затрагивает ничего выше.
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: ProjectId): Promise<ProjectDocument | undefined>;
  save(project: Project): Promise<void>;
  delete(id: ProjectId): Promise<void>;
  /** Диагностика доступности хранилища: UI обязан честно сообщить о режиме в памяти. */
  isPersistent(): boolean;
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.metadata.updatedAt,
    createdAt: project.metadata.createdAt,
  };
}

export const byUpdatedAtDesc = (a: ProjectSummary, b: ProjectSummary): number =>
  b.updatedAt.localeCompare(a.updatedAt);
