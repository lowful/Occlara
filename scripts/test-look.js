'use strict';

/**
 * ORBIT'S FOUNDATION (27 Nov 2026, over the 8.6 crescent look), read off the
 * stylesheets and run on the shared grade card: the tokens and the ground,
 * the accent and its glass, Start the loudest word by its own class with the
 * record icon beside it, the white glass primary, the shared components every
 * surface builds on, the two springs, and the grade card drawn once with no
 * frame of its own. Each case is a rule of ORBIT-SPEC.md a later edit could
 * quietly undo: Start losing its glass or its icon, a label on the glass
 * falling under 4.5:1, a press that no longer springs back, the eyebrow
 * leaving the mono face, the arrow sliding by its width instead of a
 * transform, a keycap rounding off at the card's radius.
 *
 * The accent's places, the tokens only sheets and the mono weights are
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
/** [r, g, b, a] of #RRGGBB or #RRGGBBAA. */
const rgba = (h) => [1, 3, 5, 7].map((i) => (i < 7 || h.length > 7 ? parseInt(h.slice(i, i + 2), 16) : 255));
/** A see-through colour laid over an opaque one, as #RRGGBB. */
const over = (fg, bg) => {
  const [r, g, b, a] = rgba(fg); const [R, G, B] = rgba(bg); const k = a / 255;
  return '#' + [r * k + R * (1 - k), g * k + G * (1 - k), b * k + B * (1 - k)].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};
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
  && Math.abs(contrast('#FFFFFF', '#000000') - 21) < 0.01
  && over('#FFFFFF80', '#000000') === '#808080' && over('#123456', '#FFFFFF') === '#123456',
'the rule, property, token, compositing and contrast readers read what they are given');

