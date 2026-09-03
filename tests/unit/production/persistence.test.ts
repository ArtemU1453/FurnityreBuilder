import { describe, expect, it } from 'vitest';
import { calculateCutting } from '../../../src/production/index.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { DEFAULT_KERF } from '../../../src/domain/index.js';
import { createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import { makeProject } from './helpers.js';

/**
 * Раскрой не хранится (PROMPT 17 §28).
 *
 * В файле проекта лежат ПАРАМЕТРЫ раскроя (пропил, обрезная кромка,
 * политика поворота) — их задаёт человек. Сама карта раскроя, координаты
 * размещений и размеры заготовок не сохраняются: это производные величины,
 * и сохранённая карта разошлась бы с деталями после первого изменения
 * габарита. Отсюда же ответ на §29: инвалидация не нужна, потому что
 * устаревать нечему.
 */

describe('Test 33 (§28): в файле проекта нет карты раскроя', () => {
  const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 3, 'adjustable') }));
  const json = toJson(project);

  it('ни размещений, ни листов, ни координат раскладки', () => {
    expect(json).not.toContain('placements');
    expect(json).not.toContain('utilization');
    expect(json).not.toContain('"layouts"');
    expect(json).not.toContain('stockId');
  });

  it('а параметры раскроя сохраняются, потому что их задаёт пользователь', () => {
    const parsed: unknown = JSON.parse(json);
    const settings = (parsed as { project: { settings: { cutting: { kerf: number } } } }).project.settings;
    expect(settings.cutting.kerf).toBe(DEFAULT_KERF);
  });
});

describe('Test 34 (§28): миграция старого файла', () => {
  it('проект без параметров раскроя читается и получает умолчания', () => {
    const project = makeProject();
    const document: Record<string, unknown> = JSON.parse(toJson(project)) as Record<string, unknown>;
    const inner = (document as { project: { settings: Record<string, unknown> } }).project;
    // Файл, сохранённый до PROMPT 17: поля `cutting` в нём просто нет.
    delete inner.settings['cutting'];

    const restored = fromJson(JSON.stringify(document)).project;
    expect(restored.settings.cutting).toEqual({ kerf: DEFAULT_KERF, rotationPolicy: 'by-material' });
  });

  it('и такой файл сразу считается: раскрой не зависит от версии документа', () => {
    const project = makeProject((f, ids) => ({ ...f, root: createShelvesLeaf(ids, 2, 'adjustable') }));
    const document: Record<string, unknown> = JSON.parse(toJson(project)) as Record<string, unknown>;
    delete (document as { project: { settings: Record<string, unknown> } }).project.settings['cutting'];

    const restored = fromJson(JSON.stringify(document)).project;
    const result = calculateCutting(restored);
    expect(result.errors).toHaveLength(0);
    expect(result.layouts.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).toBe(JSON.stringify(calculateCutting(project)));
  });
});
