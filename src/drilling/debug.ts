import { formatMm } from '../domain/index.js';
import type { Part } from '../domain/index.js';
import type { ProductionPart } from '../production/index.js';
import type { DrillingOperation, DrillingPlan } from './types.js';
import { faceFrame, formatDirection, localFrame, operationToWorld } from './faces.js';

/**
 * Технический вывод карты присадки (PROMPT 18 §28).
 *
 * Формат — тот же, что в задании: деталь, грань, отверстия с диаметром и
 * глубиной. Формул здесь нет ни одной: числа приходят готовыми из
 * `calculateDrilling`, мировая точка вычисляется единственной существующей
 * функцией перехода. Это инструмент проверки движка, а не интерфейс
 * пользователя (§33: финальный UI присадки не создаётся).
 */

export interface DrillingDebugInput {
  readonly plan: DrillingPlan;
  readonly partsById: ReadonlyMap<string, Part>;
  readonly productionById: ReadonlyMap<string, ProductionPart>;
}

function operationLine(operation: DrillingOperation, part: Part | undefined): string {
  const kind = operation.through === 'through' ? 'насквозь' : `глубина ${formatMm(operation.depth)}`;
  const world =
    part === undefined
      ? ''
      : (() => {
          const hole = operationToWorld(operation, part);
          return ` · мир (${formatMm(hole.point.x)}, ${formatMm(hole.point.y)}, ${formatMm(hole.point.z)}) ${formatDirection(hole.direction)}`;
        })();
  return `  ● Ø${formatMm(operation.diameter)} · ${kind} · ${operation.purpose} · (${formatMm(operation.x)}, ${formatMm(operation.y)})${world} · ${operation.id}`;
}

export function formatDrillingDebug(input: DrillingDebugInput): readonly string[] {
  const lines: string[] = [];
  const { plan } = input;

  if (plan.operations.length === 0) lines.push('— ни одной операции не рассчитано —');

  for (const [productionPartId, operations] of plan.byProductionPart) {
    const production = input.productionById.get(productionPartId);
    const first = operations[0];
    const part = first === undefined ? undefined : input.partsById.get(first.sourcePartId);
    const size =
      production === undefined ? '' : ` · ${formatMm(production.length)} × ${formatMm(production.width)} × ${formatMm(production.thickness)}`;
    lines.push(`${production?.name ?? productionPartId}${size} · операций: ${String(operations.length)}`);

    let currentFace = '';
    for (const operation of operations) {
      if (operation.face !== currentFace) {
        currentFace = operation.face;
        const frame = part === undefined ? undefined : faceFrame(part, operation.face);
        const extent = frame === undefined ? '' : ` (${formatMm(frame.extentX)} × ${formatMm(frame.extentY)})`;
        lines.push(` ${operation.face.toUpperCase()}${extent}`);
      }
      lines.push(operationLine(operation, part));
    }
  }

  for (const warning of plan.warnings) lines.push(`ПРЕДУПРЕЖДЕНИЕ · ${warning.code} · ${warning.message}`);
  for (const error of plan.errors) lines.push(`ОШИБКА · ${error.code} · ${error.message}`);

  return lines;
}

/** Границы детали в её локальной системе — заголовок карты присадки. */
export function formatPartBounds(part: Part): string {
  const frame = localFrame(part);
  return `${part.label} · ${part.id} · длина ${formatMm(frame.length)} (${frame.lengthAxis}) × ширина ${formatMm(frame.width)} (${frame.widthAxis}) × толщина ${formatMm(frame.thickness)} (${frame.thicknessAxis})`;
}