// ── The tokens and the ground ─────────────────────────────────────────────
const theme = read('shared/theme.css');
const want = {
  '--bg': '#060510', '--card': '#12111A', '--raised': '#161522', '--line': '#CBD0EB1A', '--line-2': '#CBD0EB2B',
  '--text': '#F7F7F7', '--text-2': '#9899A3', '--text-dim': '#9899A3', '--text-3': '#474B52',
  '--accent': '#516AF6', '--accent-2': '#6F85FF', '--accent-t': '#516AF629', '--accent-rgb': '81, 106, 246',
  '--btn': '#606AF780', '--btn-h': '#606AF7CC', '--glass': '#CBD0EB1F', '--glass-h': '#CBD0EB33',
  '--won': '#21C95E', '--lost': '#FF622E', '--good': '#21C95E', '--bad': '#FF622E',
  '--gold-1': '#FFC861', '--gold-2': '#AF770F', '--silver-1': '#FFF3DC', '--silver-2': '#5C5C5C', '--bronze-1': '#FFA35F', '--bronze-2': '#A4571C',
  '--signal': 'var(--accent)', '--signal-rgb': 'var(--accent-rgb)', '--red': '#516AF6', '--red-rgb': '81, 106, 246', '--on-accent': '#FFFFFF',
  '--cyan': '#FFFFFF', '--cyan-rgb': '255, 255, 255',
  '--r-card': '24px', '--r-btn': '12px', '--r-in': '16px', '--r-frame': '6px', '--r-control': '10px', '--r-pill': '999px',
  '--ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)', '--ease-enter': 'cubic-bezier(0.16, 1, 0.3, 1)', '--ease-drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
  '--dur-hover-in': '120ms', '--dur-hover-out': '220ms', '--dur-press': '90ms', '--dur-select': '240ms', '--dur-enter': '480ms',
  '--dur-sheet': '460ms', '--dur-nav': '420ms', '--dur-page-out': '160ms', '--dur-page-in': '380ms', '--stagger': '40ms',
  '--font': "'Onest', 'Segoe UI', system-ui, sans-serif", '--t-display': '40px', '--t-title': '22px',
  '--track-display': '-0.035em', '--track-title': '-0.025em', '--track-body': '-0.011em', '--track-eyebrow': '0.06em', '--lh-display': '1.08',
};
const off = Object.entries(want).filter(([k, v]) => token(theme, k) !== v).map(([k, v]) => `${k} is "${token(theme, k)}", not "${v}"`);
ok(!off.length, 'theme.css holds Orbit\'s tokens: the indigo black ground, the card, the hairlines, the three greys, the accent and its glass, the outcomes, the medals, the radii, the curves and the type', off.join('; '));
// The two springs, as linear(): smooth ends exactly at 1 and never passes it;
// gentle passes 1 by about 1% and settles.
const stops = (v) => [...v.matchAll(/(-?\d*\.?\d+)(?:\s+\d+(?:\.\d+)?%)?\s*[,)]/g)].map((m) => Number(m[1]));
const smooth = stops(token(theme, '--spring-smooth'));
const gentle = stops(token(theme, '--spring-gentle'));
ok(/^linear\(0,/.test(token(theme, '--spring-smooth')) && smooth.length > 20 && smooth[smooth.length - 1] === 1 && Math.max(...smooth) === 1
  && smooth.every((v, i) => i === 0 || v >= smooth[i - 1]),
'the smooth spring is a linear() curve that rises to 1 and never past it', `${smooth.length} stops, peak ${Math.max(...smooth)}`);
ok(/^linear\(0,/.test(token(theme, '--spring-gentle')) && gentle[gentle.length - 1] === 1 && Math.max(...gentle) > 1 && Math.max(...gentle) < 1.02,
  'the gentle spring passes 1 by about 1% and settles there', `peak ${Math.max(...gentle)}`);
ok(/\nhtml \{ font-synthesis-weight: none; \}/.test(theme)
  && /@font-face \{ font-family: 'Onest'; font-style: normal; font-weight: 100 900;[^}]*url\('\.\.\/\.\.\/\.\.\/assets\/fonts\/onest-var\.woff2'\)/.test(theme)
  && fs.existsSync(path.join(ROOT, 'assets', 'fonts', 'onest-var.woff2')),
'Onest is bundled, one variable file from 100 to 900, and nothing is drawn as a faked bold');
ok(['--text', '--text-dim', '--text-mute'].every((t) => contrast(token(theme, t), token(theme, '--bg')) >= 4.5 && contrast(token(theme, t), token(theme, '--card')) >= 4.5),
  'and the three greys meant for words pass on the ground and on a card alike');
// Start's label on its glass, the glass laid over the ground: rest, the
// pointer on it, and the bar's denser glass.
const onGlass = ['--btn', '--btn-h', '--btn-bar', '--btn-bar-h'].map((t) => [t, contrast(token(theme, '--on-accent'), over(token(theme, t), token(theme, '--bg')))]);
ok(onGlass.every(([, c]) => c >= 4.5), `Start's white label passes on its glass over the ground: ${onGlass.map(([t, c]) => `${t} ${c.toFixed(1)}:1`).join(', ')}`);
const mainWin = fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'main-window.js'), 'utf8');
const ailogWin = fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'ailog-window.js'), 'utf8');
const shot = fs.readFileSync(path.join(ROOT, 'scripts', 'shot-surface.js'), 'utf8');
ok(/const GROUND = '#060510';/.test(mainWin) && /backgroundColor: '#060510'/.test(mainWin) && !/#07080C/i.test(mainWin.replace(/\/\/[^\n]*/g, ''))
  && /backgroundColor: '#060510'/.test(ailogWin),
'the main window, its pages and the AI log open on the ground, #060510');
ok(/backgroundColor: '#060510'/.test(shot) && !/\boverlay:|\bhistory:/.test(shot), 'and so does a surface\'s picture');

// ── Start, the loudest word in the app ────────────────────────────────────
const ui = read('shared/ui.css');
const shellHtml = read('shell/index.html');
const shellCss = read('shell/shell.css');
ok(/<button id="toggle" class="btn btn-rec toggle" type="button">/.test(shellHtml) && !/id="toggle"[^>]*btn-primary/.test(shellHtml)
  && /<span class="t-ico rec-ico" aria-hidden="true"><\/span>/.test(shellHtml) && /class="btn-arrow"/.test(shellHtml),
  'the bar\'s Start is .btn-rec with the record icon beside its word and the arrow that slides in');
