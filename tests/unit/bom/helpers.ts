import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';

/** Проект с детерминированными id и временем — как в тестах остальных слоёв. */
export function makeProject(build?: (furniture: Furniture, ids: IdFactory) => Furniture): Project {
  const ids = createSequentialIdFactory('t');
  const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
  const furniture = project.furniture[0]!;
  return build === undefined ? project : { ...project, furniture: [build(furniture, ids)] };
}
