import type { Project, ProjectDocument } from '../domain/index.js';
import { SCHEMA_VERSION } from '../domain/index.js';
import { migrateDocument } from './migrations/index.js';
import { normalizeProject } from './normalize.js';
import { projectDocumentSchema, versionProbeSchema } from './schema.js';

export class DeserializationError extends Error {
  readonly details: string;

  constructor(message: string, details = '') {
    super(message);
    this.name = 'DeserializationError';
    this.details = details;
  }
}

/**
 * Домен → JSON.
 *
 * Формат обмена и формат хранения — один и тот же: пользователь без аккаунта
 * должен уметь физически забрать свой проект файлом. Никаких бинарных
 * контейнеров и ничего, что нельзя открыть текстовым редактором.
 */
export function serializeProject(project: Project): ProjectDocument {
  return { schemaVersion: SCHEMA_VERSION, project };
}

export function toJson(project: Project, pretty = true): string {
  return JSON.stringify(serializeProject(project), null, pretty ? 2 : 0);
}

/**
 * JSON → домен, через проверку схемой и миграции.
 *
 * Брендированные идентификаторы восстанавливаются приведением: во время
 * выполнения это те же строки, а форму уже проверила схема. Это единственное
 * место в проекте, где такое приведение допустимо.
 */
export function deserializeDocument(raw: unknown): ProjectDocument {
  if (typeof raw !== 'object' || raw === null) {
    throw new DeserializationError('Файл проекта повреждён: ожидался объект JSON.');
  }

  const probe = versionProbeSchema.safeParse(raw);
  if (!probe.success) {
    throw new DeserializationError(
      'Файл не является проектом: отсутствует версия схемы.',
      probe.error.message,
    );
  }

  const migrated = migrateDocument(
    raw as Record<string, unknown>,
    probe.data.schemaVersion,
    SCHEMA_VERSION,
  );

  const parsed = projectDocumentSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new DeserializationError(
      'Файл проекта не соответствует ожидаемой структуре.',
      parsed.error.message,
    );
  }

  const document = parsed.data as unknown as ProjectDocument;
  // Нормализация — последний шаг разбора: она достраивает то, что схема
  // проверить не могла, потому что зависит от проекта целиком (§19).
  return { ...document, project: normalizeProject(document.project) };
}

export function fromJson(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeserializationError('Файл не является корректным JSON.');
  }
  return deserializeDocument(raw);
}
