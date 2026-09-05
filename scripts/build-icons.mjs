#!/usr/bin/env node
/**
 * Генератор иконок приложения (PROMPT 32 §13).
 *
 * ## Почему генератор, а не картинки «просто в репозитории»
 *
 * Иконка должна существовать в шести размерах и двух формах (обычная и
 * maskable). Нарисованные по отдельности, они разъезжаются при первой же
 * правке фирменного знака: кто-то поправит SVG, а PNG останутся
 * прежними. Здесь единственный источник — геометрия ниже, ровно та же,
 * что в `public/favicon.svg`.
 *
 * ## Почему собственный растеризатор, а не библиотека
 *
 * Продукт не тянет ни одной зависимости ради того, что делается тридцатью
 * строками. Фигуры здесь простые — скруглённый прямоугольник и несколько
 * толстых отрезков, — и считать их покрытие с четырёхкратной
 * суперсэмплинг-сеткой дешевле, чем добавлять `sharp` со сборкой под
 * платформу в зависимости проекта, который в остальном чист.
 *
 * ## Когда запускать
 *
 * Только при изменении фирменного знака: `node scripts/build-icons.mjs`.
 * Результат коммитится. В обычную сборку генератор не входит — иконки
 * лежат готовыми в `public/`, как и `favicon.svg`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Фирменный синий. Тот же, что в `favicon.svg` и в токене `--color-accent`. */
const BLUE = [0x2f, 0x6f, 0xed];
const WHITE = [0xff, 0xff, 0xff];

/** Кратность суперсэмплинга: 4 × 4 = 16 проб на пиксель. */
const SS = 4;

/**
 * Знак в координатах 0…32 — те же числа, что в `favicon.svg`.
 *
 * `pad` — доля поля, которую занимает поле безопасности maskable-иконки.
 * Android обрезает её кругом или скруглённым квадратом, поэтому знак
 * должен уместиться в центральные 80 % (спецификация maskable icon).
 */
const GLYPH = {
  frame: { x: 7, y: 6, w: 18, h: 20, r: 1.6, stroke: 2.2 },
  lines: [
    { x1: 7, y1: 13, x2: 25, y2: 13 },
    { x1: 7, y1: 19, x2: 25, y2: 19 },
    { x1: 16, y1: 6, x2: 16, y2: 26 },
  ],
};

/** Расстояние от точки до отрезка — им меряется толщина линии. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Знаковое расстояние до скруглённого прямоугольника: < 0 внутри. */
function roundedRectDistance(px, py, x, y, w, h, r) {
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const outside = Math.hypot(Math.max(cx, 0), Math.max(cy, 0));
  return outside + Math.min(Math.max(cx, cy), 0) - r;
}

/**
 * Цвет точки в координатах знака (0…32).
 *
 * `background` — рисовать ли подложку. Для maskable-иконки подложка
 * заливает всё поле целиком: обрезанный угол должен остаться синим, а не
 * прозрачным.
 */
function sample(u, v, options) {
  const { rounded, background } = options;
  const inPlate = background && (!rounded || roundedRectDistance(u, v, 0, 0, 32, 32, 7) <= 0);
  if (!inPlate) return undefined;

  const half = GLYPH.frame.stroke / 2;
  const f = GLYPH.frame;
  const onFrame = Math.abs(roundedRectDistance(u, v, f.x, f.y, f.w, f.h, f.r)) <= half;
  const onLine = GLYPH.lines.some(
    (l) => distanceToSegment(u, v, l.x1, l.y1, l.x2, l.y2) <= half,
  );
  return onFrame || onLine ? WHITE : BLUE;
}

/**
 * Растеризация в RGBA.
 *
 * `inset` сжимает знак к центру, оставляя поле безопасности: подложка при
 * этом остаётся на всё поле, сжимается только рисунок.
 */
function render(size, { rounded, inset = 0 }) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 32 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) * scale;
          const fy = (y + (sy + 0.5) / SS) * scale;
          // Поле безопасности: знак сжимается, подложка — нет.
          const gx = 16 + (fx - 16) / (1 - inset);
          const gy = 16 + (fy - 16) / (1 - inset);
          const plate = sample(fx, fy, { rounded, background: true });
          if (plate === undefined) continue;
          const glyph = sample(gx, gy, { rounded: false, background: true });
          const color = glyph === undefined ? BLUE : glyph;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const samples = SS * SS;
      const offset = (y * size + x) * 4;
      // Цвет усредняется по ПОКРЫТЫМ пробам, иначе край подложки темнеет.
      const covered = a / 255;
      pixels[offset] = covered === 0 ? 0 : Math.round(r / covered);
      pixels[offset + 1] = covered === 0 ? 0 : Math.round(g / covered);
      pixels[offset + 2] = covered === 0 ? 0 : Math.round(b / covered);
      pixels[offset + 3] = Math.round(a / samples);
    }
  }
  return pixels;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function encodePng(size, pixels) {
  // Каждая строка PNG предваряется байтом фильтра; 0 — «без фильтра».
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true, inset: 0 },
  { file: 'icon-512.png', size: 512, rounded: true, inset: 0 },
  // Maskable: подложка на всё поле, знак — в центральных 80 %.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, inset: 0.2 },
  // iOS сам скругляет углы и не понимает прозрачности: подложка сплошная.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, inset: 0.08 },
];

const out = join(process.cwd(), 'public');
for (const target of TARGETS) {
  const pixels = render(target.size, { rounded: target.rounded, inset: target.inset });
  const png = encodePng(target.size, pixels);
  writeFileSync(join(out, target.file), png);
  console.log(`${target.file.padEnd(26)} ${String(target.size).padStart(3)}×${target.size}  ${String(png.length).padStart(6)} байт`);
}
