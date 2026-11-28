#!/usr/bin/env node
'use strict';
/**
 * Generates the Occlara icons from the crescent mark, no dependencies:
 *
 *   assets/icon.png        512x512, the tile (Orbit's glass crescent on its squircle, below)
 *   assets/icon.ico        the tile at 16 20 24 32 40 48 64 96 128 256 (installer, taskbar, Explorer)
 *   assets/tray-dark.ico   the crescent alone in the ink, #F5F5F7, for a dark taskbar, at 16 20 24 32 40 48
 *   assets/tray-light.ico  the crescent alone in the ground, #0A0B0E, for a light taskbar, the same sizes
 *   assets/splash/         the splash's ground, glass disc and glow (ORBIT, below)
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
 * the 120 unit grid, the disc of radius 50 at (62.15, 60) less the disc of
 * radius 42 at (77.738, 51). The ink's bounding box, x 12.15 to 107.85 and y
 * 10 to 110, has its centre at (60, 60), the centre of the box, so centring
 * the 120 box in a tile centres the ink (8.7). If that file changes, this must
 * change with it (it is one of the mark's five places, CLAUDE.md).
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
const OUTER = { x: 62.15, y: 60, r: 50 };
const INNER = { x: OUTER.x + 18 * Math.cos(Math.PI / 6), y: OUTER.y - 18 * Math.sin(Math.PI / 6), r: 42 };   // (77.738, 51)
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

/*
 * ─── ORBIT'S TILE (Nov 2026): a glass crescent on an indigo black squircle ──
 *
 * The squircle is a superellipse of exponent 5 filling the icon (a radius of
 * 0 asks for the full square, for a platform that rounds or crops its own).
 * Three ways by size, each drawn from the same two circles:
 *
 *   64 and up   GLASS: the ground falling from #1D1B45 to #060510 with an
 *               indigo haze at its top left, three faint stars, a soft indigo
 *               glow under the crescent, the crescent lit from its top left
 *               (white to #3A40B4) with the shade's own darkening along its
 *               inner edge, a specular line on its outer edge, and a faint rim
 *               round the tile
 *   32 to 48    the same ground and crescent, nothing finer, which would only
 *               be mud at these sizes
 *   16 to 24    FLAT: the crescent in #9AA8FF on #14132A, crisp, at the
 *               larger share these sizes need (markShare)
 *
 * The tray's icons are the crescent alone and are not drawn here (draw's
 * tile false). Every colour is the icon's own, as the prototype's #brand
 * drew it; none of them is a renderer token, so check:palette is not asked.
 */
const ORBIT = {
  ground: [[0, [0x1D, 0x1B, 0x45]], [0.55, [0x0D, 0x0C, 0x1F]], [1, [0x06, 0x05, 0x10]]],
  haze: { x: 0.28, y: 0.2, r: 0.75, rgb: [0x6F, 0x85, 0xFF], a: 0.42 },
  body: { a: [18, 18], b: [98, 108], stops: [[0, [0xFF, 0xFF, 0xFF]], [0.3, [0xC9, 0xD1, 0xFF]], [0.68, [0x73, 0x89, 0xFF]], [1, [0x3A, 0x40, 0xB4]]] },
  shade: { rgb: [0x16, 0x12, 0x4A], a: 0.7, from: 0.56, to: 0.7, r: 72 },
  glow: { rgb: [0x51, 0x6A, 0xF6], a: 0.55, dx: 2, dy: 6, sigma: 7 },
  spec: { inner: { x: 63.75, y: 63.2, r: 48.4 }, a: [20, 14], b: [60, 104], stops: [[0, 0.95], [0.55, 0.35], [1, 0]] },
  shine: { x: 36, y: 40, rx: 9, ry: 16, rot: Math.PI / 6, a: 0.28 },
  rim: { top: [0xE6, 0xE9, 0xFF], foot: [0xCB, 0xD0, 0xEB], stops: [[0, 0.34], [0.4, 0.08], [1, 0.05]], width: 1.6 / 256 },
  stars: [[196, 58, 1.6, 0.55], [214, 104, 1.1, 0.4], [58, 206, 1.2, 0.35]],
  flat: { ground: [0x14, 0x13, 0x2A], ink: [0x9A, 0xA8, 0xFF] },
  exp: 5,
};
/** The tile's way at a size: 'glass' from 64, 'mid' from 32, 'flat' under. */
const tierOf = (size) => (size >= 64 ? 'glass' : size >= 32 ? 'mid' : 'flat');
/** The crescent's diameter as a share of the tile, and how far below centre it sits, by way. */
const ORBIT_SHARE = { glass: 0.594, mid: 0.625 };
const ORBIT_DROP = { glass: 4 / 256, mid: 4 / 256, flat: 0 };

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** A gradient's colour (or number) at t, its stops [[at, value]]. */
function stopAt(stops, t) {
  t = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a0, v0] = stops[i - 1], [a1, v1] = stops[i];
      const k = a1 > a0 ? (t - a0) / (a1 - a0) : 0;
      return Array.isArray(v0) ? mix(v0, v1, k) : v0 + (v1 - v0) * k;
    }
  }
  return stops[stops.length - 1][1];
}
/** The superellipse's own measure at a pixel point: under 1 is inside the squircle. */
const squircleAt = (x, y, size) => Math.pow(Math.abs((2 * x) / size - 1), ORBIT.exp) + Math.pow(Math.abs((2 * y) / size - 1), ORBIT.exp);
/** The point's place along a linear gradient from a to b, 0 to 1 past its ends. */
const along = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; return clamp01(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)); };

