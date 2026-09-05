import { formatMm } from '../domain/index.js';
import type { DrillFace, DrillPurpose, EdgeSpec, Grain, Mm } from '../domain/index.js';
import type { DrillingOperation } from '../drilling/index.js';
import type { PartBOMItem } from '../bom/index.js';

/**
 * Модель технического чертежа детали (PROMPT 29 §10–§14).
 *
 * ## Почему в слое экспорта, а не в рендерере
 *
 * Чертёж на экране и чертёж в PDF — один и тот же чертёж (§14). Слой
 * `export` — это уже «расчёт → данные документа», и модель чертежа
 * принадлежит именно ему: она не рисует, а описывает, что нарисовать.
 * `render` берёт её отсюда и превращает в svg, `pdf.ts` — в страницу.
 * Держать её в `render` было бы нельзя: экспорт рендерер не видит и
 * видеть не должен, и тогда систем чертежей стало бы две.
 *
 * ## Формул производства здесь нет ни одной
 *
 * Всё приходит готовым: размеры — из `PartBOMItem` (снимок
 * `ProductionPart`), отверстия — из `DrillingOperation` как их посчитал
 * Drilling Engine. Модуль только раскладывает готовые числа по контуру,
 * выноскам и подписям. Тот же принцип, что у `buildDebugView` и
 * `buildCuttingView`: рендерер не знает мебельных формул.
 *
 * ## Система координат не новая
 *
 * Чертёж рисует ПЛАСТЬ детали — грани `top` и `bottom`, — и координаты
 * отверстий берёт как есть: `DrillingOperation.x` и `.y` уже заданы в
 * системе грани, от её минимального угла, где x идёт вдоль длины, а y
 * вдоль ширины (`faces.ts`, `docs/DRILLING_RULES.md`).
 * Единственное преобразование — инверсия оси Y: раскладка считает Y
 * вверх, экран рисует вниз. Заводить третью систему координат ради
 * картинки означало бы третий источник истины о том, где отверстие.
 *
 * Отверстия в торцах (`left`, `right`, `front`, `back`) на пласти
 * показать нельзя — их там физически нет. Они выносятся отдельным
 * списком с той стороной, к которой относятся: соврать про их положение
 * хуже, чем показать их отдельно.
 *
 * ## Один чертёж на экран и на PDF
 *
 * Эта же модель используется экспортом (`export/pdf.ts`), поэтому
 * чертёж на экране и чертёж в документе — одна и та же геометрия, а не
 * две независимые системы (§14).
 *
 * ## Округление централизовано
 *
 * Числа выводятся через `formatMm` — тот же формат, что везде в
 * приложении. Своего округления здесь нет (§12).
 */

/** Отверстие на пласти: то, что можно нарисовать на контуре. */
export interface DrawingHole {
  readonly id: string;
  /** Производственная деталь, которой принадлежит отверстие. */
  readonly productionPartId: string;
  /** Центр в координатах грани, мм от левого-нижнего угла пласти. */
  readonly x: Mm;
  readonly y: Mm;
  readonly diameter: Mm;
  readonly depth: Mm;
  readonly purpose: DrillPurpose;
  readonly through: string;
  /** Подпись для человека: диаметр, глубина, назначение. */
  readonly label: string;
  /** Правило, породившее отверстие: начало трассируемости (§18). */
  readonly ruleId: string;
  readonly reason: string;
}

/** Отверстие в торце: на пласти его нет, поэтому оно выносится списком. */
export interface DrawingEdgeHole extends DrawingHole {
  readonly face: DrillFace;
  readonly faceLabel: string;
}

/** Выносной размер: что меряем, откуда и сколько получилось. */
export interface DrawingDimension {
  readonly id: string;
  readonly kind: 'length' | 'width' | 'hole-x' | 'hole-y';
  /** Начало и конец размерной линии в координатах чертежа (мм). */
  readonly from: { readonly x: Mm; readonly y: Mm };
  readonly to: { readonly x: Mm; readonly y: Mm };
  readonly value: Mm;
  readonly label: string;
}

/** Кромка на стороне контура: показывается полосой вдоль этой стороны. */
export interface DrawingEdge {
  readonly side: 'front' | 'back' | 'left' | 'right';
  readonly sideLabel: string;
  readonly thickness: Mm;
}

