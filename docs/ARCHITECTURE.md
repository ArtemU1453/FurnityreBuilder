# Архитектура

> **Состояние реализации.** Этап «Архитектура наполнения ячеек» завершён
> (PROMPT 9): зафиксирована цепочка `Cell → Content → Geometry Resolver →
> Parts`. Модель наполнения — существующий `LeafFill`, а не новый тип:
> наполнение лежит внутри ячейки, поэтому связь структурная. Появился
> контракт `resolveContentGeometry` и явный статус `not-implemented` для
> видов, геометрии для которых ещё нет, — раньше они пропускались молча
> (`docs/GEOMETRY_RULES.md` §17).
> До этого: этап «Вертикальные перегородки и независимые
> секции» (PROMPT 7): секция перестала быть просто строкой
> `sectionId` на ячейке и стала геометрической областью с явными границами
> (`GeometryResult.sections`), а число секций меняется командой
> `SetSectionCount`, сохраняющей идентичность уже существующих секций
> вместе с их ячейками и полками (`docs/DATA_MODEL.md` §5.7).
> Вертикальные перегородки как детали существовали с PROMPT 4 и переписаны
> не были — ревизия подтвердила, что модель требованиям удовлетворяет.
> Раньше: PROMPT 6 сделал полку настоящей деталью движка — этап `fill`
> строит её внутри уже посчитанных ячеек, не создавая новых ячеек
> (`docs/GEOMETRY_RULES.md` §14); PROMPT 5 был ревизией правил корпуса без
> изменения формул (§13 там же); PROMPT 4 дал раскладку дерева секций
> (§5.7) и первый рендерер — технический debug-слой `src/render/` (§10.1),
> отрисовывающий именно то, что посчитал движок, без собственной геометрии.
> Реализованы: доменный слой (включая фабрики секций/сетки и полок), движок
> с этапами `normalize`, `carcass`, `layout` (объединил исходные `layout` и
> `dividers` — §5.2; он же выпускает секции как области), `fill` (полки,
> фасады ящиков и их способ открывания) и `facades` (распашные двери,
> базовый случай — одна ячейка на фасад, включая способ открывания), слой
> валидации, сериализация с версионированием, `ProjectRepository`, сторы
> документа и сессии с историей на патчах (включая `SetRoot` для атомарной
> замены дерева и `SetSectionCount` для изменения числа секций с
> сохранением идентичности), контроллер жестов, пружинный движок, токены
> design system, оболочка приложения с технической панелью секций, сетки,
> полок, дверей, ящиков и способа открывания (ручка/push-to-open).
> Не реализованы: короб ящика и штанга (`LeafFill`-виды без полной
> геометрии), купе/складные/подъёмные фасады, покрытие фасадом нескольких
> ячеек, полноценный расчёт фурнитуры (петли/направляющие/крепёж),
> присадка, интерактивная (не debug) отрисовка схемы, экспорт,
> планировщик — см. `IMPLEMENTATION_PLAN.md`.
> Разделы ниже помечают, что уже есть в коде, а что остаётся проектом.
>
> Смежные документы, появившиеся вместе с кодом:
> `COORDINATE_SYSTEM.md`, `UNITS_AND_PRECISION.md`, `STATE_ARCHITECTURE.md`,
> `REPOSITORY_ARCHITECTURE.md`, `TESTING_STRATEGY.md`, `GEOMETRY_RULES.md`.

---

## 1. ГЛАВНОЕ ПРАВИЛО

> **React-компонент не содержит математики мебели. UI не является источником истины.**

Формально:

```
UI (React)
  ↓ команды
Interaction Layer      — pointer, drag, keyboard, transient state
  ↓ intents
Application State      — документ, сессия, история
  ↓ чистые данные
Domain Model           — ИСТОЧНИК ИСТИНЫ
  ↓
Geometry Engine        — Furniture → Part[]
  ↓
Validation Engine      — Part[] + Furniture → Issue[]
  ↓
Parts / Hardware       — деталировка, кромка, крепёж, присадка
  ↓
Export Engine          — PDF, XLSX, CSV, раскрой
  ↓
Persistence            — IndexedDB, JSON
```

Зависимости идут **строго вниз**. Домен ничего не знает о слоях выше.

### 1.1 Как правило защищается технически

Не комментарием, а линтером. `eslint-plugin-boundaries` в `eslint.config.js`
(фактическая конфигурация, не черновик):

```js
const LAYERS = [
  { type: 'domain',       pattern: 'src/domain/**/*' },
  { type: 'geometry',     pattern: 'src/geometry/**/*' },
  { type: 'validation',   pattern: 'src/validation/**/*' },
  { type: 'persistence',  pattern: 'src/persistence/**/*' },
  { type: 'state',        pattern: 'src/state/**/*' },
  { type: 'motion',       pattern: 'src/motion/**/*' },
  { type: 'interaction',  pattern: 'src/interaction/**/*' },
  { type: 'design-system', pattern: 'src/design-system/**/*' },
  { type: 'render',       pattern: 'src/render/**/*' },   // PROMPT 4
  { type: 'app',          pattern: 'src/app/**/*' },
  { type: 'entry',        pattern: 'src/main.tsx' },
];

const rules = [
  { from: 'domain',        allow: ['domain'] },
  { from: 'geometry',      allow: ['geometry', 'domain'] },
  { from: 'validation',    allow: ['validation', 'geometry', 'domain'] },
  { from: 'persistence',   allow: ['persistence', 'domain'] },
  { from: 'state',         allow: ['state', 'persistence', 'validation', 'geometry', 'domain'] },
  { from: 'motion',        allow: ['motion'] },
  { from: 'interaction',   allow: ['interaction', 'motion', 'state', 'domain'] },
  { from: 'design-system', allow: ['design-system', 'motion'] },
  // render — презентационный слой: видит уже посчитанную геометрию,
  // но не state/interaction. Команды и хранилище остаются заботой app.
  { from: 'render',        allow: ['render', 'domain', 'geometry', 'design-system'] },
  { from: 'app',           allow: ['*'] },
  { from: 'entry',         allow: ['*'] },
];
```

`'export'` и `'parts'` из более раннего черновика этого раздела в коде не
появились: экспорт (PDF/XLSX/CSV) и отдельная спецификация деталей —
этапы плана, ещё не начатые (`docs/IMPLEMENTATION_PLAN.md`); когда они
появятся, лягут в схему по тому же принципу.

Плюс запрет на импорт `react`, `react-dom`, `zustand` и обращение к
`window`/`document`/хранилищу в слоях `domain`, `geometry`, `validation`
(`no-restricted-imports` + `no-restricted-globals`) — и отдельно запрет
UI-фреймворка в `persistence`/`motion`, которым он тоже не нужен.

