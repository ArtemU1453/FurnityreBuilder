import { useCallback, useEffect, useRef, useState } from 'react';
import { byUpdatedAtDesc, createProjectRepository } from '../persistence/index.js';
import type { ProjectRepository } from '../persistence/index.js';
import type { Project, ProjectId } from '../domain/index.js';

/**
 * Сохранение и загрузка проекта (PROMPT 22 §28).
 *
 * ## Хранилище уже есть
 *
 * `ProjectRepository` с реализациями на IndexedDB и в памяти существует с
 * PROMPT 2 и до сих пор не был подключён к интерфейсу. Второго хранилища
 * не заводится: хук только связывает существующее с экраном и показывает
 * состояние.
 *
 * ## Состояния
 *
 * `saved` — на диске то же, что на экране; `unsaved` — есть несохранённые
 * правки; `saving` — идёт запись; `error` — запись не удалась.
 * Различие между «сохранено» и «есть правки» считается по ссылке на
 * проект: Immer даёт структурное разделение, поэтому ссылка меняется
 * ровно тогда, когда меняется модель.
 *
 * Автосохранения нет намеренно: молчаливая запись поверх файла — это
 * потеря работы, если пользователь экспериментировал. Сохранение —
 * явное действие, а несохранённые правки видны постоянно.
 */

export type StorageStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface ProjectStorage {
  readonly status: StorageStatus;
  readonly message: string;
  /** Хранилище недоступно (приватный режим): интерфейс обязан сказать об этом. */
  readonly ephemeral: boolean;
  readonly save: () => Promise<void>;
  readonly load: (id: ProjectId) => Promise<Project | undefined>;
  /**
   * Последний сохранённый проект, если он есть.
   *
   * Регистрации в приложении нет, «моих проектов» тоже: список нужен
   * ровно затем, чтобы после закрытия вкладки открылось то, над чем
   * работали, а не пустой шкаф. Выбирается самый свежий по `updatedAt`.
   */
  readonly restore: () => Promise<Project | undefined>;
}

export function useProjectStorage(project: Project): ProjectStorage {
  const repositoryRef = useRef<Promise<ProjectRepository> | undefined>(undefined);
  const [status, setStatus] = useState<StorageStatus>('unsaved');
  const [message, setMessage] = useState('Проект не сохранён');
  const [ephemeral, setEphemeral] = useState(false);
  const savedRef = useRef<Project | undefined>(undefined);

  // Хранилище создаётся асинхронно (IndexedDB нужно открыть) и ровно один
  // раз на жизнь компонента: обещание запоминается, а не результат, иначе
  // два быстрых нажатия открыли бы базу дважды.
  const repositoryOf = useCallback((): Promise<ProjectRepository> => {
    repositoryRef.current ??= createProjectRepository();
    return repositoryRef.current;
  }, []);

  // Ссылка на проект изменилась — значит изменилась модель. Сравнение по
  // ссылке возможно именно потому, что состояние иммутабельно.
  useEffect(() => {
    if (savedRef.current === project) return;
    setStatus((current) => (current === 'saving' ? current : 'unsaved'));
    setMessage('Есть несохранённые изменения');
  }, [project]);

  const save = useCallback(async (): Promise<void> => {
    setStatus('saving');
    setMessage('Сохранение…');
    try {
      const repository = await repositoryOf();
      await repository.save(project);
      savedRef.current = project;
      setEphemeral(!repository.isPersistent());
      setStatus('saved');
      setMessage(repository.isPersistent() ? 'Сохранено' : 'Сохранено только в памяти вкладки');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? `Не удалось сохранить: ${error.message}` : 'Не удалось сохранить проект');
    }
  }, [project, repositoryOf]);

  const load = useCallback(
    async (id: ProjectId): Promise<Project | undefined> => {
      const repository = await repositoryOf();
      const document = await repository.load(id);
      if (document === undefined) return undefined;
      savedRef.current = document.project;
      setStatus('saved');
      setMessage('Загружено');
      return document.project;
    },
    [repositoryOf],
  );

  const restore = useCallback(async (): Promise<Project | undefined> => {
    const repository = await repositoryOf();
    setEphemeral(!repository.isPersistent());
    const summaries = [...(await repository.list())].sort(byUpdatedAtDesc);
    const latest = summaries[0];
    if (latest === undefined) return undefined;
    return load(latest.id);
  }, [load, repositoryOf]);

  return { status, message, ephemeral, save, load, restore };
}
