import type { HandlePlacement, Mm, NodeId, OpeningSystem } from '../domain/index.js';
import { roundMm } from '../domain/index.js';

/**
 * Контракт способа открывания: Facade + OpeningSystem → Part (PROMPT 12).
 *
 * ```
 * Cabinet → Cell → Content → Facade → Opening System → Hardware Parts
 * ```
 *
 * Ручка или push-to-open НЕ являются частью геометрии самого фасада —
 * они читают уже построенный объём фасада (дверного листа или фасада
 * ящика) и не хранят собственных мировых координат: `HandlePlacement`
 * несёт якорь и отступы, а не `x`/`y`. Резолвер здесь пурен и не знает,
 * фасад двери перед ним или фасад ящика — вызывающая сторона
 * (`stages/facades.ts`, `stages/fill.ts`) уже привела facade к единому
 * виду `{x,y,z,width,height,thickness}`, тому же, что возвращают
 * `resolveDoorGeometry`/`resolveDrawerFacadeGeometry`.
 *
 * ## Почему резолвер не знает про сторону петель
 *
 * PROMPT 12 §6 требует, чтобы положение ручки двери могло зависеть от
 * стороны открывания — но ЭТО решение принимается там, где создаётся
 * `HandlePlacement` (фабрика по умолчанию, `createHandleOpeningSystem`,
 * `src/domain/furniture/defaults.ts`), а не здесь: якорь/отступы уже
 * несут результат этого решения как обычные числа. Отдельный параметр
 * `hingeSide` в резолвере продублировал бы то же самое двумя разными
 * путями — эта функция остаётся чистой проекцией «фасад + положение →
 * геометрия», без доменной логики выбора стороны.
 *
 * ## Почему деталь, а не отдельный список в `GeometryResult`
 *
 * `GeometryContext` уже был спроектирован под это: комментарий в
 * `context.ts` при первом появлении `addPart`/`finish()` прямо говорит —
 * «наполнение, фасады и фурнитура (этапы 11+) шлют детали через тот же
 * addPart и получают эту защиту бесплатно». Ручка получает
 * `Part.role IN ('handle', 'push-to-open')` — те же роли, что уже
 * добавлены в `PartRole` — и идёт в `GeometryResult.parts` наравне
 * с фасадом, полкой, перегородкой: второго списка, второй валидации
 * и второго Geometry Engine не заводится (PROMPT 12 §25).
 */

export type OpeningStatus = 'none' | 'built' | 'invalid';

export interface OpeningGeometry {
  readonly id: NodeId;
  readonly role: 'handle' | 'push-to-open';
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly thickness: Mm;
}

export interface OpeningSystemResolution {
  readonly status: OpeningStatus;
  readonly items: readonly OpeningGeometry[];
  /** Человекочитаемое «почему не построено» — только для `invalid`. */
  readonly missing?: string;
}

/** Уже построенный объём фасада — дверного листа или фасада ящика (`DoorLeafGeometry`/`DrawerFacadeGeometry`). */
export interface FacadeBox {
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly thickness: Mm;
}

/** Поперечное сечение ручки-штанги (`bar`). `ASSUMPTION(T-HW-06)`. */
const BAR_CROSS_SECTION: Mm = 14;
/** Длина ручки-штанги по умолчанию, если `HandleSpec.lengthMm` не задан. `ASSUMPTION(T-HW-06)`. */
const DEFAULT_BAR_LENGTH: Mm = 128;
/** Габарит компактной ручки (`knob`/`profile`/`recessed`). `ASSUMPTION(T-HW-06)`. */
const KNOB_SIZE: Mm = 32;
/** Площадка механизма push-to-open. `ASSUMPTION(T-HW-07)`. */
const PUSH_LATCH_SIZE: Mm = 20;

function handleFootprint(kind: 'bar' | 'knob' | 'profile' | 'recessed', lengthMm: Mm | undefined, orientation: 'horizontal' | 'vertical'): { width: Mm; height: Mm } {
  if (kind !== 'bar') return { width: KNOB_SIZE, height: KNOB_SIZE };
  const length = lengthMm ?? DEFAULT_BAR_LENGTH;
  return orientation === 'vertical' ? { width: BAR_CROSS_SECTION, height: length } : { width: length, height: BAR_CROSS_SECTION };
}