**Критерий приёмки этапа 01:** попытка импортировать React в `src/geometry`
роняет сборку CI.

---

## 2. ПРИНЦИПЫ, ИЗ КОТОРЫХ ВЫВЕДЕНА АРХИТЕКТУРА

| Требование задания | Архитектурное следствие |
| --- | --- |
| Бесплатно, без регистрации, без сервера | Приложение полностью клиентское. Backend отсутствует как класс. Статический хостинг |
| Локальное сохранение | IndexedDB — единственное хранилище. Никаких сетевых запросов данных |
| Импорт/экспорт | Формат проекта — открытый versioned JSON |
| Без внешних сервисов | Zero runtime third-party requests. Шрифты и иконки — локальные |
| Direct manipulation, 60 fps | Разделение interaction state и domain state (§7) |
| Расширяемость | Слоистость + чистые функции + отсутствие скрытого состояния |

---

## 3. ТЕХНОЛОГИЧЕСКИЙ СТЕК

| Слой | Выбор | Обоснование |
| --- | --- | --- |
| Язык | TypeScript, `strict`, `noUncheckedIndexedAccess` | Геометрия — расчёты; типы ловят ошибки формул |
| Сборка | Vite | Мгновенный HMR, простой статический вывод, без конфигурационного долга |
| UI | React 19 | Требование задания (React упомянут явно) |
| Стор | Zustand + Immer patches | Минимальный, без провайдеров; патчи дают дешёвый undo (§6.3) |
| Схема 2D | **SVG** | Векторная чёткость, встроенный hit-testing, доступность через ARIA на элементах, простой экспорт в PDF |
| 3D (P2) | Three.js через react-three-fiber | Только просмотр; геометрия приходит из движка |
| Анимация | **собственный пружинный движок** (`src/motion`) | Решение изменено при реализации. Требуются точные семантики прерывания и переноса скорости; свой интегратор — около 80 строк, даёт полный контроль и не тянет зависимость, которая на этапе фундамента использовалась бы на несколько процентов. Готовая библиотека остаётся вариантом для декларативных переходов компонентов |
| Хранилище | IndexedDB через `idb` | Ёмкость, бинарные превью, транзакции |
| PDF | `pdf-lib` + `@pdf-lib/fontkit` | Встраивание локального шрифта с кириллицей |
| XLSX | `exceljs` | Полноценный XLSX локально, без сервера |
| Тесты | Vitest + Playwright + fast-check | Chromium уже в окружении; property-тесты обязательны для инвариантов геометрии |
| Границы слоёв | `eslint-plugin-boundaries` + `eslint-import-resolver-typescript` | Резолвер обязателен: без него плагин не сопоставляет импорт `../state/x.js` с файлом `.ts` и молча считает зависимость разрешённой |

**Почему SVG, а не Canvas.** Схема мебели — десятки-сотни прямоугольников, не
десятки тысяч. SVG даёт бесплатно: попадание указателя, фокус с клавиатуры,
`aria-label` на детали, ретина-чёткость, прямой экспорт векторного чертежа.
Canvas потребовал бы своей системы hit-testing и был бы недоступен для screen reader.
Порог пересмотра зафиксирован: если сцена превысит **2000 SVG-узлов** или
профилирование покажет > 8 мс на кадр — переход на Canvas 2D для фона схемы
с сохранением SVG-слоя для интерактивных элементов (см. `IMPLEMENTATION_PLAN.md`, этап 32).

**Чего в стеке нет намеренно:** аналитики, CDN, внешних шрифтов, сборщика ошибок,
любого сетевого SDK. См. `BRAND_INDEPENDENCE_AUDIT.md`.

---

## 4. СТРУКТУРА КАТАЛОГОВ

Существует сейчас:

```
src/
  domain/                    источник истины, 0 зависимостей
    units.ts                 миллиметры, округление, сравнение
    ids.ts                   брендированные идентификаторы, инъекция генератора
    coordinates.ts           Vec3, Box3, операции над телами
    diagnostics.ts           Issue, Severity
    furniture/               типы изделия, дерево секций, раскладка, значения по умолчанию
      sections.ts            фабрики: createSections, createUniformGrid
    materials/               материалы, кромка, политика размеров
    hardware/                типы фурнитуры
    part/                    модель детали, детерминированные идентификаторы
    project/                 проект, настройки, фабрика
  geometry/                  Furniture → Part[], чистые функции
    types.ts                 GeometryInput, GeometryResult, CellBox (+ row/column/sectionId/fill)
    context.ts               аккумулятор прогона, инварианты деталей и ячеек, GeometryStage
    bounding-box.ts          computeBoundingBox(parts) → BoundingBox
    parts.ts                 конструктор детали, размеры раскроя, кромка
    engine.ts                конвейер PIPELINE, аварийная остановка
    stages/normalize.ts      пригодность входа
    stages/carcass.ts        три схемы стыка, внутренний объём
    stages/layout.ts         ячейки, перегородки, row/column/sectionId (объединяет layout+dividers)
  hardware/                  Project + Geometry → HardwareBOM, чистые функции
    types.ts                 HardwareItem (производная позиция), HardwareRule, HardwareBOM
    registry.ts              встроенные определения (не сохраняются в файл проекта)
    rules/                   одно правило — один файл: петли, направляющие, держатели, крепёж, ручки
    engine.ts                calculateHardware: правила → проверки → агрегация
    debug.ts                 технический вывод спецификации
  production/                Parts → ProductionPart[] → CuttingLayout[], чистые функции
    types.ts                 ProductionPart, CuttingStock, CuttingLayout, CuttingPlacement
    parts.ts                 классификация ролей, Part → ProductionPart, поворот
    grouping.ts              группы «материал + толщина»
    stock.ts                 лист из Material.sheet, рабочая область после trim
    layout.ts                гильотинная раскладка best-fit decreasing
    engine.ts                calculateCutting: детали → группы → листы → раскладка
  drilling/                  Geometry + Parts + Hardware → DrillingPlan, чистые функции
    types.ts                 DrillingOperation, DrillingPlan, DrillingParameters
    faces.ts                 локальная система детали, грани, переход в мировые
    rules/                   петли, направляющие, полкодержатели, крепёж, ручки, push
    validate.ts              границы, глубина, пересечения, технологические отступы
    engine.ts                calculateDrilling: правила → проверки → порядок
  bom/                       агрегат всех расчётов → ProductionBOM, чистые функции
    types.ts                 PartBOMItem, ProductionBOM, ProductionCalculationResult
    parts.ts                 деталировка, разделы, метраж кромки
    summaries.ts             сводки присадки и раскроя
    confirmations.ts         централизованный список неподтверждённых правил
    engine.ts                calculateProduction: единый конвейер расчёта
  export/                    ProductionCalculationResult → PDF/XLSX, чистые функции
    types.ts                 ProductionExportData: плоские строки документов
    data.ts                  адаптер расчёта в данные документа
    format.ts                единицы и округление, общие для обоих форматов
    pdf.ts                   производственный PDF (pdf-lib + встроенный шрифт)
    xlsx.ts                  книга Office Open XML без внешних библиотек
    zip.ts                   минимальный ZIP-контейнер и CRC32
  workflow/                  готовность к производству и пакет заказа
    types.ts                 ProductionStatus, ProductionCheck, ProductionPackage
    readiness.ts             validateProductionReadiness: восемь разделов проверок
    fingerprint.ts           отпечаток производственного входа
    package.ts               buildProductionPackage, isPackageCurrent
  validation/                правила → Issue[]
    rules/{values,references,structure}.ts
  persistence/               схема Zod, сериализация, миграции, репозитории
  state/                     команды, история на патчах, сторы документа и сессии
  motion/                    пружины, проекция момента, reduced motion
  interaction/               контроллер жестов, скорость, привязка, клавиатура
  design-system/             токены, Button, Field
  render/                    Domain Geometry → Render Model → SVG (только технический debug-вид)
    debug-view.ts            buildDebugView: GeometryResult → прямоугольники + размерные линии
    DebugSchema.tsx           отрисовка, инверсия оси Y, showDebugInfo
  app/                       оболочка приложения
    editor/                  редактор: холст, инспектор, тулбар, строка состояния
                             (чистые правила — selection.ts, resize.ts — без React)
tests/
  unit/{domain,geometry,validation,persistence,state,interaction,motion,architecture,render}/
  e2e/
scripts/                     проверки реестра предположений и самостоятельности
```

