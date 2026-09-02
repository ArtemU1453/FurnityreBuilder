import { createRandomIdFactory } from '../ids.js';
import { createDefaultMaterials, DEFAULT_EDGE, DEFAULT_EDGE_SIZING_POLICY } from '../materials/defaults.js';
import { EMPTY_HARDWARE_LIBRARY } from '../hardware/types.js';
import {
  DEFAULT_SCHEME,
  DEFAULT_TOLERANCES,
  createDefaultFurniture,
} from '../furniture/defaults.js';
import type { CreateProjectOptions, Project, ProjectDocument } from './types.js';
import { SCHEMA_VERSION } from './types.js';

export const APP_VERSION = '0.1.0';

/**
 * Все внешние воздействия — источник идентификаторов и часы — передаются
 * снаружи. Домен не вызывает `Date.now()` и `crypto.randomUUID()` напрямую:
 * иначе он перестаёт быть чистым и его нельзя сравнить снапшотом.
 */
export function createProject(options: Partial<CreateProjectOptions> = {}): Project {
  const ids = options.ids ?? createRandomIdFactory();
  const now = options.now ?? ((): string => new Date().toISOString());
  const appVersion = options.appVersion ?? APP_VERSION;
  const timestamp = now();

  const materials = createDefaultMaterials(ids);
  const furniture = createDefaultFurniture(ids, materials.backId);

  return {
    id: ids.next<'Project'>(),
    name: options.name ?? 'Новый проект',
    units: 'mm',
    metadata: { createdAt: timestamp, updatedAt: timestamp, appVersion },
    materials: materials.library,
    hardware: EMPTY_HARDWARE_LIBRARY,
    furniture: [furniture],
    settings: {
      defaultMaterialId: materials.carcassId,
      defaultEdge: DEFAULT_EDGE,
      construction: DEFAULT_SCHEME,
      tolerances: DEFAULT_TOLERANCES,
      edgeSizing: DEFAULT_EDGE_SIZING_POLICY,
    },
  };
}

export function createProjectDocument(project: Project): ProjectDocument {
  return { schemaVersion: SCHEMA_VERSION, project };
}

/** Отметка времени изменения. Единственное место, где `updatedAt` меняется. */
export function touchProject(project: Project, now: () => string): Project {
  return { ...project, metadata: { ...project.metadata, updatedAt: now() } };
}
