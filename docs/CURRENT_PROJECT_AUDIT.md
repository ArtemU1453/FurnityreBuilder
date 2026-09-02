# Аудит текущего репозитория

**Репозиторий:** `ArtemU1453/FurnityreBuilder`
**Дата аудита:** 2026-08-29
**Ветка разработки:** `claude/furniture-designer-audit-cjvvuf`

---

## 1. ГЛАВНЫЙ ВЫВОД

**Репозиторий пуст. Кода не существует.** Это greenfield-проект.

Фактические данные:

```
$ git log --oneline
fatal: your current branch 'claude/furniture-designer-audit-cjvvuf' does not have any commits yet

$ git ls-remote --heads origin
(пусто — ни одной ветки на remote)

$ ls -la
.git/          ← единственный объект в рабочей директории
```

Проверено:

| Проверка | Результат |
| --- | --- |
| Коммиты в локальной ветке | 0 |
| Ветки на `origin` | 0 |
| Файлы в рабочей директории | 0 (кроме `.git/`) |
| `package.json` | отсутствует |
| Любой исходный файл | отсутствует |
| Ветка по умолчанию на remote | не создана |

---

## 2. ЧТО ЭТО ЗНАЧИТ ДЛЯ ЗАДАНИЯ

Пункт 24 задания требует разделить существующий код на REUSE / REFACTOR / REMOVE / CREATE.
Правило «не переписывай проект полностью без доказанной необходимости» **неприменимо**:
переписывать нечего.

| Категория | Содержимое |
| --- | --- |
| **REUSE** | Ничего. Кода нет. |
| **REFACTOR** | Ничего. Кода нет. |
| **REMOVE** | Ничего. Кода нет. |
| **CREATE** | Всё. См. §4. |

Это одновременно и риск, и преимущество:

- **риск** — нет ни одной проверенной строки, весь объём работ впереди;
- **преимущество** — нет технического долга, нет legacy-решений, архитектурные
  границы (§19 задания: «React не содержит математику мебели») можно заложить
  с первого коммита и защитить линтером, а не выпиливать потом.

---

## 3. АУДИТ ПО ОБЯЗАТЕЛЬНЫМ ПУНКТАМ

| Пункт | Состояние |
| --- | --- |
| Framework | не выбран → решение в `ARCHITECTURE.md` §3 |
| Язык | не выбран → TypeScript (strict), `ARCHITECTURE.md` §3 |
| Build system | не выбрана → Vite, `ARCHITECTURE.md` §3 |
| Компоненты | 0 |
| State management | отсутствует → решение в `ARCHITECTURE.md` §6 |
| Geometry engine | отсутствует → спроектирован в `ARCHITECTURE.md` §5 |
| Storage | отсутствует → IndexedDB, `ARCHITECTURE.md` §8 |
| Export | отсутствует → `ARCHITECTURE.md` §9 |
| Тесты | 0, инфраструктуры нет → Vitest + Playwright |
| UI | 0 |
| Существующие функции | 0 |
| Технический долг | 0 (нет кода) |

---

## 4. CREATE — что необходимо создать

Порядок соответствует `IMPLEMENTATION_PLAN.md`.

### 4.1 Инфраструктура (этап 01)

- `package.json`, `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`)
- Vite + React 19 + TypeScript
- Vitest (unit), Playwright (E2E) — Chromium уже установлен в окружении
- ESLint + правило границ импорта (`eslint-plugin-boundaries`), запрещающее
  импорт React внутри доменных слоёв — техническая гарантия правила §19 задания
- Prettier, CI-workflow (typecheck + lint + test + build)
- `README.md`, `LICENSE`, `.gitignore`
- Локально размещённый шрифт с кириллицей для PDF (без внешних CDN)

### 4.2 Доменное ядро (этапы 02, 06)

- `src/domain/**` — типы и сущности, **ноль зависимостей от React/DOM**
- `src/geometry/**` — чистые функции построения деталей
- `src/validation/**` — правила проверки
- `src/parts/**` — деталировка, кромка, фурнитура

