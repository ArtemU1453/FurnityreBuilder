import { formatMm } from '../domain/index.js';
import type { MaterialLibrary, Mm } from '../domain/index.js';
import type { CuttingLayout, CuttingResult, ProductionPart } from '../production/index.js';
import { usableAreaOf } from '../production/index.js';

/**
 * View-модель карты раскроя (PROMPT 17 §30).
 *
 * Формул здесь нет ни одной: все числа приходят готовыми из
 * `calculateCutting`. Рендерер только переводит их в прямоугольники и
 * подписи — тот же принцип, что у `buildDebugView` («рендерер не знает
 * мебельных формул»). Единственное преобразование — инверсия оси Y:
 * раскладка считает Y вверх, экран рисует вниз.
 */

export interface CuttingRect {
  readonly id: string;
  readonly x: Mm;
  readonly y: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly label: string;
  readonly detail: string;
  readonly rotated: boolean;
}

export interface CuttingSheetView {
  readonly id: string;
  readonly title: string;
  readonly stockWidth: Mm;
  readonly stockHeight: Mm;
  readonly usable: { readonly x: Mm; readonly y: Mm; readonly width: Mm; readonly height: Mm };
  readonly rects: readonly CuttingRect[];
  readonly summary: string;
}

export interface CuttingMapView {
  readonly sheets: readonly CuttingSheetView[];
  readonly unplaced: readonly string[];
  readonly totals: string;
}

/** Процент с одним знаком: «68.4 %». */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function sheetView(
  layout: CuttingLayout,
  index: number,
  partsById: ReadonlyMap<string, ProductionPart>,
  materials: MaterialLibrary,
): CuttingSheetView {
  const usable = usableAreaOf(layout.stock);
  const materialName = materials.items[layout.stock.materialId]?.name ?? String(layout.stock.materialId);

  const rects: CuttingRect[] = layout.placements.map((placement) => {
    const part = partsById.get(placement.productionPartId);
    const grain = part === undefined || part.grain === 'none' ? 'текстуры нет' : `текстура ${part.grain}`;
    return {
      id: placement.id,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      label: part?.name ?? placement.productionPartId,
      detail: `${placement.sourcePartId} · ${formatMm(placement.width)} × ${formatMm(placement.height)} · ${String(placement.rotation)}° · ${grain}`,
      rotated: placement.rotation === 90,
    };
  });

  return {
    id: layout.id,
    title: `ЛИСТ ${String(index + 1)} · ${materialName} · ${formatMm(layout.stock.length)} × ${formatMm(layout.stock.width)} · ${formatMm(layout.stock.thickness)}`,
    stockWidth: layout.stock.length,
    stockHeight: layout.stock.width,
    usable: { x: usable.x, y: usable.y, width: usable.length, height: usable.width },
    rects,
    summary: `Деталей: ${String(layout.placements.length)} · использовано ${percent(layout.utilization)} · отход ${formatMm(Math.round(layout.wasteArea / 100) / 100)} дм² · пропил ${formatMm(layout.stock.kerf)}`,
  };
}

export function buildCuttingView(result: CuttingResult, materials: MaterialLibrary): CuttingMapView {
  const partsById = new Map(result.productionParts.map((p) => [p.id, p]));
  const sheets = result.layouts.map((layout, index) => sheetView(layout, index, partsById, materials));

  const unplaced = result.unplaced.map((item) => {
    const part = partsById.get(item.productionPartId);
    const name = part?.name ?? item.productionPartId;
    const size = part === undefined ? '' : ` ${formatMm(part.length)} × ${formatMm(part.width)}`;
    return `НЕ РАЗМЕЩЕНО · ${name}${size} · экземпляр ${String(item.instanceIndex + 1)} · ${item.reason} · ${item.detail}`;
  });

  const usedArea = result.layouts.reduce((sum, l) => sum + l.usedArea, 0);
  const stockArea = result.layouts.reduce((sum, l) => sum + l.stockArea, 0);
  const totals = `Позиций: ${String(result.productionParts.length)} · групп: ${String(result.groups.length)} · листов: ${String(result.layouts.length)} · использовано ${percent(stockArea > 0 ? usedArea / stockArea : 0)}`;

  return { sheets, unplaced, totals };
}
