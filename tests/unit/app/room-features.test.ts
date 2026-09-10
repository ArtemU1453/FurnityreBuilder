import { describe, expect, it } from 'vitest';
import {
  OBSTACLE_LABELS,
  OPENING_LABELS,
  obstacleSizeOf,
  openingDraftOf,
  openingFits,
  wallLabel,
  wallLength,
} from '../../../src/app/editor/room-features.js';
import { createRectangularRoom } from '../../../src/domain/room/defaults.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import type { ObstacleKind, OpeningKind, Room } from '../../../src/domain/index.js';

/**
 * Проёмы и препятствия: словарь и заготовки (PROMPT 33 §22, дефект Д-001).
 *
 * До этого этапа модель, команды, проверка и отрисовка проёмов
 * существовали, а формы не было: возможность оставалась недостижимой из
 * интерфейса. Здесь проверяется чистая часть формы — та, что решает, а не
 * рисует.
 */

function room(): Room {
  return createRectangularRoom({
    ids: createSequentialIdFactory('r'),
    width: 4000,
    depth: 3000,
    height: 2700,
  });
}

describe('словарь совпадает с моделью', () => {
  it('назван каждый вид проёма', () => {
    const kinds: OpeningKind[] = ['door', 'window', 'other'];
    for (const kind of kinds) expect(OPENING_LABELS[kind]).toBeTruthy();
    expect(Object.keys(OPENING_LABELS)).toHaveLength(kinds.length);
  });

  it('назван каждый вид препятствия', () => {
    const kinds: ObstacleKind[] = ['protrusion', 'column', 'pipe', 'radiator', 'other'];
    for (const kind of kinds) expect(OBSTACLE_LABELS[kind]).toBeTruthy();
    expect(Object.keys(OBSTACLE_LABELS)).toHaveLength(kinds.length);
  });
});

describe('заготовка проёма', () => {
  it('дверь и окно отличаются размерами, а не только названием', () => {
    const wall = room().walls[0];
    const door = openingDraftOf('door', wall);
    const window = openingDraftOf('window', wall);
    expect(door.sillHeight).toBe(0);
    expect(window.sillHeight).toBeGreaterThan(0);
    expect(door.height).not.toBe(window.height);
  });

  it('проём встаёт по середине стены, а не в угол', () => {
    const wall = room().walls[0]!;
    const draft = openingDraftOf('door', wall);
    const gapLeft = draft.position;
    const gapRight = wallLength(wall) - draft.position - draft.width;
    expect(Math.abs(gapLeft - gapRight)).toBeLessThanOrEqual(1);
  });

  it('ширина не превышает стену: проём шире стены невозможен, а не «почти верен»', () => {
    const narrow = { ...room().walls[0]!, b: { x: 600, z: 0 } };
    const draft = openingDraftOf('door', narrow);
    expect(draft.width).toBeLessThanOrEqual(wallLength(narrow));
    expect(draft.position).toBeGreaterThanOrEqual(0);
  });

  it('без выбранной стены заготовка не выдумывает положение', () => {
    expect(openingDraftOf('door', undefined).position).toBe(0);
  });
});

describe('проверка помещаемости', () => {
  const wall = room().walls[0]!;

  it('проём внутри стены проходит', () => {
    expect(openingFits(wall, 100, 900)).toBe(true);
  });

  it('проём, выходящий за конец стены, не проходит', () => {
    expect(openingFits(wall, wallLength(wall) - 100, 900)).toBe(false);
  });

  it('проём ровно по длине стены проходит: допуск доменный, не строгое равенство', () => {
    expect(openingFits(wall, 0, wallLength(wall))).toBe(true);
  });

  it('отрицательный отступ и нулевая ширина не проходят', () => {
    expect(openingFits(wall, -10, 900)).toBe(false);
    expect(openingFits(wall, 0, 0)).toBe(false);
  });

  it('без стены не проходит ничего: команда всё равно откажет', () => {
    expect(openingFits(undefined, 0, 900)).toBe(false);
  });
});

describe('препятствия', () => {
  it('у каждого вида свой размер, а не общий кубик', () => {
    const sizes = (['protrusion', 'column', 'pipe', 'radiator', 'other'] as const).map((kind) =>
      JSON.stringify(obstacleSizeOf(kind)),
    );
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('колонна и труба высокие, радиатор низкий: заготовка похожа на предмет', () => {
    expect(obstacleSizeOf('column').y).toBeGreaterThan(2000);
    expect(obstacleSizeOf('pipe').y).toBeGreaterThan(2000);
    expect(obstacleSizeOf('radiator').y).toBeLessThan(1000);
  });

  it('все размеры положительны', () => {
    for (const kind of ['protrusion', 'column', 'pipe', 'radiator', 'other'] as const) {
      const size = obstacleSizeOf(kind);
      expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(0);
    }
  });
});

describe('имя стены', () => {
  it('нумерация совпадает с порядком в модели — тем же, что в инспекторе', () => {
    const current = room();
    expect(wallLabel(current, current.walls[0]!.id)).toBe('Стена 1');
    expect(wallLabel(current, current.walls[2]!.id)).toBe('Стена 3');
  });

  it('чужой идентификатор не ломает подпись', () => {
    expect(wallLabel(room(), 'нет-такой' as never)).toBe('Стена');
  });
});
