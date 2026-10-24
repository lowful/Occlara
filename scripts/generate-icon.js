#!/usr/bin/env node
'use strict';
/**
 * Generates the Occlara icons from the crescent mark, no dependencies:
 *
 *   assets/icon.png        512x512, the tile
 *   assets/icon.ico        the tile at 16 20 24 32 40 48 64 96 128 256 (installer, taskbar, Explorer)
 *   assets/tray-dark.ico   the crescent alone in the ink, #F5F5F7, for a dark taskbar, at 16 20 24 32 40 48
 *   assets/tray-light.ico  the crescent alone in the ground, #0A0B0E, for a light taskbar, the same sizes
 *
 * Usage:
 *   node scripts/generate-icon.js                the four app icons into assets/
 *   node scripts/generate-icon.js --site <dir>   the website's icons into <dir>, for its public/
 *                                                folder by hand, and the 1024 avatar: favicon.ico,
 *                                                favicon.svg, apple-touch-icon.png, icon-512.png,
 *                                                avatar-1024.png. assets/ is not touched.
 *   node scripts/generate-icon.js --pngs <dir>   every size as a loose PNG, for looking at (not shipped)
 *
 * No online converter and no other tool: these files are drawn here, and a
 * changed mark is a changed number below and one run.
 *
 * THE DRAWING IS ARITHMETIC, the same two circles as assets/logo-mark.svg: on
 * the 120 unit grid, the disc of radius 50 at (71, 54) less the disc of radius
 * 42 at (86.588, 45). If that file changes, this must change with it (it is
 * one of the mark's five places, CLAUDE.md).
 *
 * EVERY PIXEL IS COVERED, NOT POINT SAMPLED. The aperture's generator asked
 * once per pixel whether its centre was inside the mark, so every edge was a
 * hard stair and the 16px icon lost whole arcs. Here each pixel is split into
 * a grid of samples (8 x 8 up to 64px, 4 x 4 above) and its coverage is the
 * share inside, which is what a browser's antialiasing approximates. The
 * crescent is blended over the tile on the sRGB values, as a browser blends.
 *
 * THE MARK GROWS AS THE TILE SHRINKS. Its diameter is 58% of the tile from
 * 32px up, 66% at 20 and 24, 72% at 16: at 58% the 16px moon is 9px tall and
 * its back two pixels, which is a dot in a dark square on a light taskbar.
 * The tile is the ground, #0A0B0E, rounded at 22.5% of its side.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── The crescent (120 unit grid) and the tile ──────────────────────────────
const OUTER = { x: 71, y: 54, r: 50 };
const INNER = { x: 71 + 18 * Math.cos(Math.PI / 6), y: 54 - 18 * Math.sin(Math.PI / 6), r: 42 };   // (86.588, 45)
const GROUND = [0x0A, 0x0B, 0x0E];   // --bg
const INK = [0xF5, 0xF5, 0xF7];      // --text
const TILE_RADIUS = 0.225;           // of the tile's side

/** The mark's diameter as a share of the tile, by the tile's size. */
function markShare(size) {
  if (size <= 16) return 0.72;
  if (size <= 24) return 0.66;
  return 0.58;
}

/** Is a point of the 120 grid inside the crescent: inside the disc and outside the shade. */
function inCrescent(u, v) {
  const ox = u - OUTER.x, oy = v - OUTER.y;
  if (ox * ox + oy * oy > OUTER.r * OUTER.r) return false;
  const ix = u - INNER.x, iy = v - INNER.y;
  return ix * ix + iy * iy > INNER.r * INNER.r;
}

/** Is a point (in pixels of a size x size icon) inside the rounded tile (radius 0: the full square). */
function inTile(x, y, size, radius = TILE_RADIUS) {
  if (radius <= 0) return x >= 0 && y >= 0 && x <= size && y <= size;
  const r = radius * size;
  const dx = Math.max(r - x, 0, x - (size - r));
  const dy = Math.max(r - y, 0, y - (size - r));
  return dx * dx + dy * dy <= r * r;
}

/**
 * Coverage of the crescent and of the tile in every pixel.
 * tile: true draws the crescent at `share` of a tile; false, the 120 grid fills the icon.
 */
function coverage(size, tile, radius = TILE_RADIUS, share = markShare(size)) {
  const S = size <= 64 ? 8 : 4;
  // pixels -> 120 grid: the mark's 100 unit diameter becomes share * size
  const unitsPerPx = tile ? 100 / (share * size) : 120 / size;
  const offset = tile ? (size - (120 / unitsPerPx)) / 2 : 0;   // the 120 box, centred in the tile
  const mark = new Float64Array(size * size);
  const ground = new Float64Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let m = 0, g = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S, y = py + (sy + 0.5) / S;
          if (tile && !inTile(x, y, size, radius)) continue;
          g++;
          if (inCrescent((x - offset) * unitsPerPx, (y - offset) * unitsPerPx)) m++;
        }
      }
      mark[py * size + px] = m / (S * S);
      ground[py * size + px] = g / (S * S);
    }
  }
  return { mark, ground };
}

