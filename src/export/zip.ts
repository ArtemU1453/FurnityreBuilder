/**
 * Минимальный ZIP-архиватор (PROMPT 20 §9).
 *
 * ## Почему свой, а не библиотека
 *
 * XLSX — это ZIP из нескольких XML-файлов. Всё, что нужно для его записи:
 * контейнер без сжатия (метод STORE) и CRC32. Это полторы сотни строк, и
 * они дают то, чего готовая библиотека не даёт даром, — ПОЛНЫЙ КОНТРОЛЬ
 * НАД ДЕТЕРМИНИЗМОМ: ни отметки времени, ни версии упаковщика, ни порядка
 * записей, зависящего от хеш-таблицы. Один и тот же проект даёт побайтово
 * один и тот же файл (§13).
 *
 * Даты записей зафиксированы на начале эпохи DOS (1 января 1980) по той же
 * причине. Файлы внутри архива от этого не страдают: XLSX своих дат не
 * требует.
 *
 * Отсутствие сжатия делает файл крупнее исходного XML примерно на
 * величину заголовков; для документа деталировки это десятки килобайт, и
 * платить за них зависимостью с транзитивным деревом не стоит.
 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

export interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

/** 1 января 1980 года: нулевая точка формата и наш способ не хранить время. */
const DOS_DATE = 0x00_21;
const DOS_TIME = 0x00_00;
/** Бит 11 — имена и комментарии в UTF-8. */
const FLAG_UTF8 = 0x08_00;

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]));
  }

  get offset(): number {
    return this.length;
  }

  toBytes(): Uint8Array {
    const result = new Uint8Array(this.length);
    let position = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, position);
      position += chunk.length;
    }
    return result;
  }
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const writer = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const offset = writer.offset;

    writer.u32(0x04_03_4b_50);
    writer.u16(20);
    writer.u16(FLAG_UTF8);
    writer.u16(0); // STORE
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.push(name);
    writer.push(entry.data);

    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralOffset = writer.offset;
  for (const item of central) {
    writer.u32(0x02_01_4b_50);
    writer.u16(20);
    writer.u16(20);
    writer.u16(FLAG_UTF8);
    writer.u16(0);
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(item.crc);
    writer.u32(item.size);
    writer.u32(item.size);
    writer.u16(item.name.length);
    writer.u16(0); // extra
    writer.u16(0); // comment
    writer.u16(0); // disk
    writer.u16(0); // internal attributes
    writer.u32(0); // external attributes
    writer.u32(item.offset);
    writer.push(item.name);
  }
  const centralSize = writer.offset - centralOffset;

  writer.u32(0x06_05_4b_50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralOffset);
  writer.u16(0);

  return writer.toBytes();
}
