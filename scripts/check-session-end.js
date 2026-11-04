'use strict';

/**
 * A SIGN IN THE SERVER STOPS TAKING NEVER REACHES THE SCREEN MID MATCH (8.7),
 * booted for real: the real index.js, signed in through the browser with no
 * licence key, its account service standing in only for the server's answers.
 *
 * REFUSED WHILE RECORDING. The session is revoked (signed out on another
 * device) mid match: nothing happens on screen and the recording goes on. A
 * read refused after that (the engine's auth-suspect) has no key to check, so
 * it never ends the licence: revalidating nothing answered valid false, which
 * stopped the recording and pushed "your subscription has ended" over the
 * Recording screen while the player was in the match.
 *
 * AND A STOP MID MATCH HOLDS IT. Stopped in the middle of that match, the
 * window holds the seal (the match is most likely still being played), and
 * the Sign in window waits with it: it opens only once the player opens a
 * page. The stop used to end the session at once, and the Sign in window
 * showed itself over the game.
 *
 * REFUSED DURING A HELD SEAL. Signed in again, stopped mid match, and then
 * refused (the licence watch's three minute me(), a 401): the Sign in window
 * waits for the seal too, and comes once a page is opened.
 *
 * The engines that would read the screen are stand-ins that emit what the
 * real ones emit; the tray keeps the actions it is handed. Nothing reaches the
 * network: the account service's server calls are stood in for.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:sessionend
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-session-end-check.json');
const INDEX = path.join(REPO, 'src', 'main', 'index.js');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_SESSION_END_OUT: OUT });
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary run as plain node.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: a sign in refused mid match keeps recording, ends no licence and says nothing, and the Sign in window waits for a held seal, opening only once a page is opened');
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
  try { fs.writeFileSync(process.env.OCCLARA_SESSION_END_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
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
    this.inLobby = true;
    this.stopWith = null;
    engines.push(this);
  }
  start() { this.emit('status', 'coaching'); }
  stop() {
    this.emit('status', 'stopped');
    if (this.stopWith) this.emit('match-ended', this.stopWith);
  }
  pause() {}
  resume() {}
}
class StandInLeague extends EventEmitter { constructor() { super(); this.live = false; } start() {} stop() {} }
const StandInTray = { create() { return {}; }, update() {}, destroy() {} };

// The account: signed in (no key) until the check refuses it; the server's
// answers stood in for, so nothing reaches the network.
const acct = { signed: true, refused: [], svc: null };
function standInAccount(real) {
  return {
    ...real,
    createAccountService(deps) {
      const svc = real.createAccountService(deps);
      acct.svc = svc;
      return Object.assign(Object.create(svc), {
        signedIn: () => acct.signed,
        hasAuth: () => acct.signed,
        auth: () => (acct.signed ? { Authorization: 'Bearer occ_standin' } : {}),
        me: async () => null,
        referral: async () => null,
        claim: async () => ({ granted: true }),
        release: async () => ({ released: false }),
        signIn: async () => { acct.signed = true; return { ok: true }; },
        onRefused: (cb) => { acct.refused.push(cb); return () => {}; },
      });
    },
  };
}
const refuse = () => { acct.signed = false; for (const cb of acct.refused) cb(); };

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent && parent.filename && same(parent.filename, INDEX)) {
    if (request === './services/coaching-engine') return StandInValorant;
    if (request === './services/lol-recorder') return { LolRecorder: StandInLeague };
    if (request === './tray') return StandInTray;
    if (request === './services/account-service') return standInAccount(realLoad(request, parent, isMain));
  }
  return realLoad(request, parent, isMain);
};

// ── A throwaway profile, signed in, no licence key ───────────────────────────
const ud = path.join(os.tmpdir(), 'occlara-check-session-end');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en', recordingMode: 'off',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
let snapsMade = 0;
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
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)({}, ...args);
  const send = (ch, ...args) => ipcMain.emit(ch, { sender: null }, ...args);
  const latest = () => engines[engines.length - 1];
  const signInUp = () => {
    const w = registry.get('activation');
    return !!(w && !w.isDestroyed());
  };
  try {
    if (!await until(() => surfaces.find('/shell/'), 15000)) return report(false, 'signed in, the main window never loaded');
    if (signInUp()) return report(false, 'signed in, the Sign in window opened at launch');

    /** Record Valorant, in a match. */
    const record = async (label) => {
      await invoke(C.CONFIG_SET, { game: 'valorant' });
      send(C.COACH_START);
      const v = latest();
      if (!(v instanceof StandInValorant) || !(await invoke(C.STATE_GET)).isCoaching) return [null, `${label}: Valorant did not start recording`];
      v.inLobby = false;
      v.rounds = 4;
      return [v, null];
    };
    /** Stop in the middle of that match: the seal is held. */
    const stopMidMatch = async (v, label) => {
      v.stopWith = snapOf({ endedBy: 'stop', stoppedLive: true });
      send(C.COACH_STOP);
      await wait(600);
      const s = await invoke(C.SHELL_GET);
      lines.push(`${label}: stopped mid match: sealed=${s.sealed} recording=${(await invoke(C.STATE_GET)).isCoaching} Sign in window=${signInUp()}`);
      return s.sealed ? null : `${label}: a stop mid match did not hold the seal`;
    };

    // 1. Refused while recording, a read refused after it, then a stop mid match.
    {
      const [v, err] = await record('recording');
      if (err) return report(false, err);
      refuse();
      await wait(400);
      v.emit('auth-suspect');
      await wait(600);
      const st = await invoke(C.STATE_GET);
      const notice = st.notice ? st.notice.text : '';
      lines.push(`refused mid match, then a read refused: recording=${st.isCoaching} licence active=${st.licenseActive} notice="${notice}" Sign in window=${signInUp()}`);
      if (!st.isCoaching) return report(false, 'a sign in refused mid match stopped the recording');
      if (st.licenseActive === false || /ended/i.test(notice)) return report(false, `a read refused mid match ended the licence and said so: "${notice}"`);
      if (signInUp()) return report(false, 'the Sign in window opened mid match');
      const held = await stopMidMatch(v, 'recording');
      if (held) return report(false, held);
      if (signInUp()) return report(false, 'a stop mid match opened the Sign in window over the match still being played');
      send(C.SHELL_NAV, 'matches');
      const came = await until(() => signInUp(), 5000);
      lines.push(`a page opened over the held seal: Sign in window=${!!came}`);
      if (!came) return report(false, 'the seal lifted and the ended sign in never went back to the Sign in window');
    }

    // 2. Signed in again, stopped mid match, then refused while the seal is held.
    {
      const r = await invoke(C.ACCOUNT_SIGNIN);
      if (!r || !r.ok || !await until(() => surfaces.find('/shell/') && !signInUp(), 15000)) {
        return report(false, 'signing in again did not open the app');
      }
      await wait(500);
      const [v, err] = await record('again');
      if (err) return report(false, err);
      const held = await stopMidMatch(v, 'again');
      if (held) return report(false, held);
      refuse();
      await wait(800);
      lines.push(`refused during the held seal: Sign in window=${signInUp()}`);
      if (signInUp()) return report(false, 'a refusal during a held seal opened the Sign in window over the match');
      send(C.SHELL_NAV, 'matches');
      const came = await until(() => signInUp(), 5000);
      lines.push(`a page opened: Sign in window=${!!came}`);
      if (!came) return report(false, 'the held seal lifted and the Sign in window never came');
    }
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack ? e.stack : e));
  }
}, 4000);

require(INDEX);
