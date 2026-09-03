import { issue } from '../domain/index.js';
import type { Grain, Issue, MaterialLibrary, Part, PartRole } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { CuttingSettings } from '../domain/index.js';
import type { PartNature, ProductionPart, ProductionPartType } from './types.js';

/**
 * Физическая деталь → производственная позиция (PROMPT 17 §2–§10).
 */

/**
 * Что это за объект (§5).
 *
 * Список ролей закрыт и разбирается исчерпывающе: добавление новой роли в
 * `PartRole` НЕ скомпилируется, пока автор не решит, пилят её из листа или
 * покупают. Молчаливое «попадёт в раскрой по умолчанию» — ровно тот способ
 * получить в спецификации ручку размером 14×128, которого §4 требует
 * избежать.
 */
export function classifyPart(role: PartRole): PartNature {
  switch (role) {
    case 'side':
    case 'top':
    case 'bottom':
    case 'partition':
    case 'shelf-fixed':
    case 'shelf-adjustable':
    case 'back':
    case 'plinth':
    case 'countertop':
    case 'facade':
    case 'drawer-front':
    case 'drawer-side':
    case 'drawer-back':
    case 'drawer-bottom':
    case 'filler':
      return 'physical';
    case 'handle':
    case 'push-to-open':
      // Ручка и push-механизм существуют как `Part` только ради положения
      // на схеме (PROMPT 12). Это покупная фурнитура: её считает
      // `calculateHardware`, и пилить её из листа нельзя (§7).
      return 'hardware';
    case 'other':
      // Роль-заглушка: ни один этап её не строит. Пока это так, отнести её
      // к производству значило бы пустить в раскрой неизвестно что.
      return 'hardware';
  }
}

/** Попадает ли деталь в раскрой (§4). */
export function isManufacturable(part: Part): boolean {
  return classifyPart(part.role) === 'physical';
}

/** Тип производственной детали по роли (§4). Второго справочника ролей нет. */
export function productionTypeOf(role: PartRole): ProductionPartType {
  switch (role) {
    case 'side':
      return 'side';
    case 'top':
      return 'top';
    case 'bottom':
      return 'bottom';
    case 'partition':
      return 'partition';
    case 'shelf-fixed':
    case 'shelf-adjustable':
      return 'shelf';
    case 'back':
      return 'back';
    case 'plinth':
      return 'plinth';
    case 'countertop':
      return 'countertop';
    case 'facade':
      return 'facade';
    case 'drawer-front':
    case 'drawer-side':
    case 'drawer-back':
    case 'drawer-bottom':
      return 'drawer-box';
    case 'filler':
      return 'false-panel';
    case 'handle':
    case 'push-to-open':
    case 'other':
      return 'other';
  }
}

const TYPE_NAMES: Readonly<Record<ProductionPartType, string>> = {
  side: 'Боковина',
  top: 'Крышка',
  bottom: 'Дно',
  partition: 'Перегородка',
  shelf: 'Полка',
  back: 'Задняя стенка',
  plinth: 'Цоколь',
  countertop: 'Столешница',
  facade: 'Фасад',
  'drawer-box': 'Деталь ящика',
  'false-panel': 'Фальшпанель',
  other: 'Деталь',
};

/**
 * Разрешён ли поворот детали на 90° (§10, §18).
 *
 * Две причины запрета, и обе обязаны действовать одновременно:
 * направленная текстура материала (поворот положил бы деталь поперёк
 * декора — это брак, а не оптимизация) и явный запрет от геометрии
 * (`Part.grainLocked`). Политика проекта может запретить поворот вообще,
 * но не может его РАЗРЕШИТЬ вопреки текстуре: такого варианта в
 * `RotationPolicy` нет намеренно.
 */
export function rotationAllowedFor(part: Part, grain: Grain, settings: CuttingSettings): boolean {
  if (part.grainLocked) return false;
  if (settings.rotationPolicy === 'never') return false;
  return grain === 'none';
}

/**
 * Имя позиции (§23).
 *
 * Собственной системы имён здесь не заводится: у детали уже есть `label`
 * («Боковина левая», «Полка 2»), который строит геометрия из типа, секции
 * и индекса. Если все детали позиции названы одинаково — берётся их имя;
 * если позиция объединила «Полка 1» и «Полка 2» — берётся имя типа, потому
 * что называть пять полок «Полка 1» было бы неправдой.
 */
function nameFor(parts: readonly Part[], type: ProductionPartType): string {
  const first = parts[0];
  if (first === undefined) return TYPE_NAMES[type];
  return parts.every((p) => p.label === first.label) ? first.label : TYPE_NAMES[type];
}

export interface ProductionPartsResult {
  readonly parts: readonly ProductionPart[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/**
 * Детали → производственные позиции.
 *
 * Группировка — по уже существующему `quantityGroupKey` (роль, материал,
 * размеры раскроя, кромка). Второй ключ группировки не изобретается: тот,
 * что есть, задуман ровно для этого («одинаковые детали — это N штук одной
 * позиции, а не N позиций», `src/domain/part/id.ts`).
 */
export function toProductionParts(
  geometry: GeometryResult,
  materials: MaterialLibrary,
  settings: CuttingSettings,
): ProductionPartsResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const groups = new Map<string, Part[]>();

  for (const part of geometry.parts) {
    if (!isManufacturable(part)) continue;
    const bucket = groups.get(part.quantityGroupKey);
    if (bucket === undefined) groups.set(part.quantityGroupKey, [part]);
    else bucket.push(part);
  }

  const parts: ProductionPart[] = [];
  for (const [key, members] of groups) {
    // Порядок экземпляров — по идентификатору детали, а не по обходу
    // геометрии: от него зависит, какой экземпляр куда ляжет на листе.
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const first = sorted[0];
    if (first === undefined) continue;

    const material = materials.items[first.materialId];
    if (material === undefined) {
      errors.push(
        issue(
          'PRODUCTION_MATERIAL_NOT_FOUND',
          'error',
          `Деталь «${first.label}» ссылается на материал «${String(first.materialId)}», которого нет в реестре: раскроить её не из чего.`,
          { partId: first.id },
        ),
      );
      continue;
    }

    const grain: Grain = material.grain;
    const type = productionTypeOf(first.role);
    parts.push({
      id: `pp:${key}`,
      sourcePartIds: sorted.map((p) => p.id),
      sourceNodeIds: sorted.flatMap((p) => (p.origin.nodeId === undefined ? [] : [p.origin.nodeId])),
      name: nameFor(sorted, type),
      partType: type,
      role: first.role,
      materialId: first.materialId,
      thickness: first.cut.thickness,
      length: first.cut.length,
      width: first.cut.width,
      quantity: sorted.length,
      grain,
      edgeBanding: first.edge,
      rotationAllowed: rotationAllowedFor(first, grain, settings),
    });
  }

  // Устойчивый порядок позиций: id выведен из материала, размеров и кромки,
  // поэтому сортировка по нему не зависит от порядка обхода геометрии.
  parts.sort((a, b) => a.id.localeCompare(b.id));
  return { parts, warnings, errors };
}
