import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseB3d } from '../../../scripts/research/b3d-parse.mjs';
import { buildObjects } from '../../../scripts/research/b3d-objects.mjs';

/**
 * Проверки исследовательского парсера .b3d (PROMPT 66 §12).
 *
 * ## Почему тут синтетический файл, а не приложенный
 *
 * Приложенный .b3d — проектный файл заказчика из сервиса-референса.
 * Класть его в репозиторий нельзя (`docs/BRAND_INDEPENDENCE_AUDIT.md`:
 * чужие исходники и данные не копируются). Поэтому формат проверяется на
 * файле, собранном здесь же по восстановленному описанию: если разбор
 * сломается, тест это поймает, а проприетарных данных в репозитории не
 * появится.
 *
 * Факты, извлечённые из настоящего файла, проверяются дополнительно —
 * но только если путь к нему передан через `B3D_FIXTURE`. Без переменной
 * эти проверки пропускаются: тест не притворяется, что видел данные.
 */

/** Сборка файла в восстановленном формате: таблица ключей + поток записей. */
function synthetic(): string {
  const keys = ['X', 'Y', 'Z', 'Rw', 'Rx', 'Ry', 'Rz', 'ID', 'Name', 'Type'];
  const head: Buffer[] = [];
  const count = Buffer.alloc(8);
  count.writeUInt32LE(keys.length, 0);
  head.push(count);
  for (const k of keys) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(k.length, 0);
    head.push(len, Buffer.from(k, 'latin1'));
  }

  const rec = (key: number, tag: number, type: number, payload: Buffer): Buffer => {
    const h = Buffer.alloc(9);
    h.writeUInt32LE(key, 0);
    h.writeUInt32LE(tag, 4);
    h.writeUInt8(type, 8);
    return Buffer.concat([h, payload]);
  };
  const f64 = (v: number): Buffer => { const b = Buffer.alloc(8); b.writeDoubleLE(v, 0); return b; };
  const i32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };
  const str = (v: string): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v.length, 0);
    return Buffer.concat([b, Buffer.from(v, 'utf16le')]);
  };

  const body = Buffer.concat([
    rec(1, 7, 0x00, Buffer.alloc(0)),        // маркер узла
    rec(10, 0, 0x04, i32(4002)),             // Type
    rec(9, 0, 0x06, str('полка')),           // Name
    rec(8, 0, 0x04, i32(42)),                // ID
    rec(1, 7, 0x00, Buffer.alloc(0)),        // маркер преобразования
    rec(1, 0, 0x05, f64(16)),                // X
    rec(2, 0, 0x05, f64(432)),               // Y
    rec(3, 0, 0x05, f64(3)),                 // Z
    rec(4, 0, 0x05, f64(0.7071067811865476)),// Rw
    rec(5, 0, 0x05, f64(0.7071067811865475)),// Rx
    rec(6, 0, 0x05, f64(0)),                 // Ry
    rec(7, 0, 0x05, f64(0)),                 // Rz
  ]);

  const payload = Buffer.concat([...head, body]);
  const file = Buffer.concat([Buffer.from('BZ85\x01\x00\x00\xff', 'latin1'), deflateSync(payload)]);
  const dir = mkdtempSync(join(tmpdir(), 'b3d-'));
  const path = join(dir, 'synthetic.b3d');
  writeFileSync(path, file);
  return path;
}

