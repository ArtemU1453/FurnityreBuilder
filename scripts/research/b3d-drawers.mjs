#!/usr/bin/env node
/**
 * Разбор ящиков по одному (FR-04, многообразцовый анализ).
 *
 * НЕ продуктовый код. Ничего из `src/` не импортирует.
 *
 * Задача: проверить, являются ли четыре ящика изделия ЧЕТЫРЬМЯ
 * независимыми измерениями или четырьмя копиями одного. Детали ящиков
 * в файле названы «ящик.фасад (9)», «ящик.зад (9)» и т. д., где число в
 * скобках — отсек, а не ящик: в одном отсеке стоят два ящика. Поэтому
 * ящики собираются НЕ по имени, а по координате Y: детали одного ящика
 * лежат в одной горизонтальной полосе.
 *
 * Размеры деталей берутся из деталировки того же заказа (единственный
 * источник размеров: `Contour` в файле не разбирается), а положение и
 * поворот — из файла. Ничего не додумывается: если деталь не нашлась,
 * поле остаётся пустым.
 */

import { writeFileSync } from 'node:fs';
import { buildObjects } from './b3d-objects.mjs';

/** Размеры деталей ящика из деталировки заказа: имя → [L, W]. */
const PART_SIZES = {
  'ящик.фасад': [591, 196],
  'ящик.зад': [538, 179],
  'ящик.лево': [369, 179],
  'ящик.право': [369, 179],
  'ящик.дно': [538, 353],
};

const KINDS = Object.keys(PART_SIZES);
const base = (name) => name.replace(/\s*\(\d+\)\s*$/, '');
const bay = (name) => {
  const m = /\((\d+)\)\s*$/.exec(name);
  return m === null ? null : Number(m[1]);
};

export function drawersOf(path) {
  const { panels, hardware } = buildObjects(path);
  const parts = panels.filter((p) => KINDS.includes(base(p.name)));

  // Группировка по Y: детали одного ящика лежат в пределах 40 мм друг от
  // друга по высоте, соседние ящики разнесены на ~200 мм.
  const sorted = [...parts].sort((a, b) => a.y - b.y);
  const groups = [];
  for (const p of sorted) {
    const g = groups.at(-1);
    if (g !== undefined && Math.abs(p.y - g.anchor) <= 40) { g.parts.push(p); continue; }
    groups.push({ anchor: p.y, parts: [p] });
  }

  const slides = hardware.filter((h) => h.name.includes('направляющие'));
  const handles = hardware.filter((h) => h.name.includes('Ручка'));

  return groups.map((g, i) => {
    const pick = (kind) => g.parts.find((p) => base(p.name) === kind) ?? null;
    const of = (kind) => {
      const p = pick(kind);
      if (p === null) return null;
      const [L, W] = PART_SIZES[kind];
      return { L, W, x: p.x, y: p.y, z: p.z, rot: p.rot, bay: bay(p.name) };
    };
    const near = (list) => {
      let best = null;
      for (const h of list) {
        const d = Math.abs(h.y - g.anchor);
        if (best === null || d < best.d) best = { d, h };
      }
      return best !== null && best.d < 140 ? best.h : null;
    };
    const facade = of('ящик.фасад');
    return {
      index: i + 1,
      bay: facade?.bay ?? null,
      anchorY: g.anchor,
      partCount: g.parts.length,
      facade, back: of('ящик.зад'), left: of('ящик.лево'),
      right: of('ящик.право'), bottom: of('ящик.дно'),
      slide: near(slides), handle: near(handles),
    };
  });
}

if (process.argv[1] && process.argv[1].endsWith('b3d-drawers.mjs')) {
  const list = drawersOf(process.argv[2]);
  console.log(`ящиков найдено: ${String(list.length)}`);
  for (const d of list) {
    console.log(`\n— ящик ${String(d.index)} (отсек ${String(d.bay)}), деталей ${String(d.partCount)}`);
    for (const k of ['facade', 'back', 'left', 'right', 'bottom']) {
      const p = d[k];
      console.log(`   ${k.padEnd(7)} ${p === null ? '—' : `${String(p.L)} × ${String(p.W)}  @ (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`}`);
    }
    console.log(`   slide   ${d.slide === null ? '—' : `@ (${d.slide.x.toFixed(1)}, ${d.slide.y.toFixed(1)}, ${d.slide.z.toFixed(1)})`}`);
    console.log(`   handle  ${d.handle === null ? '—' : `@ (${d.handle.x.toFixed(1)}, ${d.handle.y.toFixed(1)}, ${d.handle.z.toFixed(1)})`}`);
  }
  if (process.argv[3] !== undefined) {
    writeFileSync(process.argv[3], JSON.stringify(list, null, 1));
    console.log(`\nзаписано: ${process.argv[3]}`);
  }
}
