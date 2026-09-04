import { calculateProduction } from '../bom/index.js';
import { buildProductionExportData } from '../export/index.js';
import type { Project } from '../domain/index.js';
import type { ProductionCalculationResult } from '../bom/index.js';
import type { ProductionPackage } from './types.js';
import { fingerprintOf, matchesProject } from './fingerprint.js';
import { validateProductionReadiness } from './readiness.js';

/**
 * Производственный пакет (PROMPT 21 §8–§10).
 *
 * ## Композиция, а не копия
 *
 * Пакет складывает уже посчитанное: результат расчёта, проверку
 * готовности и данные документов. Ни одна большая структура не
 * дублируется — `bom`, `cutting`, `drilling` и `hardware` доступны через
 * `calculation`, и второго BOM не появляется (§9).
 *
 * ## Один прогон конвейера
 *
 * Расчёт выполняется РОВНО ОДИН раз и передаётся и в проверку
 * готовности, и в подготовку документов. Иначе сборка пакета трижды
 * прогоняла бы одни и те же правила и могла бы, при неудачном стечении,
 * собрать пакет из трёх разных расчётов.
 */

export interface BuildPackageOptions {
  /**
   * Момент генерации документов. Передаётся снаружи: пакет обязан быть
   * воспроизводимым, а функция — чистой (§10).
   */
  readonly generatedAt: string;
  /** Уже посчитанный результат, если вызывающая сторона его имеет. */
  readonly calculation?: ProductionCalculationResult;
}

export function buildProductionPackage(project: Project, options: BuildPackageOptions): ProductionPackage {
  const calculation = options.calculation ?? calculateProduction(project);
  const readiness = validateProductionReadiness(project, { calculation });
  const exports = buildProductionExportData(project, calculation, { generatedAt: options.generatedAt });

  return {
    projectId: project.id,
    projectName: project.name,
    fingerprint: fingerprintOf(project),
    calculation,
    readiness,
    exports,
    status: readiness.status,
    warnings: readiness.warnings,
    errors: readiness.errors,
  };
}

/**
 * Описывает ли пакет текущее состояние проекта (§10).
 *
 * Устаревший пакет — это распечатка, по которой соберут не тот шкаф.
 * Поэтому вопрос задаётся явно и отвечается точно: сравнением отпечатка
 * входа, а не доверием к тому, что «мы бы заметили изменение».
 */
export function isPackageCurrent(productionPackage: ProductionPackage, project: Project): boolean {
  return matchesProject(productionPackage.fingerprint, project);
}
