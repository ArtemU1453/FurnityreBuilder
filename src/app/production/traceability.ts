import { formatMm } from '../../domain/index.js';
import type { NodeId, PartId } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';
import type { PartBOMItem } from '../../bom/index.js';
import { operationsOfItem } from '../../export/index.js';
import type { DrillingOperation } from '../../drilling/index.js';
import type { HardwareItem } from '../../hardware/index.js';
import type { CuttingPlacement, CuttingResult } from '../../production/index.js';

/**
 * Трассируемость производственных данных (PROMPT 29 §5, §9, §18, §25, §32).
 *
 * ## Связи не изобретаются — они уже есть
 *
 * `PartBOMItem.sourcePartIds` и `.sourceNodeIds`,
 * `DrillingOperation.sourceHardwareId`/`.sourceNodeId`/`.ruleId`,
 * `HardwareItem.sourcePartId`/`.sourceNodeId`/`.ruleId`,
 * `CuttingPlacement.productionPartId`/`.sourcePartId` — всё это
 * заполняется расчётными слоями с PROMPT 16–19. Здесь эти поля только
 * читаются и складываются в цепочку.
 *
 * Там, где связи в данных НЕТ, здесь не появляется догадка: функция
 * возвращает пустой список, а интерфейс говорит, чего не хватает (§9).
 *
 * ## Чистый модуль
 *
 * Ни React, ни DOM: цепочка проверяется обычным тестом.
 */

/** Где в изделии стоит узел: секция, ряд и колонка ячейки. */
export interface NodeOrigin {
  readonly nodeId: NodeId;
  /** Человеческое описание: «секция 2, ячейка 1/3». */
  readonly label: string;
}

export interface PartTrace {
  readonly item: PartBOMItem;
  /** Физические детали всех экземпляров позиции. */
  readonly sourceParts: readonly PartId[];
  /** Узлы модели, из которых деталь получилась. */
  readonly origins: readonly NodeOrigin[];
  readonly drilling: readonly DrillingOperation[];
  readonly hardware: readonly HardwareItem[];
  readonly placements: readonly CuttingPlacement[];
  /** Листы раскроя, на которые попала позиция: номера с единицы. */
  readonly sheets: readonly number[];
}

/**
 * Описание узла по геометрии.
 *
 * `GeometryResult.cells` уже несёт `sectionId`, `row` и `column` — их
 * считает раскладка, и второй раз выводить их из дерева не нужно.
 * Узел, которого среди ячеек нет (например, сама секция), описывается
 * своим идентификатором: соврать про его место хуже, чем не назвать его.
 */
export function nodeOrigin(geometry: GeometryResult | undefined, nodeId: NodeId): NodeOrigin {
  const cell = geometry?.cells.find((item) => item.nodeId === nodeId);
  if (cell === undefined) return { nodeId, label: String(nodeId) };

  const sectionIndex = geometry?.sections.findIndex((s) => s.nodeId === cell.sectionId) ?? -1;
  const section = sectionIndex >= 0 ? `секция ${String(sectionIndex + 1)}` : 'изделие';
  return {
    nodeId,
    label: `${section}, ячейка ${String(cell.row + 1)}/${String(cell.column + 1)}`,
  };
}

export interface TraceInput {
  readonly item: PartBOMItem;
  readonly geometry: GeometryResult | undefined;
  readonly drilling: ReadonlyMap<string, readonly DrillingOperation[]>;
  readonly hardware: readonly HardwareItem[];
  readonly cutting: CuttingResult;
}

/** Полная цепочка одной позиции деталировки. */
export function traceOf(input: TraceInput): PartTrace {
  const { item } = input;
  const sourceParts = new Set<PartId>(item.sourcePartIds);

  // Раскладка ключуется идентификатором ПРОИЗВОДСТВЕННОЙ детали
  // (`pp:…`), а у позиции деталировки идентификатор свой (`bom:…`).
  // Сравнивать их напрямую нельзя: это разные сущности.
  const productionPartIds = new Set(item.productionPartIds);
  const placements: CuttingPlacement[] = [];
  const sheets = new Set<number>();
  input.cutting.layouts.forEach((layout, index) => {
    for (const placement of layout.placements) {
      if (!productionPartIds.has(placement.productionPartId)) continue;
      placements.push(placement);
      sheets.add(index + 1);
    }
  });

  return {
    item,
    sourceParts: [...sourceParts],
    origins: item.sourceNodeIds.map((nodeId) => nodeOrigin(input.geometry, nodeId)),
    drilling: operationsOfItem(item, input.drilling),
    // Позиция фурнитуры принадлежит детали, если её породила одна из
    // физических деталей этой позиции. Догадок по имени или по типу нет.
    hardware: input.hardware.filter(
      (hw) => hw.sourcePartId !== undefined && sourceParts.has(hw.sourcePartId),
    ),
    placements,
    sheets: [...sheets].sort((a, b) => a - b),
  };
}

/** Короткое описание цепочки для человека: путь от детали к её месту. */
export function traceSummary(trace: PartTrace): string {
  const where =
    trace.origins.length === 0
      ? 'место в изделии не указано'
      : trace.origins.map((origin) => origin.label).join('; ');
  const sheets =
    trace.sheets.length === 0
      ? 'на листы не попала'
      : `лист ${trace.sheets.map((n) => String(n)).join(', ')}`;
  return `${where} · ${sheets} · отверстий ${String(trace.drilling.length)} · фурнитуры ${String(trace.hardware.length)}`;
}

/** Размещение на карте раскроя одной строкой. */
export function placementSummary(placement: CuttingPlacement): string {
  return `X ${formatMm(placement.x)} · Y ${formatMm(placement.y)} · ${formatMm(placement.width)} × ${formatMm(placement.height)} · поворот ${String(placement.rotation)}°`;
}
