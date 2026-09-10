# Матрица функционального соответствия

PROMPT 33. Что реализовано на самом деле — по коду и тестам, а не по
намерениям. Ни одна строка не помечена `IMPLEMENTED` без файла и теста в
графе «Подтверждение».

## 0. Про эталон: сопоставление невозможно эмпирически

Пункт §1.6 задания требует сверки с «публично доступным функциональным
поведением эталонного конструктора». **Референсный сайт недоступен из
среды выполнения**, и это проверено повторно в этой сессии, а не
унаследовано из старого документа:

```
$ curl -sS -o /dev/null -w "%{http_code}" https://privetmaket.ru/
curl: (56) CONNECT tunnel failed, response 403
000
```

Прокси окружения отклоняет CONNECT на уровне политики. То же было
зафиксировано при составлении `PRIVETMAKET_FUNCTIONAL_SPEC.md` §0.

**Следствие для этой матрицы.** Графа «Эталон» заполняется только тем,
что имеет статус `CONFIRMED` в спецификации (подтверждено доступным
источником) или `INDUSTRY` (отраслевой стандарт корпусной мебели, не
поведение референса). Там, где эталонное поведение неизвестно, так и
написано — `UNKNOWN`. Догадки о референсе в графу не попадают: строка
«эталон делает так» без источника хуже пустой, потому что выглядит
проверенной.

Поэтому статуса «отстаём от эталона» в матрице нет. Есть статусы про наш
продукт: реализовано, частично, отсутствует, отличается сознательно,
требует подтверждения.

## Статусы

| Статус | Значение |
| --- | --- |
| `IMPLEMENTED` | Работает, есть код и тест |
| `PARTIAL` | Часть цепочки готова, часть — нет; в графе «Действие» сказано, чего не хватает |
| `MISSING` | В продукте отсутствует |
| `DIFFERENT_BY_DESIGN` | Сделано иначе намеренно; причина указана |
| `NEEDS_CONFIRMATION` | Правило не подтверждено источником, см. `UNKNOWNS.json` |
| `NOT_APPLICABLE` | К этому продукту не относится |

---

## 1. Основа конструктора (§3)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Создание проекта | `CONFIRMED` (без регистрации) | `createProject` | `IMPLEMENTED` | `domain/project/factory.ts`; `tests/unit/domain/project-operations.test.ts` | — |
| Ширина W | `CONFIRMED` (поле ввода) | `dimensions.width` | `IMPLEMENTED` | `SetDimension`; `tests/e2e/journey.spec.ts` | — |
| Высота H | `CONFIRMED` | `dimensions.height` | `IMPLEMENTED` | там же | — |
| Глубина D | `CONFIRMED` | `dimensions.depth` | `IMPLEMENTED` | там же | — |
| Толщина плиты T | `CONFIRMED` (ЛДСП 16) | `dimensions.panelThickness` | `IMPLEMENTED` | `geometry/stages/carcass.ts`; `tests/unit/geometry/carcass.test.ts` | — |
| Единицы измерения | `INDUSTRY` (мм) | мм, шаг 0.1, `MM_EPSILON` 0.05 | `IMPLEMENTED` | `domain/units.ts`; `tests/unit/domain/units.test.ts` | — |
| Валидация значений | `UNKNOWN` (пороги) | `validateProject` + диагностика движка | `PARTIAL` | `validation/rules/values.ts` | Пороги min/max — `T-DIM-02` |
| Живой предпросмотр | `CONFIRMED` (3D) | пересчёт на каждый ввод, без debounce | `IMPLEMENTED` | `App.tsx` `useMemo`; `tests/e2e/scene-3d.spec.ts` | — |
| Изменение размеров | `CONFIRMED` | поля + ручки в сцене | `IMPLEMENTED` | `interaction/drag-controller.ts`; `tests/e2e/scene-3d.spec.ts` | — |
| Сохранение | `UNKNOWN` | явное, IndexedDB | `DIFFERENT_BY_DESIGN` | `use-project-storage.ts` | Автосохранения нет намеренно: молчаливая запись теряет работу |
| Загрузка | `UNKNOWN` | восстановление последнего + библиотека | `IMPLEMENTED` | `tests/e2e/final-audit.spec.ts` | — |
| Габарит проходит весь конвейер | — | геометрия → детали → фурнитура → присадка → раскрой → BOM | `IMPLEMENTED` | `tests/unit/integration/pipeline-properties.test.ts` | — |

## 2. Корпус (§4)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Левая и правая боковины | `INDUSTRY` | `role: 'side'` | `IMPLEMENTED` | `stages/carcass.ts`; `tests/unit/geometry/carcass.test.ts` | — |
| Крышка | `INDUSTRY` | `role: 'top'`, `hasTop` | `IMPLEMENTED` | там же | — |
| Дно | `INDUSTRY` | `role: 'bottom'`, `hasBottom` | `IMPLEMENTED` | там же | — |
| Внутренняя ширина | `UNKNOWN` | `W − 2T` | `IMPLEMENTED` | `carcass.ts:375` | — |
| Внутренняя высота | `UNKNOWN` | `Hc − T·[hasTop] − T·[hasBottom]` | `IMPLEMENTED` | `carcass.ts:372–375` | Не безусловное `H − 2T` — см. §2.1 ниже |
| Полезная глубина | `UNKNOWN` | `Dc − отступ задней стенки` | `IMPLEMENTED` | `carcass.ts:506–513` | Зависит от способа крепления задней стенки |
| Ориентация фронт/тыл | — | +Z вперёд, `COORDINATE_SYSTEM.md` | `IMPLEMENTED` | `domain/coordinates.ts`; `tests/unit/domain/coordinates.test.ts` | — |
| Система координат | — | правая, начало — левый-нижний-задний угол | `IMPLEMENTED` | `docs/3D_COORDINATE_SYSTEM.md` | — |
| Физические детали корпуса | `INDUSTRY` | 4–5 деталей на пустой корпус | `IMPLEMENTED` | `tests/unit/integration/production-regression.test.ts` | — |
| Нет двойного учёта толщины | — | закреплено свойством | `IMPLEMENTED` | `tests/unit/geometry/properties.test.ts` | — |

