import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMm } from '../../domain/index.js';
import { DragController } from '../../interaction/index.js';
import type { NodeId, PartId } from '../../domain/index.js';
import type { DebugSchemaView } from '../../render/index.js';
import { canvasScale, resizeValue } from './resize.js';
import styles from './EditorCanvas.module.css';

/**
 * Холст редактора (PROMPT 22 §4–§5, §21–§23).
 *
 * ## Здесь не считают мебель
 *
 * Компонент получает ГОТОВУЮ модель вида (`DebugSchemaView`), собранную
 * `buildDebugView` из результата геометрического движка, и рисует
 * прямоугольники. Ни одной мебельной формулы здесь нет и быть не может
 * (§30): холст не знает, что такое толщина панели или ширина секции.
 *
 * ## Перетаскивание
 *
 * Жест ведёт `DragController` (PROMPT 2): захват указателя, порог начала,
 * отмена по Esc, скорость на отпускании. Во время движения ДОМЕН НЕ
 * ТРОГАЕТСЯ — меняется только локальное состояние предпросмотра, и на
 * каждый кадр не запускается ни геометрия, ни производственный расчёт
 * (§23). Команда отправляется один раз, на отпускании.
 *
 * ## Доступность
 *
 * Каждый выбираемый объект — кнопка с именем и фокусом: выбрать деталь
 * можно с клавиатуры, а не только указателем. Ручки изменения размера
 * дублированы полями ввода в боковой панели — жест не единственный способ
 * задать габарит.
 */

const MARGIN = 60;
/** Ширина полосы захвата ручки: тонкую линию не поймать пальцем. */
const HANDLE_PX = 14;

export type ResizeAxis = 'width' | 'height';

export interface EditorCanvasProps {
  readonly view: DebugSchemaView;
  readonly selectedParts: readonly PartId[];
  readonly selectedNodes: readonly NodeId[];
  readonly hoveredNode: NodeId | undefined;
  readonly width: number;
  readonly height: number;
  readonly onSelectPart: (id: PartId) => void;
  readonly onSelectNode: (id: NodeId) => void;
  readonly onHoverNode: (id: NodeId | undefined) => void;
  readonly onClearSelection: () => void;
  readonly onResizeCommit: (axis: ResizeAxis, value: number) => void;
  /** Границы габарита: те же, что проверяет валидация модели. */
  readonly limits: { readonly min: number; readonly max: number };
}

interface Preview {
  readonly axis: ResizeAxis;
  readonly value: number;
  readonly snapped: boolean;
}

