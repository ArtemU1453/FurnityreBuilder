import type { MaterialLibrary } from '../domain/index.js';
import type { CuttingGroup, ProductionPart } from './types.js';

/**
 * Группы раскроя (PROMPT 17 §11, §13).
 *
 * Ключ группы — материал И толщина, а не один материал. Толщина детали
 * может быть переопределена явно (`resolveEffectiveMaterial`, PROMPT 13),
 * и деталь 18 мм невозможно выпилить из листа 16 мм, сколько бы они ни
 * делили `materialId`. Направление текстуры в ключ не входит: оно
 * определяется материалом, то есть уже неявно содержится в первой части
 * ключа.
 */

const KEY_SEPARATOR = '@';

export function groupKeyOf(part: ProductionPart): string {
  return `${String(part.materialId)}${KEY_SEPARATOR}${part.thickness.toFixed(1)}`;
}

export function groupForCutting(
  parts: readonly ProductionPart[],
  materials: MaterialLibrary,
): readonly CuttingGroup[] {
  const buckets = new Map<string, ProductionPart[]>();
  for (const part of parts) {
    const key = groupKeyOf(part);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [part]);
    else bucket.push(part);
  }

  const groups: CuttingGroup[] = [];
  for (const [key, members] of buckets) {
    const first = members[0];
    if (first === undefined) continue;
    groups.push({
      id: `cg:${key}`,
      materialId: first.materialId,
      materialName: materials.items[first.materialId]?.name ?? String(first.materialId),
      thickness: first.thickness,
      grain: first.grain,
      parts: members,
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  return groups;
}
