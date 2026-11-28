'use strict';
// THE FULL MOON'S DRAWINGS (Nov 2026), the owner's logo, the CLEAN level.
// Copied byte for byte from the design (logos/full-moon/make.js, lines 11 to
// 158 and the mark file at 532 to 554); only this header and the exports are
// added. moon-geometry.js and moon-art.js beside it are the design's own files,
// unchanged. Never redraw the moon here: change the design and copy again.
// scripts/generate-icon.js renders these; test:mark holds them to the design.
const G = require('./moon-geometry');
const A = require('./moon-art');
const { LU, fx, rng } = G;
// ---------------------------------------------------------------------------
// Shapes shared by the icons.
function squircle(cx, cy, w, n) {
  const a = w / 2, pts = [];
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), cy + a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  return 'M' + pts.map((p) => fx(p[0]) + ' ' + fx(p[1])).join('L') + 'Z';
}
const circ = (cx, cy, r) => `M${fx(cx - r)} ${fx(cy)}a${fx(r)} ${fx(r)} 0 1 0 ${fx(2 * r)} 0a${fx(r)} ${fx(r)} 0 1 0 ${fx(-2 * r)} 0Z`;
const rrect = (x, y, w, h, r) => `M${fx(x + r)} ${fx(y)}h${fx(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${fx(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${fx(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${fx(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
// A pixel map: rows of characters, each character a pixel. Returns path data per character.
function pixels(rows, x0, y0) {
  const out = {};
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') out[ch] = (out[ch] || '') + `M${x0 + x} ${y0 + y}h1v1h-1Z`; }));
  return out;
}

// The tile every app icon sits on: indigo black glass, lit from the upper left.
function tileDefs(p, sq) {
  return `<clipPath id="${p}sq"><path d="${sq}"/></clipPath>
<linearGradient id="${p}gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23215b"/><stop offset=".52" stop-color="#100f2b"/><stop offset="1" stop-color="#070612"/></linearGradient>
<radialGradient id="${p}hz" cx=".2" cy=".1" r=".9"><stop offset="0" stop-color="#7b8fff" stop-opacity=".42"/><stop offset=".55" stop-color="#6f85ff" stop-opacity=".08"/><stop offset="1" stop-color="#6f85ff" stop-opacity="0"/></radialGradient>
<radialGradient id="${p}fl" cx=".72" cy="1.04" r=".7"><stop offset="0" stop-color="#516af6" stop-opacity=".3"/><stop offset="1" stop-color="#516af6" stop-opacity="0"/></radialGradient>
<linearGradient id="${p}rm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3ff" stop-opacity=".55"/><stop offset=".3" stop-color="#cbd0eb" stop-opacity=".13"/><stop offset="1" stop-color="#cbd0eb" stop-opacity=".07"/></linearGradient>
<linearGradient id="${p}sn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".11"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
}
function tileGround(p, W) {
  return `<rect width="${W}" height="${W}" fill="url(#${p}gr)"/><rect width="${W}" height="${W}" fill="url(#${p}hz)"/><rect width="${W}" height="${W}" fill="url(#${p}fl)"/>`;
}

// 256 and 64: the drawn moon on the glass tile.
function appIcon(p, size, small) {
  const sq = squircle(128, 128, 240, 5);
  const moon = small
    ? A.moon(p + 'm', { level: 'clean', grain: false, specks: 0, halo: 1.5, rimW: 3.2 })
    : A.moon(p + 'm', { level: 'clean', grain: true, specks: 40, halo: 1.3, rimW: 1.6 });
  const r = rng(77);
  let stars = '';
  const spots = [[40, 46], [214, 40], [222, 206], [36, 214], [196, 228], [62, 178], [226, 112], [118, 30]];
  if (!small) spots.forEach(([x, y]) => { stars += `<circle cx="${x}" cy="${y}" r="${fx(0.7 + r() * 0.8)}" fill="#fff" opacity="${fx(0.35 + r() * 0.45)}"/>`; });
  return `<svg ${XMLNS} width="${size}" height="${size}" viewBox="0 0 256 256"><defs>${tileDefs(p, sq)}</defs>
<g clip-path="url(#${p}sq)">${tileGround(p, 256)}${stars}
<g transform="translate(128 128) scale(.76)">${moon}</g>
<rect width="256" height="128" fill="url(#${p}sn)"/></g>
<path d="${sq}" fill="none" stroke="url(#${p}rm)" stroke-width="${small ? 3.4 : 1.6}"/></svg>`;
}

