import { describe, expect, it } from 'vitest';
import { createProject, createProjectDocument } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { SCHEMA_VERSION } from '../../../src/domain/project/types.js';
import { collectNodeIds } from '../../../src/domain/furniture/tree.js';

const deterministic = () => ({
  ids: createSequentialIdFactory('t'),
  now: () => '2026-01-01T00:00:00.000Z',
  appVersion: '0.0.0-test',
});

describe('создание проекта', () => {
  it('детерминирован при внешних источниках id и времени', () => {
    const a = createProject(deterministic());
    const b = createProject(deterministic());
    expect(a).toEqual(b);
  });

  it('создаёт готовое к работе изделие без дополнительной настройки', () => {
    const project = createProject(deterministic());
    const furniture = project.furniture[0];
    expect(furniture).toBeDefined();
    expect(furniture?.dimensions).toEqual({
      width: 1000,
      height: 2000,
      depth: 500,
      panelThickness: 16,
    });
    expect(furniture?.root.kind).toBe('leaf');
    expect(collectNodeIds(furniture!.root)).toHaveLength(1);
  });

  it('назначает материалы всем базовым ролям деталей', () => {
    const project = createProject(deterministic());
    for (const role of ['side', 'top', 'bottom', 'shelf-adjustable', 'back'] as const) {
      expect(project.materials.assignment[role]).toBeDefined();
    }
  });

  it('не содержит ничего, что идентифицирует пользователя', () => {
    const project = createProject(deterministic());
    const json = JSON.stringify(project);
    for (const forbidden of ['user', 'account', 'email', 'token', 'session', 'price', 'order']) {
      expect(json.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it('оборачивает проект в документ с версией схемы', () => {
    const doc = createProjectDocument(createProject(deterministic()));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
