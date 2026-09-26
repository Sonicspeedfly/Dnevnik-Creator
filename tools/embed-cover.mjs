#!/usr/bin/env node
// Встраивает обложку (JPEG) в index.html как base64, чтобы приложение оставалось одним файлом.
// Использование: node tools/embed-cover.mjs [путь/к/cover.jpg] [путь/к/index.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coverPath = resolve(process.argv[2] || resolve(root, 'assets/cover.jpg'));
const htmlPath = resolve(process.argv[3] || resolve(root, 'index.html'));

const jpg = readFileSync(coverPath);
if (jpg[0] !== 0xff || jpg[1] !== 0xd8) {
  console.error(`${coverPath}: это не JPEG-файл`);
  process.exit(1);
}
const b64 = jpg.toString('base64').replace(/.{1,120}/g, '$&\n');
const html = readFileSync(htmlPath, 'utf8');
const re = /(<script id="default-cover" type="text\/plain">\n)[\s\S]*?(<\/script>)/;
if (!re.test(html)) {
  console.error(`${htmlPath}: не найден блок <script id="default-cover">`);
  process.exit(1);
}
writeFileSync(htmlPath, html.replace(re, (_, open, close) => open + b64 + close));
console.log(`Встроено ${coverPath} (${jpg.length} байт) → ${htmlPath}`);
