import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { ConstructionScheme, Dimensions } from '../../../src/domain/index.js';
import type { GeometryInput } from '../../../src/geometry/types.js';

/**
 * Общий строитель `GeometryInput` для тестов PROMPT 3.
 *
 * Не переиспользует `input()`/`makeInput()` из уже существующих
 * `carcass.test.ts`/`engine.test.ts`, чтобы не трогать проверенные файлы —
 * но следует тому же принципу: детерминированные id и время, дефолтный
 * проект как основа, точечные переопределения габаритов и схемы.
 */
export function makeGeometryInput(
  dimensions: Partial<Dimensions> = {},
  schemeOverrides: Partial<ConstructionScheme> = {},
): GeometryInput {
  const project = createProject({
    ids: createSequentialIdFactory('t'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const furniture = project.furniture[0]!;
  return {
    furniture: { ...furniture, dimensions: { ...furniture.dimensions, ...dimensions } },
    scheme: { ...project.settings.construction, ...schemeOverrides },
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  };
}
