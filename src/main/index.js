'use strict';

const { app, globalShortcut, screen, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── App identity and the profile folder ─────────────────────────────
// The product is called Occlara. Two things underneath it deliberately still
// say ghostcoach, and they are NOT cosmetic leftovers: appId is what Windows
// and electron-updater match an install on, and the releases repo URL is
// compiled into every client already in the field. Moving either orphans
// every existing user. A brand is what users see; an identity is what the
// software IS.
//
// The profile folder is not in that category, because it can be moved WITH the
// data inside it. It used to be pinned to '%APPDATA%\GhostCoach 2.0' precisely
// because renaming it without moving the contents would point a renamed build
// at an empty directory, and to a player that looks exactly like the app wiped
// their account: no licence, no history, no settings.
app.setName('Occlara');

const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'GhostCoach 2.0');
const USER_DATA        = path.join(app.getPath('appData'), 'Occlara');

// Extracted so it can be tested against real temp directories rather than
// trusted: this is the one piece of startup that can lose a player's licence.
const profileMigration = require('./services/profile-migration');

// OCCLARA_DEV_USERDATA is a dev-only escape hatch: it runs this build against a
// throwaway profile, so a smoke test can boot alongside an installed copy
// without touching its config, license, or session history.
app.setPath('userData', process.env.OCCLARA_DEV_USERDATA || profileMigration.migrate(LEGACY_USER_DATA, USER_DATA, console));

const logger   = require('./logger');
const store    = require('./services/store');
const capture  = require('./services/capture');
const { Recorder, valorantInMatch, valorantKeepSince } = require('./services/recorder');
const recorderWindow = require('./windows/recorder-window');
const CoachingEngine = require('./services/coaching-engine');
const { verifyCoachedMatch, pickCoachedMatch, linkEarly, mayGoOn, linkRetries, RIOT_ROUNDS_RETRY_MS } = require('./services/match-link');
const { normalize: normalizeLang } = require('../shared/i18n');
const registry = require('./windows/registry');
// THE ONE WINDOW (8.1): the shell and every page beside it, replacing the
// panel and the review, library, Settings, Stats and Ask Coach windows.
const mainWindow       = require('./windows/main-window');
const weeklyWindow     = require('./windows/weekly-window');
const learnWindow      = require('./windows/learn-window');
const { LolRecorder }  = require('./services/lol-recorder');
const aiLogWindow      = require('./windows/ailog-window');
const dockWindow       = require('./windows/dock-window');
const activationWindow = require('./windows/activation-window');
const onboardingWindow = require('./windows/onboarding-window');
const splashWindow     = require('./windows/splash-window');
const api              = require('./services/api-client');
const aiLogStore       = require('./services/ai-log-store');
const aiLogTimeline    = require('./services/ai-log-timeline');
const { RivalsEngine } = require('./services/rivals-engine');
const { reconcile: reconcileDeaths, summarise: summariseDeaths, makeCheckCache } = require('./services/death-reconcile');
const tray     = require('./tray');
const hotkeys  = require('./hotkeys');
const registerIpc = require('./ipc/register-ipc');
const licenseService = require('./services/license-service');
const agentData = require('./services/agent-data');
const { API, CAPTURE } = require('../shared/config');
const gameRegistry = require('../shared/games');
const { assembleReport, weekKey, rankIndex, trendDirection } = require('./services/weekly-report');
const updater  = require('./updater');
const C = require('../shared/channels');
const { ReviewStore, newId, MAX_REVIEWS } = require('./services/review-store');
const grader      = require('../shared/grade');
const insightsOf  = require('../shared/insights');
const patternsOf  = require('../shared/patterns');
const breakdownOf = require('../shared/breakdown');
const { Backfill } = require('./services/backfill');
const { RankHistory } = require('./services/rank-history');
const deathFrames = require('../shared/death-frames');
const clips = require('../shared/clips');
const clipScheme = require('./services/clip-scheme');
const reviewClips = require('./services/review-clips');
const lookStills = require('./services/look-stills');

// Every post-match review, for every game. See services/review-store.js.
const reviewStore = new ReviewStore(path.join(app.getPath('userData'), 'reviews'));

// THE CLIPS OF A REVIEW'S MOMENTS (8.3) play in its page's <video> through
// occlara-clip://, served by main alone (services/clip-scheme.js says why, and
// what it refuses). Privileged here, before the app is ready, as Chromium
// requires: without it the scheme is opaque and a <video> cannot stream from
// it. It is handled once the app is ready (below, beside the sweep).
try {
  protocol.registerSchemesAsPrivileged([clipScheme.PRIVILEGED]);
} catch (e) {
  console.warn('[clips] the clip scheme could not be registered:', e.message);
}
// The breakdown reads every saved review of a game, so it is kept until the
// next save or removal rather than read from disk on every repaint.
const breakdownCache = new Map();

// ── Session state ────────────────────────────────────────────────────────────
const state = {
  isCoaching: false,
  isPaused:   false,
  status:     'idle',   // idle | coaching | paused | stopped
  agent:      { agent: null, confirmed: false, role: null }, // detected/confirmed agent
  notice:     null,     // the window's one notice line, never about the match
  cadence:    null,     // the current gap between reads, in ms
  lastGrade:  null,     // { score, letter, game } of the latest reviewed match
  licenseActive: true,  // false once the subscription ends (locks coaching)
  licenseReason: '',    // why it ended (expired | cancelled | payment_failed | ...)
};

let mainLaunched = false;
let surfacesUp   = false;   // main window/tray built; gated behind onboarding on first run
let sealTimer    = null;    // the one second check that seals the main window mid match
let sealHeld     = false;   // recording stopped mid match: sealed until the player opens a page or records again
let appQuitting  = false;
app.on('before-quit', () => { appQuitting = true; });

