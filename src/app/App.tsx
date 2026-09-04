import { useEffect, useMemo, useState } from 'react';
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
  PartId,
  PartRole,
} from '../domain/index.js';
import { createUniformGrid } from '../domain/furniture/sections.js';
import { buildGeometry } from '../geometry/index.js';
import { buildCuttingView, buildDebugView, CuttingMap, DebugSchema } from '../render/index.js';
import { calculateHardware, formatHardwareDebug } from '../hardware/index.js';
import { calculateCutting, toProductionParts } from '../production/index.js';
import { calculateDrilling, formatDrillingDebug } from '../drilling/index.js';
import { calculateProduction, formatProductionDebug } from '../bom/index.js';
import { exportPdf, exportXlsx } from './export-actions.js';
import { validateProductionReadiness } from '../workflow/index.js';
import { useSessionStore } from '../state/index.js';
import { useProjectStorage } from './use-project-storage.js';
import { EditorCanvas } from './editor/EditorCanvas.js';
import { Scene3D } from './editor/Scene3D.js';
import { RoomPlanner, rotateQuarter } from './editor/RoomPlanner.js';
import { RoomInspector } from './editor/RoomInspector.js';
import { Inspector } from './editor/Inspector.js';
import { StatusBar } from './editor/StatusBar.js';
import { Toolbar } from './editor/Toolbar.js';
import { describeSelection, resolveSelection } from './editor/selection.js';
import type { InspectorAction } from './editor/selection.js';
import type { GizmoTarget } from '../scene/index.js';
import { findPlacement, furnitureExtent, validateRoom } from '../room/index.js';
import type { ExtentLookup } from '../room/index.js';
import { createFurnitureInstance, createRectangularRoom } from '../domain/index.js';
import type { FurnitureId, InstanceId, Vec3 } from '../domain/index.js';
import editorStyles from './editor/EditorPanels.module.css';
import { validateProject } from '../validation/index.js';
import { useDocumentStore } from '../state/index.js';
import { Button, Field } from '../design-system/index.js';
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

const AXES = [
  { key: 'width', label: 'Ширина' },
  { key: 'height', label: 'Высота' },
  { key: 'depth', label: 'Глубина' },
  { key: 'panelThickness', label: 'Толщина' },
] as const;

/**
 * Подписи статусов готовности. Живут рядом с интерфейсом, а не в домене:
 * домен отвечает за статус, интерфейс — за то, как он звучит по-русски.
 */
const READINESS_LABELS: Readonly<Record<string, string>> = {
  READY_FOR_PRODUCTION: 'Готово к производству',
  HAS_WARNINGS: 'Готово с замечаниями',
  NEEDS_CONFIRMATION: 'Требуется подтверждение производственных правил',
  INVALID: 'Изготовление невозможно: есть ошибки',
};

const CHECK_LABELS: Readonly<Record<string, string>> = {
  PASS: 'в порядке',
  WARNING: 'есть замечания',
  ERROR: 'ошибка',
  NEEDS_CONFIRMATION: 'нужно подтверждение',
};

/** Значок статуса. Дублируется текстом рядом: цвет и знак — не единственный носитель смысла. */
const CHECK_MARKS: Readonly<Record<string, string>> = {
  PASS: '✓',
  WARNING: '!',
  ERROR: '✕',
  NEEDS_CONFIRMATION: '?',
};