export interface PartDrawingView {
  /** Идентификатор ПОЗИЦИИ деталировки (`PartBOMItem.id`). */
  readonly partId: string;
  /**
   * Производственные детали позиции.
   *
   * Обычно одна. Больше одной — когда деталировка свела в одну строку
   * детали разных ролей с одинаковыми производственными свойствами
   * (например стационарную и съёмную полку одного размера): у них
   * совпадает всё, кроме присадки, и тогда на чертеже видны отверстия
   * обеих, каждое со своей деталью-владельцем.
   */
  readonly productionPartIds: readonly string[];
  readonly name: string;
  /** Габарит контура: длина по X, ширина по Y. */
  readonly length: Mm;
  readonly width: Mm;
  readonly thickness: Mm;
  readonly quantity: number;
  readonly materialName: string;
  readonly grain: Grain;
  /** Куда идёт текстура на чертеже. `undefined` — текстуры нет. */
  readonly grainLabel: string | undefined;
  readonly edges: readonly DrawingEdge[];
  readonly holes: readonly DrawingHole[];
  readonly edgeHoles: readonly DrawingEdgeHole[];
  readonly dimensions: readonly DrawingDimension[];
  /** Заголовок с размерами и материалом — одной строкой. */
  readonly title: string;
  /**
   * Текстовое описание чертежа целиком: доступная альтернатива картинке
   * (§42). Не подпись «схема детали», а те же данные словами.
   */
  readonly description: string;
}

const PURPOSE_LABELS: Readonly<Record<DrillPurpose, string>> = {
  'confirmat-face': 'конфирмат, пласть',
  'confirmat-end': 'конфирмат, торец',
  'shelf-support': 'полкодержатель',
  'hinge-cup': 'чашка петли',
  'hinge-plate': 'ответная планка петли',
  slide: 'направляющая',
  handle: 'ручка',
  dowel: 'шкант',
  eccentric: 'эксцентрик',
};

/**
 * Имена граней — те же, что в `faces.ts`, а не «как выглядит на экране».
 *
 * Пласти в этой модели — `top` и `bottom`: у детали, как она стоит в
 * изделии, это её большие поверхности независимо от ориентации панели.
 * `left`/`right` — торцы по длине, `front`/`back` — торцы по ширине.
 */
const FACE_LABELS: Readonly<Record<DrillFace, string>> = {
  top: 'пласть сверху',
  bottom: 'пласть снизу',
  left: 'торец слева',
  right: 'торец справа',
  front: 'торец спереди',
  back: 'торец сзади',
};

const EDGE_LABELS: Readonly<Record<DrawingEdge['side'], string>> = {
  front: 'спереди',
  back: 'сзади',
  left: 'слева',
  right: 'справа',
};

const GRAIN_LABELS: Readonly<Record<Grain, string | undefined>> = {
  'along-length': 'вдоль длины',
  'along-width': 'вдоль ширины',
  none: undefined,
};

/**
 * Пласти: только на них отверстие видно на контуре чертежа.
 *
 * Это `top`/`bottom`, а НЕ `front`/`back`: см. `faceFrame` в
 * `drilling/faces.ts` — у пластей extent идёт по длине и ширине детали, а
 * у `front`/`back` вторая координата — толщина.
 */
const FLAT_FACES: ReadonlySet<DrillFace> = new Set<DrillFace>(['top', 'bottom']);

function holeLabel(operation: DrillingOperation): string {
  const through = operation.through === 'through' ? 'насквозь' : 'глухое';
  return `⌀${formatMm(operation.diameter)} · ${formatMm(operation.depth)} мм · ${through} · ${PURPOSE_LABELS[operation.purpose]}`;
}

function toHole(operation: DrillingOperation): DrawingHole {
  return {
    id: operation.id,
    productionPartId: operation.productionPartId,
    x: operation.x,
    y: operation.y,
    diameter: operation.diameter,
    depth: operation.depth,
    purpose: operation.purpose,
    through: operation.through,
    label: holeLabel(operation),
    ruleId: operation.ruleId,
    reason: operation.reason,
  };
}

function edgesOf(edge: EdgeSpec): DrawingEdge[] {
  const sides: DrawingEdge['side'][] = ['front', 'back', 'left', 'right'];
  return sides
    .map((side) => ({ side, sideLabel: EDGE_LABELS[side], thickness: edge[side] }))
    .filter((item) => item.thickness > 0);
}

/**
 * Выносные размеры (§12).
 *
 * Габариты — всегда. Расстояния до отверстий — только по одной оси на
 * отверстие и только для отверстий на пласти: размерная сетка из
 * семидесяти линий читается хуже, чем её отсутствие, а расстояние по
 * второй оси видно на самом чертеже. Толщина в размерную сетку не
 * выносится: у чертежа пласти нет проекции, где она была бы отрезком, —
 * она в заголовке.
 */
function dimensionsOf(length: Mm, width: Mm, holes: readonly DrawingHole[]): DrawingDimension[] {
  const out: DrawingDimension[] = [
    {
      id: 'dim-length',
      kind: 'length',
      from: { x: 0, y: 0 },
      to: { x: length, y: 0 },
      value: length,
      label: `${formatMm(length)} мм`,
    },
    {
      id: 'dim-width',
      kind: 'width',
      from: { x: 0, y: 0 },
      to: { x: 0, y: width },
      value: width,
      label: `${formatMm(width)} мм`,
    },
  ];

  for (const hole of holes) {
    out.push({
      id: `dim-x-${hole.id}`,
      kind: 'hole-x',
      from: { x: 0, y: hole.y },
      to: { x: hole.x, y: hole.y },
      value: hole.x,
      label: `${formatMm(hole.x)} мм`,
    });
    out.push({
      id: `dim-y-${hole.id}`,
      kind: 'hole-y',
      from: { x: hole.x, y: 0 },
      to: { x: hole.x, y: hole.y },
      value: hole.y,
      label: `${formatMm(hole.y)} мм`,
    });
  }

  return out;
}

