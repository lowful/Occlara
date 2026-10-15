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

const { isFinalScore } = require('../../shared/match-end');

// The match may have started before coaching did (coaching usually begins in
// agent select or a round or two in), or shortly after we started watching.
const MATCH_LINK_LEAD_MS  = 20 * 60 * 1000;
const MATCH_LINK_TRAIL_MS = 10 * 60 * 1000;

// Roughly how long a round takes including the buy phase. Only used to work out
// whether a match was still being played when coaching started, so it wants to
// be about right rather than exact.
const ROUND_MS = 100 * 1000;

// A minute and a half for the PC clock against Riot's, on every time compared
// with Riot's own. Measured on the real pacing timelines in test-backfill.js:
// with one minute, a recording of only the last round on a clock two minutes
// fast was filed twice; with two, a short recording just after a match was
// held to it. Cutting the menus and queues out of a recording's window by its
// rounds was tried too and changed no timeline, so a window is taken whole.
const CLOCK_SLACK_MS = 90 * 1000;

// The shortest a round can be, buy phase included: a 30 s buy, a quick wipe
// and the few seconds between rounds. Real rounds measure 83 to 103 s, so this
// only rules out what cannot have happened (endedEarly).
const MIN_ROUND_MS = 55 * 1000;

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * THE AGENT THE LINK MAY REFUSE A MATCH OVER (8.4.4), from a match's context
 * (the engine's, or the one a saved review's ledger kept): one the player
 * confirmed, the rule since agent detection began. An agent the screen found
 * by itself (agentSource 'hud', the engine's look at the player's own HUD,
 * coaching-engine.js lookForAgent) agrees with any match, as one never
 * confirmed always has: the HUD agent is the coach's best reading, Riot's
 * record says exactly which agent it was, and a misread icon must never cost
 * the review its scoreboard. So every check here (verifyCoachedMatch,
 * endedEarly) and the backfill's claims see no agent from it. A review saved
 * before 8.4.4 keeps its agentConfirmed and is checked as it always was.
 */
