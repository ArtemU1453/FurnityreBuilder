import { issue, isLeaf, visitNodes } from '../../domain/index.js';
import type { Part, Vec3 } from '../../domain/index.js';
import type { DrillingOperation, DrillingRule, DrillingRuleContext, DrillingRuleResult } from '../types.js';
import { buildOperationId } from '../types.js';
import { toLocal } from '../faces.js';

/**
 * Присадка ручек и push-механизмов (PROMPT 18 §13–§14).
 *
 * ## Откуда берётся положение
 *
 * Из уже построенной ДЕТАЛИ ручки (PROMPT 12): `resolveOpeningSystemGeometry`
 * посчитал её положение на фасаде, и пересчитывать его здесь формулой
 * значило бы завести второй источник положения — он разъедется с первым при
 * следующей правке правил размещения. Правило берёт мировой центр детали
 * ручки и переводит его в координаты грани фасада (`toLocal`).
 *
 * Именно поэтому отверстия «двигаются вместе с ручкой и фасадом» (§13): они
 * не хранят своего положения вовсе, а выводятся из положения ручки при
 * каждом пересчёте.
 *
 * ## Чего не хватает
 *
 * Числа крепёжных отверстий и межцентрового расстояния: они зависят от типа
 * ручки и референсом не подтверждены (`T-HW-08`, `T-DRILL-04`). Правило
 * считает, только если параметры даны.
 */

/**
 * Створка, на которой стоит ручка.
 *
 * Связь берётся ИЗ МОДЕЛИ: способ открывания принадлежит конкретной
 * створке (`FacadeLeaf.opening`) или конкретному ящику (`Drawer.opening`),
 * и его идентификатор входит в идентификатор построенной детали ручки.
 * Соседство деталей здесь ни при чём — §12 запрещает выводить связь из него,
 * и справедливо: у ячейки с двумя створками обе ручки оказались бы на
 * первой, а вторая уехала бы за край фасада.
 */
function leafIdForOpening(ctx: DrillingRuleContext): Map<string, string> {
  const map = new Map<string, string>();
  for (const facade of ctx.furniture.facades) {
    for (const leaf of facade.leaves) {
      if (leaf.opening !== undefined && leaf.opening.kind !== 'none') map.set(leaf.opening.id, leaf.id);
    }
  }
  visitNodes(ctx.furniture.root, (node) => {
    if (!isLeaf(node) || node.fill.kind !== 'drawers') return;
    for (const drawer of node.fill.drawers) {
      // Способ открывания ящика живёт на его ФАСАДЕ, а не на коробе
      // (PROMPT 12): ручка — свойство видимой передней панели.
      const opening = drawer.facade.opening;
      if (opening !== undefined && opening.kind !== 'none') map.set(opening.id, drawer.id);
    }
  });
  return map;
}

function facadeFor(ctx: DrillingRuleContext, handle: Part, leafByOpening: ReadonlyMap<string, string>): Part | undefined {
  const owner = [...leafByOpening.entries()].find(([openingId]) => handle.id.includes(openingId));
  if (owner === undefined) return undefined;
  const leafId = owner[1];
  return ctx.geometry.parts.find((p) => p.role === 'facade' && p.id.includes(leafId));
}

function centerOf(part: Part): Vec3 {
  return {
    x: part.position.x + part.size.x / 2,
    y: part.position.y + part.size.y / 2,
    z: part.position.z + part.size.z / 2,
  };
}

export const handleDrillingRule: DrillingRule = {
  id: 'handle',
  title: 'Присадка ручек',
  status: 'needs-confirmation',
  unknownId: 'T-DRILL-04',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const handles = ctx.geometry.parts.filter((p) => p.role === 'handle');
    if (handles.length === 0) return { operations: [], warnings: [], errors: [] };

    const params = ctx.parameters.handle;
    if (params === undefined) {
      return {
        operations: [],
        warnings: [
          issue(
            'DRILLING_PARAMETERS_NOT_CONFIRMED',
            'warning',
            `Присадка ручек не рассчитана: число крепёжных отверстий и межцентровое расстояние зависят от типа ручки и не подтверждены (T-DRILL-04, T-HW-08). Ручек в изделии: ${String(handles.length)}.`,
          ),
        ],
        errors: [],
      };
    }

    const operations: DrillingOperation[] = [];
    const warnings = [];
    const leafByOpening = leafIdForOpening(ctx);
    for (const handle of handles) {
      const facade = facadeFor(ctx, handle, leafByOpening);
      if (facade === undefined) {
        warnings.push(
          issue('DRILLING_TARGET_NOT_FOUND', 'warning', `Фасад для ручки «${handle.id}» не найден: узел-источник не дал детали фасада.`),
        );
        continue;
      }
      const production = ctx.productionPartOf(facade.id);
      if (production === undefined) continue;

      // Ручка длиннее по той оси, вдоль которой её ставили; крепёж идёт
      // вдоль неё же. Ось определяется размерами уже построенной детали,
      // а не повторным разбором `HandlePlacement`.
      const vertical = handle.size.y >= handle.size.x;
      const center = toLocal(facade, 'top', centerOf(handle));
      const half = params.centerDistance / 2;
      const count = Math.max(1, Math.trunc(params.holesPerHandle));

      for (let i = 0; i < count; i += 1) {
        // При одном отверстии — по центру ручки; при двух — симметрично;
        // при большем числе — равномерно на том же межцентровом отрезке.
        const t = count === 1 ? 0 : -half + (params.centerDistance * i) / (count - 1);
        const x = vertical ? center.x + t : center.x;
        const y = vertical ? center.y : center.y + t;
        operations.push({
          id: buildOperationId('handle', handle.id, i),
          productionPartId: production.id,
          sourcePartId: facade.id,
          ...(handle.origin.nodeId === undefined ? {} : { sourceNodeId: handle.origin.nodeId }),
          purpose: 'handle',
          face: 'top',
          x,
          y,
          diameter: params.diameter,
          depth: facade.cut.thickness,
          through: 'through',
          ruleId: 'handle',
          reason: `крепление ручки «${handle.label}» на фасаде «${facade.label}», отверстие ${String(i + 1)} из ${String(count)}`,
        });
      }
    }
    return { operations, warnings, errors: [] };
  },
};

/**
 * Push-to-open (§14).
 *
 * Задание прямо разрешает не создавать отверстий, если механизм накладной.
 * Какой он — референс не подтвердил (`T-HW-04`, `T-HW-07`): накладной
 * механизм крепится шурупами к боковине, врезной требует гнезда, и это
 * разные присадки. Правило существует, знает свой вход и сообщает, что
 * именно нужно подтвердить, но отверстий не создаёт.
 */
export const pushToOpenDrillingRule: DrillingRule = {
  id: 'push-to-open',
  title: 'Присадка push-механизмов',
  status: 'needs-confirmation',
  unknownId: 'T-HW-07',
  run(ctx: DrillingRuleContext): DrillingRuleResult {
    const mechanisms = ctx.geometry.parts.filter((p) => p.role === 'push-to-open');
    if (mechanisms.length === 0) return { operations: [], warnings: [], errors: [] };
    return {
      operations: [],
      warnings: [
        issue(
          'DRILLING_PARAMETERS_NOT_CONFIRMED',
          'warning',
          `Присадка push-механизмов не рассчитана: способ монтажа (накладной или врезной) референсом не подтверждён (T-HW-07), а от него зависит, нужны ли отверстия вообще. Механизмов в изделии: ${String(mechanisms.length)}.`,
        ),
      ],
      errors: [],
    };
  },
};
