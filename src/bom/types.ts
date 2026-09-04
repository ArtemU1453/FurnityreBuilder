import type {
  DrillFace,
  DrillPurpose,
  EdgeSpec,
  EdgeThickness,
  FurnitureId,
  Grain,
  HardwareId,
  Issue,
  MaterialId,
  MaterialKind,
  Mm,
  NodeId,
  PartId,
} from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { CuttingResult, ProductionPartType, UnplacedReason } from '../production/index.js';
import type { DrillingOperation, DrillingPlan } from '../drilling/index.js';
import type { HardwareBOM } from '../hardware/index.js';

/**
 * Производственная спецификация (PROMPT 19).
 *
 * ## Что это и чем НЕ является
 *
 * `ProductionBOM` — АГРЕГАТ уже посчитанного: производственных деталей,
 * спецификации фурнитуры, плана присадки и раскладки. Он ничего не
 * вычисляет заново и не хранит второй копии данных, у которых уже есть
 * владелец (§2, §33).
 *
 * Второй спецификации фурнитуры здесь нет: `ProductionBOM.hardware` —
 * это `HardwareBOM` как он есть. Второй модели отверстий тоже нет:
 * `drilling` — это `DrillingPlan`. Новое здесь ровно одно: строка
 * деталировки (`PartBOMItem`) и производные сводки, которых до сих пор не
 * существовало ни в одном слое.
 *
 * ## Почему строка деталировки всё-таки новая
 *
 * `ProductionPart` отвечает на вопрос «что изготовить», и его ключ
 * включает РОЛЬ детали. Спецификации роль не нужна: стационарная и
 * съёмная полка одного размера из одного материала с одной кромкой — одна
 * позиция деталировки и одна и та же панель на распиле. Поэтому строка
 * деталировки группирует по производственным свойствам, а не по роли, и
 * хранит имя материала — то, что читает человек, а не машина (§4: данные
 * материализуются для экспорта и являются snapshot).
 */

/** Версия структуры спецификации. Меняется при несовместимом изменении формы. */
export const PRODUCTION_BOM_VERSION = 1;

/**
 * Раздел производственной структуры (§16).
 *
 * Категории соответствуют фактическим типам деталей проекта: фиктивных
 * разделов «на будущее» здесь нет. `drawer-box` не появляется, пока
 * геометрия не строит деталей короба (`T-DRW-02`).
 */
export type PartCategory =
  | 'carcass'
  | 'shelves'
  | 'doors'
  | 'drawers'
  | 'back-wall'
  | 'plinth'
  | 'countertop'
  | 'false-panels'
  | 'other';

/**
 * Строка деталировки.
 *
 * Размеры и кромка — SNAPSHOT из `ProductionPart` (§4): спецификация
 * материализует их, чтобы экспорт не пересчитывал деталь заново. Источник
 * истины остаётся один — `productionPartIds` ведут к нему, и расхождения
 * быть не может, потому что снимок делается в том же прогоне конвейера.
 */
export interface PartBOMItem {
  readonly id: string;
  readonly productionPartIds: readonly string[];
  readonly name: string;
  readonly partType: ProductionPartType;
  readonly category: PartCategory;
  readonly materialId: MaterialId;
  readonly materialName: string;
  readonly materialKind: MaterialKind;
  readonly thickness: Mm;
  readonly length: Mm;
  readonly width: Mm;
  readonly quantity: number;
  readonly grainDirection: Grain;
  readonly edgeBanding: EdgeSpec;
  /** Физические детали всех экземпляров: начало цепочки трассируемости (§15). */
  readonly sourcePartIds: readonly PartId[];
  readonly sourceNodeIds: readonly NodeId[];
}

/**
 * Кромка в погонных метрах (§10).
 *
 * Длина не оценивается, а выводится из реальных размеров детали: сторона
 * `left`/`right` идёт вдоль ШИРИНЫ детали, `front`/`back` — вдоль ДЛИНЫ
 * (`docs/COORDINATE_SYSTEM.md` §5). Каждая сторона учитывается столько
 * раз, сколько экземпляров у позиции.
 */
