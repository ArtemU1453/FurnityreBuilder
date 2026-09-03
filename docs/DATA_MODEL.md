# Доменная модель

**Правило документа:** модель не знает о React, DOM, canvas, SVG, единицах экрана
и о том, как выглядит интерфейс. Она описывает мебель, а не приложение.
Любой тип отсюда должен быть сериализуем в JSON без потерь.

> **Состояние реализации.** Все типы этого документа существуют в `src/domain/`
> и проверяются линтером на отсутствие зависимости от React, DOM и браузерных API.
> Отличия реализации от первоначального проекта отмечены по тексту.
> Подробности по единицам — `UNITS_AND_PRECISION.md`, по координатам —
> `COORDINATE_SYSTEM.md`. Формулы, использующие эти типы (каркас, внутренний
> объём, раскладка секций, перегородки, размеры раскроя) — `GEOMETRY_RULES.md`.
> На PROMPT 4 дерево секций (§5) впервые по-настоящему раскладывается
> геометрическим движком — Section/Grid/Cell/Partition из задания
> сопоставлены с уже существующими типами в §5.6, без новых хранимых сущностей.
> PROMPT 5 — техническая ревизия (аудит) уже реализованных правил расчёта
> корпуса: ни один тип и ни одна формула не изменены, найдена и
> задокументирована одна пограничная неоднозначность (§5.6, `Section.width`
> при вложенном делении по X) — подробности и итоговая сводная таблица
> формул — `docs/GEOMETRY_RULES.md` §13.
> На PROMPT 6 получил геометрию тип `Shelf` (§6.1): полки строятся этапом
> `fill` как настоящие детали `Part`, при этом ячейка остаётся
> пространством, а не деталью. Новых хранимых полей у `Shelf` не появилось —
> координаты, размеры и принадлежность секции по-прежнему производные
> (`docs/GEOMETRY_RULES.md` §14).
> На PROMPT 8 секции, ряды и колонки получили индивидуальные размеры
> (§5.3) — тем же типом `SizeSpec`, что существовал с PROMPT 1, без нового
> механизма и без поля-режима; команда `SetChildSize` стала адресовать
> ребёнка по id, а не по позиции в массиве.
> На PROMPT 7 секция стала геометрической областью с явными границами
> (`GeometryResult.sections`, §5.6) и появилась записанная политика
> идентичности (§5.7) вместе с командой `SetSectionCount`, которая меняет
> число секций, не трогая id уже существующих. Хранимых полей снова не
> прибавилось: границы секции вычисляются, а не хранятся
> (`docs/GEOMETRY_RULES.md` §15).

---

## 1. БАЗОВЫЕ СОГЛАШЕНИЯ

### 1.1 Единицы

Все линейные величины — **миллиметры**. Одно целое число не подходит: зазоры и
половины зазоров дают доли (например, два накладных фасада на 1000 мм при зазоре
3 мм → 498.5 мм). Решение:

```ts
/** Миллиметры. Инвариант: кратно 0.1. Нормализация — только через roundMm(). */
export type Mm = number;

export const MM_PRECISION = 0.1;
export const MM_EPSILON  = 0.05;

export const roundMm = (v: number): Mm => Math.round(v * 10) / 10;
export const eqMm = (a: Mm, b: Mm): boolean => Math.abs(a - b) < MM_EPSILON;
```

**Правило.** Каждая величина, попадающая в `Part`, проходит через `roundMm`.
Сравнения размеров — только через `eqMm`, никогда через `===`.

### 1.2 Система координат

Реализация — `src/domain/coordinates.ts`, полное описание — `COORDINATE_SYSTEM.md`.

Правая тройка, начало — левый-нижний-задний угол габарита изделия
**включая заднюю стенку**: при накладном монтаже стенка занимает
`z ∈ [0, Tb]`, а корпусные детали начинаются с `z = Tb`. Это уточнение
появилось при реализации: без него положение корпуса относительно габарита
оставалось неоднозначным.

| Ось | Направление | Смысл |
| --- | --- | --- |
| `x` | вправо | ширина `W` |
| `y` | вверх | высота `H` |
| `z` | от задней стенки вперёд, к пользователю | глубина `D` |

Причина выбора: `y` вверх совпадает с интуицией «полка выше / ниже» и с тем, как
пользователь читает фасад. Экранная инверсия `y` — задача слоя отрисовки, не домена.

Позиция детали `position` — координата её **минимального угла** (min-x, min-y, min-z).

### 1.3 Идентификаторы

```ts
export type Id<T extends string> = string & { readonly __brand: T };
export type NodeId  = Id<'Node'>;
export type PartId  = Id<'Part'>;
export type MaterialId = Id<'Material'>;
```

Генерация — `crypto.randomUUID()`. Идентификаторы стабильны между пересчётами
геометрии: `PartId` детерминированно выводится из пути в дереве и роли детали,
чтобы выделение не слетало после изменения размера (см. `INTERACTION_MODEL.md` §9).

### 1.4 Версионирование

```ts
export const SCHEMA_VERSION = 1;
```
Каждый сохранённый документ несёт `schemaVersion` **снаружи** проекта:
читатель обязан узнать версию до разбора содержимого. Миграции и правила
отказа — `REPOSITORY_ARCHITECTURE.md` §5.

