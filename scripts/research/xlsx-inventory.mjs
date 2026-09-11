#!/usr/bin/env node
/**
 * Структурная опись файла .xlsx (PROMPT 66 §1, §13).
 *
 * НЕ продуктовый код. Ничего из `src/` не импортирует и ничем из
 * зависимостей проекта не пользуется: читает ZIP и XML сам, чтобы
 * увиденное не зависело от того, что показывает или прячет библиотека.
 *
 * Задача узкая и единственная: ответить, ЧТО в файле есть, а не что он
 * значит. Опись обязана замечать спрятанное — скрытые листы (включая
 * `veryHidden`, которое интерфейс Excel не показывает вовсе), скрытые
 * строки и столбцы, формулы, объединённые диапазоны, именованные
 * диапазоны, внешние ссылки, примечания, проверку данных. Утверждение
 * «в файле ничего не спрятано» имеет цену только тогда, когда тот же
 * код на файле со спрятанным это спрятанное находит
 * (`tests/unit/research/xlsx-inventory.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Разбор ZIP-контейнера: имя части → содержимое. */
export function readPackage(path) {
  const buf = readFileSync(path);
  // Конец центрального каталога ищется с хвоста: за ним может быть комментарий.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`не ZIP-контейнер: ${path}`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const parts = new Map();
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждён центральный каталог');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`повреждён заголовок ${name}`);
    const localName = buf.readUInt16LE(offset + 26);
    const localExtra = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const raw = buf.subarray(start, start + compressed);
    parts.set(name, method === 0 ? raw : inflateRawSync(raw));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Раскрытие XML-сущностей, включая числовые: без этого кириллица не читается. */
function decode(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? whole;
  });
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1]);
};

const tags = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*/?>`, 'g')) ?? [];

/** Блоки `<name ...>…</name>` вместе с самозакрытыми `<name .../>`. */
const blocks = (xml, name) =>
  xml.match(new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`, 'g')) ?? [];

const text = (xml) =>
  (xml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
    .map((t) => decode(t.replace(/<[^>]*>/g, '')))
    .join('');

const colOf = (ref) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

function readSharedStrings(parts) {
  const xml = parts.get('xl/sharedStrings.xml');
  if (xml === undefined) return [];
  return blocks(xml.toString('utf8'), 'si').map(text);
}

function readCells(xml, shared) {
  const cells = [];
  for (const row of blocks(xml, 'row')) {
    const hidden = attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true';
    const r = Number(attr(row, 'r') ?? '0');
    for (const cell of blocks(row, 'c')) {
      const ref = attr(cell, 'r') ?? '';
      const type = attr(cell, 't') ?? 'n';
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cell);
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell);
      const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cell);
      let value = null;
      if (inline !== null) value = text(inline[1]);
      else if (v !== null) value = type === 's' ? (shared[Number(v[1])] ?? null) : decode(v[1]);
      if (value === null && formula === null) continue;
      cells.push({
        ref,
        row: r,
        column: colOf(ref),
        type,
        value,
        formula: formula === null ? null : decode(formula[1]),
        rowHidden: hidden,
      });
    }
  }
  return cells;
}

/** Полная опись книги: части контейнера, свойства, листы и их содержимое. */
export function inventoryXlsx(path) {
  const parts = readPackage(path);
  const get = (name) => parts.get(name)?.toString('utf8') ?? '';
  const workbook = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const shared = readSharedStrings(parts);

  const target = new Map();
  for (const rel of tags(rels, 'Relationship')) {
    const id = attr(rel, 'Id');
    const to = attr(rel, 'Target');
    if (id !== null && to !== null) target.set(id, to.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sheets = tags(workbook, 'sheet').map((tag) => {
    const rid = attr(tag, 'r:id') ?? attr(tag, 'id');
    const part = rid === null ? null : (target.get(rid) ?? null);
    const xml = part === null ? '' : get(part);
    const cells = readCells(xml, shared);
    const cols = blocks(xml, 'col').filter(
      (c) => attr(c, 'hidden') === '1' || attr(c, 'hidden') === 'true',
    );
    const sheetRels = part === null ? '' : get(part.replace(/([^/]+)$/, '_rels/$1.rels'));
    return {
      name: attr(tag, 'name') ?? '',
      // Атрибута может не быть вовсе — это тот же «visible».
      state: attr(tag, 'state') ?? 'visible',
      part,
      dimension: attr(blocks(xml, 'dimension')[0] ?? '', 'ref'),
      maxRow: cells.reduce((m, c) => Math.max(m, c.row), 0),
      maxColumn: cells.reduce((m, c) => Math.max(m, c.column), 0),
      nonEmptyCells: cells.filter((c) => c.value !== null).length,
      cells,
      formulas: cells.filter((c) => c.formula !== null).map((c) => c.ref),
      mergedRanges: tags(xml, 'mergeCell')
        .map((t) => attr(t, 'ref'))
        .filter((r) => r !== null),
      hiddenRows: [...new Set(cells.filter((c) => c.rowHidden).map((c) => c.row))],
      hiddenColumns: cols.map((c) => `${attr(c, 'min') ?? '?'}:${attr(c, 'max') ?? '?'}`),
      freezePanes: attr(blocks(xml, 'pane')[0] ?? '', 'topLeftCell'),
      autoFilter: attr(blocks(xml, 'autoFilter')[0] ?? '', 'ref'),
      dataValidations: tags(xml, 'dataValidation').length,
      conditionalFormatting: blocks(xml, 'conditionalFormatting').length,
      hyperlinks: tags(xml, 'hyperlink').length,
      tableParts: tags(xml, 'tablePart').length,
      legacyDrawing: /<legacyDrawing\b/.test(xml),
      drawing: /<drawing\b/.test(xml),
      relatedParts: tags(sheetRels, 'Relationship')
        .map((t) => attr(t, 'Target'))
        .filter((t) => t !== null),
    };
  });

  const core = get('docProps/core.xml');
  const app = get('docProps/app.xml');
  const tagText = (xml, name) => {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
    return m === null ? null : decode(m[1]);
  };

  return {
    parts: [...parts.keys()].sort().map((name) => ({ name, size: parts.get(name).length })),
    creator: tagText(core, 'dc:creator'),
    lastModifiedBy: tagText(core, 'cp:lastModifiedBy'),
    title: tagText(core, 'dc:title'),
    subject: tagText(core, 'dc:subject'),
    created: tagText(core, 'dcterms:created'),
    modified: tagText(core, 'dcterms:modified'),
    application: tagText(app, 'Application'),
    appVersion: tagText(app, 'AppVersion'),
    company: tagText(app, 'Company'),
    sharedStringCount: shared.length,
    definedNames: blocks(workbook, 'definedName').map((t) => ({
      name: attr(t, 'name'),
      value: decode(t.replace(/<[^>]*>/g, '')),
    })),
    externalReferences: tags(workbook, 'externalReference').length,
    customXml: [...parts.keys()].filter((n) => n.startsWith('customXml/')),
    embeddedObjects: [...parts.keys()].filter((n) => /embeddings|oleObject|\.bin$/.test(n)),
    macros: [...parts.keys()].some((n) => n.endsWith('vbaProject.bin')),
    sheets,
  };
}

if (process.argv[1]?.endsWith('xlsx-inventory.mjs')) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('использование: xlsx-inventory.mjs <файл.xlsx>');
    process.exit(2);
  }
  const report = inventoryXlsx(path);
  console.log(JSON.stringify(report, null, 2));
}
