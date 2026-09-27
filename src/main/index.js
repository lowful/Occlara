'use strict';

const { app, globalShortcut } = require('electron');
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
const CoachingEngine = require('./services/coaching-engine');
const { verifyCoachedMatch } = require('./services/match-link');
const { normalize: normalizeLang } = require('../shared/i18n');
const registry = require('./windows/registry');
const panelWindow      = require('./windows/panel-window');
const settingsWindow   = require('./windows/settings-window');
const weeklyWindow     = require('./windows/weekly-window');
const learnWindow      = require('./windows/learn-window');
const reviewWindow     = require('./windows/review-window');
const matchesWindow    = require('./windows/matches-window');
const { LolRecorder }  = require('./services/lol-recorder');
const aiLogWindow      = require('./windows/ailog-window');
const statsWindow      = require('./windows/stats-window');
const dockWindow       = require('./windows/dock-window');
const activationWindow = require('./windows/activation-window');
const onboardingWindow = require('./windows/onboarding-window');
const chatWindow       = require('./windows/chat-window');
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
const { API } = require('../shared/config');
const gameRegistry = require('../shared/games');
const { assembleReport, weekKey, rankIndex, trendDirection } = require('./services/weekly-report');
const updater  = require('./updater');
const C = require('../shared/channels');
const { ReviewStore, newId } = require('./services/review-store');
const grader      = require('../shared/grade');
const insightsOf  = require('../shared/insights');
const patternsOf  = require('../shared/patterns');
const deathFrames = require('../shared/death-frames');

// Every post-match review, for every game. See services/review-store.js.
const reviewStore = new ReviewStore(path.join(app.getPath('userData'), 'reviews'));

// ── Session state ────────────────────────────────────────────────────────────
const state = {
  isCoaching: false,
  isPaused:   false,
  status:     'idle',   // idle | coaching | paused | stopped
  agent:      { agent: null, confirmed: false, role: null }, // detected/confirmed agent
  notice:     null,     // one status line for the panel, never about the match
  cadence:    null,     // the current gap between reads, in ms
  lastGrade:  null,     // { score, letter, game } of the latest reviewed match
  licenseActive: true,  // false once the subscription ends (locks coaching)
  licenseReason: '',    // why it ended (expired | cancelled | payment_failed | ...)
  reviewRetryTimer: null,   // pending match-review re-push, cancelled when coaching stops
};

let mainLaunched = false;
let surfacesUp   = false;   // overlay/panel/tray built; gated behind onboarding on first run

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
    // One line for the panel's status: a licence ending, capture blocked, the
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
  };
}

// ── Minimize hint ────────────────────────────────────────────────────────────
// New players leave the panel sitting on screen while they play, where it can
// swallow a click mid-aim. One small bubble points at the shortcut.
//
// While they are still learning the app (first 10 sessions) it appears shortly
// after the agent is locked in, which is the natural pause before the match.
// After that they know the shortcut, so it only reappears if the panel has
// genuinely been left up for over a minute WITH tips flowing, i.e. they are
// actually mid-match and have forgotten.
const NUDGE_LEARNING_SESSIONS = 10;
const NUDGE_LATE_AFTER_MS     = 60 * 1000;

function nudgeMinimize() {
  if (state.nudgedThisSession) return;
  if (panelWindow.isMinimized()) return;         // already minimized, nothing to teach
  state.nudgedThisSession = true;
  registry.broadcast(C.PUSH_NUDGE, { kind: 'minimize' });
  console.log('[nudge] minimize hint shown');
}

/** Called once the player has settled their agent. */
function maybeNudgeAfterAgent() {
  if ((store.get('coachStartCount') || 0) > NUDGE_LEARNING_SESSIONS) return;
  setTimeout(() => { if (state.isCoaching) nudgeMinimize(); }, 2600);
}

/** Experienced players: only if the panel is still up well into a live match. */
function maybeNudgeLate() {
  if (!state.isCoaching || state.nudgedThisSession) return;
  if ((store.get('coachStartCount') || 0) <= NUDGE_LEARNING_SESSIONS) return;
  const running = state.sessionStartedAt ? Date.now() - state.sessionStartedAt : 0;
  const reading = !!(engine && engine.analyzedFrames > 10);
  if (running >= NUDGE_LATE_AFTER_MS && reading) nudgeMinimize();
}

