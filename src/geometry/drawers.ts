import type { CellBox } from './types.js';
import type { Drawer, EdgeSpec, MaterialId, Mm, NodeId, OverlaySpec } from '../domain/index.js';
import { DEFAULT_OVERLAY, resolveSizes, roundMm } from '../domain/index.js';

/**
 * Контракт фасада ящика: Cell + Drawer[] → Part (PROMPT 11).
 *
 * ## Почему `Drawer[]` внутри `LeafFill`, а не отдельная модель
 *
 * В отличие от двери (`docs/geometry/doors.ts`), ящик НЕ нуждался в
 * отдельной модели вне ячейки: `LeafFill.kind === 'drawers'` существовал
 * с PROMPT 1 (`docs/DATA_MODEL.md` §5.5) — один ящик физически не может
 * обслуживать несколько ячеек сразу, поэтому структурная вложенность
 * (наполнение лежит ВНУТРИ ячейки) здесь корректна с самого начала, и
 * заводить `DrawerContent { cellId, … }` рядом с уже существующим `Drawer`
 * значило бы завести второй способ описать то же самое (тот же довод,
 * которым PROMPT 9 отклонил отдельный тип `Content` для полок). Резолвер
 * в этом файле — та же роль, что у `doors.ts`: превращает уже
 * существующую модель в геометрию, а не изобретает новую модель.
 *
 * ## Фасад — да, короб — нет
 *
 * Реализована только геометрия ФАСАДА ящика: `DrawerFacadeSpec` описывает
 * материал/кромку/толщину/зазоры полностью, а сборка короба (боковины,
 * дно, передняя и задняя стенки короба) требует схемы, которую референс
 * не подтвердил (`T-DRW-02`: тип направляющих, материал и монтаж дна —
 * `unknown`). Строить пять деталей короба наугад значило бы придумать
 * конструкцию (PROMPT 11 §7 явно это запрещает: «если конструкция ещё не
 * подтверждена — NOT_IMPLEMENTED и не придумывать»). Короб остаётся
 * `not-implemented`, о чём `stages/fill.ts` сообщает диагностикой
 * `DRAWER_BOX_NOT_IMPLEMENTED` — тот же явный статус, что PROMPT 9 ввёл
 * для самих ящиков и штанги, до того как этот файл появился.
 */

export type DrawerFacadeStatus = 'built' | 'invalid';

export interface DrawerFacadeGeometry {
  readonly drawerId: NodeId;
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly thickness: Mm;
  readonly materialId?: MaterialId;
  readonly edge?: EdgeSpec;
}

export interface DrawerFacadeGeometryResolution {
  readonly cellId: NodeId;
  readonly status: DrawerFacadeStatus;
  readonly facades: readonly DrawerFacadeGeometry[];
  /** Человекочитаемое «почему не построено» — только для `invalid`. */
  readonly missing?: string;
}

