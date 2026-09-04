import { formatMm } from '../domain/index.js';
import type { MaterialLibrary, Room, Vec3 } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import { footprintOf, instanceKey, roomFootprint, wallBox } from '../room/index.js';
import { buildScene } from './adapter.js';
import { sceneMaterialOf } from './materials.js';
import { EMPTY_SCENE, FALLBACK_MATERIAL } from './types.js';
import type { SceneModel, SceneObject } from './types.js';

/**
 * Сцена помещения (PROMPT 24 §21).
 *
 * ## Второго рендерера не появляется
 *
 * Комната собирается в ту же `SceneModel`, что и мебель, и рисуется тем
 * же рендерером (`src/render/gl/`). Стена, пол, потолок и препятствие —
 * это `SceneObject` наравне с боковиной шкафа: коробка, положение,
 * материал. Ничего специфически «комнатного» рендерер не знает.
 *
 * ## Мебель не пересобирается
 *
 * Экземпляр берёт УЖЕ ПОСТРОЕННУЮ сцену изделия (`buildScene`) и
 * переносит её объекты в координаты комнаты. Ни геометрия, ни материалы
 * при этом не считаются заново — поэтому один и тот же шкаф, стоящий в
 * комнате трижды, строится один раз.
 */

/** Префиксы идентификаторов: объект комнаты и объект внутри экземпляра. */
export const ROOM_PREFIX = {
  floor: 'room:floor',
  ceiling: 'room:ceiling',
  wall: 'room:wall:',
  opening: 'room:opening:',
  obstacle: 'room:obstacle:',
  instance: 'room:instance:',
} as const;

/** `room:instance:<instanceId>/<partId>` — из какого экземпляра объект. */
export function instanceIdOf(sceneObjectId: string): string | undefined {
  if (!sceneObjectId.startsWith(ROOM_PREFIX.instance)) return undefined;
  const rest = sceneObjectId.slice(ROOM_PREFIX.instance.length);
  const slash = rest.indexOf('/');
  return slash < 0 ? rest : rest.slice(0, slash);
}

export interface RoomSceneOptions {
  /**
   * Геометрия изделий, доступных комнате, по ключу «проект/изделие»
   * (`instanceKey`). Планировщик её не считает — получает готовой.
   */
  readonly geometries: ReadonlyMap<string, GeometryResult>;
  readonly materials: MaterialLibrary;
  /**
   * Стены полупрозрачны, чтобы видеть мебель внутри (§22).
   *
   * По умолчанию включено: комната, показанная сплошными стенами, при
   * взгляде снаружи выглядит коробкой, а именно снаружи её и
   * рассматривают.
   */
  readonly cutawayWalls?: boolean;
  /** Пол и потолок можно скрыть отдельно от стен. */
  readonly showFloor?: boolean;
}

/** Толщина плиты пола и потолка на сцене, мм. Только для отрисовки. */
const SLAB = 40;

function wallObject(room: Room, wallId: string, materials: MaterialLibrary, cutaway: boolean): SceneObject | undefined {
  const wall = room.walls.find((item) => item.id === wallId);
  if (wall === undefined) return undefined;
  const box = wallBox(wall, room.floor.elevation);
  if (box.size.x <= 0 || box.size.z <= 0) return undefined;

  const base = wall.materialId === undefined ? FALLBACK_MATERIAL : sceneMaterialOf(materials, wall.materialId);
  return {
    id: `${ROOM_PREFIX.wall}${wall.id}`,
    kind: 'part',
    position: { x: box.min.x + box.size.x / 2, y: box.min.y + box.size.y / 2, z: box.min.z + box.size.z / 2 },
    size: box.size,
    visible: true,
    selectable: true,
    label: `Стена ${formatMm(Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z))} мм`,
    // Полупрозрачность — режим просмотра, а не свойство стены: она не
    // хранится в модели и не попадает ни в один расчёт.
    material: cutaway ? { ...base, opacity: 0.18 } : base,
  };
}

/**
 * Проём как ВЫЧИТАНИЕ из стены не строится.
 *
 * Рендерер рисует коробки, и вырезать отверстие в коробке он не умеет;
 * заводить ради этого второй тип геометрии значило бы отказаться от
 * единственного куба, на котором держится вся производительность сцены
 * (`docs/3D_PERFORMANCE.md` §1). Поэтому проём показывается собственной
 * полупрозрачной вставкой в толще стены: видно, где он и какого размера,
 * без вычитания геометрии.
 */