// The small moons, drawn for their size: silver albedo, the seas, a few
// crater marks, then the same indigo shade multiplied over, the lit limb and
// a little halo. cr: [x, y, r] in the target's own units.
function smallMoon(p, cx, cy, R, o) {
  const sx = cx + LU[0] * R * 0.55, sy = cy + LU[1] * R * 0.55;
  let craters = '';
  (o.craters || []).forEach(([x, y, r, k]) => {
    k = k || 1;
    craters += `<circle cx="${fx(x + LU[0] * r * 0.3)}" cy="${fx(y + LU[1] * r * 0.3)}" r="${fx(r * 0.86)}" fill="#14163a" fill-opacity="${fx(0.55 * k)}"/>` +
      `<circle cx="${fx(x - LU[0] * r * 0.5)}" cy="${fx(y - LU[1] * r * 0.5)}" r="${fx(r * 0.55)}" fill="#fff" fill-opacity="${fx(0.6 * k)}"/>`;
  });
  const seas = o.seas === 'map' ? `<path d="${A.seaPath(cx, cy, R, o.eps || 0.01)}" fill="#33364f" fill-opacity="${o.seaOp || 0.5}"/>` : (o.seas || '');
  return `<defs>
<clipPath id="${p}d"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
<radialGradient id="${p}sh" gradientUnits="userSpaceOnUse" cx="${fx(sx)}" cy="${fx(sy)}" r="${fx(R * 1.6)}"><stop offset="0" stop-color="#fff"/><stop offset=".42" stop-color="#fafbfe"/><stop offset=".56" stop-color="#e4e6f3"/><stop offset=".66" stop-color="#c3c7e4"/><stop offset=".75" stop-color="#8188c2"/><stop offset=".83" stop-color="#474e96"/><stop offset=".91" stop-color="#23285f"/><stop offset="1" stop-color="#101233"/></radialGradient>
<linearGradient id="${p}rim" gradientUnits="userSpaceOnUse" x1="${fx(cx + LU[0] * R)}" y1="${fx(cy + LU[1] * R)}" x2="${fx(cx - LU[0] * R)}" y2="${fx(cy - LU[1] * R)}"><stop offset="0" stop-color="#fff" stop-opacity="${o.rimOp || 0.9}"/><stop offset=".25" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
${o.halo ? `<filter id="${p}hb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${o.halo[1]}"/></filter>` : ''}
</defs>
${o.halo ? `<circle cx="${cx}" cy="${cy}" r="${fx(R * 1.02)}" fill="#516af6" opacity="${o.halo[0]}" filter="url(#${p}hb)"/>` : ''}
<g clip-path="url(#${p}d)" style="isolation:isolate">
<circle cx="${cx}" cy="${cy}" r="${R}" fill="#e9eaef"/>
${seas}${craters}
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${p}sh)" style="mix-blend-mode:multiply"/>
${o.rimW ? `<circle cx="${cx}" cy="${cy}" r="${fx(R - o.rimW / 2)}" fill="none" stroke="url(#${p}rim)" stroke-width="${o.rimW}"/>` : ''}
</g>`;
}

// 32: its own drawing. The disc is 20 px, the seas are the real map at that
// size, and three craters: Tycho, Theophilus and Copernicus.
function icon32(p, size) {
  const sq = squircle(16, 16, 30, 5);
  const C = pixels([
    'dd..',
    'd...',
    '..w.',
  ], 16, 19);
  const T = pixels(['d.', '.w'], 14, 22), H = pixels(['d.', '.w'], 20, 17), K = pixels(['w'], 12, 14);
  const craters = `<path d="${C.d}${T.d}${H.d}" fill="#14163a" fill-opacity=".5"/><path d="${C.w}${T.w}${H.w}${K.w}" fill="#fff" fill-opacity=".62"/>`;
  const m = smallMoon(p + 'm', 16, 16, 10, {
    seas: `<path d="${A.seaPath(16, 16, 10, 0.008)}" fill="#33364f" fill-opacity=".5"/>${craters}`, rimW: 0.9, halo: [0.5, 0.9],
  });
  return `<svg ${XMLNS} width="${size || 32}" height="${size || 32}" viewBox="0 0 32 32"><defs>${tileDefs(p, sq)}</defs>
<g clip-path="url(#${p}sq)">${tileGround(p, 32)}${m}<rect width="32" height="16" fill="url(#${p}sn)"/></g>
<path d="${sq}" fill="none" stroke="url(#${p}rm)" stroke-width=".8"/></svg>`;
}

// 16: its own drawing. An 11 px disc; on whole pixels, the western ocean
// as one low, irregular sea hugging the west (Imbrium into Procellarum), a
// faint eastern sea, and one crater below the centre: a shadow pixel and a
// lit one.
const P16 = pixels([
  '................',
  '................',
  '................',
  '................',
  '.....tt.........',
  '....tsst.t......',
  '...tsst..tt.....',
  '...tt.....t.....',
  '....t...........',
  '.....tt.d.......',
  '.........w......',
  '................',
], 0, 0);
function icon16(p, size) {
  const sq = squircle(8, 8, 16, 5);
  const seas = `<path d="${P16.s}" fill="#2e3150" fill-opacity=".44"/><path d="${P16.t}" fill="#2e3150" fill-opacity=".24"/><path d="${P16.d}" fill="#14163a" fill-opacity=".55"/><path d="${P16.w}" fill="#fff" fill-opacity=".7"/>`;
  const m = smallMoon(p + 'm', 8, 8, 5.5, { seas, rimW: 0.7, rimOp: 0.85, halo: [0.55, 0.6] });
  return `<svg ${XMLNS} width="${size || 16}" height="${size || 16}" viewBox="0 0 16 16"><defs>${tileDefs(p, sq)}</defs>
<g clip-path="url(#${p}sq)">${tileGround(p, 16)}${m}</g>
<path d="${sq}" fill="none" stroke="url(#${p}rm)" stroke-width=".5"/></svg>`;
}

