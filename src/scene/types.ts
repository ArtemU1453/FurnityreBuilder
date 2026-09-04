import type { MaterialId, MaterialKind, NodeId, PartId, PartRole, Vec3 } from '../domain/index.js';

/**
 * Модель сцены (PROMPT 23 §3).
 *
 * ## Это представление, а не вторая доменная модель
 *
 * `SceneObject` существует ровно для отрисовки. Он не хранит ничего, чего
 * нет в `GeometryResult`, и не добавляет полей, которые пришлось бы
 * поддерживать в синхронном состоянии с деталью. Всё, что нужно домену,
 * достаётся по `id` — который И ЕСТЬ `PartId` или `NodeId`, а не третий
 * параллельный идентификатор.
 *
 * Причина отдельного типа не в желании иметь свой тип, а в том, что
 * рендереру нужны две вещи, которых у детали нет и быть не должно:
 * ЦЕНТР коробки (домен хранит минимальный угол — `docs/COORDINATE_SYSTEM.md`
 * §2) и визуальный материал (домену не нужны ни прозрачность, ни блеск).
 * Считать это в рендерере на каждом кадре — ровно тот способ завести
 * вторую геометрию, который запрещает `docs/ARCHITECTURE.md` §1.
 */

/**
 * Вид объекта сцены. Определяет и правила отрисовки, и правила выбора.
 *
 * `part` — физическая деталь: у неё есть материал, толщина и раскрой.
 * `cell` — НЕ деталь (§6): область внутри корпуса. Рисуется только как
 * подсветка выбранного и только когда выбрана, потому что физического
 * ящика у ячейки не существует.
 * `section` — то же самое для секции.
 * `gizmo` — ручка изменения размера (§23). К производственной геометрии
 * отношения не имеет и в спецификацию не попадает никогда.
 */
export type SceneObjectKind = 'part' | 'cell' | 'section' | 'gizmo';

/** Ось изделия, вдоль которой ручка меняет размер. */
export type GizmoAxis = 'x' | 'y';

/**
 * Что именно меняет ручка. Список закрыт намеренно (§22): свободного
 * трансформа у объектов нет, потому что его нет и в доменной модели —
 * «подвинуть полку на 3 мм вправо» не выражается ни одной командой.
 */
export type GizmoTarget =
  | { readonly kind: 'furniture-width' }
  | { readonly kind: 'furniture-height' }
  /** Ширина секции или высота ряда: и то и другое — `SetChildSize` по id ребёнка. */
  | { readonly kind: 'child-size'; readonly childId: NodeId; readonly axis: GizmoAxis };

/**
 * Визуальный материал. Выводится из `Material`, не заменяет его (§12).
 *
 * Второго реестра материалов не появляется: здесь нет ни имени, ни
 * толщины, ни формата листа — только то, чем отличается ПОКАЗ одного
 * материала от показа другого.
 */
export interface SceneMaterial {
  readonly materialId: MaterialId;
  /** `#rrggbb` из `Material.displayColor`. */
  readonly color: string;
  /** 0 — зеркально, 1 — полностью матово. */
  readonly roughness: number;
  /** 0 — диэлектрик, 1 — металл. Плита и стекло — диэлектрики. */
  readonly metallic: number;
  /** 1 — непрозрачно. Меньше единицы только у стекла. */
  readonly opacity: number;
}

/**
 * Объект сцены: коробка в мировых координатах плюс то, чем её рисовать.
 *
 * Поворота нет и поля `rotation` нет. Все детали корпусной мебели
 * выровнены по осям изделия — это следствие того, что `Part` описывается
 * `position` + `size` без ориентации в пространстве
 * (`docs/COORDINATE_SYSTEM.md` §2). Заводить всегда единичный поворот
 * значило бы обещать возможность, которой в модели нет; когда появится
 * первая повёрнутая деталь (например, открытая дверь), поворот появится
 * вместе с ней и в домене, и здесь.
 */
export interface SceneObject {
  /** `PartId` для детали, `NodeId` для ячейки и секции. Не третий id. */
  readonly id: string;
  readonly kind: SceneObjectKind;
  /** Ячейка принадлежит секции, деталь — узлу-источнику. `undefined` у корпуса. */
  readonly parentId?: string;
  /** ЦЕНТР коробки в мировых координатах, мм. */
  readonly position: Vec3;
  /** Габарит по осям изделия, мм. Всегда положительный. */
  readonly size: Vec3;
  readonly visible: boolean;
  readonly selectable: boolean;
  /** Человекочитаемое имя: и подпись, и имя для скринридера. */
  readonly label: string;
  readonly role?: PartRole;
  readonly material?: SceneMaterial;
  /** Только у `kind === 'gizmo'`. */
  readonly gizmo?: GizmoTarget;
}

/**
 * Готовая сцена.
 *
 * `bounds` — измеренный охват из движка, а не пересчитанный здесь:
 * рендереру он нужен для камеры «вписать всё», и брать его из другого
 * места означало бы второй ответ на вопрос «какого размера изделие».
 */
export interface SceneModel {
  readonly objects: readonly SceneObject[];
  /** Центр охвата: точка, вокруг которой вращается камера. */
  readonly center: Vec3;
  readonly size: Vec3;
  /** Радиус описанной сферы: по нему считается дистанция камеры. */
  readonly radius: number;
}

export const EMPTY_SCENE: SceneModel = {
  objects: [],
  center: { x: 0, y: 0, z: 0 },
  size: { x: 0, y: 0, z: 0 },
  radius: 0,
};

/** Материал по умолчанию: показывается там, где `materialId` битый. */
export const FALLBACK_MATERIAL: SceneMaterial = {
  materialId: '' as MaterialId,
  color: '#b8b2a7',
  roughness: 0.9,
  metallic: 0,
  opacity: 1,
};

/** Виды материала, для которых прозрачность осмысленна (§30). */
export const TRANSPARENT_KINDS: readonly MaterialKind[] = ['glass', 'mirror'];

/** Идентификатор объекта сцены, если он деталь. */
export const partIdOf = (object: SceneObject): PartId | undefined =>
  object.kind === 'part' ? (object.id as PartId) : undefined;

/** Идентификатор узла, если объект — ячейка или секция. */
export const nodeIdOf = (object: SceneObject): NodeId | undefined =>
  object.kind === 'cell' || object.kind === 'section' ? (object.id as NodeId) : undefined;
