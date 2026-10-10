'use strict';

/**
 * What the renderer surfaces do with what arrives, run in node against their
 * real markup, scripts and preloads (scripts/fixtures/fake-dom.js).
 *
 * Every case below was a bug that reached players while every other check in
 * this repo passed, because each one is a surface doing the wrong thing with a
 * correct message:
 *
 *   - the panel never followed the language, because its bridge had no
 *     getConfig, so initI18n threw inside its own try and stayed English
 *   - with the licence ended, the panel's status line kept "Press Start" and
 *     never showed why
 *   (the panel's controls are the shell's sidebar since 8.1, and these cases
 *   run against the shell)
 *   - Settings promised a sound on start and stop, and nothing had played one
 *     since the overlay was removed
 *   - one grade was three colours: red in its library row, yellow in the trend
 *     above it, white in Stats
 *   - the library's trend drew every grade from 77 up at the same height
 *   - Stats never showed a review saved while it was open
 *   - Settings said coaching for Rivals and League was not built
 *   - the AI log called every 8.0 death a miss, because 8.0 shows nothing
 *     during a match by design and the log still counted reviews
 *   - the activation screen sold "Real-time Valorant AI coaching"
 *
 * Expected colours come from the SPEC (grade.js letters and the tone each
 * letter reads as), never from the module under test, so a wrong rule in
 * grade-view.js cannot agree with itself. Each section fails on its own, so a
 * surface that throws does not hide what the others did. Run against the
 * renderer as it was before these fixes, every section above fails.
 *
 * Layout is not measured here. A CSS change is still looked at
 * (npx electron scripts/shot-surface.js), and only its structure is held below.
 *
 * Run: npm run test:surfaces
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSurface, loadPreload, Document, settle, nextTab } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const I18N = require('../src/shared/i18n');
const grade = require('../src/shared/grade');
const aiLogStore = require('../src/main/services/ai-log-store');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The two dashes the house rules ban from every string, written as escapes so
// this file carries neither character. Asserted below against both dashes
// built from their code points, and against a plain hyphen it must not match.
const DASHES = /[\u2013\u2014]/;

/** The tone each letter reads as: S and A good, B neutral, C a warning, D a problem. */
const TONE = { S: 'good', A: 'good', B: 'mid', C: 'warn', D: 'bad' };
const toneFor = (score) => TONE[grade.letter(score)];
const toneOf = (el) => ['good', 'mid', 'warn', 'bad'].find((t) => el.classList.contains(t)) || '';

let GradeView = null;
let gradeViewError = null;
try { GradeView = require('../src/renderer/shared/grade-view'); } catch (e) { gradeViewError = e.message; }

/** One area of the app. A throw inside it is that area failing, not the run. */
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}

// A rejection inside a surface is a surface throwing on a message, which is a
// failure even when every assertion after it happens to pass.
process.on('unhandledRejection', (e) => {
  fails++;
  console.log(`FAIL  a surface rejected a promise: ${(e && e.stack) || e}`);
});

/** Web Audio, enough for shared/sfx.js to really run: it counts what started. */
function fakeAudio() {
  const stats = { started: 0, contexts: 0 };
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra) => Object.assign({ connect: (n) => n }, extra);
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = {}; }
    createOscillator() { return node({ type: '', frequency: param(), start() { stats.started++; }, stop() {} }); }
    createGain() { return node({ gain: param() }); }
    createBuffer(_ch, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { return node({ buffer: null, start() { stats.started++; } }); }
    createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); }
    resume() { return Promise.resolve(); }
  }
  return { AudioContext, stats };
}

const BASE = {
  isCoaching: false, isPaused: false, status: 'idle', gameId: 'valorant', licenseActive: true,
  sounds: true, notice: null, lastGrade: null, cadence: null, captureSpeed: 'auto', topAgents: [],
};

async function openShell(cfg, state, opts) {
  const audio = fakeAudio();
  const p = loadSurface('shell', {
    handlers: {
      [C.STATE_GET]: () => ({ ...BASE, ...(state || {}) }), [C.CONFIG_GET]: () => ({ ...cfg }),
      [C.SHELL_GET]: () => ({ page: 'home', shown: 'home', sealed: false, maximized: false }),
    },
    preload: opts && opts.preload,
    window: { AudioContext: audio.AudioContext },
  });
  // Every sound the shell asks for, while the real shared/sfx.js still plays it.
  p.sfx = [];
  p.audio = audio.stats;
  const sfx = p.window.occlaraSfx;
  if (sfx) {
    const real = sfx.play;
    sfx.play = (kind, volume) => { p.sfx.push(kind); return real(kind, volume); };
  }
  await settle();
  p.line = () => p.$('line').textContent;
  p.label = () => p.$('toggle').querySelector('.t-label').textContent;
  return p;
}

