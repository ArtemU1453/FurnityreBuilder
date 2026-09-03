import type { Box3, Issue, NodeId, Part, PartId, Severity } from '../domain/index.js';
import { hasErrors, isFiniteBox3, issue } from '../domain/index.js';
import { computeBoundingBox } from './bounding-box.js';
import type { CellBox, GeometryInput, GeometryResult, SectionBox } from './types.js';

/** Причина отказа геометрического тела (детали или ячейки) финальной проверкой. */
type SanityFailure = 'size' | 'position';

/** Проверяет положительность размера и неотрицательность координаты. NaN/Infinity уже отсечены на входе. */
function checkSanity(box: Box3): SanityFailure | undefined {
  if (box.size.x <= 0 || box.size.y <= 0 || box.size.z <= 0) return 'size';
  if (box.min.x < 0 || box.min.y < 0 || box.min.z < 0) return 'position';
  return undefined;
}

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
  private readonly sections: SectionBox[] = [];
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

  /** Симметрично `addPart`: то же немедленное отсечение NaN/Infinity, тот же принцип. */
  addSection(section: SectionBox): void {
    if (!isFiniteBox3(section.box)) {
      this.report(
        'SECTION_NOT_FINITE',
        'error',
        `Секция «${section.nodeId}» получила нечисловые координаты или размер.`,
        { nodeId: section.nodeId },
      );
      return;
    }
    this.sections.push(section);
  }

  /** Симметрично `addPart`: то же немедленное отсечение NaN/Infinity, тот же принцип. */
  addCell(cell: CellBox): void {
    if (!isFiniteBox3(cell.box)) {
      this.report(
        'CELL_NOT_FINITE',
        'error',
        `Ячейка «${cell.nodeId}» получила нечисловые координаты или размер.`,
        { nodeId: cell.nodeId },
      );
      return;
    }
    this.cells.push(cell);
  }

  report(code: string, severity: Severity, message: string, target?: Issue['target']): void {
    this.diagnostics.push(issue(code, severity, message, target));
  }

  /**
   * Ячейки, накопленные предыдущими этапами (сейчас — только `layout`).
   *
   * Нужно `fill` (PROMPT 6): вместо повторного обхода дерева `SplitNode`
   * (тот же `resolveSizes` на каждом делении, уже выполненный `layout`)
   * этап читает уже готовые `box` через эту точку и находит соответствующий
   * `LeafNode` по `cell.nodeId` (`findNode`, `domain/furniture/tree.ts`).
   * Дублирование обхода дерева было бы тем же классом решения, которого
   * проект уже избежал при объединении `layout`+`dividers` — см.
   * `docs/GEOMETRY_RULES.md` §9.7.
   */
  getCells(): readonly CellBox[] {
    return this.cells;
  }

  /**
   * Секции, построенные `layout`. Симметрично `getCells()` и по той же
   * причине: этапу `back` (PROMPT 14) нужны границы секций, чтобы разделить
   * заднюю стенку по ним — второго обхода дерева ради тех же чисел в проекте
   * не заводится (`docs/GEOMETRY_RULES.md` §22.4).
   */
  getSections(): readonly SectionBox[] {
    return this.sections;
  }

  /**
   * true, если среди уже накопленных диагностик есть хотя бы одна ошибка.
   *
   * Конвейер (`engine.ts`) читает этот флаг между этапами: как только он
   * становится истинным, дальнейшие этапы не запускаются. Геометрия не
   * пытается достроиться поверх данных, уже признанных непригодными — деталь
   * с координатой, посчитанной из отрицательной ширины, хуже, чем её отсутствие.
   *
   * Внутри ОДНОГО этапа (например, `layout`, при обходе дерева секций)
   * это правило действует мягче: одна испорченная ветка дерева останавливает
   * только себя, а не весь расчёт — см. `stages/layout.ts`. Между этапами
   * компромиссов нет: `carcass` не запускается, если `normalize` сообщил
   * об ошибке.
   */
  hasFatalError(): boolean {
    return hasErrors(this.diagnostics);
  }

  /**
   * Финальная проверка инвариантов результата и сборка `GeometryResult`.
   *
   * Деталь или ячейка, нарушающая инвариант, из результата ИСКЛЮЧАЕТСЯ — тем
   * же способом, каким `addPart`/`addCell` уже исключают нечисловые значения.
   * Гарантия получается сильнее: «если деталь или ячейка попала в результат,
   * она прошла все проверки», независимо от того, какой этап её произвёл.
   * Это важно на будущее: наполнение, фасады и фурнитура (этапы 11+) шлют
   * детали через тот же `addPart` и получают эту защиту бесплатно, без
   * необходимости дублировать проверки в каждом новом этапе.
   */
  finish(pendingStages: readonly string[]): GeometryResult {
    const seenPartIds = new Set<PartId>();
    const validParts: Part[] = [];

    for (const part of this.parts) {
      if (seenPartIds.has(part.id)) {
        this.report(
          'PART_ID_DUPLICATE',
          'error',
          `Повторяющийся идентификатор детали: «${part.id}» (деталь «${part.label}»).`,
          { partId: part.id },
        );
        continue;
      }

      const failure = checkSanity({ min: part.position, size: part.size });
      if (failure === 'size') {
        this.report(
          'PART_SIZE_NOT_POSITIVE',
          'error',
          `Деталь «${part.label}» получила неположительный размер.`,
          { partId: part.id },
        );
        continue;
      }
      if (failure === 'position') {
        // Начало координат — левый–нижний–задний угол габарита изделия
        // целиком (docs/COORDINATE_SYSTEM.md §1). Отрицательная координата
        // означает, что деталь вышла за пределы изделия — это всегда ошибка
        // формулы, а не легитимное положение.
        this.report(
          'PART_POSITION_NEGATIVE',
          'error',
          `Деталь «${part.label}» получила отрицательную координату.`,
          { partId: part.id },
        );
        continue;
      }

      seenPartIds.add(part.id);
      validParts.push(part);
    }

    const seenCellIds = new Set<NodeId>();
    const validCells: CellBox[] = [];

    for (const cell of this.cells) {
      if (seenCellIds.has(cell.nodeId)) {
        this.report(
          'CELL_ID_DUPLICATE',
          'error',
          `Повторяющийся идентификатор ячейки: «${cell.nodeId}».`,
          { nodeId: cell.nodeId },
        );
        continue;
      }

      const failure = checkSanity(cell.box);
      if (failure === 'size') {
        this.report(
          'CELL_SIZE_NOT_POSITIVE',
          'error',
          `Ячейка «${cell.nodeId}» получила неположительный размер.`,
          { nodeId: cell.nodeId },
        );
        continue;
      }
      if (failure === 'position') {
        this.report(
          'CELL_POSITION_NEGATIVE',
          'error',
          `Ячейка «${cell.nodeId}» получила отрицательную координату.`,
          { nodeId: cell.nodeId },
        );
        continue;
      }

      seenCellIds.add(cell.nodeId);
      validCells.push(cell);
    }

    // Секции проходят те же три проверки, что детали и ячейки: уникальность
    // идентификатора, положительность размера, неотрицательность координаты.
    // Симметрия здесь не украшение — она означает, что потребитель результата
    // может рассчитывать на одну и ту же гарантию для любого объекта из
    // `GeometryResult`, не заглядывая, каким этапом тот произведён.
    const seenSectionIds = new Set<NodeId>();
    const validSections: SectionBox[] = [];

    for (const section of this.sections) {
      if (seenSectionIds.has(section.nodeId)) {
        this.report(
          'SECTION_ID_DUPLICATE',
          'error',
          `Повторяющийся идентификатор секции: «${section.nodeId}».`,
          { nodeId: section.nodeId },
        );
        continue;
      }

      const failure = checkSanity(section.box);
      if (failure === 'size') {
        this.report(
          'SECTION_SIZE_NOT_POSITIVE',
          'error',
          `Секция «${section.nodeId}» получила неположительный размер.`,
          { nodeId: section.nodeId },
        );
        continue;
      }
      if (failure === 'position') {
        this.report(
          'SECTION_POSITION_NEGATIVE',
          'error',
          `Секция «${section.nodeId}» получила отрицательную координату.`,
          { nodeId: section.nodeId },
        );
        continue;
      }

      seenSectionIds.add(section.nodeId);
      validSections.push(section);
    }

    return Object.freeze({
      parts: Object.freeze(validParts),
      cells: Object.freeze(validCells),
      sections: Object.freeze(validSections),
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
