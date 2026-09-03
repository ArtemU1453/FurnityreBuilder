import { describe, expect, it } from 'vitest';
import {
  calculateDrilling,
  compareOperations,
  DRILLING_CLEARANCES,
  DRILLING_RULES,
  EMPTY_DRILLING_PARAMETERS,
  faceFrame,
  formatDrillingDebug,
  hingePositions,
  validateCollisions,
  validateOperation,
} from '../../../src/drilling/index.js';
import { toProductionParts } from '../../../src/production/index.js';
import {
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createPushToOpenSystem,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import type { DrillingOperation, DrillingPlan } from '../../../src/drilling/index.js';
import type { Project } from '../../../src/domain/index.js';
import { geometryOf, HYPOTHETICAL_PARAMETERS, makeProject, partOfRole } from './helpers.js';

/**
 * Движок присадки (PROMPT 18 §29).
 *
 * Тесты делятся надвое, и это принципиально. Первая часть проверяет, что
 * БЕЗ подтверждённых параметров движок не выдаёт ни одного отверстия и
 * называет, чего именно не хватает. Вторая подаёт заведомо гипотетические
 * параметры и проверяет САМ АЛГОРИТМ: координаты, глубины, порядок,
 * проверки. Смешивать эти два режима нельзя — иначе догадка попадёт в
 * приложение под видом расчёта.
 */

const withDoor = (): Project =>
  makeProject((furniture, ids) => ({ ...furniture, facades: [createHingedFacade(ids, furniture.root.id, 1)] }));

const withHandle = (): Project =>
  makeProject((furniture, ids) => {
    const facade = createHingedFacade(ids, furniture.root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...furniture,
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
    };
  });

const withPush = (): Project =>
  makeProject((furniture, ids) => {
    const facade = createHingedFacade(ids, furniture.root.id, 1);
    const leaf = facade.leaves[0]!;
    return {
      ...furniture,
      facades: [{ ...facade, leaves: [{ ...leaf, opening: createPushToOpenSystem(ids, leaf.hingeSide) }] }],
    };
  });

const codes = (plan: DrillingPlan): string[] => plan.warnings.map((w) => w.code);
const messages = (plan: DrillingPlan): string => plan.warnings.map((w) => w.message).join('\n');

// ── Без подтверждённых параметров (§34) ──────────────────────────────────────

describe('Test 7–10 (§8–§15): без подтверждённых параметров отверстий нет', () => {
  it('Test 7: по умолчанию параметров не задано ни одного', () => {
    expect(EMPTY_DRILLING_PARAMETERS).toEqual({});
    expect(DRILLING_CLEARANCES).toBeUndefined();
  });

  it('Test 8: пустой корпус не даёт ни одной операции, но объясняет крепёж', () => {
    const plan = calculateDrilling(makeProject());
    expect(plan.operations).toHaveLength(0);
    expect(messages(plan)).toContain('Присадка крепежа задней стенки не рассчитана');
    expect(messages(plan)).toContain('Присадка корпусного крепежа не рассчитана');
  });

  it('Test 9: полки и ящики называют недостающую связь деталей, а не сверлят наугад', () => {
    const shelves = calculateDrilling(makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') })));
    expect(shelves.operations).toHaveLength(0);
    expect(codes(shelves)).toContain('DRILLING_RELATION_NOT_MODELLED');
    expect(messages(shelves)).toContain('какая боковина или перегородка держит полку');

    const drawers = calculateDrilling(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 2) })));
    expect(drawers.operations).toHaveLength(0);
    expect(messages(drawers)).toContain('какая стенка ячейки принимает направляющую');
  });

  it('Test 10: ручка и push-механизм сообщают о неподтверждённых параметрах', () => {
    const handle = calculateDrilling(withHandle());
    expect(handle.operations).toHaveLength(0);
    expect(messages(handle)).toContain('Присадка ручек не рассчитана');

    const push = calculateDrilling(withPush());
    expect(push.operations).toHaveLength(0);
    expect(messages(push)).toContain('накладной или врезной');
  });

  it('петли: без позиций фурнитуры правило молчит, а не жалуется дважды', () => {
    // Количество петель не подтверждено (T-DOOR-05), позиций фурнитуры нет,
    // и причина уже названа расчётом фурнитуры — дублировать её незачем.
    const plan = calculateDrilling(withDoor());
    expect(messages(plan)).not.toContain('Присадка петель не рассчитана');
  });
});