/**
 * Is a Valorant match being played right now, as opposed to the session merely
 * running? Between matches the session is still on, the watch has ended the
 * last match, and nothing is being coached, so the review may be opened.
 */
function matchInProgress() {
  if (!state.isCoaching || !engine || !engine.endWatch) return false;
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
  return matchInProgress();
}

/**
 * One line on the panel's status: a licence ending, capture blocked, the server
 * unreachable. There is no tip stream any more; Occlara says nothing about the
 * match until the review.
 */
function pushNotice(text) {
  state.notice = text ? { text: String(text), at: Date.now() } : null;
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
    if (meta && meta.grade) state.lastGrade = { ...meta.grade, game, id: review.id };
    registry.broadcast(C.PUSH_REVIEWS, { id: review.id, game });
    registry.broadcast(C.PUSH_STATE, buildState());
  } catch (e) {
    console.error('[reviews] save failed:', e.message);
  }
}

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

/** Paint a review in the review window, whichever game it is from. */
function showReview(review) {
  if (!review) return;
  lastReviewShown = review;
  const ch = review.kind === 'valorant' ? C.PUSH_VALORANT_REVIEW
    : review.kind === 'rivals' ? C.PUSH_RIVALS_REVIEW : C.PUSH_LOL_REVIEW;
  registry.broadcast(ch, review);
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
      summary: ai.summary || ai.review || null,
      rounds: ai.rounds || {},
      focus: ai.focus || null,
      study: Array.isArray(ai.study) ? ai.study : [],
    },
    tracker,
    role,
    history: store.get('valorantHistory') || [],
    verification: extra && extra.verification,
    riotMe: extra && extra.riotMe,
  });
  built.aiUnavailable = !snap.ai && !(extra && extra.narrativePending);
  built.narrativePending = !!(extra && extra.narrativePending);
  built.thin = !!ai.thin;
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
 * The coach's look at the deaths worth teaching: the frame before each one,
 * sent to the server with Riot's facts about it (death-forensics.js), and a
 * cause from a closed list back. Four deaths at most, one call each.
 *
 * Returns { byRound: { n: { cause, what, better, frames } }, frames: { name: b64 } }.
 * Empty, never an error, when there are no frames: the AI log was off, or the
 * deaths were in rounds the coach never saw.
 */
async function forensicsFor(rounds, snap) {
  const empty = { byRound: {}, frames: {} };
  const log = snap.log;
  if (!log || !log.dir || !log.records.length) return empty;
  const picks = deathFrames.teachableDeaths(rounds, 4);
  const deaths = [];
  const kept = {};
  for (const r of picks) {
    const recs = deathFrames.framesFor(log.records, r, { from: snap.startedAt, to: snap.endedAt });
    const imgs = [];
    const names = [];
    recs.forEach((rec, i) => {
      try {
        const b64 = fs.readFileSync(path.join(log.dir, rec.frame)).toString('base64');
        const name = `r${r.n}-${i === 0 ? 'before' : 'after'}.jpg`;
        imgs.push(b64);
        names.push(name);
        kept[name] = b64;
      } catch {}
    });
    if (!imgs.length) continue;
    deaths.push({
      n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon,
      firstDeath: r.firstDeath, traded: r.traded, alive: r.aliveAtDeath,
      planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot, frames: imgs, names,
      gap: recs[0] && deathFrames.secondsIn(recs[0]) !== null && typeof r.deathSec === 'number'
        ? Math.max(0, r.deathSec - deathFrames.secondsIn(recs[0])) : null,
    });
  }
  if (!deaths.length) return empty;
  try {
    const body = {
      agent: snap.context.agent, map: snap.context.map, language: snap.context.language || 'en',
      deaths: deaths.map(({ names, ...d }) => d),
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
      out.byRound[f.n] = { cause: f.cause, what: f.what || null, better: f.better || null, frames: d.names };
      for (const name of d.names) out.frames[name] = kept[name];
    }
    console.log(`[review] death forensics: ${Object.entries(out.byRound).map(([n, f]) => `R${n} ${f.cause}`).join(', ')}`);
    return out;
  } catch (e) {
    console.log('[review] death forensics failed:', e.message);
    return empty;
  }
}

