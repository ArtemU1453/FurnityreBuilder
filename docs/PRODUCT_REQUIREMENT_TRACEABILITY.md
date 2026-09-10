# Product Requirement Traceability

PROMPT 51 §4. Прослеживаемость: утверждённое требование → реализация →
проверка → статус.

Аудит выполнен на коммите **`e10be44`**, версия **0.1.0**. Все статусы
относятся к нему.

Формулировок «выглядит готовым», «вероятно реализовано» и «должно
работать» здесь нет: статус ставится по файлу и проверке, названным в
графе рядом.

## Источники требований (§2)

Требования брались из репозитория, а не из представлений о том, что
продукт «должен» уметь.

| Источник | Что даёт | Статус источника |
| --- | --- | --- |
| `docs/PRIVETMAKET_FUNCTIONAL_SPEC.md` | функциональная спецификация исследовательского референса | **ЧАСТИЧНО ЗАБЛОКИРОВАН** — референсный сайт недоступен из среды, проверено повторно |
| `docs/FEATURE_MATRIX.md` | принятый перечень возможностей | действующий |
| `docs/FUNCTIONAL_PARITY_MATRIX.md` | соответствие по коду и тестам (PROMPT 33) | действующий |
| `docs/PRODUCT_CAPABILITY_TRUTH.md` | сводная истина по 60 возможностям (PROMPT 34) | действующий, одна строка уточнена — см. ниже |
| `docs/CONFIRMED_GAP_BACKLOG.md` | подтверждённые пробелы с идентификаторами | действующий |
| `docs/UNKNOWNS.json` | 21 неподтверждённое правило с идентификаторами `T-*` | действующий |
| `docs/RELEASE_NOTES.md` | что заявлено в выпуске | действующий |

**Ключевое ограничение, без которого таблица ниже читается неверно.**
Поведение референса эмпирически не наблюдалось: прокси среды отклоняет
соединение. Поэтому требования вида «референс делает так» имеют статус
**UNVERIFIED REQUIREMENT** — не «не реализовано», а «неизвестно, что
считать правильным». Их 21, и все они перечислены в `UNKNOWNS.json` с
идентификаторами; продукт по каждому либо не предлагает возможность,
либо предлагает и прямо говорит, чего в ней не хватает.

## Прослеживаемость

### Основа

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Создание проекта без регистрации | `src/domain/project/factory.ts` | `acceptance.spec.ts` FLOW A; дымовая по живому адресу | **IMPLEMENTED** |
| Габариты W/H/D | `src/domain/furniture/types.ts`, `geometry/stages/normalize.ts` | `chain.mjs` §10: редактор → документ; `parity.spec.ts` | **IMPLEMENTED** |
| Толщина плиты | `Dimensions.panelThickness` | `tests/unit/geometry/carcass.test.ts` | **IMPLEMENTED** |
| Отмена и повтор для всех команд | `src/state/` — 44 команды, патчи Immer | `tests/unit/state/`, `acceptance.spec.ts` FLOW D | **IMPLEMENTED** |
| Единицы: миллиметры везде | `src/domain/units.ts` | `tests/unit/domain/units.test.ts` | **IMPLEMENTED** |

### Конструкция

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Корпус: боковины, крышка, дно | `geometry/stages/carcass.ts` | `tests/unit/geometry/carcass.test.ts` | **IMPLEMENTED** |
| Секции равные и заданной ширины | `SetSectionCount`, `SetChildSize` | `acceptance.spec.ts`, `section-loss.spec.ts` | **IMPLEMENTED** |
| Перегородки как детали | `geometry/stages/layout.ts` | деталировка: `Перегородка × 2` при 3 секциях | **IMPLEMENTED** |
| Сетка ячеек: ряды и колонки | `createUniformGrid` | `large-project.spec.ts` — сетка 3 × 4 | **IMPLEMENTED** |
| Полки | `geometry/stages/fill.ts` | `tests/unit/geometry/fill.test.ts` | **IMPLEMENTED** |
| Задняя стенка | `geometry/stages/back.ts` | `tests/unit/geometry/back.test.ts` | **IMPLEMENTED** |
| Цоколь и царги | `geometry/plinth.ts` | `tests/unit/geometry/` | **IMPLEMENTED** |
| Столешница, антресоль, фальшпанели | `geometry/stages/modifiers.ts` | `tests/unit/geometry/` | **IMPLEMENTED** |
| Вырез в цоколе | тип `PlinthCutout` + схема; геометрия помечает `cutoutNotImplemented` | флаг в `geometry/plinth.ts` | **NOT IMPLEMENTED** (Г-014) — модель выражает, геометрия не строит, UI не предлагает |
| Навеска на стену | точка установки в модели | — | **PARTIAL** — механизм как деталь не заведён |

### Фасады

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Распашная дверь, сторона петель | `geometry/doors.ts` | `tests/unit/geometry/doors.test.ts` | **IMPLEMENTED** |
| Накладной и вкладной | `FacadeLeaf.overlay` | там же | **IMPLEMENTED** |
| Ручка и push-to-open | `geometry/opening-system.ts` | `tests/unit/geometry/opening-system.test.ts` | **IMPLEMENTED** |
| Фасады ящиков | `geometry/drawers.ts` | `tests/unit/geometry/drawers.test.ts` | **IMPLEMENTED** |
| Короб ящика | тип есть, геометрия не строит | предупреждение T-DRW-02 в выгрузке | **NOT IMPLEMENTED** (Г-008) |
| Фасады купе, складные, подъёмные | тип в домене, движок отказывает с текстом | `tests/unit/geometry/` | **NOT IMPLEMENTED** — заявлено как не поддерживаемое |
| Фасад на несколько ячеек | — | — | **NOT IMPLEMENTED** — заявлено |