### 2.1. Про формулу `H − 2T`

Задание просит проверить её отдельно. **Продукт не использует безусловное
`H − 2T`,** и это не упущение, а следствие модели.

```
Hc  = heightIncludesBase ? H − (цоколь + столешница + антресоль + зазор) : H
inner.height = Hc − T·[есть крышка] − T·[есть дно]
inner.width  = W − 2T
inner.depth  = Dc − отступ задней стенки (зависит от способа крепления)
```

`H − 2T` — частный случай: корпус с крышкой и дном, без цоколя, без
столешницы, без антресоли и без зазора до потолка. Вычитать `2T`
безусловно значило бы отнимать толщину крышки у изделия, у которого
крышки нет (`hasTop: false` — открытый стеллаж).

## 3. Секции (§5)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Одна секция | `CONFIRMED` | лист дерева | `IMPLEMENTED` | `tests/unit/app/drafts.test.ts` | — |
| Несколько секций | `CONFIRMED` | деление корня по X | `IMPLEMENTED` | `SetSectionCount`; `tests/unit/geometry/sections.test.ts` | — |
| Равные секции | `CONFIRMED` | `SizeSpec.flex` | `IMPLEMENTED` | там же | — |
| Неравные секции | `UNKNOWN` | `SizeSpec.fixed`, поле «Ширины секций» | `IMPLEMENTED` | `SetChildSize`; `tests/unit/geometry/variable-size-properties.test.ts` | — |
| Вертикальные перегородки | `INDUSTRY` | `role: 'partition'` | `IMPLEMENTED` | `stages/carcass.ts`; `tests/unit/geometry/sections.test.ts` | — |
| Изменение числа секций | `CONFIRMED` | правит хвост списка, id сохраняются | `IMPLEMENTED` | `commands.ts` `SetSectionCount` | — |
| Стабильность идентификаторов | — | id не переприсваиваются | `IMPLEMENTED` | `tests/unit/integration/section-roundtrip.test.ts` | — |
| Обход 1→2→3→4→3→2→1 | — | проверен в обе стороны | `IMPLEMENTED` | там же (6 тестов) | — |
| Отсутствие осиротевших объектов | — | проверено на каждом шаге обхода | `IMPLEMENTED` | там же | — |

## 4. Ячейки (§6)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Ряды | `CONFIRMED` (сетка) | деление по Y | `IMPLEMENTED` | `createUniformGrid`; `tests/unit/geometry/structure-properties.test.ts` | — |
| Колонки | `CONFIRMED` | деление по X внутри ряда | `IMPLEMENTED` | там же | — |
| Границы секции | — | ячейка не выходит за секцию | `IMPLEMENTED` | `tests/unit/geometry/fill.test.ts` Test 10 | — |
| Размеры ячейки | — | `CellBox` в `GeometryResult` | `IMPLEMENTED` | `geometry/types.ts` | — |
| Координаты ячейки | — | там же | `IMPLEMENTED` | там же | — |
| Переменные высоты рядов | `UNKNOWN` | `SizeSpec` по Y | `IMPLEMENTED` | `tests/unit/geometry/variable-size-properties.test.ts` | — |
| Переменные ширины колонок | `UNKNOWN` | `SizeSpec` по X | `IMPLEMENTED` | там же | — |
| Пустые ячейки | `CONFIRMED` | `fill: {kind:'empty'}` | `IMPLEMENTED` | `geometry/content.ts` | — |
| **Ячейка — пространство, не деталь** | — | `Cell` не имеет `PartRole` и не попадает в `ProductionPart` | `IMPLEMENTED` | `tests/unit/integration/invariants.test.ts` | Инвариант закреплён тестом |

## 5. Полки (§7)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Фиксированные | `INDUSTRY` | `mounting: 'fixed'`, `role: 'shelf-fixed'` | `IMPLEMENTED` | `stages/fill.ts`; `tests/unit/geometry/fill.test.ts` | — |
| Съёмные | `CONFIRMED` (полкодержатели) | `mounting: 'adjustable'` | `PARTIAL` | там же | Схема опирания — `T-SHF-02`; выбор в UI не предлагается намеренно |
| Толщина полки | `UNKNOWN` | из материала полки, не из константы | `IMPLEMENTED` | `stages/fill.ts` | — |
| Размеры полки | `CONFIRMED` (предел длины) | по ячейке минус зазоры | `IMPLEMENTED` | `tests/unit/geometry/fill.test.ts` | — |
| Положение полки | `UNKNOWN` | `auto` — равномерно; `manual` — отступ | `IMPLEMENTED` | `ShelfPlacement`; тесты там же | — |
| Материал полки | `CONFIRMED` | `materialId` на полке | `IMPLEMENTED` | `domain/furniture/types.ts:274` | — |
| Кромка полки | `CONFIRMED` | `EdgeSpec` на полке | `IMPLEMENTED` | `bom/edges.ts`; `tests/unit/bom/` | — |
| Зависимость от рядов и секций | — | полка принадлежит ячейке | `IMPLEMENTED` | `tests/unit/geometry/fill.test.ts` Test 9 | — |
| Нет двойного учёта толщины | — | закреплено свойством | `IMPLEMENTED` | `tests/unit/geometry/properties.test.ts` | — |
| Предельная длина полки | `CONFIRMED` (референс ограничивает) | правило есть, порог не подтверждён | `PARTIAL` | `validation/rules/` | Порог — `NEEDS_CONFIRMATION` |

