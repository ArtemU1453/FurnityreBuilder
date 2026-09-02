import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveSizes } from '../../../src/domain/furniture/layout.js';
import type { SizeSpec } from '../../../src/domain/furniture/types.js';
import { MM_EPSILON, roundMm, sumMm } from '../../../src/domain/units.js';

const flex = (weight = 1): SizeSpec => ({ mode: 'flex', weight });
const fixed = (value: number): SizeSpec => ({ mode: 'fixed', value });

describe('раскладка деления', () => {
  it('делит остаток поровну между растягиваемыми ячейками', () => {
    const result = resolveSizes([flex(), flex()], 968, 16);
    expect(result.spans.map((s) => s.length)).toEqual([476, 476]);
    expect(result.spans.map((s) => s.offset)).toEqual([0, 492]);
  });

  it('уважает фиксированные размеры и отдаёт остаток растягиваемым', () => {
    const result = resolveSizes([fixed(300), flex(), flex()], 1000, 0);
    expect(result.spans.map((s) => s.length)).toEqual([300, 350, 350]);
  });

  it('распределяет вес пропорционально', () => {
    const result = resolveSizes([flex(1), flex(3)], 800, 0);
    expect(result.spans.map((s) => s.length)).toEqual([200, 600]);
  });

  it('сообщает о переопределённом делении, а не молча ломает раскладку', () => {
    const result = resolveSizes([fixed(600), fixed(600)], 1000, 16);
    expect(result.overconstrained).toBe(true);
    expect(result.rest).toBeLessThan(0);
  });

  it('ИНВАРИАНТ: сумма ячеек и разделителей равна доступной длине', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 6000, noNaN: true }),
        fc.integer({ min: 2, max: 8 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (rawAvailable, count, rawThickness) => {
          // Значения произвольные, в том числе не лежащие на доменной сетке:
          // resolveSizes обязана нормализовать вход сама.
          const available = roundMm(rawAvailable);
          const thickness = roundMm(rawThickness);
          const sizes = Array.from({ length: count }, () => flex(1));
          const result = resolveSizes(sizes, rawAvailable, rawThickness);

          // Инвариант формулируется для выполнимой раскладки. Когда одни только
          // разделители не помещаются в доступную длину, сумма сойтись не может —
          // это отдельный случай, и он проверяется следующим тестом.
          fc.pre(!result.overconstrained);

          const total = sumMm([
            ...result.spans.map((s) => s.length),
            ...Array.from({ length: count - 1 }, () => thickness),
          ]);
          expect(Math.abs(total - available)).toBeLessThanOrEqual(MM_EPSILON);
        },
      ),
    );
  });

  it('ИНВАРИАНТ: невыполнимая раскладка помечается, а не выдаётся за верную', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 6000, noNaN: true }),
        fc.integer({ min: 2, max: 8 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (available, count, thickness) => {
          const result = resolveSizes(
            Array.from({ length: count }, () => flex(1)),
            available,
            thickness,
          );
          // Разделители не помещаются ⇒ признак обязан быть выставлен,
          // а размеры ячеек не должны уходить в минус.
          const dividersFit = roundMm(thickness) * (count - 1) <= roundMm(available);
          expect(result.overconstrained).toBe(!dividersFit);
          for (const span of result.spans) expect(span.length).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('ИНВАРИАНТ: ячейки идут подряд без наложений и разрывов', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 200, max: 4000, noNaN: true }),
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 2, maxLength: 6 }),
        (available, weights) => {
          const thickness = 16;
          const { spans } = resolveSizes(
            weights.map((w) => flex(w)),
            available,
            thickness,
          );
          for (let i = 1; i < spans.length; i += 1) {
            const prev = spans[i - 1];
            const cur = spans[i];
            if (prev === undefined || cur === undefined) continue;
            expect(Math.abs(cur.offset - (prev.offset + prev.length + thickness))).toBeLessThanOrEqual(
              MM_EPSILON,
            );
          }
        },
      ),
    );
  });
});
