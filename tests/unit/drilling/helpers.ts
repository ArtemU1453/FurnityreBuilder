import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { Furniture, IdFactory, Part, Project } from '../../../src/domain/index.js';
import type { GeometryResult } from '../../../src/geometry/index.js';
import type { DrillingParameters } from '../../../src/drilling/index.js';

/** Проект с детерминированными id и временем — как в тестах фурнитуры и раскроя. */
export function makeProject(build?: (furniture: Furniture, ids: IdFactory) => Furniture): Project {
  const ids = createSequentialIdFactory('t');
  const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
  const furniture = project.furniture[0]!;
  return build === undefined ? project : { ...project, furniture: [build(furniture, ids)] };
}

export function geometryOf(project: Project): GeometryResult {
  return buildGeometry({
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
}

export const partOfRole = (geometry: GeometryResult, role: Part['role']): Part =>
  geometry.parts.find((p) => p.role === role)!;

/**
 * ГИПОТЕТИЧЕСКИЕ параметры присадки — только для тестов.
 *
 * Ни одно из этих чисел не является производственным нормативом и в
 * приложение не попадает: `EMPTY_DRILLING_PARAMETERS` пуст, и правила по
 * умолчанию не считают ничего. Параметры существуют здесь, чтобы проверить
 * САМ АЛГОРИТМ — координаты, переходы, сортировку и проверки, — не выдавая
 * догадку за подтверждённое правило (PROMPT 18 §34).
 */
export const HYPOTHETICAL_PARAMETERS: DrillingParameters = {
  hinge: {
    cupDiameter: 30,
    cupDepth: 10,
    cupInset: 20,
    endOffset: 100,
    mountDiameter: 8,
    mountDepth: 10,
    mountSpacing: 40,
  },
  handle: { diameter: 5, centerDistance: 96, holesPerHandle: 2 },
  shelfSupport: { diameter: 5, depth: 10, setback: 40 },
  slide: { frontOffset: 40, pitch: 100, holesPerSlide: 3, diameter: 5, depth: 10 },
  backWall: { diameter: 3, depth: 12, spacing: 200, edgeOffset: 10 },
};