// ── The match recorded on this PC (8.3) ──────────────────────────────────────
// services/recorder.js says what it does and why; this is only what it is
// wired to. It records Valorant's sessions and League's, whose reviews have
// deaths to clip (clipLooks, clipLolDeaths); a Rivals review is one end of
// match scoreboard, with no moment to show.
//
// THE DEV SWITCHES WORK UNPACKAGED ONLY, so no installed build can be talked
// into recording a canvas instead of the screen, or into giving up early:
//   OCCLARA_FAKE_CAPTURE=1      record a generated canvas, and make every GDI
//                               frame a flat grey one: nothing touches the screen
//                               (=black draws the canvas black)
//   OCCLARA_DEV_RECORDER_MIN_FPS, OCCLARA_DEV_RECORDER_BUSY_MS
//                               the busy rule's frame floor and how long it holds
//   OCCLARA_DEV_RECORDER_PAGE_MS a page's length
const RECORDER_DEV = !app.isPackaged;
const devNumber = (name) => {
  const n = Number(RECORDER_DEV ? process.env[name] : NaN);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
// Read at each recording's start, so one check can draw black for a session.
const fakeCapture = () => {
  const v = RECORDER_DEV ? process.env.OCCLARA_FAKE_CAPTURE : '';
  return v ? (v === 'black' ? 'black' : 'canvas') : null;
};
if (fakeCapture()) capture.setFake(true);
// A match the watch ended can resume within five minutes (match-end.js
// RESUME), and its recording is held until then too, or a resumed match would
// lose what was played after the false end.
const RECORDING_RESUME_MS = 5 * 60 * 1000;
const recorder = new Recorder({
  root: path.join(app.getPath('userData'), 'recording'),
  prefs: store,
  page: () => recorderWindow.open(),
  source: () => recorderWindow.primarySource(),
  gdi: () => capture.captureGdi('standard'),
  capture,
  metrics: recorderWindow.createMetrics(),
  // A Valorant match or a League game in progress: what the PC is judged in.
  // Not matchInProgress() alone for Valorant, the seal's cautious test, which
  // holds through the menus after a match left before round 3 and through a
  // session whose reads all fail (recorder.js valorantInMatch says why).
  inMatch: () => {
    if (engine instanceof CoachingEngine) return valorantInMatch(engine, matchInProgress());
    return engine instanceof LolRecorder && matchInProgress();
  },
  // The match in progress is kept from its start: its hold is only placed once
  // it ends (onValorantMatchEnded, clipLolDeaths). A Valorant one once a read
  // has landed, and ninety minutes back at most (valorantKeepSince).
  keepSince: () => {
    if (engine instanceof CoachingEngine) return valorantKeepSince(engine, matchInProgress(), Date.now());
    if (engine instanceof LolRecorder && engine.live) return engine.liveSince;
    return null;
  },
  // The read's frame, the capture profile in use, which the recording covers.
  // League's screen is never read, so its recording covers the standard frame
  // whatever Performance says (null: recorder.js READ_SIZE), as Settings says.
  readSize: () => {
    if (engine instanceof LolRecorder) return null;
    const p = CAPTURE.profiles[store.get('captureQuality') === 'performance' ? 'performance' : 'standard'];
    return { width: p.targetW, height: p.targetH };
  },
  cadence: () => state.cadence || 1000,
  // League's screen is not read: its review is built from the game's own record.
  still: () => (engine instanceof LolRecorder ? "The review is still built from the game's own record." : null),
  limits: () => ({ minFps: devNumber('OCCLARA_DEV_RECORDER_MIN_FPS'), sustainMs: devNumber('OCCLARA_DEV_RECORDER_BUSY_MS') }),
  pageMs: () => devNumber('OCCLARA_DEV_RECORDER_PAGE_MS'),
  fake: fakeCapture,
  // The app's own version, as api-client.js reads it: run any way but as the
  // app (a check), app.getVersion() is Electron's.
  version: (() => { try { return require('../../package.json').version; } catch { return app.getVersion(); } })(),
  log: (...a) => console.log(...a),
});
// Its only voice: the window's notice line, about capture, never the match.
recorder.on('notice', (n) => {
  if (!n) return;
  if (n.text) pushNotice(n.text, n.kind);
  else if (state.notice && state.notice.kind === n.kind) pushNotice(null);
});
// Out of the recording while one is made: the AI log (the main window is out
// of it while sealed, main-window.js, and the corner mark always is). And
// Settings' status line follows it, from the state.
recorder.on('running', (on) => {
  aiLogWindow.setProtected(on);
  registry.broadcast(C.PUSH_STATE, buildState());
});
// Auto turned itself off: Settings says so, from the state.
recorder.on('prefs', () => registry.broadcast(C.PUSH_STATE, buildState()));
// The recording's frame rate moved past its rounding (Settings' "about 30
// fps"), or this session stopped recording and Settings gives the reason.
recorder.on('view', () => registry.broadcast(C.PUSH_STATE, buildState()));
// WINDOWS ENDING ITS SESSION (a shutdown, a restart, a logoff) emits no
// before-quit, and Occlara sits in the tray with no login item, so the
// recording stayed on disk until the player opened the app again by hand.
// The main window hears it ('session-end') and the recording ends at once,
// deleted before the handler returns, since Windows can end the process next.
mainWindow.onSessionEnd(() => recorder.shutdown({ exiting: true }));
// AND EVERY QUIT, not the tray's alone: an update's "Restart now" (updater.js
// quitAndInstall) quits without cleanupAndQuit, so its session ended with no
// counts, Settings kept the session before's reason, and the recording waited
// for the next launch's sweep. before-quit comes first in every quit; after
// cleanupAndQuit's own shutdown it finds nothing to end.
app.on('before-quit', () => {
  try { recorder.shutdown({ exiting: true }); } catch (e) { console.warn('[recorder] shutdown at quit:', e.message); }
});
// COUNTS FOR THE DEVELOPER, one block a session (recorder.js reportBlock): how
// PCs cope, never what was on them. Never in the way of anything: it waits
// for nothing, and a block is posted once, and once more at the next launch
// only if that post was not taken, never in a loop.
//
// KEPT BEFORE IT IS SENT. A session ended by Quit, a logout or Windows ending
// its session ends in recorder.shutdown() with app.quit() straight after, and
// the post raced the exit: those sessions, the usual way a tray app ends, were
// missing from the counts the recorder's thresholds are tuned from. So the
// newest block is kept (recordingReportPending, one at most) until the server
// takes it, and the next launch sends the one a quit left (sendPendingReport).
//
// AND AS THE APP GOES, ONLY KEPT. A block handed out as the process ends (a
// quit, Windows ending its session: shutdown's `exiting`; not a logout, after
// which the app goes on) is not posted then: raced with the exit, the post
// can reach the server and lose its answer, and the next launch sent the
// same session again, counted twice. The next launch posts it, once.
let reportSeq = 0;
recorder.on('report', (block, how) => {
  if (!block) return;
  const kept = { at: Date.now(), n: ++reportSeq, block };
  store.set('recordingReportPending', kept);
  if (!(how && how.exiting)) sendReport(kept);
});

/** One kept block to the server; taken, it is let go, unless a newer one has replaced it. */
function sendReport(kept) {
  const key = store.get('licenseKey');
  if (!key || !kept || !kept.block) return;
  api.post('/api/coach/session-report', kept.block, key, 8000).then((r) => {
    const now = store.get('recordingReportPending');
    if (r && r.ok && now && now.at === kept.at && now.n === kept.n) store.set('recordingReportPending', null);
  }).catch(() => {});
}

let pendingReportSent = false;
/** At launch, once the licence key is known: the block a quit left, sent once. */
function sendPendingReport() {
  if (pendingReportSent || !store.get('licenseKey')) return;
  const kept = store.get('recordingReportPending');
  if (!kept || typeof kept !== 'object' || !kept.block) return;
  pendingReportSent = true;
  sendReport(kept);
}

// The player's 4 most-played agent names, for the one-tap agent-select bubble.
// Four is what the bubble's width actually fits on one row.
// Guarded by Riot ID so a switched account never offers the old player's mains.
function topAgentNames() {
  const ps = store.get('playerStats');
  const rid = (store.get('riotId') || '').trim();
  if (!ps || ps._riotId !== rid || !Array.isArray(ps.topAgents)) return [];
  return ps.topAgents.slice(0, 4).map((a) => a && a.name).filter(Boolean);
}

function buildState() {
  return {
    isCoaching: state.isCoaching,
    isPaused:   state.isPaused,
    status:     state.status,
    // Was hardcoded to 'Valorant', which made this field a lie the moment a
    // second game existed. Nothing was reading it, so the bug was invisible;
    // gameId is what the panel gates its Learn entry on, so it has to be true.
    game:       gameRegistry.get(store.get('game')).label,
    gameId:     gameRegistry.get(store.get('game')).id,
    // The window's notice line: a licence ending, capture blocked, the
    // server unreachable. Nothing the coach thinks about the match, ever.
    notice:     state.notice,
    // How often the game is being read right now, and how it was chosen.
    cadence:    state.cadence,
    captureSpeed: store.get('captureSpeed') || 'auto',
    lastGrade:  state.lastGrade,
    agent:      state.agent,
    licenseActive: state.licenseActive,
    licenseReason: state.licenseReason,
    riotId:          (store.get('riotId') || '').trim(),
    topAgents:       topAgentNames(),   // player's 3 most-played, for one-tap agent select
    sounds:          store.get('sounds'),
    licensePlan:     store.get('licensePlan'),
    licenseStatus:   store.get('licenseStatus'),
    licenseExpiry:   store.get('licenseExpiry'),
    // The match recorder's setting, why Auto is off if it turned itself off,
    // and whether a recording is being made: Settings paints from it. About
    // the capture only, never the match.
    recording:       recorder.view(),
  };
}

// The minimize hint is gone with the panel (8.1). It existed because an
// always-on-top panel left on screen could swallow a click mid aim; the main
// window sits behind the game like any other app, so there is nothing to tuck
// away.

/**
 * Is a Valorant match being played right now, as opposed to the session merely
 * running? Between matches the session is still on, the watch has ended the
 * last match, and nothing is being coached, so the review may be opened.
 */
function matchInProgress() {
  if (!state.isCoaching || !engine) return false;
  // League records from the game client's own API, live while a game is on.
  if (engine instanceof LolRecorder) return !!engine.live;
  // Rivals reads hero select and the end screen; what is between them, the
  // screens it is told to skip, is the match.
  if (engine instanceof RivalsEngine) return engine.seen === 'away' || engine.seen === 'select';
  if (!engine.endWatch) return false;
  if (engine.endWatch.ended) return false;
  // Before the first round of the session, a menu is just a menu.
  return engine.ledger.size() > 0 || !engine.inLobby;
}

/**
 * The session log is closed to every viewer while its match is in progress.
 * The log shows what was read off the screen frame by frame, so an open log on
 * a second monitor would be a live feed of the match by another name.
 */
function liveLogSealed() {
  // Only the Valorant reader writes the log. A League game or a Rivals match
  // in progress has nothing in it to seal, and sealing hid the finished
  // Valorant session behind them.
  return engine instanceof CoachingEngine && matchInProgress();
}

/**
 * The window's notice line: a licence ending, capture blocked, the server
 * unreachable. There is no tip stream any more; Occlara says nothing about the
 * match until the review.
 */
function pushNotice(text, kind) {
  state.notice = text ? { text: String(text), at: Date.now(), kind: kind || null } : null;
  registry.broadcast(C.PUSH_STATE, buildState());
}

function setStatus(status) {
  state.status = status;
  registry.broadcast(C.PUSH_STATUS, { status });
  registry.broadcast(C.PUSH_STATE, buildState());
  tray.update(state.isCoaching, trayActions);
}

// ── The match library ────────────────────────────────────────────────────────
/**
 * Keep a review and tell every surface. Called on EVERY version of a review,
 * because the Valorant one improves twice after it first opens, and the saved
 * copy must be the best one. The frames it looked at go beside it, so the
 * library can show the moment long after the AI log has rolled past it.
 */
function saveReview(review, game, frames) {
  if (!review || !review.id) return;
  try {
    const { frameData, ...clean } = review;
    const meta = reviewStore.save({ id: review.id, game, at: review.at || Date.now(), review: clean, frames });
    breakdownCache.clear();
    // THE PANEL'S "LAST MATCH" IS THE NEWEST GRADED MATCH IN THE LIBRARY, the
    // rule the startup and a withdrawn review already use. An older match
    // graded after the fact (Riot's record, a late link) never takes it, and
    // the newest one re-graded updates it.
    if (meta) {
      const top = reviewStore.list().find((r) => r.grade);
      state.lastGrade = top ? { ...top.grade, game: top.game, id: top.id } : null;
    }
    registry.broadcast(C.PUSH_REVIEWS, { id: review.id, game });
    registry.broadcast(C.PUSH_STATE, buildState());
  } catch (e) {
    console.error('[reviews] save failed:', e.message);
  }
}

// ── Grading recent matches from Riot's record ────────────────────────────────
// backfill.js says what it does and why. This is only what it is wired to.
const backfill = new Backfill({
  get: (p, timeoutMs) => api.get(p, store.get('licenseKey'), timeoutMs),
  library: () => reviewStore.list('valorant').map((meta) => ({
    meta,
    // The whole review only where the plan reads one: those not checked
    // against Riot yet, linked or not.
    review: meta.source !== 'riot' && (!meta.matchId || !meta.verified)
      ? ((reviewStore.get(meta.id) || {}).review || null) : null,
  })),
  // The index alone for "linked already?", and the one review an upgrade
  // rewrites read whole, so a run never re-reads the library per match.
  metas: () => reviewStore.list('valorant'),
  whole: (id) => ((reviewStore.get(id) || {}).review || null),
  activeIds: () => new Set([...reviewJobs.values()].map((j) => j.id)),
  // A review a run takes back (backfill.js takeBack()): out of the library and
  // every window, and off the panel if it was the last grade.
  remove: (id) => {
    reviewStore.remove(id);
    breakdownCache.clear();
    // Open from Matches, it stayed painted, and Ctrl+Shift+E opened it again.
    if (lastReviewShown && lastReviewShown.id === id) {
      lastReviewShown = null;
      leaveReview();
    }
    if (state.lastGrade && state.lastGrade.id === id) {
      const top = reviewStore.list().find((r) => r.grade);
      state.lastGrade = top ? { ...top.grade, game: top.game, id: top.id } : null;
    }
    registry.broadcast(C.PUSH_REVIEWS, { id, game: 'valorant', removed: true });
    registry.broadcast(C.PUSH_STATE, buildState());
  },
  // What saving a new review pushes out of the full library, of any game,
  // read whole with its kept frames before the save deletes it, and saved
  // again whole when a run takes back what it did (backfill.js takeBack()).
  evicts: (review) => reviewStore.pushedOutBy(review.id, review.at).map((id) => {
    const e = reviewStore.get(id);
    return e ? { id: e.id, game: e.game, at: e.at, review: e.review, frames: reviewStore.framesOf(id) } : null;
  }).filter(Boolean),
  restore: (entry) => {
    reviewStore.save(entry);
    breakdownCache.clear();
    // Open in the window, it repaints as it was put back.
    if (lastReviewShown && lastReviewShown.id === entry.id) showReview(withFrames(entry.review));
    const top = reviewStore.list().find((r) => r.grade);
    state.lastGrade = top ? { ...top.grade, game: top.game, id: top.id } : null;
    registry.broadcast(C.PUSH_REVIEWS, { id: entry.id, game: entry.game });
    registry.broadcast(C.PUSH_STATE, buildState());
  },
  // The Riot ID in Settings: a run for any other account stops (backfill.js).
  account: () => (store.get('riotId') || '').trim(),
  // Whether a review dated `at` would survive the library's cap, which prunes
  // the oldest of every game on each save.
  keeps: (at) => {
    const rows = reviewStore.list();
    return rows.length < MAX_REVIEWS || at > rows[rows.length - 1].at;
  },
  save: (review) => {
    saveReview(review, 'valorant', null);
    // saveReview swallows a failed write, so what landed is read back: THIS
    // version, not just the id, because an upgrade whose write failed leaves
    // the old unlinked review under the same id. A review that is not in the
    // library is not counted as graded, and gets no baseline row.
    const back = reviewStore.get(review.id);
    if (!back || back.review.matchId !== review.matchId || !!back.review.verified !== !!review.verified) {
      throw new Error('the review was not saved');
    }
    // A RECORDING UPGRADED IN PLACE KEEPS THE CLIPS ITS CARDS NAME (8.3). The
    // upgrade drops a look at a death Riot says never happened (riot-review.js
    // upgradeWatched: the real Abyss round 17), and its clip stayed on disk,
    // played by nothing, counted in Settings and against the cap until the cap
    // or Clear clips took it. None is still being cut: a review whose work is
    // going on is never upgraded (activeIds). Saved by now, so a clip that will
    // not go is no failed save.
    if (review.lateLinked) {
      try { reviewStore.keepClips(review.id, reviewClips.namedClips(review)); } catch (e) { console.log('[clips] keepClips:', e.message); }
    }
    // A recording upgraded with Riot's record while its window is open
    // repaints there, rather than staying on the version Riot just corrected.
    if (lastReviewShown && lastReviewShown.id === review.id) showReview(withFrames(review));
  },
  history: {
    get: () => store.get('valorantHistory') || [],
    set: (rows) => store.set('valorantHistory', rows),
  },
  // When the last late link started, kept across launches, so it runs once
  // in six hours however often the app is opened (backfill.js late()).
  lateAt: {
    get: () => store.get('lateLinkAt') || 0,
    set: (at) => store.set('lateLinkAt', at),
  },
  inMatch: () => matchInProgress(),
  onStatus: (s) => {
    // A run that listed its matches proves the account exists, whether or not
    // Riot has a ranked profile for it, so the Riot ID is remembered as
    // connected: the tour shown again and Settings say so without a Connect.
    if ((s.state === 'grading' || s.state === 'done') && s.account && store.get('riotConnected') !== s.account) {
      store.set('riotConnected', s.account);
    }
    // And one Riot says does not exist is connected no longer.
    if (s.state === 'error' && s.error === 'not-found' && s.account) forgetRiotId(s.account);
    registry.broadcast(C.PUSH_BACKFILL, s);
  },
  // Not while recording: the panel's line then says it is recording, and that
  // matters more than a library update.
  notice: (text) => { if (!state.isCoaching) pushNotice(text, 'review'); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (...a) => console.log(...a),
});

/** A saved review with its kept frames attached as data URLs, for the window. */
function withFrames(review) {
  if (!review || !review.id) return review;
  const names = new Set();
  for (const card of review.rounds || []) {
    for (const n of (card && card.forensics && card.forensics.frames) || []) names.add(n);
  }
  if (!names.size) return review;
  const frameData = {};
  for (const n of names) {
    const b64 = reviewStore.frame(review.id, n);
    if (b64) frameData[n] = `data:image/jpeg;base64,${b64}`;
  }
  return { ...review, frameData };
}

/**
 * THE SEAL FOLLOWS THE MATCH. While one is in progress the main window shows
 * no page at all, only the Recording screen (main-window.js): an open page on
 * a second monitor would otherwise be the live feed the policy forbids.
 * Checked on a one second tick and before every page is opened, so the review
 * of the match that just ended never waits behind a seal for a tick.
 *
 * A STOP IN THE MIDDLE OF A MATCH HOLDS IT (sealHeld). Not recording, there is
 * no telling when that match ends, and Home would paint its review, the
 * focus for the next match included, while it is still being played. So the
 * seal stays, with the sidebar open, until the player opens a page: their
 * own choice, as opening Matches was before 8.1. Or until they record again,
 * in any game, whose own match the seal then follows (controller.start()).
 */
function syncSeal() {
  const live = !!state.isCoaching && matchInProgress();
  mainWindow.setSealed(live || sealHeld, { held: !live && sealHeld });
}

/**
 * Open a page of the main window, the seal settled first. Every page opened
 * while not recording is the player's own choice (a review opening by itself
 * needs a recording that saw the match end), so it lifts a held seal.
 */
function openPage(id, opts) {
  if (!state.isCoaching) sealHeld = false;
  syncSeal();
  return mainWindow.show(id, opts);
}

/**
 * A review taken out of the library leaves the page that showed it.
 * @param opts.outOfTheWay  withdrawn because its match carries on: the window
 *   that came forward for it gets out of the game's way, as the review window
 *   used to close
 */
function leaveReview(opts) {
  const w = mainWindow.get();
  if (!w || mainWindow.current().page !== 'review') return;
  mainWindow.show('home', { reveal: false });
  if (opts && opts.outOfTheWay && w.isFocused() && !w.isMinimized()) w.minimize();
}

/**
 * Out of sight (Ctrl+Shift+M, its X, Alt+F4), the main window leaves a small
 * click-through mark in the corner of the screen to say Occlara is still
 * running; it never catches the cursor. Back by any path (a page opened, the
 * tray, a second launch) the mark goes. The tray's Show or Hide follows both.
 */
function onMainWindow(kind) {
  if (appQuitting) return;
  if (kind === 'hide') {
    const wa = screen.getPrimaryDisplay().workArea;
    dockWindow.showAt({ x: wa.x + wa.width - dockWindow.SIZE - 16, y: wa.y + 16 });
  } else if (kind === 'show') {
    dockWindow.hide();
  }
  if (surfacesUp) {
    try { tray.update(state.isCoaching, trayActions); } catch (e) { console.warn('[tray] update:', e.message); }
  }
}
mainWindow.onWindowChange(onMainWindow);

/**
 * THE ONE WAY A REVIEW REACHES A WINDOW. Every review a renderer is handed,
 * live or saved, any game, passes through here first: showReview's push, and
 * the review page and Home asking for one (getReview, getLolReview). So what
 * a page may be shown is decided once, here, and not in each surface or in
 * each saved file.
 *
 * Returns a copy; the review main holds is never changed, because the repaint
 * paths tell one version from the next by the object they hold.
 *
 * A study note is its text and nothing else. Reviews saved before 8.2 kept the
 * name of whoever a note was imported from beside it, and the app never says
 * where its knowledge comes from (check:attribution).
 *
 * A Valorant review is in today's words (valorant-review.js served()). One
 * graded from Riot's record alone states facts, whenever it was saved: 8.0.3
 * and 8.1 saved theirs with fix lines and titles that claim what Riot never
 * records, and they are converted here rather than on disk.
 *
 * Its place in the AI log leaves as one word, 'kept', 'gone' or null, for the
 * eye on its page (8.2): which session and which frames are main's to find
 * (REVIEW_AILOG), never a page's.
 *
 * And its clips (8.3): each one a card names is played from occlara-clip
 * while it is on disk (clipUrl), and said to be cleared, for space or from
 * Settings, once it is not (clipGone). Asked of the disk each time, because
 * the cap takes the oldest reviews' clips whenever a new one is kept.
 */
function present(review) {
  if (!review || typeof review !== 'object') return review;
  const { served } = require('../shared/valorant-review');
  const out = { ...served(review) };
  if (Array.isArray(review.study)) {
    out.study = review.study.filter((n) => n && typeof n.text === 'string' && n.text).map((n) => ({ text: n.text }));
  }
  out.aiLog = aiLogStateOf(reviewLogEntry(review, review.at));
  if (!review.id) return out;
  return reviewClips.presentClips(out, {
    has: (name) => reviewStore.hasClip(review.id, name),
    url: (name) => clipScheme.urlFor(review.id, name),
  });
}

/** Paint a review in the review window, whichever game it is from. */
function showReview(review) {
  if (!review) return;
  // Held as main has it, so the repaint paths still recognise what is on
  // screen; only the copy that leaves for the window is presented.
  lastReviewShown = review;
  const ch = review.kind === 'valorant' ? C.PUSH_VALORANT_REVIEW
    : review.kind === 'rivals' ? C.PUSH_RIVALS_REVIEW : C.PUSH_LOL_REVIEW;
  registry.broadcast(ch, present(review));
}

// ── The Valorant post-match review ───────────────────────────────────────────
/**
 * The engine says a match is over, or coaching was stopped mid match.
 *
 * THE WINDOW OPENS AT ONCE and fills in later. Riot publishes the match a few
 * minutes after it ends, so waiting for the scoreboard before showing anything
 * meant a player who had already queued again never saw their review. The
 * computed half (rounds, patterns) and the coach's read are ready now; the
 * scoreboard and the comparison against the player's own average land when
 * the tracker can verify it is THIS match, and the review repaints.
 */
function buildValorantReview(snap, tracker, extra) {
  const valorantReview = require('../shared/valorant-review');
  const ai = snap.ai || {};
  const agent = snap.context && snap.context.agent;
  const role = agent ? agentData.getRole(agent) : null;
  const built = valorantReview.build({
    rounds: snap.rounds,
    context: snap.context,
    endedBy: snap.endedBy,
    ai: {
      // summary, never review: the server fills review with placeholder text
      // when the model fails, and that was painted as the coach's read.
      summary: ai.summary || null,
      rounds: ai.rounds || {},
      focus: ai.focus || null,
      study: Array.isArray(ai.study) ? ai.study : [],
    },
    tracker,
    role,
    history: (extra && extra.history) || store.get('valorantHistory') || [],
    verification: extra && extra.verification,
    riotMe: extra && extra.riotMe,
    // Riot's name for the queue, so the review says Competitive or Unrated
    // rather than the screen's guess at the mode.
    queue: (extra && extra.queue) || (tracker && tracker.mode) || null,
    riotIdSet: (store.get('riotId') || '').includes('#'),
    linkMissing: (extra && extra.linkMissing) || false,
  });
  // narrativeComing: the first version, saved before the narrative call, says
  // nothing about the narrative rather than that it failed.
  built.aiUnavailable = !snap.ai && !(extra && (extra.narrativePending || extra.narrativeComing));
  built.narrativePending = !!(extra && extra.narrativePending);
  built.thin = !!ai.thin;
  // The Riot match this review is linked to, so no other review links it too.
  built.matchId = (tracker && tracker.matchId) || null;
  // Recording stopped mid match: the link rules above treat it as a part.
  built.stoppedLive = !!snap.stoppedLive;
  // What a later Riot link needs, kept only while Riot's record is missing:
  // a Riot ID added after this review's link gave up can still grade it
  // (riot-review.js, backfill.js).
  built.ledger = built.verified ? null : valorantReview.ledgerOf(snap);
  return { built, role };
}

/**
 * Riot's round by round record of a linked match, or null.
 *
 * Only ever called with a match fetchCoachedMatch has already VERIFIED as the
 * one this session watched, so a round list from someone else's game can never
 * be laid over this review.
 */
async function riotRoundsFor(lm) {
  const riotId = (store.get('riotId') || '').trim();
  if (!lm || !lm.matchId || !riotId.includes('#')) return null;
  try {
    const { ok, data } = await api.get(
      `/api/coach/match-rounds?matchId=${encodeURIComponent(lm.matchId)}&username=${encodeURIComponent(riotId)}`,
      store.get('licenseKey'), 30000);
    if (!ok || !data || data.error || !Array.isArray(data.perRound) || !data.perRound.length) {
      console.log('[review] no Riot round record:', (data && data.error) || 'no answer');
      return null;
    }
    return data;
  } catch (e) {
    console.log('[review] Riot round record failed:', e.message);
    return null;
  }
}

/**
 * The coach's look at the deaths worth teaching: frames of each one, sent to
 * the server with the facts about it (death-forensics.js), and a cause from a
 * closed list back. Four deaths at most, one call each.
 *
 * Riot's verified deaths by default, timed by Riot's record against the
 * round's own clock (death-frames.js deathMoment). With `opts.source` 'screen'
 * (8.2), the deaths the screen saw in a review Riot's record never reached,
 * timed by when the screen read each one, and the server is told so: it then
 * claims no second and names no killer.
 *
 * THE LOOK SEES THE RECORDING (8.3.1). The clip of each moment is cut first,
 * while the match's recording is held (clipLooks), and the look is sent a few
 * stills of it around the death (recordingStills, clips.LOOK_AT) with their
 * seconds from it: on the real Sunset match the two frames the live read took
 * showed none of its four fights, and all four looks came back unclear. A
 * death with no clip (not recorded, Off, no AI log hold) is sent the read's
 * frames around it, as before. Only stills leave the PC.
 *
 * `opts.job` is the review the look is for, whose clips it cuts and keeps,
 * and `opts.stale` says when a newer look has taken over, which then keeps
 * its own (the screen's look is stale once Riot's begins).
 *
 * Returns { byRound: { n: { cause, what, better, frames, frameAt, framesFrom,
 * source, at, moment, clip } }, frames: { name: b64 } }: frames in time order,
 * frameAt each one's seconds from the death when the look knew it, framesFrom
 * 'recording' or 'reads', `at` when the first frame was taken, `moment` when
 * the death was. Empty, never an error, when there are no frames: the AI log
 * was off, or the deaths were in rounds the coach never saw.
 */
async function forensicsFor(rounds, snap, opts) {
  const source = opts && opts.source === 'screen' ? 'screen' : 'riot';
  const job = (opts && opts.job) || null;
  const stale = opts && typeof opts.stale === 'function' ? opts.stale : () => false;
  const empty = { byRound: {}, frames: {} };
  const log = snap.log;
  if (!log || !log.dir || !log.records.length) return empty;
  const looks = deathFrames.looksFor(log.records, rounds, { from: snap.startedAt, to: snap.endedAt }, source);
  const cut = job ? await clipLooks(job, looks, stale) : new Map();
  if (stale()) return empty;
  // Riot's look has its clips, the review's to keep: the recording goes now,
  // never held through the wait for a match in progress (recordingCut).
  if (job && source === 'riot') recordingCut(job, cut);
  const stills = cut.size ? await recordingStills(job, looks, cut, source, stale) : new Map();
  if (stale()) return empty;
  const looked = await askForensics(looks, stills, snap, source, log);
  if (stale()) return empty;
  if (job) keepLookClips(job, looked, cut);
  return looked;
}

/** The look's call to the server, from the stills of the recording where there are some and the read's frames elsewhere. */
async function askForensics(looks, stills, snap, source, log) {
  const empty = { byRound: {}, frames: {} };
  const deaths = [];
  const kept = {};
  for (const look of looks) {
    const r = look.round;
    const moment = clips.momentOf(look);
    const imgs = [];
    const names = [];
    let frameAt = [];
    let framesFrom = 'reads';
    const shot = stills.get(r.n);
    if (shot && shot.length) {
      framesFrom = 'recording';
      shot.forEach((s, k) => {
        const name = clips.stillName(r.n, k + 1, s.at);
        if (!name) return;
        const b64 = s.jpeg.toString('base64');
        imgs.push(b64);
        names.push(name);
        frameAt.push(s.at);
        kept[name] = b64;
      });
    } else {
      look.frames.forEach((rec, i) => {
        try {
          const b64 = fs.readFileSync(path.join(log.dir, rec.frame)).toString('base64');
          const name = look.names[i];
          imgs.push(b64);
          names.push(name);
          kept[name] = b64;
          if (Array.isArray(look.frameAt) && Number.isFinite(look.frameAt[i])) frameAt.push(look.frameAt[i]);
        } catch {}
      });
    }
    if (!imgs.length) continue;
    // Each frame's seconds from the death, where the look knows when the death
    // was: Riot's, or the stills, which are taken at seconds from the moment.
    if (frameAt.length !== names.length) frameAt = null;
    // A ledger row carries none of Riot's facts, so a look from the screen
    // sends its round, side, spot and plant alone.
    deaths.push({
      n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
      firstDeath: r.firstDeath, traded: r.traded, alive: r.aliveAtDeath,
      planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot, frames: imgs, names,
      gap: framesFrom === 'recording' ? null : look.gap,
      frameAt, framesFrom,
      // When the first frame was taken, for the eye at that moment, and when
      // the death itself was: kept here, never sent.
      at: framesFrom === 'recording' && Number.isFinite(moment) ? Math.round(moment + frameAt[0] * 1000) : look.at,
      moment,
    });
  }
  if (!deaths.length) return empty;
  try {
    const body = {
      // From the screen, only an agent the player confirmed, the rule the
      // engine keeps: one detected while spectating names a teammate, and the
      // ability gate would then pass that teammate's kit as the player's.
      // Riot's look is handed Riot's agent.
      agent: source === 'screen' && !snap.context.agentConfirmed ? null : snap.context.agent,
      map: snap.context.map, language: snap.context.language || 'en',
      source,
      deaths: deaths.map(({ names, at, moment, frames, frameAt, framesFrom, ...d }) => {
        if (!frameAt) return { ...d, frames };
        // The last frame before the death and the first after it lead, as the
        // two a server from before 8.3.1 keeps and reads (look-stills.js).
        const order = lookStills.sendOrder(frameAt);
        return { ...d, frames: order.map((i) => frames[i]), frameAt: order.map((i) => frameAt[i]), framesFrom };
      }),
    };
    const { ok, data } = await api.post(API.DEATH_FORENSICS, body, store.get('licenseKey'), 60000);
    if (!ok || !data || !Array.isArray(data.deaths)) {
      console.log('[review] death forensics unavailable:', (data && data.error) || 'no answer');
      return empty;
    }
    const out = { byRound: {}, frames: {} };
    for (const f of data.deaths) {
      const d = deaths.find((x) => x.n === f.n);
      if (!d || f.failed) continue;
      out.byRound[f.n] = {
        cause: f.cause, what: f.what || null, better: f.better || null, frames: d.names,
        ...(d.frameAt ? { frameAt: d.frameAt } : {}), framesFrom: d.framesFrom,
        source, at: typeof d.at === 'number' ? d.at : null, moment: typeof d.moment === 'number' ? d.moment : null,
      };
      for (const name of d.names) out.frames[name] = kept[name];
    }
    console.log(`[review] death forensics${source === 'screen' ? ' from the screen' : ''}: `
      + `${Object.entries(out.byRound).map(([n, f]) => `R${n} ${f.cause} (${f.frames.length} ${f.framesFrom === 'recording' ? 'from the recording' : 'read'})`).join(', ')}`);
    return out;
  } catch (e) {
    console.log('[review] death forensics failed:', e.message);
    return empty;
  }
}

/*
 * NEVER WHILE A MATCH IS BEING PLAYED (8.3.1). Decoding a clip is work for the
 * PC, and the look waits for the match in progress to end before it takes its
 * stills: Riot publishes a match 90 s to four minutes after it, by which time
 * the next one may be under way. Nobody sees the review mid match, so the
 * wait costs nothing on screen. An hour at most, the holds' own limit
 * (aiLogStore.HOLD_MAX_MS); past it, or with the review withdrawn, the read's
 * frames are sent.
 */
const AFTER_MATCH_MAX_MS = 60 * 60 * 1000;
const AFTER_MATCH_POLL_MS = 2000;
async function afterMatch(stop) {
  const end = Date.now() + AFTER_MATCH_MAX_MS;
  let said = false;
  while (matchInProgress()) {
    if (stop() || Date.now() > end) return false;
    if (!said) { said = true; console.log('[review] a match is being played: the look waits for it to end'); }
    await new Promise((resolve) => setTimeout(resolve, AFTER_MATCH_POLL_MS));
  }
  return !stop();
}

/**
 * The stills of each clipped moment (look-stills.js): from the clip kept
 * beside the review, at clips.LOOK_AT's seconds from the death, decoded in the
 * frames page (windows/frames-window.js), opened for this and closed after it,
 * never while a match is in progress. Map n -> [{ at, jpeg }], for the deaths
 * that got any.
 *
 * None once the player chose Off meanwhile (cutsClips): the look is then sent
 * the read's frames, as a look taken after Off is, and keeps no clip
 * (keepLookClips).
 */
async function recordingStills(job, looks, cut, source, stale) {
  const out = new Map();
  const offsets = clips.LOOK_AT[source === 'screen' ? 'screen' : 'riot'];
  const prof = (CAPTURE.profiles && CAPTURE.profiles.standard) || { targetW: 1280, targetH: 720, jpegQuality: 70 };
  const off = () => !clips.cutsClips(store);
  const stop = () => job.cancelled || stale() || off();
  let page = null;
  const t0 = Date.now();
  try {
    for (const look of looks) {
      const c = cut.get(look.round.n);
      // Riot's look only around Riot's own death on the wall clock, the
      // screen's around its read of it (clips.stillsMomentOf); a death with
      // neither is sent the read's frames.
      const moment = clips.stillsMomentOf(look, source);
      if (!c || !Number.isFinite(c.startWall) || !Number.isFinite(moment)) continue;
      if (matchInProgress() && page) { page.close(); page = null; }
      if (!(await afterMatch(stop))) break;
      let bytes = null;
      try { bytes = fs.readFileSync(reviewStore.clipFile(job.id, c.name)); } catch { bytes = null; }
      if (!bytes) continue;
      if (!page) {
        try { page = await require('./windows/frames-window').open(); } catch (e) {
          console.log('[review] the frames page did not open:', e.message);
          break;
        }
      }
      const got = await lookStills.stillsOf({
        bytes, startWall: c.startWall, moment, offsets, decode: (j) => page.decode(j),
        size: { width: prof.targetW, height: prof.targetH, quality: prof.jpegQuality / 100 },
      });
      if (got.length) out.set(look.round.n, got);
    }
  } finally {
    if (page) page.close();
  }
  if (off()) {
    console.log(`[review] ${job.id}: Off was chosen while the look was out, no stills from the recording`);
    return new Map();
  }
  if (cut.size) {
    console.log(`[review] ${job.id}: stills from the recording for ${out.size} of ${cut.size} clipped deaths`
      + ` (${[...out.values()].reduce((n, s) => n + s.length, 0)} frames, ${Date.now() - t0} ms)`);
  }
  return out;
}

/**
 * THE COACH'S LOOK WHEN RIOT'S RECORD IS NOT COMING (8.2). Frames reached a
 * review only through Riot's verified deaths, so a review Riot's record never
 * reached showed no picture, though the AI log kept the frames around every
 * death the screen registered. Those deaths are looked at instead
 * (forensicsFor with source 'screen'), and the review repaints with them,
 * its frames saved beside it as Riot's looks are.
 *
 * ONCE A REVIEW, NEVER OVER RIOT'S. It runs right after the narrative when no
 * Riot ID is set, since nothing will say when the player died, and otherwise
 * when the link gives up without Riot's rounds (done() in linkRiotRecord), and
 * always before the review's frames are let go, because it reads them off
 * disk. A look from Riot's record that lands first, or while this one is out,
 * is the one kept.
 */
function screenLook(job) {
  if (!job.screenLook) {
    job.screenLook = lookFromScreen(job).catch((e) => console.log('[review] the look from the screen failed:', e.message));
  }
  return job.screenLook;
}

async function lookFromScreen(job) {
  if (job.cancelled || job.riotLooked) return;
  const snap = job.snap;
  // Its clips are cut and kept by the look itself, never over Riot's look,
  // which is the one kept whenever it lands.
  const looked = await forensicsFor(snap.rounds, snap,
    { source: 'screen', job, stale: () => job.cancelled || job.riotBusy || job.riotLooked });
  // Riot's rounds landed while this look was out. Theirs is painted, and if it
  // fails after all, the link's end looks again.
  if (job.riotBusy) { job.screenLook = null; return; }
  if (job.cancelled || job.riotLooked || !Object.keys(looked.byRound).length) return;
  // On the ledger's own rows, so a version built after this one (a scoreboard
  // linked late) still carries the looks. Riot's reconcile builds its rounds
  // afresh and keeps none of them.
  for (const r of snap.rounds) if (looked.byRound[r.n]) r.forensics = looked.byRound[r.n];
  // Built as the version on screen was: its scoreboard if one linked, and the
  // reason Riot's record is missing if the link gave up.
  repaintReview(job, buildValorantReview(snap, job.tracker || null,
    { history: job.history, linkMissing: job.linkMissing || false }).built, looked.frames);
}

/**
 * THE CLIPS OF A LOOK'S MOMENTS (8.3): cut out of the match's recording while
 * its hold still keeps the pages (let go once Riot's look has cut its clips,
 * recordingCut, or else when the link is done, releaseMatchHolds),
 * kept beside the review (review-store.js saveClip), and named on the look
 * (`clip`), which its card then plays. 11 seconds before each death to 4
 * after it (shared/clips.js), six a review at most, then the cap. Since 8.3.1
 * they are cut BEFORE the look is sent, which takes its stills from them
 * (recordingStills), and named once it answers (keepLookClips).
 *
 * A match the recorder did not record (Off, given up as busy, a PC with no
 * hardware encoder, a death before the recording began) has no clip, and its
 * moments show their frames as they always have.
 *
 * NOR ONCE THE PLAYER CHOSE OFF, whatever the recorder still holds of a match
 * already played (shared/clips.js cutsClips): recorder.js lets its recordings
 * go when it is told of Off, and this holds where it was not. Riot's look
 * landing minutes after Off cut its clips out of the match's held recording
 * and kept them beside the review.
 *
 * ONE LOOK'S CLIPS AT A TIME, a review's later look after its earlier one,
 * and only while that look is still the one the review will keep (`stale`):
 * the screen's look and Riot's could otherwise both be cutting, the screen's
 * finishing last, and the review keeping Riot's cards with the screen's clips
 * in place of theirs. The last look's are the ones kept, and a clip an earlier
 * look cut of a round this one did not choose goes (keepClips).
 *
 * Resolves Map n -> { name, startWall }: the clips cut, and where each one's
 * own 0 is on the wall clock.
 */
function clipLooks(job, looks, stale) {
  const run = () => cutLookClips(job, looks, stale);
  const cut = (job.clipping || Promise.resolve()).then(run, run)
    .catch((e) => { console.log('[clips] the clips could not be cut:', e.message); return new Map(); });
  job.clipping = cut;
  return cut;
}

async function cutLookClips(job, looks, stale) {
  const cut = new Map();
  if (stale()) return cut;
  // Off: nothing is cut. The look is still the review's last, so its cards
  // name no clip, and an earlier look's clips go once it answers, as they do
  // when the recording holds none of this one's moments.
  const off = () => !clips.cutsClips(store);
  if (off()) {
    console.log(`[clips] ${job.id}: Off was chosen, no clip cut`);
    return cut;
  }
  const wanted = (looks || [])
    .map((l) => ({ key: l.round.n, name: clips.roundClip(l.round.n), moment: clips.momentOf(l) }))
    .filter((l) => l.name && Number.isFinite(l.moment))
    .sort((a, b) => a.key - b.key);
  if (!wanted.length) return cut;
  // The recording let go once Riot's look had cut its clips (recordingCut):
  // a look after it takes those clips, the rounds it wants that they are of,
  // and asks the recorder for nothing.
  if (job.recordingLetGo) {
    for (const l of wanted) {
      const c = job.clipsCut && job.clipsCut.get(l.key);
      if (c && reviewStore.hasClip(job.id, c.name)) cut.set(l.key, c);
    }
    console.log(`[clips] ${job.id}: ${cut.size} of ${wanted.length} moments already clipped, the recording let go`);
    return cut;
  }
  let r = { kept: [], tried: 0, missed: 0 };
  try {
    r = await reviewClips.cutClips({
      looks: wanted, max: clips.MAX_CLIPS,
      cut: (from, to, at) => recorder.cutClip(from, to, at),
      save: (name, bytes) => !stale() && reviewStore.saveClip(job.id, name, bytes) > 0,
      // Off chosen while they are cut: the ones kept stay named, no more.
      stopped: () => stale() || off(),
    });
  } catch (e) {
    console.log('[clips] the clips could not be cut:', e.message);
    return cut;
  }
  for (const k of r.kept) cut.set(k.key, { name: k.name, startWall: k.startWall });
  console.log(`[clips] ${job.id}: ${r.kept.length} of ${wanted.length} moments clipped`
    + `${r.missed ? `, ${r.missed} not in the recording` : ''} (${Math.round(r.kept.reduce((n, k) => n + k.bytes, 0) / 1024)} KB)`);
  return cut;
}

/*
 * THE RECORDING GOES ONCE RIOT'S LOOK HAS CUT ITS CLIPS (8.3.1). Its stills are
 * decoded from those clips beside the review (recordingStills), never from the
 * recording, and they wait for a match in progress to end (afterMatch): held
 * to the link's end, the match before's recording, about 1.6 GB at 1080p, was
 * kept through the whole of the next one. Never before its clips are cut, and
 * never for a look that may still cut: Riot's is the look a review keeps, a
 * look before it has cut already (clipLooks runs one at a time), and a look
 * after it (Riot's again after a failure, the screen's if Riot's never
 * finished) takes the clips cut here (cutLookClips). The AI log's frames stay
 * held to the link's end, for a death with no clip.
 */
function recordingCut(job, cut) {
  job.clipsCut = new Map(cut);
  if (job.recordingLetGo) return;
  job.recordingLetGo = true;
  releaseRecording(job.recording);
  job.recording = null;
  console.log(`[clips] ${job.id}: Riot's look has its clips, the match's recording is let go`);
}

/**
 * The look answered: each death it looked at names its clip, and the review
 * keeps those clips and no others (an earlier look's, a round the server
 * failed on, or every one when the look failed or Off was chosen). Then the
 * cap.
 *
 * OFF CHOSEN WHILE THE LOOK WAS OUT keeps none either (cutsClips, asked again
 * here). Its clips were cut before it was sent, and it can wait out a whole
 * match for its stills: asked only before the cut, Off chosen between matches
 * while Riot's look waited, or while the server answered, left its clip
 * beside the review and named on its card, where 8.3.0, cutting after the
 * look, kept none.
 */
function keepLookClips(job, looked, cut) {
  const names = [];
  const off = !clips.cutsClips(store);
  for (const [n, f] of Object.entries((looked && looked.byRound) || {})) {
    const c = off ? null : cut.get(Number(n));
    if (c && f) { f.clip = c.name; names.push(c.name); }
  }
  try { reviewStore.keepClips(job.id, names); } catch (e) { console.log('[clips] keepClips:', e.message); }
  if (names.length) applyClipCap();
}

/**
 * THE CAP ON EVERY CLIP TOGETHER (Settings: 5, 10, 20 or 50 GB, 10 by
 * default). Past it the oldest reviews lose their clips first and keep their
 * frames and facts, and each says its clip was cleared for space
 * (review-store.js capClips).
 */
let clipCapSeen = clips.capGB(store.get('clipCapGB'));
function applyClipCap() {
  let ids = [];
  try { ids = reviewStore.capClips(clips.capGB(store.get('clipCapGB')) * clips.GB); } catch (e) {
    console.warn('[clips] the cap could not be applied:', e.message);
    return;
  }
  if (ids.length) clipsCleared(ids, 'space');
}

/**
 * Reviews whose clips were taken (the cap, or Clear clips in Settings). A
 * review still being improved says so on every version it saves from now
 * (stampReview), or its next save would forget why its clip is gone; and the
 * one open on its page repaints, rather than keep a player on a deleted file.
 */
function clipsCleared(ids, reason) {
  const gone = new Set(ids);
  const at = Date.now();
  for (const job of reviewJobs.values()) if (gone.has(job.id)) job.clipsCleared = { reason, at };
  if (lastReviewShown && gone.has(lastReviewShown.id)) {
    const e = reviewStore.get(lastReviewShown.id);
    if (e) showReview(withFrames(e.review));
  }
  console.log(`[clips] cleared ${reason === 'space' ? 'for space' : 'from Settings'}: ${ids.length} review${ids.length === 1 ? '' : 's'}`);
}

/*
 * EVERY VALORANT REVIEW STILL BEING IMPROVED, by when its match started. Riot's
 * record lands minutes after the match, so a review keeps working long after it
 * first opens, and that work has to be stoppable: a match the watch ended too
 * early resumes, and its review is withdrawn (withdrawReview). Each review keeps
 * its own retries, so the next match ending, or the player stopping recording,
 * no longer cancels the Riot link of the one before.
 */
const reviewJobs = new Map();

/**
 * A review still being built, for the update's question (updater.js busy):
 * a job is in reviewJobs until its link is done, and is counted for the hour
 * its match's frames and recording are held at most (aiLogStore.HOLD_MAX_MS),
 * so a job a throw never let go cannot keep the question back for good.
 */
function reviewBeingBuilt(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  for (const job of reviewJobs.values()) {
    const end = job && job.snap && Number.isFinite(job.snap.endedAt) ? job.snap.endedAt : null;
    if (end !== null && t - end < aiLogStore.HOLD_MAX_MS) return true;
  }
  return false;
}

/**
 * The engine says the last end was wrong: the match is still being played.
 * Its review is taken back everywhere it went, the window included, and the
 * real end reviews the whole match.
 *
 * SEALED FIRST. The match is in progress again from the moment it resumed,
 * and nothing else here seals: leaveReview's switch to Home ran unsealed,
 * with the withdrawn review, of the very match being played, kept over Home
 * as it went, and Home then on screen until the seal's next tick. Sealed
 * first, every page goes at once and Home is only remembered for the end.
 */
function withdrawReview(startedAt) {
  syncSeal();
  const job = reviewJobs.get(startedAt);
  if (!job) return;
  reviewJobs.delete(startedAt);
  job.cancelled = true;
  clearTimeout(job.timer);
  releaseMatchHolds(job);
  reviewStore.remove(job.id);
  if (lastReviewShown && lastReviewShown.id === job.id) {
    lastReviewShown = null;
    leaveReview({ outOfTheWay: true });
  }
  if (state.lastGrade && state.lastGrade.id === job.id) {
    const top = reviewStore.list().find((r) => r.grade);
    state.lastGrade = top ? { ...top.grade, game: top.game, id: top.id } : null;
  }
  breakdownCache.clear();
  registry.broadcast(C.PUSH_REVIEWS, { id: job.id, game: 'valorant', removed: true });
  registry.broadcast(C.PUSH_STATE, buildState());
  console.log(`[review] withdrawn, the match was not over: ${job.id}`);
}

/**
 * Every version of a review is the same match: its id, its end, and its place
 * in the AI log, so the eye on it opens this match's frames whichever version
 * the library ends up keeping.
 */
function stampReview(job, built) {
  return Object.assign(built, { id: job.id, at: job.snap.endedAt || Date.now(), aiLog: job.aiLog || null },
    // Its clips taken while it was still being improved (clipsCleared): every
    // later version says why, as the saved one the cap or Settings marked did.
    job.clipsCleared ? { clipsCleared: job.clipsCleared } : {});
}

/**
 * Paint one version of a review, if nothing newer has been shown since, and
 * save it whatever is on screen, because the library keeps the best one. A
 * TRANSIENT version (the corrected numbers while the summary is rewritten) is
 * painted and not saved: a quit in that minute left the library copy saying
 * "Rewriting the coach's read" for good, with the old summary gone.
 */
function repaintReview(job, built, frames, opts) {
  if (job.cancelled) return;
  stampReview(job, built);
  // Every frame a look of this review was sent, so a version painted after a
  // look still shows its pictures: a scoreboard that links after the look
  // from the screen repaints without new frames of its own. A newer look's
  // frame of the same round replaces the older one, as it does on disk.
  if (frames) job.frames = { ...(job.frames || {}), ...frames };
  if (lastReviewShown === job.showing || (lastReviewShown && lastReviewShown.id === job.id)) {
    showReview(job.frames ? { ...built, frameData: dataUrls(job.frames) } : built);
  }
  job.showing = lastReviewShown && lastReviewShown.id === job.id ? lastReviewShown : built;
  if (!(opts && opts.transient)) saveReview(built, 'valorant', frames);
}

/** Riot match ids already linked to another saved review, never linked twice. */
function linkedMatchIds(job) {
  // Except a review recording was STOPPED in the middle of, against a later
  // recording: the player stopped and started again in the same match, and the
  // later one watched it end. Polling first, the stub used to take Riot's
  // record from it, and the review that opened was told the match was played
  // on another account.
  return new Set(reviewStore.list('valorant')
    .filter((r) => r && r.id !== job.id && r.matchId && !(r.stoppedLive && r.at <= job.snap.startedAt))
    .map((r) => r.matchId));
}

/**
 * A later recording of the same match linked Riot's record: the review of the
 * part before the player stopped is folded into it and goes, from the library
 * and from the retries, so the match is linked and counted once.
 */
function retireStopStubs(job, lm) {
  const verifyFor = (startedAt, endedAt, map) => verifyCoachedMatch(lm, startedAt, endedAt, { map }).ok;
  for (const [key, other] of [...reviewJobs.entries()]) {
    const o = other.snap;
    if (other === job || !o.stoppedLive || o.endedAt > job.snap.startedAt) continue;
    if (!verifyFor(o.startedAt, o.endedAt, o.context && o.context.map)) continue;
    other.cancelled = true;
    clearTimeout(other.timer);
    releaseMatchHolds(other);
    reviewJobs.delete(key);
    reviewStore.remove(other.id);
    console.log(`[review] ${other.id} was the start of this match, recorded before a stop: folded into ${job.id}`);
    breakdownCache.clear();
    registry.broadcast(C.PUSH_REVIEWS, { id: other.id, game: 'valorant', removed: true });
  }
  for (const r of reviewStore.list('valorant')) {
    if (r.id !== job.id && r.matchId === lm.matchId && r.stoppedLive && r.at <= job.snap.startedAt) {
      reviewStore.remove(r.id);
      breakdownCache.clear();
      registry.broadcast(C.PUSH_REVIEWS, { id: r.id, game: 'valorant', removed: true });
    }
  }
}

/**
 * The match is over, or recording stopped. The engine says so the moment it
 * happens, before the narrative call, and THIS is when the review is saved and
 * the match's AI log frames are held. Waiting for the narrative meant a quit or
 * an update in the next minute lost the review, and a Stop then Start pointed
 * its death frames at the next session's empty log.
 */
function onValorantMatchEnded(snap) {
  if (!snap) return;
  // Two reviews of one match only happen when it resumed: the newer one is the
  // whole match, and the older one goes, from the library too.
  const prior = reviewJobs.get(snap.startedAt);
  if (prior) {
    prior.cancelled = true;
    clearTimeout(prior.timer);
    releaseMatchHolds(prior);
    reviewStore.remove(prior.id);
    breakdownCache.clear();
  }
  const job = {
    id: newId('valorant', snap.endedAt || Date.now()),
    snap, cancelled: false, timer: null, recorded: false, showing: null,
    // The baseline as it was BEFORE this match. Its own history row is added
    // when the tracker links, and every version built after that compared the
    // match with an average that included the match itself.
    history: (store.get('valorantHistory') || []).slice(),
    // Held until the review has looked (released when the link is done, and
    // after the look from the screen when Riot's rounds never came), so a
    // match linked forty minutes later still has its frames.
    log: holdAiLogFrames(snap.startedAt, snap.endedAt),
    // And its recording, held the same way (8.3), for the clips cut from the
    // moments the review looks at, and through the minutes a match the watch
    // ended too early can still resume in. An hour at most, as the frames, and
    // let go once Riot's look has cut its clips (recordingCut).
    recording: holdRecording(snap.startedAt - 5000, (snap.endedAt || Date.now()) + RECORDING_RESUME_MS),
  };
  // AND KEPT WITH THE REVIEW (8.2): the session folder, and the match's stamp
  // and window, which every record of it carries. The eye on its row and its
  // page opens these frames and no others, long after the hold is let go.
  // Null when the log was off.
  job.aiLog = job.log ? aiLogStore.placeOf(job.log.dir, snap.startedAt, snap.endedAt) : null;
  snap.log = job.log;
  reviewJobs.set(snap.startedAt, job);

  // NOTHING OPENS OVER A MATCH IN PROGRESS: the next one already being played,
  // one the player had already left for the next (next-match), or the one
  // recording was stopped in the middle of. Those are kept in the library.
  const live = matchInProgress() || snap.endedBy === 'next-match' || !!snap.stoppedLive;
  const first = stampReview(job, buildValorantReview(snap, null, { history: job.history, narrativeComing: true }).built);
  job.showing = first;
  if (!live) showReview(first);
  saveReview(first, 'valorant');
  if (!live) openPage('review');
  else if (snap.stoppedLive) {
    // That match is most likely still being played: the window stays sealed
    // until the player opens a page (syncSeal).
    sealHeld = true;
    syncSeal();
    pushNotice('Recording stopped in the middle of a match. Its review is saved in Matches.', 'review');
  }
  console.log(`[review] valorant review ready: ${snap.rounds.length} rounds, ended by ${snap.endedBy}`
    + (live ? ', saved but not shown, a match is in progress' : ''));
}

/**
 * The narrative came back, or failed. Repaint with it, then link the match to
 * Riot's record, which is what grades it.
 *
 * With no Riot ID set, nothing is coming to say when the player died, so the
 * coach looks at the deaths the screen saw now, while the review is the one on
 * screen (screenLook), rather than after the link has spent its retries.
 */
function onValorantMatchReview(reviewText, snap) {
  if (!snap) return;
  if (!reviewJobs.has(snap.startedAt)) onValorantMatchEnded(snap);
  const job = reviewJobs.get(snap.startedAt);
  if (!job || job.cancelled) return;
  snap.log = job.log;
  job.snap = snap;
  if (!snap.ai) console.log('[review] no model narrative for this match');
  repaintReview(job, buildValorantReview(snap, null, { history: job.history }).built);
  if (!(store.get('riotId') || '').includes('#')) screenLook(job);
  linkRiotRecord(job);
}

// A boot check (check:latelink) shortens every wait between a review's link
// tries by this factor, so a match Riot lists only once it is over and
// published runs on its real timeline in seconds. Never above 1.
const LINK_DELAY_SCALE = (() => {
  const s = Number(process.env.OCCLARA_DEV_LINK_SCALE);
  return s > 0 && s < 1 ? s : 1;
})();

/**
 * THE MATCH THIS SESSION WATCHED, verified, then Riot's round record laid over
 * it. Retried on its own clock until Riot has published, and said plainly in
 * the review when it never links.
 */
function linkRiotRecord(job) {
  const snap = job.snap;
  const c = snap.context || {};
  const mctx = {
    map: c.map,
    // Only an agent the player confirmed: a detection taken while spectating
    // names a teammate, and the link then refused the real match.
    agent: c.agentConfirmed ? c.agent : null,
    score: { team: c.teamScore | 0, enemy: c.enemyScore | 0, final: snap.endedBy === 'score' },
  };
  // THE LINK IS DONE: linked and looked at, given up, or withdrawn. When
  // Riot's rounds never came (the scoreboard never linked, or its rounds kept
  // failing), the coach looks at what the screen saw first (screenLook), and
  // only then are the frames let go, because the look reads them off disk.
  const done = () => {
    const look = job.cancelled || job.riotLooked ? job.screenLook : screenLook(job);
    Promise.resolve(look).then(() => {
      releaseMatchHolds(job);
      if (reviewJobs.get(snap.startedAt) === job) reviewJobs.delete(snap.startedAt);
    });
  };
  const lastTry = {};
  const find = () => fetchCoachedMatch(snap.startedAt, snap.endedAt, { ...mctx, exclude: linkedMatchIds(job) }, lastTry);

  /*
   * RIOT'S RECORD OVERRIDES THE SCREEN, and the narrative is written again.
   *
   * Checked against Riot on the real Abyss fixture, the screen read 22 deaths
   * where there were 21 and 6 early deaths where there were 19, and three of
   * the coach's death reviews named the wrong killer. A summary written from
   * those facts is wrong in the same places, so correcting the numbers and
   * keeping the old summary would leave the one sentence a player reads first
   * contradicting the numbers under it. The corrected half is shown at once
   * with the summary marked as updating, the coach looks at the deaths worth
   * teaching, then the model writes the summary again from all of it.
   */
  const withRiot = async (lm) => {
    // A match linked as ended early came with its round record already
    // (fetchCoachedMatch), and is not asked for twice. Used once: a retry
    // after a failed look asks again.
    const kept = lastTry.riot && lastTry.riot.matchId === lm.matchId ? lastTry.riot.record : null;
    lastTry.riot = null;
    const riot = kept || await riotRoundsFor(lm);
    if (!riot || job.cancelled) return false;
    // A look from the screen still out when Riot's rounds land paints nothing
    // over them (lookFromScreen), and none is taken once these are painted.
    job.riotBusy = true;
    try { return await riotLook(lm, riot); } finally { job.riotBusy = false; }
  };
  const riotLook = async (lm, riot) => {
    const verify = require('../shared/valorant-verify');
    const valorantReview = require('../shared/valorant-review');
    // With the match's AI log frames, which time each death against Riot's
    // (valorant-verify.js earlyBy): one the screen read well before it is not it.
    const { rounds, checks } = verify.reconcile(snap.rounds, riot,
      { records: snap.log ? snap.log.records : null, window: { from: snap.startedAt, to: snap.endedAt } });
    const context = { ...snap.context, agent: (riot.me && riot.me.agent) || snap.context.agent };
    const vsnap = { ...snap, rounds, context };
    const verification = verify.describe(checks);
    console.log(`[review] ${verification}`);
    const extra = { verification, riotMe: riot.me, queue: riot.queue, history: job.history };
    repaintReview(job, buildValorantReview({ ...vsnap, ai: null }, lm, { ...extra, narrativePending: true }).built,
      null, { transient: true });

    // Timed by Riot's own milliseconds against the round's clock (8.3.1,
    // death-frames.js): reconcile keeps the second alone. Its clips are cut
    // by the look while the match's recording is held, and since Riot's look
    // is the one kept, its clips are, and the screen's go.
    const looked = await forensicsFor(deathFrames.withRiotTimes(rounds, riot), { ...snap, context },
      { job, stale: () => job.cancelled });
    if (job.cancelled) return false;
    for (const r of rounds) if (looked.byRound[r.n]) r.forensics = looked.byRound[r.n];

    let ai = null;
    try {
      const body = valorantReview.requestBody({
        rounds, context, endedBy: snap.endedBy, tips: [], notes: snap.notes,
        riot: {
          agent: riot.me && riot.me.agent, map: riot.map, score: riot.score, result: riot.result,
          scoreline: { kills: riot.me && riot.me.kills, deaths: riot.me && riot.me.deaths,
            assists: riot.me && riot.me.assists, acs: lm.acs, mvp: lm.mvp || null },
        },
      });
      body.context = { ...body.context, proPlaybook: snap.context.proPlaybook };
      const res = await api.post(API.MATCH_REVIEW, body, store.get('licenseKey'), 60000);
      ai = res && res.ok ? res.data : null;
    } catch (e) {
      console.log('[review] verified narrative failed:', e.message);
    }
    const final = buildValorantReview({ ...vsnap, ai }, lm, extra).built;
    repaintReview(job, final, Object.keys(looked.frames).length ? looked.frames : null);
    job.riotLooked = true;
    return true;
  };

  // Riot's round record can fail on its own (a rate limit, a slow publish)
  // after the scoreboard has linked, so it gets retries of its own
  // (RIOT_ROUNDS_RETRY_MS in match-link.js).
  const riotThen = (lm, delays) => {
    withRiot(lm)
      .catch((e) => { console.log('[review] Riot check failed:', e.message); return false; })
      .then((ok) => {
        if (ok || job.cancelled || !delays.length) { done(); return; }
        job.timer = setTimeout(() => { job.timer = null; if (!job.cancelled) riotThen(lm, delays.slice(1)); },
          delays[0] * LINK_DELAY_SCALE);
      });
  };

  const withTracker = (lm) => {
    if (job.cancelled) return;
    // Kept, so a look from the screen taken later builds on this scoreboard.
    job.tracker = lm;
    const valorantReview = require('../shared/valorant-review');
    const next = buildValorantReview(snap, lm, { history: job.history });
    // ONE HISTORY ROW PER MATCH, whichever attempt found the tracker. Every
    // version of this review is built from job.history, the baseline from
    // before this match, so the row never ends up compared with itself.
    if (!job.recorded) {
      job.recorded = true;
      const row = valorantReview.historyEntry(lm, next.role);
      if (row) {
        const past = store.get('valorantHistory') || [];
        store.set('valorantHistory', [...past, row].slice(-valorantReview.BASELINE_GAMES));
      }
    }
    // RIOT HAS PUBLISHED THIS MATCH, so the rank history read as it ended,
    // without its game, is not read back: the read the save below sets off
    // (Home's, on PUSH_REVIEWS) goes past main's cache and the server's
    // (rank-history.js), and the saves after it read that one.
    if (lm.matchId && !job.rankRead) {
      job.rankRead = true;
      rankHistory.published();
    }
    // Only repainted if nothing newer has been shown since. The retry can
    // land minutes later, by which time the next match may have its own
    // review open, and a late scoreboard must not replace it with this one.
    repaintReview(job, next.built);
    if (lm.matchId) retireStopStubs(job, lm);
    // The totals are Riot's now; the rounds follow, and they are what fixes
    // the deaths, the timing and the coach's reads.
    riotThen(lm, RIOT_ROUNDS_RETRY_MS);
  };

  (async () => {
    // A fresh tracker profile, so the stats view and the next review's
    // baseline move with the match just played.
    try {
      const current = await fetchTrackerStats(true);
      if (current) store.set('lastMatchStats', { ...current, _at: Date.now(), _riotId: (store.get('riotId') || '').trim() });
    } catch {}
    if (job.cancelled) return;
    // THE MATCH THIS SESSION WATCHED, or nothing. fetchCoachedMatch applies
    // the map, agent, score and timing checks, so it returns null rather than
    // a plausible scoreboard from a different game.
    let lm = null;
    try { lm = await find(); } catch {}
    if (lm) { withTracker(lm); return; }
    // Riot publishes a few minutes after the match. A match stopped halfway,
    // or one the watch ended on a score only swiftplay ends on, may still be
    // being played, so its review keeps trying for longer (match-link.js
    // linkRetries says how long, and the AI log holds its frames longer).
    const retry = (delays) => {
      if (job.cancelled) return;
      if (!delays.length) {
        // Nothing linked. Said in the review, rather than leaving it promising
        // a grade that is not coming.
        if ((store.get('riotId') || '').includes('#')) {
          // Refused because another review holds it is not "not found", and
          // nor is a match the watch may have ended early (mayGoOn): Riot
          // publishes a match once it is over, and a later launch's late link
          // checks it again (backfill.js late()).
          const taken = /already linked/.test(String(lastTry.why || ''));
          job.linkMissing = taken ? 'taken' : mayGoOn(mctx.score) ? 'later' : true;
          repaintReview(job, buildValorantReview(snap, null,
            { history: job.history, linkMissing: job.linkMissing }).built);
        }
        done();
        return;
      }
      job.timer = setTimeout(async () => {
        job.timer = null;
        if (job.cancelled) return;
        let found = null;
        try { found = await find(); } catch {}
        if (found) withTracker(found);
        else retry(delays.slice(1));
      }, delays[0] * LINK_DELAY_SCALE);
    };
    retry(linkRetries(snap.endedBy, mctx.score));
  })();
}

/**
 * One saved review as plain text for Ask Coach: the facts, the grade, and what
 * repeated, so the chat talks about THIS match rather than the player in general.
 * The newest review when no id was chosen.
 */
function chatReviewContext(id, game) {
  const newest = reviewStore.list(game || null)[0];
  const e = id ? reviewStore.get(id) : (newest && reviewStore.get(newest.id));
  if (!e) return null;
  // As a window is shown it (present()), so a match graded from Riot's record
  // alone gives the chat its facts, never a mistake Riot does not record.
  const r = present(e.review) || {};
  const g = r.game || {};
  const lines = [];
  lines.push(`${e.game} match on ${new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}: `
    + [g.map, g.agent || g.hero || g.champion, g.mode, g.result, g.score].filter(Boolean).join(', ') + '.');
  const sl = r.scoreline || {};
  if (typeof sl.kills === 'number') lines.push(`Scoreline ${sl.kills}/${sl.deaths}/${sl.assists}${sl.acs ? `, ACS ${sl.acs}` : ''}.`);
  const gr = r.grade;
  if (gr && gr.score !== null && gr.score !== undefined) {
    lines.push(`Grade ${gr.score} (${gr.letter})${gr.provisional ? ', provisional' : ''}: `
      + (gr.categories || []).filter((c) => c.score !== null).map((c) => `${c.label} ${c.score} (${c.evidence.join('; ')})`).join('. ') + '.');
  }
  const ins = r.insights || {};
  const list = (xs, n = 3) => (xs || []).slice(0, n).map((x) => `${x.title}: ${x.detail}`).join(' ');
  if ((ins.mistakes || []).length) lines.push(`Repeated mistakes: ${list(ins.mistakes)}`);
  if ((ins.strengths || []).length) lines.push(`Went well: ${list(ins.strengths)}`);
  if ((ins.missed || []).length) lines.push(`Missed: ${list(ins.missed)}`);
  if ((ins.facts || []).length) lines.push(`What Riot's record shows: ${list(ins.facts, 6)}`);
  for (const card of (r.rounds || []).filter((c) => c.forensics && c.forensics.what).slice(0, 4)) {
    lines.push(`Round ${card.n} death, the coach looked at the frame: ${card.forensics.what}${card.forensics.better ? ' Better: ' + card.forensics.better : ''}`);
  }
  if (r.summary) lines.push(`Review summary: ${r.summary}`);
  if (r.focus) lines.push(`Focus given: ${r.focus}`);
  return lines.join('\n').slice(0, 2400);
}

/** { name: base64 } to { name: data URL }, for the window. */
function dataUrls(frames) {
  const out = {};
  for (const [k, v] of Object.entries(frames || {})) out[k] = `data:image/jpeg;base64,${v}`;
  return out;
}

// ── Coaching controller ──────────────────────────────────────────────────────
// Owns the CoachingEngine instance and forwards its events onto the IPC bus.
let engine = null;

const controller = {
  start() {
    if (state.isCoaching) return;
    if (!state.licenseActive) {
      // Subscription ended: refuse to coach, remind the user, and re-check in
      // case they just renewed.
      pushNotice('Your subscription has ended. Renew in Settings to start coaching.');
      revalidateNow();
      return;
    }

    // REFUSE RATHER THAN COACH THE WRONG GAME.
    //
    // Every engine below is Valorant: the map lock, the callout gate, the side
    // and round arithmetic, the spike. Starting it while the app is set to
    // another game would produce tips that read perfectly and describe a game
    // the player is not in, which is worse than silence because it is
    // believable. The palette and layout switching is real; the coach is not,
    // and this is where that difference gets stated out loud.
    const chosenGame = store.get('game');
    if (!gameRegistry.canCoach(chosenGame)) {
      const g = gameRegistry.get(chosenGame);
      pushNotice(`${g.label} is not reviewed yet. Switch to Valorant, Marvel Rivals or League of Legends in Settings to record a match.`);
      return;
    }

    // RECORDING AGAIN, IN ANY GAME, the seal follows this recording's match
    // (syncSeal) and no longer the one a stop left held. Cleared only in the
    // Valorant path, a held seal outlived a switch to Rivals or League: the
    // player pressed Start, every page and the review at the game's end stayed
    // behind "Recording stopped", and only a Stop let them out. The seal is
    // settled once each branch below is recording (syncSeal after its
    // 'coaching' status), never here: not recording yet, settling it lifted the
    // seal outright, and a Valorant engine counts as in a match from its start,
    // so a Start pressed mid match showed Home until the next tick.
    sealHeld = false;

    // A DIFFERENT GAME GETS A DIFFERENT ENGINE, never this one with a new
    // palette. The Rivals coach reads hero select and a scoreboard a handful of
    // times a match; this one reads a Valorant HUD every ten seconds. Sharing
    // the engine would mean the map lock, the callout gate and the spike
    // arithmetic all running against a game that has none of those.
    if (chosenGame === 'rivals') {
      engine = new RivalsEngine({
        getKey: () => store.get('licenseKey'),
        capture: () => capture.captureScreenshot(store.get('captureQuality') === 'performance' ? 'performance' : 'standard'),
        log: (m) => console.log(m),
        getHistory: () => store.get('rivalsHistory') || [],
        // Only the features that actually work. The draft read gets roles wrong,
        // so no draft tip is ever spoken. heroCapture is separate on purpose:
        // the engine still ASKS the draft question, because that screen is the
        // only place the game prints the player's hero name, and a printed name
        // is the one hero read that graded clean. See games.js for the numbers.
        features: {
          review: gameRegistry.hasFeature('rivals', 'review'),
          draft: gameRegistry.hasFeature('rivals', 'draft'),
          heroCapture: gameRegistry.hasFeature('rivals', 'heroCapture'),
        },
      });
      // Rivals says nothing live either: only its system messages reach the panel.
      engine.on('tip', (t) => { if (t && t.source === 'system') pushNotice(t.text); });
      // The out of credits notice, and its clearing once reads work again.
      engine.on('notice', (n) => {
        if (!n) return;
        if (n.text) pushNotice(n.text, n.kind);
        else if (state.notice && state.notice.kind === n.kind) pushNotice(null);
      });
      // 'paused' and 'coaching' drive the panel and the pause button, the same
      // contract as the Valorant engine; anything else is only logged.
      engine.on('status', (s) => {
        if (s === 'paused' || s === 'coaching') {
          state.isPaused = s === 'paused';
          setStatus(s);
        } else {
          console.log('[rivals] status', JSON.stringify(s));
        }
      });
      // The post match review, computed from the scoreboard rather than written
      // by the model. Same channel the Valorant and League reviews use, and the
      // review object carries kind: 'rivals' so the surface knows which shape it
      // is looking at rather than sniffing for optional fields.
      engine.on('review', (r) => {
        // SAVED BEFORE IT IS SHOWN, because a review that is only pushed to a
        // window is lost the moment the window closes, which is how this
        // shipped at first: no record, and therefore no baseline to judge the
        // next match against.
        //
        // The entry is built from the REVIEW rather than the raw frame, so a
        // hero the review refused to believe never enters the baseline either.
        try {
          const rivalsReview = require('../shared/rivals-review');
          const entry = rivalsReview.historyEntry(r);
          if (entry) {
            const past = store.get('rivalsHistory') || [];
            store.set('rivalsHistory',
              [...past, entry].slice(-rivalsReview.RIVALS_BASELINE_GAMES));
          }
        } catch (e) {
          // Losing the record must never lose the review the player is waiting
          // for, so this is reported and stepped over.
          console.error('[rivals] could not record the match:', e.message);
        }
        // Graded and counted like every other game, then kept in the library.
        try {
          r.id = newId('rivals');
          r.at = Date.now();
          if (!r.empty) {
            r.grade = grader.rivals(r, store.get('rivalsHistory') || []);
            r.insights = insightsOf.rivals(r);
          }
        } catch (e) { console.error('[rivals] grade failed:', e.message); }
        showReview(r);
        if (!r.empty) saveReview(r, 'rivals');
        openPage('review');
        console.log(`[rivals] review ready: ${r.game.hero || 'hero unread'}, `
          + `${r.scoreline.kills}/${r.scoreline.deaths}/${r.scoreline.assists}`);
      });
      // Coaching is set BEFORE anything is pushed: the panel and the tray used
      // to receive a state that still said stopped, showed Ready and a Start
      // button that did nothing, and could not stop the session.
      state.isCoaching = true;
      state.isPaused = false;
      engine.start();
      pushNotice('Recording. Play your match: the scoreboard at the end is reviewed and graded automatically.', 'recording');
      setStatus('coaching');
      syncSeal();
      return;
    }

    // LEAGUE RECORDS AND SAYS NOTHING. It is not a live coach and must never
    // become one: Riot's policy bans overlays that provide game-session-specific
    // information previously unknown to the player, and bans apps that dictate
    // player decisions. The legitimate form, named in Riot's own words, is
    // coaching the player "game over game", so this watches the match in silence
    // and the review arrives when it is over.
    if (chosenGame === 'lol') {
      engine = new LolRecorder({
        getRole: () => store.get('lolRole') || '',
        getBand: () => store.get('lolBand') || null,
        log: (m) => console.log(m),
      });
      engine.on('status', (s) => console.log('[lol] status', JSON.stringify(s)));
      engine.on('game', (record) => finishLolGame(record));
      state.isCoaching = true;
      state.isPaused = false;
      engine.start();
      // The game recorded on this PC too (8.3), if Settings says Auto, for the
      // clips of its deaths in the review. Nothing reads the screen here; the
      // recording is display capture alone, and shows nothing.
      recorder.startSession('lol');
      pushNotice('Recording. Nothing appears during your game, and the graded review opens when it ends.', 'recording');
      setStatus('coaching');
      syncSeal();
      return;
    }

    // EVERY OTHER GAME MUST OPT IN, rather than falling through to this one.
    //
    // The branch above names Rivals explicitly, so anything else landed here
    // and got the Valorant coach: League selected meant League frames going to
    // a prompt about spike timers, with the map lock and the callout gate
    // running against a game that has neither. Same failure the hero tables are
    // built to avoid, one level up: silence when we cannot help, never a
    // confident answer about the wrong thing.
    if (!gameRegistry.hasFeature(chosenGame, 'live')) {
      const g = gameRegistry.get(chosenGame);
      console.log(`[coach] ${g.label} has no live coach, not starting one`);
      pushNotice(`${g.label} has no live coaching yet. What is built for it so far is in the Learn section.`);
      return;
    }
    engine = new CoachingEngine({
      licenseKey:      store.get('licenseKey'),
      captureFunction: () => capture.captureScreenshot(store.get('captureQuality') === 'performance' ? 'performance' : 'standard'),
      captureSpeed:    store.get('captureSpeed') || 'auto',
      // Experimental settings, read live so flipping them in Settings applies
      // to the very next capture without restarting the session.
      experiments: () => ({
        proPlaybook:  playbookMode(),
        language:     normalizeLang(store.get('language')),
        // Read when the match ends, so the review uses the setting as it is
        // then, not as it was when recording started.
        advancedTips: store.get('advancedTips') === true,
      }),
      // AI decision log: per-frame screenshot + parsed STATE + tip, to disk.
      diagnostics: (rec) => recordAiFrame(rec),
    });
    // A notice with no text is the engine saying the problem it reported is
    // over (reads or capture work again); it clears only that kind of notice.
    engine.on('notice', (n) => {
      if (!n) return;
      if (n.text) pushNotice(n.text, n.kind);
      else if (state.notice && state.notice.kind === n.kind) pushNotice(null);
    });
    engine.on('cadence', (ms) => {
      state.cadence = ms;
      registry.broadcast(C.PUSH_STATE, buildState());
    });
    engine.on('status', (status) => {
      state.isPaused = status === 'paused';
      setStatus(status);
      // Paused, nothing is read, and nothing is recorded either.
      if (status === 'paused') recorder.pause();
      else if (status === 'coaching') recorder.resume();
    });
    engine.on('match-ended', (snap) => onValorantMatchEnded(snap));
    engine.on('match-review', (reviewText, snap) => onValorantMatchReview(reviewText, snap));
    engine.on('match-resumed', (r) => withdrawReview(r && r.startedAt));
    engine.on('agent', (info) => {
      state.agent = info || { agent: null, confirmed: false, role: null };
      registry.broadcast(C.PUSH_AGENT, state.agent);
      registry.broadcast(C.PUSH_STATE, buildState());
    });
    // The server rejected our license key (401/403), confirm with an immediate
    // re-validation so a genuinely ended subscription locks fast (and a transient
    // server error does not, since revalidate is authoritative).
    engine.on('auth-suspect', () => revalidateNow());

    state.isCoaching = true;
    state.isPaused   = false;
    state.sessionStartedAt = Date.now();   // drives the 5-minute grading gate
    store.set('coachStartCount', (store.get('coachStartCount') || 0) + 1);
    state.agent      = { agent: null, confirmed: false, role: null };
    state.notice     = null;
    engine.start();
    if (state.pendingAgent) {           // player typed their agent before starting
      engine.setAgent(state.pendingAgent);
      state.pendingAgent = null;
    }
    // A fresh tracker profile for the stats view and the review's baseline.
    fetchTrackerStats(true).catch(() => {});
    startAiLog();   // fresh AI decision-log folder for this session
    // The match recorded on this PC, if Settings says Auto (recorder.js). The
    // reads stay on the GDI helper until its stream has been shown to see
    // the game, and go back to it the moment recording stops.
    recorder.startSession('valorant');
    setStatus('coaching');
    syncSeal();
    console.log('[coach] started');
  },
  stop() {
    if (!state.isCoaching) return;
    state.isCoaching = false;
    state.isPaused   = false;
    // A review's Riot link keeps trying after recording stops: the player who
    // stops on the end screen is the usual case, and Riot publishes a few
    // minutes later. The link is verified against the coached window, map and
    // agent, so a late answer can only ever be that match.
    // The match just played should show in stats right away, not after a cache
    // window. The grade is written by the post-match review, per match.
    matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };
    rankHistory.clear();
    // The session's notices end with it ("Recording...", a server that was
    // down). A licence notice stays, it is still true. Cleared before the engine
    // stops, because stopping can leave a notice of its own about the review.
    if (state.licenseActive) state.notice = null;
    // The engine first: a match stopped halfway is held as it ends (its
    // 'match-ended'), then the recording stops with its last chunks written.
    if (engine) { engine.stop(); engine = null; }
    recorder.stopSession();
    flushAiLog(true);
    state.agent = { agent: null, confirmed: false, role: null };
    registry.broadcast(C.PUSH_AGENT, state.agent); // hide the panel bubble/chip
    setStatus('stopped');
    console.log('[coach] stopped');
  },
  pauseResume() {
    // The League recorder has nothing to pause: it reads what the game client
    // reports, and the hotkey used to throw on it.
    if (!state.isCoaching || !engine || typeof engine.pause !== 'function') return;
    if (state.isPaused) engine.resume();
    else                { engine.pause(); }
    // state.isPaused + status pushes are driven by the engine 'status' event.
  },
  confirmAgent() { if (engine) engine.confirmAgent(); },
  setAgent(name) {
    if (engine) return engine.setAgent(name);
    // Not coaching yet: remember the choice and apply it when the engine starts,
    // so typing an agent never bounces with a confusing "not found".
    const canonical = agentData.resolveName(name);
    if (!canonical) return { ok: false, error: 'unknown agent' };
    state.pendingAgent = canonical;
    state.agent = { agent: canonical, confirmed: true, role: agentData.getRole(canonical) };
    registry.broadcast(C.PUSH_AGENT, state.agent);
    return { ok: true, ...state.agent };
  },
  getState() { return buildState(); },

  /**
   * The match library: saved reviews, newest first, one game or all. Each row
   * says whether the AI log still holds its match, for the eye on it, and
   * nothing about where: that is found again when the eye is pressed.
   */
  listReviews(game) {
    return reviewStore.list(game || null).map((row) => ({ ...row, aiLog: aiLogStateOf(rowLogEntry(row)) }));
  },
  getReview(id) {
    const e = reviewStore.get(id);
    return e ? present(withFrames(e.review)) : null;
  },
  /** Open the review window on one saved review. */
  openReviewById(id) {
    const e = reviewStore.get(id);
    if (!e) return;
    // As saved: showReview presents what it sends, and holds the review as main has it.
    showReview(withFrames(e.review));
    openPage('review');
  },
  /**
   * The eye on a library row and on the review page (8.2): the AI log, on that
   * match's frames. The page names the review and nothing else, and which
   * session and which frames are decided here, from the review. A match the
   * log no longer holds opens on a window that says so, never on another
   * session in its place. Mid match it does nothing, as Ctrl+Shift+E does:
   * nothing opens over a match in progress, and its page is sealed anyway.
   *
   * AT ONE MOMENT OF IT (8.2), from the eye on a death the coach looked at:
   * `at`, when the frame it looked at was captured, opens the log on that
   * frame. Only a time inside the match's own window counts, and anything
   * else opens the match on its first death as before.
   */
  openReviewAiLog(id, at) {
    if (matchInProgress()) return;
    const e = reviewStore.get(id);
    const scope = e ? aiLogScopeOf(reviewLogEntry(e.review, e.at)) : null;
    if (scope === null) return;   // nothing was recorded, so no eye was offered
    const moment = scope && typeof at === 'number' && Number.isFinite(at)
      && at >= scope.from && at <= scope.to + 5000 ? at : null;
    aiLogWindow.open(moment === null ? { scope: scope || { gone: true } } : { scope, at: moment });
  },
  /**
   * What keeps happening across the last matches of one game. The lists are
   * the last ten RECORDED matches' (patterns.js), so more are read than ten,
   * to find them behind the matches graded from Riot's record.
   */
  getPatterns(game) {
    const g = game || gameRegistry.get(store.get('game')).id;
    return { game: g, ...patternsOf.summarise(reviewStore.recent(g, patternsOf.LOOK_BACK)) };
  },
  /** By map and agent (hero, champion), counted from every saved review of one game. */
  getBreakdown(game, opts) {
    const g = game || gameRegistry.get(store.get('game')).id;
    const queue = opts && typeof opts.queue === 'string' ? opts.queue : 'All';
    const key = `${g}|${queue}`;
    if (!breakdownCache.has(key)) {
      breakdownCache.set(key, breakdownOf.build(g, reviewStore.recent(g, MAX_REVIEWS), { queue }));
    }
    return breakdownCache.get(key);
  },
  /**
   * Settings' line under Record match video (8.3): what the clips kept beside
   * the reviews take together, against the cap, counted off the disk.
   */
  clipsUsage() {
    const u = reviewStore.clipUsage();
    return { bytes: u.bytes, clips: u.clips, reviews: u.reviews, capGB: clips.capGB(store.get('clipCapGB')) };
  },
  /** Clear clips, in Settings: every clip goes, every review keeps its frames and facts and says so. */
  clearClips() {
    const ids = reviewStore.clearClips('cleared');
    if (ids.length) clipsCleared(ids, 'cleared');
    return this.clipsUsage();
  },
  /** The Matches button: grade the recent matches of the Riot ID in Settings. */
  startBackfill() {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId.includes('#')) {
      return { ...backfill.getStatus(), state: 'error', error: 'no-riot-id', message: 'Add your Riot ID in Settings first.' };
    }
    return backfill.start(riotId);
  },
  getBackfillStatus() { return backfill.getStatus(); },

  toggleMinimizePanel() {
    // Ctrl+Shift+M and the tray: the main window out of sight, or back, the
    // corner mark and the tray following it (onMainWindow). Back mid match,
    // it comes up without taking the keyboard from the game.
    return mainWindow.toggleHidden({ focus: !matchInProgress() });
  },
  /**
   * The top strip's buttons. Its X hides the window and Occlara keeps running
   * in the tray (main-window.js), so the review that just opened keeps being
   * checked against Riot's record. The tray and Settings quit.
   */
  windowAction(action) {
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') mainWindow.toggleMaximize();
    else if (action === 'close') mainWindow.hide();
  },
  /** A page of the main window, by its id in src/shared/shell-nav.js. */
  showPage(id) { openPage(id); },
  /** A page painted itself armed, and may be let in (main-window.js). */
  pageReady(id, sender) { mainWindow.pageReady(id, sender); },
  getShell() { syncSeal(); return mainWindow.shellState(); },
  openSettings()  { openPage('settings'); },
  openHistory()   { openPage('matches'); },
  openWeekly()    { weeklyWindow.open(); },
  openLearn()     { learnWindow.open(); },
  /**
   * The last review. Mid match it does nothing: the review of a match in
   * progress does not exist yet, and opening an older one over the game helps
   * nobody. After a restart the newest saved review stands in.
   */
  openReview() {
    if (matchInProgress()) return;
    if (!lastReviewShown) {
      const top = reviewStore.list()[0];
      const e = top && reviewStore.get(top.id);
      if (e) lastReviewShown = withFrames(e.review);
    }
    // The review page is kept between visits, so it is painted again: a review
    // withdrawn or taken back since would otherwise come back from the old
    // paint. With none left it loads again, onto its empty state.
    if (lastReviewShown) showReview(lastReviewShown);
    openPage('review', { reload: !lastReviewShown });
  },
  /** The last graded League game, so a review window opened later still paints. */
  // WHICHEVER REVIEW ARRIVED LAST, not specifically the League one.
  //
  // The channel name is historical: this window was built for League and is now
  // the post match review window for two games. The renderer branches on
  // review.kind, so the honest answer to "what should this window show" is the
  // most recent review of either kind. Returning the League one unconditionally
  // meant a Rivals player who opened the window by hand saw either nothing or
  // last week's League game.
  getLolReview() {
    if (!lastReviewShown) {
      const top = reviewStore.list()[0];
      const e = top && reviewStore.get(top.id);
      if (e) lastReviewShown = withFrames(e.review);
    }
    return present(lastReviewShown);
  },

  /**
   * Everything the learning surface needs, in one call.
   *
   * Assembled here rather than fetched, because the curriculum and the roster
   * are both shipped with the app: this works with no network, no licence check
   * and no server, which is the point of a section you open between games.
   */
  getLearn() {
    const curriculum = require('../shared/lol-curriculum');
    let starters = {};
    let patch = 'unknown';
    try {
      const champs = require('../shared/lol-champions');
      patch = champs.patch();
      // Resolve each curated pick against the real roster. A champion that has
      // been renamed or removed upstream is DROPPED rather than drawn as a
      // broken card, which is the same silence rule the rest of the app follows.
      for (const [lane, picks] of Object.entries(champs.STARTERS)) {
        const resolved = picks
          .map((p) => { const c = champs.champion(p.id); return c ? { name: c.name, icon: c.icon, why: p.why } : null; })
          .filter(Boolean);
        if (resolved.length) starters[lane] = resolved;
      }
    } catch (err) {
      // No generated data in this build. The curriculum still works on its own,
      // and the surface says so rather than showing an empty panel.
      console.warn('[learn] champion data unavailable:', err.message);
    }
    // THE ASSIGNMENT: one skill, chosen by the coach rather than the player.
    // Given twelve free choices players pick the interesting ones and skip
    // warding, which is the one that would have moved them two divisions.
    const lessons = require('../shared/lol-lessons');
    const targetTable = require('../shared/lol-targets');
    const grader = require('../shared/lol-grader');

    const history = store.get('lolHistory') || [];
    const role = store.get('lolRole') || '';
    const bandN = store.get('lolBand') || targetTable.DEFAULT_BAND;
    const last = history.length ? history[history.length - 1] : null;
    const results = (last && last.graded) || [];

    const pick = grader.recommend(results) || (lessons.forRole(role)[0] || {}).id || null;
    const skill = lessons.skill(pick);
    const lastResult = results.find((r) => r.skill === pick) || null;

    let assignment = null;
    if (skill) {
      const t = skill.metric ? targetTable.targetFor(skill.metric) : null;
      const bandTarget = skill.metric ? targetTable.bandTarget(skill.metric, bandN, role) : null;
      const stretch = skill.metric ? targetTable.stretchTarget(skill.metric, bandN) : null;
      const base = skill.metric ? grader.baseline(skill.metric, history) : null;
      assignment = {
        skillId: skill.id,
        klass: skill.klass,
        metric: skill.metric || null,
        metricLabel: skill.metric ? (lessons.metric(skill.metric) || {}).label : null,
        better: skill.metric ? (lessons.metric(skill.metric) || {}).better : null,
        // WHERE THE NUMBER CAME FROM, carried through so the surface can say
        // it. A sourced benchmark and a judgement call must never look alike.
        target: bandTarget !== null ? bandTarget : (stretch !== null ? stretch : base),
        targetKind: bandTarget !== null ? 'band'
          : (stretch !== null ? 'stretch' : (base !== null ? 'personal' : 'none')),
        sourced: !!(t && t.sourced),
        note: (t && t.note) || null,
        baseline: base,
      };
    }

    return {
      tracks: curriculum.TRACKS,
      lessons: curriculum.lessons(),
      skills: lessons.forRole(role),
      progress: store.get('lolProgress') || [],
      starters,
      patch,
      assignment,
      lastResult,
      gamesRecorded: history.length,
      role,
      band: bandN,
    };
  },

  /** Mark one lesson done or not done. Returns the whole list back. */
  setLearnProgress(payload) {
    const id = payload && payload.lessonId;
    const curriculum = require('../shared/lol-curriculum');
    if (!id || !curriculum.lesson(id)) return { ok: false, progress: store.get('lolProgress') || [] };
    const set = new Set(store.get('lolProgress') || []);
    if (payload.done) set.add(id); else set.delete(id);
    const next = [...set];
    store.set('lolProgress', next);
    return { ok: true, progress: next };
  },

  /**
   * Set the player's rank band and role, and hand back the whole recomputed
   * payload.
   *
   * Both are graded inputs, not preferences: the role decides which of the
   * twelve skills even apply (a support never sees the CS lesson) and the band
   * decides every sourced target. Returning getLearn() rather than an ok flag
   * means the dashboard repaints from one round trip and can never drift from
   * what main actually stored.
   */
  setLearnProfile(payload) {
    const p = payload || {};
    const band = Number(p.band);
    if (band >= 1 && band <= 5) store.set('lolBand', band);
    // '' is a real value here and means "not saying", which shows every skill.
    // Guessing a role and hiding a lesson is worse than showing one that does
    // not apply, so an unrecognised role clears rather than sticks.
    if (typeof p.role === 'string') {
      const ok = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
      store.set('lolRole', ok.includes(p.role) ? p.role : '');
    }
    return this.getLearn();
  },
  /*
   * Opened at a particular session when the caller names one.
   *
   * Tip History hands over the log session that belongs to the archive being
   * read, so the two windows agree about which sitting is on screen. Without
   * an id the viewer opens at the newest, which is what every other entry
   * point wants.
   */
  // A session folder name, or nothing. One match of a session is opened from
  // its review alone (openReviewAiLog), with the scope main found for it.
  openAiLog(sessionId) { aiLogWindow.open(typeof sessionId === 'string' && sessionId ? sessionId : null); },
  getAiLog(id, scope) {
    // ONE MATCH, from a review's eye: strict, so the session or the match gone
    // is { gone: true }, never another session in its place, and the live
    // session stays sealed as it does for a whole read. `keeps` is for the
    // window to say how many sessions the log keeps when it has to say they
    // are gone.
    if (scope && typeof scope === 'object') {
      const keeps = AI_LOG_KEEP_SESSIONS;
      if (liveLogSealed() && id && String(id) === aiLogLiveId()) {
        return { records: [], sessions: [], scoped: true, sealed: true, keeps };
      }
      return { ...aiLogStore.read(aiLogRoot(), id, aiLogLiveId(), scope), keeps };
    }
    // SEALED MID MATCH with live tips closed. The log shows every tip the coach
    // wrote, frame by frame, as it writes them, so an open log window on a
    // second monitor was the live tip feed by another name. The session in
    // progress reopens the moment the match ends.
    //
    // DECIDED ON THE SESSION SERVED (8.2), never on the id asked for. This
    // checked the id, and an id pruned at Start while the window was open
    // passed it and was then served the newest folder, which is the match in
    // progress. A session the log no longer keeps is now gone, never another
    // in its place, and while sealed the live session is in no list handed
    // back (aiLogStore.serve).
    const log = aiLogStore.serve(aiLogRoot(), id, aiLogLiveId(), liveLogSealed());
    return log.gone ? { ...log, keeps: AI_LOG_KEEP_SESSIONS } : log;
  },
  getAiLogSessions() {
    const list = aiLogSessions();
    return liveLogSealed() ? list.filter((x) => !x.live) : list;
  },

  /** Check a logged session's deaths against Riot's own record of the match.
   *  Lazy and best effort: the viewer opens on the screen-read deaths straight
   *  away, and this arrives afterwards to confirm or correct them, so the log
   *  still works offline and without a Riot ID configured. */
  async confirmAiLogDeaths(id, scope) { return confirmDeaths(id, scope); },

  /** "Why did I die here?" against one frame of the AI log. The screenshot goes
   *  with the question so the coach looks at the moment instead of reasoning
   *  from a summary, and the two preceding frames ride along because a death is
   *  usually explained by what was happening just before it. */
  async askAboutFrame(payload) {
    const licenseKey = store.get('licenseKey');
    if (!licenseKey) return { error: 'No license active.' };
    const p = payload || {};
    const question = String(p.question || '').trim();
    if (!question) return { error: 'Ask a question first.' };

    // The session must come from the payload. When the viewer only ever showed
    // the newest session this could be implied, but now that older sessions are
    // browsable, reading the newest here would answer a question about frame 12
    // of Tuesday's game using frame 12 of tonight's, with a confident answer and
    // nothing to indicate it looked at the wrong picture.
    //
    // And it must still be KEPT, which is checked before the seal (8.2): the
    // seal used to check the session named, and one pruned at Start since it
    // was opened passed it and was read as the newest folder, so a frame of the
    // match in progress went to the coach and the answer was shown mid match.
    //
    // The index is into what the viewer has on screen: one match's frames when
    // it was opened from a review, so those are what is read here too.
    const asked = aiLogStore.askAbout(aiLogRoot(), p.session, p.scope, aiLogLiveId(), liveLogSealed());
    if (asked.refused === 'sealed') {
      return { error: 'This match is still being played. Ask about it once it ends.' };
    }
    const recs = asked.records;
    const i = Math.max(0, Math.min(recs.length - 1, Number(p.index) || 0));
    const target = recs[i];
    if (!target) return { error: 'That frame is no longer in the log.' };

    // ONE frame of run-up, then the frame in question.
    //
    // It used to send three. The live analyze loop sends two and succeeds; this
    // asked the same model for an extra image AND a longer answer, and the whole
    // feature simply never replied. The provider currently in front of this is
    // the one coach.js documents as having once returned an empty string on
    // every call, and the same session logged 19 timeouts on the lighter
    // two-image path, so the third image was the difference between flaky and
    // useless.
    const b64 = (r) => (r && typeof r.frameData === 'string'
      ? r.frameData.replace(/^data:image\/[a-z]+;base64,/, '') : null);
    const images = [recs[i - 1], target].map(b64).filter(Boolean);

    try {
      const { ok, status, data } = await api.post('/api/coach/frame-chat', {
        question,
        images,
        state: target.state || {},
        shown: target.shown ? target.shown.text : '',
        history: Array.isArray(p.history) ? p.history.slice(-8) : [],
      }, licenseKey, 35000);
      if (ok && data && data.reply) return { reply: data.reply };
      // SAY WHY, in the log and on screen. This used to return the error and log
      // NOTHING, so a chat that answered nothing all session left not one line in
      // debug.log while the engine beside it was logging every 503 it saw. The
      // feature looked broken and unfixable at the same time.
      console.error(`[ai-log] frame chat: status=${status} ${(data && (data.error || data.message)) || 'no reply'}`);
      return { error: chatFailureText(status, data) };
    } catch (e) {
      console.error('[ai-log] frame chat failed:', e.message);
      return { error: 'Could not reach the coach server.' };
    }
  },

  /* Nothing above this line explains a failure to the player, so this does. The
   * three that actually happen are worth separating: credits, rate limit and the
   * model itself, because only one of them is worth retrying immediately. */
  /** The weekly report the popup renders. Reading it marks the week as seen
   *  and rolls the comparison baseline, so next week measures from here. */
  getWeeklyReport() {
    const report = buildWeeklyReport();
    if (report.hasData) {
      store.set('weeklyReportWeek', report.weekOf);
      rollWeeklyBaseline();
    }
    return report;
  },
  // Opened plainly, the chat talks about the newest reviewed match.
  openChat()      { state.chatReviewId = null; openPage('coach'); },
  openStats()     { openPage('stats'); },

  /** "Ask Coach about this" from the stats dashboard: stash the session's
   *  context, then open chat; the chat window collects the seed via CHAT_SEED
   *  and auto-sends it as the opening question. */
  openChatSeeded(seed) {
    // "Ask about this match" from a review or the library: the chat is handed
    // that review as context, and opens by asking about it.
    if (seed && typeof seed === 'object' && typeof seed.reviewId === 'string') {
      const e = reviewStore.get(seed.reviewId);
      if (e) {
        state.chatReviewId = seed.reviewId;
        const g = e.review.game || {};
        state.chatSeed = { reviewId: seed.reviewId,
          title: [g.map, g.agent || g.hero || g.champion, g.score].filter(Boolean).join(' ') || 'last' };
      }
      // The Ask Coach page is kept between visits, so it is loaded again to
      // take this seed (CHAT_SEED) and open on this match.
      openPage('coach', { reload: true });
      return;
    }
    if (seed && typeof seed === 'object') {
      const n = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
      state.chatSeed = {
        date:       String(seed.date || '').slice(0, 40),
        map:        seed.map ? String(seed.map).slice(0, 24) : null,
        overall:    n(seed.overall),
        scores:     seed.scores && typeof seed.scores === 'object' ? {
          impact: n(seed.scores.impact != null ? seed.scores.impact : seed.scores.economy),
          positioning: n(seed.scores.positioning),
          utility: n(seed.scores.utility), aim: n(seed.scores.aim),
        } : null,
        strengths:  String(seed.strengths  || '').slice(0, 400),
        weaknesses: String(seed.weaknesses || '').slice(0, 400),
      };
    }
    openPage('coach', { reload: !!state.chatSeed });
  },
  takeChatSeed() {
    const s = state.chatSeed || null;
    state.chatSeed = null;
    return s;
  },

  /** The assembled extended-stats dashboard: category trends from the local
   *  performance log, rank/win-rate from the tracker profile, and the recent
   *  match list (server-cached 15 min, client-cached alongside). */
  /**
   * Competitive RR journey for the rank drop-down graph and Home, cached 5
   * minutes (services/rank-history.js). Forced (Stats' Refresh), or after a
   * review linked, the server's own cache is asked to step aside too, at the
   * manual rate it allows /matches.
   */
  getRankHistory(force) {
    return rankHistory.read(store.get('riotId'), force);
  },

  async getStatsDashboard(mode, force) {
    // WHICH GAME ARE THESE STATS FOR. The dashboard had no concept of this at
    // all: every field below is Valorant shaped (agents, competitive/unrated,
    // tracker.gg, a Valorant rank ladder), and selecting League returned them
    // unchanged, so a League player was shown a Valorant rank and a Valorant
    // agent list with no indication anything was wrong.
    //
    // A game with no stats source returns EMPTY AND SAYS WHY, rather than
    // falling through to the Valorant tracker. Same rule as the coaching guard
    // and as ABSENCE MEANS SILENCE in the hero tables: no data is an honest
    // answer, the wrong game's data is not.
    const g = gameRegistry.get(store.get('game'));
    if (!gameRegistry.hasFeature(g.id, 'stats')) {
      return {
        game: g.id, gameLabel: g.label, statsSupported: false,
        categories: [], rank: { value: null, direction: 'flat' },
        winRate: { value: null, direction: 'flat' },
        mode: null, topAgents: [], sessions: [], sessionCount: 0,
        grading: null, matches: { matches: [], fetchedAt: 0, mode: null },
        riotId: '', riotConnected: false,
      };
    }

    const m = mode === 'unrated' ? 'unrated' : 'competitive';
    // The tracker profile and the recent-match list are two independent network
    // round-trips. They used to run one after the other, so a cold dashboard
    // open waited for the sum of both; running them together roughly halves it.
    // Unrated has no historical snapshot to trend against, so its arrows stay
    // flat; the numbers themselves come from unrated + swiftplay matches.
    let prevStats = null;
    const statsP = (m === 'unrated')
      ? fetchTrackerStats(!!force, 'unrated')
      : (force ? fetchTrackerStats(true) : Promise.resolve()).then(() => {
          const pair = guardedTrackerPair();
          prevStats = pair.prevStats;
          return pair.stats;
        });
    const matchesP = this.getMatches(false, m);
    const [stats, matches] = await Promise.all([statsP, matchesP]);
    const categories = computeCategoryTrends([], stats, prevStats);
    // Without where a match's frames are in the AI log, which stays in main
    // (REVIEW_AILOG): Stats opens a graded match's review, never its log.
    const graded = reviewStore.list(g.id).filter((r) => r.grade).slice(0, 15).map(({ aiLog, ...r }) => r);

    const rank = {
      value: (stats && stats.rank) || null,
      direction: stats && prevStats ? trendDirection(rankIndex(stats.rank), rankIndex(prevStats.rank), 0) : 'flat',
    };
    const winRate = {
      value: stats && stats.winRate != null ? stats.winRate : null,
      direction: stats && prevStats ? trendDirection(stats.winRate, prevStats.winRate) : 'flat',
    };

    return {
      // Carried on every response so the renderer can tell whose numbers these
      // are, and so a stale reply that lands after a game switch can be dropped
      // rather than painted.
      game: g.id, gameLabel: g.label, statsSupported: true,
      categories, rank, winRate, mode: m,
      topAgents: (stats && stats.topAgents) || [],
      // Graded matches from the library, newest first, with what the grade
      // was built on. Opening one opens its review.
      sessions: graded,
      sessionCount: graded.length,
      patterns: this.getPatterns(g.id),
      grading: null,
      matches,   // fetched in parallel with the tracker profile above
      riotId: (store.get('riotId') || '').trim(),
      riotConnected: (store.get('riotId') || '').includes('#'),
    };
  },

  /** Recent tracker matches with ratings. manual=true is the refresh button:
   *  rate limited to once per 3 minutes, otherwise the cache serves. */
  async getMatches(manual, mode) {
    const m = mode === 'unrated' ? 'unrated' : 'competitive';
    const bucket = matchesClient[m];
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId.includes('#')) return { matches: [], fetchedAt: 0, mode: m, error: 'no-riot-id' };
    const now = Date.now();
    if (manual && now - bucket.lastManual < 3 * 60 * 1000) {
      return { matches: bucket.data || [], fetchedAt: bucket.fetchedAt, mode: m,
               refreshBlockedFor: 3 * 60 * 1000 - (now - bucket.lastManual) };
    }
    if (!manual && bucket.data && now - bucket.fetchedAt < 2 * 60 * 1000) {
      return { matches: bucket.data, fetchedAt: bucket.fetchedAt, mode: m };
    }
    try {
      const { ok, data } = await api.get('/api/coach/matches?username=' + encodeURIComponent(riotId)
        + '&mode=' + m + (manual ? '&refresh=1' : ''), store.get('licenseKey'), 20000);
      if (ok && data && Array.isArray(data.matches)) {
        matchesClient[m] = { data: data.matches, fetchedAt: data.fetchedAt || now,
                             lastManual: manual ? now : bucket.lastManual };
        return { matches: data.matches, fetchedAt: matchesClient[m].fetchedAt, mode: m };
      }
      return { matches: bucket.data || [], fetchedAt: bucket.fetchedAt, mode: m,
               error: (data && data.error) || 'unavailable' };
    } catch {
      return { matches: bucket.data || [], fetchedAt: bucket.fetchedAt, mode: m, error: 'network' };
    }
  },

  /** Ask Coach: one conversation turn. Text-only: the coach works from the
   *  session's tips, match memory, and tracker stats, no screenshots. With no
   *  session played yet the AI is told not to invent gameplay observations. */
  async chat(messages) {
    const licenseKey = store.get('licenseKey');
    if (!licenseKey) return { ok: false, error: 'No license active.' };

    // MID MATCH, the chat gets nothing about the match in progress. Ask Coach
    // is a window the player can keep open on a second monitor, and a chat that
    // knows "died round 5 at A Site" answers "where should I play" with exactly
    // the live advice Occlara does not give.
    const midMatch = matchInProgress();
    // ONE GAME'S DATA IS NEVER SHOWN UNDER ANOTHER GAME'S NAME. The tracker
    // profile and match list are Valorant's, so with League or Rivals chosen
    // the chat was answering about the player's Valorant rank.
    // Asked about one saved review, that review's game, whatever Settings says.
    const seeded = state.chatReviewId ? reviewStore.get(state.chatReviewId) : null;
    const gameId = (seeded && seeded.game) || gameRegistry.get(store.get('game')).id;
    const valorant = gameId === 'valorant';
    // Played this game before: a review of THIS game, or the one on screen.
    const hasSessionData = reviewStore.list(gameId).length > 0
      || !!(lastReviewShown && lastReviewShown.kind === gameId);
    const seededAgent = seeded && seeded.review && seeded.review.game && seeded.review.game.agent;
    const context = {
      game:         gameId,
      agent:        valorant ? (seeded ? seededAgent || null : state.agent && state.agent.agent) : null,
      sessionTips:  [],
      // The League recorder keeps no match memory; reading it threw on every message.
      matchMemory:  engine && !midMatch && Array.isArray(engine.matchMemory) ? engine.matchMemory.slice(-8) : [],
      stats:        valorant ? await fetchTrackerStats() : null,
      noSessionYet: !hasSessionData,
      coachTrend:   valorant ? (() => { const tp = guardedTrackerPair(); return computeCategoryTrends([], tp.stats, tp.prevStats); })() : null,
      // The chat works WITH the stats dashboard: it sees the same recent
      // matches (with ratings) and coached sessions the player is looking at.
      recentMatches: !valorant ? [] : (await this.getMatches(false)).matches.slice(0, 5).map((m) => ({
        map: m.map, agent: m.agent, result: m.result, score: m.score,
        kills: m.kills, deaths: m.deaths, assists: m.assists,
        kd: m.kd, acs: m.acs, adr: m.adr, headshotPct: m.headshotPct, rating: m.rating,
        // WHEN it was played, so the coach can name the match it is talking
        // about instead of saying "your last game". With five matches in the
        // list and two of them on the same map, the map alone does not identify
        // one, and the player cannot tell which game is being discussed.
        queue: m.queue,
        when: m.startedAt
          ? new Date(m.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : null,
      })),
      // The last graded matches from the library, and what keeps repeating.
      // A match graded from Riot's record alone has a grade and no strength or
      // weakness to name (insights.countable).
      recentSessions: midMatch ? [] : reviewStore.recent(gameId, 3).map((e) => ({
        date: new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        map: e.review.game && e.review.game.map, overall: e.review.grade && e.review.grade.score,
        scores: Object.fromEntries(((e.review.grade && e.review.grade.categories) || []).map((c) => [c.key, c.score])),
        strengths: insightsOf.countable(e.review).strengths.slice(0, 2).map((x) => x.title).join('. '),
        weaknesses: insightsOf.countable(e.review).mistakes.slice(0, 2).map((x) => x.title).join('. '),
      })),
      matchReview: midMatch ? null : chatReviewContext(state.chatReviewId, gameId),
      // The playbook is Valorant's: its notes would ground a League answer in
      // Valorant tactics.
      proPlaybook:  valorant ? playbookMode() : 'off',
    };
    try {
      const { ok, status, data } = await api.post('/api/coach/chat', { messages, context }, licenseKey, 30000);
      if (ok && data && data.reply) return { ok: true, reply: data.reply };
      // Same defect as the frame chat: this used to return the error and log
      // nothing, so a chat that failed all session was invisible in debug.log.
      console.error(`[chat] status=${status} ${(data && (data.error || data.message)) || 'no reply'}`);
      return { ok: false, error: chatFailureText(status, data) };
    } catch (e) {
      console.error('[chat] failed:', e.message);
      return { ok: false, error: 'Could not reach the coach server.' };
    }
  },

  /** Settings and onboarding "Connect": test the tracker link right now, and
   *  grade the account's recent matches from Riot's record. */
  async testTracker() {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId || !riotId.includes('#')) {
      return { ok: false, error: 'Enter your Riot ID as Name#TAG first.' };
    }
    const stats = await fetchTrackerStats(true);
    // THE FIELD SAVES AS IT IS TYPED, so it may hold another ID by the time
    // the profile answers. Grading the one read before the wait filed a
    // stranger's matches into the library when a typo that was somebody's
    // real account was corrected mid check. The answer belongs to the ID in
    // Settings now, or to nobody.
    if ((store.get('riotId') || '').trim().toLowerCase() !== riotId.toLowerCase()) {
      return { ok: false, stale: true, error: 'Your Riot ID changed while it was being checked. Press Connect again.' };
    }
    // What this lookup answered. fetchTrackerStats hands back a profile kept
    // from an earlier Connect when the lookup fails, so a profile is not proof
    // the account still exists: a Riot ID renamed since read as connected with
    // its old rank. The lookup's own error decides.
    const lastError = statsCache.riotId === riotId ? statsCache.lastError : null;
    const error = stats ? null : (lastError || 'Could not reach the stats service. Try again in a minute.');
    // AN ACCOUNT WITH NO RANKED PROFILE IS STILL AN ACCOUNT. HenrikDev answers
    // "found the account but no rank or match data yet" for a player who only
    // plays unrated, and their matches can still be graded. Only an account
    // that does not exist stops the backfill before it starts; anything else
    // is for it to find out and say. A Riot ID with no name or no tag cannot
    // exist either, and /player-stats says so as "Enter your Riot ID as
    // Name#TAG", where the other routes say "must be Name#TAG".
    const unranked = !stats && /found the account/i.test(error || '');
    const missing = /could not find|name#tag/i.test(lastError || error || '');
    if (missing) {
      forgetRiotId(riotId);
      return { ok: false, error: lastError || error };
    }
    backfill.start(riotId);
    // Found, ranked or not: the account exists (see the backfill's onStatus).
    if (stats || unranked) store.set('riotConnected', riotId);
    if (stats) return { ok: true, stats };
    if (unranked) return { ok: true, stats: null, unranked: true };
    // The profile could not be loaded right now (a rate limit, the service
    // down), and the grading started anyway: it says for itself if the
    // account turns out not to exist. Reported as a failed Connect, the page
    // said "not connected" over a run grading every match.
    return { ok: true, stats: null, profileError: error };
  },

  logout() {
    // A fresh sign-in gets the tour again (new player on this machine, or a
    // returning one who wants the refresher).
    store.set('onboardingCompleted', false);
    logoutToActivation('You have been logged out. Enter a license key to sign back in.');
  },
  finishOnboarding() {
    store.set('onboardingCompleted', true);
    onboardingWindow.close();
    // First run: the surfaces were held back until the tour finished, so open
    // them now, through the loader like every other launch. Before this, the
    // very first launch was the one that skipped the animation entirely.
    // A no-op if they already exist (tour re-run from Settings).
    openAppWithSplash();
  },
  onConfigChanged() {
    if (engine && engine.setCaptureSpeed) engine.setCaptureSpeed(store.get('captureSpeed') || 'auto');
    // Record match video turned Off, or On again (Settings' "Try again" after
    // it turned itself off): applied to the session in progress at once.
    recorder.prefsChanged();
    // The cap on clips lowered: the oldest go now, not at the next save.
    const capNow = clips.capGB(store.get('clipCapGB'));
    if (capNow !== clipCapSeen) { clipCapSeen = capNow; applyClipCap(); }
    // Riot ID changed (new account connected): every tracker-derived cache is
    // now the WRONG player's data, drop it all immediately. Fresh data flows
    // back in on Connect, session start, or the next dashboard open.
    const riotId = (store.get('riotId') || '').trim();
    if (riotId !== lastRiotId) {
      lastRiotId = riotId;
      matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };
      statsCache = { at: 0, riotId: '', data: null, lastError: null };
      unratedStatsCache = { at: 0, riotId: '', data: null };
      rankHistory.clear();
      console.log('[stats] riot id changed, tracker caches cleared');
      // A grading run for another account stops by itself: it checks the
      // Riot ID in Settings before listing and before every save, and gives
      // a field being retyped a few seconds to come back (backfill.js ours()).
      // Cancelling here, on every debounced keystroke, stopped a run for good
      // when the player only retyped their own ID.
    }

    // GAME CHANGED. A harder boundary than a riot id change: it invalidates the
    // live session, every tracker cache, and the meaning of every open window.
    //
    // Order matters here. stop() archives and grades the session AND clears
    // matchesClient and the rank history itself, so it has to run BEFORE the
    // purge below, or the purge is immediately undone by a stop that follows it.
    const game = gameRegistry.get(store.get('game')).id;
    if (game !== lastGame) {
      const from = lastGame;
      lastGame = game;

      // A running Valorant engine does not become a League engine. It would
      // keep capturing frames and emitting spike and callout tips for a game
      // the player just deselected.
      if (state.isCoaching) {
        console.log(`[coach] game changed ${from} -> ${game}, stopping the running session`);
        this.stop();
      }

      // Every one of these is keyed on riot id alone, never on game, so after a
      // switch they serve Valorant rank, RR and match rows to a League
      // dashboard and look authoritative doing it.
      matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };
      statsCache = { at: 0, riotId: '', data: null, lastError: null };
      unratedStatsCache = { at: 0, riotId: '', data: null };
      rankHistory.clear();

      // The Learn surface is League only. The panel button hides on a switch
      // away, but an ALREADY OPEN window just sat there, which is the gate
      // being enforced in the renderer instead of where gates belong.
      if (game !== 'lol') learnWindow.close();

      console.log(`[game] ${from} -> ${game}, caches cleared`);
      registry.broadcast(C.PUSH_GAME, { id: game, label: gameRegistry.get(game).label });
    }

    registry.broadcast(C.PUSH_STATE, buildState());
  },
  quit() { cleanupAndQuit(); },
};

