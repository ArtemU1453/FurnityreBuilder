import { describe, expect, it } from 'vitest';
import { PIPELINE, buildGeometry } from '../../../src/geometry/engine.js';
import { resolveBackGeometry } from '../../../src/geometry/stages/carcass.js';
import { applyEdgeSizing, rawCutSize } from '../../../src/geometry/parts.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { GeometryInput } from '../../../src/geometry/types.js';

function makeInput(): GeometryInput {
  const project = createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });
  return {
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  };
}

describe('контракт геометрического движка', () => {
  it('детерминирован: одинаковый вход даёт одинаковый выход', () => {
    expect(buildGeometry(makeInput())).toEqual(buildGeometry(makeInput()));
  });

  it('честно сообщает, какие этапы конвейера ещё не реализованы', () => {
    const result = buildGeometry(makeInput());
    const planned = PIPELINE.filter((s) => s.status === 'planned').map((s) => s.name);
    expect(result.pendingStages).toEqual(planned);
    expect(result.pendingStages).toContain('layout');
    expect(result.pendingStages).toContain('facades');
  });

  it('возвращает замороженный результат: движок не отдаёт изменяемое состояние', () => {
    const result = buildGeometry(makeInput());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.parts)).toBe(true);
  });

  it('идентификаторы деталей стабильны при изменении габарита', () => {
    const base = makeInput();
    const widened: GeometryInput = {
      ...base,
      furniture: { ...base.furniture, dimensions: { ...base.furniture.dimensions, width: 1400 } },
    };
    // Выделение и открытая панель не должны слетать на каждом кадре drag.
    expect(buildGeometry(widened).parts.map((p) => p.id)).toEqual(
      buildGeometry(base).parts.map((p) => p.id),
    );
  });
});

describe('размеры раскроя', () => {
  it('выводит длину, ширину и толщину из ориентации детали', () => {
    expect(rawCutSize({ x: 16, y: 2000, z: 497 }, 'vertical-yz')).toEqual({
      length: 2000,
      width: 497,
      thickness: 16,
    });
    expect(rawCutSize({ x: 968, y: 16, z: 497 }, 'horizontal-xz')).toEqual({
      length: 968,
      width: 497,
      thickness: 16,
    });
  });

  it('вычитает кромку только при включённой политике', () => {
    const raw = { length: 568, width: 500, thickness: 16 };
    const edge = { front: 2, back: 0, left: 2, right: 2 } as const;
    expect(applyEdgeSizing(raw, edge, { subtractFromPartSize: false }).length).toBe(568);
    // ASSUMPTION(T-EDG-03): проверяет обе ветки, потому что правило неизвестно.
    expect(applyEdgeSizing(raw, edge, { subtractFromPartSize: true })).toEqual({
      length: 564,
      width: 498,
      thickness: 16,
    });
  });
});

describe('монтаж задней стенки', () => {
  it('накладная стенка отнимает глубину у корпуса и сдвигает его вперёд', () => {
    expect(resolveBackGeometry({ kind: 'overlay', thickness: 3 }, 500, true)).toEqual({
      thickness: 3,
      carcassZ0: 3,
      carcassDepth: 497,
      innerZ0: 3,
    });
  });

  it('без задней стенки корпус занимает всю глубину', () => {
    expect(resolveBackGeometry({ kind: 'none' }, 500, true).carcassDepth).toBe(500);
  });

  it('вкладная стенка не меняет глубину корпуса, но сдвигает внутреннюю границу', () => {
    const g = resolveBackGeometry({ kind: 'inset-flush', thickness: 3 }, 500, true);
    expect(g.carcassDepth).toBe(500);
    expect(g.innerZ0).toBe(3);
  });
});