function linkAgentOf(ctx) {
  const c = ctx || {};
  return c.agentConfirmed && c.agentSource !== 'hud' && typeof c.agent === 'string' && c.agent ? c.agent : null;
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

/**
 * Riot's score after round `n`, from the player's side: { team, enemy }, or
 * null when the record cannot say (fewer rounds, a gap, a round with no
 * winner). Riot's rounds are numbered from 1 by the time they reach the client
 * (server/services/riot-rounds.js), so the first n are rounds 1 to n.
 */
function scoreAfter(riot, n) {
  const per = (Array.isArray(riot && riot.perRound) ? riot.perRound : [])
    .filter((r) => r && typeof r.n === 'number').slice().sort((a, b) => a.n - b.n);
  if (!(n > 0) || per.length < n) return null;
  let team = 0;
  let enemy = 0;
  for (let i = 0; i < n; i++) {
    const r = per[i];
    if (r.n !== i + 1 || typeof r.won !== 'boolean') return null;
    if (r.won) team++;
    else enemy++;
  }
  return { team, enemy };
}

/**
 * ENDED EARLY BY THE WATCH (8.2.1). A recording whose last score is one
 * Riot's round record passes through is that match, and the watch ended it
 * too soon.
 *
 * The real case: 8.0.1 locked swiftplay wrongly on a competitive Split match
 * (scripts/fixtures/valorant-session-split-competitive.json is that session)
 * and ended it at 3 to 5 in round 9, which is a swiftplay final. Riot's record
 * has it 13 to 7 over 20 rounds, and after round 8 it stood at exactly 3 to 5.
 * verifyCoachedMatch() refused it on every try (a match seen ending after 8
 * rounds is not a 20 round one), the backfill left both alone, and the review
 * said "Defeat 3-5, Swiftplay" from what the screen read, for good.
 *
 * So the score the watch ended on may disagree with Riot's final, and the mode
 * with Riot's queue, only when all of this holds:
 *
 *   the map     the same on both sides, never merely unknown on one
 *   the agent   Riot's, when the recording's agent was confirmed by the
 *               player; one never confirmed, or one the screen found by
 *               itself (linkAgentOf), agrees with anything, the rule the link
 *               keeps
 *   the end     the moment the watch ended the match lies inside Riot's own
 *               span, its start to its start plus its length, with the clock
 *               allowance either side. That is what an early end is: Riot's
 *               match still being played while the watch called it over.
 *   the score   the screen's last score, team against enemy from the player's
 *               side, is Riot's score after round team + enemy, and Riot's
 *               record has more rounds than that
 *
 * The recording's START is not held to Riot's span. It is when Start was
 * pressed or the match before ended, minutes before Riot's start in the
 * normal order of a session (the menus, a queue, agent select), and a review
 * saved before the ledger has only an estimate of it. The end is exact, and
 * the backfill's claims (backfill.js claimsOf) already weigh the whole window.
 *
 * Everything else the link refuses stays refused: a match with no rounds, one
 * that was over before the recording or started after it, another map or
 * another agent, fewer rounds than the coach watched. A match already linked
 * to another review and a match on another account are refused before this is
 * asked (pickCoachedMatch's exclude, the backfill's plan, Riot answering for
 * the Riot ID in Settings only).
 *
 * @param lm         the listed match: { startedAt, map, agent, mode, score }
 * @param riot       Riot's round record of it, the /match-rounds reply:
 *                   { map, me: { agent }, startedAt, lengthMs, perRound: [{ n, won }] }
 * @param startedAt  when the recording started
 * @param endedAt    when the watch ended the match
 * @param mctx       { map, agent (linkAgentOf's only), score: { team, enemy, final } }
 * @returns { ok: true } | { ok: false, why: string }
 */
function endedEarly(lm, riot, startedAt, endedAt, mctx) {
  const ours = mctx && mctx.score;
  if (!ours || !ours.final) return { ok: false, why: 'the watch did not end the match on a score' };
  if (!riot || !Array.isArray(riot.perRound)) return { ok: false, why: 'no round record from Riot' };
  // Every check the link makes but the final score's.
  const base = verifyCoachedMatch(lm, startedAt, endedAt, { ...mctx, score: { ...ours, final: false } });
  if (!base.ok) return base;
  const map = riot.map || (lm && lm.map) || null;
  if (!mctx.map || !map) return { ok: false, why: 'no map on both sides to confirm an early end with' };
  if (!sameName(mctx.map, map)) return { ok: false, why: `map mismatch (coached ${mctx.map}, match ${map})` };
  const agent = (riot.me && riot.me.agent) || (lm && lm.agent) || null;
  if (mctx.agent && agent && !sameName(mctx.agent, agent)) {
    return { ok: false, why: `agent mismatch (coached ${mctx.agent}, match ${agent})` };
  }
  const start = typeof riot.startedAt === 'number' && riot.startedAt > 0 ? riot.startedAt : (lm && lm.startedAt) || 0;
  const rounds = riot.perRound.length;
  const len = typeof riot.lengthMs === 'number' && riot.lengthMs > 0 ? riot.lengthMs : rounds * ROUND_MS;
  if (!(start > 0) || !(len > 0)) return { ok: false, why: "Riot's record has no start or length" };
  if (!(endedAt >= start - CLOCK_SLACK_MS && endedAt <= start + len + CLOCK_SLACK_MS)) {
    return { ok: false, why: 'the watch ended it outside the time Riot says the match was played' };
  }
  const team = ours.team | 0;
  const enemy = ours.enemy | 0;
  const n = team + enemy;
  if (!(n > 0) || rounds <= n) return { ok: false, why: `Riot's record does not go on past round ${n}` };
  // AN END AFTER n ROUNDS CANNOT COME BEFORE n ROUNDS WERE PLAYED. Without
  // this, a recording that ended its own match at 5-4, unlisted, was upgraded
  // as the NEXT match on the same map, started a minute after it ended, which
  // stood at 5-4 after round 9: the seam between back to back matches is not
  // a claim. No round is shorter than MIN_ROUND_MS (a buy phase, a wipe, the
  // round's end); the real Split end came 929 s into its match at round 8.
  if (endedAt < start + n * MIN_ROUND_MS - CLOCK_SLACK_MS) {
    return { ok: false, why: `the watch ended it ${Math.round((endedAt - start) / 1000)} s into the match, too soon for ${n} rounds` };
  }
  const after = scoreAfter(riot, n);
  if (!after || after.team !== team || after.enemy !== enemy) {
    return { ok: false, why: `Riot's record never stood at ${team}-${enemy} after round ${n}` };
  }
  return { ok: true };
}

// How far past its estimated end (100 seconds a round) a listed match may
// still be running, for asking for its record at all: the timelines measure
// 83 to 103 seconds a round, and Riot's start may be agent select's.
const EARLY_ESTIMATE_SLACK_MS = 5 * 60 * 1000;

/**
 * The listed matches an early end may be tried on, for the live link: the
 * newest and the few before it that pass every check but the final score's,
 * on the screen's own map, never one another review holds, and whose own
 * estimated span could hold the moment the watch ended (the match before it
 * on the same map cannot, and costs no request). Only when the watch ended
 * the match on a score, since any other end is not refused for its score in
 * the first place. Riot's round record of each is what decides (endedEarly),
 * on its real span, and the list only says which records are worth asking for.
 */
function earlyCandidates(lm, startedAt, endedAt, mctx) {
  const ours = mctx && mctx.score;
  if (!ours || !ours.final || !mctx.map) return [];
  const taken = new Set((mctx && mctx.exclude) || []);
  const seen = new Set();
  const loose = { ...mctx, score: { ...ours, final: false } };
  const out = [];
  for (const m of [lm, ...(lm && Array.isArray(lm.recent) ? lm.recent : [])]) {
    if (!m || !m.matchId || seen.has(m.matchId) || taken.has(m.matchId)) continue;
    seen.add(m.matchId);
    if (!m.map || !sameName(m.map, mctx.map)) continue;
    const end = matchEndEstimate(m);
    if (end != null && !(endedAt >= m.startedAt - CLOCK_SLACK_MS && endedAt <= end + EARLY_ESTIMATE_SLACK_MS)) continue;
    if (verifyCoachedMatch(m, startedAt, endedAt, loose).ok) out.push(m);
  }
  return out;
}

// The round records one try of the live link asks for at most. Each can wait
// out its timeout, and a score end that may go on tries for as long as a stop
// does (linkRetries), so a record for every listed match on every try held a
// review's frames past the AI log's hold (test:valorantreview). One that
// refused is not asked for again, so the next try reaches the ones after it.
const EARLY_ASKS_PER_TRY = 2;

/**
 * The live link's early end: each candidate's round record asked for, and the
 * first that passes endedEarly() is the match, handed back with the record so
 * it is not fetched twice. A record that answered and refused is remembered in
 * `refused` (a matchId set the caller keeps per review), because a finished
 * match's record never changes and the link tries again for minutes; one that
 * failed to arrive is asked for again on the next try. EARLY_ASKS_PER_TRY at
 * most, newest first.
 *
 * @param roundsOf  async (match) => Riot's round record, or null
 * @returns { match, riot } | null
 */
async function linkEarly(lm, startedAt, endedAt, mctx, roundsOf, refused) {
  let asked = 0;
  for (const m of earlyCandidates(lm, startedAt, endedAt, mctx)) {
    if (refused && refused.has(m.matchId)) continue;
    if (asked >= EARLY_ASKS_PER_TRY) break;
    asked++;
    let riot = null;
    try { riot = await roundsOf(m); } catch { riot = null; }
    if (!riot) continue;
    if (endedEarly(m, riot, startedAt, endedAt, mctx).ok) return { match: m, riot };
    if (refused) refused.add(m.matchId);
  }
  return null;
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
 * it ends. A match recording was stopped in, one the next match began over,
 * or one the watch ended on a score a standard match goes on from (mayGoOn),
 * may still have been being played, so its review tries for longer
 * (linkRetries). Once the scoreboard links, Riot's round record can still fail
 * on its own (a rate limit, a slow publish), so it gets tries of its own.
 *
 * The AI log holds the match's frames for the whole of it, the look at the
 * deaths after it included (ai-log-store.js HOLD_MAX_MS), and
 * test:valorantreview fails the day these outgrow that hold.
 */
const LINK_RETRY_MS = [90000, 240000, 480000];
const LINK_RETRY_LONG_MS = [90000, 240000, 600000, 1200000];
const RIOT_ROUNDS_RETRY_MS = [120000, 300000];

/**
 * A SCORE END A STANDARD MATCH GOES ON FROM (8.2.1): the watch ended the
 * match on 5 to 3, 3 to 5 or another score only swiftplay finishes on. When
 * the swiftplay lock was wrong, as on the real Split match, the match went on
 * for eight rounds or more: at the fastest pace measured (83 seconds a round)
 * and Riot's quickest publish, its record exists twelve and a half minutes
 * after the watch's end at the soonest, about when a score end's last try is
 * made (LINK_RETRY_MS), and the real Split match's only after nearly twenty
 * (scripts/fixtures/riot-split-13-7.json, published 90 seconds on). So its
 * review tries for as long as a stop's, and when even that gives up, it says
 * the match may have gone on, never that it was played on another account
 * (index.js linkRiotRecord).
 *
 * @param score  { team, enemy, final } as the link reads the screen's last score
 */
function mayGoOn(score) {
  return !!(score && score.final) && !isFinalScore(score.team | 0, score.enemy | 0, 'standard');
}

/** The gaps between a review's link tries: the long ones for a match that may still have been played. */
function linkRetries(endedBy, score) {
  return endedBy === 'stop' || endedBy === 'next-match' || (endedBy === 'score' && mayGoOn(score))
    ? LINK_RETRY_LONG_MS : LINK_RETRY_MS;
}

module.exports = {
  verifyCoachedMatch, pickCoachedMatch, matchSummary, sameName, linkAgentOf,
  matchEndEstimate, roundsPlayed, scoreAfter, endedEarly, earlyCandidates, linkEarly, mayGoOn, linkRetries,
  MATCH_LINK_LEAD_MS, MATCH_LINK_TRAIL_MS, ROUND_MS, CLOCK_SLACK_MS, MIN_ROUND_MS, EARLY_ASKS_PER_TRY,
  LINK_RETRY_MS, LINK_RETRY_LONG_MS, RIOT_ROUNDS_RETRY_MS,
};
