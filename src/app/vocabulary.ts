/**
 * Словарь интерфейса — реэкспорт доменного (PROMPT 62 §4, §12).
 *
 * ## Почему слова переехали в домен
 *
 * Здесь они были заведены на PROMPT 58 и починили язык КОНСТРУКТОРА.
 * Производственный раздел они починить не могли: `boundaries` не
 * пускает `export` в слой `app`, поэтому PDF и XLSX пользовались своими
 * копиями — и называли `confirmat` то «конфирматом», то «корпусным
 * крепежом».
 *
 * Определение переехало в `src/domain/vocabulary.ts`, откуда его видят
 * все слои. Здесь остался реэкспорт: ни один импорт интерфейса не
 * сломался, а определение по-прежнему ОДНО.
 */
export {
  EDGE_SIDE_LABELS,
  GRAIN_LABELS,
  HARDWARE_KIND_LABELS,
  HARDWARE_UNIT_LABELS,
  OBSTACLE_KIND_LABELS,
  PART_ROLE_LABELS,
  edgeBandingText,
  edgeSideAdverb,
  grainLabel,
  hardwareKindLabel,
  hardwareUnitLabel,
  obstacleKindLabel,
  partRoleLabel,
} from '../domain/vocabulary.js';

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