Появится на следующих этапах: `geometry/stages/{edges}`. Этап `drilling` конвейера геометрии остаётся не реализованным намеренно: присадка выводится из фурнитуры, а фурнитура геометрии не видна — расчёт живёт в `src/drilling/` (PROMPT 18)
(`fill` и `facades` уже реализованы — PROMPT 6/9 и PROMPT 10 соответственно),
`parts/` (спецификация и группировка), `export/`, `planner/`. Интерактивная
(не debug) отрисовка схемы — расширение уже существующего `render/`, а не
новый слой.

---

## 5. ГЕОМЕТРИЧЕСКИЙ ДВИЖОК

### 5.1 Контракт

Актуальный контракт (`src/geometry/types.ts`), реализован полностью:

```ts
export interface GeometryInput {
  readonly furniture: Furniture;
  readonly scheme: ConstructionScheme;
  readonly tolerances: Tolerances;
  readonly materials: MaterialLibrary;
  readonly edgeSizing: EdgeSizingPolicy;
}

export interface GeometryResult {
  readonly parts: readonly Part[];
  readonly cells: readonly CellBox[];
  /** Заявленный габарит W×H×D. Вырожден при фатальной ошибке — см. §5.4. */
  readonly bounds: Box3;
  readonly innerVolume: Box3;
  /** Измеренный охват реально построенных деталей — см. §5.6. */
  readonly boundingBox: BoundingBox;
  /** Что не удалось построить и почему. */
  readonly diagnostics: readonly Issue[];
  readonly pendingStages: readonly string[];
}

export function buildGeometry(input: GeometryInput): GeometryResult;
```

Свойства функции: **чистая, детерминированная, без побочных эффектов, без Date,
без random, без обращения к DOM.** Одинаковый вход → побайтово одинаковый выход.
Это делает её тестируемой снапшотами (`tests/unit/geometry/snapshot.test.ts`)
и property-тестами (`properties.test.ts`), и пригодной для запуска в Web Worker
без изменений.

### 5.2 Порядок вычисления

```
1. normalize      — пригодность входа: финитность, положительность,        РЕАЛИЗОВАНО
                     совместимость с толщиной каркаса, мягкий диапазон
2. carcass        — боковины, верх, низ по ConstructionScheme,             РЕАЛИЗОВАНО
                     задняя стенка, внутренний объём
3. layout         — рекурсивный обход дерева секций → CellBox[]            РЕАЛИЗОВАНО
                     + детали перегородок и полок-разделителей             (объединил
                     (исходные этапы 3 и 4 плана — обоснование в §5.7)     layout+dividers)
4. fill           — наполнение ячеек: Content → Parts                      ПОЛКИ, ФАСАДЫ
                     через resolveContentGeometry (§5.10);                 ЯЩИКОВ И ИХ
                     фасады ящиков — resolveDrawerFacadeGeometry           ОТКРЫВАНИЕ
                     (PROMPT 11); их способ открывания —                   РЕАЛИЗОВАНЫ
                     resolveOpeningSystemGeometry (PROMPT 12);             (PROMPT 6, 11, 12);
                     короб ящика и штанга дают статус                      короб: этап 21,
                     not-implemented                                       штанга: этап 23
5. back           — деталь задней стенки как отдельный Part,               РЕАЛИЗОВАНО
                     цельная либо сегмент на секцию                        (PROMPT 14)
                     (docs/GEOMETRY_RULES.md §22)
6. base           — цоколь: царги по явно заданному составу,               ЦОКОЛЬ
                     высота смещает корпус (resolveBasePlacement);          РЕАЛИЗОВАН
                     ножки деталей не дают — это фурнитура                 (PROMPT 14);
                     (docs/GEOMETRY_RULES.md §23)                          ножки: этап 24
7. countertop     — столешница со свесами и фальшпанели:                  РЕАЛИЗОВАНО
                     конструктивные модификаторы поверх уже                (PROMPT 15)
                     посчитанного корпуса
                     (docs/GEOMETRY_RULES.md §26,
                      docs/STRUCTURAL_MODIFIERS.md)
8. facades        — Cell → FacadeGroup → resolveDoorGeometry → Part,       БАЗОВЫЙ СЛУЧАЙ
                     Facade → OpeningSystem →                             РЕАЛИЗОВАН
                     resolveOpeningSystemGeometry → Part                  (PROMPT 10, 12);
                     (docs/GEOMETRY_RULES.md §18, §20)                    остальное —
                     распашная дверь, 1–2 створки, 1 ячейка на фасад;      этап 22
                     купе/складные/подъёмные и покрытие нескольких        (продолжение)
                     ячеек — статус not-implemented
9. edges          — назначение кромки по ролям и сторонам                 план: этап 15
10. drilling      — присадка                                              план: этап 28
```

