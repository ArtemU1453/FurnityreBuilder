import { box3, vec3 } from '../domain/index.js';
import { GeometryContext } from './context.js';
import type { GeometryStage } from './context.js';
import { carcassStage } from './stages/carcass.js';
import { layoutStage } from './stages/layout.js';
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
  // 'dividers' из первоначального плана объединён с 'layout': оба вычисляются
  // из одного resolveSizes() на каждом делении дерева. Обоснование —
  // docs/GEOMETRY_RULES.md §10, история решения — docs/ARCHITECTURE.md §5.2.
  { name: 'layout', status: 'implemented' },
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
  layout: layoutStage,
};

/**
 * Вырожденный габарит для контекста, пока ни один этап ещё не подтвердил
 * пригодность входа. Раньше сюда попадали сырые, непроверенные
 * `furniture.dimensions` — если `carcass` не запускался (например, из-за
 * отрицательной ширины), наружу утекал `bounds` с отрицательным или NaN
 * размером. Теперь `bounds` остаётся нулевым, пока `carcass` не установит
 * его сам, на уже нормализованных данных.
 */
const DEGENERATE_BOUNDS = box3(vec3(0, 0, 0), vec3(0, 0, 0));

/**
 * Единственная точка входа геометрии.
 *
 * Функция чистая и детерминированная: не читает часы, не генерирует случайных
 * значений, не обращается к DOM. Одинаковый вход даёт побайтово одинаковый
 * выход, поэтому её можно сравнивать снапшотом и переносить в Web Worker
 * без изменений.
 *
 * Аварийная остановка. Как только какой-либо этап сообщает об ошибке
 * (`GeometryContext.hasFatalError()`), последующие этапы конвейера не
 * запускаются. Движок не пытается достроить геометрию поверх данных, уже
 * признанных непригодными: результат для недопустимого входа — пустой список
 * деталей и понятная диагностика, а не набор деталей со случайными
 * координатами. См. docs/GEOMETRY_RULES.md, раздел «Аварийная остановка».
 */
export function buildGeometry(input: GeometryInput): GeometryResult {
  const ctx = new GeometryContext(input, DEGENERATE_BOUNDS);

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
    if (ctx.hasFatalError()) continue;
    stage.run(ctx);
  }

  return ctx.finish(pending);
}
