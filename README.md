# Furniture Builder

Бесплатный онлайн-конструктор корпусной мебели. Шкафы, стеллажи, тумбы и
комоды по своим размерам — с расчётом конструкции и производственными
данными на выходе: деталировка, фурнитура, кромка, карты раскроя и
чертежи деталей.

Работает в браузере. Бесплатно, без регистрации, без рекламы. Проекты
остаются на вашем устройстве.

## Открыть приложение

### [→ Открыть готовое приложение](https://artemu1453.github.io/FurnityreBuilder/)

**Бесплатно • Без регистрации • Работает без сети после первого открытия**

Ничего устанавливать не нужно: приложение открывается в браузере и
сохраняет проекты на вашем устройстве.

## Быстрый старт

Работать с приложением можно сразу, ничего не настраивая:

1. Открыть приложение.
2. Задать габариты изделия — ширину, высоту, глубину.
3. Разделить корпус на секции и наполнить ячейки полками или ящиками.
4. Поставить фасады.
5. Сохранить проект — он останется в этом браузере.
6. Открыть раздел «Производство»: деталировка, раскрой, фурнитура.
7. Выгрузить PDF или XLSX.

Подробнее, без единой технической подробности —
[`docs/USING_THE_APPLICATION.md`](docs/USING_THE_APPLICATION.md).

## Принципы

- полностью бесплатно;
- без регистрации и авторизации;
- без подписок и платных функций;
- без рекламы, трекинга и аналитики;
- без обязательных внешних сервисов — после загрузки приложение автономно;
- проекты хранятся локально в браузере;
- импорт и экспорт проектов в открытом формате.

Серверной части у продукта нет. Данные не покидают устройство: это проверяется
не обещанием, а сборочной проверкой `npm run check:brand`, которая роняет
сборку при первом же внешнем обращении.

