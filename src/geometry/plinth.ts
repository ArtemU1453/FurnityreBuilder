import type { BaseSpec, Mm, PlinthPartKind } from '../domain/index.js';
import { roundMm } from '../domain/index.js';

/**
 * Контракт цоколя: BaseSpec + рамка корпуса → Parts (PROMPT 14 §9, §12).
 *
 * ## Почему не заводится «PlinthConfig»
 *
 * `BaseSpec { kind, height, setback, legCount? }` существует с PROMPT 1
 * (`docs/DATA_MODEL.md` §8) и уже описывает наличие, высоту и отступ.
 * PROMPT 14 добавил в него `parts`, `cutout`, `materialId`, `thickness`
 * и `edge` — но именно в него, а не в параллельную конфигурацию: цоколь
 * у изделия один, и двух его описаний быть не должно.
 *
 * ## Состав царг не угадывается
 *
 * `ASSUMPTION(T-BASE-01)`: какие царги ставит референс — только переднюю,
 * П-образную сборку или раму целиком — не подтверждено. Поэтому
 * `BaseSpec.parts` перечисляет их явно, а пустой (или незаданный) список
 * даёт цоколь как ВЫСОТУ без единой детали: высота уже влияет на корпус
 * (`resolveBasePlacement`, `stages/carcass.ts`), а придумывать за
 * пользователя конструкцию — ровно то, что PROMPT 14 §12 запрещает
 * («не создавать эти элементы автоматически без подтверждения»).
 *
 * ## Вырез
 *
 * Вырез (`ASSUMPTION(T-BASE-02)`) уменьшает переднюю царгу. Если он идёт
 * на всю высоту цоколя, царга физически распадается на две детали — их и
 * возвращает резолвер. Частичный вырез (ниже высоты цоколя) — это ПАЗ в
 * одной детали, а не две детали: прямоугольная модель `Part` его выразить
 * не может, поэтому царга остаётся целой, а вызывающая сторона сообщает
 * `PLINTH_CUTOUT_NOT_IMPLEMENTED`. Соврать здесь двумя деталями значило бы
 * выдать в деталировку конструкцию, которой нет.
 */

export type PlinthStatus = 'none' | 'built' | 'invalid';

export interface PlinthGeometry {
  readonly kind: PlinthPartKind;
  /** Порядковый номер детали этого вида: вырез делит переднюю царгу на две. */
  readonly index: number;
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly depth: Mm;
}

export interface PlinthGeometryResolution {
  readonly status: PlinthStatus;
  readonly parts: readonly PlinthGeometry[];
  /** Вырез задан, но выражается пазом, а не отдельными деталями. */
  readonly cutoutNotImplemented: boolean;
  readonly missing?: string;
}

export interface PlinthFrame {
  /** Габарит изделия по X. */
  readonly carcassWidth: Mm;
  /** Задняя и передняя плоскости корпуса по Z. */
  readonly carcassZ0: Mm;
  readonly carcassDepth: Mm;
}

/**
 * Геометрия цоколя.
 *
 * Чистая функция: одинаковый вход даёт одинаковый результат, координаты
 * полностью выводятся из рамки корпуса и `BaseSpec` — собственных X/Y/Z
 * цоколь не хранит (PROMPT 14 §9: «не создавать независимые координаты
 * цоколя»).
 *
 * Формулы — `docs/GEOMETRY_RULES.md` §23.
 */