Список воспроизведён в коде целиком, включая нереализованные этапы
(`PIPELINE` в `src/geometry/engine.ts`) — так неполный результат нельзя
принять за полный: пропущенные этапы попадают в `GeometryResult.pendingStages`.

**Конструктивная конфигурация — вход этапов, а не отдельный объект**
(PROMPT 14). Отдельного `StructuralConfiguration` не заведено: им уже
является `CarcassSpec`, который держит `back`, `base` и `countertop`
вместе с PROMPT 1. Задняя стенка и цоколь влияют на корпус ДО того, как
появятся их собственные детали:

```
Carcass (CarcassSpec)
 ├── back: BackPanelSpec ── resolveBackGeometry ──┐  carcassZ0 / carcassDepth / innerZ0
 └── base: BaseSpec ─────── resolveBasePlacement ─┤  carcassY0 / carcassHeight
                                                  ▼
                                    stages/carcass.ts → ctx.innerVolume
                                                  ▼
                              layout → Cell → fill (Shelf/Drawer) → facades (Door)
                                                  ▼
                              stages/back.ts  → Part role 'back'   (сегмент = id секции)
                              stages/base.ts  → Part role 'plinth' (царги цоколя)
```

Обе функции размещения — единственные источники своего сдвига: этапы
`back` и `base` их ПЕРЕЧИТЫВАЮТ, а не считают заново, поэтому деталь
задней стенки не может разойтись с глубиной корпуса, а царги цоколя — с
его высотой.

На PROMPT 15 вертикальная функция выросла до полного бюджета высоты
(`resolveVerticalLayout`), а конструктивные модификаторы встали в ту же
схему — без второго верхнеуровневого объекта: их держит всё тот же
`CarcassSpec` (`docs/DATA_MODEL.md` §8.1, `docs/STRUCTURAL_MODIFIERS.md`):

```
CarcassSpec ─┬─ back ────────► stages/back      → Part 'back'
             ├─ base ────────► stages/base      → Parts 'plinth'
             ├─ overhang ────► stages/carcass   (расширяет 'top'/'bottom')
             ├─ topSection ──► stages/carcass   (вторая оболочка: buildShell)
             ├─ ceilingGap ──► resolveVerticalLayout (полоса без деталей)
             ├─ countertop ──► stages/modifiers → Part 'countertop'
             ├─ wallMount ───► GeometryResult.structure (состояние без деталей)
             └─ falsePanels ► stages/modifiers → Parts 'filler'
```

Основной корпус и антресоль строит ОДНА функция `buildShell`: формулы
каркаса существуют в единственном экземпляре, а не копией на каждую
оболочку.

**Материал — вход этапов, а не отдельный этап** (PROMPT 13). Библиотека
материалов приходит в движок вместе с изделием (`GeometryInput.materials`),
и любой этап, который создаёт физическую деталь, проходит один и тот же
конвейер:

```
MaterialRegistry (MaterialLibrary)
        │  materials.assignment[role] — материал роли
        │  Shelf/DividerSpec/FacadeLeaf/DrawerFacadeSpec.materialId — материал детали
        ▼
resolveEffectiveMaterial(materials, role, explicit*, corpusThickness)   src/geometry/parts.ts
        │  materialId  — всегда существующий в библиотеке
        │  thickness   — override ?? material.thickness ?? panelThickness
        │  edge        — EdgeSpec детали ?? DEFAULT_EDGE
        │  флаги       — roleNotAssigned / dangling* / structuralGlassOrMirror
        ▼
makePart(... materialId, size(thickness), edge ...)                     src/geometry/parts.ts
        ▼
Part (materialId, size, cut, edge, quantityGroupKey)
```

Ни один этап не читает `Material.thickness` сам и не хранит «свою»
толщину: `layout` (перегородки), `fill` (полки, фасады ящиков) и
`facades` (дверные створки) получают уже вычисленное число. Резолверы
`resolveDoorGeometry`/`resolveDrawerFacadeGeometry` остаются чистыми и
`MaterialLibrary` не импортируют — толщина приходит в них callback'ом
`thicknessOf(leaf|drawer)`, который этап-вызыватель строит из
`resolveEffectiveMaterial`. Правила — `docs/GEOMETRY_RULES.md` §21.

Каждый реализованный шаг — отдельный модуль (`src/geometry/stages/`)
с собственными unit-тестами. Цикл, запускающий этапы, останавливается,
как только предыдущий этап сообщил об ошибке — см. §5.4.

### 5.3 Каркас

`W`, `H`, `D`, `T` из `Dimensions`; `Tb` — толщина задней стенки.

**Глубина корпусных деталей** (разрешение `depthIncludesBackPanel`):

```
Dcarcass = tolerances.depthIncludesBackPanel && back.mount.kind === 'overlay'
         ? D − Tb
         : D
```

**Схема `sides-through`** (значение по умолчанию, `ASSUMPTION`, T-CAR-01):

```
side.L  size = (T, H, Dcarcass)          position = (0,        0,     0)
side.R  size = (T, H, Dcarcass)          position = (W − T,    0,     0)
top     size = (W − 2T, T, Dcarcass)     position = (T,        H − T, 0)
bottom  size = (W − 2T, T, Dcarcass)     position = (T,        0,     0)
```

**Схема `horizontals-through`:**

```
top     size = (W, T, Dcarcass)          position = (0, H − T, 0)
bottom  size = (W, T, Dcarcass)          position = (0, 0,     0)
side.L  size = (T, H − 2T, Dcarcass)     position = (0,     T, 0)
side.R  size = (T, H − 2T, Dcarcass)     position = (W − T, T, 0)
```

**Схема `mixed`** — комбинация по флагам `topOverlaysSides` / `bottomOverlaysSides`.

**Внутренний объём:**

```
inner.x0 = T                       inner.x1 = W − T
inner.y0 = hasBottom ? T : 0       inner.y1 = hasTop ? H − T : H
inner.z0 = carcassZ0 + max(0, innerZ0_back − carcassZ0)   // innerZ0_back — из монтажа стенки
inner.z1 = carcassZ0 + Dcarcass                             // фронт корпуса
```
Для накладной стенки `carcassZ0 = innerZ0_back = Tb`, значит `inner.z0 = Tb`:
внутренний объём начинается сразу за панелью — там же, где корпус.
(для `horizontals-through` границы по `y` и `x` меняются местами по той же логике)

