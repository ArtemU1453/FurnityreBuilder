import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createCountertop, createFalsePanel, createTopSection } from '../../../src/domain/furniture/defaults.js';
import type { MaterialId } from '../../../src/domain/index.js';

/**
 * Команды конструктивных модификаторов (PROMPT 15 §13).
 *
 * Из десяти действий формулировки заведены три команды:
 * `SetStructuralModifiers` (патч по полям `CarcassSpec`), `AddFalsePanel`/
 * `RemoveFalsePanel`/`UpdateFalsePanel` (панели адресуются по своему id).
 * Десять команд, пишущих в поля одного объекта, означали бы десять путей
 * записи в одно состояние — тот же довод, каким PROMPT 14 обошёлся
 * `SetBackPanel`, а PROMPT 12 — полем `patch.opening`.
 */

const store = () =>
  createDocumentStore(createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' }));

const carcassOf = (s: ReturnType<typeof store>) => s.getState().project.furniture[0]!.carcass;
const firstMaterial = (s: ReturnType<typeof store>): MaterialId =>
  asId<'Material'>(Object.keys(s.getState().project.materials.items)[0]!);
const MISSING: MaterialId = asId<'Material'>('no-such-material');

describe('SetStructuralModifiers: свес (§13)', () => {
  it('включает и выключает свес, undo/redo восстанавливают', () => {
    const s = store();
    const overhang = { front: 20, back: 0, left: 0, right: 0, appliesTo: ['top' as const] };
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { overhang } });
    expect(carcassOf(s).overhang?.front).toBe(20);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { overhang: null } });
    expect(carcassOf(s).overhang).toBeUndefined();

    s.getState().undo();
    expect(carcassOf(s).overhang?.front).toBe(20);
    s.getState().redo();
    expect(carcassOf(s).overhang).toBeUndefined();
  });

  it('отрицательный свес не принимается', () => {
    const s = store();
    s.getState().execute({
      type: 'SetStructuralModifiers',
      furnitureIndex: 0,
      patch: { overhang: { front: -5, back: 0, left: 0, right: 0, appliesTo: ['top'] } },
    });
    expect(carcassOf(s).overhang).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe('SetStructuralModifiers: верхняя секция и зазор до потолка (§13)', () => {
  it('включает антресоль, меняет высоту, выключает', () => {
    const s = store();
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { topSection: createTopSection(400) } });
    expect(carcassOf(s).topSection?.height).toBe(400);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { topSection: createTopSection(500, 20) } });
    expect(carcassOf(s).topSection?.height).toBe(500);
    expect(carcassOf(s).topSection?.gap).toBe(20);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { topSection: null } });
    expect(carcassOf(s).topSection).toBeUndefined();
    s.getState().undo();
    expect(carcassOf(s).topSection?.height).toBe(500);
  });

  it('нулевая высота антресоли и отрицательный зазор не принимаются', () => {
    const s = store();
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { topSection: createTopSection(0) } });
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { topSection: createTopSection(300, -10) } });
    expect(carcassOf(s).topSection).toBeUndefined();
  });

  it('зазор до потолка задаётся, снимается и не может быть отрицательным', () => {
    const s = store();
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { ceilingGap: 120 } });
    expect(carcassOf(s).ceilingGap).toBe(120);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { ceilingGap: -1 } });
    expect(carcassOf(s).ceilingGap).toBe(120);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { ceilingGap: null } });
    expect(carcassOf(s).ceilingGap).toBeUndefined();
  });
});

describe('SetStructuralModifiers: столешница (§13)', () => {
  it('включает столешницу, меняет толщину, выключает', () => {
    const s = store();
    const countertop = createCountertop(38, firstMaterial(s));
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop } });
    expect(carcassOf(s).countertop?.thickness).toBe(38);

    s.getState().execute({
      type: 'SetStructuralModifiers',
      furnitureIndex: 0,
      patch: { countertop: { ...countertop, thickness: 26 } },
    });
    expect(carcassOf(s).countertop?.thickness).toBe(26);

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop: null } });
    expect(carcassOf(s).countertop).toBeUndefined();
  });

  it('нулевая толщина, отрицательный свес и битый материал не принимаются', () => {
    const s = store();
    const good = createCountertop(38, firstMaterial(s));
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop: { ...good, thickness: 0 } } });
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop: { ...good, overhangFront: -1 } } });
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop: { ...good, materialId: MISSING } } });
    expect(carcassOf(s).countertop).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });
});

