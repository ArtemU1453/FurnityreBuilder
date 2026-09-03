import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { GeometryContext } from '../../../src/geometry/context.js';
import { makePart } from '../../../src/geometry/parts.js';
import { EMPTY_BOUNDING_BOX } from '../../../src/geometry/bounding-box.js';
import { NO_EDGE, asId, box3, hasErrors, vec3 } from '../../../src/domain/index.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Инварианты результата и аварийная остановка конвейера.
 *
 * Требование PROMPT 3 §12: недопустимый вход должен вернуть структурированную
 * ошибку, а не тихо построить геометрию поверх мусора. До этого этапа
 * `buildGeometry` сообщал об ошибке ДОБАВЛЯЯ её к списку деталей, часть
 * которых уже была построена на непригодных числах (например, боковина
 * со смещением x = −116 при отрицательной ширине). Эти тесты фиксируют
 * исправленное поведение: фатальная ошибка останавливает конвейер целиком.
 */

describe('аварийная остановка: отрицательные значения', () => {
  it('отрицательная ширина не производит ни одной детали', () => {
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    expect(result.parts).toHaveLength(0);
    expect(hasErrors(result.diagnostics)).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_POSITIVE');
  });

  it('ни одна деталь не получает отрицательную координату вместо отказа', () => {
    // Ключевой регрессионный тест: до исправления здесь возвращались 2 детали
    // с position.x = -116.
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    for (const part of result.parts) {
      expect(part.position.x).toBeGreaterThanOrEqual(0);
      expect(part.position.y).toBeGreaterThanOrEqual(0);
      expect(part.position.z).toBeGreaterThanOrEqual(0);
    }
  });

  it('отрицательная высота, глубина и толщина материала — тот же результат', () => {
    for (const dims of [{ height: -100 }, { depth: -100 }, { panelThickness: -16 }]) {
      const result = buildGeometry(makeGeometryInput(dims));
      expect(result.parts).toHaveLength(0);
      expect(hasErrors(result.diagnostics)).toBe(true);
    }
  });
});

