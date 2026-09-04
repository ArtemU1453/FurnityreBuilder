import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Architectural boundaries are enforced here, not by convention.
 *
 * ARCHITECTURE.md §1 states: "React-компонент не содержит математики мебели.
 * UI не является источником истины." A comment cannot enforce that. This config
 * can: an import of React inside src/geometry fails the build.
 *
 * Dependency direction is strictly downward:
 *   app → state/interaction → validation → geometry → domain
 *   app → design-system → motion
 */
const LAYERS = [
  { type: 'domain', pattern: 'src/domain/**/*' },
  { type: 'geometry', pattern: 'src/geometry/**/*' },
  { type: 'hardware', pattern: 'src/hardware/**/*' },
  { type: 'production', pattern: 'src/production/**/*' },
  { type: 'drilling', pattern: 'src/drilling/**/*' },
  { type: 'bom', pattern: 'src/bom/**/*' },
  { type: 'export', pattern: 'src/export/**/*' },
  { type: 'workflow', pattern: 'src/workflow/**/*' },
  { type: 'validation', pattern: 'src/validation/**/*' },
  { type: 'persistence', pattern: 'src/persistence/**/*' },
  { type: 'state', pattern: 'src/state/**/*' },
  { type: 'motion', pattern: 'src/motion/**/*' },
  { type: 'interaction', pattern: 'src/interaction/**/*' },
  { type: 'design-system', pattern: 'src/design-system/**/*' },
  { type: 'render', pattern: 'src/render/**/*' },
  { type: 'app', pattern: 'src/app/**/*' },
  { type: 'entry', pattern: 'src/main.tsx' },
];

/** Layers that must stay free of React, the DOM and every browser API. */
const PURE_LAYERS = [
  'src/domain/**/*.ts',
  'src/geometry/**/*.ts',
  'src/validation/**/*.ts',
  // PROMPT 16 §14: расчёт фурнитуры обязан быть независим от React и DOM.
  'src/hardware/**/*.ts',
  // PROMPT 17 §35: расчёт раскроя детерминирован и не знает об интерфейсе.
  'src/production/**/*.ts',
  // PROMPT 18 §33: расчёт присадки — тоже чистый детерминированный расчёт.
  'src/drilling/**/*.ts',
  // PROMPT 19 §24: спецификация не привязана к React, DOM и экрану.
  'src/bom/**/*.ts',
  // PROMPT 20 §2: генераторы документов не знают ни о React, ни об экране.
  'src/export/**/*.ts',
  // PROMPT 21 §3: проверка готовности — доменная функция, не интерфейс.
  'src/workflow/**/*.ts',
];

