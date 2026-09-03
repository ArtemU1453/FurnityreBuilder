import type { SplitAxis } from '../coordinates.js';
import type { FurnitureId, MaterialId, NodeId, WallId } from '../ids.js';
import type { Mm } from '../units.js';
import type { EdgeSpec } from '../materials/types.js';

/** Влияет только на пресеты и подсказки. Геометрия для всех видов одна. */
export type FurnitureKind = 'wardrobe' | 'shelving' | 'cabinet' | 'dresser';

export interface Dimensions {
  /** W — габарит по X. */
  readonly width: Mm;
  /** H — габарит по Y. */
  readonly height: Mm;
  /** D — габарит по Z. */
  readonly depth: Mm;
  /** T — толщина основного корпусного материала. */
  readonly panelThickness: Mm;
}

/**
 * Что входит в габарит. Это параметры, а не догадки: конвенции референса
 * не установлены (см. реестр docs/UNKNOWNS.json), поэтому выбор остаётся
 * явным и видимым.
 */
export interface Tolerances {
  /** ASSUMPTION(T-CAR-04): входит ли толщина задней стенки в габаритную глубину D. */
  readonly depthIncludesBackPanel: boolean;
  /** ASSUMPTION(T-DOOR-02): входят ли накладные фасады в габаритную глубину D. */
  readonly depthIncludesFacade: boolean;
  /** ASSUMPTION(T-CAR-05): входит ли цоколь в габаритную высоту H. */
  readonly heightIncludesBase: boolean;
}

export type BackPanelMount =
  | { readonly kind: 'none' }
  | { readonly kind: 'overlay'; readonly thickness: Mm }
  | {
      readonly kind: 'inset-groove';
      readonly thickness: Mm;
      readonly grooveDepth: Mm;
      readonly grooveOffsetFromRear: Mm;
    }
  | { readonly kind: 'inset-flush'; readonly thickness: Mm };

export type JointType = 'confirmat' | 'eccentric' | 'dowel' | 'eccentric+dowel';

/**
 * Схема сборки каркаса — центральная параметризация проекта.
 *
 * Снимает 9 из 59 неизвестных функциональной спецификации: вместо выдуманной
 * формулы модель хранит схему стыка, а геометрия выводится из неё. Когда
 * тест T-CAR-01 будет проведён, меняется значение по умолчанию, а не алгоритм.
 *
 *   sides-through        боковины сквозные, горизонтали между ними
 *   horizontals-through  верх и низ сквозные, боковины между ними
 *   mixed                по флагам topOverlaysSides / bottomOverlaysSides
 */
export type VerticalPriority = 'sides-through' | 'horizontals-through' | 'mixed';

export interface ConstructionScheme {
  readonly verticalPriority: VerticalPriority;
  readonly topOverlaysSides: boolean;
  readonly bottomOverlaysSides: boolean;
  readonly jointType: JointType;
}

export interface BackPanelSpec {
  readonly mount: BackPanelMount;
  readonly materialId: MaterialId;
  /** ASSUMPTION(T-CAR-04): одна панель на изделие или своя на каждую секцию. */
  readonly segmentation: 'single' | 'per-section';
}

/**
 * Вырез цоколя (PROMPT 14 §11): участок передней царги, вырезанный под
 * ноги или под трубы. Заданы боковые отступы выреза от краёв цоколя и его
 * высота от пола; глубина выреза равна глубине самой царги и отдельным
 * параметром не заводится.
 *
 * `ASSUMPTION(T-BASE-02)`: ни наличие выреза, ни его размеры референсом не
 * подтверждены — модель параметрическая, значений по умолчанию нет
 * (`cutout` не задан = выреза нет).
 */
export interface PlinthCutout {
  /** Отступ выреза от левого края цоколя. */
  readonly left: Mm;
  /** Отступ выреза от правого края цоколя. */
  readonly right: Mm;
  /** Высота выреза от пола. Должна быть меньше высоты цоколя. */
  readonly height: Mm;
}

