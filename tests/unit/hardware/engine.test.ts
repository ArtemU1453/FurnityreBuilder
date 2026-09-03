import { describe, expect, it } from 'vitest';
import { calculateHardware, HARDWARE_RULES } from '../../../src/hardware/engine.js';
import { hingeCountForHeight, HINGE_COUNT_TABLE } from '../../../src/hardware/rules/hinges.js';
import { slidesPerDrawer } from '../../../src/hardware/rules/slides.js';
import { supportsPerShelf } from '../../../src/hardware/rules/shelf-supports.js';
import { findCarcassJoints } from '../../../src/hardware/rules/fasteners.js';
import {
  HW_HANDLE,
  HW_PUSH_LATCH,
  HW_SHELF_SUPPORT,
  HW_SLIDE,
  DEFAULT_HARDWARE_LIBRARY,
} from '../../../src/hardware/registry.js';
import { formatHardwareDebug } from '../../../src/hardware/debug.js';
import {
  createDrawersLeaf,
  createHandleOpeningSystem,
  createHingedFacade,
  createPushToOpenSystem,
  createShelvesLeaf,
} from '../../../src/domain/furniture/defaults.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { HardwareBOM, HardwareRule } from '../../../src/hardware/types.js';
import type { HardwareId, Project } from '../../../src/domain/index.js';
import { asId } from '../../../src/domain/index.js';
import { makeProject } from './helpers.js';

/**
 * Единая система фурнитуры (PROMPT 16 §23).
 *
 * Тесты делятся на две группы, и это принципиально. Первая проверяет
 * правила, количество которых СЛЕДУЕТ ИЗ КОНСТРУКЦИИ (ручка на фасад,
 * направляющие на ящик, держатели по углам полки) — там проверяются числа.
 * Вторая проверяет правила, для которых величина референсом НЕ
 * ПОДТВЕРЖДЕНА (петли, крепёж) — там проверяется, что движок НЕ выдумал
 * число, а сообщил, чего не хватает. Тест на «две петли на дверь» здесь
 * отсутствует намеренно: такого подтверждённого правила нет.
 */

const quantityOf = (bom: HardwareBOM, id: HardwareId): number =>
  bom.lines.find((line) => line.definitionId === id)?.quantity ?? 0;

const warningCodes = (bom: HardwareBOM): string[] => bom.warnings.map((w) => w.code);

// ── Двери и петли (§6–7) ─────────────────────────────────────────────────────

describe('Test 1–3 (§6): петли — правило есть, количество не выдумывается', () => {
  const project = makeProject((furniture, ids) => ({
    ...furniture,
    facades: [createHingedFacade(ids, furniture.root.id, 1)],
  }));
  const bom = calculateHardware(project);

  it('Test 1: позиций петель нет, пока таблица порогов не подтверждена', () => {
    expect(bom.items.filter((i) => i.kind === 'hinge')).toHaveLength(0);
  });

  it('Test 2: вместо числа — предупреждение с идентификатором неизвестного', () => {
    expect(warningCodes(bom)).toContain('HARDWARE_RULE_NEEDS_CONFIRMATION');
    expect(bom.warnings.some((w) => w.message.includes('T-DOOR-05'))).toBe(true);
  });

  it('Test 3: таблица порогов пуста, а не заполнена «обычными» значениями', () => {
    expect(HINGE_COUNT_TABLE).toHaveLength(0);
    expect(hingeCountForHeight(700)).toBeUndefined();
  });
});

describe('Test 4 (§6): интерфейс правила петель работает, как только таблица есть', () => {
  it('высота створки выбирает первый подходящий порог', () => {
    const table = [
      { maxHeight: 900, quantity: 2 },
      { maxHeight: 1600, quantity: 3 },
    ] as const;
    expect(hingeCountForHeight(600, table)).toBe(2);
    expect(hingeCountForHeight(900, table)).toBe(2);
    expect(hingeCountForHeight(1200, table)).toBe(3);
  });

  it('створка выше последнего порога получает количество последнего', () => {
    const table = [{ maxHeight: 900, quantity: 2 }] as const;
    expect(hingeCountForHeight(2400, table)).toBe(2);
  });
});

