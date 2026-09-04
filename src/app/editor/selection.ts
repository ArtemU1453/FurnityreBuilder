import { contentKindOf, contentLabel } from '../../geometry/index.js';
import { formatMm } from '../../domain/index.js';
import type { Furniture, MaterialLibrary, NodeId, PartId } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';

/**
 * Модель выделения и инспектора (PROMPT 22 §5–§6).
 *
 * ## Выделение не трогает модель
 *
 * Выбор объекта — состояние ИНТЕРФЕЙСА: оно не сохраняется в файл, не
 * попадает в деталировку и не отменяется по Ctrl+Z. Хранится там же, где
 * и остальное состояние сессии (`src/state/session-store.ts`, заведён на
 * PROMPT 2 и до сих пор не использовался интерфейсом).
 *
 * ## Почему разбор выделения — чистая функция
 *
 * Инспектор показывает то, что уже посчитал движок: размеры ячейки,
 * материал детали, наполнение. Считать это в React-компоненте значило бы
 * завести вторую геометрию (§30). Здесь только СОПОСТАВЛЕНИЕ: по
 * идентификатору находится объект и раскладывается в строки.
 */

/** Что именно выбрано. Выводится из геометрии, а не хранится отдельно. */
export type SelectionTarget =
  | { readonly kind: 'furniture' }
  | { readonly kind: 'section'; readonly nodeId: NodeId }
  | { readonly kind: 'cell'; readonly nodeId: NodeId }
  | { readonly kind: 'part'; readonly partId: PartId };

/** Действие, доступное для выбранного объекта. Команду отправляет вызывающий. */
export type InspectorAction =
  | { readonly kind: 'add-door'; readonly nodeId: NodeId }
  | { readonly kind: 'add-drawers'; readonly nodeId: NodeId }
  | { readonly kind: 'add-shelves'; readonly nodeId: NodeId }
  | { readonly kind: 'clear-fill'; readonly nodeId: NodeId }
  | { readonly kind: 'remove-door'; readonly facadeId: NodeId };

export interface InspectorRow {
  readonly label: string;
  readonly value: string;
}

export interface InspectorModel {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly InspectorRow[];
  readonly actions: readonly InspectorAction[];
}

/**
 * Разбор выделения по идентификаторам сессии.
 *
 * Порядок важен: деталь конкретнее ячейки, ячейка конкретнее секции.
 * Пользователь, ткнувший в полку, хочет свойства полки, а не секции, в
 * которой она стоит.
 */
export function resolveSelection(
  selectedNodes: readonly NodeId[],
  selectedParts: readonly PartId[],
  geometry: GeometryResult,
): SelectionTarget {
  const partId = selectedParts[0];
  if (partId !== undefined && geometry.parts.some((part) => part.id === partId)) {
    return { kind: 'part', partId };
  }
  const nodeId = selectedNodes[0];
  if (nodeId !== undefined) {
    if (geometry.cells.some((cell) => cell.nodeId === nodeId)) return { kind: 'cell', nodeId };
    if (geometry.sections.some((section) => section.nodeId === nodeId)) return { kind: 'section', nodeId };
  }
  return { kind: 'furniture' };
}

const size = (x: number, y: number, z: number): string =>
  `${formatMm(x)} × ${formatMm(y)} × ${formatMm(z)} мм`;