export interface BaseSpec {
  readonly kind: 'plinth' | 'legs' | 'none';
  readonly height: Mm;
  /** ASSUMPTION(T-OFF-01): отступ цоколя вглубь от плоскости фасада. */
  readonly setback: Mm;
  readonly legCount?: number;
  /**
   * Из каких царг собран цоколь (PROMPT 14 §12). Пустой массив — цоколь
   * есть как высота, но деталей не даёт: конструкция цоколя референсом не
   * подтверждена (`ASSUMPTION(T-BASE-01)`), поэтому боковые царги не
   * появляются сами собой — их наличие задаёт пользователь.
   */
  readonly parts?: readonly PlinthPartKind[];
  readonly cutout?: PlinthCutout;
  /** Материал цоколя. Не задан — материал роли `plinth` (PROMPT 13 §9). */
  readonly materialId?: MaterialId;
  /** Толщина царги. Не задана — толщина материала, затем толщина корпуса. */
  readonly thickness?: Mm;
  readonly edge?: EdgeSpec;
}

/** Какие царги цоколя строятся физически (PROMPT 14 §12). */
export type PlinthPartKind = 'front' | 'left' | 'right' | 'rear';

export interface CountertopSpec {
  readonly thickness: Mm;
  /** ASSUMPTION(T-CAR-06): свесы столешницы. */
  readonly overhangFront: Mm;
  readonly overhangLeft: Mm;
  readonly overhangRight: Mm;
  readonly overhangBack: Mm;
  readonly materialId: MaterialId;
  readonly edge: EdgeSpec;
}

/**
 * Куда применяется конструктивный свес (PROMPT 15 §4).
 *
 * Свес НЕ распространяется на все детали автоматически: `appliesTo`
 * перечисляет цели явно. `ASSUMPTION(T-MOD-01)` — применимость референсом
 * не подтверждена, поэтому угадывать её за пользователя нельзя.
 */
export type OverhangTarget = 'top' | 'bottom' | 'countertop';

/**
 * Свес детали за габарит корпуса, по четырём сторонам (PROMPT 15 §4).
 *
 * Четыре стороны, а не шесть: «свес вверх» и «свес вниз» у горизонтальной
 * детали — это её толщина и положение, которые уже заданы в другом месте
 * (`Dimensions.panelThickness`, вертикальная раскладка §23.1). Заводить их
 * ещё и здесь означало бы два источника одного размера.
 *
 * Значения неотрицательные и отсчитываются НАРУЖУ от габарита корпуса:
 * отрицательный свес (утопление) референсом не подтверждён и не заводится.
 */
export interface OverhangSpec {
  readonly front: Mm;
  readonly back: Mm;
  readonly left: Mm;
  readonly right: Mm;
  readonly appliesTo: readonly OverhangTarget[];
}

/**
 * Верхняя секция (антресоль) — вторая оболочка НАД основным корпусом
 * (PROMPT 15 §5), а не отдельное изделие: ширину и глубину она берёт у
 * того же `Furniture`, строится теми же формулами каркаса и входит в тот
 * же вертикальный бюджет высоты.
 *
 * `ASSUMPTION(T-MOD-02)`: собственные ли у неё дно и боковины — не
 * подтверждено; реализована как полноценная оболочка с необязательным
 * зазором до основного корпуса.
 */
export interface TopSectionSpec {
  readonly height: Mm;
  /** Зазор между верхом основного корпуса и низом антресоли. */
  readonly gap: Mm;
  readonly materialId?: MaterialId;
  readonly hasTop: boolean;
  readonly hasBottom: boolean;
}

/** Как изделие установлено (PROMPT 15 §8). `ASSUMPTION(T-MOD-04)`. */
export type WallMountMode = 'floor-standing' | 'wall-mounted' | 'suspended';

