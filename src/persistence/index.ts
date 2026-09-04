export type { ProjectRepository, ProjectSummary } from './repository.js';
export { summarize, byUpdatedAtDesc, RepositoryError } from './repository.js';
export { BaseProjectRepository } from './base-repository.js';
export { InMemoryProjectRepository } from './memory-repository.js';
export {
  IndexedDbProjectRepository,
  createProjectRepository,
  isIndexedDbAvailable,
  DB_NAME,
  DB_VERSION,
} from './indexeddb-repository.js';
export {
  serializeProject,
  deserializeDocument,
  toJson,
  fromJson,
  DeserializationError,
} from './serialization.js';
export { migrateDocument, MigrationError, MIGRATIONS } from './migrations/index.js';
export type { Migration } from './migrations/index.js';
export { projectSchema, projectDocumentSchema } from './schema.js';
export { normalizeProject } from './normalize.js';
export {
  importProjectFromText,
  exportProjectToText,
  exportFileName,
  collectImportWarnings,
  PROJECT_STATUS_LABELS,
} from './transfer.js';
export type { ImportResult, ProjectStatus } from './transfer.js';
