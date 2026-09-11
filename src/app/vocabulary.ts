import type { ObstacleKind, PartRole } from '../domain/index.js';
import type { HardwareKind } from '../domain/hardware/types.js';

/**
 * Словарь: машинное значение → слово для человека (PROMPT 58 §5).
 *
 * ## Зачем один модуль, а не подпись по месту
 *
 * Аудит PROMPT 53 (`FR-12`) нашёл в интерфейсе `Деталь · back`, а
 * сплошной обход видимого текста добавил к нему сырые `HardwareKind` в
 * спецификации фурнитуры и `ObstacleKind` в списке препятствий. Каждая
 * подпись стояла в своём компоненте, и ничто не мешало появиться
 * четвёртой такой же.
 *
 * ## Исчерпывающий Record — это проверка, а не оформление
 *
 * Каждое сопоставление объявлено как `Record<Enum, string>`. Добавление
 * нового значения в домен **не соберётся**, пока для него не написано
 * слово. Это и есть требование «то же сырое значение не может появиться
 * снова незамеченным» (§20 E) — выполняется типами, а не бдительностью.
 *
 * ## Чего здесь нет
 *
 * Ни механизма локализации, ни второго языка. Приложение
 * русскоязычное и одноязычное; латиница в обычном сценарии — утечка, а
 * не перевод. Отраслевые обозначения, которые по-русски так и пишут
 * (`Push-to-open`), словарём не трогаются.
 *
 * Домен не меняется: `PartRole`, `HardwareKind` и `ObstacleKind`
 * остаются в модели, в файлах проектов и в выгрузках такими, как есть
 * (§13). Здесь только показ.
 *
 * ## Файл чистый
 *
 * Ни React, ни DOM. Полнота словаря проверяется обычным тестом.
 */

/**
 * Роль детали в изделии.
 *
 * Слова мебельные, а не описательные: «Полкодержатель», а не «держатель
 * для полки». Точность здесь важнее простоты — по этим словам человек
 * разговаривает с цехом (§11).
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
  // так и пишут, поэтому оно не переводится (§1: доменный язык остаётся).
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
 * Этапы конвейера геометрии — в том, что они значат для изделия.
 *
 * Показываются только нереализованные (`status: 'planned'`), и показывать
 * их именем этапа бессмысленно: человеку важно не то, что называется
 * `edges`, а то, что **геометрия кромки не строится**.
 *
 * Словарь неполный намеренно и не объявлен `Record`: имена этапов —
 * внутреннее устройство движка, а не перечисление домена, и заводить
 * обязанность подписывать каждый (`normalize`, `layout`) значило бы
 * обещать, что они когда-нибудь окажутся на экране. Неизвестное имя
 * возвращается как есть — честнее, чем молча пропасть.
 */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  edges: 'кромка',
  drilling: 'присадка',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Нереализованные этапы одной фразой: «кромка и присадка». */
export function stageList(stages: readonly string[]): string {
  const labels = stages.map(stageLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(', ')} и ${labels.at(-1) as string}`;
}
