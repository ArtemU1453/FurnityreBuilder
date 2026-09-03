import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createSections, createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createEmptyLeaf } from '../../../src/domain/furniture/defaults.js';
import { hasErrors } from '../../../src/domain/index.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from './helpers.js';

/**
 * Тесты этапа раскладки (PROMPT 4 §21). Каждый Test N из задания — один
 * `describe`/`it`, чтобы соответствие было прямым и проверяемым.
 */

const DIMS = { width: 1000, height: 2000, depth: 500, panelThickness: 16 } as const;

describe('Test 1: базовый корпус (одна нераздёленная секция)', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createEmptyLeaf(ids), DIMS));

  it('2 боковины, верх, низ — без перегородок', () => {
    const roles = result.parts.map((p) => p.role).sort();
    // 'back' появилась на PROMPT 14: задняя стенка стала деталью.
    expect(roles).toEqual(['back', 'bottom', 'side', 'side', 'top']);
  });

  it('ровно одна ячейка на весь внутренний объём', () => {
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.box).toEqual(result.innerVolume);
  });

  it('без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

// Test 2 (1 секция) не выделен отдельным блоком: createSections рассчитан
// на count ≥ 2 (деление подразумевает минимум два ребёнка,
// docs/DATA_MODEL.md §15), а «1 секция» как понятие — это просто
// нераздёленный корпус, уже полностью покрытый Test 1.

describe('Test 3: 2 секции', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createSections(ids, 2, 16), DIMS));

  it('одна вертикальная перегородка, 2 ячейки', () => {
    expect(result.parts.filter((p) => p.role === 'partition')).toHaveLength(1);
    expect(result.cells).toHaveLength(2);
  });

  it('каждая ячейка — своя секция, на всю внутреннюю высоту', () => {
    const [a, b] = result.cells;
    expect(a?.sectionId).not.toBe(b?.sectionId);
    expect(a?.box.size.y).toBe(result.innerVolume.size.y);
    expect(b?.box.size.y).toBe(result.innerVolume.size.y);
  });

  it('секции равной ширины с учётом толщины перегородки', () => {
    // innerWidth = 968, 1 перегородка 16 мм: (968 − 16) / 2 = 476
    expect(result.cells[0]?.box.size.x).toBe(476);
    expect(result.cells[1]?.box.size.x).toBe(476);
  });

  it('без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('Test 4: 3 секции', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createSections(ids, 3, 16), DIMS));

  it('две перегородки, 3 ячейки, разные sectionId', () => {
    expect(result.parts.filter((p) => p.role === 'partition')).toHaveLength(2);
    expect(result.cells).toHaveLength(3);
    const sectionIds = new Set(result.cells.map((c) => c.sectionId));
    expect(sectionIds.size).toBe(3);
  });

  it('секции идут слева направо по возрастанию X без наложений', () => {
    const sorted = [...result.cells].sort((a, b) => a.box.min.x - b.box.min.x);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      expect(cur.box.min.x).toBeGreaterThan(prev.box.min.x + prev.box.size.x);
    }
  });
});

describe('Test 5: несколько колонок (одна строка)', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 4, 16, 16), DIMS));

  it('4 ячейки в один ряд, все row = 0', () => {
    expect(result.cells).toHaveLength(4);
    expect(result.cells.every((c) => c.row === 0)).toBe(true);
    expect(result.cells.map((c) => c.column).sort()).toEqual([0, 1, 2, 3]);
  });

  it('3 вертикальные перегородки, ни одной горизонтальной', () => {
    expect(result.parts.filter((p) => p.role === 'partition')).toHaveLength(3);
    expect(result.parts.filter((p) => p.role === 'shelf-fixed')).toHaveLength(0);
  });

  it('без обёртывающего деления по Y единственная строка структурно неотличима от N секций', () => {
    // Это не изъян теста, а честное следствие модели: «одна секция с 4
    // колонками, без единого ряда» и «4 независимые секции» — буквально
    // одно и то же дерево (SplitNode(x, 4 листа)), потому что делить строку
    // из одного элемента ещё одним делением нельзя — у SplitNode обязано
    // быть ≥ 2 детей (docs/DATA_MODEL.md §15). Секция определяется формой
    // дерева, а не отдельным флагом (см. `sectionIdFor` в stages/layout.ts),
    // поэтому в этом вырожденном случае у каждой колонки — собственный
    // sectionId, как и у настоящих секций. Проверяем именно это совпадение,
    // а не придуманное «должна быть одна секция».
    const sectionIds = new Set(result.cells.map((c) => c.sectionId));
    expect(sectionIds.size).toBe(result.cells.length);

    const asSections = buildGeometry(makeGeometryInputWithRoot((ids) => createSections(ids, 4, 16), DIMS));
    expect(result.cells.map((c) => c.box)).toEqual(asSections.cells.map((c) => c.box));
  });
});

