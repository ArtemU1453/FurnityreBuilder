import { Fragment, useRef, useState } from 'react';
import { formatMm } from '../domain/index.js';
import type { PartDrawingView } from '../export/index.js';
import styles from './PartDrawing.module.css';

/**
 * Технический чертёж детали (PROMPT 29 §10, §13, §40).
 *
 * ## Рисуется только рассчитанное
 *
 * Контур — габарит позиции деталировки, отверстия — операции присадки как
 * их посчитал Drilling Engine, размеры — те же числа. Условной картинки,
 * не связанной с расчётом, здесь нет: если отверстий не рассчитано, на
 * чертеже их нет, и об этом сказано словами.
 *
 * ## Масштаб не меняет числа
 *
 * Зум меняет ТОЛЬКО экранный размер svg; `viewBox` остаётся в
 * миллиметрах детали. Поэтому «600» на выноске остаётся «600» при любом
 * масштабе — меняется кегль, а не значение (§13).
 *
 * ## Доступность
 *
 * У svg есть текстовое описание всего чертежа целиком —
 * `PartDrawingView.description`, — и оно не подпись «схема детали», а те
 * же данные словами: габарит, материал, кромка, текстура и каждое
 * отверстие с координатами. Рядом лежит обычный список отверстий,
 * доступный с клавиатуры (§42).
 */

/** Поля вокруг контура: место для выносных размеров, мм. */
const MARGIN = 90;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.4;

export interface PartDrawingProps {
  readonly view: PartDrawingView;
  /** Выбранное отверстие: подсвечивается на чертеже и в списке. */
  readonly selectedHoleId?: string;
  readonly onSelectHole?: (id: string | undefined) => void;
}

export function PartDrawing({
  view,
  selectedHoleId,
  onSelectHole,
}: PartDrawingProps): React.JSX.Element {
  // 1 — «вписать»: ширина svg равна ширине контейнера. Больше единицы —
  // увеличение, и тогда контейнер прокручивается (это и есть pan).
  const [zoom, setZoom] = useState(1);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const flipY = (y: number): number => view.width - y;
  const viewBox = [-MARGIN, -MARGIN, view.length + MARGIN * 2, view.width + MARGIN * 2]
    .map((n) => String(n))
    .join(' ');

  const setClamped = (next: number): void => {
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.controls}>
        <span className={styles.zoomValue}>{`${String(Math.round(zoom * 100))} %`}</span>
        <button
          type="button"
          className={styles.control}
          onClick={() => {
            setClamped(zoom / ZOOM_STEP);
          }}
          aria-label="Уменьшить"
        >
          −
        </button>
        <button
          type="button"
          className={styles.control}
          onClick={() => {
            setClamped(zoom * ZOOM_STEP);
          }}
          aria-label="Увеличить"
        >
          +
        </button>
        <button
          type="button"
          className={styles.control}
          onClick={() => {
            setZoom(1);
          }}
        >
          Вписать
        </button>
      </div>

      <div
        className={styles.canvas}
        // Два пальца масштабируют чертёж, один — прокручивает (это pan).
        // Тот же приём, что на сцене: жест ведёт указатель, а не отдельная
        // touch-архитектура (PROMPT 28, docs/TOUCH_INTERACTIONS.md).
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return;
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => {
          if (!touches.current.has(event.pointerId)) return;
          touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (touches.current.size !== 2) return;
          const [a, b] = [...touches.current.values()];
          if (a === undefined || b === undefined) return;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const previous = pinch.current;
          if (previous !== null && previous > 0) setClamped(zoom * (distance / previous));
          pinch.current = distance;
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId);
          if (touches.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId);
          if (touches.current.size < 2) pinch.current = null;
        }}
      >
        <svg
          className={styles.sheet}
          style={{ width: `${String(zoom * 100)}%` }}
          viewBox={viewBox}
          role="img"
          aria-label={view.description}
        >
          {/* Контур детали. */}
          <rect className={styles.outline} x={0} y={0} width={view.length} height={view.width} />

          {/* Кромка: полоса вдоль стороны, к которой она приклеена. */}
          {view.edges.map((edge) => {
            const band = Math.max(6, Math.min(view.length, view.width) * 0.02);
            const geometry =
              edge.side === 'front'
                ? { x: 0, y: view.width - band, width: view.length, height: band }
                : edge.side === 'back'
                  ? { x: 0, y: 0, width: view.length, height: band }
                  : edge.side === 'left'
                    ? { x: 0, y: 0, width: band, height: view.width }
                    : { x: view.length - band, y: 0, width: band, height: view.width };
            return (
              <rect
                key={edge.side}
                className={styles.edgeBand}
                x={geometry.x}
                y={geometry.y}
                width={geometry.width}
                height={geometry.height}
              >
                <title>{`Кромка ${edge.sideLabel}: ${formatMm(edge.thickness)} мм`}</title>
              </rect>
            );
          })}

          {/* Направление текстуры: стрелка вдоль соответствующей оси. */}
          {view.grainLabel === undefined ? null : (
            <g className={styles.grain}>
              <line
                x1={view.length * 0.1}
                y1={flipY(view.width * 0.5)}
                x2={view.grain === 'along-length' ? view.length * 0.9 : view.length * 0.1}
                y2={
                  view.grain === 'along-length' ? flipY(view.width * 0.5) : flipY(view.width * 0.9)
                }
              />
              <text
                className={styles.grainLabel}
                x={view.length * 0.12}
                y={flipY(view.width * 0.5) - 12}
              >
                {`текстура ${view.grainLabel}`}
              </text>
            </g>
          )}

          {/* Габаритные размеры. */}
          <g className={styles.dimension}>
            <line x1={0} y1={view.width + 30} x2={view.length} y2={view.width + 30} />
            <text className={styles.dimensionLabel} x={view.length / 2} y={view.width + 66}>
              {`${formatMm(view.length)} мм`}
            </text>
            <line x1={-30} y1={0} x2={-30} y2={view.width} />
            <text className={styles.dimensionLabel} x={-40} y={view.width / 2} textAnchor="end">
              {`${formatMm(view.width)} мм`}
            </text>
          </g>

          {/* Отверстия пласти: положение как посчитал Drilling Engine. */}
          {view.holes.map((hole) => {
            const active = hole.id === selectedHoleId;
            return (
              <Fragment key={hole.id}>
                <circle
                  className={active ? styles.holeActive : styles.hole}
                  cx={hole.x}
                  cy={flipY(hole.y)}
                  r={Math.max(hole.diameter / 2, 2)}
                  onClick={() => {
                    onSelectHole?.(active ? undefined : hole.id);
                  }}
                >
                  <title>{`${hole.label} · X ${formatMm(hole.x)} · Y ${formatMm(hole.y)}`}</title>
                </circle>
                {!active ? null : (
                  <g className={styles.holeDimension}>
                    <line x1={0} y1={flipY(hole.y)} x2={hole.x} y2={flipY(hole.y)} />
                    <line x1={hole.x} y1={view.width} x2={hole.x} y2={flipY(hole.y)} />
                    <text className={styles.dimensionLabel} x={hole.x / 2} y={flipY(hole.y) - 8}>
                      {`${formatMm(hole.x)} мм`}
                    </text>
                    <text
                      className={styles.dimensionLabel}
                      x={hole.x + 8}
                      y={flipY(hole.y / 2)}
                      textAnchor="start"
                    >
                      {`${formatMm(hole.y)} мм`}
                    </text>
                  </g>
                )}
              </Fragment>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
