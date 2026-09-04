import { describe, expect, it } from 'vitest';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createFurnitureInstance, createRectangularRoom } from '../../../src/domain/room/defaults.js';
import {
  collectImportWarnings,
  exportFileName,
  exportProjectToText,
  importProjectFromText,
  normalizeProject,
} from '../../../src/persistence/index.js';
import { SCHEMA_VERSION } from '../../../src/domain/project/types.js';
import type { ProjectId } from '../../../src/domain/index.js';

/**
 * Импорт и экспорт (PROMPT 25 §19–§22).
 *
 * Формат один и тот же, что у хранилища: проверяется, что круговой путь
 * ничего не теряет, а нечитаемый файл объясняется словами, а не стеком.
 */

const ids = createSequentialIdFactory('t');
const project = (name = 'Шкаф') =>
  createProject({ ids: createSequentialIdFactory('p'), now: () => '2026-01-01T00:00:00.000Z', name });

describe('круговой путь', () => {
  it('экспорт и импорт возвращают тот же проект', () => {
    const source = project();
    const result = importProjectFromText(exportProjectToText(source));
    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.project).toEqual(source);
    expect(result.warnings).toEqual([]);
  });

  it('расстановка в помещении переживает круговой путь', () => {
    const source = project();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700 });
    const instance = createFurnitureInstance(ids, source.id, source.furniture[0]!, { x: 500, y: 0, z: 500 });
    const withRoom = { ...source, room: { ...room, furnitureInstances: [instance] } };

    const result = importProjectFromText(exportProjectToText(withRoom));
    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.project.room?.furnitureInstances[0]?.projectId).toBe(source.id);
    expect(result.project.room?.furnitureInstances[0]?.furnitureId).toBe(source.furniture[0]?.id);
  });

  it('экспортированный файл — читаемый JSON, а не двоичный контейнер', () => {
    const text = exportProjectToText(project());
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(text).toContain('\n');
  });
});

describe('нечитаемый файл объясняется словами', () => {
  it('не JSON', () => {
    const result = importProjectFromText('это не файл проекта');
    expect(result.status).toBe('INVALID');
    if (result.status === 'READY') return;
    expect(result.message).toContain('JSON');
  });

  it('JSON без версии схемы', () => {
    const result = importProjectFromText('{"что-то":1}');
    expect(result.status).toBe('INVALID');
    if (result.status === 'READY') return;
    expect(result.message).toContain('версия схемы');
  });

  it('версия из будущего требует другой версии приложения, а не «сломанного файла»', () => {
    const text = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, project: {} });
    const result = importProjectFromText(text);
    expect(result.status).toBe('MIGRATION_REQUIRED');
    if (result.status === 'READY') return;
    expect(result.details).toContain(String(SCHEMA_VERSION));
  });

  it('структура не соответствует схеме', () => {
    const text = JSON.stringify({ schemaVersion: SCHEMA_VERSION, project: { id: 'x' } });
    const result = importProjectFromText(text);
    expect(result.status).toBe('INVALID');
  });

  it('в сообщении пользователя нет стека', () => {
    const result = importProjectFromText('{');
    if (result.status === 'READY') return;
    expect(result.message).not.toContain('at ');
    expect(result.message).not.toContain('.ts:');
  });
});

describe('замечания при импорте', () => {
  it('изделия из чужих проектов отмечаются, но файл открывается', () => {
    const source = project();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700 });
    const foreign = createFurnitureInstance(ids, 'project:другой' as ProjectId, source.furniture[0]!, {
      x: 0,
      y: 0,
      z: 0,
    });
    const withForeign = { ...source, room: { ...room, furnitureInstances: [foreign] } };
    const warnings = collectImportWarnings(withForeign);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('других проектов');
  });

  it('проект без изделий — замечание, а не отказ', () => {
    expect(collectImportWarnings({ ...project(), furniture: [] })).toHaveLength(1);
  });

  it('обычный проект замечаний не даёт', () => {
    expect(collectImportWarnings(project())).toEqual([]);
  });
});

describe('нормализация', () => {
  it('файл до библиотеки получает projectId от проекта-хозяина', () => {
    const source = project();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700 });
    const instance = createFurnitureInstance(ids, source.id, source.furniture[0]!, { x: 0, y: 0, z: 0 });
    // Файл PROMPT 24 знал только furnitureId.
    const legacy = {
      ...source,
      room: {
        ...room,
        furnitureInstances: [{ ...instance, projectId: undefined as unknown as ProjectId }],
      },
    };
    expect(normalizeProject(legacy).room?.furnitureInstances[0]?.projectId).toBe(source.id);
  });

  it('готовый проект возвращается той же ссылкой: лишней работы нет', () => {
    const source = project();
    expect(normalizeProject(source)).toBe(source);
  });

  it('чужой projectId не переписывается', () => {
    const source = project();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700 });
    const foreign = createFurnitureInstance(ids, 'project:чужой' as ProjectId, source.furniture[0]!, {
      x: 0,
      y: 0,
      z: 0,
    });
    const withForeign = { ...source, room: { ...room, furnitureInstances: [foreign] } };
    expect(normalizeProject(withForeign).room?.furnitureInstances[0]?.projectId).toBe('project:чужой');
  });

  it('файл без projectId проходит схему и нормализуется на импорте', () => {
    const source = project();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000, height: 2700 });
    const instance = createFurnitureInstance(ids, source.id, source.furniture[0]!, { x: 400, y: 0, z: 400 });
    const raw = JSON.parse(
      exportProjectToText({ ...source, room: { ...room, furnitureInstances: [instance] } }),
    ) as { project: { room: { furnitureInstances: Record<string, unknown>[] } } };
    delete raw.project.room.furnitureInstances[0]!.projectId;

    const result = importProjectFromText(JSON.stringify(raw));
    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.project.room?.furnitureInstances[0]?.projectId).toBe(source.id);
  });
});

describe('имя файла', () => {
  it('это имя проекта, а не идентификатор', () => {
    expect(exportFileName(project('Шкаф в прихожую'))).toBe('Шкаф в прихожую.json');
  });

  it('запрещённые в именах файлов символы заменяются', () => {
    expect(exportFileName(project('Кухня/дача:1'))).toBe('Кухня-дача-1.json');
  });

  it('пустое имя не даёт файл без имени', () => {
    expect(exportFileName({ ...project(), name: '   ' })).toBe('Проект.json');
  });
});
