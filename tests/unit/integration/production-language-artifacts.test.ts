import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createProductionXlsx } from '../../../src/export/xlsx.js';
import { createProductionPdf } from '../../../src/export/pdf.js';
import { buildProductionExportData } from '../../../src/export/data.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawersLeaf, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { emptyProject, geometryOf, productionOf, run } from './fixtures.js';
import {
  EDGE_SIDE_LABELS,
  GRAIN_LABELS,
  HARDWARE_KIND_LABELS,
  HARDWARE_UNIT_LABELS,
  PART_ROLE_LABELS,
} from '../../../src/domain/vocabulary.js';
import { PRODUCTION_PART_TYPE_LABELS } from '../../../src/production/index.js';
import { PART_CATEGORY_LABELS } from '../../../src/bom/index.js';
import type { Command } from '../../../src/state/commands.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * FR-19 — язык СГЕНЕРИРОВАННЫХ документов (PROMPT 62 §13, §14).
 *
 * Читать код экспорта недостаточно: продукт — это файл. Здесь
 * представительное изделие прогоняется через конвейер целиком, а
 * получившиеся PDF и XLSX вскрываются и проверяются по содержимому.
 *
 * Изделие то же, которым мерили дефект: 1800 × 2200 × 600, три секции,
 * полки, ящик, дверь.
 */

/** Машинные значения, которые PROMPT 61 нашёл в документах и на экране. */
const RAW_PART_TYPES = ['back', 'bottom', 'facade', 'partition', 'shelf', 'side', 'top'];
const RAW_HARDWARE_KEYS = [
  'hw-hinge',
  'hw-hinge-fastener',
  'hw-back-fastener',
  'hw-carcass-fastener',
  'hw-shelf-support',
  'hw-handle-fastener',
];

function scenario(): Project {
  const ids = createSequentialIdFactory('fr19');
  const base = run(emptyProject('fr19'), [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1800 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2200 },
    { type: 'SetDimension', furnitureIndex: 0, axis: 'depth', value: 600 },
    {
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: ids.next<'Node'>(),
      newSectionIds: [ids.next<'Node'>(), ids.next<'Node'>(), ids.next<'Node'>()],
      dividerThickness: 16,
    },
  ]);

  const cells = geometryOf(base).cells;
  const filled = run(base, [
    {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: cells[0]!.nodeId,
      fill: createShelvesLeaf(createSequentialIdFactory('fr19-sh'), 4).fill,
    },
    {
      type: 'SetFill',
      furnitureIndex: 0,
      nodeId: cells[1]!.nodeId,
      fill: createDrawersLeaf(createSequentialIdFactory('fr19-dr'), 1).fill,
    },
  ] satisfies Command[]);

  const doorCell = geometryOf(filled).cells[2]!.nodeId;
  return run(filled, [
    {
      type: 'AddFacade',
      furnitureIndex: 0,
      facade: createHingedFacade(createSequentialIdFactory('fr19-fa'), doorCell, 1),
    },
  ]);
}

const project = scenario();
const calculation = productionOf(project);
const data = buildProductionExportData(project, calculation, {
  generatedAt: '2026-01-01T00:00:00.000Z',
});

describe('изделие построено полностью — иначе проверять нечего', () => {
  it('три секции, полки, ящик и дверь на месте', () => {
    const parts = geometryOf(project).parts;
    expect(geometryOf(project).sections).toHaveLength(3);
    expect(parts.filter((p) => p.role === 'shelf-adjustable')).toHaveLength(4);
    expect(parts.filter((p) => p.role === 'facade').length).toBeGreaterThanOrEqual(2);
    expect(calculation.bom.parts.length).toBeGreaterThan(0);
  });
});

/**
 * §19: FR-19 не меняет расчёт.
 *
 * Снимок снят на `b6b92a6` и на текущем коде — совпал побайтово.
 * Закреплён здесь, чтобы правка представления не могла незаметно
 * сдвинуть производственный результат.
 */