// ── С гипотетическими параметрами: проверяется алгоритм ──────────────────────

describe('Test 11–13 (§13): присадка ручки считается от построенной детали', () => {
  const project = withHandle();
  const geometry = geometryOf(project);
  const plan = calculateDrilling(project, {
    geometry: new Map([[project.furniture[0]!.id, geometry]]),
    parameters: HYPOTHETICAL_PARAMETERS,
  });
  const handleOps = plan.operations.filter((o) => o.ruleId === 'handle');

  it('Test 11: два отверстия на ручку, сквозные, в пласти фасада', () => {
    expect(handleOps).toHaveLength(2);
    for (const op of handleOps) {
      expect(op.through).toBe('through');
      expect(op.face).toBe('top');
      expect(op.purpose).toBe('handle');
    }
  });

  it('Test 12: отверстия разнесены ровно на межцентровое расстояние', () => {
    const [a, b] = handleOps;
    const distance = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    expect(distance).toBeCloseTo(HYPOTHETICAL_PARAMETERS.handle!.centerDistance, 6);
  });

  it('Test 13: отверстия попадают в фасад и никуда больше', () => {
    const facade = partOfRole(geometry, 'facade');
    for (const op of handleOps) {
      expect(op.sourcePartId).toBe(facade.id);
      const frame = faceFrame(facade, op.face);
      expect(op.x).toBeGreaterThan(0);
      expect(op.y).toBeGreaterThan(0);
      expect(op.x).toBeLessThan(frame.extentX);
      expect(op.y).toBeLessThan(frame.extentY);
    }
    expect(plan.errors).toHaveLength(0);
  });

  it('перемещение фасада двигает отверстия вместе с ним', () => {
    const wider = makeProject((furniture, ids) => {
      const facade = createHingedFacade(ids, furniture.root.id, 1);
      const leaf = facade.leaves[0]!;
      return {
        ...furniture,
        dimensions: { ...furniture.dimensions, width: 1400 },
        facades: [{ ...facade, leaves: [{ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }] }],
      };
    });
    const moved = calculateDrilling(wider, { parameters: HYPOTHETICAL_PARAMETERS }).operations.filter((o) => o.ruleId === 'handle');
    expect(moved).toHaveLength(2);
    // Локальная координата вдоль длины створки (по высоте) не изменилась —
    // ручка стоит на той же высоте; изменилась только ширина фасада.
    expect(moved[0]?.x).toBeCloseTo(handleOps[0]?.x ?? -1, 6);
    expect(moved[0]?.y).not.toBeCloseTo(handleOps[0]?.y ?? -1, 6);
  });
});

describe('Test 14 (§12): две створки в одной ячейке — две разные присадки', () => {
  // Регрессия. Первая версия правила искала фасад по узлу-источнику ручки,
  // а у обеих створок одной ячейки узел один и тот же: обе ручки получали
  // координаты ПЕРВОГО фасада, и отверстия второй уезжали за его край.
  // Нашёл property-тест; связь теперь берётся из модели —
  // `FacadeLeaf.opening.id` однозначно указывает на свою створку.
  const project = makeProject((furniture, ids) => {
    const facade = createHingedFacade(ids, furniture.root.id, 2);
    const leaves = facade.leaves.map((leaf) => ({ ...leaf, opening: createHandleOpeningSystem(ids, leaf.hingeSide) }));
    return { ...furniture, facades: [{ ...facade, leaves }] };
  });
  const plan = calculateDrilling(project, { parameters: HYPOTHETICAL_PARAMETERS });
  const handleOps = plan.operations.filter((o) => o.ruleId === 'handle');

  it('каждая ручка сверлится в своей створке', () => {
    expect(handleOps).toHaveLength(4);
    expect(new Set(handleOps.map((o) => o.sourcePartId)).size).toBe(2);
  });

  it('и ни одно отверстие не выходит за деталь', () => {
    expect(plan.errors).toHaveLength(0);
  });
});

