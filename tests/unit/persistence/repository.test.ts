import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { InMemoryProjectRepository } from '../../../src/persistence/memory-repository.js';
import { IndexedDbProjectRepository, isIndexedDbAvailable } from '../../../src/persistence/indexeddb-repository.js';
import type { ProjectRepository } from '../../../src/persistence/repository.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { SCHEMA_VERSION } from '../../../src/domain/project/types.js';

const makeProject = (prefix: string, name: string, updatedAt: string) => {
  const p = createProject({ ids: createSequentialIdFactory(prefix), now: () => updatedAt, name });
  return p;
};

// Один и тот же набор проверок для обеих реализаций: смысл абстракции в том,
// что вызывающий код не отличает их друг от друга.
function contractTests(label: string, create: () => ProjectRepository): void {
  describe(`ProjectRepository: ${label}`, () => {
    let repo: ProjectRepository;

    beforeEach(async () => {
      repo = create();
      // fake-indexeddb живёт на весь модуль: чистим через публичный API,
      // чтобы обе реализации стартовали из одинакового пустого состояния.
      for (const summary of await repo.list()) await repo.delete(summary.id);
    });

    it('сохраняет и читает проект без потерь', async () => {
      const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
      await repo.save(project);
      const loaded = await repo.load(project.id);
      expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);
      expect(loaded?.project).toEqual(project);
    });

    it('возвращает undefined для неизвестного идентификатора', async () => {
      expect(await repo.load(makeProject('z', 'x', '2026-01-01T00:00:00.000Z').id)).toBeUndefined();
    });

    it('перечисляет проекты, свежие первыми', async () => {
      await repo.save(makeProject('a', 'Старый', '2026-01-01T00:00:00.000Z'));
      await repo.save(makeProject('b', 'Новый', '2026-06-01T00:00:00.000Z'));
      const list = await repo.list();
      expect(list.map((s) => s.name)).toEqual(['Новый', 'Старый']);
    });

    it('удаляет проект', async () => {
      const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
      await repo.save(project);
      await repo.delete(project.id);
      expect(await repo.load(project.id)).toBeUndefined();
      expect(await repo.list()).toHaveLength(0);
    });

    it('повторное сохранение обновляет запись, а не создаёт вторую', async () => {
      const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
      await repo.save(project);
      await repo.save({ ...project, name: 'Переименован' });
      const list = await repo.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('Переименован');
    });
  });
}

contractTests('в памяти', () => new InMemoryProjectRepository());
contractTests('IndexedDB', () => new IndexedDbProjectRepository());

describe('выбор хранилища', () => {
  it('определяет доступность IndexedDB', () => {
    expect(isIndexedDbAvailable()).toBe(true);
  });

  it('режим в памяти честно сообщает, что не переживёт перезагрузку', () => {
    expect(new InMemoryProjectRepository().isPersistent()).toBe(false);
    expect(new IndexedDbProjectRepository().isPersistent()).toBe(true);
  });

  it('не отдаёт наружу ссылку на внутреннее состояние', async () => {
    const repo = new InMemoryProjectRepository();
    const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
    await repo.save(project);
    const first = await repo.load(project.id);
    const second = await repo.load(project.id);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