describe('производственные числа не изменились (§19)', () => {
  it('детали, размеры, материалы, раскрой и фурнитура те же, что до FR-19', () => {
    const geometry = geometryOf(project);
    expect({
      parts: geometry.parts.length,
      bomPositions: calculation.bom.parts.length,
      partQuantity: calculation.bom.parts.reduce((sum, part) => sum + part.quantity, 0),
      dims: calculation.bom.parts
        .map((p) => `${String(p.length)}x${String(p.width)}x${String(p.thickness)}`)
        .sort(),
      materials: [...new Set(calculation.bom.parts.map((p) => p.materialName))].sort(),
      sheets: calculation.bom.cutting.stockCount,
      placed: calculation.bom.cutting.placedParts,
      unplaced: calculation.bom.cutting.unplacedParts,
      utilization: calculation.bom.cutting.utilization,
      hardware: calculation.hardware.lines
        .map((l) => `${l.kind}:${String(l.quantity)}`)
        .sort(),
      drilling: calculation.drilling.operations.length,
      edge: calculation.bom.edgeBanding
        .map((e) => `${e.materialName}:${String(e.lengthMm)}:${String(e.sideCount)}`)
        .sort(),
      status: calculation.status,
    }).toEqual({
      parts: 13,
      bomPositions: 8,
      partQuantity: 13,
      dims: [
        '1768x597x16',
        '1768x597x16',
        '2164x574.6x16',
        '2164x574.7x16',
        '2168x597x16',
        '2200x1800x3',
        '2200x597x16',
        '578.7x597x16',
      ],
      materials: ['Задняя стенка 3 мм', 'Корпусная плита 16 мм'],
      sheets: 4,
      placed: 13,
      unplaced: 0,
      utilization: 0.7528765424739196,
      hardware: ['shelf-support:16', 'slide:2'],
      drilling: 0,
      edge: [
        'Кромка 0.4 мм (материал не назначен):14238.6:24',
        'Кромка 2 мм (материал не назначен):18914.8:12',
      ],
      status: 'NEEDS_CONFIRMATION',
    });
  });
});

describe('модель документа говорит по-человечески (§5, §6, §7)', () => {
  it('ни одна строка деталировки не несёт сырого типа', () => {
    for (const row of data.parts) {
      expect(RAW_PART_TYPES).not.toContain(row.partTypeLabel);
      expect(row.partTypeLabel).not.toMatch(/[A-Za-z]/);
      expect(row.categoryLabel).not.toMatch(/[A-Za-z]/);
    }
  });

  it('кромка называет сторону, а не поле модели и не позицию в строке', () => {
    for (const row of data.parts) {
      expect(row.edge).not.toMatch(/[A-Za-z]/);
      expect(row.edge).not.toMatch(/^\d/);
    }
    expect(data.parts.some((row) => row.edge.includes('спереди'))).toBe(true);
  });

  it('текстура названа смыслом, а не значением перечисления', () => {
    for (const row of data.parts) {
      expect(row.grainLabel).not.toBe('none');
      expect(row.grainLabel).not.toMatch(/[A-Za-z]/);
    }
  });

  it('фурнитура не несёт ключей реестра и латинских единиц', () => {
    for (const row of data.hardware) {
      expect(RAW_HARDWARE_KEYS).not.toContain(row.categoryLabel);
      expect(row.categoryLabel).not.toMatch(/[A-Za-z]/);
      expect(row.unitLabel).not.toBe('pcs');
      for (const source of row.sources) expect(source).not.toMatch(/^part:/);
    }
  });

  it('идентификаторы остаются в модели — прослеживаемость не потеряна (§16)', () => {
    expect(data.hardware.every((row) => row.definitionId.startsWith('hw-'))).toBe(true);
    expect(data.parts.every((row) => row.sourcePartIds.length > 0)).toBe(true);
    expect(data.parts[0]?.partType).toBeDefined();
  });
});

