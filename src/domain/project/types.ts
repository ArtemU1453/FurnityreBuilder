import type {
  FurnitureId,
  IdFactory,
  InstanceId,
  MaterialId,
  ObstacleId,
  OpeningId,
  ProjectId,
  RoomId,
  WallId,
} from '../ids.js';
import type { Mm } from '../units.js';
import type { Vec3 } from '../coordinates.js';
import type { EdgeSpec, EdgeSizingPolicy, MaterialLibrary } from '../materials/types.js';
import type { CuttingSettings } from '../cutting/types.js';
import type { HardwareLibrary } from '../hardware/types.js';
import type { ConstructionScheme, Furniture, Tolerances } from '../furniture/types.js';

/**
 * Версия схемы сохранённого документа.
 *
 * Увеличивается при любом несовместимом изменении структуры. Каждое увеличение
 * сопровождается миграцией в src/persistence/migrations — см.
 * docs/REPOSITORY_ARCHITECTURE.md §5.
 */
export const SCHEMA_VERSION = 1;

/**
 * Планировщик помещения (PROMPT 24).
 *
 * ## Модель расширена, а не заведена заново
 *
 * `Room` и `Wall` существуют с PROMPT 2, и `Project.furniture` с тех же
 * пор помечен как «задел под планировщик». Поэтому здесь не появляется
 * второй комнаты рядом с первой: к существующим типам добавлены поля,
 * которых не хватало, и ни одно старое поле не переименовано.
 *
 * ## Разделение ответственности
 *
 * Комната отвечает за помещение и РАЗМЕЩЕНИЕ объектов. Внутреннюю
 * конструкцию мебели она не знает и не считает: экземпляр ссылается на
 * изделие по идентификатору, а его геометрию по-прежнему строит
 * `buildGeometry`. Производственной геометрии в `Room` нет и быть не
 * должно — это то же правило, по которому детали не хранятся в проекте.
 */

/**
 * Стена.
 *
 * Отрезок на плане (`a` → `b`) плюс толщина и высота. Имена `a`/`b`
 * оставлены прежними: они были заведены на PROMPT 2 и уже лежат в схеме
 * сериализации. Переименовать их в `start`/`end` значило бы сломать
 * совместимость файлов ради синонима.
 *
 * Стен может быть сколько угодно, и они не обязаны образовывать
 * прямоугольник: контур задаётся списком отрезков, поэтому ниши, выступы
 * и сложные углы модель выражает уже сейчас (§4, §5). Инструменты для их
 * рисования — отдельная работа; см. `docs/ROOM_MODEL.md` §3.
 */
export interface Wall {
  readonly id: WallId;
  readonly a: { readonly x: Mm; readonly z: Mm };
  readonly b: { readonly x: Mm; readonly z: Mm };
  readonly thickness: Mm;
  readonly height: Mm;
  /** Материал отделки. Ссылка в тот же реестр, что и у мебели. */
  readonly materialId?: MaterialId;
}

/** Пол: пространственный и визуальный объект, геометрию мебели не меняет (§6). */
export interface Floor {
  /**
   * Уровень пола, мм. Не «толщина стяжки», а отметка, от которой стоит
   * мебель: подиум поднимает всё, что на нём стоит, но не меняет ни одной
   * детали изделия.
   */
  readonly elevation: Mm;
  readonly materialId?: MaterialId;
}

/**
 * Потолок (§7).
 *
 * Высоты здесь НЕТ намеренно: она уже есть — `Room.ceilingHeight`, поле
 * с PROMPT 2. Второе поле высоты означало бы два ответа на вопрос «какой
 * высоты помещение» и неизбежное расхождение.
 */
export interface Ceiling {
  readonly materialId?: MaterialId;
  /** Потолок обычно скрыт: иначе он закрывает вид на комнату сверху. */
  readonly visible: boolean;
}

/** Тип проёма. Список закрыт: `other` покрывает всё, для чего нет своего правила. */
export type OpeningKind = 'door' | 'window' | 'other';