/** A separable gaussian blur of a size x size map, sigma in pixels. */
function blur(map, size, sigma) {
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(rad * 2 + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float64Array(size * size), out = new Float64Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) { const xx = x + i; if (xx >= 0 && xx < size) s += map[y * size + xx] * k[i + rad]; }
    tmp[y * size + x] = s;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) { const yy = y + i; if (yy >= 0 && yy < size) s += tmp[yy * size + x] * k[i + rad]; }
    out[y * size + x] = s;
  }
  return out;
}

/** RGBA pixels of Orbit's tile at `size` (radius 0: the full square, no squircle). */
function drawOrbitTile(size, radius = TILE_RADIUS) {
  const tier = tierOf(size);
  const square = radius <= 0;
  const share = tier === 'flat' ? markShare(size) : ORBIT_SHARE[tier];
  const unitsPerPx = 100 / (share * size);
  const ox = (size - 120 / unitsPerPx) / 2;
  const oy = ox + ORBIT_DROP[tier] * size;
  const toGrid = (x, y) => [(x - ox) * unitsPerPx, (y - oy) * unitsPerPx];
  const S = size <= 64 ? 8 : 4;
  const inside = (x, y) => square ? (x >= 0 && y >= 0 && x <= size && y <= size) : squircleAt(x, y, size) <= 1;

  // The glow: the crescent's cover, moved down and right, blurred, at pixel scale.
  let glow = null;
  if (tier === 'glass') {
    const g = ORBIT.glow;
    const cover = new Float64Array(size * size);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      let m = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const [u, v] = toGrid(px + (sx + 0.5) / S, py + (sy + 0.5) / S);
        if (inCrescent(u - g.dx, v - g.dy)) m++;
      }
      cover[py * size + px] = m / (S * S);
    }
    glow = blur(cover, size, g.sigma / unitsPerPx);
  }
  const stars = ORBIT.stars.map(([x, y, r, a]) => [(x / 256) * size, (y / 256) * size, Math.max(0.5, (r / 256) * size), a]);
  const rimW = ORBIT.rim.width * 2;   // in the superellipse's own measure, near its edge

  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = pxl + (sx + 0.5) / S, y = py + (sy + 0.5) / S;
          if (!inside(x, y)) continue;
          n++;
          const [u, v] = toGrid(x, y);
          let c;
          if (tier === 'flat') {
            c = inCrescent(u, v) ? ORBIT.flat.ink : ORBIT.flat.ground;
          } else {
            c = stopAt(ORBIT.ground, y / size);
            const h = ORBIT.haze, hd = Math.hypot(x / size - h.x, y / size - h.y) / h.r;
            c = mix(c, h.rgb, h.a * clamp01(1 - hd));
            if (tier === 'glass') {
              for (const [sx0, sy0, sr, sa] of stars) if (Math.hypot(x - sx0, y - sy0) <= sr) c = mix(c, [255, 255, 255], sa);
              c = mix(c, ORBIT.glow.rgb, ORBIT.glow.a * Math.min(1, glow[py * size + pxl]));
            }
            if (inCrescent(u, v)) {
              let body = stopAt(ORBIT.body.stops, along([u, v], ORBIT.body.a, ORBIT.body.b));
              const sd = Math.hypot(u - INNER.x, v - INNER.y) / ORBIT.shade.r;
              const sh = sd <= ORBIT.shade.from ? ORBIT.shade.a : sd >= ORBIT.shade.to ? 0 : ORBIT.shade.a * (1 - (sd - ORBIT.shade.from) / (ORBIT.shade.to - ORBIT.shade.from));
              body = mix(body, ORBIT.shade.rgb, sh);
              if (tier === 'glass') {
                const si = ORBIT.spec.inner;
                if ((u - si.x) ** 2 + (v - si.y) ** 2 > si.r * si.r) body = mix(body, [255, 255, 255], stopAt(ORBIT.spec.stops, along([u, v], ORBIT.spec.a, ORBIT.spec.b)));
                if (size >= 96) {
                  const s = ORBIT.shine, cs = Math.cos(s.rot), sn = Math.sin(s.rot);
                  const ex = ((u - s.x) * cs + (v - s.y) * sn) / s.rx, ey = (-(u - s.x) * sn + (v - s.y) * cs) / s.ry;
                  const e = Math.sqrt(ex * ex + ey * ey);
                  const t = clamp01((1.35 - e) / 0.75);
                  body = mix(body, [255, 255, 255], s.a * t * t * (3 - 2 * t));
                }
              }
              c = body;
            }
            if (tier === 'glass' && !square) {
              const f = Math.pow(squircleAt(x, y, size), 1 / ORBIT.exp);
              if (f > 1 - rimW) c = mix(c, mix(ORBIT.rim.top, ORBIT.rim.foot, clamp01(y / size / 0.4)), stopAt(ORBIT.rim.stops, y / size));
            }
          }
          r += c[0]; gg += c[1]; b += c[2];
        }
      }
      const i = (py * size + pxl) * 4;
      if (n) { px[i] = Math.round(r / n); px[i + 1] = Math.round(gg / n); px[i + 2] = Math.round(b / n); }
      px[i + 3] = Math.round((n / (S * S)) * 255);
    }
  }
  return px;
}