> Исправлено при реализации: черновик этого документа сначала предполагал
> `inner.z0 = 0` для накладной задней стенки — то есть что внутренний объём
> начинается от абсолютного нуля координат, до самой панели. В реализации
> и тестах подтвердилось, что панель физически занимает `z ∈ [0, Tb]`,
> и внутренний объём (место для полок) не может начинаться раньше её
> передней грани. Полный вывод с рабочим примером — `docs/GEOMETRY_RULES.md` §5.

**Реализовано полностью** (`src/geometry/stages/carcass.ts`), включая
аварийную остановку и защитные проверки на каждом шаге. Формулы, единицы,
ограничения и трассируемость к спецификации — `docs/GEOMETRY_RULES.md`
§§1–8; здесь — только сводка для навигации по коду.

### 5.4 Аварийная остановка

Как только конвейер накапливает диагностику с `severity: 'error'`,
последующие этапы не запускаются: `GeometryContext.hasFatalError()`
проверяется в `buildGeometry()` перед каждым этапом. Недопустимый вход даёт
`parts: []`, а не геометрию, посчитанную поверх непригодных чисел — до этого
исправления отрицательная ширина всё ещё производила детали с отрицательной
координатой рядом с диагностикой об ошибке. Полное обоснование и
регрессионный тест — `docs/GEOMETRY_RULES.md` §2.

### 5.5 Инварианты результата

`GeometryContext.finish()` проверяет каждую деталь независимо от того, какой
этап её произвёл: финитность (уже в `addPart`), уникальность идентификатора,
положительность размера, неотрицательность координаты. Деталь, нарушившая
инвариант, исключается из `parts` с диагностикой, а не остаётся в результате
молча. Это распространяется на все будущие этапы (наполнение, фасады,
фурнитура) без необходимости дублировать проверки в каждом из них.
Полный список и обоснование — `docs/GEOMETRY_RULES.md` §7.

### 5.6 Bounding box

`computeBoundingBox(parts)` (`src/geometry/bounding-box.ts`) — измеренный
охват реально построенных деталей, в отличие от `bounds` (заявленный
номинальный габарит). Для одного каркаса без выступающих элементов они
совпадают за вычетом толщины задней стенки; разойдутся, когда появится
столешница со свесом. Нужен рендереру (этап 07) и планировщику (этап 33).
Формула и пример — `docs/GEOMETRY_RULES.md` §6.

### 5.7 Раскладка дерева секций (`layout`) — реализовано

Рекурсия `walk(node, box, row, column, sectionId)` в
`src/geometry/stages/layout.ts` строит ячейки (`CellBox[]`) и детали
перегородок (`Part[]`) из дерева `SplitNode`/`LeafNode` за один проход,
используя уже существующий и трижды проверенный `resolveSizes()`
(`src/domain/furniture/layout.ts`, PROMPT 2). Полные формулы, единицы,
ограничения, обоснование объединения `layout`+`dividers` в один этап
конвейера и локальная (внутри одного дерева) версия аварийной остановки —
`docs/GEOMETRY_RULES.md` §9. Здесь — только место в общей картине: этот
этап следует сразу за `carcass` и потребляет его `innerVolume` как
стартовый объём раскладки.

**Наполнение (`fill`) — полки (PROMPT 6), фасады ящиков (PROMPT 11) и их
способ открывания (PROMPT 12) реализованы, короб ящика и штанга нет.**
Формулы полки — в `docs/GEOMETRY_RULES.md` §14, фасада ящика — §19.3,
фасада двери — §18.3, ручки/push-to-open — §20.4, в том же формате, что и
раскладка секций. Черновик ниже («Ящик», «Фасад»)
остаётся историческим — он писался ДО реализации и с ней местами
расходится (например, «расширение до внешних граней корпуса при overlay»
не реализовано — эта часть T-DOOR-02/T-DRW-04 осталась `NEEDS_CONFIRMATION`
как `T-DOOR-06`, `docs/UNKNOWNS.json`, обе формулы фасада отсчитываются от
`cell.box`). Актуальны реализованные формулы — только в
`docs/GEOMETRY_RULES.md`; здесь ниже — план на короб ящика (этап 21) и
штангу (этап 23), для которых реализации ещё нет.

> Исправлено при реализации: черновик формулы равномерного размещения
> полки в этом документе давал
> `y = cell.y0 + (cell.h − count·T)·index/(count+1) + T·index`, то есть
> первая полка вставала впритык к низу ячейки — не хватало одного
> слагаемого `gap`, промежутка под нижней полкой. Реализация не повторяет
> эту формулу вручную, а переиспользует `resolveSizes` (тот же вызов, что
> и для структурных рядов), где промежуток снизу равен промежутку сверху
> по построению. Полный разбор — `docs/GEOMETRY_RULES.md` §14.7.

**Ящик:**

```
opening.w = cell.x1 − cell.x0
box.width  = opening.w − 2 · slide.sideClearance        // ASSUMPTION 13, T-DRW-02
box.length = maxNominalLength ≤ (cell.z1 − cell.z0) − rearClearance
side.height = box.sideHeight
front/back деталь короба = box.width − 2·T   (при схеме «царги между стенками»)
дно: mount 'groove'      → (box.width − 2T + 2·grooveDepth) × (box.length − 2T + 2·grooveDepth)
     mount 'nailed-under'→ box.width × box.length
```

**Фасад, режим `overlay`, n створок на проём шириной `Wf`:**

```
leafWidth_i = (Wf − gapSide·2 − gapBetweenLeaves·(n−1)) · share_i
leafHeight  = Hf − gapTop − gapBottom
```
`Wf`, `Hf` для `covers.kind === 'carcass'` равны `W`, `H`; для узла — габарит его `CellBox`,
расширенный до внешних граней корпуса при `overlay`.
Все зазоры — `ASSUMPTION`, тест T-DOOR-02.

**Режим `inset`:** `Wf`, `Hf` берутся по внутреннему проёму, зазор вычитается со всех сторон.

### 5.8 Правило `UNKNOWN` в коде

Любая формула, не подтверждённая тестом, обязана нести маркер:

```ts
// ASSUMPTION(T-SHF-01): полка встаёт впритык к стенкам проёма, без зазора.
// Проверить: проём 568 → ширина детали 568 (впритык) или 567 (зазор 0.5+0.5).
const shelfWidth = roundMm(cell.x1 - cell.x0);
```

CI-проверка (этап 01): скрипт `scripts/check-assumptions.ts` собирает все
`ASSUMPTION(...)` из исходников и сверяет с реестром `docs/UNKNOWNS.json`.
Маркер без записи в реестре — ошибка сборки. Это не даёт неизвестному
тихо превратиться в «факт».

### 5.9 Производительность

