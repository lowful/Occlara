'use strict';

/**
 * test:recordingview. START LANDS ON THE RECORDING SCREEN, AND THE LIVE
 * RATING'S SWITCH IS FOUND BEFORE A MATCH (9.1, the owner's item 14).
 *
 *   - Pressing Start takes the window to the Recording screen at once, in its
 *     waiting state ("Waiting for your match to start", since when, Stop),
 *     with no seal: no match is in progress, so the links stay open and any
 *     page opened takes its place (shell-nav.js createNav, main-window.js
 *     setRecordingView, index.js showRecordingView). The seal mid match is
 *     unchanged. test:shellnav holds the navigation; this holds the shell's
 *     screen and main's wiring, read as text.
 *   - The live rating's switch sits beside Start on Home as well as in
 *     Settings, past the same warning and confirm (Settings' words, word for
 *     word), main turning it on only for Home's own page (LIVE_RATING_SET,
 *     test:configset holds the gate). Never on the Recording screen.
 *
 * Pure node on the fake DOM, no window. Written with no backslash in it, so
 * no escape can be lost on the way into the file (CLAUDE.md, the regex trap).
 */
const fs = require('fs');
const path = require('path');
const { loadSurface, settle } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');

let checks = 0;
let fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}${detail ? ` (${detail})` : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Every run of white space as one space, the line ends included. */
const flat = (s) => s.split(String.fromCharCode(10)).map((l) => l.trim()).join(' ');
/** The text right inside the element with this id, up to its first tag. */
function textOf(html, id) {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return '';
  const open = html.indexOf('>', at);
  const close = html.indexOf('<', open);
  return html.slice(open + 1, close).trim();
}

const BASE = { gameId: 'valorant', isCoaching: false, isPaused: false, licenseActive: true, sounds: false, notice: null,
  live: { liveMap: true, liveAgent: true, liveScore: true, liveRound: true, liveRating: false, liveRatingStream: false } };

async function openShell(state, shell, live) {
  const p = loadSurface('shell', { handlers: {
    [C.STATE_GET]: () => ({ ...BASE, ...(state || {}) }),
    [C.CONFIG_GET]: () => ({ language: 'en', liveMap: true, liveAgent: true, liveScore: true, liveRound: true }),
    [C.SHELL_GET]: () => ({ page: 'home', shown: 'home', sealed: false, held: false, rec: false, maximized: false, ...(shell || {}) }),
    [C.LIVE_GET]: () => live || null,
  } });
  await settle();
  return p;
}
const shown = (p, id) => { let e = p.$(id); while (e) { if (e.hidden) return false; e = e.parentNode; } return true; };

(async () => {
  console.log('The Recording view: Start lands on the Recording screen, waiting');
  {
    const p = await openShell({ isCoaching: true }, { page: 'matches', shown: null, rec: true }, { state: 'waiting', startedAt: Date.now() - 60000 });
    const app = p.document.querySelector('.app');
    const links = [...p.document.querySelectorAll('#nav .nav-item')];
    ok(shown(p, 'sealed') && shown(p, 'live') && shown(p, 'live-wait') && !shown(p, 'live-main'),
      'the Recording screen in its waiting state, no facts yet');
    ok(p.$('live-wait').textContent.includes('Waiting for your match to start') && p.$('live-since').textContent.startsWith('since '),
      'it says it is waiting for the match, and since when it records');
    ok(shown(p, 'live-stop') && !shown(p, 'rec-back'), 'Stop on it, and no way back to it shown while it is up');
    ok(links.length === 4 && links.every((b) => !b.disabled && b.getAttribute('aria-current') !== 'page') && p.$('sealed-note').hidden,
      'no seal: every link open, none current, no lock note');
    ok(app.classList.contains('rec-view') && !app.classList.contains('is-sealed') && !app.classList.contains('sealed-live'),
      'the window says so as rec-view, not as sealed');
    ok(!shown(p, 'live-wait-lr'), 'the live rating off: no word of it');

    // The live rating on: one quiet line while waiting, never a control.
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, live: { ...BASE.live, liveRating: true } });
    ok(shown(p, 'live-wait-lr') && !p.$('live').querySelector('[role="switch"]'), 'the live rating on: a line says it shows here once the match starts, and nothing to switch');

    // Paused: the head says so.
    p.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    ok(p.document.querySelector('#live .live-word').textContent === 'Paused', 'paused, the head says Paused');
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(p.document.querySelector('#live .live-word').textContent === 'Recording', 'and Recording again on the resume');

    // The match seen: the seal, the same screen, its facts.
    p.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: null, sealed: true, held: false, rec: true });
    p.bridge.emit(C.PUSH_LIVE, { state: 'live', startedAt: Date.now() - 60000, mode: 'standard', map: 'Abyss', agent: 'Jett', team: 3, enemy: 2, tape: ['W', 'L', 'W', 'W', 'L'], round: 6,
      rating: { value: 6.6, shown: '66', tier: 'fair', last: { delta: '+3', up: true, down: false, label: 'Kill' }, line: [6, 6.3, 6.6] } });
    await settle();
    ok(shown(p, 'live-main') && !shown(p, 'live-wait') && links.every((b) => b.disabled) && !p.$('sealed-note').hidden,
      'the match seen: sealed, the links locked, the facts in place of the wait');
    ok(shown(p, 'live-rating') && p.$('lr-num').textContent === '66' && p.$('lr-label').textContent === 'Kill' && p.$('live').classList.contains('rated'),
      "and the live rating row with its number on the 100 scale and the engine's label, the column drawn in for it");
    ok(p.$('live-rating').classList.contains('t-fair') && p.$('lr-badge').classList.contains('t-fair'), "its tier on the row, for the glass tile's rim and the dot");

    // Over with no review asked for: the Recording view again.
    p.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: null, sealed: false, held: false, rec: true });
    p.bridge.emit(C.PUSH_LIVE, { state: 'waiting', startedAt: Date.now() - 60000 });
    await settle();
    ok(shown(p, 'live-wait') && !shown(p, 'live-rating') && links.every((b) => !b.disabled), 'the match over with no page asked for: waiting again, the links open, no rating left up');

    // A page opened: the bar's way back.
    p.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: 'matches', sealed: false, held: false, rec: false });
    ok(!shown(p, 'sealed') && shown(p, 'rec-back') && p.$('rec-back').textContent.includes('Recording'), 'a page open while recording: the screen goes, and the bar offers the way back');
    p.fire(p.$('rec-back'), 'click');
    ok(p.bridge.sent.some((m) => m[0] === C.SHELL_WINDOW && m[1] === 'recording'), 'which asks main for the Recording view');

    // Stopped: nothing of it left.
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE });
    ok(!shown(p, 'rec-back') && !shown(p, 'sealed'), 'stopped: no way back to a recording that is over, and no screen');
  }

  console.log('League: the quiet screen, with Stop, waiting or mid game');
  {
    const p = await openShell({ gameId: 'lol', isCoaching: true }, { page: 'home', shown: null, rec: true }, null);
    ok(shown(p, 'sealed-quiet') && !shown(p, 'live') && shown(p, 'quiet-stop'), 'the quiet moon and its line, and Stop');
    p.fire(p.$('quiet-stop'), 'click');
    ok(p.bridge.sent.some((m) => m[0] === C.COACH_STOP), 'Stop stops');
    p.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: null, sealed: true, held: false, rec: true });
    ok(shown(p, 'quiet-stop'), 'mid game too: the bar carries no Stop then, so the screen does');
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    p.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: null, sealed: true, held: true, rec: false });
    ok(!shown(p, 'quiet-stop'), 'held, the recording has stopped: no Stop');
  }

  console.log('Main, read as text');
  {
    const idx = flat(read('src/main/index.js'));
    ok(idx.split("setStatus('coaching'); syncSeal(); showRecordingView();").length === 3,
      'Start, Valorant or League, goes to the Recording view as it starts, the seal settled first');
    const stop = idx.indexOf("setStatus('stopped');");
    ok(stop > 0 && idx.slice(stop, stop + 300).includes('mainWindow.setRecordingView(false)'), 'Stop takes it away');
    ok(idx.includes("if (!matchInProgress() || !engineSawGame(engine)) return { state: 'waiting', startedAt: state.sessionStartedAt || null };"),
      'it waits, with no empty score, until the reader has seen a game');
    ok(idx.includes("else if (action === 'recording') showRecordingView();") && idx.includes('function showRecordingView() { if (!state.isCoaching) return;'),
      "the bar's way back, and only while recording");
    const mw = flat(read('src/main/windows/main-window.js'));
    ok(mw.includes('function setRecordingView(on) { if (!!nav.state().rec === !!on) return; nav.recording(!!on); apply(); }'),
      "the window takes the pages away for it, the way the seal does, without the seal's lock or protection");
  }

  console.log("Home: the live rating's switch beside Start, past the same warning and confirm");
  {
    const settings = read('src/renderer/settings/index.html');
    const home = read('src/renderer/home/index.html');
    ok(textOf(home, 'h-lr-confirm-body').length > 80 && textOf(home, 'h-lr-confirm-body') === textOf(settings, 'lr-warn')
      && textOf(home, 'h-lr-confirm-title') === textOf(settings, 'lr-confirm-title'),
      "Home's confirm says Settings' warning word for word, under Settings' confirm title");
    ok(textOf(home, 'h-lr-keep-off') === 'Keep it off' && textOf(home, 'h-lr-turn-on') === 'Turn it on'
      && home.indexOf('id="h-lr-keep-off"') < home.indexOf('id="h-lr-turn-on"'), 'and its two answers, Keep it off first');
    const hp = read('src/preload/home-preload.js');
    ok(hp.includes('setLiveRating: (on) => ipcRenderer.invoke(C.LIVE_RATING_SET, on === true)') && !hp.includes('CONFIG_SET'),
      "Home's bridge carries the switch alone, a boolean, and no config write");
    const ipc = read('src/main/ipc/register-ipc.js');
    ok(ipc.includes("if (!fromPage(_e, 'home')) return { ok: false"), "main turns it on only for Home's own page");
    const screen = read('src/renderer/shell/shell.js') + read('src/renderer/shell/index.html') + read('src/preload/shell-preload.js');
    ok(!screen.includes('setLiveRating') && !screen.includes('LIVE_RATING_SET') && !screen.includes('role="switch"') && !screen.includes('h-lr-'),
      'the Recording screen carries no switch for it and cannot set it');
    ok(!read('src/renderer/home/live-rating-switch.js').includes('innerHTML'), 'the switch sets its words as text');
  }
  {
    const open = async (game, liveRating) => {
      const h = loadSurface('home', { handlers: {
        [C.STATE_GET]: () => ({ ...BASE, gameId: game, live: { ...BASE.live, liveRating } }),
        [C.CONFIG_GET]: () => ({ language: 'en', recordingMode: 'auto', recordingRes: '1080' }),
        [C.REVIEWS_LIST]: () => [],
        [C.LIVE_RATING_SET]: (on) => ({ ok: true, on: on === true }),
      } });
      await settle();
      return h;
    };
    const writes = (h) => h.bridge.invoked.filter((c) => c[0] === C.LIVE_RATING_SET).map((c) => c[1]);
    const h = await open('valorant', false);
    const sw = h.$('h-lr-switch');
    ok(!h.$('h-lr').hidden && sw.getAttribute('aria-checked') === 'false' && h.$('h-lr-hint').textContent === 'Off' && h.$('h-lr-confirm').hidden,
      'Valorant: the switch beside Start, off by default, saying so');
    h.fire(sw, 'click');
    await settle();
    ok(!h.$('h-lr-confirm').hidden && writes(h).length === 0 && sw.getAttribute('aria-checked') === 'false', 'On asks first, and writes nothing');
    h.fire(h.$('h-lr-keep-off'), 'click');
    await settle();
    ok(h.$('h-lr-confirm').hidden && writes(h).length === 0 && sw.getAttribute('aria-checked') === 'false', 'Keep it off closes it, still off, nothing written');
    h.fire(sw, 'click');
    await settle();
    h.fire(h.$('h-lr-turn-on'), 'click');
    await settle();
    ok(h.$('h-lr-confirm').hidden && writes(h).join() === 'true' && sw.getAttribute('aria-checked') === 'true' && h.$('h-lr-hint').textContent === 'On',
      'Turn it on writes it once, and the switch says what main answered', writes(h).join());
    h.fire(sw, 'click');
    await settle();
    ok(h.$('h-lr-confirm').hidden && writes(h).join() === 'true,false' && sw.getAttribute('aria-checked') === 'false', 'Off asks nothing');
    h.bridge.emit(C.PUSH_STATE, { ...BASE, live: { ...BASE.live, liveRating: true } });
    ok(sw.getAttribute('aria-checked') === 'true', 'turned on in Settings, the switch follows main');
    const lol = await open('lol', false);
    ok(lol.$('h-lr').hidden, 'League: no switch, it has no live reader');
    const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
    const words = [read('src/renderer/home/live-rating-switch.js'), read('src/renderer/home/live-rating-switch.css'), home(), shellWords()];
    function home() { return read('src/renderer/home/index.html'); }
    function shellWords() { return read('src/renderer/shell/index.html') + read('src/renderer/shell/shell.js') + read('src/renderer/shell/shell.css'); }
    ok(words.every((w) => !DASH.test(w)), 'no dash in any of it');
  }

  console.log(`${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' recording view checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  FAIL the test threw: ' + ((e && e.stack) || e)); process.exit(1); });
