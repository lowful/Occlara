'use strict';

/**
 * Deciding whether a tracker match is the one a coaching session watched.
 *
 * Pulled out of index.js so it can be tested directly. This is a guard in the
 * same family as the ones in coaching-engine.js: a session graded against
 * someone else's scoreboard looks authoritative while being completely wrong,
 * which is worse than a session with no scoreboard at all. When in doubt, it
 * refuses to link.
 */

// The match may have started before coaching did (coaching usually begins in
// agent select or a round or two in), or shortly after we started watching.
const MATCH_LINK_LEAD_MS  = 20 * 60 * 1000;
const MATCH_LINK_TRAIL_MS = 10 * 60 * 1000;

// Roughly how long a round takes including the buy phase. Only used to work out
// whether a match was still being played when coaching started, so it wants to
// be about right rather than exact.
const ROUND_MS = 100 * 1000;

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Queues with no rounds to them. The tracker's teams there are not a round
// score, so a deathmatch reads as a 0-0 draw at 0 combat score, and a warm-up
// one played just before Start passed every other check and was graded as the
// coached match. The app's own fix text tells players to warm up exactly so.
// Replication, Spike Rush and custom games ARE played in rounds, and link.
const ROUNDLESS = ['deathmatch', 'team deathmatch', 'teamdeathmatch', 'hurm', 'escalation', 'ggteam',
  'snowball fight', 'snowball'];

/** Total rounds played, read off the "5-2" scoreline the tracker already sends. */
function roundsPlayed(lm) {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String((lm && lm.score) || ''));
  return m ? (Number(m[1]) + Number(m[2])) : 0;
}

/**
 * When the match finished, estimated from its length.
 *
 * The tracker reports when a match STARTED and never when it ended, which made
 * the start time the only thing available to compare against, and that is the
 * wrong question. A 45 minute competitive match that began 25 minutes before the
 * player hit Start was still very much in progress, and it was refused for
 * "starting before the session" while being the only match they played.
 * Returns null when the scoreline is unreadable, so the caller can fall back.
 */
function matchEndEstimate(lm) {
  if (!lm || !lm.startedAt) return null;
  if (lm.endedAt) return lm.endedAt;          // if a future payload provides it, prefer it
  const rounds = roundsPlayed(lm);
  return rounds ? lm.startedAt + rounds * ROUND_MS : null;
}

/**
 * @param lm         the tracker's last match ({ startedAt, map, agent, ... })
 * @param startedAt  when coaching started
 * @param endedAt    when coaching stopped
 * @param mctx       { map, agent } as the coach actually read them
 * @returns { ok: true } | { ok: false, why: string }
 *
 * Map and agent are only checked when WE know them, because an unknown on our
 * side is not evidence against the match. But anything we do know must agree,
 * and at least one identifying field must be checked: timing alone is far too
 * weak, since back-to-back games overlap the window trivially.
 */
function verifyCoachedMatch(lm, startedAt, endedAt, mctx) {
  if (!lm || !lm.startedAt) return { ok: false, why: 'no match start time' };
  if (ROUNDLESS.includes(String(lm.mode || '').trim().toLowerCase())
      || (lm.score && roundsPlayed(lm) === 0)) {
    return { ok: false, why: `not a match with rounds (${lm.mode || lm.score})` };
  }

  if (lm.startedAt > endedAt + MATCH_LINK_TRAIL_MS)  return { ok: false, why: 'match started after the session' };

  // OVERLAP, NOT START TIME. What makes a match the coached one is that it was
  // being played while the coach was watching. Testing the start time instead
  // threw away a real match for "starting before the session" when the player
  // simply began coaching partway through a long game, which is the normal way
  // this app gets used. Falls back to the old lead window only when the
  // scoreline cannot be read, since then there is nothing to estimate from.
  const end = matchEndEstimate(lm);
  if (end != null) {
    if (end < startedAt) return { ok: false, why: 'match had already finished before coaching started' };
  } else if (lm.startedAt < startedAt - MATCH_LINK_LEAD_MS) {
    return { ok: false, why: 'match started before the session and its length is unknown' };
  }

  const ourMap   = mctx && mctx.map;
  const ourAgent = mctx && mctx.agent;
  if (ourMap && lm.map && !sameName(ourMap, lm.map)) {
    return { ok: false, why: `map mismatch (coached ${ourMap}, match ${lm.map})` };
  }
  if (ourAgent && lm.agent && !sameName(ourAgent, lm.agent)) {
    return { ok: false, why: `agent mismatch (coached ${ourAgent}, match ${lm.agent})` };
  }
  if (!(ourMap && lm.map) && !(ourAgent && lm.agent)) {
    return { ok: false, why: 'no map or agent to confirm the match with' };
  }
  // THE ROUNDS HAVE TO FIT. The coach cannot have watched more rounds than the
  // match had, and a match it saw end on its score has that many rounds, one
  // either way for a misread digit. This is what tells two back to back
  // matches on the same map and agent apart, which the clock alone did not:
  // the last match's estimated end runs a minute or more past its real one.
  const ours = mctx && mctx.score;
  const theirs = roundsPlayed(lm);
  if (ours && theirs) {
    const watched = (ours.team | 0) + (ours.enemy | 0);
    if (watched > theirs) {
      return { ok: false, why: `the coach watched ${watched} rounds and the match had ${theirs}` };
    }
    if (ours.final && Math.abs(watched - theirs) > 1) {
      return { ok: false, why: `the coached match ended after ${watched} rounds and this one after ${theirs}` };
    }
  }
  return { ok: true };
}

