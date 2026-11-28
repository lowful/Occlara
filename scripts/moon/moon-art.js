'use strict';
// Full moon: the drawings. Every function returns SVG markup as a string; ids
// carry a prefix so many copies can live in one page.
const G = require('./moon-geometry');
const { LU, fx, CRATERS, craterShape, seaField, flatSeaField, SEA_FNS, contours, loopsToPath, ellField, rng } = G;

// ---------------------------------------------------------------------------
// The seas, traced once.
const SEA_LOOPS = contours((x, y) => seaField(SEA_FNS, x, y), 1.0, 520);
const CORE_LOOPS = contours((x, y) => seaField(SEA_FNS, x, y) - 0.32, 1.0, 520);
const seaPath = (cx, cy, R, eps) => loopsToPath(SEA_LOOPS, cx, cy, R, eps || 0.0012, 0.4);
const corePath = (cx, cy, R, eps) => loopsToPath(CORE_LOOPS, cx, cy, R, eps || 0.002, 0.4);

// An ellipse as path data, no transform, so user space gradients stay put.
function ell(cx, cy, rx, ry, rot) {
  const c = Math.cos(rot * G.RAD), s = Math.sin(rot * G.RAD);
  const a = [cx + rx * c, cy + rx * s], b = [cx - rx * c, cy - rx * s];
  return `M${fx(a[0])} ${fx(a[1])}A${fx(rx)} ${fx(ry)} ${fx(rot)} 1 1 ${fx(b[0])} ${fx(b[1])}A${fx(rx)} ${fx(ry)} ${fx(rot)} 1 1 ${fx(a[0])} ${fx(a[1])}Z`;
}

// One crater lit from the upper left: an apron lit on the near side and
// shaded on the far side, a bowl whose near wall is in shadow (a crescent:
// the bowl less the bowl moved away from the light) and whose far wall
// catches the light (the bowl less the bowl moved toward it), and a crest.
function crater(p, i, cx, cy, rx, ry, rot, k) {
  const id = `${p}c${i}`, m = Math.min(rx, ry);
  const s1 = 0.36 * m, s2 = 0.24 * m;
  const away = [-LU[0] * s1, -LU[1] * s1], toward = [LU[0] * s2, LU[1] * s2];
  const R1 = Math.max(rx, ry) * 1.34;
  const g = (x, y) => `x1="${fx(cx + LU[0] * x)}" y1="${fx(cy + LU[1] * x)}" x2="${fx(cx - LU[0] * y)}" y2="${fx(cy - LU[1] * y)}"`;
  const blur = m > 6 ? `${p}bl` : m > 3 ? `${p}bm` : `${p}bs`;
  return `<clipPath id="${id}k"><path d="${ell(cx, cy, rx, ry, rot)}"/></clipPath>` +
    `<linearGradient id="${id}a" gradientUnits="userSpaceOnUse" ${g(R1, R1)}><stop offset="0" stop-color="#fff" stop-opacity="${0.4 * k}"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".58" stop-color="#0b0d29" stop-opacity="0"/><stop offset="1" stop-color="#0b0d29" stop-opacity="${0.3 * k}"/></linearGradient>` +
    `<linearGradient id="${id}r" gradientUnits="userSpaceOnUse" ${g(m, m)}><stop offset="0" stop-color="#fff" stop-opacity="${0.8 * k}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<path d="${ell(cx, cy, rx * 1.3, ry * 1.3, rot)}" fill="url(#${id}a)" filter="url(#${p}ba)"/>` +
    `<g filter="url(#${blur})">` +
    `<path d="${ell(cx, cy, rx, ry, rot)}" fill="#2a2e52" fill-opacity="${0.16 * k}"/>` +
    `<path d="${ell(cx, cy, rx, ry, rot)}${ell(cx + away[0], cy + away[1], rx, ry, rot)}" fill-rule="evenodd" clip-path="url(#${id}k)" fill="#0d0f2e" fill-opacity="${0.62 * k}"/>` +
    `<path d="${ell(cx, cy, rx, ry, rot)}${ell(cx + toward[0], cy + toward[1], rx, ry, rot)}" fill-rule="evenodd" clip-path="url(#${id}k)" fill="#fff" fill-opacity="${0.55 * k}"/>` +
    `<path d="${ell(cx, cy, rx, ry, rot)}" fill="none" stroke="url(#${id}r)" stroke-width="${fx(Math.max(0.5, m * 0.09))}"/>` +
    `</g>`;
}

// The crater field of the rich drawing: small, many, mostly on the highlands.
function speckList(n, seed) {
  const r = rng(seed), out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.95;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const sea = seaField(SEA_FNS, x, y);
    if (sea > -0.08 && r() < 0.8) continue;
    // More of them in the south, as on the real moon.
    if (y < 0.1 && r() < 0.45) continue;
    const z = Math.sqrt(1 - d * d);
    const rr = 0.008 + Math.pow(r(), 2.2) * 0.02;
    out.push({ x, y, rx: rr * Math.max(0.25, z), ry: rr, rot: Math.atan2(y, x) / G.RAD });
  }
  return out;
}
const SPECKS = speckList(150, 91);

