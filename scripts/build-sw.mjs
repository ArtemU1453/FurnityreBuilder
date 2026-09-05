#!/usr/bin/env node
/**
 * Сборка service worker'а (PROMPT 32 §6, §7).
 *
 * ## Почему генератор, а не файл в `public/`
 *
 * Имена файлов сборки содержат хеш содержимого и меняются при каждой
 * правке кода. Список предзагрузки, записанный руками, устарел бы в тот
 * же день — и приложение офлайн доставало бы из кэша чанк, которого в
 * сборке больше нет. Поэтому список читается ИЗ `dist/` после сборки.
 *
 * ## Почему без Workbox
 *
 * Workbox решает задачи, которых здесь нет: несколько стратегий на
 * разные маршруты, фоновая синхронизация, очереди запросов. У продукта
 * ровно два вида ресурсов — неизменяемые файлы с хешем в имени и одна
 * навигационная страница, — и правил для них два. Зависимость со своим
 * сборочным конвейером ради двадцати строк противоречила бы всему
 * остальному проекту.
 *
 * ## Версия
 *
 * Имя кэша содержит версию приложения и отпечаток списка файлов. Любая
 * пересборка, изменившая хоть один файл, меняет имя кэша, а `activate`
 * удаляет все кэши с другим именем. Устаревший бандл после выкладки не
 * переживёт активацию новой версии.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

/**
 * Предзагрузка идёт в два яруса, и это не оптимизация, а надёжность.
 *
 * `install` обязан выполнить `addAll` целиком: одна неудачная загрузка
 * отменяет установку. Значит в него можно класть только то, без чего
 * приложение вообще не откроется, — оболочку. Она невелика, и на плохой
 * связи установка всё-таки завершится.
 *
 * Тяжёлое — шрифт для PDF и чанки экспорта — догружается ПОСЛЕ
 * активации, по одному файлу и без права провалить установку. Пока
 * догрузка не закончилась, приложение уже работает офлайн; недостающим
 * окажется только экспорт, и ровно об этом сказано в документации.
 *
 * Без второго яруса пришлось бы выбирать между «экспорт офлайн не
 * работает» и «установка падает на медленной связи». Оба ответа хуже.
 */
