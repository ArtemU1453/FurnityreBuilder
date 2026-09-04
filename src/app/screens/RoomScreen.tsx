import { useState } from 'react';
import type {
  FurnitureInstance,
  InstanceId,
  MaterialLibrary,
  ProjectId,
  Room,
  Vec3,
} from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';
import type { ExtentLookup, RoomStatus } from '../../room/index.js';
import type { ProjectSummary } from '../../persistence/index.js';
import {
  Button,
  EmptyState,
  Panel,
  Select,
  StatusIndicator,
  Switch,
} from '../../design-system/index.js';
import { usesSheets } from '../layout.js';
import { useLayoutMode } from '../use-layout-mode.js';
import { WorkspaceSlot } from './WorkspaceSlot.js';
import { RoomPlanner } from '../editor/RoomPlanner.js';
import { RoomInspector } from '../editor/RoomInspector.js';
import { ROOM_STATUS } from '../status.js';
import layout from './Workspace.module.css';

/**
 * Экран помещения (PROMPT 26 §25).
 *
 * ## Помещение — раздел, а не третий вид холста
 *
 * До этого этапа «Помещение» было третьей кнопкой в переключателе видов
 * рядом с «3D» и «Схема». Но 3D и схема показывают ОДНО И ТО ЖЕ изделие
 * по-разному, а помещение — другой объект, с другими инструментами и
 * другим инспектором. Соседство в одном переключателе говорило, что это
 * три вида одного, и переход в планировщик неожиданно менял и панель
 * параметров, и инспектор — то самое «как будто другое приложение»,
 * которое запрещает §5.
 *
 * ## Различимость объектов (§25)
 *
 * Стена, проём, препятствие и мебель различаются в сцене цветом и
 * материалом (`buildRoomScene`), а здесь — тем, что выбирается и
 * правится только мебель. Стены и проёмы правятся числами в инспекторе:
 * инструмента рисования контура в приложении нет, и показывать ручки,
 * которых нет, значило бы обещать несуществующее.
 */

export interface RoomScreenProps {
  readonly room: Room | undefined;
  readonly geometries: ReadonlyMap<string, GeometryResult>;
  readonly materials: MaterialLibrary;
  readonly extents: ExtentLookup;
  readonly status: RoomStatus | undefined;
  readonly selected: FurnitureInstance | undefined;
  readonly selectedInstances: readonly InstanceId[];
  readonly furnitureNames: ReadonlyMap<string, string>;
  /** Проекты библиотеки, которые можно поставить в помещение. */
  readonly placeable: readonly ProjectSummary[];
  /** Сколько размещённых проектов не удалось загрузить. */
  readonly missingProjects: number;
  readonly onCreateRoom: () => void;
  readonly onPlaceProject: (id: ProjectId) => void;
  readonly onSelectInstance: (id: InstanceId | undefined) => void;
  readonly onMoveCommit: (id: InstanceId, position: Vec3, rotation: number) => void;
  readonly onRoomSize: (width: number, depth: number, height: number) => void;
  readonly onFloorElevation: (value: number) => void;
  readonly onCeilingVisible: (value: boolean) => void;
  readonly onMove: (id: InstanceId, position: Vec3) => void;
  readonly onRotate: (id: InstanceId) => void;
  readonly onFlags: (id: InstanceId, patch: { locked?: boolean; visible?: boolean }) => void;
  readonly onDuplicate: (id: InstanceId) => void;
  readonly onRemove: (id: InstanceId) => void;
}