describe('Test 6: несколько строк (одна колонка)', () => {
  const result = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 3, 1, 16, 16), DIMS));

  it('3 ячейки в столбец, все column = 0', () => {
    expect(result.cells).toHaveLength(3);
    expect(result.cells.every((c) => c.column === 0)).toBe(true);
    expect(result.cells.map((c) => c.row).sort()).toEqual([0, 1, 2]);
  });

  it('2 горизонтальных разделителя, ни одной вертикальной перегородки', () => {
    expect(result.parts.filter((p) => p.role === 'shelf-fixed')).toHaveLength(2);
    expect(result.parts.filter((p) => p.role === 'partition')).toHaveLength(0);
  });
});

describe('Test 7: изменение ширины пересчитывает секции, перегородки, ячейки и bounding box', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), { ...DIMS, width: 800 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), { ...DIMS, width: 1000 }));

  it('ширина ячеек и позиции перегородок меняются вместе с W', () => {
    expect(after.cells[0]?.box.size.x).not.toBe(before.cells[0]?.box.size.x);
    const partitionsBefore = before.parts.filter((p) => p.role === 'partition').map((p) => p.position.x);
    const partitionsAfter = after.parts.filter((p) => p.role === 'partition').map((p) => p.position.x);
    expect(partitionsAfter).not.toEqual(partitionsBefore);
  });

  it('bounding box отражает новую ширину', () => {
    expect(after.boundingBox.totalWidth).toBe(1000);
    expect(before.boundingBox.totalWidth).toBe(800);
  });

  it('количество ячеек и перегородок не меняется — меняются только размеры', () => {
    expect(after.cells).toHaveLength(before.cells.length);
    expect(after.parts).toHaveLength(before.parts.length);
  });
});

describe('Test 8: изменение высоты пересчитывает горизонтальную структуру', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 3, 1, 16, 16), { ...DIMS, height: 2000 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 3, 1, 16, 16), { ...DIMS, height: 2200 }));

  it('высота ячеек и позиции горизонтальных разделителей меняются вместе с H', () => {
    expect(after.cells[0]?.box.size.y).not.toBe(before.cells[0]?.box.size.y);
    const dividersBefore = before.parts.filter((p) => p.role === 'shelf-fixed').map((p) => p.position.y);
    const dividersAfter = after.parts.filter((p) => p.role === 'shelf-fixed').map((p) => p.position.y);
    expect(dividersAfter).not.toEqual(dividersBefore);
  });

  it('bounding box отражает новую высоту', () => {
    expect(after.boundingBox.totalHeight).toBe(2200);
    expect(before.boundingBox.totalHeight).toBe(2000);
  });
});

describe('Test 9: изменение глубины пересчитывает глубину ячеек', () => {
  const before = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 2, 16, 16), { ...DIMS, depth: 400 }));
  const after = buildGeometry(makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 2, 16, 16), { ...DIMS, depth: 500 }));

  it('глубина каждой ячейки и каждой перегородки меняется вместе с D', () => {
    expect(after.cells.every((c) => c.box.size.z > (before.cells.find((b) => b.row === c.row && b.column === c.column)?.box.size.z ?? 0))).toBe(true);
    // Задняя стенка (PROMPT 14) исключена намеренно: её размер по Z — это
    // толщина листа, а не глубина корпуса, и с D она не растёт.
    for (const part of after.parts.filter((p) => p.role !== 'back')) {
      expect(part.size.z).toBeGreaterThan(100);
    }
  });

  it('ширина и высота ячеек не зависят от глубины', () => {
    expect(after.cells[0]?.box.size.x).toBe(before.cells[0]?.box.size.x);
    expect(after.cells[0]?.box.size.y).toBe(before.cells[0]?.box.size.y);
  });
});

