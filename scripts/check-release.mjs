#!/usr/bin/env node
/**
 * Проверка готовности production-пакета (PROMPT 32 §2, §21, §25).
 *
 * Проверяет СОБРАННЫЙ `dist/`, а не исходники: между кодом и тем, что
 * получит пользователь, стоит сборщик, и утверждения об одном не
 * доказывают ничего о другом. Именно так уже устроены `check:brand` и
 * `check:bundle` — здесь тот же подход, другие вопросы.
 *
 * Что здесь НЕ проверяется, чтобы не дублировать: внешние обращения и
 * упоминания референса (`check:brand`), размер главного чанка
 * (`check:bundle`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

if (!existsSync(DIST)) {
  console.error('dist/ не найден: сначала `npm run build`.');
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(relative(DIST, full).split(sep).join('/'));
  }
  return files;
}

const files = walk(DIST).sort();
const text = (name) => readFileSync(join(DIST, name), 'utf8');

/* ── 1. Обязательный состав пакета (§25) ───────────────────────────── */

const REQUIRED = [
  'index.html',
  '404.html',
  'sw.js',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];
for (const name of REQUIRED) {
  if (!files.includes(name)) fail(`в пакете нет обязательного файла: ${name}`);
}

/* ── 2. Лишнее в пакете (§25) ──────────────────────────────────────── */

