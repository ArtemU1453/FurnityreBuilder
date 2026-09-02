import type { Box3, Issue, Part, Severity } from '../domain/index.js';
import { isFiniteBox3, issue } from '../domain/index.js';
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

  finish(pendingStages: readonly string[]): GeometryResult {
    return Object.freeze({
      parts: Object.freeze([...this.parts]),
      cells: Object.freeze([...this.cells]),
      bounds: this.bounds,
      innerVolume: this.innerVolume,
      diagnostics: Object.freeze([...this.diagnostics]),
      pendingStages: Object.freeze([...pendingStages]),
    });
  }
}

export interface GeometryStage {
  readonly name: string;
  run(ctx: GeometryContext): void;
}
