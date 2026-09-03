import type {
  Box3,
  ConstructionScheme,
  EdgeSizingPolicy,
  Furniture,
  Issue,
  LeafFill,
  MaterialLibrary,
  Mm,
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
 * Секция как геометрическая область корпуса (PROMPT 7 §9–10).
 *
 * До этого этапа секция существовала только как строка `sectionId` на
 * ячейке, а её границы приходилось восстанавливать агрегированием ячеек —
 * в том числе в рендерере, куда мебельным формулам путь закрыт
 * (docs/ARCHITECTURE.md §1). Теперь границы считает движок, один раз,
 * в том же месте, где решается принадлежность ячейки секции
 * (`sectionIdFor` в `stages/layout.ts`) — второго определения «где секция»
 * в проекте не появляется.
 *
 * `box` И ЕСТЬ шесть границ из задания §9: `min` — левая/нижняя/задняя,
 * `min + size` — правая/верхняя/передняя. Отдельной физической детали
 * ни для одной границы не создаётся: границей служит либо уже
 * существующая деталь (боковина, перегородка, дно, крышка), либо
 * геометрическая плоскость внутреннего объёма.
 *
 * `width` не хранится: это `box.size.x` (PROMPT 7 §10 — производная
 * величина, а не поле).
 */
export interface SectionBox {
  readonly nodeId: NodeId;
  /** Порядковый номер слева направо, от 0. Только для подписи «SECTION N». */
  readonly index: number;
  readonly box: Box3;
}

/**
 * Конструктивная сводка изделия (PROMPT 15 §16): полосы вертикального
 * бюджета и режим установки.
 *
 * Существует ради debug-схемы, которой нужно показать зазор до потолка,
 * антресоль и режим крепления — величины, у которых нет собственных
 * деталей. Рендерер при этом остаётся чистым: он читает уже посчитанное
 * движком, а не лезет в `Furniture` мимо геометрии
 * (`docs/ARCHITECTURE.md` §1).
 */
export interface StructureSummary {
  readonly plinthHeight: Mm;
  readonly carcassY0: Mm;
  readonly carcassHeight: Mm;
  readonly countertopThickness: Mm;
  readonly topSectionHeight: Mm;
  readonly topSectionGap: Mm;
  readonly ceilingGap: Mm;
  readonly totalTop: Mm;
  readonly wallMount: 'floor-standing' | 'wall-mounted' | 'suspended';
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
  /** Секции корпуса слева направо. См. `SectionBox`. */
  readonly sections: readonly SectionBox[];
  /**
   * Измеренный физический охват построенного корпуса — НЕ буквальная копия
   * входных `width`/`height`/`depth`. По X и Y всегда совпадает с `W`/`H`.
   * По Z совпадает с `D` только когда `tolerances.depthIncludesBackPanel`
   * истинно (или задней стенки нет); если ложно — `bounds.size.z = D + Tb`,
   * потому что начало координат — задняя плоскость изделия ЦЕЛИКОМ, включая
   * стенку (docs/COORDINATE_SYSTEM.md §3), а `D` в этом случае описывает
   * только глубину корпуса, не считая стенки поверх него. Формула и тест —
   * docs/GEOMETRY_RULES.md, раздел «Carcass Calculation Rules» (`overallDepth`),
   * PROMPT 5 аудит. Вырожден (нулевой) при фатальной ошибке входа: см.
   * §«Аварийная остановка» в docs/GEOMETRY_RULES.md.
   */
  readonly bounds: Box3;
  /** Внутренний объём корпуса, в котором раскладывается дерево секций. */
  readonly innerVolume: Box3;
  /** Измеренный охват реально построенных деталей. См. bounding-box.ts. */
  readonly boundingBox: BoundingBox;
  /** Конструктивная сводка: полосы по вертикали и режим установки. */
  readonly structure: StructureSummary;
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
