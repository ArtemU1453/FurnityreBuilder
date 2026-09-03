import type { CountertopSpec, FalsePanel, Mm, NodeId, OverhangSpec } from '../domain/index.js';
import { roundMm } from '../domain/index.js';

/**
 * Конструктивные модификаторы, дающие собственные детали: столешница и
 * фальшпанели (PROMPT 15 §7, §9).
 *
 * ## Почему здесь нет ни свеса, ни антресоли, ни зазора до потолка
 *
 * Свес расширяет уже существующие детали (крышку, дно, столешницу) и живёт
 * там, где эти детали строятся; антресоль — вторая оболочка того же
 * каркаса (`buildShell`, `stages/carcass.ts`); зазор до потолка и высота
 * антресоли — полосы вертикального бюджета (`resolveVerticalLayout`).
 * Собственных деталей ни один из них не создаёт, поэтому и резолвера у них
 * нет: заводить его «для симметрии» значило бы завести вторую геометрию
 * для того, что уже посчитано.
 *
 * ## Почему нет типа StructuralModifier
 *
 * Каждый модификатор уже типизирован своим полем `CarcassSpec`
 * (`docs/DATA_MODEL.md` §8.1). Список `{id, type, config}` рядом с ними
 * означал бы два описания одного и того же и потерю типизации: `config`
 * пришлось бы делать нетипизированным.
 */

export type ModifierStatus = 'none' | 'built' | 'invalid';

export interface CountertopGeometry {
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly depth: Mm;
}

export interface CountertopResolution {
  readonly status: ModifierStatus;
  readonly countertop?: CountertopGeometry;
  readonly missing?: string;
}

export interface CarcassFrame {
  readonly width: Mm;
  /** Полоса корпуса по Z (из `resolveBackGeometry`). */
  readonly z0: Mm;
  readonly depth: Mm;
  /** Низ и верх изделия по Y (из `resolveVerticalLayout`). */
  readonly y0: Mm;
  readonly totalTop: Mm;
}

/**
 * Столешница: плита поверх основного корпуса.
 *
 * Свесы у неё СВОИ (`CountertopSpec.overhang*`, поля существуют с PROMPT 1)
 * — общий `OverhangSpec` корпуса применяется к ней дополнительно и только
 * если она названа в `appliesTo`. Складываются они, а не заменяют друг
 * друга: свес корпуса — про то, насколько плита выступает за корпус,
 * собственные свесы столешницы — про то же самое, но заданное на ней
 * самой. `ASSUMPTION(T-MOD-01)`, `ASSUMPTION(T-CAR-06)`.
 *
 * Формулы — `docs/GEOMETRY_RULES.md` §24.
 */
export function resolveCountertopGeometry(
  countertop: CountertopSpec | undefined,
  frame: CarcassFrame,
  /** Низ столешницы: верх основного корпуса (`resolveVerticalLayout`). */
  countertopY0: Mm,
  extraOverhang: OverhangSpec | undefined,
): CountertopResolution {
  if (countertop === undefined || !(countertop.thickness > 0)) return { status: 'none' };

  const left = roundMm(countertop.overhangLeft + (extraOverhang?.left ?? 0));
  const right = roundMm(countertop.overhangRight + (extraOverhang?.right ?? 0));
  const front = roundMm(countertop.overhangFront + (extraOverhang?.front ?? 0));
  const back = roundMm(countertop.overhangBack + (extraOverhang?.back ?? 0));

  if (left < 0 || right < 0 || front < 0 || back < 0) {
    return { status: 'invalid', missing: 'свес столешницы отрицателен' };
  }

  const x = roundMm(-left);
  const z = roundMm(frame.z0 - back);
  if (x < 0 || z < 0) {
    return {
      status: 'invalid',
      missing: 'свес столешницы выводит её за начало координат: уменьшите свес слева или сзади',
    };
  }

  const width = roundMm(frame.width + left + right);
  const depth = roundMm(frame.depth + back + front);
  if (!(width > 0) || !(depth > 0)) {
    return { status: 'invalid', missing: 'размер столешницы не положителен' };
  }

  return {
    status: 'built',
    countertop: { x, y: roundMm(countertopY0), z, width, height: roundMm(countertop.thickness), depth },
  };
}

export interface FalsePanelGeometry {
  readonly panelId: NodeId;
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly depth: Mm;
}

export interface FalsePanelResolution {
  readonly status: ModifierStatus;
  readonly panels: readonly FalsePanelGeometry[];
  readonly missing?: string;
}

/**
 * Фальшпанели: плиты, закрывающие зазор между корпусом и стеной или
 * потолком (PROMPT 15 §9).
 *
 * Панель — физическая деталь роли `filler` (роль существовала в `PartRole`
 * с PROMPT 1 и ждала именно этого), а не декорация рендерера. Собственных
 * мировых координат она не хранит: положение выводится из `position` и
 * рамки корпуса, размеры — из своих полей, если заданы, иначе из той же
 * рамки. `ASSUMPTION(T-MOD-05)`.
 *
 * Формулы — `docs/GEOMETRY_RULES.md` §25.
 */
export function resolveFalsePanelGeometry(
  panels: readonly FalsePanel[],
  frame: CarcassFrame,
  defaultThicknessOf: (panel: FalsePanel) => Mm,
): FalsePanelResolution {
  if (panels.length === 0) return { status: 'none', panels: [] };

  const carcassHeight = roundMm(frame.totalTop - frame.y0);
  const built: FalsePanelGeometry[] = [];

  for (const panel of panels) {
    const t = roundMm(defaultThicknessOf(panel));
    const offset = roundMm(panel.offset ?? 0);
    if (!(t > 0)) return { status: 'invalid', panels: [], missing: 'толщина фальшпанели не положительна' };
    if (offset < 0) return { status: 'invalid', panels: [], missing: 'отступ фальшпанели отрицателен' };

    const depth = roundMm(panel.depth ?? frame.depth);
    if (!(depth > 0)) return { status: 'invalid', panels: [], missing: 'глубина фальшпанели не положительна' };

    let geometry: FalsePanelGeometry;
    switch (panel.position) {
      case 'left':
      case 'right': {
        // Вертикальная панель сбоку от корпуса: толщина по X, высота по Y.
        const height = roundMm(panel.height ?? carcassHeight);
        const x =
          panel.position === 'left'
            ? roundMm(-t - offset)
            : roundMm(frame.width + offset);
        if (x < 0) {
          return {
            status: 'invalid',
            panels: [],
            missing: 'левая фальшпанель выходит за начало координат: она стоит снаружи корпуса',
          };
        }
        if (!(height > 0)) return { status: 'invalid', panels: [], missing: 'высота фальшпанели не положительна' };
        geometry = { panelId: panel.id, x, y: frame.y0, z: frame.z0, width: t, height, depth };
        break;
      }
      case 'top':
      case 'bottom': {
        // Горизонтальная панель над корпусом или под ним: толщина по Y.
        const width = roundMm(panel.width ?? frame.width);
        const y =
          panel.position === 'top' ? roundMm(frame.totalTop + offset) : roundMm(frame.y0 - t - offset);
        if (y < 0) {
          return {
            status: 'invalid',
            panels: [],
            missing: 'нижняя фальшпанель выходит за пол: уменьшите отступ или толщину',
          };
        }
        if (!(width > 0)) return { status: 'invalid', panels: [], missing: 'ширина фальшпанели не положительна' };
        geometry = { panelId: panel.id, x: 0, y, z: frame.z0, width, height: t, depth };
        break;
      }
    }
    built.push(geometry);
  }

  return { status: 'built', panels: built };
}