describe('Test 5 (§7): крепёж петель — отдельная позиция от самой петли', () => {
  const project = makeProject((furniture, ids) => ({
    ...furniture,
    facades: [createHingedFacade(ids, furniture.root.id, 2)],
  }));
  const bom = calculateHardware(project);

  it('в реестре это два разных определения, а не одно', () => {
    expect(DEFAULT_HARDWARE_LIBRARY.items['hw-hinge']?.kind).toBe('hinge');
    expect(DEFAULT_HARDWARE_LIBRARY.items['hw-hinge-fastener']?.kind).toBe('hinge-fastener');
  });

  it('и оба правила сообщают о нехватке подтверждения по отдельности', () => {
    const messages = bom.warnings.map((w) => w.message);
    expect(messages.some((m) => m.includes('Петли не рассчитаны'))).toBe(true);
    expect(messages.some((m) => m.includes('Крепёж петель не рассчитан'))).toBe(true);
  });
});

describe('Test 6 (§6): изделие без распашных фасадов не порождает предупреждений о петлях', () => {
  it('нет створок — нет и правила к применению', () => {
    const bom = calculateHardware(makeProject());
    expect(bom.warnings.some((w) => w.message.includes('Петли не рассчитаны'))).toBe(false);
  });
});

// ── Ящики и направляющие (§8) ────────────────────────────────────────────────

describe('Test 7–9 (§8): направляющие считаются от количества ящиков', () => {
  const withDrawers = (count: number): Project =>
    makeProject((furniture, ids) => ({ ...furniture, root: createDrawersLeaf(ids, count) }));

  it('Test 7: три ящика дают шесть направляющих — по две на ящик', () => {
    const bom = calculateHardware(withDrawers(3));
    expect(quantityOf(bom, HW_SLIDE)).toBe(6);
  });

  it('Test 8: удвоение количества ящиков удваивает количество направляющих', () => {
    expect(quantityOf(calculateHardware(withDrawers(2)), HW_SLIDE)).toBe(4);
    expect(quantityOf(calculateHardware(withDrawers(4)), HW_SLIDE)).toBe(8);
  });

  it('Test 9: число берётся из типа направляющей, а не из константы в правиле', () => {
    expect(slidesPerDrawer('roller')).toBe(2);
    expect(slidesPerDrawer('hidden-soft-close')).toBe(2);
  });

  it('каждая позиция ссылается на конкретный ящик', () => {
    const bom = calculateHardware(withDrawers(2));
    const slides = bom.items.filter((i) => i.definitionId === HW_SLIDE);
    expect(new Set(slides.map((i) => i.sourceNodeId)).size).toBe(2);
  });
});

// ── Полки и полкодержатели (§9) ──────────────────────────────────────────────

describe('Test 10–12 (§9): держатели только у съёмных полок', () => {
  const withShelves = (count: number, mounting: 'adjustable' | 'fixed'): Project =>
    makeProject((furniture, ids) => ({ ...furniture, root: createShelvesLeaf(ids, count, mounting) }));

  it('Test 10: две съёмные полки дают восемь держателей — по углам', () => {
    const bom = calculateHardware(withShelves(2, 'adjustable'));
    expect(quantityOf(bom, HW_SHELF_SUPPORT)).toBe(8);
    expect(supportsPerShelf()).toBe(4);
  });

  it('Test 11: стационарная полка держателей не получает', () => {
    const bom = calculateHardware(withShelves(2, 'fixed'));
    expect(quantityOf(bom, HW_SHELF_SUPPORT)).toBe(0);
  });

  it('Test 12: каждая позиция ссылается на свою деталь полки', () => {
    const bom = calculateHardware(withShelves(3, 'adjustable'));
    const supports = bom.items.filter((i) => i.definitionId === HW_SHELF_SUPPORT);
    expect(supports).toHaveLength(3);
    expect(supports.every((i) => i.sourcePartId !== undefined)).toBe(true);
  });
});

// ── Задняя стенка (§10) ──────────────────────────────────────────────────────

describe('Test 13–14 (§10): крепёж задней стенки', () => {
  it('Test 13: расстояние между креплениями не выдумано — вместо количества предупреждение', () => {
    const bom = calculateHardware(makeProject());
    expect(bom.items.filter((i) => i.kind === 'back-nail')).toHaveLength(0);
    expect(bom.warnings.some((w) => w.message.includes('Крепёж задней стенки не рассчитан'))).toBe(true);
  });

  it('Test 14: без задней стенки правило молчит', () => {
    const project = makeProject((furniture) => ({
      ...furniture,
      carcass: { ...furniture.carcass, back: { ...furniture.carcass.back, mount: { kind: 'none' } } },
    }));
    const bom = calculateHardware(project);
    expect(bom.warnings.some((w) => w.message.includes('Крепёж задней стенки не рассчитан'))).toBe(false);
  });
});

