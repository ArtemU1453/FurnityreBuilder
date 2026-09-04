import { isSplit } from '../domain/index.js';
import type { Furniture, Mm, NodeId, SectionNode, Vec3 } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { GizmoTarget, SceneModel, SceneObject } from './types.js';

/**
 * Ручки изменения размера (PROMPT 23 §22–§23).
 *
 * ## Ручка — не производственная геометрия
 *
 * Гизмо живёт в отдельном слое сцены и никогда не попадает ни в
 * `GeometryResult`, ни в спецификацию, ни в раскрой. Это следствие того,
 * что детали производны от модели: у ручки нет ни материала, ни кромки,
 * ни детали-источника, и придумывать их — значит завести деталь, которую
 * потом придётся вычитать из деталировки.
 *
 * ## Показываются только разрешённые операции
 *
 * Свободного трансформа нет (§22). Ручка существует ровно там, где
 * существует команда, которая её изменение выразит:
 *
 * | Ручка | Команда |
 * | --- | --- |
 * | правая грань изделия | `SetDimension { axis: 'width' }` |
 * | верхняя грань изделия | `SetDimension { axis: 'height' }` |
 * | граница между секциями | `SetChildSize` по id левого соседа |
 * | граница между рядами | `SetChildSize` по id нижнего соседа |
 *
 * Перемещения и поворота нет ни у одного объекта: «подвинуть полку на
 * 3 мм» доменная модель не выражает — полка задаётся правилом
 * размещения внутри ячейки (`Shelf.placement`), а не координатой.
 * Нарисовать такую ручку значило бы пообещать операцию, которой нет.
 */

/**
 * Толщина полосы захвата, мм изделия.
 *
 * Пропорциональна изделию, а не постоянна. Постоянные 24 мм казались
 * разумными, пока не выяснилось на настоящей сцене: изделие целиком
 * вписано в кадр, поэтому масштаб обратно пропорционален его размеру, и
 * у шкафа 2000 мм полоса в 24 мм превращается в 5 пикселей. Попасть в
 * неё нельзя ни мышью, ни тем более пальцем — из семи проб по разным
 * координатам жест начинался ровно в одной.
 *
 * Доля от наибольшего габарита даёт примерно постоянный размер НА
 * ЭКРАНЕ при любом изделии, потому что камера вписывает именно этот
 * габарит. Нижняя граница нужна крошечным изделиям, верхняя — чтобы
 * ручка не съедала шкаф-купе целиком.
 */
export const MIN_GIZMO_GRIP: Mm = 24;
export const MAX_GIZMO_GRIP: Mm = 120;

export function gripFor(maxExtent: Mm): Mm {
  return Math.min(MAX_GIZMO_GRIP, Math.max(MIN_GIZMO_GRIP, maxExtent * 0.04));
}

/** Насколько ручка выступает за габарит изделия, мм. */
const GIZMO_OVERHANG: Mm = 12;

interface Bounds {
  readonly minX: Mm;
  readonly maxX: Mm;
  readonly minY: Mm;
  readonly maxY: Mm;
  readonly minZ: Mm;
  readonly maxZ: Mm;
}

const boundsOf = (geometry: GeometryResult): Bounds => geometry.boundingBox;

const center = (a: Mm, b: Mm): Mm => (a + b) / 2;
const span = (a: Mm, b: Mm): Mm => Math.max(b - a, 1);

/**
 * Ручки габарита изделия: правая грань и верхняя грань.
 *
 * Левая и нижняя не заводятся: начало координат — левый-нижний-задний
 * угол (`docs/COORDINATE_SYSTEM.md` §1), и потянуть за левую грань
 * означало бы сдвинуть начало координат, то есть переместить все детали
 * разом. Команды, которая это выражает, нет — и придумывать её ради
 * симметрии ручек было бы решением интерфейса, диктующим домену.
 */
function furnitureGizmos(bounds: Bounds, grip: Mm): SceneObject[] {
  const depth = span(bounds.minZ, bounds.maxZ);
  const height = span(bounds.minY, bounds.maxY);
  const width = span(bounds.minX, bounds.maxX);

  return [
    {
      id: 'gizmo:furniture-width',
      kind: 'gizmo',
      position: { x: bounds.maxX, y: center(bounds.minY, bounds.maxY), z: center(bounds.minZ, bounds.maxZ) },
      size: { x: grip, y: height + GIZMO_OVERHANG * 2, z: depth + GIZMO_OVERHANG * 2 },
      visible: true,
      selectable: true,
      label: 'Изменить ширину изделия',
      gizmo: { kind: 'furniture-width' },
    },
    {
      id: 'gizmo:furniture-height',
      kind: 'gizmo',
      position: { x: center(bounds.minX, bounds.maxX), y: bounds.maxY, z: center(bounds.minZ, bounds.maxZ) },
      size: { x: width + GIZMO_OVERHANG * 2, y: grip, z: depth + GIZMO_OVERHANG * 2 },
      visible: true,
      selectable: true,
      label: 'Изменить высоту изделия',
      gizmo: { kind: 'furniture-height' },
    },
  ];
}

