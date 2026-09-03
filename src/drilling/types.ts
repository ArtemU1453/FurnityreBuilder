import type {
  Axis,
  Furniture,
  DrillFace,
  DrillPurpose,
  Issue,
  MaterialLibrary,
  Mm,
  NodeId,
  PartId,
  Vec3,
} from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { HardwareBOM } from '../hardware/index.js';
import type { ProductionPart } from '../production/index.js';

/**
 * Присадка (PROMPT 18).
 *
 * ## Сверловка — производная, а не координаты, введённые руками
 *
 * Операция появляется потому, что в изделии есть петля, направляющая или
 * держатель полки, а не потому, что кто-то поставил точку на детали.
 * Отсюда цепочка `HardwareItem → DrillingRule → DrillingOperation`: у
 * каждого отверстия есть позиция фурнитуры, которая его потребовала.
 *
 * ## Локальные координаты — источник истины
 *
 * Операция хранит грань детали и координаты на ней (§4, §16). Мировая
 * точка вычисляется по требованию (`toWorld`) и нигде не хранится: деталь
 * переезжает при любом изменении габарита, и хранимая мировая координата
 * устаревала бы каждый раз.
 */

/** Направление сверления в мировых осях (§17). */
export interface DrillDirection {
  readonly axis: Axis;
  /** `+1` — вдоль оси, `−1` — против. */
  readonly sign: 1 | -1;
}

/** Сквозное или глухое (§18). У глухого глубина обязана быть меньше толщины. */
export type DrillThrough = 'through' | 'blind';

/**
 * Технологическая операция сверления.
 *
 * Собственных размеров мебели здесь нет (§2): ни ширины, ни высоты, ни
 * глубины детали. Всё это уже знает `ProductionPart`, на который операция
 * ссылается, — а два источника одного размера расходятся при первом же
 * изменении.
 */
export interface DrillingOperation {
  readonly id: string;
  readonly productionPartId: string;
  /** Физическая деталь конкретного экземпляра: начало трассируемости (§22). */
  readonly sourcePartId: PartId;
  /** Позиция фурнитуры, которая потребовала отверстие. */
  readonly sourceHardwareId?: string;
  /** Узел модели: створка, ящик, полка, ячейка. */
  readonly sourceNodeId?: NodeId;
  readonly purpose: DrillPurpose;
  readonly face: DrillFace;
  /** Координата вдоль первой оси грани, от её минимального угла. */
  readonly x: Mm;
  /** Координата вдоль второй оси грани. */
  readonly y: Mm;
  readonly diameter: Mm;
  readonly depth: Mm;
  readonly through: DrillThrough;
  readonly ruleId: string;
  readonly reason: string;
}

/** Мировая проекция операции: вычисляется, не хранится (§4, §16). */
export interface WorldHole {
  /** Центр отверстия на поверхности детали, в координатах изделия. */
  readonly point: Vec3;
  readonly direction: DrillDirection;
}

/** Статус правила — тот же словарь, что у правил фурнитуры (PROMPT 16 §27). */
export type DrillingRuleStatus = 'confirmed' | 'implemented' | 'ambiguous' | 'needs-confirmation';

