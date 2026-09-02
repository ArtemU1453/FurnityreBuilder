import { describe, expect, it } from 'vitest';
import {
  DeserializationError,
  deserializeDocument,
  fromJson,
  serializeProject,
  toJson,
} from '../../../src/persistence/serialization.js';
import { MigrationError, migrateDocument } from '../../../src/persistence/migrations/index.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { SCHEMA_VERSION } from '../../../src/domain/project/types.js';

const project = () =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

describe('сериализация', () => {
  it('круговой путь домен → JSON → домен не теряет данных', () => {
    const original = project();
    const restored = fromJson(toJson(original)).project;
    expect(restored).toEqual(original);
  });

  it('пишет версию схемы снаружи проекта', () => {
    const doc = serializeProject(project());
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    const plain = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual(['schemaVersion', 'project']);
  });

  it('формат читаем человеком: это обычный JSON, а не бинарный контейнер', () => {
    const text = toJson(project());
    expect(text).toContain('"schemaVersion"');
    expect(text).toContain('"dimensions"');
    expect(() => {
      JSON.parse(text);
    }).not.toThrow();
  });

  it('отклоняет мусор, не приводя приложение в сломанное состояние', () => {
    expect(() => fromJson('не json')).toThrow(DeserializationError);
    expect(() => deserializeDocument(null)).toThrow(DeserializationError);
    expect(() => deserializeDocument({ hello: 'world' })).toThrow(DeserializationError);
  });

  it('отклоняет документ с правильной версией, но испорченной структурой', () => {
    const doc = JSON.parse(toJson(project())) as Record<string, unknown>;
    const broken = { ...doc, project: { ...(doc.project as object), furniture: 'нет' } };
    expect(() => deserializeDocument(broken)).toThrow(DeserializationError);
  });

  it('отклоняет документ более новой версии целиком, а не частично', () => {
    const doc = JSON.parse(toJson(project())) as Record<string, unknown>;
    expect(() => deserializeDocument({ ...doc, schemaVersion: SCHEMA_VERSION + 5 })).toThrow(
      MigrationError,
    );
  });
});

describe('миграции', () => {
  it('на текущей версии ничего не делает', () => {
    const doc = { schemaVersion: SCHEMA_VERSION, a: 1 };
    expect(migrateDocument(doc, SCHEMA_VERSION, SCHEMA_VERSION)).toBe(doc);
  });

  it('сообщает о недостающей миграции, а не молча пропускает шаг', () => {
    expect(() => migrateDocument({}, 0, SCHEMA_VERSION)).toThrow(MigrationError);
  });
});
