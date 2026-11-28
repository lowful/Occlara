#!/usr/bin/env node
'use strict';
/**
 * THE FULL MOON, every file of the logo, from one source (Nov 2026, the
 * owner's pick: a full round moon in Orbit's palette, the CLEAN detail level).
 *
 * THE SOURCE is scripts/moon/: moon-geometry.js and moon-art.js are the
 * design's own files, unchanged, and moon-drawings.js its icon drawings copied
 * byte for byte (the design is logos/full-moon in the redesign folder). The
 * moon is never redrawn here: every file below is one of those drawings.
 *
 * Written here in plain node, as SVG:
 *   assets/logo-mark.svg      the one colour mark: the disc, its seas and four
 *                             craters cut by even odd fill, color="#F5F5F7" on
 *                             its root (through an <img> currentColor is black)
 *   assets/mark-bar.svg       the top bar's mark, the 24 unit colour drawing at 22
 *   assets/splash/moon.svg    the splash's moon, the clean drawing with its glow
 *
 * Rendered in a hidden Electron window, because the drawn moon is made of SVG
 * filters (turbulence, blur, blend modes) no arithmetic here reproduces, and
 * packed here:
 *   assets/icon.png           512, the drawn moon on the glass tile
 *   assets/icon.ico           16 to 256, each size from the moon's own drawing:
 *                             the drawn moon with its grain at 256 and 128,
 *                             without it from 96 down to 40, the hand drawing on
 *                             the 32 grid at 32 and 24, the 16 px drawing at 20
 *                             and 16
 *   assets/tray-dark.ico      the tray, idle: the 16 grid moon in the ink
 *   assets/tray-light.ico     the same in the ground, for a light taskbar
 *   assets/tray-rec-dark.ico  recording: the moon as the dot inside the record
 *   assets/tray-rec-light.ico ring of Start's glyph, ink and ground
 *   scripts/moon/rendered.json  what each picture was rendered from (a hash of
 *                             its drawings) and what it is (a hash of the file),
 *                             so test:mark holds the pictures to the drawings
 *                             without rendering them again
 *
 * Usage (ONE ELECTRON AT A TIME on this PC: take the redesign folder's
 * electron.lock first; this shell exports ELECTRON_RUN_AS_NODE, unset it):
 *   node scripts/generate-icon.js                 every file above
 *   node scripts/generate-icon.js --svg           the three SVG files alone, no Electron
 *   node scripts/generate-icon.js --pngs <dir>    every icon size as a loose PNG, for looking
 *   node scripts/generate-icon.js --site <dir>    the website's favicon.ico, favicon.svg,
 *                                                 apple-touch-icon.png, icon-512.png and
 *                                                 avatar-1024.png; assets/ is not touched
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./moon/moon-art');
const M = require('./moon/moon-drawings');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const MANIFEST = path.join(__dirname, 'moon', 'rendered.json');

const INK = '#F5F5F7';     // the tray on a dark taskbar, and logo-mark.svg's colour
const GROUND = '#0A0B0E';  // the tray on a light taskbar
const APP = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const TRAY = [16, 20, 24, 32, 40, 48];
const PNG_SIZE = 512;

// ─── The drawings, by size ────────────────────────────────────────────────────
/** The app icon's drawing at `size`: each size its own (the design's ladder). */
function appSource(size) {
  if (size >= 128) return M.appIcon('a', size);
  if (size >= 40) return M.appIcon('a', size, true);
  if (size >= 24) return M.icon32('a', size);
  return M.icon16('a', size);
}
/** Which drawing a size uses, in words, for the manifest and the tests. */
function appDrawing(size) {
  return size >= 128 ? 'drawn moon, grain' : size >= 40 ? 'drawn moon' : size >= 24 ? 'the 32 grid drawing' : 'the 16 px drawing';
}
const traySource = (kind, color, size) => (kind === 'rec' ? M.trayRec(color, size) : M.trayIdle(color, size));
const TRAYS = [
  ['tray-dark.ico', 'idle', INK], ['tray-light.ico', 'idle', GROUND],
  ['tray-rec-dark.ico', 'rec', INK], ['tray-rec-light.ico', 'rec', GROUND],
];