// Tracker stats for the player's saved Riot ID. Persisted to disk so the link
// survives restarts ("always connected"): the last good profile is seeded from
// the store on boot and returned instantly, while a background refresh updates
// it. Returns the profile object or null.
let statsCache = { at: 0, riotId: '', data: null, lastError: null };

/**
 * A Riot ID that Riot says does not exist is connected no longer, and the
 * profile kept from an earlier Connect of it goes too: Settings and
 * onboarding read that profile back as "Connected, rank Gold 2" for an
 * account that is not there any more, a renamed one included.
 */
function forgetRiotId(riotId) {
  const id = String(riotId || '').trim().toLowerCase();
  if (!id) return;
  if (String(store.get('riotConnected') || '').toLowerCase() === id) store.set('riotConnected', null);
  const saved = store.get('playerStats');
  if (saved && String(saved._riotId || '').trim().toLowerCase() === id) store.set('playerStats', null);
  if (String(statsCache.riotId || '').toLowerCase() === id) statsCache.data = null;
}

(function seedStatsFromDisk() {
  try {
    const savedId = (store.get('riotId') || '').trim();
    const saved   = store.get('playerStats');
    // Only reuse the saved profile if it belongs to the current Riot ID.
    // at: 0 means "usable as a fallback but always due for refresh", so a
    // days-old disk profile is never treated as current just because the
    // app restarted; the next stats request pulls fresh data.
    if (savedId && saved && saved._riotId === savedId) {
      statsCache = { at: 0, riotId: savedId, data: saved, lastError: null };
    }
  } catch {}
})();

