import { buildGeometry } from '../geometry/index.js';
import { issue } from '../domain/index.js';
import type { FurnitureId, Issue, Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { CuttingGroup, CuttingLayout, CuttingResult, ProductionPart, UnplacedPart } from './types.js';
import { toProductionParts } from './parts.js';
import { groupForCutting } from './grouping.js';
import { resolveStock } from './stock.js';
import { layoutGroup } from './layout.js';
import { validateLayout, validateProductionPart, validateStock } from './validate.js';

/**
 * Расчёт раскроя (PROMPT 17 §14, §25, §29).
 *
 * ## Направление зависимости
 *
 * ```
 * Furniture → Geometry → Physical Parts → Production Parts
 *           → Material Groups → Cutting Stock → Cutting Layout
 * ```
 *
 * Стрелки не заворачиваются обратно (§25): раскрой читает геометрию и
 * настройки, но ничего в них не пишет. Проверяется тестом «расчёт не
 * изменяет проект»: карта раскроя, меняющая размер детали, — это карта,
 * по которой распилят не тот шкаф.
 *
 * ## Инвалидация
 *
 * Отдельного механизма инвалидации нет и не нужно (§29): раскрой —
 * производная величина, он не хранится, а пересчитывается из проекта.
 * Изменение габарита, материала, толщины, секций, полок, дверей, ящиков,
 * задней стенки, цоколя, столешницы, свесов, антресоли или фальшпанелей
 * меняет геометрию, а вместе с ней и раскрой. Хранимый раскрой пришлось бы
 * помечать устаревшим — а несуществующему устареть нечем.
 */

export interface CalculateCuttingOptions {
  /** Уже посчитанная геометрия по id изделия: не считать её второй раз. */
  readonly geometry?: ReadonlyMap<FurnitureId, GeometryResult>;
}

export function calculateCutting(project: Project, options: CalculateCuttingOptions = {}): CuttingResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const productionParts: ProductionPart[] = [];
  const knownPartIds = new Set<string>();

  for (const furniture of project.furniture) {
    const geometry =
      options.geometry?.get(furniture.id) ??
      buildGeometry({
        furniture,
        scheme: project.settings.construction,
        tolerances: project.settings.tolerances,
        materials: project.materials,
        edgeSizing: project.settings.edgeSizing,
      });

    // Та же аварийная остановка, что в геометрии и в расчёте фурнитуры:
    // раскраивать детали изделия, которое не удалось построить, значит
    // пилить лист по размерам, не соответствующим ничему.
    if (geometry.diagnostics.some((d) => d.severity === 'error')) {
      warnings.push(
        issue(
          'CUTTING_SKIPPED_BROKEN_GEOMETRY',
          'warning',
          `Раскрой изделия «${furniture.name}» не рассчитан: геометрия содержит ошибки.`,
        ),
      );
      continue;
    }

    for (const part of geometry.parts) knownPartIds.add(part.id);
    const result = toProductionParts(geometry, project.materials, project.settings.cutting);
    warnings.push(...result.warnings);
    errors.push(...result.errors);
    productionParts.push(...result.parts);
  }

  for (const part of productionParts) {
    errors.push(...validateProductionPart(part, project.materials, knownPartIds));
  }

  const groups: readonly CuttingGroup[] = groupForCutting(productionParts, project.materials);
  const layouts: CuttingLayout[] = [];
  const unplaced: UnplacedPart[] = [];
  const partsById = new Map(productionParts.map((p) => [p.id, p]));

  for (const group of groups) {
    const material = project.materials.items[group.materialId];
    const resolved = resolveStock(group, material, project.settings.cutting);
    if (resolved.stock === undefined) {
      if (resolved.warning !== undefined) {
        (resolved.warning.severity === 'error' ? errors : warnings).push(resolved.warning);
      }
      // Деталь не исчезает молча (§20): без листа каждый её экземпляр
      // попадает в unplaced с причиной, а не пропадает из спецификации.
      for (const part of group.parts) {
        for (let i = 0; i < part.quantity; i += 1) {
          const sourcePartId = part.sourcePartIds[i];
          if (sourcePartId === undefined) continue;
          unplaced.push({
            productionPartId: part.id,
            instanceIndex: i,
            sourcePartId,
            reason: 'INVALID_STOCK',
            detail: `Для материала «${group.materialName}» не определён формат листа.`,
          });
        }
      }
      continue;
    }

    const stockIssues = validateStock(resolved.stock);
    if (stockIssues.length > 0) {
      errors.push(...stockIssues);
      for (const part of group.parts) {
        for (let i = 0; i < part.quantity; i += 1) {
          const sourcePartId = part.sourcePartIds[i];
          if (sourcePartId === undefined) continue;
          unplaced.push({
            productionPartId: part.id,
            instanceIndex: i,
            sourcePartId,
            reason: 'INVALID_STOCK',
            detail: stockIssues[0]?.message ?? 'Лист непригоден для раскроя.',
          });
        }
      }
      continue;
    }

    const result = layoutGroup(resolved.stock, group.parts);
    layouts.push(...result.layouts);
    unplaced.push(...result.unplaced);
  }

  for (const layout of layouts) {
    errors.push(...validateLayout(layout, partsById));
    warnings.push(...layout.warnings);
  }

  return { productionParts, groups, layouts, unplaced, warnings, errors };
}
