import { Fragment } from 'react';
import type { CuttingMapView } from './cutting-view.js';
import styles from './CuttingMap.module.css';

/**
 * Технический рендерер карты раскроя (PROMPT 17 §30).
 *
 * НЕ финальный интерфейс и не редактор: деталь нельзя взять и передвинуть
 * (§36). Задача одна — показать то, что посчитал алгоритм, включая то, что
 * он посчитать не смог: неразмещённые детали выводятся текстом рядом с
 * листами, а не прячутся.
 *
 * Инверсия оси Y — по формуле на каждый элемент, а не трансформацией всей
 * сцены: `scale(1,-1)` зеркалит и подписи. Тот же приём, что в
 * `DebugSchema`.
 *
 * Доступность: каждый лист — самостоятельное изображение с текстовым
 * описанием, а сводка и список неразмещённых деталей существуют как
 * обычный текст, читаемый скринридером. Анимации нет вовсе, поэтому
 * `prefers-reduced-motion` соблюдается по построению.
 *
 * ## Выбор детали на карте (PROMPT 29 §20)
 *
 * Прямоугольник можно нажать, и выбранные подсвечиваются. Своего
 * состояния выбора у карты при этом НЕТ: она получает множество
 * подсвеченных идентификаторов снаружи и сообщает наружу о нажатии.
 * Выбранная деталь одна на все производственные разделы, и второе
 * состояние выбора рано или поздно разошлось бы с первым (§29).
 */

const MARGIN = 40;

export interface CuttingMapProps {
  readonly view: CuttingMapView;
  /** Идентификаторы размещений, которые нужно подсветить. */
  readonly highlightedRectIds?: ReadonlySet<string>;
  readonly onSelectRect?: (rectId: string) => void;
}

export function CuttingMap({
  view,
  highlightedRectIds,
  onSelectRect,
}: CuttingMapProps): React.JSX.Element {
  return (
    <div>
      <p className={styles.summary}>{view.totals}</p>

      {view.sheets.map((sheet) => {
        const flipY = (y: number, height = 0): number => sheet.stockHeight - y - height;
        const viewBox = `${String(-MARGIN)} ${String(-MARGIN * 2)} ${String(sheet.stockWidth + MARGIN * 2)} ${String(sheet.stockHeight + MARGIN * 3)}`;
        return (
          <Fragment key={sheet.id}>
            <svg className={styles.sheet} viewBox={viewBox} role="img" aria-label={sheet.title}>
              <text className={styles.title} x={0} y={-MARGIN}>
                {sheet.title}
              </text>
              <rect
                className={styles.stockRect}
                x={0}
                y={0}
                width={sheet.stockWidth}
                height={sheet.stockHeight}
              />
              <rect
                className={styles.usableRect}
                x={sheet.usable.x}
                y={flipY(sheet.usable.y, sheet.usable.height)}
                width={sheet.usable.width}
                height={sheet.usable.height}
              />
              {sheet.rects.map((rect) => (
                <Fragment key={rect.id}>
                  <rect
                    className={rect.rotated ? styles.rotatedRect : styles.partRect}
                    data-active={highlightedRectIds?.has(rect.id) === true ? '' : undefined}
                    data-clickable={onSelectRect === undefined ? undefined : ''}
                    x={rect.x}
                    y={flipY(rect.y, rect.height)}
                    width={rect.width}
                    height={rect.height}
                    onClick={() => {
                      onSelectRect?.(rect.id);
                    }}
                  >
                    <title>{`${rect.label} · ${rect.detail}`}</title>
                  </rect>
                  <text
                    className={styles.partLabel}
                    x={rect.x + rect.width / 2}
                    y={flipY(rect.y + rect.height / 2)}
                  >
                    {rect.label}
                  </text>
                  <text
                    className={styles.partDetail}
                    x={rect.x + rect.width / 2}
                    y={flipY(rect.y + rect.height / 2) + 30}
                  >
                    {rect.detail}
                  </text>
                </Fragment>
              ))}
            </svg>
            <p className={styles.summary}>{sheet.summary}</p>
          </Fragment>
        );
      })}

      {view.unplaced.length === 0 ? null : (
        <ul className={styles.textList}>
          {view.unplaced.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
