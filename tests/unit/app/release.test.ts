import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_VERSION, BUILD_DATE, BUILD_ID } from '../../../src/app/version.js';

/**
 * Согласованность выпускаемого пакета (PROMPT 32 §3, §5, §13, §26).
 *
 * Проверяется то, что живёт в СТАТИЧЕСКИХ файлах и потому не покрывается
 * ни одним тестом кода: манифест, разметка входной страницы, отсутствие
 * переменных окружения. Ошибка в любом из них не роняет ни типы, ни
 * линтер — она обнаруживается только у пользователя, который не смог
 * установить приложение.
 *
 * E2E проверяет то же самое в браузере на СОБРАННОМ приложении; здесь —
 * дешёвая проверка исходников, которая падает за секунду, а не за минуту.
 */

const read = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('версия приложения (§26)', () => {
  it('источник версии один: package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    // В модульном тесте Vite подстановку не делает, и виден запасной
    // вариант. Это и есть его смысл: он сразу говорит, что сборка шла
    // мимо обычного пути. В настоящей сборке здесь номер из package.json,
    // и это проверяет E2E на собранном приложении.
    expect(APP_VERSION).toBe('0.0.0-dev');
  });

  it('идентификатор сборки собирается из версии и даты', () => {
    expect(BUILD_ID).toBe(`${APP_VERSION} (${BUILD_DATE})`);
  });

  it('сборщик получает версию из package.json, а не из константы', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('__APP_VERSION__');
    expect(config).toContain('pkg.version');
    // Второго места с настоящим номером версии быть не должно: они
    // разойдутся. Запасное значение для тестов намеренно не похоже на
    // номер выпуска.
    const literals = read('src/app/version.ts').match(/['"]\d+\.\d+\.\d+[^'"]*['"]/g) ?? [];
    expect(literals).toEqual(["'0.0.0-dev'"]);
  });
});

describe('переменных окружения нет вовсе (§3)', () => {
  it('в исходниках нет обращений к process.env', () => {
    for (const file of ['src/app/App.tsx', 'src/app/service-worker.ts', 'src/main.tsx']) {
      expect(read(file), file).not.toContain('process.env');
    }
  });

  it('единственное обращение к import.meta.env — флаг режима разработки', () => {
    const app = read('src/app/App.tsx');
    const uses = app.match(/import\.meta\.env\.[A-Za-z_]+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    // `DEV` вырезается сборщиком вместе с веткой. Любое другое поле
    // означало бы настройку, которую пользователь обязан откуда-то взять.
    expect(new Set(uses)).toEqual(new Set(['import.meta.env.DEV']));
  });
});

describe('манифест приложения (§5)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('имя и короткое имя заданы, короткое — влезает в подпись под значком', () => {
    expect(manifest.name).toContain('Furniture Builder');
    // Подпись обрезается примерно после двенадцати знаков.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('область действия и стартовый адрес — корень', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('режим показа даёт установку как приложения', () => {
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  });

  it('есть обязательные размеры и maskable-иконка', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('цвет темы совпадает с цветом фона приложения', () => {
    // Расхождение видно глазом: системная панель и страница разного цвета.
    const tokens = read('src/design-system/tokens.css');
    expect(tokens).toContain('--n-100: #eff1f4');
    expect(manifest.background_color).toBe('#eff1f4');
    expect(read('index.html')).toContain('content="#eff1f4"');
  });
});

describe('разметка входной страницы (§5, §13, §14)', () => {
  const html = read('index.html');

  it('ссылается на манифест, значки и цвет темы', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('name="theme-color"');
  });

  it('несёт метаданные страницы, но ни одного стороннего сервиса', () => {
    expect(html).toContain('name="description"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="robots"');
    expect(html).not.toMatch(/google|yandex|analytics|gtag|facebook/i);
  });

  it('iOS-теги на месте: манифест там не читают', () => {
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-title');
  });
});

describe('service worker не трогает данные пользователя (§7, §8)', () => {
  const generator = read('scripts/build-sw.mjs');

  it('в шаблоне воркера нет обращений к IndexedDB', () => {
    // Комментарии отбрасываются: слово в объяснении — не обращение.
    const code = generator.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bindexedDB\b/i);
  });

  it('активация удаляет только кэши этого приложения', () => {
    expect(generator).toContain("startsWith('furniture-builder-')");
  });

  it('новая версия ждёт разрешения, а не встаёт под работающей вкладкой', () => {
    expect(generator).toContain('SKIP_WAITING');
    // `skipWaiting` в install означал бы подмену бандла без спроса.
    expect(generator).not.toMatch(/install[\s\S]{0,400}skipWaiting/);
  });

  it('поиск в кэше игнорирует Vary: иначе офлайн ломается на любом CDN', () => {
    expect(generator).toContain('ignoreVary: true');
  });
});
