#!/usr/bin/env node
/**
 * Пространственный анализ расстановки фурнитуры (PROMPT 66 §5, §6, §8).
 *
 * НЕ продуктовый код. Ничего из `src/` не импортирует.
 *
 * Что делает:
 *   1. Восстанавливает габаритные коробки деталей из положения, кватерниона,
 *      толщины и размеров L×W, взятых из деталировки (XLSX того же заказа).
 *      Ориентация локальных осей НЕ угадывается: перебираются обе раскладки
 *      (L,W) и (W,L) и оба знака вдоль каждой оси, принимается та коробка,
 *      которая целиком лежит в габарите изделия.
 *   2. Для каждого экземпляра крепежа ищет детали, которых он касается.
 *   3. Считает распределение гвоздей и крабиков по панелям задней стенки.
 *
 * Совпадение «крепёж рядом с деталью» само по себе стыком не считается
 * (§6): фиксируется, ЧЕРЕЗ какие детали проходит ось крепежа.
 */

import { writeFileSync } from 'node:fs';
import { buildObjects } from './b3d-objects.mjs';

/** Размеры деталей из деталировки заказа: имя → [L, W]. */
const SIZES = {
  'крыша накладная': [1240, 400], 'дно накладное': [1240, 400],
  'стенка левая': [2068, 400], 'стенка правая': [2068, 400],
  'перегородка 1': [2068, 400], 'полка': [596, 400], 'полка-стяжка': [596, 400],
  'доп. перегородка': [401, 399], 'ящик.фасад': [591, 196], 'ящик.зад': [538, 179],
  'ящик.лево': [369, 179], 'ящик.право': [369, 179], 'ящик.дно': [538, 353],
};
const BACK_SIZES = [[1236, 422], [1236, 417], [1236, 423]];
const ENVELOPE = { x: [0, 1240], y: [0, 2100], z: [0, 403] };
const EPS = 0.51;

function rotate(q, v) {
  const { x, y, z, w } = q;
  const [a, b, c] = v;
  // v' = v + 2w(q × v) + 2(q × (q × v))
  const cx = y * c - z * b, cy = z * a - x * c, cz = x * b - y * a;
  const dx = y * cz - z * cy, dy = z * cx - x * cz, dz = x * cy - y * cx;
  return [a + 2 * (w * cx + dx), b + 2 * (w * cy + dy), c + 2 * (w * cz + dz)];
}

function sizeOf(name) {
  const base = name.replace(/\s*\(\d+\)\s*$/, '');
  return SIZES[base] ?? null;
}

/** Коробка детали: origin + повёрнутые рёбра, знак выбирается по габариту. */
function panelBox(p, backSize) {
  const dims = p.name === 'задняя стенка' ? backSize : sizeOf(p.name);
  if (dims === null) return null;
  const t = p.thickness === 3 ? 3 : 16;
  for (const [u, v] of [[dims[0], dims[1]], [dims[1], dims[0]]]) {
    const axes = [rotate(p.rot, [u, 0, 0]), rotate(p.rot, [0, v, 0]), rotate(p.rot, [0, 0, t])];
    for (let mask = 0; mask < 8; mask += 1) {
      const lo = [p.x, p.y, p.z], hi = [p.x, p.y, p.z];
      for (let i = 0; i < 3; i += 1) {
        const s = (mask >> i) & 1 ? -1 : 1;
        for (let k = 0; k < 3; k += 1) {
          const d = axes[i][k] * s;
          if (d < 0) lo[k] += d; else hi[k] += d;
        }
      }
      const inside = ['x', 'y', 'z'].every((ax, k) =>
        lo[k] >= ENVELOPE[ax][0] - EPS && hi[k] <= ENVELOPE[ax][1] + EPS);
      if (inside) return { lo, hi };
    }
  }
  return null;
}

function contains(box, pt) {
  return [0, 1, 2].every((k) => pt[k] >= box.lo[k] - EPS && pt[k] <= box.hi[k] + EPS);
}

export function analyse(path) {
  const { panels, hardware } = buildObjects(path);
  let backIdx = 0;
  const boxed = panels.map((p) => {
    const bs = p.name === 'задняя стенка' ? BACK_SIZES[[0, 1, 2, 3, 4][backIdx++] === 0 ? 0 : (backIdx === 5 ? 2 : 1)] : null;
    return { name: p.name, box: panelBox(p, bs), raw: p };
  });
  const placed = boxed.filter((b) => b.box !== null);

  // Для каждого крепежа: какие детали пересекает его ось на глубину 60 мм.
  const rows = hardware.map((h) => {
    const dir = rotate(h.rot, [1, 0, 0]);
    const hits = new Set();
    for (let d = -40; d <= 60; d += 1) {
      const pt = [h.x + dir[0] * d, h.y + dir[1] * d, h.z + dir[2] * d];
      for (const b of placed) if (contains(b.box, pt)) hits.add(b.name);
    }
    return { name: h.name.replace(/\r/g, ' / '), x: h.x, y: h.y, z: h.z, parts: [...hits].sort() };
  });
  return { panels: boxed, hardware: rows };
}

if (process.argv[1] && process.argv[1].endsWith('b3d-placement.mjs')) {
  const res = analyse(process.argv[2]);
  const bad = res.panels.filter((p) => p.box === null);
  console.log(`деталей с восстановленной коробкой: ${String(res.panels.length - bad.length)}/${String(res.panels.length)}`);
  if (bad.length > 0) console.log('без коробки:', bad.map((b) => b.name).join(', '));
  if (process.argv[3] !== undefined) {
    writeFileSync(process.argv[3], JSON.stringify(res, null, 1));
    console.log(`записано: ${process.argv[3]}`);
  }
}
