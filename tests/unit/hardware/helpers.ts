import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';

/**
 * Строитель проекта для тестов расчёта фурнитуры (PROMPT 16 §23).
 *
 * Тот же приём, что у `tests/unit/geometry/helpers.ts`: детерминированные
 * id и время, дефолтный проект как основа, точечная правка изделия. Вход
 * движка фурнитуры — именно `Project` (§14), поэтому здесь строится он, а
 * не `GeometryInput`.
 */
export function makeProject(build?: (furniture: Furniture, ids: IdFactory) => Furniture): Project {
  const ids = createSequentialIdFactory('t');
  const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
  const furniture = project.furniture[0]!;
  return build === undefined ? project : { ...project, furniture: [build(furniture, ids)] };
}