/** `HandlePlacement` → положение левого-нижнего угла footprint внутри фасада. */
function placementOrigin(placement: HandlePlacement, facade: FacadeBox, footprint: { width: Mm; height: Mm }): { x: Mm; y: Mm } {
  const x =
    placement.side === 'right'
      ? facade.x + facade.width - placement.offsetX - footprint.width
      : placement.side === 'left'
        ? facade.x + placement.offsetX
        : facade.x + facade.width / 2 - footprint.width / 2 + placement.offsetX;
  const y =
    placement.anchor === 'top'
      ? facade.y + facade.height - placement.offsetY - footprint.height
      : placement.anchor === 'bottom'
        ? facade.y + placement.offsetY
        : facade.y + facade.height / 2 - footprint.height / 2 + placement.offsetY;
  return { x, y };
}

/** Внутри ли `[x, x+width] × [y, y+height]` границ фасада по X/Y. Z не проверяется: вынос вперёд — ожидаемое поведение, не выход за пределы. */
function withinFacadeXY(x: Mm, y: Mm, width: Mm, height: Mm, facade: FacadeBox): boolean {
  return x >= facade.x && x + width <= facade.x + facade.width + 1e-6 && y >= facade.y && y + height <= facade.y + facade.height + 1e-6;
}

/**
 * Геометрия способа открывания одного фасада.
 *
 * Чистая функция: не читает часы, не обращается к DOM, не зависит от React
 * и не хранит состояния — одинаковый вход даёт одинаковый результат.
 */
export function resolveOpeningSystemGeometry(opening: OpeningSystem, facade: FacadeBox): OpeningSystemResolution {
  if (opening.kind === 'none') {
    return { status: 'none', items: [] };
  }

  if (opening.kind === 'handle') {
    const footprint = handleFootprint(opening.handle.kind, opening.handle.lengthMm, opening.placement.orientation);
    const { x, y } = placementOrigin(opening.placement, facade, footprint);

    if (!(footprint.width > 0) || !(footprint.height > 0)) {
      return { status: 'invalid', items: [], missing: 'размеры ручки не положительны' };
    }
    if (!withinFacadeXY(x, y, footprint.width, footprint.height, facade)) {
      return { status: 'invalid', items: [], missing: 'ручка выходит за границы фасада' };
    }

    const thickness = opening.placement.offsetZ;
    if (!(thickness > 0)) {
      return { status: 'invalid', items: [], missing: 'вынос ручки от плоскости фасада не положителен' };
    }

    return {
      status: 'built',
      items: [
        {
          id: opening.id,
          role: 'handle',
          x: roundMm(x),
          y: roundMm(y),
          z: roundMm(facade.z + facade.thickness),
          width: roundMm(footprint.width),
          height: roundMm(footprint.height),
          thickness: roundMm(thickness),
        },
      ],
    };
  }

  // opening.kind === 'push-to-open'
  const { position, clearance } = opening.pushToOpen;
  const footprint = { width: PUSH_LATCH_SIZE, height: PUSH_LATCH_SIZE };
  const { x, y } = placementOrigin(position, facade, footprint);

  if (!withinFacadeXY(x, y, footprint.width, footprint.height, facade)) {
    return { status: 'invalid', items: [], missing: 'механизм push-to-open выходит за границы фасада' };
  }
  if (!(clearance > 0)) {
    return { status: 'invalid', items: [], missing: 'зазор срабатывания push-to-open не положителен' };
  }

  return {
    status: 'built',
    items: [
      {
        id: opening.id,
        role: 'push-to-open',
        x: roundMm(x),
        y: roundMm(y),
        z: roundMm(facade.z + facade.thickness),
        width: roundMm(footprint.width),
        height: roundMm(footprint.height),
        thickness: roundMm(clearance),
      },
    ],
  };
}