(async () => {
  await section('the fake DOM itself:', () => {
    const d = new Document('<div id="a" class="x y" hidden data-i18n="k"><span class="t">hi</span>'
      + '<svg><path d="M1 2"/></svg><img src="a.svg"><b>two</b></div>');
    const a = d.getElementById('a');
    ok(a && a.hidden && a.classList.contains('y') && a.getAttribute('data-i18n') === 'k',
      'parses ids, classes, bare attributes and data attributes');
    ok(a.querySelector('span.t').textContent === 'hi' && d.querySelectorAll('div[data-i18n="k"] > b').length === 1
      && d.querySelectorAll('#a path').length === 1 && a.textContent === 'hitwo',
      'and its selectors, self closing tags and void tags behave');
    // Focus lands where the browser lets it, and Tab goes on in page order.
    const f = new Document('<body><button id="one">1</button><article id="card"><p>text</p>'
      + '<button id="two">2</button></article><button id="off" disabled>3</button>'
      + '<div hidden><button id="tucked">4</button></div><button id="three">5</button></body>');
    const [one, card, two, three] = ['one', 'card', 'two', 'three'].map((id) => f.getElementById(id));
    one.focus();
    card.focus();
    ok(f.activeElement === one && card.tabIndex === -1 && one.tabIndex === 0,
      'a card with no tabindex takes no focus, and a button keeps it');
    ok(nextTab(f) === two, 'Tab from the button goes to the next control in the page', nextTab(f) && nextTab(f).id);
    card.tabIndex = -1;
    card.focus();
    ok(f.activeElement === card && card.getAttribute('tabindex') === '-1' && nextTab(f) === two,
      'given tabindex -1 it takes focus, out of the tab order, and Tab goes on to what is inside it');
    two.focus();
    ok(nextTab(f) === three, 'a disabled control and one in a hidden box are passed over', nextTab(f) && nextTab(f).id);
    f.getElementById('off').focus();
    ok(f.activeElement === two, 'and neither takes focus');
    two.remove();
    ok(f.activeElement === f.body, 'focus taken out of the page is back on the body');
  });

  await section('one grade colour rule, keyed to the letters in grade.js:', () => {
    ok(GradeView && typeof GradeView.letterOf === 'function' && typeof GradeView.gradeTone === 'function',
      'shared/grade-view.js exports the rule to node', gradeViewError || 'letterOf or gradeTone missing');
    const scores = Array.from({ length: 101 }, (_v, i) => i);
    const letterOff = scores.filter((s) => GradeView.letterOf(s) !== grade.letter(s));
    ok(!letterOff.length, 'GradeView.letterOf matches grade.js letter() on every score 0 to 100',
      `disagree at ${letterOff.join(', ')}`);
    const toneOff = scores.filter((s) => {
      const want = toneFor(s);
      return GradeView.scoreTone(s) !== want || GradeView.gradeTone({ score: s, letter: grade.letter(s) }) !== want
        || GradeView.gradeTone(s) !== want || GradeView.tone(grade.letter(s)) !== want;
    });
    ok(!toneOff.length, 'a bare score, a grade and a letter take one colour at every score', `differ at ${toneOff.join(', ')}`);
    ok(GradeView.gradeTone({ score: 58, letter: 'D' }) === 'bad', 'a 58 D is red, where the trend drew it yellow');
    ok(GradeView.gradeTone({ score: 69, letter: 'C' }) === 'warn', 'a 69 C is a warning, where the trend drew it white');
    ok(GradeView.gradeTone({ score: 82, letter: 'A' }) === 'good', 'an 82 A is green, where Stats drew it white');
    ok(GradeView.letterOf(null) === null && grade.letter(null) === null, 'no score, no letter');
    ok(GradeView.scoreTone(null) === '' && GradeView.gradeTone({ score: null, letter: null }) === '' && GradeView.gradeTone(undefined) === '',
      'and no colour: a grade that does not exist is not painted as a bad one');

    // Nobody keeps a private copy of the rule. A copy agrees on the day it is
    // written and drifts the first time the bands move.
    const COPY = /letter\s*===\s*'[SABCD]'/;
    ok(COPY.test("g.letter === 'S' || g.letter === 'A'"), 'the copy detector matches the copy the panel used to keep');
    const copies = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && !p.endsWith(path.join('shared', 'grade-view.js'))
          && COPY.test(fs.readFileSync(p, 'utf8'))) copies.push(path.relative(RENDERER, p));
      }
    };
    walk(RENDERER);
    ok(!copies.length, 'no surface colours a grade with its own letter table', copies.join(', '));
  });

  await section('the record controls follow the language setting:', async () => {
    const de = await openShell({ language: 'de' });
    ok(de.label() === I18N.t('de', 'panel.start') && de.label() === 'Starten', 'Start reads Starten in German', `read "${de.label()}"`);
    ok(de.$('status-text').textContent === I18N.t('de', 'panel.idle'), 'the status word is German too',
      `read "${de.$('status-text').textContent}"`);
    ok(de.line() === I18N.t('de', 'panel.noTips'), 'and so is the hint line');
    ok(de.$('nav-settings').textContent.includes(I18N.t('de', 'common.settings')), 'and the labels the markup marks for translation');
    de.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(de.label() === 'Stoppen' && de.$('status-text').textContent === I18N.t('de', 'panel.coaching'),
      'recording, the button and the status are German');

    // The bug, reproduced: the same controls on the bridge as the panel had it, without getConfig.
    const before = await openShell({ language: 'de' }, null, {
      preload: (api) => { const bare = { ...api }; delete bare.getConfig; return bare; },
    });
    ok(before.label() === 'Start', 'without getConfig on the bridge it stays English, which is what players got');

    const en = await openShell({ language: 'en' });
    ok(en.label() === 'Start' && en.$('status-text').textContent === 'Ready',
      'English keeps the panel\'s own words, Start and Ready', `read "${en.$('status-text').textContent}"`);
    let channel = null;
    if (typeof en.bridge.api.getConfig === 'function') {
      await en.bridge.api.getConfig();
      channel = (en.bridge.invoked[en.bridge.invoked.length - 1] || [])[0];
    }
    ok(channel === C.CONFIG_GET, 'getConfig goes over CONFIG_GET, the channel Settings reads');
  });

  await section('with the licence ended, the status line says why:', async () => {
    const p = await openShell({ language: 'en' });
    const notice = 'Your license has expired. Renew at occlara.app.';
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: { text: notice, at: 1 } });
    ok(p.line() === notice && p.$('line').classList.contains('system'),
      'the notice main pushed is on the line, marked as a system notice', `read "${p.line()}"`);
    ok(p.$('toggle').disabled && p.$('status-text').textContent === 'Subscription ended', 'beside a locked Start');
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: null });
    ok(/Renew in Settings/.test(p.line()) && !/Press Start/.test(p.line()),
      'with no notice it still says to renew, never Press Start', `read "${p.line()}"`);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: true, notice: null });
    ok(p.line() === I18N.t('en', 'panel.noTips') && !p.$('line').classList.contains('system') && !p.$('toggle').disabled,
      'renewed, the line is the Press Start hint again');
  });

  await section('the start and stop sounds, on real transitions only:', async () => {
    const p = await openShell({ language: 'en' });
    ok(p.window.occlaraSfx && p.scripts.some((s) => /sfx\.js$/.test(s)), 'the shell loads shared/sfx.js');
    ok(!p.sfx.length, 'opening the window plays nothing: its first state is what is already true');

    // A Valorant start is a status and then the state push setStatus sends after it.
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching' });
    ok(same(p.sfx, ['start']), 'Start plays the start sound once, though status and state both say so', p.sfx.join(','));
    ok(p.audio.started > 0, 'and shared/sfx.js really plays it: oscillators started');

    p.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, isPaused: true, status: 'paused' });
    ok(same(p.sfx, ['start']), 'pausing is silent', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(same(p.sfx, ['start', 'start']), 'resuming is recording starting again', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, status: 'stopped' });
    ok(same(p.sfx, ['start', 'start', 'stop']), 'stopping from a pause is still the end, once', p.sfx.join(','));

    // Rivals and League start through a state push alone.
    p.bridge.emit(C.PUSH_STATE, { ...BASE, gameId: 'rivals', isCoaching: true });
    ok(same(p.sfx.slice(3), ['start']), 'a Rivals start, carried by state alone, still sounds', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    ok(same(p.sfx.slice(3), ['start', 'stop']), 'and its stop', p.sfx.join(','));

    p.bridge.emit(C.PUSH_STATE, { ...BASE, sounds: false });
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    ok(p.sfx.length === 5, 'Sounds off in Settings means silence', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATE, { ...BASE });
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(p.sfx.length === 6, 'and a config with no sounds key reads as on, the default', p.sfx.join(','));
  });

  await section('the agent bubble asks only a Valorant session:', async () => {
    const r = await openShell({ language: 'en' }, { gameId: 'rivals' });
    r.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(r.$('agent-bubble').hidden, 'a Rivals start never opens "Reading your agent", which nothing would answer');
    const l = await openShell({ language: 'en' }, { gameId: 'lol' });
    l.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(l.$('agent-bubble').hidden, 'nor a League one');
    const v = await openShell({ language: 'en' }, { gameId: 'valorant' });
    v.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(!v.$('agent-bubble').hidden && !v.$('ab-detect').hidden, 'a Valorant start still asks for the agent');
  });

  // Our own marks, never a game's logo: Riot's IP policy forbids its logos
  // without a written licence, and Marvel's are as protected.
  await section('the game picker draws our own marks, each named in full:', async () => {
    const NAMES = ['Valorant', 'Marvel Rivals', 'League of Legends'];
    const p = await openShell({ language: 'en' }, { gameId: 'rivals' });
    const buttons = () => p.$('gamepick').querySelectorAll('button');
    ok(!p.$('gamepick').hidden && buttons().length === 3, 'three buttons, one per game', `${buttons().length} buttons`);
    ok(same(buttons().map((b) => b.getAttribute('aria-label')), NAMES) && buttons().every((b) => b.title === b.getAttribute('aria-label')),
      'each named in full, as its accessible name and its tooltip', buttons().map((b) => `${b.getAttribute('aria-label')}/${b.title}`).join(', '));
    ok(same(buttons().map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']), 'the game in use, and only it, is pressed');
    ok(buttons().every((b) => b.querySelectorAll('svg').length === 1 && !b.textContent.trim()), 'each is a mark with no text in it');
    ok(p.scripts.some((x) => /game-marks\.js$/.test(x)), 'drawn by shared/game-marks.js');
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(buttons().every((b) => b.disabled && b.title === 'Stop recording to switch game')
      && same(buttons().map((b) => b.getAttribute('aria-label')), NAMES),
      'recording, every mark is locked with the tooltip saying why, and keeps its name');

    // Each mark on the shell's 24 unit grid, stroke 1.75 with round ends, in
    // currentColor, and never a letter.
    const marks = require('../src/renderer/shared/game-marks');
    ok(same(marks.ids(), ['valorant', 'rivals', 'lol']) && marks.svg('nope') === '', 'a mark for each game, none for anything else');
    for (const id of marks.ids()) {
      const markup = marks.svg(id);
      const svgEl = new Document(markup).querySelector('svg');
      const attrs = ['viewBox', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill']
        .map((a) => svgEl && svgEl.getAttribute(a)).join('|');
      ok(attrs === '0 0 24 24|currentColor|1.75|round|round|none' && !/<text|#[0-9a-f]{3}|rgb/i.test(markup),
        `${id}: 24 unit grid, stroke 1.75, round ends, currentColor, no text`, attrs);
    }
    ok(/<text|#[0-9a-f]{3}|rgb/i.test('<text>V</text>') && /<text|#[0-9a-f]{3}|rgb/i.test('fill="#FF4655"'),
      'the no text, no colour detector matches a letter and a hard coded colour');
  });

  await section('Home\'s grades:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const rows = [58, 82].map((score, i) => ({ id: `h${i}`, at: at - i * 3600000, title: 'Jett', map: 'Abyss',
      result: 'Victory', score: '13-11', grade: { score, letter: grade.letter(score) } }));
    const h = loadSurface('home', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
        [C.REVIEWS_LIST]: () => rows,
        [C.PATTERNS_GET]: () => ({ matches: 2, enough: true, mistakes: [], strengths: [], missed: [],
          grades: rows.map((r) => ({ id: r.id, at: r.at, score: r.grade.score, letter: r.grade.letter })), average: 70, categories: [] }),
        [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', grade: { score: 58, letter: 'D', categories: [] } }),
      },
    });
    await settle();
    const letters = h.$('recent-list').querySelectorAll('.gv-letter');
    ok(letters.length === 2 && toneOf(letters[0]) === toneFor(58) && letters[0].textContent === 'D'
      && toneOf(letters[1]) === toneFor(82), 'each recent match takes the shared colour, with its letter beside it');
    ok(h.scripts.some((x) => /grade-view\.js$/.test(x)), 'from shared/grade-view.js rather than a copy');
  });

  await section('the match library:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    // Newest first, as patterns.js returns them.
    const grades = [95, 77, 82, 69, 58].map((score, i) => ({ id: `g${i}`, at: at - i * 3600000, score, letter: grade.letter(score) }));
    const rows = grades.map((g) => ({ id: g.id, at: g.at, title: 'Jett', grade: { score: g.score, letter: g.letter } }));
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: () => rows,
        [C.PATTERNS_GET]: () => ({ matches: 5, enough: false, grades, categories: [], average: 76,
          mistakes: [], strengths: [], missed: [] }),
      },
    });
    await settle();
    const bars = m.document.querySelectorAll('#p-trend .p-bar');
    ok(bars.length === 5 && !m.$('p-trend').hidden, 'one bar per graded match');
    const read = bars.map((b) => ({
      score: Number(b.querySelector('span').textContent),
      // Wherever the score's height is set, on the bar or on its fill.
      h: parseFloat(b.style.getPropertyValue('--h') || b.querySelector('i').style.getPropertyValue('--h')),
      fill: b.querySelector('i'),
    }));
    ok(same(read.map((r) => r.score), [58, 69, 82, 77, 95]), 'oldest on the left');
    ok(read.every((r) => r.h === r.score), 'each bar is its grade as a share of the full height', read.map((r) => r.h).join(','));
    ok(read.every((r) => toneOf(r.fill) === toneFor(r.score)),
      'and each bar is its letter\'s colour', read.map((r) => `${r.score}:${r.fill.className}`).join(' '));

    // Structure, since nothing here measures layout: the number must not share
    // a flex column with the fill, which is what capped every bar near 77%.
    const css = fs.readFileSync(path.join(RENDERER, 'matches', 'matches.css'), 'utf8');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    ok(/border-radius/.test(rule('.p-trend')), 'the rule reader finds a known rule');
    ok(/position:\s*absolute/.test(rule('.p-bar span')) && /position:\s*absolute/.test(rule('.p-bar i'))
      && /position:\s*relative/.test(rule('.p-bar')) && !/flex-direction/.test(rule('.p-bar')),
      'the number is positioned off the fill, outside the layout that sizes it');
    ok(/height:\s*var\(--h/.test(rule('.p-bar i')) && /bottom:\s*calc\(var\(--h/.test(rule('.p-bar span')),
      'and both read the same --h');

    const letters = m.document.querySelectorAll('#list .m-row .m-letter');
    ok(letters.length === 5 && letters.every((el) => toneOf(el) === TONE[el.textContent]),
      'the rows colour the same grades the same way');
  });

  // K/D/A took K/D's place in the breakdown (8.2): the cell is an average
  // match as a scoreboard prints it, the tooltip the K/D it sorts on and its
  // sample, and it is still one of the columns a narrow window drops.
  await section('the breakdown\'s K/D/A column:', async () => {
    const breakdown = require('../src/shared/breakdown');
    const at = Date.UTC(2026, 9, 1, 20);
    let seq = 0;
    const entry = (game, review) => { seq++; return { id: `${game}-${at - seq * 3600000}-k${seq}`, game, at: at - seq * 3600000, review }; };
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const val = (map, line) => entry('valorant', { kind: 'valorant', rounds: [], insights: {}, grade: graded,
      game: { map, agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' },
      scoreline: { acs: 250, adr: 160, headshotPct: 22, ...line } });
    const riv = (map, line) => entry('rivals', { kind: 'rivals', empty: false, insights: {}, grade: graded,
      game: { hero: 'Luna Snow', role: 'Strategist', map, mode: 'Competitive', result: 'VICTORY' },
      scoreline: { damage: 8000, healing: 15000, blocked: 0, accuracy: 40, ...line } });
    const saved = {
      // Abyss: 31/21/4 and 20/15/7, an average 26/18/6 at K/D 1.42. Lotus:
      // one line of the two has no assists. Haven: 15/10/3. Bind: no assists.
      valorant: [val('Abyss', { kills: 31, deaths: 21, assists: 4 }), val('Abyss', { kills: 20, deaths: 15, assists: 7 }),
        val('Lotus', { kills: 31, deaths: 21, assists: 4 }), val('Lotus', { kills: 20, deaths: 15 }),
        val('Haven', { kills: 15, deaths: 10, assists: 3 }), val('Bind', { kills: 10, deaths: 12 })],
      rivals: [riv('Tokyo 2099', { kills: 10, deaths: 5, assists: 20 }), riv('Tokyo 2099', { kills: 6, deaths: 7, assists: 18 })],
      lol: [entry('lol', { game: { champion: 'Ahri', role: 'Middle', durationSec: 1800, mode: 'CLASSIC' }, grade: graded,
        scoreline: { kills: 8, deaths: 2, assists: 6, cs: 240, ward: 18 }, insights: {} })],
    };
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: () => [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved[g] || [], opts),
      },
    });
    await settle();
    const heads = () => m.document.querySelectorAll('#b-table .b-sort').map((b) => b.textContent);
    const rows = () => m.document.querySelectorAll('#b-table .b-row');
    const name = (r) => r.querySelector('.b-name span').textContent;
    const order = () => rows().map(name).join(',');
    const kdaCell = (label) => {
      const r = rows().find((x) => name(x) === label);
      return r ? r.children[heads().indexOf('K/D/A')] : null;
    };
    const sortBy = (title) => m.document.querySelectorAll('#b-table .b-sort').find((b) => b.textContent === title).click();
    // A row opened, and the line under one of its labels in the detail that
    // follows that row.
    const lineOf = (label, dt) => {
      rows().find((x) => name(x) === label).click();
      const all = m.$('b-table').children;
      const at = all.findIndex((x) => x.classList.contains('b-row') && name(x) === label);
      const holder = all[at + 1];
      const box = holder && holder.classList.contains('b-detail-row') ? holder.querySelector('.b-detail') : null;
      const kids = box ? box.children : [];
      const i = kids.findIndex((k) => k.textContent === dt);
      return i === -1 ? '' : kids[i + 1].textContent;
    };

    ok(heads().includes('K/D/A') && !heads().includes('K/D'), 'the Valorant map cut has a K/D/A column, and no K/D one', heads().join(','));
    const abyss = kdaCell('Abyss');
    ok(abyss && abyss.textContent === '26/18/6' && abyss.title === 'K/D 1.42 over 2 matches',
      'its cell is an average match, 26/18/6, its tooltip the K/D and the sample', abyss && `"${abyss.textContent}" "${abyss.title}"`);
    const haven = kdaCell('Haven');
    ok(haven && haven.textContent === '15/10/3' && haven.title === 'K/D 1.50 over 1 match', 'one match is "over 1 match"',
      haven && `"${haven.textContent}" "${haven.title}"`);
    const lotus = kdaCell('Lotus');
    ok(lotus && lotus.textContent === '31/21/4' && lotus.title === 'K/D 1.48 over 1 match',
      'a line with no assists is left out of the cell and its sample', lotus && `"${lotus.textContent}" "${lotus.title}"`);
    const bind = kdaCell('Bind');
    ok(bind && bind.textContent === '--' && bind.classList.contains('none'), 'and a row with no line that has assists shows none');
    ok([abyss, haven, lotus, bind].every((c) => c && c.classList.contains('b-opt'))
      && m.document.querySelectorAll('#b-table .b-th-cell')[heads().indexOf('K/D/A')].classList.contains('b-opt'),
    'it is one of the columns a narrow window drops, header and cells');
    // Its track is the only one held at 64px, so the grids say where it is.
    const table = m.$('b-table');
    const cols = table.style.getPropertyValue('--cols');
    const narrowCols = table.style.getPropertyValue('--cols-narrow');
    ok(cols.split(' minmax')[heads().indexOf('K/D/A')] === '(64px, 1fr)' && !/64px/.test(narrowCols),
      'its track never narrows under its eight characters, and the narrow grid leaves it out', `${cols} | ${narrowCols}`);

    sortBy('K/D/A');
    const down = order();
    sortBy('K/D/A');
    const up = order();
    ok(down === 'Haven,Lotus,Abyss,Bind' && up === 'Abyss,Lotus,Haven,Bind',
      'it sorts on the K/D, 1.50 over 1.48 over 1.42, with the row that has none last either way', `down ${down}, up ${up}`);

    const board = lineOf('Abyss', 'Scoreboard');
    ok(board.startsWith('ACS 250') && board.includes('K/D/A 26/18/6') && board.includes('K/D 1.42') && board.endsWith('2 matches'),
      'the opened row\'s Scoreboard line carries the K/D/A beside the K/D', `read "${board}"`);
    const short = lineOf('Lotus', 'Scoreboard');
    ok(short.includes('K/D/A 31/21/4 (1 match)') && short.endsWith('2 matches'),
      'over fewer matches than the line it sits in, it says its own sample', `read "${short}"`);
    const bare = lineOf('Bind', 'Scoreboard');
    ok(bare.includes('K/D 0.83') && !/K\/D\/A/.test(bare), 'and with no assists read, the line has its K/D and no K/D/A', `read "${bare}"`);

    m.document.querySelectorAll('#b-dims button').find((b) => b.textContent === 'By agent').click();
    ok(heads().includes('K/D/A') && kdaCell('Jett'), 'the agent cut has the column too', heads().join(','));

    m.bridge.emit(C.PUSH_GAME, { id: 'rivals' });
    await settle();
    ok(heads().includes('K/D/A') && kdaCell('Tokyo 2099') && kdaCell('Tokyo 2099').textContent === '8/6/19',
      'Marvel Rivals by map reads 10/5/20 and 6/7/18 as 8/6/19', heads().join(','));
    m.document.querySelectorAll('#b-dims button').find((b) => b.textContent === 'By hero').click();
    ok(heads().includes('K/D/A') && kdaCell('Luna Snow') && kdaCell('Luna Snow').title === 'K/D 1.33 over 2 matches',
      'and by hero', heads().join(','));
    const averages = lineOf('Luna Snow', 'Averages');
    ok(averages.startsWith('K/D/A 8/6/19') && averages.includes('K/D 1.33'), 'its Averages line carries it', `read "${averages}"`);

    // League's KDA is its own ratio, (kills plus assists) over deaths.
    m.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle();
    ok(heads().includes('KDA') && !heads().includes('K/D/A'), 'League keeps its KDA ratio', heads().join(','));
  });

  // RIOT RECORDS WHAT HAPPENED AND NEVER WHY (8.2). A review graded from its
  // record alone paints one neutral list where a recorded one paints three,
  // with no fix line and no verdict colour, whether it was built today or
  // saved by 8.0.3 with three lists and served the way main serves every
  // review (valorant-review.js served()).
  await section('a review graded from Riot\'s record alone states facts:', async () => {
    const { load } = require('./fixtures/replay-match');
    const verify = require('../src/shared/valorant-verify');
    const insights = require('../src/shared/insights');
    const valorantReview = require('../src/shared/valorant-review');
    const riotReview = require('../src/shared/riot-review');
    const rec = load('riot-abyss-13-11.json');
    const fresh = riotReview.fromRiot({ row: { matchId: 'f1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory',
      score: '13-11', kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25,
      startedAt: Date.UTC(2026, 9, 1, 18) }, riot: rec, history: [] }).review;
    fresh.id = 'valorant-1759341600000-facts1';
    const old = { ...JSON.parse(JSON.stringify(fresh)), insights: insights.valorant(verify.reconcile([], rec).rounds, { role: 'Duelist' }) };
    const paintOf = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      const host = v.$('insights-host');
      return {
        heads: host.querySelectorAll('h3').map((h) => h.textContent),
        titles: host.querySelectorAll('.gv-item-title').map((t) => t.textContent),
        facts: host.querySelectorAll('.gv-item.fact').length,
        fixes: host.querySelectorAll('.gv-item-fix').length,
        verdicts: host.querySelectorAll('.gv-item.bad').length + host.querySelectorAll('.gv-item.good').length
          + host.querySelectorAll('.gv-item.warn').length,
        patterns: v.document.querySelectorAll('#v-patterns .v-pattern-text').map((p) => p.textContent),
      };
    };
    const a = await paintOf(valorantReview.served(fresh));
    ok(same(a.heads, ["What Riot's record shows"]) && a.facts === fresh.insights.facts.length && a.facts >= 6,
      'one list headed "What Riot\'s record shows", an item for every fact', JSON.stringify(a.heads));
    ok(!a.fixes && !a.verdicts && a.titles.includes('Deaths not traded within five seconds')
      && !a.titles.includes('Died where nobody could trade'), 'with no fix line, no verdict colour and no verdict for a title',
    a.titles.join(' | '));
    ok(!a.patterns.some((t) => /killed you/.test(t)) && a.titles.includes('Deaths to Skye'),
      'and what the list says is not said again under it', a.patterns.join(' | '));
    const b = await paintOf(valorantReview.served(old));
    ok(same(a, b), 'an 8.0.3 one, served, paints exactly the same', JSON.stringify(b.titles));
    // The bug, reproduced: as 8.0.3 saved it, unconverted.
    const raw = await paintOf(old);
    ok(raw.heads.includes('Your repeated mistakes') && raw.fixes > 0, 'unconverted, it paints repeated mistakes with fix lines, which is what players were shown');
    // A recorded review keeps its three lists.
    const recorded = valorantReview.build({ rounds: verify.reconcile([], rec).rounds, context: { agent: 'Jett', map: 'Abyss' },
      endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotMe: rec.me });
    const c = await paintOf(valorantReview.served({ ...recorded, id: 'valorant-1759341600000-recd1' }));
    ok(c.heads.includes('Your repeated mistakes') && c.heads.includes('What went well') && !c.facts && c.fixes > 0,
      'while a recorded match keeps its mistakes, what went well, and the fix for each', JSON.stringify(c.heads));
  });

  // The patterns are over the recorded matches and say so, the grades over
  // every match; the breakdown's repeats likewise.
  await section('the library says the patterns are the recorded matches\':', async () => {
    const breakdown = require('../src/shared/breakdown');
    const mistake = { key: 'untraded', title: 'Died where nobody could trade', matches: 2, total: 5, weight: 2, share: 1,
      judged: false, fix: 'Check someone can see the same angle.', trend: null, examples: [{ id: 'x', at: 1, detail: '3 of your 5 deaths went unanswered.' }] };
    const open = async (p, saved) => {
      const m = loadSurface('matches', {
        handlers: {
          [C.STATE_GET]: () => ({ gameId: 'valorant' }), [C.REVIEWS_LIST]: () => [],
          [C.PATTERNS_GET]: () => ({ grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [], ...p }),
          [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved || [], opts),
        },
      });
      await settle();
      return m;
    };
    const mixed = await open({ matches: 9, fromRiot: 7, recorded: 2, enough: true, mistakes: [mistake] });
    ok(mixed.$('p-sub').textContent === 'Grades across your last 9 matches, patterns across the last 2 you recorded. A pattern needs two of them to count.',
      'with Riot only matches among them, the grades and the patterns each say what they are over', mixed.$('p-sub').textContent);
    const detail = mixed.document.querySelector('#p-lists .gv-item-detail');
    ok(detail && detail.textContent.startsWith('In 2 of your last 2 recorded matches.'), 'and a pattern is counted out of the recorded ones',
      detail && detail.textContent);
    const plain = await open({ matches: 3, fromRiot: 0, recorded: 3, enough: true, mistakes: [mistake] });
    ok(plain.$('p-sub').textContent === 'Across your last 3 matches. A pattern needs two of them to count.',
      'with none, one line for both', plain.$('p-sub').textContent);
    const riotOnly = await open({ matches: 7, fromRiot: 7, recorded: 0, enough: false });
    ok(/graded from Riot's record, which says what happened and not why/.test(riotOnly.$('p-sub').textContent)
      && !riotOnly.document.querySelectorAll('#p-lists .gv-item').length, 'every match from Riot\'s record: no pattern, and why',
    riotOnly.$('p-sub').textContent);
    const one = await open({ matches: 8, fromRiot: 7, recorded: 1, enough: false });
    ok(one.$('p-sub').textContent === 'One match recorded. After the next one, this shows what repeats.', 'one recorded match waits for the next',
      one.$('p-sub').textContent);
    const none = await open({ matches: 0, fromRiot: 0, recorded: 0, enough: false });
    ok(none.$('p-sub').textContent === 'Play two matches and this shows what keeps happening across them.', 'and an empty library asks for two');

    // A breakdown row: two recorded matches on Abyss with the same mistake,
    // and one graded from Riot's record alone, saved by 8.0.3 with it too.
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const ins = { mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', fix: 'Check the angle.', count: 5, weight: 2, rounds: [] }],
      strengths: [], missed: [] };
    const at = Date.UTC(2026, 9, 1, 20);
    const row = (i, source) => ({ id: `valorant-${at - i * 3600000}-rep${i}`, game: 'valorant', at: at - i * 3600000,
      review: { kind: 'valorant', source, rounds: [], insights: ins, grade: graded,
        game: { map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' } } });
    const b = await open({ matches: 0, enough: false }, [row(1, 'riot'), row(2, 'watched'), row(3, 'watched')]);
    const r0 = b.document.querySelector('#b-table .b-row');
    if (r0) r0.click();
    const kids = (b.document.querySelector('#b-table .b-detail') || { children: [] }).children;
    const at2 = kids.findIndex((k) => k.textContent === 'Repeated here');
    const said = at2 === -1 ? '' : kids[at2 + 1].textContent;
    ok(said.startsWith('Died where nobody could trade, in 2 of 2 recorded matches.'),
      'a breakdown row counts its repeat out of its recorded matches, and says so', `read "${said}"`);
  });

  // The record beside the Matches title (8.2): "2:1" in Geist Mono at the
  // title's size, wins green and losses red, on the list page alone.
  await section('the Matches title carries the matches won and lost:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const results = {
      valorant: ['Victory', 'Defeat', 'Victory', 'Draw', null, 'Victory', 'Defeat'],
      rivals: ['VICTORY', 'defeat', 'victory'],
      lol: [null, null],
    };
    const rowsFor = (g) => (results[g] || []).map((result, i) => ({ id: `${g}-${i}`, at: at - i * 3600000, title: 'Jett',
      result, score: result ? '13-11' : null, grade: { score: 70, letter: 'B' } }));
    const open = async (sectionName) => {
      const p = loadSurface('matches', {
        handlers: {
          [C.STATE_GET]: () => ({ gameId: 'valorant' }),
          [C.REVIEWS_LIST]: (g) => rowsFor(g),
          [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        },
        window: { location: { hash: '', search: `?embed=1&section=${sectionName}` } },
      });
      await settle();
      return p;
    };
    const m = await open('list');
    const wl = m.$('wl');
    const read = () => ({ shown: !wl.hidden, w: wl.querySelector('.wl-w').textContent, l: wl.querySelector('.wl-l').textContent,
      sr: wl.querySelector('.wl-sr').textContent, title: wl.title });
    let r = read();
    ok(r.shown && r.w === '3' && r.l === '2', 'three won and two lost read 3 and 2', JSON.stringify(r));
    const painted = (cls) => m.document.querySelectorAll(`#list .m-res.${cls}`).length;
    ok(painted('win') === 3 && painted('loss') === 2, 'exactly the rows below it painted as won and as lost',
      `rows: ${painted('win')} won, ${painted('loss')} lost`);
    ok(r.sr === '3 wins, 2 losses', 'a screen reader is told "3 wins, 2 losses"', `read "${r.sr}"`);
    ok(r.title === '3 wins, 2 losses, 1 draw. 1 match with no result is not counted.',
      'the tooltip adds the draw and the match with no result', `read "${r.title}"`);
    ok(!DASHES.test(r.title + r.sr), 'with no dash in either');
    const h2 = m.document.querySelector('.sheet > header .h-brand h2');
    ok(h2 && h2.textContent === 'Matches' && wl.parentNode === h2.parentNode, 'beside the Matches title, in its header');
    ok(['.wl-w', '.wl-sep', '.wl-l'].every((s) => wl.querySelector(s).getAttribute('aria-hidden') === 'true')
      && wl.querySelector('.wl-sep').textContent === ':' && wl.querySelector('.wl-sr').classList.contains('sr-only'),
    'the digits and the colon are for the eye, the sentence for a screen reader');

    results.valorant = ['Victory', ...results.valorant];
    m.bridge.emit(C.PUSH_REVIEWS, { id: 'valorant-new', game: 'valorant' });
    await settle();
    r = read();
    ok(r.w === '4' && r.l === '2' && r.sr === '4 wins, 2 losses', 'a review saved while it is open repaints it', JSON.stringify(r));
    m.bridge.emit(C.PUSH_GAME, { id: 'rivals' });
    await settle();
    r = read();
    ok(r.shown && r.w === '2' && r.l === '1' && r.title === '2 wins, 1 loss.',
      'Marvel Rivals counts its own matches, read off the screen in any case', JSON.stringify(r));
    m.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle();
    ok(wl.hidden && m.document.querySelectorAll('#list .m-row').length === 2,
      'League, whose reviews carry no result, shows no record over its two games');
    results.valorant = [];
    m.bridge.emit(C.PUSH_GAME, { id: 'valorant' });
    await settle();
    ok(wl.hidden, 'nor does an empty library');
    results.valorant = ['Victory', 'Defeat'];
    for (const s of ['patterns', 'breakdown']) {
      const p = await open(s);
      ok(p.$('wl').hidden && p.document.querySelectorAll('#list .m-res').length === 2,
        `the ${s} page, titled for what it counts, carries no record`);
    }

    // The look, read off the stylesheets: Geist Mono 800 at the title's two
    // sizes, a window's 13px and a page's 24px, wins --good and losses --red.
    const css = fs.readFileSync(path.join(RENDERER, 'matches', 'matches.css'), 'utf8');
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule(css, '.p-trend'), 'border-radius') === 'var(--r-md)' && prop('a: 1; font-size: 13px;', 'font-size') === '13px',
      'the rule and property readers find a known rule and property');
    const base = rule(css, '.wl');
    ok(prop(base, 'font-family') === 'var(--font-mono)' && prop(base, 'font-weight') === '800'
      && prop(rule(css, '.wl b'), 'font-weight') === 'inherit', 'Geist Mono at 800, its bold tags inheriting it', base.trim());
    ok(prop(base, 'font-size') === prop(rule(css, '.h-brand h2'), 'font-size')
      && prop(rule(css, 'html.embedded .sheet > header .wl'), 'font-size') === prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-size')
      && prop(rule(css, 'html.embedded .sheet > header .wl'), 'font-size') === '24px',
    'at the title\'s size in a window and as a page');
    ok(prop(rule(css, '.wl-w'), 'color') === 'var(--good)' && prop(rule(css, '.wl-l'), 'color') === 'var(--red)'
      && prop(rule(css, '.wl-sep'), 'color') === 'var(--text-mute)', 'wins --good, losses --red, the colon dim');
    ok(/clip:/.test(rule(ui, '.sr-only')) && !/\n\.sr-only\s*\{/.test(fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8')),
      'the screen reader class is the shared one in ui.css, which the library loads, not a copy');
  });

  // THE EYE (8.2): a recorded match's AI log, from its row. A button beside the
  // row's own, never inside it; disabled with its reason once the log no
  // longer holds the match; none where nothing was recorded. The "Ask" the
  // row carried inside its own button is gone.
  const LogEye = require('../src/renderer/shared/log-eye');
  // The eye Stats opens the AI log with, read off its markup, so the two
  // cannot drift into two icons for one thing.
  const statsDoc = new Document(fs.readFileSync(path.join(RENDERER, 'stats', 'index.html'), 'utf8'));
  const statsEye = statsDoc.querySelector('#ailog svg');
  const eyeShape = (svg) => (svg ? [svg.querySelector('path') && svg.querySelector('path').getAttribute('d'),
    ...['cx', 'cy', 'r'].map((a) => svg.querySelector('circle') && svg.querySelector('circle').getAttribute(a)),
    svg.getAttribute('viewBox'), svg.getAttribute('stroke')].join('|') : '');
  await section('a library row opens its match\'s AI log, with the eye beside it:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const ROWS = {
      valorant: [
        { id: `valorant-${at}-kept01`, at, game: 'valorant', title: 'Jett', source: 'watched', aiLog: 'kept', grade: { score: 82, letter: 'A' } },
        { id: `valorant-${at - 3600000}-gone01`, at: at - 3600000, game: 'valorant', title: 'Jett', source: 'watched', aiLog: 'gone', grade: { score: 70, letter: 'B' } },
        { id: `valorant-${at - 7200000}-riot01`, at: at - 7200000, game: 'valorant', title: 'Sova', source: 'riot', aiLog: null, grade: { score: 75, letter: 'B' } },
      ],
      rivals: [{ id: `rivals-${at}-riv001`, at, game: 'rivals', title: 'Luna Snow', aiLog: null, grade: { score: 72, letter: 'B' } }],
    };
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: (g) => ROWS[g] || [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
      },
    });
    await settle();
    const items = () => m.document.querySelectorAll('#list .m-item');
    const rowOf = (it) => it.children.find((c) => c.classList.contains('m-row')) || null;
    const eyeOf = (it) => it.children.find((c) => c.classList.contains('log-eye')) || null;
    const sent = (ch) => m.bridge.sent.filter((s) => s[0] === ch);
    ok(items().length === 3 && items().every((it) => it.getAttribute('role') === 'listitem' && rowOf(it)),
      'each match is a list item holding its row');
    ok(items().every((it) => rowOf(it).tagName === 'BUTTON' && !rowOf(it).querySelectorAll('button').length
      && !rowOf(it).querySelector('.log-eye') && rowOf(it).getAttribute('role') === null),
    'the row is a plain button with no control inside it');
    const kept = eyeOf(items()[0]);
    ok(kept && kept.tagName === 'BUTTON' && kept.type === 'button' && !kept.disabled
      && kept.getAttribute('aria-label') === 'Open the AI log of this match' && kept.title === 'Open the AI log of this match',
    'a recorded match has the eye, a sibling of its row, named for what it opens');
    ok(kept && eyeShape(kept.querySelector('svg')) === eyeShape(statsEye) && eyeShape(statsEye).startsWith('M2 12')
      && kept.querySelector('svg').getAttribute('aria-hidden') === 'true',
    'drawn as the Stats header draws the AI log\'s eye', `${eyeShape(kept && kept.querySelector('svg'))} | ${eyeShape(statsEye)}`);
    if (kept) kept.click();
    ok(same(sent(C.REVIEW_AILOG), [[C.REVIEW_AILOG, ROWS.valorant[0].id]]) && !sent(C.REVIEW_OPEN).length,
      'pressed, it sends that review\'s id alone over REVIEW_AILOG, and does not open the review', JSON.stringify(m.bridge.sent));
    const gone = eyeOf(items()[1]);
    ok(gone && gone.disabled && gone.title === LogEye.GONE && gone.getAttribute('aria-label') === 'Open the AI log of this match'
      && /No AI log is kept for this match/.test(gone.title) && /frames the coach looked at/.test(gone.title),
    'once the log no longer holds the match, the eye is disabled and its tooltip says why', gone && gone.title);
    if (gone) gone.click();
    ok(sent(C.REVIEW_AILOG).length === 1, 'and a disabled eye sends nothing');
    ok(!eyeOf(items()[2]), 'a match graded from Riot\'s record alone, with nothing recorded, has no eye');
    const gapOf = (it) => it.children.find((c) => c.classList.contains('m-eye-gap')) || null;
    ok(gapOf(items()[2]) && gapOf(items()[2]).getAttribute('aria-hidden') === 'true' && !gapOf(items()[0]) && !gapOf(items()[1]),
      'and keeps the eye\'s room, hidden from a screen reader, so the grades line up down the list');
    ok(!m.document.querySelectorAll('#list .m-ask').length && !items().some((it) => /\bAsk\b/.test(it.textContent)),
      'and no row says Ask any more');
    rowOf(items()[0]).click();
    ok(same(sent(C.REVIEW_OPEN), [[C.REVIEW_OPEN, ROWS.valorant[0].id]]) && sent(C.REVIEW_AILOG).length === 1,
      'the row itself still opens the review, and only the review');
    ok(typeof m.bridge.api.openAiLog === 'function' && typeof m.bridge.api.askAbout === 'undefined',
      'the library\'s bridge opens the AI log and no longer asks about a match');
    m.bridge.emit(C.PUSH_GAME, { id: 'rivals' });
    await settle();
    ok(items().length === 1 && !eyeOf(items()[0]) && !gapOf(items()[0]),
      'Marvel Rivals writes no AI log, so its rows have no eye, nor room kept for one');
    ok(!DASHES.test(LogEye.NAME + LogEye.GONE), 'with no dash in its name or its tooltip');
  });

  await section('the review\'s header opens its match\'s AI log, beside Ask about this match:', async () => {
    const base = { id: 'valorant-1759348800000-kept01', kind: 'valorant', source: 'watched', rounds: [],
      game: { map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11' } };
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const eyeIn = (v) => v.$('eye-host').querySelector('.log-eye');
    const v = await open({ ...base, aiLog: 'kept' });
    const eye = eyeIn(v);
    ok(!v.$('eye-host').hidden && eye && !eye.disabled && eye.getAttribute('aria-label') === LogEye.NAME,
      'a recorded review shows the eye in its header');
    const actions = v.$('ask').parentNode;
    ok(v.$('eye-host').parentNode === actions && actions.classList.contains('h-actions')
      && actions.children.indexOf(v.$('eye-host')) === actions.children.indexOf(v.$('ask')) - 1,
    'right beside Ask about this match');
    ok(eye && eyeShape(eye.querySelector('svg')) === eyeShape(statsEye) && v.scripts.some((s) => /log-eye\.js$/.test(s)),
      'the same eye as its row in Matches, from shared/log-eye.js');
    if (eye) eye.click();
    ok(same(v.bridge.sent.filter((s) => s[0] === C.REVIEW_AILOG), [[C.REVIEW_AILOG, base.id]]),
      'pressed, it sends this review\'s id over REVIEW_AILOG', JSON.stringify(v.bridge.sent));
    const g = await open({ ...base, aiLog: 'gone' });
    ok(eyeIn(g) && eyeIn(g).disabled && eyeIn(g).title === LogEye.GONE, 'disabled with its reason once the log no longer holds it');
    const riot = await open({ ...base, source: 'riot', aiLog: null });
    ok(riot.$('eye-host').hidden && !eyeIn(riot) && !riot.$('ask').hidden,
      'a review graded from Riot\'s record alone has no eye, and still has Ask');
    // The page is kept between reviews, so the eye follows whichever is painted.
    v.bridge.emit(C.PUSH_RIVALS_REVIEW, { id: 'rivals-1759348800000-riv001', kind: 'rivals', aiLog: null,
      game: { hero: 'Luna Snow', role: 'Strategist', map: 'Tokyo 2099', mode: 'Competitive', result: 'victory' },
      scoreline: { kills: 10, deaths: 5, assists: 20, damage: 8000, healing: 15000, blocked: 0, accuracy: 40 } });
    await settle();
    ok(v.$('eye-host').hidden && !eyeIn(v), 'a Marvel Rivals review painted after it takes the eye away');
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...base, aiLog: 'kept' });
    await settle();
    ok(!v.$('eye-host').hidden && eyeIn(v) && !eyeIn(v).disabled, 'and the next recorded one brings it back');
    ok(v.bridge.api.openAiLog && typeof v.bridge.api.askAbout === 'function', 'the review\'s bridge opens the AI log and still asks about a match');
  });

  // WHERE YOU DIED, AND HOW (8.2): every death the coach looked at, last on the
  // review page, whether Riot's record timed it or the screen did. A round
  // card keeps the cause and a link down; the eye on a moment opens the AI log
  // at the frame the coach looked at.
  await section('the review ends with where you died, and how:', async () => {
    const AT = Date.UTC(2026, 9, 1, 18, 4, 0);
    const card = (n, side, facts, forensics) => ({ n, side, result: 'lost', died: true, facts, reads: [], why: null, forensics });
    const base = {
      id: 'valorant-1759341600000-look01', kind: 'valorant', source: 'watched', aiLog: 'kept',
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      rounds: [
        card(2, 'Defence', ['Died at A Site, 15s in, to Viper with a Marshal', 'First death of the round'],
          { cause: 'dry-peek', what: 'You swung wide into mid with nothing thrown.', better: 'Wait for the flash.',
            frames: ['r2-before.jpg', 'r2-after.jpg'], source: 'riot', at: AT }),
        { ...card(5, 'Defence', ['Died at Mid Bend'], null), result: 'won' },
        card(14, 'Attack', ['Died at A Site', 'Spike planted'],
          { cause: 'isolated', what: 'You held the site alone.', better: 'Hold closer to your team.',
            frames: ['r14-before.jpg', 'r14-after.jpg'], source: 'screen', at: AT + 600000 }),
        card(19, 'Attack', ['Died at Mid Bottom, early in the round'],
          { cause: 'unclear', what: null, better: null, frames: ['r19-before.jpg'], source: 'screen', at: AT + 900000 }),
      ],
      frameData: {
        'r2-before.jpg': 'data:image/jpeg;base64,AAA2b', 'r2-after.jpg': 'data:image/jpeg;base64,AAA2a',
        'r14-before.jpg': 'data:image/jpeg;base64,AAA14b', 'r14-after.jpg': 'data:image/jpeg;base64,AAA14a',
        'r19-before.jpg': 'data:image/jpeg;base64,AAA19b',
      },
    };
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const v = await open(base);
    const wrap = v.$('v-looks-wrap');
    const moments = v.document.querySelectorAll('#v-looks .v-moment');
    ok(!wrap.hidden && wrap.querySelector('h3').textContent === 'Where you died, and how', 'the section is shown, under its heading');
    const kids = v.$('vreview').children;
    ok(kids[kids.length - 1].classList.contains('v-foot') && kids[kids.length - 2] === wrap,
      'last on the review, with only the footer under it');
    ok(same(moments.map((m) => m.id), ['moment-2', 'moment-14', 'moment-19']), 'one entry per death the coach looked at, in round order',
      moments.map((m) => m.id).join());
    const [m2, m14, m19] = moments;
    const head = (m) => m.querySelector('.v-moment-head');
    ok(head(m2).querySelector('.v-rn').textContent === 'Round 2' && head(m2).querySelector('.v-side').textContent === 'Defence',
      'each names its round and side');
    ok(same(m14.children.map((c) => c.className.split(' ')[0]),
      ['v-moment-head', 'v-shots', 'v-facts', 'v-moment-cause', 'v-look-what', 'v-look-better', 'v-moment-src']),
    'then its frames, the round\'s facts, the cause, what happened, the better play and where its timing came from',
    m14.children.map((c) => c.className).join(' | '));
    const imgs = (m) => m.querySelectorAll('.v-shot img');
    ok(same(imgs(m2).map((i) => i.src), [base.frameData['r2-before.jpg'], base.frameData['r2-after.jpg']])
      && same(m2.querySelectorAll('figcaption').map((f) => f.textContent), ['Just before', 'Just after'])
      && m2.querySelector('.v-shots').classList.contains('two'), 'its frames are just before and just after, across the card');
    ok(imgs(m19).length === 1 && !m19.querySelector('.v-shots').classList.contains('two'), 'and a frame on its own takes the whole width');
    const fig = imgs(m2)[0].parentNode;
    imgs(m2)[0].click();
    const zoomed = fig.classList.contains('zoom');
    imgs(m2)[0].click();
    ok(zoomed && !fig.classList.contains('zoom'), 'a click zooms a frame, and another puts it back');
    ok(m2.querySelector('.v-facts').textContent === base.rounds[0].facts.join('  ·  '), 'the facts line is the round\'s own');
    ok(m2.querySelector('.v-moment-cause .v-cause').textContent === 'Dry peek' && m2.querySelector('.v-cause').classList.contains('bad')
      && m2.querySelector('.v-look-what').textContent === 'You swung wide into mid with nothing thrown.'
      && m2.querySelector('.v-look-better').textContent === 'BetterWait for the flash.', 'with the cause chip, what happened and the better play');
    const src = (m) => m.querySelector('.v-moment-src');
    ok(!src(m2) && src(m14) && src(m14).textContent === "When this happened is the coach's own read of the screen, not Riot's record of the match.",
      'a look from the screen says its timing is the coach\'s own read, and one Riot timed says nothing of the kind');
    ok(!DASHES.test(src(m14).textContent + wrap.textContent), 'with no dash anywhere in the section');
    ok(imgs(m19).length === 1 && m19.querySelector('.v-cause').textContent === 'Frame unclear' && m19.querySelector('.v-cause').classList.contains('neutral')
      && !m19.querySelector('.v-look-what') && !m19.querySelector('.v-look-better'), 'an unclear frame keeps its picture and says nothing about it');
    const eyeOf = (m) => head(m).querySelector('.log-eye');
    ok(moments.every((m) => eyeOf(m) && !eyeOf(m).disabled && eyeOf(m).getAttribute('aria-label') === LogEye.MOMENT && eyeOf(m).title === LogEye.MOMENT)
      && LogEye.MOMENT !== LogEye.NAME, 'each moment has the eye, named for the moment it opens');
    eyeOf(m14).click();
    const toLog = () => v.bridge.sent.filter((s) => s[0] === C.REVIEW_AILOG);
    ok(same(toLog(), [[C.REVIEW_AILOG, base.id, AT + 600000]]), 'pressed, it sends the review and when the frame it looked at was captured',
      JSON.stringify(toLog()));
    v.$('eye-host').querySelector('.log-eye').click();
    ok(same(toLog()[1], [C.REVIEW_AILOG, base.id]), 'while the header\'s eye still sends the review alone', JSON.stringify(toLog()));
    const rc = (n) => v.document.getElementById(`round-${n}`);
    ok(!rc(2).querySelectorAll('img').length && !rc(14).querySelectorAll('img').length && !rc(2).querySelector('.v-look-what'),
      'a round card shows no frame and no sentence of the look any more');
    ok(rc(2).querySelector('.v-look-link .v-cause').textContent === 'Dry peek'
      && rc(14).querySelector('.v-look-link .v-moment-link').textContent === 'See where you died', 'it keeps the cause chip, and a link down to the moment');
    ok(!rc(5).querySelector('.v-look-link'), 'and a round with no look has neither');
    // A keyboard player on the link presses Enter, which is its click. The
    // look is at the bottom of the page now, so focus has to go with the
    // scroll, or the next Tab carries on down the round cards from the link.
    const id = (n) => (n ? n.id || n.className : 'nothing');
    const link14 = rc(14).querySelector('.v-moment-link');
    link14.focus();
    ok(v.document.activeElement === link14 && nextTab(v.document) !== eyeOf(m14),
      'from the link, Tab goes on down the round cards, not to the moment', `next Tab: ${id(nextTab(v.document))}`);
    let asked = null;
    const focusOf = m14.focus;
    m14.focus = function (o) { asked = o || {}; return focusOf.call(this, o); };
    link14.click();
    ok(m14.classList.contains('flash') && !m2.classList.contains('flash'), 'the link brings that moment into view and flashes it');
    ok(v.document.activeElement === m14 && m14.tabIndex === -1 && !!asked && asked.preventScroll === true,
      'and hands it the focus, out of the tab order, with no scroll of its own over the smooth one',
      `focus on ${id(v.document.activeElement)}, tabindex ${m14.tabIndex}, asked ${JSON.stringify(asked)}`);
    ok(nextTab(v.document) === eyeOf(m14), 'so the next Tab is that moment\'s own eye', `next Tab: ${id(nextTab(v.document))}`);
    // The round strip jumps the same way, to the round's card.
    const cell14 = v.document.querySelectorAll('#v-strip .v-cell').find((c) => c.querySelector('.v-cell-n').textContent === '14');
    cell14.focus();
    cell14.click();
    ok(v.document.activeElement === rc(14) && nextTab(v.document) === link14,
      'and a round in the strip hands its card the focus, so Tab reaches the link down to the moment',
      `focus on ${id(v.document.activeElement)}, next Tab: ${id(nextTab(v.document))}`);
    const gone = await open({ ...base, aiLog: 'gone' });
    ok(!gone.document.querySelectorAll('#v-looks .log-eye').length && gone.document.querySelectorAll('#v-looks .v-moment img').length === 5,
      'with the AI log gone, the moments keep their frames and lose their eyes');
    const older = await open({ ...base, rounds: base.rounds.map((c) => (c.forensics ? { ...c, forensics: { ...c.forensics, source: undefined, at: undefined } } : c)) });
    ok(older.document.querySelectorAll('#v-looks .v-moment').length === 3 && !older.document.querySelectorAll('#v-looks .log-eye').length
      && !older.document.querySelectorAll('.v-moment-src').length, 'a review saved before 8.2 paints its looks as Riot\'s, with no eye at a moment it never kept');
    const none = await open({ ...base, rounds: [base.rounds[1]] });
    ok(none.$('v-looks-wrap').hidden && !none.document.querySelectorAll('.v-moment').length, 'a review with no look has no such section');
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...base, rounds: [base.rounds[1]] });
    await settle();
    ok(v.$('v-looks-wrap').hidden && !v.document.querySelectorAll('.v-moment').length, 'and a version with none painted over one clears it');
  });

  await section('Stats, graded matches:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const s = (id, score, i) => ({ id, at: at - i * 3600000, map: 'Abyss', title: 'Jett', grade: { score, letter: grade.letter(score) } });
    let sessions = [s('a', 82, 0), s('b', 58, 1), s('c', 69, 2)];
    let dashCalls = 0;
    const dash = () => {
      dashCalls++;
      return { game: 'valorant', statsSupported: true, categories: {}, rank: { value: null, direction: 'flat' },
        winRate: { value: null, direction: 'flat' }, topAgents: [], sessions: sessions.slice(), sessionCount: sessions.length,
        matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: '' };
    };
    const st = loadSurface('stats', {
      handlers: { [C.STATS_DASHBOARD]: dash, [C.STATS_MATCHES]: () => ({ matches: [] }), [C.STATS_RANK_HISTORY]: () => ({ points: [] }) },
    });
    await settle();
    st.clock.flushFrames();
    // The number in each graded row, whatever class the chip carries.
    const chips = () => st.document.querySelectorAll('#session-list .row.session .top')
      .map((top) => top.children.find((c) => /^\d+$/.test(c.textContent) && !c.classList.contains('kda')))
      .filter(Boolean);
    const shown = () => chips().map((c) => `${c.textContent}:${toneOf(c)}`);
    ok(same(shown(), [`82:${toneFor(82)}`, `58:${toneFor(58)}`, `69:${toneFor(69)}`]),
      'each grade is its letter\'s colour: an 82 A green, a 58 D red, a 69 C a warning', shown().join(' '));
    const letters = st.document.querySelectorAll('#session-list .grade-letter');
    ok(letters.length === 3 && letters.every((l) => toneOf(l) === TONE[l.textContent]), 'and the letter beside it agrees');
    ok(st.scripts.some((x) => /grade-view\.js$/.test(x)), 'Stats loads the shared rule rather than keeping its own');

    // A review saved while the window is open, then improved, in a burst.
    ok(st.bridge.listening(C.PUSH_REVIEWS) === 1, 'Stats listens for saved reviews through its preload');
    st.document.querySelector('#session-list .row.session').click();   // someone is reading the 82
    sessions = [s('d', 91, 0), ...sessions.map((x, i) => ({ ...x, at: x.at - (i + 1) }))];
    st.bridge.emit(C.PUSH_REVIEWS, { id: 'd', game: 'valorant' });
    st.bridge.emit(C.PUSH_REVIEWS, { id: 'd', game: 'valorant' });
    st.clock.advance(500);
    await settle();
    st.clock.flushFrames();
    const rows = st.document.querySelectorAll('#session-list .row.session');
    ok(rows.length === 4 && shown()[0] === `91:${toneFor(91)}`,
      'the new match appears without reopening the window', `rows ${rows.length}, first ${shown()[0]}`);
    ok(dashCalls === 2, 'two pushes in a burst cost one fetch', `fetched ${dashCalls} times`);
    ok(!rows[0].classList.contains('settled') && rows.slice(1).every((r) => r.classList.contains('settled')),
      'only the new row counts up and slides in');
    ok(rows[1] && rows[1].dataset.id === 'a' && rows[1].classList.contains('open'), 'the row being read stays open');
  });

  // The rank tile's arrow was a trend between two tracker snapshots, a flat
  // dash beside every rank with no older snapshot, which read as "no change".
  await section('Stats, the rank tile says what the last rated game did:', async () => {
    const open = async (history) => {
      const st = loadSurface('stats', {
        handlers: {
          [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {},
            rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
            sessions: [], sessionCount: 0, matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
          [C.STATS_MATCHES]: () => ({ matches: [] }),
          [C.STATS_RANK_HISTORY]: () => history,
        },
      });
      await settle();
      st.clock.flushFrames();
      const tile = st.document.querySelectorAll('#cards .card').find((c) => /^Rank/.test(c.querySelector('.label').textContent));
      const rr = tile && tile.querySelector('.arrow');
      return { st, rr, tone: rr ? ['gain', 'loss', 'even'].filter((t) => rr.classList.contains(t)).join('') : null };
    };
    // Oldest first, as the rank history route returns them.
    const pt = (elo, change, tier) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: tier || 'Gold 2' });
    const gain = await open({ points: [pt(1180, -21), pt(1218, 18)] });
    ok(gain.rr && gain.rr.textContent === '+18 RR' && gain.tone === 'gain',
      'a gain reads +18 RR, in the good colour', gain.rr && `read "${gain.rr.textContent}" ${gain.rr.className}`);
    const loss = await open({ points: [pt(1218, 18), pt(1203, -15)] });
    ok(loss.rr && loss.rr.textContent === '-15 RR' && loss.tone === 'loss',
      'a loss reads -15 RR, in red', loss.rr && `read "${loss.rr.textContent}" ${loss.rr.className}`);
    const placed = await open({ points: [pt(1203, -15), pt(1500, 297, 'Gold 3'), pt(0, 0, 'Unrated')] });
    ok(placed.rr && placed.rr.textContent === '-15 RR',
      'a placement jump and an unrated point are passed over for the newest rated game', placed.rr && `read "${placed.rr.textContent}"`);
    const even = await open({ points: [pt(1203, 0)] });
    ok(even.rr && even.rr.textContent === '0 RR' && even.tone === 'even', 'no change reads 0 RR, dim');
    for (const [what, history] of [['no history', { points: [] }], ['no Riot ID', { error: 'no-riot-id' }]]) {
      const none = await open(history);
      ok(none.rr && none.rr.textContent === '' && !none.tone, `${what}: the tile shows nothing, not a flat dash`,
        none.rr && `read "${none.rr.textContent}"`);
    }
    // The colours are the tokens, read off the stylesheet the tile is drawn with.
    const css = fs.readFileSync(path.join(RENDERER, 'stats', 'stats.css'), 'utf8');
    const colour = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return ((css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '').trim();
    };
    ok(colour('.arrow.flat') === 'color: var(--text-mute);', 'the rule reader finds a known rule');
    ok(colour('.arrow.rr.gain') === 'color: var(--good);' && colour('.arrow.rr.loss') === 'color: var(--red);'
      && colour('.arrow.rr.even') === 'color: var(--text-mute);', 'a gain is --good, a loss --red, no change dim');
    // Ask Coach is a page in the sidebar; "Ask Coach about this" on a graded match stays.
    ok(!gain.st.$('askcoach') && typeof gain.st.bridge.api.openChat === 'undefined'
      && typeof gain.st.bridge.api.askAboutSession === 'function',
      'the Stats header has no chat button, and its bridge no openChat, while a match can still be asked about');
  });

  // The Stats page with a rank, its tile found by its label (a skeleton card
  // has none), and main stood in for by `rankHistory(force)`.
  const statsWithRank = (rankHistory) => loadSurface('stats', {
    handlers: {
      [C.STATS_DASHBOARD]: (mode) => ({ game: 'valorant', statsSupported: true, categories: {},
        rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
        sessions: [], sessionCount: 0, matches: { matches: [], fetchedAt: 0, mode: mode || 'competitive' }, grading: null, riotId: 'Me#EUW' }),
      [C.STATS_REFRESH]: (mode) => ({ matches: [], fetchedAt: 0, mode: mode || 'competitive' }),
      [C.STATS_MATCHES]: () => ({ matches: [] }),
      [C.STATS_RANK_HISTORY]: rankHistory,
    },
  });
  const rankTileOf = (st) => st.document.querySelectorAll('#cards .card')
    .find((c) => c.querySelector('.label') && /^Rank/.test(c.querySelector('.label').textContent)) || null;
  const repainted = async (st) => { await settle(); st.clock.flushFrames(); };

  // REFRESH READS THE RR AGAIN, PAST MAIN'S CACHE. Main keeps the rank history
  // five minutes (getRankHistory), and a Refresh just after Riot published a
  // game put the game before it on the tile, as "RR from your last rated game",
  // beside a match list that already had the new one. The stand in answers as
  // main does: what it cached, unless the read is forced.
  await section('Stats, Refresh reads the rank tile\'s RR past main\'s cache:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const cached = { points: [pt(1180, -21), pt(1218, 18)] };
    const published = { points: [pt(1180, -21), pt(1218, 18), pt(1203, -15)] };
    const reads = [];
    // The forced read answers AFTER the forced dashboard, as it can in the app,
    // so a tile that read whatever points were held when it repainted, rather
    // than waiting on the forced read, shows the game before.
    const later = (v) => new Promise((r) => { let n = 3; const spin = () => (--n ? setImmediate(spin) : r(v)); setImmediate(spin); });
    const st = statsWithRank((force) => { reads.push(force === true); return force === true ? later(published) : cached; });
    await repainted(st);
    const rr = () => rankTileOf(st).querySelector('.arrow');
    ok(rr().textContent === '+18 RR' && same(reads, [false]), 'opened, the tile reads the history main holds',
      `read "${rr().textContent}", forced ${JSON.stringify(reads)}`);
    st.$('refresh').click();
    await repainted(st);
    await repainted(st);
    ok(rr().textContent === '-15 RR' && rr().classList.contains('loss'), 'after Refresh it shows the game Riot has just published',
      `read "${rr().textContent}"`);
    ok(same(reads, [false, true]), 'from one more read, a forced one', `forced ${JSON.stringify(reads)}`);
  });

  // A READ IS SHARED FOR A MOMENT, NOT FOR THE PAGE'S LIFE. The page is kept
  // between visits, and main drops its cache when a recording stops so the
  // match just played shows at once; held here for good, the rank graph left
  // it out until a Refresh.
  await section('Stats, the rank graph asks main again once the shared read is old:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const reads = [];
    const st = statsWithRank((force) => { reads.push(force === true); return { points: [pt(1180, -21), pt(1218, 18)] }; });
    await repainted(st);
    rankTileOf(st).click();   // the notes open, and the graph reads the history
    await repainted(st);
    ok(same(reads, [false]), 'opened at once, the graph shares the tile\'s read', `reads ${JSON.stringify(reads)}`);
    rankTileOf(st).click();   // closed
    await repainted(st);
    st.clock.advance(31 * 1000);
    rankTileOf(st).click();   // opened again, half a minute on
    await repainted(st);
    ok(same(reads, [false, false]), 'opened half a minute later, it asks main again', `reads ${JSON.stringify(reads)}`);
  });

  // THE CHEVRON FOLLOWS THE NOTES THROUGH A REPAINT. The mode toggle, Refresh
  // and a Riot ID switch all build the tile again while its notes stay open
  // under it, and it came back with its chevron closed over open notes.
  await section('Stats, the rank tile\'s chevron stays turned over while its notes are open:', async () => {
    const st = statsWithRank(() => ({ points: [] }));
    await repainted(st);
    const open = () => st.$('rank-reveal').classList.contains('open') && !st.$('rank-reveal').hidden;
    const turned = () => rankTileOf(st).classList.contains('notes-open');
    rankTileOf(st).click();
    await settle();
    ok(open() && turned(), 'the notes open and the chevron turns over');
    const first = rankTileOf(st);
    st.$('modeseg').querySelector('button[data-mode="unrated"]').click();
    await repainted(st);
    ok(rankTileOf(st) !== first && open() && turned(), 'the mode toggle builds the tile again, and it stays turned over');
    const second = rankTileOf(st);
    st.$('refresh').click();
    await repainted(st);
    ok(rankTileOf(st) !== second && open() && turned(), 'so does Refresh');
    const third = rankTileOf(st);
    st.bridge.emit(C.PUSH_STATE, { riotId: 'Me#EUW' });
    st.bridge.emit(C.PUSH_STATE, { riotId: 'Other#EUW' });
    await repainted(st);
    ok(rankTileOf(st) !== third && open() && turned(), 'and a Riot ID switch, which keeps the notes open');
    rankTileOf(st).click();
    ok(!st.$('rank-reveal').classList.contains('open') && !turned(), 'closed, the chevron turns back');
    st.$('modeseg').querySelector('button[data-mode="competitive"]').click();
    await repainted(st);
    ok(!turned(), 'and a repaint while they are closed leaves it closed');
  });

  await section('Settings, the game picker:', async () => {
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.0.1', state: 'current' }),
      },
    });
    await settle();
    const games = se.bridge.api.games.list(false);
    ok(['rivals', 'lol'].every((id) => (games.find((g) => g.id === id) || {}).coaching === true),
      'the bridge calls Rivals and League coachable, as Start does');
    se.document.querySelector('#gamepick .dd-btn').click();   // open the real dropdown
    const row = (id) => se.document.querySelector(`.dd-opt[data-value="${id}"]`);
    for (const id of ['rivals', 'lol']) {
      const r = row(id);
      const note = r ? r.title : '';
      ok(r && /graded after every/i.test(note) && !/not built|look and layout/i.test(note) && !DASHES.test(note),
        `${id}: the tooltip says how it is graded, never that coaching is not built`, `read "${note}"`);
      const tag = r && r.querySelector('.dd-opt-tag');
      ok(tag && tag.textContent === 'preview', `${id}: still labelled preview, the registry's own flag`);
    }
    const v = row('valorant');
    ok(v && !v.title && !v.querySelector('.dd-opt-tag'), 'Valorant carries no label');
  });

  await section('the AI log describes deaths, and only a tip era log counts reviews:', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-surfaces-'));
    try {
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const T = Date.UTC(2026, 9, 1, 20, 0, 0);
      const alive = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
      const dead = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
      const states = [alive, alive, dead, dead, alive];
      const write = (stamp, tipEra) => {
        const dir = path.join(root, `session-${stamp}`);
        fs.mkdirSync(dir, { recursive: true });
        const records = states.map((state, i) => {
          const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
          fs.writeFileSync(path.join(dir, frame), jpeg);
          // What each build writes: 8.0 has no `shown` at all, the tip era always had one.
          return tipEra
            ? { i, at: T + i * 10000, frame, state, aiTip: '', shown: null, reject: null }
            : { i, at: T + i * 10000, frame, state, round: 6, died: i === 2, match: null };
        });
        fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: T, records }));
        return `session-${stamp}`;
      };
      const now8 = write('2026-10-01T20-00-00-000Z', false);
      const old = write('2026-09-01T20-00-00-000Z', true);

      const open = async (id, weapon) => {
        const a = loadSurface('ailog', {
          handlers: {
            [C.AILOG_GET]: (sid) => aiLogStore.read(root, sid),
            [C.AILOG_CONFIRM]: () => ({ status: 'confirmed', summary: 'Riot agrees on 1 death.', pairs: [{ round: 6, killer: 'Jett', weapon }] }),
            [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
          },
          window: { location: { hash: `#${id}`, search: '' } },
        });
        await settle();
        return a;
      };

      const a = await open(now8, 'Outlaw');
      const sub = a.$('subtitle').textContent;
      ok(/1 death$/.test(sub) && !/reviewed/.test(sub), 'an 8.0 session counts its deaths and no reviews', `read "${sub}"`);
      const marks = a.document.querySelectorAll('#marks .mark-death');
      ok(marks.length === 1 && !marks[0].classList.contains('unreviewed'), 'its skull is not greyed out as a miss');
      ok(marks[0] && marks[0].title === 'Round 6: killed by Jett with an Outlaw. Confirmed by Riot.',
        'its tooltip names the death and Riot\'s weapon, with an Outlaw, and no review', `read "${marks[0] && marks[0].title}"`);
      if (marks[0]) marks[0].click();
      const why = a.$('death-why');
      ok(why.textContent === 'round 6, killed by Jett' && !why.classList.contains('unreviewed'),
        'on the death, the line says what happened, not that the coach said nothing', `read "${why.textContent}"`);

      const b = await open(old, 'Vandal');
      const subOld = b.$('subtitle').textContent;
      ok(/1 death, 0 reviewed$/.test(subOld), 'a tip era session keeps the reviewed count it was written with', `read "${subOld}"`);
      const markOld = b.document.querySelectorAll('#marks .mark-death')[0];
      ok(markOld && markOld.classList.contains('unreviewed')
        && markOld.title === 'Round 6: killed by Jett with a Vandal, no review was shown. Confirmed by Riot.',
        'and greys the death the coach never spoke about, with a Vandal', `read "${markOld && markOld.title}"`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ONE MATCH, from a review's eye (8.2): the AI log opens on that match's
  // frames alone, in death review mode, with no picker and "Whole session" in
  // its place; gone, it says so plainly; sealed mid match, it shows nothing.
  // Main is stood in for by the store it reads with, as main calls it.
  await section('the AI log opened on one match, from its review\'s eye:', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-surfaces-scope-'));
    try {
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const M1 = Date.UTC(2026, 9, 1, 18, 0, 0);
      const E1 = M1 + 1800000;
      const M2 = E1 + 4;
      const alive = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
      const dead = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
      const write = (name, recs, mtime) => {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        const records = recs.map(([at, state, match], i) => {
          const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
          fs.writeFileSync(path.join(dir, frame), jpeg);
          return { i, at, frame, state, round: 4, died: false, match };
        });
        fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0].at, records }));
        fs.utimesSync(dir, mtime / 1000, mtime / 1000);
        return dir;
      };
      // Three matches in one session: two frames of one before, five of the
      // match the review is of, three of the one after. So the review's frames
      // are not where they sit in the whole session.
      const sid = 'session-2026-10-01T17-29-00-000Z';
      const M0 = M1 - 1800000;
      const dir = write(sid, [
        [M0 + 60000, alive, M0], [M0 + 70000, alive, M0],
        [M1 + 60000, alive, M1], [M1 + 70000, alive, M1], [M1 + 80000, dead, M1], [M1 + 90000, dead, M1], [E1 - 30000, alive, M1],
        [M2 + 60000, alive, M2], [M2 + 70000, alive, M2], [M2 + 80000, alive, M2],
      ], M2 + 80000);
      write('session-2026-09-30T10-00-00-000Z', [[M1 - 86400000, alive, M1 - 86400000], [M1 - 86000000, alive, M1 - 86400000]], M1 - 86000000);
      const place1 = aiLogStore.placeOf(dir, M1, E1);
      const place2 = aiLogStore.placeOf(dir, M2, M2 + 600000);
      // What main knows: the session being recorded, and whether a match is
      // being played. And, for one test, a reply main no longer gives.
      let live = null;
      let sealed = false;
      let unscoped = null;
      const open = async (target) => {
        const a = loadSurface('ailog', {
          handlers: {
            // As main answers it (index.js getAiLog): strict with a scope, the
            // number of sessions the log keeps beside it, sealed mid match on
            // the session being recorded; and a whole session through serve(),
            // with the seal decided on the session it serves.
            [C.AILOG_GET]: (id, scope) => {
              if (scope) {
                return sealed && id === live ? { records: [], sessions: [], scoped: true, sealed: true, keeps: 5 }
                  : { ...aiLogStore.read(root, id, live, scope), keeps: 5 };
              }
              if (unscoped) return unscoped(id);
              const log = aiLogStore.serve(root, id, live, sealed);
              return log.gone ? { ...log, keeps: 5 } : log;
            },
            [C.AILOG_CONFIRM]: () => ({ status: 'unavailable' }),
            [C.AILOG_ASK]: () => ({ reply: 'You peeked alone.' }),
            [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
          },
          window: { location: { hash: `#${typeof target === 'string' ? target : encodeURIComponent(JSON.stringify(target))}`, search: '' } },
        });
        await settle();
        return a;
      };
      const shown = (a) => ({ frames: Number(a.$('slider').max) + 1, at: Number(a.$('slider').value), picker: !a.$('session').hidden,
        whole: !a.$('whole').hidden, main: !a.$('main').hidden, empty: a.$('empty').hidden ? '' : a.$('empty').textContent,
        pos: a.$('death-pos').textContent, sub: a.$('subtitle').textContent });

      const a = await open({ scope: place1 });
      let s = shown(a);
      ok(s.main && s.frames === 5 && /^5 frames of this match, /.test(s.sub) && /, 1 death$/.test(s.sub),
        'it shows that match\'s five frames and none of the next match\'s three', JSON.stringify(s));
      ok(s.at === 2 && s.pos === 'Death 1 of 1', 'in death review mode, on the match\'s first death', JSON.stringify(s));
      ok(!s.picker && s.whole, 'with no session picker, and "Whole session" in its place', JSON.stringify(s));
      const confirmed = a.bridge.invoked.filter((x) => x[0] === C.AILOG_CONFIRM);
      ok(confirmed.length === 1 && confirmed[0][1] === sid && same(confirmed[0][2], place1),
        'Riot\'s check is asked about this match\'s frames, not the session\'s', JSON.stringify(confirmed));
      // A question about the frame on screen names the match, because the index
      // counts its frames and not the session's.
      a.$('ask-input').value = 'Why did I die here?';
      a.fire(a.$('ask-form'), 'submit');
      await settle();
      const asked = a.bridge.invoked.filter((x) => x[0] === C.AILOG_ASK).map((x) => x[1]);
      ok(asked.length === 1 && asked[0].session === sid && same(asked[0].scope, place1) && asked[0].index === 2,
        'a question about the frame names the match it is counted in', JSON.stringify(asked));

      a.$('whole').click();
      await settle();
      s = shown(a);
      ok(s.frames === 10 && s.at === 4 && !s.whole && /frames from /.test(s.sub),
        '"Whole session" opens the whole session, on the frame that was on screen', JSON.stringify(s));
      ok(s.picker, 'and the picker is back, since there is a session to pick again');
      ok(a.$('ask-log').textContent.includes('You peeked alone.'), 'with the frame\'s conversation still under it, keyed by the frame and not its place');

      // An open window is moved to another match by AILOG_SHOW.
      a.bridge.emit(C.AILOG_SHOW, { scope: place2 });
      await settle();
      s = shown(a);
      ok(s.frames === 3 && s.at === 0 && s.whole && !s.picker && /^3 frames of this match, /.test(s.sub),
        'moved to a match with no death, it opens on that match\'s first frame', JSON.stringify(s));

      // AT ONE MOMENT (8.2): the eye on a death a review looked at names when
      // its frame was captured, and the match opens on that frame rather than
      // on its first death.
      a.bridge.emit(C.AILOG_SHOW, { scope: place1, at: M1 + 70000 });
      await settle();
      s = shown(a);
      ok(s.frames === 5 && s.at === 1 && s.whole && s.pos === '1 death',
        'moved to a moment of a match, it opens on the frame captured then, its one death counted in words', JSON.stringify(s));
      const atMoment = await open({ scope: place1, at: M1 + 71500 });
      s = shown(atMoment);
      ok(s.main && s.frames === 5 && s.at === 1 && !s.picker && s.whole,
        'opened at a moment between two frames, it shows the nearer, in the match alone', JSON.stringify(s));
      atMoment.$('death-next').click();
      ok(shown(atMoment).at === 2 && shown(atMoment).pos === 'Death 1 of 1', 'and the death it led to is the next one on');
      const notATime = await open({ scope: place1, at: 'soon' });
      ok(shown(notATime).at === 2 && shown(notATime).pos === 'Death 1 of 1', 'a moment that is not a time opens on the first death, as before');

      // GONE, said plainly, and never another session's frames in their place.
      const GONE = /no longer has this match\. It keeps your last 5 recording sessions, and the review keeps the frames the coach looked at\.$/;
      ok(GONE.test('The AI log no longer has this match. It keeps your last 5 recording sessions, and the review keeps the frames the coach looked at.'),
        'the gone line detector matches the line');
      for (const [what, target] of [['main found no kept session', { scope: { gone: true } }],
        ['its session was pruned', { scope: { ...place1, session: 'session-2026-09-01T10-00-00-000Z' } }],
        ['its scope is not a match', { scope: { session: sid, match: 'x' } }],
        ['its hash cannot be read', '%7Bbroken']]) {
        const g = await open(target);
        const gs = shown(g);
        ok(!gs.main && GONE.test(gs.empty) && !gs.picker && !gs.whole, `${what}: it says the log keeps your last 5 sessions and the review its frames`,
          JSON.stringify(gs));
        ok(!DASHES.test(gs.empty), `${what}: with no dash`);
      }
      live = sid;
      sealed = true;
      const z = await open({ scope: place1 });
      const zs = shown(z);
      ok(!zs.main && /A match is being played, so this session's AI log stays closed until it ends\./.test(zs.empty) && !zs.picker && !zs.whole,
        'sealed mid match, it shows no frame and says when it opens', JSON.stringify(zs));
      sealed = false;
      live = null;
      // A session id in the hash still opens a whole session, as it always has.
      const w = await open('session-2026-09-30T10-00-00-000Z');
      ok(shown(w).frames === 2 && !shown(w).whole, 'a session id in the hash still opens that whole session');

      // WHOLE SESSION IS STRICT (8.2): the session the match was in, or the
      // reason it is not here, and never another session's frames under its
      // name. The session being recorded is the newest folder, as it is while
      // it is written, and its frames share their file names with the match's
      // own session's, since a name is a counter of each session's own.
      const SEALED = /^A match is being played, so this session's AI log stays closed until it ends\.$/;
      const GONE_PLAIN = /^The AI log no longer has this match\. It keeps only your most recent recording sessions, and the review keeps the frames the coach looked at\.$/;
      const GONE_PICKED = /^The AI log no longer has that session\. It keeps your last 5 recording sessions\.$/;
      ok(SEALED.test("A match is being played, so this session's AI log stays closed until it ends.")
        && GONE_PLAIN.test('The AI log no longer has this match. It keeps only your most recent recording sessions, and the review keeps the frames the coach looked at.')
        && GONE_PICKED.test('The AI log no longer has that session. It keeps your last 5 recording sessions.'),
      'the sealed and gone line detectors match their lines');
      const recording = 'session-2026-10-02T09-00-00-000Z';
      write(recording, Array.from({ length: 7 }, (_v, k) => [M2 + 3600000 + k * 10000, alive, M2 + 3600000]), M2 + 3700000);
      const optionIds = (a) => a.document.querySelectorAll('#session option').map((o) => o.value);

      // Mid match, on a match of a finished session: that session, and the
      // one being recorded in none of its lists.
      live = recording;
      sealed = true;
      const fin = await open({ scope: place1 });
      fin.$('whole').click();
      await settle();
      s = shown(fin);
      ok(s.main && s.frames === 10 && s.at === 4 && !s.whole, 'mid match, Whole session on a finished session shows it, on the frame that was on screen', JSON.stringify(s));
      ok(same(optionIds(fin), [sid, 'session-2026-09-30T10-00-00-000Z']), 'and its picker lists no session being recorded', JSON.stringify(optionIds(fin)));
      sealed = false;

      // Between matches the eye opens a match of the session being recorded,
      // and then the next match begins: main answers Whole session with the
      // newest finished session, marked sealed, which is not this one.
      live = sid;
      const rec = await open({ scope: place1 });
      ok(shown(rec).main && shown(rec).whole, 'between matches the eye opens a match of the session being recorded');
      sealed = true;
      rec.$('whole').click();
      await settle();
      s = shown(rec);
      ok(!s.main && SEALED.test(s.empty) && !s.picker && !s.whole,
        'pressed once the next match began, Whole session shows no frame, of its session or of the one main answers with, and says when it opens', JSON.stringify(s));
      sealed = false;
      live = null;

      // A reply that is another session, as main once served the newest folder
      // for a session pruned while the window was open: the gone line, never
      // that session's frames, nor its frame of the same file name.
      unscoped = () => aiLogStore.read(root, recording);
      const other = await open({ scope: place1 });
      other.$('whole').click();
      await settle();
      s = shown(other);
      ok(!s.main && GONE_PLAIN.test(s.empty) && !s.picker && !s.whole,
        'a reply that is another session paints the gone line, not that session at its frame of the same name', JSON.stringify(s));
      unscoped = null;

      // Its session pruned at a Start while the window was open: main has it
      // gone, and so does the window.
      const pruned = await open({ scope: place1 });
      fs.rmSync(dir, { recursive: true, force: true });
      pruned.$('whole').click();
      await settle();
      s = shown(pruned);
      ok(!s.main && GONE.test(s.empty) && !s.picker && !s.whole, 'its session pruned while the window was open, Whole session says the log no longer has it', JSON.stringify(s));

      // A session picked after it was pruned, since the picker was painted:
      // the reason, and the picker to choose again with nothing in it chosen.
      const pick = await open('session-2026-09-30T10-00-00-000Z');
      ok(shown(pick).main && same(optionIds(pick), [recording, 'session-2026-09-30T10-00-00-000Z']), 'a session is open, with the picker listing two');
      fs.rmSync(path.join(root, recording), { recursive: true, force: true });
      pick.$('session').value = recording;
      pick.fire(pick.$('session'), 'change');
      await settle();
      s = shown(pick);
      ok(!s.main && GONE_PICKED.test(s.empty) && s.picker && same(optionIds(pick), ['session-2026-09-30T10-00-00-000Z']) && pick.$('session').value === '',
        'a session picked after it was pruned says so, with the picker to choose again and none of it chosen', JSON.stringify({ ...s, options: optionIds(pick) }));
      ok(!DASHES.test(s.empty), 'with no dash');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await section('the activation screen:', () => {
    const REAL_TIME = /real[- ]?time/i;
    ok(REAL_TIME.test('Real-time Valorant AI coaching'), 'the real time detector matches the line it replaced');
    ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && DASHES.test(`a${String.fromCharCode(0x2013)}b`) && !DASHES.test('a-b'),
      'the dash detector matches both banned dashes and not a hyphen');
    const doc = new Document(fs.readFileSync(path.join(RENDERER, 'activation', 'index.html'), 'utf8'));
    const sub = (doc.querySelector('.logo .sub') || { textContent: '' }).textContent;
    ok(/post-match/i.test(sub) && ['Valorant', 'Marvel Rivals', 'League of Legends'].every((g) => sub.includes(g)),
      'it sells post-match coaching for all three games', `read "${sub}"`);
    ok(!REAL_TIME.test(sub) && !DASHES.test(sub), 'with no real time claim and no dash');
  });

  // MOVING BETWEEN PAGES (8.2). A page of the main window arms before it is
  // shown, says when that frame is painted, and comes in when main says so
  // (main-window.js, check:mainwindow carries it out on real views). Every
  // page loads embed.js and has the motion on its bridge.
  await section('moving between pages: a page arms, says it is ready, and comes in:', async () => {
    const { PAGES } = require('../src/shared/shell-nav');
    for (const p of PAGES) {
      const html = fs.readFileSync(path.join(RENDERER, p.surface, 'index.html'), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      const iEmbed = head.indexOf('src="../shared/embed.js"');
      ok(iEmbed !== -1 && iEmbed < head.indexOf('<link rel="stylesheet"'), `${p.id}: embed.js runs in <head>, before its first paint`);
      const b = loadPreload(p.preload.replace('-preload.js', ''), {});
      const heard = [];
      if (b.api && typeof b.api.onPage === 'function') b.api.onPage((m) => heard.push(m.phase));
      b.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
      if (b.api && typeof b.api.pageReady === 'function') b.api.pageReady(p.id);
      ok(same(heard, ['arm']) && same(b.sent, [[C.PAGE_READY, p.id]]),
        `${p.id}: its bridge hears PUSH_PAGE and says PAGE_READY by its id`, `heard ${heard} sent ${JSON.stringify(b.sent)}`);
    }

    const at = Date.UTC(2026, 9, 1, 20);
    const homeRows = [70, 82].map((score, i) => ({ id: `h${i}`, at: at - i * 3600000, title: 'Jett', map: 'Abyss',
      result: 'Victory', score: '13-11', grade: { score, letter: grade.letter(score) } }));
    const homeHandlers = {
      [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
      [C.REVIEWS_LIST]: () => homeRows,
      [C.PATTERNS_GET]: () => ({ matches: 2, enough: true, mistakes: [], strengths: [], missed: [],
        grades: homeRows.map((r) => ({ id: r.id, at: r.at, score: r.grade.score, letter: r.grade.letter })), average: 76, categories: [] }),
      [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', grade: { score: 70, letter: 'B', categories: [] } }),
    };
    const h = loadSurface('home', { handlers: homeHandlers, window: { location: { hash: '', search: '?embed=1&page=home' } } });
    const root = h.document.documentElement;
    const readies = () => h.bridge.sent.filter((s) => s[0] === C.PAGE_READY);
    const arrived = () => h.document.querySelectorAll('.home .card.card-in');
    ok(root.classList.contains('embedded') && root.classList.contains('page-armed'), 'loaded as a page, it is armed before anything is painted');
    await settle();
    ok(!readies().length, 'and says nothing until two frames have painted that');
    ok(!arrived().length, 'its cards, painted while it is armed, wait to arrive');
    h.clock.flushFrames();
    ok(same(readies(), [[C.PAGE_READY, 'home']]), 'two frames on, it says it is ready, by its own id', JSON.stringify(readies()));
    h.bridge.emit(C.PUSH_PAGE, { phase: 'enter', dir: 'forward' });
    ok(!root.classList.contains('page-armed') && root.dataset.pageDir === 'forward',
      'told to come in from the right, it takes that side first, then comes in');
    const cards = arrived();
    ok(cards.length >= 3 && same(cards.map((c) => c.style.getPropertyValue('--i')), cards.map((_c, i) => String(i))),
      'and its cards arrive one after another as it does', `${cards.length} cards`);
    h.bridge.emit(C.PUSH_PAGE, { phase: 'leave' });
    ok(root.classList.contains('page-leaving'), 'told another page is coming, it fades');
    h.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'back' });
    ok(root.classList.contains('page-armed') && !root.classList.contains('page-leaving') && root.dataset.pageDir === 'back',
      'armed again, it is invisible on the side it comes back from');
    h.clock.flushFrames();
    ok(readies().length === 2, 'and answers that arm once');
    h.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
    h.bridge.emit(C.PUSH_PAGE, { phase: 'enter', dir: 'forward' });
    h.clock.flushFrames();
    ok(readies().length === 2 && !root.classList.contains('page-armed'), 'an arm answered by an enter before its frames is not answered after');
    // A review saved meanwhile repaints Home; its cards do not arrive again.
    for (const c of arrived()) c.classList.remove('card-in');
    h.bridge.emit(C.PUSH_REVIEWS, { id: 'h0', game: 'valorant' });
    await settle();
    ok(!arrived().length, 'a review saved while it is open repaints it without the cards arriving again');
    h.bridge.emit(C.PUSH_GAME, { id: 'rivals', label: 'Marvel Rivals' });
    await settle();
    ok(arrived().length >= 3, 'a change of game brings them in again');

    // A window of its own (no ?embed): never armed, and what waits for it to
    // be on screen runs at once.
    const own = loadSurface('home', { handlers: homeHandlers });
    await settle();
    ok(!own.document.documentElement.classList.contains('page-armed') && own.document.querySelectorAll('.home .card.card-in').length >= 3
      && !own.bridge.sent.some((s) => s[0] === C.PAGE_READY), 'a surface that is not a page is never armed, and never says ready');

    // The CSS it moves by: armed at once, never animated into, and never for
    // good; coming in on the tokens.
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(/clip:/.test(rule(ui, '.sr-only')) && prop(rule(ui, '.sr-only'), 'position') === 'absolute', 'the rule and property readers find a known rule');
    const armedCss = rule(ui, 'html.page-armed body');
    ok(prop(armedCss, 'opacity') === '0' && prop(armedCss, 'transition') === 'none'
      && prop(armedCss, 'transform') === 'translateX(var(--page-from, 0px))', 'armed: invisible, offset, and with no transition into it', armedCss.trim());
    ok(prop(armedCss, 'animation') === 'page-disarm 0s linear 1.2s forwards' && ui.includes('@keyframes page-disarm { to { opacity: 1; transform: none; } }'),
      'and let in by itself after 1.2 seconds if main never answers');
    ok(prop(rule(ui, 'html.page-armed[data-page-dir="forward"]'), '--page-from') === '12px'
      && prop(rule(ui, 'html.page-armed[data-page-dir="back"]'), '--page-from') === '-12px', 'forward from 12px right, back from 12px left');
    ok(prop(rule(ui, 'html.embedded body'), 'transition') === 'opacity var(--t-med) var(--ease-expo), transform var(--t-med) var(--ease-expo)',
      'coming in is --t-med on --ease-expo, opacity and transform only');
    ok(prop(rule(ui, 'html.page-leaving body'), 'transition') === 'opacity var(--t-fast) var(--ease)', 'leaving fades on --t-fast');
    const CUT = /@media \(prefers-reduced-motion: reduce\) \{\s*html\.page-armed body,\s*html\.page-leaving body \{ opacity: 1; transform: none; \}/;
    ok(CUT.test('@media (prefers-reduced-motion: reduce) {\n  html.page-armed body,\n  html.page-leaving body { opacity: 1; transform: none; }'),
      'the reduced motion reader matches the rule it looks for');
    ok(CUT.test(ui), 'asked for less motion, a page is painted as it is, armed or leaving: a plain cut with no blank frame');
    ok(prop(rule(ui, 'html.embedded .sheet'), 'animation') === 'none', 'and a surface\'s own card entrance does not play on top of it');
  });

  await section('everything that opens, opens and closes in motion:', async () => {
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const read = (rel) => fs.readFileSync(path.join(RENDERER, rel), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule(ui, '.reveal'), 'grid-template-rows') === '0fr' && prop(rule(ui, '.reveal.open'), 'grid-template-rows') === '1fr'
      && prop(rule(ui, '.reveal'), 'transition') === 'grid-template-rows var(--t-med) var(--ease-expo)'
      && prop(rule(ui, '.reveal > .reveal-clip'), 'overflow') === 'hidden',
    'opening in place is one grid row from 0fr to 1fr on --t-med, its clip hiding the rest');

    // The sidebar's marker: one element, moved to the current page.
    const shellCss = read('shell/shell.css');
    ok(!/background/.test(rule(shellCss, '.nav-item[aria-current="page"]')) && rule(shellCss, '.nav-item[aria-current="page"]').includes('color'),
      'the current item paints no background of its own');
    ok(prop(rule(shellCss, '.nav-marker'), 'transition').startsWith('transform var(--t-med) var(--ease-expo)'), 'the marker slides on --t-med');
    const p = await openShell({ language: 'en' }, {});
    const marker = p.$('nav-marker');
    ok(p.document.querySelectorAll('.nav-marker').length === 1 && marker.getAttribute('aria-hidden') === 'true', 'one marker for the whole sidebar');
    // Layout, which the fake DOM does not do: each item where the sidebar has it.
    const items = p.document.querySelectorAll('.nav-item');
    items.forEach((b, i) => Object.assign(b, { offsetTop: 120 + i * 46, offsetLeft: 12, offsetWidth: 208, offsetHeight: 44 }));
    p.$('nav-settings').offsetTop = 690;
    const top = (id) => p.document.querySelector(`.nav-item[data-page="${id}"]`).offsetTop;
    p.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: 'matches', sealed: false });
    ok(marker.classList.contains('on') && marker.style.transform === `translate(12px, ${top('matches')}px)` && marker.style.height === '44px',
      'it sits on the current page', marker.style.transform);
    p.bridge.emit(C.PUSH_SHELL, { page: 'stats', shown: 'stats', sealed: false });
    ok(marker.style.transform === `translate(12px, ${top('stats')}px)` && !marker.classList.contains('still'), 'going to another page it slides there');
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: 'settings', sealed: false });
    ok(marker.style.transform === 'translate(12px, 690px)', 'down to Settings at the foot as well');
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: null, sealed: true });
    ok(!marker.classList.contains('on'), 'sealed, no page is current and it fades out');
    p.bridge.emit(C.PUSH_SHELL, { page: 'review', shown: 'review', sealed: false });
    ok(marker.classList.contains('on') && marker.classList.contains('still') && marker.style.transform === `translate(12px, ${top('matches')}px)`,
      'unsealed on the review, it appears on Matches, put there rather than slid');
    // THE RECORD CARD CHANGES HEIGHT on its own, and with the sidebar
    // overflowing (the window's minimum height) Settings, below it, moves
    // with it. Layout again: Settings under a card as tall as what it shows.
    const settingsAt = () => 520 + (p.$('agent-bubble').hidden ? 0 : 48 + (p.$('ab-quick').hidden ? 0 : 36))
      + Math.ceil(p.line().length / 30) * 18;
    Object.defineProperty(p.$('nav-settings'), 'offsetTop', { get: settingsAt, configurable: true });
    const onSettings = () => marker.style.transform === `translate(12px, ${settingsAt()}px)`;
    const where = () => `marker ${marker.style.transform}, Settings at ${settingsAt()}`;
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: 'settings', sealed: false });
    ok(onSettings(), 'on Settings, the marker is on it', where());
    const blocked = 'Capture is blocked: Windows will not let Occlara read the screen. Set the game to Windowed Fullscreen and press Start again.';
    const before = settingsAt();
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: { text: blocked, at: 1 } });
    ok(p.line() === blocked && settingsAt() !== before && onSettings(),
      'a notice makes the card taller, and the marker, measured once the line is written, follows Settings down', where());
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: null });
    ok(settingsAt() === before && onSettings(), 'and back up when it clears', where());
    // Recording Valorant: the agent check opens in the card with the player's
    // mains, is answered, and closes itself 1.6 seconds later, and nothing but
    // the card's own size says so.
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching', topAgents: ['Jett', 'Omen', 'Sova'] });
    ok(!p.$('agent-bubble').hidden && !p.$('ab-quick').hidden && onSettings(), 'the agent check up with its quick picks, the marker is on Settings', where());
    p.bridge.emit(C.PUSH_AGENT, { agent: 'Jett', confirmed: true });
    p.resized(p.$('rec'));
    ok(p.$('ab-quick').hidden && onSettings(), 'the agent locked in and the picks gone, the card is shorter and the marker follows Settings up', where());
    p.clock.advance(1600);
    p.resized(p.$('rec'));
    ok(p.$('agent-bubble').hidden && onSettings(), 'and again once the check has closed itself', where());
    ok(prop(rule(shellCss, '.sealed'), 'animation') === 'riseIn var(--t-slow) var(--ease-expo) both'
      && prop(rule(shellCss, '.agent-bubble'), 'animation') === 'riseIn var(--t-med) var(--ease-expo) both',
    'the Recording screen and the agent bubble rise in as they appear');

    // A dropdown closes as it opened.
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.2.0', state: 'current' }),
      },
    });
    await settle();
    const mount = se.$('gamepick');
    const ddBtn = mount.querySelector('.dd-btn');
    const list = mount.querySelector('.dd-list');
    ddBtn.click();
    ok(!list.hidden && list.parentNode === se.document.body && ddBtn.getAttribute('aria-expanded') === 'true', 'open, the list hangs off body');
    ddBtn.click();
    ok(!list.hidden && list.classList.contains('dd-closing') && ddBtn.getAttribute('aria-expanded') === 'false' && !mount.classList.contains('dd-open'),
      'closed, it is closed to everything but the eye, and fades on screen');
    se.clock.advance(139);
    ok(!list.hidden, 'for --t-fast');
    se.clock.advance(1);
    ok(list.hidden && !list.classList.contains('dd-closing') && list.parentNode === mount, 'then it is hidden, back in its place');
    ddBtn.click();
    ddBtn.click();
    ddBtn.click();
    se.clock.advance(300);
    ok(!list.hidden && !list.classList.contains('dd-closing') && ddBtn.getAttribute('aria-expanded') === 'true',
      'opened again while it closed, it is open, and the close it cut short never hides it');
    const ddCss = read('shared/dropdown.css');
    ok(prop(rule(ddCss, '.dd-list.dd-closing'), 'animation') === 'ddOut var(--t-fast) var(--ease) both'
      && prop(rule(ddCss, '.dd-list.dd-closing'), 'pointer-events') === 'none', 'closing plays ddOut on --t-fast and takes no click');

    // Stats' rank notes open under the tile by height, and close back.
    const session = { id: 'st1', at: Date.UTC(2026, 9, 1, 20), map: 'Abyss', title: 'Jett', grade: { score: 82, letter: grade.letter(82) } };
    const st = loadSurface('stats', {
      handlers: {
        [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {},
          rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
          sessions: [session], sessionCount: 1, matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
        [C.STATS_MATCHES]: () => ({ matches: [] }),
        [C.STATS_RANK_HISTORY]: () => ({ points: [] }),
      },
    });
    await settle();
    st.clock.flushFrames();
    const tile = st.document.querySelectorAll('#cards .card').find((c) => /^Rank/.test(c.querySelector('.label').textContent));
    const reveal = st.$('rank-reveal');
    ok(reveal.hidden && reveal.classList.contains('reveal') && st.$('rank-notes').parentNode.classList.contains('reveal-clip'),
      'closed, the notes are nothing at all, inside a reveal');
    tile.click();
    await settle();
    ok(!reveal.hidden && reveal.classList.contains('open') && tile.classList.contains('notes-open')
      && /About Gold/.test(st.$('rank-notes').textContent), 'the rank tile opens its notes by height, its chevron turned over');
    tile.click();
    ok(!reveal.hidden && !reveal.classList.contains('open') && !tile.classList.contains('notes-open'), 'and closes them back in place');
    st.clock.advance(220);
    ok(reveal.hidden, 'hidden once closed');
    tile.click();
    tile.click();
    tile.click();
    st.clock.advance(400);
    ok(!reveal.hidden && reveal.classList.contains('open'), 'opened again while closing, it stays open');
    // A graded match's drop down opens the same way, under its own top line.
    const srow = st.document.querySelector('#session-list .row.session');
    const sReveal = srow && srow.children[1];
    ok(sReveal && sReveal.classList.contains('reveal') && sReveal.querySelector('.reveal-clip > .detail .ask-btn'),
      'a graded match\'s drop down is a reveal under its top line, its buttons inside the clip');
    srow.click();
    ok(srow.classList.contains('open'), 'and a click opens it');
    const scss = read('stats/stats.css');
    ok(prop(rule(scss, '.expandable.open > .reveal'), 'grid-template-rows') === '1fr'
      && !/display:\s*none/.test(rule(scss, '.expandable .detail'))
      && prop(rule(scss, '.expandable > .reveal > .reveal-clip'), 'visibility') === 'hidden'
      && prop(rule(scss, '.expandable > .reveal > .reveal-clip'), 'transition') === 'visibility 0s linear var(--t-med)'
      && prop(rule(scss, '.expandable.open > .reveal > .reveal-clip'), 'visibility') === 'visible',
    'by height on its row\'s open, and closed it is out of reach once the close is through');
    ok(/display:\s*none/.test('a { display: none; }'), 'the display none detector matches a hidden rule');

    // A breakdown row opens in place: no table built again.
    const breakdown = require('../src/shared/breakdown');
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const bAt = Date.UTC(2026, 9, 1, 20);
    const saved = ['Abyss', 'Abyss', 'Bind', 'Lotus'].map((map, i) => ({ id: `valorant-${bAt - i * 3600000}-mot${i}`, game: 'valorant',
      at: bAt - i * 3600000, review: { kind: 'valorant', source: 'watched', rounds: [], insights: {}, grade: graded,
        game: { map, agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' },
        scoreline: { acs: 250, adr: 160, headshotPct: 22, kills: 20, deaths: 15, assists: 5 } } }));
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }), [C.REVIEWS_LIST]: () => [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved, opts),
      },
    });
    await settle();
    const table = m.$('b-table');
    const rowsBefore = table.querySelectorAll('.b-row');
    const holders = () => table.children.filter((x) => x.classList.contains('b-detail-row'));
    ok(rowsBefore.length === 3, 'three maps, three rows', `${rowsBefore.length}`);
    rowsBefore[0].click();
    const rowsAfter = table.querySelectorAll('.b-row');
    ok(rowsAfter.length === rowsBefore.length && rowsAfter.every((r, i) => r === rowsBefore[i]),
      'opening a row builds nothing again: the same rows, in the same table');
    const first = holders()[0];
    ok(first && first.classList.contains('reveal') && first.classList.contains('open')
      && table.children.indexOf(first) === table.children.indexOf(rowsBefore[0]) + 1
      && rowsBefore[0].getAttribute('aria-expanded') === 'true', 'its detail is put right after it and opens by height');
    const clip = first && first.querySelector('.reveal-clip');
    ok(clip && clip.getAttribute('role') === 'cell' && clip.querySelector('.b-detail .b-dt'), 'the cell is the clip, the box inside it');
    rowsBefore[1].click();
    ok(!first.classList.contains('open') && first.parentNode === table && rowsBefore[0].getAttribute('aria-expanded') === 'false'
      && holders().length === 2 && holders()[1].classList.contains('open'), 'opening another closes the first in place while the second opens');
    m.clock.advance(220);
    ok(!first.parentNode && holders().length === 1, 'and the first is taken out once it has closed');
    rowsBefore[1].click();
    ok(!holders()[0].classList.contains('open') && rowsBefore[1].getAttribute('aria-expanded') === 'false', 'the open row clicked again closes');
    m.clock.advance(220);
    ok(!holders().length, 'and leaves nothing behind');

    // The review's frame zoom scales from where the frame was to where it is.
    const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({
      id: 'valorant-1759341600000-zoom01', kind: 'valorant', source: 'watched', aiLog: null,
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      rounds: [{ n: 2, side: 'Defence', result: 'lost', died: true, facts: ['Died at A Site'], reads: [], why: null,
        forensics: { cause: 'dry-peek', what: 'You swung wide.', better: 'Wait.', frames: ['b.jpg', 'a.jpg'], source: 'riot' } }],
      frameData: { 'b.jpg': 'data:image/jpeg;base64,AAAb', 'a.jpg': 'data:image/jpeg;base64,AAAa' },
    }) } });
    await settle();
    const strip = v.document.querySelector('#v-looks .v-shots');
    const [i0, i1] = strip.querySelectorAll('.v-shot img');
    const f0 = i0.parentNode;
    const box = (left, topPx, width) => ({ left, top: topPx, width, height: width * 9 / 16, x: left, y: topPx, right: left + width, bottom: topPx + width * 9 / 16 });
    i0.getBoundingClientRect = () => (f0.classList.contains('zoom') ? box(0, 0, 810) : box(0, 0, 400));
    i1.getBoundingClientRect = () => (f0.classList.contains('zoom') ? box(0, 470, 400) : box(410, 0, 400));
    let atReflow = null;
    Object.defineProperty(strip, 'offsetWidth', { configurable: true,
      get() { atReflow = [i0, i1].map((i) => `${i.style.transform}|${i.style.transition}`); return 810; } });
    i0.click();
    ok(f0.classList.contains('zoom') && atReflow && atReflow[0].startsWith('translate(0px, 0px) scale(0.49') && atReflow[0].endsWith('|none')
      && atReflow[1] === 'translate(410px, -470px) scale(1)|none', 'zooming, each frame is drawn back where it was first', JSON.stringify(atReflow));
    ok([i0, i1].every((i) => i.style.transform === '' && i.style.transition === ''), 'and then let go, so the transition carries it to its place');
    i0.click();
    ok(!f0.classList.contains('zoom') && atReflow[0].startsWith('translate(0px, 0px) scale(2.02'), 'and back out, scaled down from the zoom');
    const rcss = read('review/review.css');
    ok(prop(rule(rcss, '.v-shot img'), 'transition') === 'transform var(--t-med) var(--ease-expo)'
      && prop(rule(rcss, '.v-shot img'), 'transform-origin') === '0 0', 'on --t-med, from its top left corner');

    // The AI log and the weekly report ease in as their windows open.
    ok(prop(rule(read('ailog/ailog.css'), 'body'), 'animation') === 'sheetIn var(--t-slow) var(--ease-expo) both'
      && read('weekly/weekly.css').includes('.sheet { animation: sheetIn var(--t-slow) var(--ease-expo) both; }')
      && ui.includes('@keyframes sheetIn {'), 'the AI log and the weekly report ease in on --t-slow');
  });

  // getConfig everywhere initI18n runs, or it cannot read the language at all.
  // onState wherever the surface can be open while Settings saves a language,
  // or it never hears about the change. Onboarding is the one exception: it is
  // the first run tour, it sets the language itself and re-runs initI18n after
  // saving it, and nothing else can change the language while it is open.
  await section('every surface that translates itself can read the language:', async () => {
    const CALLS = /\binitI18n\(/;
    const SETS_ITS_OWN = new Set(['onboarding']);
    ok(CALLS.test('window.initI18n(use).then(use)'), 'the detector matches a real call');
    let seen = 0;
    for (const dir of fs.readdirSync(RENDERER, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === 'shared') continue;
      const folder = path.join(RENDERER, dir.name);
      const calls = fs.readdirSync(folder).filter((f) => f.endsWith('.js'))
        .some((f) => CALLS.test(fs.readFileSync(path.join(folder, f), 'utf8')));
      if (!calls) continue;
      seen++;
      const b = loadPreload(dir.name, { [C.CONFIG_GET]: () => ({ language: 'de' }) });
      let channel = null;
      if (b.api && typeof b.api.getConfig === 'function') {
        await b.api.getConfig();
        channel = (b.invoked[b.invoked.length - 1] || [])[0];
      }
      ok(channel === C.CONFIG_GET, `${dir.name}: getConfig on its bridge, over CONFIG_GET`);
      if (!SETS_ITS_OWN.has(dir.name)) {
        ok(b.api && typeof b.api.onState === 'function', `${dir.name}: onState on its bridge, so a change in Settings reaches it`);
      }
    }
    ok(seen >= 3, `found the surfaces that translate themselves (${seen})`);
  });

  console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: every surface does the right thing with what arrives');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL  the test itself threw: ${e.stack || e}`);
  process.exit(1);
});
