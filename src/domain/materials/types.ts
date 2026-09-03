import type { MaterialId } from '../ids.js';
import type { Mm } from '../units.js';
import type { PartRole } from '../part/types.js';

/**
 * Материал задаёт пользователь. Брендовых каталогов в продукте нет —
 * это и требование автономности (docs/BRAND_INDEPENDENCE_AUDIT.md §4.5),
 * и вопрос прав на чужие данные о декорах.
 */
export type MaterialKind =
  | 'chipboard'
  | 'mdf'
  | 'plywood'
  | 'hardboard'
  | 'solid'
  | 'glass'
  | 'mirror'
  | 'other';

/**
 * Несущие роли, для которых стекло/зеркало — необычный, но не запрещённый
 * выбор (PROMPT 13 §15): при таком сочетании движок сообщает
 * `GLASS_MIRROR_STRUCTURAL_ROLE` (warning), но всё равно строит деталь —
 * это предупреждение о вероятной ошибке ввода, а не производственный запрет.
 */
export const STRUCTURAL_ROLES = ['side', 'top', 'bottom', 'partition', 'shelf-fixed', 'shelf-adjustable'] satisfies readonly PartRole[];

/** Направление текстуры. Влияет на разрешённый поворот детали при раскрое. */
export type Grain = 'none' | 'along-length' | 'along-width';

export interface SheetFormat {
  readonly width: Mm;
  readonly height: Mm;
  /** Обрезная кромка листа, не участвующая в раскрое. */
  readonly trim: Mm;
}

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  readonly kind: MaterialKind;
  readonly thickness: Mm;
  /** Цвет для схемы, не для фотореализма. Читаемость важнее похожести. */
  readonly displayColor: string;
  readonly grain: Grain;
  readonly sheet?: SheetFormat;
}

export interface MaterialLibrary {
  readonly items: Readonly<Record<string, Material>>;
  /** Назначение материала по ролям деталей: корпус, фасад, задняя стенка… */
  readonly assignment: Readonly<Partial<Record<PartRole, MaterialId>>>;
}

/** Допустимые толщины кромки, мм. */
export type EdgeThickness = 0 | 0.4 | 1 | 2;

/**
 * Кромка по четырём сторонам детали в её локальных координатах.
 * Соответствие локальных сторон осям изделия задаётся `Part.orientation`.
 */
export interface EdgeSpec {
  readonly front: EdgeThickness;
  readonly back: EdgeThickness;
  readonly left: EdgeThickness;
  readonly right: EdgeThickness;
  readonly materialId?: MaterialId;
}

/**
 * Вычитается ли толщина кромки из размера детали при раскрое.
 *
 * true  — в карту раскроя идёт размер ДО оклейки, деталь + кромка = проектный размер
 * false — в карту раскроя идёт проектный размер, кромка добавляется «сверху»
 *
 * ASSUMPTION(T-EDG-03): значение по умолчанию не подтверждено, разные
 * производства считают по-разному, поэтому это видимая настройка проекта.
 */
export interface EdgeSizingPolicy {
  readonly subtractFromPartSize: boolean;
}
