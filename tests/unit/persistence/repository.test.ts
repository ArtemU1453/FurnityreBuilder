import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { InMemoryProjectRepository } from '../../../src/persistence/memory-repository.js';
import { IndexedDbProjectRepository, isIndexedDbAvailable } from '../../../src/persistence/indexeddb-repository.js';
import type { ProjectRepository } from '../../../src/persistence/repository.js';
import { RepositoryError } from '../../../src/persistence/repository.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { SCHEMA_VERSION } from '../../../src/domain/project/types.js';

const makeProject = (prefix: string, name: string, createdAt: string) =>
  createProject({ ids: createSequentialIdFactory(prefix), now: () => createdAt, name });

/**
 * Управляемые часы.
 *
 * Запись — единственное место, где меняется `updatedAt` (PROMPT 25 §3),
 * и проверить это можно только на часах, которые идут по команде теста,
 * а не по настоящему времени.
 */
const clock = (start = 100) => {
  let tick = start;
  return (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, tick)).toISOString();
  };
};

// Один и тот же набор проверок для обеих реализаций: смысл абстракции в том,
// что вызывающий код не отличает их друг от друга.
function contractTests(label: string, create: (now: () => string) => ProjectRepository): void {
  describe(`ProjectRepository: ${label}`, () => {
    let repo: ProjectRepository;

    beforeEach(async () => {
      repo = create(clock());
      // fake-indexeddb живёт на весь модуль: чистим через публичный API,
      // чтобы обе реализации стартовали из одинакового пустого состояния.
      for (const summary of await repo.list()) await repo.delete(summary.id);
    });

    it('сохраняет и читает проект без потерь', async () => {
      const stored = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      const loaded = await repo.load(stored.id);
      expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);
      expect(loaded?.project).toEqual(stored);
    });

    it('возвращает undefined для неизвестного идентификатора', async () => {
      expect(await repo.load(makeProject('z', 'x', '2026-01-01T00:00:00.000Z').id)).toBeUndefined();
    });

    it('перечисляет проекты, свежие первыми', async () => {
      // Порядок задаёт время ЗАПИСИ, а не то, что было в файле: список
      // отвечает на вопрос «над чем я работал последним».
      await repo.save(makeProject('a', 'Старый', '2020-01-01T00:00:00.000Z'));
      await repo.save(makeProject('b', 'Новый', '2020-01-01T00:00:00.000Z'));
      const list = await repo.list();
      expect(list.map((s) => s.name)).toEqual(['Новый', 'Старый']);
    });

    it('удаляет проект', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      await repo.delete(project.id);
      expect(await repo.load(project.id)).toBeUndefined();
      expect(await repo.list()).toHaveLength(0);
    });

    it('повторное сохранение обновляет запись, а не создаёт вторую', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      await repo.save({ ...project, name: 'Переименован' });
      const list = await repo.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('Переименован');
    });

    it('сохранение обновляет время изменения (§3)', async () => {
      const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
      const stored = await repo.save(project);
      expect(stored.metadata.updatedAt).not.toBe(project.metadata.updatedAt);
      expect(stored.metadata.createdAt).toBe(project.metadata.createdAt);
    });

    it('has отвечает про существование, не загружая документ', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      expect(await repo.has(project.id)).toBe(true);
      await repo.delete(project.id);
      expect(await repo.has(project.id)).toBe(false);
    });

    it('create не перезаписывает существующий проект молча (§4)', async () => {
      const project = makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z');
      await repo.create(project);
      await expect(repo.create({ ...project, name: 'Другой' })).rejects.toBeInstanceOf(RepositoryError);
      const list = await repo.list();
      expect(list.map((s) => s.name)).toEqual(['Шкаф']);
    });

    it('переименование сохраняет идентификатор (§10)', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      const renamed = await repo.rename(project.id, 'Гардероб');
      expect(renamed?.id).toBe(project.id);
      expect(renamed?.name).toBe('Гардероб');
      expect((await repo.load(project.id))?.project.name).toBe('Гардероб');
      expect(await repo.list()).toHaveLength(1);
    });

    it('переименование несуществующего проекта — undefined, а не исключение', async () => {
      expect(await repo.rename(makeProject('z', 'x', '2026-01-01T00:00:00.000Z').id, 'Имя')).toBeUndefined();
    });

    it('дубликат получает новый идентификатор и остаётся отдельным проектом (§11)', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      const copy = await repo.duplicate(project.id, createSequentialIdFactory('copy'));
      expect(copy).toBeDefined();
      expect(copy?.id).not.toBe(project.id);
      expect(copy?.name).toBe('Шкаф (копия)');
      expect((await repo.list()).map((s) => s.name).sort()).toEqual(['Шкаф', 'Шкаф (копия)']);
    });

    it('правка дубликата не трогает оригинал', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      const copy = (await repo.duplicate(project.id, createSequentialIdFactory('copy')))!;
      const item = copy.furniture[0]!;
      await repo.save({
        ...copy,
        furniture: [{ ...item, dimensions: { ...item.dimensions, width: 1234 } }],
      });
      const original = await repo.load(project.id);
      expect(original?.project.furniture[0]?.dimensions.width).toBe(project.furniture[0]?.dimensions.width);
    });

    it('сводка несёт то, что показывает карточка библиотеки (§6)', async () => {
      const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
      const summary = (await repo.list())[0]!;
      expect(summary.furnitureCount).toBe(project.furniture.length);
      expect(summary.size).toEqual(project.furniture[0]?.dimensions);
      expect(summary.preview).toBeUndefined();
    });
  });
}

contractTests('в памяти', (now) => new InMemoryProjectRepository(now));
contractTests('IndexedDB', (now) => new IndexedDbProjectRepository(now));

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
    const project = await repo.save(makeProject('a', 'Шкаф', '2026-01-01T00:00:00.000Z'));
    const first = await repo.load(project.id);
    const second = await repo.load(project.id);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
