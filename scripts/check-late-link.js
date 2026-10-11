'use strict';

/**
 * A match the watch ended early, verified by Riot's record through the real
 * app (8.2.1): at launch, by the late link, and live, by the link that runs
 * when a match ends. A player whose match the watch ended early, saved as the
 * screen read it, opens Occlara with a Riot ID connected, and the match is
 * checked against Riot's record by itself. Opened again within six hours, it
 * asks for nothing.
 *
 * ONLY THE SERVER IS FAKED, the way check:onboardingriot fakes it: the API
 * client's get and post are replaced before main loads. The library holds the
 * player's own 8.0.1 review of the Split match (scripts/fixtures), "Defeat
 * 3-5, Swiftplay", and the server answers the account's recent matches and
 * Riot's record of that match, Competitive, Victory 13 to 7. What runs is the
 * real launch: the licence read from the config, createAppSurfaces and its
 * timer, connectedRiotId(), backfill.js atLaunch() and late() over the real
 * review store and config, the notice main pushes and Home repainting. Only
 * the waits are cut: before the late link and between its tries mid match by
 * OCCLARA_DEV_LATE_LINK_MS, and between a review's link tries in the live
 * step by OCCLARA_DEV_LINK_SCALE.
 *
 *   launch 1  the review is upgraded in place: verified, Riot's 20 rounds with
 *             the 8 watched, Competitive, Victory 13-7, graded; Home's last
 *             match says so; the config keeps when the late link started; the
 *             notice says what was checked; the match nobody recorded beside
 *             it is neither fetched nor filed
 *   launch 2  the review put back as the screen read it, the config as launch
 *             1 left it: the list is never asked for, because the last late
 *             link started under six hours ago
 *   typed     a Riot ID typed in Settings and never connected, a duo
 *             partner's, say, whose profile the launch's own refresh saves:
 *             nothing is asked for, and the review is left as it was
 *   typedagain  the next launch of that profile, the profile on disk now: it
 *             is still no proof, and nothing is asked for
 *   typedold  an install that already ran 8.0.3 or later (the version that
 *             brought Connect), launching 8.2.1 for the first time, a typed
 *             and never connected ID with an earlier launch's profile on disk:
 *             not kept as connected, since Connect existed and was not pressed
 *   midmatch  an install from before riotConnected, connected by the profile
 *             its Connect saved alone, kept as connected at load; recording
 *             with a match on screen (a stand-in reader in place of the one
 *             that reads the screen, as check:seal does it) when the late link
 *             is due: nothing is asked for while the match is on, and the try
 *             after it is over checks the review
 *   live      recording, the stand-in's watch ending the Split match at 3 to
 *             5, on the real timeline: Riot lists the match only once it is
 *             over and published, nearly twenty minutes after the watch's end,
 *             so the tries before find nothing, and the one after asks for
 *             the Split match's round record, links it as ended early and lays
 *             that same record over the review, asked for once. Beside it, a
 *             match the watch ended at 3 to 5 that Riot never lists: when its
 *             link gives up, its review says the match may have gone on, never
 *             that it was played on another account
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:latelink
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-late-link-check.json');
const STEPS = ['first', 'again', 'typed', 'typedagain', 'typedold', 'midmatch', 'live'];
// A second launch shares the profile of the launch before it; every other
// step has its own.
const AGAIN = { again: 'first', typedagain: 'typed' };
const udOf = (step) => {
  const own = AGAIN[step] || step;
  return path.join(os.tmpdir(), own === 'first' ? 'occlara-check-late-link' : `occlara-check-late-link-${own}`);
};
// The wait before the late link's try at launch, and between its tries while
// a match is played: half a second, and in the midmatch step long enough for
// recording to have started before the first try is due.
const lateMsOf = (step) => (step === 'midmatch' ? 2500 : 500);
// The live step's clock runs this much faster, the link's waits cut to match.
const SCALE = 0.004;

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  const dirs = [...new Set(STEPS.map(udOf))];
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  let bad = 0;
  for (const step of STEPS) {
    try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
    const env = Object.assign({}, process.env, {
      OCCLARA_LATE_OUT: OUT, OCCLARA_LATE_STEP: step, OCCLARA_LATE_UD: udOf(step),
      OCCLARA_DEV_LATE_LINK_MS: String(lateMsOf(step)),
    });
    if (step === 'live') env.OCCLARA_DEV_LINK_SCALE = String(SCALE);
    else delete env.OCCLARA_DEV_LINK_SCALE;
    // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron
    // binary run as plain node and the app dies with a misleading error.
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
    if (!rec) {
      console.error(`  FAIL [${step}] the launch wrote no result (exit ${r.status})`);
      bad++;
      break;
    }
    for (const l of rec.lines) console.log('  ' + l);
    console.log(`  ${rec.ok ? 'PASS' : 'FAIL'} [${step}] ${rec.detail}`);
    if (!rec.ok) { bad++; break; }
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  if (bad) { console.error('FAIL: a match the watch ended early was not verified as it should be'); process.exit(1); }
  console.log("PASS: at launch a recording the watch ended early is checked against Riot's record by itself, "
    + 'Home shows it, a second launch within six hours asks for nothing, a Riot ID never connected asks for nothing, '
    + 'a launch mid match checks it once the match is over, and the live link takes the same match once Riot has it');
  process.exit(0);
}

const Module = require('module');
const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const { ReviewStore } = require(path.join(REPO, 'src/main/services/review-store'));
const { weekKey } = require(path.join(REPO, 'src/main/services/weekly-report'));
const riotReview = require(path.join(REPO, 'src/shared/riot-review'));
const INDEX = path.join(REPO, 'src', 'main', 'index.js');

const STEP = process.env.OCCLARA_LATE_STEP || 'first';
const ud = process.env.OCCLARA_LATE_UD;
const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_LATE_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* the exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The first truthy answer of fn, asked every quarter second, or null after ms. */
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(250);
  }
}

