import type { BackPanelMount, Box3, MaterialId, Mm, NodeId } from '../domain/index.js';
import { roundMm } from '../domain/index.js';
import type { SectionBox } from './types.js';

/**
 * Контракт задней стенки: Carcass + BackPanelSpec → Part (PROMPT 14).
 *
 * ## Почему не заводится «BackWallConfig»
 *
 * `BackPanelSpec { mount, materialId, segmentation }` существует с PROMPT 1
 * (`docs/DATA_MODEL.md` §8), и в нём уже есть всё, что PROMPT 14 §2 просит
 * от `BackWallConfig`: наличие (`mount.kind === 'none'`), материал,
 * толщина (внутри варианта `mount`), положение (сам вариант `mount`) и
 * способ разделения (`segmentation`). Вторая конфигурация рядом означала бы
 * два источника истины для одной детали — тот же довод, которым PROMPT 10
 * отклонил `DoorContent` рядом с `FacadeGroup`, а PROMPT 13 — второй
 * Material Registry рядом с `MaterialLibrary`.
 *
 * ## Положение = вариант монтажа, а не отдельная ось настроек
 *
 * `BackPanelMount` — дискриминированное объединение, и каждый вариант
 * задаёт СВОЮ рамку детали (формулы — `docs/GEOMETRY_RULES.md` §22):
 *   `none`          детали нет;
 *   `overlay`       накладная снаружи: рамка — весь корпус (OUTSIDE);
 *   `inset-flush`   вкладная заподлицо: рамка — внутренний проём (INSIDE);
 *   `inset-groove`  в паз: внутренний проём + заход в паз с каждой стороны.
 * Варианта «CENTER» нет: он не подтверждён (`T-CAR-04`) и физического
 * смысла для листовой задней стенки не имеет.
 *
 * Z-координата приходит из уже посчитанной `resolveBackGeometry`
 * (`stages/carcass.ts`) — второй формулы глубины здесь не появляется.
 */

export type BackWallStatus = 'none' | 'built' | 'invalid';

export interface BackWallGeometry {
  /** Идентичность сегмента: `NodeId` секции, либо `undefined` для цельной стенки. */
  readonly sectionId?: NodeId;
  readonly x: Mm;
  readonly y: Mm;
  readonly z: Mm;
  readonly width: Mm;
  readonly height: Mm;
  readonly thickness: Mm;
}

export interface BackWallGeometryResolution {
  readonly status: BackWallStatus;
  readonly panels: readonly BackWallGeometry[];
  /** Человекочитаемое «почему не построено» — только для `invalid`. */
  readonly missing?: string;
}

export interface BackWallFrame {
  /** Габарит корпуса по X (W). */
  readonly carcassWidth: Mm;
  /** Низ и верх корпуса по Y (с учётом цоколя). */
  readonly carcassY0: Mm;
  readonly carcassY1: Mm;
  /** Внутренний объём — рамка для вкладных вариантов. */
  readonly inner: Box3;
  /** Передняя граница внутреннего объёма по Z (`resolveBackGeometry.innerZ0`). */
  readonly innerZ0: Mm;
}

export interface BackWallInput {
  readonly mount: BackPanelMount;
  readonly segmentation: 'single' | 'per-section';
  readonly materialId: MaterialId;
  readonly frame: BackWallFrame;
  /** Секции корпуса — нужны только при `segmentation === 'per-section'`. */
  readonly sections: readonly SectionBox[];
}

