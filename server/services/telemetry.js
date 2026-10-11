'use strict';

/**
 * Aggregate coaching health, with no player content in it.
 *
 * The AI decision log is the tool that has found nearly every real bug in this
 * app, and it exists only on the player's own machine. That is the right
 * default: a frame is a photograph of somebody's screen, complete with their
 * Discord, their tabs and their stream chat, so collecting frames centrally
 * would turn a low-risk local tool into a genuine liability.
 *
 * The useful part of a log is not the picture though, it is the COUNTS: how many
 * tips were shown, how many were rejected and for which reason. Reject-reason
 * histograms are what exposed the repetition problem, the ability-vocabulary
 * mismatch and the truncation false positive, and none of that needs a single
 * pixel or word of what the player saw.
 *
 * WHAT IS ACCEPTED HERE IS A CLOSED SET. Reject reasons are matched against the
 * known list below and anything unrecognised is counted as "other" rather than
 * stored, so a future reason that happens to interpolate a callout, a player
 * name or a tip cannot leak through by accident. No tip text, no frames, no
 * map, no agent, no identifiers beyond a truncated license hash.
 */

// Every reason the client can currently record, reduced to a stable slug. A
// reason that does not match is counted, never kept.
const REJECT_KINDS = [
  ['similar',        /too similar to a recent tip/i],
  ['repeat-play',    /already recommended|repeated the same ability/i],
  ['verify-gate',    /failed the final verify gate/i],
  ['truncated',      /cut off mid sentence/i],
  ['wrong-map',      /does not belong to the|callout/i],
  ['death-spot',     /death spot/i],
  ['round-decided',  /round is already decided/i],
  ['wrong-side-hold', /while .* confirmed on/i],
  ['spectating',     /spectat/i],
  ['ability',        /ability|abilities/i],
];

function kindOf(reason) {
  const r = String(reason || '');
  for (const [kind, re] of REJECT_KINDS) if (re.test(r)) return kind;
  return 'other';
}

// Rolling in-memory window. Deliberately not persisted: this is for spotting a
// regression across a release, not for building a profile of anyone.
const MAX_SESSIONS = 500;
const sessions = [];

// ── The match recorder's sessions (8.3) ─────────────────────────────────────
//
// How PCs cope with recording the match, in counts, so its thresholds (the
// client's src/main/services/recorder.js HEALTH, first guesses all) can be
// tuned from what real PCs did rather than from one desk. Held to the same
// rule as the rest of this file and stricter: every word is one of a closed
// list or the word 'other', every number is clamped and rounded, the version
// is a version or 'other', and every other field a client sends is dropped
// unread. The client sends { version, game, mode, res, outcome, minutes,
// fpsP50, recorderCpuP50, systemCpuP90, encoderOk }, the game since League
// games record too (a League game and a Valorant match cost a PC different
// things); a block from before it has no game, is kept as it came, and
// counts its game as 'other'. The tip era's reports never carried an
// outcome, and are counted as they always were.
const RECORDING_OUTCOMES = ['recorded', 'off', 'no-hw-encoder', 'busy', 'disk', 'black', 'error'];
const RECORDING_GAMES = ['valorant', 'lol'];
const RECORDING_MODES = ['auto', 'off'];
const RECORDING_RES = ['720', '1080'];
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAX_RECORDINGS = 1000;
const recordings = [];

const oneOf = (list, x) => (typeof x === 'string' || typeof x === 'number') && list.includes(String(x)) ? String(x) : 'other';
function clampTo(x, lo, hi) {
  if (typeof x !== 'number' && typeof x !== 'string') return null;
  if (typeof x === 'string' && !x.trim()) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(lo, Math.min(hi, n)) * 10) / 10;
}

function recordRecording(r, keyHash) {
  const version = typeof r.version === 'string' && VERSION.test(r.version) ? r.version : 'other';
  recordings.push({
    at: Date.now(),
    user: String(keyHash || '').slice(0, 8),
    version,
    game: oneOf(RECORDING_GAMES, r.game),
    mode: oneOf(RECORDING_MODES, r.mode),
    res: oneOf(RECORDING_RES, r.res),
    outcome: oneOf(RECORDING_OUTCOMES, r.outcome),
    minutes: clampTo(r.minutes, 0, 600),
    fpsP50: clampTo(r.fpsP50, 0, 240),
    // % of ONE core, so a process using four reads 400; 16 cores is the cap.
    recorderCpuP50: clampTo(r.recorderCpuP50, 0, 1600),
    systemCpuP90: clampTo(r.systemCpuP90, 0, 100),
    encoderOk: typeof r.encoderOk === 'boolean' ? r.encoderOk : null,
  });
  if (recordings.length > MAX_RECORDINGS) recordings.shift();
}

function median(xs) {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
}

