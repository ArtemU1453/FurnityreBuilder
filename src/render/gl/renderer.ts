import { composeBox, viewMatrix, viewProjection } from '../../scene/index.js';
import type { Camera, Mat4, SceneModel, SceneObject } from '../../scene/index.js';
import { BOX_FRAGMENT_SHADER, BOX_VERTEX_SHADER, LINE_FRAGMENT_SHADER, LINE_VERTEX_SHADER } from './shaders.js';

/**
 * Рендерер сцены на WebGL 2 (PROMPT 23 §1, §29, §31).
 *
 * ## Почему собственный рендерер, а не библиотека
 *
 * Вся сцена — это прямоугольные параллелепипеды, выровненные по осям
 * изделия, с плоскими материалами, без текстур, теней и постобработки
 * (§29 прямо запрещает фотореализм). Готовая 3D-библиотека решает на
 * порядок более общую задачу — скелетная анимация, кватернионы, графы
 * сцены, загрузчики форматов — и приносит с собой сотни килобайт,
 * которых этому приложению не нужно ни одного.
 *
 * Это то же решение, что уже принималось в проекте дважды и по тем же
 * основаниям: собственный пружинный движок вместо анимационной
 * библиотеки (`src/motion/`) и собственные генераторы ZIP и XLSX вместо
 * готовых (`src/export/`). Продукт бесплатный, работает офлайн и без
 * единого внешнего запроса — вес бандла здесь не абстракция.
 *
 * Побочная выгода оказалась важнее исходной: требование §31 «не
 * создавать геометрию на каждый кадр» здесь выполняется не дисциплиной,
 * а устройством. Геометрия ровно одна на всё приложение — единичный куб,
 * загруженный в видеопамять при создании рендерера. Ни один объект сцены
 * своей геометрии не имеет и иметь не может: он отличается только
 * матрицей.
 *
 * ## Императивный, а не декларативный
 *
 * Рендерер живёт вне React и ничего о нём не знает. React отдаёт ему
 * модель сцены и камеру; когда именно рисовать — решает вызывающая
 * сторона. Поэтому вращение камеры не вызывает ни одного повторного
 * рендера React-дерева.
 */

/** Состояние объекта на экране (§20). */
export type ObjectState = 'normal' | 'selected' | 'hovered' | 'disabled' | 'invalid';

const STATE_CODE: Readonly<Record<ObjectState, number>> = {
  normal: 0,
  selected: 1,
  hovered: 2,
  disabled: 3,
  invalid: 4,
};

export interface RenderStyle {
  /** Фон холста, `#rrggbb`. Берётся из токенов темы, а не задаётся здесь. */
  readonly background: string;
  readonly selection: string;
  readonly hover: string;
  readonly invalid: string;
  /** Цвет вспомогательной сетки и осей. */
  readonly guide: string;
}

export interface RenderRequest {
  readonly scene: SceneModel;
  readonly camera: Camera;
  readonly style: RenderStyle;
  /** Состояние объектов по идентификатору. Отсутствие в словаре — `normal`. */
  readonly states: ReadonlyMap<string, ObjectState>;
  /** Идентификаторы объёмов (ячеек, секций), которые нужно показать. */
  readonly visibleVolumes: ReadonlySet<string>;
  readonly showGrid: boolean;
  readonly showAxes: boolean;
  /** Ручки рисуются только в режиме редактирования. */
  readonly showGizmos: boolean;
}

export interface SceneRenderer {
  /** Отрисовать кадр. Синхронно, без внутреннего requestAnimationFrame. */
  render(request: RenderRequest): void;
  /** Подогнать буфер под размер элемента. Возвращает `true`, если размер изменился. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): boolean;
  readonly aspect: number;
  /** Счётчики для проверки производительности (§31). */
  readonly stats: RenderStats;
  dispose(): void;
}

export interface RenderStats {
  /** Сколько раз создавалась геометрия за жизнь рендерера. Обязано быть 1. */
  geometryUploads: number;
  /** Вызовов отрисовки в последнем кадре. */
  drawCalls: number;
  /** Объектов, отброшенных до отрисовки. */
  culled: number;
  lastFrameMs: number;
}

