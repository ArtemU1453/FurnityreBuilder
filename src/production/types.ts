import type {
  EdgeSpec,
  Grain,
  Issue,
  MaterialId,
  Mm,
  NodeId,
  PartId,
  PartRole,
} from '../domain/index.js';

/**
 * Производственные детали и раскрой (PROMPT 17).
 *
 * ## Производственная деталь — не физическая
 *
 * `Part` описывает ОДИН физический объект в изделии: у него есть
 * положение в пространстве, ориентация пласти и происхождение. Он нужен,
 * чтобы нарисовать шкаф.
 *
 * `ProductionPart` описывает ПОЗИЦИЮ, которую надо изготовить: материал,
 * размер заготовки, кромка, количество. Пять одинаковых полок — это одна
 * производственная позиция с количеством 5, а не пять позиций (§22).
 * Именно поэтому источник у неё — СПИСОК деталей, а не одна деталь: иначе
 * четыре из пяти полок потеряли бы связь со своей ячейкой.
 *
 * ## Раскрой ничего не меняет
 *
 * Зависимость строго односторонняя (§25): раскрой читает детали, но не
 * пишет в них. Координаты раскладки живут в `CuttingPlacement`, а не в
 * `ProductionPart`, — иначе размер детали и её место на листе стали бы
 * двумя источниками одной истины.
 */

/**
 * Тип производственной детали. Это НЕ второй справочник ролей: значение
 * выводится из `PartRole` одной функцией (`productionTypeOf`) и существует
 * ради группировки и имён в спецификации.
 */
export type ProductionPartType =
  | 'side'
  | 'top'
  | 'bottom'
  | 'partition'
  | 'shelf'
  | 'back'
  | 'plinth'
  | 'countertop'
  | 'facade'
  | 'drawer-box'
  | 'false-panel'
  | 'other';

/**
 * Статус физического объекта (§5).
 *
 * `physical` — деталь, которую пилят из листа. `hardware` — покупная
 * фурнитура: ручка и push-механизм существуют как `Part` только ради
 * положения на схеме, изготавливать их нельзя. Отдельного поля в `Part`
 * для этого не заводится: `PartRole` уже отвечает на вопрос однозначно, и
 * второе поле пришлось бы синхронизировать с первым.
 */
export type PartNature = 'physical' | 'hardware';

/** Производственная позиция: что изготовить и в каком количестве. */
export interface ProductionPart {
  readonly id: string;
  /**
   * Источники позиции — по одному на каждый экземпляр, в порядке
   * размещения. `sourcePartIds[i]` — деталь, из которой получен i-й
   * экземпляр, и по ней проходит трассируемость до ячейки (§24).
   */
  readonly sourcePartIds: readonly PartId[];
  /** Узлы модели, породившие детали: ячейка, полка, створка, ящик. */
  readonly sourceNodeIds: readonly NodeId[];
  readonly name: string;
  readonly partType: ProductionPartType;
  readonly role: PartRole;
  readonly materialId: MaterialId;
  readonly thickness: Mm;
  /** Длина заготовки — вдоль текстуры, если она есть. */
  readonly length: Mm;
  readonly width: Mm;
  /** Равно `sourcePartIds.length`; проверяется валидацией. */
  readonly quantity: number;
  readonly grain: Grain;
  readonly edgeBanding: EdgeSpec;
  readonly rotationAllowed: boolean;
}

/** Группа совместимых деталей (§11, §13). */
export interface CuttingGroup {
  readonly id: string;
  readonly materialId: MaterialId;
  readonly materialName: string;
  readonly thickness: Mm;
  readonly grain: Grain;
  readonly parts: readonly ProductionPart[];
}

/** Заготовка: лист материала с рабочей областью (§12). */
export interface CuttingStock {
  readonly id: string;
  readonly materialId: MaterialId;
  readonly thickness: Mm;
  readonly length: Mm;
  readonly width: Mm;
  readonly kerf: Mm;
  readonly trimLeft: Mm;
  readonly trimRight: Mm;
  readonly trimTop: Mm;
  readonly trimBottom: Mm;
}

/** Рабочая область листа: лист минус обрезная кромка (§17). */
export interface UsableStockArea {
  readonly x: Mm;
  readonly y: Mm;
  readonly length: Mm;
  readonly width: Mm;
}

/** Размещение одного экземпляра детали на листе (§14). */
export interface CuttingPlacement {
  readonly id: string;
  readonly productionPartId: string;
  /** Какой именно экземпляр позиции размещён: 0-based, < quantity. */
  readonly instanceIndex: number;
  /** Физическая деталь этого экземпляра — начало цепочки трассируемости. */
  readonly sourcePartId: PartId;
  readonly x: Mm;
  readonly y: Mm;
  /** Габарит НА ЛИСТЕ: при повороте длина и ширина уже переставлены. */
  readonly width: Mm;
  readonly height: Mm;
  readonly rotation: 0 | 90;
}

/** Почему экземпляр не размещён (§20). */
export type UnplacedReason = 'TOO_LARGE' | 'NO_SPACE' | 'INVALID_STOCK' | 'INVALID_DIMENSIONS';

export interface UnplacedPart {
  readonly productionPartId: string;
  readonly instanceIndex: number;
  readonly sourcePartId: PartId;
  readonly reason: UnplacedReason;
  readonly detail: string;
}

/** Раскладка на одном листе (§14, §21). */
export interface CuttingLayout {
  readonly id: string;
  readonly stockId: string;
  readonly stock: CuttingStock;
  readonly placements: readonly CuttingPlacement[];
  /** Сумма площадей размещённых деталей. */
  readonly usedArea: number;
  /** Полная площадь листа. */
  readonly stockArea: number;
  /** Площадь рабочей области: лист минус обрезная кромка. */
  readonly usableArea: number;
  /** `stockArea − usedArea`: всё, что не стало деталью. */
  readonly wasteArea: number;
  /** `usedArea / stockArea`, 0…1. */
  readonly utilization: number;
  readonly warnings: readonly Issue[];
}

/** Итог расчёта раскроя всего проекта. */
export interface CuttingResult {
  readonly productionParts: readonly ProductionPart[];
  readonly groups: readonly CuttingGroup[];
  readonly layouts: readonly CuttingLayout[];
  readonly unplaced: readonly UnplacedPart[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}
