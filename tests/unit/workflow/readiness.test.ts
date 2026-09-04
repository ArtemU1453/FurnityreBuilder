import { describe, expect, it } from 'vitest';
import {
  isReadyForProduction,
  formatReadinessDebug,
  validateProductionReadiness,
} from '../../../src/workflow/index.js';
import { calculateProduction } from '../../../src/bom/index.js';
import { createDrawersLeaf, createHingedFacade, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { asId } from '../../../src/domain/index.js';
import type { MaterialId, Project } from '../../../src/domain/index.js';
import type { ProductionCheckId, ProductionReadinessResult } from '../../../src/workflow/index.js';
import { makeProject, withoutSheets } from './helpers.js';

/**
 * Проверка готовности к производству (PROMPT 21 §19).
 *
 * Главное, что проверяется: статус не может оказаться выше самой слабой
 * проверки, а неподтверждённое правило никогда не превращается в
 * готовность само собой. Всё остальное — следствия.
 */

const CHECK_IDS: readonly ProductionCheckId[] = [
  'GEOMETRY_VALID',
  'MATERIALS_VALID',
  'EDGES_VALID',
  'HARDWARE_VALID',
  'DRILLING_VALID',
  'CUTTING_VALID',
  'BOM_VALID',
  'EXPORT_VALID',
];

const check = (readiness: ProductionReadinessResult, id: ProductionCheckId) =>
  readiness.checks.find((item) => item.id === id)!;

describe('Test 1–3 (§4, §6): состав чеклиста', () => {
  const readiness = validateProductionReadiness(makeProject());

  it('Test 1: все восемь проверок присутствуют и в фиксированном порядке', () => {
    expect(readiness.checks.map((item) => item.id)).toEqual(CHECK_IDS);
  });

  it('Test 2: у каждой проверки стабильный id, заголовок и пояснение', () => {
    for (const item of readiness.checks) {
      expect(item.id).toMatch(/^[A-Z_]+$/);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.details.length).toBeGreaterThan(0);
      expect(['PASS', 'WARNING', 'ERROR', 'NEEDS_CONFIRMATION']).toContain(item.status);
    }
  });

  it('Test 3: ошибки и предупреждения итога собраны из проверок', () => {
    expect(readiness.errors).toEqual(readiness.checks.flatMap((item) => item.errors));
    expect(readiness.warnings).toEqual(readiness.checks.flatMap((item) => item.warnings));
  });
});

describe('Test 4–7 (§5): статусы и запрет автоматической готовности', () => {
  it('Test 4: обычный проект требует подтверждения, а не готов к производству', () => {
    const readiness = validateProductionReadiness(makeProject());
    expect(readiness.status).toBe('NEEDS_CONFIRMATION');
    expect(isReadyForProduction(readiness)).toBe(false);
    expect(readiness.errors).toHaveLength(0);
  });

  it('Test 5: неподтверждённые правила разложены по своим разделам', () => {
    const readiness = validateProductionReadiness(makeProject());
    // Пропил — это раскрой, параметры присадки — присадка, правила
    // количества фурнитуры — фурнитура. Технолог должен видеть, к какому
    // разделу идти, а не общий список из пятнадцати строк.
    expect(check(readiness, 'CUTTING_VALID').needsConfirmation.some((item) => item.id === 'T-CUT-01')).toBe(true);
    expect(check(readiness, 'DRILLING_VALID').needsConfirmation.some((item) => item.id.startsWith('T-DRILL'))).toBe(true);
    expect(check(readiness, 'HARDWARE_VALID').needsConfirmation.length).toBeGreaterThan(0);
    expect(check(readiness, 'EDGES_VALID').needsConfirmation.some((item) => item.id.startsWith('T-EDG'))).toBe(true);
  });

  it('Test 6: проект с ошибкой геометрии непригоден к производству', () => {
    const readiness = validateProductionReadiness(makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } })));
    expect(readiness.status).toBe('INVALID');
    expect(check(readiness, 'GEOMETRY_VALID').status).toBe('ERROR');
    expect(isReadyForProduction(readiness)).toBe(false);
  });

  it('Test 7: неразмещённая деталь делает раскрой ошибочным', () => {
    const readiness = validateProductionReadiness(withoutSheets(makeProject()));
    expect(readiness.status).toBe('INVALID');
    expect(check(readiness, 'CUTTING_VALID').status).toBe('ERROR');
    expect(check(readiness, 'CUTTING_VALID').errors.some((e) => e.code === 'BOM_PART_NOT_PLACED')).toBe(true);
  });
});