export function RoomScreen(props: RoomScreenProps): React.JSX.Element {
  /** Режимы показа. Состояние интерфейса: в проект не идут и не отменяются. */
  const [cutawayWalls, setCutawayWalls] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [placing, setPlacing] = useState('');

  // Режим раскладки и открытый лист — состояние интерфейса, как и в
  // конструкторе: помещение, мебель и их координаты от размера экрана не
  // зависят (PROMPT 28 §2).
  const mode = useLayoutMode();
  const [sheet, setSheet] = useState<'place' | 'room' | null>(null);
  const closeSheet = (): void => {
    setSheet(null);
  };

  const room = props.room;

  if (room === undefined) {
    return (
      <Panel id="room-empty" wide>
        <EmptyState
          title="Помещение ещё не создано"
          description="Создайте прямоугольную комнату — стены, пол и потолок появятся сразу, размеры можно поправить в инспекторе."
          action={
            <Button variant="primary" onClick={props.onCreateRoom}>
              Создать помещение
            </Button>
          }
        />
      </Panel>
    );
  }

  const status = props.status === undefined ? undefined : ROOM_STATUS[props.status];

  return (
    <div className={layout.workspace}>
      {/*
        Телефон (PROMPT 28 §28): помещение занимает экран, а расстановка и
        свойства выбранного объекта приходят листами снизу. Панели те же
        самые — второго планировщика для телефона не заводится.
      */}
      <WorkspaceSlot
        mode={mode}
        side="sidebar"
        label="Расстановка"
        title="Мебель в помещении"
        open={sheet === 'place'}
        onClose={closeSheet}
      >
        <Panel id="room-place" title="Мебель в помещении">
          {props.placeable.length === 0 ? (
            <EmptyState
              compact
              title="В библиотеке нет проектов с изделиями"
              description="Сохраните проект в конструкторе — он появится здесь."
            />
          ) : (
            <>
              <Select
                label="Проект из библиотеки"
                value={placing}
                onChange={setPlacing}
                options={[
                  { value: '', label: '— выберите —' },
                  ...props.placeable.map((summary) => ({ value: summary.id, label: summary.name })),
                ]}
                hint="Один и тот же проект можно поставить сколько угодно раз."
              />
              <Button
                variant="primary"
                disabled={placing === ''}
                onClick={() => {
                  if (placing !== '') props.onPlaceProject(placing as ProjectId);
                }}
              >
                Разместить в помещении
              </Button>
            </>
          )}

          {props.missingProjects === 0 ? null : (
            <StatusIndicator
              tone="danger"
              label={`Недоступных проектов: ${String(props.missingProjects)}`}
              detail="Они удалены из библиотеки. Расстановка сохранена и вернётся вместе с проектом."
              live
            />
          )}
        </Panel>

        <Panel id="room-view" title="Показ" tone="sunken">
          <Switch
            label="Прозрачные стены"
            hint="Ближние стены не закрывают мебель."
            checked={cutawayWalls}
            onChange={setCutawayWalls}
          />
          <Switch
            label="Привязка"
            hint="Мебель прилипает к стенам и углам."
            checked={snapEnabled}
            onChange={setSnapEnabled}
          />
        </Panel>
      </WorkspaceSlot>

      <div className={layout.canvas}>
        {status === undefined ? null : (
          <StatusIndicator
            tone={status.tone}
            label={status.label}
            {...(status.hint === undefined ? {} : { detail: status.hint })}
            live
          />
        )}
        <RoomPlanner
          room={room}
          geometries={props.geometries}
          materials={props.materials}
          selectedInstances={props.selectedInstances}
          cutawayWalls={cutawayWalls}
          snapEnabled={snapEnabled}
          onSelectInstance={props.onSelectInstance}
          onMoveCommit={props.onMoveCommit}
        />
      </div>

      {!usesSheets(mode) ? null : (
        <div className={layout.mobileActions}>
          <Button
            onClick={() => {
              setSheet((current) => (current === 'place' ? null : 'place'));
            }}
          >
            Мебель
          </Button>
          <Button
            onClick={() => {
              setSheet((current) => (current === 'room' ? null : 'room'));
            }}
          >
            Помещение
          </Button>
        </div>
      )}

      <WorkspaceSlot
        mode={mode}
        side="inspector"
        label="Свойства помещения"
        title="Помещение"
        open={sheet === 'room'}
        onClose={closeSheet}
      >
        <RoomInspector
          room={room}
          extents={props.extents}
          status={props.status ?? 'VALID'}
          selected={props.selected}
          furnitureNames={props.furnitureNames}
          onRoomSize={props.onRoomSize}
          onFloorElevation={props.onFloorElevation}
          onCeilingVisible={props.onCeilingVisible}
          onMove={props.onMove}
          onRotate={props.onRotate}
          onFlags={props.onFlags}
          onDuplicate={props.onDuplicate}
          onRemove={props.onRemove}
        />
      </WorkspaceSlot>
    </div>
  );
}