describe('формат .b3d восстановлен корректно', () => {
  const path = synthetic();

  it('zlib-поток находится сканированием сигнатуры, а не жёстким смещением', () => {
    const res = parseB3d(path);
    // В настоящем файле поток начинался с 531; в синтетическом — с 8.
    // Парсер не знает ни того, ни другого заранее.
    expect(res.offset).toBeGreaterThan(0);
    expect(res.reason).toBe('конец потока');
  });

  it('таблица ключей читается как u32-длина + ASCII', () => {
    const res = parseB3d(path);
    expect(res.keys).toContain('Name');
    expect(res.keys).toContain('Rw');
  });

  it('строки читаются как UTF-16LE с длиной В СИМВОЛАХ', () => {
    const res = parseB3d(path);
    const named = res.nodes.flatMap((n) =>
      typeof n.fields['Name'] === 'string' ? [n.fields['Name']] : []);
    // Длина в символах, а не в байтах: иначе кириллица обрежется вдвое.
    expect(named).toContain('полка');
  });

  it('f64 читается без потери точности — на кватернионе это видно сразу', () => {
    const res = parseB3d(path);
    const rot = res.nodes.find((n) => 'Rw' in n.fields);
    expect(rot?.fields['Rw']).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it('объекты собираются из заголовка и следующего за ним преобразования', () => {
    const { panels } = buildObjects(path);
    expect(panels).toHaveLength(1);
    expect(panels[0]?.name).toBe('полка');
    expect(panels[0]?.x).toBe(16);
    expect(panels[0]?.y).toBe(432);
  });
});

/**
 * Проверки по настоящему файлу. Запускаются только при заданном
 * `B3D_FIXTURE` — иначе пропускаются, а не «проходят».
 */
const fixture = process.env['B3D_FIXTURE'];
const real = fixture !== undefined && fixture !== '' && existsSync(fixture);

describe.skipIf(!real)('факты, извлечённые из настоящего .b3d', () => {
  it('количества фурнитуры совпадают с деталировкой заказа', () => {
    const { hardware } = buildObjects(fixture ?? '');
    const count = (needle: string): number =>
      hardware.filter((h) => h.name.includes(needle)).length;
    expect(count('Гвоздь толевый')).toBe(125);
    expect(count('Скрепка-крабик')).toBe(32);
    expect(count('Рафикс, белый')).toBe(48);
    expect(count('Минификс D15')).toBe(40);
    expect(count('Винт-конфирмат')).toBe(28);
  });

  it('деталей ровно столько, сколько строк в деталировке', () => {
    const { panels } = buildObjects(fixture ?? '');
    expect(panels).toHaveLength(46);
  });

  /**
   * Ключевой факт для PM-17 и PM-18: файл ставит в пространство ТОЛЬКО
   * те элементы, под которые сверлится отверстие. Сопутствующие
   * (заглушки, дюбель минификса, крабики) он лишь СЧИТАЕТ, оставляя их
   * в позиции-заглушке (−100, −100, −100).
   */
  it('сопутствующие элементы посчитаны, но не размещены', () => {
    const { hardware } = buildObjects(fixture ?? '');
    const at = (needle: string, placed: boolean): number =>
      hardware.filter((h) => h.name.includes(needle) && (placed ? h.x !== -100 : h.x === -100)).length;

    // Размещены: то, что имеет собственное отверстие.
    expect(at('Рафикс, белый', true)).toBe(48);
    expect(at('Минификс D15', true)).toBe(40);
    expect(at('Винт-конфирмат', true)).toBe(28);

    // Не размещены: заглушки, дюбель минификса, крабики.
    expect(at('Заглушка для минификса', false)).toBe(40);
    expect(at('Минификс шток(дюбель)', false)).toBe(40);
    expect(at('Заглушка для винта-конфирмата', false)).toBe(28);
    expect(at('Скрепка-крабик', false)).toBe(32);

    // Гвозди: 120 поставлены, 5 нет.
    expect(at('Гвоздь толевый', true)).toBe(120);
    expect(at('Гвоздь толевый', false)).toBe(5);
  });

  /** §8A: гвозди распределены поровну — по 24 на каждую из пяти панелей. */
  it('размещённые гвозди распределены по 24 на панель задней стенки', () => {
    const { hardware } = buildObjects(fixture ?? '');
    const nails = hardware.filter((h) => h.name.includes('Гвоздь толевый') && h.x !== -100);
    const rows = new Map<number, number>();
    for (const n of nails) {
      // Панели идут полосами по Y; границы взяты из восстановленных коробок.
      const band = [424, 841, 1258, 1675].findIndex((edge) => n.y < edge);
      const key = band === -1 ? 4 : band;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    expect([...rows.values()].sort()).toEqual([24, 24, 24, 24, 24]);
  });
});
