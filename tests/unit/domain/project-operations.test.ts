import { describe, expect, it } from 'vitest';
import { createProject } from '../../../src/domain/project/factory.js';
import { copyName, duplicateProject, renameProject, touchProject, withPreview } from '../../../src/domain/index.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';

/**
 * Операции над проектом (PROMPT 25 §9–§11).
 *
 * Главные два свойства: переименование НЕ меняет идентификатор (иначе
 * рвутся ссылки из помещений), а копия не разделяет с оригиналом ни
 * одной изменяемой ссылки.
 */

const at = (value: string) => (): string => value;
const project = (name = 'Шкаф') =>
  createProject({ ids: createSequentialIdFactory('p'), now: at('2026-01-01T00:00:00.000Z'), name });

describe('отметка времени', () => {
  it('меняет только updatedAt', () => {
    const base = project();
    const touched = touchProject(base, at('2026-05-05T10:00:00.000Z'));
    expect(touched.metadata.updatedAt).toBe('2026-05-05T10:00:00.000Z');
    expect(touched.metadata.createdAt).toBe(base.metadata.createdAt);
    expect(touched.id).toBe(base.id);
    expect(touched.furniture).toBe(base.furniture);
  });
});

describe('переименование', () => {
  it('идентификатор сохраняется: ссылки из помещения остаются живыми (§10)', () => {
    const base = project();
    const renamed = renameProject(base, 'Гардероб', at('2026-02-02T00:00:00.000Z'));
    expect(renamed.id).toBe(base.id);
    expect(renamed.name).toBe('Гардероб');
    expect(renamed.metadata.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('пробелы по краям срезаются', () => {
    expect(renameProject(project(), '  Кухня  ', at('x')).name).toBe('Кухня');
  });

  it('пустое имя не принимается: проект без имени не найти в списке', () => {
    const base = project();
    expect(renameProject(base, '   ', at('x'))).toBe(base);
  });

  it('то же имя не считается изменением', () => {
    const base = project('Шкаф');
    expect(renameProject(base, 'Шкаф', at('x'))).toBe(base);
  });
});

describe('дублирование', () => {
  const base = project();
  const copy = duplicateProject(base, createSequentialIdFactory('c'), at('2026-03-03T00:00:00.000Z'));

  it('копия получает новый идентификатор (§11)', () => {
    expect(copy.id).not.toBe(base.id);
  });

  it('время создания копии — момент копирования, а не оригинала', () => {
    expect(copy.metadata.createdAt).toBe('2026-03-03T00:00:00.000Z');
    expect(copy.metadata.updatedAt).toBe('2026-03-03T00:00:00.000Z');
  });

  it('общих изменяемых ссылок с оригиналом не остаётся', () => {
    expect(copy.furniture).not.toBe(base.furniture);
    expect(copy.furniture[0]).not.toBe(base.furniture[0]);
    expect(copy.materials).not.toBe(base.materials);
    expect(copy.settings).not.toBe(base.settings);
  });

  it('содержимое совпадает: копия — это копия', () => {
    expect(copy.furniture[0]?.dimensions).toEqual(base.furniture[0]?.dimensions);
  });

  it('внутренние идентификаторы сохраняются намеренно', () => {
    // Они уникальны в пределах проекта, а ссылка из помещения — пара
    // «проект + изделие», поэтому совпадение ничему не мешает.
    expect(copy.furniture[0]?.id).toBe(base.furniture[0]?.id);
  });

  it('превью не копируется: оно принадлежит сохранённому состоянию', () => {
    const withIt = withPreview(base, {
      svg: '<svg/>',
      width: 1,
      height: 1,
      sourceFingerprint: 'x',
      generatedAt: 'y',
    });
    expect(duplicateProject(withIt, createSequentialIdFactory('d'), at('z')).preview).toBeUndefined();
  });

  it('имя можно задать явно', () => {
    expect(duplicateProject(base, createSequentialIdFactory('e'), at('z'), 'Второй шкаф').name).toBe('Второй шкаф');
  });
});

describe('имя копии', () => {
  it('первая копия', () => {
    expect(copyName('Шкаф')).toBe('Шкаф (копия)');
  });

  it('копия копии не превращается в «(копия) (копия)»', () => {
    expect(copyName('Шкаф (копия)')).toBe('Шкаф (копия 2)');
    expect(copyName('Шкаф (копия 2)')).toBe('Шкаф (копия 3)');
  });

  it('имя со скобками не ломается', () => {
    expect(copyName('Шкаф (белый)')).toBe('Шкаф (белый) (копия)');
  });
});
