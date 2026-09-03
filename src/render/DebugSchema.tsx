import { Fragment } from 'react';
import type { DebugRect, DebugSchemaView } from './debug-view.js';
import styles from './DebugSchema.module.css';

/**
 * Технический 2D-рендерер фронтального вида (PROMPT 4 §17–18).
 *
 * НЕ финальный UI: точность важнее украшения. Показывает то, что реально
 * посчитал Geometry Engine — без текстур, фасадов, ручек и декора. Формулы
 * здесь нет ни одной: компонент только проецирует уже готовые прямоугольники
 * и размерные линии из `DebugSchemaView` (docs/GEOMETRY_RULES.md §12).
 *
 * Единственная нетривиальная задача компонента — инверсия оси Y: домен
 * считает Y вверх (docs/COORDINATE_SYSTEM.md §1), экран рисует Y вниз.
 * Инверсия — по формуле для каждого элемента, а не через SVG-трансформацию
 * `scale(1,-1)` на всей сцене: такая трансформация зеркалит и текст,
 * что потребовало бы отдельной контр-трансформации на каждой подписи.
 */

const MARGIN: number = 60;
const DIM_LINE_OFFSET: number = 24;
const TICK_SIZE: number = 6;

/** Горизонтальный разделитель (§9.5) и полка наполнения (PROMPT 6) — физически один
 * и тот же тип детали (`docs/GEOMETRY_RULES.md` §9.5: «горизонтальный разделитель
 * физически является полкой»), поэтому обе роли получают одинаковый стиль. */
function isShelf(role: string | undefined): boolean {
  return role === 'shelf-fixed' || role === 'shelf-adjustable';
}

/**
 * Подпись детали в режиме debug-инфо. Для полки — состав из PROMPT 6 §27
 * (ширина, глубина, толщина, Y, секция); для остальных деталей — прежняя
 * короткая форма «роль · (x, y)».
 *
 * Все значения берутся из `DebugRect`, то есть в конечном счёте из
 * `GeometryResult`: ни одна величина здесь не вычисляется заново
 * (PROMPT 6 §27 «не дублировать формулы»).
 */
function debugLabelForPart(rect: DebugRect): string {
  const at = `(${String(rect.x)}, ${String(rect.y)})`;
  if (!isShelf(rect.role)) return `${rect.role ?? ''} · ${at}`;
  const depth = rect.depth === undefined ? '' : ` × Г${String(rect.depth)}`;
  const section = rect.sectionId === undefined ? '' : ` · секция ${rect.sectionId}`;
  return `${rect.role ?? ''} · Ш${String(rect.width)}${depth} × Т${String(rect.height)} · Y ${String(rect.y)}${section}`;
}

export interface DebugSchemaProps {
  readonly view: DebugSchemaView;
  /** Координаты и ID поверх схемы. По умолчанию выключено — не для конечного пользователя. */
  readonly showDebugInfo?: boolean;
}

export function DebugSchema({ view, showDebugInfo = false }: DebugSchemaProps): React.JSX.Element {
  const { totalWidth, totalHeight, rects, dimensions } = view;

  // Экранная Y растёт вниз; доменная — вверх. Переворот — единственное
  // место во всём компоненте, где это учитывается.
  const flipY = (domainY: number, height = 0): number => totalHeight - domainY - height;

  const viewBox = `${String(-MARGIN)} ${String(-MARGIN)} ${String(totalWidth + MARGIN * 2)} ${String(totalHeight + MARGIN * 2)}`;

  if (totalWidth <= 0 || totalHeight <= 0) {
    return (
      <svg className={styles.frame} viewBox="0 0 200 100" role="img" aria-label="Схема пуста: недопустимые габариты">
        <text x={100} y={50} className={styles.dimText}>
          нет геометрии
        </text>
      </svg>
    );
  }

  return (
    <svg className={styles.frame} viewBox={viewBox} role="img" aria-label="Техническая схема изделия">
      {rects.map((rect) => {
        const partClass = isShelf(rect.role) ? styles.shelfRect : styles.partRect;
        return (
          <Fragment key={rect.id}>
            <rect
              className={rect.kind === 'part' ? partClass : styles.cellRect}
              x={rect.x}
              y={flipY(rect.y, rect.height)}
              width={rect.width}
              height={rect.height}
            />
            {rect.kind === 'cell' ? (
              <text
                className={styles.cellLabel}
                x={rect.x + rect.width / 2}
                y={flipY(rect.y, rect.height) + rect.height / 2}
              >
                {rect.label}
              </text>
            ) : null}
            {showDebugInfo ? (
              <text
                className={styles.debugLabel}
                x={rect.x + rect.width / 2}
                y={flipY(rect.y, rect.height) + rect.height / 2 + (rect.kind === 'cell' ? 14 : 0)}
              >
                {rect.kind === 'part' ? debugLabelForPart(rect) : rect.id}
              </text>
            ) : null}
          </Fragment>
        );
      })}

      {dimensions.map((dim) => {
        if (dim.axis === 'x') {
          const y = flipY(dim.at) - DIM_LINE_OFFSET;
          return (
            <g key={dim.id}>
              <line className={styles.dimLine} x1={dim.from} y1={y} x2={dim.to} y2={y} />
              <line className={styles.dimTick} x1={dim.from} y1={y - TICK_SIZE} x2={dim.from} y2={y + TICK_SIZE} />
              <line className={styles.dimTick} x1={dim.to} y1={y - TICK_SIZE} x2={dim.to} y2={y + TICK_SIZE} />
              <text className={styles.dimText} x={(dim.from + dim.to) / 2} y={y - 10}>
                {dim.text}
              </text>
            </g>
          );
        }
        const x = dim.at - DIM_LINE_OFFSET;
        const yFrom = flipY(dim.from);
        const yTo = flipY(dim.to);
        return (
          <g key={dim.id}>
            <line className={styles.dimLine} x1={x} y1={yFrom} x2={x} y2={yTo} />
            <line className={styles.dimTick} x1={x - TICK_SIZE} y1={yFrom} x2={x + TICK_SIZE} y2={yFrom} />
            <line className={styles.dimTick} x1={x - TICK_SIZE} y1={yTo} x2={x + TICK_SIZE} y2={yTo} />
            <text
              className={styles.dimText}
              x={x - 16}
              y={(yFrom + yTo) / 2}
              transform={`rotate(-90, ${String(x - 16)}, ${String((yFrom + yTo) / 2)})`}
            >
              {dim.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