/** Рамка детали задней стенки в мировых координатах для данного монтажа. */
function panelFrame(input: BackWallInput): { x0: Mm; x1: Mm; y0: Mm; y1: Mm; z: Mm; thickness: Mm } | undefined {
  const { mount, frame } = input;
  if (mount.kind === 'none') return undefined;

  const thickness = roundMm(mount.thickness);

  if (mount.kind === 'overlay') {
    // Накладная стенка закрывает корпус целиком, включая торцы боковин,
    // крышки и дна: рамка — габарит корпуса, а не внутренний проём.
    return {
      x0: 0,
      x1: roundMm(frame.carcassWidth),
      y0: roundMm(frame.carcassY0),
      y1: roundMm(frame.carcassY1),
      z: 0,
      thickness,
    };
  }

  // Вкладные варианты стоят во внутреннем проёме; в паз деталь заходит на
  // `grooveDepth` с каждой стороны, поэтому её рамка на эту величину больше.
  const grooveDepth = mount.kind === 'inset-groove' ? roundMm(mount.grooveDepth) : 0;
  const inner = frame.inner;
  return {
    x0: roundMm(inner.min.x - grooveDepth),
    x1: roundMm(inner.min.x + inner.size.x + grooveDepth),
    y0: roundMm(inner.min.y - grooveDepth),
    y1: roundMm(inner.min.y + inner.size.y + grooveDepth),
    z: roundMm(frame.innerZ0 - thickness),
    thickness,
  };
}

/**
 * Границы сегментов по X при разделении по секциям.
 *
 * Внешние края берутся у самой рамки задней стенки, внутренние проходят
 * по СЕРЕДИНЕ промежутка между соседними секциями — то есть по центру
 * перегородки, к которой сегменты и крепятся. Так сегменты покрывают
 * рамку целиком и не пересекаются между собой (PROMPT 14 §7):
 * `ASSUMPTION(T-BACK-01)` — размер детали референсом не подтверждён,
 * подтверждена только необходимость самого разделения (`T-CAR-04`).
 */
function segmentBoundaries(sections: readonly SectionBox[], x0: Mm, x1: Mm): Mm[] {
  const sorted = [...sections].sort((a, b) => a.box.min.x - b.box.min.x);
  const bounds: Mm[] = [x0];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gapStart = prev.box.min.x + prev.box.size.x;
    bounds.push(roundMm((gapStart + cur.box.min.x) / 2));
  }
  bounds.push(x1);
  return bounds;
}

export function resolveBackWallGeometry(input: BackWallInput): BackWallGeometryResolution {
  const frame = panelFrame(input);
  if (frame === undefined) return { status: 'none', panels: [] };

  if (!(frame.thickness > 0)) {
    return { status: 'invalid', panels: [], missing: 'толщина задней стенки не положительна' };
  }

  const width = roundMm(frame.x1 - frame.x0);
  const height = roundMm(frame.y1 - frame.y0);
  if (!(width > 0) || !(height > 0)) {
    return { status: 'invalid', panels: [], missing: 'задняя стенка не помещается: ширина или высота не положительна' };
  }

  if (input.segmentation === 'single' || input.sections.length <= 1) {
    // Одна секция — разделять нечего: `per-section` вырождается в цельную
    // панель, а не даёт сегмент-дубликат с другим id.
    return {
      status: 'built',
      panels: [{ x: frame.x0, y: frame.y0, z: frame.z, width, height, thickness: frame.thickness }],
    };
  }

  const sorted = [...input.sections].sort((a, b) => a.box.min.x - b.box.min.x);
  const bounds = segmentBoundaries(sorted, frame.x0, frame.x1);
  const panels: BackWallGeometry[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const left = bounds[i];
    const right = bounds[i + 1];
    const section = sorted[i];
    if (left === undefined || right === undefined || section === undefined) continue;
    const segmentWidth = roundMm(right - left);
    if (!(segmentWidth > 0)) {
      return {
        status: 'invalid',
        panels: [],
        missing: 'сегмент задней стенки получил неположительную ширину',
      };
    }
    panels.push({
      sectionId: section.nodeId,
      x: left,
      y: frame.y0,
      z: frame.z,
      width: segmentWidth,
      height,
      thickness: frame.thickness,
    });
  }

  return { status: 'built', panels };
}