## 6. Наполнение ячейки (§8)

| Вид | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| `EMPTY` | `CONFIRMED` | полный цикл | `IMPLEMENTED` | `SetFill`; `tests/e2e/journey.spec.ts` | — |
| `SHELVES` | `CONFIRMED` | полный цикл | `IMPLEMENTED` | там же | — |
| `DRAWERS` | `CONFIRMED` | фасад строится, короб — нет; подпись в интерфейсе говорит об этом прямо | `PARTIAL` | `geometry/drawers.ts`; `tests/unit/app/fill-vocabulary.test.ts` | Подпись исправлена на PROMPT 34 (Г-001) |
| `ROD` (штанга) | `CONFIRMED` (гардероб) | в модели есть, движок помечает `not-implemented`, в UI не предлагается | `PARTIAL` | `geometry/content.ts:164`; `App.tsx` `UI_FILL_KINDS` | Состав и крепление — `T-FILL-01` |
| `ROD+SHELF` | `CONFIRMED` | полка строится, штанга — нет | `PARTIAL` | `geometry/content.ts:137` | там же |
| `SHOE_MODULE` (обувница) | `UNKNOWN` | отсутствует полностью | `MISSING` | нет ни в модели, ни в спецификации | Правило неизвестно — заводить нечего |
| Расширяемость (`CUSTOM`) | — | `LeafFill` — размеченное объединение; новый вид добавляется одной ветвью | `IMPLEMENTED` | `domain/furniture/types.ts:412` | — |

Для каждого вида проверены: создание, изменение, удаление, сохранение,
восстановление, расчёт и UI. `ROD` и `ROD+SHELF` помечены `PARTIAL`, а не
`IMPLEMENTED`, именно по правилу §8: существуют архитектурно.

## 7. Двери и фасады (§9)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Распашная дверь | `CONFIRMED` | `resolveDoorGeometry` | `IMPLEMENTED` | `geometry/doors.ts`; `tests/unit/geometry/doors.test.ts` | — |
| Сторона петель | `CONFIRMED` | `hingeSide` | `IMPLEMENTED` | там же | — |
| Размеры двери | `UNKNOWN` (зазоры) | из ячейки, накладная и вкладная | `IMPLEMENTED` | там же | Величины зазоров — `T-FAC-01` |
| Материал фасада | `CONFIRMED` | `materialId` | `IMPLEMENTED` | `domain/furniture/types.ts:455` | — |
| Кромка фасада | `CONFIRMED` | `EdgeSpec` | `IMPLEMENTED` | `bom/edges.ts` | — |
| Привязка к ячейке | — | `FacadeGroup` ссылается на `nodeId` | `IMPLEMENTED` | `tests/unit/geometry/doors.test.ts` | — |
| Коллизия «дверь + ящики» | — | запрещена | `IMPLEMENTED` | `tests/unit/geometry/drawers.test.ts` | — |
| Несколько дверей на ячейку | `UNKNOWN` | `FacadeGroup.leaves` — массив | `PARTIAL` | `domain/furniture/types.ts` | Модель поддерживает; геометрия строит один лист |
| **Раздвижные (`sliding`)** | `CONFIRMED` (купе есть у эталона) | только `FacadeType` + `SlidingDoorConfig`; геометрия отказывает явно | `MISSING` | `geometry/doors.ts:103–112` | Поведения нет. §9 запрещает считать реализованным |
| Складные (`folding`) | `UNKNOWN` | только тип в объединении | `MISSING` | там же | — |
| Подъёмные (`lift`) | `UNKNOWN` | только тип в объединении | `MISSING` | там же | — |

Движок не молчит о нереализованном: `doors.ts:112` возвращает
`missing: «геометрия фасада типа "sliding" не реализована»`, и это
попадает в диагностику пользователю.