const SHELL_SKIP = [/^sw\.js$/, /^assets\/pdf-/, /^assets\/xlsx-/, /^fonts\//];
const WARM_MATCH = [/^assets\/pdf-/, /^assets\/xlsx-/, /^fonts\/.*\.ttf$/];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const all = walk(DIST)
  .map((f) => relative(DIST, f).split(sep).join('/'))
  .sort();

const precache = all.filter((f) => !SHELL_SKIP.some((re) => re.test(f))).map((f) => `/${f}`);
const warm = all.filter((f) => WARM_MATCH.some((re) => re.test(f))).map((f) => `/${f}`);

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
// Отпечаток содержимого, а не времени сборки: две сборки одного и того же
// исходника дают одно имя кэша и не заставляют пользователей качать заново.
const fingerprint = createHash('sha256')
  .update(all.map((f) => `${f}:${statSync(join(DIST, f)).size}`).join('\n'))
  .digest('hex')
  .slice(0, 12);

const CACHE = `furniture-builder-v${version}-${fingerprint}`;

const sw = `/*
 * Service worker приложения Furniture Builder.
 *
 * Файл СОБИРАЕТСЯ (scripts/build-sw.mjs) — править его в dist/ бесполезно.
 *
 * Две стратегии, потому что ресурсов ровно два вида:
 *
 *   1. Файлы с хешем в имени неизменяемы по построению. Совпало имя —
 *      совпало содержимое, поэтому кэш можно отдавать не спрашивая сеть.
 *   2. Навигация (страница приложения) идёт в сеть первой: только так
 *      пользователь получает новую выкладку. Сеть недоступна — отдаётся
 *      сохранённая страница, и приложение открывается офлайн.
 *
 * Чего здесь НЕТ намеренно: обращения к IndexedDB. Проекты пользователя
 * не принадлежат кэшу приложения, и ни одна ветка ниже их не касается —
 * обновление версии не может их потерять (PROMPT 32 §7, §8).
 */

const CACHE = '${CACHE}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const WARM = ${JSON.stringify(warm, null, 2)};

/** Последний рубеж: сети нет и страницы в кэше тоже. */
const OFFLINE_PAGE = \`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Нет сети — Furniture Builder</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font:16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    background:#eff1f4; color:#14181f; padding:24px; }
  main { max-width:32rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { margin:0 0 .5rem; color:#4a5261; }
  @media (prefers-color-scheme: dark) { body { background:#14181f; color:#eff1f4; } p { color:#9aa4b6; } }
</style></head>
<body><main>
  <h1>Приложение ещё не сохранено для работы без сети</h1>
  <p>Откройте страницу один раз с интернетом — после этого она будет работать офлайн.</p>
  <p>Сохранённые проекты при этом никуда не делись: они лежат в этом браузере.</p>
</main></body></html>\`;


self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // Отдельно кладём '/': навигационные запросы приходят именно на
      // него, а в списке предзагрузки лежит '/index.html'. Без этой
      // строки первая же попытка открыть приложение офлайн сразу после
      // установки не нашла бы страницы.
      const shell = await cache.match('/index.html', { ignoreVary: true });
      if (shell !== undefined) await cache.put('/', shell);
      // Ждать закрытия всех вкладок незачем: активацию всё равно
      // подтверждает пользователь через сообщение SKIP_WAITING.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Удаляются только кэши ЭТОГО приложения: чужие имена не трогаем.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('furniture-builder-') && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      await warmUp();
    })(),
  );
});

/**
 * Догрузка тяжёлых ресурсов после активации.
 *
 * По одному файлу и с перехватом ошибки на каждом: сеть могла оборваться
 * посередине, и это не повод объявлять установку неудачной. Уже лежащее
 * в кэше не перезапрашивается — на второй активации функция почти
 * ничего не делает.
 */
async function warmUp() {
  const cache = await caches.open(CACHE);
  for (const url of WARM) {
    try {
      if ((await cache.match(url, { ignoreVary: true })) !== undefined) continue;
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    } catch {
      // Молча: догрузка — улучшение, а не условие работы приложения.
    }
  }
}

/**
 * Немедленная активация по просьбе страницы.
 *
 * Сама собой новая версия не встаёт: пока открыта вкладка со старой,
 * подмена бандла под работающим приложением сломала бы его. Страница
 * показывает предложение обновиться и присылает это сообщение, когда
 * пользователь согласился.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

/**
 * Поиск в кэше по АДРЕСУ, без учёта заголовка \`Vary\`.
 *
 * Без \`ignoreVary\` офлайн ломается на любом сервере, который шлёт \`Vary\`
 * — а шлют его почти все: \`vite preview\` отдаёт \`Vary: Origin\`, CDN
 * обычно \`Vary: Accept-Encoding\`. Записи в кэш кладёт \`addAll\`, чей
 * запрос заголовка \`Origin\` не несёт, а страница просит модульные
 * скрипты запросом CORS, который несёт. Заголовки не совпадают, ответ не
 * находится, и приложение офлайн остаётся без своего же главного чанка,
 * хотя тот лежит в кэше.
 *
 * Игнорировать \`Vary\` здесь безопасно именно потому, что имена файлов
 * содержат хеш содержимого: адрес однозначно определяет ответ, и
 * договариваться о представлениях не о чем.
 */
function match(request) {
  return caches.match(request, { ignoreVary: true, cacheName: CACHE });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужие домены не кэшируются. Их у приложения и нет, но правило должно
  // быть явным: иначе первый же случайный запрос осел бы в кэше.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          await cache.put('/', fresh.clone());
          return fresh;
        } catch {
          // Сети нет — отдаём сохранённую страницу приложения. Любой
          // адрес внутри области действия ведёт к ней же: маршрутов у
          // приложения нет, вся навигация внутренняя.
          const cached = (await match('/')) ?? (await match('/index.html'));
          if (cached !== undefined) return cached;
          return new Response(OFFLINE_PAGE, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await match(request);
      if (cached !== undefined) return cached;
      const response = await fetch(request);
      // В кэш попадает только успешный ответ своего происхождения:
      // класть туда 404 значило бы закрепить ошибку навсегда.
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

`;

writeFileSync(join(DIST, 'sw.js'), sw);

const sizeOf = (list) => list.reduce((sum, f) => sum + statSync(join(DIST, f.slice(1))).size, 0);
console.log(`sw.js собран. Кэш: ${CACHE}`);
console.log(`Оболочка (install):   ${String(precache.length).padStart(2)} файлов, ${(sizeOf(precache) / 1024).toFixed(1).padStart(7)} КБ`);
console.log(`Догрузка (activate):  ${String(warm.length).padStart(2)} файлов, ${(sizeOf(warm) / 1024).toFixed(1).padStart(7)} КБ`);
