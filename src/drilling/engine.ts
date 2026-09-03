import { buildGeometry } from '../geometry/index.js';
import { calculateHardware } from '../hardware/index.js';
import { toProductionParts } from '../production/index.js';
import { issue } from '../domain/index.js';
import type { FurnitureId, Issue, PartId, Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { ProductionPart } from '../production/index.js';
import type { HardwareBOM } from '../hardware/index.js';
import type { DrillingOperation, DrillingParameters, DrillingPlan, DrillingRule } from './types.js';
import { EMPTY_DRILLING_PARAMETERS } from './types.js';
import { validateCollisions, validateOperation } from './validate.js';
import { hingeDrillingRule } from './rules/hinges.js';
import { handleDrillingRule, pushToOpenDrillingRule } from './rules/opening.js';
import { slideDrillingRule } from './rules/slides.js';
import { shelfSupportDrillingRule } from './rules/shelf-supports.js';
import { backWallDrillingRule, carcassFastenerDrillingRule } from './rules/fasteners.js';

/**
 * Движок присадки (PROMPT 18 §21–§27).
 *
 * ## Направление зависимости
 *
 * ```
 * Furniture → Geometry → Physical Parts → Production Parts
 *           → Hardware → Drilling Rules → Drilling Operations
 * ```
 *
 * Стрелки не заворачиваются обратно: присадка читает геометрию, детали и
 * спецификацию фурнитуры, но ничего в них не пишет. Проверено тестом
 * «расчёт не изменяет проект» и архитектурным тестом границ.
 *
 * ## Инвалидация
 *
 * Отдельного механизма нет и не нужно (§26): план присадки не хранится, а
 * пересчитывается из проекта. Любое изменение габарита, материала,
 * толщины, секций, полок, дверей, ящиков, ручек, способа открывания,
 * задней стенки, модификаторов корпуса или конфигурации фурнитуры меняет
 * вход — и вместе с ним результат. Устаревшей присадки не бывает,
 * потому что хранимой присадки не существует.
 */

/** Порядок правил фиксирован: от него зависит порядок предупреждений. */
export const DRILLING_RULES: readonly DrillingRule[] = [
  hingeDrillingRule,
  slideDrillingRule,
  shelfSupportDrillingRule,
  backWallDrillingRule,
  carcassFastenerDrillingRule,
  handleDrillingRule,
  pushToOpenDrillingRule,
];

export interface CalculateDrillingOptions {
  readonly rules?: readonly DrillingRule[];
  /** Технологические параметры. По умолчанию не задан ни один (§34). */
  readonly parameters?: DrillingParameters;
  /** Уже посчитанная геометрия по id изделия: не считать её второй раз. */
  readonly geometry?: ReadonlyMap<FurnitureId, GeometryResult>;
  /**
   * Уже посчитанные производственные детали и спецификация фурнитуры.
   *
   * Нужны единому конвейеру расчёта (PROMPT 19 §20): без них присадка
   * считала бы их заново, и один прогон конвейера строил бы одни и те же
   * детали дважды. Результат от этого не зависит — при отсутствии карт
   * движок считает всё сам, как и раньше.
   */
  readonly productionParts?: ReadonlyMap<FurnitureId, readonly ProductionPart[]>;
  readonly hardware?: ReadonlyMap<FurnitureId, HardwareBOM>;
}

/** Порядок граней в сортировке: сначала пласти, потом торцы (§24). */
const FACE_ORDER: Readonly<Record<string, number>> = {
  top: 0,
  bottom: 1,
  front: 2,
  back: 3,
  left: 4,
  right: 5,
};

/**
 * Детерминированный порядок операций (§23–§24).
 *
 * Деталь → грань → `y` → `x` → тип операции → идентификатор. Именно в
 * таком порядке технолог читает карту присадки: сначала выбирает деталь,
 * потом кладёт её нужной стороной, потом идёт по рядам сверху вниз.
 * Последний ключ — идентификатор: он гарантирует, что порядок не зависит
 * от порядка обхода, даже когда все прочие ключи совпали.
 */
export function compareOperations(a: DrillingOperation, b: DrillingOperation): number {
  const byPart = a.productionPartId.localeCompare(b.productionPartId);
  if (byPart !== 0) return byPart;
  const byFace = (FACE_ORDER[a.face] ?? 9) - (FACE_ORDER[b.face] ?? 9);
  if (byFace !== 0) return byFace;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  const byPurpose = a.purpose.localeCompare(b.purpose);
  if (byPurpose !== 0) return byPurpose;
  return a.id.localeCompare(b.id);
}

export function calculateDrilling(project: Project, options: CalculateDrillingOptions = {}): DrillingPlan {
  const rules = options.rules ?? DRILLING_RULES;
  const parameters = options.parameters ?? EMPTY_DRILLING_PARAMETERS;

  const operations: DrillingOperation[] = [];
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const partsById = new Map<PartId, Parameters<typeof validateOperation>[1]>();
  const productionById = new Map<string, ProductionPart>();

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

    // Та же аварийная остановка, что в геометрии, фурнитуре и раскрое:
    // сверлить детали изделия, которое не удалось построить, не по чему.
    if (geometry.diagnostics.some((d) => d.severity === 'error')) {
      warnings.push(
        issue('DRILLING_SKIPPED_BROKEN_GEOMETRY', 'warning', `Присадка изделия «${furniture.name}» не рассчитана: геометрия содержит ошибки.`),
      );
      continue;
    }

    const productionParts =
      options.productionParts?.get(furniture.id) ??
      toProductionParts(geometry, project.materials, project.settings.cutting).parts;
    const hardware =
      options.hardware?.get(furniture.id) ??
      calculateHardware(project, { geometry: new Map([[furniture.id, geometry]]) });

    // Производственная позиция по физической детали: у позиции количество,
    // и одна и та же деталь принадлежит ровно одной позиции (PROMPT 17 §22).
    const productionByPart = new Map<PartId, ProductionPart>();
    for (const part of productionParts) {
      productionById.set(part.id, part);
      for (const sourceId of part.sourcePartIds) productionByPart.set(sourceId, part);
    }
    for (const part of geometry.parts) partsById.set(part.id, part);

    const ctx = {
      furniture,
      geometry,
      productionParts,
      hardware,
      materials: project.materials,
      parameters,
      productionPartOf: (partId: PartId): ProductionPart | undefined => productionByPart.get(partId),
    };

    for (const rule of rules) {
      const result = rule.run(ctx);
      warnings.push(...result.warnings);
      errors.push(...result.errors);
      operations.push(...result.operations);
    }
  }

  // Проверки (§18–§20). Операция, не прошедшая проверку, ИЗ ПЛАНА НЕ
  // УДАЛЯЕТСЯ: карта присадки с молча выброшенным отверстием опаснее, чем
  // карта с явной ошибкой — по первой деталь просто соберут неправильно.
  for (const operation of operations) {
    const part = partsById.get(operation.sourcePartId);
    const production = productionById.get(operation.productionPartId);
    for (const problem of validateOperation(operation, part, production)) {
      (problem.severity === 'error' ? errors : warnings).push(problem);
    }
  }
  for (const problem of validateCollisions(operations)) {
    (problem.severity === 'error' ? errors : warnings).push(problem);
  }

  operations.sort(compareOperations);

  const byProductionPart = new Map<string, DrillingOperation[]>();
  for (const operation of operations) {
    const bucket = byProductionPart.get(operation.productionPartId);
    if (bucket === undefined) byProductionPart.set(operation.productionPartId, [operation]);
    else bucket.push(operation);
  }

  return { operations, byProductionPart, warnings, errors };
}
