'use strict';

/**
 * The seal follows the match, booted for real (8.2): the real index.js, its
 * one window and its IPC, in the two places the seal did not follow it.
 *
 * ANY NEW RECORDING TAKES OVER A HELD SEAL. A stop in the middle of a Valorant
 * match holds the seal until the player opens a page (sealHeld in index.js).
 * Only the Valorant path of Start cleared it, so after a switch to League or
 * Marvel Rivals and a Start, every page asked for, and the review when the
 * game ended, stayed behind "Recording stopped" until a Stop. Here each game
 * is started over a held seal: the seal lifts, a page from the sidebar shows,
 * and the seal then follows that game's own match, on while one is played and
 * off once it is over.
 *
 * A REVIEW WITHDRAWN BECAUSE ITS MATCH RESUMED IS SEALED AT ONCE. The watch
 * ended a match too early, its review opened, and play carried on: the review
 * was taken back with a switch to Home that ran unsealed, the withdrawn review
 * (of the very match being played) kept over Home as it went, and Home then on
 * screen until the seal's next tick. Here the window is read in the same tick
 * as the resume: sealed, no page showing, Home remembered for the real end,
 * which opens the review of the whole match.
 *
 * The engines that would read the screen and call the server are stand-ins
 * that emit what the real ones emit, nothing more: no capture, no model, no
 * network, and no League client asked. The 1 second seal tick is not running
 * (the app's surfaces are never built here), so SHELL_GET, which settles the
 * seal as the tick does, stands in for it.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 *
 * Run: npm run check:seal
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-seal-check.json');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_SEAL_OUT: OUT });
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // run as plain node and the app dies with a misleading error.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: a held seal is taken over by a League or a Rivals recording, which the seal then follows, and a review withdrawn because its match resumed is sealed in the same tick, never switched to Home on screen');
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const { replay, load } = require('./fixtures/replay-match');
const surfaces = require('./fixtures/surfaces');
const C = require(path.join(REPO, 'src/shared/channels'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_SEAL_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

// ── The engines index.js starts, as stand-ins ───────────────────────────────
// Each has the fields matchInProgress() reads and the events index.js listens
// for, and the check moves them as the real engine would.
const engines = [];

/** The Valorant reader: in a menu, no round filed, until the check says otherwise. */
class StandInValorant extends EventEmitter {
  constructor() {
    super();
    this.endWatch = { ended: false };
    this.rounds = 0;
    this.ledger = { size: () => this.rounds };
    this.inLobby = true;
    this.stopWith = null;   // the snap a stop mid match emits, as the real stop() does
    engines.push(this);
  }
  // startsInMatch: as the real reader, which clears inLobby as it starts.
  start() { if (StandInValorant.startsInMatch) this.inLobby = false; this.emit('status', 'coaching'); }
  stop() {
    this.emit('status', 'stopped');
    if (this.stopWith) this.emit('match-ended', this.stopWith);
  }
  setAgent() { return { ok: true }; }
  confirmAgent() {}
  pause() {}
  resume() {}
}
StandInValorant.startsInMatch = false;

/** Marvel Rivals: `seen` is the screen it last read, 'select' and 'away' being the match. */
class StandInRivals extends EventEmitter {
  constructor() { super(); this.seen = null; engines.push(this); }
  start() {}
  stop() {}
  pause() {}
  resume() {}
}

/** League: `live` while the game client reports a game. */
class StandInLeague extends EventEmitter {
  constructor() { super(); this.live = false; engines.push(this); }
  start() {}
  stop() {}
}

