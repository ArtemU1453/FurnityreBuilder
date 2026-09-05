import { describe, expect, it } from 'vitest';
import { FIXTURES, productionOf, readinessOf } from './fixtures.js';
import type { FixtureName } from './fixtures.js';

/**
 * Регрессия производственного расчёта (PROMPT 30 §11).
 *
 * ## Что здесь зафиксировано и почему именно это
 *
 * Зафиксированы КОЛИЧЕСТВА, а не координаты: число позиций деталировки,
 * число деталей, число листов, число размещённых и неразмещённых. Это
 * величины, которые обязаны меняться только вместе с правилом или
 * моделью, и молча меняться не могут — изменение любой из них означает,
 * что в цех уедет другое изделие.
 *
 * НЕ зафиксированы: координаты деталей, раскладка на листе, порядок
 * размещения. Они архитектурно динамические — раскладка перестраивается
 * при любом изменении размеров, — и фиксировать их значило бы менять
 * тест при каждой правке движка, не узнавая при этом ничего нового.
 * Детерминированность самой раскладки проверяется отдельно
 * (`pipeline-properties.test.ts`), там она и должна проверяться.
 *
 * ## Как обновлять
 *
 * Изменилось число — сначала объясните, какое правило изменилось. Если
 * объяснения нет, это регрессия, а не устаревшая цифра.
 */

interface Baseline {
  readonly bomPositions: number;
  readonly partQuantity: number;
  readonly hardwareLines: number;
  readonly drillingOperations: number;
  readonly sheets: number;
  readonly placed: number;
  readonly unplaced: number;
  readonly status: string;
  readonly readiness: string;
  /** Почему фикстура именно такая, если это не очевидно. */
  readonly note?: string;
}

const BASELINES: Readonly<Record<FixtureName, Baseline>> = {
  // 800×1800×500: две боковины, дно, крышка, задняя стенка.
  carcass: {
    bomPositions: 4,
    partQuantity: 5,
    hardwareLines: 0,
    drillingOperations: 0,
    sheets: 2,
    placed: 5,
    unplaced: 0,
    status: 'NEEDS_CONFIRMATION',
    readiness: 'NEEDS_CONFIRMATION',
  },
  // Тот же корпус и три съёмные полки: +3 детали, +1 строка фурнитуры
  // (полкодержатели), деталировка группирует полки в одну позицию.
  shelves: {
    bomPositions: 5,
    partQuantity: 8,
    hardwareLines: 1,
    drillingOperations: 0,
    sheets: 2,
    placed: 8,
    unplaced: 0,
    status: 'NEEDS_CONFIRMATION',
    readiness: 'NEEDS_CONFIRMATION',
  },
  // Две секции и одна распашная створка.
  doors: {
    bomPositions: 6,
    partQuantity: 7,
    hardwareLines: 0,
    drillingOperations: 0,
    sheets: 3,
    placed: 7,
    unplaced: 0,
    status: 'NEEDS_CONFIRMATION',
    readiness: 'NEEDS_CONFIRMATION',
  },
  // Пять ящиков в двух секциях: короба геометрией не строятся
  // (`T-DRW-02`), поэтому в деталировке только фасады.
  drawers: {
    bomPositions: 7,
    partQuantity: 11,
    hardwareLines: 1,
    drillingOperations: 0,
    sheets: 2,
    placed: 11,
    unplaced: 0,
    status: 'NEEDS_CONFIRMATION',
    readiness: 'NEEDS_CONFIRMATION',
  },
  // Сложный проект 2400×2200: сетка 3×3, полки, ящики, дверь, цоколь.
  //
  // Одна деталь НЕ размещается, и это правильный результат, а не дефект
  // фикстуры: цельная задняя стенка 2100×2400 мм не помещается на лист
  // 2750×1830 ни в каком повороте. Расчёт сообщает об этом ошибкой
  // BOM_PART_NOT_PLACED и ставит статус INVALID — ровно то поведение,
  // которого ждут от производственного расчёта. Фикстура намеренно
  // сохранена такой: она сторожит и путь «деталь не помещается», и то,
  // что этот путь виден, а не проглочен.
  complex: {
    bomPositions: 12,
    partQuantity: 27,
    hardwareLines: 2,
    drillingOperations: 0,
    sheets: 5,
    placed: 26,
    unplaced: 1,
    status: 'INVALID',
    readiness: 'INVALID',
    note: 'цельная задняя стенка 2100×2400 не помещается на лист 2750×1830',
  },
};

const NAMES = Object.keys(BASELINES) as FixtureName[];

describe.each(NAMES)('фикстура «%s»', (name) => {
  const baseline = BASELINES[name];
  const production = productionOf(FIXTURES[name]());

  it('число позиций деталировки и деталей не изменилось', () => {
    expect(production.bom.parts).toHaveLength(baseline.bomPositions);
    expect(production.bom.parts.reduce((sum, item) => sum + item.quantity, 0)).toBe(
      baseline.partQuantity,
    );
  });

  it('число строк фурнитуры не изменилось', () => {
    expect(production.bom.hardware.lines).toHaveLength(baseline.hardwareLines);
  });

  it('число операций присадки не изменилось', () => {
    // Ноль — не заглушка: ни одно правило присадки не подтверждено
    // референсом (docs/DRILLING_UI.md §2). Ненулевое значение здесь
    // означало бы, что появилось подтверждённое правило, — и это должно
    // быть заметным изменением, а не тихим.
    expect(production.drilling.operations).toHaveLength(baseline.drillingOperations);
  });

  it('раскрой: листы, размещённые и неразмещённые детали', () => {
    expect(production.bom.cutting.stockCount).toBe(baseline.sheets);
    expect(production.bom.cutting.placedParts).toBe(baseline.placed);
    expect(production.bom.cutting.unplacedParts).toBe(baseline.unplaced);
  });

  it('неразмещённая деталь всегда объяснена', () => {
    for (const entry of production.cutting.unplaced) {
      expect(entry.reason).toBeDefined();
      expect(entry.detail.length).toBeGreaterThan(0);
    }
    // И попадает в ошибки спецификации, а не теряется в раскрое.
    if (baseline.unplaced > 0) {
      expect(production.bom.errors.some((issue) => issue.code === 'BOM_PART_NOT_PLACED')).toBe(
        true,
      );
    }
  });

  it('статус расчёта и готовности не изменился', () => {
    expect(production.status).toBe(baseline.status);
    expect(readinessOf(FIXTURES[name]()).status).toBe(baseline.readiness);
  });

  it('деталировка и раскрой согласованы между собой', () => {
    const placed = production.cutting.layouts.reduce(
      (sum, layout) => sum + layout.placements.length,
      0,
    );
    expect(placed + production.cutting.unplaced.length).toBe(baseline.partQuantity);
  });
});
