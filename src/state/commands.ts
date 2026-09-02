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
      readonly type: 'SetChildSize';
      readonly furnitureIndex: number;
      readonly nodeId: NodeId;
      readonly childIndex: number;
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

    case 'SetChildSize': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const node = findNodeDraft(furniture.root, command.nodeId);
      if (node === undefined || node.kind !== 'split') return;
      const child = node.children[command.childIndex];
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
