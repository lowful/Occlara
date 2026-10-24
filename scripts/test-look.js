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
  '--red': '#FF5A3C', '--red-2': '#FE6347', '--red-3': '#E65136', '--red-rgb': '255, 90, 60',
  '--signal': 'var(--red)', '--signal-rgb': 'var(--red-rgb)', '--on-accent': '#0A0B0E',
  '--cyan': '#FFFFFF', '--cyan-rgb': '255, 255, 255', '--bg': '#0A0B0E', '--bg-2': '#0F1116',
  '--text': '#F5F5F7', '--text-dim': '#A1A1A6', '--text-mute': '#808086',
  '--good': '#52C88A', '--bad': '#E8636F', '--warn': '#D9A441', '--bad-rgb': '232, 99, 111',
  '--line': 'rgba(255, 255, 255, 0.09)', '--line-2': 'rgba(255, 255, 255, 0.16)', '--grid': 'rgba(255, 255, 255, 0.045)',
  '--glass-border': 'var(--line)',
  '--glow-cyan': '0 0 0 1px rgba(var(--cyan-rgb), 0.22)', '--glow-red': '0 0 0 1px rgba(var(--red-rgb), 0.45)',
  '--paper': '#E9EBF0', '--paper-ink': '#0A0B0E', '--paper-ink-2': '#484A4E', '--paper-ink-3': '#636568',
  '--paper-line': 'rgba(10, 11, 14, 0.14)',
  '--r-card': '6px', '--r-control': '10px', '--r-pill': '999px', '--r-sm': '8px', '--r-md': '12px', '--r-lg': '16px',
  '--t-press': '80ms', '--track-display': '-0.02em', '--lh-display': '1', '--track-label': '0.08em',
  '--ease': 'cubic-bezier(0.22, 1, 0.36, 1)', '--ease-expo': 'cubic-bezier(0.16, 1, 0.30, 1)',
};
const off = Object.entries(want).filter(([k, v]) => token(theme, k) !== v).map(([k, v]) => `${k} is "${token(theme, k)}", not "${v}"`);
ok(!off.length, 'theme.css holds the 8.6 tokens: the signal #FF5A3C, the ground #0A0B0E, the app\'s own ink, lines, paper, roles and tracking', off.join('; '));
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
ok(prop(rec, 'background') === 'var(--red)' && prop(rec, 'color') === 'var(--on-accent)' && prop(rec, 'font-size') === '19px'
  && prop(rec, 'font-weight') === '600' && prop(rule(shellCss, '.toggle'), 'font-weight') === '600',
'its fill is the signal, its label the ground at 19px 600', rec.trim());
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
ok(prop(primary, 'background') === 'var(--text)' && prop(primary, 'color') === 'var(--bg)'
  && prop(rule(ui, '.btn-primary:where(:not(:disabled)):hover'), 'background') === 'var(--cyan)'
  && !/\.btn-primary::after|@keyframes sweep|box-shadow/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.btn-primary[^{]*\{[^}]*\}/g).join('\n')),
'the primary is the ink with the ground on it, white under the pointer, with no glow, lift or sweep');