export function resolvePlinthGeometry(
  base: BaseSpec | undefined,
  frame: PlinthFrame,
  thickness: Mm,
): PlinthGeometryResolution {
  if (base === undefined || base.kind !== 'plinth' || !(base.height > 0)) {
    return { status: 'none', parts: [], cutoutNotImplemented: false };
  }

  const height = roundMm(base.height);
  const setback = roundMm(base.setback);
  const t = roundMm(thickness);
  const W = roundMm(frame.carcassWidth);
  const z0 = roundMm(frame.carcassZ0);
  const zFront = roundMm(z0 + frame.carcassDepth - setback);

  if (!(t > 0)) {
    return { status: 'invalid', parts: [], cutoutNotImplemented: false, missing: 'толщина царги цоколя не положительна' };
  }
  if (setback < 0) {
    return { status: 'invalid', parts: [], cutoutNotImplemented: false, missing: 'отступ цоколя отрицателен' };
  }
  if (!(zFront - z0 > 0)) {
    return {
      status: 'invalid',
      parts: [],
      cutoutNotImplemented: false,
      missing: 'отступ цоколя не меньше глубины корпуса: цоколю не остаётся места',
    };
  }

  const kinds = base.parts ?? [];
  if (kinds.length === 0) {
    // Цоколь есть как высота, деталей нет — см. T-BASE-01.
    return { status: 'built', parts: [], cutoutNotImplemented: false };
  }

  const hasLeft = kinds.includes('left');
  const hasRight = kinds.includes('right');
  const parts: PlinthGeometry[] = [];

  // Боковые царги идут вдоль Z от задней плоскости корпуса до передней
  // грани цоколя; передняя и задняя царги встают МЕЖДУ ними, если они есть.
  const innerX0 = hasLeft ? t : 0;
  const innerX1 = hasRight ? roundMm(W - t) : W;
  const spanWidth = roundMm(innerX1 - innerX0);
  const sideDepth = roundMm(zFront - z0);

  if (!(spanWidth > 0)) {
    return {
      status: 'invalid',
      parts: [],
      cutoutNotImplemented: false,
      missing: 'боковые царги цоколя не оставляют места передней царге',
    };
  }

  if (hasLeft) {
    parts.push({ kind: 'left', index: 0, x: 0, y: 0, z: z0, width: t, height, depth: sideDepth });
  }
  if (hasRight) {
    parts.push({ kind: 'right', index: 0, x: roundMm(W - t), y: 0, z: z0, width: t, height, depth: sideDepth });
  }
  if (kinds.includes('rear')) {
    parts.push({ kind: 'rear', index: 0, x: innerX0, y: 0, z: z0, width: spanWidth, height, depth: t });
  }

  if (kinds.includes('front')) {
    const zFrontBoard = roundMm(zFront - t);
    const cutout = base.cutout;

    if (cutout === undefined) {
      parts.push({ kind: 'front', index: 0, x: innerX0, y: 0, z: zFrontBoard, width: spanWidth, height, depth: t });
      return { status: 'built', parts, cutoutNotImplemented: false };
    }

    const left = roundMm(cutout.left);
    const right = roundMm(cutout.right);
    const cutHeight = roundMm(cutout.height);

    if (left < 0 || right < 0 || !(cutHeight > 0)) {
      return { status: 'invalid', parts: [], cutoutNotImplemented: false, missing: 'параметры выреза цоколя недопустимы' };
    }
    if (cutHeight > height) {
      return { status: 'invalid', parts: [], cutoutNotImplemented: false, missing: 'вырез цоколя выше самого цоколя' };
    }
    if (!(roundMm(spanWidth - left - right) > 0)) {
      return {
        status: 'invalid',
        parts: [],
        cutoutNotImplemented: false,
        missing: 'вырез цоколя не оставляет материала передней царге',
      };
    }

    if (cutHeight < height) {
      // Паз в одной детали: прямоугольная модель `Part` его не выражает.
      parts.push({ kind: 'front', index: 0, x: innerX0, y: 0, z: zFrontBoard, width: spanWidth, height, depth: t });
      return { status: 'built', parts, cutoutNotImplemented: true };
    }

    // Вырез на всю высоту — передняя царга физически распадается на две.
    if (left > 0) {
      parts.push({ kind: 'front', index: 0, x: innerX0, y: 0, z: zFrontBoard, width: left, height, depth: t });
    }
    if (right > 0) {
      parts.push({
        kind: 'front',
        index: 1,
        x: roundMm(innerX1 - right),
        y: 0,
        z: zFrontBoard,
        width: right,
        height,
        depth: t,
      });
    }
  }

  return { status: 'built', parts, cutoutNotImplemented: false };
}