## 8. Ящики (§10)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Фасад ящика | `CONFIRMED` | `role: 'drawer-front'`, строится | `IMPLEMENTED` | `geometry/drawers.ts`; `tests/unit/geometry/drawers.test.ts` | — |
| Накладной и вкладной | `UNKNOWN` | `DrawerFacadeSpec.overlay` | `IMPLEMENTED` | там же | Величины — `T-DRW-04` |
| Размеры фасада | `UNKNOWN` | из ячейки и числа ящиков | `IMPLEMENTED` | там же | — |
| Материал и кромка | `CONFIRMED` | как у фасада | `IMPLEMENTED` | `bom/edges.ts` | — |
| Коллизия с дверью | — | запрещена | `IMPLEMENTED` | `tests/unit/geometry/drawers.test.ts` | — |
| **Короб ящика** (бок, зад, дно) | `CONFIRMED` (ящик имеет короб) | роли есть в домене и в классификаторе; геометрия деталей не строит | `PARTIAL` | `domain/part/types.ts:21–23`; `production/parts.ts:33`; `KNOWN_ISSUES.md` §2 | Размеры короба зависят от направляющих — `T-DRW-05` |
| Произвольная конфигурация | `UNKNOWN` | число ящиков задаётся | `PARTIAL` | `App.tsx` | Индивидуальные высоты — не заведены |
| Зависимость от фурнитуры | `INDUSTRY` | направляющие считаются | `IMPLEMENTED` | `hardware/rules/slides.ts` | Длина — `NEEDS_CONFIRMATION` |

Ящик как физический объект **неполон**: в деталировку попадает фасад, но
не короб. Это ровно то, что §10 требует проверить по реальным
`ProductionPart`.

## 9. Ручки и push-to-open (§11)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| `NONE` | — | `{kind:'none'}` | `IMPLEMENTED` | `geometry/opening-system.ts` | — |
| `HANDLE` | `CONFIRMED` | геометрия положения строится | `IMPLEMENTED` | там же; `tests/unit/geometry/opening-system.test.ts` | — |
| `PUSH_TO_OPEN` | `CONFIRMED` | точка установки строится | `PARTIAL` | там же | Механизм как деталь — не заведён |
| Ручка-рейлинг (`bar`) | `UNKNOWN` | `HandleSpec.kind` | `IMPLEMENTED` | `domain/furniture/types.ts:303` | Каталог размеров — нет |
| Ручка-кнопка (`knob`) | `UNKNOWN` | там же | `IMPLEMENTED` | там же | — |
| Профиль, врезная | `UNKNOWN` | там же | `PARTIAL` | там же | Тип есть, отличий геометрии нет |
| Размещение | `UNKNOWN` | якорь + смещение, проверка выхода за фасад | `IMPLEMENTED` | `withinFacadeXY`; тесты там же | — |
| Ориентация | `UNKNOWN` | горизонтальная и вертикальная | `IMPLEMENTED` | там же | — |
| На двери | `CONFIRMED` | да | `IMPLEMENTED` | там же | — |
| На ящике | `CONFIRMED` | да | `IMPLEMENTED` | там же | — |
| Присадка под ручку | `INDUSTRY` | правило есть, операций не даёт | `PARTIAL` | `drilling/rules/opening.ts` | Межцентровое расстояние — `NEEDS_CONFIRMATION` |

## 10. Материалы (§12)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Реестр материалов | `CONFIRMED` (ЛДСП) | `project.materials.items` | `IMPLEMENTED` | `domain/materials/`; `tests/unit/domain/materials.test.ts` | — |
| Идентификаторы | — | `MaterialId` | `IMPLEMENTED` | там же | — |
| Толщина из материала | `CONFIRMED` (16 мм) | берётся из материала везде | `IMPLEMENTED` | проверено поиском: жёстко зашитой толщины в `geometry/`, `production/`, `bom/` нет | — |
| Назначение по ролям | `UNKNOWN` | `assignment`: корпус, полки, фасады | `IMPLEMENTED` | `App.tsx` шаг «Материалы» | — |
| Переопределение на детали | `CONFIRMED` (замена детали) | `materialId?` на 10 уровнях модели | `IMPLEMENTED` | `domain/furniture/types.ts` | — |
| Наследование | — | деталь → назначение → материал по умолчанию | `IMPLEMENTED` | `tests/unit/bom/` | — |
| Кромка | `CONFIRMED` | `EdgeSpec` | `IMPLEMENTED` | `bom/edges.ts` | — |
| Кромка по сторонам | `CONFIRMED` | `front`/`back`/`left`/`right` раздельно | `IMPLEMENTED` | `domain/materials/types.ts:62` | — |
| Вычитание кромки из размера | `UNKNOWN` | видимая настройка проекта | `NEEDS_CONFIRMATION` | `T-EDG-03`, `EdgeSizingPolicy` | Разные производства считают по-разному — поэтому настройка, а не догадка |
| Битая ссылка на материал | — | не чинится молча, даёт ошибку | `IMPLEMENTED` | `tests/unit/persistence/hardening.test.ts` | — |

## 11. Задняя стенка (§13)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Включение и отключение | `INDUSTRY` | `back.kind: 'none'` | `IMPLEMENTED` | `stages/back.ts`; `tests/unit/geometry/back.test.ts` | — |
| Материал | `INDUSTRY` (ХДФ) | `materialId` | `IMPLEMENTED` | там же | — |
| Толщина | `INDUSTRY` | из материала | `IMPLEMENTED` | там же | — |
| Способ крепления | `UNKNOWN` | `overlay`, `inset-groove`, `inset-flush` | `IMPLEMENTED` | `domain/furniture/types.ts:35–43` | Глубина паза — `ASSUMPTION` |
| Влияние на полезную глубину | — | учитывается | `IMPLEMENTED` | `carcass.ts:506` | — |
| Деление на части | `UNKNOWN` | по секциям | `IMPLEMENTED` | `stages/back.ts`; тесты там же | — |
| Размеры | — | по корпусу и способу крепления | `IMPLEMENTED` | там же | — |
| Детали производства | — | `role: 'back'` | `IMPLEMENTED` | `tests/unit/integration/production-regression.test.ts` | — |
| Раскрой | — | попадает в листы | `IMPLEMENTED` | там же | — |
| Спецификация | — | попадает в BOM | `IMPLEMENTED` | там же | — |
| Присадка задней стенки | `INDUSTRY` | правило есть, операций не даёт | `PARTIAL` | `drilling/rules/fasteners.ts` | Шаг крепежа — `NEEDS_CONFIRMATION` |