// ── Крепёж корпуса (§11) ─────────────────────────────────────────────────────

describe('Test 15 (§11): стыки корпуса найдены, количество крепежа — нет', () => {
  const project = makeProject();
  const geometry = buildGeometry({
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });

  it('боковины и горизонты дают четыре стыка у простого корпуса', () => {
    expect(findCarcassJoints(geometry.parts)).toHaveLength(4);
  });

  it('но позиции крепежа не создаются, а правило сообщает почему', () => {
    const bom = calculateHardware(project);
    expect(bom.items.filter((i) => i.kind === 'confirmat')).toHaveLength(0);
    expect(bom.warnings.some((w) => w.message.includes('Крепёж корпуса не рассчитан'))).toBe(true);
  });
});

// ── Ручки и push-to-open (§12–13) ────────────────────────────────────────────

describe('Test 16–18 (§12–13): ручки, механизмы и отсутствие двойного учёта', () => {
  const withOpening = (kind: 'handle' | 'push'): Project =>
    makeProject((furniture, ids) => {
      const facade = createHingedFacade(ids, furniture.root.id, 1);
      const leaf = facade.leaves[0]!;
      const opening = kind === 'handle' ? createHandleOpeningSystem(ids, leaf.hingeSide) : createPushToOpenSystem(ids, leaf.hingeSide);
      return { ...furniture, facades: [{ ...facade, leaves: [{ ...leaf, opening }] }] };
    });

  it('Test 16: одна ручка на фасад со способом открывания «ручка»', () => {
    const bom = calculateHardware(withOpening('handle'));
    expect(quantityOf(bom, HW_HANDLE)).toBe(1);
  });

  it('Test 17: push-to-open даёт механизм и НЕ даёт ручку', () => {
    const bom = calculateHardware(withOpening('push'));
    expect(quantityOf(bom, HW_PUSH_LATCH)).toBe(1);
    expect(quantityOf(bom, HW_HANDLE)).toBe(0);
  });

  it('Test 18: ручка не порождает второй позиции из конфигурации фасада', () => {
    const bom = calculateHardware(withOpening('handle'));
    expect(bom.items.filter((i) => i.definitionId === HW_HANDLE)).toHaveLength(1);
  });

  it('крепёж ручки — отдельное правило, и оно ждёт подтверждения', () => {
    const bom = calculateHardware(withOpening('handle'));
    expect(bom.warnings.some((w) => w.message.includes('T-HW-08'))).toBe(true);
  });
});

// ── Агрегация, трассируемость, детерминизм (§16–17, §21) ─────────────────────

