import { calculateProduction } from '../bom/index.js';
import { buildProductionExportData } from '../export/index.js';
import { hasErrors, issue } from '../domain/index.js';
import type { Issue, Project } from '../domain/index.js';
import type { ConfirmationItem, ProductionCalculationResult } from '../bom/index.js';
import type {
  CheckStatus,
  ProductionCheck,
  ProductionCheckId,
  ProductionReadinessResult,
  ProductionStatus,
} from './types.js';

/**
 * Проверка готовности к производству (PROMPT 21 §3–§6).
 *
 * ## Ничего не считает заново
 *
 * Проверка работает по готовому `ProductionCalculationResult`: у каждого
 * слоя уже есть собственная валидация, и повторять её здесь значило бы
 * завести второй свод правил, который разойдётся с первым. Задача этого
 * файла — РАЗЛОЖИТЬ найденное по разделам и вывести один статус.
 *
 * ## Почему проверки именно такие
 *
 * Раздел отвечает на вопрос «что именно мешает запустить изделие в
 * работу»: технолог, увидев «CUTTING_VALID — ошибка», знает, к кому идти,
 * а увидев «две ошибки в спецификации» — нет.
 */

const TITLES: Readonly<Record<ProductionCheckId, string>> = {
  GEOMETRY_VALID: 'Геометрия',
  MATERIALS_VALID: 'Материалы',
  EDGES_VALID: 'Кромка',
  HARDWARE_VALID: 'Фурнитура',
  DRILLING_VALID: 'Присадка',
  CUTTING_VALID: 'Раскрой',
  BOM_VALID: 'Спецификация',
  EXPORT_VALID: 'Документация',
};

/** Какие категории неподтверждённых правил относятся к какому разделу. */
const CONFIRMATION_SECTIONS: Readonly<Record<ProductionCheckId, readonly ConfirmationItem['category'][]>> = {
  GEOMETRY_VALID: ['CONSTRUCTION'],
  MATERIALS_VALID: ['MATERIAL'],
  EDGES_VALID: ['EDGE'],
  HARDWARE_VALID: ['HARDWARE'],
  DRILLING_VALID: ['DRILLING'],
  CUTTING_VALID: ['CUTTING'],
  BOM_VALID: [],
  EXPORT_VALID: [],
};

function statusOfCheck(errors: readonly Issue[], warnings: readonly Issue[], confirmations: number): CheckStatus {
  // Порядок — порядок серьёзности. Раздел с ошибкой не может считаться
  // пройденным ни при каких обстоятельствах (§5).
  if (errors.length > 0) return 'ERROR';
  if (confirmations > 0) return 'NEEDS_CONFIRMATION';
  return warnings.length > 0 ? 'WARNING' : 'PASS';
}

function makeCheck(
  id: ProductionCheckId,
  errors: readonly Issue[],
  warnings: readonly Issue[],
  confirmations: readonly ConfirmationItem[],
  details: string,
): ProductionCheck {
  return {
    id,
    title: TITLES[id],
    status: statusOfCheck(errors, warnings, confirmations.length),
    errors,
    warnings,
    needsConfirmation: confirmations,
    details,
  };
}

/** Диагностика геометрии всех изделий проекта. */
function geometryIssues(result: ProductionCalculationResult): readonly Issue[] {
  return result.geometry.flatMap((item) => item.result.diagnostics);
}

const bySeverity = (issues: readonly Issue[], severity: Issue['severity']): Issue[] =>
  issues.filter((entry) => entry.severity === severity);

/** Проблемы слоя по префиксу кода: коды у каждого слоя свои и стабильные. */
const byPrefix = (issues: readonly Issue[], ...prefixes: string[]): Issue[] =>
  issues.filter((entry) => prefixes.some((prefix) => entry.code.startsWith(prefix)));

export interface ReadinessOptions {
  /** Уже посчитанный результат: конвейер не запускается второй раз. */
  readonly calculation?: ProductionCalculationResult;
}

