/**
 * Шейдеры сцены (PROMPT 23 §29–§30).
 *
 * ## Освещение нейтральное, а не фотореалистичное
 *
 * Задача — читаемость: понять, где грань, какая деталь толще и что за
 * чем стоит. Три источника, никаких теней, никакого отражённого
 * окружения. Фотореализм здесь не просто лишний — он вреден: блик на
 * ЛДСП мешает увидеть кромку, а мягкая тень скрывает зазор между
 * деталями, то есть ровно то, ради чего человек открыл конструктор.
 *
 * ## Почему освещение в пространстве вида
 *
 * Источники закреплены за камерой, а не за миром. Иначе при вращении
 * изделие уезжает в темноту, и пользователь теряет форму именно тогда,
 * когда он её рассматривает.
 */

export const BOX_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform mat4 uView;

out vec3 vViewNormal;
out vec3 vViewPosition;
out vec3 vLocal;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);

  // Масштаб коробки неравномерный (панель 16 мм против 2000 мм), поэтому
  // нормаль нельзя умножать на матрицу модели как есть: у тонкой панели
  // она перестала бы быть перпендикулярной грани и панель осветилась бы
  // как ребро. Матрица масштаба диагональна, поэтому обратная
  // транспонированная сводится к делению на квадрат масштаба.
  vec3 scaleSq = vec3(
    dot(uModel[0].xyz, uModel[0].xyz),
    dot(uModel[1].xyz, uModel[1].xyz),
    dot(uModel[2].xyz, uModel[2].xyz)
  );
  vec3 worldNormal = normalize(mat3(uModel) * (aNormal / max(scaleSq, vec3(1e-8))));

  vViewNormal = mat3(uView) * worldNormal;
  vViewPosition = (uView * world).xyz;
  vLocal = aPosition;
  gl_Position = uViewProjection * world;
}
`;

export const BOX_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vViewNormal;
in vec3 vViewPosition;
in vec3 vLocal;

uniform vec3 uColor;
uniform float uRoughness;
uniform float uMetallic;
uniform float uOpacity;
/** 0 — обычная деталь, 1 — выделено, 2 — под курсором, 3 — недоступно, 4 — ошибка. */
uniform int uState;
uniform vec3 uStateColor;
/** 1 — рисовать рёбра коробки: без них соседние панели сливаются в пятно. */
uniform float uEdges;

out vec4 fragColor;

/**
 * Три источника, закреплённые за камерой: ключевой сверху-слева-спереди,
 * заполняющий справа и слабый контровой снизу-сзади. Контровой отделяет
 * силуэт от фона, когда изделие смотрит на камеру тёмной стороной.
 */
const vec3 KEY_DIR = normalize(vec3(-0.45, 0.75, 0.55));
const vec3 FILL_DIR = normalize(vec3(0.65, 0.15, 0.45));
const vec3 RIM_DIR = normalize(vec3(0.1, -0.6, -0.7));

void main() {
  vec3 normal = normalize(vViewNormal);
  vec3 viewDir = normalize(-vViewPosition);
  if (!gl_FrontFacing) normal = -normal;

  float key = max(dot(normal, KEY_DIR), 0.0);
  float fill = max(dot(normal, FILL_DIR), 0.0);
  float rim = max(dot(normal, RIM_DIR), 0.0);

  // Полуламберт по ключевому источнику: грань, отвёрнутая от света, не
  // уходит в чёрный, и деталь остаётся читаемой со всех сторон.
  float diffuse = 0.34 + 0.52 * (key * 0.5 + 0.5) + 0.2 * fill + 0.12 * rim;

  float shininess = mix(4.0, 96.0, 1.0 - clamp(uRoughness, 0.0, 1.0));
  vec3 halfDir = normalize(KEY_DIR + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), shininess) * (1.0 - clamp(uRoughness, 0.0, 1.0));

  // У металла (зеркала) блик окрашен в цвет материала, у диэлектрика — белый.
  vec3 specularColor = mix(vec3(1.0), uColor, clamp(uMetallic, 0.0, 1.0));
  vec3 color = uColor * diffuse + specularColor * specular * 0.45;

  // Рёбра: чем ближе к границе единичного куба, тем темнее. Считается по
  // локальной координате, поэтому линия не зависит ни от масштаба детали,
  // ни от расстояния до камеры и не мерцает при движении.
  if (uEdges > 0.5) {
    vec3 distanceToEdge = 0.5 - abs(vLocal);
    vec3 width = fwidth(vLocal) * 1.5;
    vec3 edge = smoothstep(vec3(0.0), max(width, vec3(1e-5)), distanceToEdge);
    float line = 1.0 - min(min(edge.x, edge.y), edge.z);
    color = mix(color, color * 0.55, line * 0.85);
  }

  float opacity = clamp(uOpacity, 0.0, 1.0);

  if (uState == 1) {
    // Выделение: подмешивание цвета плюс собственное свечение по краю.
    // Не обводка постобработкой — она требует второго прохода и всё
    // равно теряется на тонкой панели.
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
    color = mix(color, uStateColor, 0.42 + 0.35 * fresnel);
    opacity = max(opacity, 0.85);
  } else if (uState == 2) {
    color = mix(color, uStateColor, 0.2);
  } else if (uState == 3) {
    // Недоступно: обесцвечивание, а не затемнение. Тёмная деталь
    // читается как «другой материал», серая — как «сейчас нельзя».
    float grey = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(grey), color, 0.25);
    opacity *= 0.85;
  } else if (uState == 4) {
    color = mix(color, uStateColor, 0.55);
  }

  fragColor = vec4(color, opacity);
}
`;

/**
 * Линии: оси, сетка, подсветка границ выбранной ячейки.
 *
 * Отдельная программа, потому что линии не освещаются: свет на линии —
 * это мерцание при вращении и ничего больше.
 */
export const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;

uniform mat4 uViewProjection;

out vec3 vColor;

void main() {
  vColor = aColor;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

export const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, uOpacity);
}
`;