/*
 * CONNECTED BEFORE riotConnected WAS KEPT (8.2.1, once). Up to 8.0.2 a
 * Connect kept the profile it loaded and nothing else, so an install from
 * then carries its connection as a profile saved for the Riot ID in Settings.
 * The late link trusts riotConnected alone (connectedRiotId()), so that
 * profile is taken for it here, at load, before this launch's own refresh can
 * write one, and on the first launch that reads it only: after that, a
 * profile is one a launch's refresh saved for whatever ID was typed, and
 * proves nothing.
 */
(function keepOldConnection() {
  try {
    if (store.get('riotConnectedKept')) return;
    store.set('riotConnectedKept', true);
    // Only an install that never ran 8.0.3, the version that brought Connect:
    // before it a typed Riot ID WAS the connection, and after it one typed and
    // never connected is not. rivalsTitlesRepaired is written at the first
    // launch of 8.0.3 or later, and this runs at module load, before this
    // launch's surfaces could write it.
    if (store.get('rivalsTitlesRepaired')) return;
    const id = (store.get('riotId') || '').trim();
    const saved = store.get('playerStats');
    if (id.includes('#') && !store.get('riotConnected') && saved
        && String(saved._riotId || '').trim().toLowerCase() === id.toLowerCase()) {
      store.set('riotConnected', id);
      console.log('[stats] the Riot ID connected before 8.0.3 is kept as connected');
    }
  } catch {}
})();