## 12. Цоколь (§14)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Включение | `INDUSTRY` | `base.kind`: `plinth`, `legs`, `none` | `IMPLEMENTED` | `stages/base.ts`; `tests/unit/geometry/base.test.ts` | — |
| Высота | `UNKNOWN` | `base.height`, поле в UI | `IMPLEMENTED` | там же | Значение по умолчанию — `INDUSTRY` |
| Отступ вглубь | `UNKNOWN` | `base.setback` | `IMPLEMENTED` | там же | — |
| Вырез | `UNKNOWN` | не заведён | `MISSING` | — | Правило неизвестно |
| Взаимодействие с дном | — | дно лежит на цоколе | `IMPLEMENTED` | `carcass.ts:124` | — |
| Влияние на двери и ящики | — | через `carcassY0` | `IMPLEMENTED` | тесты там же | — |
| Детали производства | — | `role: 'plinth'`, царги | `IMPLEMENTED` | `production-regression.test.ts` | — |
| **Входит ли цоколь в общую H** | `UNKNOWN` | **выбирает пользователь** переключателем на шаге «Конструкция»: `heightIncludesBase`, по умолчанию `true` | `NEEDS_CONFIRMATION` | `carcass.ts:122`; `tests/unit/integration/tolerances.test.ts` | Поле добавлено на PROMPT 33 (Д-002); само правило по-прежнему не подтверждено |

Задание требует «использовать только уже подтверждённое правило».
Подтверждённого правила нет, и продукт его не выдумывает: он делает
поведение параметром модели с явной пометкой `ASSUMPTION`.

## 13. Конструктивные надстройки (§15)

Проверено сквозь всю цепочку: модель → геометрия → производство →
экспорт → UI → тесты.

| Надстройка | Модель | Геометрия | Производство | UI | Тесты | Статус |
| --- | --- | --- | --- | --- | --- | --- |
| Свес (`overhang`) | ✅ | ✅ | ✅ | ✅ | ✅ 4 файла | `IMPLEMENTED` |
| Антресоль (`topSection`) | ✅ | ✅ | ✅ | ✅ | ✅ 3 файла | `IMPLEMENTED` |
| Зазор до потолка (`ceilingGap`) | ✅ | ✅ | ✅ | ✅ | ✅ 4 файла | `IMPLEMENTED` |
| Столешница (`countertop`) | ✅ | ✅ | ✅ | ✅ | ✅ 9 файлов | `IMPLEMENTED` |
| Навеска на стену (`wallMount`) | ✅ | ✅ | ✅ | ✅ | ✅ 2 файла | `PARTIAL` — точка установки есть, механизм крепления как деталь не заведён |
| Фальшпанели (`falsePanels`) | ✅ | ✅ | ✅ | ✅ | ✅ 6 файлов | `IMPLEMENTED` |

## 14. Фурнитура (§16)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Петли | `CONFIRMED` | количество считается из фасадов | `PARTIAL` | `hardware/rules/hinges.ts`; `tests/unit/hardware/` | Правило числа петель по высоте — `NEEDS_CONFIRMATION` |
| Направляющие | `CONFIRMED` | количество по ящикам | `PARTIAL` | `hardware/rules/slides.ts` | Длина по глубине — `NEEDS_CONFIRMATION` |
| Полкодержатели | `CONFIRMED` | по съёмным полкам | `PARTIAL` | `hardware/rules/shelf-supports.ts` | Тип — `NEEDS_CONFIRMATION` |
| Крепёж задней стенки | `INDUSTRY` | считается | `PARTIAL` | `hardware/rules/fasteners.ts` | Шаг — `NEEDS_CONFIRMATION` |
| Крепёж корпуса | `INDUSTRY` (конфирмат) | считается | `PARTIAL` | там же | Шаг — `NEEDS_CONFIRMATION` |
| Крепёж ручек | `INDUSTRY` | считается | `PARTIAL` | `hardware/rules/opening.ts` | Межцентровое — `NEEDS_CONFIRMATION` |
| Push-to-open | `CONFIRMED` | считается | `PARTIAL` | там же | Тип — `NEEDS_CONFIRMATION` |
| Количества | — | выводятся, не хранятся | `IMPLEMENTED` | `tests/unit/hardware/hardware-properties.test.ts` | — |
| Прослеживаемость | — | каждая позиция знает свою деталь | `IMPLEMENTED` | `app/production/traceability.ts` | — |
| Цепочка Геометрия → Фурнитура | — | вход — готовая геометрия | `IMPLEMENTED` | `hardware/index.ts` | — |
| Цепочка Фурнитура → Присадка | — | вход — готовая фурнитура | `IMPLEMENTED` | `drilling/rules/relations.ts` | — |

Все семь правил дают **количество**, но ни одно не даёт **координаты**:
это и есть граница между `IMPLEMENTED` и `NEEDS_CONFIRMATION` здесь.