describe('аварийная остановка: нулевые значения', () => {
  it('нулевая ширина — ошибка, а не вырожденная геометрия', () => {
    const result = buildGeometry(makeGeometryInput({ width: 0 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_POSITIVE');
  });

  it('нулевая высота — ошибка', () => {
    const result = buildGeometry(makeGeometryInput({ height: 0 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_POSITIVE');
  });

  it('нулевая глубина — ошибка', () => {
    const result = buildGeometry(makeGeometryInput({ depth: 0 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_POSITIVE');
  });

  it('нулевая толщина материала — ошибка', () => {
    const result = buildGeometry(makeGeometryInput({ panelThickness: 0 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_POSITIVE');
  });
});

describe('аварийная остановка: NaN и Infinity', () => {
  it('NaN в любом из четырёх параметров', () => {
    for (const dims of [
      { width: Number.NaN },
      { height: Number.NaN },
      { depth: Number.NaN },
      { panelThickness: Number.NaN },
    ]) {
      const result = buildGeometry(makeGeometryInput(dims));
      expect(result.parts).toHaveLength(0);
      expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_FINITE');
    }
  });

  it('+Infinity и −Infinity в любом из четырёх параметров', () => {
    for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = buildGeometry(makeGeometryInput({ width: value }));
      expect(result.parts).toHaveLength(0);
      expect(result.diagnostics.map((d) => d.code)).toContain('DIMENSION_NOT_FINITE');
    }
  });
});

describe('аварийная остановка: несовместимые размеры', () => {
  it('ширина меньше суммарной толщины боковин — ошибка, не мусорная геометрия', () => {
    // T=16, значит корпус физически не построить при ширине ≤ 32.
    const result = buildGeometry(makeGeometryInput({ width: 20, panelThickness: 16 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('WIDTH_BELOW_CARCASS');
  });

  it('высота меньше суммарной толщины горизонталей — ошибка', () => {
    const result = buildGeometry(makeGeometryInput({ height: 20, panelThickness: 16 }));
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('HEIGHT_BELOW_CARCASS');
  });
});

describe('вырожденный результат при фатальной ошибке', () => {
  it('bounds, innerVolume и boundingBox нулевые, а не мусорные', () => {
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    expect(result.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } });
    expect(result.innerVolume).toEqual({ min: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } });
    expect(result.boundingBox).toEqual(EMPTY_BOUNDING_BOX);
  });

  it('pendingStages по-прежнему честно перечисляет нереализованные этапы', () => {
    // Аварийная остановка — это не то же самое, что «этап не реализован».
    // Пропущенные из-за ошибки implemented-этапы НЕ должны попадать в
    // pendingStages: это ввело бы в заблуждение при появлении новых этапов.
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    // 'back' и 'base' реализованы на PROMPT 14 и из списка ушли —
    // нереализованными остались этапы 'countertop', 'edges', 'drilling'.
    // 'countertop' реализован на PROMPT 15; нереализованными остались
    // 'edges' (назначение кромки по ролям) и 'drilling' (присадка).
    expect(result.pendingStages).toContain('drilling');
    expect(result.pendingStages).not.toContain('countertop');
    expect(result.pendingStages).not.toContain('back');
    expect(result.pendingStages).not.toContain('base');
    expect(result.pendingStages).not.toContain('carcass');
    expect(result.pendingStages).not.toContain('normalize');
    expect(result.pendingStages).not.toContain('layout');
    expect(result.pendingStages).not.toContain('fill');
  });

  it('layout пропускается вместе с carcass: ячеек и перегородок тоже нет', () => {
    const result = buildGeometry(makeGeometryInput({ width: -100 }));
    expect(result.cells).toHaveLength(0);
  });
});

describe('успешный расчёт не останавливается преждевременно', () => {
  it('валидные габариты дают полный набор деталей без прерывания', () => {
    const result = buildGeometry(makeGeometryInput({}));
    expect(result.parts.length).toBeGreaterThan(0);
    expect(hasErrors(result.diagnostics)).toBe(false);
  });
});

describe('инвариант: уникальность идентификаторов деталей', () => {
  it('деталь с уже использованным id отбрасывается с диагностикой', () => {
    const input = makeGeometryInput({});
    const ctx = new GeometryContext(input, box3(vec3(0, 0, 0), vec3(0, 0, 0)));

    const partArgs = {
      furnitureId: input.furniture.id,
      role: 'side' as const,
      label: 'Дубликат 1',
      index: 0,
      position: vec3(0, 0, 0),
      size: vec3(16, 100, 100),
      orientation: 'vertical-yz' as const,
      materialId: asId<'Material'>('m1'),
      edge: NO_EDGE,
      edgeSizing: input.edgeSizing,
    };

    ctx.addPart(makePart(partArgs));
    // Тот же index/role/furnitureId/nodeId ⇒ тот же детерминированный id.
    ctx.addPart(makePart({ ...partArgs, label: 'Дубликат 2', position: vec3(500, 0, 0) }));

    const result = ctx.finish([]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.label).toBe('Дубликат 1');
    expect(result.diagnostics.map((d) => d.code)).toContain('PART_ID_DUPLICATE');
  });
});

describe('инвариант: положительность размера детали', () => {
  it('деталь с нулевым или отрицательным размером исключается из результата', () => {
    const input = makeGeometryInput({});
    const ctx = new GeometryContext(input, box3(vec3(0, 0, 0), vec3(0, 0, 0)));

    ctx.addPart(
      makePart({
        furnitureId: input.furniture.id,
        role: 'shelf-fixed',
        label: 'Плоская полка',
        index: 0,
        position: vec3(0, 0, 0),
        size: vec3(500, 0, 400), // нулевая толщина — деталь без объёма
        orientation: 'horizontal-xz',
        materialId: asId<'Material'>('m1'),
        edge: NO_EDGE,
        edgeSizing: input.edgeSizing,
      }),
    );

    const result = ctx.finish([]);
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('PART_SIZE_NOT_POSITIVE');
  });
});

describe('инвариант: неотрицательность координаты', () => {
  it('деталь за пределами изделия (отрицательная координата) исключается', () => {
    const input = makeGeometryInput({});
    const ctx = new GeometryContext(input, box3(vec3(0, 0, 0), vec3(0, 0, 0)));

    ctx.addPart(
      makePart({
        furnitureId: input.furniture.id,
        role: 'other',
        label: 'Деталь за пределами корпуса',
        index: 0,
        position: vec3(-10, 0, 0),
        size: vec3(100, 100, 100),
        orientation: 'horizontal-xz',
        materialId: asId<'Material'>('m1'),
        edge: NO_EDGE,
        edgeSizing: input.edgeSizing,
      }),
    );

    const result = ctx.finish([]);
    expect(result.parts).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain('PART_POSITION_NEGATIVE');
  });

  it('исправная деталь рядом с некорректной проходит независимо', () => {
    const input = makeGeometryInput({});
    const ctx = new GeometryContext(input, box3(vec3(0, 0, 0), vec3(0, 0, 0)));

    const good = makePart({
      furnitureId: input.furniture.id,
      role: 'other',
      label: 'Корректная деталь',
      index: 0,
      position: vec3(0, 0, 0),
      size: vec3(100, 100, 100),
      orientation: 'horizontal-xz',
      materialId: asId<'Material'>('m1'),
      edge: NO_EDGE,
      edgeSizing: input.edgeSizing,
    });
    const bad = makePart({
      furnitureId: input.furniture.id,
      role: 'other',
      label: 'Некорректная деталь',
      index: 1,
      position: vec3(0, -5, 0),
      size: vec3(100, 100, 100),
      orientation: 'horizontal-xz',
      materialId: asId<'Material'>('m1'),
      edge: NO_EDGE,
      edgeSizing: input.edgeSizing,
    });

    ctx.addPart(good);
    ctx.addPart(bad);

    const result = ctx.finish([]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.label).toBe('Корректная деталь');
  });
});
