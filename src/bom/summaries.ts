import type { MaterialLibrary } from '../domain/index.js';
import type { CuttingResult, ProductionPart } from '../production/index.js';
import type { DrillingPlan } from '../drilling/index.js';
import type { CuttingSummary, DrillingSummary, DrillingSummaryItem, StockSummary } from './types.js';

/**
 * Сводки по присадке и раскрою (PROMPT 19 §11–§13).
 *
 * Сводка — ПРОИЗВОДНОЕ ПРЕДСТАВЛЕНИЕ, а не замена подробностей: и
 * `DrillingPlan`, и `CuttingResult` целиком остаются в
 * `ProductionCalculationResult`. Сводка отвечает на вопрос «сколько и
 * где», подробности — на вопрос «как именно», и вторые не выбрасываются
 * ради первых.
 */

export function buildDrillingSummary(plan: DrillingPlan, parts: readonly ProductionPart[]): DrillingSummary {
  const nameById = new Map(parts.map((p) => [p.id, p.name]));
  const items: DrillingSummaryItem[] = [];

  for (const [productionPartId, operations] of plan.byProductionPart) {
    items.push({
      productionPartId,
      partName: nameById.get(productionPartId) ?? productionPartId,
      operationCount: operations.length,
      // Грани и типы операций — множества, а не списки: технологу важно,
      // КАКИЕ стороны предстоит сверлить, а не сколько раз каждая
      // встретилась (это уже есть в operationCount).
      faces: [...new Set(operations.map((o) => o.face))].sort(),
      purposes: [...new Set(operations.map((o) => o.purpose))].sort(),
      operations,
    });
  }

  items.sort((a, b) => a.productionPartId.localeCompare(b.productionPartId));
  return { operationCount: plan.operations.length, partCount: items.length, items };
}

/**
 * Итог раскроя (§12–§13).
 *
 * Количество листов НЕ считается здесь заново: оно равно числу раскладок,
 * которые вернул раскрой. Второй алгоритм подсчёта листов рядом с первым
 * означал бы два разных ответа на один вопрос — тот же довод, по которому
 * не заводится второй Cutting Engine (§33).
 */
export function buildCuttingSummary(cutting: CuttingResult, materials: MaterialLibrary): CuttingSummary {
  const usedArea = cutting.layouts.reduce((sum, l) => sum + l.usedArea, 0);
  const stockArea = cutting.layouts.reduce((sum, l) => sum + l.stockArea, 0);
  const placedParts = cutting.layouts.reduce((sum, l) => sum + l.placements.length, 0);

  const stocks = new Map<string, StockSummary>();
  for (const layout of cutting.layouts) {
    const existing = stocks.get(layout.stockId);
    if (existing === undefined) {
      stocks.set(layout.stockId, {
        stockId: layout.stockId,
        materialId: layout.stock.materialId,
        materialName: materials.items[layout.stock.materialId]?.name ?? String(layout.stock.materialId),
        thickness: layout.stock.thickness,
        stockLength: layout.stock.length,
        stockWidth: layout.stock.width,
        stockQuantity: 1,
      });
    } else {
      stocks.set(layout.stockId, { ...existing, stockQuantity: existing.stockQuantity + 1 });
    }
  }

  return {
    stockCount: cutting.layouts.length,
    usedArea,
    stockArea,
    wasteArea: stockArea - usedArea,
    utilization: stockArea > 0 ? usedArea / stockArea : 0,
    placedParts,
    unplacedParts: cutting.unplaced.length,
    unplacedReasons: [...new Set(cutting.unplaced.map((u) => u.reason))].sort(),
    stocks: [...stocks.values()].sort((a, b) => a.stockId.localeCompare(b.stockId)),
  };
}