### 4.3 Приложение (этапы 03–21)

- `src/design-system/**` — токены и примитивы
- `src/motion/**` — spring-движок и токены движения
- `src/interaction/**` — pointer-контроллеры, drag, undo/redo
- `src/state/**` — стор документа, сессии, истории
- `src/render/**` — SVG-схема 2D (и позже 3D)
- `src/app/**` — экраны, панели, композиция

### 4.4 Инженерные подсистемы (этапы 22–30)

- `src/persistence/**` — IndexedDB, автосохранение, импорт/экспорт JSON
- `src/export/**` — PDF, XLSX, CSV, карта раскроя, присадка
- `src/planner/**` — планировщик помещения

---

## 5. РИСКИ, СВЯЗАННЫЕ С ПУСТЫМ РЕПОЗИТОРИЕМ

| Риск | Влияние | Митигация |
| --- | --- | --- |
| Нет базовой линии — легко «поплыть» по scope | Высокое | Жёсткие критерии готовности каждого этапа в `IMPLEMENTATION_PLAN.md`; приложение обязано быть рабочим после каждого этапа |
| Архитектурная граница UI/домен размоется при спешке | Высокое | Правило границ импорта в ESLint включается на этапе 01, до первого компонента |
| 59 неизвестных геометрии (см. функциональную спецификацию) | Высокое | Параметризация схем сборки; предположения помечаются `// ASSUMPTION: T-XXX-NN` и покрываются тестами |
| Соблазн начать с UI, а не с домена | Среднее | Порядок этапов: домен и геометрия раньше экранов |
| Кириллица в PDF | Среднее | Шрифт встраивается локально, проверяется E2E-тестом на этапе 26 |

---

## 6. СОСТОЯНИЕ ПОСЛЕ ЭТАПА «АРХИТЕКТУРНЫЙ ФУНДАМЕНТ»

Аудит выше — снимок на 2026-08-29 до начала разработки. Он остаётся верен
как исходная точка: репозиторий действительно был пуст, и baseline проверок
(build, lint, typecheck, tests) не существовал — ломать было нечего.

Что появилось с тех пор:

| Категория | Состояние |
| --- | --- |
| Framework | Vite + React 19 |
| Язык | TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Build | `npm run build` — typecheck + Vite |
| State management | Zustand + Immer patches, разделение документа и сессии |
| Geometry engine | контракт + конвейер, реализованы этапы `normalize` и `carcass` |
| Storage | `ProjectRepository`, IndexedDB и реализация в памяти |
| Export | не реализован |
| Тесты | 135 unit, 7 E2E |
| UI | оболочка приложения, `Button`, `Field`, токены |
| Технический долг | отсутствует; предположения учтены в `UNKNOWNS.json` |

Проверка границ слоёв включена до первого компонента и подтверждена тестом:
импорт React в `src/geometry` роняет сборку.

---

## 7. ЧТО СДЕЛАНО В РАМКАХ PROMPT 1

Создана только документация в `docs/`. Кода приложения не добавлено —
это соответствует пункту 30 задания («не начинай разработку»).

```
docs/
├── PRIVETMAKET_FUNCTIONAL_SPEC.md
├── CURRENT_PROJECT_AUDIT.md
├── DATA_MODEL.md
├── ARCHITECTURE.md
├── INTERACTION_MODEL.md
├── UX_FLOW.md
├── DESIGN_SYSTEM.md
├── MOTION_SYSTEM.md
├── FEATURE_MATRIX.md
├── BRAND_INDEPENDENCE_AUDIT.md
└── IMPLEMENTATION_PLAN.md
```

На этапе «Архитектурный фундамент» к ним добавились `COORDINATE_SYSTEM.md`,
`UNITS_AND_PRECISION.md`, `STATE_ARCHITECTURE.md`, `REPOSITORY_ARCHITECTURE.md`,
`TESTING_STRATEGY.md` и машиночитаемый реестр `UNKNOWNS.json`.