// The rays of Tycho, faint, in the rich drawing only.
function rays(p, R) {
  const t = craterShape(-43.3, -11.2, 4.4);
  const cx = t.x * R, cy = t.y * R, r = rng(5);
  let d = '';
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + r() * 0.3;
    const len = R * (0.28 + r() * 0.62), w = R * (0.012 + r() * 0.012);
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
    const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    d += `M${fx(cx + nx)} ${fx(cy + ny)}L${fx(ex)} ${fx(ey)}L${fx(cx - nx)} ${fx(cy - ny)}Z`;
  }
  return `<path d="${d}" fill="#fff" fill-opacity=".22" filter="url(#${p}br)"/>`;
}

// ---------------------------------------------------------------------------
// The moon in colour, centred on (0, 0) with radius 100.
// o.level 'clean' or 'rich'; o.grain; o.halo (0 to 1); o.specks (count)
function moon(p, o) {
  o = Object.assign({ level: 'clean', grain: true, halo: 1, specks: 0, rays: false, limb: 1, rimW: 1.3 }, o);
  const R = 100;
  const sx = LU[0] * 55, sy = LU[1] * 55; // where the light falls straightest
  const list = CRATERS.filter((c) => c[4].includes(o.level === 'rich' ? 'r' : 'c'));
  let craters = '';
  list.forEach((c, i) => {
    const e = craterShape(c[1], c[2], c[3]);
    craters += crater(p, i, e.x * R, e.y * R, e.rx * R, e.ry * R, e.rot, 1);
  });
  let specks = '';
  if (o.specks) {
    let dark = '', light = '';
    SPECKS.slice(0, o.specks).forEach((s) => {
      const cx = s.x * R, cy = s.y * R, rx = s.rx * R, ry = s.ry * R, m = Math.min(rx, ry);
      dark += ell(cx + LU[0] * m * 0.22, cy + LU[1] * m * 0.22, rx * 0.9, ry * 0.9, s.rot);
      light += ell(cx - LU[0] * m * 0.42, cy - LU[1] * m * 0.42, rx * 0.6, ry * 0.6, s.rot);
    });
    specks = `<g filter="url(#${p}bs)"><path d="${dark}" fill="#14173a" fill-opacity=".34"/><path d="${light}" fill="#fff" fill-opacity=".3"/></g>`;
  }
  const grain = o.grain ? `<rect x="-100" y="-100" width="200" height="200" filter="url(#${p}gr)" opacity="${o.level === 'rich' ? 0.26 : 0.18}"/>` : '';
  const halo = o.halo ? `<circle r="101" fill="#516af6" opacity="${fx(0.3 * o.halo)}" filter="url(#${p}hb)"/><circle r="100.4" fill="none" stroke="#6f85ff" stroke-width="1.6" opacity="${fx(0.32 * o.halo)}" filter="url(#${p}hs)"/>` : '';

  return `<g style="isolation:isolate"><defs>
<clipPath id="${p}d"><circle r="100"/></clipPath>
<radialGradient id="${p}al" gradientUnits="userSpaceOnUse" cx="${fx(sx * 0.6)}" cy="${fx(sy * 0.6)}" r="150"><stop offset="0" stop-color="#f5f5f8"/><stop offset=".55" stop-color="#e4e5ea"/><stop offset="1" stop-color="#d0d1da"/></radialGradient>
<radialGradient id="${p}sh" gradientUnits="userSpaceOnUse" cx="${fx(sx)}" cy="${fx(sy)}" r="160"><stop offset="0" stop-color="#fff"/><stop offset=".42" stop-color="#fafbfe"/><stop offset=".56" stop-color="#e4e6f3"/><stop offset=".66" stop-color="#c3c7e4"/><stop offset=".75" stop-color="#8188c2"/><stop offset=".83" stop-color="#474e96"/><stop offset=".91" stop-color="#23285f"/><stop offset="1" stop-color="#101233"/></radialGradient>
<radialGradient id="${p}lg" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="100"><stop offset=".78" stop-color="#6f85ff" stop-opacity="0"/><stop offset=".93" stop-color="#6f85ff" stop-opacity=".16"/><stop offset="1" stop-color="#9aa8ff" stop-opacity=".5"/></radialGradient>
<linearGradient id="${p}lm" gradientUnits="userSpaceOnUse" x1="${fx(LU[0] * 100)}" y1="${fx(LU[1] * 100)}" x2="${fx(-LU[0] * 100)}" y2="${fx(-LU[1] * 100)}"><stop offset=".35" stop-color="#000"/><stop offset=".85" stop-color="#fff"/></linearGradient>
<mask id="${p}m" maskUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200"><rect x="-100" y="-100" width="200" height="200" fill="url(#${p}lm)"/></mask>
<linearGradient id="${p}rim" gradientUnits="userSpaceOnUse" x1="${fx(LU[0] * 100)}" y1="${fx(LU[1] * 100)}" x2="${fx(-LU[0] * 100)}" y2="${fx(-LU[1] * 100)}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".22" stop-color="#fff" stop-opacity=".55"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="${p}bs" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".28"/></filter>
<filter id="${p}bm" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".45"/></filter>
<filter id="${p}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation=".7"/></filter>
<filter id="${p}ba" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="${p}br" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="${p}be" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".5"/></filter>
<filter id="${p}bc" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="${p}hb" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="${p}hs" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>
<filter id="${p}st" filterUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="4" seed="21" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.5 0 0 0 -.2" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in" result="t"/><feGaussianBlur in="t" stdDeviation=".45"/></filter>
<filter id="${p}mo" filterUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".024" numOctaves="4" seed="9"/><feColorMatrix type="matrix" values="0 0 0 0 .16  0 0 0 0 .165  0 0 0 0 .22  -2.4 0 0 0 1.3"/></filter>
<filter id="${p}gr" filterUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4" result="t"/><feColorMatrix in="t" type="matrix" values="0 0 0 0 .08  0 0 0 0 .09  0 0 0 0 .2  -1.9 0 0 0 1.02" result="dk"/><feColorMatrix in="t" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 1.9 0 0 -1.0" result="lt"/><feMerge><feMergeNode in="dk"/><feMergeNode in="lt"/></feMerge></filter>
</defs>
${halo}
<g clip-path="url(#${p}d)">
<circle r="100" fill="url(#${p}al)"/>
<rect x="-100" y="-100" width="200" height="200" filter="url(#${p}mo)" opacity=".5"/>
${o.rays ? rays(p, R) : ''}
<path d="${seaPath(0, 0, R)}" fill="#3d4058" fill-opacity=".22" filter="url(#${p}be)"/>
<path d="${seaPath(0, 0, R)}" fill="#33364f" fill-opacity=".46" filter="url(#${p}st)"/>
<path d="${corePath(0, 0, R)}" fill="#262a4b" fill-opacity=".2" filter="url(#${p}bc)"/>
${craters}
${specks}
${grain}
<circle r="100" fill="url(#${p}sh)" style="mix-blend-mode:multiply"/>
<circle r="100" fill="url(#${p}lg)" mask="url(#${p}m)" style="mix-blend-mode:screen" opacity="${o.limb}"/>
<circle r="${fx(100 - o.rimW / 2)}" fill="none" stroke="url(#${p}rim)" stroke-width="${o.rimW}"/>
</g></g>`;
}