function openingObject(room: Room, openingId: string): SceneObject | undefined {
  const opening = room.openings.find((item) => item.id === openingId);
  if (opening === undefined) return undefined;
  const wall = room.walls.find((item) => item.id === opening.wallId);
  if (wall === undefined) return undefined;

  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return undefined;

  const ux = dx / length;
  const uz = dz / length;
  const midpoint = opening.position + opening.width / 2;
  const centerX = wall.a.x + ux * midpoint;
  const centerZ = wall.a.z + uz * midpoint;

  // Полоса чуть толще стены, чтобы вставка не пряталась внутри неё.
  const thickness = wall.thickness + 2;
  const alongX = Math.abs(ux) > Math.abs(uz);

  return {
    id: `${ROOM_PREFIX.opening}${opening.id}`,
    kind: 'part',
    parentId: `${ROOM_PREFIX.wall}${wall.id}`,
    position: {
      x: centerX,
      y: room.floor.elevation + opening.sillHeight + opening.height / 2,
      z: centerZ,
    },
    size: alongX
      ? { x: opening.width, y: opening.height, z: thickness }
      : { x: thickness, y: opening.height, z: opening.width },
    visible: true,
    selectable: true,
    label: opening.kind === 'door' ? 'Дверной проём' : opening.kind === 'window' ? 'Окно' : 'Проём',
    material: { ...FALLBACK_MATERIAL, color: '#9fb4d0', opacity: 0.35, roughness: 0.2 },
  };
}

/**
 * Препятствия.
 *
 * Материал у них не из реестра: колонна и труба — часть здания, а не
 * изделия, и назначать им ЛДСП было бы ложью о том, из чего они
 * сделаны. Нейтральный серый честнее.
 */
function obstacleObjects(room: Room): SceneObject[] {
  return room.obstacles.map((obstacle) => {
    const print = footprintOf(obstacle.position, obstacle.size, obstacle.rotation);
    return {
      id: `${ROOM_PREFIX.obstacle}${obstacle.id}`,
      kind: 'part',
      position: {
        x: print.x + print.width / 2,
        y: obstacle.position.y + obstacle.size.y / 2,
        z: print.z + print.depth / 2,
      },
      size: { x: print.width, y: obstacle.size.y, z: print.depth },
      visible: true,
      selectable: true,
      label: obstacle.name ?? OBSTACLE_LABELS[obstacle.kind],
      material: { ...FALLBACK_MATERIAL, color: '#a89f92' },
    } satisfies SceneObject;
  });
}

const OBSTACLE_LABELS: Readonly<Record<Room['obstacles'][number]['kind'], string>> = {
  protrusion: 'Выступ стены',
  column: 'Колонна',
  pipe: 'Труба',
  radiator: 'Радиатор',
  other: 'Препятствие',
};

/**
 * Объекты одного экземпляра мебели в координатах комнаты.
 *
 * Поворот применяется к КАЖДОМУ объекту изделия вокруг центра его следа.
 * Поворота у `SceneObject` нет (см. `types.ts`), поэтому повёрнутая
 * деталь описывается своей описанной коробкой — то же приближение и с
 * той же оговоркой, что и в проверке размещения: ошибиться безопасно
 * можно только в сторону «больше».
 */
function instanceObjects(
  room: Room,
  instance: Room['furnitureInstances'][number],
  geometry: GeometryResult,
  furnitureScene: SceneModel,
): SceneObject[] {
  const extent: Vec3 = {
    x: geometry.boundingBox.totalWidth,
    y: geometry.boundingBox.totalHeight,
    z: geometry.boundingBox.totalDepth,
  };

  const cos = Math.cos(instance.rotation);
  const sin = Math.sin(instance.rotation);

  // Центр изделия в его собственных координатах и в координатах комнаты.
  const localCenterX = geometry.boundingBox.minX + extent.x / 2;
  const localCenterZ = geometry.boundingBox.minZ + extent.z / 2;
  const print = footprintOf(instance.position, extent, instance.rotation);
  const worldCenterX = print.x + print.width / 2;
  const worldCenterZ = print.z + print.depth / 2;

  const out: SceneObject[] = [];
  for (const object of furnitureScene.objects) {
    // Ячейки и секции экземпляра в комнату не переносятся: в
    // планировщике выбирают мебель целиком, а не полку внутри неё.
    if (object.kind !== 'part') continue;

    const dx = object.position.x - localCenterX;
    const dz = object.position.z - localCenterZ;
    const rotatedX = dx * cos - dz * sin;
    const rotatedZ = dx * sin + dz * cos;

    const sizeX = Math.abs(object.size.x * cos) + Math.abs(object.size.z * sin);
    const sizeZ = Math.abs(object.size.x * sin) + Math.abs(object.size.z * cos);

    out.push({
      ...object,
      id: `${ROOM_PREFIX.instance}${instance.id}/${object.id}`,
      parentId: `${ROOM_PREFIX.instance}${instance.id}`,
      position: {
        x: worldCenterX + rotatedX,
        y: object.position.y + instance.position.y + room.floor.elevation,
        z: worldCenterZ + rotatedZ,
      },
      size: { x: sizeX, y: object.size.y, z: sizeZ },
      visible: instance.visible,
      // Заблокированный экземпляр выбирать можно — нельзя двигать.
      selectable: instance.visible,
    });
  }
  return out;
}

