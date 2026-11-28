'use strict';

/**
 * Brand colours must go through tokens, or a re-skin changes almost nothing.
 *
 * `theme.css` was always well designed and always under-adopted: 51 copies of
 * the brand red and 68 of the cyan had been written out longhand as `rgba(255,
 * 70, 85, …)` across 15 surface stylesheets. `panel.css` was the clearest case,
 * zero hex values yet sixteen literal cyans, so it looked perfectly clean while
 * being hardcoded to the Valorant palette.
 *
 * Nothing failed, which is the problem. The app rendered correctly and the
 * damage only appeared when you tried to change the palette and watched most of
 * the interface ignore you.
 *
 * Status colours are checked too, but for the opposite reason: `--good`,
 * `--bad` and `--warn` describe an outcome rather than a brand, so they must
 * stay constant across games. They are tokens so that a palette swap CANNOT
 * accidentally recolour a win.
 *
 * SCRIPTS AND MARKUP TOO (8.4.1). This read the stylesheets alone, so the
 * retired cyan #00F0FF that Stats wrote into its rank journey's markup from
 * stats.js, over a gradient fill, passed it for as long as the journey had
 * been drawn: the literal was on the list, in a file the check never opened.
 * It reads every renderer script and page now, and three more rules came with
 * the fix:
 *   - no gradient but the deliberate one (Stats' skeleton shimmer, where the
 *     gradient IS the animation), counted per file and kind
 *   - a stylesheet cleaned to tokens stays clean: no colour in it but a token
 *     and the neutral black and white of the glass (TOKENS_ONLY, or a first
 *     line of its own saying so)
 *
 * THE SIGNAL ONLY WHERE IT BELONGS (8.6). --red is the signal, #E5383B, and
 * it is Start's fill, the live record card, the Recording screen's live dot,
 * the notice line's urgent dot and a destructive action under the pointer,
 * and nothing else: every other red the app drew became --bad (an outcome) or
 * the ink. So a rule naming the signal in any stylesheet but theme.css must be
 * one SIGNAL_ALLOWED lists, and no script or page names it at all. A new place
 * for the signal is a deliberate edit to that list.
 *
 * ORBIT (27 Nov 2026). The signal is the accent now, indigo #516AF6, and its
 * places are Orbit's: Start and Stop, the recording dot, the selected round,
 * the keyboard's ring and a card's eyebrow. The accent's own names (--accent,
 * --accent-2, --accent-t, --accent-tint, --accent-rgb, and --btn, --btn-h,
 * --btn-bar and --btn-bar-h, the indigo glass Start is filled with) are held
 * to those places exactly as the signal's old names are, and their literals
 * live in theme.css alone. A destructive action is coral, an outcome (--bad),
 * never the accent. A gradient that only FADES something out (a mask-image
 * over the agent's portrait or the star field) paints no colour, so it is not
 * a decorative one; the medals' metal is drawn once, in the review's SVG defs.
 *
 * GEIST MONO AT A WEIGHT IT SHIPS (8.6). The mono face ships 400 and 500, and
 * theme.css turns synthesis off, so a mono rule asking for 600 or 800 draws
 * at 500 and says something it does not do.
 *
 * Run: npm run check:palette
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const THEME = path.join(ROOT, 'shared', 'theme.css');

// The definitions live in theme.css, so it is the one file allowed literals.
const BANNED = [
  ['brand red',   /rgba\(\s*255\s*,\s*70\s*,\s*85\s*,/g,   'rgba(var(--bad-rgb), …) for an outcome, or the signal\'s token'],
  ['brand cyan',  /rgba\(\s*0\s*,\s*240\s*,\s*255\s*,/g,   'rgba(var(--cyan-rgb), …)'],
  ['brand red',   /#FF4655\b/gi,                            'var(--bad) for an outcome, or var(--signal)'],
  ['brand cyan',  /#00F0FF\b/gi,                            'var(--cyan)'],
  ['status good', /#4fd394\b/gi,                            'var(--good)'],
  ['status bad',  /#ff9aa3\b/gi,                            'var(--bad)'],
  ['status warn', /#f5c451\b/gi,                            'var(--warn)'],
  ['status good', /rgba\(\s*79\s*,\s*211\s*,\s*148\s*,/g,   'rgba(var(--good-rgb), …)'],
  // The signal and its two states (8.6), each by its token.
  ['the signal',  /#E5383B\b/gi,                            'var(--signal)'],
  ['the signal',  /rgba\(\s*229\s*,\s*56\s*,\s*59\s*,/g,    'rgba(var(--signal-rgb), …)'],
  ['Start hover', /#F04A4D\b/gi,                            'var(--red-2)'],
  ['Start press', /#C9302F\b/gi,                            'var(--red-3)'],
  // Orbit's accent and its glass (27 Nov 2026), each by its token.
  ['the accent',  /#516AF6\b/gi,                            'var(--accent)'],
  ['the accent',  /#6F85FF\b/gi,                            'var(--accent-2)'],
  ['the accent',  /rgba\(\s*81\s*,\s*106\s*,\s*246\s*,/g,   'rgba(var(--accent-rgb), ...)'],
  ['Start glass', /#606AF7/gi,                              'var(--btn) or var(--btn-h)'],
];

// No decorative gradients anywhere (CLAUDE.md). The kinds a renderer file can
// draw one with, and the one allowed, by file and kind; any other is a FAIL.
const GRADIENTS = [
  ['css',    /\b(?:linear|radial|conic)-gradient\(/gi],
  ['svg',    /<(?:linear|radial)Gradient\b/g],
  ['canvas', /\bcreate(?:Linear|Radial|Conic)Gradient\(/g],
];
const GRADIENT_ALLOWED = {
  'stats/stats.css': { css: 1 },      // the overview cards' skeleton shimmer: the gradient IS the animation
  // ORBIT (27 Nov 2026): the medals' metal, gold, silver and bronze, each its
  // light top to its dark foot and its face the other way, from the tokens
  // (--gold-1 and the rest), drawn once in the review's SVG defs.
  'review/index.html': { svg: 6 },
};

// OCCLARA WRAPPED'S OWN LOOK (docs/claude/wrapped.md, ui-rules-ipc.md
// "Wrapped's own look"): the owner chose a bold look for the year's story
// alone, its own colours and gradients and continuous motion. Its files, and
// only these, may draw gradients of any kind; the brand literals, the signal
// and the mono weights are held there as everywhere. Its stylesheet must say
// so on its first line, so the exception is written where it is used, and a
// file of it that the scan no longer reads fails rather than passing.
const OWN_LOOK_FILES = ['wrapped/wrapped.css', 'wrapped/wrapped.js', 'wrapped/gl.js', 'wrapped/card.js', 'wrapped/index.html'];
const OWN_LOOK_MARK = "/* palette: Wrapped's own";
const ownLook = (rel) => OWN_LOOK_FILES.includes(rel);
// A FADE IS NO PAINT (Orbit, 27 Nov 2026): a gradient in a mask (mask-image,
// its -webkit- twin, or the mask shorthand) only says how much of an element
// shows, never a colour, so its declaration is taken out before the css kind
// is counted. A gradient anywhere else in the same rule still counts.
const MASKS = /(?:-webkit-)?mask(?:-image)?\s*:[^;{}]*;/gi;
const unmasked = (src) => src.replace(MASKS, '');
/** The gradients a file draws past what it is allowed, [{ kind, n, allowed }]: none for Wrapped's own files. */
function gradientFails(rel, src) {
  if (ownLook(rel)) return [];   // Wrapped's own look, written down above and on its stylesheet's first line
  const out = [];
  for (const [kind, re] of GRADIENTS) {
    re.lastIndex = 0;
    const n = ((kind === 'css' ? unmasked(src) : src).match(re) || []).length;
    const allowed = ((GRADIENT_ALLOWED[rel] || {})[kind]) || 0;
    if (n > allowed) out.push({ kind, n, allowed });
  }
  return out;
}