describe('Test 15 (§8): распределение петель по высоте створки', () => {
  it('одна петля — по центру, две — на отступах от концов', () => {
    expect(hingePositions(1000, 1, 100)).toEqual([500]);
    expect(hingePositions(1000, 2, 100)).toEqual([100, 900]);
  });

  it('три петли — крайние на отступах, средняя ровно между ними', () => {
    expect(hingePositions(1000, 3, 100)).toEqual([100, 500, 900]);
  });

  it('ноль петель — ни одной позиции', () => {
    expect(hingePositions(1000, 0, 100)).toEqual([]);
  });
});

// ── Проверки (§18–§20) ───────────────────────────────────────────────────────

describe('Test 16–19 (§18–§20): проверки операций', () => {
  const geometry = geometryOf(makeProject());
  const side = partOfRole(geometry, 'side');
  const production = toProductionParts(geometry, makeProject().materials, makeProject().settings.cutting).parts;
  const productionPart = production.find((p) => p.sourcePartIds.includes(side.id))!;

  const operation = (patch: Partial<DrillingOperation>): DrillingOperation => ({
    id: 'drill:test/a/0',
    productionPartId: productionPart.id,
    sourcePartId: side.id,
    purpose: 'shelf-support',
    face: 'bottom',
    x: 100,
    y: 100,
    diameter: 5,
    depth: 10,
    through: 'blind',
    ruleId: 'test',
    reason: 'проверка',
    ...patch,
  });

  const check = (op: DrillingOperation): string[] => validateOperation(op, side, productionPart).map((i) => i.code);

  it('Test 16: корректная операция замечаний не вызывает', () => {
    expect(check(operation({}))).toHaveLength(0);
  });

  it('Test 17: отверстие за пределами детали и с отрицательной координатой', () => {
    expect(check(operation({ x: 99999 }))).toContain('DRILLING_OUT_OF_PART');
    expect(check(operation({ y: -10 }))).toContain('DRILLING_OUT_OF_PART');
    // Край отверстия, а не центр: центр внутри детали ещё ничего не значит.
    expect(check(operation({ x: 1, diameter: 20 }))).toContain('DRILLING_OUT_OF_PART');
  });

  it('Test 18: глубина глухого и сквозного отверстия', () => {
    const thickness = faceFrame(side, 'bottom').available;
    expect(check(operation({ depth: thickness }))).toHaveLength(0);
    expect(check(operation({ depth: thickness + 1 }))).toContain('DRILLING_DEPTH_EXCEEDS_MATERIAL');
    expect(check(operation({ depth: 0 }))).toContain('DRILLING_DEPTH_INVALID');
    expect(check(operation({ through: 'through', depth: thickness }))).toHaveLength(0);
    expect(check(operation({ through: 'through', depth: 2 }))).toContain('DRILLING_THROUGH_TOO_SHALLOW');
  });

  it('Test 19: ссылка на несуществующую деталь и позицию', () => {
    expect(validateOperation(operation({}), undefined, productionPart).map((i) => i.code)).toContain('DRILLING_PART_NOT_FOUND');
    expect(validateOperation(operation({}), side, undefined).map((i) => i.code)).toContain('DRILLING_PRODUCTION_PART_NOT_FOUND');
    expect(check(operation({ diameter: 0 }))).toContain('DRILLING_DIAMETER_INVALID');
  });

  it('пересечение отверстий на одной грани — ошибка, на разных гранях — нет', () => {
    const a = operation({ id: 'a', x: 100, y: 100, diameter: 20 });
    const b = operation({ id: 'b', x: 105, y: 100, diameter: 20 });
    expect(validateCollisions([a, b]).map((i) => i.code)).toContain('DRILLING_HOLES_OVERLAP');
    expect(validateCollisions([a, { ...b, face: 'top' }])).toHaveLength(0);
    expect(validateCollisions([a, { ...b, x: 200 }])).toHaveLength(0);
  });
});

