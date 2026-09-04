import { describe, expect, it } from 'vitest';
import { buildSceneMaterials, sceneMaterialOf, toSceneMaterial } from '../../../src/scene/materials.js';
import { FALLBACK_MATERIAL } from '../../../src/scene/types.js';
import { makeGeometryInput } from '../geometry/helpers.js';
import type { Material, MaterialId, MaterialKind } from '../../../src/domain/index.js';

/**
 * Визуальные материалы (PROMPT 23 §12–§13).
 *
 * Второго реестра материалов не заводится: здесь только то, чем
 * отличается ПОКАЗ одного материала от показа другого.
 */

const materials = makeGeometryInput().materials;

const material = (kind: MaterialKind, color = '#aabbcc'): Material => ({
  id: 'm-test' as MaterialId,
  name: 'Тест',
  kind,
  thickness: 16,
  displayColor: color,
  grain: 'none',
});

describe('материал детали → визуальный материал', () => {
  it('цвет берётся из displayColor, а не придумывается', () => {
    expect(toSceneMaterial(material('chipboard', '#123456')).color).toBe('#123456');
  });

  it('короткая запись цвета разворачивается в полную', () => {
    expect(toSceneMaterial(material('chipboard', '#abc')).color).toBe('#aabbcc');
  });

  it('нераспознанный цвет заменяется нейтральным, а не роняет отрисовку', () => {
    expect(toSceneMaterial(material('chipboard', 'красный')).color).toBe(FALLBACK_MATERIAL.color);
  });

  it('плита непрозрачна', () => {
    for (const kind of ['chipboard', 'mdf', 'plywood', 'hardboard', 'solid'] as const) {
      expect(toSceneMaterial(material(kind)).opacity).toBe(1);
    }
  });

  it('стекло прозрачно, зеркало — нет: зеркало отражает, а не просвечивает', () => {
    expect(toSceneMaterial(material('glass')).opacity).toBeLessThan(1);
    expect(toSceneMaterial(material('mirror')).opacity).toBe(1);
    expect(toSceneMaterial(material('mirror')).metallic).toBeGreaterThan(0.5);
  });

  it('плита шероховата, стекло — нет', () => {
    expect(toSceneMaterial(material('chipboard')).roughness).toBeGreaterThan(0.5);
    expect(toSceneMaterial(material('glass')).roughness).toBeLessThan(0.2);
  });

  it('плитные материалы различимы между собой, но не карикатурно', () => {
    const chip = toSceneMaterial(material('chipboard')).roughness;
    const mdf = toSceneMaterial(material('mdf')).roughness;
    expect(chip).not.toBe(mdf);
    expect(Math.abs(chip - mdf)).toBeLessThan(0.2);
  });

  it('визуальный материал не тащит за собой имя, толщину и формат листа', () => {
    const visual = toSceneMaterial(material('chipboard')) as unknown as Record<string, unknown>;
    expect(visual['name']).toBeUndefined();
    expect(visual['thickness']).toBeUndefined();
    expect(visual['sheet']).toBeUndefined();
  });
});

describe('поиск по идентификатору', () => {
  it('находит материал библиотеки', () => {
    const id = Object.keys(materials.items)[0] as MaterialId;
    expect(sceneMaterialOf(materials, id).materialId).toBe(id);
  });

  it('битая ссылка даёт нейтральный серый, а не чужой цвет', () => {
    // Приоритет материалов разрешён движком ДО сцены: Part.materialId уже
    // окончателен (§13). Повторять иерархию здесь значило бы завести
    // второй, расходящийся ответ на тот же вопрос.
    const visual = sceneMaterialOf(materials, 'нет-такого' as MaterialId);
    expect(visual.color).toBe(FALLBACK_MATERIAL.color);
    expect(visual.opacity).toBe(1);
  });

  it('словарь материалов покрывает всю библиотеку', () => {
    const map = buildSceneMaterials(materials);
    expect(map.size).toBe(Object.keys(materials.items).length);
  });
});