// Asked for by index.js alone. Compared without case: Windows paths can come
// back with the drive letter in either.
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/rivals-engine') return { RivalsEngine: StandInRivals };
    if (request === './services/lol-recorder') return { LolRecorder: StandInLeague };
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile, and the real match the snaps are made of ───────────
const ud = path.join(os.tmpdir(), 'occlara-check-seal');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
let snapsMade = 0;
/** A match snapshot as the engine's matchSnapshot() makes one, each match its own start. */
function snapOf(extra) {
  snapsMade++;
  const startedAt = Date.now() - 3600000 + snapsMade * 60000;
  return { rounds: played.rounds, tips: [], notes: [], context: { ...played.context, agent: 'Jett', language: 'en' },
    startedAt, endedAt: startedAt + 40 * 60000, ...extra };
}

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
    await wait(150);
  }
}

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)({}, ...args);
  const send = (ch, ...args) => ipcMain.emit(ch, { sender: null }, ...args);
  const settled = (page) => () => { const m = mainWindow.motionState(); return m.onScreen === page && !m.coming && !m.staged; };
  const shownViews = () => [...mainWindow.pageViews().entries()].filter(([, v]) => v.getVisible()).map(([id]) => id);
  const latest = () => engines[engines.length - 1];
  try {
    const win = mainWindow.create();
    win.show();
    const shell = await until(() => surfaces.find('/shell/'), 6000);
    if (!shell) return report(false, 'the shell never loaded');
    const sjs = (s) => shell.webContents.executeJavaScript(s);
    if (!await until(settled('home'), 8000)) return report(false, 'Home, the first page, never came in');

    /** Record Valorant and stop in the middle of a match: the seal is held. */
    const holdSeal = async (label, opts) => {
      await invoke(C.CONFIG_SET, { game: 'valorant' });
      send(C.COACH_START);
      const v = latest();
      if (!(v instanceof StandInValorant) || !(await invoke(C.STATE_GET)).isCoaching) return `${label}: Valorant did not start recording`;
      v.stopWith = snapOf({ endedBy: 'stop', stoppedLive: true });
      send(C.COACH_STOP);
      const s = await invoke(C.SHELL_GET);
      const titleOf = () => sjs("document.getElementById('sealed-title').textContent");
      const title = await until(async () => ((await titleOf()) === 'Recording stopped' ? 'Recording stopped' : null), 3000)
        || await titleOf();
      lines.push(`${label}: Valorant stopped mid match: sealed=${s.sealed} shown=${s.shown} shell says "${title}"`);
      if (!s.sealed || s.shown !== null || title !== 'Recording stopped') return `${label}: a stop mid match did not hold the seal`;
      if (opts && opts.reloadShell) {
        // A shell loaded again during a held seal (its menu's Reload, the
        // window made again) asks SHELL_GET at boot. Answered without the held
        // flag, it painted the live Recording screen and locked the sidebar,
        // the one way out of a held seal.
        const loaded = new Promise((r) => shell.webContents.once('did-finish-load', r));
        shell.webContents.reload();
        await loaded;
        const navOpen = "[...document.querySelectorAll('#nav .nav-item')].every((b) => !b.disabled)";
        const again = await until(async () => ((await titleOf()) === 'Recording stopped' && await sjs(navOpen)), 4000);
        lines.push(`${label}: the shell loaded again over the held seal: says "${await titleOf()}", sidebar open=${await sjs(navOpen)}`);
        if (!again) return `${label}: a shell loaded again over a held seal lost it, and locked the sidebar`;
      }
      return null;
    };

    // 1. A held seal, taken over by a recording of each other game.
    for (const game of ['lol', 'rivals']) {
      const notHeld = await holdSeal(game, { reloadShell: game === 'lol' });
      if (notHeld) return report(false, notHeld);
      await invoke(C.CONFIG_SET, { game });
      send(C.COACH_START);
      const e = latest();
      const st = await invoke(C.STATE_GET);
      if (!st.isCoaching || st.gameId !== game || !(e instanceof (game === 'lol' ? StandInLeague : StandInRivals))) {
        return report(false, `${game} did not start recording (${st.gameId}, recording=${st.isCoaching})`);
      }
      // The seal's tick, as SHELL_GET settles it, and a page from the sidebar.
      const s = await invoke(C.SHELL_GET);
      send(C.SHELL_NAV, 'matches');
      const opened = await until(() => mainWindow.current().shown === 'matches', 4000);
      lines.push(`${game} recording over it: sealed=${s.sealed} | Matches from the sidebar shown=${!!opened}`);
      if (s.sealed) return report(false, `recording ${game}, the seal a Valorant stop held is still on`);
      if (!opened) return report(false, `recording ${game}, a page asked for from the sidebar stays behind the seal`);
      // From here the seal follows this recording's own match.
      if (game === 'lol') e.live = true; else e.seen = 'select';
      const during = await invoke(C.SHELL_GET);
      const hiddenDuring = shownViews();
      if (game === 'lol') e.live = false; else e.seen = 'scoreboard';
      const over = await invoke(C.SHELL_GET);
      const back = await until(() => mainWindow.current().shown === 'matches', 4000);
      lines.push(`${game} match: sealed while played=${during.sealed} pages shown=${hiddenDuring.join(',') || 'none'} | over: sealed=${over.sealed} Matches back=${!!back}`);
      if (!during.sealed || hiddenDuring.length) return report(false, `a ${game} match in progress left a page on screen`);
      if (over.sealed || !back) return report(false, `the ${game} match over, the seal did not lift`);
      send(C.COACH_STOP);
      if ((await invoke(C.STATE_GET)).isCoaching) return report(false, `${game} did not stop`);
    }

    // 2. A review withdrawn because its match resumed.
    await invoke(C.CONFIG_SET, { game: 'valorant' });
    send(C.COACH_START);
    const v = latest();
    if (!(v instanceof StandInValorant)) return report(false, 'Valorant did not start recording again');
    const menu = await invoke(C.SHELL_GET);
    if (menu.sealed) return report(false, 'recording Valorant in a menu, the window is sealed');
    // The watch ends the match, too early as it turns out: its review opens.
    const snap = snapOf({ endedBy: 'score' });
    v.endWatch.ended = true;
    v.emit('match-ended', snap);
    if (!await until(settled('review'), 6000)) return report(false, 'the review of the match that ended never came in');
    const before = (await invoke(C.REVIEWS_LIST, 'valorant')).length;
    // Play carries on from the ended score: the engine puts the match back, then says so.
    v.endWatch.ended = false;
    v.inLobby = false;
    v.rounds = played.rounds.length;
    v.emit('match-resumed', { startedAt: snap.startedAt, from: 'score' });
    // Read in the same tick, before any timer of the switch's or the seal's.
    const now = mainWindow.current();
    const onScreen = shownViews();
    const m = mainWindow.motionState();
    lines.push(`resumed: sealed at once=${now.sealed} pages shown=${onScreen.join(',') || 'none'} on its way=${m.coming ? m.coming.to : 'none'} page kept=${now.page}`);
    if (!now.sealed) return report(false, 'a review withdrawn because its match resumed left the window unsealed mid match');
    if (onScreen.length || m.onScreen || m.coming) return report(false, `mid match, a page is on screen: ${onScreen.join(',')}`);
    if (now.page !== 'home') return report(false, `the window kept ${now.page}, not Home, for when the match ends`);
    const after = (await invoke(C.REVIEWS_LIST, 'valorant')).length;
    lines.push(`library: ${before} reviews before the resume, ${after} after`);
    if (after !== before - 1) return report(false, 'the withdrawn review is still in the library');
    // The real end lifts the seal and opens the review of the whole match.
    v.endWatch.ended = true;
    v.emit('match-ended', { ...snapOf({ endedBy: 'score' }), startedAt: snap.startedAt });
    const ended = await until(settled('review'), 8000);
    lines.push(`the real end: sealed=${mainWindow.current().sealed} review on screen=${!!ended}`);
    if (!ended || mainWindow.current().sealed) return report(false, 'the real end did not open the review of the whole match');
    send(C.COACH_STOP);

    // 3. A Valorant Start pressed over a held seal, mid match, never lifts it.
    // The real reader counts as in a match from its start (coaching-engine.js
    // start() clears inLobby), and settling the seal before the recording
    // began lifted it outright, so the page remembered from before came in
    // until the next tick. Read in the same tick as the Start.
    const notHeld3 = await holdSeal('valorant again');
    if (notHeld3) return report(false, notHeld3);
    StandInValorant.startsInMatch = true;
    send(C.COACH_START);
    const atStart = mainWindow.current();
    const shownAtStart = shownViews();
    const mStart = mainWindow.motionState();
    lines.push(`Start over a held seal, mid match: sealed=${atStart.sealed} pages shown=${shownAtStart.join(',') || 'none'} on its way=${mStart.coming ? mStart.coming.to : 'none'} staged=${mStart.staged || 'none'}`);
    if (!atStart.sealed || shownAtStart.length || mStart.coming || mStart.staged) {
      return report(false, 'a Start pressed over a held seal mid match lifted it before the recording took it over');
    }
    StandInValorant.startsInMatch = false;
    send(C.COACH_STOP);
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(INDEX);