// ── The profile: the player's own review of the match, and a Riot ID ───────
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/fixtures', name), 'utf8'));
const SAVED = fixture('valorant-review-split-801.json');
const SPLIT = fixture('riot-split-13-7.json');
const CONFIG = path.join(ud, 'occlara-config.json');
const reviews = new ReviewStore(path.join(ud, 'reviews'));
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
// The account's ranked profile, as /player-stats answers it.
const PROFILE = { source: 'henrikdev', rank: 'Gold 2', peakRank: 'Platinum 1', mode: 'competitive',
  kd: 1.12, kpr: 0.81, adr: 141, acs: 214, headshotPct: 23, winRate: 52, topAgent: 'Jett', topAgents: [] };
let lateBefore = 0;
let profiledAtLoad = false;
if (!AGAIN[STEP]) {
  // How the Riot ID came to be in Settings: by a Connect (riotConnected), typed
  // and never connected (nothing), or by a Connect from before riotConnected
  // was kept, 8.0.2 and older (the profile that Connect saved, nothing else).
  const connection = STEP === 'typed' ? {}
    : STEP === 'midmatch' ? { playerStats: { ...PROFILE, _riotId: 'Me#EUW' } }
    // Ran 8.0.3 or later before (rivalsTitlesRepaired is written at its first
    // launch), typed and never connected, an earlier launch's profile on disk.
    : STEP === 'typedold' ? { rivalsTitlesRepaired: true, playerStats: { ...PROFILE, _riotId: 'Me#EUW' } }
    : { riotConnected: 'Me#EUW' };
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({
    // Recording Off: a check never records the desktop, and with it on only
    // the hardware gate refusing stood between this one's sessions and it.
    game: 'valorant', onboardingCompleted: true, language: 'en', aiLog: false, recordingMode: 'off',
    licenseKey: 'CHECK-LATE-LINK', licenseStatus: 'active', licensePlan: 'lifetime', licenseExpiry: '',
    riotId: 'Me#EUW', ...connection,
    // Seen this week, so no weekly report opens over the check.
    weeklyReportWeek: weekKey(),
  }, null, 2));
} else {
  const before = readConfig();
  lateBefore = Number(before.lateLinkAt) || 0;
  profiledAtLoad = !!(before.playerStats && before.playerStats._riotId === 'Me#EUW');
}
// Every launch but the live one starts from the review as 8.0.1 saved it.
// The live step starts from an empty library and records the match itself.
if (STEP !== 'live') reviews.save({ id: SAVED.id, game: SAVED.game, at: SAVED.at, review: SAVED.review });
process.env.OCCLARA_DEV_USERDATA = ud;

