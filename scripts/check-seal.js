'use strict';

/**
 * The seal follows the match, booted for real (8.2): the real index.js, its
 * one window and its IPC, in the two places the seal did not follow it.
 *
 * ANY NEW RECORDING TAKES OVER A HELD SEAL. A stop in the middle of a Valorant
 * match holds the seal until the player opens a page (sealHeld in index.js).
 * Only the Valorant path of Start cleared it, so after a switch to League and
 * a Start, every page asked for, and the review when the game ended, stayed
 * behind "Recording stopped" until a Stop. Here League is started over a held
 * seal: the seal lifts, a page from the sidebar shows, and the seal then
 * follows League's own game, on while one is played and off once it is over.
 *
 * A REVIEW WITHDRAWN BECAUSE ITS MATCH RESUMED IS SEALED AT ONCE. The watch
 * ended a match too early, its review opened, and play carried on: the review
 * was taken back with a switch to Home that ran unsealed, the withdrawn review
 * (of the very match being played) kept over Home as it went, and Home then on
 * screen until the seal's next tick. Here the window is read in the same tick
 * as the resume: sealed, no page showing, Home remembered for the real end,
 * which opens the review of the whole match.
 *
 * THE CORNER MARK NEVER COVERS A MATCH (8.3.2). Out of sight, the window
 * leaves an always on top mark at the top right of the screen, over
 * Valorant's kill feed, and the window is out of sight exactly while a match
 * is played. Here the window is hidden and the mark follows the seal's own
 * test: gone in the same tick the seal comes on, for a League game and a
 * Valorant match in progress and for a stop mid match holding the seal, still
 * gone when the window is brought up and hidden again mid match, back when the
 * seal lifts with the window still out of sight, and never flashed up as a
 * page opened over a held seal brings the window back.
 *
 * THE TRAY ICON OPENS THE APP (8.4.1). Its click, the action index.js hands
 * the tray, brings the window up from hidden and from minimised on the page it
 * was on, never hides it, and mid match shows the Recording screen.
 *
 * CLOSING QUITS (8.4.1), by the tray's own path (cleanupAndQuit), asking first
 * only when quitting would lose something: here a match being recorded and a
 * review still being built, each question once, over the window, keeping
 * Occlara as it is by default; a close while a question is up asks nothing
 * more. The match's question counts the rounds a stop keeps, so a round only
 * begun is no round kept. app.quit and the native dialog are stood in for, so
 * nothing quits and nothing is shown.
 *
 * The engines that would read the screen and call the server are stand-ins
 * that emit what the real ones emit, nothing more: no capture, no model, no
 * network, and no League client asked. So is the tray, which keeps the actions
 * it is handed. The 1 second seal tick is not running (the app's surfaces are
 * never built here), so SHELL_GET, which settles the seal as the tick does,
 * stands in for it.
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
  console.log('PASS: a held seal is taken over by a League recording, which the seal then follows, a review withdrawn because its match resumed is sealed in the same tick, never switched to Home on screen, the corner mark is gone while a match is in progress or a stop holds the seal and back once it lifts, the Profile page and its checkout sealed mid match, the games toast held mid match and shown once it ends, the tray icon brings the window up, the Recording screen mid match, and closing quits by the tray\'s path, asking first, once each, when a match is being recorded (counting only the rounds a stop keeps) and when a review is still being built');
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
// Every link main would open in the browser, kept here and never opened: the
// Profile page's checkout must not open mid match (8.8), and a check opens no
// browser at all. index.js calls shell.openExternal at the time, so this is
// what it calls.
const browserOpened = [];
require('electron').shell.openExternal = async (url) => { browserOpened.push(String(url)); };
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
    // size() every round filed, list() the ones a stop keeps (the real
    // ledger's list() leaves out a last round only begun): `kept` below
    // `rounds` is a round filed off a banner or the loading screen.
    this.kept = null;
    this.ledger = {
      size: () => this.rounds,
      list: () => Array.from({ length: this.kept === null ? this.rounds : this.kept }, (_, i) => ({ n: i + 1 })),
    };
    this.inLobby = true;
    this.stopWith = null;   // the snap a stop mid match emits, as the real stop() does
    engines.push(this);
  }
  // startsInMatch: as the real reader, which clears inLobby as it starts.
  start() { if (StandInValorant.startsInMatch) this.inLobby = false; this.emit('status', 'coaching'); }
  stop() {
    this.stops = (this.stops || 0) + 1;
    this.emit('status', 'stopped');
    if (this.stopWith) this.emit('match-ended', this.stopWith);
  }
  pause() {}
  resume() {}
}
StandInValorant.startsInMatch = false;

/** League: `live` while the game client reports a game. */
class StandInLeague extends EventEmitter {
  constructor() { super(); this.live = false; engines.push(this); }
  start() {}
  stop() {}
}

