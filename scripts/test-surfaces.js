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
const { loadSurface, loadPreload, Document, settle } = require('./fixtures/fake-dom');
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

async function openPanel(cfg, state, opts) {
  const audio = fakeAudio();
  const p = loadSurface('panel', {
    handlers: { [C.STATE_GET]: () => ({ ...BASE, ...(state || {}) }), [C.CONFIG_GET]: () => ({ ...cfg }) },
    preload: opts && opts.preload,
    window: { AudioContext: audio.AudioContext },
  });
  // Every sound the panel asks for, while the real shared/sfx.js still plays it.
  p.sfx = [];
  p.audio = audio.stats;
  const sfx = p.window.occlaraSfx;
  if (sfx) {
    const real = sfx.play;
    sfx.play = (kind, volume) => { p.sfx.push(kind); return real(kind, volume); };
  }
  await settle();
  p.line = () => p.$('last-tip').querySelector('.lt-text').textContent;
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

  await section('the panel follows the language setting:', async () => {
    const de = await openPanel({ language: 'de' });
    ok(de.label() === I18N.t('de', 'panel.start') && de.label() === 'Starten', 'Start reads Starten in German', `read "${de.label()}"`);
    ok(de.$('status-text').textContent === I18N.t('de', 'panel.idle'), 'the status word is German too',
      `read "${de.$('status-text').textContent}"`);
    ok(de.line() === I18N.t('de', 'panel.noTips'), 'and so is the hint line');
    ok(de.$('stats').title === I18N.t('de', 'panel.stats'), 'and the tooltips the markup marks for translation');
    de.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(de.label() === 'Stoppen' && de.$('status-text').textContent === I18N.t('de', 'panel.coaching'),
      'recording, the button and the status are German');

    // The bug, reproduced: the same panel on the bridge as it was, without getConfig.
    const before = await openPanel({ language: 'de' }, null, {
      preload: (api) => { const bare = { ...api }; delete bare.getConfig; return bare; },
    });
    ok(before.label() === 'Start', 'without getConfig on the bridge it stays English, which is what players got');

    const en = await openPanel({ language: 'en' });
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
    const p = await openPanel({ language: 'en' });
    const notice = 'Your license has expired. Renew at occlara.app.';
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: { text: notice, at: 1 } });
    ok(p.line() === notice && p.$('last-tip').classList.contains('system'),
      'the notice main pushed is on the line, with the system dot', `read "${p.line()}"`);
    ok(p.$('toggle').disabled && p.$('status-text').textContent === 'Subscription ended', 'beside a locked Start');
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: null });
    ok(/Renew in Settings/.test(p.line()) && !/Press Start/.test(p.line()),
      'with no notice it still says to renew, never Press Start', `read "${p.line()}"`);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: true, notice: null });
    ok(p.line() === I18N.t('en', 'panel.noTips') && !p.$('last-tip').classList.contains('system') && !p.$('toggle').disabled,
      'renewed, the line is the Press Start hint again');
  });

  await section('the start and stop sounds, on real transitions only:', async () => {
    const p = await openPanel({ language: 'en' });
    ok(p.window.occlaraSfx && p.scripts.some((s) => /sfx\.js$/.test(s)), 'the panel loads shared/sfx.js');
    ok(!p.sfx.length, 'opening the panel plays nothing: its first state is what is already true');

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
    const r = await openPanel({ language: 'en' }, { gameId: 'rivals' });
    r.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(r.$('agent-bubble').hidden, 'a Rivals start never opens "Reading your agent", which nothing would answer');
    const l = await openPanel({ language: 'en' }, { gameId: 'lol' });
    l.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(l.$('agent-bubble').hidden, 'nor a League one');
    const v = await openPanel({ language: 'en' }, { gameId: 'valorant' });
    v.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(!v.$('agent-bubble').hidden && !v.$('ab-detect').hidden, 'a Valorant start still asks for the agent');
  });

  await section('the panel\'s last grade:', async () => {
    const p = await openPanel({ language: 'en' }, { lastGrade: { score: 58, letter: 'D', id: 'x' } });
    const letter = p.$('grade').querySelector('.g-letter');
    ok(letter && toneOf(letter) === toneFor(58) && letter.textContent === 'D' && /58/.test(p.$('grade').textContent),
      'the letter takes the shared colour, with the number beside it');
    ok(p.scripts.some((s) => /grade-view\.js$/.test(s)), 'from shared/grade-view.js rather than a copy');
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
