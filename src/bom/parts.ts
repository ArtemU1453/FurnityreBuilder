import { asId, issue } from '../domain/index.js';
import type { EdgeSpec, Issue, MaterialLibrary } from '../domain/index.js';
import type { ProductionPart, ProductionPartType } from '../production/index.js';
import type { EdgeBandSummary, PartBOMItem, PartCategory } from './types.js';

/**
 * Деталировка (PROMPT 19 §4, §7–§10).
 */

/**
 * Раздел производственной структуры по типу детали (§16).
 *
 * Отображение однозначное и исчерпывающее: новый тип детали не
 * скомпилируется, пока автор не решит, в какой раздел спецификации он
 * попадает. Раздел «прочее» существует для типов, у которых нет своего, —
 * но пустых разделов «на будущее» не заводится.
 */
export function categoryOf(type: ProductionPartType): PartCategory {
  switch (type) {
    case 'side':
    case 'top':
    case 'bottom':
    case 'partition':
      return 'carcass';
    case 'shelf':
      return 'shelves';
    case 'facade':
      return 'doors';
    case 'drawer-box':
      return 'drawers';
    case 'back':
      return 'back-wall';
    case 'plinth':
      return 'plinth';
    case 'countertop':
      return 'countertop';
    case 'false-panel':
      return 'false-panels';
    case 'other':
      return 'other';
  }
}

const edgeKeyOf = (edge: EdgeSpec): string =>
  `${String(edge.front)}/${String(edge.back)}/${String(edge.left)}/${String(edge.right)}/${edge.materialId ?? '-'}`;

/**
 * Ключ группировки строки деталировки (§7).
 *
 * Материал, толщина, размеры, тип, направление текстуры и кромка — ровно
 * те свойства, которые делают деталь другой ДЛЯ ПРОИЗВОДСТВА. Роль детали
 * в ключ намеренно не входит: стационарная и съёмная полка одного размера
 * из одного материала с одной кромкой — это одна панель на распиле и одна
 * строка спецификации. Кромка, наоборот, входит: две детали 720×560 с
 * разной кромкой — разные позиции, потому что их по-разному оклеивают.
 */
export function bomGroupKey(part: ProductionPart): string {
  return [
    part.partType,
    String(part.materialId),
    part.thickness.toFixed(1),
    part.length.toFixed(1),
    part.width.toFixed(1),
    part.grain,
    edgeKeyOf(part.edgeBanding),
  ].join('|');
}

export interface PartsBomResult {
  readonly items: readonly PartBOMItem[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/**
 * Производственные детали → строки деталировки.
 *
 * Количество СУММИРУЕТСЯ из `ProductionPart.quantity`, а не пересчитывается
 * по числу размещений на листах: у экземпляра, не поместившегося на лист,
 * количество от этого не уменьшается, а раскладка — отдельный вопрос
 * (§8, §28). Двойного счёта не возникает именно поэтому: количество берётся
 * ровно из одного места.
 */
export function buildPartsBom(parts: readonly ProductionPart[], materials: MaterialLibrary): PartsBomResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const groups = new Map<string, ProductionPart[]>();

  for (const part of parts) {
    const key = bomGroupKey(part);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [part]);
    else bucket.push(part);
  }

  const items: PartBOMItem[] = [];
  for (const [key, members] of groups) {
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const first = sorted[0];
    if (first === undefined) continue;

    const material = materials.items[first.materialId];
    if (material === undefined) {
      errors.push(
        issue(
          'BOM_MATERIAL_NOT_FOUND',
          'error',
          `Позиция «${first.name}» ссылается на материал «${String(first.materialId)}», которого нет в реестре.`,
        ),
      );
      continue;
    }
    if (!(first.length > 0) || !(first.width > 0) || !(first.thickness > 0)) {
      errors.push(
        issue('BOM_PART_WITHOUT_SIZE', 'error', `Позиция «${first.name}» не имеет размеров: ${String(first.length)}×${String(first.width)}×${String(first.thickness)} мм.`),
      );
      continue;
    }

    items.push({
      id: `bom:${key}`,
      productionPartIds: sorted.map((p) => p.id),
      name: first.name,
      partType: first.partType,
      category: categoryOf(first.partType),
      materialId: first.materialId,
      materialName: material.name,
      materialKind: material.kind,
      thickness: first.thickness,
      length: first.length,
      width: first.width,
      quantity: sorted.reduce((sum, p) => sum + p.quantity, 0),
      grainDirection: first.grain,
      edgeBanding: first.edgeBanding,
      sourcePartIds: sorted.flatMap((p) => p.sourcePartIds),
      sourceNodeIds: sorted.flatMap((p) => p.sourceNodeIds),
    });
  }

  // Порядок — по ключу, который выведен из свойств детали: он не зависит
  // от порядка обхода геометрии (§21).
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { items, warnings, errors };
}

/**
 * Кромка в погонных миллиметрах (§10).
 *
 * Длина берётся из реальных размеров детали, а не оценивается. Стороны
 * `left`/`right` лежат на концах ДЛИНЫ, поэтому их полоса идёт вдоль
 * ширины детали; `front`/`back` — наоборот (`docs/COORDINATE_SYSTEM.md`
 * §5). Это то же соответствие, по которому кромка уменьшает размер
 * раскроя, — второго толкования сторон не заводится.
 */
export function buildEdgeSummary(items: readonly PartBOMItem[], materials: MaterialLibrary): readonly EdgeBandSummary[] {
  const groups = new Map<string, { thickness: number; materialId?: string; lengthMm: number; sideCount: number }>();

  const add = (thickness: number, materialId: string | undefined, length: number, count: number): void => {
    if (thickness <= 0 || length <= 0 || count <= 0) return;
    const key = `${thickness.toFixed(2)}@${materialId ?? '-'}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, {
        thickness,
        ...(materialId === undefined ? {} : { materialId }),
        lengthMm: length * count,
        sideCount: count,
      });
    } else {
      bucket.lengthMm += length * count;
      bucket.sideCount += count;
    }
  };

  for (const item of items) {
    const edge = item.edgeBanding;
    const materialId = edge.materialId === undefined ? undefined : String(edge.materialId);
    add(edge.left, materialId, item.width, item.quantity);
    add(edge.right, materialId, item.width, item.quantity);
    add(edge.front, materialId, item.length, item.quantity);
    add(edge.back, materialId, item.length, item.quantity);
  }

  const summaries: EdgeBandSummary[] = [];
  for (const [key, bucket] of groups) {
    const material = bucket.materialId === undefined ? undefined : materials.items[bucket.materialId];
    summaries.push({
      id: `edge:${key}`,
      ...(bucket.materialId === undefined ? {} : { materialId: asId<'Material'>(bucket.materialId) }),
      // Материал кромки в проекте может быть не назначен: `EdgeSpec.materialId`
      // необязателен, и толщина 2 мм без материала — рабочая конфигурация.
      materialName: material?.name ?? `Кромка ${String(bucket.thickness)} мм (материал не назначен)`,
      thickness: bucket.thickness as EdgeBandSummary['thickness'],
      lengthMm: Math.round(bucket.lengthMm * 10) / 10,
      sideCount: bucket.sideCount,
    });
  }
  summaries.sort((a, b) => a.id.localeCompare(b.id));
  return summaries;
}
