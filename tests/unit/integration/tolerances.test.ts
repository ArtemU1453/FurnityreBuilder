import { describe, expect, it } from 'vitest';
import { emptyProject, geometryOf, run } from './fixtures.js';
import { createPlinthBase } from '../../../src/domain/furniture/defaults.js';
import type { Project, Tolerances } from '../../../src/domain/index.js';

/**
 * Конвенции габарита действительно меняют изделие (PROMPT 33 §14, Д-002).
 *
 * До этого этапа три флага `Tolerances` жили в модели с пометкой
 * ASSUMPTION и не имели ни одного поля в интерфейсе: пользователь
 * получал предположение движка, не зная ни что оно сделано, ни как его
 * изменить. Теперь поля есть, и эти тесты сторожат главное — что за
 * переключателем стоит настоящая разница в геометрии, а не подпись.
 */

const PLINTH = 100;

function withTolerances(patch: Partial<Tolerances>): Project {
  const base = emptyProject('tol');
  const project = run(base, [
    { type: 'SetDimension', furnitureIndex: 0, axis: 'height', value: 2000 },
    { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(PLINTH) },
  ]);
  return {
    ...project,
    settings: { ...project.settings, tolerances: { ...project.settings.tolerances, ...patch } },
  };
}

/** Высота самой высокой боковины — она и есть высота корпуса. */
function sideHeight(project: Project): number {
  const sides = geometryOf(project).parts.filter((part) => part.role === 'side');
  expect(sides.length).toBeGreaterThan(0);
  return Math.max(...sides.map((part) => part.size.y));
}

describe('цоколь в габарите (T-CAR-05)', () => {
  it('включённый флаг вычитает цоколь из H', () => {
    const included = withTolerances({ heightIncludesBase: true });
    const excluded = withTolerances({ heightIncludesBase: false });
    // Корпус при включённом флаге ровно на высоту цоколя ниже.
    expect(sideHeight(excluded) - sideHeight(included)).toBeCloseTo(PLINTH, 1);
  });

  it('без цоколя флаг ничего не меняет: вычитать нечего', () => {
    const base = emptyProject('tol');
    const on = { ...base, settings: { ...base.settings, tolerances: { ...base.settings.tolerances, heightIncludesBase: true } } };
    const off = { ...base, settings: { ...base.settings, tolerances: { ...base.settings.tolerances, heightIncludesBase: false } } };
    expect(sideHeight(on)).toBe(sideHeight(off));
  });

  it('флаг не меняет число деталей — только их размеры', () => {
    const included = geometryOf(withTolerances({ heightIncludesBase: true }));
    const excluded = geometryOf(withTolerances({ heightIncludesBase: false }));
    expect(included.parts).toHaveLength(excluded.parts.length);
  });
});

describe('все три флага существуют и независимы', () => {
  it('модель несёт ровно три конвенции габарита', () => {
    const { tolerances } = emptyProject('tol').settings;
    expect(Object.keys(tolerances).sort()).toEqual([
      'depthIncludesBackPanel',
      'depthIncludesFacade',
      'heightIncludesBase',
    ]);
  });

  it('каждый флаг — булев: третьего состояния у конвенции нет', () => {
    const { tolerances } = emptyProject('tol').settings;
    for (const value of Object.values(tolerances)) expect(typeof value).toBe('boolean');
  });
});

describe('команда SetTolerances меняет ровно один флаг', () => {
  it('соседние конвенции переносятся как есть', () => {
    const before = emptyProject('tol');
    const after = run(before, [
      {
        type: 'SetTolerances',
        tolerances: { ...before.settings.tolerances, heightIncludesBase: !before.settings.tolerances.heightIncludesBase },
      },
    ]);
    expect(after.settings.tolerances.heightIncludesBase).toBe(
      !before.settings.tolerances.heightIncludesBase,
    );
    expect(after.settings.tolerances.depthIncludesBackPanel).toBe(
      before.settings.tolerances.depthIncludesBackPanel,
    );
    expect(after.settings.tolerances.depthIncludesFacade).toBe(
      before.settings.tolerances.depthIncludesFacade,
    );
  });
});
