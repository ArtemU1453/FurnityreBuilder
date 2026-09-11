#!/usr/bin/env node
/**
 * Сборка объектов изделия из разобранного .b3d (PROMPT 66 §3, §5).
 *
 * НЕ продуктовый код. Ничего из `src/` не импортирует.
 *
 * Структура, восстановленная по файлу:
 *
 *   {Type, Name, ID}            — заголовок объекта
 *   {X, Y, Z, Rx, Ry, Rz, Rw}   — мировое положение и кватернион поворота
 *   {Mat, Thick, Contour}       — только у панелей
 *   {X,Y,Z,DirX,DirY,DirZ,Radius,Depth} — отверстия, в ЛОКАЛЬНЫХ координатах
 *                                          той фурнитуры, за которой идут
 *
 *   Type 4002 — деталь (панель)
 *   Type 3001 — экземпляр фурнитуры
 *
 * Отверстия в файле идут ПЕРЕД описанием фурнитуры, к которой относятся
 * (проверено на минификсе и рафиксе), поэтому собираются в буфер и
 * приписываются следующему описанию.
 */

import { writeFileSync } from 'node:fs';
import { parseB3d } from './b3d-parse.mjs';

const PANEL = 4002;
const HARDWARE = 3001;

export function buildObjects(path) {
  const { nodes } = parseB3d(path);
  const objects = [];
  let pending = null;
  let holes = [];

  for (const node of nodes) {
    const f = node.fields;

    if (typeof f['Type'] === 'number' && typeof f['Name'] === 'string') {
      if (pending !== null) objects.push(pending);
      pending = { type: f['Type'], name: f['Name'], id: f['ID'] ?? null, holes: [] };
      continue;
    }

    if (pending !== null && typeof f['X'] === 'number' && typeof f['Rw'] === 'number') {
      pending.x = f['X']; pending.y = f['Y']; pending.z = f['Z'];
      pending.rot = { x: f['Rx'], y: f['Ry'], z: f['Rz'], w: f['Rw'] };
      continue;
    }

    if (pending !== null && typeof f['Thick'] === 'number' && typeof f['Mat'] === 'string') {
      pending.material = f['Mat'];
      pending.thickness = f['Thick'];
      continue;
    }

    if (typeof f['Radius'] === 'number' && typeof f['Depth'] === 'number') {
      holes.push({ x: f['X'], y: f['Y'], z: f['Z'], dir: [f['DirX'], f['DirY'], f['DirZ']], r: f['Radius'], depth: f['Depth'] });
      continue;
    }

    // Описание фурнитуры (габаритная рамка) закрывает накопленные отверстия.
    if (typeof f['Name'] === 'string' && typeof f['MinX'] === 'number') {
      const target = objects.findLast?.((o) => o.type === HARDWARE && o.name === f['Name'] && o.holes.length === 0);
      if (target !== undefined && target !== null) target.holes = holes;
      else if (pending !== null && pending.name === f['Name']) pending.holes = holes;
      holes = [];
      continue;
    }
  }
  if (pending !== null) objects.push(pending);

  return {
    panels: objects.filter((o) => o.type === PANEL),
    hardware: objects.filter((o) => o.type === HARDWARE),
  };
}

if (process.argv[1] && process.argv[1].endsWith('b3d-objects.mjs')) {
  const src = process.argv[2];
  const out = process.argv[3];
  const { panels, hardware } = buildObjects(src);
  console.log(`деталей: ${String(panels.length)}`);
  console.log(`экземпляров фурнитуры: ${String(hardware.length)}`);
  const placed = hardware.filter((h) => typeof h.x === 'number').length;
  console.log(`из них с координатами: ${String(placed)}`);
  if (out !== undefined) {
    writeFileSync(out, JSON.stringify({ panels, hardware }, null, 1));
    console.log(`записано: ${out}`);
  }
}
