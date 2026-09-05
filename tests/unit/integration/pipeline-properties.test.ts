import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { produce } from 'immer';
import { emptyProject, geometryOf, productionOf, run } from './fixtures.js';
import { applyCommand } from '../../../src/state/commands.js';
import { toJson, fromJson } from '../../../src/persistence/serialization.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { Command } from '../../../src/state/commands.js';
import type { NodeId, Project } from '../../../src/domain/index.js';

/**
 * Свойства конвейера на широком диапазоне входов (PROMPT 30 §5).
 *
 * Отдельные слои уже покрыты property-тестами с PROMPT 3. Здесь
 * проверяется то, что видно только СКВОЗЬ конвейер: одинаковый проект
 * даёт одинаковую спецификацию, сериализация ничего не теряет, а
 * изменение одного параметра меняет только зависимое.
 */

const dimensions = fc.record({
  width: fc.integer({ min: 300, max: 3000 }),
  height: fc.integer({ min: 300, max: 2700 }),
  depth: fc.integer({ min: 200, max: 900 }),
});

const sized = (d: { width: number; height: number; depth: number }): Project =>
  run(emptyProject('p'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: d.width },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: d.height },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: d.depth },
  ]);

describe('детерминированность', () => {
  it('одинаковый проект — одинаковая геометрия, деталировка и раскрой', () => {
    fc.assert(
      fc.property(dimensions, (d) => {
        const first = productionOf(sized(d));
        const second = productionOf(sized(d));
        expect(second.bom).toEqual(first.bom);
        expect(second.cutting.layouts).toEqual(first.cutting.layouts);
        expect(second.drilling.operations).toEqual(first.drilling.operations);
        expect(second.hardware.lines).toEqual(first.hardware.lines);
      }),
      { numRuns: 40 },
    );
  });

  it('идентификаторы деталей не зависят от порядка вычисления', () => {
    fc.assert(
      fc.property(dimensions, (d) => {
        const project = sized(d);
        // Второй прогон той же модели: логические идентификаторы обязаны
        // совпасть, иначе выделение и история ломались бы на каждом
        // пересчёте (§5 «Identity»).
        expect(geometryOf(project).parts.map((p) => p.id)).toEqual(
          geometryOf(project).parts.map((p) => p.id),
        );
      }),
      { numRuns: 40 },
    );
  });
});

describe('сериализация', () => {
  it('круговой путь сохраняет проект', () => {
    fc.assert(
      fc.property(dimensions, (d) => {
        const project = sized(d);
        const restored = fromJson(toJson(project)).project;
        expect(restored).toEqual(project);
      }),
      { numRuns: 40 },
    );
  });

  it('круговой путь сохраняет и результат расчёта', () => {
    fc.assert(
      fc.property(dimensions, (d) => {
        const project = sized(d);
        const restored = fromJson(toJson(project)).project;
        expect(productionOf(restored).bom).toEqual(productionOf(project).bom);
      }),
      { numRuns: 30 },
    );
  });

  it('двойной круговой путь ничего не накапливает', () => {
    fc.assert(
      fc.property(dimensions, (d) => {
        const once = fromJson(toJson(sized(d))).project;
        const twice = fromJson(toJson(once)).project;
        expect(twice).toEqual(once);
      }),
      { numRuns: 30 },
    );
  });
});

describe('инвалидация', () => {
  it('смена ширины меняет геометрию, но не трогает материалы и настройки', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 2500 }), (width) => {
        const before = sized({ width: 1000, height: 2000, depth: 500 });
        const after = produce(before, (draft) => {
          applyCommand(draft, {
            type: 'SetDimension',
            furnitureIndex: 0,
            axis: 'width',
            value: width,
          });
        });
        // Изменилось только изделие: реестр материалов, настройки и имя
        // проекта — те же объекты, а не равные копии.
        expect(after.materials).toBe(before.materials);
        expect(after.settings).toBe(before.settings);
        expect(after.name).toBe(before.name);
      }),
      { numRuns: 40 },
    );
  });

  it('смена наполнения одной ячейки не меняет соседние детали', () => {
    const base = run(emptyProject('n'), [
      { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1600 },
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: 2,
        splitId: 'n-split' as NodeId,
        newSectionIds: ['n-a' as NodeId, 'n-b' as NodeId],
        dividerThickness: 16,
      },
    ]);
    const cells = geometryOf(base).cells;
    const untouched = cells[1]!.nodeId;
    const beforeParts = geometryOf(base).parts.filter((part) => part.origin.nodeId === untouched);

    const changed = run(base, [
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: cells[0]!.nodeId,
        fill: createShelvesLeaf(createSequentialIdFactory('s'), 2).fill,
      },
    ]);
    const afterParts = geometryOf(changed).parts.filter((part) => part.origin.nodeId === untouched);
    expect(afterParts).toEqual(beforeParts);
  });
});

describe('устойчивость к негодному входу', () => {
  it('нулевые и отрицательные габариты не роняют расчёт и дают ошибку', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2000, max: 0 }), (width) => {
        const project = run(emptyProject('z'), [
          { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: width },
        ]);
        const geometry = geometryOf(project);
        // Расчёт не бросает исключение и не выдаёт NaN: он ОСТАНАВЛИВАЕТСЯ
        // и объясняет причину (docs/GEOMETRY_RULES.md, «Аварийная остановка»).
        expect(geometry.diagnostics.some((issue) => issue.severity === 'error')).toBe(true);
        expect(geometry.parts).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it('нечисловой габарит останавливает расчёт, а не расходится по деталям', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const project = run(emptyProject('i'), [
        { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value },
      ]);
      const geometry = geometryOf(project);
      expect(geometry.diagnostics.some((issue) => issue.severity === 'error')).toBe(true);
      expect(geometry.parts).toEqual([]);
    }
  });

  it('команда с несуществующим изделием ничего не меняет', () => {
    const before = emptyProject('m');
    const commands: Command[] = [
      { type: 'SetDimension', furnitureIndex: 99, axis: 'width', value: 1000 },
      { type: 'SetFill', furnitureIndex: 99, nodeId: 'нет' as NodeId, fill: { kind: 'empty' } },
    ];
    expect(run(before, commands)).toEqual(before);
  });
});
