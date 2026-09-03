import type {
  EdgeSpec,
  EdgeSizingPolicy,
  FurnitureId,
  MaterialId,
  MaterialKind,
  MaterialLibrary,
  Mm,
  NodeId,
  Part,
  PartOrientation,
  PartRole,
  Vec3,
} from '../domain/index.js';
import { DEFAULT_EDGE, STRUCTURAL_ROLES, buildPartId, buildQuantityGroupKey, roundMm, vec3 } from '../domain/index.js';

/**
 * Соответствие локальных сторон детали её габариту.
 *
 *   vertical-yz    толщина по X, длина по Y (высота), ширина по Z (глубина)
 *   horizontal-xz  толщина по Y, длина по X (ширина), ширина по Z (глубина)
 *   frontal-xy     толщина по Z, длина по Y (высота), ширина по X (ширина)
 *
 * В локальной системе детали `length` идёт слева направо, `width` — от заднего
 * торца к переднему. Поэтому кромка слева и справа уменьшает длину,
 * а спереди и сзади — ширину. Полное описание — docs/COORDINATE_SYSTEM.md §5.
 */
export function rawCutSize(
  size: Vec3,
  orientation: PartOrientation,
): { length: number; width: number; thickness: number } {
  switch (orientation) {
    case 'vertical-yz':
      return { length: size.y, width: size.z, thickness: size.x };
    case 'horizontal-xz':
      return { length: size.x, width: size.z, thickness: size.y };
    case 'frontal-xy':
      return { length: size.y, width: size.x, thickness: size.z };
  }
}

export function applyEdgeSizing(
  raw: { length: number; width: number; thickness: number },
  edge: EdgeSpec,
  policy: EdgeSizingPolicy,
): { length: number; width: number; thickness: number } {
  if (!policy.subtractFromPartSize) {
    return {
      length: roundMm(raw.length),
      width: roundMm(raw.width),
      thickness: roundMm(raw.thickness),
    };
  }
  return {
    length: roundMm(raw.length - edge.left - edge.right),
    width: roundMm(raw.width - edge.back - edge.front),
    thickness: roundMm(raw.thickness),
  };
}

export function edgeKey(edge: EdgeSpec): string {
  return `${String(edge.front)}/${String(edge.back)}/${String(edge.left)}/${String(edge.right)}`;
}

/**
 * Материал по роли детали. Если роль не назначена, берётся первый материал
 * библиотеки — расчёт не должен падать из-за неполной настройки, но
 * вызывающая сторона получает `resolved: false` и может сообщить об этом.
 */
export function resolveMaterial(
  materials: MaterialLibrary,
  role: PartRole,
): { materialId: MaterialId; resolved: boolean } {
  const assigned = materials.assignment[role];
  if (assigned !== undefined) return { materialId: assigned, resolved: true };
  const first = Object.keys(materials.items)[0];
  return { materialId: (first ?? '') as MaterialId, resolved: false };
}

/**
 * Единая точка входа «эффективный материал + эффективная толщина» для
 * ЛЮБОЙ детали (полка, перегородка, дверная створка, фасад ящика) —
 * PROMPT 13 §2/§9. Место, где раньше расходились два источника толщины:
 * `Part.size` брал `Shelf.thickness ?? panelThickness` (корпус), а
 * `Material.thickness` того же материала при этом мог быть другим числом
 * и нигде не читался. Стеклянная полка 4 мм назначенным материалом
 * стекла получала бы толщину детали 16 мм (толщину корпуса) — материал
 * был декорацией, а не источником геометрии.
 *
 * Единый приоритет толщины (`docs/GEOMETRY_RULES.md`, новый раздел
 * «ЭФФЕКТИВНАЯ ТОЛЩИНА»):
 *   1. явный override поля детали (`Shelf.thickness`, `FacadeLeaf.thickness`,
 *      `DrawerFacadeSpec.thickness`, `DividerSpec.thickness` — последнее
 *      обязательное поле, поэтому по факту всегда уровень 1);
 *   2. `Material.thickness` уже назначенного материала;
 *   3. толщина корпуса (`Dimensions.panelThickness`) — аварийный запасной
 *      вариант на случай, если материал определить не удалось (пустая
 *      библиотека).
 * `ASSUMPTION(T-MAT-03)`: точный порядок референсом не подтверждён,
 * выбран как единственный, не противоречащий уже реализованным
 * `Shelf.thickness ?? panelThickness`/`leaf.thickness ?? panelThickness`
 * (уровень 1 не меняется — меняется только то, что раньше было
 * безусловным «низом» приоритета).
 *
 * Материал по ссылке (`materialId` на детали), которого нет в
 * `materials.items`, — не тихий откат на роль-материал в обход
 * диагностики: `danglingMaterialId` сообщает об этом вызывающей стороне,
 * которая обязана поднять `error`-диагностику (PROMPT 13 §15/§20 —
 * «отсутствующий материал не приводит к тихому fallback»). Деталь при
 * этом всё равно строится (на роль-материале) — иначе один битый
 * `materialId` в старом проекте останавливал бы весь расчёт целиком, что
 * хуже, чем видимая ошибка на конкретной детали.
 */
