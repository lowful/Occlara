'use strict';

/**
 * THE COACH'S PEN (8.8, src/renderer/shared/marks.js and marks.css), and the
 * foundations it stands on.
 *
 *   - every kind (underline, circle, bracket, arrow, tick, strike) has three
 *     or four hand drawn variants, and each lays out as a real path
 *   - the variant is picked from a hash of the text: the same text, the same
 *     stroke, in this process and the next
 *   - a mark renders a path on its element, one stroke a line for a line mark
 *   - it DRAWS IN only when asked, with motion allowed and coaching known to
 *     be off: never under prefers-reduced-motion, never while coaching, and
 *     never while main has not said (unknown counts as coaching)
 *   - the only place in the renderer that asks to draw is the review's
 *     reveal (runReveal, inside occlaraOnShown); a new one is an edit here
 *   - marks.css animates stroke-dashoffset and opacity only, never loops, and
 *     is still under reduced motion
 *   - --ink-pen and --ink-pen-dim measure 3:1 or better on --bg
 *   - the type is one family: theme.css declares Geist and Geist Mono alone,
 *     no serif ships, and the voice is a role (.t-fix Geist 700, .t-voice 400)
 *   - ui.css presses at scale .97, never a disabled control, and moves a
 *     control under the pointer only with a real pointer
 *
 * Run: npm run test:marks
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};

// ── A small DOM, enough for marks.js ────────────────────────────────────────
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  _from(v) { this.set = new Set(String(v).split(' ').filter(Boolean)); }
  _sync() { this.el.attrs.class = [...this.set].join(' '); }
  add(...c) { c.forEach((x) => this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
}
class El {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tagName = tag; this.attrs = {};
    this.childNodes = []; this.parentNode = null; this.classList = new ClassList(this);
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    this.textContent = ''; this.box = { left: 100, top: 50, width: 0, height: 0 };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.classList._from(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentNode = null; return n; }
  get firstChild() { return this.childNodes[0] || null; }
  getBoundingClientRect() { return { ...this.box }; }
}
function makeDoc(lines) {
  const doc = {
    lines,
    createElement: (t) => new El(doc, t),
    createElementNS: (ns, t) => new El(doc, t),
    createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => doc.lines }),
  };
  return doc;
}
function box(doc, w, h, text) {
  const el = doc.createElement('p');
  el.box = { left: 100, top: 50, width: w, height: h };
  el.textContent = text;
  return el;
}

let reduced = false;
globalThis.matchMedia = (q) => ({ matches: q.includes('prefers-reduced-motion') && reduced });
const load = () => { delete require.cache[require.resolve('../src/renderer/shared/marks.js')]; return require('../src/renderer/shared/marks.js'); };
const pen = load();

// ── The kinds and their variants ────────────────────────────────────────────
const KINDS = ['underline', 'circle', 'bracket', 'arrow', 'tick', 'strike'];
ok(KINDS.every((k) => pen.KINDS.includes(k)) && pen.KINDS.length === KINDS.length, 'the pen has the six kinds', JSON.stringify(pen.KINDS));
for (const k of KINDS) {
  const n = (pen.PATHS[k] || []).length;
  ok(n >= 3 && n <= 4, `${k} has three or four variants (${n})`);
}

const NUM = /-?\d+(?:\.\d+)?/g;
ok('M 1.5 -2 C 3 4'.match(NUM).length === 4, 'the number reader reads a path\'s numbers');
for (const k of KINDS) {
  pen.PATHS[k].forEach((v, i) => {
    const p = pen.pathFor(k, i, 10, 20, 300, 12);
    const nums = (p && p.main.match(NUM) || []).map(Number);
    const xs = nums.filter((_, j) => j % 2 === 0), ys = nums.filter((_, j) => j % 2 === 1);
    const good = !!p && p.main.startsWith('M ') && nums.length >= 4 && nums.length % 2 === 0
      && nums.every(Number.isFinite) && !/NaN|undefined/.test(p.main + p.pass)
      && xs.every((x) => x >= 10 - 300 * 0.1 && x <= 10 + 300 * 1.1) && ys.every((y) => y >= 20 - 12 * 0.2 && y <= 20 + 12 * 1.2);
    ok(good, `${k} ${i} lays out on its box`, p && p.main);
    // Drawn, not ruled: a stroke that is a straight line or a perfect
    // repeat of another variant is no pen.
    const yr = Math.max(...ys) - Math.min(...ys);
    ok(yr > 0.5 && /C/.test(v[0]) && !!v[1], `${k} ${i} wobbles, curves and has a second pass`);
  });
  const set = new Set(pen.PATHS[k].map((v) => v[0]));
  ok(set.size === pen.PATHS[k].length, `${k}'s variants are all different`);
}

// ── Deterministic picks ─────────────────────────────────────────────────────
ok(pen.hash('') === 0x811c9dc5, 'the hash is FNV-1a (the empty text hashes to its offset basis)');
ok(pen.hash('a') === 0xe40c292c, 'the hash of "a" is FNV-1a\'s', pen.hash('a').toString(16));
const FIX = 'Hold the angle you cleared until your team trades.';
const again = load();
for (const k of KINDS) {
  const a = pen.pick(k, FIX), b = pen.pick(k, FIX), c = again.pick(k, FIX);
  ok(a === b && a === c && a >= 0 && a < pen.PATHS[k].length, `${k}: the same text picks the same variant, in a fresh load too (${a})`);
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pen.pick(k, `Round ${i}: died first on A main`));
  ok(seen.size >= 2, `${k}: different texts reach different variants (${seen.size})`);
}
ok(pen.pick('scribble', FIX) === -1 && pen.mark(box(makeDoc([]), 10, 10, 'x'), 'scribble', {}) === null, 'an unknown kind picks nothing and marks nothing');

// ── A mark renders its path ─────────────────────────────────────────────────
const twoLines = [
  { left: 100, top: 50, width: 380, height: 46 },
  { left: 100, top: 96, width: 210, height: 46 },
];
for (const k of KINDS) {
  const doc = makeDoc(twoLines.map((l) => ({ ...l })));
  const el = box(doc, 400, 92, FIX);
  pen.setCoaching(false);
  const svg = pen.mark(el, k, { text: FIX });
  const paths = svg ? svg.childNodes.filter((c) => c.tagName === 'path') : [];
  const mains = paths.filter((p) => !p.classList.contains('pen-pass'));
  const wantMains = k === 'underline' || k === 'strike' ? 2 : 1;
  ok(!!svg && svg.classList.contains('pen') && svg.classList.contains(`pen-${k}`) && svg.getAttribute('aria-hidden') === 'true'
    && el.classList.contains('pen-host') && svg.parentNode === el, `${k}: a hidden svg on its element`);
  ok(mains.length === wantMains && paths.every((p) => /^M [-\d.]+ [-\d.]+ /.test(p.getAttribute('d')) && p.getAttribute('pathLength') === '1'
    && p.classList.contains('pen-stroke')), `${k}: ${wantMains} stroke${wantMains > 1 ? 's, one a line' : ''}, each a path of length 1`,
  paths.map((p) => p.getAttribute('d')).join(' | '));
  ok(!svg.classList.contains('drawing'), `${k}: still when not asked to draw`);
  // Marked again, replaced, never doubled.
  pen.mark(el, k, { text: FIX });
  ok(el.childNodes.filter((c) => c.tagName === 'svg').length === 1, `${k}: marked again, one mark`);
}
{
  const doc = makeDoc([]);
  const el = box(doc, 0, 0, FIX);
  const svg = pen.mark(el, 'underline', { text: FIX, draw: true });
  ok(svg && svg.childNodes.length === 0 && !svg.classList.contains('drawing'), 'an element with no size yet gets an empty mark, still');
}
{
  // The same text on two elements: the same stroke.
  const d = (t) => { const doc = makeDoc([{ left: 100, top: 50, width: 300, height: 40 }]); return pen.mark(box(doc, 300, 40, t), 'underline', { text: t }).childNodes[0].getAttribute('d'); };
  ok(d(FIX) === d(FIX), 'the same fix gets the same underline every time it is drawn');
}
{
  // A fix over three lines: lines: 'last' is one stroke under the last line.
  const three = [{ left: 100, top: 50, width: 300, height: 40 }, { left: 100, top: 90, width: 280, height: 40 }, { left: 100, top: 130, width: 120, height: 40 }];
  const strokes = (opts) => { const doc = makeDoc(three); return [...pen.mark(box(doc, 300, 120, FIX), 'underline', { text: FIX, ...opts }).childNodes].filter((n) => !String(n.getAttribute('class')).includes('pen-pass')); };
  const all = strokes({});
  const last = strokes({ lines: 'last' });
  const two = strokes({ lines: 2 });
  ok(all.length === 3 && last.length === 1 && two.length === 2, `an underline marks every line, or only the last one or the last n (${all.length}, ${last.length}, ${two.length})`);
}

// ── Drawn only when allowed ─────────────────────────────────────────────────
function drawn(opts, coaching, lessMotion) {
  reduced = lessMotion;
  pen.setCoaching(coaching);
  const doc = makeDoc([{ left: 100, top: 50, width: 300, height: 40 }]);
  const svg = pen.mark(box(doc, 300, 40, FIX), 'underline', { text: FIX, ...opts });
  reduced = false;
  return svg.classList.contains('drawing');
}
ok(drawn({ draw: true }, false, false), 'asked to draw, motion allowed and coaching off: it draws');
ok(!drawn({ draw: true }, false, true), 'under prefers-reduced-motion: no animation');
ok(!drawn({ draw: true }, true, false), 'while coaching: no animation');
ok(!drawn({ draw: true }, null, false), 'coaching unknown (main has not said): no animation');
ok(!drawn({ draw: false }, false, false) && !drawn({}, false, false), 'not asked to draw: no animation');
ok(!drawn({ draw: 'yes' }, false, false), 'only draw: true asks');
{
  pen.setCoaching(false);
  const doc = makeDoc([{ left: 100, top: 50, width: 300, height: 40 }]);
  const svg = pen.mark(box(doc, 300, 40, FIX), 'tick', { text: FIX, draw: true, delay: 540 });
  ok(svg.style.props['--pen-delay'] === '540ms', 'a delay reaches the stroke as --pen-delay');
  pen.setCoaching(null);
}
{
  // The bridge: coaching is what main says at load.
  const saved = globalThis.occlara;
  globalThis.occlara = { getState: () => Promise.resolve({ isCoaching: true }) };
  const fresh = load();
  globalThis.occlara = saved;
  setTimeout(() => {
    ok(fresh.coaching() === true, 'main saying coaching at load holds every mark still');
    done();
  }, 20);
}

// ── Only the reveal asks to draw ────────────────────────────────────────────
const DRAW_LITERAL = /\bdraw\s*:\s*true\b/;
const PEN_TRUE = /penFocus\([^()]*,\s*true\s*\)/g;
ok(DRAW_LITERAL.test("pen.mark(el, 'tick', { draw: true })") && !DRAW_LITERAL.test('{ draw: false }'), 'the draw reader reads a draw: true');
ok('penFocus(current, true);'.match(PEN_TRUE).length === 1 && !'penFocus(r, false);'.match(PEN_TRUE), 'the reveal reader reads penFocus(x, true)');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const f of walk(path.join(ROOT, 'src', 'renderer'))) {
  const rel = path.relative(path.join(ROOT, 'src', 'renderer'), f).split(path.sep).join('/');
  if (rel === 'shared/marks.js') continue;
  const src = strip(fs.readFileSync(f, 'utf8'));
  if (DRAW_LITERAL.test(src)) ok(false, `${rel} asks the pen to draw (draw: true), and only the review's reveal may`);
}
{
  const src = strip(read('src/renderer/review/review.js'));
  const calls = src.match(PEN_TRUE) || [];
  const at = src.indexOf('function runReveal(');
  const end = src.indexOf('\n}', at);
  const body = at >= 0 ? src.slice(at, end) : '';
  ok(calls.length === 1 && (body.match(PEN_TRUE) || []).length === 1, 'the review draws the pen once, in runReveal (inside occlaraOnShown), and nowhere else', `${calls.length} call(s)`);
  ok(/shown\(\(\) => runReveal\(mine\)\)/.test(src), 'runReveal runs only through occlaraOnShown');
  ok(/penFocus\(r, false\)/.test(src), 'every other paint marks the fix still');
}
ok(read('src/renderer/review/index.html').includes('<script src="../shared/marks.js"></script>')
  && read('src/renderer/review/index.html').includes('<link rel="stylesheet" href="../shared/marks.css" />'), 'the review loads the pen');

// ── marks.css ───────────────────────────────────────────────────────────────
{
  const css = read('src/renderer/shared/marks.css');
  const frames = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\}\s*\}/g)].map((m) => m[1]);
  const props = new Set(frames.join('\n').match(/[a-z-]+(?=\s*:)/g) || []);
  ok(frames.length >= 1 && [...props].every((p) => p === 'stroke-dashoffset' || p === 'opacity'), 'the pen animates stroke-dashoffset and opacity alone', [...props].join(', '));
  ok(!/infinite|alternate/.test(css) && !/transition\s*:\s*all/.test(css), 'nothing loops and nothing transitions all');
  const reducedBlock = (css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  ok(/animation:\s*none/.test(reducedBlock) && /stroke-dashoffset:\s*0/.test(reducedBlock), 'under reduced motion a mark is whole and still');
  ok(/\.pen\.drawing \.pen-stroke \{[^}]*animation: penDraw var\(--t-pen\) var\(--ease-out\)/.test(css), 'the stroke draws on --t-pen and --ease-out');
  ok(/stroke:\s*var\(--ink-pen\)/.test(css) && !/--signal|--red\b/.test(css), 'the stroke is the pen\'s ink, never the signal');
}

// ── The tokens ──────────────────────────────────────────────────────────────
const theme = read('src/renderer/shared/theme.css');
const token = (n) => ((theme.match(new RegExp(`${n}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
ok(Math.abs(contrast('#FFFFFF', '#000000') - 21) < 0.01, 'the contrast arithmetic gives white on black 21:1');
for (const t of ['--ink-pen', '--ink-pen-dim']) {
  const v = token(t);
  const c = /^#[0-9a-f]{6}$/i.test(v) ? contrast(v, token('--bg')) : 0;
  ok(c >= 3, `${t} ${v} measures ${c.toFixed(2)}:1 on --bg, 3:1 or better`);
}
ok(token('--ease-out') === 'cubic-bezier(0.23, 1, 0.32, 1)' && token('--ease-in-out') === 'cubic-bezier(0.77, 0, 0.175, 1)', 'the easing tokens are emil\'s curves');
// 8.8: two curves and no others; --ease is the keyword for hover and colour.
ok(!token('--ease-expo') && !token('--ease-spring'), 'there is no --ease-expo and no --ease-spring: --ease-out and --ease-in-out are the set');
{
  const users = [];
  const css = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? css(path.join(d, e.name)) : /\.(css|js|html)$/.test(e.name) ? [path.join(d, e.name)] : []));
  for (const f of css(path.join(ROOT, 'src', 'renderer'))) if (/var\(--ease-(?:expo|spring)\)/.test(fs.readFileSync(f, 'utf8'))) users.push(path.relative(ROOT, f));
  ok(!users.length, 'and nothing in the renderer asks for either', users.join(', '));
}
ok(token('--ease') === 'ease' && token('--t-press') === '100ms' && token('--t-fast') === '140ms' && token('--t-med') === '220ms' && token('--t-slow') === '280ms',
  'hover and colour take plain ease; a keycap goes down in 100ms, and nothing UI runs past --t-slow\'s 280ms');
// The pen is its own ink: 15 degrees or more of hue from --warn, or a pen
// underline beside an amber grade reads as one ink (it was 6 degrees apart to 8.8).
{
  const hue = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  };
  const apart = (x, y) => { const d = Math.abs(hue(x) - hue(y)); return Math.min(d, 360 - d); };
  ok(Math.abs(hue('#D5A98C') - 55) < 1, 'the hue reader puts oklch(0.768 0.065 55) at 55 degrees');
  const pen = token('--ink-pen'), dim = token('--ink-pen-dim'), warn = token('--warn');
  ok(apart(pen, warn) >= 15 && apart(dim, warn) >= 15 && apart(pen, dim) < 5,
    `the pen (${hue(pen).toFixed(1)}) and the dim pen (${hue(dim).toFixed(1)}) are one hue, 15 degrees or more from --warn (${hue(warn).toFixed(1)})`);
}
ok(token('--focus-ring') === 'rgba(255, 255, 255, 0.55)' && token('--line-input') === 'rgba(255, 255, 255, 0.40)' && token('--image-outline') === 'rgba(255, 255, 255, 0.1)',
  'one focus ring token, a field\'s 3:1 edge and an image\'s outline have their tokens');
ok(['--fs-caption', '--fs-label', '--fs-ui', '--fs-body', '--fs-voice', '--fs-heading', '--fs-h2', '--fs-fix', '--fs-display'].map(token).join(',') === '12px,13px,14px,15px,16px,18px,24px,34px,64px'
  && token('--lh-display') === '1.1' && token('--lh-body') === '1.55' && token('--track-hero') === '-0.03em' && token('--track-display') === '-0.02em',
  'the nine size roles, unitless line heights and tracking by size');
ok(token('--t-pen') === '450ms' && token('--t-tap') === '160ms' && token('--margin-w') === '72px', 'the pen, the press and the margin have their tokens');
ok(token('--w-body') === '400' && token('--w-label') === '500' && token('--w-title') === '600' && token('--w-display') === '700', 'the weight roles are 400, 500, 600 and 700');
// ONE TYPE FAMILY: the voice is a role in Geist, never a second face.
{
  const code = theme.replace(/\/\*[\s\S]*?\*\//g, '');
  const faces = [...new Set([...code.matchAll(/@font-face \{ font-family: '([^']+)'/g)].map((m) => m[1]))];
  ok(faces.join(',') === 'Geist,Geist Mono', 'theme.css declares Geist and Geist Mono and no other face', faces.join(', '));
  ok(!/--font-voice\b/.test(code) && !/(?<![-\w])serif\b/.test(code), 'there is no voice font and no serif in the theme');
  const extra = fs.readdirSync(path.join(ROOT, 'assets', 'fonts')).filter((f) => !/^geist(?:mono)?-\d{3}\.woff2$/.test(f));
  ok(extra.length === 0, 'assets/fonts ships Geist\'s files alone', extra.join(', '));
  const ui = read('src/renderer/shared/ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => ((ui.match(new RegExp(`\\n\\${sel} \\{([^}]*)\\}`)) || [])[1] || '');
  const fix = rule('.t-fix'), voice = rule('.t-voice');
  ok(/font-family: var\(--font\)/.test(fix) && /font-weight: var\(--w-display\)/.test(fix) && /letter-spacing: var\(--track-hero\)/.test(fix) && /line-height: var\(--lh-display\)/.test(fix),
    'the fix line (.t-fix) is Geist 700 at --track-hero (-0.03em) on --lh-display (1.1)');
  ok(/font-family: var\(--font\)/.test(voice) && /font-weight: var\(--w-body\)/.test(voice) && /font-size: var\(--fs-voice\)/.test(voice)
    && /line-height: var\(--lh-body\)/.test(voice) && /color: var\(--text\)/.test(voice) && /max-width: 65ch/.test(voice),
    'the coach\'s voice (.t-voice) is Geist 400 at --fs-voice on --lh-body (1.55) in the full ink, 65 characters wide at most');
  ok(/class="v-focus-text t-fix"/.test(read('src/renderer/review/index.html')) && /class="focus-text t-fix"/.test(read('src/renderer/home/index.html')),
    'the review\'s and Home\'s fix lines are .t-fix');
  ok(/'v-why t-voice'/.test(read('src/renderer/review/review.js')) && /'msg coach t-voice'/.test(read('src/renderer/chat/chat.js')),
    'the coach\'s read and Ask Coach\'s answers are .t-voice');
}

// ── The press and the pointer (ui.css) ──────────────────────────────────────
{
  const ui = read('src/renderer/shared/ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/\.btn:where\(:not\(:disabled\):not\(\[aria-disabled="true"\]\)\):active \{ transform: scale\(0\.97\); \}/.test(ui)
    && /\.icon-btn:where\(:not\(:disabled\):not\(\[aria-disabled="true"\]\)\):active \{ transform: scale\(0\.97\); \}/.test(ui),
    'a button and an icon button press to scale .97, never a disabled one, and with no inset shadow');
  ok(/transform var\(--t-tap\) var\(--ease-out\)/.test(ui), 'the press moves on --t-tap and --ease-out');
  // Every rule that moves a control under the pointer sits in a pointer query.
  const outside = ui.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/g, '');
  const moving = [...outside.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)].filter((m) => /transform:\s*translate/.test(m[2])).map((m) => m[1].trim());
  ok(moving.length === 0, 'no hover moves a control outside (hover: hover) and (pointer: fine)', moving.join(' | '));
  ok(/\n\.btn \{[^}]*border-radius: var\(--r-control\)/.test(ui) && /\n\.btn \{[^}]*box-shadow: none/.test(ui)
    && /\.btn-ghost, \.btn-secondary \{/.test(ui) && /\n\.icon-btn \{[^}]*border-radius: var\(--r-control\)/.test(ui)
    && /\n\.btn-primary \{[^}]*border-radius: var\(--r-btn\)/.test(ui)
    && /\.btn-tertiary \{[^}]*background: transparent/.test(ui) && /\.btn-tertiary \{[^}]*text-decoration-color: var\(--line-2\)/.test(ui),
    'a bare .btn, .btn-ghost, .btn-secondary and .icon-btn are the rectangle at --r-control, only the primary is a capsule, and the tertiary is words underlined at rest');
  ok(!/--drop|--lift|translateY\(-1px\)|inset 0 1px 2px/.test(ui), 'no control casts a shadow, rises or presses into an inset shadow');
  ok(!/transition\s*:\s*all/.test(ui), 'nothing in ui.css transitions all');
}

let finished = false;
function done() {
  if (finished) return;
  finished = true;
  console.log(fails ? `\nFAIL: ${fails} pen check(s)` : '\nPASS: the pen has six kinds of three or four hand drawn variants, picks one by the text\'s hash, renders a path a line, draws in only on the reveal with motion allowed and coaching off, and stands on tokens that measure');
  process.exit(fails ? 1 : 0);
}
