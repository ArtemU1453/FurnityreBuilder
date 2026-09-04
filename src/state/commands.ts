import type { Draft } from 'immer';
import type {
  BackPanelMount,
  BaseSpec,
  Ceiling,
  ConstructionScheme,
  CountertopSpec,
  EdgeSizingPolicy,
  EdgeSpec,
  FacadeGroup,
  FalsePanel,
  Floor,
  FurnitureInstance,
  HingeSide,
  InstanceId,
  LeafFill,
  Material,
  MaterialId,
  Mm,
  NodeId,
  Obstacle,
  ObstacleId,
  Opening,
  OpeningId,
  OpeningSystem,
  OverhangSpec,
  PartRole,
  PlinthCutout,
  PlinthPartKind,
  Project,
  Room,
  SectionNode,
  SizeSpec,
  SplitAxis,
  Tolerances,
  TopSectionSpec,
  Vec3,
  Wall,
  WallId,
  WallMountSpec,
  RotationPolicy,
  TrimSpec,
} from '../domain/index.js';
import { createDividerSpec, isFiniteVec3 } from '../domain/index.js';

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
  | {
      /**
       * Конструктивные модификаторы корпуса одним патчем (PROMPT 15 §13).
       * `null` у любого поля — выключить модификатор; отсутствие ключа —
       * не трогать. Одна команда вместо десяти из формулировки задания по
       * той же причине, по какой PROMPT 14 обошёлся `SetBackPanel`: все
       * они пишут в поля одного и того же `CarcassSpec`, и десять путей
       * записи в один объект означали бы вторую систему состояния.
       */
      readonly type: 'SetStructuralModifiers';
      readonly furnitureIndex: number;
      readonly patch: {
        readonly overhang?: OverhangSpec | null;
        readonly topSection?: TopSectionSpec | null;
        readonly ceilingGap?: Mm | null;
        readonly countertop?: CountertopSpec | null;
        readonly wallMount?: WallMountSpec | null;
      };
    }
  | {
      /**
       * Фальшпанели адресуются по своему `id` (политика идентичности,
       * `docs/DATA_MODEL.md` §5.7), а не по позиции в массиве: добавление
       * соседней панели не должно попадать в другую.
       */
      readonly type: 'AddFalsePanel';
      readonly furnitureIndex: number;
      readonly panel: FalsePanel;
    }
  | { readonly type: 'RemoveFalsePanel'; readonly furnitureIndex: number; readonly panelId: NodeId }
  | {
      readonly type: 'UpdateFalsePanel';
      readonly furnitureIndex: number;
      readonly panelId: NodeId;
      readonly patch: {
        readonly position?: FalsePanel['position'];
        readonly width?: Mm | null;
        readonly height?: Mm | null;
        readonly depth?: Mm | null;
        readonly materialId?: MaterialId | null;
        readonly thickness?: Mm | null;
        readonly offset?: Mm | null;
      };
    }
  | { readonly type: 'SetConstructionScheme'; readonly scheme: ConstructionScheme }
  | { readonly type: 'SetTolerances'; readonly tolerances: Tolerances }
  | { readonly type: 'SetEdgeSizingPolicy'; readonly policy: EdgeSizingPolicy }
  | {
      /**
       * Параметры раскроя (PROMPT 17 §26). Одна patch-команда на весь
       * `CuttingSettings`, а не отдельные `setKerf`/`setTrim`/
       * `setRotationPolicy`: все три пишут в один и тот же объект настроек,
       * и три пути записи в одно поле означали бы три источника истины —
       * тот же довод, по которому PROMPT 15 обошёлся одной
       * `SetStructuralModifiers`.
       *
       * Команд ручного перемещения деталей по листу здесь нет намеренно
       * (§26, §36): интерактивного редактора раскроя на этом этапе не
       * существует, а координата, записанная пользователем в производную
       * раскладку, немедленно потерялась бы при первом пересчёте.
       */
      readonly type: 'SetCuttingSettings';
      readonly patch: {
        readonly kerf?: Mm;
        readonly trim?: TrimSpec | null;
        readonly rotationPolicy?: RotationPolicy;
      };
    }
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
  | { readonly type: 'RemoveMaterial'; readonly materialId: MaterialId }
  /*
    Планировщик помещения (PROMPT 24 §12, §29).

    Все изменения комнаты идут через ту же систему команд, что и мебель,
    поэтому отмена, повтор и транзакции работают без единой строки нового
    кода: история не знает, что именно изменилось, — она хранит патчи.
  */
  | { readonly type: 'SetRoom'; readonly room: Room | undefined }
  | {
      /**
       * Габарит прямоугольной комнаты.
       *
       * Стены перестраиваются, но их ИДЕНТИФИКАТОРЫ сохраняются: иначе
       * проёмы, привязанные к стене, потеряли бы ссылку при каждом
       * изменении ширины (тот же довод, что у `SetSectionCount`,
       * `docs/DATA_MODEL.md` §5.7).
       *
       * Для непрямоугольной комнаты команда не делает ничего: «ширина»
       * у произвольного контура не определена, и молча превратить его в
       * прямоугольник значило бы уничтожить ниши и выступы.
       */
      readonly type: 'SetRoomSize';
      readonly width: Mm;
      readonly depth: Mm;
      readonly height: Mm;
    }
  | { readonly type: 'SetRoomName'; readonly name: string }
  | { readonly type: 'SetFloor'; readonly patch: Partial<Floor> }
  | { readonly type: 'SetCeiling'; readonly patch: Partial<Ceiling> }
  | { readonly type: 'UpdateWall'; readonly wallId: WallId; readonly patch: Partial<Omit<Wall, 'id'>> }
  | { readonly type: 'AddOpening'; readonly opening: Opening }
  | { readonly type: 'RemoveOpening'; readonly openingId: OpeningId }
  | { readonly type: 'UpdateOpening'; readonly openingId: OpeningId; readonly patch: Partial<Omit<Opening, 'id'>> }
  | { readonly type: 'AddObstacle'; readonly obstacle: Obstacle }
  | { readonly type: 'RemoveObstacle'; readonly obstacleId: ObstacleId }
  | { readonly type: 'UpdateObstacle'; readonly obstacleId: ObstacleId; readonly patch: Partial<Omit<Obstacle, 'id'>> }
  | { readonly type: 'AddFurnitureInstance'; readonly instance: FurnitureInstance }
  | { readonly type: 'RemoveFurnitureInstance'; readonly instanceId: InstanceId }
  | {
      /**
       * Перемещение и поворот экземпляра.
       *
       * Габаритов изделия здесь нет и быть не может: transform меняет
       * ПОЛОЖЕНИЕ, а размер меняется внутри изделия (§11). Иначе
       * появился бы второй способ задать ширину шкафа, расходящийся с
       * первым.
       */
      readonly type: 'TransformFurnitureInstance';
      readonly instanceId: InstanceId;
      readonly position?: Vec3;
      readonly rotation?: number;
    }
  | {
      readonly type: 'SetInstanceFlags';
      readonly instanceId: InstanceId;
      readonly locked?: boolean;
      readonly visible?: boolean;
    };

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

    case 'SetStructuralModifiers': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const { patch } = command;
      const carcass = furniture.carcass;

      if (patch.overhang !== undefined) {
        if (patch.overhang === null) delete carcass.overhang;
        else {
          const o = patch.overhang;
          // Свес отсчитывается наружу и отрицательным быть не может (§14):
          // утопление детали внутрь корпуса — другое правило, и оно не
          // подтверждено (T-MOD-01).
          if (o.front < 0 || o.back < 0 || o.left < 0 || o.right < 0) return;
          carcass.overhang = { ...o, appliesTo: [...o.appliesTo] };
        }
      }
      if (patch.topSection !== undefined) {
        if (patch.topSection === null) delete carcass.topSection;
        else {
          if (!(patch.topSection.height > 0) || patch.topSection.gap < 0) return;
          carcass.topSection = { ...patch.topSection };
        }
      }
      if (patch.ceilingGap !== undefined) {
        if (patch.ceilingGap === null) delete carcass.ceilingGap;
        else {
          if (patch.ceilingGap < 0) return;
          carcass.ceilingGap = patch.ceilingGap;
        }
      }
      if (patch.countertop !== undefined) {
        if (patch.countertop === null) delete carcass.countertop;
        else {
          const c = patch.countertop;
          if (!(c.thickness > 0)) return;
          if (c.overhangFront < 0 || c.overhangBack < 0 || c.overhangLeft < 0 || c.overhangRight < 0) return;
          if (draft.materials.items[c.materialId] === undefined) return;
          carcass.countertop = { ...c };
        }
      }
      if (patch.wallMount !== undefined) {
        if (patch.wallMount === null) delete carcass.wallMount;
        else {
          if (patch.wallMount.elevation !== undefined && patch.wallMount.elevation < 0) return;
          carcass.wallMount = { ...patch.wallMount };
        }
      }
      return;
    }

    case 'AddFalsePanel': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const panels = furniture.carcass.falsePanels ?? [];
      // Панель с уже занятым id не добавляется: два объекта с одной
      // идентичностью дали бы две детали с одинаковым `Part.id`.
      if (panels.some((p) => p.id === command.panel.id)) return;
      furniture.carcass.falsePanels = [...panels, { ...command.panel }];
      return;
    }

    case 'RemoveFalsePanel': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const panels = furniture.carcass.falsePanels ?? [];
      const next = panels.filter((p) => p.id !== command.panelId);
      if (next.length === panels.length) return;
      furniture.carcass.falsePanels = next;
      return;
    }

    case 'UpdateFalsePanel': {
      const furniture = draft.furniture[command.furnitureIndex];
      if (furniture === undefined) return;
      const panel = (furniture.carcass.falsePanels ?? []).find((p) => p.id === command.panelId);
      if (panel === undefined) return;
      const { patch } = command;

      if (patch.position !== undefined) panel.position = patch.position;
      for (const key of ['width', 'height', 'depth', 'thickness'] as const) {
        const value = patch[key];
        if (value === undefined) continue;
        if (value === null) delete panel[key];
        else if (value > 0) panel[key] = value;
      }
      if (patch.offset !== undefined) {
        if (patch.offset === null) delete panel.offset;
        else if (patch.offset >= 0) panel.offset = patch.offset;
      }
      if (patch.materialId !== undefined) {
        if (patch.materialId === null) delete panel.materialId;
        else if (draft.materials.items[patch.materialId] !== undefined) panel.materialId = patch.materialId;
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

    case 'SetCuttingSettings': {
      const { patch } = command;
      // Отрицательный пропил и отрицательная обрезная кромка физически
      // невозможны: команда не применяется целиком, чтобы половина патча
      // не оседала в проекте (как и во всех остальных командах — ранний
      // return означает отсутствие записи в историю).
      if (patch.kerf !== undefined && !(patch.kerf >= 0)) return;
      if (patch.trim !== undefined && patch.trim !== null) {
        const t = patch.trim;
        if (t.left < 0 || t.right < 0 || t.top < 0 || t.bottom < 0) return;
      }

      if (patch.kerf !== undefined) draft.settings.cutting.kerf = patch.kerf;
      if (patch.trim !== undefined) {
        if (patch.trim === null) delete draft.settings.cutting.trim;
        else draft.settings.cutting.trim = { ...patch.trim };
      }
      if (patch.rotationPolicy !== undefined) draft.settings.cutting.rotationPolicy = patch.rotationPolicy;
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

    // ── Планировщик помещения (PROMPT 24) ──────────────────────────────────

    case 'SetRoom': {
      if (command.room === undefined) delete draft.room;
      else draft.room = command.room as Draft<Room>;
      return;
    }

    case 'SetRoomName': {
      if (draft.room === undefined) return;
      draft.room.name = command.name;
      return;
    }

    case 'SetRoomSize': {
      const room = draft.room;
      if (room === undefined) return;
      if (!isPositive(command.width) || !isPositive(command.depth) || !isPositive(command.height)) return;
      // Только прямоугольная комната: у произвольного контура «ширина»
      // не определена, и перестроить его в прямоугольник значило бы
      // уничтожить ниши и выступы без ведома пользователя.
      if (room.walls.length !== 4) return;

      const corners: ReadonlyArray<readonly [number, number, number, number]> = [
        [0, 0, command.width, 0],
        [command.width, 0, command.width, command.depth],
        [command.width, command.depth, 0, command.depth],
        [0, command.depth, 0, 0],
      ];
      room.walls.forEach((wall, index) => {
        const corner = corners[index];
        if (corner === undefined) return;
        // Идентификатор стены сохраняется: иначе проёмы теряют ссылку
        // при каждом изменении габарита комнаты.
        wall.a = { x: corner[0], z: corner[1] };
        wall.b = { x: corner[2], z: corner[3] };
        wall.height = command.height;
      });
      room.ceilingHeight = command.height;
      return;
    }

    case 'SetFloor': {
      if (draft.room === undefined) return;
      if (command.patch.elevation !== undefined && !Number.isFinite(command.patch.elevation)) return;
      Object.assign(draft.room.floor, command.patch);
      return;
    }

    case 'SetCeiling': {
      if (draft.room === undefined) return;
      Object.assign(draft.room.ceiling, command.patch);
      return;
    }

    case 'UpdateWall': {
      const wall = draft.room?.walls.find((item) => item.id === command.wallId);
      if (wall === undefined) return;
      if (command.patch.thickness !== undefined && !isPositive(command.patch.thickness)) return;
      if (command.patch.height !== undefined && !isPositive(command.patch.height)) return;
      Object.assign(wall, command.patch);
      return;
    }

    case 'AddOpening': {
      const room = draft.room;
      if (room === undefined) return;
      // Проём на несуществующей стене команда не создаёт: иначе она сама
      // порождала бы битую ссылку, которую потом ловит проверка — тот же
      // довод, что у `SetMaterialAssignment`.
      if (!room.walls.some((wall) => wall.id === command.opening.wallId)) return;
      if (room.openings.some((item) => item.id === command.opening.id)) return;
      room.openings.push(command.opening);
      return;
    }

    case 'RemoveOpening': {
      const room = draft.room;
      if (room === undefined) return;
      room.openings = room.openings.filter((item) => item.id !== command.openingId);
      return;
    }

    case 'UpdateOpening': {
      const opening = draft.room?.openings.find((item) => item.id === command.openingId);
      if (opening === undefined) return;
      if (command.patch.width !== undefined && !isPositive(command.patch.width)) return;
      if (command.patch.height !== undefined && !isPositive(command.patch.height)) return;
      Object.assign(opening, command.patch);
      return;
    }

    case 'AddObstacle': {
      const room = draft.room;
      if (room === undefined) return;
      if (room.obstacles.some((item) => item.id === command.obstacle.id)) return;
      room.obstacles.push(command.obstacle);
      return;
    }

    case 'RemoveObstacle': {
      const room = draft.room;
      if (room === undefined) return;
      room.obstacles = room.obstacles.filter((item) => item.id !== command.obstacleId);
      return;
    }

    case 'UpdateObstacle': {
      const obstacle = draft.room?.obstacles.find((item) => item.id === command.obstacleId);
      if (obstacle === undefined) return;
      Object.assign(obstacle, command.patch);
      return;
    }

    case 'AddFurnitureInstance': {
      const room = draft.room;
      if (room === undefined) return;
      // Экземпляр обязан ссылаться на изделие, которое в проекте есть:
      // добавить ссылку в никуда — значит создать ошибку самой командой.
      if (!draft.furniture.some((item) => item.id === command.instance.furnitureId)) return;
      if (room.furnitureInstances.some((item) => item.id === command.instance.id)) return;
      room.furnitureInstances.push(command.instance);
      return;
    }

    case 'RemoveFurnitureInstance': {
      const room = draft.room;
      if (room === undefined) return;
      room.furnitureInstances = room.furnitureInstances.filter((item) => item.id !== command.instanceId);
      return;
    }

    case 'TransformFurnitureInstance': {
      const instance = draft.room?.furnitureInstances.find((item) => item.id === command.instanceId);
      if (instance === undefined) return;
      // Заблокированный экземпляр не двигается: блокировка существует
      // ровно для того, чтобы случайный жест не сдвинул уже расставленное.
      if (instance.locked) return;
      if (command.position !== undefined) {
        if (!isFiniteVec3(command.position)) return;
        instance.position = command.position;
      }
      if (command.rotation !== undefined) {
        if (!Number.isFinite(command.rotation)) return;
        instance.rotation = command.rotation;
      }
      return;
    }

    case 'SetInstanceFlags': {
      const instance = draft.room?.furnitureInstances.find((item) => item.id === command.instanceId);
      if (instance === undefined) return;
      if (command.locked !== undefined) instance.locked = command.locked;
      if (command.visible !== undefined) instance.visible = command.visible;
      return;
    }
  }
}

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