describe('Test 19–21 (§16–17): строки спецификации', () => {
  const project = makeProject((furniture, ids) => ({ ...furniture, root: createDrawersLeaf(ids, 3) }));
  const bom = calculateHardware(project);

  it('Test 19: одинаковые позиции сложены в одну строку с сохранением источников', () => {
    const line = bom.lines.find((l) => l.definitionId === HW_SLIDE);
    expect(line?.quantity).toBe(6);
    expect(line?.sources).toHaveLength(3);
  });

  it('Test 20: количество целое и неотрицательное', () => {
    for (const item of bom.items) {
      expect(Number.isInteger(item.quantity)).toBe(true);
      expect(item.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('Test 21: у каждой позиции есть правило и объяснение', () => {
    for (const item of bom.items) {
      expect(item.ruleId).not.toBe('');
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── Валидация (§18) ──────────────────────────────────────────────────────────

describe('Test 22–26 (§18): проверки позиций', () => {
  const project = makeProject();
  const base = {
    kind: 'handle' as const,
    unit: 'pcs' as const,
    quantity: 1,
    ruleId: 'probe',
    reason: 'тестовая позиция',
  };
  const ruleWith = (items: readonly Record<string, unknown>[]): HardwareRule => ({
    id: 'probe',
    title: 'Проба',
    status: 'implemented',
    run: () => ({ items: items as never, warnings: [], errors: [] }),
  });
  const errorsOf = (items: readonly Record<string, unknown>[]): string[] =>
    calculateHardware(project, { rules: [ruleWith(items)] }).errors.map((e) => e.code);

  it('Test 22: ссылка на несуществующее определение', () => {
    const definitionId: HardwareId = asId<'Hardware'>('hw-does-not-exist');
    expect(errorsOf([{ ...base, id: 'a', definitionId, sourceNodeId: project.furniture[0]!.root.id }])).toContain(
      'HARDWARE_UNKNOWN_DEFINITION',
    );
  });

  it('Test 23: дробное и отрицательное количество', () => {
    const source = project.furniture[0]!.root.id;
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_HANDLE, quantity: 1.5, sourceNodeId: source }])).toContain(
      'HARDWARE_QUANTITY_NOT_INTEGER',
    );
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_HANDLE, quantity: -1, sourceNodeId: source }])).toContain(
      'HARDWARE_QUANTITY_NEGATIVE',
    );
  });

  it('Test 24: позиция без источника', () => {
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_HANDLE }])).toContain('HARDWARE_WITHOUT_SOURCE');
  });

  it('Test 25: ссылка на несуществующую деталь или узел', () => {
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_HANDLE, sourcePartId: 'part-does-not-exist' }])).toContain(
      'HARDWARE_SOURCE_NOT_FOUND',
    );
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_HANDLE, sourceNodeId: 'node-does-not-exist' }])).toContain(
      'HARDWARE_SOURCE_NOT_FOUND',
    );
  });

  it('Test 26: повторяющийся идентификатор и несовместимое определение', () => {
    const source = project.furniture[0]!.root.id;
    expect(
      errorsOf([
        { ...base, id: 'same', definitionId: HW_HANDLE, sourceNodeId: source },
        { ...base, id: 'same', definitionId: HW_HANDLE, sourceNodeId: source },
      ]),
    ).toContain('HARDWARE_DUPLICATE_ID');
    expect(errorsOf([{ ...base, id: 'a', definitionId: HW_SLIDE, sourceNodeId: source }])).toContain(
      'HARDWARE_INCOMPATIBLE_DEFINITION',
    );
  });

  it('не прошедшая проверку позиция в спецификацию не попадает', () => {
    const bom = calculateHardware(project, {
      rules: [ruleWith([{ ...base, id: 'a', definitionId: HW_HANDLE, quantity: -1, sourceNodeId: project.furniture[0]!.root.id }])],
    });
    expect(bom.items).toHaveLength(0);
    expect(bom.lines).toHaveLength(0);
  });
});

// ── Пересчёт и чистота (§14, §20) ────────────────────────────────────────────

describe('Test 27–29 (§14, §20): пересчёт производной величины', () => {
  it('Test 27: добавление ящика меняет спецификацию само, без ручного пересчёта', () => {
    const before = calculateHardware(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 2) })));
    const after = calculateHardware(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 3) })));
    expect(quantityOf(before, HW_SLIDE)).toBe(4);
    expect(quantityOf(after, HW_SLIDE)).toBe(6);
  });

  it('Test 28: расчёт не изменяет проект', () => {
    const project = makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 2) }));
    const snapshot = JSON.stringify(project);
    calculateHardware(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('Test 29: изделие с ошибкой геометрии не получает выдуманной фурнитуры', () => {
    const broken = makeProject((f) => ({ ...f, dimensions: { ...f.dimensions, width: -100 } }));
    const bom = calculateHardware(broken);
    expect(bom.items).toHaveLength(0);
    expect(warningCodes(bom)).toContain('HARDWARE_SKIPPED_BROKEN_GEOMETRY');
  });
});

// ── Debug-вывод (§26) ────────────────────────────────────────────────────────

describe('Test 30 (§26): технический вывод показывает все требуемые поля', () => {
  it('заголовок перечисляет ID, DEFINITION, CATEGORY, QUANTITY, UNIT, SOURCE, RULE, REASON', () => {
    const lines = formatHardwareDebug(calculateHardware(makeProject((f, ids) => ({ ...f, root: createDrawersLeaf(ids, 1) }))));
    expect(lines[0]).toBe('ID · DEFINITION · CATEGORY · QUANTITY · UNIT · SOURCE · RULE · REASON');
    expect(lines.some((l) => l.includes('hw-slide') && l.includes('slide'))).toBe(true);
  });
});

describe('состав движка', () => {
  it('все правила объявляют статус, а нуждающиеся в подтверждении — идентификатор неизвестного', () => {
    for (const rule of HARDWARE_RULES) {
      expect(['confirmed', 'implemented', 'ambiguous', 'needs-confirmation']).toContain(rule.status);
      if (rule.status === 'needs-confirmation' || rule.status === 'ambiguous') {
        expect(rule.unknownId).toBeDefined();
      }
    }
  });
});
