/**
 * Миграции схемы документа.
 *
 * Каждая — чистая функция от неизвестной формы к неизвестной форме;
 * типизировать промежуточные версии нельзя, потому что их типы уже удалены
 * из кода. Гарантию даёт не типизация, а схема, применяемая после миграции,
 * и тест на реальном файле-фикстуре каждой версии.
 */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ключ — версия, ИЗ которой мигрируем. Пока схема первая, реестр пуст:
 * добавлять сюда заглушку «1 → 1» было бы враньём о наличии миграций.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class MigrationError extends Error {
  readonly from: number;
  readonly to: number;

  constructor(message: string, from: number, to: number) {
    super(message);
    this.name = 'MigrationError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Последовательно применяет миграции от версии документа к текущей.
 *
 * Документ новее поддерживаемой версии отклоняется целиком: частично
 * применённый импорт хуже отказа — пользователь решит, что файл открылся.
 */
export function migrateDocument(
  raw: Record<string, unknown>,
  fromVersion: number,
  targetVersion: number,
): Record<string, unknown> {
  if (fromVersion > targetVersion) {
    throw new MigrationError(
      `Файл создан в более новой версии приложения (схема ${String(fromVersion)}, поддерживается ${String(targetVersion)}).`,
      fromVersion,
      targetVersion,
    );
  }

  let doc = raw;
  for (let v = fromVersion; v < targetVersion; v += 1) {
    const migration = MIGRATIONS[v];
    if (migration === undefined) {
      throw new MigrationError(
        `Не найдена миграция схемы с версии ${String(v)} на ${String(v + 1)}.`,
        v,
        v + 1,
      );
    }
    doc = migration(doc);
  }
  return doc;
}
