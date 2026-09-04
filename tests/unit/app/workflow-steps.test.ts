import { describe, expect, it } from 'vitest';
import { issue } from '../../../src/domain/index.js';
import type { Issue } from '../../../src/domain/index.js';
import {
  FIRST_STEP,
  STEP_BY_ID,
  WORKFLOW_STEPS,
  nextStep,
  previousStep,
  stepOfIssue,
  stepPosition,
  stepStates,
} from '../../../src/app/workflow/steps.js';
import type { StepId } from '../../../src/app/workflow/steps.js';

/**
 * Пошаговый сценарий (PROMPT 27 §3, §24, §27, §29).
 *
 * Порядок и разбор проблем по шагам — правила, а не отрисовка, и
 * проверяются они здесь, без браузера.
 */

describe('порядок шагов', () => {
  it('одиннадцать шагов, пронумерованных подряд', () => {
    expect(WORKFLOW_STEPS).toHaveLength(11);
    expect(WORKFLOW_STEPS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('идентификаторы уникальны', () => {
    expect(new Set(WORKFLOW_STEPS.map((s) => s.id)).size).toBe(WORKFLOW_STEPS.length);
  });

  it('первый шаг — размеры: от них зависит всё остальное', () => {
    expect(FIRST_STEP).toBe('dimensions');
    expect(WORKFLOW_STEPS[0]?.id).toBe('dimensions');
  });

  it('проверка и производство — в конце и на своём экране', () => {
    expect(STEP_BY_ID.validation.screen).toBe('production');
    expect(STEP_BY_ID.production.screen).toBe('production');
    // Все остальные — в конструкторе.
    for (const step of WORKFLOW_STEPS.slice(0, 9)) {
      expect(step.screen, step.id).toBe('editor');
    }
  });

  it('переходы вперёд и назад проходят весь список', () => {
    const forward: StepId[] = [FIRST_STEP];
    let cursor = nextStep(FIRST_STEP);
    while (cursor !== undefined) {
      forward.push(cursor);
      cursor = nextStep(cursor);
    }
    expect(forward).toEqual(WORKFLOW_STEPS.map((s) => s.id));
  });

  it('за краями идти некуда', () => {
    expect(previousStep('dimensions')).toBeUndefined();
    expect(nextStep('production')).toBeUndefined();
  });

  it('назад — ровно обратный шаг вперёд', () => {
    for (const step of WORKFLOW_STEPS) {
      const forward = nextStep(step.id);
      if (forward !== undefined) expect(previousStep(forward)).toBe(step.id);
    }
  });

  it('положение показывается номером, а не процентом', () => {
    // «67%» подразумевает, что треть работы осталась, а это неизвестно.
    expect(stepPosition('dimensions')).toBe('1 из 11');
    expect(stepPosition('materials')).toBe('8 из 11');
  });
});

describe('проблема → шаг (§24)', () => {
  const withPath = (code: string, path: string): Issue => issue(code, 'error', 'x', { path });

  it('путь к полю точнее машинного кода', () => {
    expect(stepOfIssue(withPath('ANY_CODE', 'dimensions.width'))).toBe('dimensions');
    expect(stepOfIssue(withPath('ANY_CODE', 'carcass.back.mount'))).toBe('carcass');
    expect(stepOfIssue(withPath('ANY_CODE', 'carcass.base.parts'))).toBe('carcass');
    expect(stepOfIssue(withPath('ANY_CODE', 'settings.defaultMaterialId'))).toBe('materials');
  });

  it('задняя стенка и цоколь — корпус, а прочие модификаторы — конструкция', () => {
    // Разница содержательная: без задней стенки и цоколя короба нет, а
    // столешница и свесы — надстройка над готовым коробом.
    expect(stepOfIssue(withPath('X', 'carcass.back'))).toBe('carcass');
    expect(stepOfIssue(withPath('X', 'carcass.countertop'))).toBe('construction');
    expect(stepOfIssue(withPath('X', 'carcass.overhang'))).toBe('construction');
    expect(stepOfIssue(withPath('X', 'carcass.falsePanels'))).toBe('construction');
  });

  it('код разбирается, когда пути нет', () => {
    expect(stepOfIssue(issue('DIMENSION_NOT_POSITIVE', 'error', 'x'))).toBe('dimensions');
    expect(stepOfIssue(issue('PLINTH_GEOMETRY_INVALID', 'error', 'x'))).toBe('carcass');
    expect(stepOfIssue(issue('SPLIT_UNDERCONSTRAINED', 'error', 'x'))).toBe('sections');
    expect(stepOfIssue(issue('CELL_BELOW_MIN_SIZE', 'warning', 'x'))).toBe('cells');
    expect(stepOfIssue(issue('SHELF_OVERLAP', 'error', 'x'))).toBe('shelves');
    expect(stepOfIssue(issue('DOOR_CELL_HAS_DRAWERS', 'error', 'x'))).toBe('facades');
    expect(stepOfIssue(issue('MATERIAL_NOT_ASSIGNED', 'error', 'x'))).toBe('materials');
    expect(stepOfIssue(issue('COUNTERTOP_GEOMETRY_INVALID', 'error', 'x'))).toBe('construction');
  });

  it('ошибка самой деталировки не принадлежит шагу настройки', () => {
    // PART_* приходит из расчёта целиком, а не из параметра, который
    // человек задавал. Приписать её шагу значило бы отправить его чинить
    // не то.
    expect(stepOfIssue(issue('PART_ID_DUPLICATE', 'error', 'x'))).toBeUndefined();
    expect(stepOfIssue(issue('INNER_VOLUME_EMPTY', 'error', 'x'))).toBeUndefined();
  });
});

describe('состояния шагов (§27)', () => {
  const states = (issues: readonly Issue[], current: StepId, visited: StepId[] = []) =>
    new Map(stepStates({ issues, current, visited: new Set(visited) }).map((v) => [v.step.id, v]));

  it('без проблем текущий шаг — текущий, посещённые — посещённые', () => {
    const map = states([], 'sections', ['dimensions', 'carcass']);
    expect(map.get('sections')?.state).toBe('current');
    expect(map.get('dimensions')?.state).toBe('visited');
    expect(map.get('materials')?.state).toBe('pending');
  });

  it('ошибка перевешивает «текущий»', () => {
    // Иначе шаг, на котором стоишь, выглядел бы благополучным ровно
    // тогда, когда на нём проблема.
    const map = states([issue('DIMENSION_NOT_POSITIVE', 'error', 'x')], 'dimensions');
    expect(map.get('dimensions')?.state).toBe('error');
    expect(map.get('dimensions')?.tone).toBe('danger');
    expect(map.get('dimensions')?.errors).toBe(1);
  });

  it('ошибка перевешивает предупреждение на том же шаге', () => {
    const map = states(
      [
        issue('DIMENSION_OUT_OF_RECOMMENDED_RANGE', 'warning', 'x'),
        issue('DIMENSION_NOT_POSITIVE', 'error', 'x'),
      ],
      'materials',
    );
    expect(map.get('dimensions')?.state).toBe('error');
    expect(map.get('dimensions')?.errors).toBe(1);
    expect(map.get('dimensions')?.warnings).toBe(1);
  });

  it('предупреждение отмечается, но не как ошибка', () => {
    const map = states([issue('CELL_BELOW_MIN_SIZE', 'warning', 'x')], 'dimensions');
    expect(map.get('cells')?.state).toBe('warning');
    expect(map.get('cells')?.tone).toBe('warning');
  });

  it('сообщения уровня info состояние шага не меняют', () => {
    const map = states([issue('CELL_BELOW_MIN_SIZE', 'info', 'x')], 'dimensions');
    expect(map.get('cells')?.state).toBe('pending');
  });

  it('состояния «завершён» нет, и это осознанно', () => {
    // У каждого шага есть осмысленные умолчания, поэтому критерия
    // завершённости не существует — а рисовать галочку без критерия
    // значит показывать несуществующий факт.
    const all = stepStates({
      issues: [],
      current: 'production',
      visited: new Set(WORKFLOW_STEPS.map((s) => s.id)),
    });
    expect(all.every((v) => v.state !== ('done' as never))).toBe(true);
  });

  it('каждому шагу соответствует ровно одна запись', () => {
    const all = stepStates({ issues: [], current: 'dimensions', visited: new Set() });
    expect(all.map((v) => v.step.id)).toEqual(WORKFLOW_STEPS.map((s) => s.id));
  });
});
