import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDrawer,
  createEmptyLeaf,
  createCountertop,
  createFalsePanel,
  createPlinthBase,
  createTopSection,
  createHandleOpeningSystem,
  createHingedFacade,
  createPushToOpenSystem,
  createDrawersLeaf,
  createShelvesLeaf,
} from '../domain/furniture/defaults.js';
import {
  DEFAULT_EDGE,
  NO_EDGE,
  asId,
  createRandomIdFactory,
  findNode,
  formatMm,
  isSplit,
} from '../domain/index.js';
import type {
  HingeSide,
  LeafFill,
  MaterialId,
  NodeId,
  OpeningSystem,
  PartRole,
} from '../domain/index.js';
import { createUniformGrid } from '../domain/furniture/sections.js';
import { buildGeometry, contentLabel } from '../geometry/index.js';
import { buildCuttingView, buildDebugView, CuttingMap, DebugSchema } from '../render/index.js';
import { calculateHardware, formatHardwareDebug } from '../hardware/index.js';
import { calculateCutting, toProductionParts } from '../production/index.js';
import { calculateDrilling, formatDrillingDebug } from '../drilling/index.js';
import { calculateProduction, formatProductionDebug } from '../bom/index.js';
import { exportPdf, exportXlsx } from './export-actions.js';
import { validateProductionReadiness } from '../workflow/index.js';
import { useSessionStore } from '../state/index.js';
import { useProjectStorage } from './use-project-storage.js';
import { useProjectLibrary } from './use-project-library.js';
import { useLinkedProjects } from './use-linked-projects.js';
import { ProjectLibrary } from './editor/ProjectLibrary.js';
import { EditorCanvas } from './editor/EditorCanvas.js';
import { Scene3D } from './editor/Scene3D.js';
import { rotateQuarter } from './editor/RoomPlanner.js';
import { Inspector } from './editor/Inspector.js';
import { describeSelection, resolveSelection } from './editor/selection.js';
import type { InspectorAction } from './editor/selection.js';
import type { GizmoTarget } from '../scene/index.js';
import { extentKey, findPlacement, furnitureExtent, validateRoom } from '../room/index.js';
import type { ExtentLookup } from '../room/index.js';
import { createFurnitureInstance, createRectangularRoom } from '../domain/index.js';
import type {
  Furniture,
  Issue,
  FurnitureId,
  InstanceId,
  Project,
  ProjectId,
  Vec3,
} from '../domain/index.js';
import { validateProject } from '../validation/index.js';
import { useDocumentStore } from '../state/index.js';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  NumberInput,
  Panel,
  SegmentedControl,
  Select,
  Switch,
} from '../design-system/index.js';
import { AppShell, ProjectContext, StatusBar, TopActions } from './shell/index.js';
import type { Screen } from './shell/index.js';
import {
  FIRST_STEP,
  MobileSteps,
  STEP_BY_ID,
  WorkflowNav,
  stepOfIssue,
  stepStates,
} from './workflow/index.js';
import { useLayoutMode } from './use-layout-mode.js';
import { usesFullStepRail, usesSheets } from './layout.js';
import { WorkspaceSlot } from './screens/WorkspaceSlot.js';
import type { StepId } from './workflow/index.js';
import { ProductionScreen } from './screens/ProductionScreen.js';
import { RoomScreen } from './screens/RoomScreen.js';
import workspace from './screens/Workspace.module.css';
import styles from './App.module.css';

/**
 * Оболочка приложения на этапе фундамента.
 *
 * Это НЕ интерфейс конструктора: схемы, перетаскивания перегородок и панели
 * свойств здесь нет — они относятся к следующим этапам плана. Экран решает
 * одну задачу: показать, что связка домен → геометрия → валидация → стор
 * действительно работает, и что изменение габарита проходит весь путь
 * без участия React в расчётах.
 */

/**
 * Виды наполнения, доступные в интерфейсе (PROMPT 27 §12).
 *
 * Список короче, чем `LeafFill`, и это не упрощение ради красоты.
 * `rod` и `rod+shelf` в модели есть, но движок помечает их
 * `not-implemented` и деталей для них не строит (`geometry/content.ts`).
 * Пункт, который ничего не строит, — обещание, которого приложение не
 * выполняет; поэтому в списке его нет, а причина названа рядом текстом.
 *
 * Подписи берутся из `contentLabel` — того же места, откуда их берёт
 * диагностика движка и техническая схема. Второго словаря видов
 * наполнения не заводится.
 */
const UI_FILL_KINDS = ['empty', 'shelves', 'drawers'] as const;

const FILL_OPTIONS = UI_FILL_KINDS.map((kind) => ({
  value: kind,
  label: kind === 'empty' ? 'Пусто' : contentLabel(kind),
}));

const FILL_LABELS: Readonly<Record<LeafFill['kind'], string>> = {
  empty: 'Пусто',
  shelves: contentLabel('shelves'),
  drawers: contentLabel('drawers'),
  rod: contentLabel('rod'),
  'rod+shelf': contentLabel('rod+shelf'),
};

/** Что означает выбранный вид наполнения — одной строкой для человека. */
const FILL_HINTS: Readonly<Record<LeafFill['kind'], string>> = {
  empty: 'Ячейка остаётся открытой. Полок и ящиков в ней нет.',
  shelves: 'Полки — физические детали: они попадают в деталировку, раскрой и кромку.',
  drawers: 'Ящик добавляет короб и фасад. Дверь на ячейку с ящиками поставить нельзя.',
  rod: 'Штанга есть в модели, но геометрией пока не строится.',
  'rod+shelf': 'Штанга с полкой есть в модели, но геометрией пока не строится.',
};

const AXES = [
  { key: 'width', label: 'Ширина' },
  { key: 'height', label: 'Высота' },
  { key: 'depth', label: 'Глубина' },
  { key: 'panelThickness', label: 'Толщина' },
] as const;

