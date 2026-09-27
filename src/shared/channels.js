'use strict';

/**
 * ★ SINGLE SOURCE OF TRUTH for every IPC channel name.
 *
 * Imported by the main process, every preload, and (indirectly) every renderer.
 * No channel string is ever hand-typed anywhere else in the app. This is the
 * fix for the old client's #1 bug: main and preload drifted to different
 * channel names and the overlay silently stopped receiving events.
 *
 * Conventions:
 *   - invoke/handle  → request/response   (renderer asks, main answers)
 *   - send/on        → fire-and-forget    (renderer commands main)
 *   - webContents.send → push             (main → renderer broadcast)
 */
const CHANNELS = {
  // ── request / response (ipcRenderer.invoke ⇄ ipcMain.handle) ──────────────
  LICENSE_ACTIVATE: 'license:activate', // (key) → { ok, valid, plan, status, expiresAt, error? }
  LICENSE_GET:      'license:get',       // () → { licenseKey, plan, status, expiresAt }
  CONFIG_GET:       'config:get',        // () → full config snapshot
  CONFIG_SET:       'config:set',        // (partial) → { ok }
  STATE_GET:        'state:get',         // () → current coaching state snapshot
  AGENT_SET:        'agent:set',         // (name) → { ok, agent, confirmed, role }
  CHAT_SEND:        'chat:send',         // (messages) → { ok, reply }
  STATS_TEST:       'stats:test',        // () → { ok, stats?, error? } tracker connect test
  STATS_DASHBOARD:  'stats:dashboard',   // () → { categories, rank, winRate, sessions, sessionCount, matches, riotConnected }
  STATS_REFRESH:    'stats:refreshMatches', // (mode) → { matches, fetchedAt, mode, refreshBlockedFor? } (3-min manual limit)
  STATS_MATCHES:    'stats:matches',       // (mode) → { matches, fetchedAt, mode } cached fetch for mode switching
  CHAT_SEED:        'chat:seed',         // () → pending session context for Ask Coach, cleared on read
  STATS_RANK_HISTORY: 'stats:rankHistory', // () → { points: [{date, elo, change, tier}], current }
  WEEKLY_GET:       'weekly:get',        // () → the week's report (stat movement, strengths, what to fix)
  LEARN_GET:        'learn:get',         // () → { curriculum, progress, champions }
  LEARN_PROGRESS:   'learn:progress',    // ({ lessonId, done }) → { ok, progress }
  // ({ band, role }) → the whole learn payload, recomputed. The rank band and
  // role decide which skills apply and what every target is, so the dashboard
  // edits them in place rather than sending the player to Settings.
  LEARN_PROFILE:    'learn:profile',
  // () the last League review, so the window can paint if it opens late
  LOL_REVIEW_GET:   'lol:review',
  AILOG_GET:        'ailog:get',         // (sessionId?) → one AI decision-log session, newest by default { session, sessions, records: [{frameData, state, aiTip, shown}] }
  AILOG_SESSIONS:   'ailog:sessions',    // () → [{ id, at, frames, deaths, maps, mins, live }] metadata only, no frames
  AILOG_CONFIRM:    'ailog:confirm',     // (sessionId) → { status, detected, expected, summary, pairs } check the log's deaths against Riot
  AILOG_ASK:        'ailog:ask',         // ({ session, index, question, history }) → { reply } ask the coach about one logged frame
  APP_VERSION:      'app:version',       // () → { current, state, version } running version + update status
  APP_UPDATE_CHECK: 'app:updateCheck',   // () → same shape, after forcing a fresh feed check

  // ── renderer → main commands (ipcRenderer.send ⇄ ipcMain.on) ──────────────
  COACH_START:     'coach:start',
  COACH_STOP:      'coach:stop',
  COACH_PAUSE:     'coach:pauseResume',
  AGENT_CONFIRM:   'agent:confirm',      // player tapped ✓ on the detected agent
  PANEL_RESIZE:    'panel:resize',       // (height) → fit the window to panel content
  PANEL_MINIMIZE:  'panel:minimize',     // hide the interactive panel (anti-aim-interference)
  OPEN_SETTINGS:   'window:openSettings',
  OPEN_HISTORY:    'window:openHistory',
  OPEN_CHAT:       'window:openChat',    // the Ask Coach chat window
  OPEN_STATS:      'window:openStats',   // the extended stats dashboard window
  OPEN_WEEKLY:     'window:openWeekly',  // the weekly report popup
  OPEN_AILOG:      'window:openAiLog',   // (sessionId?) the AI decision-log viewer
  OPEN_LEARN:      'window:openLearn',   // the League learning surface
  OPEN_REVIEW:     'window:openReview',  // the last post-match review, any game
  // The match library: every saved review, for every game.
  REVIEWS_LIST:    'reviews:list',       // (game?) -> [{ id, at, game, title, result, score, grade }]
  REVIEW_GET:      'reviews:get',        // (id) -> the saved review
  REVIEW_OPEN:     'reviews:open',       // (id) open the review window on one saved review
  PATTERNS_GET:    'reviews:patterns',   // (game) -> repeated mistakes, strengths, misses, grade trend
  AILOG_SHOW:      'ailog:show',         // (sessionId) jump an OPEN log window to one session
  OPEN_CHAT_SEEDED:'window:openChatSeeded', // (sessionSeed) open Ask Coach preloaded with a session's context
  OPEN_PURCHASE:   'window:openPurchase',
  LICENSE_LOGOUT:  'license:logout',      // clear license + return to activation screen
  ONBOARDING_DONE: 'onboarding:done',     // close the welcome card + never show again
  APP_QUIT:        'app:quit',

  // ── main → renderer pushes (webContents.send ⇄ ipcRenderer.on) ────────────
  PUSH_STATUS:       'push:status',       // { status: 'coaching'|'paused'|'stopped'|'idle' }
  PUSH_STATE:        'push:state',        // full state snapshot (panel + settings)
  PUSH_AGENT:        'push:agent',        // { agent, confirmed, role }, drives the confirm bubble
  PUSH_NUDGE:        'push:nudge',        // { kind: 'minimize' } one-off coaching hint on the panel
  // EDGE TRIGGERED, not a state snapshot: fired only when the selected game
  // actually changed. PUSH_STATE already carries gameId, but it fires on every
  // config write and every status tick, so a surface that wanted to reload on a
  // game change had to diff it by hand. Stats did not, which is why it kept
  // showing Valorant rank and agents after switching to League.
  PUSH_REVIEWS:      'push:reviews',      // { id, game } a review was saved or improved; the library repaints
  PUSH_GAME:         'push:game',         // { id, label } the game changed, reload anything game-scoped
  // The recorded League game is graded and ready. Fired ONCE per finished game,
  // after it ends, never during it.
  PUSH_LOL_REVIEW:   'push:lolReview',
  // The Marvel Rivals post match review, computed from the end of match
  // scoreboard. A SEPARATE CHANNEL from the League one rather than a shared
  // "review" channel, because the two carry different shapes and the review
  // window has to know which it is holding. It also means the League path is
  // untouched: that surface has a boot check of its own (check:lolreview) and
  // widening its channel would put a second producer behind it.
  PUSH_RIVALS_REVIEW: 'push:rivalsReview',
  // The reasoning behind a tip the player just saw, on demand. A live tip is one
  // sentence because it is read mid fight; this is the same call explained at
  // length, and it only ever fires when the player asks for it.
  // The Valorant post-match review, the round by round one. Its own channel for
  // the reason the Rivals one has its own: a different shape, and the review
  // window branches on review.kind rather than sniffing for fields.
  PUSH_VALORANT_REVIEW: 'push:valorantReview',
};

// Channels the renderer is allowed to subscribe to (defensive whitelist used
// by preloads so a renderer can never listen on an arbitrary channel).
CHANNELS.PUSH_LIST = [
  CHANNELS.PUSH_STATUS,
  CHANNELS.PUSH_STATE,
  CHANNELS.PUSH_AGENT,
  CHANNELS.PUSH_NUDGE,
  CHANNELS.PUSH_GAME,
  CHANNELS.PUSH_REVIEWS,
  CHANNELS.PUSH_LOL_REVIEW,
  CHANNELS.PUSH_RIVALS_REVIEW,
  CHANNELS.PUSH_VALORANT_REVIEW,
];

module.exports = CHANNELS;
