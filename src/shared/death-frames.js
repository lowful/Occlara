'use strict';

/**
 * Which deaths the review looks at, and which frames show them.
 *
 * WHICH DEATHS. Four at most, one call each, so the four that teach the most:
 * a lost round outranks a won one, a first death or an untraded one outranks
 * a traded one, and a death with the team ahead in numbers outranks all of
 * them, because that is a round thrown. Ties are spread across the match, one
 * per third first, for the reason match-review.teachable() gives: asked to
 * choose, the model reviewed the first ten rounds and never reached the second
 * half.
 *
 * WHICH FRAMES. Riot says the player died S seconds after the barriers dropped.
 * The round clock starts at 1:40 when they drop, so a frame reading C seconds
 * left was taken 100 - C seconds in. The frame BEFORE the death is the latest
 * one in that round taken at or before S, no more than ten seconds earlier;
 * the frame AFTER is the first within four seconds past it. The round is the
 * one the ledger filed the frame under, the same ledger that files the deaths,
 * so the two agree about round numbers even where the score read lagged.
 *
 * After the plant the clock is replaced by the spike, so a post-plant death has
 * no clock to match. Those use the frames around the moment the screen
 * registered the death, when it did.
 *
 * WITH ONE EXCEPTION TO THE AGREEMENT. A death registered on the round end
 * banner, which already prints the next score, is filed back into the round
 * that ended, but the log stamps that frame with the round it was filed under,
 * one later. So the registering frame of round N can sit at the very start of
 * round N + 1, before its buy phase. On the real Abyss match that was the post
 * plant deaths of rounds 6 and 24, the spectator trap's usual shape, and both
 * had no look at all.
 *
 * AND THAT FRAME IS ROUND N's ALONE. Sitting in round N + 1, it is also the
 * first died frame that round has, and a post plant death there, which has no
 * clock to match, took it as its own: the look was of the end of round N, and
 * its cause was counted against round N + 1.
 *
 * Pure, so the tests run it against a real logged session.
 */

const { clockSeconds, ROUND_SECONDS, MID_ROUND_LEFT } = require('./valorant-rounds');

const BEFORE_MS = 10000;
const AFTER_MS = 4000;
// How far into the next round a banner death can be registered: the ledger
// files a death back only on the first frames after the score moved.
const BANNER_RECORDS = 3;

// A buy phase frame shows the shop, never the fight, and the score lag files
// a few of them under the round that follows, so they are passed over.
const usable = (r) => r && (r.state || {}).phase !== 'buy';
// Play with a mid round clock, which is what the ledger counts as the new
// round having begun. A death after it is that round's, never filed back.
const inPlay = (r) => {
  const st = (r && r.state) || {};
  const left = clockSeconds(st.clock);
  return (st.phase === 'active' || st.phase === 'postplant') && left !== null && left >= MID_ROUND_LEFT;
};

/**
 * The frame that registered round n's death on the banner of round n + 1: a
 * died frame among the first few of round n + 1, before its buy phase or any
 * play, the frames the ledger files a death back from. Null otherwise.
 */
function bannerDeath(inMatch, n) {
  const next = inMatch.filter((r) => r.round === n + 1);
  const j = next.findIndex((r) => r.died);
  if (j < 0 || j >= BANNER_RECORDS || !usable(next[j])) return null;
  if (next.slice(0, j).some((r) => !usable(r) || inPlay(r))) return null;
  return next[j];
}

/**
 * The round before's banner death, sitting at the start of round n, or null.
 * The round before claims it when it has no died frame of its own, the rule
 * the ledger files a banner death back by, and whether it has one depends on
 * the round before IT, so two banner deaths in a row are each their own.
 */
function borrowedInto(inMatch, n) {
  if (!inMatch.some((r) => r.round === n - 1)) return null;
  return ownDeaths(inMatch, n - 1).length ? null : bannerDeath(inMatch, n - 1);
}

/** Round n's died frames, less the one that belongs to the round before. */
function ownDeaths(inMatch, n) {
  const died = inMatch.filter((r) => r.round === n && r.died);
  if (!died.length) return died;
  const borrowed = borrowedInto(inMatch, n);
  return borrowed ? died.filter((r) => r !== borrowed) : died;
}