---

## 2. КОРНЕВЫЕ СУЩНОСТИ

```ts
// Реализовано в src/domain/project/types.ts
export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly units: 'mm';
  readonly metadata: ProjectMetadata;   // даты и версия приложения вынесены сюда
  readonly materials: MaterialLibrary;
  readonly hardware: HardwareLibrary;
  readonly furniture: readonly Furniture[];  // сейчас 1; массив — задел под планировщик
  readonly room?: Room;
  readonly settings: ProjectSettings;
}

export interface ProjectMetadata {
  readonly createdAt: string;   // ISO 8601
  readonly updatedAt: string;
  readonly appVersion: string;
}

export interface ProjectSettings {
  readonly defaultMaterialId: string;
  readonly defaultEdge: EdgeSpec;
  readonly construction: ConstructionScheme;   // см. §4 — ключевая параметризация
  readonly tolerances: Tolerances;
  readonly edgeSizing: EdgeSizingPolicy;       // добавлено при реализации
}
```

Три отличия от первоначального проекта, появившиеся при реализации:
`schemaVersion` переехал в `ProjectDocument` (версия должна читаться раньше
содержимого); даты собраны в `metadata` вместе с версией приложения;
`edgeSizing` перенесён из отдельного места в настройки проекта, потому что
это выбор пользователя, а не константа сборки.

Все поля объявлены `readonly`: изменения идут только через команды
(`STATE_ARCHITECTURE.md` §3).

```ts
export interface Furniture {
  readonly id: Id<'Furniture'>;
  name: string;
  kind: FurnitureKind;
  dimensions: Dimensions;
  carcass: CarcassSpec;
  root: SectionNode;          // дерево внутреннего пространства — см. §5
  facades: FacadeGroup[];     // двери, наложенные на секции — см. §7
  placement?: Placement;      // положение в помещении (планировщик)
}

export type FurnitureKind =
  | 'wardrobe'      // гардероб / шкаф
  | 'shelving'      // стеллаж (без дверей)
  | 'cabinet'       // тумба
  | 'dresser';      // комод
```

`kind` влияет только на пресеты и подсказки, **не на геометрию**.
Геометрия одинакова для всех: корпус + дерево секций + фасады.

---

## 3. ГАБАРИТЫ

```ts
export interface Dimensions {
  width:  Mm;   // W — габарит по X
  height: Mm;   // H — габарит по Y
  depth:  Mm;   // D — габарит по Z
  panelThickness: Mm;   // T — толщина основного материала корпуса
}
```

**Что входит в габарит — параметр, а не догадка:**

```ts
export interface Tolerances {
  /** Входит ли толщина задней стенки в габаритную глубину D. UNKNOWN: T-CAR-04 */
  depthIncludesBackPanel: boolean;
  /** Входят ли накладные фасады в габаритную глубину D. UNKNOWN: T-DOOR-02 */
  depthIncludesFacade: boolean;
  /** Входит ли цоколь/ножки в габаритную высоту H. UNKNOWN: T-CAR-05 */
  heightIncludesBase: boolean;
}
```

Границы значений W/H/D — `UNKNOWN` (тест T-DIM-01). До установления используются
предупреждающие, а не блокирующие пороги (см. `validation` §10) — приложение не
запрещает пользователю ввод, а сообщает о риске конструкции.

---

## 4. СХЕМА СБОРКИ КАРКАСА — ЦЕНТРАЛЬНАЯ ПАРАМЕТРИЗАЦИЯ

Это ответ на 9 из 59 неизвестных функциональной спецификации. Вместо выдуманной
формулы модель хранит **схему стыка**, а геометрия выводится из неё.

```ts
export interface ConstructionScheme {
  /** Кто «сквозной» по вертикали: боковины или горизонтали. */
  verticalPriority: 'sides-through' | 'horizontals-through' | 'mixed';
  /** Для 'mixed': верх накладной, низ вкладной (частая практика). */
  topOverlaysSides: boolean;
  bottomOverlaysSides: boolean;
  /** Крепёж корпусных стыков. */
  jointType: 'confirmat' | 'eccentric' | 'dowel' | 'eccentric+dowel';
}
```

`backMount` в реализации не входит в схему сборки: монтаж задней стенки —
свойство конкретного изделия (`Furniture.carcass.back.mount`), а схема стыка
общая для проекта. Формулы каркаса для всех трёх схем реализованы
в `src/geometry/stages/carcass.ts` и покрыты тестами.

Три поддерживаемых варианта и следствия для деталей при `W`, `H`, `D`, `T`:

| Схема | Боковина | Верх / низ | Проверяется тестом |
| --- | --- | --- | --- |
| `sides-through` | `H × D` | `(W − 2T) × D` | T-CAR-01 |
| `horizontals-through` | `(H − 2T) × D` | `W × D` | T-CAR-01 |
| `mixed` (верх накладной) | `(H − T) × D` | верх `W × D`, низ `(W − 2T) × D` | T-CAR-01 |

```ts
// ASSUMPTION (до T-CAR-01): наиболее частая практика для шкафов —
// боковины сквозные, горизонтали между ними.
export const DEFAULT_SCHEME: ConstructionScheme = {
  verticalPriority: 'sides-through',
  topOverlaysSides: false,
  bottomOverlaysSides: false,
  backMount: { kind: 'overlay', thickness: 3 },
  jointType: 'confirmat',
};
```