### Наполнение

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Пустая ячейка, полки, ящики | `LeafFill` | `fill-vocabulary.test.ts` | **IMPLEMENTED** |
| Штанга | `kind: 'rod'` в домене, геометрии нет | `fill-vocabulary.test.ts` — в UI не предлагается намеренно | **NOT IMPLEMENTED** (Г-009) |

### Материалы и кромка

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Реестр материалов, назначение по ролям | `src/domain/materials/` | `tests/unit/` | **IMPLEMENTED** |
| Кромка по четырём сторонам, метраж | `bom/` | выгрузка: колонка «Кромка» | **IMPLEMENTED** |
| Правило назначения кромки по умолчанию | реализовано «2 мм спереди, 0.4 по бокам» | предупреждение T-EDG-02 | **NOT VERIFIED** — значение по умолчанию референсом не подтверждено |
| Вычитание кромки из размера заготовки | по умолчанию не вычитается | предупреждение T-EDG-03 | **NOT VERIFIED** (Г-012) |

### Производство

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Деталировка | `src/bom/` | `chain.mjs`: сцена = сводка = документ | **IMPLEMENTED** |
| Чертежи деталей | `src/export/part-drawing.ts` | `tests/unit/export/part-drawing.test.ts` | **IMPLEMENTED** |
| Раскрой по листам | `src/production/` | `chain.mjs`: 2 листа, 46.5 % | **IMPLEMENTED** |
| Неразмещённые детали названы | `BOM_PART_NOT_PLACED` | «Деталь 2260×1830 не помещается в 2730×1810» | **IMPLEMENTED** |
| Прослеживаемость деталь → позиция | `app/production/traceability.ts` | `production.spec.ts` | **IMPLEMENTED** |
| Спецификация | `src/bom/` | `export-content.spec.ts` | **IMPLEMENTED** |
| Фурнитура: количества направляющих, полкодержателей | `src/hardware/` | предупреждения T-DRW-01, T-SHF-02 | **PARTIAL** — посчитано, часть характеристик не подтверждена |
| Фурнитура: петли | правило есть, результата не даёт | предупреждение T-DOOR-05 | **NOT VERIFIED** (Г-010) |
| Фурнитура: крепёж корпуса и задней стенки | правило есть, результата не даёт | предупреждения T-HW-03 | **NOT VERIFIED** |
| **Присадка** | пять правил в `src/drilling/rules/` | **0 операций**, семь предупреждений `T-DRILL-*`, `T-HW-*` | **NOT VERIFIED** (Г-005) — правила есть, ни одно не выдаёт результата |

### Хранение и экспорт

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Сохранение и восстановление | `src/persistence/`, IndexedDB | `chain.mjs`: сохранённое = перезагруженное | **IMPLEMENTED** |
| Версионирование схемы и миграции | `persistence/schema.ts` | `tests/unit/persistence/` | **IMPLEMENTED** |
| Импорт и экспорт проекта файлом | `library/` | `chain.mjs`: файл несёт те же габариты | **IMPLEMENTED** |
| Экспорт PDF | `src/export/pdf.ts` | открыт `pdf-lib`: 9 страниц A4+A3 | **IMPLEMENTED** |
| Экспорт XLSX | `src/export/xlsx.ts` | открыт `exceljs`: 7 листов, габариты сошлись | **IMPLEMENTED** |
| Экспорт CSV | — | — | **NOT APPLICABLE** — продукт его не заявляет |

### Приложение

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Трёхмерная сцена WebGL 2 | `src/render/`, `src/scene/` | `scene-3d.spec.ts` | **IMPLEMENTED** |
| Планировщик помещения | `src/room/` | `room-planner.spec.ts` | **IMPLEMENTED** |
| Произвольный контур помещения | модель выражает, инструмента рисования нет | — | **PARTIAL** |
| Библиотека проектов | `src/library/` | `project-library.spec.ts` | **IMPLEMENTED** |
| Работа на телефоне | `use-layout-mode.ts` | `mobile.spec.ts`, `responsive-widths.spec.ts` | **IMPLEMENTED** |
| Работа без сети, PWA | `sw.js`, `app/service-worker.ts` | `pwa.spec.ts` | **IMPLEMENTED** |
| Обработка ошибок и диагностика | `design-system/ErrorBoundary.tsx`, `app/diagnostics.ts` | `error-handling.spec.ts` | **IMPLEMENTED** |
| Без регистрации, оплаты, рекламы, трекинга | отсутствие кода | `check:brand` — 399 файлов | **IMPLEMENTED** |

## Уточнение к `PRODUCT_CAPABILITY_TRUTH.md`

Одна строка сводной таблицы неточна и исправлена в этом PROMPT (§16
разрешает исправление неверного audit evidence):

| Строка | Было | Стало | Почему |
| --- | --- | --- | --- |
| Вырез в цоколе | Домен ❌ | Домен ✅ | тип `PlinthCutout` есть в `domain/furniture/types.ts`, поле есть в `persistence/schema.ts`, а геометрия несёт явный флаг `cutoutNotImplemented`. Модель возможность выражает; не строит её расчёт |

Остальные 59 строк перепроверены выборочно и подтверждены.

## Сводка

| Статус | Требований |
| --- | --- |
| **IMPLEMENTED** | 30 |
| **PARTIAL** | 3 |
| **NOT IMPLEMENTED** | 5 |
| **NOT VERIFIED** | 6 |
| **NOT APPLICABLE** | 1 |

`NOT VERIFIED` здесь означает ровно одно: **неизвестно, каким должен
быть правильный результат**, потому что правило не подтверждено
источником. Это не то же самое, что «сломано»: продукт в каждом таком
случае либо не предлагает возможность, либо предлагает и называет, чего
в ней не хватает.
