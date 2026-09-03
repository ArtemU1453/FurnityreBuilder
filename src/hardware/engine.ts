import { buildGeometry } from '../geometry/index.js';
import { isLeaf, issue, visitNodes } from '../domain/index.js';
import type {
  Furniture,
  FurnitureId,
  HardwareDefinition,
  HardwareId,
  Issue,
  Project,
} from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { HardwareBOM, HardwareBomLine, HardwareItem, HardwareRule } from './types.js';
import { DEFAULT_HARDWARE_LIBRARY } from './registry.js';
import { hingeFastenerRule, hingeRule } from './rules/hinges.js';
import { slideRule } from './rules/slides.js';
import { shelfSupportRule } from './rules/shelf-supports.js';
import { backWallFastenerRule, carcassFastenerRule } from './rules/fasteners.js';
import { handleFastenerRule, handleRule, pushToOpenRule } from './rules/opening.js';

/**
 * Движок расчёта фурнитуры (PROMPT 16 §14).
 *
 * ## Одна точка входа, как у геометрии
 *
 * Функция чистая и детерминированная: не читает часы, не генерирует
 * случайных значений, не обращается к React и DOM. Одинаковый проект даёт
 * одинаковую спецификацию — ровно тот же контракт, что у `buildGeometry`,
 * и по той же причине: результат можно сравнивать снапшотом и вынести в
 * Worker без единой правки.
 *
 * ## Спецификация не хранится
 *
 * `HardwareBOM` нигде не сохраняется (§22): это производная величина, как
 * и список деталей. Сохранённая спецификация мгновенно расходилась бы с
 * моделью после первого же изменения габарита — именно та ошибка «второго
 * источника истины», которую §2 запрещает.
 */

/** Порядок правил фиксирован: от него зависит порядок предупреждений. */
export const HARDWARE_RULES: readonly HardwareRule[] = [
  hingeRule,
  hingeFastenerRule,
  slideRule,
  shelfSupportRule,
  backWallFastenerRule,
  carcassFastenerRule,
  handleRule,
  handleFastenerRule,
  pushToOpenRule,
];

export interface CalculateHardwareOptions {
  /** Подмена набора правил — нужна тестам и будущим схемам сборки. */
  readonly rules?: readonly HardwareRule[];
  /**
   * Уже посчитанная геометрия по id изделия. Интерфейс считает её сам и
   * передаёт сюда, чтобы движок не строил второй раз то же самое; результат
   * от этого не зависит — при отсутствии карты геометрия строится здесь.
   */
  readonly geometry?: ReadonlyMap<FurnitureId, GeometryResult>;
}

/**
 * Справочник, по которому проверяются позиции.
 *
 * Встроенные определения живут в коде, а не в файле проекта. Записать их в
 * каждый документ значило бы завести вторую копию справочника: переименуй
 * позицию в коде — и старые файлы навсегда останутся со старым именем.
 * Поэтому база — `DEFAULT_HARDWARE_LIBRARY`, а `project.hardware`
 * дополняет и перекрывает её пользовательскими определениями.
 */
function resolveRegistry(project: Project): Readonly<Record<string, HardwareDefinition>> {
  return { ...DEFAULT_HARDWARE_LIBRARY.items, ...project.hardware.items };
}

/** Все идентификаторы модели, на которые позиция вправе ссылаться. */
function collectSourceIds(furniture: Furniture, geometry: GeometryResult): ReadonlySet<string> {
  const ids = new Set<string>();
  visitNodes(furniture.root, (node) => {
    ids.add(node.id);
    if (!isLeaf(node)) return;
    if (node.fill.kind === 'drawers') for (const drawer of node.fill.drawers) ids.add(drawer.id);
  });
  for (const facade of furniture.facades) {
    ids.add(facade.id);
    for (const leaf of facade.leaves) ids.add(leaf.id);
  }
  for (const cell of geometry.cells) ids.add(cell.nodeId);
  return ids;
}

/**
 * Проверки позиций (§17–18).
 *
 * Позиция, не прошедшая проверку, В СПЕЦИФИКАЦИЮ НЕ ПОПАДАЕТ: сложить
 * дробное или отрицательное количество в строку значило бы разнести ошибку
 * по всему итогу, где её уже не найти. Вместо этого — ошибка с указанием
 * правила, породившего позицию.
 */