export function EditorCanvas(props: EditorCanvasProps): React.JSX.Element {
  const { view } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [preview, setPreview] = useState<Preview | undefined>(undefined);

  const totalWidth = view.totalWidth;
  const totalHeight = view.totalHeight;
  const flipY = useCallback((y: number, height = 0): number => totalHeight - y - height, [totalHeight]);

  /** Пикселей на миллиметр: по фактическому размеру холста на экране. */
  const scaleOf = useCallback((): number => {
    const element = svgRef.current;
    const box = element?.getBoundingClientRect();
    return canvasScale(box?.width ?? 0, totalWidth + MARGIN * 2);
  }, [totalWidth]);

  // Контроллеры жеста живут между рендерами: пересоздавать их на каждый
  // кадр движения значило бы терять фазу жеста.
  const controllers = useMemo(() => {
    const make = (axis: ResizeAxis): DragController<number> =>
      new DragController<number>({
        onStart: () => (axis === 'width' ? props.width : props.height),
        onMove: (frame, base) => {
          const result = resizeValue({
            base,
            deltaPx: axis === 'width' ? frame.dx : -frame.dy,
            scale: scaleOf(),
            min: props.limits.min,
            max: props.limits.max,
            modifiers: { shift: frame.shiftKey, alt: frame.altKey },
          });
          setPreview({ axis, value: result.value, snapped: result.snapped !== undefined });
        },
        onCommit: (end, base) => {
          const result = resizeValue({
            base,
            deltaPx: axis === 'width' ? end.dx : -end.dy,
            scale: scaleOf(),
            min: props.limits.min,
            max: props.limits.max,
            modifiers: { shift: end.shiftKey, alt: end.altKey },
          });
          setPreview(undefined);
          // Команда отправляется РОВНО ОДИН раз, на отпускании: иначе
          // история наполнилась бы сотней шагов на один жест.
          props.onResizeCommit(axis, result.value);
        },
        onCancel: () => {
          setPreview(undefined);
        },
      });
    return { width: make('width'), height: make('height') };
  }, [props, scaleOf]);

  // Esc отменяет жест — до отпускания указателя, как требует
  // прерываемость (docs/INTERACTION_MODEL.md).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      controllers.width.cancel();
      controllers.height.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [controllers]);

  const handleProps = (axis: ResizeAxis): React.SVGProps<SVGRectElement> => ({
    onPointerDown: (event) => {
      event.preventDefault();
      controllers[axis].pointerDown(event.nativeEvent, event.currentTarget);
    },
    onPointerMove: (event) => {
      controllers[axis].pointerMove(event.nativeEvent);
    },
    onPointerUp: (event) => {
      controllers[axis].pointerUp(event.nativeEvent);
    },
    onPointerCancel: () => {
      controllers[axis].cancel();
    },
  });

  const viewBox = `${String(-MARGIN)} ${String(-MARGIN)} ${String(totalWidth + MARGIN * 2)} ${String(totalHeight + MARGIN * 2)}`;

  if (totalWidth <= 0 || totalHeight <= 0) {
    return (
      <svg className={styles.canvas} viewBox="0 0 200 100" role="img" aria-label="Изделие не построено: проверьте габариты">
        <text x={100} y={50} className={styles.emptyText}>
          нет геометрии
        </text>
      </svg>
    );
  }

  const previewWidth = preview?.axis === 'width' ? preview.value : totalWidth;
  const previewHeight = preview?.axis === 'height' ? preview.value : totalHeight;

  return (
    <svg
      ref={svgRef}
      className={styles.canvas}
      viewBox={viewBox}
      role="application"
      aria-label="Схема изделия. Объекты выбираются щелчком или с клавиатуры."
      onPointerDown={(event) => {
        // Щелчок по пустому месту снимает выделение — предсказуемое
        // поведение прямого манипулирования.
        if (event.target === event.currentTarget) props.onClearSelection();
      }}
    >
      {view.rects.map((rect) => {
        const isPart = rect.kind === 'part';
        const selected = isPart
          ? props.selectedParts.includes(rect.id as PartId)
          : props.selectedNodes.includes(rect.id as NodeId);
        const hovered = !isPart && props.hoveredNode === (rect.id as NodeId);
        const select = (): void => {
          if (isPart) props.onSelectPart(rect.id as PartId);
          else props.onSelectNode(rect.id as NodeId);
        };
        return (
          <Fragment key={rect.id}>
            <rect
              className={[
                isPart ? styles.part : styles.cell,
                selected ? styles.selected : undefined,
                hovered ? styles.hovered : undefined,
              ]
                .filter(Boolean)
                .join(' ')}
              x={rect.x}
              y={flipY(rect.y, rect.height)}
              width={rect.width}
              height={rect.height}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${rect.label}, ${formatMm(rect.width)} на ${formatMm(rect.height)} миллиметров`}
              onPointerDown={(event) => {
                event.stopPropagation();
                select();
              }}
              onPointerEnter={() => {
                if (!isPart) props.onHoverNode(rect.id as NodeId);
              }}
              onPointerLeave={() => {
                if (!isPart) props.onHoverNode(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  select();
                }
              }}
            />
          </Fragment>
        );
      })}

      {/* Предпросмотр габарита во время жеста: пунктир и подпись. Домен в
          этот момент не меняется — на схеме остаётся прежнее изделие. */}
      {preview === undefined ? null : (
        <>
          <rect
            className={preview.snapped ? styles.previewSnapped : styles.preview}
            x={0}
            y={flipY(previewHeight)}
            width={previewWidth}
            height={previewHeight}
          />
          <text className={styles.previewLabel} x={previewWidth / 2} y={flipY(previewHeight) - 10}>
            {preview.axis === 'width' ? 'Ширина' : 'Высота'} {formatMm(preview.value)} мм
          </text>
        </>
      )}

      {/* Ручки изменения габарита. Полоса шире линии: тонкую грань не
          поймать ни мышью, ни пальцем. */}
      <rect
        className={styles.handleVertical}
        x={totalWidth - HANDLE_PX / 2}
        y={0}
        width={HANDLE_PX}
        height={totalHeight}
        aria-label="Изменить ширину изделия перетаскиванием"
        {...handleProps('width')}
      />
      <rect
        className={styles.handleHorizontal}
        x={0}
        y={-HANDLE_PX / 2}
        width={totalWidth}
        height={HANDLE_PX}
        aria-label="Изменить высоту изделия перетаскиванием"
        {...handleProps('height')}
      />
    </svg>
  );
}
