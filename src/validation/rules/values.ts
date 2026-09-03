import type { Issue, Project } from '../../domain/index.js';
import { DIMENSION_LIMITS, isFiniteMm, issue, lteMm } from '../../domain/index.js';
import type { ValidationRule } from '../types.js';

/** Высота цоколя, участвующая в вертикальном бюджете (PROMPT 15 §6). */
function plinthHeightOf(f: Project['furniture'][number]): number | undefined {
  const base = f.carcass.base;
  if (base === undefined || base.kind === 'none' || !(base.height > 0)) return undefined;
  return base.height;
}

/**
 * Числовая пригодность модели.
 *
 * NaN и Infinity ловятся здесь, а не «где-нибудь потом»: попав в деталировку,
 * они доедут до PDF и до цеха. Отрицательный или нулевой размер — ошибка
 * того же класса.
 */
export const valuesRule: ValidationRule = {
  code: 'VALUES',
  run(project: Project): Issue[] {
    const issues: Issue[] = [];

    project.furniture.forEach((f, fi) => {
      const dims = [
        ['width', f.dimensions.width, DIMENSION_LIMITS.width],
        ['height', f.dimensions.height, DIMENSION_LIMITS.height],
        ['depth', f.dimensions.depth, DIMENSION_LIMITS.depth],
        ['panelThickness', f.dimensions.panelThickness, DIMENSION_LIMITS.panelThickness],
      ] as const;

      for (const [name, value, limit] of dims) {
        const path = `furniture.${String(fi)}.dimensions.${name}`;

        if (typeof value !== 'number' || Number.isNaN(value)) {
          issues.push(
            issue('VALUE_NAN', 'error', `Габарит «${name}» не является числом.`, { path }),
          );
          continue;
        }
        if (!Number.isFinite(value)) {
          issues.push(
            issue('VALUE_NOT_FINITE', 'error', `Габарит «${name}» бесконечен.`, { path }),
          );
          continue;
        }
        if (lteMm(value, 0)) {
          issues.push(
            issue('VALUE_NOT_POSITIVE', 'error', `Габарит «${name}» должен быть больше нуля.`, {
              path,
            }),
          );
          continue;
        }
        if (value < limit.min || value > limit.max) {
          // ASSUMPTION(T-DIM-01): границы референса не установлены.
          // Мягкое предупреждение, а не запрет: пользователь сохраняет управление.
          issues.push(
            issue(
              'VALUE_OUT_OF_RECOMMENDED_RANGE',
              'warning',
              `Габарит «${name}» = ${String(value)} мм вне рекомендуемого диапазона ${String(limit.min)}–${String(limit.max)} мм.`,
              { path },
            ),
          );
        }
      }
    });

    // Задняя стенка и цоколь (PROMPT 14 §19). Оба параметра прямо участвуют
    // в положении корпуса: толщина стенки вычитается из глубины, высота
    // цоколя поднимает корпус — недопустимое значение здесь превращается в
    // деталь нулевого или отрицательного объёма при первом же пересчёте.
    project.furniture.forEach((f, fi) => {
      const base = `furniture.${String(fi)}.carcass`;
      const mount = f.carcass.back.mount;

      if (mount.kind !== 'none' && (!isFiniteMm(mount.thickness) || lteMm(mount.thickness, 0))) {
        issues.push(
          issue('BACK_PANEL_THICKNESS_INVALID', 'error', 'Толщина задней стенки должна быть больше нуля.', {
            path: `${base}.back.mount.thickness`,
          }),
        );
      }

      // ── Конструктивные модификаторы (PROMPT 15 §14) ────────────────────
      const { overhang, topSection, ceilingGap, countertop, falsePanels } = f.carcass;

      if (overhang !== undefined) {
        const sides = [
          ['front', overhang.front],
          ['back', overhang.back],
          ['left', overhang.left],
          ['right', overhang.right],
        ] as const;
        for (const [side, value] of sides) {
          if (!isFiniteMm(value) || value < 0) {
            issues.push(
              issue('OVERHANG_INVALID', 'error', `Свес «${side}» не может быть отрицательным.`, {
                path: `${base}.overhang.${side}`,
              }),
            );
          }
        }
        if (overhang.appliesTo.length === 0) {
          // Не ошибка: свес задан, но ни к чему не применён — это ровно то
          // состояние, в котором он не влияет ни на одну деталь (T-MOD-01).
          issues.push(
            issue('OVERHANG_NOT_APPLIED', 'info', 'Свес задан, но не применён ни к одной детали.', {
              path: `${base}.overhang.appliesTo`,
            }),
          );
        }
      }

      if (topSection !== undefined) {
        if (!isFiniteMm(topSection.height) || lteMm(topSection.height, 0)) {
          issues.push(
            issue('TOP_SECTION_HEIGHT_INVALID', 'error', 'Высота верхней секции должна быть больше нуля.', {
              path: `${base}.topSection.height`,
            }),
          );
        }
        if (!isFiniteMm(topSection.gap) || topSection.gap < 0) {
          issues.push(
            issue('TOP_SECTION_GAP_INVALID', 'error', 'Зазор до верхней секции не может быть отрицательным.', {
              path: `${base}.topSection.gap`,
            }),
          );
        }
      }

      if (ceilingGap !== undefined && (!isFiniteMm(ceilingGap) || ceilingGap < 0)) {
        issues.push(
          issue('CEILING_GAP_INVALID', 'error', 'Зазор до потолка не может быть отрицательным.', {
            path: `${base}.ceilingGap`,
          }),
        );
      }

      if (countertop !== undefined && (!isFiniteMm(countertop.thickness) || lteMm(countertop.thickness, 0))) {
        issues.push(
          issue('COUNTERTOP_THICKNESS_INVALID', 'error', 'Толщина столешницы должна быть больше нуля.', {
            path: `${base}.countertop.thickness`,
          }),
        );
      }

      // Вертикальный бюджет: сумма полос не должна съедать основной корпус
      // целиком (§14 «невозможная комбинация высот»). То же число, что
      // считает движок (`resolveVerticalLayout`), но здесь оно проверяется
      // ДО расчёта, чтобы пользователь увидел причину, а не пустую схему.
      const consumed =
        (plinthHeightOf(f) ?? 0) +
        (countertop?.thickness ?? 0) +
        (topSection === undefined ? 0 : topSection.height + Math.max(topSection.gap, 0)) +
        (ceilingGap ?? 0);
      if (consumed > 0 && consumed >= f.dimensions.height) {
        issues.push(
          issue(
            'VERTICAL_BUDGET_EXCEEDED',
            'error',
            'Цоколь, столешница, верхняя секция и зазор до потолка в сумме не оставляют высоты основному корпусу.',
            { path: `${base}.dimensions.height` },
          ),
        );
      }

      for (const panel of falsePanels ?? []) {
        for (const [field, value] of [
          ['width', panel.width],
          ['height', panel.height],
          ['depth', panel.depth],
          ['thickness', panel.thickness],
        ] as const) {
          if (value !== undefined && (!isFiniteMm(value) || lteMm(value, 0))) {
            issues.push(
              issue('FALSE_PANEL_SIZE_INVALID', 'error', `Размер «${field}» фальшпанели должен быть больше нуля.`, {
                path: `${base}.falsePanels`,
              }),
            );
          }
        }
        if (panel.offset !== undefined && (!isFiniteMm(panel.offset) || panel.offset < 0)) {
          issues.push(
            issue('FALSE_PANEL_SIZE_INVALID', 'error', 'Отступ фальшпанели не может быть отрицательным.', {
              path: `${base}.falsePanels`,
            }),
          );
        }
      }

      // Цоколь под настенным или подвесным изделием физически не на что
      // опереть. Предупреждение, а не запрет: сочетание не подтверждено
      // (T-MOD-04), и пользователь может знать о своей конструкции больше.
      if (
        f.carcass.wallMount !== undefined &&
        f.carcass.wallMount.mode !== 'floor-standing' &&
        f.carcass.base !== undefined &&
        f.carcass.base.kind === 'plinth' &&
        f.carcass.base.height > 0
      ) {
        issues.push(
          issue(
            'WALL_MOUNT_WITH_PLINTH',
            'warning',
            'У настенного или подвесного изделия задан цоколь: проверьте, нужен ли он.',
            { path: `${base}.wallMount.mode` },
          ),
        );
      }

      const plinth = f.carcass.base;
      if (plinth === undefined) return;

      if (!isFiniteMm(plinth.height) || plinth.height < 0) {
        issues.push(
          issue('PLINTH_HEIGHT_INVALID', 'error', 'Высота цоколя не может быть отрицательной.', {
            path: `${base}.base.height`,
          }),
        );
      }
      if (!isFiniteMm(plinth.setback) || plinth.setback < 0) {
        issues.push(
          issue('PLINTH_SETBACK_INVALID', 'error', 'Отступ цоколя не может быть отрицательным.', {
            path: `${base}.base.setback`,
          }),
        );
      }
      if (plinth.kind === 'plinth' && plinth.height > 0 && plinth.height >= f.dimensions.height) {
        issues.push(
          issue(
            'PLINTH_HEIGHT_EXCEEDS_CARCASS',
            'error',
            'Цоколь выше самого изделия: корпусу не остаётся высоты.',
            { path: `${base}.base.height` },
          ),
        );
      }

      const cutout = plinth.cutout;
      if (cutout !== undefined) {
        if (cutout.left < 0 || cutout.right < 0 || !(cutout.height > 0)) {
          issues.push(
            issue('PLINTH_CUTOUT_INVALID', 'error', 'Параметры выреза цоколя недопустимы.', {
              path: `${base}.base.cutout`,
            }),
          );
        }
        if (cutout.height > plinth.height) {
          issues.push(
            issue('PLINTH_CUTOUT_INVALID', 'error', 'Вырез цоколя выше самого цоколя.', {
              path: `${base}.base.cutout.height`,
            }),
          );
        }
        if (cutout.left + cutout.right >= f.dimensions.width) {
          issues.push(
            issue('PLINTH_CUTOUT_INVALID', 'error', 'Вырез цоколя не оставляет материала передней царге.', {
              path: `${base}.base.cutout`,
            }),
          );
        }
      }
    });

    for (const [id, material] of Object.entries(project.materials.items)) {
      if (!isFiniteMm(material.thickness) || lteMm(material.thickness, 0)) {
        issues.push(
          issue(
            'MATERIAL_THICKNESS_INVALID',
            'error',
            `Материал «${material.name}» имеет недопустимую толщину.`,
            { path: `materials.items.${id}.thickness` },
          ),
        );
      }
    }

    return issues;
  },
};
