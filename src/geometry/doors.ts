import type { CellBox } from './types.js';
import type { EdgeSpec, FacadeGroup, FacadeLeaf, HingeSide, MaterialId, Mm, NodeId } from '../domain/index.js';
import { resolveSizes, roundMm } from '../domain/index.js';

/**
 * Контракт двери: Cell + FacadeGroup → Part (PROMPT 10).
 *
 * ## Почему резолвер читает `FacadeGroup`, а не новый `DoorContent`
 *
 * PROMPT 10 §2 буквально просит `DoorContent`, привязанный к ячейке —
 * тот же приём, каким PROMPT 9 ввёл `Content` для полок/ящиков/штанги.
 * Здесь он не подходит: фасад в этой модели существует с ранних этапов
 * (`docs/DATA_MODEL.md` §7) и намеренно живёт ВНЕ ячейки — `Furniture.facades:
 * FacadeGroup[]` с полем `covers`, потому что одна дверь может закрывать
 * несколько ячеек сразу (`docs/GEOMETRY_RULES.md` §17.4). Завести рядом
 * `DoorContent { cellId, … }` означало бы второй способ описать ту же
 * дверь и два расходящихся источника истины — ровно то, от чего PROMPT 9
 * отказался для полок. Вместо этого этот модуль реализует резолвер для
 * УЖЕ существующего `FacadeGroup`, а не параллельную модель.
 *
 * `resolveDoorGeometry` намеренно решает только случай `covers.kind ===
 * 'node'`, указывающий на ОДИН лист дерева (ячейку) — базовый случай
 * PROMPT 10 §4/§6. Покрытие нескольких ячеек (`covers.kind === 'carcass'`
 * или узел-разделение) архитектурно предусмотрено полем `covers`, но
 * геометрия для него не реализована (см. `stages/facades.ts`), потому что
 * вычисление общего прямоугольника нескольких ячеек — отдельная задача,
 * не входящая в базовый случай этого PROMPT'а.
 */

/** Что резолвер смог сделать с фасадом. Тот же принцип явного статуса, что у `content.ts`. */
export type DoorStatus = 'built' | 'not-implemented' | 'invalid';

export interface DoorLeafGeometry {
  readonly leafId: NodeId;
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly thickness: Mm;
  readonly hingeSide: HingeSide;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
}

export interface DoorGeometryResolution {
  readonly facadeId: NodeId;
  readonly cellId: NodeId;
  readonly status: DoorStatus;
  readonly leaves: readonly DoorLeafGeometry[];
  /** Человекочитаемое «почему не построено» — только для `not-implemented`/`invalid`. */
  readonly missing?: string;
}

/** Верхняя граница числа створок, для которых ширина считается формулой этого этапа (PROMPT 10 §6/§7). */
const MAX_SUPPORTED_LEAVES = 2;

/**
 * Геометрия дверей одной ячейки из одного `FacadeGroup`, покрывающего её
 * целиком (`covers: {kind:'node', nodeId: cell.nodeId}`).
 *
 * Чистая функция: не читает часы, не обращается к DOM, не зависит от React
 * и не хранит состояния — одинаковый вход даёт одинаковый результат.
 * Координаты полностью выводятся из `cell.box`, накопленного этапом
 * `layout` (PROMPT 10 §15): дверь не хранит своих X/Y/Z как источник
 * истины и поэтому не может «отстать» от размера ячейки при resize.
 *
 * Формулы (`docs/GEOMETRY_RULES.md` §18):
 * - ширины створок делит `resolveSizes(leaves.map(l => l.size), available,
 *   gapBetweenLeaves)` — тот же алгоритм, что уже делит секции, ряды и
 *   колонки (`docs/GEOMETRY_RULES.md` §9.2), а зазор между створками играет
 *   ту же роль, что и толщина разделителя;
 * - `available = cell.box.size.x - 2·gapSide`;
 * - `height = cell.box.size.y - gapTop - gapBottom`, одна высота на все
 *   створки — вертикальный ряд из нескольких дверей не входит в базовый
 *   случай (PROMPT 10 §6);
 * - `thickness = thicknessOf(leaf)` — с PROMPT 13 вызывающая сторона
 *   (`stages/facades.ts`) вычисляет её через `resolveEffectiveMaterial`:
 *   `leaf.thickness ?? material.thickness ?? panelThickness`, тот же
 *   приоритет, что у `Shelf.thickness` (`docs/GEOMETRY_RULES.md` §9.4),
 *   но резолвер остаётся чистым и не импортирует `MaterialLibrary`
 *   напрямую — только принимает уже вычисленное число через callback;
 * - `z` — передняя плоскость ячейки (`cell.box.min.z + cell.box.size.z`):
 *   в системе координат этого проекта Z растёт от задней стенки к фасаду
 *   (`stages/carcass.ts`, `carcassZ0`/`carcassDepth`), поэтому дверь
 *   начинается на передней грани ячейки и уходит дальше вперёд на свою
 *   толщину, а не внутрь объёма ячейки — этим гарантируется отсутствие
 *   пересечения с любой деталью наполнения (§14): все они лежат внутри
 *   `cell.box`, а дверь — строго перед ним.
 *
 * Различие `overlay`/`inset` в этой версии не выражено отдельным членом
 * формулы: обе меры отсчитываются от `cell.box`, то есть от уже вычисленного
 * проёма. Собственно накладной перекрытие торца соседней панели (когда
 * дверь физически шире проёма) не реализовано — это отдельная нерешённая
 * часть T-DOOR-02, зарегистрированная отдельно как `T-DOOR-06`
 * (`docs/UNKNOWNS.json`), а не додуманное значение.
 */
