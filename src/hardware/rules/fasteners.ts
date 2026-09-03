import { issue } from '../../domain/index.js';
import type { Mm, Part } from '../../domain/index.js';
import type { HardwareRule, HardwareRuleContext, HardwareRuleResult } from '../types.js';
import { HW_BACK_FASTENER, HW_CARCASS_FASTENER } from '../registry.js';

/**
 * Крепёж задней стенки и корпуса (PROMPT 16 §10–11).
 *
 * Оба правила знают СВОЙ ВХОД полностью и обе не могут дать количество:
 * не хватает ровно одной величины в каждом, и обе прямо помечены
 * неизвестными в реестре. Задание запрещает их придумывать («Не
 * придумывать расстояние между креплениями», §10; «только там, где
 * конструктивное правило подтверждено», §11), поэтому правила сообщают,
 * чего не хватает, и показывают уже посчитанный вход — периметр стенки и
 * список стыков корпуса. Когда величина появится, менять придётся
 * константу, а не алгоритм.
 */

/** Шаг крепления задней стенки по периметру. `UNKNOWN (T-HW-03)`. */
export interface BackWallFastenerSpacing {
  readonly stepMm: Mm;
}

/** Не задан намеренно: расстояние между креплениями не подтверждено. */
export const BACK_WALL_FASTENER_SPACING: BackWallFastenerSpacing | undefined = undefined;

/**
 * Читает константу, не давая TS сузить её до `undefined`: сужение убило бы
 * ветку расчёта вместе с проверкой типов внутри неё, а она должна остаться
 * рабочей к моменту, когда шаг подтвердят.
 */
function resolveBackWallSpacing(): BackWallFastenerSpacing | undefined {
  return BACK_WALL_FASTENER_SPACING;
}

/** Периметр детали задней стенки — вход правила, уже посчитанный движком. */
function perimeterOf(part: Part): Mm {
  return 2 * (part.size.x + part.size.y);
}

export const backWallFastenerRule: HardwareRule = {
  id: 'back-wall-fastener',
  title: 'Крепёж задней стенки',
  status: 'needs-confirmation',
  unknownId: 'T-HW-03',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const panels = ctx.geometry.parts.filter((p) => p.role === 'back');
    if (panels.length === 0) return { items: [], warnings: [], errors: [] };

    const spacing = resolveBackWallSpacing();
    if (spacing !== undefined) {
      // Ветка на будущее: как только шаг подтверждён, количество считается
      // из уже известного периметра без правки алгоритма.
      const items = panels.map((part) => {
        const quantity = Math.max(1, Math.ceil(perimeterOf(part) / spacing.stepMm));
        return {
          id: `hw:back-wall-fastener/${part.id}/${String(HW_BACK_FASTENER)}`,
          definitionId: HW_BACK_FASTENER,
          kind: 'back-nail' as const,
          unit: 'pcs' as const,
          quantity,
          sourcePartId: part.id,
          ruleId: 'back-wall-fastener',
          reason: `крепёж по периметру ${String(perimeterOf(part))} мм с шагом ${String(spacing.stepMm)} мм`,
        };
      });
      return { items, warnings: [], errors: [] };
    }

    const totalPerimeter = panels.reduce((acc, p) => acc + perimeterOf(p), 0);
    const mount = ctx.furniture.carcass.back.mount.kind;
    return {
      items: [],
      warnings: [
        issue(
          'HARDWARE_RULE_NEEDS_CONFIRMATION',
          'warning',
          `Крепёж задней стенки не рассчитан: расстояние между креплениями референсом не подтверждено (T-HW-03). Сегментов стенки: ${String(panels.length)}, суммарный периметр: ${String(totalPerimeter)} мм, монтаж: «${mount}». Позиция «${String(HW_BACK_FASTENER)}» ждёт шага крепления.`,
        ),
      ],
      errors: [],
    };
  },
};

