import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import type { GeometryInput } from '../../../src/geometry/types.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { ConstructionScheme, VerticalPriority } from '../../../src/domain/furniture/types.js';
import { isFiniteBox3 } from '../../../src/domain/coordinates.js';

function input(priority: VerticalPriority, overrides: Partial<ConstructionScheme> = {}): GeometryInput {
  const project = createProject({
    ids: createSequentialIdFactory('t'),
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const furniture = project.furniture[0]!;
  return {
    furniture: { ...furniture, dimensions: { width: 1000, height: 2000, depth: 500, panelThickness: 16 } },
    scheme: { ...project.settings.construction, verticalPriority: priority, ...overrides },
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  };
}

const find = (parts: readonly { role: string; label: string; size: { x: number; y: number; z: number } }[], label: string) =>
  parts.find((p) => p.label === label);

describe('каркас: схема sides-through', () => {
  // Задняя стенка 3 мм накладная и входит в габаритную глубину,
  // поэтому глубина корпусных деталей 500 − 3 = 497.
  const result = buildGeometry(input('sides-through'));

  it('боковины идут на всю высоту', () => {
    expect(find(result.parts, 'Боковина левая')?.size).toEqual({ x: 16, y: 2000, z: 497 });
    expect(find(result.parts, 'Боковина правая')?.size).toEqual({ x: 16, y: 2000, z: 497 });
  });

  it('горизонтали встают между боковинами', () => {
    expect(find(result.parts, 'Дно')?.size).toEqual({ x: 968, y: 16, z: 497 });
    expect(find(result.parts, 'Крышка')?.size).toEqual({ x: 968, y: 16, z: 497 });
  });

  it('правая боковина стоит у правого края габарита', () => {
    expect(find(result.parts, 'Боковина правая')).toBeDefined();
    const right = result.parts.find((p) => p.label === 'Боковина правая');
    expect(right?.position).toEqual({ x: 984, y: 0, z: 3 });
  });

  it('внутренний объём равен габариту за вычетом каркаса и задней стенки', () => {
    expect(result.innerVolume.min).toEqual({ x: 16, y: 16, z: 3 });
    expect(result.innerVolume.size).toEqual({ x: 968, y: 1968, z: 497 });
  });
});

describe('каркас: схема horizontals-through', () => {
  const result = buildGeometry(input('horizontals-through'));

  it('верх и низ идут на всю ширину, боковины укорачиваются', () => {
    expect(find(result.parts, 'Дно')?.size).toEqual({ x: 1000, y: 16, z: 497 });
    expect(find(result.parts, 'Крышка')?.size).toEqual({ x: 1000, y: 16, z: 497 });
    expect(find(result.parts, 'Боковина левая')?.size).toEqual({ x: 16, y: 1968, z: 497 });
  });
});

describe('каркас: схема mixed', () => {
  const result = buildGeometry(
    input('mixed', { topOverlaysSides: true, bottomOverlaysSides: false }),
  );

  it('накладной верх и вкладное дно дают несимметричный каркас', () => {
    expect(find(result.parts, 'Крышка')?.size).toEqual({ x: 1000, y: 16, z: 497 });
    expect(find(result.parts, 'Дно')?.size).toEqual({ x: 968, y: 16, z: 497 });
    expect(find(result.parts, 'Боковина левая')?.size).toEqual({ x: 16, y: 1984, z: 497 });
  });
});

describe('каркас: устойчивость расчёта', () => {
  it('не выдаёт NaN и бесконечности ни в одной детали', () => {
    for (const priority of ['sides-through', 'horizontals-through', 'mixed'] as const) {
      const result = buildGeometry(input(priority));
      for (const part of result.parts) {
        expect(isFiniteBox3({ min: part.position, size: part.size })).toBe(true);
        expect(Number.isFinite(part.cut.length)).toBe(true);
        expect(Number.isFinite(part.cut.width)).toBe(true);
        expect(Number.isFinite(part.cut.thickness)).toBe(true);
        expect(part.size.x).toBeGreaterThan(0);
        expect(part.size.y).toBeGreaterThan(0);
        expect(part.size.z).toBeGreaterThan(0);
      }
    }
  });

  it('детали каркаса не пересекаются между собой', () => {
    const result = buildGeometry(input('sides-through'));
    for (let i = 0; i < result.parts.length; i += 1) {
      for (let j = i + 1; j < result.parts.length; j += 1) {
        const a = result.parts[i]!;
        const b = result.parts[j]!;
        const overlap =
          Math.max(0, Math.min(a.position.x + a.size.x, b.position.x + b.size.x) - Math.max(a.position.x, b.position.x)) *
          Math.max(0, Math.min(a.position.y + a.size.y, b.position.y + b.size.y) - Math.max(a.position.y, b.position.y)) *
          Math.max(0, Math.min(a.position.z + a.size.z, b.position.z + b.size.z) - Math.max(a.position.z, b.position.z));
        expect(overlap).toBe(0);
      }
    }
  });

  it('сообщает об ошибке вместо мусора при нечисловом габарите', () => {
    const base = input('sides-through');
    const broken = {
      ...base,
      furniture: { ...base.furniture, dimensions: { ...base.furniture.dimensions, width: Number.NaN } },
    };
    const result = buildGeometry(broken);
    expect(result.diagnostics.some((d) => d.code === 'DIMENSION_NOT_FINITE')).toBe(true);
  });

  it('сообщает об ошибке, когда внутреннего пространства не остаётся', () => {
    const base = input('sides-through');
    const tiny = {
      ...base,
      furniture: { ...base.furniture, dimensions: { width: 20, height: 20, depth: 500, panelThickness: 16 } },
    };
    const result = buildGeometry(tiny);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