// The splash's moon: the board's clean drawing (its "vc"), in its own frame.
const SPLASH_OPTS = { level: 'clean', grain: true, specks: 60, halo: 1, rimW: 1.3 };
const SPLASH_PX = 160;
const splashMoon = () => `<svg ${M.XMLNS} width="${SPLASH_PX}" height="${SPLASH_PX}" viewBox="-122 -122 244 244">${A.moon('s', SPLASH_OPTS)}</svg>\n`;
// The top bar's mark: the 24 unit drawing at 22 (the design's "top bar mark 22").
const BAR_PX = 22;
const barMark = () => M.miniMark('b', BAR_PX) + '\n';

/** The SVG files, written in plain node. */
const SVG_FILES = () => [
  ['assets/logo-mark.svg', M.markSvg],
  ['assets/mark-bar.svg', barMark()],
  ['assets/splash/moon.svg', splashMoon()],
];

/** The pictures to render: per file, its entries as [size, svg]. */
function jobs() {
  const out = [['assets/icon.png', [[PNG_SIZE, M.appIcon('a', PNG_SIZE)]]]];
  out.push(['assets/icon.ico', APP.map((s) => [s, appSource(s)])]);
  for (const [file, kind, color] of TRAYS) out.push([`assets/${file}`, TRAY.map((s) => [s, traySource(kind, color, s)])]);
  return out;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** The hash of what a picture is drawn from: its sizes and their drawings. */
const sourceHash = (entries) => sha(JSON.stringify(entries));

// ─── PNG encoder (pure Node.js, uses built-in zlib) ──────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
/** RGBA pixels (straight alpha) as a PNG, every row filter 0, so a reader can inflate and index it. */
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bit RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ─── ICO encoder (PNG entries, Windows Vista and later) ─────────────────────
function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;   // 0 means 256
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((x) => x.data)]);
}

// ─── Rendering, in a hidden Electron window ──────────────────────────────────
/**
 * Each [size, svg] drawn into a canvas of exactly size x size by Chromium's own
 * SVG renderer, read back as straight alpha RGBA. Resolves to Buffers.
 */
async function renderAll(list) {
  const { app, BrowserWindow } = require('electron');
  await app.whenReady();
  // A plain hidden window, as shot-demo.js makes them (an offscreen one never
  // started its renderer on this PC). It loads nothing but a blank page.
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await win.loadURL('about:blank');
  const out = [];
  for (const [size, svg] of list) {
    const b64 = await win.webContents.executeJavaScript(`(async () => {
      const url = URL.createObjectURL(new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = ${size}; c.height = ${size};
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, ${size}, ${size});
      URL.revokeObjectURL(url);
      const d = g.getImageData(0, 0, ${size}, ${size}).data;
      let s = '';
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return btoa(s);
    })()`);
    out.push(Buffer.from(b64, 'base64'));
  }
  win.destroy();
  return out;
}

