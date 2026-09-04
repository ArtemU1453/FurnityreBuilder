import type { Dimensions, IdFactory, Project, ProjectDocument, ProjectId, ProjectPreview } from '../domain/index.js';

/**
 * Краткая запись для списка проектов: читается без разбора всего документа.
 *
 * ## Почему в ней появились габарит и превью (PROMPT 25 §6)
 *
 * Карточка библиотеки показывает имя, дату, габарит и картинку. Если бы
 * сводка их не несла, список из двадцати проектов пришлось бы загружать
 * целиком и считать геометрию каждого — ради двух строчек текста. Это
 * не второй источник правды: всё здесь выведено из самого проекта
 * функцией `summarize`, и ничто из этого нельзя изменить, минуя проект.
 */
export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  /** Сколько изделий в проекте: «шкаф» и «кухня из шести шкафов» — разные вещи. */
  readonly furnitureCount: number;
  /**
   * Габарит первого изделия — того же, что показывает превью.
   * `undefined` у проекта без изделий; такого не создаёт ни один путь,
   * но файл, пришедший извне, обязан читаться и в этом случае.
   */
  readonly size: Dimensions | undefined;
  /** Сохранённое превью, если оно уже построено. */
  readonly preview: ProjectPreview | undefined;
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
 *
 * ## Библиотека не заводит второго хранилища (PROMPT 25 §4–§5)
 *
 * Операции библиотеки — создать, переименовать, продублировать,
 * проверить существование — добавлены СЮДА, к уже существовавшим
 * `list/load/save/delete`. Отдельный «LibraryStore» рядом означал бы два
 * ответа на вопрос «какие проекты есть у пользователя», и они разошлись
 * бы при первой же ошибке записи.
 *
 * Всё остаётся локальным: IndexedDB в браузере, память — когда её нет.
 * Ни сети, ни учётной записи, ни синхронизации здесь нет и не
 * предусмотрено (`docs/BRAND_INDEPENDENCE_AUDIT.md` §4.4).
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: ProjectId): Promise<ProjectDocument | undefined>;
  /**
   * Записывает проект и возвращает то, что записано.
   *
   * Возвращает, а не `void`, потому что запись — единственный момент,
   * когда меняется `updatedAt` (§3): без автосохранения «проект
   * изменился» и «изменение записано» — одно и то же событие. Вызывающий
   * код обязан взять возвращённую версию, иначе на экране осталось бы
   * старое время, а в хранилище новое.
   */
  save(project: Project): Promise<Project>;
  delete(id: ProjectId): Promise<void>;
  /** Есть ли такой проект. Нужен ссылкам из помещения и импорту. */
  has(id: ProjectId): Promise<boolean>;
  /** Записывает НОВЫЙ проект. Существующий не перезаписывает — это была бы потеря. */
  create(project: Project): Promise<Project>;
  /** Копия проекта с новым идентификатором. `undefined`, если оригинала нет. */
  duplicate(id: ProjectId, ids: IdFactory, name?: string): Promise<Project | undefined>;
  /** Переименование без смены идентификатора. `undefined`, если проекта нет. */
  rename(id: ProjectId, name: string): Promise<Project | undefined>;
  /** Диагностика доступности хранилища: UI обязан честно сообщить о режиме в памяти. */
  isPersistent(): boolean;
}

/** Ошибка, о которой пользователю можно сказать словами. */
export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export function summarize(project: Project): ProjectSummary {
  const first = project.furniture[0];
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.metadata.updatedAt,
    createdAt: project.metadata.createdAt,
    furnitureCount: project.furniture.length,
    size: first === undefined ? undefined : first.dimensions,
    preview: project.preview,
  };
}

export const byUpdatedAtDesc = (a: ProjectSummary, b: ProjectSummary): number =>
  b.updatedAt.localeCompare(a.updatedAt);