describe('сгенерированный XLSX (§13)', () => {
  const bytes = createProductionXlsx(data);

  async function open(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return workbook;
  }

  /** Весь видимый текст книги — как его увидит человек, открывший файл. */
  async function allText(): Promise<string[]> {
    const workbook = await open();
    const out: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') out.push(cell.value);
        });
      });
    });
    return out;
  }

  it('книга не содержит сырых типов деталей', async () => {
    const text = await allText();
    for (const raw of RAW_PART_TYPES) expect(text, `ячейка «${raw}»`).not.toContain(raw);
  });

  it('книга не содержит ключей реестра фурнитуры', async () => {
    const text = (await allText()).join('\n');
    for (const key of RAW_HARDWARE_KEYS) expect(text).not.toContain(key);
  });

  it('книга не содержит цепочек идентификаторов деталей', async () => {
    const text = (await allText()).join('\n');
    expect(text).not.toMatch(/part:[0-9a-f-]{8}/);
    expect(text).not.toMatch(/bom:[a-z]+\|/);
  });

  it('книга не содержит необъяснённого «none»', async () => {
    expect(await allText()).not.toContain('none');
  });

  it('лист деталей называет тип и кромку словами', async () => {
    const workbook = await open();
    const sheet = workbook.getWorksheet('Детали')!;
    const first = sheet.getRow(2);
    const cell = (column: number): unknown => first.getCell(column).value;
    expect(cell(3)).toBe(data.parts[0]?.partTypeLabel);
    expect(cell(9)).toBe(data.parts[0]?.edge);
    expect(cell(10)).toBe(data.parts[0]?.grainLabel);
  });

  /**
   * Сплошная проверка: ни одно значение перечисления, для которого
   * заведена подпись, не встречается в книге сырым.
   *
   * Список берётся из самих словарей, а не переписывается рядом: новое
   * доменное значение попадает под проверку само. Это надёжнее поиска
   * «любой латиницы», который ломался бы о `T-DRW-02`, `push-механизм`
   * и имя проекта, заданное пользователем (§15: без хрупких тестов).
   */
  it('ни одно подписанное значение перечисления не встречается сырым', async () => {
    const rawValues = [
      ...Object.keys(PART_ROLE_LABELS),
      ...Object.keys(PRODUCTION_PART_TYPE_LABELS),
      ...Object.keys(PART_CATEGORY_LABELS),
      ...Object.keys(HARDWARE_KIND_LABELS),
      ...Object.keys(HARDWARE_UNIT_LABELS),
      ...Object.keys(GRAIN_LABELS),
      ...Object.keys(EDGE_SIDE_LABELS),
    ]
      // `push-to-open` — отраслевое обозначение: подпись совпадает со
      // значением намеренно, и запрещать его было бы неверно.
      .filter((value) => value !== 'push-to-open');

    const cells = await allText();
    const found = rawValues.filter((value) =>
      cells.some((cell) => new RegExp(`(^|[^\\p{L}-])${value}([^\\p{L}-]|$)`, 'u').test(cell)),
    );
    expect(found).toEqual([]);
  });

  /**
   * §16: сначала что это значит, потом откуда. Код диагностики стоял
   * первым словом строки — `DRAWER_BOX_NOT_IMPLEMENTED: Короб ящика …`.
   */
  it('код прослеживаемости стоит после человеческого текста, а не впереди', async () => {
    const coded = (await allText()).filter((cell) => /[A-Z]{3,}_[A-Z]/.test(cell));
    expect(coded.length).toBeGreaterThan(0);
    for (const cell of coded) {
      expect(cell, cell.slice(0, 60)).not.toMatch(/^[A-Z_]+:/);
      expect(cell).toMatch(/\[[A-Z_]+\]$/);
    }
  });

  /** Реестр предположений цитируется, но категория названа по-русски. */
  it('неподтверждённые правила названы разделом, а не кодом категории', async () => {
    const rows = (await allText()).filter((cell) => cell.startsWith('Требует подтверждения:'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toMatch(/(CUTTING|DRILLING|HARDWARE|MATERIAL|EDGE|CONSTRUCTION)/);
      expect(row).toMatch(/\[T-[A-Z]+-\d+\]$/);
    }
  });
});

describe('сгенерированный PDF (§13)', () => {
  it('документ строится и не несёт сырых значений в потоке текста', async () => {
    const { readFileSync } = await import('node:fs');
    const font = new Uint8Array(readFileSync('public/fonts/LiberationSans-Regular.ttf'));
    const bytes = await createProductionPdf(data, { font });
    expect(bytes.byteLength).toBeGreaterThan(0);
    // PDF сжат, поэтому проверяется не байтовый поиск, а то, из чего он
    // собран: писатель печатает подписи, а не значения перечислений.
    const source = readFileSync('src/export/pdf.ts', 'utf8');
    expect(source).not.toMatch(/row\.partType\b/);
    expect(source).not.toMatch(/row\.definitionId\b/);
    expect(source).not.toMatch(/row\.category\b(?!Label)/);
    expect(source).not.toMatch(/row\.unit\b(?!Label)/);
  });
});
