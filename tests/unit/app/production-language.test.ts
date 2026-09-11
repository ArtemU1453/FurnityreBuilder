import { describe, expect, it } from 'vitest';
import {
  EDGE_SIDE_LABELS,
  GRAIN_LABELS,
  HARDWARE_KIND_LABELS,
  HARDWARE_UNIT_LABELS,
  PART_ROLE_LABELS,
  edgeBandingText,
  grainLabel,
  hardwareKindLabel,
  hardwareUnitLabel,
} from '../../../src/domain/vocabulary.js';
import { PRODUCTION_PART_TYPE_LABELS, productionPartTypeLabel } from '../../../src/production/index.js';
import { PART_CATEGORY_LABELS, partCategoryLabel } from '../../../src/bom/index.js';
import { NO_EDGE, formatMm } from '../../../src/domain/index.js';

/**
 * Граница представления производственного результата (PROMPT 62 §11, §15).
 *
 * ## Что здесь сторожится
 *
 * `FR-19`: деталировка печатала `back`, `facade`, `partition`, кромку —
 * `front 2, left 0.4`, текстуру — `none`, фурнитуру — `hw-shelf-support`
 * и `pcs`. Числа были верны, язык — машинный, и то же самое уходило в
 * PDF и XLSX.
 *
 * ## Принцип регрессии
 *
 * Новое доменное значение без человеческого слова не должно молча
 * появиться сырым текстом. Основную часть этого держат ТИПЫ:
 * `Record<Enum, string>` не соберётся без нового слова. Тесты ниже
 * проверяют то, чего тип проверить не может, — что слово не пустое, не
 * латинское и не совпадает с машинным значением.
 */

/** Что считается утечкой языка движка. */
const LEAK = /[A-Za-z]/;

/** Отраслевые обозначения, которые по-русски так и пишут. */
const INDUSTRY_TERMS = new Set(['push-to-open', 'push-механизм']);

function expectHuman(label: string, source: string): void {
  expect(label, `«${source}» без слова`).not.toBe('');
  // `push-to-open` — отраслевое обозначение, которое по-русски так и
  // пишут: подпись, совпадающая со значением, здесь верна, а не ленива.
  if (INDUSTRY_TERMS.has(label)) return;
  expect(label, `«${source}» подписано собой же`).not.toBe(source);
  expect(label, `«${source}» → «${label}»: латиница`).not.toMatch(LEAK);
}

describe('роли деталей (§5)', () => {
  it('каждая роль названа по-человечески', () => {
    for (const [role, label] of Object.entries(PART_ROLE_LABELS)) expectHuman(label, role);
  });

  it('ровно те значения, что видел FR-19, больше не могут быть подписью', () => {
    for (const raw of ['back', 'bottom', 'facade', 'partition', 'side', 'top']) {
      expect(Object.values(PART_ROLE_LABELS)).not.toContain(raw);
    }
  });
});

describe('типы производственных деталей (§5)', () => {
  it('каждый тип назван по-человечески', () => {
    for (const [type, label] of Object.entries(PRODUCTION_PART_TYPE_LABELS)) {
      expectHuman(label, type);
    }
  });

  it('сырые значения деталировки переведены поимённо', () => {
    expect(productionPartTypeLabel('back')).toBe('Задняя стенка');
    expect(productionPartTypeLabel('side')).toBe('Боковина');
    expect(productionPartTypeLabel('partition')).toBe('Перегородка');
    expect(productionPartTypeLabel('facade')).toBe('Фасад');
    expect(productionPartTypeLabel('shelf')).toBe('Полка');
  });
});

describe('разделы спецификации (§5)', () => {
  it('каждый раздел назван по-человечески', () => {
    for (const [category, label] of Object.entries(PART_CATEGORY_LABELS)) {
      expectHuman(label, category);
    }
  });

  it('`carcass` и `back-wall` больше не подпись', () => {
    expect(partCategoryLabel('carcass')).toBe('Корпус');
    expect(partCategoryLabel('back-wall')).toBe('Задняя стенка');
  });
});

describe('фурнитура (§8)', () => {
  it('каждый вид назван по-человечески', () => {
    for (const [kind, label] of Object.entries(HARDWARE_KIND_LABELS)) expectHuman(label, kind);
  });

  it('каждая единица измерения названа по-человечески', () => {
    for (const [unit, label] of Object.entries(HARDWARE_UNIT_LABELS)) expectHuman(label, unit);
    expect(hardwareUnitLabel('pcs')).toBe('шт');
  });

  it('внутренние ключи реестра подписью не являются', () => {
    const labels = Object.values(HARDWARE_KIND_LABELS);
    for (const key of ['hw-hinge', 'hw-back-fastener', 'hw-shelf-support', 'hw-carcass-fastener']) {
      expect(labels).not.toContain(key);
    }
    expect(hardwareKindLabel('shelf-support')).toBe('полкодержатель');
    expect(hardwareKindLabel('hinge')).toBe('петля');
  });
});

describe('кромка (§6)', () => {
  it('каждая сторона названа по-человечески', () => {
    for (const [side, label] of Object.entries(EDGE_SIDE_LABELS)) expectHuman(label, side);
  });

  it('строка кромки называет сторону и толщину, а не поле модели', () => {
    const text = edgeBandingText({ ...NO_EDGE, front: 2, left: 0.4, right: 0.4 }, formatMm);
    expect(text).toBe('спереди 2, слева 0.4, справа 0.4');
    expect(text).not.toMatch(LEAK);
  });

  it('отсутствие кромки названо словами, а не пустой строкой и не нулями', () => {
    const text = edgeBandingText(NO_EDGE, formatMm);
    expect(text).toBe('без кромки');
    expect(text).not.toBe('');
    expect(text).not.toBe('0/0/0/0');
  });

  it('стороны без кромки в строку не попадают', () => {
    expect(edgeBandingText({ ...NO_EDGE, front: 2 }, formatMm)).toBe('спереди 2');
  });
});

describe('текстура (§7)', () => {
  it('каждое направление названо по-человечески', () => {
    for (const [grain, label] of Object.entries(GRAIN_LABELS)) expectHuman(label, grain);
  });

  /**
   * Смысл `none` прослежен до места, где значение работает:
   * `rotationAllowedFor` разрешает поворот детали ровно при
   * `grain === 'none'`. Это свойство материала, а не «не задано».
   */
  it('«none» названо своим смыслом, а не отсутствием значения', () => {
    expect(grainLabel('none')).toBe('без направления');
    expect(grainLabel('none')).not.toBe('none');
    expect(grainLabel('none')).not.toBe('не задана');
    expect(grainLabel('along-length')).toBe('вдоль длины');
  });
});

describe('один словарь на всё приложение (§4, §12)', () => {
  it('словарь интерфейса — тот же объект, что доменный', async () => {
    const app = await import('../../../src/app/vocabulary.js');
    expect(app.PART_ROLE_LABELS).toBe(PART_ROLE_LABELS);
    expect(app.HARDWARE_KIND_LABELS).toBe(HARDWARE_KIND_LABELS);
    expect(app.GRAIN_LABELS).toBe(GRAIN_LABELS);
  });

  it('второго словаря видов фурнитуры в слое экспорта не осталось', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/export/data.ts', 'utf8');
    expect(source).not.toMatch(/const PURPOSE_LABELS/);
    const drawing = readFileSync('src/export/part-drawing.ts', 'utf8');
    expect(drawing).not.toMatch(/const EDGE_LABELS/);
    expect(drawing).not.toMatch(/const GRAIN_LABELS/);
  });
});