// Stylesheets cleaned to tokens: no hex colour and no rgb() of a colour, only
// tokens and the neutral black and white of the glass, rgba(0,0,0,a) and
// rgba(255,255,255,a). A stylesheet joins by its own first line,
// TOKENS_MARK, so no two builders edit this list (8.6); stats.css is listed
// from before the mark.
const TOKENS_ONLY = ['stats/stats.css'];
const TOKENS_MARK = '/* palette: tokens only */';
const HEX = /#[0-9a-f]{3,8}\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;
const neutral = (r, g, b) => (r === g && g === b && (r === 0 || r === 255));
/** The declarations of a stylesheet, comments and selectors left out (an id selector is no colour). */
const declarations = (css) => (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\{[^{}]*\}/g) || []).join('\n');
/** Every colour literal a TOKENS_ONLY stylesheet may not hold. */
function stray(css) {
  const d = declarations(css);
  const out = (d.match(HEX) || []).slice();
  for (const m of d.matchAll(RGB)) if (!neutral(Number(m[1]), Number(m[2]), Number(m[3]))) out.push(m[0]);
  return out;
}
const marked = (src) => src.split(/\r?\n/)[0].trim() === TOKENS_MARK;

/** Every rule of a stylesheet as [selector, body], comments out, the selector's whitespace normalised. */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let m;
  while ((m = re.exec(clean))) out.push([m[1].trim().replace(/\s+/g, ' '), m[2]]);
  return out;
}

