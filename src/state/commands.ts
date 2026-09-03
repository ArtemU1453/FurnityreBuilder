import type { Draft } from 'immer';
import type {
  ConstructionScheme,
  EdgeSizingPolicy,
  LeafFill,
  Material,
  MaterialId,
  NodeId,
  PartRole,
  Project,
  SectionNode,
  SizeSpec,
  SplitAxis,
  Tolerances,
} from '../domain/index.js';
import { createDividerSpec } from '../domain/index.js';

/**
 * Действия пользователя выражены командами, а не прямыми мутациями стора.
 *
 * Зачем: единая точка записи истории, воспроизводимость дефекта по журналу
 * команд и возможность добавлять новые действия, не трогая компоненты.
 * Компонент отправляет команду и ничего не знает о том, как устроен проект.
 */
export type Command =
  | { readonly type: 'SetProjectName'; readonly name: string }
  | {
      readonly type: 'SetDimension';
      readonly furnitureIndex: number;
      readonly axis: 'width' | 'height' | 'depth' | 'panelThickness';
      readonly value: number;
    }
  | { readonly type: 'SetFurnitureName'; readonly furnitureIndex: number; readonly name: string }
  | {
      readonly type: 'SetCarcassFlags';
      readonly furnitureIndex: number;
      readonly hasTop?: boolean;
      readonly hasBottom?: boolean;
    }
  | {
      readonly type: 'SplitNode';
      readonly furnitureIndex: number;
      readonly nodeId: NodeId;
      readonly axis: SplitAxis;
      readonly childIds: readonly NodeId[];
      readonly dividerThickness: number;
    }
  | { readonly type: 'CollapseNode'; readonly furnitureIndex: number; readonly nodeId: NodeId; readonly leafId: NodeId }
  | {
      /**
       * Заменяет дерево секций изделия целиком заранее построенным деревом
       * (например, `createUniformGrid`/`createSections` из
       * `domain/furniture/sections.ts`). Атомарная альтернатива серии
       * `SplitNode`: построение равномерной сетки — одно пользовательское
       * действие и один шаг истории, а не N отдельных делений с
       * промежуточными недостроенными состояниями между ними.
       */
      readonly type: 'SetRoot';
      readonly furnitureIndex: number;
      readonly root: SectionNode;
    }
  | {
      /**
       * Меняет ЧИСЛО секций верхнего уровня, сохраняя идентичность уже
       * существующих (PROMPT 7 §14–15).
       *
       * Отличие от `SetRoot`, которым сетку строили до этого: `SetRoot`
       * подменяет дерево целиком, поэтому 3 → 4 секции меняли id у ВСЕХ
       * секций, ячеек и полок разом — выделение, история и будущий drag
       * теряли объект, который пользователь не трогал. Эта команда правит
       * только хвост списка детей: первые N секций остаются теми же узлами
       * со своим наполнением.
       *
       * `splitId` нужен только когда корень ещё не делится по X (изделие
       * из одной секции); `newSectionIds` расходуются по мере надобности,
       * лишние игнорируются. Как и остальные команды, работающие со
       * структурой дерева, id не генерирует — их даёт вызывающая сторона.
       */
      readonly type: 'SetSectionCount';
      readonly furnitureIndex: number;
      readonly count: number;
      readonly splitId: NodeId;
      readonly newSectionIds: readonly NodeId[];
      readonly dividerThickness: number;
    }
  | {
      /**
       * Размер ОДНОЙ секции, строки или колонки — это `SizeSpec` ребёнка
       * деления, и адресуется он по id самого ребёнка (PROMPT 8 §18, §22).
       *
       * Раньше команда принимала `childIndex` — позицию в массиве. Позиция
       * идентичностью не является (`docs/DATA_MODEL.md` §5.7): добавление
       * соседней секции сдвигает индексы, и команда «сделай вторую секцию
       * шириной 500» после этого попадает не в ту секцию. По id она
       * попадает туда, куда назначена, всегда.
       *
       * Одна команда закрывает и `setSectionWidth`, и `setRowHeight`, и
       * размер колонки: чем является ребёнок — секцией, рядом или колонкой —
       * определяет ось его родителя, а не отдельный тип команды.
       */
      readonly type: 'SetChildSize';
      readonly furnitureIndex: number;
      readonly childId: NodeId;
      readonly size: SizeSpec;
    }
  | { readonly type: 'SetFill'; readonly furnitureIndex: number; readonly nodeId: NodeId; readonly fill: LeafFill }
  | { readonly type: 'SetConstructionScheme'; readonly scheme: ConstructionScheme }
  | { readonly type: 'SetTolerances'; readonly tolerances: Tolerances }
  | { readonly type: 'SetEdgeSizingPolicy'; readonly policy: EdgeSizingPolicy }
  | { readonly type: 'SetMaterialAssignment'; readonly role: PartRole; readonly materialId: MaterialId }
  | { readonly type: 'UpsertMaterial'; readonly material: Material }
  | { readonly type: 'RemoveMaterial'; readonly materialId: MaterialId };

