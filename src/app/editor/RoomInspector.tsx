import { formatMm } from '../../domain/index.js';
import type { FurnitureInstance, InstanceId, Room, Vec3 } from '../../domain/index.js';
import { instanceKey, isRectangular, roomSize } from '../../room/index.js';
import type { ExtentLookup, RoomStatus } from '../../room/index.js';
import { Button } from '../../design-system/index.js';
import { footprintLabel } from './RoomPlanner.js';
import styles from './EditorPanels.module.css';

/**
 * Инспектор помещения (PROMPT 24 §24).
 *
 * ## Управление без сцены
 *
 * Всё, что делается перетаскиванием, делается и здесь: положение,
 * поворот, блокировка, видимость. Это не дублирование ради галочки —
 * без него планировщик был бы недоступен с клавиатуры, а сцена стала бы
 * единственным способом управления.
 */

const STATUS_LABELS: Readonly<Record<RoomStatus, string>> = {
  VALID: 'Размещение корректно',
  WARNING: 'Есть замечания к размещению',
  INVALID: 'Размещение невозможно',
  NEEDS_CONFIRMATION: 'Правила проходов не заданы',
};

export interface RoomInspectorProps {
  readonly room: Room;
  readonly extents: ExtentLookup;
  readonly status: RoomStatus;
  readonly selected: FurnitureInstance | undefined;
  readonly furnitureNames: ReadonlyMap<string, string>;
  readonly onRoomSize: (width: number, depth: number, height: number) => void;
  readonly onFloorElevation: (value: number) => void;
  readonly onCeilingVisible: (value: boolean) => void;
  readonly onMove: (id: InstanceId, position: Vec3) => void;
  readonly onRotate: (id: InstanceId) => void;
  readonly onFlags: (id: InstanceId, patch: { locked?: boolean; visible?: boolean }) => void;
  readonly onDuplicate: (id: InstanceId) => void;
  readonly onRemove: (id: InstanceId) => void;
}

