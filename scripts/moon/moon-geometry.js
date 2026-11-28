'use strict';
// Full moon: the geometry. The near side of the moon as seen from the north,
// its seas placed by their real latitude and longitude and projected onto the
// disc (orthographic), so the seas near the limb foreshorten as they do on the
// real moon. The seas are one implicit field; its outline is traced with
// marching squares into plain paths, so every drawing shares the same coast.
// Units: the disc is the unit circle, x to the right, y down.

const RAD = Math.PI / 180;
// The light comes from the upper left, 128 degrees round from the right.
const LIGHT_DEG = -128;
const LU = [Math.cos(LIGHT_DEG * RAD), Math.sin(LIGHT_DEG * RAD)]; // toward the light

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toScreen(latD, lonD) {
  const la = latD * RAD, lo = lonD * RAD;
  return [Math.cos(la) * Math.sin(lo), -Math.sin(la), Math.cos(la) * Math.cos(lo)];
}
function toLatLon(x, y) {
  const z2 = 1 - x * x - y * y;
  if (z2 <= 0) return null;
  return [Math.asin(-y), Math.atan2(x, Math.sqrt(z2))];
}
function distBrg(la0, lo0, la, lo) {
  const dlo = lo - lo0;
  const c = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(dlo);
  const d = Math.acos(Math.max(-1, Math.min(1, c)));
  const b = Math.atan2(Math.sin(dlo) * Math.cos(la), Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(dlo));
  return [d, b];
}

// The seas: [name, lat, lon, angular radius in degrees, wobble, seed, elongation, its bearing]
const SEAS = [
  ['Imbrium', 34, -17, 18, 0.16, 3, 1.0, 0],
  ['Imbrium W', 29, -28, 11.5, 0.18, 31, 1.0, 0],
  ['Serenitatis', 28, 17.5, 11, 0.10, 5, 1.0, 0],
  ['Tranquillitatis', 8, 31, 12.5, 0.24, 7, 1.15, 70],
  ['Tranquillitatis S', 1, 23, 8, 0.2, 71, 1.0, 0],
  ['Crisium', 17, 59, 8.6, 0.08, 11, 1.18, 90],
  ['Fecunditatis', -6, 51, 10.5, 0.22, 13, 1.35, 10],
  ['Nectaris', -15, 35, 6, 0.1, 17, 1.0, 0],
  ['Vaporum', 13.5, 4, 5.6, 0.2, 19, 1.3, 80],
  ['Aestuum', 11, -9, 4.6, 0.2, 83, 1.3, 90],
  ['Medii', 2, 1, 4.4, 0.2, 23, 1.3, 90],
  ['Procellarum N', 31, -52, 13, 0.22, 29, 1.25, 20],
  ['Procellarum', 12, -57, 15, 0.22, 37, 1.25, 10],
  ['Procellarum S', -3, -48, 11.5, 0.24, 41, 1.0, 0],
  ['Insularum', 8, -31, 9, 0.22, 43, 1.0, 0],
  ['Cognitum', -10, -24, 7, 0.2, 47, 1.0, 0],
  ['Nubium', -20.5, -16, 11, 0.2, 53, 1.2, 100],
  ['Humorum', -24, -39, 6.6, 0.1, 59, 1.0, 0],
  ['Frigoris W', 56, -30, 5, 0.16, 61, 2.0, 90],
  ['Frigoris', 57.5, -8, 4.8, 0.16, 67, 2.1, 90],
  ['Frigoris E', 57, 15, 4.4, 0.16, 73, 2.0, 90],
];
// The flat mark keeps four bodies of sea apart, as the real near side does:
// the western ocean with Imbrium, the eastern chain, Crisium, and Nubium.
const FLAT_GROUPS = {
  W: ['Imbrium', 'Imbrium W', 'Procellarum N', 'Procellarum', 'Procellarum S', 'Insularum'],
  E: ['Serenitatis', 'Tranquillitatis', 'Tranquillitatis S', 'Fecunditatis', 'Nectaris'],
  C: ['Crisium'],
  S: ['Nubium', 'Humorum', 'Cognitum'],
};

function seaFns(list) {
  return list.map(([name, lat, lon, rDeg, wob, seed, el, elb]) => {
    const r = rng(seed);
    const harm = [];
    for (let k = 2; k <= 11; k++) harm.push([k, (r() * 0.7 + 0.3) / Math.pow(k, 0.75), r() * Math.PI * 2]);
    const norm = harm.reduce((s, h) => s + h[1], 0);
    return { name, la0: lat * RAD, lo0: lon * RAD, rr: rDeg * RAD, wob, harm, norm, el, elb: elb * RAD };
  });
}
const SEA_FNS = seaFns(SEAS);
const FLAT_FNS = Object.fromEntries(Object.entries(FLAT_GROUPS).map(([k, names]) => [k,
  seaFns(SEAS.filter((s) => names.includes(s[0]))).map((f) => Object.assign(f, { wob: f.wob * 0.36, rr: f.rr * 0.85 }))]));
function flatSeaField(x, y) {
  let v = -1;
  // Within a body the seas blend wide (K 3.5), between bodies they stay apart.
  for (const k in FLAT_FNS) v = Math.max(v, seaField(FLAT_FNS[k], x, y, 3.5));
  return v;
}

// Positive inside a sea. Evaluated at a screen point of the unit disc.
function seaField(fns, x, y, K) {
  const ll = toLatLon(x, y);
  if (!ll) return -1;
  let sum = 0;
  K = K || 7;
  for (const s of fns) {
    const [d, b] = distBrg(s.la0, s.lo0, ll[0], ll[1]);
    if (d > s.rr * 2.2) continue;
    let w = 0;
    for (const [k, a, ph] of s.harm) w += a * Math.cos(k * b + ph);
    const c = Math.cos(b - s.elb);
    const re = s.rr * (1 + s.wob * w / s.norm) * (1 + (s.el - 1) * c * c);
    const v = (re - d) / re;
    sum += Math.exp(K * v);
  }
  return sum > 0 ? Math.max(-1, Math.log(sum) / K) : -1;
}

