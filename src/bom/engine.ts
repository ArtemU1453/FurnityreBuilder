import { buildGeometry } from '../geometry/index.js';
import { calculateHardware, mergeHardwareBoms } from '../hardware/index.js';
import { calculateCutting, toProductionParts } from '../production/index.js';
import { calculateDrilling } from '../drilling/index.js';
import { hasErrors, issue } from '../domain/index.js';
import type { FurnitureId, Issue, Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { HardwareBOM } from '../hardware/index.js';
import type { ProductionPart } from '../production/index.js';
import type { DrillingParameters } from '../drilling/index.js';
import type { CalculationStatus, ProductionBOM, ProductionCalculationResult } from './types.js';
import { PRODUCTION_BOM_VERSION } from './types.js';
import { buildEdgeSummary, buildPartsBom } from './parts.js';
import { buildCuttingSummary, buildDrillingSummary } from './summaries.js';
import { collectConfirmations } from './confirmations.js';

/**
 * Единый конвейер производственного расчёта (PROMPT 19 §20, §24).
 *
 * ```
 * normalizeProject → calculateGeometry → calculateProductionParts
 *                  → calculateHardware → calculateDrilling → calculateCutting
 *                  → buildProductionBOM → validateProductionResult
 * ```
 *
 * ## Второго конвейера не заводится
 *
 * Каждый шаг — уже существующая функция своего слоя. Здесь не считается
 * заново ничего: геометрия строится ОДИН раз на изделие и передаётся
 * дальше явным параметром, как и производственные детали со спецификацией
 * фурнитуры. До PROMPT 19 расчёт присадки строил их сам — при последовательном
 * вызове всех движков одни и те же детали собирались бы дважды.
 *
 * ## Детерминизм
 *
 * В результате нет ни одного значения, зависящего от времени или
 * случайности: `calculationTimestamp` намеренно отсутствует (§3, §21).
 * Один и тот же проект даёт побайтово одинаковый результат, и именно это
 * позволяет сравнивать спецификации снапшотом.
 */

export interface CalculateProductionOptions {
  /** Технологические параметры присадки. По умолчанию не задан ни один. */
  readonly drillingParameters?: DrillingParameters;
  /** Уже посчитанная геометрия по id изделия: интерфейс передаёт свою. */
  readonly geometry?: ReadonlyMap<FurnitureId, GeometryResult>;
}

function statusOf(errors: readonly Issue[], warnings: readonly Issue[], confirmations: number): CalculationStatus {
  // Порядок проверок — порядок серьёзности. Проект с критической ошибкой
  // не может быть VALID ни при каких обстоятельствах (§19).
  if (errors.length > 0) return 'INVALID';
  if (confirmations > 0) return 'NEEDS_CONFIRMATION';
  return warnings.length > 0 ? 'VALID_WITH_WARNINGS' : 'VALID';
}

export function calculateProduction(project: Project, options: CalculateProductionOptions = {}): ProductionCalculationResult {
  // 1. Геометрия — один раз на изделие.
  const geometryByFurniture = new Map<FurnitureId, GeometryResult>();
  const geometryDiagnostics: Issue[] = [];
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
    geometryByFurniture.set(furniture.id, geometry);
    geometryDiagnostics.push(...geometry.diagnostics);
  }

  // 2. Производственные детали.
  const productionByFurniture = new Map<FurnitureId, readonly ProductionPart[]>();
  const productionParts: ProductionPart[] = [];
  const productionIssues: Issue[] = [];
  for (const [furnitureId, geometry] of geometryByFurniture) {
    if (hasErrors(geometry.diagnostics)) {
      productionByFurniture.set(furnitureId, []);
      continue;
    }
    const result = toProductionParts(geometry, project.materials, project.settings.cutting);
    productionByFurniture.set(furnitureId, result.parts);
    productionParts.push(...result.parts);
    productionIssues.push(...result.warnings, ...result.errors);
  }

  // 3. Фурнитура, 4. присадка, 5. раскрой — каждому передаётся уже
  //    посчитанное, чтобы ни один слой не строил детали второй раз.
  const hardwareByFurniture = new Map<FurnitureId, HardwareBOM>();
  for (const furnitureId of geometryByFurniture.keys()) {
    const geometry = geometryByFurniture.get(furnitureId);
    if (geometry === undefined) continue;
    hardwareByFurniture.set(furnitureId, calculateHardware(project, { geometry: new Map([[furnitureId, geometry]]) }));
  }
  // Спецификация проекта — слияние спецификаций изделий, а не ещё один
  // полный прогон правил: иначе одни и те же правила отработали бы дважды.
  const hardware = mergeHardwareBoms(project, [...hardwareByFurniture.values()]);
  const drilling = calculateDrilling(project, {
    geometry: geometryByFurniture,
    productionParts: productionByFurniture,
    hardware: hardwareByFurniture,
    ...(options.drillingParameters === undefined ? {} : { parameters: options.drillingParameters }),
  });
  const cutting = calculateCutting(project, { geometry: geometryByFurniture });

  // 6. Спецификация.
  const partsBom = buildPartsBom(productionParts, project.materials);
  const confirmations = collectConfirmations();

  const warnings: Issue[] = [
    ...geometryDiagnostics.filter((d) => d.severity !== 'error'),
    ...productionIssues.filter((d) => d.severity !== 'error'),
    ...partsBom.warnings,
    ...hardware.warnings,
    ...drilling.warnings,
    ...cutting.warnings,
  ];
  const errors: Issue[] = [
    ...geometryDiagnostics.filter((d) => d.severity === 'error'),
    ...productionIssues.filter((d) => d.severity === 'error'),
    ...partsBom.errors,
    ...hardware.errors,
    ...drilling.errors,
    ...cutting.errors,
  ];

  // Неразмещённая деталь — ошибка спецификации, а не раскроя: по такой
  // спецификации изделие изготовить нельзя, сколько бы листов ни купили.
  for (const unplaced of cutting.unplaced) {
    errors.push(
      issue(
        'BOM_PART_NOT_PLACED',
        'error',
        `Деталь «${unplaced.productionPartId}» (экземпляр ${String(unplaced.instanceIndex + 1)}) не размещена на листе: ${unplaced.reason}. ${unplaced.detail}`,
      ),
    );
  }

  const bom: ProductionBOM = {
    id: `bom:${String(project.id)}`,
    version: PRODUCTION_BOM_VERSION,
    parts: partsBom.items,
    edgeBanding: buildEdgeSummary(partsBom.items, project.materials),
    hardware,
    drilling: buildDrillingSummary(drilling, productionParts),
    cutting: buildCuttingSummary(cutting, project.materials),
    confirmations,
    warnings,
    errors,
  };

  return {
    bom,
    cutting,
    hardware,
    drilling,
    warnings,
    errors,
    status: statusOf(errors, warnings, confirmations.length),
  };
}