export function resolveDoorGeometry(
  facade: FacadeGroup,
  cell: CellBox,
  thicknessOf: (leaf: FacadeLeaf) => Mm,
): DoorGeometryResolution {
  if (facade.type !== 'hinged') {
    // Купе/складные/подъёмные — модель есть (`FacadeType`), геометрии нет
    // (PROMPT 10 §9): явный статус вместо тихого пропуска, тот же принцип,
    // что у `content.ts` для ящиков и штанги.
    return {
      facadeId: facade.id,
      cellId: cell.nodeId,
      status: 'not-implemented',
      leaves: [],
      missing: `геометрия фасада типа «${facade.type}» не реализована`,
    };
  }

  const count = facade.leaves.length;
  if (count === 0) {
    return { facadeId: facade.id, cellId: cell.nodeId, status: 'invalid', leaves: [], missing: 'у фасада нет ни одной створки' };
  }
  if (count > MAX_SUPPORTED_LEAVES) {
    // Архитектура (`covers`/`leaves: FacadeLeaf[]`) не ограничивает число
    // створок, но формула деления ширины для >2 створок не подтверждена
    // (PROMPT 10 §7 просит готовность архитектуры, не формулу) — честный
    // `not-implemented`, а не подгонка под текущий алгоритм.
    return {
      facadeId: facade.id,
      cellId: cell.nodeId,
      status: 'not-implemented',
      leaves: [],
      missing: `${String(count)} створок в одной ячейке — формула ширины не подтверждена (поддержаны 1–${String(MAX_SUPPORTED_LEAVES)})`,
    };
  }

  const { gapSide, gapTop, gapBottom, gapBetweenLeaves } = facade.overlay;
  const available = roundMm(cell.box.size.x - 2 * gapSide);
  const height = roundMm(cell.box.size.y - gapTop - gapBottom);

  if (!(available > 0) || !(height > 0)) {
    return {
      facadeId: facade.id,
      cellId: cell.nodeId,
      status: 'invalid',
      leaves: [],
      missing: 'зазоры не оставляют места для двери в этой ячейке',
    };
  }

  const layout = resolveSizes(
    facade.leaves.map((leaf: FacadeLeaf) => leaf.size),
    available,
    gapBetweenLeaves,
  );

  if (layout.overconstrained || layout.underconstrained || layout.spans.some((span) => !(span.length > 0))) {
    return {
      facadeId: facade.id,
      cellId: cell.nodeId,
      status: 'invalid',
      leaves: [],
      missing: 'створки не помещаются в ширину ячейки с учётом зазоров',
    };
  }

  const z = roundMm(cell.box.min.z + cell.box.size.z);
  const y = roundMm(cell.box.min.y + gapBottom);

  const leaves: DoorLeafGeometry[] = facade.leaves.map((leaf, i) => {
    const span = layout.spans[i];
    const width = roundMm(span?.length ?? 0);
    const x = roundMm(cell.box.min.x + gapSide + (span?.offset ?? 0));
    const thickness = roundMm(thicknessOf(leaf));
    return {
      leafId: leaf.id,
      x,
      y,
      z,
      width,
      height,
      thickness,
      hingeSide: leaf.hingeSide,
      ...(leaf.materialId === undefined ? {} : { materialId: leaf.materialId }),
      ...(leaf.edge === undefined ? {} : { edge: leaf.edge }),
    };
  });

  return { facadeId: facade.id, cellId: cell.nodeId, status: 'built', leaves };
}
