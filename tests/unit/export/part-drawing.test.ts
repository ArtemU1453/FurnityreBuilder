import { describe, expect, it } from 'vitest';
import {
  buildPartDrawing,
  buildPartDrawings,
  operationsOfItem,
} from '../../../src/export/index.js';
import type { PartBOMItem } from '../../../src/bom/index.js';
import type { DrillingOperation } from '../../../src/drilling/index.js';
import type { NodeId, PartId } from '../../../src/domain/index.js';

/**
 * Модель технического чертежа (PROMPT 29 §10–§14).
 *
 * Проверяется не «функция что-то вернула», а свойства, которыми чертёж
 * отличается от картинки: он показывает то, что посчитано, ничего не
 * придумывает и раскладывает отверстия по граням правильно.
 */

const item = (overrides: Partial<PartBOMItem> = {}): PartBOMItem => ({
  id: 'bom:side',
  productionPartIds: ['pp:side'],
  name: 'Боковина',
  partType: 'side',
  category: 'carcass',
  materialId: 'm-1' as PartBOMItem['materialId'],
  materialName: 'Корпусная плита 16 мм',
  materialKind: 'chipboard',
  thickness: 16,
  length: 2000,
  width: 500,
  quantity: 2,
  grainDirection: 'along-length',
  edgeBanding: { front: 2, back: 0, left: 0.4, right: 0.4 },
  sourcePartIds: ['part-1' as PartId],
  sourceNodeIds: ['node-1' as NodeId],
  ...overrides,
});

const hole = (overrides: Partial<DrillingOperation> = {}): DrillingOperation => ({
  id: 'op-1',
  productionPartId: 'pp:side',
  sourcePartId: 'part-1' as PartId,
  purpose: 'shelf-support',
  face: 'top',
  x: 37,
  y: 50,
  diameter: 5,
  depth: 12,
  through: 'blind',
  ruleId: 'shelf-support/system-32',
  reason: 'полкодержатель съёмной полки',
  ...overrides,
});

describe('чертёж детали', () => {
  it('габарит и материал берутся из позиции деталировки, а не считаются заново', () => {
    const view = buildPartDrawing(item(), []);
    expect(view.length).toBe(2000);
    expect(view.width).toBe(500);
    expect(view.thickness).toBe(16);
    expect(view.quantity).toBe(2);
    expect(view.materialName).toBe('Корпусная плита 16 мм');
  });

  it('на контур попадают отверстия пласти, а торцевые выносятся отдельно', () => {
    // Пласти в этой модели — top/bottom: у них координаты идут по длине
    // и ширине. У front/back вторая координата — толщина, и нарисовать
    // такое отверстие на пласти нельзя, не соврав.
    const view = buildPartDrawing(item(), [
      hole({ id: 'flat-1', face: 'top' }),
      hole({ id: 'flat-2', face: 'bottom' }),
      hole({ id: 'edge-1', face: 'front' }),
      hole({ id: 'edge-2', face: 'left' }),
    ]);
    expect(view.holes.map((h) => h.id)).toEqual(['flat-1', 'flat-2']);
    expect(view.edgeHoles.map((h) => h.id)).toEqual(['edge-1', 'edge-2']);
    expect(view.edgeHoles[0]?.faceLabel).toBe('торец спереди');
  });

  it('координаты отверстия не пересчитываются', () => {
    const view = buildPartDrawing(item(), [hole({ x: 37, y: 128 })]);
    expect(view.holes[0]?.x).toBe(37);
    expect(view.holes[0]?.y).toBe(128);
  });

  it('правило и причина доходят до чертежа: без них отверстие непрослеживаемо', () => {
    const view = buildPartDrawing(item(), [hole()]);
    expect(view.holes[0]?.ruleId).toBe('shelf-support/system-32');
    expect(view.holes[0]?.reason).toBe('полкодержатель съёмной полки');
    expect(view.holes[0]?.productionPartId).toBe('pp:side');
  });

  it('кромка показывается только там, где она есть', () => {
    const view = buildPartDrawing(item(), []);
    expect(view.edges.map((e) => e.side)).toEqual(['front', 'left', 'right']);
    expect(view.edges.find((e) => e.side === 'front')?.thickness).toBe(2);
  });

  it('размеров ровно столько, сколько есть что мерить', () => {
    const empty = buildPartDrawing(item(), []);
    // Только габариты: мерить до несуществующих отверстий нечего.
    expect(empty.dimensions.map((d) => d.kind)).toEqual(['length', 'width']);

    const withHoles = buildPartDrawing(item(), [hole({ id: 'a' }), hole({ id: 'b', x: 900 })]);
    expect(withHoles.dimensions.filter((d) => d.kind === 'hole-x')).toHaveLength(2);
    expect(withHoles.dimensions.filter((d) => d.kind === 'hole-y')).toHaveLength(2);
  });

  it('текстура называется словами, а её отсутствие не выдаётся за направление', () => {
    expect(buildPartDrawing(item(), []).grainLabel).toBe('вдоль длины');
    expect(buildPartDrawing(item({ grainDirection: 'none' }), []).grainLabel).toBeUndefined();
  });

  it('описание — те же данные словами, а не подпись «схема детали»', () => {
    const view = buildPartDrawing(item(), [hole()]);
    expect(view.description).toContain('2000');
    expect(view.description).toContain('Корпусная плита 16 мм');
    expect(view.description).toContain('вдоль длины');
    expect(view.description).toContain('X 37');
  });

  it('чертёж без отверстий честно говорит, что их не рассчитано', () => {
    expect(buildPartDrawing(item(), []).description).toContain('Отверстий не рассчитано');
  });

  it('чертёж детерминирован: одни и те же данные дают один и тот же результат', () => {
    const first = buildPartDrawing(item(), [hole()]);
    const second = buildPartDrawing(item(), [hole()]);
    expect(second).toEqual(first);
  });
});