// THE SIGNAL'S PLACES, which are the accent's (Orbit): the rules that may name
// it, by stylesheet. The signal's old names and the accent's own, the indigo
// glass included; a name that only begins the same (--redraw, --r-btn,
// --btn-label) is not one of them.
const SIGNAL = /--(?:red(?:-2|-3|-rgb)?|signal(?:-rgb)?|glow-red|accent(?:-2|-t|-tint|-rgb)?|btn(?:-h|-bar|-bar-h)?)(?![\w-])/;
const FOCUS_RING = '.btn:focus-visible, .icon-btn:focus-visible, .seg button:focus-visible, input:focus-visible, select:focus-visible';
const SIGNAL_ALLOWED = {
  // Start and Stop (.btn-rec and its record icon), the live dot, a card's
  // eyebrow, and the keyboard's ring on a control, a card and an input.
  'shared/ui.css':         ['.btn-rec', '.btn-rec:hover:not(:disabled):not(.active)',
                            '.btn-rec:active:not(:disabled):not(.active)',
                            '.btn-rec.active', '.btn-rec.active:hover:not(:disabled)',
                            '.btn-rec:hover:not(:disabled):not(.active) .rec-ico::after',
                            '.o-card.is-link:focus-visible', '.o-eyebrow', '.input:focus', '.sig-dot', FOCUS_RING],
  // The bar's Start (the denser glass over the moon) and its hover; the
  // keyboard's ring on a link, the profile button, a window button and a menu
  // row; the Recording screen's still dot (held and live) and the round under
  // way on the tape, the selected round's place.
  'shell/shell.css':       ['.bar .btn-rec:not(.active):not(.ended)', '.bar .btn-rec:hover:not(:disabled):not(.active)',
                            '.nav .nav-item:focus-visible', '.avatar-btn:focus-visible', '.win-btn:focus-visible',
                            '.drawer .nav-item:focus-visible', '.sealed h1::before', '.live-dot', '.pip.now',
                            // 9.1: the bar's way back to the Recording view, its still recording dot and the keyboard's ring.
                            '.rec-back-dot', '.rec-back:focus-visible'],
  // The keyboard's ring on a recent match's row.
  'home/home.css':         ['.r-row:focus-visible'],
  // 9.1: the keyboard's ring on the live rating's switch beside Start.
  'home/live-rating-switch.css': ['.h-lr-switch:focus-visible'],
  // ORBIT phase 2: a card's eyebrow on each page.
  'stats/stats.css':       ['section h3:not(#nostats-title)'],
  'profile/profile.css':   ['.pr-title'],
  'invite/invite.css':     ['.inv-label'],
  'feedback/feedback.css': ['.fb-label'],
  'whatsnew/whatsnew.css': ['.wn-ver'],
  'practice/practice.css': ['.pc-label', '.pc-where, .pc-min'],
  'moments/moments.css':   ['.mo-title:not(#mo-empty-title):not(#mo-pl-title)', '.mo-hcard:focus-visible'],
  'matches/matches.css':   ['.m-chart-label'],
};
/** The rules of a stylesheet that name the signal and are not its places. */
function strayReds(rel, css) {
  const allowed = SIGNAL_ALLOWED[rel] || [];
  return rules(css).filter(([sel, body]) => SIGNAL.test(body) && !allowed.includes(sel)).map(([sel]) => sel);
}

