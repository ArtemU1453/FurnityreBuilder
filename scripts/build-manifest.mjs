#!/usr/bin/env node
/**
 * Манифест под базовый путь сборки (PROMPT 37 §2).
 *
 * ## Почему правка после сборки, а не генерация из шаблона
 *
 * Манифест лежит в `public/` обычным читаемым файлом и в таком виде
 * верен для корня домена и для дев-сервера — то есть для всех случаев,
 * кроме одного. Заменять его шаблоном значило бы сделать нечитаемым
 * файл, который девяносто девять раз из ста никакой подстановки не
 * требует. Поэтому источник остаётся файлом, а здесь правятся ровно три
 * вида полей — и только когда база не корень.
 *
 * ## Что правится
 *
 * `start_url`, `scope` и адреса значков. Всё это абсолютные пути от
 * корня домена; в подкаталоге браузер по ним ничего не найдёт, а
 * `scope` вне области действия страницы делает манифест недействительным
 * целиком — приложение перестаёт предлагаться к установке.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appBase, withBase } from './app-base.mjs';

const FILE = join(process.cwd(), 'dist', 'manifest.webmanifest');
const BASE = appBase();

const manifest = JSON.parse(readFileSync(FILE, 'utf8'));

manifest.id = BASE;
manifest.start_url = BASE;
manifest.scope = BASE;
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: withBase(BASE, icon.src) }));

writeFileSync(FILE, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.webmanifest: базовый путь «${BASE}», значков ${String(manifest.icons.length)}.`);
