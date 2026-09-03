import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { hasErrors } from '../../../src/domain/index.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Тестовые сценарии для известных конфигураций (PROMPT 3 §16).
 *
 * Каждый сценарий проверяется двумя способами:
 *   1. явными числовыми утверждениями по ключевым размерам и позициям —
 *      основной вид проверки, объясняющий, ЧТО именно проверяется;
 *   2. `toMatchSnapshot()` по всему списку деталей — страховка от случайной
 *      правки соседнего поля (например, `role` или `edge`), которую
 *      точечные проверки не заметят.
 *
 * Числа получены прогоном текущей (уже проверенной в carcass.test.ts)
 * реализации, а не подобраны на глаз — это фиксация здорового поведения
 * для защиты от регрессий, а не источник новых формул.
 */

describe('снапшот: типовой шкаф 1000×2000×500, T=16', () => {
  const result = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 16 }));

  it('без ошибок, четыре детали каркаса и задняя стенка', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
    // С PROMPT 14 задняя стенка — деталь: 4 детали каркаса + 1 задняя стенка.
    expect(result.parts).toHaveLength(5);
  });

  it('боковины стоят по краям, высота на весь корпус', () => {
    const left = result.parts.find((p) => p.label === 'Боковина левая')!;
    const right = result.parts.find((p) => p.label === 'Боковина правая')!;
    expect(left.position).toEqual({ x: 0, y: 0, z: 3 });
    expect(left.size).toEqual({ x: 16, y: 2000, z: 497 });
    expect(right.position).toEqual({ x: 984, y: 0, z: 3 });
    expect(right.size).toEqual({ x: 16, y: 2000, z: 497 });
  });

  it('дно и крышка встают между боковинами', () => {
    const bottom = result.parts.find((p) => p.label === 'Дно')!;
    const top = result.parts.find((p) => p.label === 'Крышка')!;
    expect(bottom.position).toEqual({ x: 16, y: 0, z: 3 });
    expect(bottom.size).toEqual({ x: 968, y: 16, z: 497 });
    expect(top.position).toEqual({ x: 16, y: 1984, z: 3 });
    expect(top.size).toEqual({ x: 968, y: 16, z: 497 });
  });

  it('bounding box совпадает с номинальным габаритом', () => {
    expect(result.boundingBox).toEqual({
      minX: 0, maxX: 1000,
      minY: 0, maxY: 2000,
      // С PROMPT 14 охват включает саму заднюю стенку (z ∈ [0, 3]), поэтому
      // совпадает с номинальной глубиной целиком, а не теряет её толщину.
      minZ: 0, maxZ: 500,
      totalWidth: 1000, totalHeight: 2000, totalDepth: 500,
    });
  });

  it('снапшот полного списка деталей', () => {
    expect(result.parts).toMatchSnapshot();
  });
});

describe('снапшот: минимальная мебель 100×100×80, T=8', () => {
  const result = buildGeometry(makeGeometryInput({ width: 100, height: 100, depth: 80, panelThickness: 8 }));

  it('минимальный, но валидный корпус строится без ошибок', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
    // С PROMPT 14 задняя стенка — деталь: 4 детали каркаса + 1 задняя стенка.
    expect(result.parts).toHaveLength(5);
  });

  it('внутренний проём положителен даже на минимальных габаритах', () => {
    expect(result.innerVolume.size).toEqual({ x: 84, y: 84, z: 77 });
    expect(result.innerVolume.size.x).toBeGreaterThan(0);
    expect(result.innerVolume.size.y).toBeGreaterThan(0);
    expect(result.innerVolume.size.z).toBeGreaterThan(0);
  });

  it('боковины и горизонтали корректных размеров', () => {
    const left = result.parts.find((p) => p.label === 'Боковина левая')!;
    const bottom = result.parts.find((p) => p.label === 'Дно')!;
    expect(left.size).toEqual({ x: 8, y: 100, z: 77 });
    expect(bottom.size).toEqual({ x: 84, y: 8, z: 77 });
  });

  it('снапшот полного списка деталей', () => {
    expect(result.parts).toMatchSnapshot();
  });
});

describe('снапшот: крупная мебель 5900×2900×1150, T=30', () => {
  const result = buildGeometry(makeGeometryInput({ width: 5900, height: 2900, depth: 1150, panelThickness: 30 }));

  it('строится без ошибок на верхней границе рекомендуемого диапазона', () => {
    expect(hasErrors(result.diagnostics)).toBe(false);
    // С PROMPT 14 задняя стенка — деталь: 4 детали каркаса + 1 задняя стенка.
    expect(result.parts).toHaveLength(5);
  });

  it('внутренний проём отражает увеличенную толщину материала', () => {
    // 5900 - 2×30 = 5840; 2900 - 2×30 = 2840
    expect(result.innerVolume.size.x).toBe(5840);
    expect(result.innerVolume.size.y).toBe(2840);
  });

  it('bounding box соответствует заявленному габариту', () => {
    expect(result.boundingBox.totalWidth).toBe(5900);
    expect(result.boundingBox.totalHeight).toBe(2900);
  });

  it('снапшот полного списка деталей', () => {
    expect(result.parts).toMatchSnapshot();
  });
});

describe('снапшот: увеличенная толщина материала при типовом габарите', () => {
  const result = buildGeometry(makeGeometryInput({ width: 1000, height: 2000, depth: 500, panelThickness: 40 }));

  it('утолщение материала пропорционально уменьшает внутренний проём', () => {
    // При T=16 внутренняя ширина была 968; при T=40 она меньше на 2×(40-16)=48.
    expect(result.innerVolume.size.x).toBe(920);
    expect(result.innerVolume.size.y).toBe(1920);
  });

  it('толщина боковины и горизонталей равна заданной толщине материала', () => {
    const left = result.parts.find((p) => p.label === 'Боковина левая')!;
    const bottom = result.parts.find((p) => p.label === 'Дно')!;
    expect(left.size.x).toBe(40);
    expect(bottom.size.y).toBe(40);
  });

  it('снапшот полного списка деталей', () => {
    expect(result.parts).toMatchSnapshot();
  });
});
