import type { Box3, Issue, Part, PartId, Severity } from '../domain/index.js';
import { hasErrors, isFiniteBox3, issue } from '../domain/index.js';
import { computeBoundingBox } from './bounding-box.js';
import type { CellBox, GeometryInput, GeometryResult } from './types.js';

/**
 * Изменяемый аккумулятор одного прогона движка.
 *
 * Мутабельность здесь безопасна и намеренна: контекст живёт внутри одного
 * синхронного вызова `buildGeometry` и наружу выходит только замороженный
 * результат. Иммутабельность нужна доменной модели, а не локальному счётчику.
 */
export class GeometryContext {
  readonly input: GeometryInput;

  private readonly parts: Part[] = [];
  private readonly cells: CellBox[] = [];
  private readonly diagnostics: Issue[] = [];

  bounds: Box3;
  innerVolume: Box3;

  constructor(input: GeometryInput, bounds: Box3) {
    this.input = input;
    this.bounds = bounds;
    this.innerVolume = bounds;
  }

  /**
   * Единственная дверь для детали. Здесь же стоит проверка на NaN/Infinity:
   * повреждённое значение не должно уйти в деталировку и всплыть в PDF.
   *
   * Остальные геометрические инварианты (уникальность ID, положительность
   * размера, неотрицательность координаты) проверяются один раз в `finish()`,
   * а не здесь — деталь, битую по этим правилам, всё равно может быть полезно
   * увидеть в частичном результате отладки. О NaN/Infinity так сказать нельзя:
   * они разрушают любую дальнейшую арифметику (сумму, bounding box), поэтому
   * отсекаются немедленно, на входе.
   */
  addPart(part: Part): void {
    if (!isFiniteBox3({ min: part.position, size: part.size })) {
      this.report(
        'PART_NOT_FINITE',
        'error',
        `Деталь «${part.label}» получила нечисловой размер или позицию.`,
      );
      return;
    }
    this.parts.push(part);
  }

  addCell(cell: CellBox): void {
    this.cells.push(cell);
  }

  report(code: string, severity: Severity, message: string, target?: Issue['target']): void {
    this.diagnostics.push(issue(code, severity, message, target));
  }

  /**
   * true, если среди уже накопленных диагностик есть хотя бы одна ошибка.
   *
   * Конвейер (`engine.ts`) читает этот флаг между этапами: как только он
   * становится истинным, дальнейшие этапы не запускаются. Геометрия не
   * пытается достроиться поверх данных, уже признанных непригодными — деталь
   * с координатой, посчитанной из отрицательной ширины, хуже, чем её отсутствие.
   */
  hasFatalError(): boolean {
    return hasErrors(this.diagnostics);
  }

  /**
   * Финальная проверка инвариантов результата и сборка `GeometryResult`.
   *
   * Деталь, нарушающая инвариант, из результата ИСКЛЮЧАЕТСЯ — тем же
   * способом, каким `addPart` уже исключает нечисловые детали. Гарантия
   * получается сильнее: «если деталь попала в `GeometryResult.parts`, она
   * прошла все проверки», независимо от того, какой этап её произвёл. Это
   * особенно важно на будущее: наполнение, фасады и фурнитура (этапы 09–24)
   * добавляют детали через тот же `addPart` и получают эту защиту бесплатно,
   * без необходимости дублировать проверки в каждом этапе.
   */
  finish(pendingStages: readonly string[]): GeometryResult {
    const seenIds = new Set<PartId>();
    const validParts: Part[] = [];

    for (const part of this.parts) {
      if (seenIds.has(part.id)) {
        this.report(
          'PART_ID_DUPLICATE',
          'error',
          `Повторяющийся идентификатор детали: «${part.id}» (деталь «${part.label}»).`,
          { partId: part.id },
        );
        continue;
      }

      if (part.size.x <= 0 || part.size.y <= 0 || part.size.z <= 0) {
        this.report(
          'PART_SIZE_NOT_POSITIVE',
          'error',
          `Деталь «${part.label}» получила неположительный размер.`,
          { partId: part.id },
        );
        continue;
      }

      // Начало координат — левый–нижний–задний угол габарита изделия целиком
      // (docs/COORDINATE_SYSTEM.md §1). Отрицательная координата означает,
      // что деталь вышла за пределы изделия — это всегда ошибка формулы,
      // а не легитимное положение.
      if (part.position.x < 0 || part.position.y < 0 || part.position.z < 0) {
        this.report(
          'PART_POSITION_NEGATIVE',
          'error',
          `Деталь «${part.label}» получила отрицательную координату.`,
          { partId: part.id },
        );
        continue;
      }

      seenIds.add(part.id);
      validParts.push(part);
    }

    return Object.freeze({
      parts: Object.freeze(validParts),
      cells: Object.freeze([...this.cells]),
      bounds: this.bounds,
      innerVolume: this.innerVolume,
      boundingBox: computeBoundingBox(validParts),
      diagnostics: Object.freeze([...this.diagnostics]),
      pendingStages: Object.freeze([...pendingStages]),
    });
  }
}

export interface GeometryStage {
  readonly name: string;
  run(ctx: GeometryContext): void;
}
