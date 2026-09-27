'use strict';

/**
 * App-wide constants and store defaults. Plain values only (required by both
 * main and renderer-side code), no Electron imports here.
 */

// ── Backend (documented contract, do not change) ───────────────────────────
const SERVER_BASE_URL = 'https://ghostcoach-production.up.railway.app';

const API = {
  ACTIVATE:     '/api/license/activate',
  ANALYZE:      '/api/coach/analyze',   // older clients only; this one reads
  READ:         '/api/coach/read',      // facts only, one frame, every one to five seconds
  DETECT_AGENT: '/api/coach/detect-agent',
  MATCH_REVIEW: '/api/coach/match-review',
  DEATH_FORENSICS: '/api/coach/death-forensics',   // the frame before each teachable death
};

const PURCHASE_URL = 'https://occlara.app';

// ── Brand ───────────────────────────────────────────────────────────────────
const BRAND = {
  red:  '#FF4655',
  cyan: '#00F0FF',
  bg:   '#0F1923',
};

// ── Capture ─────────────────────────────────────────────────────────────────
// Two quality profiles: standard is plenty for HUD reading and uploads fast;
// high sends a sharper frame (bigger upload + more image tokens per call, so
// slightly slower replies, but zero effect on game FPS since capture runs in
// a worker thread).
// THE COACH READS SMALL TEXT, so the frame has to carry it. Health, the round
// timer, the scoreline and the printed location label are only a few pixels tall
// at 480p, and those four fields are what every guard in the engine is built on.
// 720p is the point where they are comfortably legible; going beyond that buys
// nothing a HUD reader needs and costs upload time and image tokens on every
// frame, so "standard" stops there rather than chasing resolution.
//
// "performance" is the old 480p profile, kept as an explicit choice for players
// on weaker machines or thin connections. It is a real trade: the coach reads
// the HUD less reliably, and the setting says so.
const CAPTURE = {
  targetW: 1280,
  targetH: 720,
  jpegQuality: 70,
  timeoutMs: 6000,
  profiles: {
    standard:    { targetW: 1280, targetH: 720, jpegQuality: 70 },
    performance: { targetW: 854,  targetH: 480, jpegQuality: 50 },
    // Kept so an explicit 'high' request still resolves; same as standard now.
    high:        { targetW: 1280, targetH: 720, jpegQuality: 70 },
  },
};

// ── Engine timing (ms) ──────────────────────────────────────────────────────
const TIMING = {
  agentDetectFirst:    3000,   // detect early so the agent is known by the first round
  agentDetectRetry:    30000,
  serverTimeout:       8000,
};

// How often the game can be read, fastest first. 'auto' starts at the first and
// steps down with the model's measured latency (coaching-engine adaptCadence),
// because a read that lands after the next one is due only piles up. A player
// can pin one in Settings.
const CAPTURE_TIERS = [1000, 2000, 3000, 5000];

