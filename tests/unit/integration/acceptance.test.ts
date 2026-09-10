import { describe, expect, it } from 'vitest';
import { FIXTURES, geometryOf, productionOf, readinessOf, run } from './fixtures.js';
import type { FixtureName } from './fixtures.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { buildScene } from '../../../src/scene/adapter.js';
import { isSplit } from '../../../src/domain/index.js';
import type { NodeId, Project, SectionNode } from '../../../src/domain/index.js';

/**
 * Приёмка расчёта и согласованности слоёв (PROMPT 35 §5, §6, §9).
 *
 * Отличие от `production-regression.test.ts`: тот сторожит КОНКРЕТНЫЕ
 * числа и падает, когда правило изменилось. Этот проверяет СВОЙСТВА,
 * которые обязаны выполняться при любых числах: конечность величин,
 * отсутствие дублей, прослеживаемость, совпадение слоёв между собой.
 *
 * Проверки идут по всем семи приёмочным фикстурам сразу: дефект, который
 * не проявляется на простом корпусе, обычно проявляется на сетке 5 × 4.
 */

const NAMES = Object.keys(FIXTURES) as FixtureName[];

/** Все числа объекта, включая вложенные. */
function numbersOf(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const item of value) numbersOf(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) numbersOf(item, out);
  }
  return out;
}

function nodeIds(node: SectionNode, out: NodeId[] = []): NodeId[] {
  out.push(node.id);
  if (isSplit(node)) for (const child of node.children) nodeIds(child.node, out);
  return out;
}