/** Up to `limit` verified deaths, most teachable first. */
function teachableDeaths(rounds, limit = 4) {
  const deaths = (rounds || []).filter((r) => r.verified && r.died);
  const score = (r) => (r.result === 'lost' ? 3 : 0) + (r.firstDeath ? 3 : 0)
    + (r.traded === false ? 2 : 0) + (r.early ? 1 : 0)
    + (r.aliveAtDeath && r.aliveAtDeath.mates > r.aliveAtDeath.enemies ? 3 : 0);
  const ranked = deaths.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s || a.r.n - b.r.n);
  const last = Math.max(1, ...deaths.map((r) => r.n));
  const third = (n) => Math.min(2, Math.floor(((n - 1) / last) * 3));
  const out = [];
  for (let t = 0; t < 3 && out.length < limit; t++) {
    const pick = ranked.find((x) => third(x.r.n) === t && !out.includes(x.r));
    if (pick && pick.s > 0) out.push(pick.r);
  }
  for (const x of ranked) {
    if (out.length >= limit) break;
    if (!out.includes(x.r) && x.s > 0) out.push(x.r);
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Seconds into the round a logged frame was taken, from its clock, or null. */
function secondsIn(rec) {
  const st = (rec && rec.state) || {};
  if (st.phase && st.phase !== 'active') return null;
  const left = clockSeconds(st.clock);
  if (left === null || left >= ROUND_SECONDS) return null;
  return ROUND_SECONDS - left;
}

/**
 * The frames around one death.
 *
 * @param records  AI log records: { at, frame, state, round, died }
 * @param death    a reconciled round: { n, deathSec, afterPlant, screenDied },
 *                 or a ledger row, whose died is the screen's own
 * @param window   { from, to } wall clock bounds of the match
 * @returns        [before, after?] records, or [] when nothing shows the moment
 */
function framesFor(records, death, window = {}) {
  const inMatch = (records || []).filter((r) => r && r.frame
    && (!window.from || r.at >= window.from) && (!window.to || r.at <= window.to + 5000));
  const round = inMatch.filter((r) => r.round === death.n);
  if (!round.length) return [];

  if (typeof death.deathSec === 'number' && !death.afterPlant) {
    const s = death.deathSec;
    // A full second of margin first. The clock is read to the second and Riot's
    // time to the millisecond, so a frame stamped the same second as the death
    // is as likely to show the death screen as the fight: the real Abyss round
    // 3 picked a frame 18 seconds in for a death at 19 and got the combat
    // report. The same second is the fallback, not the first choice.
    const pick = (margin) => {
      let before = null;
      for (const r of round) {
        const t = secondsIn(r);
        if (t === null) continue;
        if (t <= s - margin && s - t <= BEFORE_MS / 1000 && (!before || t >= secondsIn(before))) before = r;
      }
      return before;
    };
    const before = pick(2) || pick(0);
    let after = null;
    for (const r of round) {
      const t = secondsIn(r);
      if (t === null) continue;
      if (t > s && t - s <= AFTER_MS / 1000 && (!after || t < secondsIn(after))) after = r;
    }
    if (before) return after ? [before, after] : [before];
  }

  // No clock to match: the frame the screen registered the death on, and the
  // one before it, when the screen saw it at all.
  //
  // The round before's banner death is left out first, as this round's death
  // and as the frame before one.
  const borrowed = borrowedInto(inMatch, death.n);
  let list = round.filter((r) => r !== borrowed);
  let i = list.findIndex((r) => r.died);
  if (i < 0) {
    // The banner case above: a registering frame among the first few of the
    // next round, before that round's buy phase began, is this round's death.
    // The frame before it is then this round's last, never the banner's.
    // ONLY WHEN THE SCREEN FILED A DEATH IN THIS ROUND. A death Riot has and
    // the screen never registered has no registering frame anywhere, and on
    // the real Abyss session round 8 was handed round 9's own death frame.
    const screenDied = typeof death.screenDied === 'boolean' ? death.screenDied : !death.verified && !!death.died;
    if (!screenDied) return [];
    const banner = bannerDeath(inMatch, death.n);
    if (!banner) return [];
    list = list.concat([banner]);
    i = list.length - 1;
  }
  const at = list[i];
  const before = list.slice(0, i).reverse().find(usable) || null;
  if (before && usable(at)) return [before, at];
  if (before) return [before];
  return usable(at) ? [at] : [];
}

module.exports = { teachableDeaths, framesFor, secondsIn, BEFORE_MS, AFTER_MS };