/**
 * Крепление к стене — конструктивное СОСТОЯНИЕ модели (PROMPT 15 §8).
 * Собственной геометрии не даёт: точки крепления, планки и крепёж — это
 * фурнитура, которая на этом этапе не реализуется. Стена, к которой
 * привязано изделие, указывается уже существующим `WallId` из `Room`,
 * второй системы помещения не заводится.
 */
export interface WallMountSpec {
  readonly mode: WallMountMode;
  readonly wallId?: WallId;
  /** Высота низа изделия над полом для подвесного режима. */
  readonly elevation?: Mm;
}

/** Где стоит фальшпанель относительно корпуса. `ASSUMPTION(T-MOD-05)`. */
export type FalsePanelPosition = 'left' | 'right' | 'top' | 'bottom';

/**
 * Фальшпанель — физическая деталь, закрывающая зазор между корпусом и
 * стеной или потолком (PROMPT 15 §9). Собственных мировых координат не
 * хранит: положение выводится из `position` и габарита корпуса, размеры —
 * из `width`/`height`/`depth`, если заданы, иначе из габарита корпуса.
 */
export interface FalsePanel {
  readonly id: NodeId;
  readonly position: FalsePanelPosition;
  /** Ширина панели вдоль её длинной стороны. Не задана — габарит корпуса. */
  readonly width?: Mm;
  readonly height?: Mm;
  readonly depth?: Mm;
  readonly materialId?: MaterialId;
  readonly thickness?: Mm;
  readonly edge?: EdgeSpec;
  /** Отступ от края корпуса вдоль оси установки. */
  readonly offset?: Mm;
}

/**
 * Конструктивная конфигурация корпуса.
 *
 * Отдельного типа `StructuralModifier` не заведено (PROMPT 15 §3): им уже
 * является сам `CarcassSpec` — он держит все конструктивные параметры
 * изделия вместе с PROMPT 1 и был назван конструктивной конфигурацией ещё
 * на PROMPT 14 (`docs/DATA_MODEL.md` §8.1). Список модификаторов с
 * `{id, type, config}` рядом с уже типизированными полями означал бы два
 * способа описать одно и то же и потерю типизации: `config` пришлось бы
 * делать нетипизированным union'ом.
 */
export interface CarcassSpec {
  readonly hasTop: boolean;
  readonly hasBottom: boolean;
  readonly back: BackPanelSpec;
  readonly base?: BaseSpec;
  readonly countertop?: CountertopSpec;
  readonly overhang?: OverhangSpec;
  readonly topSection?: TopSectionSpec;
  /** Пустое место между верхом изделия и потолком, внутри габарита H. */
  readonly ceilingGap?: Mm;
  readonly wallMount?: WallMountSpec;
  readonly falsePanels?: readonly FalsePanel[];
}

// ── Внутреннее пространство: дерево секций ───────────────────────────────────

/**
 * Размер ребёнка в делении.
 *
 * Прямой ответ на UNKNOWN T-DIM-04 («как ведут себя ячейки при изменении
 * габарита»): вместо угадывания поведение выбирает пользователь.
 *   fixed — ячейка держит абсолютный размер
 *   flex  — делит остаток пропорционально весу
 */
export type SizeSpec =
  | { readonly mode: 'fixed'; readonly value: Mm }
  | { readonly mode: 'flex'; readonly weight: number };

export interface DividerSpec {
  /** 'none' — логическое деление без физической детали. */
  readonly material: 'panel' | 'none';
  readonly thickness: Mm;
  readonly mounting: 'fixed' | 'adjustable';
  /** ASSUMPTION(T-SHF-01): насколько разделитель не доходит до фасада. */
  readonly frontSetback: Mm;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
}

export type ShelfPlacement =
  | { readonly mode: 'auto'; readonly index: number; readonly count: number }
  | { readonly mode: 'manual'; readonly offsetFromBottom: Mm };