/**
 * Геометрия фасадов ящиков одной ячейки.
 *
 * Чистая функция: не читает часы, не обращается к DOM, не зависит от React,
 * не хранит состояния — одинаковый вход даёт одинаковый результат.
 * Координаты полностью выводятся из `cell.box` (PROMPT 11 §16: изменение
 * W/H/D/ширины секции/высоты ряда/числа секций пересчитывает ящик, потому
 * что ничего, кроме `cell.box` и самого `Drawer[]`, не читается).
 *
 * Формулы (`docs/GEOMETRY_RULES.md`, новый раздел «ЯЩИКИ И ФАСАДЫ ЯЩИКОВ»):
 * - высоты фасадов делит `resolveSizes(drawers.map(d => d.size), available,
 *   gapBetween)` — ТОТ ЖЕ алгоритм, что делит секции/ряды/колонки и створки
 *   двери (`docs/GEOMETRY_RULES.md` §9.2, §18.3), только вдоль оси Y
 *   (ящики стоят один над другим), а не X;
 * - `available = cell.box.size.y - gapTop - gapBottom`;
 * - `facadeWidth = cell.box.size.x - 2·gapSide` — одна ширина на все
 *   фасады стопки, вертикальный ряд не делится по X;
 * - зазоры — `Drawer.facade.overlay` ПЕРВОГО ящика стопки, если он задан,
 *   иначе `DEFAULT_OVERLAY` (`ASSUMPTION T-DRW-04` — второй тип зазоров
 *   для ящиков не заводится, переиспользован тот же `OverlaySpec`, что
 *   и у дверей);
 * - `thickness = thicknessOf(drawer)` — с PROMPT 13 вызывающая сторона
 *   (`stages/fill.ts`) вычисляет её через `resolveEffectiveMaterial`:
 *   `drawer.facade.thickness ?? material.thickness ?? panelThickness`, а
 *   не голый `drawer.facade.thickness ?? panelThickness`, как было раньше —
 *   резолвер остаётся чистым и не импортирует `MaterialLibrary` напрямую,
 *   только принимает уже вычисленное число через callback (PROMPT 13 §9);
 * - `z` — передняя грань ячейки, та же формула и то же обоснование
 *   отсутствия пересечений с наполнением, что у двери (§18.3): фасад
 *   ящика начинается ровно на границе `cell.box` и уходит только вперёд.
 *
 * Количество ящиков в ячейке НЕ ограничено искусственно (`ASSUMPTION
 * T-DRW-05` — реального верхнего порога референс не подтвердил):
 * единственная граница — помещаются ли фасады по высоте, и её уже
 * проверяет `resolveSizes` (`overconstrained`/`underconstrained`).
 */
export function resolveDrawerFacadeGeometry(
  drawers: readonly Drawer[],
  cell: CellBox,
  thicknessOf: (drawer: Drawer) => Mm,
): DrawerFacadeGeometryResolution {
  if (drawers.length === 0) {
    return { cellId: cell.nodeId, status: 'built', facades: [] };
  }

  const overlay: OverlaySpec = drawers[0]?.facade.overlay ?? DEFAULT_OVERLAY;
  const { gapSide, gapTop, gapBottom, gapBetweenLeaves: gapBetween } = overlay;

  const facadeWidth = roundMm(cell.box.size.x - 2 * gapSide);
  const available = roundMm(cell.box.size.y - gapTop - gapBottom);

  if (!(facadeWidth > 0) || !(available > 0)) {
    return {
      cellId: cell.nodeId,
      status: 'invalid',
      facades: [],
      missing: 'зазоры не оставляют места для фасада ящика в этой ячейке',
    };
  }

  const layout = resolveSizes(
    drawers.map((drawer) => drawer.size),
    available,
    gapBetween,
  );

  if (layout.overconstrained || layout.underconstrained || layout.spans.some((span) => !(span.length > 0))) {
    return {
      cellId: cell.nodeId,
      status: 'invalid',
      facades: [],
      missing: 'фасады ящиков не помещаются в высоту ячейки с учётом зазоров',
    };
  }

  const x = roundMm(cell.box.min.x + gapSide);
  const z = roundMm(cell.box.min.z + cell.box.size.z);

  // Порядок массива — порядок офсетов `resolveSizes`, БЕЗ переворота:
  // `drawers[0]` получает наименьший Y (нижний ящик), `drawers[i]` для
  // `i` побольше — более верхний. Та же конвенция, что уже действует
  // для `Shelf.placement.index` в `stages/fill.ts` (`planAutoShelves`,
  // `dividerOffset(spans, i)` без переворота) — не вводится вторая.
  const facades: DrawerFacadeGeometry[] = drawers.map((drawer, i) => {
    const span = layout.spans[i];
    const height = roundMm(span?.length ?? 0);
    const y = roundMm(cell.box.min.y + gapBottom + (span?.offset ?? 0));
    const thickness = roundMm(thicknessOf(drawer));
    return {
      drawerId: drawer.id,
      x,
      y,
      z,
      width: facadeWidth,
      height,
      thickness,
      ...(drawer.facade.materialId === undefined ? {} : { materialId: drawer.facade.materialId }),
      ...(drawer.facade.edge === undefined ? {} : { edge: drawer.facade.edge }),
    };
  });

  return { cellId: cell.nodeId, status: 'built', facades };
}