const number = (value: string, fallback: number): number => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function RoomInspector(props: RoomInspectorProps): React.JSX.Element {
  const size = roomSize(props.room);
  const rectangular = isRectangular(props.room);
  const selected = props.selected;
  const extent = selected === undefined ? undefined : props.extents.get(instanceKey(selected));

  return (
    <aside className={styles.inspector} aria-label="Свойства помещения">
      <h2 className={styles.panelTitle}>{props.room.name}</h2>
      <p className={styles.subtitle}>{STATUS_LABELS[props.status]}</p>

      <div className={styles.rows}>
        <label className={styles.row}>
          <span className={styles.rowLabel}>Ширина, мм</span>
          <input
            className={styles.rowValue}
            type="number"
            value={size.width}
            disabled={!rectangular}
            onChange={(event) => {
              props.onRoomSize(number(event.target.value, size.width), size.depth, size.height);
            }}
          />
        </label>
        <label className={styles.row}>
          <span className={styles.rowLabel}>Глубина, мм</span>
          <input
            className={styles.rowValue}
            type="number"
            value={size.depth}
            disabled={!rectangular}
            onChange={(event) => {
              props.onRoomSize(size.width, number(event.target.value, size.depth), size.height);
            }}
          />
        </label>
        <label className={styles.row}>
          <span className={styles.rowLabel}>Высота, мм</span>
          <input
            className={styles.rowValue}
            type="number"
            value={size.height}
            disabled={!rectangular}
            onChange={(event) => {
              props.onRoomSize(size.width, size.depth, number(event.target.value, size.height));
            }}
          />
        </label>
        <label className={styles.row}>
          <span className={styles.rowLabel}>Уровень пола, мм</span>
          <input
            className={styles.rowValue}
            type="number"
            value={props.room.floor.elevation}
            onChange={(event) => {
              props.onFloorElevation(number(event.target.value, props.room.floor.elevation));
            }}
          />
        </label>
        <label className={styles.row}>
          <span className={styles.rowLabel}>Показывать потолок</span>
          <input
            type="checkbox"
            checked={props.room.ceiling.visible}
            onChange={(event) => {
              props.onCeilingVisible(event.target.checked);
            }}
          />
        </label>
      </div>

      {/*
        Габарит правится только у прямоугольной комнаты: у произвольного
        контура «ширина» не определена, и молча превратить его в
        прямоугольник значило бы уничтожить ниши и выступы. Поле
        выключается с объяснением, а не исчезает.
      */}
      {rectangular ? null : (
        <p className={styles.pending}>
          Контур помещения не прямоугольный: габарит задаётся стенами. Правка ширины и глубины для него не определена.
        </p>
      )}

      <h3 className={styles.panelTitle}>Стены</h3>
      <dl className={styles.rows}>
        {props.room.walls.map((wall, index) => (
          <div key={wall.id} className={styles.row}>
            <dt className={styles.rowLabel}>Стена {index + 1}</dt>
            <dd className={styles.rowValue}>
              {formatMm(Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z))} × {formatMm(wall.height)} мм, толщина{' '}
              {formatMm(wall.thickness)}
            </dd>
          </div>
        ))}
      </dl>

      {props.room.openings.length === 0 ? null : (
        <>
          <h3 className={styles.panelTitle}>Проёмы</h3>
          <dl className={styles.rows}>
            {props.room.openings.map((opening) => (
              <div key={opening.id} className={styles.row}>
                <dt className={styles.rowLabel}>
                  {opening.kind === 'door' ? 'Дверь' : opening.kind === 'window' ? 'Окно' : 'Проём'}
                </dt>
                <dd className={styles.rowValue}>
                  {formatMm(opening.width)} × {formatMm(opening.height)} мм, от {formatMm(opening.position)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {props.room.obstacles.length === 0 ? null : (
        <>
          <h3 className={styles.panelTitle}>Препятствия</h3>
          <dl className={styles.rows}>
            {props.room.obstacles.map((obstacle) => (
              <div key={obstacle.id} className={styles.row}>
                <dt className={styles.rowLabel}>{obstacle.name ?? obstacle.kind}</dt>
                <dd className={styles.rowValue}>
                  {formatMm(obstacle.size.x)} × {formatMm(obstacle.size.y)} × {formatMm(obstacle.size.z)} мм
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h3 className={styles.panelTitle}>Мебель в помещении</h3>
      {props.room.furnitureInstances.length === 0 ? (
        <p className={styles.pending}>Мебель ещё не расставлена.</p>
      ) : (
        <dl className={styles.rows}>
          {props.room.furnitureInstances.map((instance) => (
            <div key={instance.id} className={styles.row}>
              <dt className={styles.rowLabel}>
                {props.furnitureNames.get(instance.furnitureId) ?? instance.furnitureId}
              </dt>
              <dd className={styles.rowValue}>
                X {formatMm(instance.position.x)} · Z {formatMm(instance.position.z)}
                {instance.locked ? ' · заблокировано' : ''}
                {instance.visible ? '' : ' · скрыто'}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {selected === undefined ? null : (
        <>
          <h3 className={styles.panelTitle}>Выбранный объект</h3>
          <div className={styles.rows}>
            <label className={styles.row}>
              <span className={styles.rowLabel}>Положение X, мм</span>
              <input
                className={styles.rowValue}
                type="number"
                value={selected.position.x}
                onChange={(event) => {
                  props.onMove(selected.id, { ...selected.position, x: number(event.target.value, selected.position.x) });
                }}
              />
            </label>
            <label className={styles.row}>
              <span className={styles.rowLabel}>Положение Z, мм</span>
              <input
                className={styles.rowValue}
                type="number"
                value={selected.position.z}
                onChange={(event) => {
                  props.onMove(selected.id, { ...selected.position, z: number(event.target.value, selected.position.z) });
                }}
              />
            </label>
            <div className={styles.row}>
              <span className={styles.rowLabel}>След</span>
              <span className={styles.rowValue}>{footprintLabel(selected, extent)}</span>
            </div>
          </div>

          <div className={styles.actions}>
            <Button
              onClick={() => {
                props.onRotate(selected.id);
              }}
              disabled={selected.locked}
            >
              Повернуть на 90°
            </Button>
            <Button
              onClick={() => {
                props.onFlags(selected.id, { locked: !selected.locked });
              }}
            >
              {selected.locked ? 'Разблокировать' : 'Заблокировать'}
            </Button>
            <Button
              onClick={() => {
                props.onFlags(selected.id, { visible: !selected.visible });
              }}
            >
              {selected.visible ? 'Скрыть' : 'Показать'}
            </Button>
            <Button
              onClick={() => {
                props.onDuplicate(selected.id);
              }}
            >
              Дублировать
            </Button>
            <Button
              onClick={() => {
                props.onRemove(selected.id);
              }}
            >
              Убрать из помещения
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}