// ── electron-store schema defaults ──────────────────────────────────────────
const STORE_DEFAULTS = {
  // license
  licenseKey:    '',
  licensePlan:   '',
  licenseStatus: '',
  licenseExpiry: '',
  deviceId:      '',
  // preferences
  // How often the game is read during a match: 'auto', or one of CAPTURE_TIERS
  // pinned. Faster means more of the match reaches the review.
  captureSpeed:    'auto',
  riotId:          '',           // Name#TAG, the account Riot's record is looked up for
  playerStats:     null,         // last good tracker profile (persists = always connected)
  lastMatchStats:  null,         // stats snapshot from the previous match (delta arrows)
  // Completed League lesson ids. An array rather than a count, so a curriculum
  // that gains or loses a lesson cannot strand someone at a total they can
  // never reach; summarise() ignores ids it does not recognise.
  lolProgress:     [],
  // Per-game League records, newest last, for the personal baseline the grader
  // judges against. Capped at BASELINE_GAMES in lol-targets.js. Records for
  // metrics that no longer exist are ignored on read, the same way summarise()
  // ignores lesson ids it does not recognise, so changing the skill set can
  // never strand a player on a baseline they cannot move.
  lolHistory:      [],
  // Per-match Marvel Rivals records, newest last, for the personal baseline the
  // post match review judges against. Capped at RIVALS_BASELINE_GAMES.
  //
  // WITHOUT THIS THE REVIEW REFUSED TO JUDGE ANYTHING, and said so in its own
  // header: a number needs a baseline before it means anything, and there was
  // nowhere to keep one. Reviews were pushed to the window and then gone, so
  // closing it lost the match.
  //
  // Each entry stores the ROLE and the HERO alongside the numbers, because the
  // baseline is scoped rather than global. A Strategist's kills and a Duelist's
  // kills are different quantities, and accuracy is only comparable within one
  // hero, since a projectile hero is naturally lower than a hitscan one at the
  // same skill.
  rivalsHistory:   [],
  // The last 10 Valorant matches the tracker could verify, one row each, from
  // Riot's numbers only. The review compares against these in the same ROLE,
  // for the same reason rivalsHistory is role scoped: a controller's ACS and a
  // duelist's are different quantities.
  valorantHistory: [],
  // Rank band 1 to 5, NOT one of eight ranks. The underlying data does not
  // support eight-way granularity, and unset means the default band rather
  // than a guess.
  lolBand:         null,
  // Top | Jungle | Mid | Bot | Support. Unset means every skill is shown,
  // because hiding one on a guess is worse than showing one that does not apply.
  lolRole:         '',
  // Screenshot quality. 'standard' is 720p, chosen because health, the round
  // timer, the scoreline and the printed location label are what the guards run
  // on and they are only a few pixels tall below it. 'performance' is the older
  // 480p frame for weaker machines, and it genuinely costs read accuracy.
  captureQuality:  'standard',   // standard | performance
  // Which game is being coached. See src/shared/games.js. Only games with
  // coaching:true are offered to a player; devGames reveals the rest for
  // development, so an unfinished game can be previewed without being sold.
  game:            'valorant',
  devGames:        false,
  // Interface and review language. The review is written in this language by
  // the model, which costs nothing extra; the UI follows for languages that
  // have a catalogue in src/shared/i18n.js and stays English otherwise.
  language:        'en',         // see LANGUAGES in src/shared/i18n.js
  // Bias the review's playbook toward advanced notes: damage breakpoints,
  // utility timings, reads across rounds. OFF by default, because advanced
  // advice assumes the fundamentals are already in place.
  //
  // It is a BIAS, never a replacement. A floor of core notes always survives,
  // and on a deathstreak core takes the majority back, because a player dying
  // on repeat needs fundamentals rather than theory. See retrieve() in
  // server/services/knowledge.js.
  advancedTips:    false,
  sounds:          true,         // the two interface sounds: recording armed, recording stood down
  panelBounds:     null,         // { x, y } remembered position of the control panel
  panelMinimized:  false,
  onboardingCompleted: false,
  coachStartCount: 0,            // how many sessions started; the minimize hint rides on this
  // Weekly report: the baseline the current stats are compared against, and
  // which week the popup was last shown for (so it opens once a week, not on
  // every launch).
  weeklySnapshot:   null,        // { at, riotId, stats } captured at the start of the week
  weeklyReportWeek: '',          // "2026-W30", the last week whose report was shown
  aiLog:            true,         // save each read frame + STATE for the AI log, and for the review's key moments
  // How many times the log window has shown its keyboard hint. It appears for
  // the first few opens and then stops, the same way coachStartCount drives the
  // minimize nudge: a shortcut nobody is told about is a shortcut nobody uses,
  // and a hint that never goes away is furniture.
  ailogHintSeen:    0,
};

module.exports = {
  CAPTURE_TIERS,
  SERVER_BASE_URL,
  API,
  PURCHASE_URL,
  BRAND,
  CAPTURE,
  TIMING,
  STORE_DEFAULTS,
};
