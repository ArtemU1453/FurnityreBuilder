import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('разрешает законное направление: geometry → domain', { timeout: 60_000 }, async () => {
    const rules = await lintSource(
      'geometry',
      'probe.ts',
      "import { roundMm } from '../../domain/units.js';\nexport const probe = roundMm;\n",
    );
    expect(rules).toEqual([]);
  });
});
