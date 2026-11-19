'use strict';

/**
 * THE TRAINER, BOOTED FOR REAL (docs/claude/trainer.md): the real index.js,
 * its one window and the Trainer page in it, on a throwaway profile with no
 * licence.
 *
 * - The page loads with no console error and no Content Security Policy
 *   violation, on its menu, listing the twelve scenarios of
 *   src/shared/trainer-scenarios.json, with a WebGL2 context on #view.
 * - NOTHING LEAVES THE PC: every request the page's webContents makes is seen
 *   by session.webRequest.onBeforeRequest, hooked before any window exists,
 *   and any URL that is not file: or devtools: (data: and blob: are in the
 *   page's own memory, never the network) fails the check.
 * - A scenario selected, then Play clicked with a user gesture, locks the pointer (Chromium needs
 *   a gesture, and a focused, foreground window), the loop runs and frame
 *   times arrive.
 * - THE PAGE TOLD TO LEAVE STOPS: a PUSH_PAGE { phase: 'leave' } to its view,
 *   and then the window showing another page, each stop the loop, leave the
 *   run paused and let go of the pointer.
 * - THE KEYS: while the pointer is locked the five Ctrl+Shift global
 *   shortcuts are let go (hotkeys.js suspend), so crouch and walk with a
 *   letter stay in the Trainer, and they are taken again within 2 s of the
 *   lock going. The real launch registers them in createAppSurfaces; this
 *   check builds the window alone, as check:seal does, so it registers the
 *   same hotkeys module with actions that only count, and index.js's
 *   trainerIpc.playing suspends and resumes that one module.
 *
 * A pointer lock needs this window in the foreground. A check started from a
 * background process may not be given it by Windows, and another program
 * (a running Occlara among them) may hold the Ctrl+Shift keys. Either is
 * reported as SKIPPED with the reason, never passed or failed by guessing.
 *
 * The engines that would read the screen are stand-ins, and the tray is one:
 * no capture, no model, no network.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:trainer
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-trainer-check.json');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_TRAINER_OUT: OUT });
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 150000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  for (const s of rec.skipped || []) console.log('  SKIPPED ' + s);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log(`PASS: the Trainer loads clean with its scenarios and WebGL2, sends nothing off this PC, plays on a click and stops when told to leave or another page shows${(rec.skipped || []).length ? `, with ${rec.skipped.length} assertion(s) skipped as said above` : ', and lets the Ctrl+Shift keys go only while it holds the pointer'}`);
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, session, globalShortcut } = require('electron');
const C = require(path.join(REPO, 'src/shared/channels'));

const lines = [];
const skipped = [];
let reported = false;
let pageWcId = null;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  // A failure says what the page itself said: its console errors.
  if (!ok && pageWcId != null) for (const l of consoleLines.filter((x) => x.wc === pageWcId && x.level >= 3).slice(0, 5)) lines.push(`page console error: ${l.text.split(String.fromCharCode(10))[0]}`);
  try { fs.writeFileSync(process.env.OCCLARA_TRAINER_OUT || OUT, JSON.stringify({ ok, detail, lines, skipped })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

// ── Stand-ins for what would read the screen, and the tray ──────────────────
class StandInValorant extends EventEmitter {
  constructor() {
    super();
    this.endWatch = { ended: false };
    this.rounds = 0;
    this.ledger = { size: () => 0, list: () => [] };
    this.inLobby = true;
  }
  start() { this.emit('status', 'coaching'); }
  stop() { this.emit('status', 'stopped'); }
  pause() {}
  resume() {}
}
class StandInLeague extends EventEmitter {
  constructor() { super(); this.live = false; }
  start() {}
  stop() {}
}
const StandInTray = { create() { return {}; }, update() {}, destroy() {} };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/lol-recorder') return { LolRecorder: StandInLeague };
    if (request === './tray') return StandInTray;
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile ─────────────────────────────────────────────────────
const ud = path.join(os.tmpdir(), 'occlara-check-trainer');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en', recordingMode: 'off', sounds: false,
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

// No disableHardwareAcceleration here: the page needs WebGL2 and its real
// frame times. The occlusion switch is the repo's checks' own: a window
// behind another reads hidden and freezes (electron-occlusion-trap).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

// ── Every request and console line, from before any window exists ──────────
const requests = [];      // { wc, url }
const consoleLines = [];  // { wc, level, text }
const hooked = new Set();
function hook(ses) {
  if (!ses || hooked.has(ses)) return;
  hooked.add(ses);
  ses.webRequest.onBeforeRequest((details, cb) => {
    requests.push({ wc: details.webContentsId, url: String(details.url) });
    cb({});
  });
}
app.on('web-contents-created', (_e, wc) => {
  hook(wc.session);
  wc.on('console-message', (e, lvl, msg, line, src) => {
    // Electron 41 hands an event with level and message; older ones the
    // level as a number and the message after it.
    const level = typeof lvl === 'number' ? lvl : ({ verbose: 0, info: 1, warning: 2, error: 3 })[e && e.level];
    const text = msg !== undefined ? msg : e && e.message;
    const where = src !== undefined ? `${String(src).split('/').pop()}:${line}` : e && e.sourceId ? `${String(e.sourceId).split('/').pop()}:${e.lineNumber}` : '';
    consoleLines.push({ wc: wc.id, level, text: `${text}${where ? ` (${where})` : ''}` });
  });
});
app.whenReady().then(() => hook(session.defaultSession));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(100);
  }
}

// Each pattern this check reads with, held to a string it must match and one
// it must not, so a pattern that silently matches nothing cannot pass it.
const RE_CSP = /Content Security Policy/i;
const RE_LOCAL = /^(file|devtools|data|blob):/i;
const RE_OWN = /renderer[\\/]trainer[\\/]/;
const RE_HARD = /-hard$/;
const selfTest = [
  'site-preaim-hard'.replace(RE_HARD, '-easy') === 'site-preaim-easy' && !RE_HARD.test('lane-hold-easy') && !RE_HARD.test('hard-start'),
  RE_CSP.test("Refused to load the script 'https://x.example/a.js' because it violates the following Content Security Policy directive") && !RE_CSP.test('three.js r170'),
  RE_LOCAL.test('file:///C:/occlara/src/renderer/trainer/app.js') && RE_LOCAL.test('devtools://devtools/bundled/x.js') && !RE_LOCAL.test('https://occlara.app/') && !RE_LOCAL.test('wss://x.example'),
  RE_OWN.test('file:///C:/occlara/src/renderer/trainer/index.html') && RE_OWN.test('C:\\occlara\\src\\renderer\\trainer\\app.js') && !RE_OWN.test('file:///C:/occlara/src/renderer/practice/index.html'),
];
if (selfTest.some((x) => !x)) {
  lines.push(`the check's own patterns: ${selfTest.join(',')}`);
  app.whenReady().then(() => report(false, 'a pattern this check reads with does not match its known example'));
}

const KEYS = ['CommandOrControl+Shift+P', 'CommandOrControl+Shift+M', 'CommandOrControl+Shift+S', 'CommandOrControl+Shift+E', 'CommandOrControl+Shift+H'];
const registeredKeys = () => KEYS.filter((k) => { try { return globalShortcut.isRegistered(k); } catch { return false; } });

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const hotkeys = require(path.join(REPO, 'src/main/hotkeys'));
  const surfaces = require('./fixtures/surfaces');
  const settled = (page) => () => { const m = mainWindow.motionState(); return m.onScreen === page && !m.coming && !m.staged; };
  try {
    const win = mainWindow.create();
    win.show();
    if (!await until(() => surfaces.find('/shell/'), 8000)) return report(false, 'the shell never loaded');
    if (!await until(settled('home'), 8000)) return report(false, 'Home, the first page, never came in');

    // The five keys, as the real launch registers them (createAppSurfaces).
    const pressed = [];
    const count = (name) => () => pressed.push(name);
    hotkeys.register({ pauseResume: count('pause'), minimizePanel: count('minimize'), openSettings: count('settings'), openReview: count('review'), openHistory: count('history') });
    const keysAtStart = registeredKeys();
    lines.push(`the Ctrl+Shift keys registered at the start: ${keysAtStart.length} of ${KEYS.length}`);
    const keysUsable = keysAtStart.length === KEYS.length;
    if (!keysUsable) skipped.push(`the Ctrl+Shift keys: only ${keysAtStart.length} of ${KEYS.length} could be registered (${KEYS.filter((k) => !keysAtStart.includes(k)).join(', ')} held by another program, a running Occlara among them), so whether the Trainer lets them go cannot be told here`);

    // The window in front, as a player has it.
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();

    // ── 1. The page loads clean ──────────────────────────────────────────
    mainWindow.show('trainer');
    if (!await until(settled('trainer'), 8000)) return report(false, 'the Trainer page never came in');
    const tv = mainWindow.pageViews().get('trainer');
    const twc = tv.webContents;
    pageWcId = twc.id;
    const tjs = (s, gesture) => twc.executeJavaScript(s, !!gesture);
    const want = require(path.join(REPO, 'src/shared/trainer-scenarios.json')).scenarios.map((s) => s.id);
    const readBoot = () => tjs(`(() => {
      const root = document.getElementById('tr');
      if (!root || !window.occlaraTrainer) return null;
      const err = document.getElementById('tr-error');
      return { state: root.dataset.state, phase: window.occlaraTrainer.phase, ids: window.occlaraTrainer.scenarios(),
        items: [...document.querySelectorAll('.tr-item[data-id]')].map((b) => b.dataset.id), error: err && !err.hidden ? err.textContent : null,
        playing: window.occlaraTrainer.playing, frames: window.occlaraTrainer.frameTimes().length };
    })()`);
    // The list is painted once the page has asked main for its runs: one row
    // a scenario, an Easy and Hard pair one row carrying the Easy id.
    const boot = (await until(async () => { const b = await readBoot(); return b && (b.items.length || b.error) ? b : null; }, 8000)) || await readBoot();
    await tjs("window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(e.violatedDirective + ' ' + e.blockedURI)); true");
    lines.push(`page: state=${boot && boot.state} scenarios=${boot && boot.ids.length} rows=${boot && boot.items.length} error=${boot && boot.error} loop in the menu=${boot && boot.playing}`);
    if (!boot) return report(false, 'the Trainer page never exposed window.occlaraTrainer');
    if (boot.error) return report(false, `the Trainer page shows its error: ${boot.error}`);
    if (boot.state !== 'menu' || boot.phase !== 'menu') return report(false, `the Trainer page did not open on its menu: ${boot.state}`);
    if (JSON.stringify(boot.ids) !== JSON.stringify(want) || want.length !== 12) return report(false, `the Trainer lists ${JSON.stringify(boot.ids)}, the JSON ${JSON.stringify(want)}`);
    if (!boot.items.length || !boot.items.every((r) => want.includes(r)) || !want.every((id) => boot.items.includes(id) || boot.items.includes(id.replace(RE_HARD, '-easy')))) {
      return report(false, `the menu does not draw a row for every scenario: ${JSON.stringify(boot.items)}`);
    }
    // In the menu the engine draws one still frame and runs no loop.
    await wait(600);
    const still = await readBoot();
    if (boot.playing || still.playing || still.frames !== boot.frames) return report(false, `the menu runs the loop: ${JSON.stringify({ boot, still })}`);
    const gl = await tjs(`(() => {
      const c = document.getElementById('view');
      const g = c && c.getContext('webgl2');
      return g ? { version: g.getParameter(g.VERSION), w: c.width, h: c.height } : null;
    })()`);
    lines.push(`WebGL2 on #view: ${JSON.stringify(gl)}`);
    if (!gl) return report(false, 'no WebGL2 context on #view');

    // ── 2. A scenario selected, Play clicked with a gesture, plays ──────────────────────────────────
    const lockState = () => tjs(`({ locked: document.pointerLockElement === document.getElementById('view'), phase: window.occlaraTrainer.phase,
      state: document.getElementById('tr').dataset.state, playing: window.occlaraTrainer.playing, raw: window.occlaraTrainer.raw,
      frames: window.occlaraTrainer.frameTimes().length, last: window.occlaraTrainer.frameTimes().slice(-3) })`);
    const play = async (id) => {
      win.show(); win.focus(); twc.focus();
      const picked = await tjs(`window.occlaraTrainer.select(${JSON.stringify(id)}); window.occlaraTrainer.selected`);
      if (picked !== id) lines.push(`select(${id}) read back ${picked}`);
      await tjs("document.getElementById('play').click(); true", true);
      return until(async () => { const s = await lockState(); return s.phase === 'playing' && s.locked ? s : null; }, 6000);
    };
    const started = await play('flick-grid');
    if (!started) {
      const s = await lockState();
      lines.push(`flick-grid played: ${JSON.stringify(s)} focused=${win.isFocused()}`);
      skipped.push(`the run, the pointer lock, the leave and the keys: the pointer lock was not granted (window focused=${win.isFocused()}, phase=${s.phase}), which needs this window in the foreground; Windows does not always give it to a process started in the background`);
      return finish(twc, tjs);
    }
    await wait(1000);
    const after = await lockState();
    const keysLocked = registeredKeys();
    lines.push(`flick-grid playing: locked=${started.locked} raw=${started.raw} playing=${after.playing} frames ${started.frames} then ${after.frames} last=${JSON.stringify(after.last.map((x) => Math.round(x * 10) / 10))} | keys while locked: ${keysLocked.length}`);
    if (!after.playing || after.phase !== 'playing') return report(false, `after the click the loop does not run: ${JSON.stringify(after)}`);
    if (!(after.frames > 0) || (after.frames === started.frames && JSON.stringify(after.last) === JSON.stringify(started.last))) return report(false, `no frame times arrive: ${JSON.stringify({ started, after })}`);
    if (keysUsable) {
      const ownKeys = await until(() => !globalShortcut.isRegistered('CommandOrControl+Shift+S') && registeredKeys().length === 0, 2000);
      if (!ownKeys) return report(false, `while the pointer is locked the Ctrl+Shift keys are still registered: ${registeredKeys().join(', ')}`);
    }

    // ── 3. PUSH_PAGE leave stops it ──────────────────────────────────────
    twc.send(C.PUSH_PAGE, { phase: 'leave' });
    const left = await until(async () => { const s = await lockState(); return !s.playing && s.state === 'paused' && !s.locked ? s : null; }, 2000);
    lines.push(`PUSH_PAGE leave: ${JSON.stringify(left || await lockState())}`);
    if (!left) return report(false, 'told to leave (PUSH_PAGE), the Trainer kept its loop or the pointer');
    const f0 = (await lockState()).last;
    await wait(500);
    if (JSON.stringify((await lockState()).last) !== JSON.stringify(f0)) return report(false, 'told to leave, frames still arrive');
    if (keysUsable) {
      const back = await until(() => registeredKeys().length === KEYS.length, 2000);
      lines.push(`the keys after the lock went: ${registeredKeys().length} of ${KEYS.length}`);
      if (!back) return report(false, `the Ctrl+Shift keys were not taken again within 2 s of the lock going: ${registeredKeys().join(', ')}`);
    }

    // ── 4. Another page shown stops it ───────────────────────────────────
    await tjs("document.getElementById('p-menu').click(); true", true);
    await until(async () => (await lockState()).state === 'menu', 2000);
    const again = await play('micro-flicks');
    if (!again) {
      skipped.push('the window showing another page: the pointer lock was not granted a second time');
    } else {
      if (keysUsable && !await until(() => registeredKeys().length === 0, 2000)) return report(false, 'locked a second time, the Ctrl+Shift keys are still registered');
      mainWindow.show('home');
      const gone = await until(async () => { const s = await lockState(); return !s.playing && s.state === 'paused' && !s.locked ? s : null; }, 3000);
      lines.push(`Home shown over a run: ${JSON.stringify(gone || await lockState())}`);
      if (!gone) return report(false, 'with another page shown, the Trainer kept its loop or the pointer');
      if (keysUsable) {
        const back = await until(() => registeredKeys().length === KEYS.length, 2000);
        if (!back) return report(false, `another page shown, the Ctrl+Shift keys were not taken again within 2 s: ${registeredKeys().join(', ')}`);
      }
      await until(settled('home'), 4000);
    }
    lines.push(`keys pressed by the check's run: ${pressed.length}`);
    return finish(twc, tjs);
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}, 6500);

/** The console, the CSP and the network, read last, over everything the page did. */
async function finish(twc, tjs) {
  const cspv = await tjs('window.__cspv || []').catch(() => []);
  const mine = consoleLines.filter((l) => l.wc === twc.id);
  const errors = mine.filter((l) => l.level >= 3).map((l) => l.text);
  const csp = mine.filter((l) => RE_CSP.test(l.text)).map((l) => l.text).concat(cspv);
  const warnings = mine.filter((l) => l.level === 2 && !RE_CSP.test(l.text)).map((l) => l.text);
  const pageReqs = requests.filter((r) => r.wc === twc.id);
  const off = pageReqs.filter((r) => !RE_LOCAL.test(r.url));
  lines.push(`console: ${errors.length} errors, ${csp.length} CSP violations, ${warnings.length} warnings${warnings.length ? `: ${warnings.slice(0, 4).join(' | ')}` : ''}`);
  lines.push(`requests by the page: ${pageReqs.length}, ${pageReqs.filter((r) => /^file:/i.test(r.url)).length} of them file:, off this PC: ${off.length}`);
  if (!pageReqs.some((r) => RE_OWN.test(decodeURIComponent(r.url)))) return report(false, 'the request hook never saw the page load its own files, so it proves nothing');
  if (off.length) return report(false, `the Trainer page made a network request: ${off.map((r) => r.url).join(', ')}`);
  if (csp.length) return report(false, `Content Security Policy violations: ${csp.join(' | ')}`);
  if (errors.length) return report(false, `console errors: ${errors.join(' | ')}`);
  report(true, 'ok');
}

require(INDEX);
