import { describe, expect, it } from 'vitest';
import { calculateProduction } from '../../../src/bom/index.js';
import { buildProductionExportData, mmValue, edgeText, lengthM, percentValue } from '../../../src/export/index.js';
import {
  createCountertop,
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { NO_EDGE } from '../../../src/domain/index.js';
import type { Material, Project } from '../../../src/domain/index.js';
import { exportDataOf, GENERATED_AT, makeProject } from './helpers.js';

/**
 * Расчёт → данные документа (PROMPT 20 §16).
 *
 * Главное, что проверяется: экспорт ничего не считает сам. Каждая строка
 * документа обязана совпадать со строкой производственной спецификации —
 * иначе в цехе окажется документ, расходящийся с расчётом, и никто не
 * узнает об этом до распила.
 */

describe('Test 1–3 (§2): данные документа повторяют спецификацию', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') }));
  const result = calculateProduction(project);
  const data = exportDataOf(project);

  it('Test 1: строки деталей совпадают со спецификацией один в один', () => {
    expect(data.parts).toHaveLength(result.bom.parts.length);
    data.parts.forEach((row, index) => {
      const source = result.bom.parts[index]!;
      expect(row.id).toBe(source.id);
      expect(row.quantity).toBe(source.quantity);
      expect(row.length).toBe(mmValue(source.length));
      expect(row.width).toBe(mmValue(source.width));
      expect(row.thickness).toBe(mmValue(source.thickness));
      expect(row.materialName).toBe(source.materialName);
      expect(row.edge).toBe(edgeText(source.edgeBanding));
    });
  });

  it('Test 2: количество деталей в документе равно количеству в расчёте', () => {
    const documentTotal = data.parts.reduce((sum, row) => sum + row.quantity, 0);
    const bomTotal = result.bom.parts.reduce((sum, item) => sum + item.quantity, 0);
    expect(data.totals.partQuantity).toBe(bomTotal);
    expect(documentTotal).toBe(bomTotal);
  });

  it('Test 3: фурнитура, присадка и раскрой берутся из своих разделов', () => {
    expect(data.hardware).toHaveLength(result.bom.hardware.lines.length);
    expect(data.drilling).toHaveLength(result.drilling.operations.length);
    expect(data.sheets).toHaveLength(result.cutting.layouts.length);
    expect(data.totals.sheetCount).toBe(result.bom.cutting.stockCount);
    expect(data.totals.utilization).toBe(percentValue(result.bom.cutting.utilization));
  });
});

describe('Test 4–6 (§8, §10): материалы, кромка и единицы', () => {
  const project = makeProject((f, ids) => ({
    ...f,
    root: createShelvesLeaf(ids, 2, 'adjustable'),
    carcass: { ...f.carcass, base: createPlinthBase(100), countertop: createCountertop(38, f.carcass.back.materialId) },
  }));
  const data = exportDataOf(project);

  it('Test 4: сводка материалов покрывает все использованные материалы', () => {
    const used = new Set(data.parts.map((row) => row.materialId));
    expect(new Set(data.materials.map((row) => row.materialId))).toEqual(used);
    for (const row of data.materials) {
      expect(row.partQuantity).toBeGreaterThan(0);
      expect(row.areaM2).toBeGreaterThan(0);
    }
  });

  it('Test 5: кромка переводится в погонные метры из спецификации', () => {
    expect(data.edgeBanding).toHaveLength(data.edgeSummary.length);
    data.edgeBanding.forEach((row, index) => {
      expect(row.lengthM).toBe(lengthM(data.edgeSummary[index]!.lengthMm));
    });
  });

  it('Test 6: размеры округляются одинаково и не дают хвостов', () => {
    for (const row of data.parts) {
      for (const value of [row.length, row.width, row.thickness]) {
        expect(Number.isFinite(value)).toBe(true);
        // Не больше одного знака после запятой: «497.0000000001» в
        // производственном документе — брак документа.
        expect(String(value)).toMatch(/^-?\d+(\.\d)?$/);
        expect(Object.is(value, -0)).toBe(false);
      }
    }
  });
});

