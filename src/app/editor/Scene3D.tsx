import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMm } from '../../domain/index.js';
import type { Furniture, NodeId, PartId, Vec3 } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';
import {
  buildGizmos,
  buildScene,
  cameraForPreset,
  orbit,
  pan,
  pick,
  pixelsPerMmAlong,
  rayFromNdc,
  screenDirectionOf,
  withGizmos,
  zoom,
} from '../../scene/index.js';
import type { Camera, GizmoTarget, SceneModel, SceneObject, ViewPreset } from '../../scene/index.js';
import { createSceneRenderer } from '../../render/index.js';
import type { ObjectState, RenderStyle, SceneRenderer } from '../../render/index.js';
import { resizeValue } from './resize.js';
import styles from './Scene3D.module.css';

/**
 * 3D-сцена конструктора (PROMPT 23).
 *
 * ## Компонент ничего не считает и ничего не рисует
 *
 * Он связывает три уже существующие вещи: модель сцены (`src/scene/`),
 * рендерер (`src/render/gl/`) и состояние сессии (`src/state/`). Ни
 * мебельных формул, ни собственного выделения, ни собственной геометрии
 * здесь нет — это то же правило, по которому построен двумерный холст
 * (`docs/EDITOR_ARCHITECTURE.md` §1).
 *
 * ## Камера живёт в компоненте, а не в проекте
 *
 * Положение камеры — это «куда я сейчас смотрю», а не свойство мебели
 * (§36). Оно не сохраняется в файл, не попадает в деталировку и не
 * отменяется по Ctrl+Z. И даже не в сторе сессии: камера меняется на
 * каждом кадре орбиты, и класть её в общий стор значило бы перерисовывать
 * React-дерево шестьдесят раз в секунду. Она живёт в ref, а перерисовку
 * запрашивает рендерер напрямую.
 */

/** Что делает текущий жест. Определяется на нажатии, до первого движения (§18). */
type Intent =
  | { readonly kind: 'idle' }
  /** Нажали на объект: пока не сдвинулись — это выбор, сдвинулись — орбита. */
  | { readonly kind: 'pending'; readonly objectId: string | undefined; readonly x: number; readonly y: number }
  | { readonly kind: 'orbit' }
  | { readonly kind: 'pan' }
  | {
      readonly kind: 'gizmo';
      readonly target: GizmoTarget;
      readonly base: number;
      /** Пикселей экрана на миллиметр вдоль оси ручки. */
      readonly pxPerMm: number;
      /** Единичное направление оси В КООРДИНАТАХ ЭКРАНА (y вниз, как у указателя). */
      readonly ux: number;
      readonly uy: number;
      /** Точка нажатия: смещение считается от неё, а не от прошлого события. */
      readonly startX: number;
      readonly startY: number;
    };

interface Preview {
  readonly target: GizmoTarget;
  readonly value: number;
  readonly label: string;
}

export interface Scene3DProps {
  readonly furniture: Furniture;
  readonly geometry: GeometryResult;
  readonly materials: Parameters<typeof buildScene>[1];
  readonly selectedParts: readonly PartId[];
  readonly selectedNodes: readonly NodeId[];
  readonly hoveredNode: NodeId | undefined;
  readonly editable: boolean;
  readonly showGrid: boolean;
  readonly showAxes: boolean;
  readonly debug: boolean;
  readonly onSelectPart: (id: PartId) => void;
  readonly onSelectNode: (id: NodeId) => void;
  readonly onClearSelection: () => void;
  readonly onResizeCommit: (target: GizmoTarget, value: number) => void;
  readonly limits: { readonly min: number; readonly max: number };
}

/** Порог, после которого нажатие перестаёт быть щелчком и становится жестом. */
const DRAG_THRESHOLD_PX = 4;

/** Цвета сцены читаются из токенов темы: свою палитру рендерер не заводит. */
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