export function validateProductionReadiness(project: Project, options: ReadinessOptions = {}): ProductionReadinessResult {
  const result = options.calculation ?? calculateProduction(project);
  const confirmations = result.bom.confirmations;
  const confirmationsOf = (id: ProductionCheckId): ConfirmationItem[] => {
    const categories = CONFIRMATION_SECTIONS[id];
    return confirmations.filter((item) => categories.includes(item.category));
  };

  const checks: ProductionCheck[] = [];

  // ── Геометрия ──────────────────────────────────────────────────────────────
  // Диагностика материалов приходит из геометрии (это она первой замечает
  // сломанную ссылку), но относится к разделу материалов: технолог,
  // увидев «ошибка геометрии», пойдёт проверять размеры, а проблема — в
  // реестре материалов.
  const allGeometry = geometryIssues(result);
  const materialGeometry = byPrefix(allGeometry, 'MATERIAL_');
  const geometry = allGeometry.filter((entry) => !materialGeometry.includes(entry));
  checks.push(
    makeCheck(
      'GEOMETRY_VALID',
      bySeverity(geometry, 'error'),
      bySeverity(geometry, 'warning'),
      confirmationsOf('GEOMETRY_VALID'),
      `Изделий: ${String(result.geometry.length)}, деталей построено: ${String(
        result.geometry.reduce((sum, item) => sum + item.result.parts.length, 0),
      )}.`,
    ),
  );

  // ── Материалы ──────────────────────────────────────────────────────────────
  // Ссылки на материалы уже проверил слой производственных деталей; здесь
  // остаётся то, что видно только на уровне спецификации: толщина позиции.
  const materialErrors: Issue[] = [
    ...bySeverity(materialGeometry, 'error'),
    ...byPrefix(result.errors, 'PRODUCTION_MATERIAL_NOT_FOUND', 'BOM_MATERIAL_NOT_FOUND', 'CUTTING_MATERIAL_NOT_FOUND'),
  ];
  for (const part of result.bom.parts) {
    if (!(part.thickness > 0)) {
      materialErrors.push(
        issue('READINESS_THICKNESS_NOT_DEFINED', 'error', `Позиция «${part.name}»: толщина не определена.`),
      );
    }
    if (project.materials.items[part.materialId] === undefined) {
      materialErrors.push(
        issue('READINESS_MATERIAL_UNKNOWN', 'error', `Позиция «${part.name}» ссылается на неизвестный материал.`),
      );
    }
  }
  checks.push(
    makeCheck(
      'MATERIALS_VALID',
      materialErrors,
      [...bySeverity(materialGeometry, 'warning'), ...byPrefix(result.warnings, 'CUTTING_SHEET_NOT_DEFINED')],
      confirmationsOf('MATERIALS_VALID'),
      `Материалов в деле: ${String(new Set(result.bom.parts.map((part) => String(part.materialId))).size)}.`,
    ),
  );

  // ── Кромка ─────────────────────────────────────────────────────────────────
  // Кромка ссылается на материал необязательно, но если ссылается —
  // материал обязан существовать: оклеить деталь несуществующим нечем.
  const edgeErrors: Issue[] = [];
  for (const part of result.bom.parts) {
    const edgeMaterial = part.edgeBanding.materialId;
    if (edgeMaterial !== undefined && project.materials.items[edgeMaterial] === undefined) {
      edgeErrors.push(
        issue(
          'READINESS_EDGE_MATERIAL_UNKNOWN',
          'error',
          `Позиция «${part.name}» ссылается на неизвестный материал кромки «${String(edgeMaterial)}».`,
        ),
      );
    }
  }
  const unnamedEdges = result.bom.edgeBanding.filter((edge) => edge.materialId === undefined);
  checks.push(
    makeCheck(
      'EDGES_VALID',
      edgeErrors,
      unnamedEdges.length === 0
        ? []
        : [
            issue(
              'READINESS_EDGE_MATERIAL_NOT_ASSIGNED',
              'warning',
              `Материал кромки не назначен для ${String(unnamedEdges.length)} позиций: в заказе она пойдёт без артикула.`,
            ),
          ],
      confirmationsOf('EDGES_VALID'),
      `Позиций кромки: ${String(result.bom.edgeBanding.length)}, суммарно ${String(
        Math.round(result.bom.edgeBanding.reduce((sum, edge) => sum + edge.lengthMm, 0) / 100) / 10,
      )} м.`,
    ),
  );

  // ── Фурнитура ──────────────────────────────────────────────────────────────
  checks.push(
    makeCheck(
      'HARDWARE_VALID',
      result.hardware.errors,
      result.hardware.warnings,
      confirmationsOf('HARDWARE_VALID'),
      `Позиций фурнитуры: ${String(result.hardware.lines.length)}, штук: ${String(
        result.hardware.lines.reduce((sum, line) => sum + line.quantity, 0),
      )}.`,
    ),
  );

  // ── Присадка ───────────────────────────────────────────────────────────────
  checks.push(
    makeCheck(
      'DRILLING_VALID',
      result.drilling.errors,
      result.drilling.warnings,
      confirmationsOf('DRILLING_VALID'),
      `Операций присадки: ${String(result.drilling.operations.length)} на ${String(result.bom.drilling.partCount)} деталях.`,
    ),
  );

  // ── Раскрой ────────────────────────────────────────────────────────────────
  const cuttingErrors: Issue[] = [...result.cutting.errors, ...byPrefix(result.errors, 'BOM_PART_NOT_PLACED')];
  checks.push(
    makeCheck(
      'CUTTING_VALID',
      cuttingErrors,
      result.cutting.warnings,
      confirmationsOf('CUTTING_VALID'),
      `Листов: ${String(result.bom.cutting.stockCount)}, размещено ${String(result.bom.cutting.placedParts)}, не размещено ${String(
        result.bom.cutting.unplacedParts,
      )}.`,
    ),
  );

  // ── Спецификация ───────────────────────────────────────────────────────────
  // Инварианты, которые невозможно проверить внутри одного слоя: количество
  // против источников и уникальность деталей между позициями.
  const bomErrors: Issue[] = [...byPrefix(result.errors, 'BOM_')].filter((entry) => entry.code !== 'BOM_PART_NOT_PLACED');
  const seenSources = new Set<string>();
  for (const part of result.bom.parts) {
    if (part.quantity !== part.sourcePartIds.length) {
      bomErrors.push(
        issue(
          'READINESS_BOM_QUANTITY_MISMATCH',
          'error',
          `Позиция «${part.name}»: количество ${String(part.quantity)} не совпадает с числом деталей-источников ${String(part.sourcePartIds.length)}.`,
        ),
      );
    }
    for (const sourceId of part.sourcePartIds) {
      const key = String(sourceId);
      if (seenSources.has(key)) {
        bomErrors.push(
          issue('READINESS_BOM_DUPLICATE_SOURCE', 'error', `Деталь «${key}» попала в спецификацию дважды.`),
        );
      }
      seenSources.add(key);
    }
  }
  checks.push(
    makeCheck(
      'BOM_VALID',
      bomErrors,
      [],
      confirmationsOf('BOM_VALID'),
      `Позиций: ${String(result.bom.parts.length)}, деталей: ${String(
        result.bom.parts.reduce((sum, part) => sum + part.quantity, 0),
      )}.`,
    ),
  );

  // ── Документация ───────────────────────────────────────────────────────────
  // Проверяется не «файл создался», а то, что данные для документа
  // собираются и совпадают со спецификацией по числу строк: расхождение
  // здесь означает документ, не соответствующий расчёту.
  const exportErrors: Issue[] = [];
  let exportDetails = '';
  try {
    const data = buildProductionExportData(project, result, { generatedAt: '' });
    if (data.parts.length !== result.bom.parts.length) {
      exportErrors.push(
        issue('READINESS_EXPORT_ROWS_MISMATCH', 'error', 'Число строк документа не совпадает со спецификацией.'),
      );
    }
    exportDetails = `Строк деталей: ${String(data.parts.length)}, фурнитуры: ${String(data.hardware.length)}, присадки: ${String(data.drilling.length)}, листов раскроя: ${String(data.sheets.length)}.`;
  } catch (error) {
    exportErrors.push(
      issue(
        'READINESS_EXPORT_FAILED',
        'error',
        `Данные документа не собираются: ${error instanceof Error ? error.message : 'неизвестная ошибка'}.`,
      ),
    );
  }
  checks.push(makeCheck('EXPORT_VALID', exportErrors, [], confirmationsOf('EXPORT_VALID'), exportDetails));

  const errors = checks.flatMap((check) => check.errors);
  const warnings = checks.flatMap((check) => check.warnings);

  return {
    status: statusOf(checks, confirmations.length),
    calculationStatus: result.status,
    checks,
    errors,
    warnings,
    needsConfirmation: confirmations,
  };
}

/**
 * Общий статус: не выше самой слабой проверки (§5).
 *
 * `READY_FOR_PRODUCTION` требует, чтобы не было ни ошибок, ни
 * неподтверждённых правил, ни предупреждений. Неподтверждённое правило
 * НИКОГДА не превращается в готовность автоматически: это прямой запрет
 * §5, и он важнее удобства.
 */
function statusOf(checks: readonly ProductionCheck[], confirmations: number): ProductionStatus {
  if (checks.some((check) => check.status === 'ERROR')) return 'INVALID';
  if (confirmations > 0 || checks.some((check) => check.status === 'NEEDS_CONFIRMATION')) return 'NEEDS_CONFIRMATION';
  return checks.some((check) => check.status === 'WARNING') ? 'HAS_WARNINGS' : 'READY_FOR_PRODUCTION';
}

/** Готово ли изделие к запуску. Единственный ответ на этот вопрос. */
export function isReadyForProduction(readiness: ProductionReadinessResult): boolean {
  return readiness.status === 'READY_FOR_PRODUCTION';
}

/** Есть ли среди диагностик хотя бы одна ошибка — та же функция, что в домене. */
export function readinessHasErrors(readiness: ProductionReadinessResult): boolean {
  return hasErrors(readiness.errors);
}