const rec = rule(ui, '.btn-rec');
ok(prop(rec, 'background') === 'var(--btn)' && prop(rec, 'color') === 'var(--on-accent)' && prop(rec, 'font-size') === '15px'
  && prop(rec, 'font-weight') === '700' && prop(rec, 'letter-spacing') === '-0.01em' && /blur\(12px\)/.test(prop(rec, 'backdrop-filter'))
  && prop(rule(ui, '.btn-rec.xl'), 'font-size') === '17px' && prop(rule(ui, '.btn-rec.xl'), 'height') === '52px'
  && prop(rule(ui, '.btn'), 'font-size') === '15px' && prop(rule(ui, '.btn'), 'font-weight') === '600',
'Start is the indigo glass over a 12px blur, its label 15px 700 in white (17px at the hero size), where every other button is 15px 600', rec.trim());
ok(prop(rule(ui, '.btn-rec:hover:not(:disabled):not(.active)'), 'background') === 'var(--btn-h)' && !rule(ui, '.btn-rec:hover') && !rule(ui, '.btn-rec:active'),
  'its hover is --btn-h, and its hover and press leave Stop alone (:not(.active))');
const ico = rule(ui, '.rec-ico');
const dot = rule(ui, '.rec-ico::after');
ok(prop(ico, 'width') === '14px' && prop(ico, 'height') === '14px' && /inset 0 0 0 1\.5px rgba\(255, 255, 255, 0\.7\)/.test(prop(ico, 'box-shadow'))
  && prop(dot, 'width') === '6px' && prop(dot, 'height') === '6px' && /transform 160ms/.test(prop(dot, 'transition'))
  && /scale\(1\.1667\)/.test(rule(ui, '.btn-rec:hover:not(:disabled):not(.active) .rec-ico::after'))
  && prop(rule(ui, '.btn-rec:hover:not(:disabled):not(.active) .rec-ico::after'), 'background') === 'var(--accent-tint)'
  && /border-radius: 2\.5px/.test(rule(ui, '.btn-rec.active .rec-ico::after')),
'the record icon is a 14px ring of 1.5px at 70% holding a 6px dot that takes the tint and grows to 7px over 160ms, and squares off into the stop glyph on Stop');
ok(/box-shadow: inset/.test(rule(ui, '.btn-rec.active')) && !/animation/.test(rule(ui, '.btn-rec.active')),
  'Stop glows from inside, and the glow is still: nothing on the Recording screen moves but its arrival');
const ended = rule(shellCss, '.toggle.ended:disabled');
ok(prop(ended, 'opacity') === '1' && prop(ended, 'background') === 'transparent' && prop(ended, 'border') === '1px solid var(--line-2)'
  && prop(ended, 'color') === 'var(--text-dim)' && contrast(token(theme, '--text-dim'), token(theme, '--bg')) >= 7,
`ended, it is a ghost at full opacity, its words at ${contrast(token(theme, '--text-dim'), token(theme, '--bg')).toFixed(1)}:1, never a faded glass`, ended.trim());

