import type { IdFactory, MaterialId, NodeId } from '../ids.js';
import { DEFAULT_EDGE } from '../materials/defaults.js';
import type {
  BackPanelMount,
  CarcassSpec,
  ConstructionScheme,
  Dimensions,
  DividerSpec,
  Drawer,
  DrawerBoxSpec,
  FacadeGroup,
  FacadeLeaf,
  Furniture,
  HingeSide,
  LeafNode,
  OverlaySpec,
  Shelf,
  SlideSpec,
  Tolerances,
} from './types.js';

/**
 * ASSUMPTION(T-CAR-01): боковины сквозные, горизонтали между ними —
 * наиболее распространённая практика для шкафов. Схема референса не установлена.
 */
export const DEFAULT_SCHEME: ConstructionScheme = {
  verticalPriority: 'sides-through',
  topOverlaysSides: false,
  bottomOverlaysSides: false,
  jointType: 'confirmat',
};

/** ASSUMPTION(T-CAR-04): накладная задняя стенка 3 мм, входящая в габаритную глубину. */
export const DEFAULT_BACK_MOUNT: BackPanelMount = { kind: 'overlay', thickness: 3 };

export const DEFAULT_TOLERANCES: Tolerances = {
  depthIncludesBackPanel: true,
  depthIncludesFacade: false,
  heightIncludesBase: true,
};

/**
 * ASSUMPTION(T-DRW-02): шариковые направляющие полного выдвижения,
 * зазор 13 мм с каждой стороны — самый распространённый стандарт.
 */
export const DEFAULT_SLIDE: SlideSpec = {
  type: 'ball-full',
  nominalLength: 450,
  sideClearance: 13,
};

/** ASSUMPTION(T-DOOR-02): накладные фасады, зазор 3 мм между створками. */
export const DEFAULT_OVERLAY: OverlaySpec = {
  mode: 'overlay',
  gapBetweenLeaves: 3,
  gapTop: 2,
  gapBottom: 2,
  gapSide: 2,
};

/** Минимальный размер ячейки, ниже которого выдаётся предупреждение. */
export const MIN_CELL_SIZE = 50;

/** ASSUMPTION(T-DIM-01): границы референса не установлены, пороги мягкие. */
export const DIMENSION_LIMITS = {
  width: { min: 100, max: 6000 },
  height: { min: 100, max: 3000 },
  depth: { min: 80, max: 1200 },
  panelThickness: { min: 8, max: 40 },
} as const;

export const DEFAULT_DIMENSIONS: Dimensions = {
  width: 1000,
  height: 2000,
  depth: 500,
  panelThickness: 16,
};

export function createDividerSpec(thickness: number, materialId?: MaterialId): DividerSpec {
  return {
    material: 'panel',
    thickness,
    mounting: 'fixed',
    frontSetback: 0,
    ...(materialId === undefined ? {} : { materialId }),
    edge: DEFAULT_EDGE,
  };
}

export function createEmptyLeaf(ids: IdFactory): LeafNode {
  return { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'empty' } };
}

/**
 * Лист с `count` равномерно распределёнными полками (PROMPT 6).
 *
 * Аналог `createDividerSpec`/`createSections`: чистая фабрика домена, а не
 * формула геометрического движка. `frontSetback: 0` — то же значение по
 * умолчанию, что и у `createDividerSpec` (ASSUMPTION T-SHF-01: «полка
 * встаёт впритык, отступ от фасада 0», `docs/UNKNOWNS.json`).
 * `thickness`/`materialId` не заданы намеренно — движок берёт толщину
 * корпуса и материал по роли, как и для перегородок (§9.5
 * `docs/GEOMETRY_RULES.md`); задавать их здесь означало бы второй,
 * независимый параметр толщины при уже существующем.
 */
export function createShelvesLeaf(
  ids: IdFactory,
  count: number,
  mounting: Shelf['mounting'] = 'adjustable',
): LeafNode {
  const shelves: Shelf[] = Array.from({ length: count }, (_, index) => ({
    id: ids.next<'Node'>(),
    placement: { mode: 'auto', index, count },
    mounting,
    frontSetback: 0,
  }));
  return { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'shelves', shelves } };
}