export interface Shelf {
  readonly id: NodeId;
  readonly placement: ShelfPlacement;
  readonly mounting: 'adjustable' | 'fixed';
  readonly thickness?: Mm;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
  /** ASSUMPTION(T-SHF-01): отступ передней кромки от плоскости фасада. */
  readonly frontSetback?: Mm;
}

export type SlideType = 'roller' | 'ball-full' | 'ball-partial' | 'hidden-soft-close';

export interface SlideSpec {
  readonly type: SlideType;
  /** INDUSTRY: ряд 250…600 шаг 50. ASSUMPTION(T-DRW-03): точный ряд не подтверждён. */
  readonly nominalLength: Mm;
  /** ASSUMPTION(T-DRW-02): зазор с каждой стороны между коробом и стенкой проёма. */
  readonly sideClearance: Mm;
}

export interface DrawerBoxSpec {
  readonly sideHeight: Mm;
  readonly bottom: {
    /** ASSUMPTION(T-DRW-02): дно в паз или прибитое снизу. */
    readonly mount: 'groove' | 'nailed-under';
    readonly thickness: Mm;
    readonly grooveDepth?: Mm;
    readonly grooveOffsetFromBottom?: Mm;
  };
  readonly materialId?: MaterialId;
}

export interface HandleSpec {
  readonly kind: 'bar' | 'knob' | 'profile' | 'recessed';
  readonly lengthMm?: Mm;
}

/**
 * Положение ручки на фасаде (PROMPT 12 §5) — параметрическая модель,
 * а не мировые координаты: `Handle.x = 742` не заводится нигде, только
 * якорь и отступы, которые резолвер применяет к уже вычисленному объёму
 * фасада (`resolveOpeningSystemGeometry`, `src/geometry/opening-system.ts`).
 * Все значения — `ASSUMPTION(T-HW-06)`, референс не подтвердил ни одного.
 */
export interface HandlePlacement {
  /** Край фасада, от которого считается `offsetY`. */
  readonly anchor: 'top' | 'bottom' | 'center';
  /**
   * Край фасада, от которого считается `offsetX` — НЕ всегда левый: для
   * двери сторона обычно противоположна петлям, поэтому фиксированный
   * «от левого края» неверно пересчитывался бы при смене `hingeSide` или
   * при отражении двери. `side` делает эту зависимость явной без второго
   * параметра позиции.
   */
  readonly side: 'left' | 'right' | 'center';
  /** Отступ от `side` вдоль ширины фасада. */
  readonly offsetX: Mm;
  /** Отступ от `anchor` вдоль высоты фасада. */
  readonly offsetY: Mm;
  /** Вынос ручки вперёд от плоскости фасада (стандофф). */
  readonly offsetZ: Mm;
  readonly orientation: 'horizontal' | 'vertical';
}

/**
 * Push-to-open (PROMPT 12 §7) — только логическая модель и точка установки,
 * без механики: `mechanismType` ограничен уже существующим
 * `HardwareKind` (`push-latch`, `src/domain/hardware/types.ts`), вторая
 * фурнитурная система не заводится.
 */
export interface PushToOpenConfig {
  readonly mechanismType: 'push-latch';
  /** Переиспользован тот же offset-тип, что и у ручки: не вторая модель позиции. */
  readonly position: HandlePlacement;
  /** Требуемый зазор для срабатывания механизма. `ASSUMPTION(T-HW-07)`. */
  readonly clearance: Mm;
}

/**
 * Способ открывания фасада (PROMPT 12 §2). Заменяет прежнее
 * `handle?: HandleSpec | null`, где `null` неявно означал push-to-open —
 * тот самый `hasHandle`-подобный магический флаг, которого PROMPT 12
 * прямо просит избегать. Дискриминант `kind` делает три состояния явными:
 * `none` (нет ни ручки, ни push-to-open), `handle`, `push-to-open`.
 *
 * `id` у `handle`/`push-to-open` — их собственная стабильная идентичность
 * (тот же `NodeId`, что у `Shelf.id`/`Drawer.id`/`FacadeLeaf.id`), не
 * зависящая от пересчёта геометрии.
 */