// ── F5: the shared components ─────────────────────────────────────────────
const btn = rule(ui, '.btn');
ok(prop(btn, 'height') === '44px' && prop(btn, 'border-radius') === 'var(--r-control)' && prop(btn, 'font-size') === '15px'
  && prop(btn, 'font-weight') === '500' && prop(btn, 'padding') === '0 18px' && prop(btn, 'gap') === 'var(--space-3)'
  && !prop(btn, 'box-shadow') && !/\.btn:hover\s*\{|\.btn:active\s*\{|translateY\(-1px\)/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')),
'a button is flat: 44px, --r-control, Geist 500 15px, no shadow, no lift and no press of its own', btn.trim());
ok(prop(rule(ui, '.btn.md'), 'height') === '40px' && prop(rule(ui, '.btn.sm'), 'height') === '32px' && prop(rule(ui, '.btn.sm'), 'font-size') === '13px'
  && prop(rule(ui, '.btn:has(> .kbd:last-child, > kbd:last-child, > .keys:last-child)'), 'padding-right') === '6px',
'with a 40px and a 32px size, and a keycap at its end taking the end padding to 6px');
const ghost = rule(ui, '.btn-ghost');
ok(prop(ghost, 'background') === 'rgba(255, 255, 255, 0.03)' && prop(ghost, 'border-color') === 'var(--line-2)' && prop(ghost, 'color') === 'var(--text)'
  && prop(rule(ui, '.btn-ghost:where(:not(:disabled)):hover'), 'background') === 'rgba(255, 255, 255, 0.09)'
  && prop(rule(ui, '.btn-link'), 'border-color') === 'transparent' && prop(rule(ui, '.btn-link'), 'color') === 'var(--text-dim)',
'the ghost is the bordered secondary, and the borderless link it was is .btn-link');
const danger = rule(ui, '.btn-ghost.danger:hover:not(:disabled)');
ok(prop(danger, 'color') === 'var(--signal)' && /rgba\(var\(--signal-rgb\), 0\.5\)/.test(danger) && /rgba\(var\(--signal-rgb\), 0\.08\)/.test(danger),
  'a destructive ghost takes the signal under the pointer alone');
const mono = rule(ui, '.mono');
ok(prop(mono, 'font-family') === 'var(--font-mono)' && prop(mono, 'font-weight') === '500' && prop(mono, 'font-size') === '11px'
  && prop(mono, 'letter-spacing') === 'var(--track-label)' && prop(mono, 'text-transform') === 'uppercase' && prop(mono, 'color') === 'var(--text-mute)',
'the mono label is Geist Mono 500 11px, uppercase on --track-label, in ink-3', mono.trim());
const ix = rule(ui, '.eyebrow::before');
ok(prop(ix, 'counter-increment') === 'sec' && prop(ix, 'content') === '"[ " counter(sec, decimal-leading-zero) " ]" / ""'
  && prop(ix, 'color') === 'var(--text-dim)' && prop(rule(ui, '.eyebrow'), 'font-family') === 'var(--font-mono)',
'an eyebrow draws its index from a counter, with empty alternative text, so its own text stays the label');
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
const vf = rule(ui, '.vf::before');
ok(prop(vf, 'inset') === '-2px' && prop(vf, 'border') === '1.5px solid var(--text-dim)' && /clip-path: polygon\(/.test(vf)
  && prop(rule(ui, '.vf:hover::before, .vf:focus-within::before'), 'inset') === '-4px' && !/gradient/.test(vf),
'the viewfinder is one border clipped to four corners, 2px out, opening to 4px under the pointer or with focus inside');
ok(prop(rule(ui, '.stats .stat-n'), 'font-size') === '64px' && prop(rule(ui, '.stats.sm .stat-n'), 'font-size') === '36px'
  && prop(rule(ui, '.stats.xs .stat-n'), 'font-size') === '24px' && prop(rule(ui, '.stats .stat-n'), 'font-variant-numeric') === 'tabular-nums'
  && prop(rule(ui, '.stats > .stat'), 'border-left') === '1px solid var(--line)' && !rule(ui, '.stat'),
'the stat block is held under .stats (the review keeps its own .stat), its numbers tabular at 64, 36 and 24px');
ok(prop(rule(ui, '.colgrid > i'), 'border-left') === '1px solid var(--grid)' && prop(rule(ui, '.colgrid'), 'pointer-events') === 'none'
  && prop(rule(ui, '.sig-dot'), 'background') === 'var(--signal)' && prop(rule(ui, '.sig-dot.off'), 'background') === 'var(--text-mute)',
'the column grid is twelve hairlines of --grid, and the signal dot has its off state in ink-3');
const input = rule(ui, '.input');
ok(prop(input, 'height') === '44px' && prop(input, 'font-family') === 'var(--font-mono)' && prop(input, 'font-size') === '14px'
  && prop(input, 'border') === '1px solid var(--line-2)' && prop(input, 'border-radius') === 'var(--r-control)' && prop(input, 'background') === 'transparent'
  && prop(rule(ui, '.input:focus'), 'box-shadow') === 'var(--glow-cyan)' && !/SF Mono|Consolas/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')),
'an input is 44px of Geist Mono 14px in the control hairline, no literal font left', input.trim());
ok(prop(rule(ui, '.icon-btn'), 'border-radius') === 'var(--r-control)' && !prop(rule(ui, '.icon-btn'), 'box-shadow')
  && !/translateY/.test(rule(ui, '.icon-btn:where(:not(:disabled)):hover')),
'an icon button is --r-control and as flat as the rest');
ok(prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-weight') === '600'
  && prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-size') === '24px'
  && prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'letter-spacing') === 'var(--track-display)',
'a page title is Geist 600 at 24px on --track-display');
const DEAD = /\.style-grid|\.style-opt|\.sp-(?:glass|solid|minimal|neon)|(?:^|\n)\.sp\b|\.chip\b|\.dot\.(?:coaching|paused|stopped)|\.count-in|\.live-dot|livePulse|\.sheet-in|\.stagger|\.icon-btn\.danger/;
ok(DEAD.test('.chip.good { x: 1; }') && DEAD.test('.stagger > * { }') && !DEAD.test('.chips { } .dot { } .rise-in { }'), 'the dead rule reader finds the tip era and passes over what stays');
ok(!DEAD.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')) && /@keyframes sheetIn \{/.test(ui) && /@keyframes countIn \{/.test(ui) && /@keyframes pulse \{/.test(ui)
  && rule(ui, '.rise-in') && rule(ui, '.hover-lift') && rule(ui, '.grad-num'),
'the tip era rules are gone from ui.css, and what weekly, onboarding, Stats and the AI log still use is kept');

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
ok(prop(lt, 'width') === '40px' && prop(lt, 'height') === '40px' && prop(lt, 'border-radius') === 'var(--r-card)' && prop(lt, 'font-weight') === '600'
  && prop(rule(gv, '.gv-letter.good'), 'color') === 'var(--good)' && prop(rule(gv, '.gv-letter.mid'), 'color') === 'var(--text)'
  && prop(rule(gv, '.gv-letter.warn'), 'color') === 'var(--warn)' && prop(rule(gv, '.gv-letter.bad'), 'color') === 'var(--bad)',
'its letter is a 40px square on --r-card, Geist 600, S and A --good, B ink, C --warn, D --bad');
ok(prop(rule(gv, '.gv-cat-score'), 'font-weight') === '500' && /^500 /.test(prop(rule(gv, '.gv-rchip'), 'font'))
  && prop(rule(gv, '.gv-label'), 'font-family') === 'var(--font-mono)' && prop(rule(gv, '.gv-block h3'), 'font-family') === 'var(--font-mono)',
'its category scores and round chips are Geist Mono 500, its small labels the mono label');

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
  && compact.querySelectorAll('.gv-cat').length === 1 && compact.querySelector('.gv-ev').textContent === 'First kill 3 times',
'and compact, for the review under its Verdict, leaves out the score row and keeps the categories with their evidence');

console.log(fails ? `\n${fails} look check(s) FAILED` : '\nall look checks passed: the tokens, Start, the primary, the shared components and the grade card are the 8.6 look');
process.exit(fails ? 1 : 0);
