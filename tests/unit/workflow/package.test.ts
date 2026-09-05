import { describe, expect, it } from 'vitest';
import {
  buildProductionPackage,
  fingerprintOf,
  formatPackageDebug,
  isPackageCurrent,
  matchesProject,
} from '../../../src/workflow/index.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { createProductionPdf } from '../../../src/export/pdf.js';
import { createProductionXlsx } from '../../../src/export/xlsx.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createDocumentStore } from '../../../src/state/document-store.js';
import {
  createCountertop,
  createHandleOpeningSystem,
  createHingedFacade,
  createPlinthBase,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { createSections } from '../../../src/domain/furniture/sections.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { readFileSync } from 'node:fs';
import type { Material, Project } from '../../../src/domain/index.js';
import { GENERATED_AT, makeProject, withoutSheets } from './helpers.js';

/**
 * Производственный пакет и полный конвейер (PROMPT 21 §19).
 *
 * Здесь проверяется не отдельная функция, а сквозной путь: проект →
 * геометрия → детали → фурнитура → присадка → раскрой → спецификация →
 * готовность → пакет → документы. Такой тест ловит то, чего не видит ни
 * один модульный: рассогласование между слоями.
 */

/**
 * Изделие «как в жизни»: две секции, цоколь, столешница и распашной фасад
 * с ручками. Фасад вешается на ЯЧЕЙКУ уже построенного дерева, а не на
 * прежний корень: иначе он ссылается на узел, которого больше нет, — и
 * это первое, что ловит расчёт.
 */
const richProject = (): Project =>
  makeProject((furniture, ids) => {
    const root = createSections(ids, 2, 16);
    const firstCell = root.children[0]!.node;
    const facade = createHingedFacade(ids, firstCell.id, 2);
    const leaves = facade.leaves.map((leaf) => ({ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }));
    return {
      ...furniture,
      root,
      carcass: {
        ...furniture.carcass,
        base: createPlinthBase(100),
        countertop: createCountertop(38, furniture.carcass.back.materialId),
      },
      facades: [{ ...facade, leaves }],
    };
  });

describe('Test 16–19 (§8–§9): состав пакета', () => {
  const project = richProject();
  const pkg = buildProductionPackage(project, { generatedAt: GENERATED_AT });

  it('Test 16: пакет несёт расчёт, готовность и данные документов', () => {
    expect(pkg.projectId).toBe(project.id);
    expect(pkg.calculation.bom.parts.length).toBeGreaterThan(0);
    expect(pkg.readiness.checks).toHaveLength(8);
    expect(pkg.exports.parts).toHaveLength(pkg.calculation.bom.parts.length);
  });

  it('Test 17: большие структуры не копируются, а лежат ссылками', () => {
    // Второго BOM в пакете нет: спецификация доступна ровно одна, через
    // расчёт. Это и есть запрет §9, проверенный, а не задекларированный.
    expect(pkg.calculation.bom.hardware).toBe(pkg.calculation.hardware);
    expect(Object.keys(pkg)).not.toContain('bom');
  });

  it('Test 18: статус пакета — статус готовности, а не отдельное мнение', () => {
    expect(pkg.status).toBe(pkg.readiness.status);
    expect(pkg.errors).toEqual(pkg.readiness.errors);
  });

  it('Test 19: конвейер прогоняется один раз', () => {
    const calculation = calculateProduction(project);
    const reused = buildProductionPackage(project, { generatedAt: GENERATED_AT, calculation });
    expect(reused.calculation).toBe(calculation);
    expect(JSON.stringify(reused.readiness)).toBe(JSON.stringify(pkg.readiness));
  });
});

describe('Test 20–23 (§10–§11): инвалидация', () => {
  const project = richProject();
  const pkg = buildProductionPackage(project, { generatedAt: GENERATED_AT });

  it('Test 20: пакет актуален для того проекта, из которого собран', () => {
    expect(isPackageCurrent(pkg, project)).toBe(true);
  });

  it('Test 21: любое изменение конструкции делает пакет устаревшим', () => {
    const mutations: { name: string; apply: (p: Project) => Project }[] = [
      {
        name: 'ширина',
        apply: (p) => ({ ...p, furniture: p.furniture.map((f) => ({ ...f, dimensions: { ...f.dimensions, width: 1500 } })) }),
      },
      {
        name: 'высота',
        apply: (p) => ({ ...p, furniture: p.furniture.map((f) => ({ ...f, dimensions: { ...f.dimensions, height: 2400 } })) }),
      },
      {
        name: 'глубина',
        apply: (p) => ({ ...p, furniture: p.furniture.map((f) => ({ ...f, dimensions: { ...f.dimensions, depth: 600 } })) }),
      },
      {
        name: 'толщина',
        apply: (p) => ({
          ...p,
          furniture: p.furniture.map((f) => ({ ...f, dimensions: { ...f.dimensions, panelThickness: 18 } })),
        }),
      },
      {
        name: 'наполнение ячейки',
        apply: (p) => {
          const ids = createSequentialIdFactory('m');
          const furniture = p.furniture[0]!;
          const root = furniture.root;
          if (root.kind !== 'split') return p;
          const children = root.children.map((child, index) =>
            index === 0 ? { ...child, node: createShelvesLeaf(ids, 2, 'adjustable') } : child,
          );
          return { ...p, furniture: [{ ...furniture, root: { ...root, children } }] };
        },
      },
      {
        name: 'материалы',
        apply: (p) => ({
          ...p,
          materials: {
            ...p.materials,
            items: Object.fromEntries(
              Object.entries(p.materials.items).map(([id, m]): [string, Material] => [id, { ...m, thickness: 18 }]),
            ),
          },
        }),
      },
      {
        name: 'параметры раскроя',
        apply: (p) => ({ ...p, settings: { ...p.settings, cutting: { ...p.settings.cutting, kerf: 3 } } }),
      },
      {
        name: 'задняя стенка',
        apply: (p) => ({
          ...p,
          furniture: p.furniture.map((f) => ({
            ...f,
            carcass: { ...f.carcass, back: { ...f.carcass.back, mount: { kind: 'none' as const } } },
          })),
        }),
      },
      {
        name: 'цоколь',
        apply: (p) => ({
          ...p,
          furniture: p.furniture.map((f) => ({ ...f, carcass: { ...f.carcass, base: createPlinthBase(150) } })),
        }),
      },
    ];

    for (const mutation of mutations) {
      const mutated = mutation.apply(project);
      expect(isPackageCurrent(pkg, mutated), `изменение «${mutation.name}» не инвалидировало пакет`).toBe(false);
    }
  });

  it('Test 22: переименование проекта пакет не инвалидирует', () => {
    // Имя не меняет ни детали, ни отверстия, ни листы раскроя. Если бы
    // оно объявляло пакет устаревшим, предупреждение об устаревании
    // перестали бы читать.
    const renamed: Project = { ...project, name: 'Другое имя', furniture: project.furniture.map((f) => ({ ...f, name: 'Шкаф' })) };
    expect(isPackageCurrent(pkg, renamed)).toBe(true);
  });

  it('Test 23: отпечаток детерминирован и сравним напрямую', () => {
    expect(fingerprintOf(project)).toBe(fingerprintOf(project));
    expect(matchesProject(pkg.fingerprint, project)).toBe(true);
  });
});

describe('Test 24–26 (§10, §12, §15): воспроизводимость и хранение', () => {
  const project = richProject();

  it('Test 24: одинаковый проект даёт одинаковый пакет', () => {
    const first = buildProductionPackage(project, { generatedAt: GENERATED_AT });
    const second = buildProductionPackage(project, { generatedAt: GENERATED_AT });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('Test 25: сохранение и загрузка не меняют пакет', () => {
    const restored = fromJson(toJson(project)).project;
    const before = buildProductionPackage(project, { generatedAt: GENERATED_AT });
    const after = buildProductionPackage(restored, { generatedAt: GENERATED_AT });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(isPackageCurrent(before, restored)).toBe(true);
  });

  it('Test 26: правка через команды и отмена возвращают исходный пакет', () => {
    const store = createDocumentStore(project);
    const before = buildProductionPackage(store.getState().project, { generatedAt: GENERATED_AT });

    store.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1500 });
    const changed = buildProductionPackage(store.getState().project, { generatedAt: GENERATED_AT });
    expect(isPackageCurrent(before, store.getState().project)).toBe(false);
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(before));

    store.getState().undo();
    const undone = buildProductionPackage(store.getState().project, { generatedAt: GENERATED_AT });
    expect(JSON.stringify(undone)).toBe(JSON.stringify(before));
    expect(isPackageCurrent(before, store.getState().project)).toBe(true);
  });
});

describe('Test 27–28 (§9): пакет и документы', () => {
  it('Test 27: из пакета собираются оба документа без повторного расчёта', async () => {
    const pkg = buildProductionPackage(richProject(), { generatedAt: GENERATED_AT });
    const xlsx = createProductionXlsx(pkg.exports);
    expect([...xlsx.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const font = new Uint8Array(readFileSync('public/fonts/LiberationSans-Regular.ttf'));
    const pdf = await createProductionPdf(pkg.exports, { font });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });

  it('Test 28: пакет непригодного проекта всё равно собирается и объясняет причину', () => {
    const pkg = buildProductionPackage(withoutSheets(makeProject()), { generatedAt: GENERATED_AT });
    expect(pkg.status).toBe('INVALID');
    expect(pkg.errors.length).toBeGreaterThan(0);
    const lines = formatPackageDebug(pkg).join('\n');
    expect(lines).toContain('INVALID');
    expect(lines).toContain('Раскрой');
  });
});
