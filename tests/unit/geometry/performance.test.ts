import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { makeGeometryInput } from './helpers.js';

/**
 * Бюджет производительности из docs/ARCHITECTURE.md §5.6: полный пересчёт
 * типового изделия — цель < 5 мс. Порог здесь взят заметно шире (50 мс),
 * чтобы тест не был хрупким в разных CI-средах — это дымовой тест на
 * отсутствие квадратичного разрастания, а не бюджетный замер. Настоящий
 * бюджет проверяется трассировкой кадров в браузере на этапе 30 плана.
 */
describe('производительность: дымовой тест', () => {
  it('единичный расчёт укладывается в разумный бюджет', () => {
    const input = makeGeometryInput({});
    const start = performance.now();
    buildGeometry(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('время расчёта не растёт с числом повторов — нет скрытого накопления состояния', () => {
    const input = makeGeometryInput({});

    const first = performance.now();
    for (let i = 0; i < 200; i += 1) buildGeometry(input);
    const firstBatch = performance.now() - first;

    const second = performance.now();
    for (let i = 0; i < 200; i += 1) buildGeometry(input);
    const secondBatch = performance.now() - second;

    // Вторая партия не должна быть на порядок медленнее первой — если бы
    // движок копил состояние между вызовами (например, глобальный кэш без
    // ограничения), это проявилось бы именно так.
    expect(secondBatch).toBeLessThan(firstBatch * 5 + 20);
  });
});
