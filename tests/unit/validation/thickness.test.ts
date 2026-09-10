import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { thicknessRule, validateProject } from '../../../src/validation/index.js';
import { createProject } from '../../../src/domain/index.js';

/**
 * Толщина корпуса против толщины материала (PROMPT 47, gap G-01).
 *
 * Дефект, найденный приёмкой: деталь 18 мм из «Корпусной плиты 16 мм» —
 * и ни слова об этом. Проверяется не текст сообщения, а то, что
 * расхождение вообще перестало быть молчаливым и что в сообщении есть
 * оба числа: без них человек не поймёт, что именно исправлять.
 */

const withThickness = (mm: number) =>
  produce(createProject({ name: 'Проверка толщины' }), (draft) => {
    const furniture = draft.furniture[0];
    if (furniture !== undefined) furniture.dimensions.panelThickness = mm;
  });

describe('толщина корпуса и толщина материала', () => {
  it('проект по умолчанию согласован — предупреждать не о чем', () => {
    expect(thicknessRule.run(createProject({ name: 'По умолчанию' }))).toHaveLength(0);
  });

  it('расхождение названо, и в нём оба числа', () => {
    const issues = thicknessRule.run(withThickness(18));
    expect(issues).toHaveLength(1);
    const [found] = issues;
    expect(found?.code).toBe('THICKNESS_MATERIAL_MISMATCH');
    expect(found?.severity).toBe('warning');
    expect(found?.message).toContain('18');
    expect(found?.message).toContain('16');
    // И имя материала: «не совпадает с материалом» без имени не
    // подсказывает, какой именно материал менять.
    expect(found?.message).toContain('Корпусная плита');
  });

  it('это предупреждение, а не ошибка: проект остаётся рабочим', () => {
    const report = validateProject(withThickness(18));
    expect(report.errors).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
    // Выгрузка документов не блокируется: расхождение стоит назвать, но
    // запрещать из-за него работу — уже перебор.
    expect(report.canExport).toBe(true);
  });

  it('правило подключено к общей проверке, а не живёт отдельно', () => {
    const report = validateProject(withThickness(22));
    expect(report.issues.some((i) => i.code === 'THICKNESS_MATERIAL_MISMATCH')).toBe(true);
  });

  it('сообщение ведёт к полю, которое правят', () => {
    const [found] = thicknessRule.run(withThickness(18));
    expect(found?.target?.path).toContain('panelThickness');
  });

  it('возврат к толщине материала убирает предупреждение', () => {
    expect(thicknessRule.run(withThickness(16))).toHaveLength(0);
  });
});