/**
 * The coached match among the newest one and the few before it, which the
 * server sends as `recent`. The newest is not always this one: a deathmatch or
 * a skirmish queued straight after it used to fail the map check on every try.
 *
 * @returns { match, why, tried }  match is null when none of them verifies
 */
function pickCoachedMatch(lm, startedAt, endedAt, mctx) {
  const candidates = [lm, ...(lm && Array.isArray(lm.recent) ? lm.recent : [])];
  // A match already linked to another saved review is that review's, never
  // this one's too: a session restarted right after a match used to link the
  // previous match, and both reviews then showed the same scoreboard.
  const taken = new Set((mctx && mctx.exclude) || []);
  const seen = new Set();
  let why = null;
  let tried = 0;
  for (const m of candidates) {
    if (!m || (m.matchId && seen.has(m.matchId))) continue;
    if (m.matchId) seen.add(m.matchId);
    if (m.matchId && taken.has(m.matchId)) { why = why || 'already linked to another review'; continue; }
    tried++;
    const v = verifyCoachedMatch(m, startedAt, endedAt, mctx);
    if (v.ok) return { match: m, why: null, tried };
    why = why || v.why;
  }
  return { match: null, why: why || 'no match to check', tried };
}

/** The scoreboard fields worth keeping on a session record. */
function matchSummary(m) {
  if (!m) return null;
  return {
    result: m.result, score: m.score,
    kills: m.kills, deaths: m.deaths, assists: m.assists,
    kd: m.kd, acs: m.acs, adr: m.adr,
    headshotPct: m.headshotPct, grade: m.grade,
    map: m.map, agent: m.agent, startedAt: m.startedAt,
  };
}

/*
 * HOW LONG A REVIEW KEEPS TRYING TO LINK (index.js linkRiotRecord), the gap
 * before each try after the first. Riot publishes a match a few minutes after
 * it ends. A match recording was stopped in, or one the next match began
 * over, may still have been being played, so its review tries for longer.
 * Once the scoreboard links, Riot's round record can still fail on its own (a
 * rate limit, a slow publish), so it gets tries of its own.
 *
 * The AI log holds the match's frames for the whole of it, the look at the
 * deaths after it included (ai-log-store.js HOLD_MAX_MS), and
 * test:valorantreview fails the day these outgrow that hold.
 */
const LINK_RETRY_MS = [90000, 240000, 480000];
const LINK_RETRY_LONG_MS = [90000, 240000, 600000, 1200000];
const RIOT_ROUNDS_RETRY_MS = [120000, 300000];

module.exports = {
  verifyCoachedMatch, pickCoachedMatch, matchSummary, sameName,
  matchEndEstimate, roundsPlayed,
  MATCH_LINK_LEAD_MS, MATCH_LINK_TRAIL_MS, ROUND_MS,
  LINK_RETRY_MS, LINK_RETRY_LONG_MS, RIOT_ROUNDS_RETRY_MS,
};
