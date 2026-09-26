/*
 * Сквозной тест Дневник‑Креатора в headless Chromium (Playwright).
 * CDN-библиотеки подменяются локальными копиями из node_modules, поэтому тест работает офлайн.
 *
 *   npm install            # playwright, jszip, jspdf, file-saver, @tailwindcss/browser, jpeg-js
 *   npm test               # или: node tests/e2e.cjs
 *
 * Переменные окружения: OUT_DIR — куда сложить скриншоты и выгрузки (по умолчанию tests/out),
 * CHROMIUM — путь к исполняемому файлу Chromium, HEADFUL=1 — показать окно браузера.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const jpeg = require('jpeg-js');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.OUT_DIR || path.join(__dirname, 'out'));
const FIX = path.join(OUT, 'fixtures');
fs.mkdirSync(FIX, { recursive: true });

const lib = (id, file) => path.join(path.dirname(require.resolve(id + '/package.json')), file);
const ROUTES = [
  [/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser/, lib('@tailwindcss/browser', 'dist/index.global.js')],
  [/jszip/, lib('jszip', 'dist/jszip.min.js')],
  [/FileSaver|file-saver/, lib('file-saver', 'dist/FileSaver.min.js')],
  [/jspdf/, lib('jspdf', 'dist/jspdf.umd.min.js')],
];

/* Google Fonts → локальные копии @fontsource (если установлены): canvas рисует настоящими PT Serif / PT Sans / Noto Serif */
function localFontsCss() {
  const css = [];
  for (const pkg of ['pt-serif', 'pt-sans', 'noto-serif']) {
    let dir; try { dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)); } catch (e) { continue; }
    for (const w of ['400', '700']) {
      const f = path.join(dir, `${w}.css`); if (!fs.existsSync(f)) continue;
      css.push(fs.readFileSync(f, 'utf8').replace(/url\(\.\/files\/([^)]+)\)/g, (m, n) => `url(https://fonts.gstatic.com/__local/${pkg}/${n})`));
    }
  }
  return css.join('\n');
}
const FONTS_CSS = localFontsCss();

let failures = 0;
const check = (cond, msg, extra) => {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra) : ''); }
};

/* ---------- тестовые «портреты» ---------- */
function makePortrait(file, w, h, hue) {
  const data = Buffer.alloc(w * h * 4);
  const cx = w / 2, faceY = h * 0.38, fr = w * 0.2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let r = 60 + hue * 0.4 + 80 * (y / h), g = 110 + 60 * (x / w), b = 180 - hue * 0.3;
    const dx = (x - cx) / fr, dy = (y - faceY) / (fr * 1.25);
    if (((x - cx) / (w * 0.42)) ** 2 + ((y - h) / (h * 0.36)) ** 2 < 1) { r = 30 + hue * 0.2; g = 40; b = 90; }
    if (dx * dx + dy * dy < 1) { r = 232; g = 190; b = 160; if (dy < -0.45) { r = 50; g = 35; b = 25; } }
    if ((((x - (cx - fr * 0.38)) / (fr * 0.1)) ** 2 + ((y - faceY + fr * 0.1) / (fr * 0.08)) ** 2 < 1) || (((x - (cx + fr * 0.38)) / (fr * 0.1)) ** 2 + ((y - faceY + fr * 0.1) / (fr * 0.08)) ** 2 < 1)) { r = 20; g = 20; b = 30; }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  fs.writeFileSync(file, jpeg.encode({ data, width: w, height: h }, 88).data);
  return file;
}
const photos = [
  makePortrait(path.join(FIX, '1.jpg'), 900, 1200, 10),
  makePortrait(path.join(FIX, '02.jpg'), 900, 1200, 60),
  makePortrait(path.join(FIX, 'nazarzoda_farrukh.jpg'), 900, 1200, 110),
  makePortrait(path.join(FIX, 'Рахимова Нигина.JPG'), 900, 1200, 160),
  makePortrait(path.join(FIX, 'saidov.jpg'), 240, 320, 200),          // низкое разрешение
  makePortrait(path.join(FIX, 'лишнее фото.jpg'), 600, 800, 240),     // не сопоставится
];
fs.writeFileSync(path.join(FIX, 'broken.heic'), Buffer.from('not an image'));
photos.push(path.join(FIX, 'broken.heic'));

