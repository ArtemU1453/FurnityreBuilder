import { useMemo, useState } from 'react';
import { createEmptyLeaf, createShelvesLeaf } from '../domain/furniture/defaults.js';
import { createRandomIdFactory, formatMm } from '../domain/index.js';
import { createUniformGrid } from '../domain/furniture/sections.js';
import { buildGeometry } from '../geometry/index.js';
import { buildDebugView, DebugSchema } from '../render/index.js';
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

export function App(): React.JSX.Element {
  const project = useDocumentStore((s) => s.project);
  const execute = useDocumentStore((s) => s.execute);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const history = useDocumentStore((s) => s.history);

  // Черновые значения полей сетки: рабочий проект не трогается до нажатия
  // «Применить» — перестроение дерева секций является отдельным осознанным
  // действием пользователя, а не непрерывным вводом вроде габарита
  // (docs/GEOMETRY_RULES.md §10, docs/INTERACTION_MODEL.md §4.4 — то же
  // разграничение «черновое значение / коммит», что и у транзакций drag).
  const [rowsDraft, setRowsDraft] = useState(1);
  const [columnsDraft, setColumnsDraft] = useState(1);
  const [shelvesDraft, setShelvesDraft] = useState(0);
  const [showDebugInfo, setShowDebugInfo] = useState(false);

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

  const report = useMemo(() => validateProject(project), [project]);
  const debugView = useMemo(() => (geometry === undefined ? undefined : buildDebugView(geometry)), [geometry]);

  if (furniture === undefined || geometry === undefined || debugView === undefined) {
    return <p>Проект не содержит изделий.</p>;
  }

  // Дерево секций заменяется целиком одной командой SetRoot (см.
  // state/commands.ts) — построение равномерной сетки rows×columns здесь
  // и есть демонстрация PROMPT 4 §11: изменение количества строк/колонок
  // пересчитывает перегородки, ячейки и bounding box за один шаг истории.
  const applyGrid = (): void => {
    const ids = createRandomIdFactory();
    // Наполнение ячейки (полки, PROMPT 6) задаётся фабрикой листа: структура
    // сетки и содержимое ячейки — разные решения, см. `LeafFactory`.
    const createLeaf = (factoryIds: typeof ids) =>
      shelvesDraft <= 0 ? createEmptyLeaf(factoryIds) : createShelvesLeaf(factoryIds, shelvesDraft, 'adjustable');
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

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Перейти к содержимому
      </a>

      <header className={styles.toolbar}>
        <h1 className={styles.title}>Furniture Builder</h1>
        <Button onClick={undo} disabled={history.past.length === 0} aria-label="Отменить">
          Отменить
        </Button>
        <Button onClick={redo} disabled={history.future.length === 0} aria-label="Вернуть">
          Вернуть
        </Button>
      </header>

      <main id="main" className={styles.main}>
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
          <Button onClick={applyGrid} style={{ marginTop: 'var(--sp-3)' }}>
            Применить сетку {rowsDraft}×{columnsDraft}
          </Button>
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
              <span className={styles.statLabel}>Ячеек</span>
              <span className={styles.statValue}>{geometry.cells.length}</span>
            </li>
            <li className={styles.stat}>
              <span className={styles.statLabel}>Полок</span>
              <span className={styles.statValue}>
                {geometry.parts.filter((p) => p.role === 'shelf-fixed' || p.role === 'shelf-adjustable').length}
              </span>
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
                {formatMm(geometry.boundingBox.totalWidth)} × {formatMm(geometry.boundingBox.totalHeight)} ×{' '}
                {formatMm(geometry.boundingBox.totalDepth)} мм
              </span>
            </li>
          </ul>

          {report.issues.length > 0 ? (
            <>
              <h3 className={styles.panelTitle} style={{ marginTop: 'var(--sp-4)' }}>
                Проверка
              </h3>
              <ul className={styles.issues} aria-live="polite">
                {report.issues.map((item, index) => (
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
          <section className={`${styles.panel} ${styles.fullWidth}`} aria-labelledby="schema-title">
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
            <DebugSchema view={debugView} showDebugInfo={showDebugInfo} />
          </section>
        ) : null}
      </main>

      <footer className={styles.status}>
        <span>Схема сборки: {project.settings.construction.verticalPriority}</span>
        <span>Ошибок: {report.errors}</span>
        <span>Предупреждений: {report.warnings}</span>
        <span>Шагов истории: {history.past.length}</span>
      </footer>
    </div>
  );
}
