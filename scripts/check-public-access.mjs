#!/usr/bin/env node
/**
 * Целостность публичного входа (PROMPT 42).
 *
 * ## Что охраняется
 *
 * Единственный путь пользователя к продукту:
 *
 *     репозиторий → README → «Открыть приложение» → рабочее приложение
 *
 * Сломать его можно молча и множеством способов: переименовать
 * репозиторий, сменить ветку по умолчанию, поправить ссылку «почти
 * верно», оставить в ней localhost после отладки. Ни один тест продукта
 * этого не заметит — приложение при этом исправно.
 *
 * ## Откуда берётся ожидаемый адрес
 *
 * Он НЕ записан в проекте второй константой. Адрес страниц проекта на
 * GitHub Pages определяется устройством самой площадки:
 *
 *     https://<владелец>.github.io/<репозиторий>/
 *
 * Поэтому он ВЫЧИСЛЯЕТСЯ из принадлежности репозитория — из
 * `GITHUB_REPOSITORY` в CI, из адреса `origin` локально. Переименуют
 * репозиторий — изменится и ожидание, и проверка потребует обновить
 * README. Ровно этого от неё и ждут.
 *
 * ## Чего здесь НЕТ
 *
 * Обращения в сеть. Проверка обязана проходить на каждом pull request, в
 * том числе когда площадка недоступна: доступность боевого адреса —
 * задача дымовой проверки после выкладки, а не этой
 * (`docs/PUBLIC_ACCESS_INTEGRITY.md`).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);

/** Заголовок раздела, в котором живёт ссылка входа. */
const ENTRY_HEADING = 'Открыть приложение';

/** Подделки: адрес, который выглядит адресом, но никуда не ведёт. */
const PLACEHOLDERS = [
  /example\.(com|org|net)/i,
  /YOUR[_-]?URL/i,
  /\bTODO\b/i,
  /PLACEHOLDER/i,
  /ACTUAL_.*URL/i,
  /<[^>]*>/,
];

/* ── Ожидаемый адрес ────────────────────────────────────────────────── */

function repositorySlug() {
  const fromCi = process.env.GITHUB_REPOSITORY;
  if (fromCi !== undefined && fromCi.includes('/')) return fromCi;
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/.exec(remote);
    if (match !== null) return `${match[1]}/${match[2]}`;
  } catch {
    // Ни CI, ни git — ниже об этом будет сказано прямо.
  }
  return undefined;
}

const slug = repositorySlug();
if (slug === undefined) {
  console.error('Не удалось определить репозиторий: нет ни GITHUB_REPOSITORY, ни origin.');
  process.exit(1);
}
const [owner, repo] = slug.split('/');
// Хост Pages всегда в нижнем регистре, имя репозитория регистр сохраняет.
const EXPECTED_PATH = `/${repo}/`;
const EXPECTED = `https://${owner.toLowerCase()}.github.io${EXPECTED_PATH}`;
notes.push(`Репозиторий: ${slug}`);
notes.push(`Ожидаемый адрес: ${EXPECTED}`);

/* ── 1. Раздел входа есть и в нём есть ссылка ───────────────────────── */

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const lines = readme.split('\n');
const start = lines.findIndex((line) => /^#{1,3}\s/.test(line) && line.includes(ENTRY_HEADING));

let entryLinks = [];
if (start === -1) {
  fail(`README.md: нет раздела «${ENTRY_HEADING}» — пользователю негде найти приложение`);
} else {
  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).join('\n');
  entryLinks = [...section.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1].trim());
  if (entryLinks.length === 0) {
    fail(`README.md: в разделе «${ENTRY_HEADING}» нет ни одной ссылки`);
  }
}

/* ── 2. Каждая ссылка входа пригодна ────────────────────────────────── */

for (const link of entryLinks) {
  if (/^(https?:)?\/\/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(link)) {
    fail(`README.md: ссылка входа ведёт на локальный адрес — «${link}»`);
    continue;
  }
  for (const re of PLACEHOLDERS) {
    if (re.test(link)) {
      fail(`README.md: ссылка входа — заглушка, а не адрес: «${link}»`);
      break;
    }
  }
  if (!link.startsWith('https://')) {
    fail(`README.md: ссылка входа не по HTTPS — «${link}». Без него нет ни офлайна, ни установки`);
    continue;
  }
  if (link !== EXPECTED) {
    fail(
      `README.md: ссылка входа «${link}» не совпадает с адресом публикации «${EXPECTED}». ` +
        'Либо адрес изменился и README устарел, либо ссылку поправили мимо',
    );
  }
}

/* ── 3. Ни один документ не называет ДРУГОЙ адрес ───────────────────── */

/**
 * Второй адрес — это второй источник истины. Он и опаснее битой ссылки:
 * битую замечают сразу, а разошедшуюся правильную — никогда.
 */
const docFiles = ['README.md', ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f))];
for (const rel of docFiles) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  for (const match of text.matchAll(/https:\/\/[a-z0-9-]+\.github\.io\/[^\s)`"']*/gi)) {
    // Хвост разметки к адресу не относится: «…/FurnityreBuilder/**» в
    // жирном начертании — тот же адрес, а не другой.
    const found = match[0].replace(/[*_~`.,;:]+$/, '');
    const normalized = found.endsWith('/') ? found : `${found}/`;
    if (normalized !== EXPECTED) {
      fail(`${rel}: назван другой адрес приложения — «${found}» вместо «${EXPECTED}»`);
    }
  }
}

/* ── 4. Пакет, если он собран, отвечает тому же адресу ──────────────── */

const dist = join(ROOT, 'dist');
if (existsSync(join(dist, 'index.html'))) {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
  const base = String(manifest.scope);
  if (base !== '/' && base !== EXPECTED_PATH) {
    fail(
      `dist/manifest.webmanifest: базовый путь «${base}» не соответствует ни корню, ни адресу ` +
        `публикации «${EXPECTED_PATH}». Такая сборка на площадке даст белый экран`,
    );
  } else {
    notes.push(`Собранный пакет: базовый путь ${base}`);
  }
} else {
  notes.push('Пакет не собран — проверка базового пути пропущена (это не ошибка).');
}

/* ── Итог ───────────────────────────────────────────────────────────── */

for (const note of notes) console.log(note);
if (problems.length > 0) {
  console.error(`\nПубличный вход нарушен. Найдено: ${String(problems.length)}.`);
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}
console.log('Публичный вход цел: раздел, ссылка, адрес и документы сходятся.');
