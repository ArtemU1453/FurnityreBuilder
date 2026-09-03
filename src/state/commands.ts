import type { Draft } from 'immer';
import type {
  BackPanelMount,
  BaseSpec,
  ConstructionScheme,
  EdgeSizingPolicy,
  EdgeSpec,
  FacadeGroup,
  HingeSide,
  LeafFill,
  Material,
  MaterialId,
  Mm,
  NodeId,
  OpeningSystem,
  PartRole,
  PlinthCutout,
  PlinthPartKind,
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
  | {
      /**
       * Назначает фасад ячейке (PROMPT 10). `facade.covers` уже указывает
       * на ячейку — id не генерирует, как и `SetRoot`/`SplitNode`: их
       * даёт вызывающая сторона (UI, `createHingedFacade`). Именно эта
       * команда — та точка записи, для которой `docs/DATA_MODEL.md` §7
       * и `PLANNED_COMMANDS` держали место с более ранних этапов.
       */
      readonly type: 'AddFacade';
      readonly furnitureIndex: number;
      readonly facade: FacadeGroup;
    }
  | { readonly type: 'RemoveFacade'; readonly furnitureIndex: number; readonly facadeId: NodeId }
  | {
      /**
       * Правка одной створки: сторона петель, материал, кромка, толщина,
       * доля ширины, способ открывания. `opening` покрывает и PROMPT 12
       * §15 (`setOpeningSystem`/`removeOpeningSystem`/`addHandle`/
       * `removeHandle`/`updateHandleConfig`) — одно поле патча заменяет
       * их все, тем же приёмом, каким уже покрыты предыдущие поля:
       * второй командный слой не заводится.
       */
      readonly type: 'UpdateFacadeLeaf';
      readonly furnitureIndex: number;
      readonly facadeId: NodeId;
      readonly leafId: NodeId;
      readonly patch: {
        readonly hingeSide?: HingeSide;
        /**
         * `null` — СНЯТЬ переопределение (вернуться к материалу роли);
         * то же и у `edge`/`thickness`. Это покрывает `removePartEdge`
         * из PROMPT 13 §18 без второй команды: отсутствие ключа в патче
         * («не трогай») и `null` («сбрось») — разные вещи, и различить их
         * иначе, чем явным значением, при `exactOptionalPropertyTypes`
         * нельзя.
         */
        readonly materialId?: MaterialId | null;
        readonly edge?: EdgeSpec | null;
        readonly thickness?: Mm | null;
        readonly size?: SizeSpec;
        readonly opening?: OpeningSystem;
      };
    }
  | {
      /**
       * Задняя стенка целиком: монтаж (он же положение и толщина), материал
       * и способ разделения (PROMPT 14 §18 — `setBackWallConfig`,
       * `setBackWallMaterial`, `setBackWallPosition`, `setBackWallSplitMode`).
       * Одна команда вместо четырёх по той же причине, по какой PROMPT 12
       * обошёлся полем `patch.opening`: все четыре меняют одну и ту же
       * `BackPanelSpec`, и раздельные команды означали бы четыре пути
       * записи в одно поле. Патч — частичный: не указанное не меняется.
       */
      readonly type: 'SetBackPanel';
      readonly furnitureIndex: number;
      readonly patch: {
        readonly mount?: BackPanelMount;
        readonly materialId?: MaterialId;
        readonly segmentation?: 'single' | 'per-section';
      };
    }
  | {
      /**
       * Цоколь целиком (PROMPT 14 §18 — `setPlinthConfig`, `setPlinthHeight`,
       * `setPlinthSetback`, `setPlinthCutout`). `base: null` — убрать
       * основание; `cutout: null` внутри патча — убрать вырез, оставив цоколь.
       */
      readonly type: 'SetBase';
      readonly furnitureIndex: number;
      readonly base: BaseSpec | null;
    }
  | {
      readonly type: 'UpdateBase';
      readonly furnitureIndex: number;
      readonly patch: {
        readonly height?: Mm;
        readonly setback?: Mm;
        readonly kind?: BaseSpec['kind'];
        readonly parts?: readonly PlinthPartKind[];
        readonly cutout?: PlinthCutout | null;
        readonly materialId?: MaterialId | null;
        readonly thickness?: Mm | null;
      };
    }
  | { readonly type: 'SetConstructionScheme'; readonly scheme: ConstructionScheme }
  | { readonly type: 'SetTolerances'; readonly tolerances: Tolerances }
  | { readonly type: 'SetEdgeSizingPolicy'; readonly policy: EdgeSizingPolicy }
  | { readonly type: 'SetMaterialAssignment'; readonly role: PartRole; readonly materialId: MaterialId }
  | {
      /**
       * Материал проекта по умолчанию (`setProjectMaterial`, PROMPT 13 §18).
       * `settings.defaultMaterialId` существовал с PROMPT 1 и проверялся
       * валидацией, но изменить его было нечем — команда закрывает именно
       * этот пробел, а не заводит второе поле «материал проекта».
       */
      readonly type: 'SetDefaultMaterial';
      readonly materialId: MaterialId;
    }
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

    case 'AddFacade': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const { covers } = command.facade;
      if (covers.kind === 'node') {
        const node = findNodeDraft(furniture.root, covers.nodeId);
        if (node === undefined || node.kind !== 'leaf') return;
        // Базовый случай PROMPT 10 §6: одна ячейка — не более одного
        // фасада. Правило проверяется здесь, а не только в валидации,
        // чтобы неоткуда было взяться двум дверям одной ячейки в истории.
        const alreadyCovered = furniture.facades.some(
          (f) => f.covers.kind === 'node' && f.covers.nodeId === covers.nodeId,
        );
        if (alreadyCovered) return;
      }
      furniture.facades.push(command.facade as Draft<FacadeGroup>);
      return;
    }

    case 'RemoveFacade': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const index = furniture.facades.findIndex((f) => f.id === command.facadeId);
      if (index === -1) return;
      furniture.facades.splice(index, 1);
      return;
    }

    case 'UpdateFacadeLeaf': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const facade = furniture.facades.find((f) => f.id === command.facadeId);
      if (facade === undefined) return;
      const leaf = facade.leaves.find((l) => l.id === command.leafId);
      if (leaf === undefined) return;
      const { patch } = command;
      if (patch.hingeSide !== undefined) leaf.hingeSide = patch.hingeSide;
      if (patch.materialId !== undefined) {
        // Битую ссылку команда не создаёт (PROMPT 13 §15): материал должен
        // существовать в библиотеке. Появиться такая ссылка может только
        // из файла проекта, где команда не выполнялась, — там её ловит
        // диагностика движка `MATERIAL_REFERENCE_BROKEN`.
        if (patch.materialId === null) delete leaf.materialId;
        else if (draft.materials.items[patch.materialId] !== undefined) leaf.materialId = patch.materialId;
      }
      if (patch.edge !== undefined) {
        if (patch.edge === null) delete leaf.edge;
        else if (patch.edge.materialId === undefined || draft.materials.items[patch.edge.materialId] !== undefined) {
          leaf.edge = patch.edge;
        }
      }
      if (patch.thickness !== undefined) {
        // Толщина-переопределение обязана быть положительной (§15/§21):
        // ноль или отрицательное значение дали бы деталь нулевого объёма.
        if (patch.thickness === null) delete leaf.thickness;
        else if (patch.thickness > 0) leaf.thickness = patch.thickness;
      }
      if (patch.size !== undefined) leaf.size = patch.size;
      if (patch.opening !== undefined) leaf.opening = patch.opening;
      return;
    }

    case 'SetBackPanel': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const { patch } = command;

      if (patch.mount !== undefined) {
        // Толщина задней стенки — источник геометрии (она вычитается из
        // глубины корпуса), поэтому неположительная не принимается (§19).
        if (patch.mount.kind !== 'none' && !(patch.mount.thickness > 0)) return;
        furniture.carcass.back.mount = patch.mount;
      }
      if (patch.materialId !== undefined) {
        // Битую ссылку команда не создаёт — тот же приём, что у материалов
        // на PROMPT 13 §15.
        if (draft.materials.items[patch.materialId] === undefined) return;
        furniture.carcass.back.materialId = patch.materialId;
      }
      if (patch.segmentation !== undefined) furniture.carcass.back.segmentation = patch.segmentation;
      return;
    }

    case 'SetBase': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      if (command.base === null) {
        delete furniture.carcass.base;
        return;
      }
      if (command.base.height < 0 || command.base.setback < 0) return;
      furniture.carcass.base = command.base as Draft<BaseSpec>;
      return;
    }

    case 'UpdateBase': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const base = furniture.carcass.base;
      if (base === undefined) return;
      const { patch } = command;

      // Высота и отступ цоколя не могут быть отрицательными: обе величины
      // прямо участвуют в положении корпуса и самих царг (§19).
      if (patch.height !== undefined) {
        if (patch.height < 0) return;
        base.height = patch.height;
      }
      if (patch.setback !== undefined) {
        if (patch.setback < 0) return;
        base.setback = patch.setback;
      }
      if (patch.kind !== undefined) base.kind = patch.kind;
      if (patch.parts !== undefined) base.parts = [...patch.parts];
      if (patch.cutout !== undefined) {
        if (patch.cutout === null) delete base.cutout;
        else {
          if (patch.cutout.left < 0 || patch.cutout.right < 0 || !(patch.cutout.height > 0)) return;
          base.cutout = { ...patch.cutout };
        }
      }
      if (patch.materialId !== undefined) {
        if (patch.materialId === null) delete base.materialId;
        else if (draft.materials.items[patch.materialId] !== undefined) base.materialId = patch.materialId;
      }
      if (patch.thickness !== undefined) {
        if (patch.thickness === null) delete base.thickness;
        else if (patch.thickness > 0) base.thickness = patch.thickness;
      }
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
      // Назначить роли материал, которого нет в библиотеке, нельзя
      // (PROMPT 13 §15): иначе команда сама создавала бы битую ссылку,
      // которую потом ловит диагностика.
      if (draft.materials.items[command.materialId] === undefined) return;
      draft.materials.assignment[command.role] = command.materialId;
      return;
    }

    case 'SetDefaultMaterial': {
      if (draft.materials.items[command.materialId] === undefined) return;
      draft.settings.defaultMaterialId = command.materialId;
      return;
    }

    case 'UpsertMaterial': {
      // Толщина материала — источник геометрии (PROMPT 13 §4/§15), поэтому
      // неположительная толщина не принимается: она дала бы детали нулевого
      // или отрицательного объёма при первом же пересчёте.
      if (!(command.material.thickness > 0) || !Number.isFinite(command.material.thickness)) return;
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