// ── План, порядок, трассируемость (§21–§24) ──────────────────────────────────

describe('Test 20–22 (§21–§24): план присадки', () => {
  const project = withHandle();
  const plan = calculateDrilling(project, { parameters: HYPOTHETICAL_PARAMETERS });

  it('Test 20: операции сгруппированы по производственным деталям', () => {
    const total = [...plan.byProductionPart.values()].reduce((sum, ops) => sum + ops.length, 0);
    expect(total).toBe(plan.operations.length);
  });

  it('Test 21: порядок детерминирован и не зависит от порядка обхода', () => {
    const again = calculateDrilling(project, { parameters: HYPOTHETICAL_PARAMETERS });
    expect(JSON.stringify(again.operations)).toBe(JSON.stringify(plan.operations));
    const shuffled = [...plan.operations].reverse().sort(compareOperations);
    expect(shuffled.map((o) => o.id)).toEqual(plan.operations.map((o) => o.id));
  });

  it('Test 22: каждая операция прослеживается до фурнитуры и до узла модели', () => {
    for (const op of plan.operations) {
      expect(op.sourcePartId).not.toBe('');
      expect(op.productionPartId).not.toBe('');
      expect(op.ruleId).not.toBe('');
      expect(op.reason.length).toBeGreaterThan(0);
    }
  });

  it('расчёт не изменяет проект', () => {
    const snapshot = JSON.stringify(project);
    calculateDrilling(project, { parameters: HYPOTHETICAL_PARAMETERS });
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('изделие с ошибкой геометрии присадки не получает', () => {
    const broken = makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } }));
    const brokenPlan = calculateDrilling(broken);
    expect(brokenPlan.operations).toHaveLength(0);
    expect(codes(brokenPlan)).toContain('DRILLING_SKIPPED_BROKEN_GEOMETRY');
  });
});

describe('Test 23 (§28): технический вывод', () => {
  it('показывает деталь, грань, диаметр, глубину и направление', () => {
    const project = withHandle();
    const geometry = geometryOf(project);
    const plan = calculateDrilling(project, {
      geometry: new Map([[project.furniture[0]!.id, geometry]]),
      parameters: HYPOTHETICAL_PARAMETERS,
    });
    const production = toProductionParts(geometry, project.materials, project.settings.cutting).parts;
    const lines = formatDrillingDebug({
      plan,
      partsById: new Map(geometry.parts.map((p) => [p.id, p])),
      productionById: new Map(production.map((p) => [p.id, p])),
    }).join('\n');

    expect(lines).toContain('TOP');
    expect(lines).toContain('Ø5');
    expect(lines).toContain('насквозь');
    expect(lines).toContain('мир (');
  });

  it('пустой план говорит об этом прямо', () => {
    const lines = formatDrillingDebug({
      plan: calculateDrilling(makeProject()),
      partsById: new Map(),
      productionById: new Map(),
    });
    expect(lines[0]).toBe('— ни одной операции не рассчитано —');
  });
});

describe('состав движка', () => {
  it('все правила объявляют статус, а неподтверждённые — идентификатор неизвестного', () => {
    for (const rule of DRILLING_RULES) {
      expect(['confirmed', 'implemented', 'ambiguous', 'needs-confirmation']).toContain(rule.status);
      if (rule.status === 'needs-confirmation' || rule.status === 'ambiguous') expect(rule.unknownId).toBeDefined();
    }
  });
});