// Unrated/swiftplay aggregates live in their own cache; the competitive cache
// below stays the persisted profile the coach and chat run on.
let unratedStatsCache = { at: 0, riotId: '', data: null };
// The rank history for Stats and Home, and a link making it stale (rank-history.js).
const rankHistory = new RankHistory({ get: (p, timeoutMs) => api.get(p, store.get('licenseKey'), timeoutMs) });

async function fetchUnratedStats(force) {
  const riotId = (store.get('riotId') || '').trim();
  if (!riotId || !riotId.includes('#')) return null;
  if (!force && unratedStatsCache.data && unratedStatsCache.riotId === riotId
      && Date.now() - unratedStatsCache.at < 10 * 60 * 1000) {
    return unratedStatsCache.data;
  }
  try {
    const { ok, data } = await api.get('/api/coach/player-stats?mode=unrated&username=' + encodeURIComponent(riotId), store.get('licenseKey'), 22000);
    const stats = ok && data && !data.error ? data : null;
    if (stats) unratedStatsCache = { at: Date.now(), riotId, data: stats };
    return stats || (unratedStatsCache.riotId === riotId ? unratedStatsCache.data : null);
  } catch {
    return unratedStatsCache.riotId === riotId ? unratedStatsCache.data : null;
  }
}

async function fetchTrackerStats(force, mode) {
  if (mode === 'unrated') return fetchUnratedStats(force);
  const riotId = (store.get('riotId') || '').trim();
  if (!riotId || !riotId.includes('#')) return null;
  if (!force && statsCache.data && statsCache.riotId === riotId && Date.now() - statsCache.at < 10 * 60 * 1000) {
    return statsCache.data;
  }
  try {
    const { ok, data } = await api.get('/api/coach/player-stats?username=' + encodeURIComponent(riotId), store.get('licenseKey'), 15000);
    const stats = ok && data && !data.error ? data : null;
    if (stats) {
      statsCache = { at: Date.now(), riotId, data: stats, lastError: null };
      store.set('playerStats', { ...stats, _riotId: riotId });   // persist = always connected
    } else {
      // Keep serving the last good profile on a transient failure; just note
      // why. Only this ID's: a lookup for the old ID landing after the switch
      // left its profile here, and relabelled, it read as this account's rank.
      if (statsCache.riotId !== riotId) statsCache = { at: 0, riotId, data: null, lastError: null };
      statsCache.lastError = (data && data.error) || 'Could not reach the stats service.';
    }
    return stats || (statsCache.riotId === riotId ? statsCache.data : null);
  } catch {
    // A lookup that timed out says nothing about the account. Left as it
    // was, the error of the lookup before stood in for this one, and an ID
    // once not found read as not found again for a dropped connection.
    if (statsCache.riotId !== riotId) statsCache = { at: 0, riotId, data: null, lastError: null };
    statsCache.lastError = 'Could not reach the stats service.';
    return statsCache.data;
  }
}

