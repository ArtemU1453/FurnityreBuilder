import type { Project, ProjectDocument, ProjectId } from '../domain/index.js';
import { serializeProject } from './serialization.js';
import type { ProjectSummary } from './repository.js';
import { byUpdatedAtDesc, summarize } from './repository.js';
import { BaseProjectRepository } from './base-repository.js';

/**
 * Хранилище в памяти.
 *
 * Не отладочная заглушка, а рабочий режим: в приватном окне IndexedDB может
 * быть недоступен, и приложение обязано продолжать работать, честно сообщив,
 * что изменения не переживут перезагрузку (`isPersistent() === false`).
 * Он же используется в тестах домена — без эмуляции браузера.
 */
export class InMemoryProjectRepository extends BaseProjectRepository {
  private readonly store = new Map<string, ProjectDocument>();

  list(): Promise<ProjectSummary[]> {
    const summaries = [...this.store.values()].map((doc) => summarize(doc.project));
    return Promise.resolve(summaries.sort(byUpdatedAtDesc));
  }

  load(id: ProjectId): Promise<ProjectDocument | undefined> {
    const found = this.store.get(id);
    // Клонируем: вызывающий код не должен получить ссылку на внутреннее состояние
    // и случайно изменить «сохранённое» в обход save().
    return Promise.resolve(found === undefined ? undefined : structuredClone(found));
  }

  protected write(project: Project): Promise<void> {
    this.store.set(project.id, structuredClone(serializeProject(project)));
    return Promise.resolve();
  }

  delete(id: ProjectId): Promise<void> {
    this.store.delete(id);
    return Promise.resolve();
  }

  isPersistent(): boolean {
    return false;
  }
}