```ts
export interface CarcassSpec {
  hasTop: boolean;
  hasBottom: boolean;
  back: BackPanelSpec;
  base?: BaseSpec;          // цоколь или ножки
  countertop?: CountertopSpec;
}
```

---

## 5. ВНУТРЕННЕЕ ПРОСТРАНСТВО: ДЕРЕВО СЕКЦИЙ

### 5.1 Почему дерево, а не плоская сетка

Задание говорит о «сетке, строках, колонках». Плоская сетка `rows × cols` не
описывает реальную мебель: в шкафу левая колонка может быть разделена на 5 полок,
а правая — на штангу сверху и 3 ящика снизу, причём ящичная зона делится дальше.
Плоская сетка вынуждает создавать фиктивные строки во всех колонках.

**Решение: рекурсивное дерево с чередующейся осью деления.**
Дерево — надмножество сетки: плоская сетка = split по X, каждый ребёнок = split по Y
с одинаковым числом детей. Поэтому выбор дерева ничего не теряет.

`UNKNOWN (T-GRID-01)`: использует ли референс плоскую сетку или дерево. На нашу
модель это не влияет — она покрывает оба случая. Влияет только на UI-пресеты.

### 5.2 Типы узлов

```ts
export type SectionNode = SplitNode | LeafNode;

export interface SplitNode {
  readonly id: NodeId;
  kind: 'split';
  axis: 'x' | 'y';                 // 'x' → колонки (вертикальные стойки)
                                   // 'y' → строки (горизонтальные полки-разделители)
  divider: DividerSpec;            // чем именно разделено
  children: SectionChild[];        // ≥ 2
}

export interface SectionChild {
  size: SizeSpec;
  node: SectionNode;
}

export interface LeafNode {
  readonly id: NodeId;
  kind: 'leaf';
  fill: LeafFill;                  // наполнение ячейки
}
```

### 5.3 Размеры детей — как ведут себя ячейки при изменении габарита

Это прямой ответ на UNKNOWN T-DIM-04, вынесенный в решение пользователя:

```ts
export type SizeSpec =
  | { mode: 'fixed'; value: Mm }   // держит абсолютный размер; при росте корпуса не меняется
  | { mode: 'flex'; weight: number }; // делит остаток пропорционально весу
```

Алгоритм раскладки одного `SplitNode` по доступной длине `L` вдоль оси:

```
usable = L − divider.thickness × (children.length − 1)
fixedSum = Σ fixed.value
flexSum  = Σ flex.weight
rest = usable − fixedSum
for each flex child: size = rest × (weight / flexSum)
```

Инварианты:
- `rest ≥ 0` — иначе `ValidationError('OVERCONSTRAINED_SPLIT')`;
- размер любой ячейки `≥ minCellSize` (по умолчанию 50 мм) — иначе `warning`.

Поведение при изменении габарита следует из режима:
`fixed` — ячейка сохраняет размер, `flex` — растягивается. Пользователь видит и
переключает режим прямо в схеме (замок на размерной линии), см. `UX_FLOW.md` §6.

**Индивидуальные размеры (PROMPT 8).** Этот же тип задаёт и неравномерные
секции, ряды и колонки — отдельной модели размеров не заводится:

| Режим из задания PROMPT 8 | Как выражается | Чем строится |
| --- | --- | --- |
| EQUAL — `sectionCount = 3` даёт `[400, 400, 400]` | все дети `flex` с равным весом | `createSections` |
| FIXED — `[300, 500, 400]` | все дети `fixed` | `createSizedSplit(ids, 'x', fixedSizes([...]), T)` |
| смешанный — «эта секция ровно 300, остальные делят остаток» | часть `fixed`, часть `flex` | `createSizedSplit` со смешанным массивом |

Отдельного поля `sectionSizingMode` нет намеренно: оно было бы вторым
источником истины о том, что уже однозначно записано в размерах детей,
и могло бы с ними разойтись. Ряды и колонки используют тот же `SizeSpec`
на той же позиции — разница только в оси родительского деления
(`docs/GEOMETRY_RULES.md` §16).

Размер здесь — это ПРОЁМ, а не доля габарита: `W = Σ секций + (N−1)·T + 2·T`.
Если сумма не сходится с доступным местом, движок сообщает
`SPLIT_OVERCONSTRAINED` или `SPLIT_UNDERCONSTRAINED` и не строит геометрию
с невидимым зазором (§16.4 там же).

### 5.4 Разделитель

```ts
export interface DividerSpec {
  /** Реальная деталь или воображаемая линия деления. */
  material: 'panel' | 'none';
  thickness: Mm;                   // 0 если 'none'
  /** Для 'y': полка-разделитель. Съёмная или стационарная. */
  mounting: 'fixed' | 'adjustable';
  /** Насколько разделитель не доходит до фасада. */
  frontSetback: Mm;                // UNKNOWN: T-SHF-01, default 0
  materialId?: MaterialId;         // если отличается от корпуса
  edge?: EdgeSpec;
}
```

`material: 'none'` нужен для чисто логического деления (например, зона под штангой,
не отделённая физической полкой).

