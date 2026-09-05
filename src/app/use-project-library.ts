import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createProject,
  createRandomIdFactory,
} from '../domain/index.js';
import type { Project, ProjectId } from '../domain/index.js';
import {
  RepositoryError,
  checkImportSize,
  exportFileName,
  exportProjectToText,
  importProjectFromText,
} from '../persistence/index.js';
import type { ImportResult, ProjectSummary } from '../persistence/index.js';
import { recentProjects, searchProjects, sortProjects } from '../library/index.js';
import type { SortOrder } from '../library/index.js';
import { sharedRepository } from './repository.js';

/**
 * Библиотека проектов: связь чистого слоя с хранилищем (PROMPT 25 §4, §28).
 *
 * ## Что здесь есть и чего нет
 *
 * Здесь — асинхронность, состояние загрузки и сообщения об ошибках.
 * Правила поиска, сортировки и построения превью живут в `src/library`
 * и проверяются без React; правила дублирования и переименования — в
 * домене; запись — в `ProjectRepository`. Хук их соединяет и ничего не
 * решает сам.
 *
 * Список проектов — не второе состояние рядом с хранилищем, а его
 * прочитанный снимок: любое изменение сначала уходит в хранилище, и
 * только потом список перечитывается. Иначе после неудачной записи на
 * экране осталось бы то, чего в хранилище нет.
 */

export interface ProjectLibrary {
  readonly loading: boolean;
  /** Хранилище недоступно (приватный режим): пользователь обязан это знать. */
  readonly ephemeral: boolean;
  /** Последняя ошибка операции. Текст для человека, не стек (§22). */
  readonly error: string | undefined;
  readonly summaries: readonly ProjectSummary[];
  /** Отфильтрованный и отсортированный список — то, что показывают карточки. */
  readonly visible: readonly ProjectSummary[];
  readonly recent: readonly ProjectSummary[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly order: SortOrder;
  readonly setOrder: (value: SortOrder) => void;
  readonly refresh: () => Promise<void>;
  readonly create: (name?: string) => Promise<Project | undefined>;
  readonly open: (id: ProjectId) => Promise<Project | undefined>;
  readonly rename: (id: ProjectId, name: string) => Promise<void>;
  readonly duplicate: (id: ProjectId) => Promise<void>;
  readonly remove: (id: ProjectId) => Promise<void>;
  readonly importText: (text: string) => Promise<ImportResult>;
  /**
   * Импорт выбранного файла: сначала размер, потом чтение (§17).
   *
   * Отдельный метод, а не проверка в компоненте, потому что решение
   * «читать или отказать» — правило импорта, а не разметка. Компоненту
   * остаётся отдать файл и показать результат.
   */
  readonly importFile: (file: File) => Promise<ImportResult>;
  readonly exportProject: (project: Project) => { readonly text: string; readonly fileName: string };
  readonly clearError: () => void;
}

export function useProjectLibrary(): ProjectLibrary {
  const [summaries, setSummaries] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ephemeral, setEphemeral] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<SortOrder>('updated-desc');

  // Размонтированный компонент не должен получать ответ: иначе React
  // предупредит об обновлении состояния мёртвого дерева, а пользователь
  // увидит мигание.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const repository = await sharedRepository();
      const list = await repository.list();
      if (!aliveRef.current) return;
      setEphemeral(!repository.isPersistent());
      setSummaries(list);
    } catch (cause) {
      if (aliveRef.current) setError(messageOf(cause, 'Не удалось прочитать список проектов.'));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Общая обёртка: ошибка становится текстом, список перечитывается. */
  const run = useCallback(
    async <T,>(action: (repository: Awaited<ReturnType<typeof sharedRepository>>) => Promise<T>, fallback: string): Promise<T | undefined> => {
      setError(undefined);
      try {
        const repository = await sharedRepository();
        const result = await action(repository);
        await refresh();
        return result;
      } catch (cause) {
        if (aliveRef.current) setError(messageOf(cause, fallback));
        return undefined;
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (name?: string): Promise<Project | undefined> => {
      // Умолчания те же, что у первого запуска приложения (§9): второго
      // «нового проекта» не бывает.
      const project = createProject(name === undefined ? {} : { name });
      return run((repository) => repository.create(project), 'Не удалось создать проект.');
    },
    [run],
  );

  const open = useCallback(
    async (id: ProjectId): Promise<Project | undefined> => {
      setError(undefined);
      try {
        const repository = await sharedRepository();
        const document = await repository.load(id);
        if (document === undefined) {
          setError('Проект не найден: возможно, он удалён.');
          return undefined;
        }
        return document.project;
      } catch (cause) {
        setError(messageOf(cause, 'Не удалось открыть проект.'));
        return undefined;
      }
    },
    [],
  );

  const rename = useCallback(
    async (id: ProjectId, name: string): Promise<void> => {
      await run((repository) => repository.rename(id, name), 'Не удалось переименовать проект.');
    },
    [run],
  );

  const duplicate = useCallback(
    async (id: ProjectId): Promise<void> => {
      await run((repository) => repository.duplicate(id, createRandomIdFactory()), 'Не удалось создать копию.');
    },
    [run],
  );

  const remove = useCallback(
    async (id: ProjectId): Promise<void> => {
      await run((repository) => repository.delete(id), 'Не удалось удалить проект.');
    },
    [run],
  );

  const importText = useCallback(
    async (text: string): Promise<ImportResult> => {
      const result = importProjectFromText(text);
      if (result.status !== 'READY') {
        setError(result.message);
        return result;
      }
      // Импортированный проект попадает в библиотеку сразу: иначе он
      // существовал бы только на экране и исчез бы при перезагрузке.
      // Идентификатор сохраняется — ссылки из помещений в том же файле
      // остаются живыми.
      await run((repository) => repository.save(result.project), 'Не удалось сохранить импортированный проект.');
      return result;
    },
    [run],
  );

  const importFile = useCallback(
    async (file: File): Promise<ImportResult> => {
      // Размер проверяется ДО `file.text()`: после чтения проверять уже
      // нечего — память вкладки занята, и именно этого мы избегаем.
      const tooLarge = checkImportSize(file.size);
      if (tooLarge !== undefined) {
        setError(tooLarge.message);
        return tooLarge;
      }
      return importText(await file.text());
    },
    [importText],
  );

  const exportProject = useCallback(
    (project: Project) => ({ text: exportProjectToText(project), fileName: exportFileName(project) }),
    [],
  );

  const visible = useMemo(
    () => sortProjects(searchProjects(summaries, query), order),
    [summaries, query, order],
  );
  const recent = useMemo(() => recentProjects(summaries), [summaries]);

  return {
    loading,
    ephemeral,
    error,
    summaries,
    visible,
    recent,
    query,
    setQuery,
    order,
    setOrder,
    refresh,
    create,
    open,
    rename,
    duplicate,
    remove,
    importText,
    importFile,
    exportProject,
    clearError: useCallback(() => {
      setError(undefined);
    }, []),
  };
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof RepositoryError) return cause.message;
  return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
}
