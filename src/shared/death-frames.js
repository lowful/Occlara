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
 * Pure, so the tests run it against a real logged session.
 */

const { clockSeconds, ROUND_SECONDS } = require('./valorant-rounds');

const BEFORE_MS = 10000;
const AFTER_MS = 4000;

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
 * @param death    a reconciled round: { n, deathSec, afterPlant }
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
  // A buy phase frame shows the shop, never the fight, and the score lag files
  // a few of them under the round that follows, so they are passed over.
  const i = round.findIndex((r) => r.died);
  if (i < 0) return [];
  const usable = (r) => r && (r.state || {}).phase !== 'buy';
  const at = round[i];
  const before = round.slice(0, i).reverse().find(usable) || null;
  if (before && usable(at)) return [before, at];
  if (before) return [before];
  return usable(at) ? [at] : [];
}

module.exports = { teachableDeaths, framesFor, secondsIn, BEFORE_MS, AFTER_MS };
