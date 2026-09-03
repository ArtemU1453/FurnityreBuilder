import { issue } from '../../domain/index.js';
import type { Mm, Part } from '../../domain/index.js';
import type { DrillingOperation, DrillingRule, DrillingRuleContext, DrillingRuleResult, HingeDrillingParams } from '../types.js';
import { buildOperationId } from '../types.js';

/**
 * Присадка петель (PROMPT 18 §8).
 *
 * ## Что известно и чего не хватает
 *
 * Известно: какие створки распашные и где они стоят — это уже посчитала
 * геометрия. Не известно НИЧЕГО из того, что нужно для отверстия:
 * диаметр чашки, глубина фрезерования, отступ центра чашки от края
 * створки, положение петель по высоте (`T-DOOR-05` — пороги количества
 * петель тоже не подтверждены) и присадка ответной планки.
 *
 * Поэтому правило реализовано ЦЕЛИКОМ, но считает только тогда, когда ему
 * дали `parameters.hinge`. По умолчанию параметров нет, операций нет и есть
 * предупреждение с точным перечнем недостающих величин. Подставить сюда
 * «обычные» 35 мм значило бы выдать догадку за производственное правило.
 *
 * ## Куда идёт чашка
 *
 * В ВНУТРЕННЮЮ пласть створки — грань `bottom` в локальной системе детали
 * (`docs/DRILLING_RULES.md` §2), потому что петля прячется внутрь корпуса.
 * Ось `x` этой грани идёт вдоль длины створки, то есть по высоте: у фасада
 * (`frontal-xy`) длина — это мировая `y`.
 */

/**
 * Положения петель по высоте створки.
 *
 * Крайние — на `endOffset` от концов, промежуточные равномерно между ними.
 * Это самая распространённая схема, но именно СХЕМА, а не подтверждённое
 * правило: она применяется только вместе с параметрами, которых по
 * умолчанию нет.
 */
export function hingePositions(leafLength: Mm, count: number, endOffset: Mm): Mm[] {
  if (count <= 0) return [];
  if (count === 1) return [leafLength / 2];
  const first = endOffset;
  const last = leafLength - endOffset;
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => first + step * i);
}

/** Деталь створки по идентификатору узла: та же связка, что у расчёта фурнитуры. */
function facadePartFor(ctx: DrillingRuleContext, nodeId: string | undefined): Part | undefined {
  if (nodeId === undefined) return undefined;
  return ctx.geometry.parts.find((p) => p.role === 'facade' && p.id.includes(nodeId));
}

function cupOperations(
  part: Part,
  productionPartId: string,
  hardwareId: string,
  nodeId: string | undefined,
  quantity: number,
  params: HingeDrillingParams,
  leafLength: Mm,
): DrillingOperation[] {
  const operations: DrillingOperation[] = [];
  const positions = hingePositions(leafLength, quantity, params.endOffset);

  positions.forEach((position, index) => {
    const base = {
      productionPartId,
      sourcePartId: part.id,
      sourceHardwareId: hardwareId,
      ...(nodeId === undefined ? {} : { sourceNodeId: nodeId as never }),
      face: 'bottom' as const,
      through: 'blind' as const,
      ruleId: 'hinge',
    };
    operations.push({
      ...base,
      id: buildOperationId('hinge', `${part.id}/cup`, index),
      purpose: 'hinge-cup',
      x: position,
      y: params.cupInset,
      diameter: params.cupDiameter,
      depth: params.cupDepth,
      reason: `чашка петли ${String(index + 1)} из ${String(quantity)} на створке «${part.label}»`,
    });
    // Монтажные отверстия петли — отдельные операции: у них другой
    // диаметр и другая глубина, и на станке это другой инструмент.
    for (const sign of [-1, 1] as const) {
      operations.push({
        ...base,
        id: buildOperationId('hinge', `${part.id}/mount${String(sign)}`, index),
        purpose: 'hinge-plate',
        x: position + sign * params.mountSpacing,
        y: params.cupInset,
        diameter: params.mountDiameter,
        depth: params.mountDepth,
        reason: `крепление петли ${String(index + 1)} на створке «${part.label}»`,
      });
    }
  });

  return operations;
}

export const hingeDrillingRule: DrillingRule = {
  id: 'hinge',
  title: 'Присадка петель',
  status: 'needs-confirmation',
  unknownId: 'T-DRILL-01',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const hinges = ctx.hardware.items.filter((item) => item.kind === 'hinge');
    if (hinges.length === 0) {
      // Позиций петель нет — считать не от чего. Причина уже названа
      // расчётом фурнитуры (T-DOOR-05), повторять её здесь не нужно.
      return { operations: [], warnings: [], errors: [] };
    }

    const params = ctx.parameters.hinge;
    if (params === undefined) {
      return {
        operations: [],
        warnings: [
          issue(
            'DRILLING_PARAMETERS_NOT_CONFIRMED',
            'warning',
            `Присадка петель не рассчитана: не подтверждены диаметр и глубина чашки, отступ чашки от края створки, отступ крайних петель и присадка крепления (T-DRILL-01). Петель в изделии: ${String(hinges.reduce((sum, h) => sum + h.quantity, 0))}.`,
          ),
        ],
        errors: [],
      };
    }

    const operations: DrillingOperation[] = [];
    const warnings = [];
    for (const item of hinges) {
      const part = facadePartFor(ctx, item.sourceNodeId);
      if (part === undefined) {
        warnings.push(
          issue('DRILLING_TARGET_NOT_FOUND', 'warning', `Створка для петли «${item.id}» не найдена среди построенных деталей.`),
        );
        continue;
      }
      const production = ctx.productionPartOf(part.id);
      if (production === undefined) continue;
      operations.push(
        ...cupOperations(part, production.id, item.id, item.sourceNodeId, item.quantity, params, part.cut.length),
      );
    }
    return { operations, warnings, errors: [] };
  },
};
