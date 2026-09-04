import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import type { Project, ProjectDocument, ProjectId } from '../domain/index.js';
import { SCHEMA_VERSION } from '../domain/index.js';
import { deserializeDocument, serializeProject } from './serialization.js';
import type { ProjectRepository, ProjectSummary } from './repository.js';
import { byUpdatedAtDesc, summarize } from './repository.js';
import { BaseProjectRepository } from './base-repository.js';

export const DB_NAME = 'furniture-builder';
export const DB_VERSION = 1;

interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: number;
  readonly document: unknown;
  /**
   * Сводка для списка (PROMPT 25 §6).
   *
   * Необязательна: записи, сделанные до библиотеки, её не содержат.
   * Тогда список разбирает документ этой записи — медленнее, но
   * правильно; и при первом же сохранении запись обновится и станет
   * быстрой. Подставлять вместо неё нули значило бы показать в карточке
   * неправду.
   */
  readonly summary?: ProjectSummary;
}

interface FurnitureBuilderDb extends DBSchema {
  projects: {
    key: string;
    value: StoredProject;
    indexes: { updatedAt: string };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

/**
 * IndexedDB, а не localStorage.
 *
 * Обоснование в docs/REPOSITORY_ARCHITECTURE.md §2. Кратко: localStorage
 * синхронен и блокирует поток на сериализации крупного проекта, ограничен
 * примерно 5 МБ и хранит только строки. IndexedDB асинхронен, вмещает
 * на порядки больше, поддерживает транзакции и индексы. localStorage
 * остаётся только под мелкие настройки интерфейса.
 *
 * Сводные поля (`name`, `updatedAt`) продублированы рядом с документом,
 * чтобы список проектов строился без разбора каждого проекта целиком.
 */
export class IndexedDbProjectRepository extends BaseProjectRepository {
  private dbPromise: Promise<IDBPDatabase<FurnitureBuilderDb>> | undefined;

  private db(): Promise<IDBPDatabase<FurnitureBuilderDb>> {
    this.dbPromise ??= openDB<FurnitureBuilderDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const store = db.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
    return this.dbPromise;
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const rows = await db.getAll('projects');
    const summaries = rows.map((row) => this.summaryOf(row));
    return summaries.filter((item): item is ProjectSummary => item !== undefined).sort(byUpdatedAtDesc);
  }

  /**
   * Сводка записи: готовая, если она есть, иначе выведенная из документа.
   *
   * Битая запись пропускается, а не роняет весь список: один
   * повреждённый проект не должен закрывать пользователю доступ к
   * остальным (§22).
   */
  private summaryOf(row: StoredProject): ProjectSummary | undefined {
    if (row.summary !== undefined) return row.summary;
    try {
      const document = deserializeDocument(row.document);
      return summarize(document.project);
    } catch {
      return undefined;
    }
  }

  async load(id: ProjectId): Promise<ProjectDocument | undefined> {
    const db = await this.db();
    const row = await db.get('projects', id);
    if (row === undefined) return undefined;
    // Проверяем схемой и мигрируем на чтении: запись могла быть сделана
    // предыдущей версией приложения.
    return deserializeDocument(row.document);
  }

  protected async write(project: Project): Promise<void> {
    const db = await this.db();
    const document = serializeProject(project);
    const summary = summarize(project);
    await db.put('projects', {
      id: summary.id,
      name: summary.name,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      schemaVersion: SCHEMA_VERSION,
      document,
      summary,
    });
  }

  /** Существование проверяется ключом, без разбора документа. */
  override async has(id: ProjectId): Promise<boolean> {
    const db = await this.db();
    return (await db.getKey('projects', id)) !== undefined;
  }

  async delete(id: ProjectId): Promise<void> {
    const db = await this.db();
    await db.delete('projects', id);
  }

  isPersistent(): boolean {
    return true;
  }
}

/** Доступен ли IndexedDB в текущем окружении (приватный режим, старый браузер). */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Выбор хранилища при старте: постоянное, если возможно, иначе — в памяти
 * с честным `isPersistent() === false`, который UI обязан показать.
 */
export async function createProjectRepository(): Promise<ProjectRepository> {
  if (!isIndexedDbAvailable()) {
    const { InMemoryProjectRepository } = await import('./memory-repository.js');
    return new InMemoryProjectRepository();
  }
  return new IndexedDbProjectRepository();
}