const TSV = [
  'Номер\tФИО_Именительный\tФИО_Родительный\tПол (М/Ж)\tИмя_Файла',
  '1\tАбдуллоев Сухроб\tАбдуллоева Сухроба\tМ\t1.jpg',
  '2\tАзимова Мадина\t\tЖ\t',
  '3\tНазарзода Фаррух\tНазарзода Фарруха\tм\t',
  '4\tРаҳимова Нигина\tРаҳимовой Нигины\t\t',
  '5\tСаидов Ҷамшед\tСаидова Ҷамшеда\tМ\tsaidov.jpg',
  '6\tКаримова Шахзода Абдуллоевна\t\t\tнет_такого.jpg',
].join('\n');

function pngInfo(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const i = buf.indexOf(Buffer.from('pHYs'));
  return { w, h, ppmX: i > 0 ? buf.readUInt32BE(i + 4) : 0, unit: i > 0 ? buf[i + 12] : -1, physBeforeIdat: i > 0 && i < buf.indexOf(Buffer.from('IDAT')) };
}
function jpegInfo(buf) {
  const units = buf[13], dx = buf.readUInt16BE(14);
  let off = 2, w = 0, h = 0;
  while (off < buf.length) { if (buf[off] !== 0xFF) break; const m = buf[off + 1]; const len = buf.readUInt16BE(off + 2); if (m >= 0xC0 && m <= 0xC2) { h = buf.readUInt16BE(off + 5); w = buf.readUInt16BE(off + 7); break; } off += 2 + len; }
  return { units, dx, w, h };
}