// ── The buttons ───────────────────────────────────────────────────────────
const btn = rule(ui, '.btn');
ok(prop(btn, 'height') === '44px' && prop(btn, 'border-radius') === 'var(--r-btn)' && prop(btn, 'border') === '1px solid var(--line)'
  && prop(btn, 'transition-property') === 'background-color, border-color, color, transform, opacity'
  && /var\(--dur-hover-out\)/.test(prop(btn, 'transition-duration')) && /var\(--spring-gentle\)/.test(prop(btn, 'transition-timing-function'))
  && /var\(--dur-hover-in\)/.test(prop(rule(ui, '.btn:where(:not(:disabled)):hover'), 'transition-duration'))
  && prop(rule(ui, '.btn:where(:not(:disabled)):active'), 'transform') === 'scale(0.97)'
  && prop(rule(ui, '.btn:where(:not(:disabled)):active'), 'transition-duration') === 'var(--dur-press)'
  && !/\.btn:hover\s*\{|\.btn:active\s*\{/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')),
'a button is 44px, radius 12, a hairline; its hover comes in over 120ms and leaves over 220; its press goes to .97 in 90ms and the gentle spring lets it back', btn.trim());
ok(prop(rule(ui, '.btn.lg'), 'height') === '52px' && prop(rule(ui, '.btn.md'), 'height') === '36px' && prop(rule(ui, '.btn.sm'), 'height') === '30px'
  && prop(rule(ui, '.btn:has(> .kbd:last-child, > kbd:last-child, > .keys:last-child)'), 'padding-right') === '8px',
'with a 52px hero size, 36 and 30px sizes, and a keycap at its end taking the end padding to 8px');
const label = rule(ui, '.btn:has(> .btn-arrow) > .btn-label');
const arrow = rule(ui, '.btn-arrow');
ok(prop(label, 'transform') === 'translateX(8px)' && prop(arrow, 'opacity') === '0' && /translateX/.test(prop(arrow, 'transform'))
  && /var\(--spring-smooth\)/.test(prop(arrow, 'transition')) && /180ms/.test(prop(arrow, 'transition'))
  && prop(rule(ui, '.btn:where(:not(:disabled)):is(:hover, :focus-visible) > .btn-arrow'), 'opacity') === '1'
  && !/width/.test(prop(arrow, 'transition')),
'under the pointer the label shifts 8px and the arrow slides in, 180ms on the smooth spring, by transform and opacity alone');
const primary = rule(ui, '.btn-primary');
ok(prop(primary, 'background') === 'var(--glass)' && prop(primary, 'color') === 'var(--text)' && prop(primary, 'font-weight') === '700'
  && prop(rule(ui, '.btn-primary:where(:not(:disabled)):hover'), 'background') === 'var(--glass-h)'
  && !/--btn|--accent/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.btn-primary[^{]*\{[^}]*\}/g).join('\n')),
'the primary is the white glass, its hover the stronger glass, and never the accent: the indigo is Start\'s');
const ghost = rule(ui, '.btn-ghost');
ok(prop(ghost, 'background') === 'var(--glass-q)' && prop(ghost, 'border-color') === 'var(--line)' && prop(ghost, 'color') === 'var(--text)'
  && prop(rule(ui, '.btn-link'), 'border-color') === 'transparent' && prop(rule(ui, '.btn-link'), 'background') === 'transparent'
  && prop(rule(ui, '.btn-link:where(:not(:disabled)):hover'), 'background') === 'var(--glass-q)',
'the ghost is the quiet glass, and the text only link fades the glass in under the pointer');
const danger = rule(ui, '.btn-ghost.danger');
ok(prop(danger, 'color') === 'var(--bad)' && /rgba\(var\(--bad-rgb\), 0\.3\)/.test(danger)
  && prop(rule(ui, '.btn-ghost.danger:active:not(:disabled)'), 'background') === 'var(--bad)'
  && !/--signal|--red|--accent/.test(rule(ui, '.btn-ghost.danger:hover:not(:disabled)')),
'a destructive ghost is quiet coral text and line, filled coral only while pressed, and never the accent');
const ib = rule(ui, '.icon-btn');
ok(prop(ib, 'width') === '36px' && prop(ib, 'height') === '36px' && prop(ib, 'border-radius') === '50%'
  && prop(rule(ui, '.icon-btn:where(:not(:disabled)):active'), 'transform') === 'scale(0.86)' && /var\(--spring-gentle\)/.test(prop(ib, 'transition-timing-function')),
'an icon button is 36px round, squished to .86 by a press and let back on the gentle spring');
const oCard = rule(ui, '.o-card');
ok(prop(oCard, 'background') === 'var(--card)' && prop(oCard, 'border') === '1px solid var(--line)' && prop(oCard, 'border-radius') === 'var(--r-card)'
  && prop(oCard, 'padding') === '28px' && prop(oCard, 'contain') === 'paint' && /200ms/.test(prop(oCard, 'transition'))
  // the hover sits in a pointer's media query, indented: read it unindented
  && prop(rule(ui.replace(/\n[ \t]+/g, '\n'), '.o-card.is-link:hover'), 'border-color') === 'var(--line-2)'
  && prop(rule(ui.replace(/\n[ \t]+/g, '\n'), '.o-card.is-link:hover'), 'transform') === 'translateY(-1px)',
'a card is --card, radius 24, a hairline and 28px in, contained, lifting 1px to the stronger hairline over 200ms');
const eyebrow = rule(ui, '.o-eyebrow');
ok(prop(eyebrow, 'font-family') === 'var(--font-mono)' && prop(eyebrow, 'font-weight') === '500' && prop(eyebrow, 'font-size') === '12px'
  && prop(eyebrow, 'text-transform') === 'uppercase' && prop(eyebrow, 'letter-spacing') === 'var(--track-eyebrow)' && prop(eyebrow, 'color') === 'var(--accent-2)',
'its eyebrow is Geist Mono 500 12px, uppercase on .06em, in the accent\'s lighter step');
ok(prop(rule(ui, '.o-display'), 'font-size') === 'var(--t-display)' && prop(rule(ui, '.o-display'), 'font-weight') === '700'
  && prop(rule(ui, '.o-display'), 'letter-spacing') === 'var(--track-display)' && prop(rule(ui, '.o-title'), 'font-size') === 'var(--t-title)',
'the display line is Onest 700 at 40px on -0.035em, a card title 22px');
const cap = rule(ui, 'kbd, .kbd');
ok(prop(cap, 'height') === '22px' && prop(cap, 'border') === '1px solid var(--line-2)' && prop(cap, 'border-radius') === 'var(--r-frame)'
  && prop(cap, 'font-family') === 'var(--font-mono)' && prop(cap, 'font-weight') === '500' && prop(cap, 'font-size') === '11px'
  && /translateY\(1px\)/.test(rule(ui, 'kbd.is-pressed, .kbd.is-pressed')) && /var\(--t-press\)/.test(prop(cap, 'transition')),
'a keycap is 22px, the control hairline, the frame\'s 6px radius (never the card\'s), Geist Mono 500 11px, and goes down 1px on --t-press', cap.trim());
const leftover = ['shared', 'review', 'matches', 'moments', 'settings', 'stats', 'learn', 'ailog', 'players', 'profile', 'trainer', 'feedback', 'onboarding']
  .flatMap((d) => fs.readdirSync(path.join(RENDERER, d)).filter((f) => f.endsWith('.css')).map((f) => `${d}/${f}`))
  .filter((f) => /var\(--r-card\)/.test(read(f)) && !/\.o-card/.test(read(f)));
