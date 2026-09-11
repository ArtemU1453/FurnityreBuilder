import type { EdgeSpec, Grain, MaterialKind } from './materials/types.js';
import type { HardwareKind, HardwareUnit } from './hardware/types.js';
import type { ObstacleKind } from './project/types.js';
import type { DrillFace, DrillPurpose, PartRole } from './part/types.js';
import type { BackPanelMount, BaseSpec, SlideType } from './furniture/types.js';

/**
 * Словарь: машинное значение → слово для человека.
 *
 * ## Почему он в домене, а не в интерфейсе
 *
 * Заведён он был в `src/app/vocabulary.ts` (PROMPT 58) и починил язык
 * КОНСТРУКТОРА. Производственный раздел он не починил и не мог:
 * `boundaries/element-types` не пускает `export` в слой `app`, а
 * значит PDF и XLSX словарём из интерфейса пользоваться не в силах.
 * Они и не пользовались — писали `back`, `facade`, `2/0.4/0.4/0.4`.
 *
 * Обход PROMPT 62 нашёл ЧЕТЫРЕ словаря в четырёх слоях, два из которых
 * называли одно и то же по-разному: `confirmat` был и «конфирмат», и
 * «корпусный крепёж»; `eccentric` — и «эксцентриковая стяжка», и
 * «эксцентрик». Это и есть цена второго определения.
 *
 * Домен видят все слои. Словарь здесь — единственный способ выполнить
 * требование «экран, PDF и XLSX говорят одними словами» устройством, а
 * не договорённостью.
 *
 * ## Исчерпывающий Record — это проверка, а не оформление
 *
 * Каждое сопоставление объявлено как `Record<Enum, string>`. Добавление
 * значения в перечисление **не соберётся**, пока для него не написано
 * слово. Новое доменное значение не может молча появиться на экране
 * машинным текстом — это держат типы, а не бдительность.
 *
 * ## Что словарь НЕ делает
 *
 * Он не трогает модель. `PartRole`, `HardwareKind`, `Grain` остаются в
 * геометрии, в файлах проектов и в расчёте ровно такими, как есть: это
 * показ, а не переименование. Локализации здесь тоже нет — приложение
 * одноязычное, и латиница в обычном сценарии означает утечку, а не
 * второй язык. Отраслевые обозначения, которые по-русски так и пишут
 * (`Push-to-open`), словарём не переводятся.
 */

/**
 * Роль детали в изделии.
 *
 * Слова мебельные, а не описательные: «полкодержатель», а не «держатель
 * для полки». Точность здесь важнее простоты — по этим словам человек
 * разговаривает с цехом.
 */
export const PART_ROLE_LABELS: Readonly<Record<PartRole, string>> = {
  side: 'боковина',
  top: 'крышка',
  bottom: 'дно',
  partition: 'перегородка',
  'shelf-fixed': 'полка несъёмная',
  'shelf-adjustable': 'полка съёмная',
  back: 'задняя стенка',
  plinth: 'цоколь',
  countertop: 'столешница',
  facade: 'фасад',
  'drawer-front': 'фасад ящика',
  'drawer-side': 'боковина ящика',
  'drawer-back': 'задняя стенка ящика',
  'drawer-bottom': 'дно ящика',
  handle: 'ручка',
  // Отраслевое название механизма открывания без ручки. По-русски его
  // так и пишут, поэтому оно не переводится.
  'push-to-open': 'push-to-open',
  filler: 'фальшпанель',
  other: 'прочее',
};

export function partRoleLabel(role: PartRole): string {
  return PART_ROLE_LABELS[role];
}