(async () => {
  const browser = await chromium.launch({
    headless: !process.env.HEADFUL,
    executablePath: process.env.CHROMIUM || undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    for (const [re, file] of ROUTES) if (re.test(url)) return route.fulfill({ path: file, contentType: 'application/javascript' });
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) && process.env.NO_FONTS) return route.abort();
    if (FONTS_CSS && /fonts\.googleapis\.com\/css2/.test(url)) return route.fulfill({ body: FONTS_CSS, contentType: 'text/css' });
    const lf = url.match(/fonts\.gstatic\.com\/__local\/([^/]+)\/(.+)$/);
    if (lf) return route.fulfill({ path: path.join(path.dirname(require.resolve(`@fontsource/${lf[1]}/package.json`)), 'files', lf[2]), contentType: lf[2].endsWith('.woff2') ? 'font/woff2' : 'font/woff' });
    return route.continue();
  });

  console.log('1. Запуск');
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.DC && window.DC.state.cover && window.DC.state.cover.clean, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const init = await page.evaluate(() => ({ n: DC.state.students.length, demo: DC.state.demo, cw: DC.state.cover.w, tw: getComputedStyle(document.querySelector('#app')).display }));
  check(init.demo && init.n === 5, 'демо-список загружен', init);
  check(init.cw === 594, 'встроенная обложка декодирована', init.cw);
  check(init.tw === 'flex', 'Tailwind применён');
  if (FONTS_CSS) {
    const fontOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'PT Serif' && f.status === 'loaded'); });
    check(fontOk, 'веб-шрифт PT Serif загружен для canvas');
  }
  await page.screenshot({ path: path.join(OUT, '01-start.png') });

  console.log('2. Импорт из Excel (TSV)');
  await page.click('[data-action="open-import"]');
  await page.fill('#pasteArea', TSV);
  await page.waitForTimeout(300);
  const info = await page.textContent('#parseInfo');
  check(/строк: 6/.test(info) && /заголовок/.test(info), 'предпросмотр распознал заголовок и 6 строк', info);
  await page.screenshot({ path: path.join(OUT, '02-import.png') });
  await page.click('[data-mact="do-import"]');
  const studs = await page.evaluate(() => DC.state.students.map((s) => ({ num: s.num, nom: s.nameNom, gen: s.nameGen, g: s.gender, gg: s.genderGuessed, genG: s.genGuessed, file: s.fileName })));
  check(studs.length === 6, 'импортировано 6 учеников', studs.length);
  check(studs[1].gen === 'Азимовой Мадины' && studs[1].genG, 'автосклонение: Азимова Мадина → Азимовой Мадины', studs[1]);
  check(studs[0].g === 'M' && !studs[0].gg, 'столбец «Пол (М/Ж)» распознан по заголовку', studs[0]);
  check(studs[2].g === 'M' && !studs[2].gg, 'пол «м» (строчная) распознан', studs[2]);
  check(studs[3].g === 'F' && studs[3].gg, 'пол Раҳимовой определён автоматически', studs[3]);
  check(studs[5].g === 'F' && studs[5].gen === 'Каримовой Шахзоды Абдуллоевны', 'полное ФИО с отчеством склонено', studs[5]);

  console.log('3. Загрузка фото и сопоставление');
  // файлы передаются буфером: Playwright теряет пути с кириллицей
  const asPayload = (f) => ({ name: path.basename(f), mimeType: /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'application/octet-stream', buffer: fs.readFileSync(f) });
  await page.setInputFiles('#filePhotos', photos.map(asPayload));
  await page.waitForFunction(() => [...DC.state.photos.values()].every((p) => p.status !== 'pending'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const match = await page.evaluate(() => DC.state.students.map((s) => { const p = s.photoId && DC.state.photos.get(s.photoId); return { nom: s.nameNom, photo: p ? p.name : null, info: s.matchInfo }; }));
  check(match[0].photo === '1.jpg', 'по имени файла: 1.jpg', match[0]);
  check(match[1].photo === '02.jpg', 'по номеру: 02.jpg → №2', match[1]);
  check(match[2].photo === 'nazarzoda_farrukh.jpg', 'по транслиту ФИО: nazarzoda_farrukh.jpg', match[2]);
  check(match[3].photo === 'Рахимова Нигина.JPG', 'по ФИО с таджикской буквой: Раҳимова ↔ Рахимова', match[3]);
  check(match[4].photo === 'saidov.jpg', 'по имени файла: saidov.jpg', match[4]);
  check(match[5].photo === null, 'нет фото для «нет_такого.jpg»', match[5]);
  const un = await page.evaluate(() => [...DC.state.photos.values()].filter((p) => !DC.state.students.some((s) => s.photoId === p.id)).map((p) => [p.name, p.status]));
  check(un.length === 2 && un.some(([n, s]) => n === 'broken.heic' && s === 'error'), 'нераспознанные фото показаны, HEIC-заглушка помечена ошибкой', un);
  const pf = await page.evaluate(() => DC.state.students.map((s) => DC.preflight(s).map((i) => i.level + ':' + i.text)));
  check(pf[4].some((t) => /Низкое разрешение/.test(t)), 'предупреждение о низком разрешении фото', pf[4]);
  check(pf[5].some((t) => /не найдено/.test(t)), 'ошибка «фото не найдено»', pf[5]);
  await page.screenshot({ path: path.join(OUT, '03-matched.png') });

  console.log('4. Кадрирование мышью и колесом');
  await page.evaluate(() => DC.selectStudent(DC.state.students[0].id));
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const r = DC.frameRect(); const c = document.querySelector('#preview').getBoundingClientRect(); const v = { x: 0, y: 0, w: 3508, h: 2480 };
    return { x: c.left + (r.cx - v.x) / v.w * c.width, y: c.top + (r.cy - v.y) / v.h * c.height, scale: c.width / v.w };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 20, { steps: 5 });
  await page.mouse.up();
  let crop = await page.evaluate(() => ({ ...DC.state.students[0].crop }));
  check(crop.x > 0.05 && crop.y > 0.03, 'перетаскивание сдвигает фото', crop);
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  crop = await page.evaluate(() => ({ ...DC.state.students[0].crop }));
  check(crop.zoom > 1.2, 'колесо мыши увеличивает масштаб', crop);
  await page.dblclick('#preview', { position: { x: box.x - (await page.locator('#preview').boundingBox()).x, y: box.y - (await page.locator('#preview').boundingBox()).y } });
  crop = await page.evaluate(() => ({ ...DC.state.students[0].crop }));
  check(crop.zoom === 1 && crop.x === 0, 'двойной щелчок сбрасывает кадрирование', crop);
  await page.evaluate(() => { const s = DC.state.students[0]; s.crop = { zoom: 1.15, x: 0, y: 0.04, rot: 0 }; });
  await page.click('[data-tab="student"]');
  await page.click('#genderSeg [data-gender="F"]');
  let g = await page.evaluate(() => [DC.state.students[0].gender, DC.layoutText(document.createElement('canvas').getContext('2d'), DC.state.students[0]).items.map((i) => i.text).join(' | ')]);
  check(g[0] === 'F' && /ученицы/.test(g[1]), 'переключатель пола меняет «ученика» → «ученицы»', g);
  await page.click('#genderSeg [data-gender="M"]');
  g = await page.evaluate(() => DC.layoutText(document.createElement('canvas').getContext('2d'), DC.state.students[0]).items.map((i) => i.text));
  check(g.includes('ученика 2 «Г» класса') && g.includes('Абдуллоева Сухроба') && g[0] === 'Дневник', 'текст надписи по шаблону', g);

  console.log('5. Экспорт текущего разворота');
  const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), fn()]); const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; };
  const pngPath = await dl(() => page.click('header [data-action="export-current"][data-fmt="png"]'));
  const pi = pngInfo(fs.readFileSync(pngPath));
  check(pi.w === 3508 && pi.h === 2480, 'PNG 3508×2480', pi);
  check(pi.ppmX === 11811 && pi.unit === 1 && pi.physBeforeIdat, 'PNG содержит pHYs = 300 DPI', pi);
  await page.click('[data-tab="export"]');
  const jpgPath = await dl(() => page.click('#tabBody [data-action="export-current"][data-fmt="jpg"]'));
  const ji = jpegInfo(fs.readFileSync(jpgPath));
  check(ji.units === 1 && ji.dx === 300 && ji.w === 3508 && ji.h === 2480, 'JPEG 3508×2480, JFIF 300 DPI', ji);
  const pdfPath = await dl(() => page.click('#tabBody [data-action="export-current"][data-fmt="pdf"]'));
  const pdf = fs.readFileSync(pdfPath).toString('latin1');
  check(/\/MediaBox \[0 0 841\.8[89]\d* 595\.2[78]\d*\]/.test(pdf) && (pdf.match(/\/Type \/Page\b/g) || []).length === 1, 'PDF: 1 страница A4 альбом', (pdf.match(/\/MediaBox[^\]]*\]/) || [])[0]);

  console.log('6. Пакетный экспорт');
  await page.selectOption('[data-k="export.batchFormat"]', 'zip-png');
  await page.waitForTimeout(100);
  const zipPath = await dl(() => page.click('[data-action="export-batch"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  check(names.length === 5, 'ZIP содержит 5 разворотов (ученики с фото)', names);
  check(names.some((n) => /01_Абдуллоев Сухроб\.png$/.test(n)), 'имя файла по шаблону {номер}_{фио_им}', names);
  const first = await zip.file(names[0]).async('nodebuffer');
  check(pngInfo(first).w === 3508 && pngInfo(first).ppmX === 11811, 'PNG в архиве 3508×2480 @300 DPI', pngInfo(first));
  await page.selectOption('[data-k="export.batchFormat"]', 'pdf');
  await page.selectOption('[data-k="export.scope"]', 'all');
  await page.waitForTimeout(100);
  const bpdf = fs.readFileSync(await dl(() => page.click('[data-action="export-batch"]'))).toString('latin1');
  check((bpdf.match(/\/Type \/Page\b/g) || []).length === 6, 'единый PDF: 6 страниц', (bpdf.match(/\/Type \/Page\b/g) || []).length);

  console.log('7. Сохранение и восстановление после перезагрузки');
  await page.evaluate(() => { DC.state.students[1].crop = { zoom: 1.3, x: 0.1, y: -0.05, rot: 2 }; });
  await page.click('[data-tab="student"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => localStorage.setItem('dnevnik-creator:v1', JSON.stringify({ app: 'dnevnik-creator', v: 1, students: DC.state.students.map(({ avatarUrl, matchInfo, ...s }) => s), settings: DC.state.settings, currentId: DC.state.currentId, demo: false })));
  await page.reload();
  await page.waitForFunction(() => window.DC && DC.state.cover && DC.state.photos.size > 0 && [...DC.state.photos.values()].every((p) => p.status !== 'pending'), null, { timeout: 30000 });
  const after = await page.evaluate(() => ({ n: DC.state.students.length, withPhoto: DC.state.students.filter((s) => s.photoId).length, crop: DC.state.students[1].crop }));
  check(after.n === 6 && after.withPhoto === 5, 'список и фото восстановлены из браузера', after);
  check(after.crop.zoom === 1.3 && after.crop.rot === 2, 'кадрирование сохранилось', after.crop);

  console.log('8. Вид, макет, стили');
  await page.click('[data-view="front"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '04-front.png') });
  await page.click('[data-view="spread"]');
  await page.click('[data-tab="layout"]');
  await page.evaluate(() => document.querySelectorAll('#tabBody details').forEach((d) => { d.open = true; }));
  for (const style of ['denim-full', 'grid', 'denim-grid']) {
    await page.evaluate(() => document.querySelectorAll('#tabBody details').forEach((d) => { d.open = true; }));
    await page.selectOption('[data-k="back.style"]', style); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `05-back-${style}.png`) });
  }
  await page.evaluate(() => { DC.state.settings.text.plate = 'paper'; DC.state.settings.frame.shape = 'arch'; });
  await page.click('[data-action="toggle-layout"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-layout-mode.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { DC.state.settings.text.plate = 'white'; DC.state.settings.frame.shape = 'oval'; });

  console.log('9. Ошибки консоли');
  const relevant = consoleErrors.filter((t) => !/fonts\.g|ERR_TUNNEL|net::ERR_/.test(t));
  check(relevant.length === 0, 'нет ошибок JavaScript в консоли', relevant);

  await browser.close();
  console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