/**
 * Стык двух корпусных деталей — вход правила крепежа корпуса.
 *
 * Считается по уже построенным деталям: горизонталь стыкуется с каждой
 * вертикалью, которой касается. Сам список стыков геометрия знает точно,
 * а вот сколько крепежа на стык — нет (`T-HW-03`: «Правило количества
 * крепежа на корпусный стык: не задано»).
 */
export interface CarcassJoint {
  readonly a: Part;
  readonly b: Part;
}

const VERTICAL_ROLES = new Set(['side', 'partition']);
const HORIZONTAL_ROLES = new Set(['top', 'bottom', 'shelf-fixed']);

/** Касаются ли детали по X с точностью до половины миллиметра. */
function touchesAlongX(vertical: Part, horizontal: Part): boolean {
  const vx0 = vertical.position.x;
  const vx1 = vertical.position.x + vertical.size.x;
  const hx0 = horizontal.position.x;
  const hx1 = horizontal.position.x + horizontal.size.x;
  const overlap = Math.min(vx1, hx1) - Math.max(vx0, hx0);
  const adjacent = Math.abs(hx0 - vx1) < 0.5 || Math.abs(vx0 - hx1) < 0.5;
  return overlap > 0.5 || adjacent;
}

/** Пересекаются ли детали по Y — то есть встречаются ли они по высоте. */
function meetsAlongY(vertical: Part, horizontal: Part): boolean {
  const vy0 = vertical.position.y;
  const vy1 = vertical.position.y + vertical.size.y;
  const hy0 = horizontal.position.y;
  const hy1 = horizontal.position.y + horizontal.size.y;
  return hy1 > vy0 - 0.5 && hy0 < vy1 + 0.5;
}

/** Все стыки «вертикаль — горизонталь» корпуса. */
export function findCarcassJoints(parts: readonly Part[]): CarcassJoint[] {
  const verticals = parts.filter((p) => VERTICAL_ROLES.has(p.role));
  const horizontals = parts.filter((p) => HORIZONTAL_ROLES.has(p.role));
  const joints: CarcassJoint[] = [];
  for (const v of verticals) {
    for (const h of horizontals) {
      if (touchesAlongX(v, h) && meetsAlongY(v, h)) joints.push({ a: v, b: h });
    }
  }
  return joints;
}

/** Количество крепежа на один стык. `UNKNOWN (T-HW-03)`. */
export const CARCASS_FASTENERS_PER_JOINT: number | undefined = undefined;

/** См. `resolveBackWallSpacing`: чтение без сужения типа. */
function resolveFastenersPerJoint(): number | undefined {
  return CARCASS_FASTENERS_PER_JOINT;
}

export const carcassFastenerRule: HardwareRule = {
  id: 'carcass-fastener',
  title: 'Крепёж корпуса',
  status: 'needs-confirmation',
  unknownId: 'T-HW-03',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const joints = findCarcassJoints(ctx.geometry.parts);
    if (joints.length === 0) return { items: [], warnings: [], errors: [] };

    const perJoint = resolveFastenersPerJoint();
    if (perJoint !== undefined) {
      const items = joints.map((joint) => ({
        id: `hw:carcass-fastener/${joint.a.id}+${joint.b.id}/${String(HW_CARCASS_FASTENER)}`,
        definitionId: HW_CARCASS_FASTENER,
        kind: 'confirmat' as const,
        unit: 'pcs' as const,
        quantity: perJoint,
        sourcePartId: joint.b.id,
        ruleId: 'carcass-fastener',
        reason: `${String(perJoint)} крепежа на стык «${joint.a.label}» — «${joint.b.label}»`,
      }));
      return { items, warnings: [], errors: [] };
    }

    return {
      items: [],
      warnings: [
        issue(
          'HARDWARE_RULE_NEEDS_CONFIRMATION',
          'warning',
          `Крепёж корпуса не рассчитан: количество крепежа на стык референсом не подтверждено (T-HW-03). Стыков «вертикаль — горизонталь» найдено: ${String(joints.length)}. Позиция «${String(HW_CARCASS_FASTENER)}» ждёт правила на стык.`,
        ),
      ],
      errors: [],
    };
  },
};
