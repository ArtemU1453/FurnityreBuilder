#!/usr/bin/env node
/**
 * Бюджеты производительности production-сборки (PROMPT 30 §17, PROMPT 44).
 *
 * ## Зачем
 *
 * На PROMPT 29 в главный чанк вернулись pdf-lib и fontkit: баррель
 * `export/index.ts` реэкспортировал генераторы документов, а
 * `workflow/readiness.ts` импортировал из этого барреля функцию, которая
 * вычисляется на каждое изменение модели. Главный чанк весил 1809 КБ
 * вместо 648, и заметить это можно было только замером вручную.
 *
 * Проверка ловит ровно такую регрессию: не «стало на килобайт больше», а
 * «в загрузку по умолчанию въехала библиотека, которую никто не просил».
 *
 * ## Что отличает первую загрузку от отложенной
 *
 * Первая загрузка — то, без чего приложение не откроется: разметка,
 * главный чанк, точка входа, стили. Отложенное пользователь получает по
 * нажатию и только если оно было. Мерить их одним числом бессмысленно:
 * pdf-lib большой, и это нормально для того, кто выпускает документ.
 *
 * ## Откуда бюджеты
 *
 * Из `performance/bundle-baseline.json`. Там же записано, почему каждый
 * выбран именно таким. Здесь чисел нет намеренно: два места, где написан
 * бюджет, расходятся при первой же правке.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`;
const gzipOf = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

let assets;
try {
  assets = readdirSync(ASSETS);
} catch {
  console.error(`Нет каталога ${ASSETS}. Сначала выполните npm run build.`);
  process.exit(1);
}

/* ── Что во что входит ──────────────────────────────────────────────── */

/**
 * Отложенные чанки распознаются по имени, а имена задаёт разбиение кода.
 * Список короткий и обязан таким остаться: каждая новая строка здесь —
 * это возможность, которую вынесли из первой загрузки, и решение того
 * стоит принимать осознанно.
 */
const LAZY_PREFIXES = ['pdf-', 'xlsx-', 'memory-repository-'];
const isLazy = (name) => LAZY_PREFIXES.some((prefix) => name.startsWith(prefix));

const js = assets.filter((name) => name.endsWith('.js'));
const eagerJs = js.filter((name) => !isLazy(name));
const css = assets.filter((name) => name.endsWith('.css'));

if (eagerJs.length === 0) {
  console.error('В сборке нет ни одного чанка первой загрузки.');
  process.exit(1);
}

const sizeOfEach = (names) =>
  names.map((name) => ({ name, gzip: gzipOf(join(ASSETS, name)), raw: statSync(join(ASSETS, name)).size }));

const eager = sizeOfEach(eagerJs);
const styles = sizeOfEach(css);
const htmlGzip = gzipOf(join(DIST, 'index.html'));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const totalRaw = walk(DIST).reduce((sum, file) => sum + statSync(file).size, 0);

const sum = (list) => list.reduce((total, item) => total + item.gzip, 0);
const lazyGzip = (prefix) => {
  const found = assets.find((name) => name.startsWith(prefix));
  return found === undefined ? undefined : gzipOf(join(ASSETS, found));
};

/** Кто именно даёт вклад в метрику — чтобы при отказе было куда смотреть. */
const contributors = {
  'initial-js-gzip': eager,
  'initial-css-gzip': styles,
  'largest-initial-chunk-gzip': eager,
  'critical-total-gzip': [...eager, ...styles],
};

const measured = {
  'initial-js-gzip': sum(eager),
  'initial-css-gzip': sum(styles),
  'largest-initial-chunk-gzip': eager.reduce((biggest, file) => Math.max(biggest, file.gzip), 0),
  'critical-total-gzip': sum(eager) + sum(styles) + htmlGzip,
  'lazy-pdf-gzip': lazyGzip('pdf-'),
  'lazy-xlsx-gzip': lazyGzip('xlsx-'),
  'total-build-raw': totalRaw,
};

/* ── Сверка с бюджетами ─────────────────────────────────────────────── */

const baseline = JSON.parse(readFileSync('performance/bundle-baseline.json', 'utf8'));
const problems = [];

console.log('Первая загрузка:');
for (const file of [...eager, ...styles]) {
  console.log(`  ${file.name.padEnd(34)} ${kb(file.raw).padStart(10)} raw  ${kb(file.gzip).padStart(10)} gzip`);
}
console.log('Отложенное:');
for (const name of assets.filter(isLazy)) {
  const file = join(ASSETS, name);
  console.log(`  ${name.padEnd(34)} ${kb(statSync(file).size).padStart(10)} raw  ${kb(gzipOf(file)).padStart(10)} gzip`);
}
console.log('');

for (const metric of baseline.metrics) {
  const actual = measured[metric.id];
  if (actual === undefined) {
    problems.push({ metric, actual: undefined });
    continue;
  }
  const delta = actual - metric.baseline;
  const sign = delta >= 0 ? '+' : '−';
  const status = actual > metric.budget ? 'ПРЕВЫШЕН' : 'в бюджете';
  console.log(
    `${metric.id.padEnd(28)} ${kb(actual).padStart(10)}  ` +
      `бюджет ${kb(metric.budget).padStart(10)}  ` +
      `к базе ${sign}${kb(Math.abs(delta))}  ${status}`,
  );
  if (actual > metric.budget) problems.push({ metric, actual });
}

if (problems.length === 0) {
  console.log('\nВсе метрики в пределах бюджета.');
  process.exit(0);
}

/* ── Отказ обязан быть полезным ─────────────────────────────────────── */

console.error(`\nБюджет производительности превышен. Метрик: ${String(problems.length)}.`);
for (const { metric, actual } of problems) {
  console.error(`\n  Метрика:    ${metric.id} — ${metric.title}`);
  if (actual === undefined) {
    console.error('  Значение:   не измерено — соответствующего файла нет в сборке');
    console.error('  Что делать: либо чанк исчез, либо изменилось его имя. Проверьте разбиение кода.');
    continue;
  }
  console.error(`  Сейчас:     ${kb(actual)}`);
  console.error(`  Бюджет:     ${kb(metric.budget)}`);
  console.error(`  Превышение: ${kb(actual - metric.budget)} (${((100 * (actual - metric.budget)) / metric.budget).toFixed(1)} %)`);
  console.error(`  К базе:     ${kb(actual - metric.baseline)} от ${kb(metric.baseline)}`);
  const parts = contributors[metric.id];
  if (parts !== undefined) {
    const top = [...parts].sort((a, b) => b.gzip - a.gzip).slice(0, 3);
    console.error(`  Вклад:      ${top.map((f) => `${f.name} (${kb(f.gzip)})`).join(', ')}`);
  }
  console.error(`  Почему так: ${metric.description}`);
}
console.error(
  '\nЕсли рост обоснован — обновите performance/bundle-baseline.json вместе с объяснением\n' +
    'в docs/PERFORMANCE_BUDGETS.md. Молча поднимать бюджет нельзя: он затем и нужен.',
);
process.exit(1);
