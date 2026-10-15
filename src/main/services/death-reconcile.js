'use strict';

/**
 * Checking the deaths the coach read off the screen against the ones Riot
 * recorded.
 *
 * The screen-reading detector is good but not exact. Measured across five real
 * sessions against the tracker it missed 3 deaths in one, 2 in another, and
 * invented 1 in a third. Riot's match detail knows precisely: which round each
 * death happened in, who did it, and with what.
 *
 * The hard part is not comparing the two numbers, it is knowing WHICH deaths the
 * session could possibly have seen. Coaching rarely covers a whole match: one
 * real session ran for nine frames at the start of an eighteen round game, and
 * the player's first death was in round 5. Comparing 0 detected against 11 in
 * the match would call that a catastrophic miss when the detector was perfectly
 * correct. So the comparison is always against the deaths inside the rounds the
 * session actually watched.
 *
 * ROUND BY ROUND, AND IN THE REVIEW'S OWN WORDS (8.4.1), where the deaths are
 * the engine's (ai-log-timeline.js engineDeaths): each carries the round its
 * ledger filed it under, so it is checked as the review checks its ledger
 * (valorant-verify.js reconcile), and said with that check's own sentence
 * (describe). On the player's Fracture swiftplay the log said "Riot recorded
 * 3 deaths, the coach marked 6, so 3 is not real." beside a review saying
 * "the screen read 4 deaths and Riot has 3, with none in round 1": its own
 * count, and an English no reader could parse. A log from before 8.0 has no
 * ledger round, and neither does a session of several matches, each counting
 * its own from 1: those are checked by their counts, as they always were, and
 * said in the same words.
 *
 * A pair's weapon is a name or none, as wherever Riot's record enters the
 * client (valorant-verify.js weaponName): a server from before 8.4.1 sent the
 * type for a kill with no name, and the log's round 6 mark said "killed by
 * Chamber with a Weapon". And its killer is an agent or none (agentName): the
 * server names the killer by agent since 8.4.1 (coach.js killerAgentOf), and
 * one from before sends the killer's full Riot ID, or a puuid, which the log
 * painted on every death Riot confirmed.
 */
const { describe, weaponName, agentName } = require('../../shared/valorant-verify');

// The round the session was watching is derived from the scoreboard, and that
// read lags: three deaths verified against their screenshots all carried a score
// one round behind what the screenshot showed. So the window is widened by this
// much at each end before anything is called missing.
const ROUND_SLACK = 1;

/** The span of rounds a session covered, from the scores it managed to read. */
function roundsCovered(records) {
  let lo = null, hi = null;
  for (const r of (Array.isArray(records) ? records : [])) {
    const s = r.state || {};
    if (typeof s.teamScore !== 'number' || typeof s.enemyScore !== 'number') continue;
    const round = s.teamScore + s.enemyScore + 1;
    if (lo == null || round < lo) lo = round;
    if (hi == null || round > hi) hi = round;
  }
  if (lo == null) return null;
  return { from: Math.max(1, lo - ROUND_SLACK), to: hi + ROUND_SLACK };
}

/**
 * The match and the round each record of a log the engine wrote is filed
 * under, one { match, round } a record (8.4.1). Every record since 8.0 carries
 * the round its ledger filed it under (`round`) and the match's stamp
 * (`match`). One that carries no round was read after the watch ended a match,
 * the next ledger not begun: it is the ended match's, in the round its own
 * score says, where that ledger files it if the match resumes
 * (coaching-engine.js resumeMatch), and with no score read, the round before
 * it. The player's 8.0.1 Split session is the case: ended at 3 to 5 in round
 * 9, it read on to 12 to 7 under no round, and the engine registered 15 deaths
 * there, in rounds 10 to 20 by their scores: filed under the round before
 * them, every one was round 9's, which had its death already. The one rule the
 * log's deaths (ai-log-timeline.js engineDeaths) and the rounds Riot's check
 * covers (ledgerRounds) go by.
 */
