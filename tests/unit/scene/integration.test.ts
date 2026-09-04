import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { buildScene, buildGizmos } from '../../../src/scene/index.js';
import { cameraForPreset, rayFromNdc } from '../../../src/scene/camera.js';
import { pick } from '../../../src/scene/raycast.js';
import { describeSelection, resolveSelection } from '../../../src/app/editor/selection.js';
import type { NodeId, PartId, Project } from '../../../src/domain/index.js';

/**
 * Сквозной путь (PROMPT 23 §37): проект → геометрия → сцена → выделение →
 * инспектор.
 *
 * Это единственный тест, который проверяет, что три слоя действительно
 * говорят на одном языке идентификаторов. Каждый по отдельности может
 * быть верным, а вместе — расходиться: ровно так и появляется «щёлкнул по
 * полке, а выделилась ячейка».
 */

const store = () =>
  createDocumentStore(createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' }));

const geometryOf = (project: Project) =>
  buildGeometry({
    furniture: project.furniture[0]!,
    scheme: project.settings.construction,
    tolerances: project.settings.tolerances,
    materials: project.materials,
    edgeSizing: project.settings.edgeSizing,
  });

describe('проект → сцена → выделение → инспектор', () => {
  it('объект, выбранный лучом на сцене, находится инспектором', () => {
    const s = store();
    const project = s.getState().project;
    const geometry = geometryOf(project);
    const scene = buildScene(geometry, project.materials);

    const aspect = 4 / 3;
    const camera = cameraForPreset('front', scene, aspect);
    const hit = pick(scene, rayFromNdc(camera, aspect, 0, 0)!);
    expect(hit).toBeDefined();

    const target = resolveSelection([], [hit!.object.id as PartId], geometry);
    expect(target).toEqual({ kind: 'part', partId: hit!.object.id });

    const model = describeSelection(target, project.furniture[0]!, geometry, project.materials);
    expect(model.title).toBe(hit!.object.label);
  });

  it('идентификаторы сцены и домена — одни и те же', () => {
    const s = store();
    const project = s.getState().project;
    const geometry = geometryOf(project);
    const scene = buildScene(geometry, project.materials);

    const partIds = new Set(geometry.parts.map((p) => p.id as string));
    const sceneParts = scene.objects.filter((o) => o.kind === 'part').map((o) => o.id);
    for (const id of sceneParts) expect(partIds.has(id)).toBe(true);
  });

  it('команда меняет проект — и сцена меняется вместе с ним', () => {
    const s = store();
    const before = buildScene(geometryOf(s.getState().project), s.getState().project.materials);

    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1600 });

    const after = buildScene(geometryOf(s.getState().project), s.getState().project.materials);
    expect(after.size.x).toBe(1600);
    expect(before.size.x).toBe(1000);
  });

  it('ручка ширины отправляет SetDimension и отменяется одним шагом', () => {
    const s = store();
    const project = s.getState().project;
    const geometry = geometryOf(project);
    const gizmo = buildGizmos(project.furniture[0]!, geometry).find((g) => g.gizmo?.kind === 'furniture-width');
    expect(gizmo).toBeDefined();

    s.getState().execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value: 1400 }, 'Ширина изделия');
    expect(s.getState().project.furniture[0]!.dimensions.width).toBe(1400);

    s.getState().undo();
    expect(s.getState().project.furniture[0]!.dimensions.width).toBe(1000);
  });

  it('ручка ширины секции отправляет SetChildSize по id ребёнка', () => {
    const s = store();
    const ids = createSequentialIdFactory('sec');
    s.getState().execute({
      type: 'SetSectionCount',
      furnitureIndex: 0,
      count: 3,
      splitId: ids.next<'Node'>(),
      newSectionIds: [ids.next<'Node'>(), ids.next<'Node'>(), ids.next<'Node'>()],
      dividerThickness: 16,
    });

    const project = s.getState().project;
    const geometry = geometryOf(project);
    const gizmo = buildGizmos(project.furniture[0]!, geometry).find(
      (g) => g.gizmo?.kind === 'child-size',
    );
    expect(gizmo).toBeDefined();
    const target = gizmo!.gizmo as { kind: 'child-size'; childId: NodeId; axis: 'x' | 'y' };

    s.getState().execute({
      type: 'SetChildSize',
      furnitureIndex: 0,
      childId: target.childId,
      size: { mode: 'fixed', value: 500 },
    });

    const next = geometryOf(s.getState().project);
    const box = next.cells.find((c) => c.nodeId === target.childId)?.box;
    expect(box?.size.x).toBe(500);
  });

  it('выделение не попадает ни в проект, ни в сцену', () => {
    // Сцена строится ТОЛЬКО из геометрии и материалов: выделение в неё не
    // передаётся, поэтому выбрать деталь и «изменить мебель» — разные
    // события, и второе из первого не следует (§19, §36).
    const s = store();
    const project = s.getState().project;
    const geometry = geometryOf(project);
    const a = buildScene(geometry, project.materials);
    const b = buildScene(geometry, project.materials);
    expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects));
    expect(JSON.stringify(project)).not.toContain('selected');
  });
});