- Полный пересчёт типового шкафа (≈ 60–120 деталей) — цель **< 5 мс**.
- Пересчёт синхронный, в основном потоке, на каждое изменение домена.
- Мемоизация по неизменяемой ссылке на `Furniture` (Immer даёт структурное
  разделение — неизменённые поддеревья сохраняют ссылку).
- Во время drag полный пересчёт **не выполняется**: см. §7.
- Web Worker вводится только если профилирование покажет превышение бюджета;
  чистота функции делает перенос механическим.

---

### 5.10 Cell → Content → Resolver → Parts (PROMPT 9)

Три сущности, которые нельзя смешивать: `Part` — физическая деталь,
`Cell` — пространственная область, `Content` — логическое наполнение
ячейки. Полная цепочка расчёта:

```
Project → Carcass → Sections → Cells → Contents → Geometry Engine → Parts
```

Наполнение — это `LeafNode.fill` (`LeafFill`), существующее с PROMPT 1
размеченное объединение. Второго типа `Content` с полем `cellId` рядом
не заводится: наполнение лежит ВНУТРИ ячейки, поэтому «ссылка не
испортится», «наполнение не осиротеет», «не переедет в другую ячейку»
и «не разойдётся с ячейкой в размерах» — свойства по построению, а не
правила, которые нужно соблюдать.

`resolveContentGeometry(fill, cellId)` (`src/geometry/content.ts`) —
чистая функция без DOM, React и часов: отвечает, что означает наполнение,
и возвращает статус `empty` / `built` / `not-implemented`. Геометрию по
этому ответу строит `stages/fill.ts`. Полные правила, точка расширения
для новых видов и таблица «что не реализовано» —
`docs/GEOMETRY_RULES.md` §17.

---

## 6. СОСТОЯНИЕ ПРИЛОЖЕНИЯ

### 6.1 Три независимых уровня

| Уровень | Что хранит | Undo | Сохраняется |
| --- | --- | --- | --- |
| **Document** | `Project` — вся мебель | да | да |
| **Session** | выделение, зум, панорама, активная панель, вкладка, единицы отображения | нет | частично (превью-настройки) |
| **Interaction** | текущий drag: смещение, скорость, кандидат-значение | нет | нет |

Смешение этих уровней — главная причина «тормозящих» конструкторов:
изменение зума попадает в историю, а drag дёргает весь домен на каждый кадр.
Разделение вводится с первого дня.

### 6.2 Сторы

```ts
useDocumentStore   // Project + история; мутации только через команды
useSessionStore    // выделение, вид, UI
// interaction state — НЕ стор: useRef внутри контроллера жеста
```

### 6.3 Undo/redo

```ts
const [next, patches, inverse] = produceWithPatches(current, recipe);
history.past.push(inverse);
history.future.length = 0;
```

- Глубина 200.
- **Коалесценция:** непрерывный ввод в поле или один drag дают **один** шаг истории.
  Признак — `transactionId`, открываемый на `pointerdown` / `focus` и закрываемый
  на `pointerup` / `blur` / таймаут 600 мс бездействия ввода.
- Undo восстанавливает не только документ, но и **выделение на момент действия** —
  иначе пользователь теряет контекст (принцип Agency).

### 6.4 Команды

UI никогда не мутирует документ напрямую. Только именованные команды:

```ts
type Command =
  | { type: 'SetDimension'; axis: 'W'|'H'|'D'; value: Mm }
  | { type: 'SplitNode'; nodeId: NodeId; axis: 'x'|'y'; count: number }
  | { type: 'MoveDivider'; nodeId: NodeId; index: number; value: Mm }
  | { type: 'SetChildSizeMode'; nodeId: NodeId; index: number; mode: 'fixed'|'flex' }
  | { type: 'SetFill'; nodeId: NodeId; fill: LeafFill }
  | { type: 'AddFacade'; nodeId: NodeId; spec: FacadeGroup }
  | { type: 'SetMaterial'; role: PartRole; materialId: MaterialId }
  | ... ;
```

Выгоды: единая точка истории, тривиальная телеметрия (локальная, не сетевая),
воспроизводимость багов через лог команд, будущая коллаборация — без переписывания.

---

## 7. РАЗДЕЛЕНИЕ INTERACTION STATE И DOMAIN STATE

Требование задания §10 и principle Response. Реализация:

```
pointerdown → открыть транзакцию, снять базовое состояние
pointermove → обновить ТОЛЬКО transform SVG-элемента (rAF) + число в поле
              домен НЕ трогается, геометрия НЕ пересчитывается
pointerup   → одна команда с итоговым значением → пересчёт → закрыть транзакцию
```

Во время drag пользователь видит «черновой» слой: перетаскиваемый элемент и
размерная линия обновляются напрямую через `style.transform`, минуя React.
Домен получает одно изменение в конце.

**Исключение — где нужен «живой» домен.** Для перетаскивания полки достаточно
чернового слоя. Для изменения габарита корпуса пользователь должен видеть, как
перестраивается всё изделие. Здесь применяется **throttled preview**: пересчёт
геометрии не чаще одного раза на кадр (`rAF`), в отдельной ветке
`previewFurniture`, которая **не попадает в историю**. Домен обновляется один раз
на `pointerup`. Так сохраняется и непрерывная обратная связь, и чистая история.

Бюджет: если пересчёт превысит 8 мс, preview деградирует до контурного режима
(только габаритная рамка и затронутые детали) — но никогда до отсутствия отклика.

---

## 8. ХРАНЕНИЕ

### 8.1 Выбор

| Вариант | Вердикт |
| --- | --- |
| `localStorage` | **Только для настроек UI.** Синхронный, блокирует поток, лимит ~5 МБ, только строки |
| `IndexedDB` | **Основное хранилище проектов.** Асинхронный, десятки МБ+, транзакции, хранит `Blob` для превью |
| JSON-файл | **Обмен и резервная копия.** Пользователь владеет своими данными физически |

### 8.2 Схема БД

```
db: 'furniture-builder', version 1
├── projects       keyPath 'id',  index 'updatedAt'
├── revisions      keyPath ['projectId','seq']   — кольцевой буфер, 20 снимков
└── settings       keyPath 'key'
```

`revisions` — защита от потери работы: снимок раз в 60 с и при каждом крупном
структурном изменении. Пользователь может откатиться к снимку, даже закрыв вкладку.

### 8.3 Сохранение (реализовано на PROMPT 22)

Автосохранения **нет**, и план дебаунса 800 мс, описанный здесь до
PROMPT 22, отклонён при подключении хранилища к интерфейсу: молчаливая
запись поверх сохранённого — это потеря работы, если пользователь
экспериментировал. Сохранение сделано явным действием, а несохранённые
правки видны постоянно — тем же индикатором, ради которого автосохранение
и предлагалось.