const FORBIDDEN = [
  { re: /\.map$/, why: 'карта исходников' },
  { re: /^test-results\//, why: 'артефакт тестов' },
  { re: /^playwright-report\//, why: 'отчёт тестов' },
  { re: /\.(env|pem|key|p12)$/, why: 'файл с секретами' },
  { re: /\.spec\.|\.test\./, why: 'тест' },
  { re: /\.DS_Store$/, why: 'мусор файловой системы' },
];
for (const name of files) {
  for (const { re, why } of FORBIDDEN) {
    if (re.test(name)) fail(`в пакете лишний файл (${why}): ${name}`);
  }
}

/* ── 3. Никаких секретов и адресов разработки в бандле (§3, §21) ───── */

const SECRET_PATTERNS = [
  { re: /\bsk-[A-Za-z0-9]{16,}/, label: 'похоже на API-ключ' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'ключ AWS' },
  { re: /\bghp_[A-Za-z0-9]{20,}/, label: 'токен GitHub' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'закрытый ключ' },
  { re: /\bBearer\s+[A-Za-z0-9._-]{20,}/, label: 'токен доступа' },
];
const DEV_PATTERNS = [
  { re: /http:\/\/localhost:\d+/, label: 'адрес localhost' },
  { re: /http:\/\/127\.0\.0\.1:\d+/, label: 'адрес 127.0.0.1' },
  { re: /\bNODE_ENV\s*===?\s*['"]development['"]/, label: 'ветка режима разработки' },
];

const SCANNED = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.svg']);
for (const name of files) {
  const dot = name.lastIndexOf('.');
  if (!SCANNED.has(name.slice(dot))) continue;
  const content = text(name);
  for (const { re, label } of [...SECRET_PATTERNS, ...DEV_PATTERNS]) {
    const found = re.exec(content);
    if (found !== null) fail(`${name}: ${label} — «${found[0].slice(0, 40)}»`);
  }
}

/* ── 4. Отладочный интерфейс не доехал до сборки (§2) ──────────────── */

const bundles = files.filter((f) => f.endsWith('.js') && f !== 'sw.js');

/**
 * Чужой код, за отладочный вывод которого мы не отвечаем.
 *
 * В отложенном чанке PDF таких мест ровно два, оба чужие и оба
 * недостижимы в этом приложении:
 *
 *   1. `console.log("FLATE:", …)` — собственный распаковщик Flate внутри
 *      `pdf-lib`. Ветка относится к ЧТЕНИЮ существующих PDF, а
 *      приложение их только создаёт.
 *   2. `console.log(t)` — запасной путь предупреждения о числе
 *      слушателей во встроенной замене node-модуля `events`. Он
 *      выполняется, только если у окружения нет `console.warn`, то есть
 *      никогда в браузере.
 *
 * Убрать их можно лишь правкой зависимости, а это хуже, чем знать о них.
 * Что вывода нет и на практике — на настоящем экспорте в настоящем
 * браузере — проверяет `tests/e2e/console.spec.ts`.
 *
 * Исключение именное и посчитанное: третий `console.log` в этом чанке
 * или первый в любом другом — по-прежнему отказ.
 */
const VENDOR_LOG_ALLOWED = [{ chunk: /^assets\/pdf-/, count: 2 }];

for (const name of bundles) {
  const content = text(name);
  // Строка технической схемы существует только под `import.meta.env.DEV`.
  // Минификация стирает имена, но не строковые литералы, поэтому ищем текст.
  if (content.includes('Схема (debug')) fail(`${name}: в сборку попал отладочный интерфейс`);

  const budget = VENDOR_LOG_ALLOWED.find((rule) => rule.chunk.test(name))?.count ?? 0;
  const logs = content.match(/\bconsole\.log\s*\(/g) ?? [];
  if (logs.length > budget) {
    fail(`${name}: console.log в сборке — ${String(logs.length)} при допуске ${String(budget)}`);
  } else if (budget > 0) {
    notes.push(`${name}: ${String(logs.length)} недостижимых console.log чужой библиотеки — см. docs/KNOWN_ISSUES.md`);
  }
}

/* ── 5. Манифест пригоден к установке (§5) ─────────────────────────── */

const manifest = JSON.parse(text('manifest.webmanifest'));
for (const field of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
  if (manifest[field] === undefined) fail(`manifest: нет обязательного поля ${field}`);
}
if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
  fail(`manifest: display=${String(manifest.display)} не даёт установки как приложения`);
}
const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
if (!sizes.has('192x192') || !sizes.has('512x512')) {
  fail('manifest: нужны иконки 192×192 и 512×512');
}
if (!manifest.icons.some((icon) => icon.purpose === 'maskable')) {
  fail('manifest: нет maskable-иконки — на Android знак обрежется по краю');
}
for (const icon of manifest.icons) {
  if (!files.includes(icon.src.replace(/^\//, ''))) fail(`manifest: иконки нет в пакете: ${icon.src}`);
}

/* ── 6. Страница ссылается на манифест и иконки (§5, §13) ──────────── */

const html = text('index.html');
for (const [what, re] of [
  ['манифест', /rel="manifest"/],
  ['favicon', /rel="icon"/],
  ['apple-touch-icon', /rel="apple-touch-icon"/],
  ['theme-color', /name="theme-color"/],
  ['description', /name="description"/],
  ['viewport', /name="viewport"/],
]) {
  if (!re.test(html)) fail(`index.html: нет ${what}`);
}

/* ── 7. Service worker согласован со сборкой (§7) ──────────────────── */

const sw = text('sw.js');
const version = /const CACHE = '([^']+)'/.exec(sw);
if (version === null) fail('sw.js: не найдено имя кэша');
else notes.push(`Кэш: ${version[1]}`);

const precache = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw);
if (precache === null) fail('sw.js: не найден список предзагрузки');
else {
  for (const url of JSON.parse(precache[1])) {
    if (!files.includes(url.replace(/^\//, ''))) {
      fail(`sw.js: в предзагрузке файл, которого нет в пакете: ${url}`);
    }
  }
}
// Главный бандл обязан быть предзагружен: без него офлайн не откроется.
const entry = bundles.find((f) => /^assets\/index-.*\.js$/.test(f) && statSync(join(DIST, f)).size > 100_000);
if (entry !== undefined && precache !== null && !JSON.parse(precache[1]).includes(`/${entry}`)) {
  fail(`sw.js: главный чанк ${entry} не в предзагрузке — офлайн приложение не откроется`);
}
if (!sw.includes('SKIP_WAITING')) {
  fail('sw.js: нет управляемой активации — новая версия встанет под работающей вкладкой');
}
// Комментарии отбрасываются: слово «IndexedDB» в объяснении того, почему
// воркер к базе НЕ обращается, не должно засчитываться как обращение.
const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
if (/\bindexedDB\b/i.test(swCode)) {
  fail('sw.js: обращение к хранилищу проектов — обновление приложения не должно касаться данных');
}

/* ── Итог ──────────────────────────────────────────────────────────── */

const total = files.reduce((sum, f) => sum + statSync(join(DIST, f)).size, 0);
console.log(`Пакет: ${String(files.length)} файлов, ${(total / 1024).toFixed(1)} КБ.`);
for (const note of notes) console.log(note);

if (problems.length > 0) {
  console.error(`\nПакет не готов к выпуску. Найдено: ${String(problems.length)}.`);
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}
console.log('Пакет готов к выпуску: состав, манифест, service worker и содержимое бандла проверены.');