// THE TRAY, as a stand-in that keeps the actions index.js hands it (8.4.1):
// its icon's click is actions.show, which the check presses as the icon
// would. index.js hands them over on every status change (setStatus), so a
// recording started is enough, with no surfaces built. tray.js itself, the
// click and double click wired to show, is test:shellnav's.
const trayStandIn = { actions: null, destroyed: 0 };
const StandInTray = {
  create(actions) { trayStandIn.actions = actions; return {}; },
  update(_recording, actions) { trayStandIn.actions = actions; },
  destroy() { trayStandIn.destroyed++; },
};

// Asked for by index.js alone. Compared without case: Windows paths can come
// back with the drive letter in either.
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

// ── A throwaway profile, and the real match the snaps are made of ───────────
const ud = path.join(os.tmpdir(), 'occlara-check-seal');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
// Recording Off: the sessions below are Valorant sessions (stand in readers,
// the real recorder), and with recording on only the hardware gate refusing
// (this check runs with no GPU acceleration) stood between them and the
// desktop. A check never records it.
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en', recordingMode: 'off',
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

    // 1. A held seal, taken over by a recording of the other game.
    for (const game of ['lol']) {
      const notHeld = await holdSeal(game, { reloadShell: game === 'lol' });
      if (notHeld) return report(false, notHeld);
      // League is coming soon: written to the store, as a page cannot choose it.
      require(path.join(REPO, 'src/main/services/store')).set('game', game);
      send(C.COACH_START);
      const e = latest();
      const st = await invoke(C.STATE_GET);
      if (!st.isCoaching || st.gameId !== game || !(e instanceof StandInLeague)) {
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
      e.live = true;
      const during = await invoke(C.SHELL_GET);
      const hiddenDuring = shownViews();
      // THE INVITE PAGE IS SEALED LIKE EVERY PAGE (8.7): asked for mid match,
      // through the real index.js, no page shows and its button is locked.
      send(C.SHELL_NAV, 'invite');
      await wait(400);
      const inviteMid = await invoke(C.SHELL_GET);
      const inviteLocked = await until(() => sjs("document.getElementById('nav-invite').disabled && document.getElementById('nav-settings').disabled"), 3000);
      const inviteShown = shownViews();
      lines.push(`${game} match: Invite asked for mid match: shown=${inviteMid.shown} pages shown=${inviteShown.join(',') || 'none'} button locked=${!!inviteLocked}`);
      if (inviteMid.shown !== null || inviteShown.length || !inviteLocked) return report(false, `mid ${game} match, the Invite page or its button is not sealed`);
      // AND THE MOMENTS PAGE (8.7), whose clips must never play mid match:
      // asked for mid match, no page shows and its nav item is locked.
      send(C.SHELL_NAV, 'moments');
      await wait(400);
      const momentsMid = await invoke(C.SHELL_GET);
      const momentsLocked = await until(() => sjs("(() => { const b = document.querySelector('#nav .nav-item[data-page=\"moments\"]'); return !!b && b.disabled; })()"), 3000);
      const momentsShown = shownViews();
      lines.push(`${game} match: Moments asked for mid match: shown=${momentsMid.shown} pages shown=${momentsShown.join(',') || 'none'} button locked=${!!momentsLocked}`);
      if (momentsMid.shown !== null || momentsShown.length || !momentsLocked) return report(false, `mid ${game} match, the Moments page or its button is not sealed`);
      // AND THE PRACTICE PAGE (ui.md, "The Practice page"): asked for mid
      // match no page shows and its tab is locked, and its channels, called
      // as the page and Home would, answer nothing and store nothing.
      send(C.SHELL_NAV, 'practice');
      await wait(400);
      const practiceMid = await invoke(C.SHELL_GET);
      const practiceLocked = await until(() => sjs("(() => { const b = document.querySelector('#nav .nav-item[data-page=\"practice\"]'); return !!b && b.disabled; })()"), 3000);
      const practiceShown = shownViews();
      const practicePage = await invoke(C.PRACTICE_GET, 'valorant');
      const practiceToday = await invoke(C.PRACTICE_TODAY);
      const practiceMark = await invoke(C.PRACTICE_MARK, 'general-range-warm-up');
      lines.push(`${game} match: Practice asked for mid match: shown=${practiceMid.shown} pages shown=${practiceShown.join(',') || 'none'} tab locked=${!!practiceLocked}`
        + ` | page=${JSON.stringify(practicePage)} today=${JSON.stringify(practiceToday)} mark=${JSON.stringify(practiceMark)}`);
      if (practiceMid.shown !== null || practiceShown.length || !practiceLocked) return report(false, `mid ${game} match, the Practice page or its tab is not sealed`);
      if (practicePage !== null || practiceToday !== null || !practiceMark || practiceMark.ok !== false || practiceMark.error !== 'match') {
        return report(false, `mid ${game} match, the Practice page's channels answered: ${JSON.stringify({ practicePage, practiceToday, practiceMark })}`);
      }
      // AND THE PROFILE PAGE (8.8), whose buy button opens a checkout: asked
      // for mid match no page shows and its button is locked, and its three
      // channels, called as the page would, answer nothing and open nothing.
      send(C.SHELL_NAV, 'profile');
      await wait(400);
      const profileMid = await invoke(C.SHELL_GET);
      const profileLocked = await until(() => sjs("document.getElementById('nav-profile').disabled"), 3000);
      const profileShown = shownViews();
      const buyMid = await invoke(C.PROFILE_BUY, 5);
      const plansMid = await invoke(C.PROFILE_PLANS);
      const pageMid = await invoke(C.PROFILE_GET);
      lines.push(`${game} match: Profile asked for mid match: shown=${profileMid.shown} pages shown=${profileShown.join(',') || 'none'} button locked=${!!profileLocked}`
        + ` | buy=${JSON.stringify(buyMid)} plans=${JSON.stringify(plansMid)} page=${JSON.stringify(pageMid)} opened=${browserOpened.length}`);
      if (profileMid.shown !== null || profileShown.length || !profileLocked) return report(false, `mid ${game} match, the Profile page or its button is not sealed`);
      if (!buyMid || buyMid.ok !== false || !plansMid || plansMid.ok !== false || pageMid !== null || browserOpened.length) {
        return report(false, `mid ${game} match, the Profile page's channels answered or opened a link: ${JSON.stringify({ buyMid, plansMid, pageMid, opened: browserOpened })}`);
      }
      // Its gift channels (8.8) the same: no checkout opened, nothing
      // redeemed, nothing copied mid match.
      const giftMid = await invoke(C.PROFILE_GIFT, 'pro_monthly');
      const redeemMid = await invoke(C.PROFILE_REDEEM, 'https://occlara.app/gift/0123456789abcdefghjkmnpqrs');
      const copyMid = await invoke(C.PROFILE_GIFT_COPY, 'g1');
      lines.push(`${game} match: gift=${JSON.stringify(giftMid)} redeem=${JSON.stringify(redeemMid)} copy=${JSON.stringify(copyMid)} opened=${browserOpened.length}`);
      if (!giftMid || giftMid.ok !== false || !redeemMid || redeemMid.ok !== false || !copyMid || copyMid.ok !== false || browserOpened.length) {
        return report(false, `mid ${game} match, a gift channel answered or opened a link: ${JSON.stringify({ giftMid, redeemMid, copyMid, opened: browserOpened })}`);
      }
      // AND WHAT'S NEW AND THE DISCORD (the changelog): asked for mid match,
      // the page does not show, the Discord icon is locked with the pages,
      // the invite asked for exactly as the page would opens nothing, and
      // Home's update line is answered null.
      send(C.SHELL_NAV, 'whatsnew');
      await wait(400);
      const newsMid = await invoke(C.SHELL_GET);
      const newsShown = shownViews();
      const discordLocked = await until(() => sjs("document.getElementById('discord').disabled"), 3000);
      const discordMid = await invoke(C.DISCORD_OPEN, require(path.join(REPO, 'src/shared/config')).DISCORD_URL);
      const noticeMid = await invoke(C.CHANGELOG_NOTICE);
      lines.push(`${game} match: What's new asked for mid match: shown=${newsMid.shown} pages shown=${newsShown.join(',') || 'none'} | Discord locked=${!!discordLocked}`
        + ` open=${JSON.stringify(discordMid)} notice=${JSON.stringify(noticeMid)} opened=${browserOpened.length}`);
      if (newsMid.shown !== null || newsShown.length || !discordLocked) return report(false, `mid ${game} match, the What's new page or the Discord icon is not sealed`);
      if (!discordMid || discordMid.ok !== false || discordMid.error !== 'match' || noticeMid !== null || browserOpened.length) {
        return report(false, `mid ${game} match, the Discord invite or the update line answered: ${JSON.stringify({ discordMid, noticeMid, opened: browserOpened })}`);
      }
      // AND REPORT A PROBLEM (docs/claude/feedback.md): asked for mid match
      // the page does not show and its icon above the Discord is locked, and
      // its four channels, called as the page would, answer nothing, take no
      // picture and send nothing.
      send(C.SHELL_NAV, 'feedback');
      await wait(400);
      const reportMid = await invoke(C.SHELL_GET);
      const reportShown = shownViews();
      const reportLocked = await until(() => sjs("document.getElementById('nav-feedback').disabled && document.getElementById('nav-feedback').title === 'Locked until the match ends'"), 3000);
      const reportInfo = await invoke(C.FEEDBACK_INFO);
      const reportPrep = await invoke(C.FEEDBACK_PREPARE, { type: 'image/png', size: 100, bytes: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]) });
      const reportSend = await invoke(C.FEEDBACK_SEND, { kind: 'broke', text: 'the review never opened after my match', tokens: [] });
      lines.push(`${game} match: Report a problem asked for mid match: shown=${reportMid.shown} pages shown=${reportShown.join(',') || 'none'} button locked=${!!reportLocked}`
        + ` | info=${JSON.stringify(reportInfo)} prepare=${reportPrep && reportPrep.error} send=${reportSend && reportSend.error}`);
      if (reportMid.shown !== null || reportShown.length || !reportLocked) return report(false, `mid ${game} match, the Report a problem page or its icon is not sealed`);
      if (reportInfo !== null || !reportPrep || reportPrep.error !== 'match' || !reportSend || reportSend.ok !== false || reportSend.error !== 'match') {
        return report(false, `mid ${game} match, a Report a problem channel answered: ${JSON.stringify({ reportInfo, reportPrep, reportSend })}`);
      }
      send(C.SHELL_NAV, 'matches');
      e.live = false;
      const over = await invoke(C.SHELL_GET);
      const back = await until(() => mainWindow.current().shown === 'matches', 4000);
      lines.push(`${game} match: sealed while played=${during.sealed} pages shown=${hiddenDuring.join(',') || 'none'} | over: sealed=${over.sealed} Matches back=${!!back}`);
      if (!during.sealed || hiddenDuring.length) return report(false, `a ${game} match in progress left a page on screen`);
      if (over.sealed || !back) return report(false, `the ${game} match over, the seal did not lift`);
      // The match over, the same buy opens the site's checkout, and only a
      // whole number from 1 to 500 does (profile.isBuyUrl, in main).
      const buyAfter = await invoke(C.PROFILE_BUY, 5);
      const refused = await Promise.all([501, 0, 2.5, '5', null].map((n) => invoke(C.PROFILE_BUY, n)));
      lines.push(`${game} match over: buy 5=${JSON.stringify(buyAfter)} opened=${JSON.stringify(browserOpened)} | 501, 0, 2.5, "5", null: ${refused.map((r) => r && r.ok).join(',')}`);
      if (!buyAfter || !buyAfter.ok || browserOpened.length !== 1 || browserOpened[0] !== 'https://occlara.app/buy?games=5' || refused.some((r) => !r || r.ok !== false)) {
        return report(false, `after the ${game} match, the checkout did not open as it should: ${JSON.stringify({ buyAfter, opened: browserOpened, refused })}`);
      }
      // The match over, the Discord invite opens, exactly it and nothing like it.
      const DISCORD = require(path.join(REPO, 'src/shared/config')).DISCORD_URL;
      const discordAfter = await invoke(C.DISCORD_OPEN, DISCORD);
      const discordRefused = await Promise.all([`${DISCORD}/`, 'https://discord.gg/other', 'https://evil.example', null].map((u) => invoke(C.DISCORD_OPEN, u)));
      lines.push(`${game} match over: Discord=${JSON.stringify(discordAfter)} opened=${JSON.stringify(browserOpened.slice(1))} | near misses: ${discordRefused.map((r) => r && r.error).join(',')}`);
      if (!discordAfter || !discordAfter.ok || browserOpened.length !== 2 || browserOpened[1] !== DISCORD || discordRefused.some((r) => !r || r.ok !== false || r.error !== 'url')) {
        return report(false, `after the ${game} match, the Discord invite did not open as it should: ${JSON.stringify({ discordAfter, opened: browserOpened, discordRefused })}`);
      }
      // The match over, a real picture is taken: Electron's own nativeImage
      // downscales a 3200 by 1800 PNG to 1600 by 900 and recompresses it to
      // JPEG in main (feedback-service.js prepare), and info answers again.
      {
        const { nativeImage } = require('electron');
        const W = 3200, H = 1800;
        const bitmap = Buffer.alloc(W * H * 4);
        for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = (i / 4) % 251; bitmap[i + 1] = 90; bitmap[i + 2] = 160; bitmap[i + 3] = 255; }
        const png = nativeImage.createFromBitmap(bitmap, { width: W, height: H }).toPNG();
        const prep = await invoke(C.FEEDBACK_PREPARE, { type: 'image/png', size: Math.min(png.length, 5 * 1024 * 1024 - 1), bytes: png });
        const infoAfter = await invoke(C.FEEDBACK_INFO);
        lines.push(`${game} match over: a ${W} by ${H} PNG prepared as ${prep && prep.width} by ${prep && prep.height}, ${prep && prep.bytes} bytes of JPEG | info version=${infoAfter && infoAfter.version}`);
        if (!prep || !prep.ok || prep.width !== 1600 || prep.height !== 900 || !(prep.bytes > 0) || !String(prep.preview || '').startsWith('data:image/jpeg;base64,')
          || !infoAfter || !infoAfter.version) {
          return report(false, `after the ${game} match, a picture was not prepared as it should be: ${JSON.stringify({ ...prep, preview: undefined, infoAfter: !!infoAfter })}`);
        }
        await invoke(C.FEEDBACK_DROP, prep.token);
      }
      browserOpened.length = 0;
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
    // THE GAMES TOAST WAITS (8.9.1, ui.md "The games toast"): games that came
    // mid match (a gift redeemed, an invite paid off) are never said over it.
    // index.js holds them while a match is on or the window is sealed
    // (flushGamesToasts, test:gamestoast); the window's toast view holds any
    // that reach it while sealed. Here one reaches it mid match.
    const giftToast = { id: 'seal-gift', kind: 'gift', pre: 'You got Pro', n: null, post: '', line: 'Someone sent you a gift, 25 games a month.' };
    mainWindow.toast(giftToast);
    const tMid = mainWindow.toastState();
    lines.push(`resumed: a games toast mid match: shown=${tMid.shown} waiting=${tMid.queued.join(',') || 'none'}`);
    if (tMid.shown || !tMid.queued.includes('seal-gift')) return report(false, 'mid match, the games toast came on screen');
    const after = (await invoke(C.REVIEWS_LIST, 'valorant')).length;
    lines.push(`library: ${before} reviews before the resume, ${after} after`);
    if (after !== before - 1) return report(false, 'the withdrawn review is still in the library');
    // The real end lifts the seal and opens the review of the whole match.
    v.endWatch.ended = true;
    v.emit('match-ended', { ...snapOf({ endedBy: 'score' }), startedAt: snap.startedAt });
    const ended = await until(settled('review'), 8000);
    lines.push(`the real end: sealed=${mainWindow.current().sealed} review on screen=${!!ended}`);
    if (!ended || mainWindow.current().sealed) return report(false, 'the real end did not open the review of the whole match');
    // The match over, the seal lifted: the toast that waited comes, drawn.
    const tShown = await until(() => mainWindow.toastState().shown, 3000);
    const tView = mainWindow.toastState().view;
    const tTitle = tView ? await until(() => tView.webContents.executeJavaScript(
      "(() => { const b = document.getElementById('toast'); return b && !b.hidden ? document.getElementById('toast-title').textContent + ' | ' + document.getElementById('toast-line').textContent : ''; })()"), 4000) : null;
    lines.push(`the real end: the games toast shown=${!!tShown} says "${tTitle || ''}"`);
    if (!tShown || tTitle !== `${giftToast.pre} | ${giftToast.line}`) return report(false, 'once the match ended, the games toast that waited did not come');
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

    // 4. The corner mark, with the window out of sight. Read in the same tick
    // as the seal it follows (SHELL_GET settles the seal as the tick does).
    const registry = require(path.join(REPO, 'src/main/windows/registry'));
    const dock = require(path.join(REPO, 'src/main/windows/dock-window'));
    const markShown = () => { const d = registry.get('dock'); return !!(d && d.isVisible()); };
    // Every time the mark is put up, so one up for a moment is caught too.
    let markUps = 0;
    const realShowAt = dock.showAt;
    dock.showAt = (...a) => { markUps++; return realShowAt(...a); };
    const hideWin = async () => { mainWindow.hide(); return until(() => !win.isVisible(), 3000); };
    const bringWin = async () => { mainWindow.toggleHidden({ focus: false }); return until(() => win.isVisible(), 3000); };
    const idle = await invoke(C.SHELL_GET);
    if (idle.sealed) return report(false, 'not recording, the window is still sealed');
    if (!await hideWin()) return report(false, 'the window would not hide');
    const atRest = await until(markShown, 3000);
    lines.push(`mark: not recording, the window hidden: mark up=${!!atRest}`);
    if (!atRest) return report(false, 'not recording, with the window hidden, the corner mark did not show');

    // A League game: up while its client has no game on, gone the tick the
    // game is, still gone with the window brought up and hidden again mid
    // game, and back once the game is over.
    // League is coming soon (games.js comingSoon): a page cannot choose it, so
    // the check writes the store the way an install that had it chosen would
    // be, and the seal and the mark are still held to the League rules.
    const refusedLol = await invoke(C.CONFIG_SET, { game: 'lol' });
    if (refusedLol && refusedLol.config && refusedLol.config.game === 'lol') return report(false, 'League is coming soon, yet a page could choose it');
    require(path.join(REPO, 'src/main/services/store')).set('game', 'lol');
    send(C.COACH_START);
    const lolRec = latest();
    if (!(lolRec instanceof StandInLeague) || !(await invoke(C.STATE_GET)).isCoaching) return report(false, 'League did not start recording for the mark');
    await invoke(C.SHELL_GET);
    const lobbyMark = markShown();
    lolRec.live = true;
    const lolOn = await invoke(C.SHELL_GET);
    const lolMark = markShown();
    lines.push(`mark: recording League, no game on: mark up=${lobbyMark} | the game on: sealed=${lolOn.sealed} mark up=${lolMark} window shown=${win.isVisible()}`);
    if (!lobbyMark) return report(false, 'recording League with no game on, the corner mark went');
    if (!lolOn.sealed) return report(false, 'a League game in progress did not seal the window');
    if (lolMark) return report(false, 'a League game in progress, the corner mark is still on top of the game');
    if (!await bringWin()) return report(false, 'mid game, the window would not come back');
    if (!await hideWin()) return report(false, 'mid game, the window would not hide again');
    await wait(400);
    await invoke(C.SHELL_GET);
    const againMark = markShown();
    lines.push(`mark: mid game, the window brought up and hidden again: mark up=${againMark}`);
    if (againMark) return report(false, 'mid game, hiding the window again put the corner mark back over the game');
    lolRec.live = false;
    const lolOver = await invoke(C.SHELL_GET);
    const lolBack = await until(markShown, 3000);
    lines.push(`mark: the game over: sealed=${lolOver.sealed} mark back=${!!lolBack}`);
    if (lolOver.sealed || !lolBack) return report(false, 'the League game over with the window hidden, the corner mark did not come back');
    send(C.COACH_STOP);

    // A Valorant match: gone the tick it begins; a stop mid match holds the
    // seal, and the mark with it, until the player opens a page, which lifts
    // the seal with no mark put up on the window's way back.
    await invoke(C.CONFIG_SET, { game: 'valorant' });
    send(C.COACH_START);
    const valRec = latest();
    if (!(valRec instanceof StandInValorant)) return report(false, 'Valorant did not start recording for the mark');
    await invoke(C.SHELL_GET);
    const menuMark = markShown();
    valRec.inLobby = false;
    const valOn = await invoke(C.SHELL_GET);
    const valMark = markShown();
    lines.push(`mark: recording Valorant in a menu: mark up=${menuMark} | the match on: sealed=${valOn.sealed} mark up=${valMark}`);
    if (!menuMark) return report(false, 'recording Valorant in a menu, the corner mark went');
    if (!valOn.sealed || valMark) return report(false, 'a Valorant match in progress, the corner mark is still over the kill feed');
    valRec.stopWith = snapOf({ endedBy: 'stop', stoppedLive: true });
    send(C.COACH_STOP);
    await wait(400);
    const heldNow = await invoke(C.SHELL_GET);
    const heldMark = markShown();
    lines.push(`mark: stopped mid match: sealed=${heldNow.sealed} held=${heldNow.held} mark up=${heldMark} window shown=${win.isVisible()}`);
    if (!heldNow.sealed || !heldNow.held) return report(false, 'a stop mid match did not hold the seal');
    if (heldMark || win.isVisible()) return report(false, 'a stop mid match, the seal held, put the corner mark back over the game');
    const upsBefore = markUps;
    send(C.SHELL_NAV, 'matches');
    const pageUp = await until(() => win.isVisible() && mainWindow.current().shown === 'matches', 4000);
    await wait(400);
    lines.push(`mark: a page opened over the held seal: window shown=${!!pageUp} sealed=${mainWindow.current().sealed} mark up=${markShown()} put up meanwhile=${markUps - upsBefore}`);
    if (!pageUp || mainWindow.current().sealed) return report(false, 'a page opened over the held seal did not lift it');
    if (markShown() || markUps !== upsBefore) return report(false, 'a page opened over the held seal flashed the corner mark up on its way');
    if (!await hideWin()) return report(false, 'the window would not hide once the seal lifted');
    const liftedMark = await until(markShown, 3000);
    lines.push(`mark: the seal lifted, the window hidden: mark up=${!!liftedMark}`);
    if (!liftedMark) return report(false, 'the seal lifted with the window hidden, and the corner mark did not come back');
    await bringWin();
    dock.showAt = realShowAt;

    // 5. THE TRAY ICON OPENS THE APP (8.4.1). Its click (actions.show, as
    // index.js hands the tray it) brings the window up from hidden and from
    // minimised, on the page it was on, and mid match on the Recording
    // screen the seal decides. The focus is asked for and not held to: the
    // player may have another window in front of this check.
    const tray = trayStandIn.actions;
    if (!tray || typeof tray.show !== 'function') return report(false, 'index.js hands the tray no way to bring the window up');
    send(C.SHELL_NAV, 'matches');
    if (!await until(settled('matches'), 4000)) return report(false, 'Matches would not come in for the tray');
    if (!await hideWin()) return report(false, 'the window would not hide for the tray');
    tray.show();
    const trayUp = await until(() => win.isVisible(), 3000);
    lines.push(`tray: the window hidden, its icon clicked: shown=${!!trayUp} focused=${win.isFocused()} page=${mainWindow.current().shown} mark up=${markShown()}`);
    if (!trayUp || mainWindow.current().shown !== 'matches') return report(false, 'the tray icon, clicked with the window hidden, did not bring it up on its page');
    if (await until(markShown, 800)) return report(false, 'the window brought up by the tray left the corner mark up');
    win.minimize();
    await until(() => win.isMinimized(), 3000);
    tray.show();
    const restored = await until(() => !win.isMinimized() && win.isVisible(), 3000);
    lines.push(`tray: the window minimised, its icon clicked: restored=${!!restored}`);
    if (!restored) return report(false, 'the tray icon, clicked with the window minimised, did not restore it');
    tray.show();
    if (!win.isVisible() || win.isMinimized()) return report(false, 'the tray icon clicked again over the window shown hid it, as the old toggle did');
    await invoke(C.CONFIG_SET, { game: 'valorant' });
    send(C.COACH_START);
    const midTray = latest();
    midTray.inLobby = false;
    await invoke(C.SHELL_GET);
    if (!await hideWin()) return report(false, 'mid match, the window would not hide for the tray');
    tray.show();
    const sealedUp = await until(() => win.isVisible(), 3000);
    const recScreen = await sjs("!document.getElementById('sealed').hidden");
    lines.push(`tray: mid match, its icon clicked: shown=${!!sealedUp} sealed=${mainWindow.current().sealed} pages shown=${shownViews().join(',') || 'none'} Recording screen=${recScreen}`);
    if (!sealedUp || !mainWindow.current().sealed || shownViews().length || !recScreen) {
      return report(false, 'mid match, the tray brought the window up on a page, not the Recording screen');
    }

    // 6. CLOSING QUITS (8.4.1), by the tray's own path, cleanupAndQuit, and
    // asks first only when quitting would lose something: here a match being
    // recorded (the stand-in mid match, four rounds filed) and the reviews
    // earlier steps left being built. Each question a native dialog over the
    // window, its first button, the default and Escape, keeping Occlara as it
    // is. app.quit and the dialog are stood in for, so the check can see them.
    const { dialog } = require('electron');
    const realBox = dialog.showMessageBox;
    const realQuit = app.quit;
    const asked = [];
    let answers = [];
    let hold = null;
    dialog.showMessageBox = (...a) => {
      const opts = a.length > 1 ? a[1] : a[0];
      asked.push({ parent: a.length > 1 && a[0] === win, ...opts });
      if (hold) return new Promise((r) => { hold.release = () => r({ response: 0 }); });
      return Promise.resolve({ response: answers.length ? answers.shift() : 0 });
    };
    let quits = 0;
    app.quit = () => { quits++; };
    if (dialog.showMessageBox === realBox || app.quit === realQuit) return report(false, 'the dialog or app.quit could not be stood in for');
    const restore = () => { dialog.showMessageBox = realBox; app.quit = realQuit; };
    const close = async (how) => {
      const n = asked.length;
      if (how === 'x') await sjs("document.getElementById('w-close').click(); true");
      else win.close();
      await until(() => asked.length > n || quits, 3000);
      await wait(300);
      return asked.slice(n);
    };
    // A round only begun (filed off the loading screen, never bought or
    // played) is no round a stop keeps (coaching-engine.js matchSnapshot):
    // the question says nothing of the match is kept, as nothing is.
    midTray.rounds = 1;
    midTray.kept = 0;
    answers = [0];
    const begun = await close('x');
    const q0 = begun[0] || {};
    lines.push(`closing with only a round begun: asked ${begun.length}: "${q0.detail}" | quit=${quits}`);
    if (begun.length !== 1 || q0.detail !== 'No round of it has been recorded yet, so nothing of it is kept. Keep recording and the match is reviewed when it ends.') {
      restore();
      return report(false, `closing with only a round begun said a round of it is kept: ${JSON.stringify(begun)}`);
    }
    if (quits) { restore(); return report(false, 'kept recording with only a round begun, Occlara quit anyway'); }
    midTray.kept = null;
    midTray.rounds = 4;
    // Kept recording: nothing else asked, nothing quit, the window as it was.
    answers = [0];
    const kept = await close('x');
    const q1 = kept[0] || {};
    lines.push(`closing mid match with its X: asked ${kept.length}: "${q1.message}" | "${q1.detail}" | [${(q1.buttons || []).join(', ')}] default=${q1.defaultId} cancel=${q1.cancelId} over the window=${q1.parent} | quit=${quits} window shown=${win.isVisible()}`);
    if (kept.length !== 1 || q1.message !== 'A match is being recorded. Quit and stop recording?'
      || q1.detail !== "The 4 rounds recorded so far are kept in Matches as part of a match, as the screen read them, with no coach's read. Keep recording and the whole match is reviewed when it ends."
      || (q1.buttons || []).join('|') !== 'Keep recording|Quit' || q1.defaultId !== 0 || q1.cancelId !== 0 || !q1.parent) {
      restore();
      return report(false, `closing mid match did not ask the one question it should, with keeping on as the default: ${JSON.stringify(kept)}`);
    }
    if (quits || !win.isVisible() || !(await invoke(C.STATE_GET)).isCoaching) { restore(); return report(false, 'kept recording, Occlara quit or stopped anyway'); }
    // Quit chosen for the match, kept open for the review still being built.
    answers = [1, 0];
    const both = await close('altf4');
    const q2 = both[1] || {};
    lines.push(`closing with Alt+F4: asked ${both.length}: then "${q2.message}" | "${q2.detail}" | [${(q2.buttons || []).join(', ')}] | quit=${quits}`);
    if (both.length !== 2 || both[0].message !== q1.message || q2.message !== "Your last match's review is still being written. Quit now?"
      || q2.detail !== "Quit now and it is kept as the screen read it, without the coach's read or its look at your deaths. Keep Occlara open and it finishes by itself, usually in a minute or two."
      || (q2.buttons || []).join('|') !== 'Keep Occlara open|Quit now' || q2.defaultId !== 0 || q2.cancelId !== 0) {
      restore();
      return report(false, `Alt+F4 did not ask both questions, the match first, each once: ${JSON.stringify(both)}`);
    }
    if (quits || !(await invoke(C.STATE_GET)).isCoaching) { restore(); return report(false, 'kept open at the second question, Occlara quit anyway'); }
    // A second close while a question is up asks nothing more.
    hold = {};
    const n0 = asked.length;
    win.close();
    await until(() => asked.length > n0, 3000);
    win.close();
    await sjs("document.getElementById('w-close').click(); true");
    await wait(600);
    const stacked = asked.length - n0;
    hold.release();
    hold = null;
    await wait(300);
    lines.push(`two more closes while a question was up: asked ${stacked} | quit=${quits}`);
    if (stacked !== 1 || quits) { restore(); return report(false, `closes while a question was up asked ${stacked} questions, or quit`); }
    // Quit chosen for both: quits by the tray's path, the session ended and the tray gone with it.
    answers = [1, 1];
    const stopsBefore = midTray.stops || 0;
    const trayGone = trayStandIn.destroyed;
    const gone = await close('x');
    await until(() => quits, 3000);
    lines.push(`quit chosen for both: asked ${gone.length} | quit=${quits} the session stopped=${(midTray.stops || 0) > stopsBefore} tray destroyed=${trayStandIn.destroyed > trayGone}`);
    restore();
    if (gone.length !== 2 || quits !== 1) return report(false, `quitting at both questions asked ${gone.length} and quit ${quits} times`);
    if (!((midTray.stops || 0) > stopsBefore) || !(trayStandIn.destroyed > trayGone)) {
      return report(false, 'the close quit without cleanupAndQuit: the session or the tray was left as it was');
    }
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(INDEX);
