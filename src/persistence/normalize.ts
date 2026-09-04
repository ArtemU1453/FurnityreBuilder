import type { Project } from '../domain/index.js';

/**
 * Нормализация проекта после разбора схемой (PROMPT 25 §19).
 *
 * ## Зачем отдельный шаг
 *
 * Схема отвечает на вопрос «правильной ли формы файл», миграции — на
 * вопрос «какой он версии». Ни та, ни другая не могут ответить на
 * вопрос «чего в нём не хватает по смыслу»: подставить экземпляру
 * ссылку на проект способен только тот, кто знает, ЧЕЙ это файл, а
 * значение это появляется лишь когда проект уже разобран целиком.
 *
 * Поэтому нормализация — третий шаг конвейера
 * `Parse → Validate → Migrate → Normalize → Save`, а не спрятанный
 * `.transform()` внутри схемы: спрятанный он был бы невидим и не
 * проверяем отдельно.
 *
 * ## Что она НЕ делает
 *
 * Не чинит ошибки. Экземпляр, ссылающийся на удалённое изделие,
 * остаётся как есть и становится видимой ошибкой размещения
 * (PROMPT 25 §12, вариант C). Тихо «починенный» файл хуже честно
 * помеченного: пользователь не узнает, что потерял расстановку.
 */
export function normalizeProject(project: Project): Project {
  const room = project.room;
  if (room === undefined) return project;

  // Файл, сохранённый до библиотеки, знал только `furnitureId`: проект
  // был один, и им был этот. Подставляется именно он — это не догадка,
  // а единственное значение, которое поле могло иметь.
  const instances = room.furnitureInstances.map((instance) =>
    instance.projectId === undefined || instance.projectId.length === 0
      ? { ...instance, projectId: project.id }
      : instance,
  );

  const changed = instances.some((instance, index) => instance !== room.furnitureInstances[index]);
  return changed ? { ...project, room: { ...room, furnitureInstances: instances } } : project;
}
