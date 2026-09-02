import type {
  EdgeSpec,
  EdgeSizingPolicy,
  FurnitureId,
  MaterialId,
  MaterialLibrary,
  NodeId,
  Part,
  PartOrientation,
  PartRole,
  Vec3,
} from '../domain/index.js';
import { buildPartId, buildQuantityGroupKey, roundMm, vec3 } from '../domain/index.js';

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

export interface MakePartArgs {
  readonly furnitureId: FurnitureId;
  readonly role: PartRole;
  readonly label: string;
  readonly index: number;
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
