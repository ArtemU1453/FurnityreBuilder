import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import type { Project } from '../../../src/domain/index.js';

/**
 * PROMPT 3 §18: FurnitureModel → JSON → FurnitureModel не должен менять
 * геометрические параметры. Проверяется на уровне, который реально важен —
 * не «объекты равны», а «GeometryResult, посчитанный из восстановленного
 * проекта, идентичен GeometryResult из исходного».
 */

function geometryInputOf(project: Project): GeometryInput {
  const furniture = project.furniture[0]!;
  return {
    furniture,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  };
}

describe('серилизация не меняет геометрический результат', () => {
  it('проект по умолчанию: круговой путь домен → JSON → домен', () => {
    const original = createProject({
      ids: createSequentialIdFactory('t'),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const restored = fromJson(toJson(original)).project;

    expect(buildGeometry(geometryInputOf(restored))).toEqual(buildGeometry(geometryInputOf(original)));
  });

  it('проект с изменёнными габаритами и схемой стыка', () => {
    const base = createProject({
      ids: createSequentialIdFactory('t'),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const furniture = base.furniture[0]!;
    const original: Project = {
      ...base,
      furniture: [
        {
          ...furniture,
          dimensions: { width: 1830.4, height: 2400.7, depth: 583.2, panelThickness: 18.6 },
        },
      ],
      settings: {
        ...base.settings,
        construction: { ...base.settings.construction, verticalPriority: 'horizontals-through' },
      },
    };

    const restored = fromJson(toJson(original)).project;
    const before = buildGeometry(geometryInputOf(original));
    const after = buildGeometry(geometryInputOf(restored));

    expect(after).toEqual(before);
    expect(after.parts).toHaveLength(4);
  });

  it('property: для произвольного валидного проекта результат геометрии переживает круговой путь', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 200, max: 4000, noNaN: true }),
        fc.double({ min: 200, max: 2500, noNaN: true }),
        fc.double({ min: 150, max: 900, noNaN: true }),
        fc.double({ min: 10, max: 30, noNaN: true }),
        fc.constantFrom('sides-through', 'horizontals-through', 'mixed' as const),
        (width, height, depth, panelThickness, verticalPriority) => {
          const base = createProject({
            ids: createSequentialIdFactory('t'),
            now: () => '2026-01-01T00:00:00.000Z',
          });
          const furniture = base.furniture[0]!;
          const original: Project = {
            ...base,
            furniture: [{ ...furniture, dimensions: { width, height, depth, panelThickness } }],
            settings: { ...base.settings, construction: { ...base.settings.construction, verticalPriority } },
          };

          const restored = fromJson(toJson(original)).project;
          expect(buildGeometry(geometryInputOf(restored))).toEqual(buildGeometry(geometryInputOf(original)));
        },
      ),
    );
  });
});
