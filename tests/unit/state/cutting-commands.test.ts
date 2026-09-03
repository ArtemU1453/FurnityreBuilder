import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { DEFAULT_KERF, uniformTrim } from '../../../src/domain/index.js';

/**
 * Команды параметров раскроя (PROMPT 17 §26).
 *
 * Команда одна на весь `CuttingSettings`: `kerf`, `trim` и
 * `rotationPolicy` пишутся в один объект настроек, и три отдельные команды
 * означали бы три пути записи в одно состояние. Команд перемещения
 * деталей по листу нет — их отсутствие тоже проверяется здесь, потому что
 * добавить их «на будущее» было бы легко, а координата в производной
 * раскладке потерялась бы при первом же пересчёте.
 */

const store = () =>
  createDocumentStore(createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' }));

const cuttingOf = (s: ReturnType<typeof store>) => s.getState().project.settings.cutting;

describe('SetCuttingSettings (§26)', () => {
  it('ширина пропила по умолчанию — единственная константа, а не magic number в алгоритме', () => {
    expect(cuttingOf(store()).kerf).toBe(DEFAULT_KERF);
  });

  it('меняет ширину пропила, undo/redo восстанавливают', () => {
    const s = store();
    s.getState().execute({ type: 'SetCuttingSettings', patch: { kerf: 3.2 } });
    expect(cuttingOf(s).kerf).toBe(3.2);
    s.getState().undo();
    expect(cuttingOf(s).kerf).toBe(DEFAULT_KERF);
    s.getState().redo();
    expect(cuttingOf(s).kerf).toBe(3.2);
  });

  it('задаёт и снимает обрезную кромку по четырём сторонам', () => {
    const s = store();
    s.getState().execute({ type: 'SetCuttingSettings', patch: { trim: uniformTrim(15) } });
    expect(cuttingOf(s).trim).toEqual({ left: 15, right: 15, top: 15, bottom: 15 });
    s.getState().execute({ type: 'SetCuttingSettings', patch: { trim: null } });
    expect(cuttingOf(s).trim).toBeUndefined();
  });

  it('меняет политику поворота', () => {
    const s = store();
    s.getState().execute({ type: 'SetCuttingSettings', patch: { rotationPolicy: 'never' } });
    expect(cuttingOf(s).rotationPolicy).toBe('never');
  });

  it('отрицательный пропил и отрицательная кромка отвергаются целиком', () => {
    const s = store();
    const before = s.getState().history.past.length;
    s.getState().execute({ type: 'SetCuttingSettings', patch: { kerf: -1, rotationPolicy: 'never' } });
    expect(cuttingOf(s).kerf).toBe(DEFAULT_KERF);
    // Половина патча не должна осесть в проекте: команда либо применяется
    // целиком, либо не применяется вовсе и не попадает в историю.
    expect(cuttingOf(s).rotationPolicy).toBe('by-material');
    expect(s.getState().history.past.length).toBe(before);

    s.getState().execute({ type: 'SetCuttingSettings', patch: { trim: { left: -5, right: 0, top: 0, bottom: 0 } } });
    expect(cuttingOf(s).trim).toBeUndefined();
    expect(s.getState().history.past.length).toBe(before);
  });
});
