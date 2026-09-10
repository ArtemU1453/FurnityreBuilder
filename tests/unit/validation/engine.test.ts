import { describe, expect, it } from 'vitest';
import { validateProject } from '../../../src/validation/engine.js';
import { createProject } from '../../../src/domain/project/factory.js';
import { asId, createSequentialIdFactory } from '../../../src/domain/ids.js';
import { DIMENSION_LABELS } from '../../../src/domain/index.js';
import type { Project } from '../../../src/domain/index.js';

const base = (): Project =>
  createProject({ ids: createSequentialIdFactory('t'), now: () => '2026-01-01T00:00:00.000Z' });

const codes = (project: Project): string[] => validateProject(project).issues.map((i) => i.code);

describe('валидация: значения', () => {
  it('чистый проект проходит без ошибок и допускает экспорт', () => {
    const report = validateProject(base());
    expect(report.errors).toBe(0);
    expect(report.canExport).toBe(true);
  });

  it('ловит NaN в габарите', () => {
    const project = base();
    const broken: Project = {
      ...project,
      furniture: [
        { ...project.furniture[0]!, dimensions: { ...project.furniture[0]!.dimensions, width: Number.NaN } },
      ],
    };
    expect(codes(broken)).toContain('VALUE_NAN');
    expect(validateProject(broken).canExport).toBe(false);
  });

  it('ловит бесконечность в габарите', () => {
    const project = base();
    const broken: Project = {
      ...project,
      furniture: [
        {
          ...project.furniture[0]!,
          dimensions: { ...project.furniture[0]!.dimensions, height: Number.POSITIVE_INFINITY },
        },
      ],
    };
    expect(codes(broken)).toContain('VALUE_NOT_FINITE');
  });

  it('ловит неположительный размер', () => {
    const project = base();
    const broken: Project = {
      ...project,
      furniture: [
        { ...project.furniture[0]!, dimensions: { ...project.furniture[0]!.dimensions, depth: 0 } },
      ],
    };
    expect(codes(broken)).toContain('VALUE_NOT_POSITIVE');
  });

  it('выход за рекомендуемый диапазон — предупреждение, а не блокировка', () => {
    const project = base();
    const wide: Project = {
      ...project,
      furniture: [
        { ...project.furniture[0]!, dimensions: { ...project.furniture[0]!.dimensions, width: 9000 } },
      ],
    };
    const report = validateProject(wide);
    // ASSUMPTION(T-DIM-01): границы неизвестны, поэтому пользователь не теряет управление.
    expect(report.warnings).toBeGreaterThan(0);
    expect(report.errors).toBe(0);
    expect(report.canExport).toBe(true);
  });
});

describe('валидация: ссылки', () => {
  it('ловит ссылку на несуществующий материал', () => {
    const project = base();
    const broken: Project = {
      ...project,
      materials: {
        ...project.materials,
        assignment: { ...project.materials.assignment, side: asId<'Material'>('missing') },
      },
    };
    expect(codes(broken)).toContain('MATERIAL_REFERENCE_BROKEN');
  });

  it('ловит фасад, ссылающийся на несуществующую секцию', () => {
    const project = base();
    const broken: Project = {
      ...project,
      furniture: [
        {
          ...project.furniture[0]!,
          facades: [
            {
              id: asId<'Node'>('f1'),
              covers: { kind: 'node', nodeId: asId<'Node'>('nope') },
              type: 'hinged',
              leaves: [],
              overlay: { mode: 'overlay', gapBetweenLeaves: 3, gapTop: 2, gapBottom: 2, gapSide: 2 },
            },
          ],
        },
      ],
    };
    expect(codes(broken)).toContain('FACADE_REFERENCE_BROKEN');
  });

  it('ловит повторяющийся идентификатор узла', () => {
    const project = base();
    const duplicate = asId<'Node'>('dup');
    const broken: Project = {
      ...project,
      furniture: [
        {
          ...project.furniture[0]!,
          root: {
            id: duplicate,
            kind: 'split',
            axis: 'x',
            divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
            children: [
              { size: { mode: 'flex', weight: 1 }, node: { id: duplicate, kind: 'leaf', fill: { kind: 'empty' } } },
              { size: { mode: 'flex', weight: 1 }, node: { id: asId<'Node'>('other'), kind: 'leaf', fill: { kind: 'empty' } } },
            ],
          },
        },
      ],
    };
    expect(codes(broken)).toContain('NODE_ID_DUPLICATE');
  });
});

