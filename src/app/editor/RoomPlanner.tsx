import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMm } from '../../domain/index.js';
import type { FurnitureId, InstanceId, Room, Vec3 } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';
import {
  applySnap,
  furnitureExtent,
  instanceFootprint,
  roomSize,
  snapRotationToQuarter,
  validateRoom,
} from '../../room/index.js';
import type { ExtentLookup, SnapResult } from '../../room/index.js';
import {
  buildRoomScene,
  cameraForPreset,
  instanceIdOf,
  orbit,
  pan,
  pick,
  rayFromNdc,
  zoom,
} from '../../scene/index.js';
import type { Camera, SceneModel, ViewPreset } from '../../scene/index.js';
import { createSceneRenderer } from '../../render/index.js';
import type { ObjectState, RenderStyle, SceneRenderer } from '../../render/index.js';
import styles from './Scene3D.module.css';

/**
 * Планировщик помещения (PROMPT 24 §13–§14, §21–§23).
 *
 * ## Всё переиспользовано
 *
 * Рендерер, камера, попадание луча и состояние выделения — те же, что у
 * сцены изделия (PROMPT 23). Здесь нет ни второго рендерера, ни второй
 * камеры, ни своего выделения: отличается только то, ЧТО собирается в
 * сцену и какая команда уходит на отпускании.
 *
 * ## Во время перетаскивания мебель не пересчитывается
 *
 * Кадр жеста стоит ровно столько: новое положение, привязка и проверка
 * пересечений по габаритным коробкам. Ни `buildGeometry`, ни
 * производственный конвейер не запускаются — они и не нужны, потому что
 * от перемещения шкафа его детали не меняются (§32).
 */

type Intent =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly objectId: string | undefined; readonly x: number; readonly y: number }
  | { readonly kind: 'orbit' }
  | { readonly kind: 'pan' }
  | {
      readonly kind: 'move';
      readonly instanceId: InstanceId;
      readonly origin: Vec3;
      /** Точка на полу под указателем в момент нажатия, мм. */
      readonly grabX: number;
      readonly grabZ: number;
    };

export interface RoomPlannerProps {
  readonly room: Room;
  readonly geometries: ReadonlyMap<FurnitureId, GeometryResult>;
  readonly materials: Parameters<typeof buildRoomScene>[1]['materials'];
  readonly selectedInstances: readonly InstanceId[];
  readonly cutawayWalls: boolean;
  readonly snapEnabled: boolean;
  readonly onSelectInstance: (id: InstanceId | undefined) => void;
  readonly onMoveCommit: (id: InstanceId, position: Vec3, rotation: number) => void;
}

const DRAG_THRESHOLD_PX = 4;
/** Радиус притяжения в пикселях экрана — как у всех магнитов проекта. */
const SNAP_RADIUS_PX = 14;

