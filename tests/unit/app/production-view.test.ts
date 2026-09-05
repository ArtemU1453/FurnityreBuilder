import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PART_FILTER,
  FIRST_SECTION,
  PRODUCTION_SECTIONS,
  itemOfSourcePart,
  materialOptions,
  nodeOrigin,
  partRows,
  traceOf,
  traceSummary,
  typeOptions,
  usesSectionList,
  visibleRows,
} from '../../../src/app/production/index.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { calculateProduction } from '../../../src/bom/index.js';
import type { MaterialId, NodeId } from '../../../src/domain/index.js';

/**
 * Разделы производства, отбор и трассируемость (PROMPT 29 §2, §27–§29).
 *
 * Модули чистые, поэтому проверяются без DOM. Смысл проверок — не
 * «функция вернула массив», а то, что интерфейс не переизобретает
 * группировку спецификации и не выдумывает связей, которых нет в данных.
 */

function sample() {
  const base = createProject({
    ids: createSequentialIdFactory('p'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const furniture0 = base.furniture[0]!;
  const project = {
    ...base,
    furniture: [
      {
        ...furniture0,
        dimensions: { ...furniture0.dimensions, width: 2000, height: 2000 },
        root: createUniformGrid(createSequentialIdFactory('g'), 2, 3, 16, 16, (ids) =>
          createShelvesLeaf(ids, 2),
        ),
      },
    ],
  };
  const furniture = project.furniture[0]!;
  const geometry = buildGeometry({
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });
  const calculation = calculateProduction(project, {
    geometry: new Map([[furniture.id, geometry]]),
  });
  return { project, geometry, calculation };
}

describe('разделы производства', () => {
  it('восемь разделов в заданном порядке, начиная со сводки', () => {
    expect(PRODUCTION_SECTIONS.map((s) => s.id)).toEqual([
      'overview',
      'parts',
      'drawings',
      'drilling',
      'cutting',
      'hardware',
      'bom',
      'documentation',
    ]);
    expect(FIRST_SECTION).toBe('overview');
  });

  it('на телефоне разделы показываются списком, а не восемью сегментами', () => {
    expect(usesSectionList('mobile')).toBe(true);
    expect(usesSectionList('tablet')).toBe(false);
    expect(usesSectionList('desktop')).toBe(false);
  });
});

describe('список деталей', () => {
  const { calculation } = sample();
  const items = calculation.bom.parts;
  const rows = partRows(items);

  it('группировку спецификации интерфейс не переизобретает', () => {
    // Четыре перегородки — ОДНА строка с количеством 4: так их
    // сгруппировал ProductionBOM, и разгруппировывать их здесь значило бы
    // показывать не то, что уйдёт в цех.
    const partition = rows.find((row) => row.item.partType === 'partition');
    expect(partition?.item.quantity).toBeGreaterThan(1);
    expect(rows).toHaveLength(items.length);
  });

  it('номер позиции не зависит от отбора', () => {
    const all = visibleRows(rows, DEFAULT_PART_FILTER);
    const filtered = visibleRows(rows, { ...DEFAULT_PART_FILTER, query: 'полка' });
    const first = filtered[0];
    expect(first).toBeDefined();
    // Тот же номер, что и в полном списке: иначе «деталь №5» значила бы
    // разное до и после поиска.
    expect(all.find((row) => row.item.id === first?.item.id)?.index).toBe(first?.index);
  });

  it('поиск ищет по имени, номеру, материалу и размеру', () => {
    expect(visibleRows(rows, { ...DEFAULT_PART_FILTER, query: 'Боковина' })).toHaveLength(1);
    expect(visibleRows(rows, { ...DEFAULT_PART_FILTER, query: 'плита' }).length).toBeGreaterThan(0);
    expect(visibleRows(rows, { ...DEFAULT_PART_FILTER, query: 'нетакого' })).toHaveLength(0);
  });

  it('пустой запрос ничего не отфильтровывает', () => {
    expect(visibleRows(rows, DEFAULT_PART_FILTER)).toHaveLength(rows.length);
    expect(visibleRows(rows, { ...DEFAULT_PART_FILTER, query: '   ' })).toHaveLength(rows.length);
  });

  it('фильтр по материалу и типу отбирает по реальным значениям', () => {
    const material = materialOptions(items)[0]!;
    const byMaterial = visibleRows(rows, { ...DEFAULT_PART_FILTER, materialId: material.id });
    expect(byMaterial.every((row) => row.item.materialId === material.id)).toBe(true);

    const type = typeOptions(items)[0]!;
    const byType = visibleRows(rows, { ...DEFAULT_PART_FILTER, partType: type });
    expect(byType.every((row) => row.item.partType === type)).toBe(true);
  });

  it('материал, которого в деталировке нет, не предлагается', () => {
    const options = materialOptions(items);
    expect(options.every((option) => items.some((item) => item.materialId === option.id))).toBe(
      true,
    );
    expect(
      visibleRows(rows, { ...DEFAULT_PART_FILTER, materialId: 'нет-такого' as MaterialId }),
    ).toHaveLength(0);
  });

  it('сортировка меняет порядок, но не состав', () => {
    const byQuantity = visibleRows(rows, { ...DEFAULT_PART_FILTER, sort: 'quantity' });
    expect(byQuantity).toHaveLength(rows.length);
    const quantities = byQuantity.map((row) => row.item.quantity);
    expect([...quantities].sort((a, b) => a - b)).toEqual(quantities);

    const descending = visibleRows(rows, {
      ...DEFAULT_PART_FILTER,
      sort: 'quantity',
      descending: true,
    });
    expect(descending.map((r) => r.item.id)).toEqual(
      [...byQuantity].reverse().map((r) => r.item.id),
    );
  });

  it('сортировка устойчива: равные ключи сохраняют порядок спецификации', () => {
    const sorted = visibleRows(rows, { ...DEFAULT_PART_FILTER, sort: 'material' });
    const sameMaterial = sorted.filter(
      (row) => row.item.materialName === sorted[0]?.item.materialName,
    );
    expect(sameMaterial.map((r) => r.index)).toEqual(
      [...sameMaterial.map((r) => r.index)].sort((a, b) => a - b),
    );
  });
});

describe('трассируемость', () => {
  const { geometry, calculation } = sample();
  const items = calculation.bom.parts;

  it('деталь находится по физической детали, а не по имени', () => {
    const item = items.find((entry) => entry.sourcePartIds.length > 0)!;
    const partId = item.sourcePartIds[0]!;
    expect(itemOfSourcePart(items, partId)?.id).toBe(item.id);
  });

  it('раскладка связывается по производственной детали, а не по позиции', () => {
    // `bom:…` и `pp:…` — разные идентификаторы. Сравнение напрямую не
    // находило ни одного размещения, и любая деталь выглядела
    // «не размещённой».
    const item = items.find((entry) => entry.partType === 'side')!;
    const trace = traceOf({
      item,
      geometry,
      drilling: calculation.drilling.byProductionPart,
      hardware: calculation.hardware.items,
      cutting: calculation.cutting,
    });
    expect(trace.placements.length).toBeGreaterThan(0);
    expect(trace.sheets.length).toBeGreaterThan(0);
    expect(
      trace.placements.every((placement) =>
        item.productionPartIds.includes(placement.productionPartId),
      ),
    ).toBe(true);
  });

  it('место в изделии берётся из геометрии, а не угадывается', () => {
    const cell = geometry.cells[0]!;
    const origin = nodeOrigin(geometry, cell.nodeId);
    expect(origin.label).toContain('ячейка');
    expect(origin.nodeId).toBe(cell.nodeId);
  });

  it('узел, которого в геометрии нет, называется собой, а не выдуманным местом', () => {
    const origin = nodeOrigin(geometry, 'нет-такого' as NodeId);
    expect(origin.label).toBe('нет-такого');
  });

  it('фурнитура связывается с деталью только через записанный источник', () => {
    const item = items[0]!;
    const trace = traceOf({
      item,
      geometry,
      drilling: calculation.drilling.byProductionPart,
      hardware: calculation.hardware.items,
      cutting: calculation.cutting,
    });
    expect(
      trace.hardware.every(
        (hw) => hw.sourcePartId !== undefined && item.sourcePartIds.includes(hw.sourcePartId),
      ),
    ).toBe(true);
  });

  it('сводка цепочки читается словами и не врёт про отсутствующее', () => {
    const item = items.find((entry) => entry.partType === 'shelf')!;
    const trace = traceOf({
      item,
      geometry,
      drilling: calculation.drilling.byProductionPart,
      hardware: calculation.hardware.items,
      cutting: calculation.cutting,
    });
    const summary = traceSummary(trace);
    expect(summary).toContain('лист');
    expect(summary).toContain('отверстий');
  });
});
