import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectId, Room } from '../domain/index.js';
import { sharedRepository } from './repository.js';

/**
 * Проекты, на которые ссылается помещение (PROMPT 25 §13, §14, §22).
 *
 * ## Зачем
 *
 * Экземпляр в помещении — это ссылка «проект + изделие», и проект этот
 * не обязан быть открытым. Чтобы нарисовать чужой шкаф и посчитать его
 * габарит, приложению нужен сам проект; берётся он из того же
 * хранилища, что и всё остальное.
 *
 * ## Почему кэш, а не загрузка при каждом кадре
 *
 * Проект загружается один раз на идентификатор и держится в памяти,
 * пока он нужен помещению. Иначе каждое движение мышью по планировщику
 * читало бы базу (§33).
 *
 * ## Отсутствующий проект — это состояние, а не ошибка
 *
 * Удалённый проект не чинится и не убирается молча: он попадает в
 * `missing`, и планировщик показывает размещение как недоступное
 * (§12, вариант C; §22, состояние MISSING). Повторные попытки загрузки
 * не делаются — иначе неудача превратилась бы в бесконечный цикл.
 */
export interface LinkedProjects {
  /** Загруженные чужие проекты по идентификатору. */
  readonly projects: ReadonlyMap<ProjectId, Project>;
  /** Идентификаторы, которых в хранилище нет. */
  readonly missing: ReadonlySet<ProjectId>;
  /** Загрузить проект заранее — перед размещением его в помещении. */
  readonly link: (id: ProjectId) => Promise<Project | undefined>;
}

export function useLinkedProjects(room: Room | undefined, hostId: ProjectId): LinkedProjects {
  const [projects, setProjects] = useState<ReadonlyMap<ProjectId, Project>>(new Map());
  const [missing, setMissing] = useState<ReadonlySet<ProjectId>>(new Set());

  // Ссылки на текущее содержимое: эффект ниже не должен перезапускаться
  // от того, что кэш пополнился, — иначе он пополнял бы его снова.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const missingRef = useRef(missing);
  missingRef.current = missing;

  /**
   * Ключ множества ссылок. Строка, а не массив: массив был бы новым
   * объектом на каждый рендер, и эффект срабатывал бы бесконечно.
   */
  const referenced = useMemo(() => {
    if (room === undefined) return '';
    const ids = new Set<string>();
    for (const instance of room.furnitureInstances) {
      if (instance.projectId !== hostId) ids.add(instance.projectId);
    }
    return [...ids].sort().join(',');
  }, [room, hostId]);

  const link = useCallback(async (id: ProjectId): Promise<Project | undefined> => {
    const known = projectsRef.current.get(id);
    if (known !== undefined) return known;
    try {
      const repository = await sharedRepository();
      const document = await repository.load(id);
      if (document === undefined) {
        setMissing((current) => new Set(current).add(id));
        return undefined;
      }
      setProjects((current) => new Map(current).set(id, document.project));
      return document.project;
    } catch {
      setMissing((current) => new Set(current).add(id));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (referenced.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const raw of referenced.split(',')) {
        const id = raw as ProjectId;
        if (cancelled) return;
        if (projectsRef.current.has(id) || missingRef.current.has(id)) continue;
        await link(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [referenced, link]);

  return { projects, missing, link };
}
