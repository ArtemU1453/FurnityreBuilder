import type { Vec3 } from '../domain/index.js';

/**
 * Матрицы и векторы для сцены (PROMPT 23).
 *
 * ## Почему это свой файл, а не библиотека
 *
 * Нужно ровно то, что перечислено ниже: перспектива, ортографическая
 * проекция, взгляд, умножение, обращение и перенос точки. Всё остальное,
 * что даёт математическая библиотека — кватернионы, эйлеровы углы,
 * сплайны, — этой сцене не нужно: изделие состоит из коробок,
 * выровненных по осям.
 *
 * ## Порядок хранения
 *
 * Столбцовый (column-major), как требует WebGL от `uniformMatrix4fv`:
 * элемент `m[c * 4 + r]` — строка `r` колонки `c`. Транспонирование при
 * загрузке в шейдер запрещено спецификацией WebGL, поэтому хранить
 * иначе означало бы транспонировать на каждом кадре вручную.
 */

/** Матрица 4×4, column-major. */
export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/** `out = a · b` (сначала применяется `b`). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Перенос и неравномерный масштаб — всё, что нужно коробке. */
export function composeBox(center: Vec3, size: Vec3): Mat4 {
  const m = new Float32Array(16);
  m[0] = size.x;
  m[5] = size.y;
  m[10] = size.z;
  m[12] = center.x;
  m[13] = center.y;
  m[14] = center.z;
  m[15] = 1;
  return m;
}

export function perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2);
  const m = new Float32Array(16);
  m[0] = f / (aspect || 1);
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function orthographic(halfHeight: number, aspect: number, near: number, far: number): Mat4 {
  const halfWidth = halfHeight * (aspect || 1);
  const m = new Float32Array(16);
  m[0] = 1 / halfWidth;
  m[5] = 1 / halfHeight;
  m[10] = -2 / (far - near);
  m[14] = -(far + near) / (far - near);
  m[15] = 1;
  return m;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
}

/**
 * Матрица вида.
 *
 * `up` не обязан быть перпендикулярен направлению взгляда — ортогональная
 * составляющая восстанавливается через два векторных произведения. Без
 * этого камера складывается в вырожденный базис ровно в тот момент, когда
 * пользователь доводит орбиту до полюса.
 */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const forward = normalize(sub(eye, target));
  const right = normalize(cross(up, forward));
  const trueUp = cross(forward, right);
  const m = new Float32Array(16);
  m[0] = right.x;
  m[1] = trueUp.x;
  m[2] = forward.x;
  m[4] = right.y;
  m[5] = trueUp.y;
  m[6] = forward.y;
  m[8] = right.z;
  m[9] = trueUp.z;
  m[10] = forward.z;
  m[12] = -dot(right, eye);
  m[13] = -dot(trueUp, eye);
  m[14] = -dot(forward, eye);
  m[15] = 1;
  return m;
}

/**
 * Обращение матрицы 4×4.
 *
 * Нужно ровно для одного: перевести точку экрана обратно в мир, чтобы
 * построить луч выбора. Общий алгоритм, а не «обращение аффинной
 * матрицы»: обращать приходится произведение проекции на вид, а проекция
 * аффинной не является.
 *
 * Возвращает `undefined` для вырожденной матрицы — это возможно, пока
 * холст не получил размер и aspect равен нулю. Тихо вернуть мусор здесь
 * означало бы получить выбор детали в случайной точке.
 */
export function invert(m: Mat4): Mat4 | undefined {
  const a = m;
  const g = (i: number): number => a[i] ?? 0;
  const b00 = g(0) * g(5) - g(1) * g(4);
  const b01 = g(0) * g(6) - g(2) * g(4);
  const b02 = g(0) * g(7) - g(3) * g(4);
  const b03 = g(1) * g(6) - g(2) * g(5);
  const b04 = g(1) * g(7) - g(3) * g(5);
  const b05 = g(2) * g(7) - g(3) * g(6);
  const b06 = g(8) * g(13) - g(9) * g(12);
  const b07 = g(8) * g(14) - g(10) * g(12);
  const b08 = g(8) * g(15) - g(11) * g(12);
  const b09 = g(9) * g(14) - g(10) * g(13);
  const b10 = g(9) * g(15) - g(11) * g(13);
  const b11 = g(10) * g(15) - g(11) * g(14);

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const d = 1 / det;

  const out = new Float32Array(16);
  out[0] = (g(5) * b11 - g(6) * b10 + g(7) * b09) * d;
  out[1] = (g(2) * b10 - g(1) * b11 - g(3) * b09) * d;
  out[2] = (g(13) * b05 - g(14) * b04 + g(15) * b03) * d;
  out[3] = (g(10) * b04 - g(9) * b05 - g(11) * b03) * d;
  out[4] = (g(6) * b08 - g(4) * b11 - g(7) * b07) * d;
  out[5] = (g(0) * b11 - g(2) * b08 + g(3) * b07) * d;
  out[6] = (g(14) * b02 - g(12) * b05 - g(15) * b01) * d;
  out[7] = (g(8) * b05 - g(10) * b02 + g(11) * b01) * d;
  out[8] = (g(4) * b10 - g(5) * b08 + g(7) * b06) * d;
  out[9] = (g(1) * b08 - g(0) * b10 - g(3) * b06) * d;
  out[10] = (g(12) * b04 - g(13) * b02 + g(15) * b00) * d;
  out[11] = (g(9) * b02 - g(8) * b04 - g(11) * b00) * d;
  out[12] = (g(5) * b07 - g(4) * b09 - g(6) * b06) * d;
  out[13] = (g(0) * b09 - g(1) * b07 + g(2) * b06) * d;
  out[14] = (g(13) * b01 - g(12) * b03 - g(14) * b00) * d;
  out[15] = (g(8) * b03 - g(9) * b01 + g(10) * b00) * d;
  return out;
}

/** Точка через матрицу, с делением на однородную координату. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const g = (i: number): number => m[i] ?? 0;
  const x = g(0) * p.x + g(4) * p.y + g(8) * p.z + g(12);
  const y = g(1) * p.x + g(5) * p.y + g(9) * p.z + g(13);
  const z = g(2) * p.x + g(6) * p.y + g(10) * p.z + g(14);
  const w = g(3) * p.x + g(7) * p.y + g(11) * p.z + g(15);
  return w === 0 ? { x, y, z } : { x: x / w, y: y / w, z: z / w };
}