// The mark in a 56 px bar or a header pill: a 24 unit drawing, no tile.
function miniMark(p, size) {
  const m = smallMoon(p + 'm', 12, 12, 10.6, {
    seas: 'map', eps: 0.01, seaOp: 0.5, rimW: 0.8, halo: [0.55, 0.9],
    craters: [[10.5, 19.2, 1.35], [16.6, 15, 1.1]],
  });
  return `<svg ${XMLNS} width="${size}" height="${size}" viewBox="0 0 24 24">${m}</svg>`;
}

// The tray: one flat colour on the 16 grid. Idle: three cuts on the 14 px
// disc, each a different size at a different height so they never read as a
// face: the western ocean (Imbrium into Procellarum), the eastern sea
// (Tranquillitatis) and Tycho's crater. v1 and v2 were tried and set aside
// (an eye, a yin yang). Recording puts the moon, as the dot, inside the 1 px
// ring of the Start button's record glyph.
const TRAY_REC_D = circ(8, 8, 7) + circ(8, 8, 6) + circ(8, 8, 4);
const TRAY_V = {
  v1: circ(8, 8, 7) + 'M6.3 3.8C7.9 3.8 8.9 4.9 8.6 6.2C8.4 7.3 7.4 7.6 6.6 7.9C5.9 8.2 5.6 9 4.7 9C3.8 9 3.5 8 3.6 6.9C3.8 5.1 4.8 3.8 6.3 3.8Z' + circ(9.9, 11, 1.15),
  v2: circ(8, 8, 7) + 'M4.4 4.6C5.6 3.6 7.4 3.9 8.4 4.5C9.4 3.9 11 4.2 11.3 5.4C11.6 6.5 10.6 7 9.6 6.9C8.9 6.8 8.4 7.1 7.9 7.6C7.1 8.4 6.1 8.3 5.5 8.9C4.9 9.5 3.9 9.4 3.6 8.4C3.3 7.1 3.4 5.4 4.4 4.6Z' + circ(7.6, 11.4, 1.15),
  v3: circ(8, 8, 7) + 'M5.6 3.9C7 3.6 8.3 4.3 8.3 5.6C8.3 6.8 7.2 7.4 6.2 7.5C5.2 7.6 4.9 8.6 4.1 8.7C3.4 8.8 3.1 7.7 3.3 6.6C3.6 5.2 4.3 4.2 5.6 3.9Z' + 'M10.4 7.2C11.3 7 12.1 7.6 12 8.5C11.9 9.3 11.1 9.7 10.4 9.5C9.7 9.3 9.4 8.5 9.6 7.9C9.7 7.5 10 7.3 10.4 7.2Z' + circ(7.2, 11.6, 1.0),
};
const TRAY_IDLE_D = TRAY_V.v3;
const trayV = (k, color, size) => `<svg ${XMLNS} width="${size || 16}" height="${size || 16}" viewBox="0 0 16 16"><path fill-rule="evenodd" fill="${color}" d="${TRAY_V[k]}"/></svg>`;
const trayIdle = (color, size) => `<svg ${XMLNS} width="${size || 16}" height="${size || 16}" viewBox="0 0 16 16"><path fill-rule="evenodd" fill="${color}" d="${TRAY_IDLE_D}"/></svg>`;
const trayRec = (color, size) => `<svg ${XMLNS} width="${size || 16}" height="${size || 16}" viewBox="0 0 16 16"><path fill-rule="evenodd" fill="${color}" d="${TRAY_REC_D}"/></svg>`;

const markSvg = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" color="#F5F5F7" role="img" aria-label="Occlara">
<!--
  Occlara, full moon. One flat colour, one path, even odd fill.

  Construction on a 120 unit grid. The disc: a circle of radius 50 centred
  at (60, 60). The seas: the moon's own near side, each sea placed by its
  selenographic latitude and longitude and projected orthographically onto
  the disc, then drawn at 0.9 scale so a band of the disc always closes the
  outline. Four bodies of sea are kept apart as on the sky: the western
  ocean with Imbrium, the eastern chain from Serenitatis to Nectaris,
  Crisium, and Nubium with Humorum. The light comes from the upper left, 128
  degrees round from the right. Each of the four craters (Tycho, Clavius, a
  highland crater east of Nubium and one in the south east) is a ring: its
  rim less a circle 0.74 of its size moved 0.14 of its radius away from the
  light, thick where the shadow falls and a hairline where the light does.
  Craters near the limb foreshorten into ellipses, as on the real moon.

  Down to 20 px this file is the mark. At 16 px the tray drawing takes over
  (tray-idle.svg, tray-recording.svg), drawn on whole pixels.
-->
  <path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="${A.FLAT_D}"/>
</svg>
`;

module.exports = { squircle, circ, appIcon, smallMoon, icon32, icon16, miniMark, trayIdle, trayRec, TRAY_IDLE_D, TRAY_REC_D, markSvg, XMLNS };
