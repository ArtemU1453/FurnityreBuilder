import type { IdFactory, MaterialId } from '../ids.js';
import type { EdgeSpec, EdgeSizingPolicy, Material, MaterialLibrary } from './types.js';

export const NO_EDGE: EdgeSpec = { front: 0, back: 0, left: 0, right: 0 };

/**
 * INDUSTRY: видимые фронтальные торцы — 2 мм ПВХ, невидимые внутренние — 0.4 мм,
 * задний торец у стены — без кромки.
 * ASSUMPTION(T-EDG-02): правило референса не установлено, взята отраслевая практика.
 */
export const DEFAULT_EDGE: EdgeSpec = { front: 2, back: 0, left: 0.4, right: 0.4 };

/** ASSUMPTION(T-EDG-03): по умолчанию кромка не вычитается из проектного размера. */
export const DEFAULT_EDGE_SIZING_POLICY: EdgeSizingPolicy = { subtractFromPartSize: false };

/** Стандартный лист ЛДСП. */
export const DEFAULT_SHEET = { width: 2750, height: 1830, trim: 10 } as const;

export interface DefaultMaterials {
  readonly library: MaterialLibrary;
  readonly carcassId: MaterialId;
  readonly backId: MaterialId;
}

/**
 * Минимальная стартовая библиотека: корпусный материал 16 мм и тонкий лист
 * для задних стенок и доньев ящиков. Имена нейтральные и описательные.
 */
export function createDefaultMaterials(ids: IdFactory): DefaultMaterials {
  const carcassId = ids.next<'Material'>();
  const backId = ids.next<'Material'>();

  const carcass: Material = {
    id: carcassId,
    name: 'Корпусная плита 16 мм',
    kind: 'chipboard',
    thickness: 16,
    displayColor: '#D9CBB4',
    grain: 'none',
    sheet: DEFAULT_SHEET,
  };

  const back: Material = {
    id: backId,
    name: 'Задняя стенка 3 мм',
    kind: 'hardboard',
    thickness: 3,
    displayColor: '#C7BAA6',
    grain: 'none',
    sheet: DEFAULT_SHEET,
  };

  const library: MaterialLibrary = {
    items: { [carcassId]: carcass, [backId]: back },
    assignment: {
      side: carcassId,
      top: carcassId,
      bottom: carcassId,
      partition: carcassId,
      'shelf-fixed': carcassId,
      'shelf-adjustable': carcassId,
      facade: carcassId,
      back: backId,
    },
  };

  return { library, carcassId, backId };
}
