import type { Severity } from '../domain/index.js';
import type { ProjectStatus } from '../persistence/index.js';
import type { RoomStatus } from '../room/index.js';
import type { CheckStatus, ProductionStatus } from '../workflow/index.js';
import type { Tone } from '../design-system/index.js';
import type { StorageStatus } from './use-project-storage.js';

/**
 * Единый язык состояний (PROMPT 26 §14–§17).
 *
 * ## Что здесь исправлено
 *
 * До этого этапа один и тот же `ProductionStatus` подписывался тремя
 * разными наборами слов: «Готово» в тулбаре, «Готово к производству» в
 * строке состояния и «Готово к производству» третьим оттенком зелёного
 * в чеклисте. Все три были видны одновременно, и понять, что это одно и
 * то же состояние, было нельзя. Плюс к тому четыре доменных перечисления
 * состояний — производство, помещение, проект, хранилище — не имели
 * между собой ничего общего в показе.
 *
 * Теперь у каждого состояния ровно одно описание: слова, тон и
 * пояснение. Тон выбирается из пяти, и это те же пять, что понимает
 * `StatusIndicator`.
 *
 * ## Почему в слое приложения, а не в домене
 *
 * Домен решает, ЧТО произошло: `NEEDS_CONFIRMATION` — это утверждение о
 * проекте, а не о экране. Как это назвать по-русски и каким цветом
 * показать — вопрос интерфейса, и держать ответ на него в домене
 * значило бы привязать расчёт к языку интерфейса.
 *
 * ## Четыре уровня, а не два
 *
 * `info`, `warning`, `NEEDS_CONFIRMATION` и `error` — разные вещи, и
 * §16–§17 требуют их не смешивать. Предупреждение говорит «так можно, но
 * посмотрите»; «нужно подтверждение» говорит «правило неизвестно, и
 * расчёт его не выдумывал»; ошибка говорит «так нельзя». Одинаковый
 * красный на всех трёх сделал бы неизвестное правило неотличимым от
 * поломки.
 */

export interface StatusView {
  readonly label: string;
  readonly tone: Tone;
  /** Короткая подпись для тулбара, где места на предложение нет. */
  readonly short: string;
  /** Что это значит и что с этим делать. */
  readonly hint?: string;
}

export const PRODUCTION_STATUS: Readonly<Record<ProductionStatus, StatusView>> = {
  READY_FOR_PRODUCTION: {
    label: 'Готово к производству',
    short: 'Готово',
    tone: 'success',
    hint: 'Все разделы спецификации посчитаны, ошибок и неподтверждённых правил нет.',
  },
  HAS_WARNINGS: {
    label: 'Готово с замечаниями',
    short: 'Замечания',
    tone: 'warning',
    hint: 'Изделие изготовимо, но к расчёту есть вопросы — их стоит прочитать до заказа материала.',
  },
  NEEDS_CONFIRMATION: {
    label: 'Требуется подтверждение правил',
    short: 'Подтвердить',
    tone: 'warning',
    hint: 'Часть производственных правил не подтверждена источником. Расчёт не подставил числа вместо них и говорит об этом прямо.',
  },
  INVALID: {
    label: 'Изготовление невозможно',
    short: 'Ошибки',
    tone: 'danger',
    hint: 'В проекте есть ошибки, при которых деталировка не имеет смысла. Исправьте их — расчёт обновится сам.',
  },
};

export const ROOM_STATUS: Readonly<Record<RoomStatus, StatusView>> = {
  VALID: { label: 'Размещение корректно', short: 'Корректно', tone: 'success' },
  WARNING: {
    label: 'Есть замечания к размещению',
    short: 'Замечания',
    tone: 'warning',
    hint: 'Мебель помещается, но нарушены зазоры или предметы стоят слишком близко.',
  },
  NEEDS_CONFIRMATION: {
    label: 'Правила проходов не заданы',
    short: 'Подтвердить',
    tone: 'warning',
    hint: 'Нормы проходов между мебелью не подтверждены источником, поэтому проверка их не применяла.',
  },
  INVALID: {
    label: 'Размещение невозможно',
    short: 'Ошибки',
    tone: 'danger',
    hint: 'Мебель пересекается со стенами, препятствиями или друг с другом.',
  },
};

