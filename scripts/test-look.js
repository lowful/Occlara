'use strict';

/**
 * THE CRESCENT LOOK'S FOUNDATION (8.6), read off the stylesheets and run on
 * the shared grade card: the tokens and the grounds, Start keeping the signal
 * by its own class while the primary turns ink, the shared components every
 * surface builds on, and the grade card drawn once with no frame of its own.
 * Each case is a rule of the 8.6 spec that a later edit could quietly undo:
 * Start turning white with the primary, pressing Stop flashing the signal,
 * the ended button fading to 2.4:1, a button growing its shadows back, a
 * surface's own Consolas keycap returning.
 *
 * The signal's places, the tokens-only sheets and the mono weights are
 * check:palette's; the mark in its five places is test:mark's.
 *
 * Run: npm run test:look
 */
const fs = require('fs');
const path = require('path');
const { Document } = require('./fixtures/fake-dom');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const read = (rel) => fs.readFileSync(path.join(RENDERER, rel), 'utf8');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};

/** A rule's body by its exact selector at the start of a line, comments out. */
const rule = (src, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return (clean.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
};
/** A rule inside ui.css's real pointer query (8.8): a hover that moves a control lives there alone. */
const pointerRule = (src, sel) => {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = clean.match(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/g) || [];
  for (const b of blocks) { const r = rule(b.replace(/\n\s+/g, '\n'), sel); if (r) return r; }
  return '';
};
const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
const token = (css, name) => ((css.match(new RegExp(`(?:^|[;\\s{])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
/** WCAG contrast of two #RRGGBB colours. */
const contrast = (a, b) => {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// The readers, on known strings first.
ok(prop(rule('.a { color: red; }\n.b { height: 44px; }', '.b'), 'height') === '44px'
  && rule('/* .b { height: 1px; } */\n.c { x: 1; }', '.b') === ''
  && token(':root {\n  --bg: #0A0B0E;\n  --bg-2: #0F1116;\n}', '--bg') === '#0A0B0E'
  && Math.abs(contrast('#FFFFFF', '#000000') - 21) < 0.01,
'the rule, property, token and contrast readers read what they are given');

// ── F1: the tokens and the grounds ────────────────────────────────────────
const theme = read('shared/theme.css');
const want = {
  '--red': '#E5383B', '--red-2': '#F04A4D', '--red-3': '#C9302F', '--red-rgb': '229, 56, 59',
  '--signal': 'var(--red)', '--signal-rgb': 'var(--red-rgb)', '--on-accent': '#0A0B0E',
  '--cyan': '#FFFFFF', '--cyan-rgb': '255, 255, 255', '--bg': '#0A0B0E', '--bg-2': '#0F1116',
  '--text': '#F5F5F7', '--text-dim': '#A1A1A6', '--text-mute': '#808086',
  '--good': '#52C88A', '--bad': '#E8636F', '--warn': '#D9A441', '--bad-rgb': '232, 99, 111',
  '--line': 'rgba(255, 255, 255, 0.09)', '--line-2': 'rgba(255, 255, 255, 0.16)', '--line-input': 'rgba(255, 255, 255, 0.40)',
  '--focus-ring': 'rgba(255, 255, 255, 0.55)', '--ink': '#FFFFFF', '--image-outline': 'rgba(255, 255, 255, 0.1)',
  '--glass-border': 'var(--line)',
  '--paper': '#E9EBF0', '--paper-ink': '#0A0B0E', '--paper-ink-2': '#484A4E', '--paper-ink-3': '#636568',
  '--paper-line': 'rgba(10, 11, 14, 0.14)',
  '--r-card': '6px', '--r-control': '10px', '--r-pill': '999px', '--r-sm': '8px', '--r-lg': '16px',
  '--t-press': '100ms', '--t-slow': '280ms', '--track-display': '-0.02em', '--track-hero': '-0.03em', '--lh-display': '1.1',
  '--ease': 'ease', '--ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)', '--ease-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
  '--z-base': '0', '--z-raised': '1', '--z-menu': '20', '--z-overlay': '40',
};
const off = Object.entries(want).filter(([k, v]) => token(theme, k) !== v).map(([k, v]) => `${k} is "${token(theme, k)}", not "${v}"`);
ok(!off.length, 'theme.css holds the 8.8 tokens: the signal #E5383B, the ground #0A0B0E, the app\'s own ink, lines, focus, paper, roles, tracking, the two curves and the layers', off.join('; '));
// What 8.8 took away stays away: the depth tokens, the decorative grid and
// blur, the third and fourth curves, and the tracked label.
const gone = ['--grid', '--glass-blur', '--glow-cyan', '--glow-red', '--drop', '--drop-hover', '--lift', '--sheen', '--edge-top', '--r-md',
  '--ease-expo', '--ease-spring', '--track-label'].filter((k) => new RegExp(`(?:^|[;\\s{])${k}\\s*:`).test(theme.replace(/\/\*[\s\S]*?\*\//g, '')));
ok(!gone.length, 'and none of the tokens 8.8 removed is defined again', gone.join(', '));
{
  const code = theme.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/backdrop-filter/.test(code) && !/user-select:\s*none;\s*\n\s*cursor/.test(code) && /::selection \{ background: rgba\(255, 255, 255, 0\.18\)/.test(code)
    && /caret-color: var\(--text\)/.test(code) && /:focus-visible \{\s*outline: 2px solid var\(--focus-ring\);\s*outline-offset: 2px;\s*\}/.test(code),
    'no blur anywhere, text selectable with a themed selection and caret, and one focus ring that sets no radius');
  const reduced = (code.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/) || [])[1] || '';
  ok(reduced && !/0\.01ms/.test(reduced) && /@keyframes riseIn\s*\{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(reduced)
    && !/0\.01ms/.test(read('shared/ui.css')),
    'reduced motion turns the shared entrances into fades and no longer collapses every duration to nothing');
}
ok(/\nhtml \{ font-synthesis-weight: none; \}/.test(theme), 'and draws no faked bold: font-synthesis-weight is none on html');
ok(contrast(token(theme, '--on-accent'), token(theme, '--red')) >= 4.5 && contrast('#FFFFFF', token(theme, '--red')) < 4.5,
  `Start's label, the ground on the signal, passes at ${contrast(token(theme, '--on-accent'), token(theme, '--red')).toFixed(2)}:1, where white on it fails at ${contrast('#FFFFFF', token(theme, '--red')).toFixed(2)}:1`);
ok(['--text', '--text-dim', '--text-mute'].every((t) => contrast(token(theme, t), token(theme, '--bg')) >= 4.5 && contrast(token(theme, t), token(theme, '--bg-2')) >= 4.5),
  'and the three inks pass on the ground and the raised ground alike');
const mainWin = fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'main-window.js'), 'utf8');
const ailogWin = fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'ailog-window.js'), 'utf8');
const shot = fs.readFileSync(path.join(ROOT, 'scripts', 'shot-surface.js'), 'utf8');
ok(/const GROUND = '#0A0B0E';/.test(mainWin) && /backgroundColor: '#0A0B0E'/.test(mainWin) && !/#08090A/i.test(mainWin)
  && /backgroundColor: '#0A0B0E'/.test(ailogWin) && !/#0b1119/i.test(ailogWin),
'the main window, its pages and the AI log open on the ground, #0A0B0E');
ok(/backgroundColor: '#0A0B0E'/.test(shot) && !/\boverlay:|\bhistory:/.test(shot), 'and so does a surface\'s picture, with the retired overlay and history gone from its sizes');

// ── F4: Start keeps the signal by its own class; the primary is ink ──────
const ui = read('shared/ui.css');
const shellHtml = read('shell/index.html');
const shellCss = read('shell/shell.css');
ok(/<button id="toggle" class="btn btn-rec toggle" type="button">/.test(shellHtml) && !/id="toggle"[^>]*btn-primary/.test(shellHtml),
  'Start is .btn-rec, never the primary, so the primary turning ink leaves it the signal');
const rec = rule(ui, '.btn-rec');
ok(prop(rec, 'background') === 'var(--red)' && prop(rec, 'color') === 'var(--on-accent)' && prop(rec, 'font-size') === 'var(--fs-heading)'
  && prop(rec, 'font-weight') === 'var(--w-title)' && prop(rec, 'box-shadow') === 'var(--hi-signal)' && prop(rec, 'border-radius') === 'var(--r-btn)'
  && ['600', 'var(--w-title)'].includes(prop(rule(shellCss, '.toggle'), 'font-weight')),
'its fill is the signal, its label the ground at 18px 600, a capsule lit from above and casting no shadow (8.8)', rec.trim());
ok(prop(rule(ui, '.btn-rec:hover:not(:disabled):not(.active)'), 'background') === 'var(--red-2)'
  && prop(rule(ui, '.btn-rec:active:not(:disabled):not(.active)'), 'background') === 'var(--red-3)'
  && !rule(ui, '.btn-rec:hover') && !rule(ui, '.btn-rec:active'),
'its hover and its press are --red-2 and --red-3 and both leave Stop alone (:not(.active)): pressing Stop never flashes the signal');
const ended = rule(shellCss, '.toggle.ended:disabled');
ok(prop(ended, 'opacity') === '1' && prop(ended, 'filter') === 'none' && prop(ended, 'background') === 'transparent'
  && prop(ended, 'border') === '1px solid var(--line-2)' && prop(ended, 'color') === 'var(--text-dim)'
  && contrast(token(theme, '--text-dim'), token(theme, '--bg')) >= 7,
`ended, it is a ghost at full opacity, its words at ${contrast(token(theme, '--text-dim'), token(theme, '--bg')).toFixed(1)}:1, never the faded signal`, ended.trim());
const primary = rule(ui, '.btn-primary');
const HOVER = ':where(:not(:disabled):not([aria-disabled="true"]))';
ok(prop(primary, 'background') === 'var(--text)' && prop(primary, 'color') === 'var(--bg)' && prop(primary, 'border-radius') === 'var(--r-btn)'
  && prop(primary, 'height') === '40px' && prop(primary, 'padding') === '0 20px'
  && prop(rule(ui, `.btn-primary${HOVER}:hover`), 'background') === 'var(--cyan)'
  && prop(primary, 'box-shadow') === 'var(--hi-ink)'
  && !/\.btn-primary::after|@keyframes sweep|blur\(|0 0 \d+px/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.btn-primary[^{]*\{[^}]*\}/g).join('\n')),
'the primary is the ink capsule with the ground on it, 40px, white under the pointer, its lit top edge alone (8.8) and no glow or sweep');

// ── F5: the shared components ─────────────────────────────────────────────
const btn = rule(ui, '.btn');
const code = ui.replace(/\/\*[\s\S]*?\*\//g, '');
// THREE RANKS (8.8): a bare .btn is the secondary, a quiet rectangle at
// --r-control with one hairline and no shadow. Under the pointer only its
// fill, edge and ink answer; pressed it goes to .97, and nothing rises or
// presses into an inset shadow.
ok(prop(btn, 'height') === '36px' && prop(btn, 'border-radius') === 'var(--r-control)' && prop(btn, 'font-size') === 'var(--fs-ui)'
  && prop(btn, 'font-weight') === 'var(--w-label)' && prop(btn, 'padding') === '0 14px' && prop(btn, 'gap') === 'var(--space-2)'
  && prop(btn, 'background') === 'transparent' && prop(btn, 'border') === '1px solid var(--line-2)' && prop(btn, 'box-shadow') === 'none'
  && prop(btn, 'user-select') === 'none'
  && !pointerRule(ui, `.btn${HOVER}:hover`) && !/translate/.test(rule(ui, `.btn${HOVER}:hover`))
  && /scale\(0\.97\)/.test(rule(ui, `.btn${HOVER}:active`)) && !/inset 0 1px 2px/.test(code)
  && !/\.btn:hover\s*\{|\.btn:active\s*\{/.test(code),
'a bare button is the secondary: 36px, --r-control, Geist 500 14px, one hairline and no shadow, no rise, and a press to .97', btn.trim());
ok(prop(rule(ui, '.btn.md'), 'height') === '36px' && prop(rule(ui, '.btn.sm'), 'height') === '30px' && prop(rule(ui, '.btn.sm'), 'font-size') === 'var(--fs-label)'
  && prop(rule(ui, '.btn:has(> .kbd:last-child, > kbd:last-child, > .keys:last-child)'), 'padding-right') === '8px'
  && prop(rule(ui, '.btn:has(> svg:first-child)'), 'padding-left') === '12px' && prop(rule(ui, '.btn-primary:has(> svg:first-child)'), 'padding-left') === '18px'
  && prop(rule(ui, '.btn.sm::before'), 'inset') === '-5px 0',
'with a 36px and a 30px size (whose hit area still reaches 40px), a keycap at its end taking the end padding to 8px, and the icon side 2px closer');
const ghost = rule(ui, '.btn-ghost, .btn-secondary');
ok(prop(ghost, 'background') === 'transparent' && prop(ghost, 'border-color') === 'var(--line-2)' && prop(ghost, 'color') === 'var(--text)'
  && prop(rule(ui, `.btn${HOVER}:hover`), 'background') === 'rgba(255, 255, 255, 0.05)'
  && prop(rule(ui, '.btn-link'), 'border-color') === 'transparent' && prop(rule(ui, '.btn-link'), 'color') === 'var(--text-dim)',
'the ghost and the secondary are the bare .btn by older names, and the borderless link is .btn-link');
const tert = rule(ui, '.btn-tertiary');
ok(prop(tert, 'text-decoration-line') === 'underline' && prop(tert, 'text-decoration-color') === 'var(--line-2)' && prop(tert, 'background') === 'transparent'
  && prop(rule(ui, `.btn-tertiary${HOVER}:hover`), 'text-decoration-color') === 'var(--text-mute)' && prop(rule(ui, '.btn-tertiary::before'), 'height') === '32px',
'the tertiary is words underlined at rest in --line-2, --text-mute under the pointer, its hit area 32px tall');
const danger = rule(ui, '.btn-ghost.danger:hover:not(:disabled)');
ok(prop(danger, 'color') === 'var(--signal)' && /rgba\(var\(--signal-rgb\), 0\.5\)/.test(danger) && /rgba\(var\(--signal-rgb\), 0\.08\)/.test(danger),
  'a destructive ghost takes the signal under the pointer alone');
// The mono uppercase kicker and the indexed eyebrow are gone (8.7): a label
// is Geist 12/500 in --text-mute, sentence case, and no renderer asks for
// either class.
ok(!rule(ui, '.mono').trim() && !rule(ui, '.eyebrow').trim() && !rule(ui, '.eyebrow::before').trim(),
  'no .mono kicker and no .eyebrow in ui.css');
{
  const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const asks = walk(rendererDir).filter((f) => /\.(html|js)$/.test(f))
    .filter((f) => /class="(?:[^"]*\s)?(?:mono|eyebrow)(?:\s[^"]*)?"|['"](?:[^'"]* )?(?:mono|eyebrow)(?: [^'"]*)?['"]\s*[,)]/.test(fs.readFileSync(f, 'utf8')));
  ok(!asks.length, 'and no surface asks for them', asks.join(', '));
  // 8.8: the viewfinder, the column grid, the hover lift, gradient text and
  // the hero stat tiles are gone, and nothing asks for them.
  const tells = walk(rendererDir).filter((f) => /\.(html|js|css)$/.test(f))
    .filter((f) => /(?:class="|['"\s])(?:vf|colgrid|hover-lift|grad-num)(?=["'\s])|\.(?:vf|colgrid|hover-lift|grad-num)\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
  ok(!tells.length, 'no viewfinder, column grid, hover lift or gradient number is drawn or asked for', tells.join(', '));
}
const cap = rule(ui, 'kbd, .kbd');
ok(prop(cap, 'height') === '22px' && prop(cap, 'border') === '1px solid var(--line-2)' && prop(cap, 'border-radius') === 'var(--r-card)'
  && prop(cap, 'font-family') === 'var(--font-mono)' && prop(cap, 'font-weight') === '500' && prop(cap, 'font-size') === '11px'
  && /translateY\(1px\)/.test(rule(ui, 'kbd.is-pressed, .kbd.is-pressed')) && /var\(--t-press\)/.test(prop(cap, 'transition')),
'a keycap is 22px, the control hairline, --r-card, Geist Mono 500 11px, and goes down 1px on --t-press', cap.trim());
ok(prop(rule(ui, '[data-keys]::after'), 'content') === 'attr(data-keys) / ""' && prop(rule(ui, '[data-keys]::after'), 'display') === 'none',
  'a cap drawn from data-keys holds the chord with empty alternative text, hidden until its surface shows it');
const local = [['onboarding/onboarding.css', /(?:^|\n)kbd\s*\{/], ['settings/settings.css', /(?:^|\n)kbd\s*\{/], ['ailog/ailog.css', /\.keyhint kbd\s*\{/]]
  .filter(([f, re]) => { const c = read(f).replace(/\/\*[\s\S]*?\*\//g, ''); return re.test(c) || /Consolas/.test(c); }).map(([f]) => f);
ok(!local.length, 'and it is every keycap in the app: the surfaces\' own kbd rules are gone', local.join(', '));
ok(!rule(ui, '.vf::before') && !rule(ui, '.stats .stat-n') && !rule(ui, '.colgrid') && !rule(ui, '.hover-lift') && !rule(ui, '.grad-num')
  && prop(rule(ui, '.sig-dot'), 'background') === 'var(--signal)' && prop(rule(ui, '.sig-dot.off'), 'background') === 'var(--text-mute)',
'ui.css draws no viewfinder, stat tiles, column grid, hover lift or gradient number, and the signal dot has its off state in ink-3');
const input = rule(ui, '.input');
ok(prop(input, 'height') === '44px' && prop(input, 'font-family') === 'var(--font)' && prop(input, 'font-size') === 'var(--fs-ui)' && prop(input, 'letter-spacing') === '0'
  && prop(input, 'border') === '1px solid var(--line-input)' && prop(input, 'border-radius') === 'var(--r-control)' && prop(input, 'background') === 'transparent'
  && !prop(rule(ui, '.input:focus'), 'box-shadow') && !/SF Mono|Consolas/.test(code),
'an input is 44px of untracked Geist 14px in the 3:1 field edge, no glow on focus, no literal font left', input.trim());
ok(prop(rule(ui, '.icon-btn'), 'border-radius') === 'var(--r-control)' && prop(rule(ui, '.icon-btn'), 'box-shadow') === 'none'
  && prop(rule(ui, '.icon-btn'), 'border') === '1px solid var(--line-2)' && prop(rule(ui, '.icon-btn::before'), 'inset') === '-3px'
  && !pointerRule(ui, `.icon-btn${HOVER}:hover`) && !/translate/.test(rule(ui, `.icon-btn${HOVER}:hover`))
  && /scale\(0\.97\)/.test(rule(ui, `.icon-btn${HOVER}:active`)) && !/\.icon-btn[^{]*::after\s*\{/.test(code),
'an icon button is the secondary rectangle holding an icon: --r-control, a hairline and no shadow, a 40px hit area, no halo, a press to .97');
ok(prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-weight') === '600'
  && prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-size') === 'var(--fs-h2)'
  && prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'letter-spacing') === 'var(--track-display)',
'a page title is Geist 600 at --fs-h2 (24px) on --track-display');
const DEAD = /\.style-grid|\.style-opt|\.sp-(?:glass|solid|minimal|neon)|(?:^|\n)\.sp\b|\.chip\b|\.dot\.(?:coaching|paused|stopped)|\.count-in|\.live-dot|livePulse|\.sheet-in|\.stagger|\.icon-btn\.danger/;
ok(DEAD.test('.chip.good { x: 1; }') && DEAD.test('.stagger > * { }') && !DEAD.test('.chips { } .dot { } .rise-in { }'), 'the dead rule reader finds the tip era and passes over what stays');
ok(!DEAD.test(code) && /@keyframes sheetIn\s*\{/.test(theme) && /@keyframes riseIn\s*\{/.test(theme) && !/@keyframes pulse\b/.test(code + theme)
  && rule(ui, '.rise-in') && !/infinite/.test(code),
'the tip era rules are gone from ui.css, the shared entrances live in theme.css, and nothing in ui.css loops');

// ── F5: the grade card, drawn once, with no frame of its own ──────────────
const gv = read('shared/grade-view.css');
const card = rule(gv, '.gv-grade');
ok(!prop(card, 'background') && !prop(card, 'border') && !prop(card, 'border-radius') && !prop(card, 'padding'),
  'the grade card has no frame of its own: its host frames it', card.trim());
const score = rule(gv, '.gv-score');
ok(prop(score, 'font-family') === 'var(--font)' && prop(score, 'font-weight') === '600' && prop(score, 'font-size') === '44px'
  && prop(score, 'font-variant-numeric') === 'tabular-nums',
'its score is Geist 600 44px with figures one width', score.trim());
const lt = rule(gv, '.gv-letter');
ok(prop(lt, 'width') === '40px' && prop(lt, 'height') === '40px' && prop(lt, 'border-radius') === 'var(--r-btn)' && prop(lt, 'font-weight') === '600'
  && prop(rule(gv, '.gv-letter.good'), 'color') === 'var(--good)' && prop(rule(gv, '.gv-letter.mid'), 'color') === 'var(--text)'
  && prop(rule(gv, '.gv-letter.warn'), 'color') === 'var(--warn)' && prop(rule(gv, '.gv-letter.bad'), 'color') === 'var(--bad)',
'its letter is a 40px capsule on --r-btn (8.7, the same mark as the library\'s .m-letter), Geist 600, S and A --good, B ink, C --warn, D --bad');
ok(prop(rule(gv, '.gv-cat-score'), 'font-weight') === '600' && prop(rule(gv, '.gv-cat-score'), 'font-family') === 'var(--font)'
  && /^500 12px var\(--font-mono\)/.test(prop(rule(gv, '.gv-rchip'), 'font'))
  && prop(rule(gv, '.gv-label'), 'font-size') === '12px' && prop(rule(gv, '.gv-label'), 'font-weight') === '500' && prop(rule(gv, '.gv-label'), 'color') === 'var(--text-mute)'
  && prop(rule(gv, '.gv-block h3'), 'font-size') === '15px' && prop(rule(gv, '.gv-block h3'), 'font-weight') === '600' && !prop(rule(gv, '.gv-block h3'), 'font-family'),
'its category scores are Geist 600, its round chips Geist Mono 500, its small labels Geist 12/500 mute and its headings Geist 15/600 (8.7, no mono kickers)');

global.document = new Document('<body></body>');
global.window = undefined;
const gvFile = path.join(RENDERER, 'shared', 'grade-view.js');
delete require.cache[gvFile];
const GV = require(gvFile);
const L = (g, o) => (typeof GV.letter === 'function' ? GV.letter(g, o) : { className: 'no letter()', textContent: '' });
const a = L(84);
const d = L({ score: 58, letter: 'D' }, { size: 'sm' });
const b = L(71, { size: 'xs' });
const none = L(null);
ok(typeof GV.letter === 'function' && a.className === 'gv-letter good' && a.textContent === 'A'
  && d.className === 'gv-letter bad sm' && d.textContent === 'D' && b.className === 'gv-letter mid xs' && b.textContent === 'B'
  && none.className === 'gv-letter none' && none.textContent === '?' && L(95, { size: 'huge' }).className === 'gv-letter good',
'GradeView.letter() draws the letter alone in its tone, at 40, 28 or 20px, and no grade as a ? in no colour',
[a, d, b, none].map((n) => `${n.className}=${n.textContent}`).join(' '));
const G = { score: 61, letter: 'C', categories: [{ label: 'Impact', score: 70, evidence: ['First kill 3 times'] }] };
const full = GV.gradeCard(G);
const compact = GV.gradeCard(G, { compact: true });
ok(full.querySelector('.gv-top') && full.querySelector('.gv-score').textContent === '61' && full.querySelectorAll('.gv-cat').length === 1,
  'the card has its score row and its categories');
ok(!compact.querySelector('.gv-top') && !compact.querySelector('.gv-score') && !compact.querySelector('.gv-letter')
  && compact.querySelectorAll('.gv-cat').length === 1 && compact.querySelector('.gv-chips').textContent === 'First kill 3 times',
'and compact, for the review under its Verdict, leaves out the score row and keeps the categories with their evidence');

console.log(fails ? `\n${fails} look check(s) FAILED` : '\nall look checks passed: the tokens, Start, the primary, the shared components and the grade card are the 8.6 look');
process.exit(fails ? 1 : 0);