/** The most recent COMPLETED competitive match from the tracker, only when
 *  it ended recently enough to plausibly be this session's match (3 hours).
 *  Null when unavailable; the review simply shows without match stats. */
async function fetchLastMatch() {
  const riotId = (store.get('riotId') || '').trim();
  const licenseKey = store.get('licenseKey');
  if (!riotId || !riotId.includes('#') || !licenseKey) return null;
  try {
    const { ok, data } = await api.get('/api/coach/last-match?username=' + encodeURIComponent(riotId), licenseKey, 30000);
    if (!ok || !data || data.error || !data.result) return null;
    if (!data.startedAt || Date.now() - data.startedAt > 3 * 60 * 60 * 1000) return null;
    return data;
  } catch { return null; }
}

/**
 * Is this tracker match the one we just coached?
 *
 * fetchLastMatch() returns the most recent match within three hours, which is
 * NOT the same claim. A player can queue again before the review lands, alt
 * tab into a different game, or open the app after a match they never coached,
 * and every one of those would otherwise attribute someone else's numbers to
 * this session. A session graded on the wrong match is worse than one graded
 * on no match at all, because it looks authoritative while being wrong.
 *
 * So all three available facts have to agree:
 *   time   the match started inside the coached window (with slack at both
 *          ends, since coaching usually starts mid-agent-select and the clock
 *          Riot reports is the match start, not the buy phase)
 *   map    the map we watched, when the map lock ever confirmed one
 *   agent  the agent we watched, when the agent was confirmed
 *
 * Map and agent are only checked when WE know them; an unknown on our side is
 * not evidence against the match. But whatever we do know must not contradict.
 */
/**
 * The coached match, or null when it cannot be confirmed as ours.
 *
 * ENDED EARLY BY THE WATCH (8.2.1). A match the watch ended on a score it
 * could not continue from, which Riot's record has going on, is refused by
 * every check above for its score. When none of the matches verifies, the
 * ones that pass every check but that one have their round records asked
 * for, and one whose record stood at the screen's last score after that many
 * rounds is the match (match-link.js linkEarly, endedEarly). Its record is
 * handed back in `out.riot`, so the link lays it over the review without a
 * second request, and a record that refused is remembered in `out.refused`
 * for the link's later tries.
 */
async function fetchCoachedMatch(startedAt, endedAt, mctx, out) {
  const lm = await fetchLastMatch();
  if (!lm) return null;
  // The newest match and the few before it, each verified (pickCoachedMatch).
  const { match: m, why, tried } = pickCoachedMatch(lm, startedAt, endedAt, mctx);
  if (out) out.why = why;
  if (m) {
    console.log(`[match-link] linked: ${m.map} ${m.agent} ${m.result} ${m.score} (${m.kills}/${m.deaths}/${m.assists}, ACS ${m.acs})`);
    return m;
  }
  const refused = out ? (out.refused = out.refused || new Set()) : new Set();
  const early = await linkEarly(lm, startedAt, endedAt, mctx, riotRoundsFor, refused);
  if (early) {
    const e = early.match;
    const s = (mctx && mctx.score) || {};
    if (out) { out.why = null; out.riot = { matchId: e.matchId, record: early.riot }; }
    console.log(`[match-link] linked a match the watch ended early at ${s.team}-${s.enemy}: `
      + `${e.map} ${e.agent} ${e.result} ${e.score} (${e.kills}/${e.deaths}/${e.assists}, ACS ${e.acs})`);
    return e;
  }
  console.log(`[match-link] not linking any of the last ${tried} matches to this session: ${why}`);
  return null;
}

// ── Session performance log (extended stats dashboard) ──────────────────────
// One small record per coached session (four category scores + strengths and
// weaknesses text). Kept in its own file, NOT the 7-day session archive, so
// trends survive pruning. Capped at the last 100 sessions.
/**
 * A recorded League game: grade it, keep it, show it.
 *
 * The history cap matters. lol-targets.BASELINE_GAMES is all a baseline is ever
 * computed from, so an unbounded list would grow forever inside the config file
 * for no benefit at all.
 *
 * The REVIEW IS BUILT DETERMINISTICALLY, in lol-review.js, not generated. A
 * review is where a confident wrong sentence is most expensive, because the game
 * is over and the player cannot check it against anything but a half memory.
 */
function finishLolGame(record) {
  const review = require('../shared/lol-review');
  // Not "grader": that name is grade.js at the top of this file, and shadowing
  // it here made grader.lol throw, so every League review was saved ungraded.
  const lolGrader = require('../shared/lol-grader');
  const targets = require('../shared/lol-targets');
  try {
    const history = store.get('lolHistory') || [];
    const built = review.buildReview(record, history);
    const graded = lolGrader.gradeGame(record, history);

    const entry = {
      at: Date.now(),
      champion: record.champion || null,
      role: record.role || null,
      mode: record.mode || null,
      measured: graded.measured,
      graded: graded.results,
    };
    store.set('lolHistory', [...history, entry].slice(-targets.BASELINE_GAMES));

    built.kind = 'lol';
    built.id = newId('lol');
    built.at = Date.now();
    try {
      built.grade = grader.lol(built);
      built.insights = insightsOf.lol(built);
    } catch (e) { console.error('[lol] grade failed:', e.message); }
    lastLolReview = built;
    showReview(built);
    saveReview(built, 'lol');
    openPage('review');
    console.log(`[lol] review ready: ${built.scoreline.kills}/${built.scoreline.deaths}/${built.scoreline.assists}`);
    clipLolDeaths(built, record).catch((e) => console.log('[clips] the League deaths could not be clipped:', e.message));
  } catch (e) {
    // A failed grade must never lose the game that was recorded, so the raw
    // record is kept for inspection rather than dropped on the floor.
    console.error('[lol] review failed:', e.message);
    lastLolRaw = record;
  }
}

/**
 * A LEAGUE GAME'S DEATHS, CLIPPED (8.3), once its review is on screen. The
 * game stamps each death by its own clock, and the recorder noted that clock
 * against the wall clock on every poll (lol-recorder.js timeline), so a death
 * at 14:32 of game time is found in the recording by wall time (wallAt) and
 * cut 11 s before to 4 s after, as a Valorant look's moment is. Six at most,
 * spread across the game when it had more (pickSpread). Nothing else holds a
 * League game's recording, so it is held here, from the game's start, while
 * they are cut. A game not recorded has no clips, and "Your deaths" lists its
 * deaths as before. Nor does a game that ends after the player chose Off, or
 * one still waiting for its clips when they do (shared/clips.js cutsClips, as
 * in cutLookClips).
 */
const LOL_CLIP_SETTLE_MS = 6000;
async function clipLolDeaths(built, record) {
  const { wallAt } = require('./services/lol-recorder');
  const off = () => !clips.cutsClips(store);
  const deaths = Array.isArray(built.deathList) ? built.deathList : [];
  const timeline = record && Array.isArray(record.timeline) ? record.timeline : [];
  if (!deaths.length || !timeline.length || off()) return;
  const looks = clips.pickSpread(deaths, clips.MAX_CLIPS)
    .map((d) => ({ key: d.n, name: clips.deathClip(d.n), moment: wallAt(timeline, d.atSec) }))
    .filter((l) => l.name && Number.isFinite(l.moment));
  if (!looks.length) return;
  const from = Number.isFinite(record.startedAt) ? record.startedAt : Math.min(...looks.map((l) => l.moment)) - clips.BEFORE_MS;
  const hold = holdRecording(from - 5000, Date.now() + 1000, 10 * 60 * 1000);
  try {
    // A death in the last fight of the game ends its clip's four seconds
    // after the game's end, and the recording writes a second at a time:
    // a few seconds more, and those are on disk too.
    await new Promise((resolve) => setTimeout(resolve, LOL_CLIP_SETTLE_MS));
    if (off()) return;
    const r = await reviewClips.cutClips({
      looks, max: clips.MAX_CLIPS,
      cut: (a, b, at) => recorder.cutClip(a, b, at),
      save: (name, bytes) => reviewStore.saveClip(built.id, name, bytes) > 0,
      stopped: off,
    });
    console.log(`[clips] ${built.id}: ${r.kept.length} of ${looks.length} deaths clipped${r.missed ? `, ${r.missed} not in the recording` : ''}`);
    if (!r.kept.length) return;
    for (const k of r.kept) {
      const d = deaths.find((x) => x.n === k.key);
      if (d) d.clip = k.name;
    }
    saveReview(built, 'lol');
    if (lastReviewShown && lastReviewShown.id === built.id) showReview(built);
    applyClipCap();
  } finally {
    releaseRecording(hold);
  }
}
let lastLolReview = null;
let lastLolRaw = null;
// Held for the same reason lastLolReview is: the review window can be opened by
// hand after the push, and a window that opens empty looks like a bug rather
// than like a match nobody has played yet.
// Whichever review arrived most recently, of either game, which is what the
// review window shows. Held because the window can be opened by hand after the
// push, and one that opens empty reads as a bug rather than as a match nobody
// has played yet.
let lastReviewShown = null;

