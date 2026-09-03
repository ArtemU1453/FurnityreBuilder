import type { Part, PartId } from '../domain/index.js';
import { overlaps } from '../domain/index.js';

/**
 * Поиск деталей, которые занимают один и тот же объём (PROMPT 7 §19).
 *
 * Чистая функция над уже посчитанным результатом, а не этап конвейера —
 * и это осознанное решение, а не упущение:
 *
 * 1. Проверка квадратична по числу деталей. Конвейер запускается на КАЖДОЕ
 *    нажатие в поле габарита (`docs/INTERACTION_MODEL.md` §4.4, без
 *    debounce), а изделие с сеткой и полками легко даёт сотни деталей.
 *    Платить квадратом на каждый символ ради инварианта, который держится
 *    по построению, — ровно тот случай, против которого в проекте заведён
 *    дымовой тест производительности.
 * 2. У проверки уже есть назначенное место в плане: `VAL-05` «Пересечение
 *    деталей» в `docs/FEATURE_MATRIX.md` — слой валидации, а не движок.
 *    Эта функция и есть та геометрия, которую `VAL-05` вызовет, когда до
 *    него дойдёт очередь; заводить её второй раз не придётся.
 *
 * Сейчас она вызывается тестами: инвариант «ни одна деталь не пересекает
 * другую» проверяется на всех конфигурациях, которые строит движок, —
 * включая перегородки, полки и вложенные деления
 * (`tests/unit/geometry/partitions.test.ts`).
 *
 * Касание гранями (полка вплотную к перегородке, дно к боковине) —
 * законный конструктивный контакт и пересечением НЕ считается: см.
 * `overlaps()` в `src/domain/coordinates.ts`, где сравнение идёт с общим
 * допуском `MM_EPSILON`, а не «строго больше нуля».
 */
export interface PartOverlap {
  readonly a: PartId;
  readonly b: PartId;
  readonly labels: readonly [string, string];
}

export function findPartOverlaps(parts: readonly Part[]): PartOverlap[] {
  const found: PartOverlap[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const a = parts[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < parts.length; j += 1) {
      const b = parts[j];
      if (b === undefined) continue;
      if (overlaps({ min: a.position, size: a.size }, { min: b.position, size: b.size })) {
        found.push({ a: a.id, b: b.id, labels: [a.label, b.label] });
      }
    }
  }
  return found;
}