/** ASSUMPTION(T-DRW-02): дно в паз, толщина 4 мм (ХДФ) — распространённая практика. */
export const DEFAULT_DRAWER_BOX: DrawerBoxSpec = {
  sideHeight: 150,
  bottom: { mount: 'groove', thickness: 4 },
};

/**
 * Один ящик со значениями по умолчанию (`flex`-вес 1 — равная доля высоты
 * ячейки среди других ящиков стопки). Короб (`DrawerBoxSpec`) и
 * направляющая (`SlideSpec`) заданы умолчаниями (`DEFAULT_DRAWER_BOX`,
 * `DEFAULT_SLIDE`) — они существуют в модели и переживают сериализацию,
 * но геометрией пока не читаются (`T-DRW-02`, `src/geometry/drawers.ts`).
 */
export function createDrawer(ids: IdFactory): Drawer {
  return {
    id: ids.next<'Node'>(),
    size: { mode: 'flex', weight: 1 },
    slide: DEFAULT_SLIDE,
    box: DEFAULT_DRAWER_BOX,
    facade: {},
  };
}

/**
 * Лист с `count` ящиками (PROMPT 11), в порядке снизу вверх — та же
 * конвенция, что уже действует у `resolveSizes`/`Shelf.placement.index`
 * (`docs/GEOMETRY_RULES.md`, новый раздел «ЯЩИКИ И ФАСАДЫ ЯЩИКОВ»). Высота
 * каждого фасада не хранится — её на каждом пересчёте вычисляет
 * `resolveDrawerFacadeGeometry` из `cell.box`, той же логикой, что и
 * остальное наполнение.
 */
export function createDrawersLeaf(ids: IdFactory, count: number): LeafNode {
  const drawers: Drawer[] = Array.from({ length: count }, () => createDrawer(ids));
  return { id: ids.next<'Node'>(), kind: 'leaf', fill: { kind: 'drawers', drawers } };
}

/**
 * Распашной фасад на одну ячейку — базовый случай PROMPT 10 §4/§6: одна
 * створка на всю ячейку либо (`doorCount: 2`) архитектура, подготовленная
 * §7-ом — две равные (`flex`-вес 1 у каждой) створки с петлями по краям.
 * Ширина каждой не хранится — её на каждом пересчёте вычисляет
 * `resolveDoorGeometry` из `cell.box`, той же логикой, что и остальное
 * наполнение (`docs/GEOMETRY_RULES.md` §18).
 */
export function createHingedFacade(
  ids: IdFactory,
  cellNodeId: NodeId,
  doorCount: 1 | 2 = 1,
): FacadeGroup {
  const leaves: FacadeLeaf[] = Array.from({ length: doorCount }, (_, index): FacadeLeaf => {
    const hingeSide: HingeSide = doorCount === 2 ? (index === 0 ? 'left' : 'right') : 'left';
    return { id: ids.next<'Node'>(), size: { mode: 'flex', weight: 1 }, hingeSide };
  });
  return {
    id: ids.next<'Node'>(),
    covers: { kind: 'node', nodeId: cellNodeId },
    type: 'hinged',
    leaves,
    overlay: DEFAULT_OVERLAY,
  };
}

export function createDefaultCarcass(backMaterialId: MaterialId): CarcassSpec {
  return {
    hasTop: true,
    hasBottom: true,
    back: {
      mount: DEFAULT_BACK_MOUNT,
      materialId: backMaterialId,
      segmentation: 'single',
    },
  };
}

/** Пустой корпус заданных габаритов: каркас и одна нераздёленная секция. */
export function createDefaultFurniture(
  ids: IdFactory,
  backMaterialId: MaterialId,
  overrides: Partial<Pick<Furniture, 'name' | 'kind' | 'dimensions'>> = {},
): Furniture {
  return {
    id: ids.next<'Furniture'>(),
    name: overrides.name ?? 'Изделие 1',
    kind: overrides.kind ?? 'wardrobe',
    dimensions: overrides.dimensions ?? DEFAULT_DIMENSIONS,
    carcass: createDefaultCarcass(backMaterialId),
    root: createEmptyLeaf(ids),
    facades: [],
  };
}