export function App(): React.JSX.Element {
  const project = useDocumentStore((s) => s.project);
  const execute = useDocumentStore((s) => s.execute);
  const undo = useDocumentStore((s) => s.undo);
  const beginTransaction = useDocumentStore((s) => s.beginTransaction);
  const endTransaction = useDocumentStore((s) => s.endTransaction);
  const redo = useDocumentStore((s) => s.redo);
  const history = useDocumentStore((s) => s.history);
  const replaceProject = useDocumentStore((s) => s.replaceProject);
  const markSaved = useDocumentStore((s) => s.markSaved);

  // Черновые значения полей сетки: рабочий проект не трогается до нажатия
  // «Применить» — перестроение дерева секций является отдельным осознанным
  // действием пользователя, а не непрерывным вводом вроде габарита
  // (docs/GEOMETRY_RULES.md §10, docs/INTERACTION_MODEL.md §4.4 — то же
  // разграничение «черновое значение / коммит», что и у транзакций drag).
  const [rowsDraft, setRowsDraft] = useState(1);
  const [columnsDraft, setColumnsDraft] = useState(1);
  const [shelvesDraft, setShelvesDraft] = useState(0);
  const [sectionsDraft, setSectionsDraft] = useState(1);
  const [sectionWidthsDraft, setSectionWidthsDraft] = useState('');
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  // Экспорт: одно состояние на обе кнопки. Пока идёт генерация, обе
  // заблокированы — второй запуск во время первого дал бы два файла и
  // непонятно какой из них актуален (§19).
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Выбранная для управления дверью ячейка (PROMPT 10 §19). Черновой выбор,
  // а не команда: сам по себе он ничего в проекте не меняет.
  // Выделение живёт в состоянии СЕССИИ (`src/state/session-store.ts`,
  // заведено на PROMPT 2 и до сих пор не подключалось к интерфейсу): оно
  // не сохраняется в файл и не отменяется по Ctrl+Z. Локального состояния
  // выделения здесь больше нет — второй источник выбора означал бы, что
  // холст и панели показывают разные объекты.
  const selectedNodes = useSessionStore((state) => state.selectedNodes);
  const selectedParts = useSessionStore((state) => state.selectedParts);
  const hoveredNode = useSessionStore((state) => state.hoveredNode);
  const selectNodes = useSessionStore((state) => state.selectNodes);
  const selectParts = useSessionStore((state) => state.selectParts);
  const selectedInstances = useSessionStore((state) => state.selectedInstances);
  const selectInstances = useSessionStore((state) => state.selectInstances);
  const setHovered = useSessionStore((state) => state.setHovered);
  const clearSelection = useSessionStore((state) => state.clearSelection);

  const furniture = project.furniture[0];

  // Пересчёт синхронный и мемоизированный по ссылке на проект. Immer даёт
  // структурное разделение, поэтому ссылка меняется только при реальном
  // изменении модели.
  const geometry = useMemo(() => {
    if (furniture === undefined) return undefined;
    return buildGeometry({
      furniture,
      scheme: project.settings.construction,
      tolerances: project.settings.tolerances,
      materials: project.materials,
      edgeSizing: project.settings.edgeSizing,
    });
  }, [furniture, project.settings, project.materials]);

  // Спецификация фурнитуры (PROMPT 16). Считается тем же способом, что и
  // геометрия — мемоизацией по ссылке на проект, поэтому изменение любого
  // габарита, наполнения или фасада пересчитывает её автоматически (§20):
  // ручного «пересчитать» нет и быть не может, количества нигде не хранятся.
  //
  // Готовая геометрия передаётся движку, а не считается им второй раз: это
  // ровно тот же результат, что уже показан на схеме, поэтому спецификация
  // гарантированно описывает то же изделие, что видит пользователь.
  //
  // Ветка `import.meta.env.DEV` — по той же причине, что у `debugView`:
  // интерфейса фурнитуры в этом этапе нет (§29 исключает производственный
  // UI), есть только технический вывод, и в production-бандл он не попадает.
  const hardwareDebug = useMemo(() => {
    if (!import.meta.env.DEV || furniture === undefined || geometry === undefined) return undefined;
    return formatHardwareDebug(
      calculateHardware(project, { geometry: new Map([[furniture.id, geometry]]) }),
    );
  }, [project, furniture, geometry]);

  // Карта раскроя (PROMPT 17). Как и фурнитура, производная величина:
  // пересчитывается из проекта и готовой геометрии, нигде не хранится и не
  // требует инвалидации — устареть нечему (§29).
  const cuttingView = useMemo(() => {
    if (!import.meta.env.DEV || furniture === undefined || geometry === undefined) return undefined;
    const result = calculateCutting(project, { geometry: new Map([[furniture.id, geometry]]) });
    return buildCuttingView(result, project.materials);
  }, [project, furniture, geometry]);

  // Карта присадки (PROMPT 18). Третья производная величина подряд и
  // считается так же: из проекта и готовой геометрии, без хранения и без
  // инвалидации — устаревать нечему (§26).
  const drillingDebug = useMemo(() => {
    if (!import.meta.env.DEV || furniture === undefined || geometry === undefined) return undefined;
    const geometryByFurniture = new Map([[furniture.id, geometry]]);
    const plan = calculateDrilling(project, { geometry: geometryByFurniture });
    const production = toProductionParts(
      geometry,
      project.materials,
      project.settings.cutting,
    ).parts;
    return formatDrillingDebug({
      plan,
      partsById: new Map(geometry.parts.map((p) => [p.id, p])),
      productionById: new Map(production.map((p) => [p.id, p])),
    });
  }, [project, furniture, geometry]);

  // Производственная спецификация (PROMPT 19). Единый конвейер: он сам
  // вызывает геометрию, детали, фурнитуру, присадку и раскрой ровно по
  // одному разу и агрегирует результат. Готовая геометрия передаётся, чтобы
  // не строить её второй раз — та же, что уже показана на схеме.
  const productionDebug = useMemo(() => {
    if (!import.meta.env.DEV || furniture === undefined || geometry === undefined) return undefined;
    return formatProductionDebug(
      calculateProduction(project, { geometry: new Map([[furniture.id, geometry]]) }),
    );
  }, [project, furniture, geometry]);

  /*
    Готовность к производству (PROMPT 21). Считается из того же расчёта,
    что и спецификация: отдельного «пересчитать» нет и быть не может —
    производных результатов не существует в устаревшем виде.

    Зависимости — не весь проект, а то, от чего расчёт действительно
    зависит (PROMPT 26 §30). Разница не косметическая: `project` меняется
    и при перемещении мебели по комнате, а расстановка не влияет ни на
    одну деталь. До этой правки каждый шаг перетаскивания в планировщике
    запускал весь производственный конвейер — геометрию, детали,
    фурнитуру, присадку, раскрой и спецификацию — ради результата,
    который заведомо не изменился.

    `project` всё ещё передаётся в расчёт: ему нужен весь документ.
    Перезапускается он теперь только когда меняется что-то из списка
    зависимостей.
  */
  const readiness = useMemo(() => {
    if (furniture === undefined || geometry === undefined) return undefined;
    return validateProductionReadiness(project, {
      calculation: calculateProduction(project, { geometry: new Map([[furniture.id, geometry]]) }),
    });
    // `project` намеренно не в списке зависимостей: см. комментарий выше —
    // иначе расчёт запускается на каждое движение мебели по комнате.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furniture, geometry, project.settings, project.materials, project.hardware]);

  const runExport = async (kind: 'pdf' | 'xlsx'): Promise<void> => {
    if (exporting !== null || furniture === undefined || geometry === undefined) return;
    setExporting(kind);
    setExportError(null);
    try {
      const context = {
        project,
        geometry: new Map([[String(furniture.id), geometry]]),
        now: () => new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      if (kind === 'pdf') await exportPdf(context);
      else await exportXlsx(context);
    } catch (error) {
      // Ошибку показываем текстом и оставляем кнопку рабочей: экспорт
      // должен быть повторяемым, а не заканчиваться тупиком (§19).
      setExportError(error instanceof Error ? error.message : 'Не удалось сформировать документ.');
    } finally {
      setExporting(null);
    }
  };

  // `selectedCellId` больше не хранится: он ВЫВОДИТСЯ из выделения. Так
  // панели дверей и ящиков и холст всегда говорят об одной ячейке.
  const selectedCellId: NodeId | '' =
    geometry === undefined
      ? ''
      : (selectedNodes.find((id) => geometry.cells.some((cell) => cell.nodeId === id)) ?? '');
  const setSelectedCellId = (id: NodeId | ''): void => {
    selectNodes(id === '' ? [] : [id]);
  };

  /**
   * Выбранная ячейка целиком (PROMPT 27 §9).
   *
   * Ячейка — ПРОСТРАНСТВО, а не деталь: в деталировку, раскрой и
   * спецификацию она не попадает. Поэтому здесь берётся `CellBox` из
   * результата расчёта, а не деталь из `parts`.
   */
  const selectedCell =
    selectedCellId === '' || geometry === undefined
      ? undefined
      : geometry.cells.find((cell) => cell.nodeId === selectedCellId);

  /** Наполнение выбранной ячейки — из модели, а не из отдельного состояния. */
  const selectedFillKind: LeafFill['kind'] = ((): LeafFill['kind'] => {
    if (selectedCellId === '' || furniture === undefined) return 'empty';
    const node = findNode(furniture.root, selectedCellId);
    return node?.kind === 'leaf' ? node.fill.kind : 'empty';
  })();

  const selectedShelfCount =
    selectedCellId === '' || furniture === undefined
      ? 0
      : ((): number => {
          const node = findNode(furniture.root, selectedCellId);
          return node?.kind === 'leaf' && node.fill.kind === 'shelves'
            ? node.fill.shelves.length
            : 0;
        })();

  /**
   * Смена наполнения ячейки.
   *
   * Одна существующая команда `SetFill` и существующие доменные фабрики.
   * Второй модели содержимого не заводится (§12): виды наполнения — это
   * ровно те, что есть в `LeafFill`.
   */
  const setCellFillKind = (kind: (typeof UI_FILL_KINDS)[number]): void => {
    if (selectedCellId === '') return;
    const ids = createRandomIdFactory();
    const fill: LeafFill =
      kind === 'shelves'
        ? createShelvesLeaf(ids, Math.max(1, selectedShelfCount)).fill
        : kind === 'drawers'
          ? createDrawersLeaf(ids, 1).fill
          : { kind: 'empty' };
    execute(
      { type: 'SetFill', furnitureIndex: 0, nodeId: selectedCellId, fill },
      `Наполнение: ${FILL_LABELS[kind]}`,
    );
  };

  /** Число полок в выбранной ячейке. Той же командой `SetFill`. */
  const setCellShelfCount = (count: number): void => {
    if (selectedCellId === '') return;
    const fill: LeafFill =
      count <= 0 ? { kind: 'empty' } : createShelvesLeaf(createRandomIdFactory(), count).fill;
    execute(
      { type: 'SetFill', furnitureIndex: 0, nodeId: selectedCellId, fill },
      `Полок в ячейке: ${String(count)}`,
    );
  };

  /**
   * Действия инспектора идут теми же командами, что и панели: инспектор —
   * ещё одна точка входа в существующую модель команд, а не второй способ
   * менять проект (§7).
   */
  const runInspectorAction = (action: InspectorAction): void => {
    switch (action.kind) {
      case 'add-door':
        setSelectedCellId(action.nodeId);
        addDoor();
        return;
      case 'remove-door':
        execute(
          { type: 'RemoveFacade', furnitureIndex: 0, facadeId: action.facadeId },
          'Убрать дверь',
        );
        return;
      case 'add-drawers':
        setSelectedCellId(action.nodeId);
        addDrawer();
        return;
      case 'add-shelves':
        execute(
          {
            type: 'SetFill',
            furnitureIndex: 0,
            nodeId: action.nodeId,
            fill: createShelvesLeaf(createRandomIdFactory(), 1).fill,
          },
          'Добавить полку',
        );
        return;
      case 'clear-fill':
        execute(
          { type: 'SetFill', furnitureIndex: 0, nodeId: action.nodeId, fill: { kind: 'empty' } },
          'Очистить ячейку',
        );
        return;
    }
  };

  /**
   * Вид холста в конструкторе: сцена или плоская схема.
   *
   * Это ОДНО И ТО ЖЕ изделие, показанное по-разному, поэтому выделение и
   * команды у них общие. Помещение из этого переключателя убрано
   * (PROMPT 26 §5): оно не вид изделия, а другой раздел — со своими
   * инструментами и своим инспектором.
   *
   * Состояние интерфейса: в проект не сохраняется и по Ctrl+Z не
   * отменяется, как и выделение (PROMPT 22 §5, PROMPT 23 §36).
   */
  const [canvasMode, setCanvasMode] = useState<'3d' | '2d'>('3d');

  // ── Планировщик помещения (PROMPT 24) ─────────────────────────────────────

  const room = project.room;

  /**
   * Геометрия каждого изделия проекта.
   *
   * Планировщик её НЕ считает: он получает уже построенную. Пересчёт
   * идёт при изменении изделий, а не при движении мебели по комнате
   * (§32) — от того, что шкаф подвинули, его детали не меняются.
   */
  /**
   * Проекты, размещённые в помещении помимо открытого (PROMPT 25 §13).
   *
   * Помещение может содержать изделия из нескольких проектов сразу;
   * загружаются они из того же хранилища и держатся в кэше, пока нужны.
   */
  const linked = useLinkedProjects(room, project.id);

  const furnitureGeometries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildGeometry>>();
    // Открытый проект и все связанные — одним и тем же способом. Второго
    // пути построения геометрии «для чужого проекта» не появляется.
    for (const source of [project, ...linked.projects.values()]) {
      for (const item of source.furniture) {
        map.set(
          extentKey(source.id, item.id),
          buildGeometry({
            furniture: item,
            scheme: source.settings.construction,
            tolerances: source.settings.tolerances,
            materials: source.materials,
            edgeSizing: source.settings.edgeSizing,
          }),
        );
      }
    }
    return map;
  }, [project, linked.projects]);

  const roomExtents: ExtentLookup = useMemo(() => {
    const map = new Map<string, Vec3>();
    for (const [key, result] of furnitureGeometries) map.set(key, furnitureExtent(result));
    return map;
  }, [furnitureGeometries]);

  const roomValidation = useMemo(
    () => (room === undefined ? undefined : validateRoom(room, { extents: roomExtents })),
    [room, roomExtents],
  );

  const furnitureNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of [project, ...linked.projects.values()]) {
      for (const item of source.furniture) map.set(item.id, item.name);
    }
    return map;
  }, [project, linked.projects]);

  const createRoom = (): void => {
    execute(
      {
        type: 'SetRoom',
        room: createRectangularRoom({
          ids: createRandomIdFactory(),
          width: 4000,
          depth: 3000,
          height: 2700,
        }),
      },
      'Создать помещение',
    );
    setScreen('room');
  };

  /**
   * Изделие по паре «проект + изделие» (PROMPT 25 §13).
   *
   * Ищет и в открытом проекте, и в связанных: ссылка экземпляра
   * полностью квалифицирована, и разбирать её двумя разными способами
   * значило бы завести два вида ссылок.
   */
  const furnitureOf = (projectId: ProjectId, furnitureId: FurnitureId): Furniture | undefined => {
    const source = projectId === project.id ? project : linked.projects.get(projectId);
    return source?.furniture.find((entry) => entry.id === furnitureId);
  };

  const placeInRoom = (projectId: ProjectId, furnitureId: FurnitureId, label: string): void => {
    const item = furnitureOf(projectId, furnitureId);
    if (item === undefined || room === undefined) return;
    const extent = roomExtents.get(extentKey(projectId, furnitureId));

    // Новая мебель ставится в первое СВОБОДНОЕ место — угол, затем
    // стену, — а не в начало координат: оно лежит на осевой линии стен,
    // и изделие появлялось бы сразу внутри двух стен. Подробнее, включая
    // отвергнутые варианты, — `src/room/autoplace.ts`.
    const placed =
      extent === undefined
        ? { position: { x: 0, y: 0, z: 0 }, rotation: 0 }
        : findPlacement(room, projectId, furnitureId, extent, roomExtents);

    execute(
      {
        type: 'AddFurnitureInstance',
        instance: {
          ...createFurnitureInstance(createRandomIdFactory(), projectId, item, placed.position),
          rotation: placed.rotation,
        },
      },
      label,
    );
  };

  /**
   * Разместить в помещении проект из библиотеки (§13, §14).
   *
   * Проект сначала загружается — без него неизвестен ни его габарит, ни
   * его изделия. Размещается первое изделие: остальные добавляются
   * отдельно, каждым своим действием, и повторить это действие можно
   * сколько угодно раз (§14) — одинаковых экземпляров у одного проекта
   * может быть много, и ничего в модели этому не мешает.
   */
  const addProjectToRoom = (projectId: ProjectId): void => {
    void (async () => {
      const source = projectId === project.id ? project : await linked.link(projectId);
      const first = source?.furniture[0];
      if (first === undefined) return;
      placeInRoom(projectId, first.id, 'Разместить проект в помещении');
    })();
  };

  const duplicateInstance = (instanceId: InstanceId): void => {
    const source = room?.furnitureInstances.find((item) => item.id === instanceId);
    if (source === undefined) return;
    const item = furnitureOf(source.projectId, source.furnitureId);
    if (item === undefined) return;
    const extent = roomExtents.get(extentKey(source.projectId, source.furnitureId));
    // Копия ставится рядом, а не поверх оригинала: два объекта в одной
    // точке выглядят как один, и пользователь решил бы, что ничего не
    // произошло. Смещение — на собственную ширину копии, а не на
    // выдуманное число.
    const offset = extent?.x ?? 0;
    execute(
      {
        type: 'AddFurnitureInstance',
        instance: {
          ...createFurnitureInstance(createRandomIdFactory(), source.projectId, item, {
            x: source.position.x + offset,
            y: source.position.y,
            z: source.position.z,
          }),
          rotation: source.rotation,
        },
      },
      'Дублировать',
    );
  };

  /**
   * Ручка на сцене изменила размер (PROMPT 23 §23).
   *
   * Обе операции выражаются УЖЕ СУЩЕСТВУЮЩИМИ командами: габарит —
   * `SetDimension`, ширина секции и высота ряда — `SetChildSize` по id
   * ребёнка деления. Ни одной новой команды 3D-сцена не потребовала, и
   * это ожидаемо: она показывает ту же модель, а не другую.
   */
  const runGizmoResize = (target: GizmoTarget, value: number): void => {
    if (target.kind === 'furniture-width') {
      execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'width', value }, 'Ширина изделия');
      return;
    }
    if (target.kind === 'furniture-height') {
      execute({ type: 'SetDimension', furnitureIndex: 0, axis: 'height', value }, 'Высота изделия');
      return;
    }
    // `fixed` осознанно: пользователь только что задал этому ребёнку
    // конкретный размер руками. Оставить его `flex` значило бы, что
    // размер немедленно уедет при следующем изменении габарита, и жест
    // окажется бессмысленным (`SizeSpec`, T-DIM-04).
    execute(
      {
        type: 'SetChildSize',
        furnitureIndex: 0,
        childId: target.childId,
        size: { mode: 'fixed', value },
      },
      target.axis === 'x' ? 'Ширина секции' : 'Высота ряда',
    );
  };

  /**
   * Переход от текста ошибки к объекту и к шагу (PROMPT 22 §29,
   * PROMPT 27 §24).
   *
   * Три действия подряд, и все три нужны. Выделить объект мало: человек
   * увидит подсвеченную деталь, но останется на шаге, где её параметра
   * нет. Поэтому сначала открывается шаг, которому проблема принадлежит,
   * а потом выделяется сам объект — и нужное поле оказывается на экране.
   *
   * Шаг определяется по уже существующим полям диагностики (код и путь к
   * полю), а не по новому полю в `Issue`: домен не должен знать
   * устройство интерфейса.
   */
  const goToIssue = (issue: Issue): void => {
    const owner = stepOfIssue(issue);
    if (owner !== undefined) goToStep(owner);
    if (issue.target?.partId !== undefined) selectParts([issue.target.partId]);
    else if (issue.target?.nodeId !== undefined) selectNodes([issue.target.nodeId]);
  };

  const storage = useProjectStorage(project, { onStored: markSaved });

  // ── Библиотека проектов (PROMPT 25) ───────────────────────────────────────

  const library = useProjectLibrary();
  /**
   * Текущий раздел приложения (PROMPT 26 §3).
   *
   * Одно состояние на всю навигацию. Раньше их было два — `libraryOpen`
   * булевым и `canvasMode === 'room'` — и вопрос «где я нахожусь»
   * складывался из двух ответов, которые могли противоречить друг другу.
   *
   * Адресов у разделов нет: приложение работает без сервера, и заводить
   * маршрутизацию ради четырёх экранов значило бы построить вторую
   * навигацию рядом с переключателем.
   */
  const [screen, setScreen] = useState<Screen>('editor');

  /**
   * Текущий шаг сценария (PROMPT 27 §2, §27).
   *
   * Состояние ИНТЕРФЕЙСА, и только оно: копии мебели внутри сценария
   * нет, все изменения идут существующими командами. Шаг не хранится в
   * проекте и не отменяется по Ctrl+Z — «отменить переход на другой шаг»
   * не значит ничего.
   */
  const [step, setStep] = useState<StepId>(FIRST_STEP);
  const lastEditorStepRef = useRef<StepId>(FIRST_STEP);
  const lastProductionStepRef = useRef<StepId>('validation');
  /** Где уже были: нужно только лестнице шагов, чтобы отличать «не открывали». */
  const [visited, setVisited] = useState<ReadonlySet<StepId>>(() => new Set([FIRST_STEP]));

  /**
   * Режим раскладки (PROMPT 28 §3).
   *
   * Состояние ИНТЕРФЕЙСА, и только оно: поворот телефона не меняет ни
   * одного миллиметра изделия. Ни второй модели, ни второго рендерера
   * под мобильный режим не заводится — меняется место панелей.
   */
  const layout = useLayoutMode();
  const mobile = usesSheets(layout);

  /**
   * Какой лист открыт на телефоне (§7, §8, §24).
   *
   * `null` — открыт холст, и это состояние по умолчанию: на телефоне
   * изделие важнее полей ввода. Один лист за раз: два одновременно не
   * поместятся, а очередь из листов — способ потерять, где ты.
   */
  const [sheet, setSheet] = useState<'params' | 'object' | 'steps' | null>(null);
  const closeSheet = (): void => {
    setSheet(null);
  };

  // Последний шаг в каждом разделе: чтобы возврат в раздел возвращал
  // туда же, откуда ушли.
  const lastEditorStep = STEP_BY_ID[step].screen === 'editor' ? step : lastEditorStepRef.current;
  const lastProductionStep =
    STEP_BY_ID[step].screen === 'production' ? step : lastProductionStepRef.current;
  lastEditorStepRef.current = lastEditorStep;
  lastProductionStepRef.current = lastProductionStep;

  /**
   * Переход на шаг.
   *
   * Шаг знает свой экран, поэтому переход на «Проверку» сам открывает
   * раздел «Производство». Иначе человек нажал бы на шаг и остался бы
   * там же, где стоял.
   */
  const goToStep = (next: StepId): void => {
    setStep(next);
    setVisited((seen) => (seen.has(next) ? seen : new Set(seen).add(next)));
    setScreen(STEP_BY_ID[next].screen);
    // Список этапов закрывается сам: он открывался, чтобы выбрать шаг, и
    // шаг выбран. Оставить его открытым поверх нового шага значило бы
    // требовать второго нажатия за уже принятое решение.
    setSheet((current) => (current === 'steps' ? null : current));
  };

  /**
   * Переход по разделам приложения (PROMPT 26 §3) с сохранением места в
   * сценарии.
   *
   * Разделом можно переключиться и мимо лестницы шагов — кнопками в
   * шапке. Тогда шаг обязан последовать за разделом: иначе в
   * конструкторе остался бы открыт шаг «Проверка», который живёт в
   * производстве, и боковая колонка оказалась бы пустой. Возврат идёт на
   * ТОТ ЖЕ шаг, где человек был в этом разделе, а не в начало: терять
   * место при переключении туда-обратно — то же, что терять работу.
   */
  const goToScreen = (next: Screen): void => {
    setScreen(next);
    if (next !== 'editor' && next !== 'production') return;
    if (STEP_BY_ID[step].screen === next) return;
    const restored = next === 'editor' ? lastEditorStep : lastProductionStep;
    setStep(restored);
    setVisited((seen) => (seen.has(restored) ? seen : new Set(seen).add(restored)));
  };

  /**
   * Открытие проекта из библиотеки (§21).
   *
   * Документ заменяется целиком, история сбрасывается — открыт другой
   * проект, и отменять в нём правки предыдущего было бы бессмыслицей.
   * `markClean` нужен, чтобы только что открытый проект не показывался
   * несохранённым: на диске лежит ровно он.
   */
  const openProject = (opened: Project): void => {
    replaceProject(opened);
    storage.markClean(opened);
    setScreen('editor');
  };

  /**
   * Выгрузка проекта файлом (§20).
   *
   * Blob и ссылка — всё, что нужно: файл собирается в браузере и никуда
   * не отправляется. Адрес объекта освобождается сразу, иначе вкладка
   * держала бы его до закрытия.
   */
  const exportProjectFile = (source: Project): void => {
    const { text, fileName } = library.exportProject(source);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    // Уборка — следующим кадром, а не сразу: у оторванной от документа
    // ссылки браузер игнорирует `download` и сохраняет файл под именем
    // «download», а немедленный `revokeObjectURL` успевает отменить саму
    // загрузку.
    requestAnimationFrame(() => {
      link.remove();
      URL.revokeObjectURL(url);
    });
  };

  /**
   * Список библиотеки перечитывается после записи.
   *
   * `updatedAt` меняется ровно в двух случаях: проект сохранён и проект
   * открыт (§3). И то и другое — момент, когда список на экране мог
   * устареть. Подписываться на само сохранение было бы вторым сигналом
   * о том же событии.
   */
  const refreshLibrary = library.refresh;
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary, project.metadata.updatedAt]);

  /** Сколько раз проект размещён в открытом помещении (§12). */
  const placementsOf = (id: ProjectId): number =>
    room?.furnitureInstances.filter((instance) => instance.projectId === id).length ?? 0;

  // Восстановление последнего сохранённого проекта при открытии вкладки
  // (§28). Регистрации нет, «моих проектов» нет — но и терять работу
  // из-за закрытой вкладки пользователь не должен. Загрузка идёт один
  // раз: `restore` стабильна, а повторный вызов затёр бы правки.
  const restore = storage.restore;
  useEffect(() => {
    let cancelled = false;
    void restore().then((restored) => {
      if (!cancelled && restored !== undefined) replaceProject(restored);
    });
    return () => {
      cancelled = true;
    };
  }, [restore, replaceProject]);

  const selection =
    geometry === undefined ? undefined : resolveSelection(selectedNodes, selectedParts, geometry);
  const inspector =
    geometry === undefined || furniture === undefined || selection === undefined
      ? undefined
      : describeSelection(selection, furniture, geometry, project.materials);

  const report = useMemo(() => validateProject(project), [project]);

  // Диагностика движка и диагностика валидации — один и тот же тип `Issue`,
  // и пользователю они одинаково важны: до PROMPT 8 показывалась только
  // вторая, поэтому ошибка расчёта (например, «размеры не заполняют
  // доступное пространство») оставляла схему пустой БЕЗ объяснения. Это
  // прямо противоречит принципу «ошибка объясняется текстом», ради которого
  // существует эта панель.
  const problems = useMemo(
    () => (geometry === undefined ? report.issues : [...geometry.diagnostics, ...report.issues]),
    [geometry, report],
  );
  // `import.meta.env.DEV` внутри useMemo, а не только вокруг <DebugSchema/>:
  // сама сборка view-модели тоже относится к debug-слою. Пока условие стояло
  // лишь у компонента, `buildDebugView` попадала в production-бандл и честно
  // считалась на каждый пересчёт геометрии — результат никто не отрисовывал.
  // Найдено на PROMPT 7 по строке «SECTION » в собранном файле: прежняя
  // проверка искала имена (`DebugSchema`, `buildDebugView`), которые
  // минификация стирает, и потому давала ложное «чисто».
  // Модель вида холста — та же функция, что и у технической схемы:
  // `buildDebugView` переводит результат движка в прямоугольники и ничего
  // не считает сама. Второго построителя вида не заводится (§30).
  /**
   * Состояния шагов (PROMPT 27 §27).
   *
   * Выводятся из ТЕХ ЖЕ проблем, что показывает строка состояния: второго
   * источника правды о том, что не так с проектом, не появляется.
   */
  const workflowSteps = useMemo(
    () => stepStates({ issues: problems, current: step, visited }),
    [problems, step, visited],
  );

  const canvasView = useMemo(
    () => (geometry === undefined ? undefined : buildDebugView(geometry, project.materials)),
    [geometry, project.materials],
  );

  const debugView = useMemo(
    () =>
      !import.meta.env.DEV || geometry === undefined
        ? undefined
        : buildDebugView(geometry, project.materials),
    [geometry, project.materials],
  );

  if (furniture === undefined || geometry === undefined) {
    return <p>Проект не содержит изделий.</p>;
  }

  // Дерево секций заменяется целиком одной командой SetRoot (см.
  // state/commands.ts) — построение равномерной сетки rows×columns здесь
  // и есть демонстрация PROMPT 4 §11: изменение количества строк/колонок
  // пересчитывает перегородки, ячейки и bounding box за один шаг истории.
  const applyGrid = (): void => {
    const ids = createRandomIdFactory();
    // Наполнение ячейки (полки, PROMPT 6) задаётся фабрикой листа: структура
    // сетки и содержимое ячейки — разные решения, см. `SectionContentFactory`.
    const createLeaf = (factoryIds: typeof ids) =>
      shelvesDraft <= 0
        ? createEmptyLeaf(factoryIds)
        : createShelvesLeaf(factoryIds, shelvesDraft, 'adjustable');
    const root =
      rowsDraft <= 1 && columnsDraft <= 1
        ? createLeaf(ids)
        : createUniformGrid(
            ids,
            rowsDraft,
            columnsDraft,
            furniture.dimensions.panelThickness,
            furniture.dimensions.panelThickness,
            createLeaf,
          );
    execute(
      { type: 'SetRoot', furnitureIndex: 0, root },
      `Сетка ${String(rowsDraft)}×${String(columnsDraft)}, полок в ячейке: ${String(shelvesDraft)}`,
    );
  };

  // Изменение числа секций идёт ОТДЕЛЬНОЙ командой, а не пересборкой дерева
  // через SetRoot: `SetSectionCount` правит только хвост списка секций,
  // поэтому у секций, которых пользователь не трогал, сохраняются id — а с
  // ними выделение, история и всё, что на них ссылается (PROMPT 7 §14–15).
  const applySectionCount = (): void => {
    const ids = createRandomIdFactory();
    execute(
      {
        type: 'SetSectionCount',
        furnitureIndex: 0,
        count: sectionsDraft,
        splitId: ids.next<'Node'>(),
        newSectionIds: Array.from({ length: sectionsDraft }, () => ids.next<'Node'>()),
        dividerThickness: furniture.dimensions.panelThickness,
      },
      `Секций: ${String(sectionsDraft)}`,
    );
  };

  // Индивидуальные ширины секций (PROMPT 8). Применяются командой
  // SetChildSize по id каждой секции — не пересборкой дерева, поэтому
  // id секций, ячеек и полок остаются прежними. Пустое поле возвращает
  // режим равных секций: все дети снова становятся растягиваемыми.
  const applySectionWidths = (): void => {
    const root = furniture.root;
    if (!isSplit(root) || root.axis !== 'x') return;
    const values = sectionWidthsDraft
      .split(',')
      .map((raw) => Number(raw.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    // Одна транзакция — один шаг истории на всё изменение, как и для жеста.
    beginTransaction(`Ширины секций: ${sectionWidthsDraft || 'равные'}`);
    root.children.forEach((child, index) => {
      const value = values[index];
      execute({
        type: 'SetChildSize',
        furnitureIndex: 0,
        childId: child.node.id,
        size: value === undefined ? { mode: 'flex', weight: 1 } : { mode: 'fixed', value },
      });
    });
    endTransaction();
  };

  // Технические элементы управления дверью (PROMPT 10 §19): выбрать ячейку,
  // добавить/убрать дверь, сторона петель, материал через уже существующий
  // materialId. НЕ производственный UI — минимум, нужный для проверки
  // конвейера Cell → FacadeGroup → resolveDoorGeometry → Part.
  const facadeForCell = (nodeId: NodeId) =>
    furniture.facades.find((f) => f.covers.kind === 'node' && f.covers.nodeId === nodeId);
  const selectedFacade = selectedCellId === '' ? undefined : facadeForCell(selectedCellId);

  const addDoor = (): void => {
    if (selectedCellId === '') return;
    const facade = createHingedFacade(createRandomIdFactory(), selectedCellId, 1);
    execute({ type: 'AddFacade', furnitureIndex: 0, facade }, 'Добавить дверь');
  };

  const removeDoor = (): void => {
    if (selectedFacade === undefined) return;
    execute(
      { type: 'RemoveFacade', furnitureIndex: 0, facadeId: selectedFacade.id },
      'Убрать дверь',
    );
  };

  const setDoorHingeSide = (hingeSide: HingeSide): void => {
    const leaf = selectedFacade?.leaves[0];
    if (selectedFacade === undefined || leaf === undefined) return;
    execute(
      {
        type: 'UpdateFacadeLeaf',
        furnitureIndex: 0,
        facadeId: selectedFacade.id,
        leafId: leaf.id,
        patch: { hingeSide },
      },
      'Сторона петель',
    );
  };

  const setDoorMaterial = (materialId: MaterialId): void => {
    const leaf = selectedFacade?.leaves[0];
    if (selectedFacade === undefined || leaf === undefined) return;
    execute(
      {
        type: 'UpdateFacadeLeaf',
        furnitureIndex: 0,
        facadeId: selectedFacade.id,
        leafId: leaf.id,
        patch: { materialId },
      },
      'Материал двери',
    );
  };

  // Способ открывания двери (PROMPT 12 §19): та же команда UpdateFacadeLeaf,
  // поле patch.opening — ни setOpeningSystem, ни addHandle отдельно не заведены.
  const setDoorOpening = (kind: OpeningSystem['kind']): void => {
    const leaf = selectedFacade?.leaves[0];
    if (selectedFacade === undefined || leaf === undefined) return;
    const ids = createRandomIdFactory();
    const opening: OpeningSystem =
      kind === 'none'
        ? { kind: 'none' }
        : kind === 'handle'
          ? createHandleOpeningSystem(ids, leaf.hingeSide)
          : createPushToOpenSystem(ids, leaf.hingeSide);
    execute(
      {
        type: 'UpdateFacadeLeaf',
        furnitureIndex: 0,
        facadeId: selectedFacade.id,
        leafId: leaf.id,
        patch: { opening },
      },
      'Способ открывания двери',
    );
  };

  // Технические элементы управления ящиками (PROMPT 11 §21): та же выбранная
  // ячейка, что и у двери — ящик и дверь в одной ячейке несовместимы
  // (§14, `DOOR_CELL_HAS_DRAWERS`), поэтому один селектор ячейки на оба
  // наполнения достаточен и не заводит вторую систему выбора. В отличие
  // от двери, ящики — уже существующий `LeafFill.kind === 'drawers'`
  // (`docs/GEOMETRY_RULES.md`), поэтому команда — уже существующий `SetFill`,
  // без новых addDrawer/removeDrawer: то же решение, каким PROMPT 6/9
  // обошлись без отдельных addShelf/removeShelf.
  const selectedLeaf = selectedCellId === '' ? undefined : findNode(furniture.root, selectedCellId);
  const selectedDrawers =
    selectedLeaf?.kind === 'leaf' && selectedLeaf.fill.kind === 'drawers'
      ? selectedLeaf.fill.drawers
      : [];
  const canAddDrawer =
    selectedCellId !== '' &&
    selectedFacade === undefined &&
    selectedLeaf?.kind === 'leaf' &&
    (selectedLeaf.fill.kind === 'empty' || selectedLeaf.fill.kind === 'drawers');

  const addDrawer = (): void => {
    if (selectedCellId === '' || !canAddDrawer) return;
    const drawer = createDrawer(createRandomIdFactory());
    const fill: LeafFill = { kind: 'drawers', drawers: [...selectedDrawers, drawer] };
    execute({ type: 'SetFill', furnitureIndex: 0, nodeId: selectedCellId, fill }, 'Добавить ящик');
  };

  const removeDrawer = (): void => {
    if (selectedCellId === '' || selectedDrawers.length === 0) return;
    const rest = selectedDrawers.slice(0, -1);
    const fill: LeafFill =
      rest.length === 0 ? { kind: 'empty' } : { kind: 'drawers', drawers: rest };
    execute({ type: 'SetFill', furnitureIndex: 0, nodeId: selectedCellId, fill }, 'Убрать ящик');
  };

  // Способ открывания ящиков (PROMPT 12 §19): применяется ко ВСЕМ ящикам
  // выбранной ячейки разом (тот же стиль ручек на всей стопке) — через тот
  // же SetFill, что и добавление/удаление ящика, второй команды не заведено.
  const setDrawersOpening = (kind: OpeningSystem['kind']): void => {
    if (selectedCellId === '' || selectedDrawers.length === 0) return;
    const drawers = selectedDrawers.map((drawer) => {
      const ids = createRandomIdFactory();
      const opening: OpeningSystem =
        kind === 'none'
          ? { kind: 'none' }
          : kind === 'handle'
            ? createHandleOpeningSystem(ids)
            : createPushToOpenSystem(ids);
      return { ...drawer, facade: { ...drawer.facade, opening } };
    });
    execute(
      {
        type: 'SetFill',
        furnitureIndex: 0,
        nodeId: selectedCellId,
        fill: { kind: 'drawers', drawers },
      },
      'Способ открывания ящиков',
    );
  };

  // Технические элементы управления корпусом (PROMPT 14 §27): задняя стенка
  // и цоколь. НЕ производственный UI — минимум, нужный, чтобы пройти путь
  // Carcass → StructuralConfiguration → BackWall/Plinth → Parts руками.
  const backPanel = furniture.carcass.back;
  const plinth = furniture.carcass.base;

  const setBackMount = (kind: 'none' | 'overlay' | 'inset-flush'): void => {
    const thickness = backPanel.mount.kind === 'none' ? 3 : backPanel.mount.thickness;
    const mount =
      kind === 'none'
        ? ({ kind: 'none' } as const)
        : kind === 'overlay'
          ? ({ kind: 'overlay', thickness } as const)
          : ({ kind: 'inset-flush', thickness } as const);
    execute({ type: 'SetBackPanel', furnitureIndex: 0, patch: { mount } }, 'Монтаж задней стенки');
  };

  const setBackThickness = (thickness: number): void => {
    if (!Number.isFinite(thickness) || thickness <= 0 || backPanel.mount.kind === 'none') return;
    execute(
      {
        type: 'SetBackPanel',
        furnitureIndex: 0,
        patch: { mount: { ...backPanel.mount, thickness } },
      },
      'Толщина задней стенки',
    );
  };

  const setBackSegmentation = (segmentation: 'single' | 'per-section'): void => {
    execute(
      { type: 'SetBackPanel', furnitureIndex: 0, patch: { segmentation } },
      'Разделение задней стенки',
    );
  };

  const setPlinthHeight = (height: number): void => {
    if (!Number.isFinite(height) || height < 0) return;
    if (height === 0) {
      execute({ type: 'SetBase', furnitureIndex: 0, base: null }, 'Убрать цоколь');
      return;
    }
    if (plinth === undefined) {
      execute(
        { type: 'SetBase', furnitureIndex: 0, base: createPlinthBase(height) },
        'Добавить цоколь',
      );
      return;
    }
    execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { height } }, 'Высота цоколя');
  };

  const setPlinthSetback = (setback: number): void => {
    if (plinth === undefined || !Number.isFinite(setback) || setback < 0) return;
    execute({ type: 'UpdateBase', furnitureIndex: 0, patch: { setback } }, 'Отступ цоколя');
  };

  const togglePlinthSides = (withSides: boolean): void => {
    if (plinth === undefined) return;
    execute(
      {
        type: 'UpdateBase',
        furnitureIndex: 0,
        patch: { parts: withSides ? ['front', 'left', 'right'] : ['front'] },
      },
      'Состав царг цоколя',
    );
  };

  // Конструктивные модификаторы (PROMPT 15 §21): свес, антресоль, зазор до
  // потолка, столешница, крепление и фальшпанели. Технический минимум —
  // полноценная панель конструкции не этот этап.
  const modifiers = furniture.carcass;

  const setCeilingGap = (value: number): void => {
    if (!Number.isFinite(value) || value < 0) return;
    execute(
      {
        type: 'SetStructuralModifiers',
        furnitureIndex: 0,
        patch: { ceilingGap: value === 0 ? null : value },
      },
      'Зазор до потолка',
    );
  };

  const setTopSectionHeight = (value: number): void => {
    if (!Number.isFinite(value) || value < 0) return;
    execute(
      {
        type: 'SetStructuralModifiers',
        furnitureIndex: 0,
        patch: {
          topSection: value === 0 ? null : createTopSection(value, modifiers.topSection?.gap ?? 0),
        },
      },
      'Высота антресоли',
    );
  };

  const setCountertopThickness = (value: number): void => {
    if (!Number.isFinite(value) || value < 0) return;
    if (value === 0) {
      execute(
        { type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop: null } },
        'Убрать столешницу',
      );
      return;
    }
    const materialId =
      modifiers.countertop?.materialId ?? asId<'Material'>(project.settings.defaultMaterialId);
    const countertop =
      modifiers.countertop === undefined
        ? createCountertop(value, materialId)
        : { ...modifiers.countertop, thickness: value };
    execute(
      { type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { countertop } },
      'Толщина столешницы',
    );
  };

  const setCountertopOverhang = (value: number): void => {
    const current = modifiers.countertop;
    if (current === undefined || !Number.isFinite(value) || value < 0) return;
    execute(
      {
        type: 'SetStructuralModifiers',
        furnitureIndex: 0,
        patch: {
          countertop: {
            ...current,
            overhangFront: value,
            overhangLeft: value,
            overhangRight: value,
          },
        },
      },
      'Свес столешницы',
    );
  };

  const setWallMount = (mode: 'floor-standing' | 'wall-mounted' | 'suspended'): void => {
    execute(
      { type: 'SetStructuralModifiers', furnitureIndex: 0, patch: { wallMount: { mode } } },
      'Установка изделия',
    );
  };

  const addFalsePanel = (position: 'left' | 'right' | 'top' | 'bottom'): void => {
    execute(
      {
        type: 'AddFalsePanel',
        furnitureIndex: 0,
        panel: createFalsePanel(createRandomIdFactory(), position),
      },
      'Добавить фальшпанель',
    );
  };

  const removeLastFalsePanel = (): void => {
    const last = (modifiers.falsePanels ?? []).at(-1);
    if (last === undefined) return;
    execute(
      { type: 'RemoveFalsePanel', furnitureIndex: 0, panelId: last.id },
      'Убрать фальшпанель',
    );
  };

  // Технические элементы управления материалами (PROMPT 13 §23): реестр,
  // толщина материала, назначение по ролям и кромка. НЕ Material Editor —
  // минимум, нужный, чтобы пройти конвейер
  // Material → Thickness → Part → Geometry руками и увидеть, что
  // изменение толщины материала пересчитывает всю зависимую геометрию.
  const materialList = Object.values(project.materials.items);

  const setMaterialThickness = (materialId: MaterialId, thickness: number): void => {
    const material = project.materials.items[materialId];
    if (material === undefined || !Number.isFinite(thickness) || thickness <= 0) return;
    execute(
      { type: 'UpsertMaterial', material: { ...material, thickness } },
      `Толщина материала: ${material.name}`,
    );
  };

  /** Назначение материала группе ролей — одна транзакция, один шаг истории. */
  const assignMaterial = (
    roles: readonly PartRole[],
    materialId: MaterialId,
    label: string,
  ): void => {
    beginTransaction(label);
    for (const role of roles) execute({ type: 'SetMaterialAssignment', role, materialId });
    endTransaction();
  };

  const CARCASS_ROLES: readonly PartRole[] = ['side', 'top', 'bottom', 'partition'];
  const SHELF_ROLES: readonly PartRole[] = ['shelf-fixed', 'shelf-adjustable'];

  // Кромка створки: три варианта — по умолчанию (2/0/0.4/0.4), без кромки
  // и снять переопределение (`null`, `removePartEdge` из §18).
  const setDoorEdge = (mode: 'default' | 'none' | 'inherit'): void => {
    const leaf = selectedFacade?.leaves[0];
    if (selectedFacade === undefined || leaf === undefined) return;
    const edge = mode === 'default' ? DEFAULT_EDGE : mode === 'none' ? NO_EDGE : null;
    execute(
      {
        type: 'UpdateFacadeLeaf',
        furnitureIndex: 0,
        facadeId: selectedFacade.id,
        leafId: leaf.id,
        patch: { edge },
      },
      'Кромка двери',
    );
  };

  // Дверь и фасад ящика используют одну и ту же роль `facade` (переиспользована,
  // не заведена вторая) — для счётчиков в панели результата их различают
  // по наполнению ячейки-источника, тем же способом, что и debug-схема
  // (`render/debug-view.ts`).
  const cellFillKindByNodeId = new Map(geometry.cells.map((cell) => [cell.nodeId, cell.fill.kind]));
  const facadeParts = geometry.parts.filter((p) => p.role === 'facade');
  const doorPartCount = facadeParts.filter(
    (p) => p.origin.nodeId === undefined || cellFillKindByNodeId.get(p.origin.nodeId) !== 'drawers',
  ).length;
  const drawerFacadePartCount = facadeParts.length - doorPartCount;
  const handlePartCount = geometry.parts.filter((p) => p.role === 'handle').length;
  const pushToOpenPartCount = geometry.parts.filter((p) => p.role === 'push-to-open').length;

  return (
    <AppShell
      screen={screen}
      onScreen={goToScreen}
      context={
        <ProjectContext
          name={project.name}
          size={furniture.dimensions}
          storage={storage.status}
          {...(storage.ephemeral ? { storageDetail: 'только память вкладки' } : {})}
        />
      }
      actions={
        <TopActions
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          storage={storage.status}
          production={readiness?.status}
          onUndo={undo}
          onRedo={redo}
          onSave={() => {
            void storage.save();
          }}
        />
      }
      status={
        <StatusBar
          issues={problems}
          production={readiness?.status}
          storage={storage.status}
          onSelectIssue={goToIssue}
        />
      }
    >
      {screen === 'library' ? (
        <ProjectLibrary
          library={library}
          currentProjectId={project.id}
          currentIsDirty={storage.status === 'unsaved'}
          onOpen={openProject}
          onExport={exportProjectFile}
          placementsOf={placementsOf}
        />
      ) : null}

      {screen === 'production' ? (
        // `data-stacked`: производство — сплошной текст, и на планшете
        // боковая колонка делает его вдвое длиннее (PROMPT 28 §31).
        <div className={workspace.workspace} data-stacked="">
          {/*
            Лестница шагов видна и здесь: «Проверка» и «Производство» —
            такие же шаги сценария, как «Размеры», и уйти с них обратно в
            конструктор нужно тем же способом, каким сюда пришли.
          */}
          {!usesFullStepRail(layout) ? null : (
            <div className={workspace.sidebar}>
              <WorkflowNav steps={workflowSteps} current={step} onStep={goToStep} />
            </div>
          )}
          <div className={workspace.canvas}>
            <ProductionScreen
              readiness={readiness}
              exporting={exporting}
              exportError={exportError}
              compact={mobile}
              onExport={(kind) => {
                void runExport(kind);
              }}
            />
          </div>
          {/*
            На телефоне здесь та же полоса шагов, что в конструкторе
            (PROMPT 28 §24): «Проверка» и «Производство» — такие же шаги
            сценария, и уходить с них нужно тем же способом.
          */}
          {!mobile ? null : (
            <>
              <div className={workspace.mobileBar}>
                <MobileSteps
                  current={step}
                  steps={workflowSteps}
                  onStep={goToStep}
                  onOpenList={() => {
                    setSheet('steps');
                  }}
                />
              </div>
              <Dialog open={sheet === 'steps'} title="Этапы" onClose={closeSheet}>
                <WorkflowNav steps={workflowSteps} current={step} onStep={goToStep} />
              </Dialog>
            </>
          )}
        </div>
      ) : null}

      {screen === 'room' ? (
        <RoomScreen
          room={room}
          geometries={furnitureGeometries}
          materials={project.materials}
          extents={roomExtents}
          status={roomValidation?.status}
          selected={room?.furnitureInstances.find((item) => item.id === selectedInstances[0])}
          selectedInstances={selectedInstances}
          furnitureNames={furnitureNames}
          placeable={library.summaries.filter((summary) => summary.furnitureCount > 0)}
          missingProjects={linked.missing.size}
          onCreateRoom={createRoom}
          onPlaceProject={addProjectToRoom}
          onSelectInstance={(id) => {
            selectInstances(id === undefined ? [] : [id]);
          }}
          onMoveCommit={(id, position, rotation) => {
            execute(
              { type: 'TransformFurnitureInstance', instanceId: id, position, rotation },
              'Переместить мебель',
            );
          }}
          onRoomSize={(width, depth, height) => {
            execute({ type: 'SetRoomSize', width, depth, height }, 'Габарит помещения');
          }}
          onFloorElevation={(elevation) => {
            execute({ type: 'SetFloor', patch: { elevation } }, 'Уровень пола');
          }}
          onCeilingVisible={(visible) => {
            execute({ type: 'SetCeiling', patch: { visible } }, 'Показ потолка');
          }}
          onMove={(id, position) => {
            execute(
              { type: 'TransformFurnitureInstance', instanceId: id, position },
              'Переместить мебель',
            );
          }}
          onRotate={(id) => {
            const instance = room?.furnitureInstances.find((item) => item.id === id);
            if (instance === undefined) return;
            execute(
              {
                type: 'TransformFurnitureInstance',
                instanceId: id,
                rotation: rotateQuarter(instance.rotation),
              },
              'Повернуть мебель',
            );
          }}
          onFlags={(id, patch) => {
            execute({ type: 'SetInstanceFlags', instanceId: id, ...patch }, 'Свойства экземпляра');
          }}
          onDuplicate={duplicateInstance}
          onRemove={(id) => {
            execute({ type: 'RemoveFurnitureInstance', instanceId: id }, 'Убрать из помещения');
          }}
        />
      ) : null}

      {/*
        Конструктор. Порядок в разметке совпадает с порядком на экране:
        параметры, холст, инспектор. Раскладывать колонки сеткой в один
        порядок, а в разметке держать другой — значит развести порядок
        табуляции с визуальным, и клавиатурный обход начинает прыгать.
      */}
      <div className={workspace.workspace} hidden={screen !== 'editor'}>
        {/*
          Параметры шага: колонка на широком экране, лист снизу на
          телефоне (PROMPT 28 §7). Содержимое одно и то же — те же поля и
          те же команды; меняется только место.
        */}
        <WorkspaceSlot
          mode={layout}
          side="sidebar"
          label="Параметры"
          title={STEP_BY_ID[step].title}
          open={sheet === 'params'}
          onClose={closeSheet}
        >
          {!usesFullStepRail(layout) ? null : (
            <WorkflowNav steps={workflowSteps} current={step} onStep={goToStep} />
          )}

          {step !== 'dimensions' ? null : (
            <Panel id="dimensions" title="Размеры" subtitle="Габарит изделия и толщина плиты.">
              <div className={styles.grid}>
                {AXES.map(({ key, label }) => {
                  const value = furniture.dimensions[key];
                  const invalid = !Number.isFinite(value) || value <= 0;
                  return (
                    <NumberInput
                      key={key}
                      label={label}
                      unit="мм"
                      value={value}
                      min={1}
                      status={invalid ? 'error' : 'default'}
                      {...(invalid ? { message: 'Значение должно быть больше нуля.' } : {})}
                      onChange={(next) => {
                        // Без debounce: схема обязана реагировать на каждый
                        // валидный промежуточный ввод. См. INTERACTION_MODEL §4.4.
                        execute(
                          { type: 'SetDimension', furnitureIndex: 0, axis: key, value: next },
                          `Габарит: ${label}`,
                        );
                      }}
                    />
                  );
                })}
              </div>
            </Panel>
          )}

          {step !== 'sections' ? null : (
            <Panel
              id="sections"
              title="Секции"
              subtitle="Вертикальное деление корпуса перегородками."
            >
              <NumberInput
                label="Секций"
                value={sectionsDraft}
                min={1}
                step={1}
                onChange={(next) => {
                  if (next >= 1) setSectionsDraft(Math.round(next));
                }}
              />
              <Button onClick={applySectionCount}>Применить секций: {sectionsDraft}</Button>

              {/*
              Ширины задаются списком, а не полем на секцию: секций бывает
              сколько угодно, а строка «300, 500, 400» читается целиком и
              правится быстрее, чем три поля. Пусто — равные секции, и это
              не «ноль», а отсутствие ограничения (`SizeSpec`).
            */}
              <Field
                label="Ширины секций, мм"
                message="Через запятую: 300, 500, 400. Пусто — равные секции."
              >
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    className={styles.textInput}
                    type="text"
                    inputMode="numeric"
                    value={sectionWidthsDraft}
                    placeholder="равные"
                    {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                    onChange={(event) => {
                      setSectionWidthsDraft(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Button onClick={applySectionWidths}>Применить ширины</Button>
            </Panel>
          )}

          {step !== 'cells' ? null : (
            <Panel
              id="cells"
              title="Ячейки"
              subtitle="Ряды и колонки внутри секции. Ячейка — пространство, а не деталь: в деталировку она не попадает."
            >
              <div className={styles.grid}>
                <NumberInput
                  label="Строк"
                  value={rowsDraft}
                  min={1}
                  step={1}
                  onChange={(next) => {
                    if (next >= 1) setRowsDraft(Math.round(next));
                  }}
                />
                <NumberInput
                  label="Колонок"
                  value={columnsDraft}
                  min={1}
                  step={1}
                  onChange={(next) => {
                    if (next >= 1) setColumnsDraft(Math.round(next));
                  }}
                />
                <NumberInput
                  label="Полок в ячейке"
                  value={shelvesDraft}
                  min={0}
                  step={1}
                  onChange={(next) => {
                    if (next >= 0) setShelvesDraft(Math.round(next));
                  }}
                />
              </div>
              <Button onClick={applyGrid}>
                Применить сетку {rowsDraft}×{columnsDraft}
              </Button>

              {selectedCell === undefined ? (
                <EmptyState
                  compact
                  title="Ячейка не выбрана"
                  description="Выберите ячейку на холсте или в сцене — здесь появятся её номер, размеры и наполнение."
                />
              ) : (
                <dl className={styles.stats}>
                  <div className={styles.stat}>
                    <dt className={styles.statLabel}>Размер</dt>
                    <dd className={styles.statValue}>
                      {formatMm(selectedCell.box.size.x)} × {formatMm(selectedCell.box.size.y)} мм
                    </dd>
                  </div>
                  <div className={styles.stat}>
                    <dt className={styles.statLabel}>Наполнение</dt>
                    <dd className={styles.statValue}>{FILL_LABELS[selectedFillKind]}</dd>
                  </div>
                </dl>
              )}
            </Panel>
          )}

          {step !== 'shelves' ? null : (
            <Panel
              id="shelves"
              title="Полки"
              subtitle="Полка — физическая деталь: она попадает в деталировку, раскрой и кромку."
            >
              {selectedCell === undefined ? (
                <EmptyState
                  compact
                  title="Ячейка не выбрана"
                  description="Полки принадлежат ячейке. Выберите ячейку на холсте или в сцене."
                  action={
                    <Button
                      onClick={() => {
                        goToStep('cells');
                      }}
                    >
                      К шагу «Ячейки»
                    </Button>
                  }
                />
              ) : (
                <>
                  <NumberInput
                    label="Полок в этой ячейке"
                    value={selectedShelfCount}
                    min={0}
                    step={1}
                    hint="0 — ячейка без полок. Положение полок движок распределяет равномерно."
                    onChange={(next) => {
                      if (next >= 0) setCellShelfCount(Math.round(next));
                    }}
                  />
                  {/*
                  Тип опоры («фиксированная» или «съёмная») — параметр
                  каждой полки в модели. Схема опирания съёмной полки
                  источником не подтверждена (T-SHF-02), поэтому выбор
                  здесь не предлагается: он обещал бы расчёт, которого
                  движок пока не делает.
                */}
                  <p className={styles.pending}>
                    Материал и кромка полок задаются на шаге «Материалы» — назначением на роль, а не
                    по одной полке.
                  </p>
                </>
              )}
            </Panel>
          )}

          {step !== 'fill' ? null : (
            <Panel id="fill" title="Наполнение" subtitle="Что стоит внутри выбранной ячейки.">
              {selectedCell === undefined ? (
                <EmptyState
                  compact
                  title="Ячейка не выбрана"
                  description="Выберите ячейку на холсте или в сцене, чтобы задать её наполнение."
                />
              ) : (
                <>
                  <SegmentedControl
                    label="Наполнение ячейки"
                    value={
                      // Виды, которых нет в списке (штанга), показываются
                      // как «пусто»: переключатель обязан иметь выбранное
                      // значение из своих же вариантов.
                      UI_FILL_KINDS.includes(selectedFillKind as (typeof UI_FILL_KINDS)[number])
                        ? (selectedFillKind as (typeof UI_FILL_KINDS)[number])
                        : 'empty'
                    }
                    options={FILL_OPTIONS}
                    onChange={setCellFillKind}
                    stretch
                  />
                  <p className={styles.pending}>{FILL_HINTS[selectedFillKind]}</p>
                </>
              )}

              {/*
              Обувной модуль в задании назван как вид наполнения, но его
              состав — число наклонных полок, угол, шаг и крепление —
              источником не подтверждён (T-FILL-01). Пункт, который
              ничего не строит, был бы обещанием, поэтому в списке его
              нет, а причина названа прямо.
            */}
              <p className={styles.pending}>
                Обувной модуль пока недоступен: его состав (наклонные полки, угол и шаг) не
                подтверждён источником — T-FILL-01 в реестре предположений.
              </p>
            </Panel>
          )}

          {step !== 'facades' ? null : (
            <Panel
              id="doors"
              title="Двери"
              subtitle="Дверь закрывает ячейку снаружи. То, что стоит внутри, задаётся на шаге «Наполнение»."
            >
              <div className={styles.grid}>
                <Select
                  label="Ячейка"
                  value={selectedCellId}
                  options={[
                    { value: '', label: '— выбрать —' },
                    ...geometry.cells.map((cell) => {
                      const node = findNode(furniture.root, cell.nodeId);
                      const drawerCount =
                        node?.kind === 'leaf' && node.fill.kind === 'drawers'
                          ? node.fill.drawers.length
                          : 0;
                      const door = facadeForCell(cell.nodeId) === undefined ? '' : ' — дверь';
                      const drawers = drawerCount === 0 ? '' : ` — ящиков: ${String(drawerCount)}`;
                      return {
                        value: cell.nodeId,
                        label: `${cell.nodeId} (${formatMm(cell.box.size.x)} × ${formatMm(cell.box.size.y)})${door}${drawers}`,
                      };
                    }),
                  ]}
                  onChange={(next) => {
                    setSelectedCellId(next === '' ? '' : asId<'Node'>(next));
                  }}
                />
                {selectedFacade === undefined ? null : (
                  <>
                    <Select
                      label="Сторона петель"
                      value={selectedFacade.leaves[0]?.hingeSide ?? 'left'}
                      options={[
                        { value: 'left', label: 'Слева' },
                        { value: 'right', label: 'Справа' },
                      ]}
                      onChange={(next) => {
                        setDoorHingeSide(next as HingeSide);
                      }}
                    />
                    <Select
                      label="Материал"
                      value={selectedFacade.leaves[0]?.materialId ?? ''}
                      options={[
                        { value: '', label: 'по умолчанию' },
                        ...Object.values(project.materials.items).map((material) => ({
                          value: material.id,
                          label: material.name,
                        })),
                      ]}
                      onChange={(next) => {
                        if (next !== '') setDoorMaterial(asId<'Material'>(next));
                      }}
                    />
                    <Select
                      label="Кромка"
                      value={
                        selectedFacade.leaves[0]?.edge === undefined
                          ? 'inherit'
                          : selectedFacade.leaves[0]?.edge?.front === 0
                            ? 'none'
                            : 'default'
                      }
                      options={[
                        { value: 'inherit', label: 'по умолчанию' },
                        { value: 'default', label: '2/0/0.4/0.4 мм' },
                        { value: 'none', label: 'без кромки' },
                      ]}
                      onChange={(next) => {
                        setDoorEdge(next as 'default' | 'none' | 'inherit');
                      }}
                    />
                    <Select
                      label="Открывание"
                      value={selectedFacade.leaves[0]?.opening?.kind ?? 'none'}
                      options={[
                        { value: 'none', label: 'Нет' },
                        { value: 'handle', label: 'Ручка' },
                        { value: 'push-to-open', label: 'Push-to-open' },
                      ]}
                      onChange={(next) => {
                        setDoorOpening(next as OpeningSystem['kind']);
                      }}
                    />
                  </>
                )}
              </div>
              <Button
                onClick={addDoor}
                disabled={
                  selectedCellId === '' ||
                  selectedFacade !== undefined ||
                  selectedDrawers.length > 0
                }
                style={{ marginTop: 'var(--sp-3)' }}
              >
                Добавить дверь
              </Button>
              <Button
                onClick={removeDoor}
                disabled={selectedFacade === undefined}
                style={{ marginTop: 'var(--sp-2)' }}
              >
                Убрать дверь
              </Button>
            </Panel>
          )}

          {step !== 'facades' ? null : (
            <Panel
              id="drawers"
              title="Фасады ящиков"
              subtitle="Фасад — деталь, механизм открывания — фурнитура. Это разные сущности, и правятся они порознь."
            >
              <p className={styles.pending}>
                Ячейка выбирается в панели «Двери» выше — ящик и дверь на одной ячейке несовместимы.
              </p>
              <ul className={styles.stats}>
                <li className={styles.stat}>
                  <span className={styles.statLabel}>Ящиков в выбранной ячейке</span>
                  <span className={styles.statValue}>{selectedDrawers.length}</span>
                </li>
              </ul>
              {selectedDrawers.length === 0 ? null : (
                <div className={styles.grid}>
                  <Select
                    label="Открывание (все ящики ячейки)"
                    value={selectedDrawers[0]?.facade.opening?.kind ?? 'none'}
                    options={[
                      { value: 'none', label: 'Нет' },
                      { value: 'handle', label: 'Ручка' },
                      { value: 'push-to-open', label: 'Push-to-open' },
                    ]}
                    onChange={(next) => {
                      setDrawersOpening(next as OpeningSystem['kind']);
                    }}
                  />
                </div>
              )}
              <Button
                onClick={addDrawer}
                disabled={!canAddDrawer}
                style={{ marginTop: 'var(--sp-3)' }}
              >
                Добавить ящик
              </Button>
              <Button
                onClick={removeDrawer}
                disabled={selectedDrawers.length === 0}
                style={{ marginTop: 'var(--sp-2)' }}
              >
                Убрать ящик
              </Button>
            </Panel>
          )}

          {/*
          Корпус (PROMPT 14 §27). Технический минимум: задняя стенка и цоколь.
          Полноценная панель конструкции корпуса — не этот этап.
        */}
          {step !== 'carcass' ? null : (
            <Panel
              id="structure"
              title="Корпус"
              subtitle="Задняя стенка и цоколь: без них короба нет."
            >
              <div className={styles.grid}>
                <Select
                  label="Задняя стенка"
                  value={
                    backPanel.mount.kind === 'inset-groove' ? 'inset-flush' : backPanel.mount.kind
                  }
                  options={[
                    { value: 'overlay', label: 'Накладная' },
                    { value: 'inset-flush', label: 'Вкладная' },
                    { value: 'none', label: 'Нет' },
                  ]}
                  onChange={(next) => {
                    setBackMount(next as 'none' | 'overlay' | 'inset-flush');
                  }}
                />
                {backPanel.mount.kind === 'none' ? null : (
                  <>
                    <NumberInput
                      label="Толщина стенки"
                      unit="мм"
                      value={backPanel.mount.thickness}
                      min={1}
                      onChange={setBackThickness}
                    />
                    <Select
                      label="Разделение стенки"
                      value={backPanel.segmentation}
                      options={[
                        { value: 'single', label: 'Цельная' },
                        { value: 'per-section', label: 'По секциям' },
                      ]}
                      onChange={(next) => {
                        setBackSegmentation(next as 'single' | 'per-section');
                      }}
                    />
                  </>
                )}
                <NumberInput
                  label="Высота цоколя"
                  unit="мм"
                  value={plinth?.height ?? 0}
                  min={0}
                  message="0 — цоколя нет."
                  onChange={(next) => {
                    setPlinthHeight(next);
                  }}
                />
                {plinth === undefined ? null : (
                  <>
                    <NumberInput
                      label="Отступ цоколя"
                      unit="мм"
                      value={plinth.setback}
                      min={0}
                      onChange={setPlinthSetback}
                    />
                    <Select
                      label="Царги цоколя"
                      value={(plinth.parts ?? []).length > 1 ? 'sides' : 'front'}
                      options={[
                        { value: 'front', label: 'Только передняя' },
                        { value: 'sides', label: 'Передняя и боковые' },
                      ]}
                      onChange={(next) => {
                        togglePlinthSides(next === 'sides');
                      }}
                    />
                  </>
                )}
              </div>
            </Panel>
          )}

          {/*
          Конструктивные модификаторы (PROMPT 15 §21). Технический минимум:
          зазор до потолка, антресоль, столешница, крепление и фальшпанели.
        */}
          {step !== 'construction' ? null : (
            <Panel
              id="modifiers"
              title="Конструкция"
              subtitle="Надстройки над готовым коробом: свесы, столешница, антресоль, крепление, фальшпанели."
            >
              <p className={styles.pending}>
                Габарит H делится между цоколем, корпусом, столешницей, антресолью и зазором до
                потолка.
              </p>
              <div className={styles.grid}>
                <NumberInput
                  label="Зазор до потолка"
                  unit="мм"
                  value={modifiers.ceilingGap ?? 0}
                  min={0}
                  onChange={setCeilingGap}
                />
                <NumberInput
                  label="Высота антресоли"
                  unit="мм"
                  value={modifiers.topSection?.height ?? 0}
                  min={0}
                  message="0 — антресоли нет."
                  onChange={(next) => {
                    setTopSectionHeight(next);
                  }}
                />
                <NumberInput
                  label="Толщина столешницы"
                  unit="мм"
                  value={modifiers.countertop?.thickness ?? 0}
                  min={0}
                  message="0 — столешницы нет."
                  onChange={(next) => {
                    setCountertopThickness(next);
                  }}
                />
                {modifiers.countertop === undefined ? null : (
                  <NumberInput
                    label="Свес столешницы"
                    unit="мм"
                    value={modifiers.countertop?.overhangFront ?? 0}
                    min={0}
                    onChange={setCountertopOverhang}
                  />
                )}
                <Select
                  label="Установка"
                  value={modifiers.wallMount?.mode ?? 'floor-standing'}
                  options={[
                    { value: 'floor-standing', label: 'Напольная' },
                    { value: 'wall-mounted', label: 'Настенная' },
                    { value: 'suspended', label: 'Подвесная' },
                  ]}
                  onChange={(next) => {
                    setWallMount(next as 'floor-standing' | 'wall-mounted' | 'suspended');
                  }}
                />
                {/*
                Счётчик, а не поле: значение выводится из модели и не
                правится напрямую. Поле «только для чтения» обещало бы
                ввод, которого нет.
              */}
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Фальшпанелей</span>
                  <span className={styles.statValue}>{(modifiers.falsePanels ?? []).length}</span>
                </div>
              </div>
              <Button
                onClick={() => {
                  addFalsePanel('left');
                }}
                style={{ marginTop: 'var(--sp-3)' }}
              >
                Фальшпанель слева
              </Button>
              <Button
                onClick={() => {
                  addFalsePanel('right');
                }}
                style={{ marginTop: 'var(--sp-2)' }}
              >
                Фальшпанель справа
              </Button>
              <Button
                onClick={removeLastFalsePanel}
                disabled={(modifiers.falsePanels ?? []).length === 0}
                style={{ marginTop: 'var(--sp-2)' }}
              >
                Убрать фальшпанель
              </Button>
            </Panel>
          )}

          {/*
          Материалы (PROMPT 13 §23). Технический минимум: реестр материалов
          с их толщинами и назначение материала по ролям. Полноценный
          Material Editor (декоры, форматы листа, кромочные материалы,
          создание и удаление материалов) — НЕ этот этап, см.
          docs/FEATURE_MATRIX.md.
        */}
          {step !== 'materials' ? null : (
            <Panel id="materials" title="Материалы">
              <p className={styles.pending}>
                Толщина материала — источник геометрии: у детали без своего переопределения толщина
                берётся отсюда.
              </p>
              <div className={styles.grid}>
                {materialList.map((material) => (
                  <NumberInput
                    key={material.id}
                    label={material.name}
                    unit="мм"
                    value={material.thickness}
                    min={1}
                    onChange={(next) => {
                      setMaterialThickness(material.id, next);
                    }}
                  />
                ))}
              </div>
              <div className={styles.grid} style={{ marginTop: 'var(--sp-3)' }}>
                <Select
                  label="Материал корпуса"
                  value={project.materials.assignment.side ?? ''}
                  options={[
                    { value: '', label: '— не назначен —' },
                    ...materialList.map((material) => ({
                      value: material.id,
                      label: material.name,
                    })),
                  ]}
                  onChange={(next) => {
                    if (next !== '') {
                      assignMaterial(CARCASS_ROLES, asId<'Material'>(next), 'Материал корпуса');
                    }
                  }}
                />
                <Select
                  label="Материал полок"
                  value={project.materials.assignment['shelf-adjustable'] ?? ''}
                  options={[
                    { value: '', label: '— не назначен —' },
                    ...materialList.map((material) => ({
                      value: material.id,
                      label: material.name,
                    })),
                  ]}
                  onChange={(next) => {
                    if (next !== '') {
                      assignMaterial(SHELF_ROLES, asId<'Material'>(next), 'Материал полок');
                    }
                  }}
                />
                <Select
                  label="Материал фасадов"
                  value={project.materials.assignment.facade ?? ''}
                  options={[
                    { value: '', label: '— не назначен —' },
                    ...materialList.map((material) => ({
                      value: material.id,
                      label: material.name,
                    })),
                  ]}
                  onChange={(next) => {
                    if (next !== '') {
                      assignMaterial(['facade'], asId<'Material'>(next), 'Материал фасадов');
                    }
                  }}
                />
                <Select
                  label="Материал проекта по умолчанию"
                  value={project.settings.defaultMaterialId}
                  options={[
                    ...materialList.map((material) => ({
                      value: material.id,
                      label: material.name,
                    })),
                  ]}
                  onChange={(next) => {
                    if (next !== '') {
                      execute(
                        {
                          type: 'SetDefaultMaterial',
                          materialId: asId<'Material'>(next),
                        },
                        'Материал проекта',
                      );
                    }
                  }}
                />
              </div>
            </Panel>
          )}

          <Panel id="result" title="Результат расчёта" tone="sunken">
            <ul className={styles.stats}>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Деталей</span>
                <span className={styles.statValue}>{geometry.parts.length}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Секций</span>
                <span className={styles.statValue}>{geometry.sections.length}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Перегородок</span>
                <span className={styles.statValue}>
                  {geometry.parts.filter((p) => p.role === 'partition').length}
                </span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Ячеек</span>
                <span className={styles.statValue}>{geometry.cells.length}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Полок</span>
                <span className={styles.statValue}>
                  {
                    geometry.parts.filter(
                      (p) => p.role === 'shelf-fixed' || p.role === 'shelf-adjustable',
                    ).length
                  }
                </span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Дверей</span>
                <span className={styles.statValue}>{doorPartCount}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Фасадов ящиков</span>
                <span className={styles.statValue}>{drawerFacadePartCount}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Ручек</span>
                <span className={styles.statValue}>{handlePartCount}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Push-to-open</span>
                <span className={styles.statValue}>{pushToOpenPartCount}</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Внутренняя ширина</span>
                <span className={styles.statValue}>{formatMm(geometry.innerVolume.size.x)} мм</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Внутренняя высота</span>
                <span className={styles.statValue}>{formatMm(geometry.innerVolume.size.y)} мм</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Внутренняя глубина</span>
                <span className={styles.statValue}>{formatMm(geometry.innerVolume.size.z)} мм</span>
              </li>
              <li className={styles.stat}>
                <span className={styles.statLabel}>Bounding box (Ш×В×Г)</span>
                <span className={styles.statValue}>
                  {formatMm(geometry.boundingBox.totalWidth)} ×{' '}
                  {formatMm(geometry.boundingBox.totalHeight)} ×{' '}
                  {formatMm(geometry.boundingBox.totalDepth)} мм
                </span>
              </li>
            </ul>

            {problems.length > 0 ? (
              <>
                <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                  Проверка
                </h3>
                <ul className={styles.issues} aria-live="polite">
                  {problems.map((item, index) => (
                    <li key={`${item.code}-${String(index)}`} className={styles.issue}>
                      <span className={styles[item.severity]} aria-hidden="true">
                        {item.severity === 'error' ? '✕' : item.severity === 'warning' ? '!' : 'i'}
                      </span>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className={styles.pending}>
              Этапы конвейера геометрии, ещё не реализованные: {geometry.pendingStages.join(', ')}.
            </p>
          </Panel>

          {/*
          Технический debug-renderer (PROMPT 4 §17). НЕ часть конечного
          интерфейса: собран только для проверки Geometry Engine и явно
          исключён из production-сборки через import.meta.env.DEV — Vite
          заменяет это константой на этапе сборки, и Rollup выбрасывает
          мёртвую ветку целиком (docs/GEOMETRY_RULES.md §12).
        */}
          {import.meta.env.DEV ? (
            <Panel id="schema" title="Схема (debug, только в разработке)" wide>
              <Switch
                label="Показывать ID и координаты"
                checked={showDebugInfo}
                onChange={setShowDebugInfo}
              />
              {debugView === undefined ? null : (
                <DebugSchema view={debugView} showDebugInfo={showDebugInfo} />
              )}

              {/*
              Технический вывод спецификации фурнитуры (PROMPT 16 §26):
              идентификатор, определение, категория, количество, единица,
              источник, правило и причина. Строки собирает
              `formatHardwareDebug` — здесь они только размещаются.
            */}
              {/*
              Карта раскроя (PROMPT 17 §30): лист, рабочая область,
              размещённые детали с id, размерами и поворотом, а рядом —
              неразмещённые детали с причиной. Технический вывод, не
              редактор: перетаскивание деталей здесь отсутствует
              намеренно (§36).
            */}
              {cuttingView === undefined ? null : (
                <>
                  <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                    Карта раскроя (debug)
                  </h3>
                  <CuttingMap view={cuttingView} />
                </>
              )}

              {/*
              Производственная спецификация (PROMPT 19 §25): детали,
              кромка, фурнитура, присадка, раскрой и централизованный
              список неподтверждённых правил. Технический вывод, не
              производственный интерфейс (§33).
            */}
              {productionDebug === undefined ? null : (
                <>
                  <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                    Спецификация (расчёт)
                  </h3>
                  <ul className={styles.hardwareDebug}>
                    {productionDebug.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}

              {/*
              Карта присадки (PROMPT 18 §28): деталь, грань, отверстия с
              диаметром, глубиной, направлением и идентификатором операции.
              Технический вывод, не редактор: перемещения отверстий нет
              намеренно (§25, §34).
            */}
              {drillingDebug === undefined ? null : (
                <>
                  <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                    Присадка (расчёт)
                  </h3>
                  <ul className={styles.hardwareDebug}>
                    {drillingDebug.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}

              {hardwareDebug === undefined ? null : (
                <>
                  <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                    Фурнитура (расчёт)
                  </h3>
                  <ul className={styles.hardwareDebug}>
                    {hardwareDebug.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          ) : null}
        </WorkspaceSlot>
        <div className={workspace.canvas}>
          {/*
            Вид холста: трёхмерная сцена или плоская схема. Это одно и то
            же изделие, показанное по-разному, поэтому и выделение, и
            команды у них общие — второго состояния для 3D не заводится
            (§19). Переключатель, а не две панели рядом: две картинки
            одного шкафа отнимают место и заставляют выбирать, куда
            смотреть.
          */}
          <SegmentedControl
            label="Вид изделия"
            value={canvasMode}
            onChange={setCanvasMode}
            options={[
              { value: '3d', label: 'Сцена' },
              { value: '2d', label: 'Схема' },
            ]}
          />

          {canvasMode !== '3d' || geometry === undefined || furniture === undefined ? null : (
            <Scene3D
              furniture={furniture}
              geometry={geometry}
              materials={project.materials}
              selectedParts={selectedParts}
              selectedNodes={selectedNodes}
              hoveredNode={hoveredNode}
              editable
              showGrid
              showAxes={import.meta.env.DEV}
              debug={import.meta.env.DEV}
              limits={{ min: 100, max: 6000 }}
              onSelectPart={(id) => {
                selectParts([id]);
              }}
              onSelectNode={(id) => {
                selectNodes([id]);
              }}
              onClearSelection={clearSelection}
              onResizeCommit={runGizmoResize}
            />
          )}

          {canvasMode !== '2d' ||
          geometry === undefined ||
          furniture === undefined ||
          canvasView === undefined ? null : (
            <EditorCanvas
              view={canvasView}
              selectedParts={selectedParts}
              selectedNodes={selectedNodes}
              hoveredNode={hoveredNode}
              width={furniture.dimensions.width}
              height={furniture.dimensions.height}
              limits={{ min: 100, max: 6000 }}
              onSelectPart={(id) => {
                selectParts([id]);
              }}
              onSelectNode={(id) => {
                selectNodes([id]);
              }}
              onHoverNode={setHovered}
              onClearSelection={clearSelection}
              onResizeCommit={(axis, value) => {
                execute(
                  { type: 'SetDimension', furnitureIndex: 0, axis, value },
                  axis === 'width' ? 'Ширина изделия' : 'Высота изделия',
                );
              }}
            />
          )}
        </div>

        {/*
          Полоса действий телефона (PROMPT 28 §4, §24).

          Стоит между холстом и навигацией разделов — у нижнего края, там,
          где палец. Здесь же переходы по шагам: одиннадцать шагов подряд
          на 390 px не помещаются, поэтому виден текущий, а весь список
          открывается листом.
        */}
        {!mobile ? null : (
          <div className={workspace.mobileBar}>
            <MobileSteps
              current={step}
              steps={workflowSteps}
              onStep={goToStep}
              onOpenList={() => {
                setSheet('steps');
              }}
            />
            <div className={workspace.mobileActions}>
              <Button
                onClick={() => {
                  setSheet((current) => (current === 'params' ? null : 'params'));
                }}
              >
                {STEP_BY_ID[step].title}
              </Button>
              <Button
                disabled={inspector === undefined}
                onClick={() => {
                  setSheet((current) => (current === 'object' ? null : 'object'));
                }}
              >
                Объект
              </Button>
            </div>
          </div>
        )}

        {/*
          Все этапы — тот же `WorkflowNav`, что и в колонке на широком
          экране, а не его вторая копия: список шагов, их состояния и
          разбор проблем по шагам общие (`workflow/steps.ts`).

          Этот лист модальный: он открыт, чтобы выбрать шаг, и закрывается
          выбором. Держать под ним рабочий холст незачем.
        */}
        {!mobile ? null : (
          <Dialog open={sheet === 'steps'} title="Этапы" onClose={closeSheet}>
            <WorkflowNav steps={workflowSteps} current={step} onStep={goToStep} />
          </Dialog>
        )}

        <WorkspaceSlot
          mode={layout}
          side="inspector"
          label="Свойства объекта"
          title="Выбранный объект"
          open={sheet === 'object'}
          onClose={closeSheet}
        >
          {inspector === undefined ? null : (
            <Inspector model={inspector} onAction={runInspectorAction} />
          )}
        </WorkspaceSlot>
      </div>
    </AppShell>
  );
}