function onValorantMatchReview(reviewText, snap) {
  if (!snap) return;
  const id = newId('valorant', snap.endedAt || Date.now());
  // The frames of this match, held back from the AI log's thinning until the
  // review has had its look at them.
  snap.log = holdAiLogFrames(snap.startedAt, snap.endedAt);
  const stamp = (built) => Object.assign(built, { id, at: snap.endedAt || Date.now() });

  const first = stamp(buildValorantReview(snap, null).built);
  showReview(first);
  saveReview(first, 'valorant');
  reviewWindow.open();
  console.log(`[review] valorant review ready: ${snap.rounds.length} rounds, ended by ${snap.endedBy}`
    + (snap.ai ? '' : ', no model narrative'));

  const mctx = { map: snap.context.map, agent: snap.context.agent };
  let recorded = false;
  let showing = first;
  // Paint one version of the review, if nothing newer has been shown since,
  // and save it whatever is on screen, because the library keeps the best one.
  const repaint = (built, frames) => {
    stamp(built);
    if (lastReviewShown === showing || (lastReviewShown && lastReviewShown.id === id)) {
      showReview(frames ? { ...built, frameData: dataUrls(frames) } : built);
    }
    showing = lastReviewShown && lastReviewShown.id === id ? lastReviewShown : built;
    saveReview(built, 'valorant', frames);
  };

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
    const riot = await riotRoundsFor(lm);
    if (!riot) return false;
    const verify = require('../shared/valorant-verify');
    const valorantReview = require('../shared/valorant-review');
    const { rounds, checks } = verify.reconcile(snap.rounds, riot);
    const context = { ...snap.context, agent: (riot.me && riot.me.agent) || snap.context.agent };
    const vsnap = { ...snap, rounds, context };
    const verification = verify.describe(checks);
    console.log(`[review] ${verification}`);
    repaint(buildValorantReview({ ...vsnap, ai: null }, lm, { verification, narrativePending: true, riotMe: riot.me }).built);

    const looked = await forensicsFor(rounds, { ...snap, context });
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
    const final = buildValorantReview({ ...vsnap, ai }, lm, { verification, riotMe: riot.me }).built;
    repaint(final, Object.keys(looked.frames).length ? looked.frames : null);
    releaseAiLogFrames(snap.log);
    return true;
  };

  const withTracker = (lm) => {
    const next = buildValorantReview(snap, lm);
    // ONE HISTORY ROW PER MATCH, whichever attempt found the tracker, and
    // built before the row is added so the match is not compared with itself.
    if (!recorded) {
      recorded = true;
      const valorantReview = require('../shared/valorant-review');
      const row = valorantReview.historyEntry(lm, next.role);
      if (row) {
        const past = store.get('valorantHistory') || [];
        store.set('valorantHistory', [...past, row].slice(-valorantReview.BASELINE_GAMES));
      }
    }
    // Only repainted if nothing newer has been shown since. The retry can
    // land four minutes later, by which time the next match may have its own
    // review open, and a late scoreboard must not replace it with this one.
    repaint(next.built);
    // The totals are Riot's now; the rounds follow, and they are what fixes
    // the deaths, the timing and the coach's reads.
    withRiot(lm).catch((e) => console.log('[review] Riot check failed:', e.message))
      .finally(() => releaseAiLogFrames(snap.log));
  };

  (async () => {
    // A fresh tracker profile, so the stats view and the next review's
    // baseline move with the match just played.
    try {
      const current = await fetchTrackerStats(true);
      if (current) store.set('lastMatchStats', { ...current, _at: Date.now(), _riotId: (store.get('riotId') || '').trim() });
    } catch {}
    // THE MATCH THIS SESSION WATCHED, or nothing. fetchCoachedMatch applies
    // the map, agent and timing checks, so it returns null rather than a
    // plausible scoreboard from a different game.
    let lm = null;
    try { lm = await fetchCoachedMatch(snap.startedAt, snap.endedAt, mctx); } catch {}
    if (lm) { withTracker(lm); return; }
    // Riot publishes a few minutes after the match. Two more tries, both
    // verified, both cancelled if recording is stopped, since a scoreboard
    // arriving over the next session would be the wrong match.
    clearTimeout(state.reviewRetryTimer);
    const retry = (delays) => {
      if (!delays.length) { releaseAiLogFrames(snap.log); return; }
      state.reviewRetryTimer = setTimeout(async () => {
        state.reviewRetryTimer = null;
        let found = null;
        try { found = await fetchCoachedMatch(snap.startedAt, snap.endedAt, mctx); } catch {}
        if (found) withTracker(found);
        else retry(delays.slice(1));
      }, delays[0]);
    };
    retry([90000, 240000]);
  })();
}

