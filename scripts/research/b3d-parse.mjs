#!/usr/bin/env node
/**
 * Исследовательский парсер .b3d (PROMPT 66 §3).
 *
 * НЕ продуктовый код: лежит в `scripts/research/`, ничего из `src/` не
 * импортирует и никем из `src/` не импортируется. Существует, чтобы
 * извлечение фактов из приложенного производственного файла можно было
 * ПОВТОРИТЬ, а не переписывать координаты в документ руками (§3).
 *
 * Формат восстановлен по самому файлу (`docs/B3D_FORMAT_FORENSICS.md`):
 *
 *   [0..]      заголовок контейнера, zlib-поток начинается со смещения,
 *              которое ищется сканированием сигнатуры 0x78 0x01|9C|DA|5E
 *   payload:   u32 keyCount, u32 0, затем keyCount × (u32 len + ASCII имя)
 *   далее:     поток записей
 *                u32 key       — индекс в таблице имён (1-based), либо id узла
 *                u32 tag       — 0 у поля, ненулевой у структурного маркера
 *                u8  type      — код типа значения
 *                value         — по коду типа
 *
 *   Коды типов, встреченные в файле:
 *     0x00 — нет значения (у структурных маркеров)
 *     0x01 — u8
 *     0x02 — пустое значение (установлено перебором длины: только длина 0
 *            доводит поток до конца файла)
 *     0x03 — u8  (булево/перечисление)
 *     0x04 — i32
 *     0x05 — f64
 *     0x06 — строка: u32 длина В СИМВОЛАХ + UTF-16LE
 *     0x07 — двоичный блок: u32 длина В БАЙТАХ + байты (не разбирается)
 *     0x08 — пустое значение, полезной нагрузки нет
 *     0x09 — завершитель потока (встречается один раз, за 8 байт до конца)
 *
 * Ничего не додумывается: неизвестный код типа обрывает разбор с
 * указанием смещения, а не подставляет значение по умолчанию.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function findPayload(raw) {
  // Берётся САМЫЙ БОЛЬШОЙ успешно распакованный поток, а не первый
  // достаточно большой: порог «больше N байт» отбрасывал бы маленькие
  // файлы, а размер настоящего файла заранее неизвестен.
  let best = null;
  for (let i = 0; i + 1 < raw.length; i += 1) {
    if (raw[i] !== 0x78) continue;
    if (![0x01, 0x5e, 0x9c, 0xda].includes(raw[i + 1])) continue;
    try {
      const out = inflateSync(raw.subarray(i));
      if (best === null || out.length > best.payload.length) best = { offset: i, payload: out };
    } catch {
      /* не тот поток — ищем дальше */
    }
  }
  if (best === null) throw new Error('zlib-поток не найден');
  return best;
}

function readKeyTable(buf) {
  const count = buf.readUInt32LE(0);
  let off = 8;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const len = buf.readUInt32LE(off);
    off += 4;
    if (len > 200 || off + len > buf.length) break;
    keys.push(buf.subarray(off, off + len).toString('latin1'));
    off += len;
  }
  return { keys, end: off };
}

/** Разбор потока записей в плоский список узлов с полями. */
export function parseB3d(path) {
  const { offset, payload } = findPayload(readFileSync(path));
  const { keys, end } = readKeyTable(payload);
  // Последняя «строка» таблицы — уже начало потока: имена ключей ASCII,
  // а поток содержит байты вне ASCII. Отрезаем по фактическому концу.
  const table = keys.filter((k) => /^[A-Za-z][A-Za-z0-9]*$/.test(k));
  let off = end - (keys.length - table.length === 0 ? 0 : 0);
  // пересчитываем конец таблицы по числу принятых имён
  off = 8;
  for (const k of table) off += 4 + k.length;

  const nodes = [];
  let current = null;
  const stats = { fields: 0, markers: 0 };

  while (off + 9 <= payload.length) {
    const key = payload.readUInt32LE(off);
    const tag = payload.readUInt32LE(off + 4);
    const type = payload[off + 8];
    off += 9;

    let value;
    switch (type) {
      case 0x00: value = null; break;
      case 0x01: value = payload[off]; off += 1; break;
      case 0x02: value = null; break;
      case 0x03: value = payload[off]; off += 1; break;
      case 0x04: value = payload.readInt32LE(off); off += 4; break;
      case 0x05: value = payload.readDoubleLE(off); off += 8; break;
      case 0x07: {
        // Двоичный блок: u32 длина в БАЙТАХ. Содержимое не разбирается —
        // для PM-18/PM-17 оно не нужно, но длину пропустить обязательно,
        // иначе поток рассыпается.
        const len = payload.readUInt32LE(off); off += 4;
        if (off + len > payload.length) { off = payload.length; break; }
        value = { blob: len };
        off += len;
        break;
      }
      case 0x08: value = null; break;
      case 0x06: {
        const chars = payload.readUInt32LE(off); off += 4;
        const bytes = chars * 2;
        if (off + bytes > payload.length) { off = payload.length; break; }
        value = payload.subarray(off, off + bytes).toString('utf16le');
        off += bytes;
        break;
      }
      case 0x09:
        return { offset, keys: table, nodes, stats, stoppedAt: off - 9, reason: 'завершитель 0x09' };
      default:
        return { offset, keys: table, nodes, stats, stoppedAt: off - 9, reason: `неизвестный тип 0x${type.toString(16)}` };
    }

    if (tag !== 0) {
      current = { id: key, tag, fields: {} };
      nodes.push(current);
      stats.markers += 1;
      continue;
    }
    const name = key >= 1 && key <= table.length ? table[key - 1] : `#${String(key)}`;
    if (current !== null) current.fields[name] = value;
    stats.fields += 1;
  }

  return { offset, keys: table, nodes, stats, stoppedAt: off, reason: 'конец потока' };
}

if (process.argv[1] && process.argv[1].endsWith('b3d-parse.mjs')) {
  const src = process.argv[2];
  const out = process.argv[3];
  if (src === undefined) {
    console.error('usage: node scripts/research/b3d-parse.mjs <file.b3d> [out.json]');
    process.exit(2);
  }
  const res = parseB3d(src);
  console.log(`zlib offset: ${String(res.offset)}`);
  console.log(`ключей в таблице: ${String(res.keys.length)}`);
  console.log(`узлов: ${String(res.nodes.length)}, полей: ${String(res.stats.fields)}`);
  console.log(`разбор завершён: ${res.reason} (смещение ${String(res.stoppedAt)})`);
  if (out !== undefined) {
    writeFileSync(out, JSON.stringify(res.nodes, null, 1));
    console.log(`записано: ${out}`);
  }
}
