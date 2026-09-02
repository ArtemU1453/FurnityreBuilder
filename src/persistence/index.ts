export type { ProjectRepository, ProjectSummary } from './repository.js';
export { summarize, byUpdatedAtDesc } from './repository.js';
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