### 5.5 Наполнение ячейки

```ts
export type LeafFill =
  | { kind: 'empty' }
  | { kind: 'shelves'; shelves: Shelf[] }
  | { kind: 'drawers'; drawers: Drawer[] }
  | { kind: 'rod'; rod: HangingRod }
  | { kind: 'rod+shelf'; rod: HangingRod; shelfAbove: Shelf };
```

Смешанные случаи (полки + ящики в одной ячейке) выражаются делением по `y`
на две ячейки, а не флагами внутри одной — это сохраняет модель однозначной.

### 5.6 Carcass / Section / Grid / Cell / Partition — производные понятия

**Реализовано на PROMPT 4.** Задание требует сущности `Section`, `Grid`,
`Cell`, `Partition` с полями вроде `rowCount`/`columnCount`/`cells`. В коде
их НЕТ как отдельных хранимых типов — и это осознанное решение, а не
пропуск. У каждого понятия уже есть точный эквивалент в модели, введённой
в §4–§5, и заводить для них параллельные структуры означало бы держать
одну и ту же информацию (сколько секций, где перегородки, какого они
размера) в двух местах одновременно — ровно то, от чего проект
последовательно уклоняется с PROMPT 1 (`docs/ARCHITECTURE.md` §1: «Domain
Model — источник истины», принцип, повторённый и в задании PROMPT 4 §12).

| Понятие задания | Эквивалент в модели | Как получить |
| --- | --- | --- |
| `Carcass` | `CarcassSpec` (§4) + `ConstructionScheme` (§4) | уже есть, без изменений |
| `Section` | ребёнок ПЕРВОГО деления по оси X от корня; если корень делится по Y или является листом — секция одна, и это сам корень | `sectionIdFor()` в `src/geometry/stages/layout.ts` |
| `Section.width` (аудит PROMPT 5) | сумма расстояния между соседними перегородками/боковинами (не включает толщину перегородки) — однозначно ТОЛЬКО пока внутри секции нет второго, более глубокого деления по X. При таком (сейчас непостроимом фабриками, но не запрещённом моделью) дереве у ячеек одной секции были бы разные `box.size.x` — единого числа не существовало бы. `AMBIGUOUS`, не решается сейчас — см. `docs/GEOMETRY_RULES.md` §13.2 | `resolveSizes(...).spans[i].length` на узле, определяющем секцию |
| `Grid` (rows × columns) | поддерево из вложенных `SplitNode` с чередующимися осями Y (строки) и X (колонки) | `createUniformGrid()` в `src/domain/furniture/sections.ts` строит его программно; вручную — последовательность команд `SplitNode` |
| `Partition` | `DividerSpec` на узле `SplitNode` (уже в §5.4) + порождаемый ею `Part` с ролью `partition`/`shelf-fixed`/`shelf-adjustable` | вычисляется `layout`-этапом движка, не хранится |
| `Section` как ОБЛАСТЬ (PROMPT 7) | `GeometryResult.sections: SectionBox[]` — `nodeId`, `index`, `box` (шесть границ секции) | вычисляется `layout`-этапом; `section.width` — это `box.size.x`, отдельным полем не хранится |
| `Cell` | `LeafNode` (уже в §5.2), `id` листа = id ячейки | `LeafNode.id`, без отдельного строкового идентификатора вида `section-1-cell-2-3` |
| `Cell.row`/`Cell.column` | индекс листа среди соседей по ближайшему предку соответствующей оси | вычисляется при обходе дерева, не хранится (дерево — не обязательно равномерная сетка целиком, см. §5.1) |
| `Cell.contents` | `LeafNode.fill` (уже в §5.5) | без изменений |
| `Cell.state` | **не входит в домен** — состояние выделения/наведения принадлежит сессии интерфейса, не изделию (`docs/STATE_ARCHITECTURE.md` §7) | `useSessionStore` |

**Почему НЕ два id на ячейку.** `LeafNode.id` уже стабилен между
пересчётами (детерминированность деревьев гарантирована тем, что структуру
меняют только команды, а не расчёт) и уже используется для undo/redo,
выделения и трассируемости (`docs/INTERACTION_MODEL.md` §9). Второй,
вычисляемый id вида `section-1-cell-2-3` менялся бы при каждой
структурной правке (добавили колонку — у всех последующих ячеек «номер»
сдвинулся) и либо разошёлся бы с первым, либо дублировал его как строку.
Ни то ни другое не помогает.

**Расчёт.** Geometry Engine раскладывает дерево в ячейки и перегородки —
`docs/GEOMETRY_RULES.md` §9. Результат — `GeometryResult.cells: CellBox[]`,
где каждая запись несёт `nodeId` (= id ячейки), `box`, `row`, `column`,
`sectionId`, `fill`. Формально это РЕЗУЛЬТАТ расчёта, не часть `Project` —
как и `Part[]` (§11), не хранится.

### 5.7 Политика идентичности (PROMPT 7 §15)

Идентичность объекта — это id его узла в дереве (`NodeId`), и ничего
больше. Ни порядковый номер, ни координата, ни индекс в массиве
идентичностью не являются. Отсюда четыре правила, которые вместе
описывают всё поведение проекта при изменениях:

