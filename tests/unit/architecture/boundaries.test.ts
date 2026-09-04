import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';

/**
 * Архитектурная граница проверяется тестом, а не доверием.
 *
 * ARCHITECTURE.md §1 требует, чтобы доменные слои не зависели от React и от
 * слоёв выше. Комментарий этого не гарантирует, конфигурация линтера — да,
 * но конфигурацию легко сломать незаметно: достаточно опечатки в шаблоне
 * пути, и правило перестаёт находить файлы, продолжая «проходить».
 * Ровно это здесь и ловится.
 */
const ROOT = process.cwd();
const SCRATCH = join(ROOT, 'src', '__boundary_probe__');

async function lintSource(relativeDir: string, filename: string, source: string): Promise<string[]> {
  const dir = join(ROOT, 'src', relativeDir, '__boundary_probe__');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  writeFileSync(file, source, 'utf8');
  try {
    const eslint = new ESLint({ cwd: ROOT });
    const results = await eslint.lintFiles([file]);
    return results.flatMap((r) => r.messages.map((m) => m.ruleId ?? 'unknown'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('архитектурные границы', () => {
  it('запрещает React в геометрии', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'geometry',
      'probe.ts',
      "import { useState } from 'react';\nexport const probe = useState;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает домену знать о React', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'domain',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает React в расчёте фурнитуры', { timeout: 60_000 }, async () => {
    // PROMPT 16 §14: `calculateHardware` обязана быть независима от React и
    // DOM — иначе спецификацию нельзя ни вынести в Worker, ни сравнить
    // снапшотом, ровно как и геометрию.
    const rules = await lintSource(
      'hardware',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает импорт вверх по слоям: hardware → state', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'hardware',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает React в расчёте раскроя', { timeout: 60_000 }, async () => {
    // PROMPT 17 §35: расчёт раскроя детерминирован и не знает об
    // интерфейсе — иначе карту нельзя ни сравнить снапшотом, ни вынести
    // в Worker, а именно раскрой из всех расчётов самый тяжёлый.
    const rules = await lintSource(
      'production',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает раскрою менять геометрию: production → state', { timeout: 60_000 }, async () => {
    // PROMPT 17 §25: зависимость строго односторонняя. Раскрой читает
    // геометрию, но не имеет права дотянуться до команд и что-то изменить.
    const rules = await lintSource(
      'production',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает React в расчёте присадки', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'drilling',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает присадке менять модель: drilling → state', { timeout: 60_000 }, async () => {
    // PROMPT 18 §25: план присадки производный. Команды `moveHole()` не
    // существует, и дотянуться до команд слой не должен даже случайно.
    const rules = await lintSource(
      'drilling',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает React в производственной спецификации', { timeout: 60_000 }, async () => {
    // PROMPT 19 §24: `calculateProduction` не привязана к React, DOM и
    // конкретному экрану — иначе её нельзя вызвать из экспорта.
    const rules = await lintSource(
      'bom',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает спецификации менять модель: bom → state', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'bom',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает React в генераторах документов', { timeout: 60_000 }, async () => {
    // PROMPT 20 §2: экспорт получает готовые данные и не знает ни об
    // экране, ни о том, как файл будет сохранён.
    const rules = await lintSource(
      'export',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает экспорту трогать модель: export → state', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'export',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает React в проверке готовности', { timeout: 60_000 }, async () => {
    // PROMPT 21 §3: `validateProductionReadiness` — доменная функция, а не
    // часть экрана: её результат нужен и интерфейсу, и экспорту, и тестам.
    const rules = await lintSource(
      'workflow',
      'probe.ts',
      "import { useMemo } from 'react';\nexport const probe = useMemo;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('запрещает workflow менять модель: workflow → state', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'workflow',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает импорт вверх по слоям: geometry → state', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'geometry',
      'probe.ts',
      "import { PLANNED_COMMANDS } from '../../state/commands.js';\nexport const probe = PLANNED_COMMANDS;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('запрещает домену обращаться к браузерным API', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'domain',
      'probe.ts',
      'export const probe = (): number => window.innerWidth;\n',
    );
    expect(rules).toContain('no-restricted-globals');
  });

  it('запрещает доступ к хранилищу в обход ProjectRepository', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'validation',
      'probe.ts',
      "export const probe = (): string | null => localStorage.getItem('x');\n",
    );
    expect(rules).toContain('no-restricted-globals');
  });

  it('запрещает движку зависеть от редактора: geometry → app', { timeout: 60_000 }, async () => {
    // PROMPT 22 §30: интерфейс — потребитель движка, а не его часть.
    // Обратная зависимость означала бы, что мебель считается в React, и
    // расчёт больше нельзя ни вынести в Worker, ни проверить без DOM.
    const rules = await lintSource(
      'geometry',
      'probe.ts',
      "import { resizeValue } from '../../app/editor/resize.js';\nexport const probe = resizeValue;\n",
    );
    expect(rules).toContain('boundaries/element-types');
  });

  it('держит правила редактора вне React: selection и resize — чистые модули', () => {
    // PROMPT 22 §30. Линтер здесь не помощник: слою `app` React разрешён,
    // и разрешён обоснованно — рядом лежат компоненты. Гарантию даёт сам
    // факт, что эти два модуля импортируются в окружении `node` (см.
    // tests/unit/app/*) и не тянут ни React, ни DOM. Проверяется исходник,
    // потому что случайный `import { useMemo }` компилируется молча.
    for (const file of ['selection.ts', 'resize.ts']) {
      const source = readFileSync(join(ROOT, 'src', 'app', 'editor', file), 'utf8');
      expect(source).not.toMatch(/from 'react'/);
      expect(source).not.toMatch(/\.module\.css/);
    }
  });

  it('разрешает законное направление: geometry → domain', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'geometry',
      'probe.ts',
      "import { roundMm } from '../../domain/units.js';\nexport const probe = roundMm;\n",
    );
    expect(rules).toEqual([]);
  });
});
