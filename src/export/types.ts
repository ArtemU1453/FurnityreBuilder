import type { DrillFace, DrillPurpose, Grain, Mm } from '../domain/index.js';
import type { CalculationStatus, ConfirmationItem, EdgeBandSummary, PartCategory } from '../bom/index.js';
import type { ProductionPartType, UnplacedReason } from '../production/index.js';

/**
 * Данные для экспорта (PROMPT 20 §2).
 *
 * ## Зачем отдельный слой между расчётом и документом
 *
 * Экспортёры не должны знать ни о геометрии, ни о правилах производства.
 * Их работа — разложить готовые числа по страницам и ячейкам. Слой
 * `ProductionExportData` фиксирует эту границу: если завтра появится
 * третий формат, он получит те же данные, а не начнёт «дочитывать»
 * недостающее из модели напрямую — именно так в проектах и заводится
 * второй расчётный движок.
 *
 * ## Плоские строки, а не ссылки
 *
 * Всё здесь — плоские строки таблиц: у ячейки XLSX нет способа сослаться
 * на объект. Значения уже отформатированы там, где это отображение
 * (`display`), и оставлены числами там, где это число: в XLSX размер
 * обязан быть числом, иначе по нему нельзя ни отсортировать, ни
 * просуммировать (§15).
 */

export interface ExportMetadata {
  readonly projectName: string;
  readonly furnitureName: string;
  /**
   * Дата генерации. ЕДИНСТВЕННОЕ значение, зависящее от момента
   * времени, и оно живёт отдельно от производственных данных (§13):
   * сравнение двух экспортов игнорирует именно это поле.
   */
  readonly generatedAt: string;
  readonly appVersion: string;
  readonly bomVersion: number;
  readonly status: CalculationStatus;
}

export interface ExportDimensions {
  readonly width: Mm;
  readonly height: Mm;
  readonly depth: Mm;
  readonly panelThickness: Mm;
  readonly constructionScheme: string;
  readonly backPanel: string;
  readonly base: string;
}

/** Строка спецификации деталей: одна позиция деталировки. */
export interface ExportPartRow {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly partType: ProductionPartType;
  readonly category: PartCategory;
  readonly quantity: number;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialId: string;
  readonly materialName: string;
  readonly edge: string;
  readonly grain: Grain;
  /** Идентификаторы физических деталей: трассируемость до ячейки (§12). */
  readonly sourcePartIds: readonly string[];
}

export interface ExportHardwareRow {
  readonly index: number;
  readonly definitionId: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly unit: string;
  readonly purpose: string;
  readonly sources: readonly string[];
  readonly ruleId: string;
}

export interface ExportDrillingRow {
  readonly index: number;
  readonly partId: string;
  readonly partName: string;
  readonly operationId: string;
  readonly purpose: DrillPurpose;
  readonly face: DrillFace;
  readonly x: number;
  readonly y: number;
  /** Мировая координата центра отверстия: нужна станку и проверке. */
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly diameter: number;
  readonly depth: number;
  readonly direction: string;
  readonly through: string;
}

export interface ExportPlacementRow {
  readonly index: number;
  readonly stockId: string;
  readonly sheetNumber: number;
  readonly stockLength: number;
  readonly stockWidth: number;
  readonly partId: string;
  readonly partName: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly kerf: number;
  readonly utilization: number;
  readonly wasteArea: number;
}

export interface ExportUnplacedRow {
  readonly partId: string;
  readonly partName: string;
  readonly instance: number;
  readonly reason: UnplacedReason;
  readonly detail: string;
}

export interface ExportMaterialRow {
  readonly index: number;
  readonly materialId: string;
  readonly name: string;
  readonly kind: string;
  readonly thickness: number;
  readonly partPositions: number;
  readonly partQuantity: number;
  readonly areaM2: number;
  readonly sheetCount: number;
}

export interface ExportEdgeRow {
  readonly index: number;
  readonly materialName: string;
  readonly thickness: number;
  readonly lengthM: number;
  readonly sideCount: number;
}

/** Одна карта раскроя для векторной отрисовки в PDF (§6). */
export interface ExportCuttingSheet {
  readonly id: string;
  readonly sheetNumber: number;
  readonly materialName: string;
  readonly thickness: number;
  readonly stockLength: number;
  readonly stockWidth: number;
  readonly usable: { readonly x: number; readonly y: number; readonly length: number; readonly width: number };
  readonly kerf: number;
  readonly utilization: number;
  readonly wasteArea: number;
  readonly placements: readonly {
    readonly partId: string;
    readonly partName: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  }[];
}

/** Чертёж детали для PDF (§4): габарит, кромка, текстура, отверстия. */
export interface ExportPartDrawing {
  readonly partId: string;
  readonly name: string;
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialName: string;
  readonly edge: string;
  readonly grain: Grain;
  readonly quantity: number;
  readonly holes: readonly {
    readonly id: string;
    readonly face: DrillFace;
    readonly x: number;
    readonly y: number;
    readonly diameter: number;
    readonly depth: number;
    readonly through: string;
    readonly purpose: DrillPurpose;
  }[];
}

export interface ProductionExportData {
  readonly metadata: ExportMetadata;
  readonly dimensions: ExportDimensions;
  readonly parts: readonly ExportPartRow[];
  readonly drawings: readonly ExportPartDrawing[];
  readonly hardware: readonly ExportHardwareRow[];
  readonly drilling: readonly ExportDrillingRow[];
  readonly placements: readonly ExportPlacementRow[];
  readonly unplaced: readonly ExportUnplacedRow[];
  readonly sheets: readonly ExportCuttingSheet[];
  readonly materials: readonly ExportMaterialRow[];
  readonly edgeBanding: readonly ExportEdgeRow[];
  readonly edgeSummary: readonly EdgeBandSummary[];
  readonly confirmations: readonly ConfirmationItem[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly totals: {
    readonly partPositions: number;
    readonly partQuantity: number;
    readonly hardwarePositions: number;
    readonly drillingOperations: number;
    readonly sheetCount: number;
    readonly utilization: number;
    readonly unplaced: number;
  };
}