/**
 * Проём в стене (§8).
 *
 * `position` — расстояние вдоль стены от её точки `a` до ЛЕВОГО края
 * проёма, если смотреть от `a` к `b`. Именно смещение вдоль стены, а не
 * мировая координата: проём принадлежит стене, и при переносе стены он
 * обязан ехать вместе с ней.
 *
 * `ASSUMPTION(T-ROOM-03)`: влияет ли проём на допустимость размещения
 * мебели, референсом не подтверждено. Модель проём описывает, проверка
 * сообщает о перекрытии дверного проёма предупреждением — запрета нет.
 */
export interface Opening {
  readonly id: OpeningId;
  readonly wallId: WallId;
  readonly kind: OpeningKind;
  readonly position: Mm;
  readonly width: Mm;
  readonly height: Mm;
  /** Высота низа проёма от пола. У двери обычно 0, у окна — высота подоконника. */
  readonly sillHeight: Mm;
}

/**
 * Препятствие (§9): выступ стены, колонна, труба, радиатор.
 *
 * Одна модель на все виды намеренно. Отдельный тип на каждый вид
 * потребовал бы своей геометрии, своих правил и своей проверки, а с
 * точки зрения размещения все они — одно и то же: объём, который мебель
 * занять не может. `kind` остаётся подписью, а не поведением.
 */
export type ObstacleKind = 'protrusion' | 'column' | 'pipe' | 'radiator' | 'other';

export interface Obstacle {
  readonly id: ObstacleId;
  readonly kind: ObstacleKind;
  /** Минимальный угол коробки препятствия в координатах комнаты, мм. */
  readonly position: Vec3;
  readonly size: Vec3;
  /** Поворот вокруг вертикальной оси, радианы. Другие оси не нужны и не заведены. */
  readonly rotation: number;
  readonly name?: string;
}

/**
 * Экземпляр мебели в комнате (§10).
 *
 * ## Мебель не копируется в комнату
 *
 * Экземпляр хранит ССЫЛКУ и положение — и больше ничего. Габариты,
 * конструкция, детали и спецификация остаются у изделия; изменение
 * изделия немедленно меняет все его экземпляры, потому что копии нет.
 *
 * ## Почему `furnitureId`, а не `projectId`
 *
 * Задание называет ссылку `projectId`. В этой архитектуре адресуемая
 * единица мебели внутри документа — `Furniture` со стабильным
 * `FurnitureId`, а `Project` это весь документ целиком: материалы,
 * фурнитура, настройки и список изделий. Ссылка на другой ДОКУМЕНТ
 * означала бы, что комната может ссылаться на удалённый или ещё не
 * загруженный файл, и сохранение перестало бы быть атомарным.
 *
 * Смысл требования при этом сохранён полностью: один и тот же шкаф
 * размещается в комнате сколько угодно раз — у экземпляров разные
 * `id` и одинаковый `furnitureId`.
 */
export interface FurnitureInstance {
  readonly id: InstanceId;
  /**
   * Проект библиотеки, изделие которого стоит в комнате (PROMPT 25 §3, §13).
   *
   * Появилось на PROMPT 25 вместе с библиотекой проектов. На PROMPT 24
   * ссылка была только внутридокументной (`furnitureId`), и это было
   * верно для тогдашнего мира: проект был один, а ссылка на другой
   * ДОКУМЕНТ означала бы, что комната зависит от файла, которого может
   * не оказаться. Библиотека этот мир изменила — проектов теперь много,
   * и §13 прямо требует ставить в комнату проект из библиотеки.
   *
   * Двух систем ссылок при этом не появилось: `projectId` + `furnitureId`
   * это ОДНА полностью квалифицированная ссылка «какой проект и какое
   * изделие внутри него». Для изделия из текущего документа `projectId`
   * равен его собственному идентификатору.
   *
   * Удалённый проект ссылку не чинит и не стирает: экземпляр остаётся и
   * помечается отсутствующим (`docs/PROJECT_ROOM_INTEGRATION.md` §4) —
   * та же политика, что у удалённого материала (PROMPT 13).
   */
  readonly projectId: ProjectId;
  readonly furnitureId: FurnitureId;
  /**
   * Положение ЛЕВОГО-НИЖНЕГО-ЗАДНЕГО угла изделия в координатах комнаты
   * ДО поворота, мм. Тот же угол, что и начало координат изделия
   * (`docs/COORDINATE_SYSTEM.md` §1), поэтому перевод между системами —
   * это сдвиг и поворот, а не пересчёт.
   */
  readonly position: Vec3;
  /** Поворот вокруг вертикальной оси, радианы. */
  readonly rotation: number;
  /** Заблокированный экземпляр не двигается ни жестом, ни командой перемещения. */
  readonly locked: boolean;
  readonly visible: boolean;
}

