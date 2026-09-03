import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { asId } from '../../../src/domain/index.js';
import type { Furniture, IdFactory, PartId, Project } from '../../../src/domain/index.js';
import type { CuttingStock, ProductionPart } from '../../../src/production/index.js';

/** Проект с детерминированными id и временем — как в тестах фурнитуры. */
export function makeProject(build?: (furniture: Furniture, ids: IdFactory) => Furniture): Project {
  const ids = createSequentialIdFactory('t');
  const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
  const furniture = project.furniture[0]!;
  return build === undefined ? project : { ...project, furniture: [build(furniture, ids)] };
}

/**
 * Лист для тестов раскладки. Значения задаются явно в каждом тесте:
 * проверяется поведение алгоритма, а не умолчания проекта.
 */
export function makeStock(overrides: Partial<CuttingStock> = {}): CuttingStock {
  return {
    id: 'stock:test',
    materialId: asId<'Material'>('m-1'),
    thickness: 16,
    length: 1000,
    width: 1000,
    kerf: 0,
    trimLeft: 0,
    trimRight: 0,
    trimTop: 0,
    trimBottom: 0,
    ...overrides,
  };
}

/** Производственная позиция для тестов раскладки. */
export function makeProductionPart(overrides: Partial<ProductionPart> & { id: string }): ProductionPart {
  const quantity = overrides.quantity ?? overrides.sourcePartIds?.length ?? 1;
  const sourcePartIds =
    overrides.sourcePartIds ??
    Array.from({ length: quantity }, (_, i): PartId => asId<'Part'>(`part:${overrides.id}/${String(i)}`));
  return {
    sourceNodeIds: [],
    name: overrides.id,
    partType: 'shelf',
    role: 'shelf-adjustable',
    materialId: asId<'Material'>('m-1'),
    thickness: 16,
    length: 400,
    width: 300,
    grain: 'none',
    edgeBanding: { front: 0, back: 0, left: 0, right: 0 },
    rotationAllowed: true,
    ...overrides,
    quantity,
    sourcePartIds,
  };
}
