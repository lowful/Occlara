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
 *   - no gradient but the deliberate ones (the two loading shimmers, and the
 *     share card's two, left for the Stats revamp), counted per file and kind
 *   - a stylesheet cleaned to tokens stays clean: no colour in it but a token
 *     and the neutral black and white of the glass (TOKENS_ONLY)
 *
 * Run: npm run check:palette
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const THEME = path.join(ROOT, 'shared', 'theme.css');

// The definitions live in theme.css, so it is the one file allowed literals.
const BANNED = [
  ['brand red',   /rgba\(\s*255\s*,\s*70\s*,\s*85\s*,/g,   'rgba(var(--red-rgb), …)'],
  ['brand cyan',  /rgba\(\s*0\s*,\s*240\s*,\s*255\s*,/g,   'rgba(var(--cyan-rgb), …)'],
  ['brand red',   /#FF4655\b/gi,                            'var(--red)'],
  ['brand cyan',  /#00F0FF\b/gi,                            'var(--cyan)'],
  ['status good', /#4fd394\b/gi,                            'var(--good)'],
  ['status bad',  /#ff9aa3\b/gi,                            'var(--bad)'],
  ['status warn', /#f5c451\b/gi,                            'var(--warn)'],
  ['status good', /rgba\(\s*79\s*,\s*211\s*,\s*148\s*,/g,   'rgba(var(--good-rgb), …)'],
];

// No decorative gradients anywhere (CLAUDE.md). The kinds a renderer file can
// draw one with, and the few allowed, by file and kind; any other is a FAIL.
const GRADIENTS = [
  ['css',    /\b(?:linear|radial|conic)-gradient\(/gi],
  ['svg',    /<(?:linear|radial)Gradient\b/g],
  ['canvas', /\bcreate(?:Linear|Radial|Conic)Gradient\(/g],
];
const GRADIENT_ALLOWED = {
  'shared/ui.css':   { css: 1 },      // the loading shimmer: the gradient IS the animation
  'stats/stats.css': { css: 1 },      // the overview cards' skeleton shimmer, the same
  'stats/stats.js':  { canvas: 2 },   // the share card's two, left for the Stats revamp
};

// Stylesheets cleaned to tokens: no hex colour and no rgb() of a colour, only
// tokens and the neutral black and white of the glass, rgba(0,0,0,a) and
// rgba(255,255,255,a). Add a file once it is clean.
const TOKENS_ONLY = ['stats/stats.css'];
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
// And a stylesheet held to tokens is one the scan reads: renamed or moved, it
// would be held to nothing and pass.
for (const f of TOKENS_ONLY) {
  if (!files.some((x) => rel(x) === f)) fail(`SCAN BROKEN  ${f} is held to tokens, and the scan does not read it`);
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [label, re, fix] of BANNED) {
    const n = (src.match(re) || []).length;
    if (!n) continue;
    problems += n;
    console.log(`${String(n).padStart(3)}x literal ${label}  in ${rel(f)}`);
    console.log(`     use ${fix} instead, or a palette swap will not reach it`);
  }
  for (const [kind, re] of GRADIENTS) {
    const n = (src.match(re) || []).length;
    const allowed = ((GRADIENT_ALLOWED[rel(f)] || {})[kind]) || 0;
    if (n > allowed) {
      fail(`${String(n).padStart(3)}x ${kind} gradient  in ${rel(f)}${allowed ? `, where ${allowed} ${allowed === 1 ? 'is' : 'are'} allowed` : ''}`);
      console.log('     no decorative gradients: a solid fill and the tokens');
    }
  }
  if (TOKENS_ONLY.includes(rel(f))) {
    const left = stray(src);
    if (left.length) {
      fail(`${String(left.length).padStart(3)}x colour literal  in ${rel(f)}, which is held to tokens: ${[...new Set(left)].join(', ')}`);
      console.log('     use a token (--good, --bad, --warn, --red, --text, --on-accent...) or its -rgb twin');
    }
  }
}

// The tokens themselves must exist, since everything above depends on them.
const theme = fs.readFileSync(THEME, 'utf8');
for (const t of ['--red-rgb', '--cyan-rgb', '--good', '--bad', '--warn', '--good-rgb', '--warn-rgb', '--on-accent']) {
  if (!new RegExp(`${t}\\s*:`).test(theme)) {
    problems++;
    console.log(`MISSING TOKEN  ${t} is not defined in shared/theme.css`);
  }
}

console.log(problems
  ? `\nFAIL: ${problems} colour(s) bypass the palette`
  : `\nPASS: every brand and status colour goes through a token (${files.length} stylesheets, scripts and pages read)`);
process.exit(problems ? 1 : 0);
