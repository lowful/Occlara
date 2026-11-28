'use strict';

/**
 * THE RATING VIDEO'S OVERLAY (docs/claude/rating.md "The video tool"), as an
 * ASS subtitle script the bundled ffmpeg draws with libass: shapes, text in
 * the app's own Geist (decoded by woff2.js), and motion on time, frame exact,
 * no browser and no Electron. The stream widget's broadcast look
 * (renderer/rating-widget): one plate on the app's surface with its rim and
 * shadow, the number on its tier's colour in the dark ink (on the app's 100
 * scale, 68 and never 6.8, countSteps), the move rising in
 * green or falling in red at the event's moment, the short label, and the
 * moon with "Occlara" so a clip carries the brand.
 *
 * Motion, as the widget's: the number counts to its new value in 0.42 s
 * (ease out), the badge's colour turns with it, the move slides in 14 px and
 * fades, the label rises 6 px and fades in. Nothing loops.
 *
 * Layout at 1080 rows is scaled by the height (and --scale). The default
 * corner, bottom left, ends at 0.86 of the height, clear of the minimap, the
 * kill feed, the health bar and the abilities; top right sits under the kill
 * feed, top left under the minimap and the voice list (layoutOf).
 */

// The app's tokens (renderer/shared/theme.css), as RGB.
const TOKENS = Object.freeze({
  s1: '#0B0D12', text: '#F5F5F7', mute: '#808086', ink: '#0A0B0E',
  good: '#52C88A', bad: '#E8636F',
  tier: { poor: '#E8636F', fair: '#D9A441', good: '#52C88A', great: '#3FC1AE', excellent: '#6E8BE0' },
});

const COUNT_S = 0.42;     // the number's count, var(--t-slow)
const MOVE_S = 0.42;      // the move's slide
const LABEL_IN_S = 0.22;  // the label's rise, var(--t-med)
const MOVE_HOLD_S = 2.8;  // the move stays this long
const LABEL_HOLD_S = 4.0; // the label stays this long (or until the next)
const FPS_STEP = 1 / 30;

/** '#RRGGBB' to ASS '&HBBGGRR&'. */
function col(hex) {
  const h = hex.replace('#', '');
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
}