describe('SetStructuralModifiers: крепление к стене (§13)', () => {
  it('меняет режим установки, undo возвращает прежний', () => {
    const s = store();
    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { wallMount: { mode: 'wall-mounted' } } });
    expect(carcassOf(s).wallMount?.mode).toBe('wall-mounted');

    s.getState().execute({ type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { wallMount: { mode: 'suspended', elevation: 600 } } });
    expect(carcassOf(s).wallMount?.elevation).toBe(600);

    s.getState().undo();
    expect(carcassOf(s).wallMount?.mode).toBe('wall-mounted');
  });

  it('отрицательная высота подвеса не принимается', () => {
    const s = store();
    s.getState().execute({
      type: 'SetStructuralModifiers',
      furnitureIndex: 0,
      patch: { wallMount: { mode: 'suspended', elevation: -100 } },
    });
    expect(carcassOf(s).wallMount).toBeUndefined();
  });
});

describe('Фальшпанели: add / remove / update (§13)', () => {
  const ids = createSequentialIdFactory('fp');

  it('добавляет панель и убирает её по id', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });
    expect(carcassOf(s).falsePanels).toHaveLength(1);

    s.getState().execute({ type: 'RemoveFalsePanel', furnitureIndex: 0, panelId: panel.id });
    expect(carcassOf(s).falsePanels).toHaveLength(0);

    s.getState().undo();
    expect(carcassOf(s).falsePanels?.[0]?.id).toBe(panel.id);
  });

  it('панель с уже занятым id не добавляется дважды', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });
    expect(carcassOf(s).falsePanels).toHaveLength(1);
  });

  it('удаление несуществующей панели — no-op, история не пишется', () => {
    const s = store();
    s.getState().execute({ type: 'RemoveFalsePanel', furnitureIndex: 0, panelId: asId<'Node'>('nope') });
    expect(s.getState().history.past).toHaveLength(0);
  });

  it('меняет размер панели и снимает переопределение через null', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });

    s.getState().execute({ type: 'UpdateFalsePanel', furnitureIndex: 0, panelId: panel.id, patch: { height: 500, thickness: 20 } });
    expect(carcassOf(s).falsePanels?.[0]?.height).toBe(500);
    expect(carcassOf(s).falsePanels?.[0]?.thickness).toBe(20);

    s.getState().execute({ type: 'UpdateFalsePanel', furnitureIndex: 0, panelId: panel.id, patch: { height: null } });
    expect(carcassOf(s).falsePanels?.[0]?.height).toBeUndefined();
  });

  it('неположительный размер и битый материал не принимаются', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });

    s.getState().execute({ type: 'UpdateFalsePanel', furnitureIndex: 0, panelId: panel.id, patch: { width: 0 } });
    s.getState().execute({ type: 'UpdateFalsePanel', furnitureIndex: 0, panelId: panel.id, patch: { materialId: MISSING } });
    expect(carcassOf(s).falsePanels?.[0]?.width).toBeUndefined();
    expect(carcassOf(s).falsePanels?.[0]?.materialId).toBeUndefined();
  });

  it('меняет материал на существующий и позицию', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 0, panel });
    s.getState().execute({
      type: 'UpdateFalsePanel',
      furnitureIndex: 0,
      panelId: panel.id,
      patch: { materialId: firstMaterial(s), position: 'top' },
    });
    expect(carcassOf(s).falsePanels?.[0]?.materialId).toBe(firstMaterial(s));
    expect(carcassOf(s).falsePanels?.[0]?.position).toBe('top');
  });

  it('несуществующее изделие — no-op для всех трёх команд', () => {
    const s = store();
    const panel = createFalsePanel(ids, 'right');
    s.getState().execute({ type: 'AddFalsePanel', furnitureIndex: 9, panel });
    s.getState().execute({ type: 'RemoveFalsePanel', furnitureIndex: 9, panelId: panel.id });
    s.getState().execute({ type: 'UpdateFalsePanel', furnitureIndex: 9, panelId: panel.id, patch: { height: 100 } });
    expect(s.getState().history.past).toHaveLength(0);
  });
});
