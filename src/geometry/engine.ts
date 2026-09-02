import { box3, vec3 } from '../domain/index.js';
import { GeometryContext } from './context.js';
import type { GeometryStage } from './context.js';
import { carcassStage } from './stages/carcass.js';
import { normalizeStage } from './stages/normalize.js';
import type { GeometryInput, GeometryResult, StageDescriptor } from './types.js';

/**
 * Конвейер расчёта.
 *
 * Порядок зафиксирован в docs/ARCHITECTURE.md §5.2 и повторён здесь целиком,
 * включая ещё не реализованные этапы. Список не «то, что уже написано»,
 * а полный контракт движка: пропущенные этапы попадают в
 * `GeometryResult.pendingStages`, поэтому неполный результат нельзя случайно
 * принять за полный.
 */
export const PIPELINE: readonly StageDescriptor[] = [
  { name: 'normalize', status: 'implemented' },
  { name: 'carcass', status: 'implemented' },
  { name: 'layout', status: 'planned', plannedAt: '09' },
  { name: 'dividers', status: 'planned', plannedAt: '10' },
  { name: 'fill', status: 'planned', plannedAt: '11' },
  { name: 'back', status: 'planned', plannedAt: '13' },
  { name: 'base', status: 'planned', plannedAt: '23' },
  { name: 'countertop', status: 'planned', plannedAt: '23' },
  { name: 'facades', status: 'planned', plannedAt: '22' },
  { name: 'edges', status: 'planned', plannedAt: '15' },
  { name: 'drilling', status: 'planned', plannedAt: '28' },
];

const IMPLEMENTED: Readonly<Record<string, GeometryStage>> = {
  normalize: normalizeStage,
  carcass: carcassStage,
};

/**
 * Единственная точка входа геометрии.
 *
 * Функция чистая и детерминированная: не читает часы, не генерирует случайных
 * значений, не обращается к DOM. Одинаковый вход даёт побайтово одинаковый
 * выход, поэтому её можно сравнивать снапшотом и переносить в Web Worker
 * без изменений.
 */
export function buildGeometry(input: GeometryInput): GeometryResult {
  const { width, height, depth } = input.furniture.dimensions;
  const initialBounds = box3(vec3(0, 0, 0), vec3(width, height, depth));
  const ctx = new GeometryContext(input, initialBounds);

  const pending: string[] = [];

  for (const descriptor of PIPELINE) {
    if (descriptor.status === 'planned') {
      pending.push(descriptor.name);
      continue;
    }
    const stage = IMPLEMENTED[descriptor.name];
    if (stage === undefined) {
      pending.push(descriptor.name);
      continue;
    }
    stage.run(ctx);
  }

  return ctx.finish(pending);
}