**Версия 0.1.0.** Продукт функционально завершён. Что реализовано и что
ограничено — [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md); что
менялось — [`CHANGELOG.md`](CHANGELOG.md); как выпускается версия —
[`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md).

Номер текущей версии виден в самом приложении, в строке состояния внизу.

## Возможности

Перечислено только то, что действительно работает.

### Конструктор

- габариты изделия: ширина, высота, глубина, толщина плиты;
- деление корпуса на секции с равными или заданными ширинами;
- сетка ячеек внутри секции: ряды и колонки;
- наполнение ячейки: полки или ящики (штанги в интерфейсе нет —
  правило её построения не подтверждено, и приложение говорит об этом
  вместо того, чтобы предлагать несуществующее);
- фасады: распашные двери и фасады ящиков, сторона петель, накладные и
  вкладные;
- способ открывания: ручка с размещением или push-to-open;
- надстройки: столешница со свесом, антресоль, фальшпанели, зазор до потолка;
- задняя стенка и цоколь с царгами;
- материалы корпуса, полок и фасадов, кромка, схема сборки;
- сценарий из 11 шагов, ведущий от габаритов к производству: десять из
  них конструируют изделие, последний выдаёт производственный результат
  ([`docs/FINAL_CONSTRUCTION_TO_PRODUCTION_FLOW.md`](docs/FINAL_CONSTRUCTION_TO_PRODUCTION_FLOW.md));
- отмена и повтор для всех 44 команд модели.

### Просмотр

- трёхмерная сцена на WebGL 2 с выбором деталей, вращением и масштабом;
- изменение габаритов перетаскиванием ручек прямо в сцене;
- инспектор выбранного объекта;
- планировщик помещения: стены, проёмы, расстановка изделий с привязкой к
  стенам и углам.

### Производство

- деталировка: физические детали с размерами, материалом и кромкой;
- чертёж детали с размерами и отверстиями, тот же на экране и в PDF;
- спецификация фурнитуры;
- карты раскроя по листам с учётом реза и неразмещённых деталей;
- прослеживаемость: от строки спецификации к детали в сцене и обратно;
- раздел открывается результатом: сводка, состояние расчёта, документы;
- раздел «Готовность» — что посчитано, что требует уточнения и на что
  это влияет; неподтверждённые правила названы и не спрятаны.

### Документы

- экспорт PDF: титул, деталировка, фурнитура, раскрой, чертежи;
- экспорт XLSX: те же данные листами таблицы;
- экспорт и импорт проекта одним файлом.

### Известные ограничения

- **Присадка не даёт операций.** Правила расположения отверстий не
  подтверждены источником, и приложение честно показывает это вместо
  выдуманных координат. Подробности —
  [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md).
- **У экранов нет отдельных адресов.** Приложение работает по одному
  адресу, навигация внутренняя; ссылку на конкретный экран отправить
  нельзя. Решение архитектурное, см.
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §7.
- Полный список — [`docs/FINAL_DEFECT_LIST.md`](docs/FINAL_DEFECT_LIST.md).

## Что нужно, чтобы пользоваться

Браузер с поддержкой WebGL 2 и IndexedDB — то есть любой современный.
Проверено в Chrome, Firefox, Safari и Edge; на телефоне — Safari iOS и
Chrome Android. Устанавливать ничего не нужно, но приложение можно
поставить на устройство как обычное (PWA).

Ниже — всё для разработчика. Тому, кто просто хочет спроектировать шкаф,
дальше читать незачем.

---

## Запустить локально

Нужен Node.js 20 или новее и npm. Больше ничего: ни базы данных, ни
сервера, ни служб.

**Обязательных переменных окружения нет.** Единственная, которую
приложение вообще читает, — необязательная `APP_BASE`: она нужна только
при сборке под подкаталог (см. «Развёртывание»). Без неё сборка идёт под
корень домена. Файла `.env` в проекте нет и не требуется.

```bash
npm install
npm run dev          # сервер разработки, http://localhost:5173
```

## Production-сборка

```bash
npm run build        # типы → Vite → манифест → service worker → 404.html
npm run preview      # посмотреть собранное локально
```

`dist/` — статические файлы, готовые к выкладке. Никакого исполнения на
сервере не требуется.

Полная проверка перед выпуском:

```bash
npm run verify       # реестр предположений → lint → типы → тесты → сборка →
                     # автономность → бюджеты → готовность пакета → вход
```

## Что где лежит

| Нужно | Где |
| --- | --- |
| Все команды одной таблицей | [`docs/OPERATIONS.md`](docs/OPERATIONS.md) |
| Как устроено приложение | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Правила расчёта мебели | [`docs/CALCULATION_RULES.md`](docs/CALCULATION_RULES.md) |
| Что доказывает каждый вид тестов | [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) |
| Обязательные проверки и их порядок | [`docs/CI_QUALITY_GATES.md`](docs/CI_QUALITY_GATES.md) |
| Как выпускается версия | [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) |
| Где лежат проекты пользователя | [`docs/PROJECT_PERSISTENCE.md`](docs/PROJECT_PERSISTENCE.md) |

## Development Quality Checks

Всё, что проверяет CI, запускается локально теми же командами:

```bash
npm ci                                        # установка строго из lock-файла
npm run verify                                # девять проверок подряд, до первой упавшей
npx playwright test --project=chromium        # E2E на production-сборке
npx playwright test --project=chromium-dev    # E2E технического режима

PLAYWRIGHT_BASE_URL=<адрес> npm run smoke     # проверка опубликованного
```

`npm run verify` — это реестр предположений, линтер, типы, тесты, сборка,
самостоятельность продукта, бюджеты производительности, готовность пакета
и целостность публичного входа.

Что именно проверяется, чем блокируется и почему E2E разделён на два
прогона — [`docs/CI_QUALITY_GATES.md`](docs/CI_QUALITY_GATES.md).

## Тесты

```bash
npm run test         # 2001 модульный, интеграционный и property-тест
npm run typecheck    # vitest НЕ проверяет типы: этот шаг обязателен отдельно
```

## E2E

```bash
npx playwright install --with-deps chromium

npx playwright test --project=chromium       # на production-сборке
npx playwright test --project=chromium-dev   # технический режим, dev-сервер
```

Проекты запускаются **по отдельности**: вместе они поднимают два сервера и
мешают друг другу.

## Развёртывание

Приложение — статический сайт. Достаточно отдать содержимое `dist/` любым
файловым хостингом по HTTPS и настроить SPA-fallback.

Сборка умеет жить и в корне домена, и в подкаталоге:

```bash
npm run build                          # в корне домена
APP_BASE=/репозиторий/ npm run build   # в подкаталоге
```

Публикация на GitHub Pages настроена и работает: каждый push в ветку по
умолчанию проходит ворота качества, и только после них собирается и
выкладывается production-версия
([`docs/GITHUB_PAGES_DEPLOYMENT.md`](docs/GITHUB_PAGES_DEPLOYMENT.md)).

Подробно, включая настройки для конкретных хостингов, требования к
заголовкам и проверку выкладки:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md),
[`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`](docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md).

## Работа без сети

После первого открытия приложение работает офлайн полностью: создание и
правка проекта, расчёты, 3D, планировщик, производственные разделы,
сохранение, а также экспорт PDF и XLSX. Ничего из этого не обращается к
серверу — считает и рисует само устройство.

Как это устроено и что именно кэшируется — [`docs/PWA_OFFLINE.md`](docs/PWA_OFFLINE.md).

## Хранение проектов

Проекты лежат в IndexedDB того браузера, в котором вы работаете. Это значит:

- они не видны на другом устройстве и в другом браузере;
- они переживают перезагрузку страницы, перезапуск браузера и обновление
  приложения;
- их удаляет очистка данных сайта — как и любые данные сайта;
- в приватном режиме хранилище может быть недоступно, и приложение прямо
  говорит об этом, а не делает вид, что сохранило.

Чтобы перенести проект на другое устройство или сохранить надолго —
выгрузите его файлом.

Что именно хранится и что не отправляется наружу: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Импорт и экспорт

Кнопка «Экспорт» в библиотеке выгружает проект одним файлом `.json` в
открытом формате с номером версии схемы. Кнопка «Импорт из файла» читает
такой файл обратно.

При импорте файл проверяется целиком: размер, корректность JSON, версия
схемы, структура и ссылки. Неподходящий файл отклоняется с объяснением
причины, а не молча.

Формат и миграции: [`docs/PROJECT_PERSISTENCE.md`](docs/PROJECT_PERSISTENCE.md).

## Архитектура

Слои выстроены в одну сторону, и это проверяет линтер: импорт «наверх»
роняет сборку.

```
domain → geometry → hardware/production → drilling → bom → export → workflow
```

Плюс `room`, `scene`, `library`, `render`, `state`, `interaction`, `motion`,
`design-system`, `persistence`, `validation`, `app`.

Три правила, из которых следует почти всё остальное:

1. **Чистые слои чисты.** В `domain`, `geometry`, `validation`, `hardware`,
   `production`, `drilling`, `bom`, `export`, `workflow`, `scene`, `room` и
   `library` нет React, DOM и браузерных глобальных объектов. Импорт React в
   `src/geometry` роняет сборку.
2. **Производные величины не хранятся.** Деталировка, фурнитура, раскрой и
   присадка выводятся из проекта при каждом обращении. Поэтому в приложении
   нет кнопки «Пересчитать»: устаревшего результата не бывает.
3. **Изменения идут командами.** Все 44 команды проходят через одну функцию,
   история хранит патчи Immer, отмена и повтор работают везде одинаково.

Подробно: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Документация

В `docs/` больше сотни файлов, и они разного рода: действующие правила,
руководства и **датированные отчёты о конкретных прогонах**. Карта по
категориям — в
[`docs/MAINTAINABILITY_AUDIT_REPORT.md`](docs/MAINTAINABILITY_AUDIT_REPORT.md).
Начать стоит с этих:

| Документ | Содержание |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Слои, стек, движок геометрии, состояние, хранение, экспорт |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Доменная модель, независимая от интерфейса |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Сборка, выкладка, SPA-fallback, HTTPS, заголовки |
| [`docs/PWA_OFFLINE.md`](docs/PWA_OFFLINE.md) | Установка, кэш, обновление версий, работа без сети |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Что хранится, где и что не отправляется наружу |
| [`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md) | Зависимости и их лицензии |
| [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md) | Что реализовано, что поддерживается, что ограничено |
| [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) | Версии, теги, выпуск и откат по номеру версии |
| [`docs/RELEASE_VERSIONING_REPORT.md`](docs/RELEASE_VERSIONING_REPORT.md) | Состояние системы выпусков: что проверено и что нет |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | Что проверить перед выкладкой |
| [`docs/FINAL_RELEASE_REPORT.md`](docs/FINAL_RELEASE_REPORT.md) | Итог финальной проверки выпуска на конкретном коммите |
| [`docs/PRODUCT_CAPABILITY_MAP.md`](docs/PRODUCT_CAPABILITY_MAP.md) | Что продукт умеет — и что прямо не умеет |
| [`docs/PRODUCT_REQUIREMENT_TRACEABILITY.md`](docs/PRODUCT_REQUIREMENT_TRACEABILITY.md) | Требование → реализация → проверка → статус |
| [`docs/PRODUCT_GAP_REGISTER.md`](docs/PRODUCT_GAP_REGISTER.md) | Пробелы продукта с воспроизведением и классом |
| [`docs/NEXT_DEVELOPMENT_ROADMAP.md`](docs/NEXT_DEVELOPMENT_ROADMAP.md) | Порядок следующего этапа, построенный из подтверждённых пробелов |
| [`docs/PRODUCT_PARITY_AUDIT_REPORT.md`](docs/PRODUCT_PARITY_AUDIT_REPORT.md) | Итог аудита соответствия продуктовой цели |
| [`docs/CURRENT_APP_SCREEN_MAP.md`](docs/CURRENT_APP_SCREEN_MAP.md) | Карта экранов приложения: зоны, их размеры и что где лежит |
| [`docs/CURRENT_APP_CONTROL_INVENTORY.md`](docs/CURRENT_APP_CONTROL_INVENTORY.md) | Инвентаризация органов управления по экранам и шагам |
| [`docs/CURRENT_APP_USER_FLOW.md`](docs/CURRENT_APP_USER_FLOW.md) | Фактический сценарий работы от открытия до выгрузки |
| [`docs/INTUITIVE_BUILDING_UX_AUDIT_REPORT.md`](docs/INTUITIVE_BUILDING_UX_AUDIT_REPORT.md) | Может ли новый человек сам дойти от «хочу шкаф» до производственных данных |
| [`docs/FURNITURE_BUILDING_FRICTION_MAP.md`](docs/FURNITURE_BUILDING_FRICTION_MAP.md) | Где человек застревает: 18 наблюдений с измерениями и классом P0–P4 |
| [`docs/IDEAL_FURNITURE_BUILDING_JOURNEY.md`](docs/IDEAL_FURNITURE_BUILDING_JOURNEY.md) | Каким путь должен быть: восемь требований и измеримые пороги |
| [`docs/UX_REBUILD_PRIORITY_MATRIX.md`](docs/UX_REBUILD_PRIORITY_MATRIX.md) | Очередь правок понятности: влияние, цена, риск |
| [`docs/P0_CELL_SELECTION_IMPLEMENTATION_NOTES.md`](docs/P0_CELL_SELECTION_IMPLEMENTATION_NOTES.md) | Устройство выбора объектов до правки P0 и почему ячейка не бралась в сцене |
| [`docs/P0_CELL_SELECTION_VERIFICATION.md`](docs/P0_CELL_SELECTION_VERIFICATION.md) | Замеры до и после: 0/9 → 9/9 на четырёх размерах окна |
| [`docs/FR02_CONSTRUCTION_RESET_ANALYSIS.md`](docs/FR02_CONSTRUCTION_RESET_ANALYSIS.md) | Почему действие по умолчанию шага 4 отменяло шаг 3 |
| [`docs/FR02_CONSTRUCTION_RESET_VERIFICATION.md`](docs/FR02_CONSTRUCTION_RESET_VERIFICATION.md) | Замеры до и после: 7/3/2 → 5/1/0 больше не воспроизводится |
| [`docs/CONSTRUCTION_STEP_STATE_MODEL.md`](docs/CONSTRUCTION_STEP_STATE_MODEL.md) | Что каждый шаг делает с моделью и может ли уничтожить сделанное |
| [`docs/FR05_FIRST_ACTION_ANALYSIS.md`](docs/FR05_FIRST_ACTION_ANALYSIS.md) | Какое действие первое, почему его не было видно и аудит одиннадцати шагов |
| [`docs/FR05_DESKTOP_MOBILE_HIERARCHY_COMPARISON.md`](docs/FR05_DESKTOP_MOBILE_HIERARCHY_COMPARISON.md) | Чему настольная раскладка научилась у телефонной — и где телефон был не прав |
| [`docs/FR05_FIRST_ACTION_VERIFICATION.md`](docs/FR05_FIRST_ACTION_VERIFICATION.md) | Замеры до и после: 888 px → 205 px на четырёх размерах окна |
| [`docs/FR06_FURNITURE_STARTING_POINT_ANALYSIS.md`](docs/FR06_FURNITURE_STARTING_POINT_ANALYSIS.md) | Что модель различает на самом деле и почему выбора типа мебели нет |
| [`docs/FR06_FURNITURE_STARTING_POINT_VERIFICATION.md`](docs/FR06_FURNITURE_STARTING_POINT_VERIFICATION.md) | Замеры до и после: с чего начинается изделие и куда ведёт подпись |
| [`docs/FR12_TECHNICAL_LANGUAGE_ANALYSIS.md`](docs/FR12_TECHNICAL_LANGUAGE_ANALYSIS.md) | Откуда в интерфейсе брались `edges`, `back` и `Bounding box` |
| [`docs/FR12_TECHNICAL_LANGUAGE_VERIFICATION.md`](docs/FR12_TECHNICAL_LANGUAGE_VERIFICATION.md) | Замеры до и после: что переименовано, что оставлено и почему |
| [`docs/FR07_PARALLEL_PATH_ANALYSIS.md`](docs/FR07_PARALLEL_PATH_ANALYSIS.md) | Инспектор и шаги 5–7: что из этого дубль, а что разные действия |
| [`docs/FR07_PRIMARY_PATH_VERIFICATION.md`](docs/FR07_PRIMARY_PATH_VERIFICATION.md) | Замеры до и после: девять реализаций пяти операций стали пятью |
| [`docs/FR08_SHELF_INTERACTION_ANALYSIS.md`](docs/FR08_SHELF_INTERACTION_ANALYSIS.md) | Почему «сколько полок» имело два разных ответа в двух местах |
| [`docs/FR08_SHELF_MODEL_VERIFICATION.md`](docs/FR08_SHELF_MODEL_VERIFICATION.md) | Замеры до и после: один вопрос о полках, один ответ |
| [`docs/FR19_PRODUCTION_LANGUAGE_ANALYSIS.md`](docs/FR19_PRODUCTION_LANGUAGE_ANALYSIS.md) | Четыре островка словаря и почему имена деталей не находились нигде |
| [`docs/FR19_PRODUCTION_LANGUAGE_VERIFICATION.md`](docs/FR19_PRODUCTION_LANGUAGE_VERIFICATION.md) | Замеры до и после: 23/72 ячеек с латиницей → 0/72, PDF и XLSX вскрыты |
| [`docs/FR20_PRODUCTION_DEFAULT_ANALYSIS.md`](docs/FR20_PRODUCTION_DEFAULT_ANALYSIS.md) | Почему вход в производство занимала стена неподтверждённых правил |
| [`docs/FR20_PRODUCTION_DEFAULT_VERIFICATION.md`](docs/FR20_PRODUCTION_DEFAULT_VERIFICATION.md) | Замеры до и после: 80…82 % высоты → 0 px на входе |
| [`docs/FR10_FINAL_STEPS_ANALYSIS.md`](docs/FR10_FINAL_STEPS_ANALYSIS.md) | Чем были заняты шаги 10 и 11 и почему это был один экран дважды |
| [`docs/FR10_FINAL_STEPS_VERIFICATION.md`](docs/FR10_FINAL_STEPS_VERIFICATION.md) | Замеры до и после: 3 общие панели и 19 общих органов → 0 и 0 |
| [`docs/FINAL_CONSTRUCTION_TO_PRODUCTION_FLOW.md`](docs/FINAL_CONSTRUCTION_TO_PRODUCTION_FLOW.md) | Где заканчивается конструирование и начинается производство |
| [`docs/FR04_DRAWER_MODEL_ANALYSIS.md`](docs/FR04_DRAWER_MODEL_ANALYSIS.md) | Конструкция ящика: что подтверждено источником, что нет и почему короб пока не строится |
| [`docs/PRIVET_MAKET_CAPABILITY_MATRIX.md`](docs/PRIVET_MAKET_CAPABILITY_MATRIX.md) | Карта возможностей референса против наших, с классом доказательства у каждой строки |
| [`docs/PRIVET_MAKET_HARDWARE_REGISTRY.md`](docs/PRIVET_MAKET_HARDWARE_REGISTRY.md) | Реестр фурнитуры: что известно про каждый узел и до какого уровня |
| [`docs/PRIVET_MAKET_IMPLEMENTATION_PRIORITY.md`](docs/PRIVET_MAKET_IMPLEMENTATION_PRIORITY.md) | Очередь пробелов фурнитуры и что нужно достать, чтобы их закрыть |
| [`docs/CORE_CONSTRUCTION_ACTION_PATHS.md`](docs/CORE_CONSTRUCTION_ACTION_PATHS.md) | Где что делать: первичный и вторичный путь для каждого действия |
| [`docs/USING_THE_APPLICATION.md`](docs/USING_THE_APPLICATION.md) | Как пользоваться приложением — без единой технической подробности |
| [`docs/PUBLIC_LAUNCH_READINESS.md`](docs/PUBLIC_LAUNCH_READINESS.md) | Приёмка глазами пользователя: что проверено и какие дефекты найдены |
| [`docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`](docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md) | Что проверить при самой выкладке и сразу после неё |
| [`docs/PRODUCTION_DEPLOYMENT_REPORT.md`](docs/PRODUCTION_DEPLOYMENT_REPORT.md) | Отчёт о проверке выкладки: что проверено и что осталось непроверенным |
| [`docs/PERFORMANCE_BUDGETS.md`](docs/PERFORMANCE_BUDGETS.md) | Бюджеты размера: что измеряется, какие потолки и как их менять |
| [`docs/PERFORMANCE_BASELINE_REPORT.md`](docs/PERFORMANCE_BASELINE_REPORT.md) | Факты замера: первая загрузка, отложенное, что автоматизировано и что нет |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Все команды одной таблицей: среда, работа, сборка, проверки, выпуск |
| [`docs/CALCULATION_RULES.md`](docs/CALCULATION_RULES.md) | Вход в правила расчёта: где что лежит и какие правила сквозные |
| [`docs/MAINTAINABILITY_AUDIT_REPORT.md`](docs/MAINTAINABILITY_AUDIT_REPORT.md) | Проверка передачи проекта: clean start, команды, карта документации |
| [`docs/UX_CLARITY_ISSUES.md`](docs/UX_CLARITY_ISSUES.md) | Реестр проблем понятности: что подтверждено, что признано не проблемой |
| [`docs/UX_CLARITY_AUDIT_REPORT.md`](docs/UX_CLARITY_AUDIT_REPORT.md) | Аудит понятности интерфейса и accessibility baseline |
| [`docs/ACCEPTANCE_GAP_REGISTER.md`](docs/ACCEPTANCE_GAP_REGISTER.md) | Реестр пробелов приёмки: severity, влияние на пользователя и решение по каждому |
| [`docs/ACCEPTANCE_GAP_CLOSURE_REPORT.md`](docs/ACCEPTANCE_GAP_CLOSURE_REPORT.md) | Что закрыто, чем доказано и что осталось открытым |
| [`docs/CRITICAL_REGRESSION_MAP.md`](docs/CRITICAL_REGRESSION_MAP.md) | Какой пользовательский путь каким тестом сторожится |
| [`docs/PRODUCT_ACCEPTANCE_MATRIX.md`](docs/PRODUCT_ACCEPTANCE_MATRIX.md) | Приёмка по пользовательским сценариям: статус, свидетельство, пробелы автоматизации |
| [`docs/PRODUCT_ACCEPTANCE_REPORT.md`](docs/PRODUCT_ACCEPTANCE_REPORT.md) | Итог финального аудита продукта на конкретном коммите |
| [`docs/ERROR_HANDLING.md`](docs/ERROR_HANDLING.md) | Что происходит при ошибке: границы, восстановление, диагностика и её приватность |
| [`docs/ERROR_HANDLING_REPORT.md`](docs/ERROR_HANDLING_REPORT.md) | Факты проверки обработки ошибок: что подтверждено управляемым отказом |
| [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) | Действующие ограничения с причинами |
| [`docs/UX_FLOW.md`](docs/UX_FLOW.md) | Полный сценарий работы |
| [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) | Уровни тестов и что именно проверяется |
| [`docs/CI_QUALITY_GATES.md`](docs/CI_QUALITY_GATES.md) | Ворота качества: что проверяет CI и что блокирует выпуск |
| [`docs/GITHUB_PAGES_DEPLOYMENT.md`](docs/GITHUB_PAGES_DEPLOYMENT.md) | Как приложение попадает в production и как откатить версию |
| [`docs/PRODUCTION_SMOKE_TESTING.md`](docs/PRODUCTION_SMOKE_TESTING.md) | Проверка опубликованной версии: зачем и что именно проверяется |
| [`docs/PUBLIC_ACCESS_INTEGRITY.md`](docs/PUBLIC_ACCESS_INTEGRITY.md) | Охрана пути «README → приложение» от регрессий |
| [`docs/PUBLIC_ACCESS_INTEGRITY_REPORT.md`](docs/PUBLIC_ACCESS_INTEGRITY_REPORT.md) | Состояние охраны: что проверено и какие сценарии отказа подтверждены |
| [`docs/PRODUCTION_SMOKE_TEST_REPORT.md`](docs/PRODUCTION_SMOKE_TEST_REPORT.md) | Факты прогона дымовой проверки |
| [`docs/GITHUB_PAGES_DEPLOYMENT_REPORT.md`](docs/GITHUB_PAGES_DEPLOYMENT_REPORT.md) | Факты выкладки: что подтверждено и что осталось непроверенным |

## Лицензия

MIT — см. [`LICENSE`](LICENSE).

Лицензии сторонних компонентов, включая шрифт для PDF:
[`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md).