/** RGBA pixels: the tile (ground, crescent blended over it) or the crescent alone in `ink`. */
function draw(size, tile, ink = INK, radius = TILE_RADIUS, share = markShare(size)) {
  const { mark, ground } = coverage(size, tile, radius, share);
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    if (tile) {
      // the crescent's share of the pixel, inside the tile's share of it,
      // blended on the sRGB values, as a browser blends an edge
      const m = ground[i] > 0 ? Math.min(1, mark[i] / ground[i]) : 0;
      for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(GROUND[c] * (1 - m) + ink[c] * m);
      px[i * 4 + 3] = Math.round(ground[i] * 255);
    } else {
      for (let c = 0; c < 3; c++) px[i * 4 + c] = ink[c];
      px[i * 4 + 3] = Math.round(mark[i] * 255);
    }
  }
  return px;
}

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
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bit RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));   // each row: filter byte 0 (None), then the row
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

// ─── The favicon as a vector: the 72% tile, for a browser tab ──────────────
/** The crescent's path at `share` of a 120 tile, centred as the PNGs centre it. */
function tilePath(share) {
  const k = (share * 120) / 100;          // grid units per mark unit
  const o = (120 - 120 * k) / 2;          // the scaled 120 box, centred
  const P = (x, y) => [o + x * k, o + y * k];
  // the two horns, where the disc and the shade cross
  const d = Math.hypot(INNER.x - OUTER.x, INNER.y - OUTER.y);
  const a = (OUTER.r * OUTER.r - INNER.r * INNER.r + d * d) / (2 * d);
  const h = Math.sqrt(OUTER.r * OUTER.r - a * a);
  const ux = (INNER.x - OUTER.x) / d, uy = (INNER.y - OUTER.y) / d;
  const mx = OUTER.x + a * ux, my = OUTER.y + a * uy;
  const h1 = P(mx + h * uy, my - h * ux), h2 = P(mx - h * uy, my + h * ux);
  const f = (n) => String(Math.round(n * 1000) / 1000);
  const R = OUTER.r * k, r = INNER.r * k;
  return `M${f(h1[0])},${f(h1[1])} A${f(R)},${f(R)} 0 1,0 ${f(h2[0])},${f(h2[1])} A${f(r)},${f(r)} 0 1,1 ${f(h1[0])},${f(h1[1])} Z`;
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function faviconSvg() {
  return '<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Occlara">\n'
    + `  <rect width="120" height="120" rx="${120 * TILE_RADIUS}" fill="${hex(GROUND)}"/>\n`
    + `  <path d="${tilePath(0.72)}" fill="${hex(INK)}"/>\n`
    + '</svg>\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const APP = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const TRAY = [16, 20, 24, 32, 40, 48];

// Required (test:mark reads the geometry), it draws nothing and writes nothing.
module.exports = { OUTER, INNER, GROUND, INK, TILE_RADIUS, APP, TRAY, inCrescent, markShare, tilePath, faviconSvg, draw, png, ico };
if (require.main === module) main();

function main() {
  const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? path.resolve(process.argv[i + 1]) : null;
  };
  const siteDir = argAfter('--site');
  const pngDir = argAfter('--pngs');
  if ((process.argv.includes('--site') && !siteDir) || (process.argv.includes('--pngs') && !pngDir)) {
    console.error('usage: node scripts/generate-icon.js [--site <dir>] [--pngs <dir>]');
    process.exit(1);
  }

  if (siteDir) {
    // For the website: the favicon (the 72% tile, so a tab's 16px keeps its
    // moon), and the full bleed squares a platform rounds or crops itself (the
    // touch icon, the Discord and TikTok avatars). The avatar's crescent stays
    // inside the circle those crop it to: its disc reaches 371 of 512px from the
    // centre.
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'favicon.ico'), ico([16, 32, 48].map((s) => ({ size: s, data: png(s, draw(s, true, INK, TILE_RADIUS, 0.72)) }))));
    fs.writeFileSync(path.join(siteDir, 'favicon.svg'), faviconSvg());
    fs.writeFileSync(path.join(siteDir, 'apple-touch-icon.png'), png(180, draw(180, true, INK, 0, 0.58)));
    fs.writeFileSync(path.join(siteDir, 'icon-512.png'), png(512, draw(512, true)));
    fs.writeFileSync(path.join(siteDir, 'avatar-1024.png'), png(1024, draw(1024, true, INK, 0, 0.58)));
    console.log(`favicon.ico, favicon.svg, apple-touch-icon.png, icon-512.png and avatar-1024.png written to ${siteDir}`);
  }
  if (pngDir) {
    fs.mkdirSync(pngDir, { recursive: true });
    for (const s of APP) fs.writeFileSync(path.join(pngDir, `tile-${s}.png`), png(s, draw(s, true)));
    for (const s of TRAY) {
      fs.writeFileSync(path.join(pngDir, `tray-dark-${s}.png`), png(s, draw(s, false, INK)));
      fs.writeFileSync(path.join(pngDir, `tray-light-${s}.png`), png(s, draw(s, false, GROUND)));
    }
    console.log(`loose PNGs of every size written to ${pngDir}`);
  }
  if (!siteDir && !pngDir) {
    const assets = path.join(__dirname, '..', 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.writeFileSync(path.join(assets, 'icon.png'), png(512, draw(512, true)));
    fs.writeFileSync(path.join(assets, 'icon.ico'), ico(APP.map((s) => ({ size: s, data: png(s, draw(s, true)) }))));
    fs.writeFileSync(path.join(assets, 'tray-dark.ico'), ico(TRAY.map((s) => ({ size: s, data: png(s, draw(s, false, INK)) }))));
    fs.writeFileSync(path.join(assets, 'tray-light.ico'), ico(TRAY.map((s) => ({ size: s, data: png(s, draw(s, false, GROUND)) }))));
    console.log(`icon.png, icon.ico, tray-dark.ico and tray-light.ico written to ${assets}`);
  }
}