export const PROJECT_STATUS: Readonly<Record<ProjectStatus, StatusView>> = {
  LOADING: { label: 'Загружается', short: 'Загрузка', tone: 'neutral' },
  READY: { label: 'Готов', short: 'Готов', tone: 'success' },
  WARNING: { label: 'Открывается с замечаниями', short: 'Замечания', tone: 'warning' },
  INVALID: { label: 'Файл не читается', short: 'Ошибка', tone: 'danger' },
  MIGRATION_REQUIRED: {
    label: 'Нужна другая версия приложения',
    short: 'Версия',
    tone: 'warning',
    hint: 'Файл создан более новой версией. Частично открыть его было бы хуже, чем не открывать.',
  },
  MISSING: {
    label: 'Проект недоступен',
    short: 'Недоступен',
    tone: 'danger',
    hint: 'Проект удалён или не загружен. Размещения в помещении сохранены и вернутся вместе с ним.',
  },
};

/**
 * Состояние сохранения (§22).
 *
 * `saved` показывается нейтрально, а не зелёным: «сохранено» — это
 * норма, а не достижение. Зелёная галочка после каждой записи
 * превращается в шум, который перестают замечать — и тогда её перестают
 * замечать и в тот раз, когда сохранения не произошло.
 */
export const STORAGE_STATUS: Readonly<Record<StorageStatus, StatusView>> = {
  saved: { label: 'Сохранено', short: 'Сохранено', tone: 'neutral' },
  unsaved: {
    label: 'Есть несохранённые изменения',
    short: 'Не сохранено',
    tone: 'warning',
    hint: 'Автосохранения нет намеренно: запись поверх сохранённого потеряла бы работу, если вы экспериментировали.',
  },
  saving: { label: 'Сохранение…', short: 'Сохранение…', tone: 'neutral' },
  error: {
    label: 'Не удалось сохранить',
    short: 'Ошибка',
    tone: 'danger',
    hint: 'Выгрузите проект файлом, чтобы не потерять работу.',
  },
};

export const CHECK_STATUS: Readonly<Record<CheckStatus, StatusView>> = {
  PASS: { label: 'В порядке', short: 'В порядке', tone: 'success' },
  WARNING: { label: 'Есть замечания', short: 'Замечания', tone: 'warning' },
  NEEDS_CONFIRMATION: { label: 'Нужно подтверждение', short: 'Подтвердить', tone: 'warning' },
  ERROR: { label: 'Ошибка', short: 'Ошибка', tone: 'danger' },
};

/** Значок состояния. Дублирует тон формой — цвет не единственный носитель смысла. */
export const CHECK_MARK: Readonly<Record<CheckStatus, string>> = {
  PASS: '✓',
  WARNING: '!',
  NEEDS_CONFIRMATION: '?',
  ERROR: '✕',
};

/**
 * Уровень проблемы → тон.
 *
 * `info` — нейтральный, а не синий-«информационный»: сообщение уровня
 * info не требует действия, и выделять его цветом значило бы звать к
 * тому, чего делать не надо.
 */
export const SEVERITY_TONE: Readonly<Record<Severity, Tone>> = {
  error: 'danger',
  warning: 'warning',
  info: 'neutral',
};

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  error: 'Ошибка',
  warning: 'Предупреждение',
  info: 'Сообщение',
};

/** Сводка по списку проблем: то, что показывает строка состояния. */
export function summarizeIssues(issues: readonly { readonly severity: Severity }[]): StatusView {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  if (errors > 0) {
    return {
      label: `Ошибок: ${String(errors)}`,
      short: `Ошибок: ${String(errors)}`,
      tone: 'danger',
      ...(warnings > 0 ? { hint: `и предупреждений: ${String(warnings)}` } : {}),
    };
  }
  if (warnings > 0) {
    return {
      label: `Предупреждений: ${String(warnings)}`,
      short: `Предупреждений: ${String(warnings)}`,
      tone: 'warning',
    };
  }
  return { label: 'Проблем нет', short: 'Без проблем', tone: 'success' };
}