// ---------------------------------------------------------------------------
// The flat mark: one disc, its seas and the shadows of four craters cut out.
// Built on the 120 grid: disc R 50 at (60, 60). The seas are the real map at
// 0.9 scale, so a band of the disc always closes the outline.
const FLAT_SCALE = 0.9;
const FLAT_CRATERS = CRATERS.filter((c) => c[4].includes('f')).map((c) => {
  const e = craterShape(c[1], c[2], c[3]);
  return { name: c[0], x: e.x * FLAT_SCALE, y: e.y * FLAT_SCALE, rx: e.rx * FLAT_SCALE, ry: e.ry * FLAT_SCALE, rot: e.rot };
});
// A crater is a ring: its rim, less a circle 0.74 of its size moved 0.14 of
// its radius away from the light, so the ring is thick where the shadow falls
// and a hairline where the light does.
const FLAT_INNER = 0.74, FLAT_SHIFT = 0.14;
function flatCut(x, y) {
  const r = Math.hypot(x, y);
  let v = -1;
  const sx = x / FLAT_SCALE, sy = y / FLAT_SCALE;
  if (sx * sx + sy * sy < 1) v = Math.max(v, flatSeaField(sx, sy));
  for (const e of FLAT_CRATERS) {
    const m = Math.min(e.rx, e.ry) * FLAT_SHIFT;
    const inner = { x: e.x - LU[0] * m, y: e.y - LU[1] * m, rx: e.rx * FLAT_INNER, ry: e.ry * FLAT_INNER, rot: e.rot };
    v = Math.max(v, Math.min(ellField(e, x, y), -ellField(inner, x, y)));
  }
  return Math.min(v, 0.93 - r);
}
const FLAT_LOOPS = contours(flatCut, 1.0, 700);
const FLAT_HOLES = loopsToPath(FLAT_LOOPS, 60, 60, 50, 0.0009, 0.8);
const FLAT_D = `M10 60a50 50 0 1 0 100 0a50 50 0 1 0 -100 0Z${FLAT_HOLES}`;
const flatMark = (size, color, extra) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120" ${extra || ''}><path fill-rule="evenodd" fill="${color}" d="${FLAT_D}"/></svg>`;

module.exports = { moon, ell, seaPath, corePath, crater, flatMark, FLAT_D, FLAT_CRATERS, FLAT_SCALE, FLAT_SHIFT, FLAT_INNER, SEA_LOOPS };
