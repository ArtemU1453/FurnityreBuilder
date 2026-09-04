import { describe, expect, it } from 'vitest';
import { buildGizmos, gizmoBaseValue, withGizmos } from '../../../src/scene/gizmos.js';
import { buildScene } from '../../../src/scene/adapter.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { makeGeometryInput, makeGeometryInputWithRoot } from '../geometry/helpers.js';
import { isSplit } from '../../../src/domain/index.js';
import type { GizmoTarget } from '../../../src/scene/types.js';

/**
 * Ручки изменения размера (PROMPT 23 §22–§23).
 *
 * Ручка существует ровно там, где существует команда, которая её
 * изменение выразит. Проверяется именно это соответствие: свободного
 * трансформа в доменной модели нет, и обещать его в интерфейсе нельзя.
 */

const simple = makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 });
const grid = makeGeometryInputWithRoot((ids) => createUniformGrid(ids, 1, 3, 16, 16), {
  width: 1600,
  height: 2000,
  depth: 500,
  panelThickness: 16,
});

const gizmosOf = (input: typeof simple) => buildGizmos(input.furniture, buildGeometry(input));

describe('ручки габарита', () => {
  const gizmos = gizmosOf(simple);
  const kinds = gizmos.map((g) => g.gizmo?.kind);

  it('есть ручка ширины и ручка высоты', () => {
    expect(kinds).toContain('furniture-width');
    expect(kinds).toContain('furniture-height');
  });

  it('ручки левой и нижней грани не заводятся: команды для них нет', () => {
    // Потянуть за левую грань означало бы сдвинуть начало координат, то
    // есть переместить все детали разом. Такой команды в домене нет.
    expect(gizmos).toHaveLength(2);
  });

  it('ручка ширины стоит на правой грани изделия', () => {
    const geometry = buildGeometry(simple);
    const widthGizmo = gizmos.find((g) => g.gizmo?.kind === 'furniture-width')!;
    expect(widthGizmo.position.x).toBeCloseTo(geometry.boundingBox.maxX, 6);
  });

  it('ручка высоты стоит на верхней грани изделия', () => {
    const geometry = buildGeometry(simple);
    const heightGizmo = gizmos.find((g) => g.gizmo?.kind === 'furniture-height')!;
    expect(heightGizmo.position.y).toBeCloseTo(geometry.boundingBox.maxY, 6);
  });

  it('ручка не является деталью: у неё нет ни материала, ни роли', () => {
    for (const gizmo of gizmos) {
      expect(gizmo.kind).toBe('gizmo');
      expect(gizmo.material).toBeUndefined();
      expect(gizmo.role).toBeUndefined();
    }
  });

  it('полоса захвата шире грани: тонкую линию не поймать пальцем', () => {
    const widthGizmo = gizmos.find((g) => g.gizmo?.kind === 'furniture-width')!;
    expect(widthGizmo.size.x).toBeGreaterThan(16);
  });
});

describe('ручки внутренних границ', () => {
  const geometry = buildGeometry(grid);
  const gizmos = buildGizmos(grid.furniture, geometry);
  const childGizmos = gizmos.filter((g) => g.gizmo?.kind === 'child-size');

  it('на три секции приходится две внутренние границы', () => {
    // У последнего ребёнка своей границы нет: там уже стенка корпуса, а
    // его размер определяется остатком.
    expect(childGizmos).toHaveLength(2);
  });

  it('ручка адресована id ребёнка, а не его номеру', () => {
    const root = grid.furniture.root;
    const childIds = isSplit(root) ? root.children.map((c) => c.node.id) : [];
    for (const gizmo of childGizmos) {
      const target = gizmo.gizmo as Extract<GizmoTarget, { kind: 'child-size' }>;
      expect(childIds).toContain(target.childId);
    }
  });

  it('ручка стоит на правой границе своего ребёнка', () => {
    const target = childGizmos[0]!.gizmo as Extract<GizmoTarget, { kind: 'child-size' }>;
    const box = geometry.cells.find((c) => c.nodeId === target.childId)?.box
      ?? geometry.sections.find((s) => s.nodeId === target.childId)!.box;
    expect(childGizmos[0]!.position.x).toBeCloseTo(box.min.x + box.size.x, 6);
  });

  it('деление по X даёт ручки ширины секции', () => {
    for (const gizmo of childGizmos) {
      expect((gizmo.gizmo as Extract<GizmoTarget, { kind: 'child-size' }>).axis).toBe('x');
    }
  });

  it('идентификаторы ручек уникальны и не совпадают с деталями', () => {
    const scene = withGizmos(buildScene(geometry, grid.materials), gizmos);
    const ids = scene.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('базовое значение ручки', () => {
  it('для габарита читается из домена, а не из сцены', () => {
    expect(gizmoBaseValue({ kind: 'furniture-width' }, simple.furniture, buildGeometry(simple))).toBe(1000);
    expect(gizmoBaseValue({ kind: 'furniture-height' }, simple.furniture, buildGeometry(simple))).toBe(2000);
  });

  it('для секции читается посчитанная движком ширина', () => {
    const geometry = buildGeometry(grid);
    const gizmo = buildGizmos(grid.furniture, geometry).find((g) => g.gizmo?.kind === 'child-size')!;
    const target = gizmo.gizmo as Extract<GizmoTarget, { kind: 'child-size' }>;
    const box = geometry.cells.find((c) => c.nodeId === target.childId)?.box
      ?? geometry.sections.find((s) => s.nodeId === target.childId)!.box;
    expect(gizmoBaseValue(target, grid.furniture, geometry)).toBe(box.size.x);
  });

  it('исчезнувший узел не даёт выдуманного числа', () => {
    const value = gizmoBaseValue(
      { kind: 'child-size', childId: 'нет-такого' as never, axis: 'x' },
      grid.furniture,
      buildGeometry(grid),
    );
    expect(value).toBeUndefined();
  });
});

describe('вырожденная геометрия', () => {
  it('изделие без габарита не получает ручек', () => {
    const broken = makeGeometryInput({ width: -100, height: 2000, depth: 500, panelThickness: 16 });
    expect(gizmosOf(broken)).toEqual([]);
  });
});