ok(!leftover.length, 'and every keycap, frame and small image that used the old 6px card radius takes --r-frame', leftover.join(', '));
ok(prop(rule(ui, '[data-keys]::after'), 'content') === 'attr(data-keys) / ""' && prop(rule(ui, '[data-keys]::after'), 'display') === 'none',
  'a cap drawn from data-keys holds the chord with empty alternative text, hidden until its surface shows it');
const input = rule(ui, '.input');
ok(prop(input, 'height') === '44px' && prop(input, 'border') === '1px solid var(--line-2)' && prop(input, 'border-radius') === 'var(--r-in)'
  && prop(input, 'background') === 'var(--card)' && prop(rule(ui, '.input:focus'), 'border-color') === 'var(--accent-2)'
  && /var\(--accent-t\)/.test(prop(rule(ui, '.input:focus'), 'box-shadow')),
'an input is 44px on the card\'s fill, radius 16, the stronger hairline, and the accent\'s ring when focused', input.trim());
const sw = rule(ui, '.switch');
ok(prop(sw, 'width') === '44px' && prop(sw, 'height') === '26px' && /var\(--spring-smooth\)/.test(prop(rule(ui, '.switch::after'), 'transition'))
  && prop(rule(ui, '.switch[aria-checked="true"]::after'), 'transform') === 'translateX(18px)' && !/--accent|--btn/.test(rule(ui, '.switch[aria-checked="true"]')),
'a switch is 44 by 26, its knob sliding on the smooth spring, on the ink when on: the accent stays in its places');
const thumb = rule(ui, '.seg-thumb');
ok(prop(thumb, 'background') === 'var(--raised)' && /var\(--spring-smooth\)/.test(prop(thumb, 'transition')) && /var\(--dur-select\)/.test(prop(thumb, 'transition'))
  && prop(rule(ui, '.seg-slide'), 'background') === 'var(--card)' && prop(rule(ui, '.seg-slide'), 'border-radius') === 'var(--r-btn)',
'the segmented control is one track on the card\'s fill, its raised thumb settling on the smooth spring over 240ms');
ok(prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-weight') === '700'
  && prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'letter-spacing') === 'var(--track-display)',