describe.each(NAMES)('приёмка расчёта: %s', (name) => {
  const project = (): Project => FIXTURES[name]();

  it('ни одного NaN и ни одной бесконечности во всём результате', () => {
    const production = productionOf(project());
    const numbers = numbersOf(production);
    expect(numbers.length).toBeGreaterThan(0);
    const bad = numbers.filter((n) => !Number.isFinite(n));
    expect(bad, `не конечных величин: ${String(bad.length)}`).toHaveLength(0);
  });

  it('расчёт детерминирован: два прогона дают побайтово один результат', () => {
    const source = project();
    expect(JSON.stringify(productionOf(source))).toBe(JSON.stringify(productionOf(source)));
  });

  it('идентификаторы узлов дерева не повторяются', () => {
    const ids = nodeIds(project().furniture[0]!.root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('идентификаторы деталей геометрии не повторяются', () => {
    const ids = geometryOf(project()).parts.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждая деталь имеет источник: живой узел дерева либо корпус', () => {
    const source = project();
    const alive = new Set(nodeIds(source.furniture[0]!.root));
    for (const part of geometryOf(source).parts) {
      const nodeId = part.origin.nodeId;
      if (nodeId === undefined) continue; // деталь корпуса узлу не принадлежит
      expect(alive.has(nodeId), `деталь ${part.id} ссылается на исчезнувший узел`).toBe(true);
    }
  });

  it('ни одна ячейка не стала физической деталью', () => {
    const result = geometryOf(project());
    const cellIds = new Set(result.cells.map((cell) => cell.nodeId));
    // Ячейка — пространство. Деталь может ПРИНАДЛЕЖАТЬ ячейке, но сама
    // ячейка деталью не становится: её идентификатор не может быть id детали.
    for (const part of result.parts) {
      expect(cellIds.has(part.id as unknown as NodeId)).toBe(false);
    }
  });

  it('спецификация не теряет и не удваивает деталей', () => {
    const source = project();
    const built = geometryOf(source).parts.length;
    const production = productionOf(source);
    const counted = production.bom.parts.reduce((sum, item) => sum + item.quantity, 0);
    expect(counted, 'сумма количеств в спецификации ≠ числу построенных деталей').toBe(built);
  });

  it('каждая позиция спецификации знает свои исходные детали', () => {
    for (const item of productionOf(project()).bom.parts) {
      expect(item.sourcePartIds.length, `позиция ${item.id} без источника`).toBeGreaterThan(0);
      expect(item.sourcePartIds).toHaveLength(item.quantity);
    }
  });

  it('раскрой учитывает каждую заготовку ровно один раз', () => {
    const production = productionOf(project());
    const placed = production.bom.cutting.placedParts;
    const unplaced = production.bom.cutting.unplacedParts;
    const total = production.bom.parts.reduce((sum, item) => sum + item.quantity, 0);
    expect(placed + unplaced, 'размещённые + неразмещённые ≠ всем деталям').toBe(total);
  });

  it('каждая неразмещённая деталь названа по имени и с причиной', () => {
    for (const entry of productionOf(project()).cutting.unplaced) {
      expect(entry.sourcePartId).toBeTruthy();
      expect(entry.reason).toBeTruthy();
      expect(entry.detail, 'причина без объяснения размеров').toMatch(/\d/);
    }
  });

  it('каждая позиция фурнитуры знает правило, по которому получена', () => {
    for (const item of productionOf(project()).hardware.items) {
      expect(item.ruleId, 'позиция фурнитуры без правила').toBeTruthy();
      expect(item.reason, 'позиция фурнитуры без объяснения').toBeTruthy();
      expect(item.quantity).toBeGreaterThan(0);
    }
  });

  it('каждая операция присадки знает своё правило и причину', () => {
    for (const operation of productionOf(project()).drilling.operations) {
      expect(operation.ruleId).toBeTruthy();
      expect(operation.reason).toBeTruthy();
    }
  });

  it('нерассчитанное не молчит: статус готовности объясняется', () => {
    const production = productionOf(project());
    const readiness = readinessOf(project());
    if (readiness.status === 'READY_FOR_PRODUCTION') return;
    // Любой статус хуже «готово к производству» обязан сопровождаться
    // хотя бы одним сообщением: иначе человек видит «не готово» и не
    // узнаёт, почему.
    const messages = [...production.bom.warnings, ...production.bom.errors];
    expect(messages.length, `статус ${readiness.status} без единого сообщения`).toBeGreaterThan(0);
  });
});

describe.each(NAMES)('согласованность слоёв: %s', (name) => {
  const project = (): Project => FIXTURES[name]();

  it('сцена показывает ровно те детали, что построила геометрия', () => {
    const source = project();
    const result = geometryOf(source);
    const scene = buildScene(result, source.materials);
    const partObjects = scene.objects.filter((object) => object.kind === 'part');
    expect(partObjects).toHaveLength(result.parts.length);
  });

  it('сцена не пересчитывает размеры: они те же, что в геометрии', () => {
    const source = project();
    const result = geometryOf(source);
    const scene = buildScene(result, source.materials);
    const byId = new Map<string, (typeof result.parts)[number]>(
      result.parts.map((part) => [String(part.id), part]),
    );
    for (const object of scene.objects) {
      if (object.kind !== 'part') continue;
      // У объекта сцены поле `id`: для детали это её `PartId`, третьего
      // идентификатора сцена не заводит.
      const part = byId.get(object.id);
      expect(part, `в сцене деталь ${object.id}, которой нет в геометрии`).toBeDefined();
      if (part === undefined) continue;
      expect(object.size.x).toBeCloseTo(part.size.x, 3);
      expect(object.size.y).toBeCloseTo(part.size.y, 3);
      expect(object.size.z).toBeCloseTo(part.size.z, 3);
    }
  });

  it('круговой путь через файл не меняет ни проект, ни расчёт', () => {
    const source = project();
    const restored = fromJson(toJson(source)).project;
    expect(toJson(restored)).toBe(toJson(source));
    expect(JSON.stringify(productionOf(restored))).toBe(JSON.stringify(productionOf(source)));
  });
});

describe('приёмка: правка проходит весь конвейер (§6)', () => {
  it('изменение габарита меняет и геометрию, и спецификацию, и раскрой', () => {
    const before = FIXTURES.shelves();
    const after = run(before, [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1500 },
    ]);

    const geometryChanged =
      JSON.stringify(geometryOf(before).parts) !== JSON.stringify(geometryOf(after).parts);
    expect(geometryChanged, 'габарит изменён, а геометрия та же').toBe(true);

    const productionBefore = productionOf(before);
    const productionAfter = productionOf(after);
    expect(
      JSON.stringify(productionBefore.bom.parts) !== JSON.stringify(productionAfter.bom.parts),
      'геометрия изменена, а деталировка та же — значит она устарела',
    ).toBe(true);
  });

  it('изменение толщины плиты доходит до размеров деталей', () => {
    const before = FIXTURES.carcass();
    const after = run(before, [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'panelThickness', value: 18 },
    ]);
    const sideBefore = geometryOf(before).parts.find((part) => part.role === 'side');
    const sideAfter = geometryOf(after).parts.find((part) => part.role === 'side');
    expect(sideBefore?.size.x).toBe(16);
    expect(sideAfter?.size.x).toBe(18);
  });
});
