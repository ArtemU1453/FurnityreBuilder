import type {
  Box3,
  ConstructionScheme,
  EdgeSizingPolicy,
  Furniture,
  Issue,
  LeafFill,
  MaterialLibrary,
  NodeId,
  Part,
  Tolerances,
} from '../domain/index.js';
import type { BoundingBox } from './bounding-box.js';

/**
 * Вход геометрического движка. Полный и самодостаточный: движок ничего
 * не читает из глобального состояния, поэтому его можно вызвать в тесте,
 * в Web Worker или в генераторе экспорта одинаково.
 */
export interface GeometryInput {
  readonly furniture: Furniture;
  readonly scheme: ConstructionScheme;
  readonly tolerances: Tolerances;
  readonly materials: MaterialLibrary;
  readonly edgeSizing: EdgeSizingPolicy;
}

/**
 * Пространство ячейки: нужно интерфейсу для попадания указателя, подсветки
 * и технической отрисовки (docs/GEOMETRY_RULES.md §12).
 *
 * `nodeId` — он же стабильный идентификатор «ячейки» в терминах PROMPT 4:
 * отдельного строкового id вида `section-1-cell-2-3` не заводится, потому
 * что `LeafNode.id` уже является таким идентификатором и остаётся
 * неизменным между пересчётами, пока не меняется структура дерева
 * (docs/COORDINATE_SYSTEM.md, docs/DATA_MODEL.md §1.3). Второй, параллельный
 * id создавал бы два источника истины для одной и той же сущности.
 *
 * `row`/`column` — индекс среди соседей по ближайшему предку соответствующей
 * оси (0 при отсутствии такого предка), а не глобальные координаты сетки:
 * дерево не обязано быть прямоугольной сеткой целиком, поэтому «строка» и
 * «колонка» имеют смысл только локально, относительно места ячейки в дереве.
 *
 * `sectionId` — id ближайшей «секции»: ребёнка верхнего деления по оси X,
 * либо id корня, если верхнее деление отсутствует или идёт по оси Y
 * (тогда всё изделие — одна секция). Не хранится в домене отдельно —
 * выводится при обходе дерева, см. `stages/layout.ts`.
 */
export interface CellBox {
  readonly nodeId: NodeId;
  readonly box: Box3;
  readonly sectionId: NodeId;
  readonly row: number;
  readonly column: number;
  readonly fill: LeafFill;
}

/**
 * Результат расчёта.
 *
 * `pendingStages` — честная отметка о том, что часть конвейера ещё не
 * реализована. Результат без неё выглядел бы полным, хотя не является таковым;
 * это ровно тот способ соврать самим себе, которого проект избегает.
 */
export interface GeometryResult {
  readonly parts: readonly Part[];
  readonly cells: readonly CellBox[];
  /**
   * Заявленный габарит изделия по W/H/D — то, что ДОЛЖНО получиться.
   * Вырожден (нулевой) при фатальной ошибке входа: см. §"Аварийная остановка"
   * в docs/GEOMETRY_RULES.md.
   */
  readonly bounds: Box3;
  /** Внутренний объём корпуса, в котором раскладывается дерево секций. */
  readonly innerVolume: Box3;
  /** Измеренный охват реально построенных деталей. См. bounding-box.ts. */
  readonly boundingBox: BoundingBox;
  readonly diagnostics: readonly Issue[];
  readonly pendingStages: readonly string[];
}

export type StageStatus = 'implemented' | 'planned';

export interface StageDescriptor {
  readonly name: string;
  readonly status: StageStatus;
  /** Этап плана разработки, на котором этап конвейера будет реализован. */
  readonly plannedAt?: string;
}
