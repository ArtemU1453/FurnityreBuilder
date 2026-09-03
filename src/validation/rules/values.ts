import type { Issue, Project } from '../../domain/index.js';
import { DIMENSION_LIMITS, isFiniteMm, issue, lteMm } from '../../domain/index.js';
import type { ValidationRule } from '../types.js';

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
      if (cutout === undefined) return;
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
          issue(
            'PLINTH_CUTOUT_INVALID',
            'error',
            'Вырез цоколя не оставляет материала передней царге.',
            { path: `${base}.base.cutout` },
          ),
        );
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
