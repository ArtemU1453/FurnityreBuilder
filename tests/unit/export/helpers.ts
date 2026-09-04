import { readFileSync } from 'node:fs';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { buildProductionExportData } from '../../../src/export/index.js';
import type { Furniture, IdFactory, Project } from '../../../src/domain/index.js';
import type { ProductionExportData } from '../../../src/export/index.js';

/** Проект с детерминированными id и временем — как в тестах остальных слоёв. */
export function makeProject(build?: (furniture: Furniture, ids: IdFactory) => Furniture): Project {
  const ids = createSequentialIdFactory('t');
  const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
  const furniture = project.furniture[0]!;
  return build === undefined ? project : { ...project, furniture: [build(furniture, ids)] };
}

/** Момент генерации фиксирован: иначе сравнить два экспорта нельзя. */
export const GENERATED_AT = '2026-01-01 09:00';

export function exportDataOf(project: Project): ProductionExportData {
  return buildProductionExportData(project, calculateProduction(project), { generatedAt: GENERATED_AT });
}

/**
 * Шрифт для PDF читается из репозитория — того же файла, что отдаёт
 * приложение. Отдельной тестовой копии нет: тест обязан проверять то,
 * что попадёт к пользователю.
 */
export function loadFont(): Uint8Array {
  return new Uint8Array(readFileSync('public/fonts/LiberationSans-Regular.ttf'));
}