export interface EdgeBandSummary {
  readonly id: string;
  /** Материал кромки, если назначен: `EdgeSpec.materialId` необязателен. */
  readonly materialId?: MaterialId;
  readonly materialName: string;
  readonly thickness: EdgeThickness;
  /** Суммарная длина, мм. Метры — забота представления, не расчёта. */
  readonly lengthMm: number;
  /** Сколько отдельных сторон деталей вошло в эту строку. */
  readonly sideCount: number;
}

/** Присадка по детали (§11). Детальные операции остаются в `DrillingPlan`. */
export interface DrillingSummaryItem {
  readonly productionPartId: string;
  readonly partName: string;
  readonly operationCount: number;
  readonly faces: readonly DrillFace[];
  readonly purposes: readonly DrillPurpose[];
  readonly operations: readonly DrillingOperation[];
}

export interface DrillingSummary {
  readonly operationCount: number;
  readonly partCount: number;
  readonly items: readonly DrillingSummaryItem[];
}

/** Раскладка одной заготовки (§13). Количество листов приходит из раскроя. */
export interface StockSummary {
  readonly stockId: string;
  readonly materialId: MaterialId;
  readonly materialName: string;
  readonly thickness: Mm;
  readonly stockLength: Mm;
  readonly stockWidth: Mm;
  readonly stockQuantity: number;
}

/** Итог раскроя (§12). Второго алгоритма раскладки не появляется. */
export interface CuttingSummary {
  readonly stockCount: number;
  readonly usedArea: number;
  readonly stockArea: number;
  readonly wasteArea: number;
  readonly utilization: number;
  readonly placedParts: number;
  readonly unplacedParts: number;
  readonly unplacedReasons: readonly UnplacedReason[];
  readonly stocks: readonly StockSummary[];
}

/** Категория неподтверждённого правила (§18). */
export type ConfirmationCategory = 'CUTTING' | 'DRILLING' | 'HARDWARE' | 'MATERIAL' | 'EDGE' | 'CONSTRUCTION';

/**
 * Неподтверждённое производственное правило.
 *
 * Спецификация не имеет права прятать такие ограничения: лист с
 * количеством, полученным по выдуманному правилу, выглядит ровно так же,
 * как лист с подтверждённым, — и разницу видно только на производстве.
 */
export interface ConfirmationItem {
  /** Идентификатор неизвестного из `docs/UNKNOWNS.json`. */
  readonly id: string;
  readonly category: ConfirmationCategory;
  readonly rule: string;
  readonly source: string;
  readonly impact: string;
}

export interface ProductionBOM {
  readonly id: string;
  readonly version: number;
  readonly parts: readonly PartBOMItem[];
  readonly edgeBanding: readonly EdgeBandSummary[];
  readonly hardware: HardwareBOM;
  readonly drilling: DrillingSummary;
  readonly cutting: CuttingSummary;
  readonly confirmations: readonly ConfirmationItem[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/** Статус расчёта (§19). */
export type CalculationStatus = 'VALID' | 'VALID_WITH_WARNINGS' | 'NEEDS_CONFIRMATION' | 'INVALID';

/**
 * Полный результат расчёта (§19, §24).
 *
 * Содержит и агрегат, и все промежуточные результаты: экспортёру нужна
 * спецификация, а карте раскроя и карте присадки — их собственные полные
 * данные, и заставлять их считать всё заново было бы ровно тем
 * дублированием, которое запрещает §26.
 */
/** Геометрия изделия внутри результата расчёта: та же, что строил конвейер. */
export interface ProductionGeometry {
  readonly furnitureId: FurnitureId;
  readonly furnitureName: string;
  readonly result: GeometryResult;
}

export interface ProductionCalculationResult {
  /**
   * Геометрия каждого изделия — тот самый объект, который конвейер
   * построил и передал дальше (PROMPT 21 §1). Хранится ссылкой, а не
   * копией: проверке готовности нужна диагностика геометрии отдельно от
   * остальных, а строить её второй раз означало бы второй расчёт.
   */
  readonly geometry: readonly ProductionGeometry[];
  readonly bom: ProductionBOM;
  readonly cutting: CuttingResult;
  readonly hardware: HardwareBOM;
  readonly drilling: DrillingPlan;
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
  readonly status: CalculationStatus;
}

/** Строка спецификации фурнитуры адресуется определением. */
export type HardwareLineKey = HardwareId;