function writeSvgs() {
  for (const [rel, text] of SVG_FILES()) {
    const dest = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
  console.log(`[icons] ${SVG_FILES().map((f) => f[0]).join(', ')} written`);
}

async function renderFiles() {
  const manifest = { note: 'Written by scripts/generate-icon.js. sources: the hash of the drawings each picture is rendered from; sha256: the file. test:mark holds both.', files: {} };
  for (const [rel, entries] of jobs()) {
    const bufs = await renderAll(entries);
    const pngs = entries.map(([size], i) => ({ size, data: png(size, bufs[i]) }));
    const data = rel.endsWith('.png') ? pngs[0].data : ico(pngs);
    fs.writeFileSync(path.join(ROOT, rel), data);
    manifest.files[rel] = { sizes: entries.map((e) => e[0]), drawings: rel === 'assets/icon.ico' ? entries.map(([s]) => `${s} ${appDrawing(s)}`) : undefined, sources: sourceHash(entries), sha256: sha(data) };
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[icons] ${jobs().map((j) => j[0]).join(', ')} rendered, and scripts/moon/rendered.json`);
}

async function renderLoose(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  for (const s of APP) list.push([`app-${s}.png`, s, appSource(s)]);
  for (const [file, kind, color] of TRAYS) for (const s of TRAY) list.push([`${file.replace('.ico', '')}-${s}.png`, s, traySource(kind, color, s)]);
  list.push(['splash-moon-320.png', 320, splashMoon().replace(/width="160" height="160"/, 'width="320" height="320"')]);
  list.push(['mark-bar-88.png', 88, M.miniMark('b', 88)]);
  list.push(['logo-mark-120.png', 120, M.markSvg]);
  const bufs = await renderAll(list.map(([, s, svg]) => [s, svg]));
  list.forEach(([name, s], i) => fs.writeFileSync(path.join(dir, name), png(s, bufs[i])));
  console.log(`[icons] ${list.length} loose PNGs written to ${dir}`);
}

async function renderSite(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ico3 = [16, 32, 48].map((s) => [s, appSource(s)]);
  const b = await renderAll(ico3);
  fs.writeFileSync(path.join(dir, 'favicon.ico'), ico(ico3.map(([s], i) => ({ size: s, data: png(s, b[i]) }))));
  fs.writeFileSync(path.join(dir, 'favicon.svg'), M.icon16('f', 16) + '\n');
  const big = [[180, M.appIcon('a', 180)], [512, M.appIcon('a', 512)], [1024, M.appIcon('a', 1024)]];
  const bb = await renderAll(big);
  ['apple-touch-icon.png', 'icon-512.png', 'avatar-1024.png'].forEach((n, i) => fs.writeFileSync(path.join(dir, n), png(big[i][0], bb[i])));
  console.log(`[icons] favicon.ico, favicon.svg, apple-touch-icon.png, icon-512.png and avatar-1024.png written to ${dir}`);
}

// Required by test:mark: the sources and the packers, nothing drawn or written.
module.exports = { INK, GROUND, APP, TRAY, TRAYS, PNG_SIZE, SPLASH_OPTS, SPLASH_PX, BAR_PX, appSource, appDrawing, traySource, splashMoon, barMark, SVG_FILES, jobs, sourceHash, sha, png, ico, MANIFEST };

// Run as a script: named on the command line. NOT require.main alone, because
// `electron this.js` loads it through Electron's default app, whose own file
// is require.main there; that test left the render window never made and the
// app idle forever. Required by test:mark, nothing runs.
const RUN = require.main === module || process.argv.slice(1, 3).some((a) => {
  try { return path.resolve(a) === __filename; } catch { return false; }
});
if (RUN) {
  const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? path.resolve(process.argv[i + 1]) : null;
  };
  const inElectron = !!process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE;
  if (!inElectron) {
    // Plain node: the SVG files, then this same script again in Electron for the pictures.
    writeSvgs();
    if (process.argv.includes('--svg')) process.exit(0);
    const { spawnSync } = require('child_process');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(String(require('electron')), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
    process.exit(typeof run.status === 'number' ? run.status : 1);
  }
  const { app } = require('electron');
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.on('window-all-closed', () => {});
  // Never left hanging: a render that has not finished in three minutes fails.
  setTimeout(() => { console.error('[icons] FAIL: the render did not finish in 3 minutes'); app.exit(2); }, 180000);
  const pngDir = argAfter('--pngs');
  const siteDir = argAfter('--site');
  const work = pngDir ? renderLoose(pngDir) : siteDir ? renderSite(siteDir) : renderFiles();
  work.then(() => app.exit(0)).catch((e) => { console.error(`[icons] ${e && e.stack}`); app.exit(1); });
}
