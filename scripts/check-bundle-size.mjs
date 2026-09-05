#!/usr/bin/env node
/**
 * Порог размера главного чанка (PROMPT 30 §17, §21).
 *
 * ## Зачем
 *
 * На PROMPT 29 в главный чанк вернулись pdf-lib и fontkit: барредь
 * `export/index.ts` реэкспортировал генераторы документов, а
 * `workflow/readiness.ts` импортировал из этого барреля функцию, которая
 * вычисляется на каждое изменение модели. Главный чанк весил 1809 КБ
 * вместо 648, и заметить это можно было только замером вручную.
 *
 * Порог ловит ровно такую регрессию: не «стало на килобайт больше», а
 * «в главный чанк въехала библиотека, которую никто не просил».
 *
 * ## Почему только главный чанк
 *
 * Отложенные чанки пользователь получает по нажатию и только если оно
 * было. Ограничивать их значило бы запрещать pdf-lib быть большим — а он
 * большой, и это нормально для того, кто выпускает документ.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Предел gzip главного чанка, байт.
 *
 * Текущий размер — 194 КБ. Запас до 260 КБ оставлен на рост приложения:
 * порог должен ловить въехавшую библиотеку, а не заставлять править
 * число на каждую новую панель.
 */
const LIMIT = 260 * 1024;

/** Чанки, которые обязаны оставаться отложенными. */
const LAZY = ['pdf', 'xlsx'];

const dir = 'dist/assets';
let files;
try {
  files = readdirSync(dir).filter((name) => name.endsWith('.js'));
} catch {
  console.error(`Нет каталога ${dir}. Сначала выполните npm run build.`);
  process.exit(1);
}

const sized = files.map((name) => {
  const bytes = readFileSync(join(dir, name));
  return { name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
});

// Главный чанк — самый большой из тех, что не отложены.
const lazy = sized.filter((file) => LAZY.some((prefix) => file.name.startsWith(prefix)));
const eager = sized.filter((file) => !lazy.includes(file));
const main = eager.reduce((biggest, file) => (file.gzip > biggest.gzip ? file : biggest), eager[0]);

if (main === undefined) {
  console.error('В сборке нет ни одного чанка приложения.');
  process.exit(1);
}

const kb = (value) => `${(value / 1024).toFixed(1)} КБ`;
for (const file of sized) {
  const mark = lazy.includes(file) ? 'отложен' : 'сразу';
  console.log(
    `${file.name.padEnd(34)} ${kb(file.raw).padStart(10)} raw  ${kb(file.gzip).padStart(9)} gzip  ${mark}`,
  );
}

if (lazy.length < LAZY.length) {
  console.error(
    `\nОтложенных чанков ${String(lazy.length)}, ожидалось ${String(LAZY.length)}: генератор документов попал в главный чанк.`,
  );
  console.error('Импортируйте export/pdf.js и export/xlsx.js только через await import().');
  process.exit(1);
}

if (main.gzip > LIMIT) {
  console.error(`\nГлавный чанк ${main.name}: ${kb(main.gzip)} gzip при пределе ${kb(LIMIT)}.`);
  console.error('Проверьте, не попала ли в него библиотека, нужная лишь по нажатию.');
  process.exit(1);
}

console.log(`\nГлавный чанк ${main.name}: ${kb(main.gzip)} gzip при пределе ${kb(LIMIT)}.`);
