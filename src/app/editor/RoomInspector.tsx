import { formatMm } from '../../domain/index.js';
import type { FurnitureInstance, InstanceId, Room, Vec3 } from '../../domain/index.js';
import { instanceKey, isRectangular, roomSize } from '../../room/index.js';
import type { ExtentLookup, RoomStatus } from '../../room/index.js';
import {
  Button,
  EmptyState,
  NumberInput,
  Panel,
  StatusIndicator,
  Switch,
} from '../../design-system/index.js';
import { ROOM_STATUS } from '../status.js';
import { footprintLabel } from './RoomPlanner.js';
import styles from './EditorPanels.module.css';

/**
 * Инспектор помещения (PROMPT 24 §24, PROMPT 26 §12–§13).
 *
 * ## Управление без сцены
 *
 * Всё, что делается перетаскиванием, делается и здесь: положение,
 * поворот, блокировка, видимость. Это не дублирование ради галочки —
 * без него планировщик был бы недоступен с клавиатуры, а сцена стала бы
 * единственным способом управления.
 *
 * ## Только относящееся к выбранному (§13)
 *
 * Панель «Выбранный объект» появляется, когда объект выбран, и исчезает,
 * когда нет. Показывать поля положения при пустом выделении значило бы
 * предлагать править то, чего не выбрано.
 */

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

export function RoomInspector(props: RoomInspectorProps): React.JSX.Element {
  const size = roomSize(props.room);
  const rectangular = isRectangular(props.room);
  const selected = props.selected;
  const extent = selected === undefined ? undefined : props.extents.get(instanceKey(selected));
  const status = ROOM_STATUS[props.status];

  return (
    <>
      <Panel id="room" title={props.room.name}>
        <StatusIndicator
          tone={status.tone}
          label={status.label}
          {...(status.hint === undefined ? {} : { detail: status.hint })}
          live
        />

        {/*
          Габарит правится только у прямоугольной комнаты: у произвольного
          контура «ширина» не определена, и молча превратить его в
          прямоугольник значило бы уничтожить ниши и выступы. Поля
          выключаются с объяснением, а не исчезают.
        */}
        <NumberInput
          label="Ширина"
          unit="мм"
          value={size.width}
          min={1}
          disabled={!rectangular}
          onChange={(value) => {
            props.onRoomSize(value, size.depth, size.height);
          }}
        />
        <NumberInput
          label="Глубина"
          unit="мм"
          value={size.depth}
          min={1}
          disabled={!rectangular}
          onChange={(value) => {
            props.onRoomSize(size.width, value, size.height);
          }}
        />
        <NumberInput
          label="Высота"
          unit="мм"
          value={size.height}
          min={1}
          disabled={!rectangular}
          onChange={(value) => {
            props.onRoomSize(size.width, size.depth, value);
          }}
        />
        <NumberInput
          label="Уровень пола"
          unit="мм"
          value={props.room.floor.elevation}
          hint="Подиум поднимает мебель: шкаф, помещавшийся на полу, на подиуме может упереться в потолок."
          onChange={props.onFloorElevation}
        />
        <Switch
          label="Показывать потолок"
          checked={props.room.ceiling.visible}
          onChange={props.onCeilingVisible}
        />

        {rectangular ? null : (
          <p className={styles.subtitle}>
            Контур помещения не прямоугольный: габарит задаётся стенами. Правка ширины и глубины для
            него не определена.
          </p>
        )}
      </Panel>

      <Panel id="room-structure" title="Конструкция" tone="sunken">
        <dl className={styles.rows}>
          {props.room.walls.map((wall, index) => (
            <div key={wall.id} className={styles.row}>
              <dt className={styles.rowLabel}>Стена {index + 1}</dt>
              <dd className={styles.rowValue}>
                {formatMm(Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z))} ×{' '}
                {formatMm(wall.height)} мм, толщина {formatMm(wall.thickness)}
              </dd>
            </div>
          ))}
          {props.room.openings.map((opening) => (
            <div key={opening.id} className={styles.row}>
              <dt className={styles.rowLabel}>
                {opening.kind === 'door' ? 'Дверь' : opening.kind === 'window' ? 'Окно' : 'Проём'}
              </dt>
              <dd className={styles.rowValue}>
                {formatMm(opening.width)} × {formatMm(opening.height)} мм, от{' '}
                {formatMm(opening.position)}
              </dd>
            </div>
          ))}
          {props.room.obstacles.map((obstacle) => (
            <div key={obstacle.id} className={styles.row}>
              <dt className={styles.rowLabel}>{obstacle.name ?? obstacle.kind}</dt>
              <dd className={styles.rowValue}>
                {formatMm(obstacle.size.x)} × {formatMm(obstacle.size.y)} ×{' '}
                {formatMm(obstacle.size.z)} мм
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel id="room-furniture" title="Мебель в помещении">
        {props.room.furnitureInstances.length === 0 ? (
          <EmptyState
            compact
            title="В помещении пока нет мебели"
            description="Выберите проект из библиотеки слева и разместите его."
          />
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
      </Panel>

      {selected === undefined ? null : (
        <Panel
          id="room-selection"
          title="Выбранный объект"
          subtitle={footprintLabel(selected, extent)}
        >
          <NumberInput
            label="Положение X"
            unit="мм"
            value={selected.position.x}
            disabled={selected.locked}
            onChange={(value) => {
              props.onMove(selected.id, { ...selected.position, x: value });
            }}
          />
          <NumberInput
            label="Положение Z"
            unit="мм"
            value={selected.position.z}
            disabled={selected.locked}
            onChange={(value) => {
              props.onMove(selected.id, { ...selected.position, z: value });
            }}
          />

          <Switch
            label="Заблокировано"
            hint="Заблокированный объект не двигается случайным жестом."
            checked={selected.locked}
            onChange={(locked) => {
              props.onFlags(selected.id, { locked });
            }}
          />
          <Switch
            label="Показывать объект"
            checked={selected.visible}
            onChange={(visible) => {
              props.onFlags(selected.id, { visible });
            }}
          />

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
                props.onDuplicate(selected.id);
              }}
            >
              Дублировать
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                props.onRemove(selected.id);
              }}
            >
              Убрать из помещения
            </Button>
          </div>
        </Panel>
      )}
    </>
  );
}
