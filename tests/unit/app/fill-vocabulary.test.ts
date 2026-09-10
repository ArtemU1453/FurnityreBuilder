import { describe, expect, it } from 'vitest';
import {
  FILL_BUILDS,
  FILL_HINTS,
  FILL_LABELS,
  FILL_OPTIONS,
  PART_WORDS,
  UI_FILL_KINDS,
} from '../../../src/app/editor/fill-vocabulary.js';
import { emptyProject, geometryOf, productionOf, run } from '../integration/fixtures.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import { createDrawersLeaf, createShelvesLeaf } from '../../../src/domain/furniture/defaults.js';
import type { LeafFill, PartRole, Project, SectionNode } from '../../../src/domain/index.js';

/**
 * Подпись в интерфейсе не расходится с тем, что строит движок
 * (PROMPT 34 §10, дефект Г-001).
 *
 * Это не проверка текста ради текста. Подпись у ящиков утверждала «Ящик
 * добавляет короб и фасад», а короб геометрией не строится: его размеры
 * зависят от типа направляющих, и правило не подтверждено (`T-DRW-05`).
 * Человек читал обещание детали, которой в деталировке не появится, — и
 * узнавал об этом уже на производстве.
 *
 * Проверка устроена так, чтобы ловить ЛЮБОЕ такое расхождение, а не одно
 * известное: для каждого вида наполнения строится настоящая геометрия, и
 * набор ролей сверяется с тем, что обещает подпись.
 */

const ids = () => createSequentialIdFactory('fv');

/** Изделие, у которого единственная ячейка имеет заданное наполнение. */
function projectWithFill(make: (factory: ReturnType<typeof ids>) => SectionNode): Project {
  const factory = ids();
  const root = make(factory);
  const base = emptyProject('fv');
  return run(base, [{ type: 'SetRoot', furnitureIndex: 0, root }]);
}

/** Роли деталей, появившиеся ИМЕННО от наполнения, а не от корпуса. */
function rolesFromFill(project: Project): ReadonlySet<PartRole> {
  const carcass = new Set<PartRole>(['side', 'top', 'bottom', 'partition', 'back', 'plinth']);
  const roles = geometryOf(project).parts.map((part) => part.role);
  return new Set(roles.filter((role) => !carcass.has(role)));
}

const BUILDERS: Readonly<Record<(typeof UI_FILL_KINDS)[number], () => Project>> = {
  empty: () => emptyProject('fv'),
  shelves: () => projectWithFill((factory) => createShelvesLeaf(factory, 2, 'adjustable')),
  drawers: () => projectWithFill((factory) => createDrawersLeaf(factory, 3)),
};

describe('словарь наполнения полон и согласован', () => {
  it('у каждого вида модели есть подпись и пояснение', () => {
    const kinds: LeafFill['kind'][] = ['empty', 'shelves', 'drawers', 'rod', 'rod+shelf'];
    for (const kind of kinds) {
      expect(FILL_LABELS[kind], kind).toBeTruthy();
      expect(FILL_HINTS[kind], kind).toBeTruthy();
    }
  });

  it('в интерфейсе предлагается только то, что движок строит', () => {
    // `rod` и `rod+shelf` движок помечает not-implemented — предлагать их
    // значило бы обещать пункт, который ничего не делает.
    expect([...UI_FILL_KINDS]).toEqual(['empty', 'shelves', 'drawers']);
    expect(FILL_OPTIONS.map((option) => option.value)).toEqual([...UI_FILL_KINDS]);
  });

  it('у видов, которых нет в интерфейсе, пояснение прямо говорит об этом', () => {
    for (const kind of ['rod', 'rod+shelf'] as const) {
      expect(FILL_HINTS[kind]).toMatch(/не строится|не строятся/);
    }
  });
});

describe('обещанное совпадает с построенным', () => {
  for (const kind of UI_FILL_KINDS) {
    it(`«${FILL_LABELS[kind]}»: движок строит ровно заявленные роли`, () => {
      expect([...rolesFromFill(BUILDERS[kind]())].sort()).toEqual([...FILL_BUILDS[kind]].sort());
    });
  }

  it('ящик даёт фасад и НЕ даёт короб: правило размеров короба не подтверждено', () => {
    const roles = rolesFromFill(BUILDERS.drawers());
    expect(roles.has('facade')).toBe(true);
    for (const boxRole of ['drawer-side', 'drawer-back', 'drawer-bottom'] as const) {
      expect(roles.has(boxRole), boxRole).toBe(false);
    }
  });
});

describe('подпись не называет деталь, которой не будет', () => {
  for (const kind of UI_FILL_KINDS) {
    it(`«${FILL_LABELS[kind]}»: каждое названное изделие либо строится, либо оговорено`, () => {
      const hint = FILL_HINTS[kind].toLowerCase();
      const built = new Set(FILL_BUILDS[kind]);

      for (const [word, role] of Object.entries(PART_WORDS)) {
        if (!hint.includes(word)) continue;
        if (built.has(role)) continue;
        // Деталь названа, но не строится — подпись обязана сказать это
        // прямо, а не умолчать.
        expect(
          /не стро|пока не|не подтвержд/.test(hint),
          `подпись «${kind}» называет «${word}», деталь не строится и оговорки нет`,
        ).toBe(true);
      }
    });
  }

  it('регрессия: прежняя подпись у ящиков эту проверку не проходила', () => {
    const wasWrong = 'Ящик добавляет короб и фасад. Дверь на ячейку с ящиками поставить нельзя.';
    const hint = wasWrong.toLowerCase();
    expect(hint).toContain('короб');
    // Короб назван, не строится, оговорки нет — ровно то, что ловит
    // проверка выше.
    expect(/не стро|пока не|не подтвержд/.test(hint)).toBe(false);
  });
});

describe('ящик доходит до производства', () => {
  it('фасад ящика попадает в деталировку, направляющие — в фурнитуру', () => {
    const production = productionOf(BUILDERS.drawers());
    expect(production.bom.parts.length).toBeGreaterThan(0);
    const slides = production.hardware.items.filter((item) => item.kind === 'slide');
    expect(slides.length).toBeGreaterThan(0);
  });
});