describe('Test 10: слишком маленький корпус', () => {
  it('корпус меньше толщины материала — ошибка ещё на этапе normalize/carcass, раскладка не запускается', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 3, 3, 16, 16), {
        width: 20,
        height: 20,
        depth: 80,
        panelThickness: 16,
      }),
    );
    expect(result.parts).toHaveLength(0);
    expect(result.cells).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
  });
});

describe('Test 11: слишком много секций для доступной ширины', () => {
  it('деление не помещается — ошибка, ноль мусорных ячеек для этой ветки', () => {
    // Внутренняя ширина 68 мм (100 − 2×16), 20 секций с перегородками 16 мм
    // каждая не могут поместиться ни при каком раскладе.
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createSections(ids, 20, 16), {
        width: 100,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    expect(result.cells).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('SPLIT_OVERCONSTRAINED');
  });

  it('каркас (боковины/верх/низ) остаётся построенным — испорчена только раскладка', () => {
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createSections(ids, 20, 16), {
        width: 100,
        height: 2000,
        depth: 500,
        panelThickness: 16,
      }),
    );
    // Errors от раскладки не должны стирать уже построенный (валидный) каркас:
    // пользователь видит корпус и понимает, что именно внутри него не сходится.
    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.parts.every((p) => p.role === 'side' || p.role === 'top' || p.role === 'bottom')).toBe(true);
  });

  it('соседняя валидная ветка дерева строится, даже если другая — нет', () => {
    // Секция 0 — валидная сетка 2×2, секция 1 — заведомо переопределённая
    // (слишком много колонок для доступной ширины половины корпуса).
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => ({
        id: ids.next<'Node'>(),
        kind: 'split' as const,
        axis: 'x' as const,
        divider: { material: 'panel' as const, thickness: 16, mounting: 'fixed' as const, frontSetback: 0 },
        children: [
          { size: { mode: 'flex' as const, weight: 1 }, node: createUniformGrid(ids, 2, 2, 16, 16) },
          { size: { mode: 'flex' as const, weight: 1 }, node: createSections(ids, 50, 16) },
        ],
      }), DIMS),
    );
    expect(hasErrors(result.diagnostics)).toBe(true);
    // Валидная секция дала свои 4 ячейки, несмотря на то, что соседняя сломана.
    expect(result.cells.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Test 12: serialize → deserialize → geometry', () => {
  it('раскладка с секциями и сеткой переживает круговой путь через JSON без изменений', async () => {
    const { toJson, fromJson } = await import('../../../src/persistence/serialization.js');
    const input = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 2, 3, 16, 16), DIMS);

    // Оборачиваем furniture в полноценный Project для сериализации —
    // GeometryInput сам по себе не является хранимой единицей.
    const { createProject } = await import('../../../src/domain/project/factory.js');
    const { createSequentialIdFactory } = await import('../../../src/domain/ids.js');
    const base = createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z' });
    const project = { ...base, furniture: [input.furniture] };

    const restored = fromJson(toJson(project)).project;
    const restoredInput = { ...input, furniture: restored.furniture[0]! };

    expect(buildGeometry(restoredInput)).toEqual(buildGeometry(input));
  });
});

describe('минимальный размер ячейки: предупреждение, не блокировка', () => {
  it('ячейка меньше MIN_CELL_SIZE даёт warning и остаётся в результате', () => {
    // Ширина 100, T=8: внутренняя ширина 84. 5 колонок с перегородками 4 мм:
    // (84 − 4×4) / 5 ≈ 13.6 мм на ячейку — заведомо меньше 50 мм.
    const result = buildGeometry(
      makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 5, 4, 4), {
        width: 100,
        height: 300,
        depth: 200,
        panelThickness: 8,
      }),
    );
    expect(result.cells).toHaveLength(5);
    expect(result.diagnostics.some((d) => d.code === 'CELL_BELOW_MIN_SIZE' && d.severity === 'warning')).toBe(true);
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('содержимое ячейки берётся из дерева, а не выдумывается заново', () => {
  it('cell.fill совпадает с fill соответствующего LeafNode', () => {
    const result = buildGeometry(makeGeometryInput(DIMS));
    expect(result.cells[0]?.fill).toEqual({ kind: 'empty' });
  });
});