/**
 * Turn a failed coach call into something worth reading.
 *
 * The old behaviour was a flat "The coach had no answer", which is the same
 * sentence whether the wallet is empty, the key is rate limited, or the model
 * timed out. Those need three different reactions from the player and only one
 * of them is "try again".
 */
function chatFailureText(status, data) {
  const said = String((data && (data.error || data.message)) || '').toLowerCase();
  if (status === 402 || said.includes('credit')) {
    return 'The coach is out of credits on the server. This is not your connection, and it comes back when the balance does.';
  }
  if (status === 429 || said.includes('rate limit')) {
    return 'Too many questions too quickly. Wait a few seconds and ask again.';
  }
  if (status === 403) return 'That licence is not active any more.';
  if (status === 503 || status === 504) {
    return 'The coach took too long to look at this frame. Ask again, and a shorter question usually lands.';
  }
  if (said) return said.charAt(0).toUpperCase() + said.slice(1);
  return 'The coach had no answer for that frame.';
}

function emptyMatchBucket() { return { data: null, fetchedAt: 0, lastManual: 0 }; }
let matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };   // per-mode tracker cache
let lastRiotId = (store.get('riotId') || '').trim();               // detects account switches
// SEEDED FROM THE STORE, never left undefined. onConfigChanged runs on every
// config write, so if this started empty the first unrelated save (tip opacity,
// language, anything at all) would read as a game switch and stop a live
// coaching session. Same reason lastRiotId is seeded above.
let lastGame = gameRegistry.get(store.get('game')).id;             // detects game switches

/** Tracker-derived category levels, the heavier half of the ratings.
 *  Rubric (what the numbers mean, anchored to competitive reality):
 *    Aim         = HS% * 2.6 + KPR * 25
 *                  elite 90+ (27% HS, 0.9 kills/rd) · solid 70 (20%, 0.7) · weak under 50 (12%, 0.5)
 *    Positioning = 140 - deaths-per-round * 100 (dying less = positioned better)
 *                  elite 85 (0.55 DPR) · average 65 (0.75) · weak 45 (0.95)
 *    Utility     = 30 + assists-per-round * 150 (assists track util that enabled kills)
 *                  elite 90 (0.40 APR) · average 65 (0.23) · weak 45 (0.10)
 *    Impact      = 20 + ACS * 0.25 (combat score is Riot's own round-influence number)
 *                  elite 90 (280 ACS) · strong 75 (220) · weak under 58 (150)
 *  (Economy was retired: no tracker signal, and the coach never tips economy.)
 *  Values clamp to 5..95: nobody is a 0 or a 100 over ten games. */
function trackerCategoryScores(st) {
  if (!st || st.kpr == null) return {};
  const clamp = (v) => Math.max(5, Math.min(95, Math.round(v)));
  const out = {
    aim:         clamp((st.headshotPct || 0) * 2.6 + (st.kpr || 0) * 25),
    positioning: clamp(140 - (st.dpr != null ? st.dpr : 0.85) * 100),
    utility:     clamp(30 + (st.apr || 0) * 150),
  };
  if (st.acs != null) out.impact = clamp(20 + st.acs * 0.25);
  return out;
}

// ── Weekly report ────────────────────────────────────────────────────────────
// A once-a-week look back the player gets when they open the app: which stats
// moved and in which direction, what they have been doing well, and the one
// thing to work on. Everything is assembled from data the app already has, the
// tracker profile plus the graded coaching sessions, so it costs no extra calls.

/**
 * Gather this week's inputs and hand them to the report assembler. Only a
 * snapshot from the SAME account can serve as the baseline, otherwise a
 * switched Riot ID would show as a dramatic week of "improvement".
 */
function buildWeeklyReport() {
  const riotId   = (store.get('riotId') || '').trim();
  const snapshot = store.get('weeklySnapshot');
  const tp       = guardedTrackerPair();
  const game     = gameRegistry.get(store.get('game')).id;
  const base = snapshot && snapshot.stats && (!snapshot.riotId || snapshot.riotId === riotId)
    ? snapshot.stats : null;
  // Read once for both: the fortnight is the newest of them, and the patterns
  // look further back, for the last ten recorded matches (patterns.js).
  const recent = reviewStore.recent(game, patternsOf.LOOK_BACK);

  return assembleReport({
    riotId,
    game,
    // Tracker stats are Valorant's; another game's week is its reviews alone.
    stats: game === 'valorant' ? tp.stats : null,
    base: game === 'valorant' ? base : null,
    snapshotAt: snapshot ? snapshot.at : null,
    // The last fortnight of graded matches, so this week can be compared with
    // the one before it.
    reviews: recent.filter((e) => e.at >= Date.now() - 14 * 24 * 60 * 60 * 1000),
    patterns: patternsOf.summarise(recent),
  });
}

/** Roll the comparison baseline forward once a week's report has been seen. */
function rollWeeklyBaseline() {
  const riotId = (store.get('riotId') || '').trim();
  const tp = guardedTrackerPair();
  if (!tp.stats) return;
  const snap = store.get('weeklySnapshot');
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (!snap || !snap.at || Date.now() - snap.at >= weekMs || snap.riotId !== riotId) {
    store.set('weeklySnapshot', { at: Date.now(), riotId, stats: tp.stats });
    console.log('[weekly] baseline rolled forward');
  }
}

/** Riot-ID-guarded tracker snapshots (current profile + last-match snapshot). */
function guardedTrackerPair() {
  const riotId  = (store.get('riotId') || '').trim();
  const raw     = store.get('playerStats');
  const rawPrev = store.get('lastMatchStats');
  return {
    stats:     raw && raw._riotId === riotId ? raw : null,
    prevStats: rawPrev && (!rawPrev._riotId || rawPrev._riotId === riotId) ? rawPrev : null,
  };
}

/** Category ratings for the dashboard and the live coach: coached-session
 *  averages blended with tracker reality. The tracker carries the heavier
 *  weight (60/40) wherever it can speak; with only one source, that source
 *  stands alone. Direction compares the same blend against the previous
 *  10 sessions and the previous tracker snapshot. */
function computeCategoryTrends(perf, stats, prevStats) {
  const recent = perf.slice(-10);
  const prev   = perf.slice(-20, -10);
  const avg = (rows, k) => rows.length
    ? Math.round(rows.reduce((s, r) => s + ((r.scores && r.scores[k]) || 0), 0) / rows.length)
    : null;
  const tNow  = trackerCategoryScores(stats);
  const tPrev = trackerCategoryScores(prevStats);
  const blend = (sessionAvg, trackerVal) =>
    trackerVal == null ? sessionAvg
    : sessionAvg == null ? trackerVal
    : Math.round(trackerVal * 0.6 + sessionAvg * 0.4);
  const out = {};
  for (const k of ['impact', 'positioning', 'utility', 'aim']) {
    const nowV  = blend(avg(recent, k), tNow[k]);
    const prevV = blend(prev.length ? avg(prev, k) : null, tPrev[k]);
    out[k] = { avg: nowV, direction: trendDirection(nowV, prevV) };
  }
  return out;
}

// Rank ladder + trend arrows live with the weekly report, which is their main
// consumer; the stats dashboard shares the same helpers so both agree on what
// counts as a move up or down.

/** The Pro Playbook is no longer a setting: hybrid (classic brief plus
 *  situation-retrieved habits) proved the strongest mode and is now standard. */
function playbookMode() {
  return 'hybrid';
}

// ── AI decision log ──────────────────────────────────────────────────────────
// One folder per coaching session holding the frames the coach read, plus a
// log.json of what it parsed and said for each. This is the "look back and see
// what went wrong" record: every entry pairs a screenshot with the STATE the AI
// derived (its notes) and the tip. Capped per session and pruned to the few
// most recent sessions so it never grows without bound.
// At a read every second a match is two thousand frames, so the log keeps:
//   every frame of the last few minutes, whole
//   every frame around a death the engine registered, before and after it,
//     because that is what the review goes back to look at
//   every frame around a round change, where a round filed wrong is traced
//     to (8.3.1)
//   one frame every ten seconds of everything older, for the viewer
// and holds a finished match's frames whole until its review has looked.
const AI_LOG_RECENT        = 180;     // the last three minutes at the fastest read
const AI_LOG_THIN_MS       = 10000;   // older frames: one per ten seconds
const AI_LOG_DEATH_BEFORE  = 35000;   // kept before a registered death
const AI_LOG_DEATH_AFTER   = 5000;    // and after it
const AI_LOG_ROUND_MS      = 10000;   // kept either side of a round change
const AI_LOG_MAX_FRAMES    = 1500;    // hard ceiling, oldest go first
const AI_LOG_KEEP_SESSIONS = 5;       // only the most recent sessions survive
const AI_LOG_WRITE_MS      = 3000;    // log.json is rewritten at most this often
let aiLogDir = null;               // current session's folder
let aiLogRecords = [];             // in-memory index, flushed to log.json
let aiLogWarned = false;           // one write failure is reported per session
let aiLogSeq = 0;                  // frame file counter, never reused in a session
let aiLogKeepUntil = 0;            // frames up to here follow a death, and are kept
let aiLogTurnUntil = 0;            // and these a round change
let aiLogHolds = [];               // [{ from, to, until }] matches awaiting their review
let aiLogLastWrite = 0;
let aiLogWriteTimer = null;

function aiLogRoot() { return path.join(app.getPath('userData'), 'ai-log'); }

/** The id of the session being written right now, so the picker can mark it. */
function aiLogLiveId() { return aiLogDir ? path.basename(aiLogDir) : null; }

/** Start a fresh log folder for a coaching session. */
function startAiLog() {
  if (store.get('aiLog') === false) { aiLogDir = null; return; }
  try {
    const root = aiLogRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    // Make room first. Pruning after the folder exists deleted the session
    // that had just been started, because it has no log.json until its first
    // frame lands and that is exactly what the empty rule looks for.
    pruneAiLog();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    aiLogDir = path.join(root, 'session-' + stamp);
    fs.mkdirSync(aiLogDir, { recursive: true });
    aiLogDirsCache = null;   // the session before this one is finished now
    aiLogRecords = [];
    aiLogWarned = false;
    aiLogSeq = 0;
    aiLogKeepUntil = 0;
    aiLogTurnUntil = 0;
    console.log('[ai-log] started', path.basename(aiLogDir));
  } catch (e) { aiLogDir = null; console.error('[ai-log] start failed:', e.message); }
}

