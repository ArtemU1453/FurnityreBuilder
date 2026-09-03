import { issue } from '../domain/index.js';
import type { Issue, Part } from '../domain/index.js';
import type { ProductionPart } from '../production/index.js';
import type { DrillingOperation } from './types.js';
import { faceFrame } from './faces.js';

/**
 * Проверки присадки (PROMPT 18 §18–§20).
 *
 * Проверяется собственный результат движка: ошибка здесь означает ошибку
 * правила, а не ввода пользователя. Отверстие, вышедшее за деталь или
 * глубже её толщины, — это испорченная заготовка, и «на схеме выглядит
 * нормально» тут не критерий (§20).
 *
 * ## Ошибка или предупреждение
 *
 * `error` — брак: отверстие вне детали, глубина больше материала, ссылка
 * на несуществующую деталь, пересечение отверстий. Такое сверлить нельзя.
 * `warning` — вероятная проблема, о которой должен знать технолог: близко
 * к краю (норма не подтверждена), близко к соседнему отверстию.
 */

const EPSILON = 0.001;

/**
 * Минимальные технологические расстояния.
 *
 * `undefined` намеренно: §19 запрещает придумывать безопасные расстояния,
 * а референс их не подтвердил (`T-DRILL-05`). Архитектура проверки готова —
 * заполнение константы включает её без изменения алгоритма.
 */
export interface DrillingClearances {
  /** Минимальное расстояние от края отверстия до края детали. */
  readonly edgeDistance: number;
  /** Минимальное расстояние между краями соседних отверстий. */
  readonly holeDistance: number;
}

export const DRILLING_CLEARANCES: DrillingClearances | undefined = undefined;

function clearances(): DrillingClearances | undefined {
  return DRILLING_CLEARANCES;
}

/** Геометрия отверстия и детали: всё, что нужно проверкам. */
export function validateOperation(
  operation: DrillingOperation,
  part: Part | undefined,
  production: ProductionPart | undefined,
): Issue[] {
  const errors: Issue[] = [];
  const where = `Операция «${operation.id}»`;

  if (part === undefined) {
    errors.push(
      issue('DRILLING_PART_NOT_FOUND', 'error', `${where} ссылается на деталь «${String(operation.sourcePartId)}», которой нет в геометрии.`),
    );
    return errors;
  }
  if (production === undefined) {
    errors.push(
      issue('DRILLING_PRODUCTION_PART_NOT_FOUND', 'error', `${where} ссылается на производственную позицию «${operation.productionPartId}», которой нет в раскрое.`),
    );
  }

  if (!(operation.diameter > 0)) {
    errors.push(issue('DRILLING_DIAMETER_INVALID', 'error', `${where}: диаметр ${String(operation.diameter)} мм не положителен.`));
  }

  const frame = faceFrame(part, operation.face);
  const radius = operation.diameter / 2;

  // Отверстие целиком внутри грани: проверяется КРАЙ отверстия, а не его
  // центр — центр в пределах детали ещё ничего не гарантирует.
  if (
    operation.x - radius < -EPSILON ||
    operation.y - radius < -EPSILON ||
    operation.x + radius > frame.extentX + EPSILON ||
    operation.y + radius > frame.extentY + EPSILON
  ) {
    errors.push(
      issue(
        'DRILLING_OUT_OF_PART',
        'error',
        `${where} выходит за деталь «${part.label}»: центр (${String(operation.x)}, ${String(operation.y)}) при Ø${String(operation.diameter)} на грани ${operation.face} размером ${String(frame.extentX)}×${String(frame.extentY)} мм.`,
        { partId: part.id },
      ),
    );
  }

  // Глубина (§18). Сквозное отверстие обязано пройти материал насквозь,
  // глухое — остаться внутри него.
  if (!(operation.depth > 0)) {
    errors.push(issue('DRILLING_DEPTH_INVALID', 'error', `${where}: глубина ${String(operation.depth)} мм не положительна.`));
  } else if (operation.through === 'blind' && operation.depth > frame.available + EPSILON) {
    errors.push(
      issue(
        'DRILLING_DEPTH_EXCEEDS_MATERIAL',
        'error',
        `${where}: глухое отверстие глубиной ${String(operation.depth)} мм в материале толщиной ${String(frame.available)} мм.`,
        { partId: part.id },
      ),
    );
  } else if (operation.through === 'through' && operation.depth < frame.available - EPSILON) {
    errors.push(
      issue(
        'DRILLING_THROUGH_TOO_SHALLOW',
        'error',
        `${where}: сквозное отверстие глубиной ${String(operation.depth)} мм не проходит материал толщиной ${String(frame.available)} мм.`,
        { partId: part.id },
      ),
    );
  }

  // Расстояние до края (§19). Норма не подтверждена — при отсутствии
  // константы проверка не выполняется вовсе, а не подменяется догадкой.
  const limits = clearances();
  if (limits !== undefined) {
    const margin = Math.min(operation.x - radius, operation.y - radius, frame.extentX - operation.x - radius, frame.extentY - operation.y - radius);
    if (margin < limits.edgeDistance) {
      errors.push(
        issue('DRILLING_TOO_CLOSE_TO_EDGE', 'warning', `${where}: до края детали ${String(Math.round(margin))} мм при минимуме ${String(limits.edgeDistance)} мм.`),
      );
    }
  }

  return errors;
}

/**
 * Пересечения отверстий на одной грани одной детали (§20).
 *
 * Два отверстия пересекаются, если расстояние между центрами меньше суммы
 * радиусов. Разные грани не сравниваются: отверстие в пласти и отверстие в
 * торце физически могут встретиться внутри детали, но эта проверка
 * требует подтверждённых глубин обоих и относится к `T-DRILL-05`.
 */
export function validateCollisions(operations: readonly DrillingOperation[]): Issue[] {
  const errors: Issue[] = [];
  const limits = clearances();

  for (let i = 0; i < operations.length; i += 1) {
    for (let j = i + 1; j < operations.length; j += 1) {
      const a = operations[i];
      const b = operations[j];
      if (a === undefined || b === undefined) continue;
      if (a.sourcePartId !== b.sourcePartId || a.face !== b.face) continue;

      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const gap = distance - (a.diameter + b.diameter) / 2;
      if (gap < -EPSILON) {
        errors.push(
          issue(
            'DRILLING_HOLES_OVERLAP',
            'error',
            `Операции «${a.id}» и «${b.id}» пересекаются на грани ${a.face}: расстояние между центрами ${String(Math.round(distance))} мм при радиусах ${String(a.diameter / 2)} и ${String(b.diameter / 2)} мм.`,
          ),
        );
      } else if (limits !== undefined && gap < limits.holeDistance) {
        errors.push(
          issue('DRILLING_HOLES_TOO_CLOSE', 'warning', `Операции «${a.id}» и «${b.id}»: между краями ${String(Math.round(gap))} мм при минимуме ${String(limits.holeDistance)} мм.`),
        );
      }
    }
  }
  return errors;
}