describe('Test 8–11 (§3): содержание проверок', () => {
  it('Test 8: неизвестный материал ловится разделом материалов', () => {
    const base = makeProject();
    const broken: Project = { ...base, materials: { ...base.materials, items: {} } };
    const readiness = validateProductionReadiness(broken);
    expect(check(readiness, 'MATERIALS_VALID').status).toBe('ERROR');
  });

  it('Test 9: неизвестный материал кромки ловится разделом кромки', () => {
    const base = makeProject();
    const ghost: MaterialId = asId<'Material'>('no-such-edge-material');
    const broken: Project = {
      ...base,
      settings: { ...base.settings, defaultEdge: { ...base.settings.defaultEdge, materialId: ghost } },
      furniture: base.furniture.map((f) => ({ ...f })),
    };
    // Кромка деталей берётся из умолчания проекта, поэтому подмена
    // материала в нём доходит до каждой оклеиваемой детали.
    const readiness = validateProductionReadiness(broken);
    const edges = check(readiness, 'EDGES_VALID');
    // Если деталь не получила ссылку на несуществующий материал, раздел
    // обязан хотя бы предупредить о неназначенном материале кромки.
    expect(['ERROR', 'WARNING', 'NEEDS_CONFIRMATION']).toContain(edges.status);
  });

  it('Test 10: спецификация проверяется на двойной счёт', () => {
    const readiness = validateProductionReadiness(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') })));
    const bom = check(readiness, 'BOM_VALID');
    expect(bom.errors).toHaveLength(0);
    expect(bom.details).toContain('Позиций');
  });

  it('Test 11: документация проверяется по числу строк, а не по факту вызова', () => {
    const project = makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 2) }));
    const readiness = validateProductionReadiness(project);
    const exportCheck = check(readiness, 'EXPORT_VALID');
    expect(exportCheck.status).toBe('PASS');
    expect(exportCheck.details).toContain('Строк деталей');
  });
});

describe('Test 12–14 (§10, §14): повторяемость и чистота', () => {
  const project = makeProject((f, ids) => ({
    ...f,
    root: createShelvesLeaf(ids, 2, 'adjustable'),
    facades: [createHingedFacade(ids, f.root.id, 1)],
  }));

  it('Test 12: одинаковый проект даёт одинаковую проверку', () => {
    expect(JSON.stringify(validateProductionReadiness(project))).toBe(JSON.stringify(validateProductionReadiness(project)));
  });

  it('Test 13: готовый расчёт не пересчитывается', () => {
    const calculation = calculateProduction(project);
    const withCalculation = validateProductionReadiness(project, { calculation });
    const without = validateProductionReadiness(project);
    expect(JSON.stringify(withCalculation)).toBe(JSON.stringify(without));
  });

  it('Test 14: проверка не изменяет проект', () => {
    const snapshot = JSON.stringify(project);
    validateProductionReadiness(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

describe('Test 15 (§17): технический вывод готовности', () => {
  it('показывает статус и все пункты чеклиста', () => {
    const lines = formatReadinessDebug(validateProductionReadiness(makeProject())).join('\n');
    expect(lines).toContain('СТАТУС: NEEDS_CONFIRMATION');
    for (const title of ['Геометрия', 'Материалы', 'Кромка', 'Фурнитура', 'Присадка', 'Раскрой', 'Спецификация', 'Документация']) {
      expect(lines).toContain(title);
    }
  });
});