- Состояния: `saved` / `unsaved` / `saving` / `error`
  (`src/app/use-project-storage.ts`).
- «Есть правки» определяется сравнением ссылки на проект: состояние
  иммутабельно, ссылка меняется ровно тогда, когда меняется модель.
- При открытии вкладки восстанавливается последний сохранённый проект
  (самый свежий по `updatedAt`).
- Индикатор состояния виден постоянно, в тулбаре и в строке состояния
  (принцип Responsibility: пользователь без аккаунта должен точно знать,
  что его работа не потеряна). Недоступное хранилище (приватный режим)
  названо прямо, а не замаскировано словом «сохранено».

### 8.4 Миграции

```ts
const migrations: Record<number, (doc: unknown) => unknown> = { 1: v1_to_v2, ... };
```
Чистые функции, каждая с тестом на реальном сохранённом файле-фикстуре.
Файл новее поддерживаемой версии — импорт отклоняется с внятным сообщением,
а не «частично применяется».

### 8.5 Формат обмена

`*.furniture.json` — plain JSON, `SCHEMA_VERSION`, без бинарей.
Импорт валидируется схемой (Zod) до попадания в стор. Некорректный файл
не должен приводить приложение в сломанное состояние.

**Приватность:** данные не покидают браузер. Экспорт — это `Blob` + `URL.createObjectURL`,
никаких загрузок на сервер, потому что сервера нет.

---

## 9. ЭКСПОРТ

Все генераторы работают локально, вход — `Part[]` и `Furniture`, а не UI.

| Формат | Назначение | Источник | Реализация | Сложность |
| --- | --- | --- | --- | --- |
| **JSON** | проект, обмен, резерв | `Project` | нативно | тривиально |
| **CSV** | деталировка в любую программу | `ProductionBOM.parts` | своя сериализация, разделитель `;`, BOM для кириллицы в Excel | низкая |
| **XLSX** | деталировка + фурнитура + кромка, листами | `ProductionBOM` (PROMPT 19) | `exceljs` | средняя |
| **PDF — чертёж** | схема с размерами | `Part[]` + SVG-слой | `pdf-lib` + встроенный шрифт | средняя |
| **PDF — деталировка** | таблица деталей | `Part[]` | `pdf-lib` | средняя |
| **PDF — карта раскроя** | раскладка на листах | результат nesting | `pdf-lib` | высокая |
| **PDF — присадка** | схема сверловки по деталям | `DrillHole[]` | `pdf-lib` | высокая |
| **SVG** | векторный чертёж | слой отрисовки | сериализация DOM | низкая |
| **PNG** | быстрый обмен видом | SVG → canvas | нативно | низкая |
| **3D (GLTF)** | просмотр в стороннем ПО | `Part[]` | генерация боксов | средняя, P3 |
| Формат стороннего САПР | — | — | **вне области**: проприетарный бинарный формат, публичной спецификации нет | — |

### 9.1 Карта раскроя

Собственная реализация, без сервисов:

1. Группировка деталей по `materialId` и толщине.
2. Гильотинный раскрой (соответствует реальному форматно-раскроечному станку),
   алгоритм — best-fit decreasing по площади с деревом свободных прямоугольников.
3. Учёт ширины пропила (по умолчанию 4 мм, настраивается) и обрезной кромки листа.
4. `grainLocked` запрещает поворот детали на 90°.
5. Метрика — процент полезного использования листа, показывается пользователю.

Оптимальность не гарантируется (задача NP-трудная) и **это честно указывается в UI**:
«раскрой близкий к оптимальному», а не «оптимальный».

### 9.2 Кириллица в PDF

Стандартные шрифты PDF не содержат кириллицы. Решение: свободный шрифт
(например, Noto Sans / Inter с кириллическим набором) **в составе репозитория**,
подключается через `fontkit`, subset по используемым глифам.
Никаких Google Fonts в рантайме — это нарушило бы требование «без внешних сервисов».
Покрывается E2E-тестом: экспорт проекта с русскими названиями → в PDF извлекается
корректный текст.

---

## 10. РЕНДЕРИНГ

### 10.1 Технический debug-рендерер (реализовано, PROMPT 4)

```
render/
  debug-view.ts       Domain Geometry → Render Model (чистая функция, без React)
  DebugSchema.tsx      Render Model → SVG (React, единственная нетривиальная задача — инверсия Y)
```

Контракт слоя (`docs/GEOMETRY_RULES.md` §12 в терминах PROMPT 4 §20 —
«не заставляй renderer понимать мебельные формулы»):

```ts
buildDebugView(geometry: GeometryResult): DebugSchemaView   // мм, домен, Y вверх
```

`DebugSchemaView` — плоский список прямоугольников (`parts` и `cells`
проецируются на плоскость XY, ось Z отбрасывается — вид спереди) и
размерных линий, уже в миллиметрах; `DebugSchema.tsx` переводит их в SVG
`viewBox`, инвертируя Y один раз на каждый элемент (не через `<g
transform="scale(1,-1)">` — это отразило бы и подписи, потребовав
контр-трансформации на каждой). Ни одной формулы мебели в `render/` нет —
только проекция и форматирование уже посчитанных чисел.