// ── The reader, a stand-in for the midmatch and live steps ──────────────────
// It has what matchInProgress() reads and emits what the real reader emits
// when its watch ends a match, nothing more: no capture, no model. In the
// midmatch step a match is on screen from its first read.
const readers = [];
class StandInValorant extends EventEmitter {
  constructor() {
    super();
    this.endWatch = { ended: false };
    this.ledger = { size: () => 0 };
    this.inLobby = STEP !== 'midmatch';
    readers.push(this);
  }
  start() { this.emit('status', 'coaching'); }
  stop() { this.emit('status', 'stopped'); }
  setAgent() { return { ok: true }; }
  confirmAgent() {}
  pause() {}
  resume() {}
}
if (STEP === 'live' || STEP === 'midmatch') {
  // Asked for by index.js alone. Compared without case: Windows paths can
  // come back with the drive letter in either.
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent && parent.filename && same(parent.filename, INDEX) && request === './services/coaching-engine') return StandInValorant;
    return realLoad(request, parent, isMain);
  };
}
// The live match is played now: the watch ends it at 3 to 5 as the check
// runs, and Riot's record is moved to have started as long before that as
// the real one had (15 and a half minutes), its length unchanged.
const LIVE_END = Date.now() + 3000;
const LIVE_START = LIVE_END - (SAVED.at - SPLIT.startedAt);
// THE REAL TIMELINE, on a clock that runs SCALE times faster from the moment
// the watch's end is handed over (the link's waits are cut by the same
// factor, OCCLARA_DEV_LINK_SCALE): Riot lists the Split match only once it is
// over and published, its own length after its start and 90 seconds on, the
// quickest Riot publishes. That is nearly twenty minutes after the watch's
// end, past a score end's last try on the usual schedule.
const PUBLISH_MS = 90000;
const LISTED_AT = LIVE_START + SPLIT.lengthMs + PUBLISH_MS;
let handedAt = 0;
const riotNow = (at = Date.now()) => (handedAt ? LIVE_END + (at - handedAt) / SCALE : 0);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

// ── The server, faked before main loads ─────────────────────────────────────
const SPLIT_ROW = { matchId: 'split-1', map: 'Split', mode: 'Competitive', agent: 'Jett', result: 'Victory', score: '13-7',
  kills: 17, deaths: 16, assists: 8, kd: 1.06, acs: 279, adr: 181, headshotPct: 22, startedAt: SPLIT.startedAt };
// Played three hours later and never recorded: Connect's to grade, not the late link's.
const OTHER_ROW = { ...SPLIT_ROW, matchId: 'bind-1', map: 'Bind', result: 'Defeat', score: '9-13',
  startedAt: SPLIT.startedAt + 3 * 3600000 };