/** Sink handed to the engine: write the frame, append the record, thin the old ones. */
function recordAiFrame(d) {
  if (!aiLogDir || !d || !d.image) return;
  try {
    const at = d.at || Date.now();
    const i = aiLogSeq++;
    const frameFile = `frame-${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(aiLogDir, frameFile), Buffer.from(d.image, 'base64'));
    const rec = {
      i, at, frame: frameFile, state: d.state || {},
      round: typeof d.round === 'number' ? d.round : null, died: !!d.died, match: d.match || null,
    };
    if (rec.died) {
      for (const r of aiLogRecords) if (r.at >= at - AI_LOG_DEATH_BEFORE) r.keep = true;
      rec.keep = true;
      aiLogKeepUntil = at + AI_LOG_DEATH_AFTER;
    } else if (at <= aiLogKeepUntil) {
      rec.keep = true;
    }
    // A ROUND CHANGE IS KEPT AS A DEATH IS (8.3.1): the ten seconds either side
    // of a frame the ledger filed under another round than the frame before.
    // The reads that moved the round are what a round filed wrong is traced to,
    // and thinned to one in ten seconds they were gone: on the player's Sunset
    // swiftplay a buy read seven seconds before round 4's buy phase ended began
    // round 5, and the play read that let it was not in the log. Marked apart
    // (`turn`), so the cap loses these before any death's.
    const prev = aiLogRecords[aiLogRecords.length - 1];
    if (prev && typeof rec.round === 'number' && typeof prev.round === 'number' && rec.round !== prev.round) {
      for (const r of aiLogRecords) if (r.at >= at - AI_LOG_ROUND_MS) r.turn = true;
      rec.turn = true;
      aiLogTurnUntil = at + AI_LOG_ROUND_MS;
    } else if (at <= aiLogTurnUntil) {
      rec.turn = true;
    }
    aiLogRecords.push(rec);
    if (i % 10 === 0) thinAiLog();
    flushAiLog(false);
  } catch (e) {
    /*
     * A dropped frame is not worth interrupting the read, and it is worth
     * saying once. Reported per session rather than per frame: at a frame
     * every second an unconditional log would bury everything else, and
     * silence is what let a whole broken session pass unnoticed for two weeks.
     */
    if (!aiLogWarned) {
      aiLogWarned = true;
      console.error('[ai-log] cannot write frames, this session will not be logged:', e.message);
    }
  }
}

/** Drop what the log no longer needs; see the constants above for what stays. */
function thinAiLog() {
  const now = Date.now();
  aiLogHolds = aiLogHolds.filter((h) => h.until > now);
  const held = (r) => aiLogHolds.some((h) => r.at >= h.from && r.at <= h.to);
  const edge = aiLogRecords.length - AI_LOG_RECENT;
  if (edge <= 0) return;
  const out = [];
  let lastKept = -Infinity;
  aiLogRecords.forEach((r, idx) => {
    const keep = idx >= edge || r.keep || r.turn || r.kept || held(r) || r.at - lastKept >= AI_LOG_THIN_MS;
    if (keep) {
      if (idx < edge) { r.kept = true; lastKept = r.at; }
      out.push(r);
    } else {
      try { fs.unlinkSync(path.join(aiLogDir, r.frame)); } catch {}
    }
  });
  // THE CAP LOSES THE LEAST FIRST, and never the last three minutes. Taking
  // the oldest unheld record took the live match's death windows once a long
  // hold (a review still waiting for Riot) filled the log. A round change's
  // frames go before any death's: the review goes back to the deaths. And
  // after a held match's other frames: ranked with them, the round changes of
  // a match played straight after another, the one before it held for its
  // review, were the first frames the cap took.
  while (out.length > AI_LOG_MAX_FRAMES) {
    const limit = out.length - AI_LOG_RECENT;
    const first = (test) => { for (let i = 0; i < limit; i++) if (test(out[i])) return i; return -1; };
    let k = first((r) => !r.keep && !r.turn && !held(r));
    if (k < 0) k = first((r) => !r.keep && !r.turn && held(r));
    if (k < 0) k = first((r) => !r.keep && !held(r));
    if (k < 0) k = first((r) => !r.keep && held(r));
    if (k < 0) k = first((r) => r.keep && !held(r));
    if (k < 0) k = 0;
    const drop = out.splice(k, 1)[0];
    try { fs.unlinkSync(path.join(aiLogDir, drop.frame)); } catch {}
  }
  aiLogRecords = out;
}

/** Write log.json, at most every few seconds unless forced. */
function flushAiLog(force) {
  if (!aiLogDir) return;
  const write = () => {
    aiLogWriteTimer = null;
    aiLogLastWrite = Date.now();
    try {
      // The app version is stamped so a review of this session can tell whether
      // it predates a guard.
      fs.writeFileSync(path.join(aiLogDir, 'log.json'), JSON.stringify({
        startedAt: aiLogRecords[0] ? aiLogRecords[0].at : Date.now(),
        app: app.getVersion(),
        records: aiLogRecords,
      }));
    } catch (e) {
      if (!aiLogWarned) { aiLogWarned = true; console.error('[ai-log] cannot write the index:', e.message); }
    }
  };
  if (force || Date.now() - aiLogLastWrite >= AI_LOG_WRITE_MS) { clearTimeout(aiLogWriteTimer); write(); return; }
  if (!aiLogWriteTimer) aiLogWriteTimer = setTimeout(write, AI_LOG_WRITE_MS);
}

/**
 * A finished match's frames, for its review, held whole until the review has
 * looked. Riot publishes the match minutes later, and thinning in the meantime
 * would delete the very frames the death forensics needs.
 *
 * UNTIL IT IS RELEASED (releaseAiLogFrames, when the link is done), however
 * long the link takes, and an hour at most (aiLogStore.HOLD_MAX_MS) for a
 * release that never comes. A fixed forty minutes ran out under a match
 * stopped halfway, whose link can still be trying, and its look from the
 * screen still to come, past that.
 */
function holdAiLogFrames(from, to) {
  if (!aiLogDir) return null;
  const hold = { from: from - 5000, to: to + 5000, until: Date.now() + aiLogStore.HOLD_MAX_MS };
  aiLogHolds.push(hold);
  flushAiLog(true);
  aiLogDirsCache = null;   // its index is on disk, so the review's eye finds the session
  return {
    dir: aiLogDir, hold,
    records: aiLogRecords.filter((r) => r.at >= hold.from && r.at <= hold.to).map((r) => ({ ...r })),
  };
}
function releaseAiLogFrames(log) {
  if (!log || !log.hold) return;
  aiLogHolds = aiLogHolds.filter((h) => h !== log.hold);
}

/**
 * A finished match's recording, held as its AI log frames are (8.3): pages
 * older than two minutes go unless a hold covers them, and a review looks at
 * its deaths minutes after the match, once Riot has published it. Until
 * released (releaseRecording: once Riot's look has cut its clips, or when the
 * review's work is done), and `forMs` at most, an hour by default (recorder.js
 * HOLD_MAX_MS).
 */
function holdRecording(from, to, forMs) { return recorder.hold(from, to, forMs); }
function releaseRecording(hold) { recorder.release(hold); }

/**
 * A review's work is done (or withdrawn): its AI log frames and its recording
 * are let go together, the recording unless Riot's look let it go already
 * (recordingCut). The clips of the moments it looked at are cut before this,
 * as each look lands (clipLooks), since the recording's pages go once nothing
 * holds them.
 */
function releaseMatchHolds(job) {
  if (!job) return;
  releaseAiLogFrames(job.log);
  releaseRecording(job.recording);
}

/** Keep only the most recent session folders. */
function pruneAiLog() {
  // The live folder is named so no prune can remove the session in progress,
  // whichever order the caller happens to run in.
  aiLogStore.prune(aiLogRoot(), AI_LOG_KEEP_SESSIONS, aiLogLiveId());
  aiLogDirsCache = null;
}

/*
 * WHICH FRAMES OF THE LOG ARE A REVIEW'S (8.2), for the eye on its library row
 * and its page. Read once and kept, never per row per paint: the kept session
 * folders change only when a session starts or is pruned (both above, and both
 * drop the list), and the matches a finished session holds never change. The
 * list also lives thirty seconds at most, for a folder deleted by hand.
 */
const AI_LOG_DIRS_MS = 30 * 1000;
let aiLogDirsCache = null;           // { at, ids }: the kept session folders
const aiLogSpansCache = new Map();   // a finished session's id -> the matches it holds

function keptAiLogDirs() {
  if (!aiLogDirsCache || Date.now() - aiLogDirsCache.at > AI_LOG_DIRS_MS) {
    aiLogDirsCache = { at: Date.now(), ids: aiLogStore.dirs(aiLogRoot()) };
  }
  return aiLogDirsCache.ids;
}

/** The finished sessions and the matches each holds, for a review saved before 8.2. */
function finishedAiLogSpans() {
  const live = aiLogLiveId();
  const ids = keptAiLogDirs().filter((id) => id !== live);
  for (const id of aiLogSpansCache.keys()) if (!ids.includes(id)) aiLogSpansCache.delete(id);
  return ids.map((id) => {
    if (!aiLogSpansCache.has(id)) aiLogSpansCache.set(id, aiLogStore.matchesIn(aiLogRoot(), id));
    return { id, spans: aiLogSpansCache.get(id) };
  });
}

/** What scopeFor() reads of a library row, and of a whole review. */
function rowLogEntry(row) {
  const r = row || {};
  return { valorant: r.game === 'valorant', source: r.source, at: r.at, aiLog: r.aiLog };
}
function reviewLogEntry(review, at) {
  const r = review || {};
  return { valorant: r.kind === 'valorant', source: r.source, at, aiLog: r.aiLog };
}

/** A review's frames in the log: its scope, false once gone, null with none to keep. */
function aiLogScopeOf(entry) {
  return aiLogStore.scopeFor(entry, keptAiLogDirs, finishedAiLogSpans);
}

/** The same, as the one word a page is handed: 'kept', 'gone' or null. */
function aiLogStateOf(entry) {
  const scope = aiLogScopeOf(entry);
  return scope === null ? null : scope ? 'kept' : 'gone';
}

/** Metadata for the session picker: every kept session, and no frames. */
function aiLogSessions() { return aiLogStore.sessions(aiLogRoot(), aiLogLiveId()); }

/**
 * Check a logged session's deaths against Riot's record of the match.
 *
 * Three tracker calls, so results are cached: the HenrikDev rate limit is strict
 * enough to have emptied whole queues out of the stats view before, and
 * reopening the log should not cost anything.
 *
 * A CONFIRMED result is cached for the life of the process, because a finished
 * match never changes. A FAILURE is cached only briefly, and that difference
 * matters more than it looks: the tracker takes a minute or two to index a match
 * after it ends, and the session a player is most likely to open is the one they
 * just played. Caching "no match lines up" permanently meant checking once,
 * seconds too early, and then never again, so the confirmation silently never
 * appeared for the game they actually wanted it for.
 *
 * Everything here fails to "unavailable" rather than to an error, because this
 * is a confirmation of something the viewer has already shown. No Riot ID, no
 * network, an unranked custom the tracker never saw: in all of those the deaths
 * read off the screen are still the best available answer.
 */
const DEATH_CHECK_RETRY_MS = 3 * 60 * 1000;   // how long a failure is remembered
const deathChecks = makeCheckCache(DEATH_CHECK_RETRY_MS);
const deathCheckRemember = (key, rec) => deathChecks.remember(key, rec);

async function confirmDeaths(id, scope) {
  // ONE MATCH of a session (a review's eye) is checked as it was read: that
  // session or nothing, and its own frames, whose deaths are the ones on
  // screen and line up with one Riot match. Cached apart from the session.
  //
  // AND A WHOLE SESSION IS THE ONE NAMED (8.2), as it is read: one the log no
  // longer keeps is unavailable, never the newest folder in its place, whose
  // deaths, the match in progress among them, would be summed up under this
  // one's marks. The session being written is not checked mid match either,
  // decided on the session checked (aiLogStore.served), as every read is.
  const scoped = !!scope && typeof scope === 'object';
  const chosen = scoped && !id ? null
    : aiLogStore.served(aiLogStore.dirs(aiLogRoot()), id, aiLogLiveId(), liveLogSealed()).id;
  if (!chosen) return { status: 'unavailable' };
  const key = scoped ? `${chosen}|${Number(scope.match)}` : chosen;
  const cached = deathChecks.get(key);
  if (cached) return cached;

  const riotId = (store.get('riotId') || '').trim();
  const licenseKey = store.get('licenseKey');
  if (!riotId.includes('#') || !licenseKey) return { status: 'unavailable', why: 'no Riot ID set' };

  try {
    const log = aiLogStore.read(aiLogRoot(), chosen, null, scoped ? scope : undefined);
    const recs = log.records || [];
    if (!recs.length) return { status: 'unavailable' };
    const detected = aiLogTimeline.deaths(recs);
    const segs = aiLogTimeline.segments(recs);

    // Both queues, because a coached game is as likely to be unrated as ranked
    // and the match list is per queue.
    //
    // ONE RETRY PER QUEUE, because the tracker's account lookup fails
    // intermittently under its own rate limit and reports it as "Account not
    // found", which reads like a wrong Riot ID rather than a blip. Reproduced
    // here four times in a row: the first call failed and the second, seconds
    // later, returned all ten matches. Losing a queue to that means losing every
    // unrated game, which is most of what gets coached.
    const matches = [];
    for (const mode of ['competitive', 'unrated']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 2500));
        const { ok, data } = await api.get(
          `/api/coach/matches?mode=${mode}&username=${encodeURIComponent(riotId)}`, licenseKey, 30000);
        if (ok && data && Array.isArray(data.matches)) { matches.push(...data.matches); break; }
        if (attempt) console.log(`[ai-log] ${mode} match list unavailable: ${(data && data.error) || 'no answer'}`);
      }
    }
    // The same verification the session review uses, so a session is never
    // graded against a match somebody else was playing.
    const mctx = { map: segs[0] && segs[0].map, agent: null };
    const hit = matches.find((m) => verifyCoachedMatch(m, recs[0].at, recs[recs.length - 1].at, mctx).ok);
    if (!hit) {
      // Short lived on purpose: a match that has only just ended is not in the
      // tracker yet, and this is exactly the session a player opens first.
      return deathCheckRemember(key, { status: 'unavailable', why: 'no tracker match lines up with this session' });
    }

    const { ok, data } = await api.get(
      `/api/coach/match-deaths?matchId=${encodeURIComponent(hit.id)}&username=${encodeURIComponent(riotId)}`,
      licenseKey, 30000);
    if (!ok || !data || data.error) {
      return deathCheckRemember(key, { status: 'unavailable', why: (data && data.error) || 'tracker did not answer' });
    }

    const rec = reconcileDeaths(detected, data, recs);
    rec.summary = summariseDeaths(rec);
    rec.match = { map: hit.map, score: hit.score, agent: hit.agent, result: hit.result };
    console.log(`[ai-log] death check for ${key}: ${rec.summary}`);
    return deathCheckRemember(key, rec);
  } catch (e) {
    console.error('[ai-log] death check failed:', e.message);
    return { status: 'unavailable', why: 'the check could not run' };
  }
}

// ── License (real service) ───────────────────────────────────────────────────
// Thin adapter over license-service that also drives the window transitions
// (close activation + launch the app) on a successful activation.
const license = {
  async activate(key) {
    const result = await licenseService.activate(key);
    if (result.valid) {
      state.licenseActive = true;   // clear any prior "ended" lock
      state.licenseReason = '';
      activationWindow.close();
      launchMainApp();
    }
    return result;
  },
  getCached() { return licenseService.getCached(); },
};

// ── Subscription lifecycle (soft lock) ───────────────────────────────────────
// When the subscription ends we DON'T force the user out; we stop all coaching
// (no AI and no library tips) and surface the ended state in the panel + Settings
// so they can renew. Coaching stays disabled until a re-validation says active.
function enterLicenseEnded(reason) {
  state.licenseReason = reason || state.licenseReason || 'expired';
  if (!state.licenseActive) { registry.broadcast(C.PUSH_STATE, buildState()); return; }
  state.licenseActive = false;
  console.warn('[license] subscription ended:', state.licenseReason);
  if (state.isCoaching) controller.stop();   // kills the engine: no more tips at all
  const msg = licenseService.messageForStatus(state.licenseReason) ||
    'Your Occlara subscription has ended. Renew to keep coaching.';
  pushNotice(msg);  // one notice explaining why tips stopped
  registry.broadcast(C.PUSH_STATE, buildState());
}

function exitLicenseEnded() {
  if (state.licenseActive) return;
  state.licenseActive = true;
  state.licenseReason = '';
  state.notice = null;   // "your subscription has ended" is no longer true
  console.log('[license] subscription active again');
  registry.broadcast(C.PUSH_STATE, buildState());
}

// Authoritative check: only the license endpoint decides active vs ended.
function revalidateNow() {
  licenseService.revalidate()
    .then((r) => {
      if (r.valid === false) enterLicenseEnded(r.status);
      else if (r.valid)      exitLicenseEnded();
    })
    .catch(() => {});
}

// Tear down the running session (windows, engine, tray, hotkeys) WITHOUT quitting
// the app, so we can return to the activation window.
function teardownSession() {
  try { if (engine) { engine.stop(); engine = null; } } catch (e) {}
  // Logged out: the recording stops, nothing of the screen stays on disk, the
  // session's counts are kept for the server, and the AI log, made again at
  // the next sign in, is back in captures ('running' false).
  try { recorder.shutdown(); } catch (e) {}
  // Logged out: no grading carries on under a licence that is gone, and no
  // late link starts after it.
  try { backfill.cancel(); } catch (e) {}
  if (lateLinkTimer) { clearTimeout(lateLinkTimer); lateLinkTimer = null; }
  try { hotkeys.unregister(); } catch (e) {}
  try { tray.destroy(); } catch (e) {}
  try { capture.disposeWorker(); } catch (e) {}
  // The main window takes its page views with it (main-window.js).
  for (const name of ['dock', 'main', 'weekly', 'ailog', 'learn']) {
    const w = registry.get(name);
    if (w && !w.isDestroyed()) w.destroy();
  }
  if (sealTimer) { clearInterval(sealTimer); sealTimer = null; }
  sealHeld = false;
  state.isCoaching = false;
  state.isPaused   = false;
  state.status     = 'idle';
  state.agent      = { agent: null, confirmed: false, role: null };
  surfacesUp       = false;   // a fresh login rebuilds the surfaces
}

// Log the user out: clear the cached license, tear the session down, and show the
// activation window. Stays logged out until a new key is activated.
function logoutToActivation(reason) {
  stopLicenseWatch();
  // The recording ends while the licence key is still there, so its session's
  // counts go with it: ended after the clear, the post found no key and the
  // block waited for the next launch, and a session ended before then took
  // its place unsent. teardownSession's own shutdown finds nothing left.
  try { recorder.shutdown(); } catch (e) {}
  licenseService.clear();
  teardownSession();
  mainLaunched = false;
  console.log('[license] logged out', reason ? `(${reason})` : '(manual)');
  showActivation(reason);
}

// ── License watchdog ─────────────────────────────────────────────────────────
// Every minute: an offline-safe expiry check (the cached expiry date passing).
// Every ~10 minutes: a server re-validation, and a state broadcast so the open
// Settings window always reflects the current plan/status/expiry.
let licenseWatch = null;
let licenseTick  = 0;
function startLicenseWatch() {
  stopLicenseWatch();
  licenseTick = 0;
  licenseWatch = setInterval(() => {
    if (!mainLaunched) return;
    // Offline-safe: the cached expiry date has passed. (Doesn't return early, so
    // the server re-check below can still detect a renewal.)
    if (state.licenseActive && !licenseService.isLocallyValid()) {
      const status = store.get('licenseStatus');
      enterLicenseEnded(status && status !== 'active' ? status : 'expired');
    }
    // Server re-check every ~3 minutes: catches a server-side end AND a renewal,
    // and keeps the open Settings window's license block fresh.
    if (++licenseTick % 3 === 0 && store.get('licenseKey')) {
      licenseService.revalidate()
        .then((r) => {
          if (r.valid === false) enterLicenseEnded(r.status);
          else if (r.valid)      exitLicenseEnded();
          registry.broadcast(C.PUSH_STATE, buildState());
        })
        .catch(() => {});
    }
  }, 60 * 1000);
}
function stopLicenseWatch() {
  if (licenseWatch) { clearInterval(licenseWatch); licenseWatch = null; }
}

// ── Tray / hotkey action maps ────────────────────────────────────────────────
const trayActions = {
  start:          () => controller.start(),
  stop:           () => controller.stop(),
  toggleMinimize: () => controller.toggleMinimizePanel(),
  isMinimized:    () => mainWindow.isHidden(),
  openSettings:   () => controller.openSettings(),
  openHistory:    () => controller.openHistory(),
  openReview:     () => controller.openReview(),
  openWeekly:     () => controller.openWeekly(),
  openAiLog:      () => controller.openAiLog(),
  quit:           () => controller.quit(),
};

const hotkeyActions = {
  pauseResume:    () => controller.pauseResume(),
  minimizePanel:  () => controller.toggleMinimizePanel(),
  openSettings:   () => controller.openSettings(),
  openHistory:    () => controller.openHistory(),
  // The last review, from anywhere. Ctrl+Shift+E used to explain the last tip.
  openReview:     () => controller.openReview(),
};

// ── Launch ───────────────────────────────────────────────────────────────────
// First run gates the app behind the onboarding tour: until it is completed we
// show ONLY the tour, and the overlay/panel/tray are not created, so the app
// never appears behind an unfinished tour. finishOnboarding() then builds the
// surfaces. A returning user (onboarding already done) goes straight in.
function launchMainApp() {
  if (mainLaunched) return;
  mainLaunched = true;
  // A key just activated: the recorder's counts a quit left, if launch had none.
  sendPendingReport();

  if (!store.get('onboardingCompleted')) {
    const tour = onboardingWindow.create();
    // Closed with Alt+F4 or from the taskbar rather than finished: the window
    // already marks the tour done, so the app opens as if it was. Without this
    // nothing else existed, no panel, no tray, and the process stayed alive
    // holding the single instance lock, so the app could not be opened again.
    if (tour) tour.on('closed', () => { if (!surfacesUp && mainLaunched) openAppWithSplash(); });
    console.log('[main] first run, waiting on onboarding before opening the app');
    return;
  }
  openAppWithSplash();
}

/**
 * The licence window, the only window there is until a key is activated. Closed
 * without activating (Alt+F4, the taskbar), it quits the app: before, the
 * process stayed alive with no window and no tray, held the single instance
 * lock, and every attempt to open the app again did nothing.
 */
function showActivation(reason) {
  const win = activationWindow.create(reason);
  if (win && !win.__quitsWhenAlone) {
    win.__quitsWhenAlone = true;
    win.on('closed', () => {
      if (!surfacesUp && !registry.get('onboarding') && !licenseService.isLocallyValid()) {
        console.log('[main] licence window closed without a licence, quitting');
        cleanupAndQuit();
      }
    });
  }
  return win;
}

/**
 * THE LOADER OWNS THE SCREEN ALONE, then hands over to the app.
 *
 * The surfaces are still built immediately, because that is the startup cost
 * the animation is there to cover, but the panel is created hidden and only
 * revealed once the splash is gone. Building it first means the reveal is
 * instant and the panel is never seen part way through rendering.
 *
 * Used by EVERY path into the app. This lived inline in launchMainApp(),
 * which returns early on first run to show the tour, and finishOnboarding()
 * then built the surfaces directly. So a brand new user, the one person
 * seeing the app for the very first time, was the only one who never saw the
 * launch animation.
 */
function openAppWithSplash() {
  // Re-running the tour from Settings leaves every surface already up and the
  // panel loaded long ago, so did-finish-load would never fire again and the
  // loader would sit there until its own hard timeout. There is no startup
  // cost left to cover either. Just make sure the main window is showing.
  if (surfacesUp) { mainWindow.reveal(); return; }

  splashWindow.open();
  splashWindow.onTimeout(() => mainWindow.reveal());   // never strand a hidden window
  createAppSurfaces({ deferShow: true });

  const main = mainWindow.get();
  const handOver = () => splashWindow.close(() => mainWindow.reveal());
  if (main) main.webContents.once('did-finish-load', handOver);
  else handOver();
}

function createAppSurfaces(opts) {
  if (surfacesUp) return;
  surfacesUp = true;
  // Once: Rivals titles saved before 8.0.3 read backwards for deaths, and the
  // library row, the review and the weekly report read the saved words.
  if (!store.get('rivalsTitlesRepaired')) {
    try {
      const n = require('./services/review-repair').repairRivalsTitles(reviewStore, insightsOf);
      store.set('rivalsTitlesRepaired', true);
      if (n) { breakdownCache.clear(); console.log(`[reviews] rewrote the comparison titles of ${n} Rivals reviews`); }
    } catch (e) {
      console.warn('[reviews] Rivals title repair failed:', e.message);
    }
  }
  // The panel's "last match" grade survives a restart: it is the newest saved
  // review's, not only one reviewed since the app opened.
  try {
    const top = reviewStore.list().find((r) => r.grade);
    if (top && !state.lastGrade) state.lastGrade = { ...top.grade, game: top.game, id: top.id };
  } catch {}

  // deferShow keeps the main window hidden until the launch animation finishes.
  mainWindow.create({ deferShow: !!(opts && opts.deferShow) });
  tray.create(trayActions);
  hotkeys.register(hotkeyActions);
  // Background update checks, and the restart question, never asked while the
  // player is playing: a session running, a stop mid match holding the seal,
  // or a review still being built (updater.js).
  updater.init({ busy: () => !!state.isCoaching || sealHeld || reviewBeingBuilt() });

  // Send an initial state snapshot once the shell has loaded.
  const main = mainWindow.get();
  if (main) {
    main.webContents.once('did-finish-load', () => {
      setTimeout(() => registry.broadcast(C.PUSH_STATE, buildState()), 200);
    });
  }
  // The seal follows the match (syncSeal()), checked once a second.
  if (!sealTimer) sealTimer = setInterval(() => { try { syncSeal(); } catch {} }, 1000);
  startLicenseWatch(); // detect expiry / revocation mid-session and keep Settings fresh

  // Stay connected to the tracker across restarts: refresh the saved profile in
  // the background so live tips + chat have current stats without reconnecting.
  if ((store.get('riotId') || '').trim()) {
    fetchTrackerStats(true).catch(() => {});
  }
  // THE LATE LINK (8.2.1): the recent recordings Riot's record never reached
  // are checked against it by themselves, a little after launch, out of the
  // launch's way. backfill.js late() and atLaunch() say when it runs.
  if (!lateLinkTimer) lateLinkTimer = setTimeout(lateLinkAtLaunch, LATE_LINK_DELAY_MS);

  maybeShowWeeklyReport();
  console.log('[main] app surfaces created');
}

// A boot check sets OCCLARA_DEV_LATE_LINK_MS so it does not sit out the wait,
// nor the minute between tries while a match is being played.
const LATE_LINK_DEV_MS = Number(process.env.OCCLARA_DEV_LATE_LINK_MS) || 0;
const LATE_LINK_DELAY_MS = LATE_LINK_DEV_MS || 20000;
let lateLinkTimer = null;

/**
 * The Riot ID in Settings when Riot has shown it is the player's: a Connect,
 * or a run that listed its matches, proved it (riotConnected). One typed and
 * never connected is not, so a typo never sends a request by itself, and one
 * Riot says does not exist loses it (forgetRiotId).
 *
 * A PROFILE IS NO PROOF. Every launch refreshes the profile of whatever ID
 * Settings holds (createAppSurfaces), a duo partner's typed in to look at
 * their rank included, so a ranked one read as connected twenty seconds into
 * the next launch, and the late link filled the player's recordings with that
 * player's agent and numbers. An install from before riotConnected kept its
 * connection as the profile alone, and that profile counted once, read at
 * load before any refresh could write one (keepOldConnection).
 */
function connectedRiotId() {
  const id = (store.get('riotId') || '').trim();
  if (!id.includes('#')) return null;
  return String(store.get('riotConnected') || '').trim().toLowerCase() === id.toLowerCase() ? id : null;
}

/**
 * The late link, if it is due: once in six hours, and never mid match, where
 * it tries again each minute until the match is over (backfill.js late(),
 * atLaunch()). `again` is that next try.
 */
function lateLinkAtLaunch(again) {
  lateLinkTimer = null;
  try {
    const run = typeof again === 'function' ? again() : backfill.atLaunch(connectedRiotId, armLateLink);
    if (run) console.log("[backfill] checking the recent recordings against Riot's record");
  } catch (e) {
    console.warn('[backfill] the late link did not start:', e.message);
  }
}

/** The late link's next try, kept in lateLinkTimer so a logout clears it (teardownSession). */
function armLateLink(again, ms) {
  lateLinkTimer = setTimeout(() => lateLinkAtLaunch(again), LATE_LINK_DEV_MS || ms);
}

/**
 * The weekly report popup, on the first app open of each calendar week.
 * Skipped when there is nothing honest to show (a brand new player with no
 * sessions and no connected account) so it never opens empty.
 *
 * Tracker stats arrive asynchronously, so this waits briefly for the refresh
 * kicked off at launch; without that the first report of the week would compare
 * against nothing and show every arrow flat.
 */
function maybeShowWeeklyReport() {
  if (store.get('weeklyReportWeek') === weekKey()) return;   // already seen this week
  setTimeout(() => {
    try {
      const preview = buildWeeklyReport();
      if (!preview.hasData) {
        console.log('[weekly] skipped, nothing to report yet:', preview.reason);
        return;
      }
      weeklyWindow.open();
      console.log('[weekly] report shown for', preview.weekOf);
    } catch (e) {
      console.error('[weekly] report failed:', e.message);
    }
  }, 4000);
}

function cleanupAndQuit() {
  try {

    if (engine) { engine.stop(); engine = null; }
    flushAiLog(true);
    // Quitting: no review job outlives the process, so neither does the
    // recording of the screen (and a quit that never gets here is swept at the
    // next launch). The session's counts are kept, not posted into the exit
    // (`exiting`), and the next launch sends them.
    recorder.shutdown({ exiting: true });
    capture.disposeWorker();
    hotkeys.unregister();
    globalShortcut.unregisterAll();
    tray.destroy();
  } catch (err) {
    console.error('[cleanup]', err.message);
  }
  app.quit();
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.setAppUserModelId('com.ghostcoach.app2');

// Single instance, focus existing rather than launching a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Opened again from the Start menu or a shortcut: the window comes back
    // from wherever it went, hidden by its X, by Ctrl+Shift+M or minimised.
    if (surfacesUp) { mainWindow.reveal(); return; }
    const win = registry.get('activation') || registry.get('onboarding');
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    logger.init(app);
    console.log('[main] Ready. Debug log:', logger.getLogPath());
    // Whatever recording a run before this one left (a crash, a kill) is a
    // picture of somebody's screen that no review is waiting for any more.
    try { recorder.sweep(); } catch (e) { console.warn('[recorder] sweep failed:', e.message); }
    // The recorder's counts a quit left unsent, once, with the key kept from
    // the last run (launchMainApp sends it instead once a key is activated).
    sendPendingReport();
    // THE PRIMARY DISPLAY, FOLLOWED. A recording is of the display that was
    // primary when it opened and the GDI helper reads whichever is primary
    // now, so when another display becomes the primary one (the game moved to
    // it, a laptop docked) the recording starts again on it
    // (recorder.js displaysChanged), and the read never serves the old one.
    const followPrimary = () => {
      try { recorder.displaysChanged(screen.getPrimaryDisplay().id); } catch (e) { console.warn('[recorder] display change:', e.message); }
    };
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, followPrimary);
    // The clips a review's page plays (8.3): served from the reviews' own
    // folders and nowhere else (clip-scheme.js, review-store.js clipFile).
    try {
      protocol.handle(clipScheme.SCHEME, clipScheme.createHandler({ fileOf: (id, name) => reviewStore.clipFile(id, name) }));
    } catch (e) { console.warn('[clips] the clip scheme could not be handled:', e.message); }
    // And the cap on them, once at launch too: a run that quit between keeping
    // a clip and applying the cap left the clips past it.
    applyClipCap();

    registerIpc({ controller, license });

    // Dev-only self-test (never runs in normal use): bypasses the license server
    // and exercises launch → IPC round-trip, writing results to debug.log.
    if (process.env.OCCLARA_DEV_AUTOLAUNCH === '1') {
      setTimeout(() => {
        console.log('[dev] auto-launch (license bypassed) for self-test');
        launchMainApp();
        controller.start();
        if (process.env.OCCLARA_DEV_OPEN_SETTINGS === '1') openPage('settings');
        if (process.env.OCCLARA_DEV_OPEN_WEEKLY === '1') {
          console.log('[dev] weekly report:', JSON.stringify(buildWeeklyReport()).slice(0, 600));
          weeklyWindow.open();
        }
        if (process.env.OCCLARA_DEV_OPEN_AILOG === '1') aiLogWindow.open();
        if (process.env.OCCLARA_DEV_MINIMIZE === '1') setTimeout(() => controller.toggleMinimizePanel(), 1200);
        if (process.env.OCCLARA_DEV_NOQUIT !== '1') {
          setTimeout(() => { console.log('[dev] self-test: forcing quit'); cleanupAndQuit(); }, 4000);
        }
      }, 800);
      return;
    }

    // Dev-only: drive the REAL license path (service → live server → persist →
    // launch) with a key from the env. Lets us verify activation from the CLI.
    if (process.env.OCCLARA_DEV_ACTIVATE_KEY) {
      if (!licenseService.isLocallyValid()) activationWindow.create();
      license.activate(process.env.OCCLARA_DEV_ACTIVATE_KEY).then((r) => {
        console.log('[dev] activate result:', JSON.stringify(r));
        if (!r.valid && process.env.OCCLARA_DEV_NOQUIT !== '1') {
          setTimeout(() => { console.log('[dev] quitting after failed activation'); cleanupAndQuit(); }, 1500);
        }
      });
      return;
    }

    // Trust-cache, re-activate in background: if a locally-valid license is
    // cached, launch instantly and silently re-check; only sign out on an
    // explicit valid:false. Otherwise show the activation window.
    if (licenseService.isLocallyValid()) {
      launchMainApp();
      licenseService.revalidate()
        .then((r) => { if (r.valid === false) enterLicenseEnded(r.status); })
        .catch((err) => console.warn('[license] revalidate failed:', err.message));
    } else {
      showActivation();
    }
  });

  app.on('window-all-closed', () => {
    // Tray keeps the app alive; quit only via explicit action.
  });

  app.on('will-quit', () => {
    hotkeys.unregister();
    globalShortcut.unregisterAll();
  });
}

// ── Crash safety ─────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[crash] uncaughtException:', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[crash] unhandledRejection:', reason);
});
