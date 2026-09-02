import type { SplitAxis } from '../coordinates.js';
import type { FurnitureId, MaterialId, NodeId } from '../ids.js';
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

export interface BaseSpec {
  readonly kind: 'plinth' | 'legs' | 'none';
  readonly height: Mm;
  /** ASSUMPTION(T-OFF-01): отступ цоколя вглубь от плоскости фасада. */
  readonly setback: Mm;
  readonly legCount?: number;
}

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

export interface CarcassSpec {
  readonly hasTop: boolean;
  readonly hasBottom: boolean;
  readonly back: BackPanelSpec;
  readonly base?: BaseSpec;
  readonly countertop?: CountertopSpec;
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

export interface DrawerFacadeSpec {
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
}

export interface Drawer {
  readonly id: NodeId;
  readonly size: SizeSpec;
  readonly slide: SlideSpec;
  readonly box: DrawerBoxSpec;
  readonly facade: DrawerFacadeSpec;
  /** null — PUSH-открывание вместо ручки. */
  readonly handle?: HandleSpec | null;
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
  readonly handle?: HandleSpec | null;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
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

/** Фасад может закрывать несколько ячеек, поэтому он не принадлежит ячейке. */
export interface FacadeGroup {
  readonly id: NodeId;
  readonly covers: FacadeCoverage;
  readonly type: FacadeType;
  readonly leaves: readonly FacadeLeaf[];
  readonly overlay: OverlaySpec;
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