function describe(view: Omit<PartDrawingView, 'description'>): string {
  const parts: string[] = [
    `Чертёж детали «${view.name}».`,
    `Габарит ${formatMm(view.length)} × ${formatMm(view.width)} × ${formatMm(view.thickness)} мм, ${String(view.quantity)} шт, материал ${view.materialName}.`,
  ];
  parts.push(
    view.grainLabel === undefined ? 'Текстуры нет.' : `Направление текстуры: ${view.grainLabel}.`,
  );
  parts.push(
    view.edges.length === 0
      ? 'Кромки нет.'
      : `Кромка: ${view.edges.map((e) => `${e.sideLabel} ${formatMm(e.thickness)} мм`).join(', ')}.`,
  );
  if (view.holes.length === 0 && view.edgeHoles.length === 0) {
    parts.push('Отверстий не рассчитано.');
  } else {
    parts.push(`Отверстий на пласти: ${String(view.holes.length)}.`);
    for (const hole of view.holes) {
      parts.push(`${hole.label}, X ${formatMm(hole.x)}, Y ${formatMm(hole.y)} мм.`);
    }
    if (view.edgeHoles.length > 0) {
      parts.push(`Отверстий в торцах: ${String(view.edgeHoles.length)}.`);
      for (const hole of view.edgeHoles) {
        parts.push(
          `${hole.faceLabel}: ${hole.label}, X ${formatMm(hole.x)}, Y ${formatMm(hole.y)} мм.`,
        );
      }
    }
  }
  return parts.join(' ');
}

/**
 * Чертёж одной позиции деталировки.
 *
 * `operations` — операции ИМЕННО этой позиции: их даёт
 * `DrillingPlan.byProductionPart`, и выбирать их здесь заново не нужно.
 */
export function buildPartDrawing(
  item: PartBOMItem,
  operations: readonly DrillingOperation[],
): PartDrawingView {
  const flat = operations.filter((op) => FLAT_FACES.has(op.face));
  const holes = flat.map(toHole);
  const edgeHoles: DrawingEdgeHole[] = operations
    .filter((op) => !FLAT_FACES.has(op.face))
    .map((op) => ({ ...toHole(op), face: op.face, faceLabel: FACE_LABELS[op.face] }));

  const base: Omit<PartDrawingView, 'description'> = {
    partId: item.id,
    productionPartIds: item.productionPartIds,
    name: item.name,
    length: item.length,
    width: item.width,
    thickness: item.thickness,
    quantity: item.quantity,
    materialName: item.materialName,
    grain: item.grainDirection,
    grainLabel: GRAIN_LABELS[item.grainDirection],
    edges: edgesOf(item.edgeBanding),
    holes,
    edgeHoles,
    dimensions: dimensionsOf(item.length, item.width, holes),
    title: `${item.name} · ${formatMm(item.length)} × ${formatMm(item.width)} × ${formatMm(item.thickness)} мм · ${item.materialName} · ${String(item.quantity)} шт`,
  };

  return { ...base, description: describe(base) };
}

/**
 * Операции присадки, относящиеся к позиции деталировки.
 *
 * `DrillingPlan.byProductionPart` ключуется идентификатором
 * ПРОИЗВОДСТВЕННОЙ детали (`pp:…`), а у позиции деталировки
 * идентификатор свой (`bom:…`) — это разные сущности, и одно за другое
 * принимать нельзя. Позиция знает свои производственные детали
 * (`productionPartIds`), и операции собираются по ним.
 *
 * До PROMPT 29 поиск шёл по `item.id`, то есть не находил ничего
 * никогда: страницы чертежей в PDF не появлялись вовсе, потому что
 * фильтр «есть отверстия» не пропускал ни одной позиции.
 */
export function operationsOfItem(
  item: PartBOMItem,
  byProductionPart: ReadonlyMap<string, readonly DrillingOperation[]>,
): readonly DrillingOperation[] {
  return item.productionPartIds.flatMap((id) => byProductionPart.get(id) ?? []);
}

/** Чертежи всех позиций деталировки в порядке спецификации. */
export function buildPartDrawings(
  items: readonly PartBOMItem[],
  byProductionPart: ReadonlyMap<string, readonly DrillingOperation[]>,
): readonly PartDrawingView[] {
  return items.map((item) => buildPartDrawing(item, operationsOfItem(item, byProductionPart)));
}
