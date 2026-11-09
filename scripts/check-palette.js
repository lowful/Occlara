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
 * GEIST MONO AT A WEIGHT IT SHIPS (8.6). The mono face ships 400 and 500, and
 * theme.css turns synthesis off, so a mono rule asking for 600 or 800 draws
 * at 500 and says something it does not do.
 *
 * THE PEN IN ITS PLACES (8.8). --ink-pen is the coach's pen
 * (shared/marks.css, PEN_ALLOWED), and no script or page names the ink.
 *
 * ONE TYPE FAMILY (8.8). Geist and Geist Mono, nothing else. theme.css
 * declares those two faces and the --font and --font-mono stacks alone,
 * every font-family elsewhere is one of those tokens, no file names a serif
 * or another face, and assets/fonts ships Geist's files only. The coach's
 * voice is a role (ui.css .t-fix, .t-voice), never a font.
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
};

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

// THE SIGNAL'S PLACES: the rules that may name it, by stylesheet.
const SIGNAL = /--(?:red(?:-2|-3|-rgb)?|signal(?:-rgb)?|glow-red)\b/;
const SIGNAL_ALLOWED = {
  'shared/ui.css':         ['.btn-rec', '.btn-rec:hover:not(:disabled):not(.active)',
                            '.btn-rec:active:not(:disabled):not(.active)',
                            '.btn-ghost.danger:hover:not(:disabled)',
                            '.btn-tertiary.danger:hover:not(:disabled):not([aria-disabled="true"])', '.sig-dot'],
  'shell/shell.css':       ['.rec.live', '.toggle.active .t-ico', '.win-btn.close:hover',
                            '.sealed h1::before', '.top-notice.urgent::before'],
  'settings/settings.css': ['.rec-clear.armed'],
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

// THE PEN'S INK (8.8). --ink-pen is the coach's pencil and nothing else: the
// pen's strokes and its margin notes. A rule naming it is one PEN_ALLOWED
// lists ('*' for every rule of a sheet that is the pen's own), and no script
// or page names it (marks.js draws through marks.css's classes). A new place
// for it is a deliberate edit here.
const PEN = /--ink-pen(?:-dim)?\b/;
const PEN_ALLOWED = {
  'shared/marks.css': '*',
};
/** The rules of a stylesheet that name the token and are not its places. */
function strayUse(rel, css, re, allowed) {
  const ok = allowed[rel];
  if (ok === '*') return [];
  return rules(css).filter(([sel, body]) => re.test(body) && !(ok || []).includes(sel)).map(([sel]) => sel);
}

// ONE TYPE FAMILY (8.8). Geist and Geist Mono and nothing else: a second face
// (8.8's first pass set the coach's voice in a serif) reads as random beside
// the app's bold Geist. The voice is set apart by role (ui.css .t-fix and
// .t-voice), never by font. So theme.css declares only those two faces and
// only the --font and --font-mono stacks, each led by its face; every other
// font-family or font shorthand anywhere is var(--font), var(--font-mono) or
// inherited; and no file names a serif or another display face at all.
const FACES_OK = ['Geist', 'Geist Mono'];
const FONT_DECL = /(?:^|[;{\s"'])font(-family)?\s*:\s*([^;{}"]+)/g;
const FAMILY_OK = /^(?:var\(--font(?:-mono)?\)|inherit|initial|unset)$/;
const OTHER_FACE = /\b(?:Newsreader|Georgia|Iowan|Times New Roman|Garamond|Playfair|Merriweather|Lora|Inter|Fraunces|Charter|Cambria)\b|(?<![-\w])serif\b|\bcursive\b|\bfantasy\b/;
/** A declaration naming a family that is not Geist's own token. */
function strayFonts(text) {
  const out = [];
  for (const m of text.matchAll(FONT_DECL)) {
    const v = m[2].trim();
    if (m[1]) { if (!FAMILY_OK.test(v)) out.push(`font-family: ${v}`); continue; }
    // The shorthand: its family is what follows the size (and line-height),
    // either of which may be a token (var(--fs-label), var(--lh-body)).
    if (FAMILY_OK.test(v)) continue;
    const sized = /(?:^|\s)(?:[\d.]+(?:px|em|rem|%)|var\(--fs-[\w-]+\))(?:\s*\/|\s|$)/.test(v);
    const fam = v.match(/\s(\S+)$/);
    if (!sized || !fam || !FAMILY_OK.test(fam[1].trim())) out.push(`font: ${v}`);
  }
  return out;
}
/** Comments out of a stylesheet, a script or a page, so a note may say "no serif". */
const uncomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

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
const PEN_POS = '.a { stroke: var(--ink-pen); }\n.b { color: var(--ink-pen-dim); }\n.v-focus-text { color: var(--ink-pen); }';
const PEN_NEG = '/* .a { stroke: var(--ink-pen); } */\n.b { color: var(--text); }\n.c { --ink-penny: 1; }';
if (strayUse('review/review.css', PEN_POS, PEN, PEN_ALLOWED).join(' | ') !== '.a | .b | .v-focus-text') fail(`RULE BROKEN  the pen rule reads three stray inks as ${JSON.stringify(strayUse('review/review.css', PEN_POS, PEN, PEN_ALLOWED))}`);
if (strayUse('review/review.css', PEN_NEG, PEN, PEN_ALLOWED).length || strayUse('shared/marks.css', PEN_POS, PEN, PEN_ALLOWED).length) fail('RULE BROKEN  a comment, the text ink, a longer name or the pen\'s own sheet read as a stray pen');
const FONT_POS = ".a { font-family: var(--font-voice); }\n.b { font: 500 15px/1.4 'Newsreader', serif; }\n.c { font-family: Georgia; }\n<p style=\"font-family: 'Lora'\">";
const FONT_NEG = ".a { font-family: var(--font); }\n.b { font: 500 15px/1.4 var(--font-mono); }\n.c { font: inherit; }\n.d { font-family: inherit; font-weight: 700; font-size: 12px; }\n.e { font: 500 var(--fs-caption)/1.4 var(--font-mono); }\n.f { font: var(--w-label) var(--fs-label)/var(--lh-body) var(--font); }\nctx.font = `600 ${s}px ${F.sans}`;";
if (strayFonts(FONT_POS).length !== 4) fail(`RULE BROKEN  the one family rule reads a token, a serif, Georgia and an inline face as ${JSON.stringify(strayFonts(FONT_POS))}`);
if (strayFonts(FONT_NEG).length) fail(`RULE BROKEN  Geist's tokens, inherit and the weight and size read as strays: ${JSON.stringify(strayFonts(FONT_NEG))}`);
if (!OTHER_FACE.test("font-family: 'Newsreader', Georgia, serif") || !OTHER_FACE.test('font: 16px serif') || OTHER_FACE.test("'Geist', -apple-system, 'Segoe UI', sans-serif") || OTHER_FACE.test('frameTimes, Interval')) {
  fail('RULE BROKEN  the other face rule misses a serif or reads Geist\'s sans stack as one');
}
if (/serif/.test(uncomment('/* no serif */ .a { color: red; } // a serif\n<!-- serif -->')) || !/serif/.test(uncomment('.a { font: 1px serif; }'))) fail('RULE BROKEN  the comment strip keeps a comment or drops a rule');
if (monoWeights(MONO_NEG).length) fail(`RULE BROKEN  Mono at 500 and 400 and Geist at 700 and 600 read as ${JSON.stringify(monoWeights(MONO_NEG))}`);

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
for (const f of [...TOKENS_ONLY, ...Object.keys(SIGNAL_ALLOWED), ...Object.keys(MONO_PENDING), ...Object.keys(PEN_ALLOWED)]) {
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
  for (const [kind, re] of GRADIENTS) {
    const n = (src.match(re) || []).length;
    const allowed = ((GRADIENT_ALLOWED[r] || {})[kind]) || 0;
    if (n > allowed) {
      fail(`${String(n).padStart(3)}x ${kind} gradient  in ${r}${allowed ? `, where ${allowed} ${allowed === 1 ? 'is' : 'are'} allowed` : ''}`);
      console.log('     no decorative gradients: a solid fill and the tokens');
    }
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
      fail(`  signal  in ${r}: "${sel}" names the signal, which is only Start, the live card and its Stop, the live and urgent dots and a destructive hover`);
      console.log('     an outcome is var(--bad), a fill or a selection the ink; a new place for the signal is an edit to SIGNAL_ALLOWED');
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
    for (const sel of strayUse(r, src, PEN, PEN_ALLOWED)) {
      fail(`  pen  in ${r}: "${sel}" names the pen's ink, which is the pen's strokes and its margin notes alone`);
      console.log('     a mark is drawn by shared/marks.js; a new place for the ink is an edit to PEN_ALLOWED');
    }
  } else {
    if (SIGNAL.test(src)) {
      const at = src.split(/\r?\n/).findIndex((l) => SIGNAL.test(l)) + 1;
      fail(`  signal  in ${r}:${at} names the signal, and no script or page may: only the stylesheets' allowed rules do`);
    }
    if (PEN.test(src)) {
      const at = src.split(/\r?\n/).findIndex((l) => PEN.test(l)) + 1;
      fail(`  pen  in ${r}:${at} names the pen's ink, and no script or page may: marks.css draws it`);
    }
  }
  const code = uncomment(src);
  if (OTHER_FACE.test(code)) {
    fail(`  font  in ${r}: names "${code.match(OTHER_FACE)[0]}", and the app is one family, Geist and Geist Mono`);
    console.log('     the coach\'s voice is a role, not a face: shared/ui.css .t-fix (Geist 700) and .t-voice (Geist 400)');
  }
  if (!f.endsWith('.js')) {
    for (const d of strayFonts(code)) {
      fail(`  font  in ${r}: "${d}" sets a family that is not var(--font) or var(--font-mono)`);
    }
  }
}
// The faces themselves: theme.css declares Geist and Geist Mono and no other,
// and its only stacks are --font and --font-mono, each led by its face.
{
  const themeCode = uncomment(fs.readFileSync(THEME, 'utf8'));
  const faces = [...themeCode.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!faces.length) fail('SCAN BROKEN  theme.css declares no @font-face, so the face rule reads nothing');
  for (const face of new Set(faces)) if (!FACES_OK.includes(face)) fail(`  font  in shared/theme.css: declares the face '${face}', and the app is Geist and Geist Mono alone`);
  for (const face of FACES_OK) if (!faces.includes(face)) fail(`MISSING FACE  shared/theme.css no longer declares '${face}'`);
  const stacks = [...themeCode.matchAll(/(--font[-\w]*)\s*:\s*([^;]+);/g)];
  for (const [, name, v] of stacks) {
    const lead = name === '--font' ? "'Geist'," : name === '--font-mono' ? "'Geist Mono'," : null;
    if (!lead) fail(`  font  in shared/theme.css: ${name} is a font token beside --font and --font-mono, and there is one family`);
    else if (!v.trim().startsWith(lead)) fail(`  font  in shared/theme.css: ${name} is not led by ${lead.slice(0, -1)}`);
    if (OTHER_FACE.test(v)) fail(`  font  in shared/theme.css: ${name} falls back to "${v.match(OTHER_FACE)[0]}"`);
  }
  for (const m of fs.readdirSync(path.join(__dirname, '..', 'assets', 'fonts'))) {
    if (/\.(woff2?|ttf|otf)$/i.test(m) && !/^geist(?:mono)?-\d{3}\.woff2$/.test(m)) fail(`  font  in assets/fonts: ${m} is a font file that is not Geist's, and only Geist ships`);
  }
}
for (const f of TOKENS_ONLY) if (!held.includes(f)) fail(`SCAN BROKEN  ${f} is held to tokens, and the scan did not hold it`);
for (const f of ['shared/ui.css', 'shared/grade-view.css', 'shared/dropdown.css']) {
  if (!held.includes(f)) fail(`MARK MISSING  ${f} is held to tokens since 8.6, and its first line no longer says ${TOKENS_MARK}`);
}

// The tokens themselves must exist, since everything above depends on them.
const theme = fs.readFileSync(THEME, 'utf8');
for (const t of ['--red-rgb', '--cyan-rgb', '--good', '--bad', '--warn', '--good-rgb', '--warn-rgb', '--on-accent',
  '--signal', '--signal-rgb', '--red-3', '--line', '--line-2', '--line-input', '--focus-ring', '--image-outline', '--ink', '--paper', '--paper-ink', '--paper-ink-2', '--paper-ink-3',
  '--paper-line', '--r-card', '--r-control', '--r-pill', '--t-press', '--track-display', '--track-hero', '--lh-display', '--lh-heading', '--lh-body',
  '--fs-caption', '--fs-label', '--fs-ui', '--fs-body', '--fs-voice', '--fs-heading', '--fs-h2', '--fs-fix', '--fs-display', '--z-base', '--z-raised', '--z-menu', '--z-overlay',
  '--ink-pen', '--ink-pen-dim', '--ease-out', '--ease-in-out', '--t-tap', '--t-pen', '--margin-w', '--w-body', '--w-label', '--w-title', '--w-display']) {
  if (!new RegExp(`${t}\\s*:`).test(theme)) {
    problems++;
    console.log(`MISSING TOKEN  ${t} is not defined in shared/theme.css`);
  }
}

console.log(problems
  ? `\nFAIL: ${problems} colour(s) or weight(s) bypass the palette`
  : `\nPASS: every brand and status colour goes through a token, the signal and the pen's ink are only in their places, the type is Geist and Geist Mono alone, the mono face only at the weights it ships (${files.length} stylesheets, scripts and pages read, ${held.length} held to tokens, ${Object.values(MONO_PENDING).flat().length} mono rules left for their surfaces)`);
process.exit(problems ? 1 : 0);