export interface DrillingRuleResult {
  readonly operations: readonly DrillingOperation[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/**
 * Вход правила: готовая геометрия, производственные детали и уже
 * посчитанная спецификация фурнитуры. Правило ничего из этого не пересчитывает.
 */
export interface DrillingRuleContext {
  /**
   * Нормализованная модель. Нужна правилам не ради размеров (их даёт
   * геометрия), а ради КОНСТРУКТИВНЫХ СВЯЗЕЙ: какая створка несёт этот
   * способ открывания, какой ящик стоит в этой ячейке. Геометрия таких
   * связей не хранит — она хранит детали.
   */
  readonly furniture: Furniture;
  readonly geometry: GeometryResult;
  readonly productionParts: readonly ProductionPart[];
  readonly hardware: HardwareBOM;
  readonly materials: MaterialLibrary;
  readonly parameters: DrillingParameters;
  /** Производственная позиция и физическая деталь по её идентификатору. */
  readonly productionPartOf: (partId: PartId) => ProductionPart | undefined;
}

export interface DrillingRule {
  readonly id: string;
  readonly title: string;
  readonly status: DrillingRuleStatus;
  /** Идентификатор неизвестного из `docs/UNKNOWNS.json`, если статус его требует. */
  readonly unknownId?: string;
  run(ctx: DrillingRuleContext): DrillingRuleResult;
}

/** Итог расчёта (§21). */
export interface DrillingPlan {
  readonly operations: readonly DrillingOperation[];
  /** Операции по производственным деталям: полный набор для каждой детали. */
  readonly byProductionPart: ReadonlyMap<string, readonly DrillingOperation[]>;
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

// ── Параметры правил ─────────────────────────────────────────────────────────

/**
 * Технологические параметры присадки.
 *
 * Живут в КОДЕ, а не в файле проекта: это отраслевые нормы, а не выбор
 * пользователя. Все поля не заданы (`undefined`), потому что ни одно
 * значение референсом не подтверждено. Правило, у которого нет параметров,
 * не считает координаты, а сообщает, какой именно величины ему не хватает.
 *
 * Подставить сюда «обычные» 35 мм чашки петли значило бы выдать догадку за
 * производственное правило — ровно то, что §34 запрещает.
 */
export interface HingeDrillingParams {
  /** Диаметр чашки петли. */
  readonly cupDiameter: Mm;
  /** Глубина фрезерования чашки. */
  readonly cupDepth: Mm;
  /** Отступ центра чашки от края створки со стороны петель. */
  readonly cupInset: Mm;
  /** Отступ крайних петель от верха и низа створки. */
  readonly endOffset: Mm;
  /** Диаметр монтажных отверстий петли. */
  readonly mountDiameter: Mm;
  readonly mountDepth: Mm;
  /** Расстояние от центра чашки до монтажного отверстия. */
  readonly mountSpacing: Mm;
}

export interface SlideDrillingParams {
  /** Отступ первого отверстия от переднего торца боковины. */
  readonly frontOffset: Mm;
  /** Шаг отверстий вдоль направляющей. */
  readonly pitch: Mm;
  readonly holesPerSlide: number;
  readonly diameter: Mm;
  readonly depth: Mm;
}

export interface ShelfSupportDrillingParams {
  readonly diameter: Mm;
  readonly depth: Mm;
  /** Отступ отверстия от переднего и заднего торца боковины. */
  readonly setback: Mm;
}

export interface BackWallDrillingParams {
  readonly diameter: Mm;
  readonly depth: Mm;
  /** Шаг крепления по периметру. */
  readonly spacing: Mm;
  readonly edgeOffset: Mm;
}

export interface HandleDrillingParams {
  readonly diameter: Mm;
  /** Межцентровое расстояние крепёжных отверстий ручки. */
  readonly centerDistance: Mm;
  readonly holesPerHandle: number;
}

export interface DrillingParameters {
  readonly hinge?: HingeDrillingParams;
  readonly slide?: SlideDrillingParams;
  readonly shelfSupport?: ShelfSupportDrillingParams;
  readonly backWall?: BackWallDrillingParams;
  readonly handle?: HandleDrillingParams;
}

/**
 * Ни одного подтверждённого параметра. Это не заглушка «на потом», а
 * текущее состояние знаний: см. `docs/DRILLING_RULES.md`.
 */
export const EMPTY_DRILLING_PARAMETERS: DrillingParameters = {};

export const EMPTY_RULE_RESULT: DrillingRuleResult = { operations: [], warnings: [], errors: [] };

/** Стабильный id операции (§23): правило + источник + порядковый номер в нём. */
export function buildOperationId(ruleId: string, source: string, index: number): string {
  return `drill:${ruleId}/${source}/${String(index)}`;
}
