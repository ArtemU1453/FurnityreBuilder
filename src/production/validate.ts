import { issue } from '../domain/index.js';
import type { Issue, MaterialLibrary } from '../domain/index.js';
import type { CuttingLayout, CuttingStock, ProductionPart } from './types.js';
import { usableAreaOf } from './stock.js';

/**
 * Проверки производственных деталей и раскладки (PROMPT 17 §19, §27).
 *
 * Проверяется не ввод пользователя, а СОБСТВЕННЫЙ результат: детали и
 * раскладку строит этот же слой. Смысл именно в этом — алгоритм раскладки
 * содержит арифметику, в которой легко ошибиться на пропил или на обрезную
 * кромку, и «визуально всё в порядке» здесь не критерий (§19). Проверка
 * ловит ошибку алгоритма до того, как по такой карте распилят лист.
 */

const EPSILON = 0.001;

export function validateProductionPart(part: ProductionPart, materials: MaterialLibrary, knownPartIds: ReadonlySet<string>): Issue[] {
  const errors: Issue[] = [];
  const where = `Позиция «${part.name}» (${part.id})`;

  if (!(part.length > 0)) errors.push(issue('PRODUCTION_LENGTH_NOT_POSITIVE', 'error', `${where}: длина ${String(part.length)} мм не положительна.`));
  if (!(part.width > 0)) errors.push(issue('PRODUCTION_WIDTH_NOT_POSITIVE', 'error', `${where}: ширина ${String(part.width)} мм не положительна.`));
  if (!(part.thickness > 0)) errors.push(issue('PRODUCTION_THICKNESS_NOT_POSITIVE', 'error', `${where}: толщина ${String(part.thickness)} мм не положительна.`));
  if (materials.items[part.materialId] === undefined) {
    errors.push(issue('PRODUCTION_MATERIAL_NOT_FOUND', 'error', `${where} ссылается на несуществующий материал «${String(part.materialId)}».`));
  }
  if (part.quantity < 1) {
    errors.push(issue('PRODUCTION_QUANTITY_INVALID', 'error', `${where}: количество ${String(part.quantity)} меньше единицы.`));
  }
  if (part.quantity !== part.sourcePartIds.length) {
    errors.push(
      issue(
        'PRODUCTION_QUANTITY_MISMATCH',
        'error',
        `${where}: количество ${String(part.quantity)} не совпадает с числом деталей-источников ${String(part.sourcePartIds.length)}.`,
      ),
    );
  }
  for (const sourceId of part.sourcePartIds) {
    if (!knownPartIds.has(sourceId)) {
      errors.push(issue('PRODUCTION_SOURCE_NOT_FOUND', 'error', `${where} ссылается на деталь «${String(sourceId)}», которой нет в геометрии.`));
    }
  }
  return errors;
}

export function validateStock(stock: CuttingStock): Issue[] {
  const errors: Issue[] = [];
  const where = `Лист «${stock.id}»`;
  if (!(stock.length > 0) || !(stock.width > 0)) {
    errors.push(issue('CUTTING_STOCK_SIZE_INVALID', 'error', `${where}: размер ${String(stock.length)}×${String(stock.width)} мм не положителен.`));
  }
  if (stock.kerf < 0) errors.push(issue('CUTTING_KERF_NEGATIVE', 'error', `${where}: ширина пропила ${String(stock.kerf)} мм отрицательна.`));
  const trims = [stock.trimLeft, stock.trimRight, stock.trimTop, stock.trimBottom];
  if (trims.some((t) => t < 0)) {
    errors.push(issue('CUTTING_TRIM_NEGATIVE', 'error', `${where}: обрезная кромка не может быть отрицательной.`));
  }
  const usable = usableAreaOf(stock);
  if (!(usable.length > 0) || !(usable.width > 0)) {
    errors.push(
      issue(
        'CUTTING_USABLE_AREA_INVALID',
        'error',
        `${where}: рабочая область ${String(usable.length)}×${String(usable.width)} мм после обрезной кромки не положительна.`,
      ),
    );
  }
  return errors;
}

/**
 * Проверка раскладки (§19): деталь внутри рабочей области, детали не
 * пересекаются, поворот не нарушает запрет, источник существует.
 */
export function validateLayout(layout: CuttingLayout, partsById: ReadonlyMap<string, ProductionPart>): Issue[] {
  const errors: Issue[] = [];
  const usable = usableAreaOf(layout.stock);

  for (const placement of layout.placements) {
    const where = `Размещение «${placement.id}»`;
    const part = partsById.get(placement.productionPartId);
    if (part === undefined) {
      errors.push(issue('CUTTING_PLACEMENT_SOURCE_NOT_FOUND', 'error', `${where} ссылается на несуществующую позицию «${placement.productionPartId}».`));
      continue;
    }
    if (placement.rotation === 90 && !part.rotationAllowed) {
      errors.push(issue('CUTTING_ROTATION_FORBIDDEN', 'error', `${where}: деталь повёрнута на 90°, хотя поворот запрещён.`));
    }
    if (!(placement.width > 0) || !(placement.height > 0)) {
      errors.push(issue('CUTTING_PLACEMENT_SIZE_INVALID', 'error', `${where}: размер ${String(placement.width)}×${String(placement.height)} мм не положителен.`));
    }
    if (
      placement.x < usable.x - EPSILON ||
      placement.y < usable.y - EPSILON ||
      placement.x + placement.width > usable.x + usable.length + EPSILON ||
      placement.y + placement.height > usable.y + usable.width + EPSILON
    ) {
      errors.push(
        issue(
          'CUTTING_PLACEMENT_OUT_OF_BOUNDS',
          'error',
          `${where} выходит за рабочую область листа: деталь ${String(placement.width)}×${String(placement.height)} мм в точке (${String(placement.x)}, ${String(placement.y)}).`,
        ),
      );
    }
  }

  for (let i = 0; i < layout.placements.length; i += 1) {
    for (let j = i + 1; j < layout.placements.length; j += 1) {
      const a = layout.placements[i];
      const b = layout.placements[j];
      if (a === undefined || b === undefined) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > EPSILON && overlapY > EPSILON) {
        errors.push(
          issue(
            'CUTTING_PLACEMENTS_OVERLAP',
            'error',
            `Размещения «${a.id}» и «${b.id}» пересекаются на ${String(Math.round(overlapX))}×${String(Math.round(overlapY))} мм.`,
          ),
        );
      }
    }
  }

  return errors;
}
