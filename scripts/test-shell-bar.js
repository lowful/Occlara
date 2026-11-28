'use strict';

/**
 * THE BAR'S RIGHT GROUP (9.1, the owner's items 2 and 22), on the real
 * shell (markup, preload and scripts, scripts/fixtures/fake-dom.js):
 *
 *   - WHAT'S NEW lives in the bar: Home's update line sat faint on the moon,
 *     so after an update main's line is a pill on the bar's own glass, "What's
 *     new in 9.1.0", main's sentence whole in its title, seen only once it is
 *     on screen, opening What's new, gone when main takes it back, and never
 *     on the bar while recording or on the Recording screen. Home has no copy.
 *   - THE GAME PICKER sits in the right group at the controls' 36px on the
 *     bar's dense glass, and Start on Home gives its room back (display none,
 *     not an unseen gap that set the picker floating mid bar).
 *   - THE UPDATER is the bar's green control: downloading, the arrow and its
 *     progress; ready, "Restart to update", which asks main to install; never
 *     shown while recording, sealed or on the Recording view, whatever main
 *     says; nothing installs without the press.
 *
 * Layout is looked at by picture (scripts/shot-demo.js news, updating,
 * updatingsoon, updateready, barall, barnarrow, barmid, sealedbar); only its
 * rules are held here.
 *
 * Run: npm run test:shellbar
 */
