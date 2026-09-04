import type { IdFactory, MaterialId, Mm, Vec3 } from '../index.js';
import type {
  Ceiling,
  Floor,
  Furniture,
  FurnitureInstance,
  Obstacle,
  ObstacleKind,
  Opening,
  OpeningKind,
  Room,
  Wall,
} from '../index.js';

/**
 * Фабрики помещения (PROMPT 24 §25).
 *
 * ## Прямоугольная комната строится, произвольная — выражается
 *
 * Модель стен (список отрезков) описывает любой контур: ниши, выступы,
 * непрямые углы. Инструмента рисования произвольного контура на этом
 * этапе нет, и заводить его «на всякий случай» задание прямо запрещает
 * (§5: «не создавать сложную геометрию без необходимости»). Поэтому
 * здесь одна фабрика — прямоугольник, — а модель остаётся готовой к
 * остальному.
 *
 * ## Высота потолка живёт в одном месте
 *
 * `Room.ceilingHeight` — единственная высота помещения. Стены получают
 * ту же величину, а не свою собственную: стена ниже потолка это уже
 * перегородка, и когда такой случай понадобится, он будет вводиться
 * осознанно, а не как расхождение двух полей.
 */

/** Толщина стены по умолчанию: несущая перегородка. `ASSUMPTION(T-PLAN-01)`. */
export const DEFAULT_WALL_THICKNESS: Mm = 100;
/** Высота потолка по умолчанию. `ASSUMPTION(T-PLAN-01)`. */
export const DEFAULT_CEILING_HEIGHT: Mm = 2700;

export interface RectangularRoomOptions {
  readonly ids: IdFactory;
  readonly width: Mm;
  readonly depth: Mm;
  readonly height?: Mm;
  readonly wallThickness?: Mm;
  readonly name?: string;
  readonly floorMaterialId?: MaterialId;
  readonly wallMaterialId?: MaterialId;
}

/**
 * Прямоугольная комната из четырёх стен.
 *
 * Внутренний контур начинается в начале координат: точка (0, 0) — это
 * левый ближний к задней стене угол СВОБОДНОГО пространства, а стены
 * стоят снаружи него. Так координаты мебели в комнате совпадают с
 * привычным «от левого угла», и шкаф, поставленный в (0, 0), стоит
 * вплотную к стенам, а не внутри них.
 *
 * Обход по часовой стрелке, если смотреть сверху: задняя (вдоль X при
 * z = 0), правая, передняя, левая. Порядок фиксирован, чтобы «первая
 * стена» означала одно и то же во всех проектах.
 */
export function createRectangularRoom(options: RectangularRoomOptions): Room {
  const { ids } = options;
  const width = options.width;
  const depth = options.depth;
  const height = options.height ?? DEFAULT_CEILING_HEIGHT;
  const thickness = options.wallThickness ?? DEFAULT_WALL_THICKNESS;
  const material = options.wallMaterialId;

  const wall = (ax: Mm, az: Mm, bx: Mm, bz: Mm): Wall => ({
    id: ids.next<'Wall'>(),
    a: { x: ax, z: az },
    b: { x: bx, z: bz },
    thickness,
    height,
    ...(material === undefined ? {} : { materialId: material }),
  });

  return {
    id: ids.next<'Room'>(),
    name: options.name ?? 'Помещение',
    walls: [
      wall(0, 0, width, 0),
      wall(width, 0, width, depth),
      wall(width, depth, 0, depth),
      wall(0, depth, 0, 0),
    ],
    ceilingHeight: height,
    floor: {
      elevation: 0,
      ...(options.floorMaterialId === undefined ? {} : { materialId: options.floorMaterialId }),
    },
    // Потолок по умолчанию скрыт: иначе он закрывает вид на комнату
    // сверху, а именно сверху её и рассматривают чаще всего.
    ceiling: { visible: false },
    openings: [],
    obstacles: [],
    furnitureInstances: [],
  };
}

/** Экземпляр мебели в комнате. Ссылка и положение — больше ничего. */
export function createFurnitureInstance(
  ids: IdFactory,
  furniture: Furniture,
  position: Vec3 = { x: 0, y: 0, z: 0 },
  rotation = 0,
): FurnitureInstance {
  return {
    id: ids.next<'Instance'>(),
    furnitureId: furniture.id,
    position,
    rotation,
    locked: false,
    visible: true,
  };
}

export function createOpening(
  ids: IdFactory,
  wallId: Wall['id'],
  kind: OpeningKind,
  position: Mm,
  width: Mm,
  height: Mm,
  sillHeight: Mm,
): Opening {
  return { id: ids.next<'Opening'>(), wallId, kind, position, width, height, sillHeight };
}

export function createObstacle(
  ids: IdFactory,
  kind: ObstacleKind,
  position: Vec3,
  size: Vec3,
  rotation = 0,
): Obstacle {
  return { id: ids.next<'Obstacle'>(), kind, position, size, rotation };
}

export const DEFAULT_FLOOR: Floor = { elevation: 0 };
export const DEFAULT_CEILING: Ceiling = { visible: false };