describe('Test 7–8 (§12): трассируемость и стабильные идентификаторы', () => {
  const project = makeProject((f, ids) => {
    const facade = createHingedFacade(ids, f.root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...f,
      root: createDrawersLeaf(ids, 2),
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
    };
  });
  const result = calculateProduction(project);
  const data = exportDataOf(project);

  it('Test 7: каждая строка несёт идентификаторы физических деталей', () => {
    for (const row of data.parts) {
      expect(row.sourcePartIds).toHaveLength(row.quantity);
      for (const id of row.sourcePartIds) expect(id.startsWith('part:')).toBe(true);
    }
  });

  it('Test 8: идентификаторы не выдумываются экспортом', () => {
    const bomIds = new Set(result.bom.parts.map((item) => item.id));
    for (const row of data.parts) expect(bomIds.has(row.id)).toBe(true);
    for (const row of data.placements) expect(bomIds.has(row.partId)).toBe(true);
  });
});

describe('Test 9–11 (§13): детерминизм', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') }));

  it('Test 9: одинаковый проект даёт одинаковые данные документа', () => {
    expect(JSON.stringify(exportDataOf(project))).toBe(JSON.stringify(exportDataOf(project)));
  });

  it('Test 10: дата генерации — единственное, что отличается', () => {
    const result = calculateProduction(project);
    const first = buildProductionExportData(project, result, { generatedAt: '2026-01-01 09:00' });
    const second = buildProductionExportData(project, result, { generatedAt: '2030-12-31 23:59' });
    expect(second.metadata.generatedAt).not.toBe(first.metadata.generatedAt);
    expect(JSON.stringify({ ...second, metadata: { ...second.metadata, generatedAt: GENERATED_AT } })).toBe(
      JSON.stringify({ ...first, metadata: { ...first.metadata, generatedAt: GENERATED_AT } }),
    );
  });

  it('Test 11: подготовка данных не изменяет проект', () => {
    const snapshot = JSON.stringify(project);
    exportDataOf(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

describe('Test 12–15 (§11, §16): статусы расчёта в документе', () => {
  it('Test 12: обычный проект помечен как требующий подтверждения', () => {
    const data = exportDataOf(makeProject());
    expect(data.metadata.status).toBe('NEEDS_CONFIRMATION');
    expect(data.confirmations.length).toBeGreaterThan(0);
    // Список неподтверждённых правил обязан быть в документе целиком:
    // «часть данных предварительна» без перечня — бесполезная оговорка.
    for (const item of data.confirmations) {
      expect(item.id).toMatch(/^T-/);
      expect(item.impact.length).toBeGreaterThan(0);
    }
  });

  it('Test 13: проект с ошибкой геометрии помечен как INVALID', () => {
    const data = exportDataOf(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } })));
    expect(data.metadata.status).toBe('INVALID');
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.parts).toHaveLength(0);
  });

  it('Test 14: неразмещённые детали попадают в документ, а не теряются', () => {
    const base = makeProject();
    const noSheet: Project = {
      ...base,
      materials: {
        ...base.materials,
        items: Object.fromEntries(
          Object.entries(base.materials.items).map(([id, m]): [string, Material] => {
            const { sheet: _sheet, ...rest } = m;
            return [id, rest];
          }),
        ),
      },
    };
    const data = exportDataOf(noSheet);
    expect(data.unplaced.length).toBeGreaterThan(0);
    expect(data.totals.unplaced).toBe(data.unplaced.length);
    for (const row of data.unplaced) expect(row.reason).toBe('INVALID_STOCK');
  });

  it('Test 15: чертежи готовятся только для деталей с присадкой', () => {
    // Присадка по умолчанию не считается (параметры не подтверждены),
    // поэтому чертежей нет — и это правильный результат, а не пропуск.
    const data = exportDataOf(makeProject());
    expect(data.drilling).toHaveLength(0);
    expect(data.drawings).toHaveLength(0);
  });
});

describe('Test 16 (§3): общие размеры берутся из модели', () => {
  it('габариты и конструктивные параметры совпадают с изделием', () => {
    const project = makeProject((f) => ({
      ...f,
      dimensions: { ...f.dimensions, width: 1234, height: 2345, depth: 456 },
      carcass: { ...f.carcass, base: createPlinthBase(120) },
    }));
    const data = exportDataOf(project);
    expect(data.dimensions.width).toBe(1234);
    expect(data.dimensions.height).toBe(2345);
    expect(data.dimensions.depth).toBe(456);
    expect(data.dimensions.base).toContain('120');
    expect(data.dimensions.backPanel).toBe('overlay');
  });

  it('деталь без кромки показывается нулями, а не пустой строкой', () => {
    expect(edgeText(NO_EDGE)).toBe('0/0/0/0');
  });
});
