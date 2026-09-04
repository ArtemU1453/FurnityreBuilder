import { boxCenter, formatMm } from '../domain/index.js';
import type { MaterialLibrary, NodeId, Vec3 } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import { sceneMaterialOf } from './materials.js';
import { EMPTY_SCENE } from './types.js';
import type { SceneModel, SceneObject } from './types.js';

/**
 * Адаптер сцены (PROMPT 23 §2–§3): `GeometryResult` → `SceneObject[]`.
 *
 * ## Здесь нет ни одной мебельной формулы
 *
 * Ни `width - thickness * 2`, ни «полка на 32 мм выше дна». Каждое число
 * приходит из уже посчитанной детали. Единственное арифметическое
 * действие во всём файле — перевод минимального угла в центр коробки, и
 * оно нужно потому, что домен хранит минимальный угол
 * (`docs/COORDINATE_SYSTEM.md` §2), а прямоугольный параллелепипед
 * рисуется от центра. Это преобразование системы координат, а не расчёт
 * мебели: изменение конструкции не меняет здесь ничего.
 *
 * ## Что попадает в сцену
 *
 * ВСЕ детали `GeometryResult.parts`, какими бы они ни были: корпус,
 * перегородки, полки, задняя стенка, цоколь, фасады, фасады ящиков,
 * ручки, механизмы push-to-open, фальшпанели, столешница. Списка ролей
 * здесь нет намеренно — список пришлось бы дополнять при каждом новом
 * виде детали, и рано или поздно кто-то забыл бы это сделать, а деталь
 * молча исчезла бы со сцены. Появилась деталь в движке — появилась на
 * экране (§5: «никаких визуальных деталей, которых нет в
 * `GeometryResult`», и обратное тоже верно).
 *
 * ## Ячейки и секции — не детали
 *
 * Ячейка физической деталью не является (§6), поэтому её коробка
 * попадает в сцену со `visible: false`: рисовать её постоянно значило бы
 * показать мебель, которой нет. Она нужна ради двух вещей — попадания
 * указателя и подсветки выбранного, — и рендерер показывает её только
 * когда она выбрана или под курсором. То же для секции.
 */

/** Порядок отрисовки: непрозрачное раньше прозрачного, иначе стекло «съедает» то, что за ним. */
function byOpacity(a: SceneObject, b: SceneObject): number {
  return (b.material?.opacity ?? 1) - (a.material?.opacity ?? 1);
}

/**
 * Модель сцены из результата геометрического движка.
 *
 * Чистая функция: одинаковый вход даёт одинаковый выход, и её результат
 * можно сравнить в тесте, не открывая браузер.
 */
export function buildScene(geometry: GeometryResult, materials: MaterialLibrary): SceneModel {
  const objects: SceneObject[] = [];

  for (const part of geometry.parts) {
    objects.push({
      id: part.id,
      kind: 'part',
      ...(part.origin.nodeId === undefined ? {} : { parentId: part.origin.nodeId }),
      // Центр вместо минимального угла — единственное преобразование
      // координат в файле. См. `docs/3D_COORDINATE_SYSTEM.md` §2.
      position: boxCenter({ min: part.position, size: part.size }),
      size: part.size,
      visible: true,
      selectable: true,
      label: part.label,
      role: part.role,
      material: sceneMaterialOf(materials, part.materialId),
    });
  }

  // Секция БЕЗ деления — это тот же узел дерева, что и ячейка внутри неё
  // (`docs/EDITOR_SELECTION.md` §2). Выдать оба объекта значило бы
  // положить в сцену два объекта с ОДНИМ идентификатором: поиск по id
  // возвращал бы то один, то другой, а луч выбора попадал бы в невидимую
  // секцию вместо ячейки. Побеждает ячейка — она конкретнее, и тот же
  // приоритет уже действует при разборе выделения (PROMPT 22 §5).
  const cellNodeIds = new Set(geometry.cells.map((cell) => cell.nodeId));

  for (const section of geometry.sections) {
    if (cellNodeIds.has(section.nodeId)) continue;
    objects.push({
      id: section.nodeId,
      kind: 'section',
      position: boxCenter(section.box),
      size: section.box.size,
      // Невидима по умолчанию: секция — область, а не деталь.
      visible: false,
      selectable: true,
      label: `Секция ${String(section.index + 1)}`,
    });
  }

  for (const cell of geometry.cells) {
    objects.push({
      id: cell.nodeId,
      kind: 'cell',
      parentId: cell.sectionId,
      position: boxCenter(cell.box),
      size: cell.box.size,
      visible: false,
      selectable: true,
      label: `Ячейка ${formatMm(cell.box.size.x)} × ${formatMm(cell.box.size.y)}`,
    });
  }

  objects.sort(byOpacity);

  return { objects, ...framing(geometry) };
}

/**
 * Центр и радиус охвата для камеры.
 *
 * Берётся ИЗМЕРЕННЫЙ охват движка (`boundingBox`), а не заявленный
 * габарит (`bounds`): столешница со свесом и ручка выступают за
 * номинальный габарит, и камера, вписывающая `bounds`, обрезала бы их.
 * Разница между этими двумя величинами описана в `src/geometry/types.ts`.
 */
function framing(geometry: GeometryResult): Omit<SceneModel, 'objects'> {
  const box = geometry.boundingBox;
  const size: Vec3 = { x: box.totalWidth, y: box.totalHeight, z: box.totalDepth };
  if (size.x <= 0 && size.y <= 0 && size.z <= 0) return { center: EMPTY_SCENE.center, size, radius: 0 };
  return {
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, z: (box.minZ + box.maxZ) / 2 },
    size,
    radius: Math.hypot(size.x, size.y, size.z) / 2,
  };
}

/** Объект сцены по идентификатору. */
export function findSceneObject(scene: SceneModel, id: string): SceneObject | undefined {
  return scene.objects.find((object) => object.id === id);
}

/**
 * Ячейки секции: нужны подсветке, когда выбрана секция целиком.
 *
 * Принадлежность берётся из `parentId`, который заполнен `cell.sectionId`
 * движком; заново «какая ячейка в какой секции» здесь не определяется —
 * это решает `sectionIdFor` в `stages/layout.ts`, и второго ответа быть
 * не должно.
 */
export function cellsOfSection(scene: SceneModel, sectionId: NodeId): readonly SceneObject[] {
  return scene.objects.filter((object) => object.kind === 'cell' && object.parentId === sectionId);
}