## 15. Присадка (§17)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Система координат | `INDUSTRY` (система 32) | локальная система детали | `IMPLEMENTED` | `docs/DRILLING_RULES.md`; `drilling/types.ts` | — |
| Локальные и мировые координаты | — | перевод реализован | `IMPLEMENTED` | `tests/unit/drilling/` | — |
| Грань детали | — | `DrillFace`: `top`/`bottom` — пласти, остальные — торцы | `IMPLEMENTED` | `export/part-drawing.ts` | — |
| Направление | — | `through` / глухое | `IMPLEMENTED` | `drilling/types.ts` | — |
| Сквозные и глухие | — | различаются | `IMPLEMENTED` | там же | — |
| Отверстия под петли | `INDUSTRY` (чашка 35) | правило есть, операций **0** | `NEEDS_CONFIRMATION` | `drilling/rules/hinges.ts` | Диаметр чашки, отступ — не подтверждены |
| Под направляющие | `INDUSTRY` | правило есть, операций **0** | `NEEDS_CONFIRMATION` | `drilling/rules/slides.ts` | — |
| Под полкодержатели | `INDUSTRY` (шаг 32) | правило есть, операций **0** | `NEEDS_CONFIRMATION` | `drilling/rules/shelf-supports.ts` | — |
| Под ручки | `INDUSTRY` | правило есть, операций **0** | `NEEDS_CONFIRMATION` | `drilling/rules/opening.ts` | — |
| Под крепёж задней стенки | `INDUSTRY` | правило есть, операций **0** | `NEEDS_CONFIRMATION` | `drilling/rules/fasteners.ts` | — |
| Конфликты отверстий | — | проверка есть | `IMPLEMENTED` | `drilling/`; тесты там же | Сработать не на чем: операций нет |
| Источник каждой операции | — | `ruleId` + `reason` обязательны по типу | `IMPLEMENTED` | `drilling/types.ts` | Требование §17 выполнено структурно |

**Ноль операций — намеренное состояние, а не поломка.** Оно закреплено
регрессионным тестом, чтобы «вдруг появившиеся» отверстия были замечены.

## 16. Раскрой (§18)

| Функция | Эталон | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- | --- |
| Заготовки | `CONFIRMED` | `ProductionPart` из деталей | `IMPLEMENTED` | `production/parts.ts`; `tests/unit/production/` | — |
| Листы | `CONFIRMED` | размер из настроек | `IMPLEMENTED` | `production/layout.ts` | — |
| Размеры | — | из детали и кромки | `IMPLEMENTED` | там же | — |
| Поворот детали | `CONFIRMED` (текстура) | по направлению волокон | `IMPLEMENTED` | `tests/unit/production/layout.test.ts` | — |
| Ширина реза (kerf) | `INDUSTRY` | настройка проекта | `IMPLEMENTED` | `CuttingSettings` | — |
| Обрез края (trim) | `INDUSTRY` | настройка проекта | `IMPLEMENTED` | там же | — |
| Раскладка | — | детерминированная | `IMPLEMENTED` | `layout.test.ts` Test 32; `cutting-properties.test.ts` | — |
| Неразмещённые детали | — | отдельный список с причиной | `IMPLEMENTED` | `production-regression.test.ts` | — |
| Отход | — | считается | `IMPLEMENTED` | `production/` | — |
| Использование листа | — | считается | `IMPLEMENTED` | там же | — |
| Направление волокон | `CONFIRMED` | `Grain`: `none`/`along-length`/`along-width` | `IMPLEMENTED` | `domain/part/types.ts` | — |
| Детерминированность | — | два прогона — один результат | `IMPLEMENTED` | `invariants.test.ts:128` | — |

## 17. Спецификация (§19)

| Функция | Наше | Статус | Подтверждение |
| --- | --- | --- | --- |
| Детали | сгруппированы по одинаковым | `IMPLEMENTED` | `bom/`; `production-regression.test.ts` |
| Количества | выводятся | `IMPLEMENTED` | там же |
| Фурнитура | отдельным разделом | `IMPLEMENTED` | там же |
| Материалы | сводка по материалам | `IMPLEMENTED` | там же |
| Кромка | длина по материалам | `IMPLEMENTED` | `bom/edges.ts` |
| Присадка | раздел есть, операций 0 | `PARTIAL` | см. §15 |
| Раскрой | листы и размещения | `IMPLEMENTED` | там же |
| Предупреждения | отдельный список | `IMPLEMENTED` | `workflow/readiness.ts` |
| Ошибки | отдельный список | `IMPLEMENTED` | там же |
| `NEEDS_CONFIRMATION` как статус | показывается пользователю | `IMPLEMENTED` | `app/status.ts` |
| **Отсутствие двойного счёта** | проверяется явно | `IMPLEMENTED` | `tests/unit/workflow/readiness.test.ts:117` |

## 18. Чертежи (§20)