export function App(): React.JSX.Element {
  const project = useDocumentStore((s) => s.project);
  const execute = useDocumentStore((s) => s.execute);
  const undo = useDocumentStore((s) => s.undo);
  const beginTransaction = useDocumentStore((s) => s.beginTransaction);
  const endTransaction = useDocumentStore((s) => s.endTransaction);
  const redo = useDocumentStore((s) => s.redo);
  const history = useDocumentStore((s) => s.history);
  const replaceProject = useDocumentStore((s) => s.replaceProject);

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

  // Готовность к производству (PROMPT 21). Считается из того же расчёта,
  // что и спецификация: отдельного «пересчитать» нет и быть не может —
  // производных результатов не существует в устаревшем виде.
  const readiness = useMemo(() => {
    if (furniture === undefined || geometry === undefined) return undefined;
    return validateProductionReadiness(project, {
      calculation: calculateProduction(project, { geometry: new Map([[furniture.id, geometry]]) }),
    });
  }, [project, furniture, geometry]);

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
   * Вид холста. Состояние ИНТЕРФЕЙСА: в проект не сохраняется и по
   * Ctrl+Z не отменяется — как и выделение (PROMPT 22 §5, PROMPT 23 §36).
   */
  const [canvasMode, setCanvasMode] = useState<'3d' | '2d' | 'room'>('3d');
  /** Режимы показа помещения. Состояние интерфейса: в проект не идут. */
  const [cutawayWalls, setCutawayWalls] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // ── Планировщик помещения (PROMPT 24) ─────────────────────────────────────

  const room = project.room;

  /**
   * Геометрия каждого изделия проекта.
   *
   * Планировщик её НЕ считает: он получает уже построенную. Пересчёт
   * идёт при изменении изделий, а не при движении мебели по комнате
   * (§32) — от того, что шкаф подвинули, его детали не меняются.
   */
  const furnitureGeometries = useMemo(() => {
    const map = new Map<FurnitureId, ReturnType<typeof buildGeometry>>();
    for (const item of project.furniture) {
      map.set(
        item.id,
        buildGeometry({
          furniture: item,
          scheme: project.settings.construction,
          tolerances: project.settings.tolerances,
          materials: project.materials,
          edgeSizing: project.settings.edgeSizing,
        }),
      );
    }
    return map;
  }, [project.furniture, project.settings, project.materials]);

  const roomExtents: ExtentLookup = useMemo(() => {
    const map = new Map<string, Vec3>();
    for (const [id, result] of furnitureGeometries) map.set(id, furnitureExtent(result));
    return map;
  }, [furnitureGeometries]);

  const roomValidation = useMemo(
    () => (room === undefined ? undefined : validateRoom(room, { extents: roomExtents })),
    [room, roomExtents],
  );

  const furnitureNames = useMemo(
    () => new Map(project.furniture.map((item) => [item.id as string, item.name])),
    [project.furniture],
  );

  const createRoom = (): void => {
    execute(
      {
        type: 'SetRoom',
        room: createRectangularRoom({ ids: createRandomIdFactory(), width: 4000, depth: 3000, height: 2700 }),
      },
      'Создать помещение',
    );
    setCanvasMode('room');
  };

  const addFurnitureToRoom = (furnitureId: FurnitureId): void => {
    const item = project.furniture.find((entry) => entry.id === furnitureId);
    if (item === undefined || room === undefined) return;
    const extent = roomExtents.get(furnitureId);

    // Новая мебель ставится в первое СВОБОДНОЕ место — угол, затем
    // стену, — а не в начало координат: оно лежит на осевой линии стен,
    // и изделие появлялось бы сразу внутри двух стен. Подробнее, включая
    // отвергнутые варианты, — `src/room/autoplace.ts`.
    const placed =
      extent === undefined
        ? { position: { x: 0, y: 0, z: 0 }, rotation: 0 }
        : findPlacement(room, furnitureId, extent, roomExtents);

    execute(
      {
        type: 'AddFurnitureInstance',
        instance: {
          ...createFurnitureInstance(createRandomIdFactory(), item, placed.position),
          rotation: placed.rotation,
        },
      },
      'Добавить мебель в помещение',
    );
  };

  const duplicateInstance = (instanceId: InstanceId): void => {
    const source = room?.furnitureInstances.find((item) => item.id === instanceId);
    const item = project.furniture.find((entry) => entry.id === source?.furnitureId);
    if (source === undefined || item === undefined) return;
    const extent = roomExtents.get(source.furnitureId);
    // Копия ставится рядом, а не поверх оригинала: два объекта в одной
    // точке выглядят как один, и пользователь решил бы, что ничего не
    // произошло. Смещение — на собственную ширину копии, а не на
    // выдуманное число.
    const offset = extent?.x ?? 0;
    execute(
      {
        type: 'AddFurnitureInstance',
        instance: {
          ...createFurnitureInstance(createRandomIdFactory(), item, {
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
      { type: 'SetChildSize', furnitureIndex: 0, childId: target.childId, size: { mode: 'fixed', value } },
      target.axis === 'x' ? 'Ширина секции' : 'Высота ряда',
    );
  };

  /** Переход от текста ошибки к затронутому объекту (§29). */
  const selectIssueTarget = (issue: { target?: { nodeId?: NodeId; partId?: PartId } }): void => {
    if (issue.target?.partId !== undefined) selectParts([issue.target.partId]);
    else if (issue.target?.nodeId !== undefined) selectNodes([issue.target.nodeId]);
  };

  const storage = useProjectStorage(project);

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
    <div className={`${styles.shell} ${editorStyles.editor}`}>
      <a className={styles.skipLink} href="#main">
        Перейти к содержимому
      </a>

      <Toolbar
        projectName={project.name}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        storage={storage.status}
        storageMessage={storage.message}
        production={readiness?.status}
        exporting={exporting}
        onUndo={undo}
        onRedo={redo}
        onSave={() => {
          void storage.save();
        }}
        onExport={(kind) => {
          void runExport(kind);
        }}
      />

      <div className={editorStyles.workspace}>
        {/*
          Порядок в разметке совпадает с порядком на экране: параметры,
          холст, инспектор. Раскладывать колонки сеткой в один порядок, а
          в разметке держать другой — значит развести порядок табуляции с
          визуальным, и клавиатурный обход начинает прыгать по экрану.
          Телефонную перестановку («сначала изделие, потом поля») делает
          `order` в одноколоночной раскладке, где прыгать уже некуда (§25).
        */}
        <main id="main" className={editorStyles.sidebar}>
          <section className={styles.panel} aria-labelledby="export-title">
            <h2 id="export-title" className={styles.panelTitle}>
              Производственная документация
            </h2>
            <p className={styles.pending}>
              Спецификация деталей, фурнитура, присадка и карта раскроя. Документ формируется из
              текущего расчёта: отдельного «пересчитать» не требуется.
            </p>
            {/*
            Чеклист готовности (§17). Строится из доменного результата и
            ничего не проверяет сам. Список, а не таблица: каждый пункт —
            самостоятельное утверждение о разделе, и читать его нужно
            построчно, в том числе скринридером.
          */}
            {readiness === undefined ? null : (
              <>
                <p className={styles.readinessStatus} data-status={readiness.status}>
                  {READINESS_LABELS[readiness.status]}
                </p>
                <ul className={styles.readinessList}>
                  {readiness.checks.map((check) => (
                    <li key={check.id} data-status={check.status}>
                      <span className={styles.readinessMark} aria-hidden="true">
                        {CHECK_MARKS[check.status]}
                      </span>
                      <span className={styles.readinessTitle}>{check.title}</span>
                      <span className={styles.readinessDetail}>
                        {CHECK_LABELS[check.status]} · {check.details}
                      </span>
                      {check.errors.length === 0 ? null : (
                        <span className={styles.readinessDetail}>{check.errors[0]?.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className={styles.debugToolbar}>
              <Button
                variant="primary"
                onClick={() => {
                  void runExport('pdf');
                }}
                loading={exporting === 'pdf'}
                disabled={exporting !== null}
              >
                {exporting === 'pdf' ? 'Формируется PDF…' : 'Скачать PDF'}
              </Button>
              <Button
                onClick={() => {
                  void runExport('xlsx');
                }}
                loading={exporting === 'xlsx'}
                disabled={exporting !== null}
              >
                {exporting === 'xlsx' ? 'Формируется XLSX…' : 'Скачать XLSX'}
              </Button>
            </div>
            {/* Сообщения экспорта читаются вслух: результат действия не
              должен быть виден только глазами (§19). */}
            <p className={styles.pending} role="status" aria-live="polite">
              {exportError ?? (exporting === null ? '' : 'Идёт формирование документа…')}
            </p>
          </section>

          <section className={styles.panel} aria-labelledby="dimensions-title">
            <h2 id="dimensions-title" className={styles.panelTitle}>
              Габариты
            </h2>
            <div className={styles.grid}>
              {AXES.map(({ key, label }) => {
                const value = furniture.dimensions[key];
                const invalid = !Number.isFinite(value) || value <= 0;
                return (
                  <Field
                    key={key}
                    label={`${label}, мм`}
                    status={invalid ? 'error' : 'default'}
                    {...(invalid ? { message: 'Значение должно быть больше нуля.' } : {})}
                  >
                    {({ id, describedBy, invalid: isInvalid }) => (
                      <input
                        id={id}
                        className={styles.numberInput}
                        type="number"
                        inputMode="numeric"
                        value={Number.isFinite(value) ? value : ''}
                        aria-invalid={isInvalid}
                        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                        onChange={(event) => {
                          // Без debounce: схема обязана реагировать на каждый
                          // валидный промежуточный ввод. См. INTERACTION_MODEL §4.4.
                          const next = event.target.valueAsNumber;
                          execute(
                            { type: 'SetDimension', furnitureIndex: 0, axis: key, value: next },
                            `Габарит: ${label}`,
                          );
                        }}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="grid-title">
            <h2 id="grid-title" className={styles.panelTitle}>
              Сетка
            </h2>
            <div className={styles.grid}>
              <Field label="Секций">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={sectionsDraft}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber;
                      if (Number.isFinite(next) && next >= 1) setSectionsDraft(Math.round(next));
                    }}
                  />
                )}
              </Field>
              <Field label="Строк">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={rowsDraft}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber;
                      if (Number.isFinite(next) && next >= 1) setRowsDraft(Math.round(next));
                    }}
                  />
                )}
              </Field>
              <Field label="Колонок">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={columnsDraft}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber;
                      if (Number.isFinite(next) && next >= 1) setColumnsDraft(Math.round(next));
                    }}
                  />
                )}
              </Field>
              <Field label="Полок в ячейке">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={shelvesDraft}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber;
                      if (Number.isFinite(next) && next >= 0) setShelvesDraft(Math.round(next));
                    }}
                  />
                )}
              </Field>
            </div>
            <Button onClick={applySectionCount} style={{ marginTop: 'var(--sp-3)' }}>
              Применить секций: {sectionsDraft}
            </Button>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Field
                label="Ширины секций, мм"
                message="Через запятую: 300, 500, 400. Пусто — равные секции."
              >
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
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
            </div>
            <Button onClick={applySectionWidths} style={{ marginTop: 'var(--sp-2)' }}>
              Применить ширины
            </Button>
            <Button onClick={applyGrid} style={{ marginTop: 'var(--sp-2)' }}>
              Применить сетку {rowsDraft}×{columnsDraft}
            </Button>
          </section>

          <section className={styles.panel} aria-labelledby="doors-title">
            <h2 id="doors-title" className={styles.panelTitle}>
              Двери
            </h2>
            <div className={styles.grid}>
              <Field label="Ячейка">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={selectedCellId}
                    onChange={(event) => {
                      setSelectedCellId(
                        event.target.value === '' ? '' : asId<'Node'>(event.target.value),
                      );
                    }}
                  >
                    <option value="">— выбрать —</option>
                    {geometry.cells.map((cell) => {
                      const node = findNode(furniture.root, cell.nodeId);
                      const drawerCount =
                        node?.kind === 'leaf' && node.fill.kind === 'drawers'
                          ? node.fill.drawers.length
                          : 0;
                      return (
                        <option key={cell.nodeId} value={cell.nodeId}>
                          {cell.nodeId} ({formatMm(cell.box.size.x)} × {formatMm(cell.box.size.y)})
                          {facadeForCell(cell.nodeId) === undefined ? '' : ' — дверь'}
                          {drawerCount === 0 ? '' : ` — ящиков: ${String(drawerCount)}`}
                        </option>
                      );
                    })}
                  </select>
                )}
              </Field>
              {selectedFacade === undefined ? null : (
                <>
                  <Field label="Сторона петель">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={selectedFacade.leaves[0]?.hingeSide ?? 'left'}
                        onChange={(event) => {
                          setDoorHingeSide(event.target.value as HingeSide);
                        }}
                      >
                        <option value="left">Слева</option>
                        <option value="right">Справа</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Материал">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={selectedFacade.leaves[0]?.materialId ?? ''}
                        onChange={(event) => {
                          if (event.target.value !== '')
                            setDoorMaterial(asId<'Material'>(event.target.value));
                        }}
                      >
                        <option value="">по умолчанию</option>
                        {Object.values(project.materials.items).map((material) => (
                          <option key={material.id} value={material.id}>
                            {material.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Кромка">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={
                          selectedFacade.leaves[0]?.edge === undefined
                            ? 'inherit'
                            : selectedFacade.leaves[0]?.edge?.front === 0
                              ? 'none'
                              : 'default'
                        }
                        onChange={(event) => {
                          setDoorEdge(event.target.value as 'default' | 'none' | 'inherit');
                        }}
                      >
                        <option value="inherit">по умолчанию</option>
                        <option value="default">2/0/0.4/0.4 мм</option>
                        <option value="none">без кромки</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Открывание">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={selectedFacade.leaves[0]?.opening?.kind ?? 'none'}
                        onChange={(event) => {
                          setDoorOpening(event.target.value as OpeningSystem['kind']);
                        }}
                      >
                        <option value="none">Нет</option>
                        <option value="handle">Ручка</option>
                        <option value="push-to-open">Push-to-open</option>
                      </select>
                    )}
                  </Field>
                </>
              )}
            </div>
            <Button
              onClick={addDoor}
              disabled={
                selectedCellId === '' || selectedFacade !== undefined || selectedDrawers.length > 0
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
          </section>

          <section className={styles.panel} aria-labelledby="drawers-title">
            <h2 id="drawers-title" className={styles.panelTitle}>
              Ящики
            </h2>
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
                <Field label="Открывание (все ящики ячейки)">
                  {({ id }) => (
                    <select
                      id={id}
                      className={styles.numberInput}
                      value={selectedDrawers[0]?.facade.opening?.kind ?? 'none'}
                      onChange={(event) => {
                        setDrawersOpening(event.target.value as OpeningSystem['kind']);
                      }}
                    >
                      <option value="none">Нет</option>
                      <option value="handle">Ручка</option>
                      <option value="push-to-open">Push-to-open</option>
                    </select>
                  )}
                </Field>
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
          </section>

          {/*
          Корпус (PROMPT 14 §27). Технический минимум: задняя стенка и цоколь.
          Полноценная панель конструкции корпуса — не этот этап.
        */}
          <section className={styles.panel} aria-labelledby="structure-title">
            <h2 id="structure-title" className={styles.panelTitle}>
              Корпус
            </h2>
            <div className={styles.grid}>
              <Field label="Задняя стенка">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={
                      backPanel.mount.kind === 'inset-groove' ? 'inset-flush' : backPanel.mount.kind
                    }
                    onChange={(event) => {
                      setBackMount(event.target.value as 'none' | 'overlay' | 'inset-flush');
                    }}
                  >
                    <option value="overlay">Накладная</option>
                    <option value="inset-flush">Вкладная</option>
                    <option value="none">Нет</option>
                  </select>
                )}
              </Field>
              {backPanel.mount.kind === 'none' ? null : (
                <>
                  <Field label="Толщина стенки, мм">
                    {({ id }) => (
                      <input
                        id={id}
                        className={styles.numberInput}
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={backPanel.mount.kind === 'none' ? '' : backPanel.mount.thickness}
                        onChange={(event) => {
                          setBackThickness(event.target.valueAsNumber);
                        }}
                      />
                    )}
                  </Field>
                  <Field label="Разделение стенки">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={backPanel.segmentation}
                        onChange={(event) => {
                          setBackSegmentation(event.target.value as 'single' | 'per-section');
                        }}
                      >
                        <option value="single">Цельная</option>
                        <option value="per-section">По секциям</option>
                      </select>
                    )}
                  </Field>
                </>
              )}
              <Field label="Высота цоколя, мм" message="0 — цоколя нет.">
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={plinth?.height ?? 0}
                    {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                    onChange={(event) => {
                      setPlinthHeight(event.target.valueAsNumber);
                    }}
                  />
                )}
              </Field>
              {plinth === undefined ? null : (
                <>
                  <Field label="Отступ цоколя, мм">
                    {({ id }) => (
                      <input
                        id={id}
                        className={styles.numberInput}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={plinth.setback}
                        onChange={(event) => {
                          setPlinthSetback(event.target.valueAsNumber);
                        }}
                      />
                    )}
                  </Field>
                  <Field label="Царги цоколя">
                    {({ id }) => (
                      <select
                        id={id}
                        className={styles.numberInput}
                        value={(plinth.parts ?? []).length > 1 ? 'sides' : 'front'}
                        onChange={(event) => {
                          togglePlinthSides(event.target.value === 'sides');
                        }}
                      >
                        <option value="front">Только передняя</option>
                        <option value="sides">Передняя и боковые</option>
                      </select>
                    )}
                  </Field>
                </>
              )}
            </div>
          </section>

          {/*
          Конструктивные модификаторы (PROMPT 15 §21). Технический минимум:
          зазор до потолка, антресоль, столешница, крепление и фальшпанели.
        */}
          <section className={styles.panel} aria-labelledby="modifiers-title">
            <h2 id="modifiers-title" className={styles.panelTitle}>
              Модификаторы
            </h2>
            <p className={styles.pending}>
              Габарит H делится между цоколем, корпусом, столешницей, антресолью и зазором до
              потолка.
            </p>
            <div className={styles.grid}>
              <Field label="Зазор до потолка, мм">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={modifiers.ceilingGap ?? 0}
                    onChange={(event) => {
                      setCeilingGap(event.target.valueAsNumber);
                    }}
                  />
                )}
              </Field>
              <Field label="Высота антресоли, мм" message="0 — антресоли нет.">
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={modifiers.topSection?.height ?? 0}
                    {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                    onChange={(event) => {
                      setTopSectionHeight(event.target.valueAsNumber);
                    }}
                  />
                )}
              </Field>
              <Field label="Толщина столешницы, мм" message="0 — столешницы нет.">
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={modifiers.countertop?.thickness ?? 0}
                    {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                    onChange={(event) => {
                      setCountertopThickness(event.target.valueAsNumber);
                    }}
                  />
                )}
              </Field>
              {modifiers.countertop === undefined ? null : (
                <Field label="Свес столешницы, мм">
                  {({ id }) => (
                    <input
                      id={id}
                      className={styles.numberInput}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={modifiers.countertop?.overhangFront ?? 0}
                      onChange={(event) => {
                        setCountertopOverhang(event.target.valueAsNumber);
                      }}
                    />
                  )}
                </Field>
              )}
              <Field label="Установка">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={modifiers.wallMount?.mode ?? 'floor-standing'}
                    onChange={(event) => {
                      setWallMount(
                        event.target.value as 'floor-standing' | 'wall-mounted' | 'suspended',
                      );
                    }}
                  >
                    <option value="floor-standing">Напольная</option>
                    <option value="wall-mounted">Настенная</option>
                    <option value="suspended">Подвесная</option>
                  </select>
                )}
              </Field>
              <Field label="Фальшпанелей">
                {({ id }) => (
                  <input
                    id={id}
                    className={styles.numberInput}
                    type="number"
                    readOnly
                    value={(modifiers.falsePanels ?? []).length}
                  />
                )}
              </Field>
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
          </section>

          {/*
          Материалы (PROMPT 13 §23). Технический минимум: реестр материалов
          с их толщинами и назначение материала по ролям. Полноценный
          Material Editor (декоры, форматы листа, кромочные материалы,
          создание и удаление материалов) — НЕ этот этап, см.
          docs/FEATURE_MATRIX.md.
        */}
          <section className={styles.panel} aria-labelledby="materials-title">
            <h2 id="materials-title" className={styles.panelTitle}>
              Материалы
            </h2>
            <p className={styles.pending}>
              Толщина материала — источник геометрии: у детали без своего переопределения толщина
              берётся отсюда.
            </p>
            <div className={styles.grid}>
              {materialList.map((material) => (
                <Field key={material.id} label={`${material.name}, мм`}>
                  {({ id }) => (
                    <input
                      id={id}
                      className={styles.numberInput}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={material.thickness}
                      onChange={(event) => {
                        setMaterialThickness(material.id, event.target.valueAsNumber);
                      }}
                    />
                  )}
                </Field>
              ))}
            </div>
            <div className={styles.grid} style={{ marginTop: 'var(--sp-3)' }}>
              <Field label="Материал корпуса">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={project.materials.assignment.side ?? ''}
                    onChange={(event) => {
                      if (event.target.value !== '') {
                        assignMaterial(
                          CARCASS_ROLES,
                          asId<'Material'>(event.target.value),
                          'Материал корпуса',
                        );
                      }
                    }}
                  >
                    <option value="">— не назначен —</option>
                    {materialList.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Материал полок">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={project.materials.assignment['shelf-adjustable'] ?? ''}
                    onChange={(event) => {
                      if (event.target.value !== '') {
                        assignMaterial(
                          SHELF_ROLES,
                          asId<'Material'>(event.target.value),
                          'Материал полок',
                        );
                      }
                    }}
                  >
                    <option value="">— не назначен —</option>
                    {materialList.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Материал фасадов">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={project.materials.assignment.facade ?? ''}
                    onChange={(event) => {
                      if (event.target.value !== '') {
                        assignMaterial(
                          ['facade'],
                          asId<'Material'>(event.target.value),
                          'Материал фасадов',
                        );
                      }
                    }}
                  >
                    <option value="">— не назначен —</option>
                    {materialList.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Материал проекта по умолчанию">
                {({ id }) => (
                  <select
                    id={id}
                    className={styles.numberInput}
                    value={project.settings.defaultMaterialId}
                    onChange={(event) => {
                      if (event.target.value !== '') {
                        execute(
                          {
                            type: 'SetDefaultMaterial',
                            materialId: asId<'Material'>(event.target.value),
                          },
                          'Материал проекта',
                        );
                      }
                    }}
                  >
                    {materialList.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </section>

          <aside className={styles.panel} aria-labelledby="result-title">
            <h2 id="result-title" className={styles.panelTitle}>
              Результат расчёта
            </h2>
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

            <p className={styles.pending} style={{ marginTop: 'var(--sp-4)' }}>
              Этапы конвейера геометрии, ещё не реализованные: {geometry.pendingStages.join(', ')}.
            </p>
          </aside>

          {/*
          Технический debug-renderer (PROMPT 4 §17). НЕ часть конечного
          интерфейса: собран только для проверки Geometry Engine и явно
          исключён из production-сборки через import.meta.env.DEV — Vite
          заменяет это константой на этапе сборки, и Rollup выбрасывает
          мёртвую ветку целиком (docs/GEOMETRY_RULES.md §12).
        */}
          {import.meta.env.DEV ? (
            <section
              className={`${styles.panel} ${styles.fullWidth}`}
              aria-labelledby="schema-title"
            >
              <h2 id="schema-title" className={styles.panelTitle}>
                Схема (debug, только в разработке)
              </h2>
              <div className={styles.debugToolbar}>
                <label className={styles.debugToggle}>
                  <input
                    type="checkbox"
                    checked={showDebugInfo}
                    onChange={(event) => {
                      setShowDebugInfo(event.target.checked);
                    }}
                  />
                  Показывать ID и координаты
                </label>
              </div>
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
            </section>
          ) : null}
        </main>
        <div className={editorStyles.canvasArea}>
          {/*
            Вид холста: трёхмерная сцена или плоская схема. Это одно и то
            же изделие, показанное по-разному, поэтому и выделение, и
            команды у них общие — второго состояния для 3D не заводится
            (§19). Переключатель, а не две панели рядом: две картинки
            одного шкафа отнимают место и заставляют выбирать, куда
            смотреть.
          */}
          <div className={editorStyles.viewSwitch} role="group" aria-label="Вид изделия">
            <button
              type="button"
              aria-pressed={canvasMode === '3d'}
              onClick={() => {
                setCanvasMode('3d');
              }}
            >
              3D
            </button>
            <button
              type="button"
              aria-pressed={canvasMode === '2d'}
              onClick={() => {
                setCanvasMode('2d');
              }}
            >
              Схема
            </button>
            <button
              type="button"
              aria-pressed={canvasMode === 'room'}
              onClick={() => {
                if (room === undefined) createRoom();
                else setCanvasMode('room');
              }}
            >
              Помещение
            </button>
          </div>

          {canvasMode !== 'room' ? null : room === undefined ? (
            <p className={styles.pending}>Помещение ещё не создано.</p>
          ) : (
            <RoomPlanner
              room={room}
              geometries={furnitureGeometries}
              materials={project.materials}
              selectedInstances={selectedInstances}
              cutawayWalls={cutawayWalls}
              snapEnabled={snapEnabled}
              onSelectInstance={(id) => {
                selectInstances(id === undefined ? [] : [id]);
              }}
              onMoveCommit={(id, position, rotation) => {
                execute(
                  { type: 'TransformFurnitureInstance', instanceId: id, position, rotation },
                  'Переместить мебель',
                );
              }}
            />
          )}

          {canvasMode !== 'room' || room === undefined ? null : (
            <div className={editorStyles.viewSwitch} role="group" aria-label="Показ помещения">
              <button
                type="button"
                aria-pressed={cutawayWalls}
                onClick={() => {
                  setCutawayWalls(!cutawayWalls);
                }}
              >
                Прозрачные стены
              </button>
              <button
                type="button"
                aria-pressed={snapEnabled}
                onClick={() => {
                  setSnapEnabled(!snapEnabled);
                }}
              >
                Привязка
              </button>
              {project.furniture.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    addFurnitureToRoom(item.id);
                  }}
                >
                  Добавить «{item.name}»
                </button>
              ))}
            </div>
          )}

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

          {canvasMode !== '2d' || geometry === undefined || furniture === undefined || canvasView === undefined ? null : (
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

        {canvasMode === 'room' && room !== undefined && roomValidation !== undefined ? (
          <RoomInspector
            room={room}
            extents={roomExtents}
            status={roomValidation.status}
            selected={room.furnitureInstances.find((item) => item.id === selectedInstances[0])}
            furnitureNames={furnitureNames}
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
              execute({ type: 'TransformFurnitureInstance', instanceId: id, position }, 'Переместить мебель');
            }}
            onRotate={(id) => {
              const instance = room.furnitureInstances.find((item) => item.id === id);
              if (instance === undefined) return;
              execute(
                { type: 'TransformFurnitureInstance', instanceId: id, rotation: rotateQuarter(instance.rotation) },
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
        ) : inspector === undefined ? null : (
          <Inspector model={inspector} onAction={runInspectorAction} />
        )}
      </div>

      <StatusBar
        issues={problems}
        production={readiness?.status}
        storage={storage.status}
        storageMessage={storage.message}
        ephemeral={storage.ephemeral}
        onSelectIssue={selectIssueTarget}
      />
    </div>
  );
}