const calls = [];
const stamps = [];
const param = (p, k) => {
  const m = new RegExp('[?&]' + k + '=([^&]*)').exec(p);
  return m ? decodeURIComponent(m[1]) : '';
};
// The live step's match as the tracker lists it once it is: the newest, the
// Split match played now, with the match before it on another map, which is
// all the list holds until then.
const LIVE_ROW = { ...SPLIT_ROW, startedAt: LIVE_START };
const LIVE_BEFORE = { ...OTHER_ROW, startedAt: LIVE_START - 45 * 60000 };
const api = require(path.join(REPO, 'src/main/services/api-client'));
api.get = async (p) => {
  calls.push(p);
  stamps.push({ p, at: Date.now() });
  const answer = (data, status = 200) => ({ ok: status < 400, status, data });
  if (param(p, 'username').toLowerCase() !== 'me#euw') return answer({ error: 'Not part of this check.' }, 404);
  if (p.startsWith('/api/coach/player-stats')) return answer({ ...PROFILE });
  if (p.startsWith('/api/coach/recent-matches')) return answer({ matches: [OTHER_ROW, SPLIT_ROW] });
  if (p.startsWith('/api/coach/last-match')) {
    return answer(riotNow() >= LISTED_AT ? { ...LIVE_ROW, recent: [LIVE_BEFORE] } : { ...LIVE_BEFORE, recent: [] });
  }
  if (p.startsWith('/api/coach/match-rounds')) {
    const rec = { ...JSON.parse(JSON.stringify(SPLIT)), matchId: 'split-1' };
    if (STEP === 'live') rec.startedAt = LIVE_START;
    return param(p, 'matchId') === 'split-1' ? answer(rec) : answer({ error: 'That Riot ID is not in this match.' });
  }
  return answer({ error: 'Not part of this check.' }, 404);
};
api.post = async (p) => {
  calls.push('POST ' + p);
  if (p === '/api/license/activate') return { ok: true, status: 200, data: { valid: true, status: 'active', plan: 'lifetime' } };
  // The summary written again from Riot's record, as the review route answers.
  if (p === '/api/coach/match-review') {
    return { ok: true, status: 200, data: { summary: 'You won the match 13 to 7.', rounds: {}, focus: 'Trade your entries.', study: [] } };
  }
  return { ok: false, status: 404, data: { error: 'Not part of this check.' } };
};

// The notices main pushes, as every window receives them.
const registry = require(path.join(REPO, 'src/main/windows/registry'));
const C = require(path.join(REPO, 'src/shared/channels'));
const notices = [];
const statuses = [];
const broadcast = registry.broadcast;
registry.broadcast = (ch, data) => {
  if (ch === C.PUSH_STATE && data && data.notice && data.notice.text && !notices.includes(data.notice.text)) {
    notices.push(data.notice.text);
  }
  if (ch === C.PUSH_BACKFILL && data) statuses.push({ state: data.state, late: !!data.late });
  return broadcast(ch, data);
};

// THE MIDMATCH STEP RECORDS FROM THE MOMENT THE SURFACES ARE UP, a match on
// screen, so the launch's try at the late link, due OCCLARA_DEV_LATE_LINK_MS
// after them (createAppSurfaces arms it as it builds the main window), lands
// mid match.
let surfacedAt = 0;
if (STEP === 'midmatch') {
  const poll = setInterval(() => {
    if (!registry.get('main')) return;
    clearInterval(poll);
    surfacedAt = Date.now();
    ipcMain.emit(C.COACH_START, { sender: null });
  }, 20);
}

const HOME = `(() => {
  const host = document.getElementById('last');
  const q = (s) => { const e = host && host.querySelector(s); return e ? e.textContent : null; };
  return host ? { result: q('.result'), score: q('.score'), meta: q('.meta') } : null;
})()`;

/**
 * OCCLARA_SHOTS=1: a picture of one page as the player sees it, to
 * dist-surface-shots/latelink-<name>.png, scrolled to `focus` when named.
 */
async function shot(wc, name, focus) {
  if (process.env.OCCLARA_SHOTS !== '1' || !wc) return;
  try {
    if (focus) {
      await wc.executeJavaScript(`(() => { const e = document.getElementById(${JSON.stringify(focus)});
        if (e) e.scrollIntoView({ block: 'center' }); return true; })()`);
    }
    await wait(600);
    const img = await wc.capturePage();
    const dir = path.join(REPO, 'dist-surface-shots');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `latelink-${name}.png`), img.toPNG());
    lines.push(`shot latelink-${name}.png`);
  } catch (e) {
    lines.push(`shot latelink-${name}.png failed: ${e.message}`);
  }
}