// GEIST MONO SHIPS 400 AND 500. A rule naming the mono face with any other
// weight, as font-weight or in the font shorthand, fails.
const MONO_OK = ['400', '500', 'normal'];
function monoWeights(css) {
  const out = [];
  for (const [sel, body] of rules(css)) {
    if (!/var\(--font-mono\)/.test(body)) continue;
    const ws = [...body.matchAll(/(?:^|[;\s])font-weight\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
    for (const m of body.matchAll(/(?:^|[;\s])font\s*:\s*([^;]+)/g)) {
      const w = m[1].trim().match(/^(?:(?:italic|oblique|normal|small-caps)\s+)*(\d{3}|bold|bolder)\b/);
      if (w) ws.push(w[1]);
    }
    const off = ws.filter((w) => !MONO_OK.includes(w));
    if (off.length) out.push(`${sel} (${off.join(', ')})`);
  }
  return out;
}
// Moved by their surface's own task, which moves them to the type scale (a
// digit in a column to Geist Mono 500, a big number to Geist 600 with
// tabular-nums) and deletes its own line here in the same commit: a line that
// names a rule no longer at a wrong weight fails too, so this list can only
// shrink. Until then each draws at 500, as synthesis off draws it.
const MONO_PENDING = {
};

let problems = 0;
const fail = (line) => { problems++; console.log(line); };

// The rules themselves, on known positives and negatives first: a rule that
// matches nothing passes every file.
const selfTest = [
  [GRADIENTS[0][1], 'background: linear-gradient(100deg, transparent, #fff);', true],
  [GRADIENTS[0][1], 'No decorative gradients anywhere.', false],
  [GRADIENTS[1][1], '<linearGradient id="rgFill" x1="0" y1="0" x2="0" y2="1">', true],
  [GRADIENTS[1][1], '</linearGradient>', false],
  [GRADIENTS[2][1], 'const fade = ctx.createLinearGradient(W * 0.4, 0, W * 0.68, 0);', true],
  [GRADIENTS[2][1], 'the no gradient rule', false],
  [BANNED[3][1], 'stroke="#00F0FF" stroke-width="2.2"', true],
  [BANNED[3][1], 'stroke: var(--text-dim);', false],
  [BANNED[8][1], 'background: #E5383B;', true],
  [BANNED[8][1], 'background: #E5383BAA; color: var(--signal);', false],
  [BANNED[9][1], 'box-shadow: 0 0 0 1px rgba(229, 56, 59, 0.45);', true],
  [BANNED[9][1], 'background: rgba(229, 56, 590);', false],
  [BANNED[10][1], 'background: #f04a4d;', true],
  [BANNED[10][1], 'background: var(--red-2);', false],
  [BANNED[11][1], 'background: #C9302F;', true],
  [BANNED[11][1], 'background: #C9302F0;', false],
  [SIGNAL, 'color: var(--red);', true],
  [SIGNAL, 'background: rgba(var(--signal-rgb), 0.08);', true],
  [SIGNAL, 'background: var(--red-3);', true],
  [SIGNAL, 'color: var(--bad); border-color: rgba(var(--bad-rgb), 0.4);', false],
  [SIGNAL, 'transition: var(--redraw-ms) var(--signalling);', false],
  // Orbit: the accent's own names are the signal's, and look-alikes are not.
  [SIGNAL, 'color: var(--accent-2);', true],
  [SIGNAL, 'box-shadow: 0 0 0 3px var(--accent-t);', true],
  [SIGNAL, 'background: rgba(var(--accent-rgb), 0.12);', true],
  [SIGNAL, 'background: var(--btn-h);', true],
  [SIGNAL, 'background: var(--btn);', true],
  [SIGNAL, 'border-radius: var(--r-btn); color: var(--accented);', false],
  [SIGNAL, 'width: var(--btn-label-w);', false],
  [BANNED[12][1], 'background: #516af6;', true],
  [BANNED[12][1], 'background: #516AF629;', false],
  [BANNED[14][1], 'box-shadow: inset 0 0 8px rgba(81, 106, 246, 0.3);', true],
  [BANNED[14][1], 'background: rgba(81, 106, 2460);', false],
];
for (const [re, text, want] of selfTest) {
  re.lastIndex = 0;
  if (re.test(text) !== want) fail(`RULE BROKEN  ${re} ${want ? 'misses' : 'matches'} "${text}"`);
  re.lastIndex = 0;
}
const STRAY_POS = '.a { color: #ff8a95; } .b { background: rgba(74,222,128,0.08); }';
const STRAY_NEG = '#rank-reveal .x { color: var(--good); background: rgba(0,0,0,0.22); border-color: rgba(255,255,255,0.1); } /* #ff8a95 */';
if (stray(STRAY_POS).length !== 2) fail(`RULE BROKEN  a TOKENS_ONLY sheet's #ff8a95 and rgba(74,222,128) read as ${JSON.stringify(stray(STRAY_POS))}`);
if (stray(STRAY_NEG).length !== 0) fail(`RULE BROKEN  an id selector, a token, the glass and a comment read as ${JSON.stringify(stray(STRAY_NEG))}`);
if (!marked(`${TOKENS_MARK}\r\n.a { color: var(--text); }`) || marked(`/* Shared */\n${TOKENS_MARK}\n`)) {
  fail('RULE BROKEN  the tokens only mark is read on a first line alone');
}
const REDS_POS = '.btn-rec:hover:not(:disabled):not(.active) { background: var(--red-2); }\n.m-res.loss { color: var(--red); }\n@media (x) {\n  .a,\n  .b { border-color: rgba(var(--signal-rgb), 0.5); } }';
const REDS_NEG = '/* .x { color: var(--red); } */\n.m-res.loss { color: var(--bad); }\n.btn-rec { background: var(--red); }';
const redsPos = strayReds('shared/ui.css', REDS_POS);
if (redsPos.join(' | ') !== '.m-res.loss | .a, .b') fail(`RULE BROKEN  the signal rule reads a stray loss red and a stray signal tint as ${JSON.stringify(redsPos)}`);
if (strayReds('shared/ui.css', REDS_NEG).length) fail(`RULE BROKEN  a comment, an outcome and Start read as strays: ${JSON.stringify(strayReds('shared/ui.css', REDS_NEG))}`);
const MONO_POS = '.a { font-family: var(--font-mono); font-weight: 600; }\n.b { font: 800 13px var(--font-mono); }\n.c { font: italic bold 12px var(--font-mono); }';
const MONO_NEG = '.a { font-family: var(--font-mono); font-weight: 500; }\n.b { font: 400 13px var(--font-mono); }\n.c { font-family: var(--font); font-weight: 700; }\n.d { font: 600 12px var(--font); }';
if (monoWeights(MONO_POS).join(' | ') !== '.a (600) | .b (800) | .c (bold)') fail(`RULE BROKEN  the mono weight rule reads 600, 800 and bold as ${JSON.stringify(monoWeights(MONO_POS))}`);
if (monoWeights(MONO_NEG).length) fail(`RULE BROKEN  Mono at 500 and 400 and Geist at 700 and 600 read as ${JSON.stringify(monoWeights(MONO_NEG))}`);
// A fade is no paint: a mask's gradient passes, a painted one beside it fails.
const FADE = '.a { -webkit-mask-image: linear-gradient(#000 58%, transparent 90%); mask-image: linear-gradient(#000 58%, transparent 90%); }\n.b { mask: radial-gradient(circle, #000, transparent) no-repeat; }';
const PAINT = '.a { mask-image: linear-gradient(#000, transparent); background: linear-gradient(#000, #fff); }';
if (gradientFails('home/home.css', FADE).length) fail(`RULE BROKEN  a mask's fade reads as a decorative gradient: ${JSON.stringify(gradientFails('home/home.css', FADE))}`);
if (JSON.stringify(gradientFails('home/home.css', PAINT)) !== JSON.stringify([{ kind: 'css', n: 1, allowed: 0 }])) fail(`RULE BROKEN  a painted gradient beside a mask reads as ${JSON.stringify(gradientFails('home/home.css', PAINT))}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|js|html)$/.test(e.name) && p !== THEME) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
// The scan reads the scripts and the pages, or the journey's cyan is back to passing.
if (!files.some((f) => rel(f) === 'stats/stats.js') || !files.some((f) => rel(f) === 'stats/index.html')) {
  fail('SCAN BROKEN  the renderer\'s scripts and pages are not read, only its stylesheets');
}
// And a stylesheet held to tokens, or holding the signal, is one the scan
// reads: renamed or moved, it would be held to nothing and pass.
for (const f of [...TOKENS_ONLY, ...Object.keys(SIGNAL_ALLOWED), ...Object.keys(MONO_PENDING)]) {
  if (!files.some((x) => rel(x) === f)) fail(`SCAN BROKEN  ${f} is named here, and the scan does not read it`);
}
const held = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const r = rel(f);
  for (const [label, re, fix] of BANNED) {
    const n = (src.match(re) || []).length;
    if (!n) continue;
    problems += n;
    console.log(`${String(n).padStart(3)}x literal ${label}  in ${r}`);
    console.log(`     use ${fix} instead, or a palette swap will not reach it`);
  }
  for (const g of gradientFails(r, src)) {
    fail(`${String(g.n).padStart(3)}x ${g.kind} gradient  in ${r}${g.allowed ? `, where ${g.allowed} ${g.allowed === 1 ? 'is' : 'are'} allowed` : ''}`);
    console.log('     no decorative gradients: a solid fill and the tokens');
  }
  const css = f.endsWith('.css');
  if (css && (TOKENS_ONLY.includes(r) || marked(src))) {
    held.push(r);
    const left = stray(src);
    if (left.length) {
      fail(`${String(left.length).padStart(3)}x colour literal  in ${r}, which is held to tokens: ${[...new Set(left)].join(', ')}`);
      console.log('     use a token (--good, --bad, --warn, --text, --line, --on-accent...) or its -rgb twin');
    }
  }
  if (css) {
    for (const sel of strayReds(r, src)) {
      fail(`  signal  in ${r}: "${sel}" names the accent, which is only Start and Stop, the recording dot, the selected round, the keyboard's ring and a card's eyebrow`);
      console.log('     an outcome or a destructive action is var(--bad), a fill or a selection the ink or the raised fill; a new place for the accent is an edit to SIGNAL_ALLOWED');
    }
    const pending = MONO_PENDING[r] || [];
    const wrong = monoWeights(src);
    for (const w of wrong) {
      const sel = w.replace(/ \([^)]*\)$/, '');
      if (!pending.includes(sel)) fail(`  mono  in ${r}: "${w}" asks Geist Mono for a weight it does not ship (400 and 500): a digit in a column is Mono 500, a big number Geist 600 with tabular-nums`);
    }
    for (const sel of pending) {
      if (!wrong.some((w) => w.replace(/ \([^)]*\)$/, '') === sel)) fail(`  mono  in ${r}: "${sel}" is on the scale now, so take it off MONO_PENDING`);
    }
  } else if (SIGNAL.test(src)) {
    const at = src.split(/\r?\n/).findIndex((l) => SIGNAL.test(l)) + 1;
    fail(`  signal  in ${r}:${at} names the signal, and no script or page may: only the stylesheets' allowed rules do`);
  }
}
for (const f of TOKENS_ONLY) if (!held.includes(f)) fail(`SCAN BROKEN  ${f} is held to tokens, and the scan did not hold it`);
// Wrapped's exception: every file of it read, its stylesheet saying so on its
// first line, and no other surface's file let off (a gradient in Home's
// stylesheet is still one too many).
for (const f of OWN_LOOK_FILES) if (!files.some((x) => rel(x) === f)) fail(`SCAN BROKEN  ${f} is Wrapped's own look, and the scan does not read it`);
{
  const css = files.find((x) => rel(x) === 'wrapped/wrapped.css');
  if (css && !fs.readFileSync(css, 'utf8').split(/\r?\n/)[0].startsWith(OWN_LOOK_MARK)) {
    fail(`MARK MISSING  wrapped/wrapped.css is Wrapped's own look, and its first line no longer says ${OWN_LOOK_MARK} ...`);
  }
  // The exception run through the very rule the scan applies, on known positives
  // and negatives: a gradient in Home's stylesheet, ui.css or a Wrapped-looking
  // name outside the folder still fails; the same in Wrapped's own files does not.
  const G = '.a { background: linear-gradient(90deg, #000, #fff); }\nctx.createLinearGradient(0, 0, 1, 1);';
  for (const other of ['home/home.css', 'shared/ui.css', 'shell/wrapped.css', 'wrapped-copy/wrapped.css', 'stats/stats.css']) {
    if (!gradientFails(other, G).length) fail(`RULE BROKEN  a gradient in ${other} passes: Wrapped's exception reaches a file that is not Wrapped's`);
  }
  for (const own of ['wrapped/wrapped.css', 'wrapped/gl.js', 'wrapped/card.js']) {
    if (gradientFails(own, G).length) fail(`RULE BROKEN  a gradient in ${own} fails: Wrapped's own look is not let through`);
  }
}
for (const f of ['shared/ui.css', 'shared/grade-view.css', 'shared/dropdown.css']) {
  if (!held.includes(f)) fail(`MARK MISSING  ${f} is held to tokens since 8.6, and its first line no longer says ${TOKENS_MARK}`);
}

// The tokens themselves must exist, since everything above depends on them.
const theme = fs.readFileSync(THEME, 'utf8');
for (const t of ['--red-rgb', '--cyan-rgb', '--good', '--bad', '--warn', '--good-rgb', '--warn-rgb', '--on-accent',
  '--signal', '--signal-rgb', '--red-3', '--line', '--line-2', '--grid', '--paper', '--paper-ink', '--paper-ink-2', '--paper-ink-3',
  '--paper-line', '--r-card', '--r-control', '--r-pill', '--t-press', '--track-display', '--lh-display', '--track-label',
  // Orbit (27 Nov 2026): the accent, its glass, the card, the frame and the two springs.
  '--accent', '--accent-2', '--accent-t', '--accent-rgb', '--btn', '--btn-h', '--glass', '--glass-h', '--card', '--raised',
  '--r-btn', '--r-in', '--r-frame', '--spring-smooth', '--spring-gentle', '--ease-enter', '--ease-drawer']) {
  if (!new RegExp(`${t}\\s*:`).test(theme)) {
    problems++;
    console.log(`MISSING TOKEN  ${t} is not defined in shared/theme.css`);
  }
}

console.log(problems
  ? `\nFAIL: ${problems} colour(s) or weight(s) bypass the palette`
  : `\nPASS: every brand and status colour goes through a token, the signal is only in its places and the mono face only at the weights it ships (${files.length} stylesheets, scripts and pages read, ${held.length} held to tokens, ${Object.values(MONO_PENDING).flat().length} mono rules left for their surfaces)`);
process.exit(problems ? 1 : 0);