/**
 * One saved review as plain text for Ask Coach: the facts, the grade, and what
 * repeated, so the chat talks about THIS match rather than the player in general.
 * The newest review when no id was chosen.
 */
function chatReviewContext(id) {
  const e = id ? reviewStore.get(id) : (reviewStore.list()[0] && reviewStore.get(reviewStore.list()[0].id));
  if (!e) return null;
  const r = e.review || {};
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
  const list = (xs) => (xs || []).slice(0, 3).map((x) => `${x.title}: ${x.detail}`).join(' ');
  if ((ins.mistakes || []).length) lines.push(`Repeated mistakes: ${list(ins.mistakes)}`);
  if ((ins.strengths || []).length) lines.push(`Went well: ${list(ins.strengths)}`);
  if ((ins.missed || []).length) lines.push(`Missed: ${list(ins.missed)}`);
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
      pushNotice(`${g.label} coaching is not built yet. The look and layout are a preview, so switch back to Valorant in Settings to coach.`);
      return;
    }

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
      engine.on('status', (s) => console.log('[rivals] status', JSON.stringify(s)));
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
        reviewWindow.open();
        console.log(`[rivals] review ready: ${r.game.hero || 'hero unread'}, `
          + `${r.scoreline.kills}/${r.scoreline.deaths}/${r.scoreline.assists}`);
      });
      engine.start();
      pushNotice('Recording. Play your match: the scoreboard at the end is reviewed and graded automatically.');
      state.isCoaching = true;
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
      engine.start();
      pushNotice('Recording. Nothing appears during your game, and the graded review opens when it ends.');
      state.isCoaching = true;
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
    engine.on('notice', (n) => pushNotice(n && n.text));
    engine.on('cadence', (ms) => {
      state.cadence = ms;
      registry.broadcast(C.PUSH_STATE, buildState());
    });
    engine.on('status', (status) => {
      state.isPaused = status === 'paused';
      setStatus(status);
    });
    engine.on('match-review', (reviewText, snap) => onValorantMatchReview(reviewText, snap));
    engine.on('agent', (info) => {
      const wasConfirmed = !!(state.agent && state.agent.confirmed);
      state.agent = info || { agent: null, confirmed: false, role: null };
      registry.broadcast(C.PUSH_AGENT, state.agent);
      registry.broadcast(C.PUSH_STATE, buildState());
      // Agent just settled: the quiet moment before the match starts.
      if (!wasConfirmed && state.agent.confirmed) maybeNudgeAfterAgent();
    });
    // The server rejected our license key (401/403), confirm with an immediate
    // re-validation so a genuinely ended subscription locks fast (and a transient
    // server error does not, since revalidate is authoritative).
    engine.on('auth-suspect', () => revalidateNow());

    state.isCoaching = true;
    state.isPaused   = false;
    state.sessionStartedAt = Date.now();   // drives the 5-minute grading gate
    state.nudgedThisSession = false;       // the minimize hint is once per session
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
    setStatus('coaching');
    console.log('[coach] started');
  },
  stop() {
    if (!state.isCoaching) return;
    state.isCoaching = false;
    state.isPaused   = false;
    // A pending match-review retry belongs to the session that just ended.
    if (state.reviewRetryTimer) {
      clearTimeout(state.reviewRetryTimer);
      state.reviewRetryTimer = null;
    }
    // The match just played should show in stats right away, not after a cache
    // window. The grade is written by the post-match review, per match.
    matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };
    rankHistCache = { at: 0, riotId: '', data: null };
    if (engine) { engine.stop(); engine = null; }
    flushAiLog(true);
    state.agent = { agent: null, confirmed: false, role: null };
    registry.broadcast(C.PUSH_AGENT, state.agent); // hide the panel bubble/chip
    setStatus('stopped');
    console.log('[coach] stopped');
  },
  pauseResume() {
    if (!state.isCoaching || !engine) return;
    if (state.isPaused) engine.resume();
    else                { engine.pause(); }
    // state.isPaused + status pushes are driven by the engine 'status' event.
  },
  confirmAgent() { if (engine) engine.confirmAgent(); },
  resizePanel(h) { if (typeof h === 'number') panelWindow.setContentHeight(h); },
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

  /** The match library: saved reviews, newest first, one game or all. */
  listReviews(game) { return reviewStore.list(game || null); },
  getReview(id) {
    const e = reviewStore.get(id);
    return e ? withFrames(e.review) : null;
  },
  /** Open the review window on one saved review. */
  openReviewById(id) {
    const r = this.getReview(id);
    if (!r) return;
    showReview(r);
    reviewWindow.open();
  },
  /** What keeps happening across the last matches of one game. */
  getPatterns(game) {
    const g = game || gameRegistry.get(store.get('game')).id;
    return { game: g, ...patternsOf.summarise(reviewStore.recent(g, patternsOf.WINDOW)) };
  },

  toggleMinimizePanel() {
    // Minimized shows the small floating mark (icon only, click-through,
    // no status dot); Ctrl+Shift+M or the tray restores the panel.
    if (!panelWindow.isMinimized()) {
      const anchor = panelWindow.getDockAnchor(dockWindow.SIZE); // capture before hiding
      panelWindow.setMinimized(true);
      dockWindow.showAt(anchor);
    } else {
      dockWindow.hide();
      panelWindow.setMinimized(false);
    }
    tray.update(state.isCoaching, trayActions);
    return panelWindow.isMinimized();
  },
  openSettings()  { settingsWindow.open(); },
  openHistory()   { matchesWindow.open(); },
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
    reviewWindow.open();
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
    return lastReviewShown;
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
  openAiLog(sessionId) { aiLogWindow.open(sessionId || null); },
  getAiLog(id) {
    // SEALED MID MATCH with live tips closed. The log shows every tip the coach
    // wrote, frame by frame, as it writes them, so an open log window on a
    // second monitor was the live tip feed by another name. The session in
    // progress reopens the moment the match ends.
    if (liveLogSealed() && (!id || id === aiLogLiveId())) {
      const past = aiLogSessions().filter((x) => !x.live);
      if (!past.length) return { records: [], sessions: [], sealed: true };
      const log = readAiLog(past[0].id);
      return { ...log, sessions: past, sealed: true };
    }
    return readAiLog(id);
  },
  getAiLogSessions() {
    const list = aiLogSessions();
    return liveLogSealed() ? list.filter((x) => !x.live) : list;
  },

  /** Check a logged session's deaths against Riot's own record of the match.
   *  Lazy and best effort: the viewer opens on the screen-read deaths straight
   *  away, and this arrives afterwards to confirm or correct them, so the log
   *  still works offline and without a Riot ID configured. */
  async confirmAiLogDeaths(id) { return confirmDeaths(id); },

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
    if (liveLogSealed() && (!p.session || p.session === aiLogLiveId())) {
      return { error: 'This match is still being played. Ask about it once it ends.' };
    }
    const log = readAiLog(p.session);
    const recs = Array.isArray(log.records) ? log.records : [];
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
  openChat()      { state.chatReviewId = null; chatWindow.open(); },
  openStats()     { statsWindow.open(); },

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
      chatWindow.open();
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
    chatWindow.open();
  },
  takeChatSeed() {
    const s = state.chatSeed || null;
    state.chatSeed = null;
    return s;
  },

  /** The assembled extended-stats dashboard: category trends from the local
   *  performance log, rank/win-rate from the tracker profile, and the recent
   *  match list (server-cached 15 min, client-cached alongside). */
  /** Competitive RR journey for the rank drop-down graph, cached 5 minutes. */
  async getRankHistory(force) {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId.includes('#')) return { error: 'no-riot-id' };
    if (!force && rankHistCache.data && rankHistCache.riotId === riotId && Date.now() - rankHistCache.at < 5 * 60 * 1000) {
      return rankHistCache.data;
    }
    try {
      const { ok, data } = await api.get('/api/coach/rank-history?username=' + encodeURIComponent(riotId), store.get('licenseKey'), 15000);
      if (ok && data && !data.error) {
        rankHistCache = { at: Date.now(), riotId, data };
        return data;
      }
      return (rankHistCache.riotId === riotId && rankHistCache.data) || data || { error: 'unavailable' };
    } catch {
      return (rankHistCache.riotId === riotId && rankHistCache.data) || { error: 'unavailable' };
    }
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
    const graded = reviewStore.list(g.id).filter((r) => r.grade).slice(0, 15);

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

    const hasSessionData = !!lastReviewShown || reviewStore.list().length > 0;
    // MID MATCH, the chat gets nothing about the match in progress. Ask Coach
    // is a window the player can keep open on a second monitor, and a chat that
    // knows "died round 5 at A Site" answers "where should I play" with exactly
    // the live advice Occlara does not give.
    const midMatch = matchInProgress();
    const context = {
      agent:        state.agent && state.agent.agent,
      sessionTips:  [],
      matchMemory:  engine && !midMatch ? engine.matchMemory.slice(-8) : [],
      stats:        await fetchTrackerStats(),
      noSessionYet: !hasSessionData,
      coachTrend:   (() => { const tp = guardedTrackerPair(); return computeCategoryTrends([], tp.stats, tp.prevStats); })(),
      // The chat works WITH the stats dashboard: it sees the same recent
      // matches (with ratings) and coached sessions the player is looking at.
      recentMatches: (await this.getMatches(false)).matches.slice(0, 5).map((m) => ({
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
      recentSessions: midMatch ? [] : reviewStore.recent(gameRegistry.get(store.get('game')).id, 3).map((e) => ({
        date: new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        map: e.review.game && e.review.game.map, overall: e.review.grade && e.review.grade.score,
        scores: Object.fromEntries(((e.review.grade && e.review.grade.categories) || []).map((c) => [c.key, c.score])),
        strengths: ((e.review.insights && e.review.insights.strengths) || []).slice(0, 2).map((x) => x.title).join('. '),
        weaknesses: ((e.review.insights && e.review.insights.mistakes) || []).slice(0, 2).map((x) => x.title).join('. '),
      })),
      matchReview: midMatch ? null : chatReviewContext(state.chatReviewId),
      proPlaybook:  playbookMode(),
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

  /** Settings "Connect" button: test the tracker link right now, and if it
   *  works, push the stats into the running engine + chat immediately. */
  async testTracker() {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId || !riotId.includes('#')) {
      return { ok: false, error: 'Enter your Riot ID as Name#TAG first.' };
    }
    const stats = await fetchTrackerStats(true);
    if (stats) {
      return { ok: true, stats };
    }
    return { ok: false, error: statsCache.lastError || 'Could not reach the stats service. Try again in a minute.' };
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
    // Riot ID changed (new account connected): every tracker-derived cache is
    // now the WRONG player's data, drop it all immediately. Fresh data flows
    // back in on Connect, session start, or the next dashboard open.
    const riotId = (store.get('riotId') || '').trim();
    if (riotId !== lastRiotId) {
      lastRiotId = riotId;
      matchesClient = { competitive: emptyMatchBucket(), unrated: emptyMatchBucket() };
      statsCache = { at: 0, riotId: '', data: null, lastError: null };
      unratedStatsCache = { at: 0, riotId: '', data: null };
      rankHistCache = { at: 0, riotId: '', data: null };
      console.log('[stats] riot id changed, tracker caches cleared');
    }

    // GAME CHANGED. A harder boundary than a riot id change: it invalidates the
    // live session, every tracker cache, and the meaning of every open window.
    //
    // Order matters here. stop() archives and grades the session AND clears
    // matchesClient and rankHistCache itself, so it has to run BEFORE the purge
    // below, or the purge is immediately undone by a stop that follows it.
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
      rankHistCache = { at: 0, riotId: '', data: null };

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

// Unrated/swiftplay aggregates live in their own cache; the competitive cache
// below stays the persisted profile the coach and chat run on.
let unratedStatsCache = { at: 0, riotId: '', data: null };
let rankHistCache = { at: 0, riotId: '', data: null };

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
      // Keep serving the last good profile on a transient failure; just note why.
      statsCache.lastError = (data && data.error) || 'Could not reach the stats service.';
      statsCache.riotId = riotId;
    }
    return stats || (statsCache.riotId === riotId ? statsCache.data : null);
  } catch {
    return statsCache.riotId === riotId ? statsCache.data : null;
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
/** The coached match, or null when it cannot be confirmed as ours. */
async function fetchCoachedMatch(startedAt, endedAt, mctx) {
  const lm = await fetchLastMatch();
  if (!lm) return null;
  const v = verifyCoachedMatch(lm, startedAt, endedAt, mctx);
  if (!v.ok) {
    console.log(`[match-link] not linking the last match to this session: ${v.why}`);
    return null;
  }
  console.log(`[match-link] linked: ${lm.map} ${lm.agent} ${lm.result} ${lm.score} (${lm.kills}/${lm.deaths}/${lm.assists}, ACS ${lm.acs})`);
  return lm;
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
  const grader = require('../shared/lol-grader');
  const targets = require('../shared/lol-targets');
  try {
    const history = store.get('lolHistory') || [];
    const built = review.buildReview(record, history);
    const graded = grader.gradeGame(record, history);

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
    reviewWindow.open();
    console.log(`[lol] review ready: ${built.scoreline.kills}/${built.scoreline.deaths}/${built.scoreline.assists}`);
  } catch (e) {
    // A failed grade must never lose the game that was recorded, so the raw
    // record is kept for inspection rather than dropped on the floor.
    console.error('[lol] review failed:', e.message);
    lastLolRaw = record;
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

  return assembleReport({
    riotId,
    game,
    // Tracker stats are Valorant's; another game's week is its reviews alone.
    stats: game === 'valorant' ? tp.stats : null,
    base: game === 'valorant' ? base : null,
    snapshotAt: snapshot ? snapshot.at : null,
    // The last fortnight of graded matches, so this week can be compared with
    // the one before it.
    reviews: reviewStore.recent(game, 40).filter((e) => e.at >= Date.now() - 14 * 24 * 60 * 60 * 1000),
    patterns: patternsOf.summarise(reviewStore.recent(game, patternsOf.WINDOW)),
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
//   one frame every ten seconds of everything older, for the viewer
// and holds a finished match's frames whole until its review has looked.
const AI_LOG_RECENT        = 180;     // the last three minutes at the fastest read
const AI_LOG_THIN_MS       = 10000;   // older frames: one per ten seconds
const AI_LOG_DEATH_BEFORE  = 35000;   // kept before a registered death
const AI_LOG_DEATH_AFTER   = 5000;    // and after it
const AI_LOG_MAX_FRAMES    = 1500;    // hard ceiling, oldest go first
const AI_LOG_KEEP_SESSIONS = 5;       // only the most recent sessions survive
const AI_LOG_WRITE_MS      = 3000;    // log.json is rewritten at most this often
let aiLogDir = null;               // current session's folder
let aiLogRecords = [];             // in-memory index, flushed to log.json
let aiLogWarned = false;           // one write failure is reported per session
let aiLogSeq = 0;                  // frame file counter, never reused in a session
let aiLogKeepUntil = 0;            // frames up to here follow a death, and are kept
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
    aiLogRecords = [];
    aiLogWarned = false;
    aiLogSeq = 0;
    aiLogKeepUntil = 0;
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
    const keep = idx >= edge || r.keep || r.kept || held(r) || r.at - lastKept >= AI_LOG_THIN_MS;
    if (keep) {
      if (idx < edge) { r.kept = true; lastKept = r.at; }
      out.push(r);
    } else {
      try { fs.unlinkSync(path.join(aiLogDir, r.frame)); } catch {}
    }
  });
  while (out.length > AI_LOG_MAX_FRAMES) {
    const k = out.findIndex((r) => !held(r));
    const drop = out.splice(k < 0 ? 0 : k, 1)[0];
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
 */
function holdAiLogFrames(from, to) {
  if (!aiLogDir) return null;
  const hold = { from: from - 5000, to: to + 5000, until: Date.now() + 8 * 60 * 1000 };
  aiLogHolds.push(hold);
  flushAiLog(true);
  return {
    dir: aiLogDir, hold,
    records: aiLogRecords.filter((r) => r.at >= hold.from && r.at <= hold.to).map((r) => ({ ...r })),
  };
}
function releaseAiLogFrames(log) {
  if (!log || !log.hold) return;
  aiLogHolds = aiLogHolds.filter((h) => h !== log.hold);
}

/** Keep only the most recent session folders. */
function pruneAiLog() {
  // The live folder is named so no prune can remove the session in progress,
  // whichever order the caller happens to run in.
  aiLogStore.prune(aiLogRoot(), AI_LOG_KEEP_SESSIONS, aiLogLiveId());
}

/** Metadata for the session picker: every kept session, and no frames. */
function aiLogSessions() { return aiLogStore.sessions(aiLogRoot(), aiLogLiveId()); }

/** One session with its frames, for the viewer. Newest unless asked otherwise. */
function readAiLog(id) { return aiLogStore.read(aiLogRoot(), id, aiLogLiveId()); }

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

async function confirmDeaths(id) {
  const chosen = aiLogStore.dirs(aiLogRoot()).includes(String(id)) ? String(id) : (aiLogStore.dirs(aiLogRoot())[0] || null);
  if (!chosen) return { status: 'unavailable' };
  const cached = deathChecks.get(chosen);
  if (cached) return cached;

  const riotId = (store.get('riotId') || '').trim();
  const licenseKey = store.get('licenseKey');
  if (!riotId.includes('#') || !licenseKey) return { status: 'unavailable', why: 'no Riot ID set' };

  try {
    const log = aiLogStore.read(aiLogRoot(), chosen);
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
      return deathCheckRemember(chosen, { status: 'unavailable', why: 'no tracker match lines up with this session' });
    }

    const { ok, data } = await api.get(
      `/api/coach/match-deaths?matchId=${encodeURIComponent(hit.id)}&username=${encodeURIComponent(riotId)}`,
      licenseKey, 30000);
    if (!ok || !data || data.error) {
      return deathCheckRemember(chosen, { status: 'unavailable', why: (data && data.error) || 'tracker did not answer' });
    }

    const rec = reconcileDeaths(detected, data, recs);
    rec.summary = summariseDeaths(rec);
    rec.match = { map: hit.map, score: hit.score, agent: hit.agent, result: hit.result };
    console.log(`[ai-log] death check for ${chosen}: ${rec.summary}`);
    return deathCheckRemember(chosen, rec);
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
  try { hotkeys.unregister(); } catch (e) {}
  try { tray.destroy(); } catch (e) {}
  try { capture.disposeWorker(); } catch (e) {}
  for (const name of ['dock', 'matches', 'review', 'settings', 'panel', 'stats', 'weekly', 'ailog', 'chat']) {
    const w = registry.get(name);
    if (w && !w.isDestroyed()) w.destroy();
  }
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
  licenseService.clear();
  teardownSession();
  mainLaunched = false;
  console.log('[license] logged out', reason ? `(${reason})` : '(manual)');
  activationWindow.create(reason);
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
  isMinimized:    () => panelWindow.isMinimized(),
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

  if (!store.get('onboardingCompleted')) {
    onboardingWindow.create();
    console.log('[main] first run, waiting on onboarding before opening the app');
    return;
  }
  openAppWithSplash();
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
  // cost left to cover either. Just make sure the panel is showing.
  if (surfacesUp) { panelWindow.reveal(); return; }

  splashWindow.open();
  splashWindow.onTimeout(() => panelWindow.reveal());   // never strand a hidden panel
  createAppSurfaces({ deferShow: true });

  const panel = panelWindow.get();
  const handOver = () => splashWindow.close(() => panelWindow.reveal());
  if (panel) panel.webContents.once('did-finish-load', handOver);
  else handOver();
}

function createAppSurfaces(opts) {
  if (surfacesUp) return;
  surfacesUp = true;

  // deferShow keeps the panel hidden until the launch animation finishes.
  panelWindow.create({ deferShow: !!(opts && opts.deferShow) });
  tray.create(trayActions);
  hotkeys.register(hotkeyActions);
  updater.init();   // background update checks + in-app restart prompt

  // Send an initial state snapshot once the panel has loaded.
  const panel = panelWindow.get();
  if (panel) {
    panel.webContents.once('did-finish-load', () => {
      setTimeout(() => registry.broadcast(C.PUSH_STATE, buildState()), 200);
    });
  }
  startLicenseWatch(); // detect expiry / revocation mid-session and keep Settings fresh

  // Stay connected to the tracker across restarts: refresh the saved profile in
  // the background so live tips + chat have current stats without reconnecting.
  if ((store.get('riotId') || '').trim()) {
    fetchTrackerStats(true).catch(() => {});
  }

  maybeShowWeeklyReport();
  console.log('[main] app surfaces created');
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
    const win = registry.get('panel') || registry.get('activation');
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    logger.init(app);
    console.log('[main] Ready. Debug log:', logger.getLogPath());

    registerIpc({ controller, license });

    // Dev-only self-test (never runs in normal use): bypasses the license server
    // and exercises launch → IPC round-trip, writing results to debug.log.
    if (process.env.OCCLARA_DEV_AUTOLAUNCH === '1') {
      setTimeout(() => {
        console.log('[dev] auto-launch (license bypassed) for self-test');
        launchMainApp();
        controller.start();
        if (process.env.OCCLARA_DEV_OPEN_SETTINGS === '1') settingsWindow.open();
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
      activationWindow.create();
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