/**
 * Сцена помещения со всей расставленной мебелью.
 *
 * Чистая функция: одинаковая комната и одинаковые геометрии дают
 * одинаковую сцену, и её можно сравнить в тесте без браузера.
 */
export function buildRoomScene(room: Room, options: RoomSceneOptions): SceneModel {
  const cutaway = options.cutawayWalls ?? true;
  const objects: SceneObject[] = [];
  const print = roomFootprint(room);

  if (print.width <= 0 || print.depth <= 0) return EMPTY_SCENE;

  if (options.showFloor !== false) {
    const floorMaterial =
      room.floor.materialId === undefined
        ? { ...FALLBACK_MATERIAL, color: '#cbc3b6' }
        : sceneMaterialOf(options.materials, room.floor.materialId);
    objects.push({
      id: ROOM_PREFIX.floor,
      kind: 'part',
      position: { x: print.x + print.width / 2, y: room.floor.elevation - SLAB / 2, z: print.z + print.depth / 2 },
      size: { x: print.width, y: SLAB, z: print.depth },
      visible: true,
      selectable: true,
      label: 'Пол',
      material: floorMaterial,
    });
  }

  if (room.ceiling.visible) {
    const ceilingMaterial =
      room.ceiling.materialId === undefined
        ? { ...FALLBACK_MATERIAL, color: '#e6e2db' }
        : sceneMaterialOf(options.materials, room.ceiling.materialId);
    objects.push({
      id: ROOM_PREFIX.ceiling,
      kind: 'part',
      position: {
        x: print.x + print.width / 2,
        y: room.floor.elevation + room.ceilingHeight + SLAB / 2,
        z: print.z + print.depth / 2,
      },
      size: { x: print.width, y: SLAB, z: print.depth },
      visible: true,
      selectable: true,
      label: 'Потолок',
      material: ceilingMaterial,
    });
  }

  for (const wall of room.walls) {
    const object = wallObject(room, wall.id, options.materials, cutaway);
    if (object !== undefined) objects.push(object);
  }

  for (const opening of room.openings) {
    const object = openingObject(room, opening.id);
    if (object !== undefined) objects.push(object);
  }

  objects.push(...obstacleObjects(room));

  // Сцена изделия строится ОДИН раз на изделие, а не на экземпляр: шкаф,
  // стоящий в комнате трижды, разбирается на детали единожды. Без этого
  // кэша обещание «мебель не пересобирается» было бы неправдой — и
  // именно так оно и было написано до первой проверки.
  const furnitureScenes = new Map<string, SceneModel>();
  for (const instance of room.furnitureInstances) {
    const key = instanceKey(instance);
    const geometry = options.geometries.get(key);
    // Геометрии нет — изделия в проекте нет. Рисовать «примерную
    // коробку» вместо него нельзя: пользователь принял бы её за мебель.
    // Об отсутствии сообщает `validateRoom`.
    if (geometry === undefined) continue;

    let furnitureScene = furnitureScenes.get(key);
    if (furnitureScene === undefined) {
      furnitureScene = buildScene(geometry, options.materials);
      furnitureScenes.set(key, furnitureScene);
    }
    objects.push(...instanceObjects(room, instance, geometry, furnitureScene));
  }

  // Непрозрачное раньше прозрачного — то же правило, что и в сцене
  // изделия: иначе стекло и полупрозрачные стены «съедают» то, что за ними.
  objects.sort((a, b) => (b.material?.opacity ?? 1) - (a.material?.opacity ?? 1));

  const height = room.ceilingHeight + SLAB;
  const size: Vec3 = { x: print.width, y: height, z: print.depth };
  return {
    objects,
    center: {
      x: print.x + print.width / 2,
      y: room.floor.elevation + height / 2,
      z: print.z + print.depth / 2,
    },
    size,
    radius: Math.hypot(size.x, size.y, size.z) / 2,
  };
}