function filedRounds(records) {
  const out = [];
  let match = null;
  let round = null;
  for (const x of (Array.isArray(records) ? records : [])) {
    const r = x || {};
    const s = r.state || {};
    if (typeof r.round === 'number' && Number.isFinite(r.round)) {
      round = r.round;
      match = r.match === undefined ? null : r.match;
    } else {
      if (round === null) match = r.match === undefined ? null : r.match;
      if (typeof s.teamScore === 'number' && typeof s.enemyScore === 'number') round = s.teamScore + s.enemyScore + 1;
    }
    out.push({ match, round });
  }
  return out;
}

/**
 * The rounds the records were filed under (filedRounds), { from, to }, when
 * they are one match's. Null for a log from before 8.0, which carries no round,
 * and for a session of several matches. No slack: the ledger has worked the
 * score's lag out already.
 */
function ledgerRounds(records) {
  const recs = Array.isArray(records) ? records : [];
  if (!recs.some((r) => r && typeof r.round === 'number' && Number.isFinite(r.round))) return null;
  let lo = null;
  let hi = null;
  const matches = new Set();
  for (const f of filedRounds(recs)) {
    if (f.round === null) continue;
    matches.add(f.match);
    if (lo === null || f.round < lo) lo = f.round;
    if (hi === null || f.round > hi) hi = f.round;
  }
  return lo === null || matches.size !== 1 ? null : { from: lo, to: hi };
}

/**
 * The engine's deaths against Riot's, round by round over the rounds its
 * ledger filed (`span`), as valorant-verify.js reconcile() checks the review's
 * ledger: `checks` is that check's own shape, so describe() says it in the
 * review's words. Each death in a round Riot has one in is paired with it, by
 * its frame (`at`), and each in a round Riot has none in is `refuted`. Never
 * timed: the review also counts a death the screen read well before Riot's
 * among those it invented (earlyBy), from Riot's plant and its round's clock,
 * and the deaths Riot's check here is sent carry no plant (a post plant death
 * cannot be timed without one, death-frames.js deathMoment).
 */
function byRound(mine, tracker, theirs, span) {
  const total = Number.isFinite(tracker.rounds) && tracker.rounds > 0 ? tracker.rounds : null;
  const riot = new Map();
  for (const d of theirs) {
    if (d && Number.isFinite(d.round) && d.round >= span.from && d.round <= span.to && !riot.has(d.round)) riot.set(d.round, d);
  }
  let watched = 0;
  for (let n = Math.max(1, span.from); n <= span.to; n++) if (total === null || n <= total) watched++;
  const pairs = [];
  const refuted = [];
  const screen = new Set();
  for (const d of mine) {
    screen.add(d.round);
    const r = riot.get(d.round);
    if (r) pairs.push({ at: d.at, round: d.round, killer: agentName(r.killer), weapon: weaponName(r.weapon) });
    else refuted.push({ at: d.at, round: d.round });
  }
  const invented = refuted.map((x) => x.round).sort((a, b) => a - b);
  const missed = [...riot.keys()].filter((n) => !screen.has(n)).sort((a, b) => a - b);
  const checks = {
    watched, screenDeaths: mine.length, riotDeaths: riot.size, agreed: pairs.length,
    invented, early: [], missed, readsDropped: 0,
    roundsAdded: total === null ? 0 : Math.max(0, total - watched),
  };
  return {
    status: invented.length ? 'overcounted' : missed.length ? 'missed' : 'agrees',
    byRound: true,
    detected: mine.length,
    expected: riot.size,
    matchTotal: theirs.length,
    matchRounds: total,
    covered: span,
    partial: !!(total && (span.from > 1 || span.to < total)),
    pairs,
    refuted,
    invented,
    missed,
    checks,
    rounds: [...riot.keys()].sort((a, b) => a - b),
  };
}

/**
 * Compare what the coach saw with what Riot recorded.
 *
 * @param detected  deaths from the frames, as ai-log-timeline produces them
 * @param tracker   { total, rounds, deaths: [{ round, killer, weapon, atMs }] }
 * @param records   the session's frames, for working out the rounds covered
 */
