import type { Project } from '../domain/index.js';
import { DeserializationError, fromJson, toJson } from './serialization.js';
import { MigrationError } from './migrations/index.js';

/**
 * Импорт и экспорт одного проекта (PROMPT 25 §19–§21).
 *
 * ## Формат тот же самый
 *
 * Экспорт — это `toJson`, импорт — это `fromJson`. Отдельного «формата
 * обмена» не заводится: файл, который пользователь скачал, — ровно то,
 * что лежит в хранилище, и открыть его можно текстовым редактором.
 * Второй формат означал бы вторую схему, вторые миграции и второй набор
 * ошибок.
 *
 * ## Конвейер
 *
 *     File → Parse → Validate → Migrate → Normalize → Save
 *
 * Первые четыре шага уже выполняет `deserializeDocument`: разбор JSON,
 * проверка схемой, миграции и нормализация. Здесь добавляется последний
 * шаг — превращение технической ошибки в предложение, которое можно
 * показать человеку.
 *
 * ## Ни одного внешнего обращения
 *
 * Ни загрузки, ни отправки, ни адреса. Файл приходит от пользователя и
 * уходит к пользователю; сеть в этом не участвует
 * (`docs/BRAND_INDEPENDENCE_AUDIT.md` §4.4).
 */

/**
 * Состояние проекта в библиотеке (§22).
 *
 * Список закрыт и покрывает все случаи, в которых карточка может
 * оказаться. `MISSING` относится не к самому проекту, а к ссылке на
 * него из помещения: проект удалён, а расстановка осталась.
 */
export type ProjectStatus = 'LOADING' | 'READY' | 'WARNING' | 'INVALID' | 'MIGRATION_REQUIRED' | 'MISSING';

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  LOADING: 'Загружается',
  READY: 'Готов',
  WARNING: 'Открывается с замечаниями',
  INVALID: 'Файл не читается',
  MIGRATION_REQUIRED: 'Нужна другая версия приложения',
  MISSING: 'Проект недоступен',
};

/**
 * Результат импорта.
 *
 * Ошибка — это тоже результат, а не исключение наружу: интерфейс обязан
 * показать причину словами, а не молча ничего не сделать. Техническая
 * подробность (`details`) остаётся рядом, но пользователю показывается
 * только по его желанию — стек и текст schema-ошибки ему ни о чём не
 * говорят (§22).
 */
export type ImportResult =
  | { readonly status: 'READY'; readonly project: Project; readonly warnings: readonly string[] }
  | { readonly status: 'INVALID' | 'MIGRATION_REQUIRED'; readonly message: string; readonly details: string };

/**
 * Замечания, с которыми файл всё же открывается (§22, состояние WARNING).
 *
 * Это НЕ ошибки: проект работоспособен, но что-то в нём стоит увидеть
 * до того, как пользователь удивится. Молчать о таком — значит дать ему
 * обнаружить это самому и позже.
 */
export function collectImportWarnings(project: Project): string[] {
  const warnings: string[] = [];

  const room = project.room;
  if (room !== undefined) {
    const foreign = room.furnitureInstances.filter((instance) => instance.projectId !== project.id);
    if (foreign.length > 0) {
      warnings.push(
        `В помещении размещены изделия из других проектов (${String(foreign.length)}). ` +
          'Они отобразятся, только если эти проекты есть в библиотеке.',
      );
    }
  }

  if (project.furniture.length === 0) {
    warnings.push('В проекте нет ни одного изделия.');
  }

  return warnings;
}

/** Импорт из текста файла. Исключений не выбрасывает: причина — часть результата. */
export function importProjectFromText(text: string): ImportResult {
  try {
    const document = fromJson(text);
    return { status: 'READY', project: document.project, warnings: collectImportWarnings(document.project) };
  } catch (error) {
    if (error instanceof MigrationError) {
      return {
        status: 'MIGRATION_REQUIRED',
        message: error.message,
        details: `Схема файла: ${String(error.from)}, поддерживается: ${String(error.to)}.`,
      };
    }
    if (error instanceof DeserializationError) {
      return { status: 'INVALID', message: error.message, details: error.details };
    }
    // Непредвиденное всё равно не показывается стеком: пользователю
    // нужен ответ «что делать», а не место в коде.
    return {
      status: 'INVALID',
      message: 'Файл не удалось прочитать как проект.',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Экспорт: тот же контракт сериализации, что и у хранилища (§20). */
export function exportProjectToText(project: Project): string {
  return toJson(project, true);
}

/**
 * Имя файла для сохранения.
 *
 * Имя проекта, а не идентификатор: в папке «Загрузки» пользователь
 * ищет «Шкаф в прихожую», а не `a3f1…`. Запрещённые в именах файлов
 * символы заменяются, потому что иначе браузер молча сохранит файл под
 * другим именем.
 */
export function exportFileName(project: Project): string {
  const safe = project.name
    .trim()
    .replace(/[\\/:*?"<>|]/gu, '-')
    .replace(/\s+/gu, ' ')
    .slice(0, 80);
  return `${safe.length === 0 ? 'Проект' : safe}.json`;
}
