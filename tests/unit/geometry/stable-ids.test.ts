import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { makeGeometryInputWithRoot } from './helpers.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';

/**
 * PROMPT 4 §23: одинаковая доменная модель, посчитанная дважды, не должна
 * получать случайные новые ID. Это условие для выделения, undo/redo,
 * будущего drag и экспорта — если id детали меняются от одного пересчёта
 * к другому без изменения структуры дерева, выделение и открытая панель
 * свойств слетают на каждое движение ползунка (docs/INTERACTION_MODEL.md §9).
 *
 * Домен здесь один и тот же ОБЪЕКТ (input A), а не «эквивалентная копия» —
 * геометрия детерминирована и от объектной идентичности не зависит, но тест
 * называет сценарий в точности так, как он сформулирован в задании.
 */
describe('стабильность идентификаторов при повторном расчёте', () => {
  it('id ячеек совпадают между двумя независимыми вызовами buildGeometry', () => {
    const input = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), {
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });

    const a = buildGeometry(input);
    const b = buildGeometry(input);

    expect(a.cells.map((c) => c.nodeId)).toEqual(b.cells.map((c) => c.nodeId));
  });

  it('id перегородок совпадают между двумя независимыми вызовами buildGeometry', () => {
    const input = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), {
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });

    const a = buildGeometry(input);
    const b = buildGeometry(input);

    const dividerIdsA = a.parts.filter((p) => p.role === 'partition' || p.role === 'shelf-fixed').map((p) => p.id);
    const dividerIdsB = b.parts.filter((p) => p.role === 'partition' || p.role === 'shelf-fixed').map((p) => p.id);
    expect(dividerIdsA).toEqual(dividerIdsB);
    expect(dividerIdsA.length).toBeGreaterThan(0);
  });

  it('id остаются теми же, когда меняется ТОЛЬКО габарит, а структура дерева — нет', () => {
    const base = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), {
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });
    const widened = { ...base, furniture: { ...base.furniture, dimensions: { ...base.furniture.dimensions, width: 1400 } } };

    const before = buildGeometry(base);
    const after = buildGeometry(widened);

    // Позиции и размеры меняются — это и есть параметрический пересчёт.
    expect(after.cells[0]?.box.size.x).not.toBe(before.cells[0]?.box.size.x);
    // А сами идентификаторы — нет: выделение и открытая панель свойств
    // не должны слетать при перетаскивании габаритного маркера.
    expect(after.cells.map((c) => c.nodeId)).toEqual(before.cells.map((c) => c.nodeId));
    expect(after.parts.map((p) => p.id)).toEqual(before.parts.map((p) => p.id));
  });

  it('id меняются предсказуемо, когда меняется САМА структура дерева', () => {
    // Один и тот же генератор id для обеих структур — как в реальном сеансе
    // работы: пользователь превращает дерево из 2 колонок в 3, а не
    // открывает два независимых проекта. Раздельные генераторы здесь дали
    // бы ложное совпадение id (оба стартуют с t-1) — это была бы ошибка
    // теста, а не системы.
    const ids = createSequentialIdFactory('t');
    const project = createProject({ ids, now: () => '2026-01-01T00:00:00.000Z' });
    const furniture = project.furniture[0]!;
    const dims = { width: 1000, height: 2000, depth: 500, panelThickness: 16 };
    const baseInput = {
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    };

    const twoColumnsRoot = createUniformGrid(ids, 1, 2, 16, 16);
    const threeColumnsRoot = createUniformGrid(ids, 1, 3, 16, 16);

    const a = buildGeometry({ ...baseInput, furniture: { ...furniture, dimensions: dims, root: twoColumnsRoot } });
    const b = buildGeometry({ ...baseInput, furniture: { ...furniture, dimensions: dims, root: threeColumnsRoot } });

    // Структура другая — id узлов дерева (а значит и cell.nodeId) другие,
    // потому что дерево построено заново, а не переиспользовано.
    const idsA = new Set(a.cells.map((c) => c.nodeId));
    const idsB = new Set(b.cells.map((c) => c.nodeId));
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
  });
});