'a page title is Onest 700 on the display tracking');
const vf = rule(ui, '.vf::before');
ok(prop(vf, 'inset') === '-2px' && /clip-path: polygon\(/.test(vf) && !/gradient/.test(vf),
  'the viewfinder is still one border clipped to four corners');
const DEAD = /\.style-grid|\.style-opt|\.sp-(?:glass|solid|minimal|neon)|(?:^|\n)\.sp\b|\.chip\b|\.dot\.(?:coaching|paused|stopped)|\.count-in|\.live-dot|livePulse|\.sheet-in|\.stagger|\.icon-btn\.danger/;
ok(DEAD.test('.chip.good { x: 1; }') && DEAD.test('.stagger > * { }') && !DEAD.test('.chips { } .dot { } .rise-in { }'), 'the dead rule reader finds the tip era and passes over what stays');
ok(!DEAD.test(ui.replace(/\/\*[\s\S]*?\*\//g, '')) && /@keyframes sheetIn \{/.test(ui) && /@keyframes countIn \{/.test(ui) && /@keyframes pulse \{/.test(ui)
  && rule(ui, '.rise-in') && rule(ui, '.hover-lift') && rule(ui, '.grad-num'),
'the tip era rules are gone from ui.css, and what weekly, onboarding, Stats and the AI log still use is kept');

// ── The motion helpers ────────────────────────────────────────────────────
const mcss = read('shared/motion.css');
const mjs = read('shared/motion.js');
ok(/@keyframes m-enter \{ from \{ opacity: 0; transform: translateY\(8px\) scale\(0\.985\); filter: blur\(6px\); \}/.test(mcss)
  && prop(rule(mcss, '.m-enter'), 'animation') === 'm-enter var(--dur-enter) var(--spring-smooth) both'
  && /html\.ambient-off \.m-drift \{ animation-play-state: paused; \}/.test(mcss)
  && /::view-transition-old\(root\)/.test(mcss) && /::view-transition-new\(root\)/.test(mcss),
'motion.css: the entrance from 8px low, .985 and a 6px blur on the smooth spring, the ambient float paused when off, and the view transition\'s two halves');
ok(/function transition\(fn\)/.test(mjs) && /startViewTransition/.test(mjs) && /function squish\(el\)/.test(mjs)
  && /function ambient\(on\)/.test(mjs) && /visibilitychange/.test(mjs) && /function enter\(el, key\)/.test(mjs),
'motion.js: a view transition with a plain change where it is missing, the squish, the entrance and ambient motion off whenever the window is hidden');

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

console.log(fails ? `\n${fails} look check(s) FAILED` : '\nall look checks passed: the tokens, Start, the buttons, the shared components, the motion and the grade card are the Orbit look');
process.exit(fails ? 1 : 0);
