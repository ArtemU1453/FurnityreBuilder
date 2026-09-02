import type {
  Box3,
  ConstructionScheme,
  EdgeSizingPolicy,
  Furniture,
  Issue,
  MaterialLibrary,
  NodeId,
  Part,
  Tolerances,
} from '../domain/index.js';

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

/** Пространство ячейки: нужно интерфейсу для попадания указателя и подсветки. */
export interface CellBox {
  readonly nodeId: NodeId;
  readonly box: Box3;
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
  /** Габарит изделия целиком. */
  readonly bounds: Box3;
  /** Внутренний объём корпуса, в котором раскладывается дерево секций. */
  readonly innerVolume: Box3;
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