/** Строки и действия инспектора для выбранного объекта. */
export function describeSelection(
  target: SelectionTarget,
  furniture: Furniture,
  geometry: GeometryResult,
  materials: MaterialLibrary,
): InspectorModel {
  switch (target.kind) {
    case 'part': {
      const part = geometry.parts.find((item) => item.id === target.partId);
      if (part === undefined) return describeSelection({ kind: 'furniture' }, furniture, geometry, materials);
      const material = materials.items[part.materialId];
      return {
        title: part.label,
        subtitle: `Деталь · ${part.role}`,
        rows: [
          { label: 'Размер раскроя', value: size(part.cut.length, part.cut.width, part.cut.thickness) },
          { label: 'Габарит', value: size(part.size.x, part.size.y, part.size.z) },
          { label: 'Материал', value: material?.name ?? String(part.materialId) },
          {
            label: 'Кромка',
            value: `${formatMm(part.edge.front)}/${formatMm(part.edge.back)}/${formatMm(part.edge.left)}/${formatMm(part.edge.right)}`,
          },
          { label: 'Положение', value: `X ${formatMm(part.position.x)} · Y ${formatMm(part.position.y)} · Z ${formatMm(part.position.z)}` },
        ],
        // Правка отдельной детали не поддерживается моделью: деталь
        // производна от конструкции (`T-PART-01`), и «изменить полку»
        // означает изменить ячейку, а не деталь.
        actions: [],
      };
    }

    case 'cell': {
      const cell = geometry.cells.find((item) => item.nodeId === target.nodeId);
      if (cell === undefined) return describeSelection({ kind: 'furniture' }, furniture, geometry, materials);
      const kind = contentKindOf(cell.fill);
      const doors = geometry.parts.filter((part) => part.role === 'facade' && part.origin.nodeId === cell.nodeId);
      const facade = furniture.facades.find(
        (group) => group.covers.kind === 'node' && group.covers.nodeId === cell.nodeId,
      );
      return {
        title: 'Ячейка',
        subtitle: `${cell.nodeId} · секция ${cell.sectionId}`,
        rows: [
          { label: 'Размер', value: size(cell.box.size.x, cell.box.size.y, cell.box.size.z) },
          { label: 'Положение', value: `X ${formatMm(cell.box.min.x)} · Y ${formatMm(cell.box.min.y)}` },
          { label: 'Ряд · колонка', value: `${String(cell.row + 1)} · ${String(cell.column + 1)}` },
          { label: 'Наполнение', value: contentLabel(kind) },
          { label: 'Фасад', value: doors.length === 0 ? 'нет' : `${String(doors.length)} шт` },
        ],
        // Действия зависят от состояния ячейки: несовместимые не
        // показываются вовсе (§12). Дверь на ячейку с ящиками поставить
        // нельзя — это проверяет и движок, но предлагать её незачем.
        actions: [
          ...(kind === 'drawers' ? [] : [{ kind: 'add-door' as const, nodeId: cell.nodeId }]),
          ...(facade === undefined ? [] : [{ kind: 'remove-door' as const, facadeId: facade.id }]),
          ...(kind === 'empty' ? [{ kind: 'add-drawers' as const, nodeId: cell.nodeId }] : []),
          ...(kind === 'empty' || kind === 'shelves' ? [{ kind: 'add-shelves' as const, nodeId: cell.nodeId }] : []),
          ...(kind === 'empty' ? [] : [{ kind: 'clear-fill' as const, nodeId: cell.nodeId }]),
        ],
      };
    }

    case 'section': {
      const section = geometry.sections.find((item) => item.nodeId === target.nodeId);
      if (section === undefined) return describeSelection({ kind: 'furniture' }, furniture, geometry, materials);
      const cells = geometry.cells.filter((cell) => cell.sectionId === section.nodeId);
      return {
        title: `Секция ${String(section.index + 1)}`,
        subtitle: String(section.nodeId),
        rows: [
          { label: 'Размер', value: size(section.box.size.x, section.box.size.y, section.box.size.z) },
          { label: 'Положение X', value: `${formatMm(section.box.min.x)} мм` },
          { label: 'Ячеек', value: String(cells.length) },
          { label: 'Рядов', value: String(new Set(cells.map((cell) => cell.row)).size) },
          { label: 'Колонок', value: String(new Set(cells.map((cell) => cell.column)).size) },
        ],
        actions: [],
      };
    }

    case 'furniture':
      return {
        title: furniture.name,
        subtitle: 'Изделие',
        rows: [
          { label: 'Габарит', value: size(furniture.dimensions.width, furniture.dimensions.height, furniture.dimensions.depth) },
          { label: 'Толщина материала', value: `${formatMm(furniture.dimensions.panelThickness)} мм` },
          { label: 'Секций', value: String(geometry.sections.length) },
          { label: 'Ячеек', value: String(geometry.cells.length) },
          { label: 'Деталей', value: String(geometry.parts.length) },
        ],
        actions: [],
      };
  }
}