/** Seconds to ASS 'H:MM:SS.cc'. */
function ts(t) {
  const c = Math.max(0, Math.round(t * 100));
  const h = Math.floor(c / 360000);
  const m = Math.floor((c % 360000) / 6000);
  const s = Math.floor((c % 6000) / 100);
  const cc = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/** A rounded rectangle as an ASS drawing, from its top left, in pixels. */
function roundRect(w, h, r) {
  const k = 0.5523 * r;
  const p = (x, y) => `${f1(x)} ${f1(y)}`;
  return [
    `m ${p(r, 0)}`, `l ${p(w - r, 0)}`, `b ${p(w - r + k, 0)} ${p(w, r - k)} ${p(w, r)}`,
    `l ${p(w, h - r)}`, `b ${p(w, h - r + k)} ${p(w - r + k, h)} ${p(w - r, h)}`,
    `l ${p(r, h)}`, `b ${p(r - k, h)} ${p(0, h - r + k)} ${p(0, h - r)}`,
    `l ${p(0, r)}`, `b ${p(0, r - k)} ${p(r - k, 0)} ${p(r, 0)}`,
  ].join(' ');
}

/*
 * THE MOON, a sixth drawing of the logo from its one source (scripts/moon,
 * the flat mark assets/logo-mark.svg is written from and test:mark holds it
 * to), so a change to the mark reaches the badge too: the disc of radius 50
 * at (60, 60) on the 120 unit grid, and its seas and craters cut from it.
 * The SVG cuts them by the even odd rule; an ASS drawing is filled by the
 * winding of its outlines, so each outline is turned to run against the one
 * it lies in, which cuts the same holes under either rule (a crater's ring
 * is a hole with its floor back inside it). The disc's two arcs are drawn as
 * 64 straight sides. Scaled to `size` pixels. (9.1: the full moon took the
 * crescent's place in every drawing of the mark.)
 */
const { FLAT_D } = require('../moon/moon-art');
const MOON_LOOPS = FLAT_D.split('M').filter((p) => p.trim()).map((part) => {
  const p = part.trim().replace(/Z$/, '');
  if (p.includes('a')) {
    const pts = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([60 + 50 * Math.cos(a), 60 + 50 * Math.sin(a)]); }
    return pts;
  }
  return p.split('L').map((xy) => xy.trim().split(' ').map(Number));
});
/** Twice the signed area of a loop: its sign is the way it runs. */
function loopArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}
/** Whether a point lies inside a loop (the crossing rule). */
function inLoop(pt, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** The loops as they are drawn: each run against the one it lies in. */
function moonLoops() {
  const disc = loopArea(MOON_LOOPS[0]) > 0;
  return MOON_LOOPS.map((pts, n) => {
    const depth = MOON_LOOPS.filter((o, m) => m !== n && inLoop(pts[0], o)).length;
    const want = depth % 2 === 0 ? disc : !disc;
    return (loopArea(pts) > 0) === want ? pts : pts.slice().reverse();
  });
}
function moonMark(size) {
  const k = size / 120;
  return moonLoops().map((pts) => pts.map(([x, y], i) => `${i ? 'l' : 'm'} ${f1(x * k)} ${f1(y * k)}`).join(' ')).join(' ');
}

/**
 * Where the plate goes and how big, for a W by H picture.
 * @param o.corner  'bottom-left' (default) | 'top-left' | 'top-right' | 'bottom-right' | 'vertical'
 * @param o.scale   a factor on the size (1)
 */
function layoutOf(W, H, opts) {
  const o = opts || {};
  const corner = o.corner || 'bottom-left';
  const scale = Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1;
  const s = (corner === 'vertical' ? W / 540 : H / 1080) * scale;
  const w = Math.round(430 * s);
  const h = Math.round(116 * s);
  let x;
  let y;
  const mx = Math.round(W * 0.022);
  if (corner === 'vertical') { x = Math.round((W - w) / 2); y = Math.round(H * 0.74); }
  else if (corner === 'top-left') { x = mx; y = Math.round(H * 0.5); }
  else if (corner === 'top-right') { x = W - mx - w; y = Math.round(H * 0.34); }
  else if (corner === 'bottom-right') { x = Math.round(W * 0.86) - w; y = Math.round(H * 0.86) - h; }
  else if (corner === 'bottom-left') { x = mx; y = Math.round(H * 0.86) - h; }
  else throw new Error(`--corner is bottom-left, top-left, top-right or bottom-right, not "${corner}"`);
  const pad = Math.round(12 * s);
  const bw = Math.round(132 * s);
  const badge = { x: x + pad, y: y + pad, w: bw, h: h - 2 * pad, r: Math.round(14 * s) };
  const colX = badge.x + bw + Math.round(18 * s);
  return {
    W, H, s, corner,
    plate: { x, y, w, h, r: Math.round(20 * s) },
    badge,
    num: { x: badge.x + bw / 2, y: badge.y + badge.h / 2, size: Math.round(72 * s) },
    delta: { x: colX, y: y + Math.round(30 * s), size: Math.round(28 * s), slide: Math.round(14 * s) },
    brand: { x: x + w - pad, y: y + Math.round(30 * s), size: Math.round(17 * s) },
    label: { x: colX, y: y + Math.round(80 * s), size: Math.round(27 * s), width: x + w - pad - colX, rise: Math.round(6 * s) },
  };
}

/** About how wide a label is in Geist SemiBold at `size` (0.56 em a letter, measured on the app's labels). */
function labelWidth(text, size) {
  let em = 0;
  for (const ch of String(text)) em += ch === ' ' ? 0.27 : /[mwMW]/.test(ch) ? 0.82 : /[ilj.,']/.test(ch) ? 0.28 : /[A-Z]/.test(ch) ? 0.66 : 0.56;
  return em * size;
}

const { tierOf, Display } = require('../../src/shared/rating');

/**
 * The count from one value to the next, ON THE APP'S 100 SCALE (9.1, the
 * owner's item 16, shared/display.js rating): 6.8 is drawn "68", as the
 * review, the live rating and its stream widget show it, so a clip made with
 * this tool never shows a number the app does not. The shown number at each
 * frame step, ease out, as [{ t, shown, value }] from t0, the first the old
 * value moved; `value` is the shown number back in the rating's own units,
 * for its tier.
 */
function countSteps(t0, from, to, until) {
  const out = [];
  const end = Math.min(t0 + COUNT_S, Number.isFinite(until) ? until : Infinity);
  let last = null;
  for (let t = t0; t < end - 1e-6; t += FPS_STEP) {
    const u = (t - t0) / COUNT_S;
    const v = from + (to - from) * (1 - Math.pow(1 - Math.min(1, u + FPS_STEP / COUNT_S), 3));
    const shown = Display.rating(v);
    if (shown !== last) { out.push({ t, shown, value: Display.ratingPoints(v) / 10 }); last = shown; }
  }
  const fin = Display.rating(to);
  if (last !== fin) out.push({ t: end, shown: fin, value: Display.ratingPoints(to) / 10 });
  return out;
}

/**
 * The ASS script for a plan on a W by H video `duration` seconds long.
 * @param plan    plan.js's { start, steps, final }
 * @param o.fullTime  seconds of "Full time" at the end (the video is that much longer), 0 for none
 */
function assOf(plan, W, H, duration, opts) {
  const o = opts || {};
  const L = layoutOf(W, H, o);
  const end = duration + (o.fullTime > 0 ? o.fullTime : 0);
  const lines = [];
  const ev = (layer, t0, t1, text) => { if (t1 > t0) lines.push(`Dialogue: ${layer},${ts(t0)},${ts(t1)},R,,0,0,0,,${text}`); };
  const P = L.plate;

  // The plate, its shadow and its rim, the whole video.
  ev(0, 0, end, `{\\an7\\pos(${P.x},${P.y + Math.round(8 * L.s)})\\p1\\bord0\\shad0\\blur${Math.round(14 * L.s)}\\1c&H000000&\\1a&H70&}${roundRect(P.w, P.h, P.r)}`);
  ev(1, 0, end, `{\\an7\\pos(${P.x},${P.y})\\p1\\bord${Math.max(1, Math.round(L.s))}\\shad0\\1c${col(TOKENS.s1)}\\1a&H14&\\3c&HFFFFFF&\\3a&HEC&}${roundRect(P.w, P.h, P.r)}`);

  // The brand: the moon and the word, on the move's line at the right.
  const cs = Math.round(L.brand.size * 0.95);
  const word = 'Occlara';
  const wordW = labelWidth(word, L.brand.size) * 0.98;
  ev(3, 0, end, `{\\an6\\pos(${L.brand.x},${L.brand.y})\\fn${FONT.medium}\\fs${L.brand.size}\\bord0\\shad0\\1c${col(TOKENS.mute)}}${word}`);
  ev(3, 0, end, `{\\an7\\pos(${Math.round(L.brand.x - wordW - cs - 6 * L.s)},${Math.round(L.brand.y - cs / 2)})\\p1\\bord0\\shad0\\1c${col(TOKENS.mute)}}${moonMark(cs)}`);

  // The number and the badge: a segment a shown value, each count frame its own.
  const B = L.badge;
  const marks = [{ t: 0, shown: Display.rating(plan.start), value: plan.start }];
  const steps = plan.steps.slice().sort((a, b) => a.t - b.t);
  let prev = plan.start;
  steps.forEach((s, i) => {
    const until = i + 1 < steps.length ? steps[i + 1].t : end;
    for (const c of countSteps(s.t, prev, s.value, until)) marks.push({ t: c.t, shown: c.shown, value: c.value });
    prev = s.value;
  });
  const ft = o.fullTime > 0 ? duration : null;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const t1 = i + 1 < marks.length ? marks[i + 1].t : end;
    ev(4, m.t, t1, `{\\an5\\pos(${Math.round(L.num.x)},${Math.round(L.num.y + L.num.size * 0.04)})\\fn${FONT.bold}\\b1\\fs${L.num.size}\\fsp${-(L.num.size * 0.04).toFixed(1)}\\bord0\\shad0\\1c${col(TOKENS.ink)}}${m.shown}`);
  }
  // The badge's colour: one segment a tier, turning into the next over the count.
  const tiers = [];
  for (const m of marks) { const tr = tierOf(m.value); if (!tiers.length || tiers[tiers.length - 1].tier !== tr) tiers.push({ t: m.t, tier: tr }); }
  for (let i = 0; i < tiers.length; i++) {
    const t0 = tiers[i].t;
    const t1 = i + 1 < tiers.length ? tiers[i + 1].t : end;
    const from = i ? TOKENS.tier[tiers[i - 1].tier] : TOKENS.tier[tiers[i].tier];
    const turn = i ? `\\t(0,${Math.round(COUNT_S * 1000)},\\1c${col(TOKENS.tier[tiers[i].tier])})` : '';
    ev(2, t0, t1, `{\\an7\\pos(${B.x},${B.y})\\p1\\bord0\\shad0\\1c${col(from)}${turn}}${roundRect(B.w, B.h, B.r)}`);
  }

  // The move and the label, at each step.
  steps.forEach((s, i) => {
    const next = i + 1 < steps.length ? steps[i + 1].t : (ft !== null ? ft : end);
    const D = L.delta;
    const from = s.up ? D.y + D.slide : D.y - D.slide;
    const mEnd = Math.min(s.t + MOVE_HOLD_S, next);
    if (s.up || s.down) ev(5, s.t, mEnd, `{\\an4\\move(${D.x},${from},${D.x},${D.y},0,${Math.round(MOVE_S * 1000)})\\fad(90,${mEnd - s.t > 0.6 ? 260 : 0})\\fn${FONT.mono}\\fs${D.size}\\bord0\\shad0\\1c${col(s.up ? TOKENS.good : TOKENS.bad)}}${s.delta}`);
    const Lb = L.label;
    const lEnd = Math.min(s.t + LABEL_HOLD_S, next);
    const fit = Math.min(1, Lb.width / Math.max(1, labelWidth(s.label, Lb.size)));
    ev(5, s.t, lEnd, `{\\an4\\move(${Lb.x},${Lb.y + Lb.rise},${Lb.x},${Lb.y},0,${Math.round(LABEL_IN_S * 1000)})\\fad(120,${lEnd - s.t > 0.6 ? 300 : 0})\\fn${FONT.semi}\\fs${Lb.size}\\fscx${Math.floor(fit * 100)}\\bord0\\shad0\\1c${col(TOKENS.text)}}${esc(s.label)}`);
  });

  // Full time: the last seconds hold the final number and say so.
  if (ft !== null) {
    const Lb = L.label;
    ev(5, ft, end, `{\\an4\\move(${Lb.x},${Lb.y + Lb.rise},${Lb.x},${Lb.y},0,${Math.round(LABEL_IN_S * 1000)})\\fad(150,0)\\fn${FONT.bold}\\b1\\fs${Lb.size}\\bord0\\shad0\\1c${col(TOKENS.text)}}Full time`);
    ev(5, ft, end, `{\\an4\\pos(${L.delta.x},${L.delta.y})\\fad(150,0)\\fn${FONT.medium}\\fs${L.brand.size}\\bord0\\shad0\\1c${col(TOKENS.mute)}}Match rating`);
  }

  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: R,${FONT.regular},${Math.round(24 * L.s)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  return { text: head.concat(lines).join('\n') + '\n', layout: L, end };
}

/** Text as ASS takes it: no override braces, no line breaks. */
function esc(s) {
  return String(s).replace(/[{}]/g, '').replace(/\\/g, '').replace(/[\r\n]+/g, ' ');
}

// The family names of the app's fonts, as decoded (woff2.js) into the fonts folder.
const FONT = Object.freeze({ regular: 'Geist', medium: 'Geist Medium', semi: 'Geist SemiBold', bold: 'Geist', mono: 'Geist Mono Medium' });
const FONT_FILES = Object.freeze(['geist-400', 'geist-500', 'geist-600', 'geist-700', 'geistmono-500']);

module.exports = { assOf, layoutOf, roundRect, moonMark, moonLoops, loopArea, inLoop, countSteps, labelWidth, col, ts, tierOf, TOKENS, FONT, FONT_FILES, COUNT_S, MOVE_HOLD_S, LABEL_HOLD_S };
