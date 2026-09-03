import { Fragment } from 'react';
import type { DebugSchemaView } from './debug-view.js';
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
/** Насколько подпись секции поднята над её низом, чтобы не сливаться с дном. */
const SECTION_LABEL_OFFSET: number = 18;
/** Вторая строка подписи (ширина, X, id) — под первой. */
const SECTION_DETAIL_OFFSET: number = 14;
/** Строка наполнения — над размерами ячейки, чтобы читались обе. */
const CONTENT_LABEL_OFFSET: number = 15;

/** Горизонтальный разделитель (§9.5) и полка наполнения (PROMPT 6) — физически один
 * и тот же тип детали (`docs/GEOMETRY_RULES.md` §9.5: «горизонтальный разделитель
 * физически является полкой»), поэтому обе роли получают одинаковый стиль. */
function isShelf(role: string | undefined): boolean {
  return role === 'shelf-fixed' || role === 'shelf-adjustable';
}

export interface DebugSchemaProps {
  readonly view: DebugSchemaView;
  /** Координаты и ID поверх схемы. По умолчанию выключено — не для конечного пользователя. */
  readonly showDebugInfo?: boolean;
}

export function DebugSchema({ view, showDebugInfo = false }: DebugSchemaProps): React.JSX.Element {
  const { totalWidth, totalHeight, rects, dimensions, sectionLabels } = view;

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
      {/* Подписи секций идут ПЕРВЫМИ, под прямоугольниками: секция —
          область, а не деталь, и не должна перекрывать то, что в ней стоит. */}
      {sectionLabels.map((section) => (
        <Fragment key={`section-${section.id}`}>
          <text className={styles.sectionTitle} x={section.centerX} y={flipY(section.bottomY) - SECTION_LABEL_OFFSET}>
            {section.title}
          </text>
          {showDebugInfo ? (
            <text
              className={styles.sectionDetail}
              x={section.centerX}
              y={flipY(section.bottomY) - SECTION_LABEL_OFFSET + SECTION_DETAIL_OFFSET}
            >
              {section.detail}
            </text>
          ) : null}
        </Fragment>
      ))}

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
              <>
                <text
                  className={styles.cellLabel}
                  x={rect.x + rect.width / 2}
                  y={flipY(rect.y, rect.height) + rect.height / 2}
                >
                  {rect.label}
                </text>
                {rect.content === undefined ? null : (
                  <text
                    className={styles.cellContent}
                    x={rect.x + rect.width / 2}
                    y={flipY(rect.y, rect.height) + rect.height / 2 - CONTENT_LABEL_OFFSET}
                  >
                    {rect.content}
                  </text>
                )}
              </>
            ) : null}
            {showDebugInfo ? (
              <text
                className={styles.debugLabel}
                x={rect.x + rect.width / 2}
                y={flipY(rect.y, rect.height) + rect.height / 2 + (rect.kind === 'cell' ? 14 : 0)}
              >
                {rect.detail}
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