/** Единичный куб: 24 вершины (по 4 на грань, чтобы нормали были плоскими). */
function unitCube(): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const faces: Array<{ normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
    { normal: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { normal: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { normal: [1, 0, 0], corners: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { normal: [-1, 0, 0], corners: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, 1, 0], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { normal: [0, -1, 0], corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  faces.forEach((face, faceIndex) => {
    for (const corner of face.corners) {
      positions.push(...corner);
      normals.push(...face.normal);
    }
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('Не удалось создать шейдер');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Шейдер не скомпилирован: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  if (program === null) throw new Error('Не удалось создать программу');
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`Программа не слинкована: ${log}`);
  }
  return program;
}

/** `#rrggbb` → три числа 0…1. Цвета приходят из токенов темы. */
export function parseColor(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int) || full.length !== 6) return [0.5, 0.5, 0.5];
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

/** Линии осей и сетки. Строятся один раз на сцену, не на кадр. */
function buildGuides(scene: SceneModel, style: RenderStyle, showGrid: boolean, showAxes: boolean): Float32Array {
  const data: number[] = [];
  const guide = parseColor(style.guide);
  const extent = Math.max(scene.size.x, scene.size.z, 1) * 1.6;
  const y = 0;

  if (showGrid) {
    // Шаг сетки — 100 мм: это не «магическая сетка привязки» (§25), а
    // только вспомогательная разметка пола. Привязка ни к сетке, ни к
    // её шагу отношения не имеет.
    const step = 100;
    const half = Math.ceil(extent / step) * step;
    for (let v = -half; v <= half; v += step) {
      data.push(-half, y, v, ...guide, half, y, v, ...guide);
      data.push(v, y, -half, ...guide, v, y, half, ...guide);
    }
  }

  if (showAxes) {
    // Оси в цветах X-красный, Y-зелёный, Z-синий — соглашение, знакомое
    // по любому 3D-инструменту. Своё изобретать незачем.
    const length = extent * 0.5;
    data.push(0, 0, 0, 0.85, 0.28, 0.28, length, 0, 0, 0.85, 0.28, 0.28);
    data.push(0, 0, 0, 0.3, 0.72, 0.4, 0, length, 0, 0.3, 0.72, 0.4);
    data.push(0, 0, 0, 0.32, 0.5, 0.9, 0, 0, length, 0.32, 0.5, 0.9);
  }

  return new Float32Array(data);
}

interface BoxUniforms {
  viewProjection: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  view: WebGLUniformLocation | null;
  color: WebGLUniformLocation | null;
  roughness: WebGLUniformLocation | null;
  metallic: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  state: WebGLUniformLocation | null;
  stateColor: WebGLUniformLocation | null;
  edges: WebGLUniformLocation | null;
}

/**
 * Создать рендерер на существующем холсте.
 *
 * Бросает исключение, если WebGL 2 недоступен: вызывающая сторона обязана
 * показать это пользователю и оставить работоспособным всё остальное
 * (§34 — 3D не может быть единственным способом управления). Тихо
 * нарисовать пустой прямоугольник было бы хуже всего: человек решил бы,
 * что сломался проект, а не браузер.
 */
export function createSceneRenderer(canvas: HTMLCanvasElement): SceneRenderer {
  const context = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    // Буфер глубины обязателен: без него передние детали не перекрывают
    // задние и корпус выглядит вывернутым наизнанку.
    depth: true,
    powerPreference: 'low-power',
  });
  if (context === null) throw new Error('WebGL 2 недоступен');
  // Отдельная константа с явным типом: `drawObject` и `dispose` —
  // объявления функций, и сужение типа из проверки выше в их тела не
  // переносится. Проверять на null внутри каждого кадра было бы враньём
  // о том, что контекст может исчезнуть посреди отрисовки.
  const gl: WebGL2RenderingContext = context;

  const boxProgram = link(gl, BOX_VERTEX_SHADER, BOX_FRAGMENT_SHADER);
  const lineProgram = link(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);

  const stats: RenderStats = { geometryUploads: 0, drawCalls: 0, culled: 0, lastFrameMs: 0 };

  // ── Геометрия: ОДИН единичный куб на всё приложение ──────────────────────
  const cube = unitCube();
  const boxVao = gl.createVertexArray();
  gl.bindVertexArray(boxVao);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  stats.geometryUploads += 1;

  // ── Линии: буфер переиспользуется, пересоздаётся только при смене сцены ──
  const lineVao = gl.createVertexArray();
  const lineBuffer = gl.createBuffer();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);

  let lineVertexCount = 0;
  let guidesKey = '';

  const u: BoxUniforms = {
    viewProjection: gl.getUniformLocation(boxProgram, 'uViewProjection'),
    model: gl.getUniformLocation(boxProgram, 'uModel'),
    view: gl.getUniformLocation(boxProgram, 'uView'),
    color: gl.getUniformLocation(boxProgram, 'uColor'),
    roughness: gl.getUniformLocation(boxProgram, 'uRoughness'),
    metallic: gl.getUniformLocation(boxProgram, 'uMetallic'),
    opacity: gl.getUniformLocation(boxProgram, 'uOpacity'),
    state: gl.getUniformLocation(boxProgram, 'uState'),
    stateColor: gl.getUniformLocation(boxProgram, 'uStateColor'),
    edges: gl.getUniformLocation(boxProgram, 'uEdges'),
  };
  const lineViewProjection = gl.getUniformLocation(lineProgram, 'uViewProjection');
  const lineOpacity = gl.getUniformLocation(lineProgram, 'uOpacity');

  let width = 1;
  let height = 1;

  // Матрицы объектов кэшируются по объекту: пока деталь не изменилась,
  // её матрица не пересобирается. Изменилась геометрия — WeakMap
  // отпускает старые объекты сам, без ручной инвалидации (§31).
  const modelCache = new WeakMap<SceneObject, Mat4>();
  const modelOf = (object: SceneObject): Mat4 => {
    const cached = modelCache.get(object);
    if (cached !== undefined) return cached;
    const matrix = composeBox(object.position, object.size);
    modelCache.set(object, matrix);
    return matrix;
  };

  function resize(cssWidth: number, cssHeight: number, pixelRatio: number): boolean {
    // Ограничение плотности: на телефоне с ratio 3 буфер вчетверо больше
    // нужного, и кадр уходит в десятки миллисекунд без единого выигрыша
    // в читаемости.
    const ratio = Math.min(Math.max(pixelRatio, 1), 2);
    const nextWidth = Math.max(1, Math.round(cssWidth * ratio));
    const nextHeight = Math.max(1, Math.round(cssHeight * ratio));
    const changed = nextWidth !== canvas.width || nextHeight !== canvas.height;

    // Собственный размер запоминается ВСЕГДА, даже когда холст уже нужного
    // размера. Раньше выход был раньше присваивания — и рендерер, созданный
    // на уже размеченном холсте, оставался с областью вывода 1×1 и рисовал
    // чёрный прямоугольник. Воспроизводилось при пересоздании рендерера
    // (в разработке это делает StrictMode, в жизни — смена темы или
    // возврат вкладки), а в production не воспроизводилось только потому,
    // что рендерер создавался ровно один раз.
    width = nextWidth;
    height = nextHeight;
    if (changed) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    return changed;
  }

  function drawObject(object: SceneObject, request: RenderRequest, view: Mat4): void {
    const material = object.material;
    const state = request.states.get(object.id) ?? 'normal';

    const color = object.kind === 'gizmo' ? parseColor(request.style.selection) : parseColor(material?.color ?? '#b8b2a7');
    const stateColor =
      state === 'invalid'
        ? parseColor(request.style.invalid)
        : state === 'hovered'
          ? parseColor(request.style.hover)
          : parseColor(request.style.selection);

    // Объём (ячейка, секция) показывается полупрозрачной подсветкой, а не
    // сплошной коробкой: это область, а не деталь (§6, §21).
    const isVolume = object.kind === 'cell' || object.kind === 'section';
    const opacity = isVolume ? 0.22 : object.kind === 'gizmo' ? 0.38 : (material?.opacity ?? 1);

    gl.uniformMatrix4fv(u.model, false, modelOf(object));
    gl.uniformMatrix4fv(u.view, false, view);
    gl.uniform3fv(u.color, isVolume ? stateColor : color);
    gl.uniform1f(u.roughness, material?.roughness ?? 0.9);
    gl.uniform1f(u.metallic, material?.metallic ?? 0);
    gl.uniform1f(u.opacity, opacity);
    gl.uniform1i(u.state, isVolume ? 0 : STATE_CODE[state]);
    gl.uniform3fv(u.stateColor, stateColor);
    gl.uniform1f(u.edges, isVolume || object.kind === 'gizmo' ? 0 : 1);

    gl.drawElements(gl.TRIANGLES, cube.indices.length, gl.UNSIGNED_SHORT, 0);
    stats.drawCalls += 1;
  }

  function visible(object: SceneObject, request: RenderRequest): boolean {
    if (object.kind === 'gizmo') return request.showGizmos;
    if (object.kind === 'cell' || object.kind === 'section') return request.visibleVolumes.has(object.id);
    return object.visible;
  }

  function render(request: RenderRequest): void {
    const started = performance.now();
    stats.drawCalls = 0;
    stats.culled = 0;

    const aspect = width / height;
    const vp = viewProjection(request.camera, aspect);
    // Матрица вида нужна шейдеру отдельно: освещение закреплено за
    // камерой, а не за миром (см. `shaders.ts`).
    const view = viewMatrix(request.camera);

    gl.viewport(0, 0, width, height);
    const background = parseColor(request.style.background);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // Отбраковка задних граней ВЫКЛЮЧЕНА намеренно: камера регулярно
    // оказывается внутри корпуса, и без задних граней шкаф изнутри
    // выглядит дырявым.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // ── Линии ──────────────────────────────────────────────────────────────
    const key = `${String(request.showGrid)}/${String(request.showAxes)}/${String(request.scene.size.x)}/${String(request.scene.size.z)}/${request.style.guide}`;
    if (key !== guidesKey) {
      const data = buildGuides(request.scene, request.style, request.showGrid, request.showAxes);
      gl.bindVertexArray(lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      lineVertexCount = data.length / 6;
      guidesKey = key;
      gl.bindVertexArray(null);
    }

    if (lineVertexCount > 0) {
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineViewProjection, false, vp);
      gl.uniform1f(lineOpacity, 0.5);
      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, lineVertexCount);
      stats.drawCalls += 1;
    }

    // ── Коробки ────────────────────────────────────────────────────────────
    gl.useProgram(boxProgram);
    gl.uniformMatrix4fv(u.viewProjection, false, vp);
    gl.bindVertexArray(boxVao);

    // Непрозрачное раньше прозрачного — порядок уже задан адаптером
    // (`byOpacity`), здесь он только соблюдается. Подсветка объёмов и
    // ручки идут последними: они всегда полупрозрачны.
    const overlays: SceneObject[] = [];
    for (const object of request.scene.objects) {
      if (!visible(object, request)) {
        stats.culled += 1;
        continue;
      }
      if (object.kind === 'cell' || object.kind === 'section' || object.kind === 'gizmo') {
        overlays.push(object);
        continue;
      }
      drawObject(object, request, view);
    }

    // Подсветка не пишет в буфер глубины: иначе полупрозрачная коробка
    // ячейки закрыла бы полки внутри себя от последующих слоёв.
    gl.depthMask(false);
    for (const object of overlays) drawObject(object, request, view);
    gl.depthMask(true);

    gl.bindVertexArray(null);
    stats.lastFrameMs = performance.now() - started;
  }

  function dispose(): void {
    gl.deleteProgram(boxProgram);
    gl.deleteProgram(lineProgram);
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(normalBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteBuffer(lineBuffer);
    gl.deleteVertexArray(boxVao);
    gl.deleteVertexArray(lineVao);
  }

  return {
    render,
    resize,
    get aspect() {
      return width / height;
    },
    stats,
    dispose,
  };
}
