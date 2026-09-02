import { describe, expect, it } from 'vitest';
import { createDocumentStore } from '../../../src/state/document-store.js';
import { createSessionStore } from '../../../src/state/session-store.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory, asId } from '../../../src/domain/ids.js';
import { toJson } from '../../../src/persistence/serialization.js';

/**
 * Разделение уровней состояния — архитектурное требование, а не стиль.
 * Проверяем его свойствами, а не наличием файлов.
 */
describe('разделение состояния документа и сессии', () => {
  const project = () =>
    createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

  it('выделение не попадает в документ и не сохраняется в файл', () => {
    const session = createSessionStore();
    session.getState().selectNodes([asId<'Node'>('n1')]);
    const json = toJson(project());
    expect(json).not.toContain('selected');
    expect(json).not.toContain('viewport');
    expect(json).not.toContain('hovered');
  });

  it('изменение состояния сессии не трогает документ и не пишет историю', () => {
    const doc = createDocumentStore(project());
    const session = createSessionStore();
    const before = doc.getState().project;

    session.getState().setViewport({ scale: 2.5, tx: 100, ty: -40 });
    session.getState().selectNodes([asId<'Node'>('n1')]);
    session.getState().setTool('pan');

    expect(doc.getState().project).toBe(before);
    expect(doc.getState().history.past).toHaveLength(0);
  });

  it('состояние сессии несёт признак непостоянного хранилища для честного предупреждения', () => {
    const session = createSessionStore();
    expect(session.getState().storageEphemeral).toBe(false);
    session.getState().setStorageEphemeral(true);
    expect(session.getState().storageEphemeral).toBe(true);
  });
});
