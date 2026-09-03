import type { IdFactory, MaterialId } from '../ids.js';
import { DEFAULT_EDGE } from '../materials/defaults.js';
import type {
  BackPanelMount,
  CarcassSpec,
  ConstructionScheme,
  Dimensions,
  DividerSpec,
  Furniture,
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
