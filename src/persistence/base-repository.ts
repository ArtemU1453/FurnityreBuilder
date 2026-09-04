import { duplicateProject, renameProject, touchProject } from '../domain/index.js';
import type { IdFactory, Project, ProjectDocument, ProjectId } from '../domain/index.js';
import type { ProjectRepository, ProjectSummary } from './repository.js';
import { RepositoryError } from './repository.js';

/**
 * Общая часть хранилищ (PROMPT 25 §4).
 *
 * ## Почему база, а не копипаста в двух классах
 *
 * `create`, `rename`, `duplicate` и `has` выражаются через
 * `load` и `save` целиком: они не знают ни про IndexedDB, ни про Map.
 * Написать их дважды значило бы завести два места, где решается,
 * что такое «переименовать проект», — и они разошлись бы при первой
 * же правке. Наследуется здесь только то, что действительно одно и
 * то же; всё, что зависит от движка хранения, объявлено абстрактным.
 *
 * ## Часы
 *
 * Момент записи — единственное место, где меняется `updatedAt` (§3).
 * Часы передаются в конструктор, а не берутся из `Date` прямо в теле:
 * иначе тест не мог бы проверить, что время обновилось, не засыпая
 * на миллисекунду.
 */
export abstract class BaseProjectRepository implements ProjectRepository {
  protected readonly now: () => string;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  abstract list(): Promise<ProjectSummary[]>;
  abstract load(id: ProjectId): Promise<ProjectDocument | undefined>;
  abstract delete(id: ProjectId): Promise<void>;
  abstract isPersistent(): boolean;

  /** Запись без отметки времени: её ставит `save`, и только он. */
  protected abstract write(project: Project): Promise<void>;

  async save(project: Project): Promise<Project> {
    const stamped = touchProject(project, this.now);
    await this.write(stamped);
    return stamped;
  }

  async has(id: ProjectId): Promise<boolean> {
    return (await this.load(id)) !== undefined;
  }

  async create(project: Project): Promise<Project> {
    // Перезаписать существующий проект «созданием» — это потерять его
    // молча. Отказ с понятной причиной честнее (§22).
    if (await this.has(project.id)) {
      throw new RepositoryError(`Проект с таким идентификатором уже существует: ${project.name}`);
    }
    return this.save(project);
  }

  async rename(id: ProjectId, name: string): Promise<Project | undefined> {
    const document = await this.load(id);
    if (document === undefined) return undefined;
    // Идентификатор не меняется: ссылки из помещений остаются живыми (§10).
    return this.save(renameProject(document.project, name, this.now));
  }

  async duplicate(id: ProjectId, ids: IdFactory, name?: string): Promise<Project | undefined> {
    const document = await this.load(id);
    if (document === undefined) return undefined;
    const copy = duplicateProject(document.project, ids, this.now, name);
    return this.create(copy);
  }
}