function validateItem(
  item: HardwareItem,
  registry: Readonly<Record<string, HardwareDefinition>>,
  parts: ReadonlySet<string>,
  sources: ReadonlySet<string>,
  seen: Set<string>,
): Issue[] {
  const errors: Issue[] = [];
  const where = `позиция «${item.id}» (правило «${item.ruleId}»)`;

  const definition = registry[item.definitionId];
  if (definition === undefined) {
    errors.push(
      issue(
        'HARDWARE_UNKNOWN_DEFINITION',
        'error',
        `${where} ссылается на определение «${String(item.definitionId)}», которого нет в реестре фурнитуры.`,
      ),
    );
  } else {
    if (definition.kind !== item.kind) {
      errors.push(
        issue(
          'HARDWARE_INCOMPATIBLE_DEFINITION',
          'error',
          `${where} объявлена как «${item.kind}», а определение «${String(item.definitionId)}» описывает «${definition.kind}».`,
        ),
      );
    }
    if (definition.unit !== item.unit) {
      errors.push(
        issue(
          'HARDWARE_INCOMPATIBLE_DEFINITION',
          'error',
          `${where} считается в «${item.unit}», а определение «${String(item.definitionId)}» — в «${definition.unit}».`,
        ),
      );
    }
  }

  if (!Number.isInteger(item.quantity)) {
    errors.push(
      issue('HARDWARE_QUANTITY_NOT_INTEGER', 'error', `${where}: количество ${String(item.quantity)} не целое.`),
    );
  } else if (item.quantity < 0) {
    errors.push(
      issue('HARDWARE_QUANTITY_NEGATIVE', 'error', `${where}: количество ${String(item.quantity)} отрицательное.`),
    );
  }

  if (item.sourcePartId === undefined && item.sourceNodeId === undefined) {
    errors.push(issue('HARDWARE_WITHOUT_SOURCE', 'error', `${where} не привязана ни к детали, ни к узлу модели.`));
  }
  if (item.sourcePartId !== undefined && !parts.has(item.sourcePartId)) {
    errors.push(
      issue(
        'HARDWARE_SOURCE_NOT_FOUND',
        'error',
        `${where} ссылается на деталь «${String(item.sourcePartId)}», которой нет в геометрии.`,
      ),
    );
  }
  if (item.sourceNodeId !== undefined && !sources.has(item.sourceNodeId)) {
    errors.push(
      issue(
        'HARDWARE_SOURCE_NOT_FOUND',
        'error',
        `${where} ссылается на узел «${String(item.sourceNodeId)}», которого нет в модели.`,
      ),
    );
  }

  if (seen.has(item.id)) {
    errors.push(issue('HARDWARE_DUPLICATE_ID', 'error', `${where} встречается второй раз: идентификаторы позиций уникальны.`));
  }
  seen.add(item.id);

  return errors;
}

/** Сложение одинаковых позиций с сохранением источников (§16). */
function aggregate(
  items: readonly HardwareItem[],
  registry: Readonly<Record<string, HardwareDefinition>>,
): HardwareBomLine[] {
  const byDefinition = new Map<HardwareId, HardwareItem[]>();
  for (const item of items) {
    const bucket = byDefinition.get(item.definitionId);
    if (bucket === undefined) byDefinition.set(item.definitionId, [item]);
    else bucket.push(item);
  }

  const lines: HardwareBomLine[] = [];
  for (const [definitionId, sources] of byDefinition) {
    const first = sources[0];
    if (first === undefined) continue;
    const definition = registry[definitionId];
    lines.push({
      definitionId,
      kind: first.kind,
      name: definition?.name ?? String(definitionId),
      unit: first.unit,
      quantity: sources.reduce((sum, item) => sum + item.quantity, 0),
      sources,
    });
  }
  // Порядок по идентификатору определения, а не по порядку появления:
  // спецификация не должна переставляться от перестановки правил.
  lines.sort((a, b) => String(a.definitionId).localeCompare(String(b.definitionId)));
  return lines;
}

export function calculateHardware(project: Project, options: CalculateHardwareOptions = {}): HardwareBOM {
  const rules = options.rules ?? HARDWARE_RULES;
  const registry = resolveRegistry(project);

  const items: HardwareItem[] = [];
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const seen = new Set<string>();

  for (const furniture of project.furniture) {
    const geometry =
      options.geometry?.get(furniture.id) ??
      buildGeometry({
        furniture,
        scheme: project.settings.construction,
        tolerances: project.settings.tolerances,
        materials: project.materials,
        edgeSizing: project.settings.edgeSizing,
      });

    // Та же аварийная остановка, что в геометрии: считать фурнитуру по
    // изделию, детали которого построить не удалось, значит выдать
    // количество, не соответствующее ничему.
    if (geometry.diagnostics.some((d) => d.severity === 'error')) {
      warnings.push(
        issue(
          'HARDWARE_SKIPPED_BROKEN_GEOMETRY',
          'warning',
          `Фурнитура изделия «${furniture.name}» не рассчитана: геометрия содержит ошибки, считать не от чего.`,
        ),
      );
      continue;
    }

    const partIds = new Set<string>(geometry.parts.map((p) => p.id));
    const sourceIds = collectSourceIds(furniture, geometry);
    const ctx = { furniture, geometry, library: project.hardware };

    for (const rule of rules) {
      const result = rule.run(ctx);
      warnings.push(...result.warnings);
      errors.push(...result.errors);
      for (const item of result.items) {
        const problems = validateItem(item, registry, partIds, sourceIds, seen);
        if (problems.length > 0) {
          errors.push(...problems);
          continue;
        }
        items.push(item);
      }
    }
  }

  // Устойчивый порядок позиций: по идентификатору, который сам выведен из
  // правила и источника (§21), а не из порядка обхода.
  items.sort((a, b) => a.id.localeCompare(b.id));

  return { items, lines: aggregate(items, registry), warnings, errors };
}