/**
 * Команды, для которых архитектура готова, но модели ещё нет.
 *
 * Список существует, чтобы «пока не реализовано» было видно в коде, а не
 * подразумевалось. Добавление любой из них — новая ветка switch и правило
 * валидации; ни компоненты, ни стор при этом не меняются.
 */
export const PLANNED_COMMANDS = [
  'AddFacade',
  'RemoveFacade',
  'UpdateFacadeLeaf',
  'AddDrawer',
  'RemoveDrawer',
  'AddShelf',
  'RemoveShelf',
  'MoveDivider',
  'UpdateEdgeBanding',
  'UpdateHardware',
  'SetBackPanelMount',
  'SetBase',
  'SetCountertop',
] as const;

function findNodeDraft(root: Draft<Project>['furniture'][number]['root'], id: NodeId): Draft<Project>['furniture'][number]['root'] | undefined {
  if (root.id === id) return root;
  if (root.kind !== 'split') return undefined;
  for (const child of root.children) {
    const found = findNodeDraft(child.node, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Запись `SectionChild`, чей узел имеет данный id: она несёт размер ребёнка. */
function findChildDraft(
  root: Draft<Project>['furniture'][number]['root'],
  childId: NodeId,
): { size: SizeSpec } | undefined {
  if (root.kind !== 'split') return undefined;
  for (const child of root.children) {
    if (child.node.id === childId) return child;
    const found = findChildDraft(child.node, childId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Применение команды к черновику проекта.
 *
 * Функция мутирует `Draft` из Immer, а не сам проект: снаружи это остаётся
 * чистым преобразованием, из которого Immer добывает патчи для истории.
 */
export function applyCommand(draft: Draft<Project>, command: Command): void {
  switch (command.type) {
    case 'SetProjectName': {
      draft.name = command.name;
      return;
    }

    case 'SetFurnitureName': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture !== undefined) furniture.name = command.name;
      return;
    }

    case 'SetDimension': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      // Значение НЕ округляется и НЕ ограничивается здесь: команда фиксирует
      // намерение пользователя как есть, а о недопустимости сообщает валидация.
      // Иначе поле «прыгало» бы под пальцами во время ввода.
      furniture.dimensions[command.axis] = command.value;
      return;
    }

    case 'SetCarcassFlags': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      if (command.hasTop !== undefined) furniture.carcass.hasTop = command.hasTop;
      if (command.hasBottom !== undefined) furniture.carcass.hasBottom = command.hasBottom;
      return;
    }

    case 'SplitNode': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const node = findNodeDraft(furniture.root, command.nodeId);
      if (node === undefined || command.childIds.length < 2) return;

      const children = command.childIds.map((id) => ({
        size: { mode: 'flex' as const, weight: 1 },
        node: { id, kind: 'leaf' as const, fill: { kind: 'empty' as const } },
      }));

      // Мутируем найденный узел на месте: ссылки родителя остаются валидными,
      // а Immer выдаёт патч ровно на изменённое поддерево.
      const asSplit = node as unknown as {
        id: NodeId;
        kind: 'split';
        axis: SplitAxis;
        divider: ReturnType<typeof createDividerSpec>;
        children: typeof children;
        fill?: unknown;
      };
      asSplit.kind = 'split';
      asSplit.axis = command.axis;
      asSplit.divider = createDividerSpec(command.dividerThickness);
      asSplit.children = children;
      delete asSplit.fill;
      return;
    }

    case 'CollapseNode': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const node = findNodeDraft(furniture.root, command.nodeId);
      if (node === undefined) return;
      const asLeaf = node as unknown as {
        id: NodeId;
        kind: 'leaf';
        fill: LeafFill;
        axis?: unknown;
        divider?: unknown;
        children?: unknown;
      };
      asLeaf.kind = 'leaf';
      asLeaf.id = command.leafId;
      asLeaf.fill = { kind: 'empty' };
      delete asLeaf.axis;
      delete asLeaf.divider;
      delete asLeaf.children;
      return;
    }

    case 'SetRoot': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      // Дерево заменяется целиком — источник истины остаётся один: сама
      // структура, а не отдельно хранимые «количество секций»/«строк»/
      // «колонок» (docs/DATA_MODEL.md §5). Draft снимает readonly с уже
      // неизменяемого значения, копия не нужна — как и в SetFill.
      furniture.root = command.root as Draft<SectionNode>;
      return;
    }

    case 'SetSectionCount': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined || command.count < 1) return;

      const root = furniture.root;
      const isXSplit = root.kind === 'split' && root.axis === 'x';

      if (!isXSplit) {
        // Изделие пока из одной секции. Одна секция и требуется — работы нет.
        if (command.count === 1) return;
        // Существующий корень становится ПЕРВОЙ секцией, а не выбрасывается:
        // его наполнение (полки, вложенные деления) переживает добавление
        // соседей, как и его id.
        const extra = command.newSectionIds.slice(0, command.count - 1);
        if (extra.length < command.count - 1) return;
        furniture.root = {
          id: command.splitId,
          kind: 'split',
          axis: 'x',
          divider: createDividerSpec(command.dividerThickness),
          children: [
            { size: { mode: 'flex', weight: 1 }, node: root },
            ...extra.map((id) => ({
              size: { mode: 'flex' as const, weight: 1 },
              node: { id, kind: 'leaf' as const, fill: { kind: 'empty' as const } },
            })),
          ],
        };
        return;
      }

      if (command.count === 1) {
        // Схлопывание до одной секции: остаётся ПЕРВАЯ секция целиком —
        // её узел, её id, её наполнение. Остальные исчезают вместе со всем,
        // что принадлежало только им (PROMPT 7 §13, §15).
        const first = root.children[0];
        if (first === undefined) return;
        furniture.root = first.node;
        return;
      }

      const existing = root.children.length;
      if (command.count < existing) {
        // Удаляются ПОСЛЕДНИЕ секции: у оставшихся не меняется ни порядок,
        // ни id. Дерево — единственный источник истины, поэтому вместе с
        // удалённым поддеревом исчезают и его ячейки, и его полки:
        // осиротевших объектов не остаётся по построению.
        root.children.splice(command.count);
        return;
      }
      if (command.count > existing) {
        const extra = command.newSectionIds.slice(0, command.count - existing);
        if (extra.length < command.count - existing) return;
        for (const id of extra) {
          root.children.push({
            size: { mode: 'flex', weight: 1 },
            node: { id, kind: 'leaf', fill: { kind: 'empty' } },
          });
        }
      }
      return;
    }

    case 'SetChildSize': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const child = findChildDraft(furniture.root, command.childId);
      if (child === undefined) return;
      child.size = command.size;
      return;
    }

    case 'SetFill': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const node = findNodeDraft(furniture.root, command.nodeId);
      if (node === undefined || node.kind !== 'leaf') return;
      // Draft снимает readonly; команда несёт неизменяемое значение, копия не нужна.
      node.fill = command.fill as Draft<LeafFill>;
      return;
    }

    case 'SetConstructionScheme': {
      draft.settings.construction = command.scheme;
      return;
    }

    case 'SetTolerances': {
      draft.settings.tolerances = command.tolerances;
      return;
    }

    case 'SetEdgeSizingPolicy': {
      draft.settings.edgeSizing = command.policy;
      return;
    }

    case 'SetMaterialAssignment': {
      draft.materials.assignment[command.role] = command.materialId;
      return;
    }

    case 'UpsertMaterial': {
      draft.materials.items[command.material.id] = command.material;
      return;
    }

    case 'RemoveMaterial': {
      // Ссылки на удалённый материал остаются битыми намеренно: валидация
      // покажет это явно, а тихая подстановка другого материала изменила бы
      // проект без ведома пользователя.
      delete draft.materials.items[command.materialId];
      return;
    }
  }
}