// Marching squares over [-ext, ext]^2, n cells a side, at the zero level of f.
function contours(f, ext, n) {
  const step = (2 * ext) / n;
  const V = new Float64Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V[j * (n + 1) + i] = f(-ext + i * step, -ext + j * step);
  const at = (i, j) => V[j * (n + 1) + i];
  const pt = new Map();
  const edgePoint = (key, i0, j0, i1, j1) => {
    if (pt.has(key)) return key;
    const a = at(i0, j0), b = at(i1, j1);
    const t = a / (a - b);
    pt.set(key, [-ext + (i0 + (i1 - i0) * t) * step, -ext + (j0 + (j1 - j0) * t) * step]);
    return key;
  };
  const next = new Map();
  const seg = (p, q) => { next.set(p, q); };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = at(i, j) > 0, b = at(i + 1, j) > 0, c = at(i + 1, j + 1) > 0, d = at(i, j + 1) > 0;
      const idx = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => edgePoint(`h${i},${j}`, i, j, i + 1, j);
      const R = () => edgePoint(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1);
      const B = () => edgePoint(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1);
      const L = () => edgePoint(`v${i},${j}`, i, j, i, j + 1);
      // Segments oriented so the inside is on the left.
      switch (idx) {
        case 1: seg(L(), T()); break;
        case 2: seg(T(), R()); break;
        case 3: seg(L(), R()); break;
        case 4: seg(R(), B()); break;
        case 5: { const ctr = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
          if (ctr) { seg(L(), B()); seg(R(), T()); } else { seg(L(), T()); seg(R(), B()); } break; }
        case 6: seg(T(), B()); break;
        case 7: seg(L(), B()); break;
        case 8: seg(B(), L()); break;
        case 9: seg(B(), T()); break;
        case 10: { const ctr = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
          if (ctr) { seg(T(), L()); seg(B(), R()); } else { seg(T(), R()); seg(B(), L()); } break; }
        case 11: seg(B(), R()); break;
        case 12: seg(R(), L()); break;
        case 13: seg(R(), T()); break;
        case 14: seg(T(), L()); break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(pt.get(k)); k = next.get(k); }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
  let md = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
    if (d > md) { md = d; mi = i; }
  }
  if (md <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(pts.slice(mi), eps));
}
function simplifyLoop(loop, eps) {
  // Split the closed loop at its farthest pair, simplify both halves.
  let far = 0, fd = 0;
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(loop.slice(0, far + 1), eps), b = rdp(loop.slice(far).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function area(loop) { let s = 0; for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }

// A loop to path data in the target frame: centre (cx, cy), radius R.
const fx = (v) => (Math.round(v * 100) / 100).toString();
function loopsToPath(loops, cx, cy, R, eps, minArea) {
  return loops
    .filter((l) => Math.abs(area(l)) * R * R >= (minArea || 0))
    .map((l) => {
      const s = simplifyLoop(l, eps);
      return 'M' + s.map((p) => fx(cx + p[0] * R) + ' ' + fx(cy + p[1] * R)).join('L') + 'Z';
    })
    .join('');
}

// The craters: [name, lat, lon, angular radius in degrees, levels: c clean, r rich, f flat]
const CRATERS = [
  ['Tycho', -43.3, -11.2, 5.4, 'crf'],
  ['Copernicus', 9.6, -20.1, 4.4, 'cr'],
  ['Clavius', -58.4, -14.4, 7.6, 'crf'],
  ['Highland', -28, 9, 6.2, 'crf'],
  ['Theophilus', -12.5, 25, 4.0, 'cr'],
  ['Plato', 51.6, -9.4, 3.4, 'r'],
  ['Petavius', -25.3, 60.4, 5.0, 'r'],
  ['Langrenus', -8.9, 60.9, 3.8, 'r'],
  ['Highland E', -47, 27, 4.6, 'rf'],
  ['Highland SE', -34, 43, 3.4, 'r'],
  ['Maginus', -50, -2, 3.4, 'r'],
  ['Posidonius', 41, 35, 3.2, 'r'],
  ['Kepler', 8.1, -38, 2.3, 'r'],
  ['Aristarchus', 23.7, -47.4, 2.2, 'r'],
];

// A crater on the disc: its centre, and the ellipse it foreshortens to.
function craterShape(lat, lon, rDeg) {
  const [x, y, z] = toScreen(lat, lon);
  const r = Math.sin(rDeg * RAD);
  return { x, y, rx: r * Math.max(0.18, z), ry: r, rot: Math.atan2(y, x) / RAD, z };
}

// Positive inside an ellipse.
function ellField(e, x, y, sx, sy, k) {
  const c = Math.cos(e.rot * RAD), s = Math.sin(e.rot * RAD);
  const dx = x - (e.x + (sx || 0)), dy = y - (e.y + (sy || 0));
  const u = (dx * c + dy * s) / (e.rx * (k || 1)), v = (-dx * s + dy * c) / (e.ry * (k || 1));
  return 1 - Math.sqrt(u * u + v * v);
}

module.exports = { RAD, LU, LIGHT_DEG, rng, toScreen, toLatLon, SEAS, SEA_FNS, seaField, flatSeaField, FLAT_GROUPS, contours, loopsToPath, simplifyLoop, CRATERS, craterShape, ellField, fx, area };