/** Вид фурнитуры — так, как её называют в спецификации и в магазине. */
export const HARDWARE_KIND_LABELS: Readonly<Record<HardwareKind, string>> = {
  confirmat: 'конфирмат',
  eccentric: 'эксцентриковая стяжка',
  dowel: 'шкант',
  'shelf-support': 'полкодержатель',
  hinge: 'петля',
  'hinge-fastener': 'крепёж петли',
  slide: 'направляющая',
  handle: 'ручка',
  'handle-fastener': 'крепёж ручки',
  'push-latch': 'push-механизм',
  rod: 'штанга',
  'rod-flange': 'фланец штанги',
  leg: 'опора',
  'plinth-clip': 'клипса цоколя',
  'back-nail': 'гвоздь задней стенки',
};

export function hardwareKindLabel(kind: HardwareKind): string {
  return HARDWARE_KIND_LABELS[kind];
}

/**
 * Единица измерения позиции фурнитуры.
 *
 * До PROMPT 62 в колонке «Ед.» стояло `pcs` — сокращение чужого языка
 * там, где вся остальная таблица по-русски.
 */
export const HARDWARE_UNIT_LABELS: Readonly<Record<HardwareUnit, string>> = {
  pcs: 'шт',
  pair: 'пара',
  set: 'компл',
};

export function hardwareUnitLabel(unit: HardwareUnit): string {
  return HARDWARE_UNIT_LABELS[unit];
}

/** Вид препятствия в помещении. */
export const OBSTACLE_KIND_LABELS: Readonly<Record<ObstacleKind, string>> = {
  protrusion: 'выступ',
  column: 'колонна',
  pipe: 'труба',
  radiator: 'радиатор',
  other: 'прочее',
};

export function obstacleKindLabel(kind: ObstacleKind): string {
  return OBSTACLE_KIND_LABELS[kind];
}

/**
 * Направление текстуры — по тому, что оно ЗНАЧИТ для раскроя.
 *
 * `none` — не «не задано» и не «неизвестно». Это свойство материала,
 * которым раскрой пользуется прямо сейчас: `rotationAllowedFor` в
 * `src/production/parts.ts` разрешает поворот детали на 90° ровно тогда,
 * когда `grain === 'none'`. Поэтому слово — «без направления»: у плиты
 * может быть декор, направленным он при этом не является.
 */
export const GRAIN_LABELS: Readonly<Record<Grain, string>> = {
  none: 'без направления',
  'along-length': 'вдоль длины',
  'along-width': 'вдоль ширины',
};

export function grainLabel(grain: Grain): string {
  return GRAIN_LABELS[grain];
}

/** Стороны детали, к которым относится кромка. */
export const EDGE_SIDE_LABELS: Readonly<Record<keyof Omit<EdgeSpec, 'materialId'>, string>> = {
  front: 'передняя',
  back: 'задняя',
  left: 'левая',
  right: 'правая',
};

const EDGE_SIDES = ['front', 'back', 'left', 'right'] as const;

/** Сторона кромки в родительном падеже — для фраз «кромка спереди». */
const EDGE_SIDE_ADVERBS: Readonly<Record<(typeof EDGE_SIDES)[number], string>> = {
  front: 'спереди',
  back: 'сзади',
  left: 'слева',
  right: 'справа',
};

export function edgeSideAdverb(side: (typeof EDGE_SIDES)[number]): string {
  return EDGE_SIDE_ADVERBS[side];
}

/**
 * Кромка детали одной строкой.
 *
 * До PROMPT 62 этих строк было ДВЕ и обе машинные: экран писал
 * `front 2, left 0.4, right 0.4` — имена полей модели; PDF и XLSX
 * писали `2/0.4/0.4/0.4` — четыре числа, порядок которых надо знать
 * наизусть. Ни одна не говорила, какая сторона имеется в виду.
 *
 * Стороны без кромки не перечисляются: строка отвечает на вопрос «где
 * кромка и какая», а не «каково значение каждого из четырёх полей».
 * Когда кромки нет нигде — так и сказано.
 *
 * Сторона названа наречием («спереди»), а не прилагательным
 * («передняя»), и миллиметры вынесены в заголовок колонки. Это не
 * сокращение ради красоты: полная форма — «передняя 2 мм, левая 0.4 мм,
 * правая 0.4 мм» — не помещается в колонку деталировки на A4 и
 * обрезалась на середине, а обрезанная кромка в раскроечном листе хуже,
 * чем машинная. Наречия — та же форма, которой уже пользуется чертёж
 * детали, так что второго словаря и здесь не появилось.
 */