/**
 * Ручки внутренних границ: между секциями и между рядами.
 *
 * Одна ручка ставится на КАЖДУЮ границу, кроме последней: последний
 * ребёнок деления не имеет собственной границы справа (сверху) — там уже
 * стенка корпуса, а его размер определяется остатком. Тянуть за неё
 * означало бы менять размер изделия, а для этого есть своя ручка.
 *
 * Ручка адресована id ребёнка СЛЕВА (СНИЗУ) от границы — того, чей
 * размер она увеличивает. Адресация по id, а не по индексу: индекс
 * сдвигается при добавлении соседа, и ручка начинает менять не ту секцию
 * (`docs/DATA_MODEL.md` §5.7, тот же довод, что и у `SetChildSize`).
 */
function splitGizmos(node: SectionNode, geometry: GeometryResult, bounds: Bounds, grip: Mm, out: SceneObject[]): void {
  if (!isSplit(node)) return;

  const boxes = new Map<NodeId, { min: Vec3; size: Vec3 }>();
  for (const cell of geometry.cells) boxes.set(cell.nodeId, cell.box);
  for (const section of geometry.sections) boxes.set(section.nodeId, section.box);

  const children = node.children;
  for (let i = 0; i < children.length - 1; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    const box = boxes.get(child.node.id);
    // Граница строится по уже посчитанной коробке ребёнка. Если движок
    // её не построил (например, деление ещё не раскладывается), ручки
    // просто нет: рисовать её «примерно там» — это выдуманная граница.
    if (box === undefined) continue;

    const depth = span(bounds.minZ, bounds.maxZ);
    const zCenter = center(bounds.minZ, bounds.maxZ);

    if (node.axis === 'x') {
      out.push({
        id: `gizmo:child-x:${child.node.id}`,
        kind: 'gizmo',
        parentId: node.id,
        position: { x: box.min.x + box.size.x, y: box.min.y + box.size.y / 2, z: zCenter },
        size: { x: grip, y: box.size.y, z: depth },
        visible: true,
        selectable: true,
        label: 'Изменить ширину секции',
        gizmo: { kind: 'child-size', childId: child.node.id, axis: 'x' },
      });
    } else {
      out.push({
        id: `gizmo:child-y:${child.node.id}`,
        kind: 'gizmo',
        parentId: node.id,
        position: { x: box.min.x + box.size.x / 2, y: box.min.y + box.size.y, z: zCenter },
        size: { x: box.size.x, y: grip, z: depth },
        visible: true,
        selectable: true,
        label: 'Изменить высоту ряда',
        gizmo: { kind: 'child-size', childId: child.node.id, axis: 'y' },
      });
    }
  }

  for (const child of children) splitGizmos(child.node, geometry, bounds, grip, out);
}

/**
 * Все ручки изделия.
 *
 * Отдельная функция, а не часть `buildScene`: слой взаимодействия
 * включается только в режиме редактирования и выключается, когда
 * пользователь просто рассматривает изделие. Смешивать его с моделью
 * сцены означало бы отдавать в отрисовку объекты, которые не мебель, и
 * при каждом обходе объяснять, что вот эти — не считаются.
 */
export function buildGizmos(furniture: Furniture, geometry: GeometryResult): readonly SceneObject[] {
  const bounds = boundsOf(geometry);
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return [];

  const grip = gripFor(Math.max(span(bounds.minX, bounds.maxX), span(bounds.minY, bounds.maxY)));
  const out: SceneObject[] = furnitureGizmos(bounds, grip);
  splitGizmos(furniture.root, geometry, bounds, grip, out);
  return out;
}

/** Сцена с включённым слоем ручек. Модель сцены при этом не меняется. */
export function withGizmos(scene: SceneModel, gizmos: readonly SceneObject[]): SceneModel {
  return gizmos.length === 0 ? scene : { ...scene, objects: [...scene.objects, ...gizmos] };
}

/** Текущее значение размера, которым управляет ручка. Читается из домена, не из сцены. */
export function gizmoBaseValue(target: GizmoTarget, furniture: Furniture, geometry: GeometryResult): Mm | undefined {
  if (target.kind === 'furniture-width') return furniture.dimensions.width;
  if (target.kind === 'furniture-height') return furniture.dimensions.height;

  const cell = geometry.cells.find((item) => item.nodeId === target.childId);
  const section = geometry.sections.find((item) => item.nodeId === target.childId);
  const box = cell?.box ?? section?.box;
  if (box === undefined) return undefined;
  return target.axis === 'x' ? box.size.x : box.size.y;
}
