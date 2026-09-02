import { useMemo } from 'react';
import { formatMm } from '../domain/index.js';
import { buildGeometry } from '../geometry/index.js';
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

  if (furniture === undefined || geometry === undefined) {
    return <p>Проект не содержит изделий.</p>;
  }

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
