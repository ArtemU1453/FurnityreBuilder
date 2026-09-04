import { useCallback, useEffect, useRef, useState } from 'react';
import { byUpdatedAtDesc } from '../persistence/index.js';
import { generateProjectThumbnail } from '../library/index.js';
import { withPreview } from '../domain/index.js';
import type { Project, ProjectId } from '../domain/index.js';
import { sharedRepository } from './repository.js';

/**
 * Сохранение и загрузка проекта (PROMPT 22 §28, PROMPT 25 §23–§24).
 *
 * ## Хранилище уже есть
 *
 * `ProjectRepository` с реализациями на IndexedDB и в памяти существует с
 * PROMPT 2 и до сих пор не был подключён к интерфейсу. Второго хранилища
 * не заводится: хук только связывает существующее с экраном и показывает
 * состояние. Библиотека проектов (PROMPT 25) работает через ТО ЖЕ
 * хранилище — `sharedRepository()`.
 *
 * ## Состояния
 *
 * `saved` — на диске то же, что на экране; `unsaved` — есть несохранённые
 * правки; `saving` — идёт запись; `error` — запись не удалась.
 * Различие между «сохранено» и «есть правки» считается по ссылке на
 * проект: Immer даёт структурное разделение, поэтому ссылка меняется
 * ровно тогда, когда меняется модель. Второго механизма «грязного»
 * состояния PROMPT 25 §23 не заводит — этот уже есть и работает.
 *
 * Автосохранения нет намеренно (§24): молчаливая запись поверх файла —
 * это потеря работы, если пользователь экспериментировал. Сохранение —
 * явное действие, а несохранённые правки видны постоянно. Раз механизма
 * автосохранения в приложении нет, PROMPT 25 §24 предписывает его и не
 * вводить.
 *
 * ## Превью строится при записи
 *
 * Ровно один раз на сохранение, а не на каждое изменение модели (§8).
 * Эффекта, который смотрел бы на проект и записывал бы в него превью,
 * здесь нет — а значит нет и цикла обновлений, которого §8 требует
 * избежать.
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
  /** Отметить открытый проект сохранённым: после открытия из библиотеки. */
  readonly markClean: (project: Project) => void;
}

export interface ProjectStorageOptions {
  /**
   * Что сделать с записанной версией проекта.
   *
   * Запись возвращает проект с обновлённым `updatedAt` и превью. Если бы
   * приложение его не приняло, на экране осталось бы старое время
   * изменения, а в хранилище — новое, и они разошлись бы (§3).
   */
  readonly onStored: (project: Project) => void;
}

export function useProjectStorage(project: Project, options: ProjectStorageOptions): ProjectStorage {
  const [status, setStatus] = useState<StorageStatus>('unsaved');
  const [message, setMessage] = useState('Проект не сохранён');
  const [ephemeral, setEphemeral] = useState(false);
  const savedRef = useRef<Project | undefined>(undefined);

  // Колбэк держится в ссылке: иначе `save` пересоздавалась бы на каждый
  // рендер приложения и тянула бы за собой все зависящие от неё эффекты.
  const onStoredRef = useRef(options.onStored);
  onStoredRef.current = options.onStored;

  // Ссылка на проект изменилась — значит изменилась модель. Сравнение по
  // ссылке возможно именно потому, что состояние иммутабельно.
  useEffect(() => {
    if (savedRef.current === project) return;
    setStatus((current) => (current === 'saving' ? current : 'unsaved'));
    setMessage('Есть несохранённые изменения');
  }, [project]);

  const markClean = useCallback((stored: Project): void => {
    savedRef.current = stored;
    setStatus('saved');
    setMessage('Сохранено');
  }, []);

  const save = useCallback(async (): Promise<void> => {
    setStatus('saving');
    setMessage('Сохранение…');
    try {
      const repository = await sharedRepository();
      const preview = generateProjectThumbnail(project, () => new Date().toISOString());
      const stored = await repository.save(preview === undefined ? project : withPreview(project, preview));
      savedRef.current = stored;
      onStoredRef.current(stored);
      setEphemeral(!repository.isPersistent());
      setStatus('saved');
      setMessage(repository.isPersistent() ? 'Сохранено' : 'Сохранено только в памяти вкладки');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? `Не удалось сохранить: ${error.message}` : 'Не удалось сохранить проект');
    }
  }, [project]);

  const load = useCallback(async (id: ProjectId): Promise<Project | undefined> => {
    const repository = await sharedRepository();
    const document = await repository.load(id);
    if (document === undefined) return undefined;
    savedRef.current = document.project;
    setStatus('saved');
    setMessage('Загружено');
    return document.project;
  }, []);

  const restore = useCallback(async (): Promise<Project | undefined> => {
    const repository = await sharedRepository();
    setEphemeral(!repository.isPersistent());
    const summaries = [...(await repository.list())].sort(byUpdatedAtDesc);
    const latest = summaries[0];
    if (latest === undefined) return undefined;
    return load(latest.id);
  }, [load]);

  return { status, message, ephemeral, save, load, restore, markClean };
}