export interface EffectiveMaterial {
  readonly materialId: MaterialId;
  readonly thickness: Mm;
  readonly edge: EdgeSpec;
  /** `undefined`, только если материал не найден совсем (пустая библиотека). */
  readonly kind?: MaterialKind;
  readonly roleNotAssigned: boolean;
  readonly danglingMaterialId: boolean;
  readonly danglingEdgeMaterialId: boolean;
  /** Стекло/зеркало на несущей роли (PROMPT 13 §15, `T-MAT-04`) — предупреждение, не запрет. */
  readonly structuralGlassOrMirror: boolean;
}

export interface ResolveEffectiveMaterialArgs {
  readonly materials: MaterialLibrary;
  readonly role: PartRole;
  /** Явная ссылка на материал детали (`Shelf.materialId` и аналоги), если задана. */
  readonly explicitMaterialId?: MaterialId | undefined;
  /** Явная кромка детали (`Shelf.edge` и аналоги), если задана. */
  readonly explicitEdge?: EdgeSpec | undefined;
  /** Явный override толщины детали (`Shelf.thickness` и аналоги), если задан. */
  readonly thicknessOverride?: Mm | undefined;
  /** Толщина корпуса (`Dimensions.panelThickness`) — уровень 3 приоритета. */
  readonly corpusThickness: Mm;
}

export function resolveEffectiveMaterial(args: ResolveEffectiveMaterialArgs): EffectiveMaterial {
  let materialId: MaterialId;
  let roleNotAssigned = false;
  let danglingMaterialId = false;

  if (args.explicitMaterialId !== undefined) {
    if (args.materials.items[args.explicitMaterialId] !== undefined) {
      materialId = args.explicitMaterialId;
    } else {
      danglingMaterialId = true;
      const fallback = resolveMaterial(args.materials, args.role);
      materialId = fallback.materialId;
      roleNotAssigned = !fallback.resolved;
    }
  } else {
    const resolved = resolveMaterial(args.materials, args.role);
    materialId = resolved.materialId;
    roleNotAssigned = !resolved.resolved;
  }

  const material = args.materials.items[materialId];
  const thickness = roundMm(args.thicknessOverride ?? material?.thickness ?? args.corpusThickness);
  const edge = args.explicitEdge ?? DEFAULT_EDGE;
  const danglingEdgeMaterialId =
    edge.materialId !== undefined && args.materials.items[edge.materialId] === undefined;
  const structuralGlassOrMirror =
    (material?.kind === 'glass' || material?.kind === 'mirror') &&
    (STRUCTURAL_ROLES as readonly PartRole[]).includes(args.role);

  return {
    materialId,
    thickness,
    edge,
    ...(material === undefined ? {} : { kind: material.kind }),
    roleNotAssigned,
    danglingMaterialId,
    danglingEdgeMaterialId,
    structuralGlassOrMirror,
  };
}

export interface MakePartArgs {
  readonly furnitureId: FurnitureId;
  readonly role: PartRole;
  readonly label: string;
  /** Обычно порядковый номер; для деталей со своим стабильным id в дереве
   * модели (полка — `Shelf.id`) — этот id строкой. См. `buildPartId`. */
  readonly index: number | string;
  readonly position: Vec3;
  readonly size: Vec3;
  readonly orientation: PartOrientation;
  readonly materialId: MaterialId;
  readonly edge: EdgeSpec;
  readonly edgeSizing: EdgeSizingPolicy;
  readonly grainLocked?: boolean;
  readonly nodeId?: NodeId;
}

/** Единственный конструктор детали: гарантирует нормализацию и стабильный id. */
export function makePart(args: MakePartArgs): Part {
  const position = vec3(args.position.x, args.position.y, args.position.z);
  const size = vec3(args.size.x, args.size.y, args.size.z);
  const cut = applyEdgeSizing(rawCutSize(size, args.orientation), args.edge, args.edgeSizing);

  return {
    id: buildPartId({
      furnitureId: args.furnitureId,
      role: args.role,
      index: args.index,
      ...(args.nodeId === undefined ? {} : { nodeId: args.nodeId }),
    }),
    role: args.role,
    label: args.label,
    position,
    size,
    orientation: args.orientation,
    cut,
    materialId: args.materialId,
    edge: args.edge,
    grainLocked: args.grainLocked ?? false,
    origin: {
      furnitureId: args.furnitureId,
      ...(args.nodeId === undefined ? {} : { nodeId: args.nodeId }),
    },
    drilling: [],
    quantityGroupKey: buildQuantityGroupKey({
      role: args.role,
      materialId: args.materialId,
      length: cut.length,
      width: cut.width,
      thickness: cut.thickness,
      edgeKey: edgeKey(args.edge),
    }),
  };
}