| Событие | Что происходит с id |
| --- | --- |
| **Изменение размера секции, ряда или колонки** | Не меняется ни один id: `SetChildSize` правит `SizeSpec` существующего ребёнка и адресует его по `childId`, а не по позиции в массиве (позиция сдвигается при добавлении соседа — идентичностью она не является) |
| **Пересчёт геометрии** (изменился `W`, `H`, `D`, `T`) | Не меняется ни один id. Пересчёт не трогает дерево, поэтому изменить id физически не может — меняются только координаты и размеры в `GeometryResult` |
| **Добавление секции** | Новая секция получает новый id. Существующие сохраняют свои — вместе со своим наполнением, ячейками и полками |
| **Удаление секции** | Исчезает удалённая секция и всё, что принадлежало ТОЛЬКО ей (её ячейки, её полки). Оставшиеся сохраняют id и порядок |
| **Изменение структуры внутри секции** (деление на ряды, схлопывание) | Меняется идентичность только затронутого поддерева; соседние секции не задеты |

**Почему это важно раньше, чем появился интерфейс.** Выделение, undo/redo,
перетаскивание, сохранение и экспорт — все они ссылаются на объект по id.
Если id объекта, которого пользователь не касался, меняется от действия
в другом месте экрана, ломается всё перечисленное сразу: выделение
слетает, шаг истории ссылается в пустоту, экспортированная спецификация
не сходится с предыдущей версией.

**Как это обеспечено.** Команда `SetSectionCount`
(`src/state/commands.ts`) правит ТОЛЬКО хвост списка секций: добавляет или
удаляет детей, не пересобирая существующих. До PROMPT 7 число секций
меняли через `SetRoot`, подменявший дерево целиком — и потому менявший id
у всех секций разом, включая нетронутые. Обе команды остались: `SetRoot`
для случая «построить новую структуру с нуля», `SetSectionCount` — для
«изменить количество, сохранив то, что есть».

Отдельный случай — схлопывание до одной секции: первая секция не
пересоздаётся пустой, а становится корнем как есть, со своим id и своим
наполнением. Проверено тестом: полка, положенная в первую секцию при трёх
секциях, остаётся на месте после схлопывания до одной.

---

## 6. ДЕТАЛИ НАПОЛНЕНИЯ

### 6.1 Полка

```ts
export interface Shelf {
  readonly id: NodeId;
  /** Положение вдоль высоты ячейки. */
  placement:
    | { mode: 'auto'; index: number; count: number }  // равномерно
    | { mode: 'manual'; offsetFromBottom: Mm };
  mounting: 'adjustable' | 'fixed';   // полкодержатель / конфирмат
  thickness?: Mm;                     // если отличается от корпуса
  materialId?: MaterialId;
  edge?: EdgeSpec;
  /** Отступ передней кромки от плоскости фасада. UNKNOWN: T-SHF-01 */
  frontSetback?: Mm;
}
```

**Реализовано на PROMPT 6.** Полки строятся этапом `fill` геометрического
движка (`src/geometry/stages/fill.ts`); полные формулы ширины, глубины,
толщины, координат, количества и размещения — `docs/GEOMETRY_RULES.md` §14.
Правило допустимого пролёта (`CONFIRMED`, см. функциональную спецификацию
§1.3) остаётся задачей валидации, а не геометрии, и ещё не реализовано.

**Почему в типе нет `x`/`y`/`width`/`depth`/`sectionId`/`row`/`removable`,
которых требует задание PROMPT 6 §3.** По тому же правилу, по которому их
нет у ячейки (§5.6): это производные величины, и хранить их означало бы
завести второй источник истины. Соответствие — `GEOMETRY_RULES.md` §14.2:

| Понятие задания | Где оно на самом деле |
| --- | --- |
| `x`, `y`, `z`, `width`, `height`, `depth` | `Part.position`/`Part.size` в `GeometryResult` |
| `sectionId`, `row` | через `Part.origin.nodeId` → ячейка в `GeometryResult.cells` → её `sectionId`/`row` |
| `thickness` | `Shelf.thickness ?? Dimensions.panelThickness` |
| `removable` | `mounting === 'adjustable'`: «съёмная» и «на полкодержателях» — одно свойство, а не два |
| тип полки (FIXED/REMOVABLE) | `PartRole` результата: `shelf-fixed` / `shelf-adjustable` |

**Полка и горизонтальный разделитель — одна деталь, разные задачи.**
`SplitNode` с `axis: 'y'` (§5.2) тоже даёт физическую полку, но при этом
делит ячейку надвое: две новых ячейки с независимым наполнением. Полка
из `LeafFill.shelves` ячеек не создаёт — проём остаётся одним.
Выбор между ними — вопрос «нужны ли разные наполнения сверху и снизу»,
а не вопрос о самой доске. Подробнее — `GEOMETRY_RULES.md` §14.1.

### 6.2 Ящик