const fs = require('fs');
const path = require('path');
const { loadSurface, loadPreload, settle } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
let fails = 0;
let passes = 0;
const ok = (cond, what, detail) => {
  if (cond) { passes++; console.log(`ok    ${what}`); } else { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}
process.on('unhandledRejection', (e) => { fails++; console.log(`FAIL  a surface rejected a promise: ${(e && e.stack) || e}`); });

// The two dashes the house rules ban, built from their code points.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const BASE = { isCoaching: false, isPaused: false, status: 'idle', gameId: 'valorant', licenseActive: true, sounds: false, notice: null };
const NEWS = { version: '9.1.0', text: 'Occlara updated to 9.1.0.', link: "See what's new" };
const READY = { state: 'ready', version: '9.1.1' };

async function openShell(o) {
  const opts = o || {};
  const installs = [];
  const p = loadSurface('shell', {
    handlers: {
      [C.STATE_GET]: () => ({ ...BASE, ...(opts.state || {}) }),
      [C.CONFIG_GET]: () => ({ language: 'en' }),
      [C.SHELL_GET]: () => ({ page: opts.page || 'home', shown: opts.page || 'home', sealed: false, held: false, rec: false, maximized: false, ...(opts.shell || {}) }),
      [C.CHANGELOG_NOTICE]: () => (opts.news === undefined ? null : opts.news),
      [C.UPDATE_GET]: () => (opts.update === undefined ? null : opts.update),
      [C.UPDATE_INSTALL]: () => { installs.push(1); return opts.install || { ok: true }; },
    },
  });
  p.installs = installs;
  if (opts.hidden) p.document.visibilityState = 'hidden';
  await settle();
  p.sentOn = (ch) => p.bridge.sent.filter(([c]) => c === ch);
  return p;
}
const CSS = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8');
const UI = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
const HTML = fs.readFileSync(path.join(RENDERER, 'shell', 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.js'), 'utf8');
const uncomment = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** The body of one rule, by its exact selector, comments out. */
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (css.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
};
const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();

(async () => {
  await section('the bar\'s right group: what is in it, in its order, at one height:', async () => {
    const p = await openShell();
    const end = p.document.querySelector('.bar-end');
    const kids = end.children.map((c) => c.id || c.className);
    ok(same(kids, ['news', 'gamepick', 'rec-back', 'rec', 'upd', 'upd-say', 'menu-btn', 'win-controls']),
      'What\'s new, the game, back to recording, Start, the updater, the profile, the window\'s buttons', kids.join());
    ok(rule(CSS, '.bar') && prop(rule(CSS, '.bar'), 'height') === '56px', 'the rule reader finds a known rule');
    // 36px each: the pills are ui.css .btn.md, the picker 1 + 3 + 28 + 3 + 1.
    ok(prop(rule(UI, '.btn.md'), 'height') === '36px' && p.$('news').classList.contains('md') && p.$('upd').classList.contains('md')
      && prop(rule(CSS, '.game-seg.seg-slide'), 'padding') === '3px' && /height: 28px/.test(rule(CSS, '.game-seg button'))
      && prop(rule(CSS, '.avatar-btn'), 'height') === '36px' && prop(rule(CSS, '.toggle'), 'height') === '36px',
    'every control in it stands 36px: the pills, the picker, Start and the profile');
    // The bar's own glass: dense and blurred, so it holds over the moon.
    ok(prop(rule(CSS, '.game-seg.seg-slide'), 'background') === 'var(--glass-fill-2)' && /blur\(var\(--glass-blur\)\)/.test(rule(CSS, '.game-seg.seg-slide'))
      && prop(rule(CSS, '.bar-pill'), 'background') === 'var(--glass-fill-2)' && /blur\(var\(--glass-blur\)\)/.test(rule(CSS, '.bar-pill'))
      && p.$('news').classList.contains('bar-pill'),
    'the picker and What\'s new on the bar\'s dense glass, blurred');
    // Start on Home gives its room back, rather than an unseen gap.
    ok(prop(rule(CSS, '.app.home-page .rec:not(.recording)'), 'display') === 'none' && !/visibility:\s*hidden/.test(rule(CSS, '.app.home-page .rec:not(.recording)')),
      'on Home the bar\'s Start is not drawn and takes no room: nothing floats in its place', rule(CSS, '.app.home-page .rec:not(.recording)'));
    ok(/function flipBar\(change\)/.test(JS) && /flipBar\(\(\) => app\.classList\.toggle\('home-page', homeNow\)\)/.test(JS),
      'and the controls beside it glide into the room it leaves (flipBar)');
    // Mid match and on the Recording view, neither pill.
    ok(/\.app\.is-sealed \.news, \.app\.is-sealed \.upd, \.app\.rec-view \.news, \.app\.rec-view \.upd \{ display: none; \}/.test(CSS),
      'the stylesheet hides What\'s new and the updater sealed and on the Recording view');
    const words = uncomment(HTML) + uncomment(JS) + CSS;
    ok(!DASHES.test(words) && DASHES.test(`a${String.fromCharCode(0x2014)}b`), 'no dash in the bar\'s markup, script or styles');
  });

  await section('What\'s new: in the bar after an update, seen only on screen, gone once What\'s new opens:', async () => {
    const quiet = await openShell();
    ok(quiet.$('news').hidden && !quiet.sentOn(C.CHANGELOG_SEEN).length, 'with nothing from main, no pill and nothing seen');

    const p = await openShell({ news: NEWS });
    const pill = p.$('news');
    // Its words as a wide bar draws them (.news-short, "New", only under 1040px).
    ok(!pill.hidden && pill.querySelector('.news-text').textContent.replace(/\s+/g, ' ').trim() === "What's new in 9.1.0"
      && pill.textContent.replace(/\s+/g, ' ').trim() === "What's new in 9.1.0New" && pill.title === "Occlara updated to 9.1.0. See what's new",
      'main\'s line: "What\'s new in 9.1.0", main\'s sentence whole in its title', `"${pill.textContent}" / "${pill.title}"`);
    ok(same(p.sentOn(C.CHANGELOG_SEEN), [[C.CHANGELOG_SEEN, '9.1.0']]), 'on screen, that version is seen, once', JSON.stringify(p.sentOn(C.CHANGELOG_SEEN)));
    p.bridge.emit(C.PUSH_CHANGELOG, { ...NEWS });
    await settle();
    ok(p.sentOn(C.CHANGELOG_SEEN).length === 1 && !pill.hidden, 'the same line pushed again: still there, not seen again');
    pill.click();
    ok(p.sentOn(C.SHELL_NAV).some(([, page]) => page === 'whatsnew'), 'pressed, it opens What\'s new');
    p.bridge.emit(C.PUSH_CHANGELOG, null);
    await settle();
    ok(pill.hidden, 'and main taking it back takes it off the bar');

    // A window not on screen (in the tray) has not shown it.
    const away = await openShell({ news: NEWS, hidden: true });
    ok(!away.$('news').hidden && !away.sentOn(C.CHANGELOG_SEEN).length, 'painted while the window is hidden: not yet seen');
    away.document.visibilityState = 'visible';
    for (const fn of away.document._listeners.visibilitychange || []) fn();
    ok(same(away.sentOn(C.CHANGELOG_SEEN), [[C.CHANGELOG_SEEN, '9.1.0']]), 'the window shown: seen then');
    // A window made hidden reads visible on its first load: in front is what counts.
    const behind = loadSurface('shell', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
        [C.SHELL_GET]: () => ({ page: 'home', shown: 'home', sealed: false, maximized: false }),
        [C.CHANGELOG_NOTICE]: () => NEWS,
      },
    });
    let front = false;
    behind.document.hasFocus = () => front;
    behind.sentOn = (ch) => behind.bridge.sent.filter(([c]) => c === ch);
    await settle();
    ok(!behind.$('news').hidden && !behind.sentOn(C.CHANGELOG_SEEN).length, 'painted with the window not in front: not yet seen');
    front = true;
    for (const fn of behind.window._listeners.focus || []) fn();
    await settle();
    ok(same(behind.sentOn(C.CHANGELOG_SEEN), [[C.CHANGELOG_SEEN, '9.1.0']]), 'the window brought to the front: seen then, once');

    // Held until the seal lifted: the push paints it then.
    const late = await openShell();
    late.bridge.emit(C.PUSH_CHANGELOG, NEWS);
    await settle();
    ok(!late.$('news').hidden, 'held until the seal lifted, main\'s push paints it then');

    // Never on the bar while recording or on the Recording screen, whatever main says.
    const rec = await openShell({ news: NEWS });
    rec.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    await settle();
    ok(rec.$('news').hidden, 'recording: gone from the bar at once');
    rec.bridge.emit(C.PUSH_CHANGELOG, NEWS);
    await settle();
    ok(rec.$('news').hidden, 'and a push meanwhile does not put it back');
    rec.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    await settle();
    ok(!rec.$('news').hidden, 'stopped: back on the bar');
    rec.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: null, sealed: true, held: false, rec: false });
    await settle();
    ok(rec.$('news').hidden, 'sealed: gone');
    rec.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: null, sealed: false, held: false, rec: true });
    await settle();
    ok(rec.$('news').hidden, 'on the Recording view: gone');

    // A push newer than the boot's answer wins.
    let answer = null;
    const race = loadSurface('shell', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
        [C.SHELL_GET]: () => ({ page: 'home', shown: 'home', sealed: false, maximized: false }),
        [C.CHANGELOG_NOTICE]: () => new Promise((r) => { answer = r; }),
      },
    });
    await settle();
    race.bridge.emit(C.PUSH_CHANGELOG, null);
    if (answer) answer(NEWS);
    await settle();
    ok(answer && race.$('news').hidden, 'main taking it back while the bar\'s first ask was out: the older answer is not painted');

    // Home carries no copy.
    const home = fs.readFileSync(path.join(RENDERER, 'home', 'index.html'), 'utf8') + fs.readFileSync(path.join(RENDERER, 'home', 'home.js'), 'utf8');
    const hp = loadPreload('home', {}).api;
    ok(!/id="h-news|h-news-open|paintNews|getNews/.test(uncomment(home)) && !('getNews' in hp) && !('newsSeen' in hp),
      'Home has no update line of its own, and its bridge no way to ask for one');
    const sp = loadPreload('shell', { [C.CHANGELOG_NOTICE]: () => NEWS }).api;
    ok(typeof sp.getNews === 'function' && typeof sp.onNews === 'function' && typeof sp.newsSeen === 'function' && typeof sp.openWhatsNew === 'function',
      'the bar\'s bridge asks for it, hears it, says it was seen, and opens What\'s new');
  });

  await section('the updater in the bar: downloading, then Restart to update, and only on a press:', async () => {
    const p = await openShell({ page: 'matches' });
    const u = p.$('upd');
    ok(u.hidden, 'nothing from main: no control');

    p.bridge.emit(C.PUSH_UPDATE, { state: 'downloading', version: '9.1.1', percent: 42 });
    await settle();
    ok(!u.hidden && u.classList.contains('downloading') && !u.classList.contains('ready') && !u.classList.contains('unsure')
      && u.style.getPropertyValue('--p') === '42' && u.getAttribute('aria-disabled') === 'true'
      && u.title === 'Downloading Occlara 9.1.1, 42%' && u.getAttribute('aria-label') === u.title,
    'downloading: the round control, its progress at 42, nothing to press, its title saying so', `${u.className} ${u.style.getPropertyValue('--p')} "${u.title}"`);
    ok(!p.$('upd-say').textContent, 'and the percent is never read out');
    u.click();
    await settle();
    ok(p.installs.length === 0, 'pressed while it downloads: nothing asked of main');
    p.bridge.emit(C.PUSH_UPDATE, { state: 'downloading', version: '9.1.1', percent: null });
    await settle();
    ok(u.classList.contains('unsure') && u.title === 'Downloading Occlara 9.1.1', 'no percent yet: the quarter ring turning, the title with no number');
    p.bridge.emit(C.PUSH_UPDATE, { state: 'downloading', version: '9.1.1', percent: 140 });
    await settle();
    ok(u.style.getPropertyValue('--p') === '100', 'a percent past 100 is drawn as whole');

    p.bridge.emit(C.PUSH_UPDATE, READY);
    await settle();
    ok(u.classList.contains('ready') && !u.classList.contains('downloading') && u.getAttribute('aria-disabled') === 'false'
      && p.$('upd-label').textContent === 'Restart to update' && /Restart to update/.test(u.getAttribute('aria-label')),
    'ready: "Restart to update", its accessible name holding the words it shows', `${u.className} "${u.getAttribute('aria-label')}"`);
    ok(p.$('upd-say').textContent === 'Occlara 9.1.1 is ready to install.', 'and a screen reader is told once', p.$('upd-say').textContent);
    p.bridge.emit(C.PUSH_UPDATE, { ...READY });
    p.$('upd-say').textContent = '';
    p.bridge.emit(C.PUSH_UPDATE, { ...READY });
    await settle();
    ok(!p.$('upd-say').textContent, 'the same version pushed again is not said again');
    ok(p.installs.length === 0, 'ready, nothing is asked of main until it is pressed');
    u.click();
    await settle();
    ok(p.installs.length === 1 && u.classList.contains('installing') && p.$('upd-label').textContent === 'Restarting' && u.getAttribute('aria-disabled') === 'true',
      'pressed: main is asked once, and it says Restarting at once', `${p.installs.length} ${u.className}`);
    u.click();
    await settle();
    ok(p.installs.length === 1, 'pressed again while it restarts: nothing more');

    // Main refusing (a match began between the paint and the press): it stays as main says.
    const refused = await openShell({ page: 'matches', update: READY, install: { ok: false, error: 'match' } });
    refused.$('upd').click();
    await settle();
    ok(refused.installs.length === 1 && refused.$('upd').classList.contains('ready') && !refused.$('upd').classList.contains('installing'),
      'refused by main: no Restarting, it stays as main has it');

    // Never on the bar while recording, sealed or on the Recording view, whatever main says.
    const rec = await openShell({ page: 'matches', update: READY });
    ok(!rec.$('upd').hidden, 'asked at boot: ready on the bar');
    rec.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    await settle();
    ok(rec.$('upd').hidden, 'recording: gone from the bar at once, though main still had it ready');
    rec.$('upd').click();
    await settle();
    ok(rec.installs.length === 0, 'and a press then asks nothing of main');
    rec.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    await settle();
    ok(!rec.$('upd').hidden, 'stopped: back');
    rec.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: null, sealed: true, held: false, rec: false });
    await settle();
    ok(rec.$('upd').hidden, 'sealed: gone');
    rec.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: 'matches', sealed: false, held: false, rec: false });
    await settle();
    ok(!rec.$('upd').hidden, 'the seal lifted: back');
    rec.bridge.emit(C.PUSH_UPDATE, null);
    await settle();
    ok(rec.$('upd').hidden, 'main saying nothing (the player playing): gone');
    rec.bridge.emit(C.PUSH_UPDATE, { state: 'nonsense', version: '9.1.1' });
    await settle();
    ok(rec.$('upd').hidden, 'a state it does not know: nothing drawn');

    // The rules of the drawing.
    ok(/<circle id="upd-arc" class="upd-arc"[^>]*pathLength="100"/.test(HTML) && /stroke-dashoffset: calc\(100 - var\(--p, 0\)\)/.test(CSS),
      'the arc is drawn from its percent, on a path of 100');
    ok(/html\.rec-still \.upd\.unsure \.upd-arc, html\.ambient-off \.upd\.unsure \.upd-arc \{ animation-play-state: paused; \}/.test(CSS),
      'the turning quarter is still with every other loop while a match is recorded');
    ok(/color: var\(--good\)/.test(rule(CSS, '.btn.upd')) && !/--accent|--btn\b|--signal/.test(rule(CSS, '.btn.upd') + rule(CSS, '.upd.ready, .upd.installing')),
      'green, the one green in the app, never the accent');
    ok(/prefers-reduced-motion: reduce\) \{ \.upd\.unsure \.upd-arc \{ animation: none;/.test(CSS), 'and still when asked for less motion');
    const sp = loadPreload('shell', {}).api;
    ok(typeof sp.getUpdate === 'function' && typeof sp.onUpdate === 'function' && typeof sp.installUpdate === 'function',
      'the bar\'s bridge asks for it, hears it, and presses it');
  });

  // THE BAR GIVES WAY (9.1). At 960 with the licence ended, What's new and an
  // update ready, the group ran past the window and cut the close button
  // off, and the notice saying why Start is locked got nothing; the pills
  // squeezed a server notice to "T...". The notice now comes first, the
  // controls draw in, and the window's buttons are never cut. The widths are
  // looked at by picture (shot-demo barended960, barnotice960, barnotice1280).
  await section('the bar gives way: a notice first, the window\'s buttons never cut:', async () => {
    const p = await openShell({ page: 'matches', news: NEWS, update: READY });
    const bar = p.document.querySelector('.bar');
    ok(!bar.classList.contains('has-notice'), 'no notice: the pills keep their words');
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: { kind: 'server', text: 'The coaching server could not be reached.' } });
    await settle();
    ok(bar.classList.contains('has-notice') && p.$('notice').textContent === 'The coaching server could not be reached.', 'a notice: the bar marked so');
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: null });
    await settle();
    ok(!bar.classList.contains('has-notice'), 'gone: the pills have their words back');
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: null });
    await settle();
    ok(bar.classList.contains('has-notice') && /subscription has ended/i.test(p.$('notice').textContent), 'the licence ended is a notice too, the sentence in full');
    p.bridge.emit(C.PUSH_STATE, { ...BASE });
    await settle();

    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const hides = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{\\s*display: none;`).test(css)
      || new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`).test(css);
    ok(/\.bar\.has-notice \.news \.news-text, \.bar\.has-notice \.news \.btn-arrow \{ display: none; \}/.test(css)
      && /\.bar\.has-notice \.upd \.upd-word \{ display: none; \}/.test(css) && /\.bar\.has-notice \.rec-back-word \{ display: none; \}/.test(css),
    'with a notice, What\'s new keeps its spark, the updater its icon and back to recording its dot');
    const narrow = (css.match(/@media \(max-width: 1040px\) \{\s*\.bar\.has-notice \.news \{ display: none; \}\s*\.bar \.toggle\.ended \{ display: none; \}\s*\}/) || [])[0];
    ok(!!narrow, 'under 1040px with a notice, What\'s new waits and the ended button goes, the notice saying it in full');
    // 9.1: narrow with no notice, a word beside the spark, never a bare spark in a circle.
    const narrowWord = (css.match(/@media \(max-width: 1040px\) \{[^}]*\.btn\.news \{[^}]*\}[^]*?\.news \.news-short \{ display: inline; \}/) || [])[0];
    ok(p.$('news').querySelector('.news-short') && p.$('news').querySelector('.news-short').textContent === 'New'
      && !!narrowWord && !/width: 36px/.test(narrowWord) && /\.news-short \{ display: none;/.test(css)
      && /\.bar\.has-notice \.news \.news-short, \.bar\.tight \.news \.news-short, \.bar\.snug \.news \.news-short \{ display: none; \}/.test(css),
    'under 1040px What\'s new keeps the word New beside its spark, and beside a notice or tight its spark alone');
    ok(hides('.app.is-recording .game-seg'), 'recording, the picker gives its room back, as mid match');
    ok(/\.bar\.tight \.news, \.bar\.tight \.game-seg, \.bar\.tight \.toggle\.ended \{ display: none; \}/.test(css)
      && /\.bar\.tight \.upd \.upd-word, \.bar\.tight \.rec-back-word \{ display: none; \}/.test(css),
    'and marked tight, all of it at once');
    ok(p.$('rec-back').querySelector('.rec-back-word') && p.$('rec-back').getAttribute('aria-label') === 'Back to the Recording screen',
      'back to recording keeps its name with its word drawn in');

    // Recording: the app says so, for the picker.
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    await settle();
    ok(p.document.querySelector('.app').classList.contains('is-recording'), 'recording: the app marked so');
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    await settle();
    ok(!p.document.querySelector('.app').classList.contains('is-recording'), 'stopped: not');

    // Still running past the window: tight, measured by layout alone.
    const wc = p.document.querySelector('.win-controls');
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => 960 });
    let left = 843;
    Object.defineProperty(wc, 'offsetLeft', { configurable: true, get: () => left });
    Object.defineProperty(wc, 'offsetWidth', { configurable: true, get: () => 138 });
    for (const fn of p.window._listeners.resize || []) fn();
    ok(bar.classList.contains('tight'), 'the window\'s buttons past the window\'s edge: the bar is marked tight');
    left = 700;
    for (const fn of p.window._listeners.resize || []) fn();
    ok(!bar.classList.contains('tight'), 'room again: not tight');
    // 9.1: the smaller step first. What's new's word ("New", under 1040px)
    // alone running past marks the bar snug, the word going and nothing else.
    Object.defineProperty(wc, 'offsetLeft', { configurable: true, get: () => (bar.classList.contains('snug') ? 800 : 843) });
    for (const fn of p.window._listeners.resize || []) fn();
    ok(bar.classList.contains('snug') && !bar.classList.contains('tight'), 'only What\'s new\'s word past the edge: snug, the word gone, nothing else');
    Object.defineProperty(wc, 'offsetLeft', { configurable: true, get: () => (bar.classList.contains('tight') ? 700 : 843) });
    for (const fn of p.window._listeners.resize || []) fn();
    ok(bar.classList.contains('snug') && bar.classList.contains('tight'), 'still past it without the word: tight as well');
    Object.defineProperty(wc, 'offsetLeft', { configurable: true, get: () => 700 });
    for (const fn of p.window._listeners.resize || []) fn();
    ok(!bar.classList.contains('snug') && !bar.classList.contains('tight'), 'room again: neither');
    ok(/\.bar\.snug \.btn\.news \{ width: 36px; padding: 0; border-radius: 18px; \}/.test(css), 'snug, the spark keeps its circle');

    // What's new given way to a notice (not drawn) is not yet seen.
    const away = loadSurface('shell', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE, notice: { kind: 'server', text: 'The coaching server could not be reached.' } }),
        [C.CONFIG_GET]: () => ({ language: 'en' }),
        [C.SHELL_GET]: () => ({ page: 'matches', shown: 'matches', sealed: false, maximized: false }),
        [C.CHANGELOG_NOTICE]: () => NEWS,
      },
    });
    let drawn = false;
    away.$('news').getClientRects = () => (drawn ? [{}] : []);
    away.sentOn = (ch) => away.bridge.sent.filter(([c]) => c === ch);
    await settle();
    ok(!away.$('news').hidden && !away.sentOn(C.CHANGELOG_SEEN).length, 'given way to a notice, not drawn: not seen');
    drawn = true;
    away.bridge.emit(C.PUSH_STATE, { ...BASE, notice: null });
    await settle();
    ok(same(away.sentOn(C.CHANGELOG_SEEN), [[C.CHANGELOG_SEEN, '9.1.0']]), 'the notice gone and the pill drawn again: seen then, once');
  });

  console.log(fails ? `\nFAIL: ${fails} of ${passes + fails} bar checks failed` : `\nPASS: all ${passes} bar checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });
