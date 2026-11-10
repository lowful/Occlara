'use strict';

/**
 * A START THAT NEVER REACHES A GAME IS CANCELLED, booted for real: the real
 * index.js, the reader a stand in that says what the real one says
 * (sawGame, inLobby, lastLobbyAt, the ledger), the process probe a stand in,
 * and the watch's thresholds shortened (its rules at their boundaries are
 * test:nogame's, on a fake clock).
 *
 * 1. Start with neither Riot's client nor Valorant running: cancelled. The
 *    recording stopped and discarded (stopSession({ discard: true })), the
 *    session's AI log folder gone, no review in the library, nothing claimed
 *    or released, the window not sealed, Ready again (not recording), and
 *    the notice line says the calm line.
 * 2. Start again at once: it records. The game open in its menus (queueing,
 *    a LOBBY read every moment): not cancelled under the menus threshold,
 *    cancelled at it.
 * 3. A game seen (a reply that was not LOBBY, a round in the ledger), then
 *    the game closed for longer than either threshold: never cancelled, the
 *    seal holds, no notice. A match always wins.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:nogame
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-no-game-check.json');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_NO_GAME_OUT: OUT });
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary run as plain node.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: a Start that never reaches a game is cancelled with nothing kept, claimed or reviewed, Start works again at once, a queue under the threshold is left alone, and a match always wins');
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const surfaces = require('./fixtures/surfaces');
const C = require(path.join(REPO, 'src/shared/channels'));
const NG = require(path.join(REPO, 'src/main/services/no-game-watch'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_NO_GAME_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

// ── Stand-ins ────────────────────────────────────────────────────────────────
const engines = [];
class StandInValorant extends EventEmitter {
  constructor() {
    super();
    this.endWatch = { ended: false };
    this.rounds = 0;
    this.ledger = { size: () => this.rounds, list: () => Array.from({ length: this.rounds }, (_, i) => ({ n: i + 1 })) };
    this.inLobby = false;
    this.sawGame = false;
    this.lastLobbyAt = 0;
    this.stopped = false;
    engines.push(this);
  }
  start() { this.emit('status', 'coaching'); }
  stop() { this.stopped = true; this.emit('status', 'stopped'); }
  pause() {}
  resume() {}
}
class StandInLeague extends EventEmitter { constructor() { super(); this.live = false; } start() {} stop() {} }
const StandInTray = { create() { return {}; }, update() {}, destroy() {} };

const PROCESS_MS = 600;
const MENUS_MS = 2500;
const probe = { state: 'none' };
function standInWatch(real) {
  return {
    ...real,
    TICK_MS: 100,
    createNoGameWatch: (o) => real.createNoGameWatch({ ...(o || {}), processMs: PROCESS_MS, menusMs: MENUS_MS }),
    probeValorant: async () => probe.state,
  };
}

const stops = [];
function standInRecorder(real) {
  class SpyRecorder extends real.Recorder {
    stopSession(o) { stops.push(o || null); return super.stopSession(o); }
  }
  return { ...real, Recorder: SpyRecorder };
}

const acct = { claims: 0, releases: 0 };
function standInAccount(real) {
  return {
    ...real,
    createAccountService(deps) {
      const svc = real.createAccountService(deps);
      return Object.assign(Object.create(svc), {
        signedIn: () => true,
        hasAuth: () => true,
        auth: () => ({ Authorization: 'Bearer occ_standin' }),
        me: async () => null,
        referral: async () => null,
        claim: async () => { acct.claims++; return { granted: true }; },
        release: async () => { acct.releases++; return { released: false }; },
        signIn: async () => ({ ok: true }),
        onRefused: () => () => {},
      });
    },
  };
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/lol-recorder') return { LolRecorder: StandInLeague };
    if (request === './tray') return StandInTray;
    if (request === './services/account-service') return standInAccount(realLoad(request, parent, isMain));
    if (request === './services/no-game-watch') return standInWatch(realLoad(request, parent, isMain));
    if (request === './services/recorder') return standInRecorder(realLoad(request, parent, isMain));
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile, signed in, no licence key ───────────────────────────
const ud = path.join(os.tmpdir(), 'occlara-check-no-game');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en', recordingMode: 'off',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;
const aiLogDirs = () => {
  try { return fs.readdirSync(path.join(ud, 'ai-log')).filter((n) => n.startsWith('session-')); } catch { return []; }
};

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

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

setTimeout(async () => {
  const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)({}, ...args);
  const send = (ch, ...args) => ipcMain.emit(ch, { sender: null }, ...args);
  const latest = () => engines[engines.length - 1];
  try {
    if (!await until(() => surfaces.find('/shell/'), 15000)) return report(false, 'the main window never loaded');

    /** Press Start; the reader is the newest stand in. */
    const start = async (label) => {
      const before = engines.length;
      send(C.COACH_START);
      const st = await invoke(C.STATE_GET);
      if (engines.length !== before + 1 || !st.isCoaching) return [null, `${label}: Start did not record`];
      return [latest(), null];
    };

    // 1. Neither Riot's client nor Valorant: cancelled, nothing kept.
    {
      const dirsBefore = aiLogDirs();
      probe.state = 'none';
      const [v, err] = await start('no game');
      if (err) return report(false, err);
      v.inLobby = true;   // the desktop reads as LOBBY
      v.lastLobbyAt = Date.now();
      const started = Date.now();
      const dirsDuring = aiLogDirs();
      const done = await until(async () => !(await invoke(C.STATE_GET)).isCoaching, 6000);
      const took = Date.now() - started;
      const st = await invoke(C.STATE_GET);
      const shell = await invoke(C.SHELL_GET);
      const rows = await invoke(C.REVIEWS_LIST, 'valorant');
      const notice = st.notice ? st.notice.text : '';
      const dirsAfter = aiLogDirs();
      lines.push(`no game: cancelled=${!!done} after ${took} ms (threshold ${PROCESS_MS}), engine stopped=${v.stopped}, notice="${notice}",`
        + ` recorder stops=${JSON.stringify(stops)}, AI log folders before/during/after=${dirsBefore.length}/${dirsDuring.length}/${dirsAfter.length},`
        + ` reviews=${rows.length}, claims=${acct.claims} releases=${acct.releases}, sealed=${shell.sealed}, status=${st.status}`);
      if (!done) return report(false, 'a Start with no game running was never cancelled');
      if (took < PROCESS_MS - 50) return report(false, `cancelled after ${took} ms, before the ${PROCESS_MS} ms threshold`);
      if (!v.stopped) return report(false, 'the reader was not stopped');
      if (notice !== NG.NOTICE) return report(false, `the notice line said "${notice}"`);
      if (!stops.length || !stops[stops.length - 1] || stops[stops.length - 1].discard !== true) return report(false, 'the recording was not stopped with discard');
      if (dirsDuring.length !== dirsBefore.length + 1) return report(false, 'Start made no AI log folder to discard');
      if (dirsAfter.length !== dirsBefore.length) return report(false, 'the empty session\'s AI log folder was kept');
      if (rows.length) return report(false, 'a review was built for a Start with no game');
      if (acct.claims || acct.releases) return report(false, 'a game was claimed or released for it');
      if (shell.sealed) return report(false, 'the window stayed sealed');
    }

    // 2. Start again at once; queueing in the menus.
    {
      probe.state = 'game';
      const [v, err] = await start('again');
      if (err) return report(false, `Start again at once: ${err}`);
      const st0 = await invoke(C.STATE_GET);
      lines.push(`Start again at once: recording=${st0.isCoaching} notice=${st0.notice ? `"${st0.notice.text}"` : 'none'}`);
      if (st0.notice && st0.notice.text === NG.NOTICE) return report(false, 'the notice stayed up over the new session');
      v.inLobby = true;
      const feed = setInterval(() => { v.lastLobbyAt = Date.now(); }, 50);
      v.lastLobbyAt = Date.now();
      const started = Date.now();
      await wait(MENUS_MS - 800);
      const mid = await invoke(C.STATE_GET);
      lines.push(`queueing ${Date.now() - started} ms with the game open (menus threshold ${MENUS_MS}): recording=${mid.isCoaching}`);
      if (!mid.isCoaching) { clearInterval(feed); return report(false, 'a player queueing under the menus threshold was cancelled'); }
      const done = await until(async () => !(await invoke(C.STATE_GET)).isCoaching, 5000);
      clearInterval(feed);
      const st = await invoke(C.STATE_GET);
      lines.push(`menus only: cancelled=${!!done} after ${Date.now() - started} ms, notice="${st.notice ? st.notice.text : ''}"`);
      if (!done) return report(false, 'the game open in its menus past the threshold was never cancelled');
      if (!st.notice || st.notice.text !== NG.NOTICE) return report(false, 'no notice after the menus cancel');
    }

    // 3. A game seen: never cancelled, whatever comes after.
    {
      probe.state = 'game';
      const [v, err] = await start('match');
      if (err) return report(false, err);
      v.inLobby = false;
      v.sawGame = true;
      v.rounds = 2;
      await wait(400);
      probe.state = 'none';
      v.inLobby = true;
      v.lastLobbyAt = Date.now();
      await wait(MENUS_MS + 1500);
      const st = await invoke(C.STATE_GET);
      lines.push(`a match seen, then the game gone for ${MENUS_MS + 1500} ms: recording=${st.isCoaching} notice=${st.notice ? `"${st.notice.text}"` : 'none'}`);
      if (!st.isCoaching) return report(false, 'a session that saw a match was cancelled');
      if (st.notice && st.notice.text === NG.NOTICE) return report(false, 'the no game notice was said over a match');
      // And mid match (the reader in a round right now), with the game "gone".
      v.inLobby = false;
      await wait(300);
      const shell = await invoke(C.SHELL_GET);
      lines.push(`mid match: sealed=${shell.sealed}`);
      if (!shell.sealed) return report(false, 'the seal did not follow the match');
      v.inLobby = true;
      v.rounds = 0;
      send(C.COACH_STOP);
      await wait(300);
    }
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack ? e.stack : e));
  }
}, 4000);

require(INDEX);