```ts
export interface Drawer {
  readonly id: NodeId;
  /** Высота фасада как доля ячейки или фиксированная. */
  size: SizeSpec;
  slide: SlideSpec;
  box: DrawerBoxSpec;
  facade: FacadeSpec;
  handle?: HandleSpec | null;         // null = PUSH-открывание
}

export interface SlideSpec {
  type: 'roller' | 'ball-full' | 'ball-partial' | 'hidden-soft-close';
  /** Номинальная длина, мм. INDUSTRY: 250…600 шаг 50. UNKNOWN точный ряд: T-DRW-03 */
  nominalLength: Mm;
  /** Зазор с каждой стороны между коробом и стенкой проёма. UNKNOWN: T-DRW-02 */
  sideClearance: Mm;
}

export interface DrawerBoxSpec {
  sideHeight: Mm;
  bottom: {
    mount: 'groove' | 'nailed-under';   // UNKNOWN: T-DRW-02
    thickness: Mm;                       // обычно 3–4 (ХДФ)
    grooveDepth?: Mm;
    grooveOffsetFromBottom?: Mm;
  };
  materialId?: MaterialId;
}
```

```ts
// ASSUMPTION (до T-DRW-02): шариковые направляющие полного выдвижения,
// зазор 13 мм с каждой стороны — наиболее распространённый стандарт.
export const DEFAULT_SLIDE: SlideSpec = {
  type: 'ball-full', nominalLength: 450, sideClearance: 13,
};
```

### 6.3 Штанга

```ts
export interface HangingRod {
  readonly id: NodeId;
  profile: 'round-25' | 'oval-30x15';
  /** Отступ от верха ячейки — место для плечиков. */
  offsetFromTop: Mm;                  // ASSUMPTION 60; UNKNOWN: T-HW-05
  /** Отступ от фасада. */
  offsetFromFront: Mm;                // ASSUMPTION 100; UNKNOWN: T-HW-05
  mount: 'flange' | 'endcap';
}
```

---

## 7. ФАСАДЫ

Фасады не принадлежат ячейке: одна дверь может закрывать несколько ячеек.
Поэтому это отдельный список со ссылкой на покрываемую область.

```ts
export interface FacadeGroup {
  readonly id: NodeId;
  /** Что закрывает: узел дерева (секцию) или весь корпус. */
  covers: { kind: 'node'; nodeId: NodeId } | { kind: 'carcass' };
  type: FacadeType;
  leaves: FacadeLeaf[];               // створки
  overlay: OverlaySpec;
}

export type FacadeType =
  | 'hinged'        // распашные
  | 'sliding'       // купе        (UNKNOWN наличие: T-DOOR-01)
  | 'folding'       // складные    (UNKNOWN наличие: T-DOOR-01)
  | 'lift';         // подъёмные   (UNKNOWN наличие: T-DOOR-01)

export interface FacadeLeaf {
  readonly id: NodeId;
  /** Доля ширины проёма. */
  size: SizeSpec;
  hingeSide: 'left' | 'right' | 'top' | 'bottom' | 'none';
  handle?: HandleSpec | null;
  materialId?: MaterialId;
  edge?: EdgeSpec;
}

export interface OverlaySpec {
  /** Накладной (поверх корпуса) или вкладной (в проём). UNKNOWN: T-DOOR-02 */
  mode: 'overlay' | 'inset';
  gapBetweenLeaves: Mm;    // UNKNOWN: T-DOOR-02, ASSUMPTION 3
  gapTop: Mm;              // ASSUMPTION 2
  gapBottom: Mm;           // ASSUMPTION 2
  gapSide: Mm;             // ASSUMPTION 2
}
```

---

## 8. ЗАДНЯЯ СТЕНКА, ЦОКОЛЬ, СТОЛЕШНИЦА

```ts
export type BackPanelMount =
  | { kind: 'none' }
  | { kind: 'overlay'; thickness: Mm }              // прибивается сзади
  | { kind: 'inset-groove'; thickness: Mm;          // в паз
      grooveDepth: Mm; grooveOffsetFromRear: Mm }
  | { kind: 'inset-flush'; thickness: Mm };         // в четверть/впотай

export interface BackPanelSpec {
  mount: BackPanelMount;
  materialId: MaterialId;
  /** Одна панель или отдельная на каждую секцию. UNKNOWN: T-CAR-04 */
  segmentation: 'single' | 'per-section';
}

export interface BaseSpec {
  kind: 'plinth' | 'legs' | 'none';
  height: Mm;
  /** Отступ цоколя вглубь от плоскости фасада. */
  setback: Mm;                 // UNKNOWN: T-OFF-01
  legCount?: number;
}

export interface CountertopSpec {
  thickness: Mm;
  overhangFront: Mm;           // UNKNOWN: T-CAR-06
  overhangLeft: Mm;
  overhangRight: Mm;
  overhangBack: Mm;
  materialId: MaterialId;
  edge: EdgeSpec;
}
```

---

## 9. МАТЕРИАЛЫ И КРОМКА

```ts
export interface Material {
  readonly id: MaterialId;
  name: string;                 // задаёт пользователь; никаких брендовых каталогов
  kind: 'chipboard' | 'mdf' | 'plywood' | 'hardboard' | 'solid' | 'glass' | 'other';
  thickness: Mm;
  /** Цвет только для отрисовки схемы, не для фотореализма. */
  displayColor: string;         // hex
  /** Направление текстуры — критично для карты раскроя. */
  grain: 'none' | 'along-length' | 'along-width';
  sheet?: { width: Mm; height: Mm; trim: Mm };  // формат листа для раскроя
  pricePerSqM?: number;         // опционально, для сметы; по умолчанию не задано
}

export interface MaterialLibrary {
  items: Record<MaterialId, Material>;
  /** Назначение материала по ролям деталей. */
  assignment: Partial<Record<PartRole, MaterialId>>;
}
```

