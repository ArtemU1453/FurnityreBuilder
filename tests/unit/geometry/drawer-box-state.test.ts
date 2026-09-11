import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../../../src/geometry/engine.js';
import { createDrawersLeaf, DEFAULT_DRAWER_BOX, DEFAULT_SLIDE } from '../../../src/domain/furniture/defaults.js';
import { makeGeometryInputWithRoot } from './helpers.js';
import type { IdFactory, SectionNode } from '../../../src/domain/index.js';

/**
 * FR-04 — ЗАФИКСИРОВАННОЕ состояние короба ящика (PROMPT 65).
 *
 * ## Зачем этот файл
 *
 * PROMPT 65 исследовал конструкцию ящика и выбрал OUTCOME C: короб НЕ
 * строится, потому что из восьми величин, нужных для его раскроя,
 * источником подтверждены две (`docs/FR04_DRAWER_MODEL_ANALYSIS.md`).
 *
 * Такое состояние легко потерять двумя противоположными способами:
 * кто-нибудь «на всякий случай» построит короб выдуманными числами, или
 * кто-нибудь уберёт диагностику, потому что она «портит статус». Этот
 * файл сторожит и то и другое: он утверждает, что короба нет И что
 * приложение об этом говорит вслух.
 *
 * Тест НЕ защищает отсутствие функции как таковое. Он защищает
 * ЧЕСТНОСТЬ: пока конструкция не подтверждена, результат обязан
 * признаваться неполным. Когда появится монтажная инструкция
 * направляющей (`T-DRW-07`), этот файл переписывается на новое
 * поведение — с теми же двумя требованиями: детали настоящие,
 * умолчания не выдуманы.
 */

const DIMS = { width: 900, height: 2000, depth: 600, panelThickness: 16 } as const;

function oneDrawer(ids: IdFactory): SectionNode {
  return {
    id: ids.next<'Node'>(),
    kind: 'split',
    axis: 'x',
    divider: { material: 'panel', thickness: 16, mounting: 'fixed', frontSetback: 0 },
    children: [{ size: { mode: 'flex', weight: 1 }, node: createDrawersLeaf(ids, 1) }],
  };
}

describe('боковой зазор направляющей подтверждён источником', () => {
  /**
   * 12.7 мм — толщина самой боковой шариковой направляющей, а не
   * округление: Hettich печатает её в наименовании изделия («KA 5632 …
   * dimensions (H × W) 46 × 12.7 mm»), Accuride для серии 3832 требует
   * 0.5″ с каждой стороны. До PROMPT 65 здесь стояло 13 — на 0.3 мм
   * больше, что дало бы короб на 0.6 мм уже нужного.
   */
  it('короб уже проёма ровно на 25.4 мм — по 12.7 на сторону', () => {
    expect(DEFAULT_SLIDE.sideClearance).toBe(12.7);
    expect(DEFAULT_SLIDE.sideClearance * 2).toBeCloseTo(25.4, 10);
  });

  it('тип направляющей по умолчанию — боковая шариковая полного выдвижения', () => {
    // Именно к ней относится подтверждённые 12.7: у скрытых
    // направляющих (`hidden-soft-close`) своя, другая геометрия короба.
    expect(DEFAULT_SLIDE.type).toBe('ball-full');
  });
});

describe('короб ящика не строится, и это сказано вслух', () => {
  it('ящик даёт только фасад: ни боковин, ни дна, ни задней стенки короба', () => {
    const result = buildGeometry(makeGeometryInputWithRoot(oneDrawer, DIMS));
    const boxRoles = result.parts.filter((part) =>
      part.role === 'drawer-side' || part.role === 'drawer-back' || part.role === 'drawer-bottom',
    );
    expect(boxRoles).toHaveLength(0);
    // Фасад при этом есть — иначе проверялось бы просто пустое изделие.
    expect(result.parts.some((part) => part.label.startsWith('Фасад ящика'))).toBe(true);
  });

  it('результат сообщает о неполноте, а не молчит', () => {
    const result = buildGeometry(makeGeometryInputWithRoot(oneDrawer, DIMS));
    const report = result.diagnostics.find((d) => d.code === 'DRAWER_BOX_NOT_IMPLEMENTED');
    expect(report).toBeDefined();
    // Не ошибка: незаданная конструкция — не поломка пользовательских
    // данных. Но и не тишина.
    expect(report?.severity).toBe('info');
  });

  it('умолчания короба хранятся, но ничего не выдумывают в раскрое', () => {
    // Поля существуют и переживают сериализацию (PROMPT 11), однако
    // геометрия их не читает — проверяется именно это следствие, а не
    // сам факт чтения: ни одна деталь не получила размер из `sideHeight`.
    const result = buildGeometry(makeGeometryInputWithRoot(oneDrawer, DIMS));
    const sizes = result.parts.flatMap((part) => [part.size.x, part.size.y, part.size.z]);
    expect(sizes).not.toContain(DEFAULT_DRAWER_BOX.sideHeight);
    expect(sizes).not.toContain(DEFAULT_DRAWER_BOX.bottom.thickness);
  });
});