/*
 * ─── THE SPLASH'S PICTURES (Orbit) ─────────────────────────────────────────
 * The splash draws no gradient (check:palette) and runs no script (its CSP),
 * so its glass comes from three pictures drawn here, from the same circles:
 *
 *   splash/ground.png  the card's ground: the tile's indigo falling to the
 *                      ground with its haze, and a few faint stars
 *   splash/glass.png   the 120 box with the whole disc lit as the tile's
 *                      crescent is, the shade's darkening where the shade
 *                      comes to rest; the splash's mask reveals the crescent
 *   splash/glow.png    the indigo glow under the crescent, the 120 box with
 *                      GLOW_PAD units round it for the blur to fall into
 */
const SPLASH_STARS = [[0.17, 0.14, 1.1, 0.5], [0.83, 0.11, 0.9, 0.42], [0.91, 0.38, 0.8, 0.32], [0.08, 0.62, 0.8, 0.28], [0.76, 0.84, 1, 0.3], [0.29, 0.9, 0.7, 0.24], [0.61, 0.2, 0.7, 0.3]];
const GLOW_PAD = 30;

/** The splash card's ground, size x size. */
function drawSplashGround(size) {
  const px = Buffer.alloc(size * size * 4);
  const stars = SPLASH_STARS.map(([x, y, r, a]) => [x * size, y * size, (r / 340) * size * 1.4, a]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let c = stopAt(ORBIT.ground, (y + 0.5) / size);
    const h = ORBIT.haze, hd = Math.hypot((x + 0.5) / size - h.x, (y + 0.5) / size - h.y) / h.r;
    c = mix(c, h.rgb, h.a * 0.8 * clamp01(1 - hd));
    for (const [sx, sy, sr, sa] of stars) {
      const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      if (d < sr + 1) c = mix(c, [255, 255, 255], sa * clamp01(sr + 0.5 - d));
    }
    const i = (y * size + x) * 4;
    px[i] = Math.round(c[0]); px[i + 1] = Math.round(c[1]); px[i + 2] = Math.round(c[2]); px[i + 3] = 255;
  }
  return px;
}