```ts
export type EdgeThickness = 0 | 0.4 | 1 | 2;

export interface EdgeSpec {
  /** Кромка на каждой из четырёх сторон детали в её локальных координатах. */
  front: EdgeThickness;
  back:  EdgeThickness;
  left:  EdgeThickness;
  right: EdgeThickness;
  materialId?: MaterialId;
}

/**
 * Вычитается ли толщина кромки из размера детали при раскрое.
 * true  → в карту раскроя идёт размер ДО оклейки (деталь + кромка = проектный размер)
 * false → в карту раскроя идёт проектный размер, кромка «сверху»
 * UNKNOWN: T-EDG-03 — определяющий тест.
 */
export interface EdgeSizingPolicy { subtractFromPartSize: boolean }
```

Правило по умолчанию (`INDUSTRY`): видимые фронтальные торцы — 2 мм ПВХ,
невидимые внутренние — 0.4 мм, задние торцы у стены — без кромки.
Правило референса — `UNKNOWN (T-EDG-02)`.

---

## 10. ФУРНИТУРА

```ts
export type HardwareKind =
  | 'confirmat' | 'eccentric' | 'dowel' | 'shelf-support'
  | 'hinge' | 'slide' | 'handle' | 'push-latch'
  | 'rod' | 'rod-flange' | 'leg' | 'plinth-clip' | 'back-nail';

export interface HardwareItem {
  readonly id: Id<'Hardware'>;
  kind: HardwareKind;
  name: string;
  spec: Record<string, string | number>;   // «7×50», «угол 110°» и т.п.
}

/** Позиция в итоговой спецификации. */
export interface HardwareLine {
  hardwareId: Id<'Hardware'>;
  quantity: number;
  /** Откуда взялось — для трассируемости и подсветки в схеме. */
  sourcePartIds: PartId[];
}
```

Правила количества (петли по высоте двери, конфирматы по глубине стыка) —
**не константы модели**, а таблицы в `src/parts/rules/`, покрытые тестами.
Пороги — `UNKNOWN (T-DOOR-05, T-HW-03)`, значения по умолчанию — `INDUSTRY`.

---

## 11. ДЕТАЛЬ — ВЫХОД ГЕОМЕТРИЧЕСКОГО ДВИЖКА

`Part` **не хранится** в проекте. Это производная величина: `Furniture → Part[]`.
Хранение деталей означало бы два источника истины.

```ts
export interface Part {
  readonly id: PartId;              // детерминированный, стабильный между пересчётами
  role: PartRole;
  label: string;                    // «Боковина левая», «Полка 2 (секция A)»
  /** Позиция минимального угла в системе координат изделия. */
  position: { x: Mm; y: Mm; z: Mm };
  /** Габарит детали по осям изделия. */
  size: { x: Mm; y: Mm; z: Mm };
  /** Плоскость пласти — определяет, какие два размера являются «длина × ширина». */
  orientation: 'vertical-yz' | 'horizontal-xz' | 'frontal-xy';
  /** Размеры для раскроя, уже с учётом EdgeSizingPolicy. */
  cut: { length: Mm; width: Mm; thickness: Mm };
  materialId: MaterialId;
  edge: EdgeSpec;
  grainLocked: boolean;             // нельзя поворачивать при раскрое
  /** Трассируемость: какой узел модели породил деталь. */
  origin: { nodeId?: NodeId; furnitureId: Id<'Furniture'> };
  drilling: DrillHole[];
  quantityGroupKey: string;         // для группировки одинаковых деталей в спецификации
}

export type PartRole =
  | 'side' | 'top' | 'bottom' | 'partition'
  | 'shelf-fixed' | 'shelf-adjustable'
  | 'back' | 'plinth' | 'countertop'
  | 'facade' | 'drawer-front' | 'drawer-side' | 'drawer-back' | 'drawer-bottom'
  | 'filler' | 'other';

export interface DrillHole {
  face: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
  /** Координаты в локальной системе детали, от её минимального угла. */
  u: Mm; v: Mm;
  diameter: Mm;
  depth: Mm;
  purpose: 'confirmat-face' | 'confirmat-end' | 'shelf-support'
         | 'hinge-cup' | 'hinge-plate' | 'slide' | 'handle' | 'dowel' | 'eccentric';
}
```

**Реализовано** (`src/domain/part/types.ts`, `src/geometry/parts.ts`).
`Furniture → Part[]` работает через `buildGeometry()`
(`docs/ARCHITECTURE.md` §5, формулы — `docs/GEOMETRY_RULES.md`).
Движок даёт гарантию сверх типа: если деталь попала в
`GeometryResult.parts`, она уникальна по `id`, имеет положительный размер
по всем трём осям и неотрицательные координаты — это проверяется на каждой
детали, независимо от того, какой этап её произвёл
(`docs/GEOMETRY_RULES.md` §7). `DrillHole[]` пока всегда пуст — присадка
не реализована (этап 28 плана).

---

## 12. ВАЛИДАЦИЯ

