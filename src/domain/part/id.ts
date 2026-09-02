import { asId } from '../ids.js';
import type { FurnitureId, NodeId, PartId } from '../ids.js';
import type { PartRole } from './types.js';

/**
 * Детерминированный идентификатор детали.
 *
 * Зачем: после изменения габарита геометрия пересчитывается целиком. Если бы id
 * зависел от порядка создания, выделение и открытая панель свойств слетали бы
 * при каждом движении ползунка. Идентификатор, выведенный из структуры модели,
 * остаётся тем же, пока структура не изменилась.
 *
 * Формат: `part:{furnitureId}/{nodeId|-}/{role}/{index}`
 * См. docs/INTERACTION_MODEL.md §9.
 */
export function buildPartId(args: {
  furnitureId: FurnitureId;
  role: PartRole;
  index: number;
  nodeId?: NodeId;
}): PartId {
  const node = args.nodeId ?? '-';
  return asId<'Part'>(`part:${args.furnitureId}/${node}/${args.role}/${String(args.index)}`);
}

/**
 * Ключ группировки одинаковых деталей в спецификации: одинаковые роль, материал,
 * размеры раскроя и кромка — это N штук одной позиции, а не N позиций.
 */
export function buildQuantityGroupKey(parts: {
  role: PartRole;
  materialId: string;
  length: number;
  width: number;
  thickness: number;
  edgeKey: string;
}): string {
  return [
    parts.role,
    parts.materialId,
    parts.length.toFixed(1),
    parts.width.toFixed(1),
    parts.thickness.toFixed(1),
    parts.edgeKey,
  ].join('|');
}
