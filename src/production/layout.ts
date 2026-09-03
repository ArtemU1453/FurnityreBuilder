import { issue } from '../domain/index.js';
import type { Issue, Mm, PartId } from '../domain/index.js';
import type {
  CuttingLayout,
  CuttingPlacement,
  CuttingStock,
  ProductionPart,
  UnplacedPart,
  UsableStockArea,
} from './types.js';
import { usableAreaOf } from './stock.js';

/**
 * Раскладка деталей на листах (PROMPT 17 §15, §18–§21).
 *
 * ## Какой алгоритм и почему именно он
 *
 * Гильотинный раскрой с деревом свободных прямоугольников, детали
 * перебираются по убыванию площади (best-fit decreasing). Алгоритм не
 * выбран заново: ровно он записан в `docs/ARCHITECTURE.md` §9.1 как
 * решение проекта, и причина там же — гильотинный рез соответствует
 * реальному форматно-раскроечному станку, который умеет резать лист только
 * насквозь. Раскладка, которую невозможно распилить, не стоит ничего,
 * какой бы процент использования она ни показывала.
 *
 * Пересечений здесь не может возникнуть по построению: размещение
 * ЗАБИРАЕТ свободный прямоугольник и заменяет его двумя непересекающимися
 * остатками. Это не отменяет проверки (§19) — она ловит ошибку в самом
 * алгоритме, а не в данных.
 *
 * Оптимальность не гарантируется и не заявляется: задача NP-трудная.
 *
 * ## Единицы измерения
 *
 * На листе ось X — вдоль длины листа, Y — вдоль ширины, начало координат в
 * левом нижнем углу рабочей области. Это та же ориентация осей, что у
 * схемы изделия (`docs/COORDINATE_SYSTEM.md`): Y растёт вверх.
 */

/** Один физический экземпляр детали — то, что реально кладут на лист (§22). */
interface Instance {
  readonly productionPartId: string;
  readonly instanceIndex: number;
  readonly sourcePartId: PartId;
  readonly length: Mm;
  readonly width: Mm;
  readonly rotationAllowed: boolean;
}

interface FreeRect {
  readonly x: Mm;
  readonly y: Mm;
  readonly length: Mm;
  readonly width: Mm;
}

interface Sheet {
  readonly index: number;
  readonly free: FreeRect[];
  readonly placements: CuttingPlacement[];
}

/** Каждый экземпляр позиции — отдельная единица размещения (§22). */
export function expandInstances(parts: readonly ProductionPart[]): Instance[] {
  const instances: Instance[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.quantity; i += 1) {
      const sourcePartId = part.sourcePartIds[i];
      if (sourcePartId === undefined) continue;
      instances.push({
        productionPartId: part.id,
        instanceIndex: i,
        sourcePartId,
        length: part.length,
        width: part.width,
        rotationAllowed: part.rotationAllowed,
      });
    }
  }
  return instances;
}

interface Candidate {
  readonly sheet: Sheet;
  readonly rectIndex: number;
  readonly w: Mm;
  readonly h: Mm;
  readonly rotation: 0 | 90;
  readonly leftover: number;
}

/** Помещается ли габарит в свободный прямоугольник. */
function fits(w: Mm, h: Mm, rect: FreeRect): boolean {
  return w <= rect.length && h <= rect.width;
}

/**
 * Лучшее место для экземпляра: минимальный остаток площади прямоугольника.
 * При равенстве побеждает лист с меньшим номером, затем прямоугольник с
 * меньшим индексом, затем поворот 0° — раскладка обязана быть одинаковой
 * при одинаковом входе (§32).
 */
function bestCandidate(instance: Instance, sheets: readonly Sheet[]): Candidate | undefined {
  let best: Candidate | undefined;
  const orientations: { w: Mm; h: Mm; rotation: 0 | 90 }[] = [
    { w: instance.length, h: instance.width, rotation: 0 },
  ];
  if (instance.rotationAllowed) {
    orientations.push({ w: instance.width, h: instance.length, rotation: 90 });
  }

  for (const sheet of sheets) {
    for (let i = 0; i < sheet.free.length; i += 1) {
      const rect = sheet.free[i];
      if (rect === undefined) continue;
      for (const o of orientations) {
        if (!fits(o.w, o.h, rect)) continue;
        const leftover = rect.length * rect.width - o.w * o.h;
        if (best === undefined || leftover < best.leftover) {
          best = { sheet, rectIndex: i, w: o.w, h: o.h, rotation: o.rotation, leftover };
        }
      }
    }
  }
  return best;
}

/**
 * Гильотинный разрез прямоугольника после размещения.
 *
 * Рез всегда идёт насквозь — иначе это не гильотина, — но направление
 * первого реза выбирается: либо горизонталь через весь прямоугольник (и
 * тогда верхний остаток полноширинный, а правый — высотой в деталь), либо
 * вертикаль (правый остаток полновысотный, верхний — шириной в деталь).
 *
 * Правило выбора — «резать вдоль короткого остатка» (SplitShorterLeftoverAxis):
 * крупный остаток достаётся одним целым куском, а не двумя узкими полосами,
 * в каждую из которых уже не помещается ни одна деталь. Это не делает
 * раскладку оптимальной — задача NP-трудная, — но убирает самый частый
 * способ потерять место на ровном месте.
 *
 * Ширина пропила вычитается ровно один раз на каждый рез: деталь остаётся
 * своего размера, материал теряется между деталями.
 */
