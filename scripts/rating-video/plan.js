'use strict';

/**
 * THE RATING VIDEO'S PLAN (docs/claude/rating.md "The video tool"): what the
 * badge says when. The events (from the video, a hand corrected file or Riot's
 * record of one of the owner's reviews) go through the match rating's own
 * engine (src/shared/rating.js) in order, and every move of the player's
 * value becomes a step: { t, value, shown, tier, delta, label }. The label is
 * the live rating's own, short and without the numbers standing
 * (live-rating-service.js liveLabel). Pure: no ffmpeg, no files.
 */

const rating = require('../../src/shared/rating');
const { liveLabel } = require('../../src/main/services/live-rating-service');

function step(t, out, kind) {
  return { t, kind, value: out.value, shown: rating.Display.rating(out.value), tier: rating.tierOf(out.value), delta: out.delta ? rating.signed(out.delta) : '', up: rating.Display.moveWay(rating.signed(out.delta)) === 'up', down: rating.Display.moveWay(rating.signed(out.delta)) === 'down', label: liveLabel(out.label) };
}

/**
 * The plan from a video's event list (events.js: t in seconds of the video).
 * A kill before any round opens the first one (o.startRound) where it is.
 */
function planOf(events, opts) {
  const o = opts || {};
  const r = rating.createRating({ subject: 'me', queue: o.mode || null, meAgent: o.agent || null });
  const steps = [];
  let round = null;
  let roundT = 0;
  let seq = 0;
  let next = Number.isInteger(o.startRound) && o.startRound > 0 ? o.startRound : 1;
  const open = (t, n, side) => {
    round = n; roundT = t; next = n + 1;
    r.push({ kind: 'round', id: `v${seq++}`, round, side: side || null });
  };
  for (const e of events) {
    if (e.kind === 'round') { open(e.t, Number.isInteger(e.round) ? e.round : next, e.side); continue; }
    if (round === null) open(e.t, next, null);
    const ms = Math.max(0, Math.round((e.t - roundT) * 1000));
    let ev = null;
    if (e.kind === 'kill') ev = { kind: 'kill', round, ms, killer: e.killer, victim: e.victim, ...(e.assists ? { assists: e.assists } : {}) };
    else if (e.kind === 'plant' || e.kind === 'defuse') ev = { kind: e.kind, round, ms, by: e.by || null };
    else if (e.kind === 'end') ev = { kind: 'end', round, won: typeof e.won === 'boolean' ? e.won : null };
    if (!ev) continue;
    const out = r.push({ ...ev, id: `v${seq++}` });
    if (out && !out.ignored && out.label) steps.push(step(e.t, out, e.kind));
  }
  return { start: rating.D.START, steps, final: r.value() };
}

/**
 * THE PLAN FROM RIOT'S RECORD of one of the owner's reviews, exact: every
 * round's events as the review's own rating counts them (assists, plants and
 * results included), laid on the video by one offset a round:
 *   offsets   Map(round -> seconds of the video at the round's ms 0)
 * Rounds with no offset still count (the value the video opens on), and only
 * the moves between 0 and o.duration are steps.
 */
function planOfRecord(review, offsets, opts) {
  const o = opts || {};
  const rounds = rating.roundsOfReview(review);
  const g = review && review.game && typeof review.game === 'object' ? review.game : {};
  const r = rating.createRating({ subject: 'me', queue: typeof g.mode === 'string' ? g.mode : null, meAgent: typeof g.agent === 'string' ? g.agent : null });
  const steps = [];
  let start = rating.D.START;
  let seq = 0;
  const firstShown = Math.min(...[...offsets.keys()]);
  for (const round of rounds) {
    const evs = rating.eventsOfRound(round);
    if (!evs) continue;
    const off = offsets.has(round.n) ? offsets.get(round.n) : null;
    for (const e of evs) {
      const out = r.push({ ...e, id: `r${seq++}` });
      if (!out || out.ignored) continue;
      const t = off !== null && Number.isFinite(e.ms) ? off + e.ms / 1000 : null;
      if (t !== null && t >= 0 && (!Number.isFinite(o.duration) || t <= o.duration)) {
        if (out.label) steps.push(step(Math.round(t * 100) / 100, out, e.kind));
      } else if (round.n < firstShown || (t !== null && t < 0)) {
        start = out.value;
      }
    }
  }
  steps.sort((a, b) => a.t - b.t);
  const last = steps.length ? steps[steps.length - 1].value : start;
  return { start, steps, final: last };
}

/**
 * One offset a round by matching the kills read off the video to the
 * record's: the offset that puts the most record kills within TOL_S of a read
 * kill of the same two teams wins, and needs two (or the round's only kill).
 * detected: [{ t, killer, victim }] with me/us/them; answers Map(round -> offset).
 */
const TOL_S = 0.8;
function alignRounds(review, detected) {
  const team = (k) => (k === 'me' || k === 'mate' || k === 'us' ? 'us' : k === 'enemy' || k === 'them' ? 'them' : null);
  const out = new Map();
  let floor = -Infinity;
  for (const round of rating.roundsOfReview(review)) {
    const feed = Array.isArray(round.feed) ? round.feed.filter((k) => k && Number.isFinite(k.ms)) : [];
    if (!feed.length) continue;
    let best = null;
    for (const k of feed) {
      for (const d of detected) {
        if (team(k.by) !== team(d.killer) || team(k.on) !== team(d.victim)) continue;
        const off = d.t - k.ms / 1000;
        if (off <= floor) continue;
        let hits = 0;
        let err = 0;
        for (const x of feed) {
          const want = off + x.ms / 1000;
          const m = detected.find((y) => team(y.killer) === team(x.by) && team(y.victim) === team(x.on) && Math.abs(y.t - want) <= TOL_S);
          if (m) { hits++; err += Math.abs(m.t - want); }
        }
        if (!best || hits > best.hits || (hits === best.hits && err < best.err)) best = { off, hits, err };
      }
    }
    if (best && best.hits >= Math.min(2, feed.length)) {
      out.set(round.n, Math.round(best.off * 100) / 100);
      floor = best.off;
    }
  }
  return out;
}

module.exports = { planOf, planOfRecord, alignRounds, TOL_S };