export type OpeningSystem =
  | { readonly kind: 'none' }
  | { readonly kind: 'handle'; readonly id: NodeId; readonly handle: HandleSpec; readonly placement: HandlePlacement }
  | { readonly kind: 'push-to-open'; readonly id: NodeId; readonly pushToOpen: PushToOpenConfig };

export interface DrawerFacadeSpec {
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
  /** Не задана — толщина корпуса, тот же приоритет, что у `FacadeLeaf.thickness` (PROMPT 10). */
  readonly thickness?: Mm;
  /**
   * Зазоры фасада ящика. Не задан — берётся `DEFAULT_OVERLAY` (PROMPT 11,
   * `ASSUMPTION(T-DRW-04)`): второй тип зазоров для ящиков не заводится,
   * переиспользуется `OverlaySpec`, уже существующий для фасадов дверей —
   * тот же физический смысл (зазор между соседними фасадами и по периметру
   * ячейки), только для стопки фасадов ящиков, а не створок двери. Если
   * ящиков в ячейке несколько, стопку целиком задаёт `overlay` ПЕРВОГО
   * ящика — тот же приоритет, что у `Shelf.thickness` внутри одной
   * auto-группы полок (`docs/GEOMETRY_RULES.md` §14).
   */
  readonly overlay?: OverlaySpec;
  /**
   * Способ открывания (PROMPT 12). Не задан — `{kind: 'none'}`. Живёт на
   * фасаде, а не на `Drawer` целиком (было `Drawer.handle`, до PROMPT 12):
   * ручка/push-to-open — свойство ВИДИМОЙ передней панели, а не короба.
   */
  readonly opening?: OpeningSystem;
}

export interface Drawer {
  readonly id: NodeId;
  readonly size: SizeSpec;
  readonly slide: SlideSpec;
  readonly box: DrawerBoxSpec;
  readonly facade: DrawerFacadeSpec;
}

export interface HangingRod {
  readonly id: NodeId;
  readonly profile: 'round-25' | 'oval-30x15';
  /** ASSUMPTION(T-HW-05): отступ от верха ячейки под плечики. */
  readonly offsetFromTop: Mm;
  /** ASSUMPTION(T-HW-05): отступ от фасада. */
  readonly offsetFromFront: Mm;
  readonly mount: 'flange' | 'endcap';
}

/**
 * Наполнение листовой ячейки.
 * Смешанные случаи (полки + ящики) выражаются делением ячейки по Y,
 * а не флагами внутри одной ячейки — так представление остаётся единственным.
 */
export type LeafFill =
  | { readonly kind: 'empty' }
  | { readonly kind: 'shelves'; readonly shelves: readonly Shelf[] }
  | { readonly kind: 'drawers'; readonly drawers: readonly Drawer[] }
  | { readonly kind: 'rod'; readonly rod: HangingRod }
  | { readonly kind: 'rod+shelf'; readonly rod: HangingRod; readonly shelfAbove: Shelf };

export interface LeafNode {
  readonly id: NodeId;
  readonly kind: 'leaf';
  readonly fill: LeafFill;
}

export interface SectionChild {
  readonly size: SizeSpec;
  readonly node: SectionNode;
}

export interface SplitNode {
  readonly id: NodeId;
  readonly kind: 'split';
  /** 'x' — колонки (вертикальные стойки), 'y' — строки (горизонтальные разделители). */
  readonly axis: SplitAxis;
  readonly divider: DividerSpec;
  readonly children: readonly SectionChild[];
}

/**
 * Дерево, а не плоская сетка: в шкафу левая колонка может делиться на 5 полок,
 * а правая — на штангу и ящики, причём ящичная зона делится дальше.
 * Дерево — надмножество сетки, поэтому ничего не теряет.
 */
