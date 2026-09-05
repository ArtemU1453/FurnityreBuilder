import { describe, expect, it } from 'vitest';
import { FIXTURES, geometryOf, productionOf, readinessOf } from './fixtures.js';
import type { FixtureName } from './fixtures.js';
import { toJson, fromJson } from '../../../src/persistence/serialization.js';

/**
 * Инварианты ВСЕГО конвейера (PROMPT 30 §4).
 *
 * Геометрия проверяется своими property-тестами с PROMPT 3, но дальше
 * неё — производственные детали, присадка, раскрой, спецификация —
 * инварианты до сих пор не проверялись сквозной проверкой. Ломается там
 * ровно то же самое: NaN, бесконечности, дубли и потерянные ссылки, и
 * ломается молча.
 */

const NAMES = Object.keys(FIXTURES) as FixtureName[];

/** Все числа объекта, включая вложенные: ищем NaN и бесконечности. */
function numbersOf(value: unknown, seen = new Set<unknown>()): number[] {
  if (typeof value === 'number') return [value];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Map) return [...value.values()].flatMap((item) => numbersOf(item, seen));
  return Object.values(value).flatMap((item) => numbersOf(item, seen));
}

describe.each(NAMES)('инварианты конвейера: фикстура «%s»', (name) => {
  const project = FIXTURES[name]();
  const geometry = geometryOf(project);
  const production = productionOf(project);

  it('ни одного NaN и ни одной бесконечности во всём результате', () => {
    // Проверяется весь расчёт целиком, а не только геометрия: NaN,
    // родившийся в раскрое, до сих пор никем не ловился.
    const numbers = [
      ...numbersOf(geometry),
      ...numbersOf(production.bom),
      ...numbersOf(production.cutting),
      ...numbersOf(production.hardware),
      ...numbersOf(production.drilling),
    ];
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.filter((n) => !Number.isFinite(n))).toEqual([]);
  });

  it('размеры деталей положительны', () => {
    for (const part of geometry.parts) {
      expect(part.size.x, part.id).toBeGreaterThan(0);
      expect(part.size.y, part.id).toBeGreaterThan(0);
      expect(part.size.z, part.id).toBeGreaterThan(0);
    }
  });

  it('идентификаторы деталей уникальны', () => {
    const ids = geometry.parts.map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('идентификаторы ячеек и секций уникальны', () => {
    const cells = geometry.cells.map((cell) => cell.nodeId);
    expect(new Set(cells).size).toBe(cells.length);
    const sections = geometry.sections.map((section) => section.nodeId);
    expect(new Set(sections).size).toBe(sections.length);
  });

  it('ячейка не становится деталью', () => {
    // Ячейка — пространство. Если её идентификатор появился среди
    // деталей, значит пространство поехало в цех.
    const cells = new Set(geometry.cells.map((cell) => String(cell.nodeId)));
    expect(geometry.parts.filter((part) => cells.has(String(part.id)))).toEqual([]);
  });

  it('каждая деталь принадлежит существующему изделию', () => {
    const furnitureIds = new Set(project.furniture.map((item) => String(item.id)));
    for (const part of geometry.parts) {
      expect(furnitureIds.has(String(part.origin.furnitureId)), part.id).toBe(true);
    }
  });

  it('каждая позиция деталировки ссылается на существующие детали', () => {
    const partIds = new Set(geometry.parts.map((part) => String(part.id)));
    for (const item of production.bom.parts) {
      expect(item.sourcePartIds.length, item.id).toBeGreaterThan(0);
      for (const id of item.sourcePartIds) expect(partIds.has(String(id)), item.id).toBe(true);
    }
  });

  it('каждое размещение раскроя ссылается на существующую производственную деталь', () => {
    const productionIds = new Set(production.cutting.productionParts.map((part) => part.id));
    for (const layout of production.cutting.layouts) {
      for (const placement of layout.placements) {
        expect(productionIds.has(placement.productionPartId), placement.id).toBe(true);
      }
    }
  });

  it('каждая операция присадки ссылается на существующую деталь', () => {
    const productionIds = new Set(production.cutting.productionParts.map((part) => part.id));
    for (const operation of production.drilling.operations) {
      expect(productionIds.has(operation.productionPartId), operation.id).toBe(true);
    }
  });

  it('каждая позиция фурнитуры ссылается на существующую деталь, если ссылается вообще', () => {
    const partIds = new Set(geometry.parts.map((part) => String(part.id)));
    for (const item of production.hardware.items) {
      if (item.sourcePartId === undefined) continue;
      expect(partIds.has(String(item.sourcePartId)), item.id).toBe(true);
    }
  });

  it('деталь не размещается на листе дважды', () => {
    const placed = production.cutting.layouts.flatMap((layout) =>
      layout.placements.map(
        (placement) => `${placement.productionPartId}#${String(placement.instanceIndex)}`,
      ),
    );
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('количество в спецификации совпадает с числом физических деталей', () => {
    for (const item of production.bom.parts) {
      expect(item.quantity, item.id).toBe(item.sourcePartIds.length);
    }
  });

  it('расчёт детерминирован: два прогона дают один результат', () => {
    expect(productionOf(FIXTURES[name]())).toEqual(production);
  });

  it('сохранение и загрузка не меняют расчёт', () => {
    const restored = fromJson(toJson(project)).project;
    expect(productionOf(restored)).toEqual(production);
  });

  it('готовность вычисляется и содержит восемь разделов', () => {
    const readiness = readinessOf(project);
    expect(readiness.checks).toHaveLength(8);
    expect(readiness.status).toBeDefined();
  });
});
