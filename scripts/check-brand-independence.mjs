#!/usr/bin/env node
/**
 * Проверка самостоятельности продукта (docs/BRAND_INDEPENDENCE_AUDIT.md §5).
 *
 * Ловит две вещи:
 *   1. упоминание исследовательского референса где-либо кроме docs/;
 *   2. внешние источники в разметке и стилях — приложение обязано работать
 *      без единого стороннего запроса.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'public', 'tests'];
const SCAN_FILES = ['index.html', 'package.json', 'README.md', 'vite.config.ts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.json', '.svg', '.md']);

const BRAND_PATTERNS = [/privetmaket/i, /привет\s*[-\s]?макет/i];

/**
 * Единственное допустимое вхождение — путь к нашему собственному
 * исследовательскому документу. Его имя задано требованиями этапа 1 и не
 * может быть изменено; ссылка на файл документации — не упоминание сервиса
 * в продукте. Комментарии в исходниках до сборки не доживают, что отдельно
 * проверяется сканированием dist/ ниже.
 */
const ALLOWED_DOC_PATH = /docs\/PRIVETMAKET_FUNCTIONAL_SPEC\.md/g;

const EXTERNAL_PATTERNS = [
  { re: /https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+/gi, label: 'внешний URL' },
  { re: /<iframe/gi, label: 'iframe' },
  { re: /fonts\.googleapis\.com|fonts\.gstatic\.com/gi, label: 'внешний шрифт' },
  { re: /google-analytics|googletagmanager|yandex\.ru\/metrika|mc\.yandex/gi, label: 'аналитика' },
];

/**
 * Ссылки на документацию и спецификации допустимы в комментариях и в README.
 *
 * `schemas.openxmlformats.org` — не ссылка, а ИДЕНТИФИКАТОР пространства
 * имён XML в формате XLSX (PROMPT 20). Он обязан присутствовать в файле
 * дословно, иначе книгу не откроет ни один редактор таблиц, и никогда не
 * запрашивается по сети: это имя, а не адрес.
 */
const ALLOWED_URL = /(schema\.org|www\.w3\.org|claude\.ai|github\.com\/emilkowalski|schemas\.openxmlformats\.org)/i;

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(extname(full))) files.push(full);
  }
  return files;
}

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...SCAN_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
];

const problems = [];

for (const file of files) {
  const rel = file.replace(`${ROOT}/`, '');
  const text = readFileSync(file, 'utf8').replace(ALLOWED_DOC_PATH, '<doc>');

  for (const pattern of BRAND_PATTERNS) {
    if (pattern.test(text)) {
      problems.push(`${rel}: упоминание исследовательского референса вне docs/`);
    }
  }

  for (const { re, label } of EXTERNAL_PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (ALLOWED_URL.test(match[0])) continue;
      problems.push(`${rel}: ${label} — ${match[0]}`);
    }
  }
}

/**
 * Собранный артефакт — то, что реально попадает к пользователю.
 * Здесь исключений нет вообще: ни одного упоминания, ни одного внешнего хоста.
 */
const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  for (const file of walk(dist)) {
    const rel = file.replace(`${ROOT}/`, '');
    const text = readFileSync(file, 'utf8');

    // Упоминание бренда и трекеры недопустимы нигде в артефакте.
    for (const pattern of BRAND_PATTERNS) {
      if (pattern.test(text)) problems.push(`${rel}: упоминание референса в собранном артефакте`);
    }
    for (const { re, label } of EXTERNAL_PATTERNS.filter((p) => p.label !== 'внешний URL')) {
      for (const match of text.matchAll(re)) {
        problems.push(`${rel}: ${label} в собранном артефакте — ${match[0]}`);
      }
    }

    // Внешние ЗАГРУЗКИ объявляются в разметке и стилях — их и проверяем.
    // В JavaScript-бандле URL встречаются как текст внутри сообщений об
    // ошибках библиотек (например, ссылка на документацию React); это не
    // обращение к сети. Отсутствие реальных запросов проверяет E2E-тест
    // «приложение не выполняет ни одного внешнего запроса».
    if (!['.html', '.css'].includes(extname(file))) continue;
    for (const match of text.matchAll(/https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+/gi)) {
      if (ALLOWED_URL.test(match[0])) continue;
      problems.push(`${rel}: внешний источник в собранном артефакте — ${match[0]}`);
    }
  }
} else {
  console.log('dist/ отсутствует — проверка собранного артефакта пропущена (запустите после build).');
}

if (problems.length > 0) {
  console.error('Нарушения самостоятельности продукта:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`Проверено файлов: ${files.length}. Внешних зависимостей и упоминаний референса не найдено.`);
