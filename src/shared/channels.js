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
  // What the Stats page was opened to show (8.4.1): 'journey' when Home's
  // Rank journey opened it (OPEN_STATS), else null. Cleared on read, as
  // CHAT_SEED is; the page asks as it loads and each time it is about to show.
  STATS_OPENED_FOR: 'stats:openedFor',   // () → 'journey' | null
  WEEKLY_GET:       'weekly:get',        // () → the week's report (stat movement, strengths, what to fix)
  LEARN_GET:        'learn:get',         // () → { curriculum, progress, champions }
  LEARN_PROGRESS:   'learn:progress',    // ({ lessonId, done }) → { ok, progress }
  // ({ band, role }) → the whole learn payload, recomputed. The rank band and
  // role decide which skills apply and what every target is, so the dashboard
  // edits them in place rather than sending the player to Settings.
  LEARN_PROFILE:    'learn:profile',
  // () the last League review, so the window can paint if it opens late
  LOL_REVIEW_GET:   'lol:review',
  AILOG_GET:        'ailog:get',         // (sessionId?, scope?) → one AI decision-log session, newest by default { session, sessions, records: [{frameData, state, aiTip, shown}] }; with a scope, that one match's frames or { gone: true }, as is a session no longer kept
  AILOG_SESSIONS:   'ailog:sessions',    // () → [{ id, at, frames, deaths, maps, mins, live }] metadata only, no frames
  AILOG_CONFIRM:    'ailog:confirm',     // (sessionId, scope?) → { status, detected, expected, summary, pairs } check the log's deaths against Riot
  AILOG_ASK:        'ailog:ask',         // ({ session, scope?, index, question, history }) → { reply } ask the coach about one logged frame
  APP_VERSION:      'app:version',       // () → { current, state, version } running version + update status
  APP_UPDATE_CHECK: 'app:updateCheck',   // () → same shape, after forcing a fresh feed check

  // ── renderer → main commands (ipcRenderer.send ⇄ ipcMain.on) ──────────────
  COACH_START:     'coach:start',
  COACH_STOP:      'coach:stop',
  COACH_PAUSE:     'coach:pauseResume',
  AGENT_CONFIRM:   'agent:confirm',      // player tapped ✓ on the detected agent
  OPEN_SETTINGS:   'window:openSettings',
  OPEN_HISTORY:    'window:openHistory',
  OPEN_CHAT:       'window:openChat',    // the Ask Coach chat window
  OPEN_STATS:      'window:openStats',   // (what?) the Stats page; 'journey' opens it with the rank journey open
  OPEN_WEEKLY:     'window:openWeekly',  // the weekly report popup
  OPEN_AILOG:      'window:openAiLog',   // (sessionId?) the AI decision-log viewer
  OPEN_LEARN:      'window:openLearn',   // the League learning surface
  OPEN_REVIEW:     'window:openReview',  // the last post-match review, any game
  // The match library: every saved review, for every game.
  REVIEWS_LIST:    'reviews:list',       // (game?) -> [{ id, at, game, title, result, score, grade, aiLog: 'kept' | 'gone' | null, work: null | { path, step, ... } }]
  REVIEW_GET:      'reviews:get',        // (id) -> the saved review
  REVIEW_OPEN:     'reviews:open',       // (id) open the review window on one saved review
  // The eye on a library row and on the review page (8.2): the AI log, opened
  // on that review's match. The page names the review and nothing else; main
  // finds the session and the frames from it. The eye on one death the coach
  // looked at adds when its frame was captured, to open the log at it.
  REVIEW_AILOG:    'reviews:ailog',      // (id, at?) open the AI log on one saved review's match, at the frame captured at `at`
  PATTERNS_GET:    'reviews:patterns',   // (game) -> repeated mistakes, strengths, misses, grade trend
  // The breakdown in Matches: by map and agent (champion), counted from
  // the saved reviews of one game (src/shared/breakdown.js).
  BREAKDOWN_GET:   'reviews:breakdown',  // (game, { queue }) -> { game, matches, dims, rows, headline, ... }
  // Grading the recent matches of the Riot ID in config from Riot's record
  // (src/main/services/backfill.js).
  BACKFILL_START:  'backfill:start',     // () -> the run's status
  BACKFILL_STATUS: 'backfill:status',    // () -> the run's status
  // The clips kept beside the reviews (8.3, src/main/services/review-clips.js),
  // for Settings: what they take against the cap, and Clear clips.
  CLIPS_USAGE:     'clips:usage',        // () -> { bytes, clips, reviews, capGB }
  CLIPS_CLEAR:     'clips:clear',        // () -> the same, once every clip is gone
  // The PC check behind onboarding's Record gameplay or Frames only (8.3.1,
  // src/main/services/pc-check.js): what Node can tell of this PC, and the
  // recorder's two encoder asks for the page to put to WebCodecs itself.
  PC_CHECK:        'pc:check',           // () -> { gpu, cpu, threads, ramBytes, display, freeBytes, drive, asks: [{ res, width, height, codec, bitrate }] }
  AILOG_SHOW:      'ailog:show',         // (sessionId | { scope, at? }) jump an OPEN log window to one session, or to one match of one, at one frame of it
  // The one window (8.1, src/main/windows/main-window.js): the sidebar asks
  // for a page by its id in src/shared/shell-nav.js, and the top strip's
  // buttons move the window.
  SHELL_NAV:       'shell:nav',          // (pageId) show that page
  SHELL_WINDOW:    'shell:window',       // ('minimize' | 'maximize' | 'close')
  SHELL_GET:       'shell:get',          // () -> { page, shown, sealed, maximized }
  // A page has painted itself armed (8.2): main-window.js may now hide the
  // page on screen and let this one in (PUSH_PAGE).
  PAGE_READY:      'page:ready',         // (pageId) from that page's own view only
  OPEN_CHAT_SEEDED:'window:openChatSeeded', // (sessionSeed) open Ask Coach preloaded with a session's context
  OPEN_PURCHASE:   'window:openPurchase',
  LICENSE_LOGOUT:  'license:logout',      // clear license + return to activation screen
  ONBOARDING_DONE: 'onboarding:done',     // close the welcome card + never show again
  APP_QUIT:        'app:quit',

  // ── main → renderer pushes (webContents.send ⇄ ipcRenderer.on) ────────────
  PUSH_STATUS:       'push:status',       // { status: 'coaching'|'paused'|'stopped'|'idle' }
  PUSH_STATE:        'push:state',        // full state snapshot (panel + settings)
  PUSH_AGENT:        'push:agent',        // { agent, confirmed, role }, drives the confirm bubble
  // EDGE TRIGGERED, not a state snapshot: fired only when the selected game
  // actually changed. PUSH_STATE already carries gameId, but it fires on every
  // config write and every status tick, so a surface that wanted to reload on a
  // game change had to diff it by hand. Stats did not, which is why it kept
  // showing Valorant rank and agents after switching to League.
  PUSH_REVIEWS:      'push:reviews',      // { id, game } a review was saved or improved; the library repaints
  PUSH_GAME:         'push:game',         // { id, label } the game changed, reload anything game-scoped
  // The backfill's status on every change: { state, account, total, done, items, message, ... }
  PUSH_BACKFILL:     'push:backfill',
  // The recorded League game is graded and ready. Fired ONCE per finished game,
  // after it ends, never during it.
  PUSH_LOL_REVIEW:   'push:lolReview',
  // The reasoning behind a tip the player just saw, on demand. A live tip is one
  // sentence because it is read mid fight; this is the same call explained at
  // length, and it only ever fires when the player asks for it.
  // The Valorant post-match review, the round by round one. A SEPARATE CHANNEL
  // from the League one rather than a shared "review" channel, because the two
  // carry different shapes, and the review window branches on review.kind
  // rather than sniffing for fields. It also means the League path is
  // untouched: that surface has a boot check of its own (check:lolreview).
  PUSH_VALORANT_REVIEW: 'push:valorantReview',
  // A review still being built (8.4.1, src/shared/review-work.js): { id, work },
  // work the step it is on or null once it is done, on every change. The
  // review page shows its loading screen until then, and Home and Matches say
  // it is being checked where its grade would be. The review itself arrives
  // with its work too (index.js present()), and every library row (REVIEWS_LIST).
  PUSH_REVIEW_WORK:  'push:reviewWork',
  // The main window's page and seal, to the shell: { page, shown, sealed, maximized }.
  PUSH_SHELL:        'push:shell',
  // Moving between pages (8.2, src/shared/shell-nav.js createMotion), to one
  // page: { phase: 'arm', dir } paint yourself invisible and say PAGE_READY,
  // { phase: 'enter', dir } come in, { phase: 'leave' } another page is coming.
  PUSH_PAGE:         'push:page',

  // ── the match recorder (8.3, src/main/services/recorder.js) ───────────────
  // Between main and the recorder's hidden page (src/renderer/recorder) and
  // nothing else. The page records the screen and shows nothing on it.
  // main -> page: { type: 'start', ... } | { type: 'stop' } | { type: 'grab',
  // id, width, height, quality } | { type: 'compare', id, gdi } | { type:
  // 'gate', id, codec, width, height, bitrate } (the hardware gate's answer)
  PUSH_RECORDER:     'push:recorder',
  // page -> main: { seq, wall, data } one MediaRecorder chunk, in order, with
  // the page's wall clock when it was handed over
  RECORDER_CHUNK:    'recorder:chunk',
  // page -> main: { type: 'ready' | 'started' | 'health' | 'stopped' | 'error', ... }
  RECORDER_STATUS:   'recorder:status',
  // page -> main: { id, ok, ... } the answer to a grab (a JPEG for the read),
  // a compare (the stream's brightness against a GDI frame's) or a gate
  RECORDER_REPLY:    'recorder:reply',

  // ── the frames of a clip (8.3.1, src/main/windows/frames-window.js) ───────
  // Between main and the frames page (src/renderer/frames), a window that is
  // never shown, and nothing else: the stills the look at a death takes from
  // a clip of the match's recording, decoded after the match.
  // main -> page: { id, codec, width, height, chunks: [{ ts, key, data }],
  // picks: [ts | null], outWidth, outHeight, quality }
  PUSH_FRAMES:       'push:frames',
  // page -> main: { type: 'ready' } once, then { id, ok, frames: [JPEG |
  // null], accel, ms, error }
  FRAMES_REPLY:      'frames:reply',
};

// Channels the renderer is allowed to subscribe to (defensive whitelist used
// by preloads so a renderer can never listen on an arbitrary channel).
CHANNELS.PUSH_LIST = [
  CHANNELS.PUSH_STATUS,
  CHANNELS.PUSH_STATE,
  CHANNELS.PUSH_AGENT,
  CHANNELS.PUSH_GAME,
  CHANNELS.PUSH_REVIEWS,
  CHANNELS.PUSH_BACKFILL,
  CHANNELS.PUSH_LOL_REVIEW,
  CHANNELS.PUSH_VALORANT_REVIEW,
  CHANNELS.PUSH_REVIEW_WORK,
  CHANNELS.PUSH_SHELL,
  CHANNELS.PUSH_PAGE,
  CHANNELS.PUSH_RECORDER,
  CHANNELS.PUSH_FRAMES,
];

module.exports = CHANNELS;