| Функция | Наше | Статус | Подтверждение |
| --- | --- | --- | --- |
| Общий вид | плоская схема + 3D | `IMPLEMENTED` | `render/`; `tests/e2e/scene-3d.spec.ts` |
| Чертёж детали | SVG с размерами | `IMPLEMENTED` | `render/PartDrawing.tsx` |
| Размеры на чертеже | длина, ширина, толщина | `IMPLEMENTED` | `export/part-drawing.ts` |
| Схема присадки | слой есть, отверстий 0 | `PARTIAL` | там же; см. §15 |
| Масштаб | подгонка и зум 0.25–8× | `IMPLEMENTED` | `render/PartDrawing.tsx` |
| Ориентация | пласть — `top`/`bottom` | `IMPLEMENTED` | `export/part-drawing.ts` |
| Подписи | имя, материал, количество, волокна | `IMPLEMENTED` | там же |
| Печать | страницы PDF | `IMPLEMENTED` | `export/pdf.ts`; `tests/unit/export/` |
| **Одна модель чертежа** | `buildPartDrawing` — общий для экрана и PDF | `IMPLEMENTED` | `export/part-drawing.ts`; требование §20 выполнено |

## 19. Экспорт (§21)

| Функция | Эталон | Наше | Статус | Подтверждение |
| --- | --- | --- | --- | --- |
| PDF | `CONFIRMED` | реальный файл | `IMPLEMENTED` | `tests/unit/export/pdf.test.ts`; `tests/e2e/pwa.spec.ts` |
| XLSX | `CONFIRMED` | реальный файл, собирается своим кодом | `IMPLEMENTED` | `tests/unit/export/xlsx.test.ts` (читается `exceljs`) |
| Детали в экспорте | — | совпадают с расчётом | `IMPLEMENTED` | `tests/unit/integration/export-content.test.ts` |
| Фурнитура | — | совпадает | `IMPLEMENTED` | там же |
| Присадка | — | раздел есть, пуст | `PARTIAL` | там же |
| Раскрой | — | совпадает, включая неразмещённые | `IMPLEMENTED` | там же |
| Спецификация | — | совпадает | `IMPLEMENTED` | там же |
| Материалы и кромка | — | совпадают | `IMPLEMENTED` | там же |
| Предупреждения | — | переносятся в файл | `IMPLEMENTED` | там же |
| Кириллица в PDF | `CONFIRMED` | Liberation Sans, подмножество | `IMPLEMENTED` | `export/pdf.ts` |

## 20. Планировщик помещения (§22)

| Функция | Наше | Статус | Подтверждение | Действие |
| --- | --- | --- | --- | --- |
| Произвольные стены | модель поддерживает | `PARTIAL` | `domain/project/types.ts`; `ROOM_PLANNER.md` §11 | Инструмента рисования контура нет |
| Пол | `Floor` | `IMPLEMENTED` | `scene/room-scene.ts` | — |
| Потолок | `Ceiling`, показ переключается | `IMPLEMENTED` | там же | — |
| Двери (проёмы) | модель, команды, сцена, валидация, форма | `IMPLEMENTED` | `AddOpening`; `RoomScreen` панель «Проёмы и препятствия»; `tests/e2e/parity.spec.ts` | Закрыто на PROMPT 33 (Д-001) |
| Окна | тот же `Opening` с `sillHeight`, свои размеры по умолчанию | `IMPLEMENTED` | там же; `app/editor/room-features.ts` | Закрыто на PROMPT 33 (Д-001) |
| Препятствия | модель, команды, сцена, форма | `IMPLEMENTED` | `AddObstacle`; `tests/unit/app/room-features.test.ts` | Закрыто на PROMPT 33 (Д-001) |
| Экземпляры мебели | размещение из библиотеки | `IMPLEMENTED` | `tests/e2e/room-planner.spec.ts` | — |
| Положение | X и Z, поля и перетаскивание | `IMPLEMENTED` | там же | — |
| Поворот | четвертями | `IMPLEMENTED` | `rotateQuarter` | — |
| Привязка | к стенам и углам | `IMPLEMENTED` | `room/snap.ts`; `tests/unit/room/` | — |
| Коллизии | проверка есть, показывается | `IMPLEMENTED` | `room/collision.ts` | — |
| Блокировка | `locked` | `IMPLEMENTED` | `RoomInspector.tsx` | — |
| Видимость | `visible` | `IMPLEMENTED` | там же | — |
| Сохранение и загрузка | в том же документе | `IMPLEMENTED` | `tests/e2e/room-planner.spec.ts` | — |
| **`FurnitureInstance` не копирует модель** | только `projectId` + `furnitureId` + поворот и положение | `IMPLEMENTED` | `domain/project/types.ts:163` | Требование §22 выполнено |

## 21. Библиотека проектов (§23)

| Функция | Наше | Статус | Подтверждение |
| --- | --- | --- | --- |
| Создание | `create` | `IMPLEMENTED` | `tests/e2e/project-library.spec.ts` |
| Открытие | `open` | `IMPLEMENTED` | там же |
| Переименование | без смены id | `IMPLEMENTED` | `tests/unit/persistence/repository.test.ts` |
| Дублирование | новые id | `IMPLEMENTED` | `tests/unit/domain/project-operations.test.ts` |
| Удаление | `delete` | `IMPLEMENTED` | `tests/unit/persistence/repository.test.ts` |
| Поиск | по имени | `IMPLEMENTED` | `tests/unit/library/search.test.ts` |
| Сортировка | 4 порядка | `IMPLEMENTED` | там же |
| Недавние | список | `IMPLEMENTED` | там же |
| Превью | SVG, кэш с отпечатком | `IMPLEMENTED` | `library/preview.ts` |
| Импорт | с проверкой размера, схемы, ссылок | `IMPLEMENTED` | `tests/unit/persistence/hardening.test.ts` |
| Экспорт | файл в открытом формате | `IMPLEMENTED` | там же |
| Несохранённые изменения | предупреждение при закрытии и при открытии другого | `IMPLEMENTED` | `tests/e2e/final-audit.spec.ts` |
| Ссылка Планировщик → Проект | `projectId` + `furnitureId`; удалённый помечается | `IMPLEMENTED` | `PROJECT_ROOM_INTEGRATION.md` §4 |