/** The recorder's sessions, aggregated: counts only. */
function recordingSummary(rows) {
  if (!rows.length) return { reports: 0 };
  const outcomes = {};
  for (const o of RECORDING_OUTCOMES.concat(['other'])) outcomes[o] = 0;
  const users = new Set();
  let minutes = 0;
  for (const r of rows) {
    outcomes[r.outcome] += 1;
    if (r.user) users.add(r.user);
    minutes += r.minutes || 0;
  }
  // Of the sessions that tried (Auto), how many recorded to their end: the
  // number a release that makes recording cheaper or dearer moves.
  const tried = rows.filter((r) => r.mode === 'auto');
  const share = (part, of) => (of ? Math.round((part / of) * 100) : null);
  const gated = rows.filter((r) => r.encoderOk !== null);
  const one = (rs) => ({
    reports: rs.length,
    recordedShare: share(rs.filter((r) => r.mode === 'auto' && r.outcome === 'recorded').length, rs.filter((r) => r.mode === 'auto').length),
    medianFps: median(rs.map((r) => r.fpsP50)),
    medianRecorderCpu: median(rs.map((r) => r.recorderCpuP50)),
    medianSystemCpuP90: median(rs.map((r) => r.systemCpuP90)),
  });
  const byVersion = {};
  for (const v of [...new Set(rows.map((r) => r.version))]) byVersion[v] = one(rows.filter((r) => r.version === v));
  const byGame = {};
  for (const g of [...new Set(rows.map((r) => r.game))]) byGame[g] = one(rows.filter((r) => r.game === g));
  return {
    ...one(rows),
    distinctUsers: users.size,
    triedShare: share(tried.length, rows.length),
    outcomes,
    encoderOkShare: share(gated.filter((r) => r.encoderOk).length, gated.length),
    minutesRecorded: Math.round(minutes),
    byVersion,
    byGame,
  };
}

/**
 * Record one finished session.
 * @param report { tipsShown, tipsGenerated, durationMin, rejects: {reason: count} }
 *   from a tip era client, or the recorder's block (above), told apart by its
 *   outcome
 * @param keyHash short, non-reversible tag so repeat sessions can be told apart
 */
function record(report, keyHash) {
  if (!report || typeof report !== 'object') return;
  if (typeof report.outcome === 'string') { recordRecording(report, keyHash); return; }
  const rejects = {};
  for (const [reason, n] of Object.entries(report.rejects || {})) {
    const k = kindOf(reason);
    rejects[k] = (rejects[k] || 0) + (Number(n) || 0);
  }
  sessions.push({
    at: Date.now(),
    user: String(keyHash || '').slice(0, 8),
    version: String(report.version || '').slice(0, 12),
    tipsShown: Math.max(0, Math.min(999, Number(report.tipsShown) || 0)),
    tipsGenerated: Math.max(0, Math.min(999, Number(report.tipsGenerated) || 0)),
    durationMin: Math.max(0, Math.min(600, Math.round(Number(report.durationMin) || 0))),
    rejects,
  });
  if (sessions.length > MAX_SESSIONS) sessions.shift();
}

/** Aggregate view for the admin route. Counts only. */
function summary() {
  const recording = recordingSummary(recordings);
  if (!sessions.length) return { sessions: 0, recording };
  const byVersion = {};
  const rejectTotals = {};
  let shown = 0, generated = 0, minutes = 0;
  const users = new Set();

  for (const s of sessions) {
    shown += s.tipsShown;
    generated += s.tipsGenerated;
    minutes += s.durationMin;
    if (s.user) users.add(s.user);
    byVersion[s.version || 'unknown'] = (byVersion[s.version || 'unknown'] || 0) + 1;
    for (const [k, n] of Object.entries(s.rejects)) rejectTotals[k] = (rejectTotals[k] || 0) + n;
  }

  const totalRejects = Object.values(rejectTotals).reduce((a, b) => a + b, 0);
  // Sorted so the dominant failure mode is the first thing visible, which is how
  // every bug so far has actually been noticed.
  const rejectRanked = Object.entries(rejectTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => ({ kind, n, pct: totalRejects ? Math.round((n / totalRejects) * 100) : 0 }));

  return {
    sessions: sessions.length,
    distinctUsers: users.size,
    coachedMinutes: minutes,
    tipsShown: shown,
    tipsGenerated: generated,
    // The number worth watching: how much of what the coach writes survives.
    showRate: generated ? Math.round((shown / generated) * 100) : 0,
    tipsPerHour: minutes ? Math.round((shown / minutes) * 60) : 0,
    byVersion,
    rejects: rejectRanked,
    // The match recorder's sessions (8.3), kept apart from the tip era's.
    recording,
  };
}

/** The recorder's rows as kept, copied, for scripts/test-telemetry.js to read every field of. */
function recordingRows() { return recordings.map((r) => ({ ...r })); }

module.exports = { record, summary, kindOf, recordingRows, REJECT_KINDS, RECORDING_OUTCOMES, RECORDING_GAMES, RECORDING_MODES, RECORDING_RES };