function reconcile(detected, tracker, records) {
  const mine = Array.isArray(detected) ? detected : [];
  const theirs = (tracker && Array.isArray(tracker.deaths)) ? tracker.deaths : null;
  if (!theirs) return { status: 'unavailable', detected: mine.length };

  // The engine's deaths, each in its ledger's round, of one match: round by round.
  const ledger = mine.every((d) => d && d.registered === true && Number.isFinite(d.round)) ? ledgerRounds(records) : null;
  if (ledger) return byRound(mine, tracker, theirs, ledger);

  const span = roundsCovered(records);
  // Without a readable scoreboard anywhere there is no way to say which part of
  // the match this was, so the whole match is the window and the verdict says so.
  const inWindow = span
    ? theirs.filter((d) => d.round == null || (d.round >= span.from && d.round <= span.to))
    : theirs;

  const expected = inWindow.length;
  const found = mine.length;
  const status = found === expected ? 'agrees' : (found < expected ? 'missed' : 'overcounted');

  return {
    status,
    detected: found,
    expected,
    matchTotal: theirs.length,
    matchRounds: tracker.rounds || null,
    covered: span,
    partial: !!(span && tracker.rounds && (span.from > 1 || span.to < tracker.rounds)),
    // Paired in order ONLY when the counts agree. Forcing a pairing across a
    // mismatch would attach the wrong killer to the wrong moment, which reads as
    // confident detail and is worse than leaving it off.
    pairs: status === 'agrees'
      ? mine.map((d, i) => ({ at: d.at, round: inWindow[i].round, killer: agentName(inWindow[i].killer), weapon: weaponName(inWindow[i].weapon) }))
      : [],
    // The rounds Riot says had a death, so the interface can name them even when
    // the counts disagree and no pairing is possible.
    rounds: inWindow.map((d) => d.round).filter((r) => r != null),
  };
}

const deathsText = (n) => (n === 0 ? 'no deaths' : n === 1 ? '1 death' : `${n} deaths`);

/**
 * One line a person can read, for the log header: the review's own sentence
 * for a check made round by round (valorant-verify.js describe), and for one
 * made by counts the same words with no round named, since a count cannot say
 * which.
 */
function summarise(rec) {
  if (!rec || rec.status === 'unavailable') return '';
  if (rec.checks) return describe(rec.checks) || '';
  const scope = rec.partial && rec.covered ? `rounds ${rec.covered.from} to ${rec.covered.to}` : 'the match';
  const S = Number(rec.detected) || 0;
  const R = Number(rec.expected) || 0;
  const said = S === 0 && R === 0 ? 'the screen read no deaths, and Riot has none either'
    : S === 0 ? `the screen read no deaths and Riot has ${R}`
      : R === 0 ? `the screen read ${deathsText(S)}, and Riot has none`
        : `the screen read ${deathsText(S)} and Riot has ${R}`;
  return `Checked against Riot's record of ${scope}: ${said}.`;
}

/**
 * A cache that remembers answers and forgets failures.
 *
 * Confirmed results never change, so they are kept for the life of the process
 * and reopening the log costs nothing against a strict tracker rate limit.
 * Failures must expire, and that difference is the whole point: the tracker
 * takes a minute or two to index a match after it ends, and the session a player
 * opens first is the one they just played. Remembering "no match lines up"
 * forever meant checking once, seconds too early, then never again, so the
 * confirmation silently never arrived for the game they actually cared about.
 */
function makeCheckCache(ttlMs, now = () => Date.now()) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.rec.status !== 'unavailable') return hit.rec;   // settled
      if (now() - hit.at < ttlMs) return hit.rec;             // too soon to retry
      map.delete(key);
      return null;
    },
    remember(key, rec) { map.set(key, { at: now(), rec }); return rec; },
    get size() { return map.size; },
  };
}

module.exports = { reconcile, summarise, roundsCovered, ledgerRounds, filedRounds, makeCheckCache, ROUND_SLACK };
