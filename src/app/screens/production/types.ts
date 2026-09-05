import type { NodeId, PartId } from '../../../domain/index.js';
import type { GeometryResult } from '../../../geometry/index.js';
import type { PartBOMItem, ProductionCalculationResult } from '../../../bom/index.js';
import type { ProductionReadinessResult } from '../../../workflow/index.js';
import type { PartTrace } from '../../production/index.js';

/**
 * Общий вход разделов производства (PROMPT 29 §2, §3).
 *
 * Все разделы получают ОДИН уже посчитанный результат и ничего не
 * считают сами. Расчёт приходит сверху ровно один раз за перерисовку:
 * восемь разделов, каждый со своим вызовом `calculateProduction`, — это
 * восемь конвейеров вместо одного (§43).
 */
export interface ProductionData {
  readonly calculation: ProductionCalculationResult;
  readonly readiness: ProductionReadinessResult;
  /** Геометрия изделия: нужна для описания места детали в модели. */
  readonly geometry: GeometryResult | undefined;
}

/** Что раздел умеет сделать с выбранной деталью. */
export interface ProductionActions {
  /** Выбрать позицию деталировки. `undefined` — снять выбор. */
  readonly onSelectItem: (item: PartBOMItem | undefined) => void;
  /** Показать деталь в трёхмерной сцене (§31). */
  readonly onShowIn3d: (partId: PartId) => void;
  /** Открыть источник детали в конструкторе (§32). */
  readonly onShowInEditor: (nodeId: NodeId) => void;
  /** Перейти в другой раздел производства. */
  readonly onSection: (id: string) => void;
}

export interface SelectionState {
  readonly selectedItem: PartBOMItem | undefined;
  readonly trace: PartTrace | undefined;
  readonly compact: boolean;
}
