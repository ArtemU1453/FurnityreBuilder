import type { Issue, Project } from '../../domain/index.js';
import { issue } from '../../domain/index.js';
import type { ValidationRule } from '../types.js';

/**
 * Толщина корпуса против толщины материала (PROMPT 47, gap G-01).
 *
 * ## Что нашёл приёмочный аудит
 *
 * В выгруженной деталировке деталь «Дно» — 18 мм, а материал у неё —
 * «Корпусная плита 16 мм». Это не ошибка расчёта: геометрия корпуса
 * СОЗНАТЕЛЬНО берёт толщину из `Dimensions.panelThickness`
 * (`carcass.ts` передаёт `thicknessOverride: T`), тогда как полки берут
 * её из материала (`Shelf.thickness ?? material.thickness ?? T`,
 * PROMPT 13 §9). Оба правила задокументированы, и оба верны сами по
 * себе — но вместе они дают документ, который сам себе противоречит.
 *
 * Цех, читающий такой раскрой, закажет плиту 16 мм на детали 18 мм.
 *
 * ## Почему предупреждение, а не смена геометрии
 *
 * Потому что `T` — несущий параметр: от него зависят внутренние
 * габариты, положение горизонталей и присадка
 * (`docs/GEOMETRY_RULES.md` §4). Переписать корпус на толщину материала
 * значит изменить геометрию всех существующих проектов ради
 * согласования подписи. Это не минимальное исправление, а другая
 * модель.
 *
 * А вот молчать нельзя: расхождение видно только тому, кто сверит
 * колонку «Толщина» с колонкой «Материал» — то есть почти никому.
 * Правило превращает молчаливое противоречие в названное: с числами,
 * с именем материала и с двумя способами его убрать.
 *
 * Предупреждение, а не ошибка: проект остаётся рабочим, документы
 * выпускаются. Решение — за человеком, и оно у него теперь есть.
 */
export const thicknessRule: ValidationRule = {
  code: 'THICKNESS',
  run(project: Project): Issue[] {
    const issues: Issue[] = [];

    project.furniture.forEach((furniture, index) => {
      const panel = furniture.dimensions.panelThickness;
      /*
        Материал корпуса — тот, которым подписаны боковины: именно его
        имя стоит в деталировке рядом с их толщиной. Роль `side`
        обязательна и есть у любого изделия, поэтому выбор однозначен.
      */
      const materialId = project.materials.assignment.side ?? project.settings.defaultMaterialId;
      const material = project.materials.items[materialId];
      // Материала нет вовсе — об этом сообщает правило ссылочной
      // целостности, и второй раз то же самое повторять незачем.
      if (material === undefined) return;
      if (material.thickness === panel) return;

      issues.push(
        issue(
          'THICKNESS_MATERIAL_MISMATCH',
          'warning',
          `Толщина плиты ${String(panel)} мм не совпадает с толщиной материала «${material.name}» (${String(material.thickness)} мм). В деталировке детали корпуса будут ${String(panel)} мм, а материал у них — этот. Либо задайте толщину ${String(material.thickness)} мм, либо выберите материал нужной толщины.`,
          { path: `furniture.${String(index)}.dimensions.panelThickness` },
        ),
      );
    });

    return issues;
  },
};
