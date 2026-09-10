import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
// @ts-expect-error — общий модуль без типов: он же читается сборочными
// скриптами на чистом JS, и заводить ради него .d.ts не за чем.
import { appBase } from './scripts/app-base.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Версия и отметка сборки (PROMPT 32 §26).
 *
 * Источник версии один — `package.json`. Второго объявления в коде нет
 * намеренно: два места, где написано «0.1.0», расходятся при первом же
 * выпуске.
 *
 * `__BUILD_DATE__` — дата, а не время с секундами: она попадает в
 * интерфейс, и точность до секунды там не значит ничего, зато делает
 * каждую сборку отличной от предыдущей и мешает воспроизводимости.
 * Переопределить её можно через `SOURCE_DATE_EPOCH` — тем же способом,
 * которым воспроизводимость обеспечивают сборки дистрибутивов.
 */
const buildDate = new Date(
  process.env.SOURCE_DATE_EPOCH === undefined
    ? Date.now()
    : Number(process.env.SOURCE_DATE_EPOCH) * 1000,
)
  .toISOString()
  .slice(0, 10);

export default defineConfig({
  /*
    Базовый путь. По умолчанию корень домена; `APP_BASE` переводит сборку
    в подкаталог — так приложение публикуется на GitHub Pages
    (`docs/DEPLOYMENT.md` §2). Значение читается общим модулем, потому
    что тот же путь нужен манифесту, service worker'у и проверке пакета.
  */
  base: appBase() as string,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    target: 'es2022',
    // The product must work offline and pull nothing from third-party hosts.
    // Everything is bundled locally; see docs/BRAND_INDEPENDENCE_AUDIT.md.
    assetsInlineLimit: 4096,
  },
});
