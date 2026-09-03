import { issue, uniformTrim } from '../domain/index.js';
import type { CuttingSettings, Issue, Material, TrimSpec } from '../domain/index.js';
import type { CuttingGroup, CuttingStock, UsableStockArea } from './types.js';

/**
 * Заготовка (PROMPT 17 §12, §17).
 *
 * Формат листа НЕ придумывается здесь: он уже есть в реестре материалов
 * (`Material.sheet`, `SheetFormat {width, height, trim}`) с PROMPT 1.
 * Заводить рядом второй справочник листов значило бы повторить ошибку,
 * которую этот проект отклонял уже трижды — у материала стало бы два
 * формата, расходящихся при первом же редактировании.
 *
 * Заготовка собирается из трёх источников, и каждый отвечает ровно за своё:
 * материал даёт размер листа и обрезную кромку, настройки проекта — ширину
 * пропила и (если задана) обрезную кромку по четырём сторонам, группа —
 * материал и толщину.
 */

/** Обрезная кромка: настройка проекта, иначе равномерная из формата листа. */
export function trimFor(material: Material, settings: CuttingSettings): TrimSpec {
  if (settings.trim !== undefined) return settings.trim;
  return uniformTrim(material.sheet?.trim ?? 0);
}

/**
 * Лист для группы. `undefined` означает «формат листа не задан» — это не
 * ошибка расчёта, а неполные данные материала, и детали такой группы
 * честно уходят в `unplaced` с причиной `INVALID_STOCK` (§20), а не
 * раскладываются на выдуманном листе.
 */
export function resolveStock(
  group: CuttingGroup,
  material: Material | undefined,
  settings: CuttingSettings,
): { stock?: CuttingStock; warning?: Issue } {
  if (material === undefined) {
    return {
      warning: issue(
        'CUTTING_MATERIAL_NOT_FOUND',
        'error',
        `Материал группы «${group.materialName}» не найден в реестре: лист определить не из чего.`,
      ),
    };
  }
  const sheet = material.sheet;
  if (sheet === undefined) {
    return {
      warning: issue(
        'CUTTING_SHEET_NOT_DEFINED',
        'warning',
        `У материала «${material.name}» не задан формат листа: детали толщиной ${String(group.thickness)} мм разложить не на чем.`,
      ),
    };
  }

  const trim = trimFor(material, settings);
  return {
    stock: {
      id: `stock:${String(material.id)}@${group.thickness.toFixed(1)}`,
      materialId: material.id,
      thickness: group.thickness,
      length: sheet.width,
      width: sheet.height,
      kerf: settings.kerf,
      trimLeft: trim.left,
      trimRight: trim.right,
      trimTop: trim.top,
      trimBottom: trim.bottom,
    },
  };
}

/**
 * Рабочая область листа (§17): лист минус обрезная кромка со всех сторон.
 * Деталь не имеет права попасть в область trim, поэтому раскладка работает
 * только внутри этого прямоугольника.
 */
export function usableAreaOf(stock: CuttingStock): UsableStockArea {
  return {
    x: stock.trimLeft,
    y: stock.trimBottom,
    length: stock.length - stock.trimLeft - stock.trimRight,
    width: stock.width - stock.trimTop - stock.trimBottom,
  };
}
