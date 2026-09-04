import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  matchesQuery,
  normalizeQuery,
  recentProjects,
  searchProjects,
  sortProjects,
} from '../../../src/library/index.js';
import type { ProjectSummary } from '../../../src/persistence/index.js';
import type { ProjectId } from '../../../src/domain/index.js';

/**
 * Поиск и порядок библиотеки (PROMPT 25 §15–§17).
 *
 * Правила проверяются здесь, а не кликами в браузере, ровно потому, что
 * они живут в чистом слое и от интерфейса не зависят.
 */

const summary = (name: string, updatedAt: string, createdAt = updatedAt): ProjectSummary => ({
  id: `project:${name}` as ProjectId,
  name,
  updatedAt,
  createdAt,
  furnitureCount: 1,
  size: undefined,
  preview: undefined,
});

const day = (n: number): string => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;

describe('поиск по имени', () => {
  it('регистр не мешает найти проект', () => {
    expect(matchesQuery(summary('Шкаф в прихожую', day(1)), 'шкаф')).toBe(true);
    expect(matchesQuery(summary('шкаф', day(1)), 'ШКАФ')).toBe(true);
  });

  it('«ё» и «е» считаются одной буквой', () => {
    // Человек не помнит, как он написал имя полгода назад, и точно не
    // должен угадывать букву.
    expect(matchesQuery(summary('Полёт', day(1)), 'полет')).toBe(true);
    expect(matchesQuery(summary('Полет', day(1)), 'полёт')).toBe(true);
  });

  it('ищется подстрока, а не только начало имени', () => {
    expect(matchesQuery(summary('Кухня для дачи', day(1)), 'дач')).toBe(true);
  });

  it('пустой запрос ничего не отсекает', () => {
    expect(normalizeQuery('   ')).toBe('');
    const all = [summary('А', day(1)), summary('Б', day(2))];
    expect(searchProjects(all, '  ')).toHaveLength(2);
  });

  it('несовпадение исключает проект', () => {
    expect(searchProjects([summary('Шкаф', day(1))], 'тумба')).toHaveLength(0);
  });
});

describe('порядок', () => {
  const items = [summary('Бета', day(2), day(5)), summary('Альфа', day(3), day(1)), summary('Гамма', day(1), day(9))];

  it('по умолчанию — сначала недавние', () => {
    expect(sortProjects(items, 'updated-desc').map((s) => s.name)).toEqual(['Альфа', 'Бета', 'Гамма']);
  });

  it('обратный порядок по времени изменения', () => {
    expect(sortProjects(items, 'updated-asc').map((s) => s.name)).toEqual(['Гамма', 'Бета', 'Альфа']);
  });

  it('по имени в обе стороны', () => {
    expect(sortProjects(items, 'name-asc').map((s) => s.name)).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(sortProjects(items, 'name-desc').map((s) => s.name)).toEqual(['Гамма', 'Бета', 'Альфа']);
  });

  it('по времени создания — это не то же, что по времени правки', () => {
    expect(sortProjects(items, 'created-desc').map((s) => s.name)).toEqual(['Гамма', 'Бета', 'Альфа']);
  });

  it('сортировка не изменяет исходный массив', () => {
    const before = items.map((s) => s.name);
    sortProjects(items, 'name-desc');
    expect(items.map((s) => s.name)).toEqual(before);
  });

  it('одинаковое время даёт устойчивый порядок, а не случайный', () => {
    const same = [summary('Б', day(1)), summary('А', day(1))];
    expect(sortProjects(same, 'updated-desc').map((s) => s.id)).toEqual(
      sortProjects([...same].reverse(), 'updated-desc').map((s) => s.id),
    );
  });
});

describe('недавние', () => {
  it('это верхушка того же списка, а не второе состояние', () => {
    const many = Array.from({ length: 8 }, (_, index) => summary(`П${String(index)}`, day(index + 1)));
    const recent = recentProjects(many);
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]?.name).toBe('П7');
  });

  it('пустая библиотека даёт пустой список, а не ошибку', () => {
    expect(recentProjects([])).toEqual([]);
  });
});