```ts
export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: string;                     // 'SHELF_SPAN_EXCEEDED'
  severity: Severity;
  message: string;
  /** К чему относится — для подсветки в схеме. */
  target: { nodeId?: NodeId; partId?: PartId };
  /** Предлагаемое исправление, если оно однозначно. */
  fix?: { label: string; apply: 'AddPartition' | 'ThickenShelf' | 'ReduceWidth' };
}
```

**Принцип (Agency).** `error` не блокирует редактирование — блокирует только
экспорт производственных файлов. Пользователь всегда может довести проект
до корректного состояния сам; приложение не отбирает у него управление.

---

## 13. ПОМЕЩЕНИЕ И ПЛАНИРОВЩИК

```ts
export interface Room {
  walls: Wall[];
  ceilingHeight: Mm;
}

export interface Wall {
  readonly id: Id<'Wall'>;
  a: { x: Mm; z: Mm };
  b: { x: Mm; z: Mm };
  thickness: Mm;
  height: Mm;
}

export interface Placement {
  /** Позиция в плане помещения. */
  origin: { x: Mm; z: Mm };
  /** Поворот вокруг вертикальной оси, градусы, шаг привязки 15°. */
  rotationDeg: number;
  /** Зазоры до стен, вычисляются, но могут быть зафиксированы пользователем. */
  clearances?: { left?: Mm; right?: Mm; back?: Mm };
}
```

Планировщик — приоритет P2, см. `FEATURE_MATRIX.md`.

---

## 14. ДОКУМЕНТ И ИСТОРИЯ

```ts
/** Сохраняемая единица. */
export interface ProjectDocument {
  schemaVersion: number;
  project: Project;
}

/** Не сохраняется. Живёт только в сессии. */
export interface HistoryState {
  past: Patch[][];
  future: Patch[][];
  limit: number;   // 200
}
```

Undo/redo реализуется патчами Immer (`produceWithPatches`), а не снимками:
патч дешёв, сериализуем и одновременно служит дельтой для автосохранения.
Подробности — `ARCHITECTURE.md` §6.3.

---

## 15. ИНВАРИАНТЫ МОДЕЛИ

Реализованные проверки — в `src/validation/rules/`. Пункты 1, 3, 4, 5
проверяет правило `structure` и `references`, пункт 6 — `values`,
пункт 7 обеспечивается конструктором детали `makePart`, пункт 8 покрыт
тестом каркаса. Пункт 2 станет проверяемым вместе с раскладкой (этап 09).

1. `SplitNode.children.length ≥ 2`.
2. У `SplitNode` хотя бы один ребёнок имеет `mode: 'flex'`, либо сумма `fixed`
   в точности равна доступной длине.
3. Вложенные `SplitNode` с одинаковой `axis` запрещены — вместо этого
   разделитель добавляется в существующий узел. Гарантирует единственность
   представления и предсказуемость undo.
4. Все `NodeId` в пределах `Furniture` уникальны.
5. `FacadeGroup.covers.nodeId` ссылается на существующий узел.
6. Толщина любой детали > 0.
7. Любая величина в `Part` кратна 0.1 мм.
8. `Part` не пересекается с другим `Part` объёмом более `MM_EPSILON³`
   (проверка коллизий, `warning` — ловит ошибки формул).

---

## 16. ЧТО МОДЕЛЬ СОЗНАТЕЛЬНО НЕ СОДЕРЖИТ

| Отсутствует | Причина |
| --- | --- |
| Пользователь, аккаунт, сессия, токен | Продукт без регистрации и авторизации |
| Цена, заказ, корзина, подписка, тариф | Продукт бесплатный, без платных функций |
| Аналитика, идентификаторы устройства | Нет трекинга |
| Ссылки на внешние API и каталоги | Нет зависимости от внешних сервисов |
| Состояние UI (выделение, зум, открытая панель) | Это состояние сессии, не документа. См. `ARCHITECTURE.md` §6 |
| Транзиентное состояние drag | Живёт в ref слоя взаимодействия, никогда не в домене |

---

## 17. СВОДКА UNKNOWN В МОДЕЛИ

| Поле / решение | Тест |
| --- | --- |
| Границы W/H/D, шаг, значения по умолчанию | T-DIM-01, T-DIM-03 |
| Поведение ячеек при изменении габарита | T-DIM-04 (решено параметром `SizeSpec`) |
| `ConstructionScheme.verticalPriority` | T-CAR-01 |
| `BackPanelMount`, вхождение в глубину | T-CAR-04 |
| Плоская сетка или дерево у референса | T-GRID-01 (наша модель покрывает оба) |
| `OverlaySpec` — режим и зазоры | T-DOOR-02 |
| Правило количества петель | T-DOOR-05 |
| `SlideSpec.sideClearance`, ряд длин | T-DRW-02, T-DRW-03 |
| Формула размеров полки, `frontSetback` | T-SHF-01 |
| `EdgeSizingPolicy.subtractFromPartSize` | T-EDG-03 |
| Правило сторон оклейки | T-EDG-02 |
| Правило количества конфирматов | T-HW-03 |
| Параметры штанги | T-HW-05 |
| Свесы столешницы, отступ цоколя | T-CAR-06, T-OFF-01 |
