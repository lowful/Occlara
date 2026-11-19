'use strict';

/**
 * A DEATH THE PLAYER FLAGGED (8.13): which death each press of the flag key
 * meant. Pure, so main and test:deathflags read one rule.
 *
 * A PRESS MEANS THE LATEST DEATH BEFORE IT, up to the moment the next round's
 * barriers drop: a player presses while dead, while the round plays out, or in
 * the next buy phase. Once they are back in play a press means nothing, and is
 * said to be so on the review. It never makes a death: the deaths come from
 * Riot's record and the screen's read (death-frames.js flagDeaths).
 *
 * Every press is kept as its wall clock time until the review has its deaths,
 * and is read again when Riot's record replaces the screen's: a flag follows
 * the death, and one Riot says never happened stays, marked (`noDeath`), with
 * the clip the player asked to keep.
 */

const MAX_FLAGS = 6;
// A held key repeats, and a double tap is one press.
const PRESS_GAP_MS = 400;
// The clock is read a moment apart from the key: a press this far before a
// death's start is still that death.
const GRACE_MS = 1500;

/** The list with this press on it; a repeat of the last press is dropped. */
function addPress(list, at) {
  const xs = Array.isArray(list) ? list : [];
  if (!Number.isFinite(at)) return xs;
  const last = xs[xs.length - 1];
  return Number.isFinite(last) && at - last < PRESS_GAP_MS ? xs : [...xs, Math.round(at)];
}

/** The presses that fall inside one match. */
function pressesIn(list, from, to) {
  return (Array.isArray(list) ? list : []).filter((at) => Number.isFinite(at)
    && (!Number.isFinite(from) || at >= from) && (!Number.isFinite(to) || at <= to));
}

/**
 * @param presses  wall clock ms
 * @param deaths   [{ n, start, until }]: when the death could first have
 *                 happened, and when a press stops meaning it
 * @returns { rounds: [{ n, presses }], unmatched: [at], over: [at] }, rounds in
 *          round order: `over` the presses on deaths past the first MAX_FLAGS
 */
function resolve(presses, deaths) {
  const list = (Array.isArray(deaths) ? deaths : [])
    .filter((d) => d && Number.isInteger(d.n) && Number.isFinite(d.start) && Number.isFinite(d.until))
    .slice().sort((a, b) => a.start - b.start);
  const rounds = new Map();
  const unmatched = [];
  const over = [];
  for (const at of (Array.isArray(presses) ? presses : []).filter(Number.isFinite).slice().sort((a, b) => a - b)) {
    let hit = null;
    for (const d of list) if (d.start - GRACE_MS <= at && at <= d.until) hit = d;
    if (!hit) { unmatched.push(at); continue; }
    if (!rounds.has(hit.n) && rounds.size >= MAX_FLAGS) { over.push(at); continue; }
    if (!rounds.has(hit.n)) rounds.set(hit.n, { n: hit.n, presses: [] });
    rounds.get(hit.n).presses.push(at);
  }
  return { rounds: [...rounds.values()].sort((a, b) => a.n - b.n), unmatched, over };
}

/**
 * This reading of the presses over the one before. A round flagged again keeps
 * the clip it has. A round flagged before whose presses now match no death is
 * kept, marked noDeath: Riot's record says that death never happened.
 */
function merge(prev, next) {
  const before = prev && Array.isArray(prev.rounds) ? prev.rounds : [];
  const rounds = next.rounds.map((r) => {
    const old = before.find((b) => b.n === r.n);
    return { ...(old ? { clip: old.clip, clipDeath: old.clipDeath, target: old.target } : {}), n: r.n, presses: r.presses };
  });
  let unmatched = next.unmatched.slice();
  for (const old of before) {
    if (rounds.length >= MAX_FLAGS || rounds.some((r) => r.n === old.n)) continue;
    if (!old.presses.every((at) => unmatched.includes(at))) continue;
    unmatched = unmatched.filter((at) => !old.presses.includes(at));
    rounds.push({ ...old, noDeath: true });
  }
  return { rounds: rounds.sort((a, b) => a.n - b.n), unmatched, over: next.over.slice() };
}

/** Every clip the flags hold. */
function clipNames(flags) {
  return ((flags && flags.rounds) || []).map((r) => r && r.clip).filter((c) => typeof c === 'string' && c);
}

/**
 * What a review keeps of them: no press times, only what its page says. Null
 * for a match with nothing to say, so every other review is saved as it was.
 */
function view(flags, keyFailed) {
  const f = flags || { rounds: [], unmatched: [], over: [] };
  const rounds = f.rounds.map((r) => ({ n: r.n,
    ...(r.clip ? { clip: r.clip, clipDeath: Number.isFinite(r.clipDeath) ? r.clipDeath : null } : {}),
    ...(r.noDeath ? { noDeath: true } : {}) }));
  if (!rounds.length && !f.unmatched.length && !f.over.length && !keyFailed) return null;
  return { rounds, unmatched: f.unmatched.length, over: f.over.length, ...(keyFailed ? { keyFailed: true } : {}) };
}

module.exports = { MAX_FLAGS, PRESS_GAP_MS, GRACE_MS, addPress, pressesIn, resolve, merge, clipNames, view };