describe('поиск операций позиции', () => {
  it('операции ищутся по производственным деталям, а не по идентификатору позиции', () => {
    // `bom:…` и `pp:…` — разные сущности. До PROMPT 29 поиск шёл по
    // `item.id` и не находил НИЧЕГО: страницы чертежей в PDF не
    // появлялись вовсе, потому что фильтр «есть отверстия» не пропускал
    // ни одной позиции.
    const map = new Map<string, readonly DrillingOperation[]>([['pp:side', [hole()]]]);
    expect(operationsOfItem(item(), map)).toHaveLength(1);
    expect(map.get('bom:side')).toBeUndefined();
  });

  it('позиция из нескольких производственных деталей собирает операции всех', () => {
    // Так бывает, когда деталировка свела в одну строку детали разных
    // ролей с одинаковыми производственными свойствами: у них совпадает
    // всё, кроме присадки.
    const map = new Map<string, readonly DrillingOperation[]>([
      ['pp:shelf-fixed', [hole({ id: 'a', productionPartId: 'pp:shelf-fixed' })]],
      ['pp:shelf-adjustable', [hole({ id: 'b', productionPartId: 'pp:shelf-adjustable' })]],
    ]);
    const view = buildPartDrawing(
      item({ productionPartIds: ['pp:shelf-fixed', 'pp:shelf-adjustable'] }),
      operationsOfItem(item({ productionPartIds: ['pp:shelf-fixed', 'pp:shelf-adjustable'] }), map),
    );
    // Ни одно отверстие не потеряно, и у каждого видно, чьё оно.
    expect(view.holes.map((h) => h.productionPartId)).toEqual([
      'pp:shelf-fixed',
      'pp:shelf-adjustable',
    ]);
  });

  it('чертежи строятся в порядке спецификации', () => {
    const items = [item({ id: 'bom:a', name: 'А' }), item({ id: 'bom:b', name: 'Б' })];
    const views = buildPartDrawings(items, new Map());
    expect(views.map((v) => v.name)).toEqual(['А', 'Б']);
  });
});