setTimeout(async () => {
  const surfaces = require('./fixtures/surfaces');
  try {
    if (STEP === 'first') {
      const up = await until(() => {
        const e = reviews.get(SAVED.id);
        return e && e.review && e.review.verified ? e.review : null;
      }, 45000);
      lines.push(`calls: ${calls.filter((c) => !c.startsWith('/api/coach/player-stats')).join(' , ')}`);
      if (!up) return report(false, 'the review was never checked against Riot\'s record at launch');
      const watched = up.rounds.filter((c) => c.watched).length;
      lines.push(`review: ${up.game.mode} ${up.game.result} ${up.game.score}, ${up.rounds.length} rounds, ${watched} watched, `
        + `grade ${up.grade && up.grade.score} ${up.grade && up.grade.letter}`);
      if (up.rounds.length !== 20 || watched !== 8 || up.game.mode !== 'Competitive' || up.game.result !== 'Victory'
        || up.game.score !== '13-7' || typeof (up.grade && up.grade.score) !== 'number') {
        return report(false, 'the review checked at launch is not Riot\'s 20 round Competitive 13-7 with the 8 watched rounds, graded');
      }
      if (reviews.list('valorant').length !== 1 || calls.some((c) => c.includes('matchId=bind-1'))) {
        return report(false, 'the late link fetched or filed the match nobody recorded');
      }
      const note = await until(() => notices.find((t) => t.startsWith('Checked')), 5000);
      lines.push(`notice: ${note}`);
      if (note !== "Checked 1 recent match against Riot's record. It is in Matches.") {
        return report(false, `the notice was "${note}"`);
      }
      if (!statuses.length || !statuses.every((s) => s.late)) {
        return report(false, `the run's pushes were not a late link's: ${JSON.stringify(statuses)}`);
      }
      const at = Number(readConfig().lateLinkAt) || 0;
      lines.push(`lateLinkAt: ${at ? new Date(at).toISOString() : 'not kept'}`);
      if (!(at > Date.now() - 120000 && at <= Date.now())) return report(false, 'the config does not keep when the late link started');
      // HOME SHOWS RIOT'S RESULT: it repaints on the save, from the library.
      const home = await until(async () => {
        const s = surfaces.find('/home/');
        const h = s ? await s.webContents.executeJavaScript(HOME) : null;
        return h && h.result === 'Victory' ? h : null;
      }, 15000);
      lines.push(`home: ${JSON.stringify(home)}`);
      if (!home || home.score !== '13 : 7' || !/Competitive/.test(home.meta || '')) {
        return report(false, 'Home\'s last match does not show Riot\'s Victory 13-7 in Competitive');
      }
      if (process.env.OCCLARA_SHOTS === '1') {
        const homeWc = surfaces.find('/home/').webContents;
        await shot(homeWc, 'home');
        await homeWc.executeJavaScript("[...document.querySelectorAll('#last button')].find((b) => b.textContent === 'Open review').click(); true");
        const page = await until(() => surfaces.find('/review/'), 8000);
        await wait(1500);
        await shot(page && page.webContents, 'review');
        await shot(page && page.webContents, 'review-refused', 'v-refused-wrap');
      }
      return report(true, 'checked against Riot\'s record at launch, upgraded in place, said as a notice, and on Home');
    }
    if (STEP === 'typed' || STEP === 'typedagain' || STEP === 'typedold') {
      // Past the late link's try (half a second after the surfaces), with
      // the profile the launch's own refresh saved for the typed ID on disk,
      // and on the next launch, on disk from the launch before.
      await wait(3000);
      const cfg = readConfig();
      const lists = calls.filter((c) => c.startsWith('/api/coach/recent-matches')).length;
      const still = reviews.get(SAVED.id);
      const saved = cfg.playerStats && cfg.playerStats._riotId;
      lines.push(`${STEP === 'typed' ? 'typed' : 'the next launch'}, never connected: profile saved for ${saved}`
        + `${STEP === 'typedagain' ? `, on disk at load ${profiledAtLoad}` : ''}, ${lists} list requests, `
        + `review verified=${!!(still && still.review.verified)}, riotConnected ${JSON.stringify(cfg.riotConnected || null)}`);
      if (saved !== 'Me#EUW' || (STEP === 'typedagain' && !profiledAtLoad)) {
        return report(false, 'no profile was saved for the typed Riot ID, so this proves nothing');
      }
      if (lists) return report(false, 'a Riot ID typed and never connected started the late link, on a profile a launch saved');
      if (!still || still.review.verified) return report(false, 'the review was checked against the record of a Riot ID never connected');
      if (cfg.riotConnected) return report(false, 'a Riot ID typed and never connected was kept as connected');
      return report(true, STEP === 'typed'
        ? 'a Riot ID typed and never connected asks for nothing, though the launch saved its profile'
        : STEP === 'typedagain' ? 'nor on the next launch, the profile on disk from the one before'
          : 'nor on an install that already had Connect and never pressed it, its old profile on disk');
    }
    if (STEP === 'midmatch') {
      const v = await until(() => readers[readers.length - 1], 5000);
      if (!v || !surfacedAt) return report(false, 'recording never started before the late link was due');
      // A second and a half past the launch's try, with the match still on.
      await wait(Math.max(0, surfacedAt + lateMsOf(STEP) + 1500 - Date.now()));
      const cfg = readConfig();
      const mid = calls.filter((c) => c.startsWith('/api/coach/recent-matches')).length;
      lines.push(`mid match, past the launch's try: ${mid} list requests, riotConnected ${JSON.stringify(cfg.riotConnected || null)}, `
        + `lateLinkAt ${cfg.lateLinkAt || 0}`);
      if (cfg.riotConnected !== 'Me#EUW') {
        return report(false, 'the Riot ID connected before riotConnected was kept is not kept as connected at load');
      }
      if (mid || cfg.lateLinkAt) return report(false, 'the late link ran while a match was being played');
      // The match is over: the menus.
      v.inLobby = true;
      const over = Date.now();
      const up = await until(() => {
        const e = reviews.get(SAVED.id);
        return e && e.review.verified ? e.review : null;
      }, 20000);
      const first = stamps.find((s) => s.p.startsWith('/api/coach/recent-matches'));
      lines.push(`after the match: list asked ${first ? `${Math.round((first.at - over) / 100) / 10} s after it ended` : 'never'}, `
        + `review ${up ? `${up.game.mode} ${up.game.result} ${up.game.score}` : 'unchecked'}`);
      if (!up) return report(false, "the late link never ran once the match was over: the launch's try mid match was its only one");
      return report(true, "the launch's late link, due mid match, checks the review once the match is over, "
        + 'for a Riot ID connected before riotConnected was kept');
    }
    if (STEP === 'live') {
      ipcMain.emit(C.COACH_START, { sender: null });
      const v = readers[readers.length - 1];
      if (!v) return report(false, 'recording never started the reader');
      // The screen's 8 rounds as the 8.0.1 review's cards hold them, ended at 3 to 5 on a swiftplay lock.
      const { rows } = riotReview.ledgerRows(SAVED.review);
      const ended = (map, startedAt, endedAt) => ({ endedBy: 'score', rounds: rows, tips: [], notes: [],
        context: { map, agent: 'Jett', agentConfirmed: true, teamScore: 3, enemyScore: 5, gameMode: 'swiftplay', language: 'en' },
        startedAt, endedAt, ai: { summary: 'You lost the match five to three.' } });
      // And two hours before it, a match on Lotus ended the same way that
      // Riot never lists.
      const lotus = ended('Lotus', LIVE_END - 2 * 3600000 - 10 * 100000, LIVE_END - 2 * 3600000);
      const snap = ended('Split', LIVE_END - 10 * 100000, LIVE_END);
      v.endWatch.ended = true;
      handedAt = Date.now();
      for (const s of [lotus, snap]) {
        v.emit('match-ended', s);
        v.emit('match-review', 'review text', s);
      }
      const onMap = (map) => reviews.list('valorant').map((m) => reviews.get(m.id))
        .find((e) => e && e.review && e.review.game && e.review.game.map === map);
      const up = await until(() => {
        const e = onMap('Split');
        return e && e.review.verified && e.review.matchId === 'split-1' ? e.review : null;
      }, 30000);
      const scaled = (at) => `+${Math.round((riotNow(at) - LIVE_END) / 1000)}s`;
      const asked = stamps.filter((s) => s.p.startsWith('/api/coach/last-match') || s.p.startsWith('/api/coach/match-rounds'))
        .map((s) => `${s.p.startsWith('/api/coach/last-match') ? 'list' : 'record'} ${scaled(s.at)}`);
      lines.push(`live, Riot lists the Split match ${Math.round((LISTED_AT - LIVE_END) / 1000)} s after the watch's end; `
        + `asked: ${asked.join(' , ')}`);
      if (!up) return report(false, 'the live link never linked the match the watch ended early');
      const record = stamps.filter((s) => s.p.startsWith('/api/coach/match-rounds'));
      if (!(record.length && riotNow(record[0].at) >= LISTED_AT)) {
        return report(false, 'Riot\'s record was asked for before Riot had listed the match, which is not the real timeline');
      }
      const usual = require(path.join(REPO, 'src/main/services/match-link')).LINK_RETRY_MS.reduce((a, b) => a + b, 0);
      if (!(LIVE_END + usual < LISTED_AT)) return report(false, 'on this timeline the usual schedule would have reached the match too');
      const watched = up.rounds.filter((c) => c.watched).length;
      lines.push(`live review: ${up.game.mode} ${up.game.result} ${up.game.score}, ${up.rounds.length} rounds, ${watched} watched, `
        + `summary "${up.summary}"`);
      if (up.rounds.length !== 20 || watched !== 8 || up.game.mode !== 'Competitive' || up.game.result !== 'Victory'
        || up.game.score !== '13-7' || up.halftimeAfter !== 12) {
        return report(false, 'the live link laid something else over the review than Riot\'s 20 round Competitive 13-7');
      }
      if (!up.refused.some((l) => l.startsWith('The coach thought the match was over at 3 to 5, and it went on.'))) {
        return report(false, 'the live review does not say the coach ended the match too soon');
      }
      if (up.summary !== 'You won the match 13 to 7.') return report(false, 'the summary was not written again from Riot\'s record');
      if (record.length !== 1 || !record[0].p.includes('matchId=split-1')) {
        return report(false, `Riot's record was asked for ${record.length} times, not once for the Split match`);
      }
      // GIVEN UP ON, it may have gone on: never "another account".
      const gone = await until(() => {
        const e = onMap('Lotus');
        return e && e.review.refused.some((l) => l.startsWith("Riot's record of this match was not found yet.")) ? e.review : null;
      }, 30000);
      const lotusLines = ((gone || (onMap('Lotus') || {}).review || {}).refused || []);
      lines.push(`the match Riot never lists: ${lotusLines.filter((l) => /record/.test(l)).join(' | ')}`);
      if (!gone) return report(false, 'the match Riot never listed did not say, once its link gave up, that it may have gone on');
      if (gone.verified || gone.refused.some((l) => /another account/.test(l))
        || (gone.grade && gone.grade.notes || []).some((n) => /another account/.test(n))) {
        return report(false, 'the match the watch ended on a swiftplay score is said to have been played on another account');
      }
      return report(true, 'the live link takes the match the watch ended early once Riot has it, on the one record it asked for, '
        + 'and a match Riot never lists is said to have perhaps gone on');
    }
    // A second launch, an hour inside the six: the review is the screen's
    // again, so only the gate stands between it and the list.
    await wait(6000);
    const lists = calls.filter((c) => c.startsWith('/api/coach/recent-matches')).length;
    const still = reviews.get(SAVED.id);
    const at = Number(readConfig().lateLinkAt) || 0;
    lines.push(`second launch: ${lists} list requests, review verified=${!!(still && still.review.verified)}, `
      + `lateLinkAt kept=${at === lateBefore && at > 0}`);
    if (!lateBefore) return report(false, 'the first launch left no lateLinkAt to keep');
    if (lists) return report(false, 'a second launch within six hours asked for the list again');
    if (still && still.review.verified) return report(false, 'the review was checked again within six hours');
    if (at !== lateBefore) return report(false, 'the second launch moved lateLinkAt');
    return report(true, 'a second launch within six hours asks for nothing');
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack || e));
  }
}, 2500);

require(path.join(REPO, 'src/main/index.js'));
