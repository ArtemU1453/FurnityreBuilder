#!/usr/bin/env node
/**
 * Ни одно предположение не должно тихо превратиться в «факт».
 *
 * В коде каждая неподтверждённая формула помечается ASSUMPTION(<id>).
 * Скрипт сверяет маркеры с реестром docs/UNKNOWNS.json: маркер без записи —
 * ошибка сборки. Так список того, что мы на самом деле не знаем, остаётся
 * актуальным, а не устаревает через месяц.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SOURCE_DIRS = ['src', 'tests'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css']);
const MARKER = /ASSUMPTION\(([A-Za-z0-9-]+)\)/g;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(extname(full))) files.push(full);
  }
  return files;
}

const registry = JSON.parse(readFileSync(join(ROOT, 'docs/UNKNOWNS.json'), 'utf8'));
const known = new Set(registry.unknowns.map((u) => u.id));

const found = new Map();
for (const dir of SOURCE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(MARKER)) {
      const id = match[1];
      if (!found.has(id)) found.set(id, []);
      found.get(id).push(file.replace(`${ROOT}/`, ''));
    }
  }
}

const orphans = [...found.keys()].filter((id) => !known.has(id));

if (orphans.length > 0) {
  console.error('Маркеры ASSUMPTION без записи в docs/UNKNOWNS.json:');
  for (const id of orphans) console.error(`  ${id}  →  ${found.get(id).join(', ')}`);
  console.error('\nДобавьте запись в реестр или уберите маркер.');
  process.exit(1);
}

const unresolved = registry.unknowns.filter((u) => u.status === 'unknown').length;
console.log(
  `Предположений в коде: ${found.size}. Записей в реестре: ${known.size}, из них не подтверждено: ${unresolved}.`,
);