function splitRect(rect: FreeRect, w: Mm, h: Mm, kerf: Mm): FreeRect[] {
  const result: FreeRect[] = [];
  const rightLength = rect.length - w - kerf;
  const topWidth = rect.width - h - kerf;
  const splitHorizontally = rect.length - w < rect.width - h;

  if (rightLength > 0) {
    result.push({
      x: rect.x + w + kerf,
      y: rect.y,
      length: rightLength,
      width: splitHorizontally ? h : rect.width,
    });
  }
  if (topWidth > 0) {
    result.push({
      x: rect.x,
      y: rect.y + h + kerf,
      length: splitHorizontally ? rect.length : w,
      width: topWidth,
    });
  }
  return result;
}

function newSheet(index: number, usable: UsableStockArea): Sheet {
  return {
    index,
    free: [{ x: usable.x, y: usable.y, length: usable.length, width: usable.width }],
    placements: [],
  };
}

export interface LayoutResult {
  readonly layouts: readonly CuttingLayout[];
  readonly unplaced: readonly UnplacedPart[];
}

/**
 * Раскладывает детали одной группы на листы одного формата.
 *
 * Листов может понадобиться несколько: новый открывается только тогда,
 * когда экземпляр не поместился ни в один уже начатый — так раскладка не
 * плодит полупустые листы.
 */
export function layoutGroup(stock: CuttingStock, parts: readonly ProductionPart[]): LayoutResult {
  const usable = usableAreaOf(stock);
  const unplaced: UnplacedPart[] = [];

  if (usable.length <= 0 || usable.width <= 0) {
    for (const instance of expandInstances(parts)) {
      unplaced.push({
        productionPartId: instance.productionPartId,
        instanceIndex: instance.instanceIndex,
        sourcePartId: instance.sourcePartId,
        reason: 'INVALID_STOCK',
        detail: `Рабочая область листа ${String(stock.length)}×${String(stock.width)} мм после обрезной кромки не положительна.`,
      });
    }
    return { layouts: [], unplaced };
  }

  // По убыванию площади: крупные детали задают структуру листа, мелкие
  // потом заполняют остатки. При равной площади порядок задаёт id — иначе
  // одинаковый вход давал бы разную раскладку.
  const instances = expandInstances(parts).sort((a, b) => {
    const areaDiff = b.length * b.width - a.length * a.width;
    if (areaDiff !== 0) return areaDiff;
    const idDiff = a.productionPartId.localeCompare(b.productionPartId);
    return idDiff !== 0 ? idDiff : a.instanceIndex - b.instanceIndex;
  });

  const sheets: Sheet[] = [];
  for (const instance of instances) {
    if (instance.length <= 0 || instance.width <= 0) {
      unplaced.push({
        productionPartId: instance.productionPartId,
        instanceIndex: instance.instanceIndex,
        sourcePartId: instance.sourcePartId,
        reason: 'INVALID_DIMENSIONS',
        detail: `Размер заготовки ${String(instance.length)}×${String(instance.width)} мм не положителен.`,
      });
      continue;
    }

    let candidate = bestCandidate(instance, sheets);
    if (candidate === undefined) {
      // Ни один начатый лист не подошёл — пробуем чистый.
      const fresh = newSheet(sheets.length, usable);
      candidate = bestCandidate(instance, [fresh]);
      if (candidate === undefined) {
        unplaced.push({
          productionPartId: instance.productionPartId,
          instanceIndex: instance.instanceIndex,
          sourcePartId: instance.sourcePartId,
          reason: 'TOO_LARGE',
          detail: `Деталь ${String(instance.length)}×${String(instance.width)} мм не помещается в рабочую область ${String(usable.length)}×${String(usable.width)} мм${instance.rotationAllowed ? '' : ' (поворот запрещён текстурой или политикой раскроя)'}.`,
        });
        continue;
      }
      sheets.push(fresh);
    }

    const sheet = candidate.sheet;
    const rect = sheet.free[candidate.rectIndex];
    if (rect === undefined) continue;
    sheet.placements.push({
      id: `pl:${String(sheet.index)}/${instance.productionPartId}/${String(instance.instanceIndex)}`,
      productionPartId: instance.productionPartId,
      instanceIndex: instance.instanceIndex,
      sourcePartId: instance.sourcePartId,
      x: rect.x,
      y: rect.y,
      width: candidate.w,
      height: candidate.h,
      rotation: candidate.rotation,
    });
    sheet.free.splice(candidate.rectIndex, 1, ...splitRect(rect, candidate.w, candidate.h, stock.kerf));
  }

  const stockArea = stock.length * stock.width;
  const usableArea = usable.length * usable.width;
  const layouts: CuttingLayout[] = sheets.map((sheet) => {
    const usedArea = sheet.placements.reduce((sum, p) => sum + p.width * p.height, 0);
    const warnings: Issue[] = [];
    if (sheet.placements.length === 0) {
      warnings.push(issue('CUTTING_EMPTY_SHEET', 'warning', 'Лист открыт, но ни одна деталь на него не легла.'));
    }
    return {
      id: `layout:${stock.id}/${String(sheet.index)}`,
      stockId: stock.id,
      stock,
      placements: sheet.placements,
      usedArea,
      stockArea,
      usableArea,
      wasteArea: stockArea - usedArea,
      utilization: stockArea > 0 ? usedArea / stockArea : 0,
      warnings,
    };
  });

  return { layouts, unplaced };
}