export type SectionNode = SplitNode | LeafNode;

// ── Фасады ───────────────────────────────────────────────────────────────────

export type FacadeType = 'hinged' | 'sliding' | 'folding' | 'lift';

export type HingeSide = 'left' | 'right' | 'top' | 'bottom' | 'none';

export interface FacadeLeaf {
  readonly id: NodeId;
  readonly size: SizeSpec;
  readonly hingeSide: HingeSide;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
  /**
   * Толщина створки. Если не задана — толщина корпуса
   * (`Dimensions.panelThickness`), тот же приоритет, что у `Shelf.thickness`
   * (`docs/GEOMETRY_RULES.md` §9.4): своя толщина переопределяет общую,
   * а не заводит отдельное умолчание.
   */
  readonly thickness?: Mm;
  /** Способ открывания (PROMPT 12). Не задан — `{kind: 'none'}`. Было `handle?: HandleSpec | null` до PROMPT 12 — см. `OpeningSystem`. */
  readonly opening?: OpeningSystem;
}

export interface OverlaySpec {
  /** ASSUMPTION(T-DOOR-02): накладной поверх корпуса или вкладной в проём. */
  readonly mode: 'overlay' | 'inset';
  /** ASSUMPTION(T-DOOR-02): все зазоры не подтверждены, вынесены в настройки. */
  readonly gapBetweenLeaves: Mm;
  readonly gapTop: Mm;
  readonly gapBottom: Mm;
  readonly gapSide: Mm;
}

export type FacadeCoverage =
  | { readonly kind: 'node'; readonly nodeId: NodeId }
  | { readonly kind: 'carcass' };

/**
 * Контракт конфигурации купе — типизирован, но геометрия не реализована (PROMPT 10 §9).
 * Все поля не подтверждены (`UNKNOWN T-DOOR-01`): наличие вида купе в этом
 * инструменте, число направляющих, величина нахлёста створок, вынос створки
 * от плоскости фасада и число створок — ни одно значение не имеет
 * источника, поэтому не читается ни одним резолвером и не влияет на
 * `GeometryResult`. Поле существует, чтобы место в модели было готово,
 * когда T-DOOR-01 будет подтверждён, без переработки `FacadeGroup`.
 */
export interface SlidingDoorConfig {
  /** Число направляющих (обычно 2 или 3). UNKNOWN: T-DOOR-01 */
  readonly trackCount: number;
  /** Нахлёст соседних створок купе. UNKNOWN: T-DOOR-01 */
  readonly overlap: Mm;
  /** Вынос створки вперёд от плоскости корпуса. UNKNOWN: T-DOOR-01 */
  readonly frontOffset: Mm;
  /** Число створок купе (может отличаться от числа направляющих). UNKNOWN: T-DOOR-01 */
  readonly doorCount: number;
}

/** Фасад может закрывать несколько ячеек, поэтому он не принадлежит ячейке. */
export interface FacadeGroup {
  readonly id: NodeId;
  readonly covers: FacadeCoverage;
  readonly type: FacadeType;
  readonly leaves: readonly FacadeLeaf[];
  readonly overlay: OverlaySpec;
  /** Только для `type: 'sliding'`. Архитектурный контракт, не геометрия — см. `SlidingDoorConfig`. */
  readonly slidingConfig?: SlidingDoorConfig;
}

// ── Изделие ──────────────────────────────────────────────────────────────────

export interface Placement {
  readonly origin: { readonly x: Mm; readonly z: Mm };
  /** Поворот вокруг вертикальной оси, градусы. */
  readonly rotationDeg: number;
}

export interface Furniture {
  readonly id: FurnitureId;
  readonly name: string;
  readonly kind: FurnitureKind;
  readonly dimensions: Dimensions;
  readonly carcass: CarcassSpec;
  readonly root: SectionNode;
  readonly facades: readonly FacadeGroup[];
  readonly placement?: Placement;
}