describe('валидация: структура дерева', () => {
  it('ловит деление с одной ячейкой', () => {
    const project = base();
    const broken: Project = {
      ...project,
      furniture: [
        {
          ...project.furniture[0]!,
          root: {
            id: asId<'Node'>('s1'),
            kind: 'split',
            axis: 'x',
            divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
            children: [
              { size: { mode: 'flex', weight: 1 }, node: { id: asId<'Node'>('a'), kind: 'leaf', fill: { kind: 'empty' } } },
            ],
          },
        },
      ],
    };
    expect(codes(broken)).toContain('SPLIT_TOO_FEW_CHILDREN');
  });

  it('ловит вложенное деление по той же оси', () => {
    const project = base();
    const nested: Project = {
      ...project,
      furniture: [
        {
          ...project.furniture[0]!,
          root: {
            id: asId<'Node'>('s1'),
            kind: 'split',
            axis: 'x',
            divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
            children: [
              {
                size: { mode: 'flex', weight: 1 },
                node: {
                  id: asId<'Node'>('s2'),
                  kind: 'split',
                  axis: 'x',
                  divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
                  children: [
                    { size: { mode: 'flex', weight: 1 }, node: { id: asId<'Node'>('a'), kind: 'leaf', fill: { kind: 'empty' } } },
                    { size: { mode: 'flex', weight: 1 }, node: { id: asId<'Node'>('b'), kind: 'leaf', fill: { kind: 'empty' } } },
                  ],
                },
              },
              { size: { mode: 'flex', weight: 1 }, node: { id: asId<'Node'>('c'), kind: 'leaf', fill: { kind: 'empty' } } },
            ],
          },
        },
      ],
    };
    expect(codes(nested)).toContain('NESTED_SPLIT_SAME_AXIS');
  });
});

describe('сообщения написаны на языке пользователя (PROMPT 38, дефект П-004)', () => {
  /*
    Ошибка валидации — это текст, который увидит мебельщик. Он читал
    «Габарит «width» должен быть больше нуля», заполняя поле с подписью
    «Ширина»: внутреннее имя ключа, английское, в русской фразе, про
    поле, которое так нигде и не называется.

    Проверяется правило, а не конкретная формулировка: в сообщении не
    должно быть ключей модели. Иначе следующее сообщение напишут так же.
    */
  const KEYS = ['width', 'height', 'depth', 'panelThickness'];

  const messagesOf = (project: Project): string[] =>
    validateProject(project).issues.map((i) => i.message);

  const withDimensions = (value: number): Project => {
    const project = base();
    const first = project.furniture[0]!;
    return {
      ...project,
      furniture: [
        {
          ...first,
          dimensions: { ...first.dimensions, width: value, height: value, depth: value },
        },
      ],
    };
  };

  it('нулевой габарит: сообщение без ключей модели', () => {
    for (const message of messagesOf(withDimensions(0))) {
      for (const key of KEYS) {
        expect(message, `ключ «${key}» в тексте: ${message}`).not.toContain(`«${key}»`);
      }
    }
  });

  it('нулевой габарит: сообщение называет поле так же, как интерфейс', () => {
    const messages = messagesOf(withDimensions(0));
    expect(messages.some((m) => m.includes(DIMENSION_LABELS.width))).toBe(true);
    expect(messages.some((m) => m.includes(DIMENSION_LABELS.height))).toBe(true);
  });

  it('выход за диапазон: тоже подпись, а не ключ', () => {
    const messages = messagesOf(withDimensions(9000));
    const range = messages.filter((m) => m.includes('диапазон'));
    expect(range.length).toBeGreaterThan(0);
    for (const message of range) {
      for (const key of KEYS) expect(message).not.toContain(`«${key}»`);
    }
  });

  it('словарь подписей покрывает все габариты', () => {
    for (const key of KEYS) {
      expect(DIMENSION_LABELS[key as keyof typeof DIMENSION_LABELS]).toBeTruthy();
    }
  });
});