function readStyle(element: HTMLElement): RenderStyle {
  const computed = getComputedStyle(element);
  const token = (name: string, fallback: string): string => {
    const value = computed.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  return {
    background: token('--scene-bg', '#eceae6'),
    selection: token('--scene-selection', '#2f6fed'),
    hover: token('--scene-hover', '#8fb6ff'),
    invalid: token('--scene-invalid', '#c0392b'),
    guide: token('--scene-guide', '#c9c5be'),
  };
}

/**
 * Точка пересечения луча с полом.
 *
 * Мебель ездит по полу, а не в воздухе, поэтому перетаскивание
 * проецируется на горизонтальную плоскость. Это и естественнее для
 * пользователя, и избавляет от вопроса «на какой высоте сейчас шкаф».
 */
function floorPoint(
  camera: Camera,
  aspect: number,
  ndcX: number,
  ndcY: number,
  floorY: number,
): { x: number; z: number } | undefined {
  const ray = rayFromNdc(camera, aspect, ndcX, ndcY);
  if (ray === undefined) return undefined;
  // Луч, идущий почти параллельно полу, пересекает его бесконечно далеко:
  // тащить по такой проекции невозможно, и жест просто не начинается.
  if (Math.abs(ray.direction.y) < 1e-4) return undefined;
  const t = (floorY - ray.origin.y) / ray.direction.y;
  if (t < 0) return undefined;
  return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
}

export function RoomPlanner(props: RoomPlannerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const intentRef = useRef<Intent>({ kind: 'idle' });
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const [unsupported, setUnsupported] = useState(false);
  const [view, setView] = useState<ViewPreset>('perspective');
  const [preview, setPreview] = useState<{ position: Vec3; rotation: number; snap: SnapResult } | undefined>(undefined);

  /** Габариты изделий: берутся из уже посчитанной геометрии (§13). */
  const extents: ExtentLookup = useMemo(() => {
    const map = new Map<string, Vec3>();
    for (const [id, geometry] of props.geometries) map.set(id, furnitureExtent(geometry));
    return map;
  }, [props.geometries]);

  /**
   * Комната, показанная на экране: с уже применённым предпросмотром.
   *
   * Домен во время жеста не меняется — меняется только эта производная
   * копия. Поэтому отмена жеста не требует ничего откатывать.
   */
  const displayRoom: Room = useMemo(() => {
    const dragging = intentRef.current;
    if (preview === undefined || dragging.kind !== 'move') return props.room;
    return {
      ...props.room,
      furnitureInstances: props.room.furnitureInstances.map((instance) =>
        instance.id === dragging.instanceId
          ? { ...instance, position: preview.position, rotation: preview.rotation }
          : instance,
      ),
    };
  }, [props.room, preview]);

  const scene: SceneModel = useMemo(
    () =>
      buildRoomScene(displayRoom, {
        geometries: props.geometries,
        materials: props.materials,
        cutawayWalls: props.cutawayWalls,
      }),
    [displayRoom, props.geometries, props.materials, props.cutawayWalls],
  );

  /** Проверка размещения на габаритах: дёшево и достаточно для кадра жеста. */
  const validation = useMemo(
    () => validateRoom(displayRoom, { extents }),
    [displayRoom, extents],
  );

  const states = useMemo(() => {
    const map = new Map<string, ObjectState>();
    const broken = new Set(
      validation.issues
        .filter((item) => item.severity === 'error' && item.target?.path?.startsWith('room.furnitureInstances.'))
        .map((item) => item.target?.path?.split('.').at(-1) ?? ''),
    );
    for (const object of scene.objects) {
      const instanceId = instanceIdOf(object.id);
      if (instanceId === undefined) continue;
      // Ошибка размещения важнее выделения: красный шкаф, который ещё и
      // выбран, обязан остаться красным.
      if (broken.has(instanceId)) map.set(object.id, 'invalid');
      else if (props.selectedInstances.includes(instanceId as InstanceId)) map.set(object.id, 'selected');
    }
    return map;
  }, [scene, validation, props.selectedInstances]);

  const draw = useCallback(() => {
    frameRef.current = null;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const host = hostRef.current;
    if (renderer === null || camera === null || host === null) return;
    renderer.render({
      scene,
      camera,
      style: readStyle(host),
      states,
      visibleVolumes: new Set<string>(),
      showGrid: true,
      showAxes: false,
      showGizmos: false,
    });
  }, [scene, states]);

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    try {
      rendererRef.current = createSceneRenderer(canvas);
    } catch {
      setUnsupported(true);
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    if (host === null || renderer === null) return;
    const apply = (): void => {
      const rect = host.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio);
      requestDraw();
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [requestDraw, unsupported]);

  // Камера подгоняется под КОМНАТУ, а не под мебель: планировщик
  // открывается видом на помещение целиком (§23).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    cameraRef.current = cameraForPreset(view, scene, renderer.aspect);
    requestDraw();
    // Пересчёт камеры при каждом кадре жеста сбрасывал бы вид, поэтому
    // зависимость — только от вида и от размера комнаты, а не от сцены.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scene.size.x, scene.size.z, requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const ndcAt = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((clientY - rect.top) / rect.height) * 2,
      rect,
    };
  }, []);

  const hitAt = useCallback(
    (clientX: number, clientY: number) => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const ndc = ndcAt(clientX, clientY);
      if (camera === null || renderer === null || ndc === undefined) return undefined;
      const ray = rayFromNdc(camera, renderer.aspect, ndc.x, ndc.y);
      return ray === undefined ? undefined : pick(scene, ray);
    },
    [ndcAt, scene],
  );

  /** Радиус привязки в миллиметрах: перевод из пикселей делает интерфейс. */
  const snapRadiusMm = useCallback((): number => {
    const camera = cameraRef.current;
    const host = hostRef.current;
    if (camera === null || host === null) return 0;
    const rect = host.getBoundingClientRect();
    const visibleHeight = 2 * camera.distance * Math.tan(camera.fovY / 2);
    return (visibleHeight / Math.max(rect.height, 1)) * SNAP_RADIUS_PX;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (host === null || camera === null || renderer === null) return;

      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size === 2) {
        intentRef.current = { kind: 'idle' };
        setPreview(undefined);
        pinchRef.current = null;
        return;
      }

      host.setPointerCapture(event.pointerId);
      pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };

      if (event.button === 1 || event.shiftKey) {
        intentRef.current = { kind: 'pan' };
        return;
      }

      // Намерение определяется ДО движения — как и в сцене изделия (§14).
      const hit = hitAt(event.clientX, event.clientY);
      const instanceId = hit === undefined ? undefined : instanceIdOf(hit.object.id);
      const instance = props.room.furnitureInstances.find((item) => item.id === instanceId);

      if (instance !== undefined && !instance.locked) {
        const ndc = ndcAt(event.clientX, event.clientY);
        const grab =
          ndc === undefined
            ? undefined
            : floorPoint(camera, renderer.aspect, ndc.x, ndc.y, props.room.floor.elevation);
        if (grab !== undefined) {
          intentRef.current = {
            kind: 'move',
            instanceId: instance.id,
            origin: instance.position,
            grabX: grab.x,
            grabZ: grab.z,
          };
          return;
        }
      }

      intentRef.current = { kind: 'pending', objectId: hit?.object.id, x: event.clientX, y: event.clientY };
    },
    [hitAt, ndcAt, props.room],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (host === null || camera === null || renderer === null) return;

      if (touchesRef.current.has(event.pointerId)) {
        touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (touchesRef.current.size === 2) {
        const [a, b] = [...touchesRef.current.values()];
        if (a !== undefined && b !== undefined) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const previous = pinchRef.current;
          if (previous !== null && previous > 0) {
            cameraRef.current = zoom(camera, previous / distance, scene.radius);
            requestDraw();
          }
          pinchRef.current = distance;
        }
        return;
      }

      const pointer = pointerRef.current;
      if (pointer === null || event.pointerId !== pointer.id) return;

      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const rect = host.getBoundingClientRect();
      const intent = intentRef.current;

      if (intent.kind === 'pending') {
        if (Math.hypot(event.clientX - intent.x, event.clientY - intent.y) < DRAG_THRESHOLD_PX) return;
        intentRef.current = { kind: 'orbit' };
      }

      const current = intentRef.current;
      if (current.kind === 'orbit') {
        cameraRef.current = orbit(camera, dx, dy, rect.height);
        requestDraw();
      } else if (current.kind === 'pan') {
        cameraRef.current = pan(camera, dx, dy, rect.height);
        requestDraw();
      } else if (current.kind === 'move') {
        const ndc = ndcAt(event.clientX, event.clientY);
        const point =
          ndc === undefined ? undefined : floorPoint(camera, renderer.aspect, ndc.x, ndc.y, props.room.floor.elevation);
        if (point !== undefined) {
          const instance = props.room.furnitureInstances.find((item) => item.id === current.instanceId);
          const extent = instance === undefined ? undefined : extents.get(instance.furnitureId);
          if (instance !== undefined && extent !== undefined) {
            // Смещение от ТОЧКИ ЗАХВАТА, а не от центра: объект остаётся
            // взятым там, где его взяли.
            const moved: Vec3 = {
              x: current.origin.x + (point.x - current.grabX),
              y: current.origin.y,
              z: current.origin.z + (point.z - current.grabZ),
            };
            const snap = props.snapEnabled
              ? applySnap(props.room, extent, moved, instance.rotation, snapRadiusMm())
              : { position: moved, rotation: instance.rotation, snapped: undefined };
            setPreview({ position: snap.position, rotation: snap.rotation, snap });
          }
        }
      }

      pointerRef.current = { id: pointer.id, x: event.clientX, y: event.clientY };
    },
    [extents, ndcAt, props.room, props.snapEnabled, requestDraw, scene.radius, snapRadiusMm],
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const host = hostRef.current;
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
      if (host !== null && host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);

      const intent = intentRef.current;
      intentRef.current = { kind: 'idle' };
      pointerRef.current = null;

      if (cancelled) {
        setPreview(undefined);
        return;
      }

      if (intent.kind === 'pending') {
        const instanceId = intent.objectId === undefined ? undefined : instanceIdOf(intent.objectId);
        props.onSelectInstance(instanceId as InstanceId | undefined);
        return;
      }

      if (intent.kind === 'move') {
        if (preview === undefined) {
          // Нажали на мебель и отпустили, не сдвинув, — это ВЫБОР, а не
          // пустой жест. Без этой ветки щелчок по шкафу не делал ничего:
          // намерение «перемещение» определялось на нажатии, а команда
          // уходила только при движении.
          props.onSelectInstance(intent.instanceId);
          return;
        }
        // Команда отправляется один раз, на отпускании. Пока жест шёл,
        // домен не менялся ни разу.
        props.onMoveCommit(intent.instanceId, preview.position, preview.rotation);
        setPreview(undefined);
      }
    },
    [preview, props],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const camera = cameraRef.current;
      if (camera === null) return;
      cameraRef.current = zoom(camera, Math.exp(event.deltaY * 0.0015), scene.radius);
      requestDraw();
    },
    [requestDraw, scene.radius],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      intentRef.current = { kind: 'idle' };
      setPreview(undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (unsupported) {
    return (
      <div className={styles.fallback} role="status">
        <p className={styles.fallbackTitle}>Трёхмерный просмотр недоступен</p>
        <p>
          Браузер не даёт WebGL 2. Помещение и расстановка правятся полями инспектора: положение, поворот, видимость и
          блокировка доступны без сцены.
        </p>
      </div>
    );
  }

  const size = roomSize(props.room);
  const errors = validation.issues.filter((item) => item.severity === 'error').length;

  return (
    <div className={styles.wrapper}>
      <div
        ref={hostRef}
        className={styles.host}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          finishPointer(event, false);
        }}
        onPointerCancel={(event) => {
          finishPointer(event, true);
        }}
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`Помещение ${props.room.name}: ${formatMm(size.width)} × ${formatMm(size.depth)} мм, высота ${formatMm(size.height)} мм. Мебели: ${String(props.room.furnitureInstances.length)}. Ошибок размещения: ${String(errors)}.`}
        />

        {preview === undefined ? null : (
          <p className={styles.readout} role="status">
            {preview.snap.snapped === undefined
              ? `X ${formatMm(preview.position.x)} · Z ${formatMm(preview.position.z)} мм`
              : `${preview.snap.snapped.label} · X ${formatMm(preview.position.x)} · Z ${formatMm(preview.position.z)} мм`}
          </p>
        )}

        <dl className={styles.dimensions}>
          <div>
            <dt>Ш</dt>
            <dd>{formatMm(size.width)}</dd>
          </div>
          <div>
            <dt>Г</dt>
            <dd>{formatMm(size.depth)}</dd>
          </div>
          <div>
            <dt>В</dt>
            <dd>{formatMm(size.height)}</dd>
          </div>
        </dl>
      </div>

      <div className={styles.views} role="group" aria-label="Вид помещения">
        {VIEWS.map((item) => (
          <button
            key={item.preset}
            type="button"
            className={styles.viewButton}
            aria-pressed={view === item.preset}
            onClick={() => {
              setView(item.preset);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const VIEWS: ReadonlyArray<{ preset: ViewPreset; label: string }> = [
  { preset: 'perspective', label: 'Общий' },
  { preset: 'top', label: 'План' },
  { preset: 'front', label: 'Спереди' },
  { preset: 'left', label: 'Слева' },
];

/** Поворот экземпляра на четверть оборота. Используется кнопкой инспектора. */
export const rotateQuarter = (rotation: number): number => snapRotationToQuarter(rotation + Math.PI / 2);

/** След экземпляра для подписи в инспекторе. */
export const footprintLabel = (
  instance: Room['furnitureInstances'][number],
  extent: Vec3 | undefined,
): string => {
  if (extent === undefined) return '—';
  const print = instanceFootprint(instance, extent);
  return `${formatMm(print.width)} × ${formatMm(print.depth)} мм`;
};