export function edgeBandingText(edge: EdgeSpec, formatMm: (value: number) => string): string {
  const sides = EDGE_SIDES.filter((side) => edge[side] > 0);
  if (sides.length === 0) return 'без кромки';
  return sides.map((side) => `${EDGE_SIDE_ADVERBS[side]} ${formatMm(edge[side])}`).join(', ');
}

/**
 * Вид материала — так, как он называется в прайсе поставщика.
 *
 * В листе «Материалы» выгрузки стояло `chipboard`, `hardboard`.
 */
export const MATERIAL_KIND_LABELS: Readonly<Record<MaterialKind, string>> = {
  chipboard: 'ЛДСП',
  mdf: 'МДФ',
  plywood: 'фанера',
  hardboard: 'ХДФ',
  solid: 'массив',
  glass: 'стекло',
  mirror: 'зеркало',
  other: 'прочее',
};

export function materialKindLabel(kind: MaterialKind): string {
  return MATERIAL_KIND_LABELS[kind];
}

/** Тип направляющей ящика. Показывается в объяснениях правил фурнитуры. */
export const SLIDE_TYPE_LABELS: Readonly<Record<SlideType, string>> = {
  roller: 'роликовая',
  'ball-full': 'шариковая полного выдвижения',
  'ball-partial': 'шариковая частичного выдвижения',
  'hidden-soft-close': 'скрытая с доводчиком',
};

export function slideTypeLabel(type: SlideType): string {
  return SLIDE_TYPE_LABELS[type];
}

/**
 * Назначение отверстия присадки.
 *
 * Словарь жил приватным в `src/export/part-drawing.ts` и работал только
 * на чертеже: лист «Присадка» рядом печатал `hinge-cup` и `slide`.
 */
export const DRILL_PURPOSE_LABELS: Readonly<Record<DrillPurpose, string>> = {
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

export function drillPurposeLabel(purpose: DrillPurpose): string {
  return DRILL_PURPOSE_LABELS[purpose];
}

/**
 * Грани детали для присадки — те же, что в `drilling/faces.ts`.
 *
 * Пласти здесь — `top` и `bottom`: у детали, как она стоит в изделии,
 * это её большие поверхности независимо от ориентации панели.
 * `left`/`right` — торцы по длине, `front`/`back` — торцы по ширине.
 */
export const DRILL_FACE_LABELS: Readonly<Record<DrillFace, string>> = {
  top: 'пласть сверху',
  bottom: 'пласть снизу',
  left: 'торец слева',
  right: 'торец справа',
  front: 'торец спереди',
  back: 'торец сзади',
};

export function drillFaceLabel(face: DrillFace): string {
  return DRILL_FACE_LABELS[face];
}

/** Как задняя стенка держится в корпусе. */
export const BACK_MOUNT_LABELS: Readonly<Record<BackPanelMount['kind'], string>> = {
  overlay: 'накладная',
  'inset-groove': 'в паз',
  'inset-flush': 'вкладная заподлицо',
  none: 'без задней стенки',
};

export function backMountLabel(kind: BackPanelMount['kind']): string {
  return BACK_MOUNT_LABELS[kind];
}

/** Что изделие держит снизу. */
export const BASE_KIND_LABELS: Readonly<Record<BaseSpec['kind'], string>> = {
  plinth: 'цоколь',
  legs: 'опоры',
  none: 'без основания',
};

export function baseKindLabel(kind: BaseSpec['kind']): string {
  return BASE_KIND_LABELS[kind];
}