/**
 * Помещение.
 *
 * `walls` — единственный источник истины о форме комнаты. Ширины и
 * глубины среди полей нет: для прямоугольной комнаты они выводятся из
 * стен (`roomFootprint`), и хранить их рядом означало бы два ответа на
 * один вопрос — ровно та ошибка, которой проект избегает во всех
 * производных величинах.
 */
export interface Room {
  readonly id: RoomId;
  readonly name: string;
  readonly walls: readonly Wall[];
  readonly ceilingHeight: Mm;
  readonly floor: Floor;
  readonly ceiling: Ceiling;
  readonly openings: readonly Opening[];
  readonly obstacles: readonly Obstacle[];
  readonly furnitureInstances: readonly FurnitureInstance[];
}

export interface ProjectSettings {
  readonly defaultMaterialId: string;
  readonly defaultEdge: EdgeSpec;
  readonly construction: ConstructionScheme;
  readonly tolerances: Tolerances;
  readonly edgeSizing: EdgeSizingPolicy;
  /**
   * Параметры раскроя (PROMPT 17). Ввод пользователя, а не производная
   * величина: сам раскрой не хранится и пересчитывается из деталей.
   */
  readonly cutting: CuttingSettings;
}

/**
 * Метаданные документа. Сознательно не содержат ничего, что идентифицирует
 * пользователя: продукт работает без регистрации, аккаунтов и трекинга
 * (docs/DATA_MODEL.md §16).
 */
export interface ProjectMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appVersion: string;
}

/**
 * Превью проекта для библиотеки (PROMPT 25 §7–§8).
 *
 * ## Превью — производное, и хранится оно как кэш, а не как истина
 *
 * Содержимое строится из `GeometryResult` того же проекта
 * (`generateProjectThumbnail`). Хранится оно ради одного: список из
 * тридцати проектов не должен строить тридцать геометрий при открытии.
 *
 * `sourceFingerprint` — отпечаток того, из чего превью построено. Пока
 * он совпадает с текущим, картинка верна; разошёлся — превью устарело и
 * пересобирается. Без отпечатка кэш пришлось бы инвалидировать вручную,
 * и он неизбежно разошёлся бы с проектом.
 *
 * Дублирующей геометрии внутри превью нет: это строка SVG и ничего больше.
 */
export interface ProjectPreview {
  /** Разметка SVG. Детерминирована для одного и того же проекта. */
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** Отпечаток исходных данных: по нему видно, что превью устарело. */
  readonly sourceFingerprint: string;
  readonly generatedAt: string;
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly units: 'mm';
  readonly metadata: ProjectMetadata;
  readonly materials: MaterialLibrary;
  readonly hardware: HardwareLibrary;
  /** Сейчас одно изделие; массив — задел под планировщик. */
  readonly furniture: readonly Furniture[];
  readonly room?: Room;
  /** Превью для библиотеки. Производное: отсутствие — не ошибка. */
  readonly preview?: ProjectPreview;
  readonly settings: ProjectSettings;
}

/**
 * Сохраняемая единица. Версия лежит СНАРУЖИ проекта, а не внутри:
 * читатель обязан узнать версию до того, как начнёт разбирать содержимое.
 */
export interface ProjectDocument {
  readonly schemaVersion: number;
  readonly project: Project;
}

export interface CreateProjectOptions {
  readonly ids: IdFactory;
  readonly now: () => string;
  readonly appVersion: string;
  readonly name?: string;
}