**Не финальный интерфейс.** Существует для проверки Geometry Engine
(PROMPT 4 §17): показывает корпус, перегородки, ячейки, размеры,
координаты и id — без текстур, фасадов, ручек и декора. Полностью
исключён из production-сборки через `import.meta.env.DEV`
(Vite подставляет константу на этапе сборки, Rollup выбрасывает мёртвую
ветку целиком — проверено: строка «Схема (debug…» отсутствует в `dist/`).

**Границы слоя.** `render → domain, geometry, design-system` — не видит
`state`/`interaction`. Управление (кнопка «Применить сетку», переключатель
подписей) живёт в `app/App.tsx`, который читает стор и передаёт `render/`
только данные и колбэки — стандартное разделение presentational/container.


> **Исправлено на PROMPT 7.** Условие `import.meta.env.DEV` стояло только
> вокруг компонента `<DebugSchema/>`, но не вокруг `buildDebugView()` —
> поэтому сборка view-модели попадала в production-бандл и выполнялась на
> каждый пересчёт геометрии, а результат никто не отрисовывал. Обнаружено
> по строке «SECTION » в собранном файле: прежняя проверка искала имена
> (`DebugSchema`, `debug-view`), которые минификация стирает, и потому
> давала ложное «в production ничего нет». Теперь под условием весь
> debug-слой целиком; проверка в отчётах ищет литералы, переживающие
> минификацию (`dim-total-width`, `cellRect`, «нет геометрии»).

### 10.2 Холст редактора (PROMPT 22) и дальнейший план

Реализовано на PROMPT 22: `src/app/editor/EditorCanvas.tsx` — тот же
`DebugSchemaView`, что и у технической схемы, но интерактивный: выбор
объекта указателем и с клавиатуры, ручки изменения габарита на
`DragController`, предпросмотр без изменения домена. Второго построителя
вида не заведено — `buildDebugView` осталась единственной.

Порядок прямоугольников с PROMPT 22 задаёт `byPaintOrder`: в SVG нет
`z-index`, и деталь, нарисованная позже, перехватывает указатель. Пока
задняя стенка рисовалась последней, она накрывала фронтальный вид
целиком и делала выбор боковины невозможным. Подробнее —
`docs/EDITOR_SELECTION.md` §6.

Дальнейший план:

```
render/
  scene/      сцена, viewport, зум/панорама
  views/      front (фасад) | section (разрез) | plan (план) | iso3d
  overlays/   размерные линии, выделение, подсветка проблем, ручки drag
  hit/        карта попаданий: ячейка / деталь / разделитель / ручка
```

Расширение уже существующего `render/`, не новый слой: `debug-view.ts`
и его тесты (`tests/unit/render/debug-view.test.ts`) — рабочий образец
того, как Render Model отделяется от Domain Geometry; `DebugSchema.tsx` —
образец того, как выглядит презентационный компонент без доступа к state.

- Одна и та же `GeometryResult.parts` питает и схему, и чертёж, и PDF — **одна
  модель, одна геометрия** (требование §15 задания PROMPT 1: UI и canvas
  представляют одну модель). Debug-рендерер уже следует этому принципу.
- Viewport-трансформация — единственная матрица `{ scale, tx, ty }`, применяемая
  к корневому `<g transform>`. Зум и панорама не вызывают перерисовку React-дерева.
- Размерные линии — не украшение, а интерактивный элемент: значение редактируется
  прямо на схеме (см. `INTERACTION_MODEL.md` §6). В debug-версии размерные
  линии пока только читают геометрию, без прямого редактирования.

---

## 11. ТЕСТИРОВАНИЕ

| Уровень | Инструмент | Что покрывает |
| --- | --- | --- |
| Unit | Vitest | формулы геометрии, раскладка дерева, правила фурнитуры, кромка |
| Property-based | fast-check | инварианты: сумма ячеек + разделители = внутренний размер; детали не пересекаются; все размеры > 0 при любом валидном входе |
| Snapshot | Vitest | эталонные деталировки для набора реперных изделий |
| Integration | Vitest + fake-indexeddb | сохранение → перезагрузка → идентичный документ |
| E2E | Playwright | сценарии `UX_FLOW.md`, экспорт файлов, доступность |
| Визуальный | Playwright screenshots | схема не «поехала» после рефакторинга |
| Производительность | Playwright trace | drag держит 60 fps; пересчёт < 5 мс |

**Property-тесты — ключевой инструмент для геометрии.** Пример инварианта:
для любого дерева и любых допустимых габаритов сумма ширин ячеек одного уровня
плюс толщины перегородок точно равна внутренней ширине (с точностью `MM_EPSILON`).
Такой тест ловит ошибки формул, которые снапшот пропустит.

**Подтверждено дважды на PROMPT 3.** Сначала на PROMPT 2 такой тест нашёл
ненормализованный вход в `resolveSizes`. Затем на PROMPT 3 — тот же класс
дефекта в `carcass.ts`: толщина материала, не лежащая на сетке 0.1 мм,
округлялась независимо в позиции и в размере детали и могла увести правую
боковину на 0.1 мм за пределы заявленной ширины. На PROMPT 4 property-тест
искал похожий дефект в новом `layout.ts` — не нашёл: раскладка сразу
переиспользовала уже нормализованные значения через `resolveSizes`. Все
случаи и то, что новый код прошёл проверку сразу, — подробности в
`docs/TESTING_STRATEGY.md` §4 и `docs/GEOMETRY_RULES.md` §4.1.

Для геометрии сейчас реализовано: 4 снапшот-конфигурации каркаса (типовая,
минимальная, крупная, с утолщённым материалом) с явными проверками
ключевых размеров; 8 property-свойств (3 для каркаса — недопустимый вход,
допустимый вход, детерминизм; 3 для сетки — те же вопросы плюс сохранение
границ номинального габарита; 2 для домена — раскладка деления, круговой
путь сериализации); 24+28 явных граничных случаев и сценариев (каркас и
раскладка секций); круговой путь через сериализацию не меняет
`GeometryResult`, включая деревья с секциями и сеткой. 128 тестов в
`tests/unit/geometry/` (было 92 после PROMPT 3) — см.
`docs/TESTING_STRATEGY.md`.

---

## 12. РЕЕСТР UNKNOWN

Машиночитаемый реестр `docs/UNKNOWNS.json` создаётся на этапе 01 и содержит
все 59 позиций из `PRIVETMAKET_FUNCTIONAL_SPEC.md` §2 в формате:

```json
{
  "id": "T-CAR-01",
  "area": "carcass",
  "question": "Какая схема стыка каркаса используется",
  "status": "unknown",
  "defaultAssumption": "sides-through",
  "test": "W=1000 H=2000 D=500 T=16, сверить размеры боковины и верха в деталировке",
  "blocks": ["geometry/scheme", "export/parts-list"]
}
```

Реестр связан с CI-проверкой маркеров `ASSUMPTION(...)` (§5.8).
Реальный статус проекта всегда виден: сколько предположений ещё не подтверждено.

---

## 13. РИСКИ АРХИТЕКТУРЫ

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| Формулы окажутся неверными после проверки | Высокая | Среднее | Параметризация схем; изменение = одна константа, не алгоритм |
| Preview-пересчёт не уложится в кадр на слабом устройстве | Средняя | Высокое | Деградация до контурного режима; порог перехода на Worker зафиксирован |
| SVG-сцена станет тяжёлой на сложных изделиях | Средняя | Среднее | Порог 2000 узлов; гибридный Canvas-фон |
| Раскрой даст плохой процент использования | Средняя | Среднее | Честная формулировка в UI; несколько стратегий на выбор |
| Кириллица в PDF | Средняя | Высокое | Локальный шрифт + E2E-тест на этапе 26 |
| IndexedDB недоступен (приватный режим) | Низкая | Высокое | Обнаружение при старте, явное предупреждение, работа в памяти + принудительный экспорт в файл |
| Разрастание домена под давлением UI | Средняя | Высокое | Линтер границ + команды как единственный путь мутации |