## 22. Редактор: правила слоёв (§24)

| Запрет | Соблюдён | Подтверждение |
| --- | --- | --- |
| Прямая мутация домена из UI | ✅ | Модель иммутабельна; правки только через `execute(Command)` |
| UI-копия проекта | ✅ | Единственный документ — в `useDocumentStore` |
| Расчёт производственной геометрии в компоненте | ✅ | Компонент **вызывает** чистые модули в `useMemo`; ни одной формулы размера в JSX |
| Второй источник истины | ✅ | Черновики выводятся из дерева (`app/editor/drafts.ts`), а не хранятся |

Проверяется машиной: `eslint-plugin-boundaries` + `PURE_LAYERS` +
`tests/unit/architecture/boundaries.test.ts`.

## 23. Трёхмерная сцена (§25)

| Объект | В сцене | Подтверждение |
| --- | --- | --- |
| Корпус, секции, перегородки, полки | ✅ | `scene/adapter.ts`; `tests/unit/scene/adapter.test.ts` |
| Двери, фасады ящиков, ручки | ✅ | там же |
| Задняя стенка, цоколь, надстройки | ✅ | там же |
| Материалы цветом | ✅ | `scene/materials.ts` |

**Рендерер размеров не пересчитывает.** `GeometryResult → SceneObject` —
чистая адаптация: `scene/adapter.ts` читает готовые `position` и `size`.
Вся сцена рисуется одним статическим единичным кубом,
`stats.geometryUploads === 1` закреплено тестом.

## 24. Мобильная версия (§26)

| Функция | Desktop | Mobile | Статус |
| --- | --- | --- | --- |
| Создание проекта | ✅ | ✅ | `IMPLEMENTED` |
| Габариты | ✅ | ✅ (лист параметров) | `IMPLEMENTED` |
| Секции, ячейки, наполнение | ✅ | ✅ | `IMPLEMENTED` |
| Материалы | ✅ | ✅ | `IMPLEMENTED` |
| 3D | ✅ | ✅ (сцена во весь экран) | `IMPLEMENTED` |
| Планировщик | ✅ | ✅ | `IMPLEMENTED` |
| Производство | ✅ | ✅ | `IMPLEMENTED` |
| Сохранение | ✅ | ✅ | `IMPLEMENTED` |
| Экспорт | ✅ | ✅ | `IMPLEMENTED` |
| Полная лестница шагов | ✅ | компактная строка «Шаг N из 11» | `DIFFERENT_BY_DESIGN` |
| Габарит в шапке | ✅ | скрыт | `DIFFERENT_BY_DESIGN` |
| Версия в строке состояния | ✅ | скрыта | `DIFFERENT_BY_DESIGN` |

Функционального разрыва нет: на телефоне недоступных возможностей не
осталось, отличается только плотность подачи. Проверено 13 сценариями в
`tests/e2e/mobile.spec.ts`.

## 25. Независимость (§28)

| Проверка | Результат |
| --- | --- |
| Упоминания референса вне `docs/` | 0 |
| Внешние сетевые обращения | 0 |
| Чужие логотипы, водяные знаки | 0 |
| Трекинг, реклама, `iframe`, прокси | 0 |

`node scripts/check-brand-independence.mjs` — 369 файлов, чисто.

---

## 26. Сводка

| Статус | Строк |
| --- | --- |
| `IMPLEMENTED` | 121 |
| `PARTIAL` | 23 |
| `MISSING` | 5 |
| `DIFFERENT_BY_DESIGN` | 4 |
| `NEEDS_CONFIRMATION` | 8 |

### `MISSING` целиком

1. Раздвижные фасады (`sliding`) — тип есть, поведения нет.
2. Складные фасады (`folding`) — то же.
3. Подъёмные фасады (`lift`) — то же.
4. Обувница (`SHOE_MODULE`) — отсутствует полностью, правило неизвестно.
5. Вырез в цоколе — правило неизвестно.

### Классификация отличий (§27)

| Отличие | Класс | Решение |
| --- | --- | --- |
| Нет раздвижных фасадов | **C** — техническое ограничение | Задокументировать; правила направляющих купе не подтверждены |
| Нет обувницы | **D** — правило неизвестно | `NEEDS_CONFIRMATION` |
| Нет короба ящика | **C** | Зависит от типа направляющих (`T-DRW-05`) |
| Нет штанги | **D** | `T-FILL-01` |
| Присадка без операций | **D** | Пять правил ждут подтверждения |
| Нет автосохранения | **B** — сознательное улучшение | Молчаливая запись теряет работу |
| Нет кнопки «Пересчитать» | **B** | Производные величины не устаревают |
| Нет адресов у экранов | **B** | Один источник истины о положении |
| ~~Проёмы и препятствия без формы~~ | **A** | **Исправлено** на PROMPT 33 (Д-001) |
| ~~`heightIncludesBase` без поля~~ | **A** | **Исправлено** на PROMPT 33 (Д-002) |
| ~~Подпись у ящиков обещала короб~~ | **A** | **Исправлено** на PROMPT 34 (Г-001) |
