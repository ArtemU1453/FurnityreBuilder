import type { Issue, ProjectId } from '../domain/index.js';
import type { CalculationStatus, ConfirmationItem, ProductionCalculationResult } from '../bom/index.js';
import type { ProductionExportData } from '../export/index.js';

/**
 * Производственный workflow (PROMPT 21).
 *
 * ## Один статус, а не второй рядом
 *
 * `ProductionCalculationResult.status` уже отвечает на вопрос «в каком
 * состоянии расчёт» (PROMPT 19 §19). Второго набора статусов здесь не
 * заводится: `ProductionStatus` — то же самое, переведённое на язык
 * производства, с единственным содержательным добавлением —
 * `READY_FOR_PRODUCTION`.
 *
 * Состояний `DRAFT` и `CALCULATED` в этом словаре нет намеренно. Расчёт
 * производный и синхронный: он не бывает «ещё не выполнен» — он
 * выполняется из проекта в момент запроса. Статус, означающий «расчёт
 * устарел», описывал бы то, чего в этой архитектуре не существует.
 */
export type ProductionStatus = 'READY_FOR_PRODUCTION' | 'HAS_WARNINGS' | 'NEEDS_CONFIRMATION' | 'INVALID';

/** Идентификатор проверки. Стабильный: по нему адресуются, а не по тексту (§4). */
export type ProductionCheckId =
  | 'GEOMETRY_VALID'
  | 'MATERIALS_VALID'
  | 'EDGES_VALID'
  | 'HARDWARE_VALID'
  | 'DRILLING_VALID'
  | 'CUTTING_VALID'
  | 'BOM_VALID'
  | 'EXPORT_VALID';

export type CheckStatus = 'PASS' | 'WARNING' | 'ERROR' | 'NEEDS_CONFIRMATION';

/**
 * Пункт производственного чеклиста (§6).
 *
 * Собственной логики у пункта нет: он собирается из уже посчитанного
 * результата. Чеклист, который считает сам, — это второй источник правды
 * о готовности, и он неизбежно разойдётся с первым.
 */
export interface ProductionCheck {
  readonly id: ProductionCheckId;
  readonly title: string;
  readonly status: CheckStatus;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  /** Неподтверждённые правила, относящиеся именно к этому разделу. */
  readonly needsConfirmation: readonly ConfirmationItem[];
  /** Что проверялось и что получилось — одной строкой для человека. */
  readonly details: string;
}

/**
 * Итог проверки готовности (§4).
 *
 * `status` выводится из проверок и НЕ может оказаться выше самой слабой
 * из них: неподтверждённое правило никогда не превращается в
 * `READY_FOR_PRODUCTION` само собой (§5).
 */
export interface ProductionReadinessResult {
  readonly status: ProductionStatus;
  readonly calculationStatus: CalculationStatus;
  readonly checks: readonly ProductionCheck[];
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly needsConfirmation: readonly ConfirmationItem[];
}

/**
 * Отпечаток входных данных (§10–§11).
 *
 * Строка, однозначно определяющая всё, от чего зависит производственный
 * расчёт: габариты, материалы, дерево секций, фасады, настройки раскроя.
 * Пакет несёт отпечаток того проекта, из которого собран, и по нему
 * проверяется, не устарел ли он.
 *
 * Отпечаток — не кэш и не источник истины: он ничего не хранит, кроме
 * ответа на вопрос «это всё ещё тот же вход».
 */
export type ProjectFingerprint = string;

/**
 * Производственный пакет (§8–§9).
 *
 * Композиция уже существующих результатов, а не их копия: `calculation`
 * содержит и спецификацию, и раскрой, и присадку, и фурнитуру, а поля
 * `bom`/`cutting`/`drilling`/`hardware` — ссылки на них же. Копировать
 * большие структуры ради «плоского» вида значило бы завести второй BOM,
 * что §9 запрещает прямо.
 */
export interface ProductionPackage {
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly fingerprint: ProjectFingerprint;
  readonly calculation: ProductionCalculationResult;
  readonly readiness: ProductionReadinessResult;
  readonly exports: ProductionExportData;
  readonly status: ProductionStatus;
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}
