import { createProjectRepository } from '../persistence/index.js';
import type { ProjectRepository } from '../persistence/index.js';

/**
 * Единственное хранилище приложения (PROMPT 25 §2, §5).
 *
 * ## Почему модульный уровень, а не хук
 *
 * Хранилище одно на вкладку. Если бы его создавал каждый хук, редактор
 * и библиотека открыли бы по своему соединению с одной и той же базой —
 * то есть завели бы два входа туда, куда вход должен быть один. Здесь
 * обещание запоминается один раз и раздаётся всем, кому нужно.
 *
 * Само хранилище остаётся локальным: IndexedDB, а без него — память.
 * Ни адреса, ни учётной записи, ни синхронизации.
 */
let shared: Promise<ProjectRepository> | undefined;

export function sharedRepository(): Promise<ProjectRepository> {
  shared ??= createProjectRepository();
  return shared;
}

/** Только для тестов: сбрасывает запомненное обещание. */
export function resetSharedRepository(): void {
  shared = undefined;
}