const UI_FRAMEWORK_IMPORTS = {
  patterns: [
    {
      group: ['react', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
      message:
        'Architectural boundary: this layer must not depend on the UI framework or the store. ' +
        'The domain is the source of truth, not React. See docs/ARCHITECTURE.md §1.',
    },
  ],
};

const BROWSER_GLOBALS = [
  { name: 'window', message: 'This layer must run without a DOM (tests, workers). See docs/ARCHITECTURE.md §1.' },
  { name: 'document', message: 'This layer must run without a DOM. See docs/ARCHITECTURE.md §1.' },
  { name: 'localStorage', message: 'Storage access belongs in src/persistence behind ProjectRepository.' },
  { name: 'sessionStorage', message: 'Storage access belongs in src/persistence behind ProjectRepository.' },
  { name: 'indexedDB', message: 'Storage access belongs in src/persistence behind ProjectRepository.' },
  { name: 'navigator', message: 'This layer must run without a browser. See docs/ARCHITECTURE.md §1.' },
  { name: 'fetch', message: 'The application performs no network requests. See docs/BRAND_INDEPENDENCE_AUDIT.md §4.4.' },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // ── Architectural boundaries ────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // mode 'full' сопоставляет шаблон с полным путём файла, а не с папкой:
      // иначе файлы, лежащие прямо в src/domain, не попадают ни в один слой.
      'boundaries/elements': LAYERS.map((layer) => ({ ...layer, mode: 'full' })),
      'boundaries/include': ['src/**/*.ts', 'src/**/*.tsx'],
      // Исходники импортируют друг друга со ссылкой на .js (verbatimModuleSyntax),
      // а на диске лежат .ts. Без резолвера TypeScript плагин не находит файл
      // и молча считает зависимость неизвестной — то есть разрешённой.
      // Именно так проверка границ и превращается в бесполезную декорацию.
      'import/resolver': { typescript: { alwaysTryTypes: true, project: './tsconfig.json' } },
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: 'Layer "${file.type}" must not import from "${dependency.type}". See docs/ARCHITECTURE.md §1.',
          rules: [
            { from: 'domain', allow: ['domain'] },
            { from: 'geometry', allow: ['geometry', 'domain'] },
            // Расчёт фурнитуры — производная от геометрии, поэтому видит её
            // и домен, но не state и не UI (PROMPT 16 §14: движок чистый).
            { from: 'hardware', allow: ['hardware', 'geometry', 'domain'] },
            // Раскрой — производная от геометрии и деталей: видит их и
            // домен, но не state и не UI (PROMPT 17 §25: раскрой ничего не
            // меняет в модели, зависимость строго односторонняя).
            { from: 'production', allow: ['production', 'geometry', 'domain'] },
            // Присадка — производная от геометрии, деталей и фурнитуры
            // (PROMPT 18 §2). Она читает все три и не пишет ни в один.
            { from: 'drilling', allow: ['drilling', 'production', 'hardware', 'geometry', 'domain'] },
            // Производственная спецификация — агрегат всех расчётных слоёв
            // (PROMPT 19 §2). Она читает их результаты и ничего не считает
            // заново; вверх — к state и UI — не смотрит.
            { from: 'bom', allow: ['bom', 'drilling', 'production', 'hardware', 'geometry', 'domain'] },
            // Экспорт — самый верхний расчётный слой: читает готовый
            // результат и раскладывает его по страницам и ячейкам
            // (PROMPT 20 §2). Своих правил производства не содержит.
            { from: 'export', allow: ['export', 'bom', 'drilling', 'production', 'hardware', 'geometry', 'domain'] },
            // Производственный workflow — самый верхний расчётный слой:
            // складывает готовые результаты и проверяет готовность
            // (PROMPT 21 §8). Своих правил производства не содержит.
            { from: 'workflow', allow: ['workflow', 'export', 'bom', 'drilling', 'production', 'hardware', 'geometry', 'domain'] },
            { from: 'validation', allow: ['validation', 'bom', 'drilling', 'production', 'hardware', 'geometry', 'domain'] },
            { from: 'persistence', allow: ['persistence', 'domain'] },
            { from: 'state', allow: ['state', 'persistence', 'validation', 'workflow', 'export', 'bom', 'drilling', 'production', 'hardware', 'geometry', 'domain'] },
            { from: 'motion', allow: ['motion'] },
            { from: 'interaction', allow: ['interaction', 'motion', 'state', 'domain'] },
            { from: 'design-system', allow: ['design-system', 'motion'] },
            // render — презентационный слой: получает уже посчитанную
            // геометрию и рисует её. Не видит state/interaction — команды
            // и хранилище остаются заботой app, render только показывает.
            { from: 'render', allow: ['render', 'domain', 'geometry', 'hardware', 'production', 'drilling', 'bom', 'design-system'] },
            { from: 'app', allow: ['*'] },
            { from: 'entry', allow: ['*'] },
          ],
        },
      ],
    },
  },

  // ── The domain must not know that a UI exists ───────────────────────────────
  {
    files: PURE_LAYERS,
    rules: {
      'no-restricted-imports': ['error', UI_FRAMEWORK_IMPORTS],
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS],
    },
  },
  {
    files: ['src/persistence/**/*.ts', 'src/motion/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', UI_FRAMEWORK_IMPORTS],
    },
  },

  // ── React ──────────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // ── Tests may reach across layers; they exercise the seams on purpose ───────
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', '*.config.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.ts', 'playwright.config.ts', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Скрипты сборки выполняются в Node и вправе пользоваться его глобальными
    // объектами; запрет на них касается доменных слоёв, а не инструментов.
    files: ['scripts/**/*.mjs', '*.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