export function Scene3D(props: Scene3DProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const intentRef = useRef<Intent>({ kind: 'idle' });
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null);
  /** Активные указатели: нужны для щипка двумя пальцами (§33). */
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  /** Снимок счётчиков рендерера для debug-режима (§27, §31). */
  const [stats, setStats] = useState({ drawCalls: 0, geometryUploads: 0, culled: 0, lastFrameMs: 0 });
  const [unsupported, setUnsupported] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<ViewPreset>('perspective');

  // Модель сцены пересобирается только при смене геометрии или материалов.
  // Вращение камеры её не трогает — иначе каждый кадр орбиты пересоздавал
  // бы все объекты сцены (§31).
  const scene: SceneModel = useMemo(
    () => buildScene(props.geometry, props.materials),
    [props.geometry, props.materials],
  );

  const gizmos = useMemo(
    () => (props.editable ? buildGizmos(props.furniture, props.geometry) : []),
    [props.editable, props.furniture, props.geometry],
  );

  const fullScene = useMemo(() => withGizmos(scene, gizmos), [scene, gizmos]);

  // Состояния объектов — тоже мемоизированы: словарь строится при смене
  // выделения, а не на каждом кадре.
  const states = useMemo(() => {
    const map = new Map<string, ObjectState>();
    for (const id of props.selectedParts) map.set(id, 'selected');
    for (const id of props.selectedNodes) map.set(id, 'selected');
    if (hoveredId !== undefined && !map.has(hoveredId)) map.set(hoveredId, 'hovered');
    return map;
  }, [props.selectedParts, props.selectedNodes, hoveredId]);

  // Объёмы (ячейки и секции) показываются только когда выбраны или под
  // курсором: постоянно нарисованная ячейка — это мебель, которой нет (§6).
  const visibleVolumes = useMemo(() => {
    const set = new Set<string>(props.selectedNodes);
    if (props.hoveredNode !== undefined) set.add(props.hoveredNode);
    if (hoveredId !== undefined) set.add(hoveredId);
    return set;
  }, [props.selectedNodes, props.hoveredNode, hoveredId]);

  const draw = useCallback(() => {
    frameRef.current = null;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const host = hostRef.current;
    if (renderer === null || camera === null || host === null) return;
    renderer.render({
      scene: fullScene,
      camera,
      style: readStyle(host),
      states,
      visibleVolumes,
      showGrid: props.showGrid,
      showAxes: props.showAxes,
      showGizmos: props.editable,
    });
    // Счётчики снимаются только в debug-режиме: обычному пользователю они
    // не нужны, а лишний setState на каждом кадре орбиты сводил бы на нет
    // весь смысл рендера вне React.
    if (props.debug) setStats({ ...renderer.stats });
  }, [fullScene, states, visibleVolumes, props.showGrid, props.showAxes, props.editable, props.debug]);

  /** Один кадр на анимационный тик: серия событий указателя не даёт серии отрисовок (§24). */
  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // ── Создание рендерера ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    try {
      rendererRef.current = createSceneRenderer(canvas);
    } catch {
      // WebGL 2 может быть недоступен: старый браузер, отключённое
      // аппаратное ускорение, политика организации. Это не повод ломать
      // редактор — все размеры правятся полями и инспектором (§34).
      setUnsupported(true);
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ── Размер холста ─────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    const renderer = rendererRef.current;
    if (host === null || renderer === null) return;

    // Кадр запрашивается всегда, а не только при смене размера: иначе
    // первый кадр зависел бы от того, в каком порядке отработали эффекты.
    // Запрос дешёвый — он всё равно схлопывается до одного кадра.
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

  // ── Камера: вид по умолчанию и переключение вида ──────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    cameraRef.current = cameraForPreset(view, scene, renderer.aspect);
    requestDraw();
  }, [view, scene, requestDraw]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  useEffect(
    () => () => {
      // Ref обязан быть сброшен вместе с отменой кадра. Иначе защита от
      // повторного запроса («кадр уже заказан») остаётся взведённой
      // навсегда, и после любого перемонтирования компонента сцена не
      // рисуется вообще: `requestDraw` каждый раз видит несброшенный
      // идентификатор и выходит. Найдено на dev-сервере, где React
      // монтирует компонент дважды; в production не воспроизводилось
      // только потому, что монтирование было одно.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  // ── Указатель → мир ───────────────────────────────────────────────────────
  const rayAt = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (host === null || camera === null || renderer === null) return undefined;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    return rayFromNdc(camera, renderer.aspect, ndcX, ndcY);
  }, []);

  const hitAt = useCallback(
    (clientX: number, clientY: number, kinds?: readonly SceneObject['kind'][]) => {
      const ray = rayAt(clientX, clientY);
      if (ray === undefined) return undefined;
      return pick(fullScene, ray, kinds === undefined ? {} : { kinds });
    },
    [fullScene, rayAt],
  );

  /**
   * Начало жеста ручки.
   *
   * Коэффициент «пиксель → миллиметр» и экранное направление оси
   * считаются ОДИН раз, на нажатии. Пересчитывать их на каждом кадре
   * нельзя: камера во время жеста не двигается, а вот значение под
   * указателем поехало бы вслед за округлениями.
   */
  const startGizmo = useCallback(
    (object: SceneObject, clientX: number, clientY: number): Intent | undefined => {
      const target = object.gizmo;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const host = hostRef.current;
      if (target === undefined || camera === null || renderer === null || host === null) return undefined;

      const axis: Vec3 =
        target.kind === 'furniture-height' || (target.kind === 'child-size' && target.axis === 'y')
          ? { x: 0, y: 1, z: 0 }
          : { x: 1, y: 0, z: 0 };

      const rect = host.getBoundingClientRect();
      const perMm = pixelsPerMmAlong(camera, renderer.aspect, rect.width, rect.height, object.position, axis);
      // Ось смотрит почти точно в камеру: тянуть за такую ручку нечем.
      // Честнее не начинать жест, чем делить на почти-ноль и дёргать
      // изделие на метры за один пиксель.
      if (perMm === undefined) return undefined;

      const base =
        target.kind === 'furniture-width'
          ? props.furniture.dimensions.width
          : target.kind === 'furniture-height'
            ? props.furniture.dimensions.height
            : gizmoBase(target, props.geometry);
      if (base === undefined) return undefined;

      // Направление оси на экране. Берётся из проекции, а не из
      // предположения «ширина тянется вправо»: при взгляде сзади правая
      // грань уходит влево, и без этого изделие сжималось бы, когда
      // пользователь тянет наружу. Y инвертируется, потому что в
      // нормализованных координатах он вверх, а у указателя — вниз.
      const screen = screenDirectionOf(camera, renderer.aspect, object.position, axis);
      const screenLength = Math.hypot(screen.x, screen.y);
      if (screenLength === 0) return undefined;
      const ux = screen.x / screenLength;
      const uy = -screen.y / screenLength;

      return { kind: 'gizmo', target, base, pxPerMm: perMm, ux, uy, startX: clientX, startY: clientY };
    },
    [props.furniture, props.geometry],
  );

  // ── События указателя ─────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (host === null) return;

      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size === 2) {
        // Второй палец: жест превращается в щипок, начатый жест
        // отменяется, чтобы изделие не «поехало» вместе с масштабом.
        intentRef.current = { kind: 'idle' };
        setPreview(undefined);
        pinchRef.current = null;
        return;
      }

      // Захват указателя обязателен: без него движение перестаёт приходить,
      // как только курсор ушёл за пределы холста, и вращение срывается.
      host.setPointerCapture(event.pointerId);
      pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };

      // Средняя кнопка и Shift — панорама: соглашение, знакомое по любому
      // трёхмерному инструменту, и его незачем изобретать заново.
      if (event.button === 1 || event.shiftKey) {
        intentRef.current = { kind: 'pan' };
        return;
      }

      // Намерение определяется ДО первого движения (§18). Ручка забирает
      // жест себе; всё остальное остаётся неопределённым: сдвинулись —
      // орбита, отпустили на месте — выбор.
      const gizmoHit = props.editable ? hitAt(event.clientX, event.clientY, ['gizmo']) : undefined;
      if (gizmoHit !== undefined) {
        const intent = startGizmo(gizmoHit.object, event.clientX, event.clientY);
        if (intent !== undefined) {
          intentRef.current = intent;
          return;
        }
      }

      const hit = hitAt(event.clientX, event.clientY);
      intentRef.current = { kind: 'pending', objectId: hit?.object.id, x: event.clientX, y: event.clientY };
    },
    [hitAt, props.editable, startGizmo],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (host === null) return;

      // ── Щипок двумя пальцами: масштаб (§33) ────────────────────────────────
      if (touchesRef.current.has(event.pointerId)) {
        touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (touchesRef.current.size === 2) {
        const [a, b] = [...touchesRef.current.values()];
        if (a !== undefined && b !== undefined) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const previous = pinchRef.current;
          if (previous !== null && previous > 0 && cameraRef.current !== null) {
            cameraRef.current = zoom(cameraRef.current, previous / distance, scene.radius);
            requestDraw();
          }
          pinchRef.current = distance;
        }
        return;
      }

      const pointer = pointerRef.current;
      const camera = cameraRef.current;
      const intent = intentRef.current;

      if (pointer === null || camera === null) {
        // Указатель не захвачен — это просто движение мыши над сценой.
        // Подсветка есть, но не на касании: у пальца нет положения «над».
        if (event.pointerType !== 'touch') {
          const hit = hitAt(event.clientX, event.clientY);
          const next = hit?.object.kind === 'gizmo' ? undefined : hit?.object.id;
          if (next !== hoveredId) setHoveredId(next);
        }
        return;
      }

      if (event.pointerId !== pointer.id) return;

      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const rect = host.getBoundingClientRect();

      if (intent.kind === 'pending') {
        if (Math.hypot(event.clientX - intent.x, event.clientY - intent.y) < DRAG_THRESHOLD_PX) return;
        // Порог пройден: нажатие было не щелчком, а началом вращения.
        intentRef.current = { kind: 'orbit' };
      }

      const current = intentRef.current;
      if (current.kind === 'orbit') {
        cameraRef.current = orbit(camera, dx, dy, rect.height);
        requestDraw();
      } else if (current.kind === 'pan') {
        cameraRef.current = pan(camera, dx, dy, rect.height);
        requestDraw();
      } else if (current.kind === 'gizmo') {
        // Тяжёлого расчёта на кадр нет (§24): считается ОДНО число, и
        // показывается предпросмотр. Ни геометрия, ни производственный
        // конвейер до отпускания не запускаются.
        //
        // Смещение — проекция пути указателя ОТ ТОЧКИ НАЖАТИЯ на экранное
        // направление оси. Складывать приращения кадров нельзя: округление
        // шага (Shift — 10 мм) накапливалось бы, и значение уползало бы от
        // курсора; движение поперёк оси при этом справедливо ничего не даёт.
        const deltaPx =
          (event.clientX - current.startX) * current.ux + (event.clientY - current.startY) * current.uy;
        const result = resizeValue({
          base: current.base,
          deltaPx,
          scale: current.pxPerMm,
          min: props.limits.min,
          max: props.limits.max,
          modifiers: { shift: event.shiftKey, alt: event.altKey },
        });
        setPreview({ target: current.target, value: result.value, label: gizmoLabel(current.target) });
      }

      pointerRef.current = { id: pointer.id, x: event.clientX, y: event.clientY };
    },
    [hitAt, hoveredId, props.limits, requestDraw, scene.radius],
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
        // Нажатие без движения — это выбор. Именно здесь, а не на
        // нажатии: иначе каждое вращение камеры меняло бы выделение.
        if (intent.objectId === undefined) props.onClearSelection();
        else {
          const object = fullScene.objects.find((o) => o.id === intent.objectId);
          if (object === undefined) props.onClearSelection();
          else if (object.kind === 'part') props.onSelectPart(object.id as PartId);
          else if (object.kind !== 'gizmo') props.onSelectNode(object.id as NodeId);
        }
        return;
      }

      if (intent.kind === 'gizmo' && preview !== undefined) {
        // Команда отправляется РОВНО ОДИН раз, на отпускании: иначе один
        // жест наполнил бы историю сотней шагов.
        props.onResizeCommit(intent.target, preview.value);
      }
      setPreview(undefined);
    },
    [fullScene, preview, props],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const camera = cameraRef.current;
      if (camera === null) return;
      // Экспонента, а не линейный шаг: одинаковое ощущение на любом
      // расстоянии. Трекпад даёт мелкие частые дельты, колесо — крупные
      // редкие, и обе укладываются в одну формулу.
      cameraRef.current = zoom(camera, Math.exp(event.deltaY * 0.0015), scene.radius);
      requestDraw();
    },
    [requestDraw, scene.radius],
  );

  // Esc отменяет жест до отпускания — та же прерываемость, что и на
  // двумерном холсте (`docs/EDITOR_INTERACTION.md` §5).
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
          Браузер не даёт WebGL 2. Все размеры и наполнение правятся полями слева и инспектором справа, а схема
          изделия доступна в двумерном виде.
        </p>
      </div>
    );
  }

  const dims = props.geometry.boundingBox;

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
        {/*
          Холст помечен `img` с текстовым описанием, а не `application`:
          сцена не является самостоятельным способом управления (§34), и
          обещать скринридеру интерактивность, которой у пикселей нет,
          неправильно. Управление — кнопки видов ниже, поля габаритов и
          инспектор; они же и есть доступная альтернатива.
        */}
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label={`Трёхмерный вид изделия: ширина ${formatMm(dims.totalWidth)}, высота ${formatMm(dims.totalHeight)}, глубина ${formatMm(dims.totalDepth)} миллиметров. Деталей: ${String(props.geometry.parts.length)}.`}
        />

        {preview === undefined ? null : (
          <p className={styles.readout} role="status">
            {preview.label} {formatMm(preview.value)} мм
          </p>
        )}

        {/* Размеры берутся из движка и никогда не считаются здесь (§26). */}
        <dl className={styles.dimensions}>
          <div>
            <dt>Ш</dt>
            <dd>{formatMm(dims.totalWidth)}</dd>
          </div>
          <div>
            <dt>В</dt>
            <dd>{formatMm(dims.totalHeight)}</dd>
          </div>
          <div>
            <dt>Г</dt>
            <dd>{formatMm(dims.totalDepth)}</dd>
          </div>
        </dl>

        {!props.debug ? null : (
          <ul className={styles.debug}>
            <li>Объектов сцены: {fullScene.objects.length}</li>
            <li>Деталей: {props.geometry.parts.length}</li>
            <li>Ячеек: {props.geometry.cells.length}</li>
            <li>Секций: {props.geometry.sections.length}</li>
            <li>Ручек: {gizmos.length}</li>
            <li>Вызовов отрисовки: {stats.drawCalls}</li>
            <li>Загрузок геометрии: {stats.geometryUploads}</li>
            <li>Отброшено: {stats.culled}</li>
            <li>Кадр: {stats.lastFrameMs.toFixed(1)} мс</li>
          </ul>
        )}
      </div>

      <div className={styles.views} role="group" aria-label="Вид камеры">
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
  { preset: 'front', label: 'Спереди' },
  { preset: 'left', label: 'Слева' },
  { preset: 'right', label: 'Справа' },
  { preset: 'top', label: 'Сверху' },
  { preset: 'back', label: 'Сзади' },
];

function gizmoLabel(target: GizmoTarget): string {
  if (target.kind === 'furniture-width') return 'Ширина';
  if (target.kind === 'furniture-height') return 'Высота';
  return target.axis === 'x' ? 'Ширина секции' : 'Высота ряда';
}

function gizmoBase(target: Extract<GizmoTarget, { kind: 'child-size' }>, geometry: GeometryResult): number | undefined {
  const box =
    geometry.cells.find((cell) => cell.nodeId === target.childId)?.box ??
    geometry.sections.find((section) => section.nodeId === target.childId)?.box;
  if (box === undefined) return undefined;
  return target.axis === 'x' ? box.size.x : box.size.y;
}