/** The whole disc of the mark lit as glass, in the 120 box at size x size; outside it, nothing. */
function drawGlassDisc(size) {
  const S = 4, k = 120 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let pxl = 0; pxl < size; pxl++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (pxl + (sx + 0.5) / S) * k, v = (py + (sy + 0.5) / S) * k;
      if ((u - OUTER.x) ** 2 + (v - OUTER.y) ** 2 > OUTER.r * OUTER.r) continue;
      n++;
      let c = stopAt(ORBIT.body.stops, along([u, v], ORBIT.body.a, ORBIT.body.b));
      const sd = Math.hypot(u - INNER.x, v - INNER.y) / ORBIT.shade.r;
      const sh = sd <= ORBIT.shade.from ? ORBIT.shade.a : sd >= ORBIT.shade.to ? 0 : ORBIT.shade.a * (1 - (sd - ORBIT.shade.from) / (ORBIT.shade.to - ORBIT.shade.from));
      c = mix(c, ORBIT.shade.rgb, sh);
      const si = ORBIT.spec.inner;
      if ((u - si.x) ** 2 + (v - si.y) ** 2 > si.r * si.r) c = mix(c, [255, 255, 255], stopAt(ORBIT.spec.stops, along([u, v], ORBIT.spec.a, ORBIT.spec.b)));
      const s = ORBIT.shine, cs = Math.cos(s.rot), sn = Math.sin(s.rot);
      const ex = ((u - s.x) * cs + (v - s.y) * sn) / s.rx, ey = (-(u - s.x) * sn + (v - s.y) * cs) / s.ry;
      const t = clamp01((1.35 - Math.sqrt(ex * ex + ey * ey)) / 0.75);
      c = mix(c, [255, 255, 255], s.a * t * t * (3 - 2 * t));
      r += c[0]; g += c[1]; b += c[2];
    }
    const i = (py * size + pxl) * 4;
    if (n) { px[i] = Math.round(r / n); px[i + 1] = Math.round(g / n); px[i + 2] = Math.round(b / n); }
    px[i + 3] = Math.round((n / (S * S)) * 255);
  }
  return px;
}

/** The glow under the crescent: the box from -GLOW_PAD to 120 + GLOW_PAD units, at size x size. */
function drawGlow(size) {
  const g = ORBIT.glow, span = 120 + 2 * GLOW_PAD, k = span / size, S = 4;
  const cover = new Float64Array(size * size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let m = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (px + (sx + 0.5) / S) * k - GLOW_PAD, v = (py + (sy + 0.5) / S) * k - GLOW_PAD;
      if (inCrescent(u - g.dx, v - g.dy)) m++;
    }
    cover[py * size + px] = m / (S * S);
  }
  const soft = blur(cover, size, g.sigma / k);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = g.rgb[0]; out[i * 4 + 1] = g.rgb[1]; out[i * 4 + 2] = g.rgb[2];
    out[i * 4 + 3] = Math.round(255 * g.a * Math.min(1, soft[i]));
  }
  return out;
}
const SPLASH = { ground: 680, glass: 240, glow: 360 };

/**
 * RGBA pixels: Orbit's tile (tile true), or the crescent alone in `ink`, the
 * tray's (tile false). `ink` and `share` speak to the crescent alone; the
 * tile's are its own (drawOrbitTile).
 */
function draw(size, tile, ink = INK, radius = TILE_RADIUS, share = markShare(size)) {
  if (tile) return drawOrbitTile(size, radius);
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
    + `  <rect width="120" height="120" rx="${120 * TILE_RADIUS}" fill="${hex(ORBIT.flat.ground)}"/>\n`
    + `  <path d="${tilePath(0.72)}" fill="${hex(ORBIT.flat.ink)}"/>\n`
    + '</svg>\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const APP = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const TRAY = [16, 20, 24, 32, 40, 48];

// Required (test:mark reads the geometry), it draws nothing and writes nothing.
module.exports = { OUTER, INNER, GROUND, INK, TILE_RADIUS, APP, TRAY, ORBIT, SPLASH, GLOW_PAD, inCrescent, markShare, tierOf, tilePath, faviconSvg, draw, drawSplashGround, drawGlassDisc, drawGlow, png, ico };
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
    const splash = path.join(assets, 'splash');
    fs.mkdirSync(splash, { recursive: true });
    fs.writeFileSync(path.join(splash, 'ground.png'), png(SPLASH.ground, drawSplashGround(SPLASH.ground)));
    fs.writeFileSync(path.join(splash, 'glass.png'), png(SPLASH.glass, drawGlassDisc(SPLASH.glass)));
    fs.writeFileSync(path.join(splash, 'glow.png'), png(SPLASH.glow, drawGlow(SPLASH.glow)));
    console.log(`splash/ground.png, glass.png and glow.png written to ${splash}`);
  }
}
