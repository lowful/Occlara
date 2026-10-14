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
 * registered the death, when it did, and say nothing of Riot's second against
 * them (lookAt's gap): the clock on those frames is not the round's.
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
 * AND A REVIEW RIOT'S RECORD NEVER REACHED LOOKS TOO (8.2). It has no death
 * second at all, so every one of its deaths takes the path a post plant death
 * takes above: the frame the screen registered the death on, and the one
 * before it. Which deaths, and why fewer things rank them, is
 * teachableScreenDeaths below.
 *
 * WHEN RIOT'S DEATH WAS ON THE WALL CLOCK (8.3.1), and the frames by it. The
 * rule above read one frame's clock against Riot's second, rounded, and on the
 * real Sunset match every look missed the fight: round 2's two frames were
 * both after its death (a post plant death, framed the screen's way), and
 * round 6's "after" frame was taken 0.12 s BEFORE it, the player alive. A
 * round's clock is on every frame of its play, so the moment its barriers
 * dropped is read off all of them together (barrierDrop), and Riot's death is
 * that moment plus Riot's own milliseconds (deathMoment), after the plant as
 * before it. Then the frame before the death is the last one taken at least
 * FRAME_MARGIN_MS before it, and the frame after is the first one past it,
 * whatever each shows: on that match, picked by the deaths its clips show,
 * those were 0.12 to 0.38 s before each death and 0.7 to 1.6 s after it, the
 * fight and then KILLED BY. A round with no clocked frame of its own keeps
 * the rule above.
 *
 * Pure, so the tests run it against a real logged session.
 */

const { clockSeconds, ROUND_SECONDS, MID_ROUND_LEFT, BUY_MAX_LEFT } = require('./valorant-rounds');

const BEFORE_MS = 10000;
const AFTER_MS = 4000;
// The frame before the death is at least this far before it. Riot's moment is
// good to a few tenths (barrierDrop), and the frame in the same tenth as the
// death shows the death as often as the fight.
const FRAME_MARGIN_MS = 300;
// The frame after it is within this of it. The clock rule's four seconds were
// read off a clock to the second, and reached five.
const AFTER_WALL_MS = 5000;
// How far a frame's capture may sit from the second its clock says, either
// way. Its capture time is good to about this: on the real Sunset match the
// AI log's frames matched the recording's to within 25 ms, and round 2's 24
// spans missed one another by 10 ms where its clock stepped from 1:33 to 1:31
// between two frames a second apart.
const CLOCK_SLACK_MS = 25;
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

/**
 * The `limit` best of `deaths` by `score`: the best of each third of the match
 * first, then the best of the rest, in round order. A death that scores
 * nothing is never chosen.
 */
function spread(deaths, score, limit) {
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

/** Up to `limit` verified deaths, most teachable first. */
function teachableDeaths(rounds, limit = 4) {
  const deaths = (rounds || []).filter((r) => r.verified && r.died);
  const score = (r) => (r.result === 'lost' ? 3 : 0) + (r.firstDeath ? 3 : 0)
    + (r.traded === false ? 2 : 0) + (r.early ? 1 : 0)
    + (r.aliveAtDeath && r.aliveAtDeath.mates > r.aliveAtDeath.enemies ? 3 : 0);
  return spread(deaths, score, limit);
}

/**
 * Up to `limit` deaths the screen saw and Riot never checked, most teachable
 * first (8.2), spread across the match the same way.
 *
 * The screen knows less about each one than Riot does: no first death, no
 * trade, nobody's numbers standing. So two things rank it, a lost round and a
 * death early in the round (the ledger's own early, read off the round
 * clock), and every death starts from one, so a match whose only deaths came
 * in rounds that were won still has a moment to show.
 */
function teachableScreenDeaths(rows, limit = 4) {
  const deaths = (rows || []).filter((r) => r && r.died && !r.verified);
  const score = (r) => 1 + (r.result === 'lost' ? 3 : 0) + (r.early ? 1 : 0);
  return spread(deaths, score, limit);
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
 * When round n's barriers dropped, on the wall clock (ms): { at, frames, of },
 * the moment, how many clocked frames agree on it and how many there were. Or
 * null.
 *
 * Every frame of the round that shows its clock says when, to within a second.
 * The HUD shows the seconds left rounded down (0:00 is on screen for a whole
 * second at the end of every buy phase, and 1:40 never), so a frame reading S
 * seconds left was taken between 99 - S and 100 - S seconds after the drop:
 * each frame is a one second span the drop lies in, and the drop is where the
 * most of them meet.
 *
 * Only the round clock counts: more than a buy phase's 45 seconds left, and
 * never after the plant, when the spike replaces the clock and a read carries
 * the clock of a read before it (on the real Abyss session, read every ten
 * seconds, rounds 6 and 16 read 1:20 and 1:23 on frames taken after the
 * death). A dead player's frames count: the clock is the round's, whichever
 * teammate the camera is on. `opts.before` leaves out the frames from then on
 * (Riot's plant, deathMoment).
 *
 * A MISREAD CLOCK MUST NOT MOVE IT. A span that meets no other is outvoted.
 * Two groups that each agree among themselves are two answers (a ledger that
 * filed two rounds' frames under one), and unless one is twice the other the
 * round has none: null, and its death is framed as before.
 */
function barrierDrop(records, n, opts) {
  const o = opts || {};
  const spans = [];
  for (const r of records || []) {
    if (!r || r.round !== n || !Number.isFinite(r.at)) continue;
    if (Number.isFinite(o.from) && r.at < o.from) continue;
    if (Number.isFinite(o.to) && r.at > o.to + 5000) continue;
    if (Number.isFinite(o.before) && r.at >= o.before) continue;
    const st = r.state || {};
    if (st.phase === 'postplant' || st.spike === 'planted') continue;
    const left = clockSeconds(st.clock);
    if (left === null || left <= BUY_MAX_LEFT || left >= ROUND_SECONDS) continue;
    spans.push([r.at - (ROUND_SECONDS - left) * 1000 - CLOCK_SLACK_MS, r.at - (ROUND_SECONDS - 1 - left) * 1000 + CLOCK_SLACK_MS]);
  }
  const deepest = (list) => {
    const edges = [];
    for (const [lo, hi] of list) edges.push([lo, 1], [hi, -1]);
    // A span is [lo, hi): one that ends where another begins does not meet it.
    edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let depth = 0;
    let best = 0;
    let where = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      depth += edges[i][1];
      const a = edges[i][0];
      const b = edges[i + 1][0];
      if (b <= a || depth <= 0) continue;
      if (depth > best) { best = depth; where = [[a, b]]; } else if (depth === best) {
        const last = where[where.length - 1];
        if (last[1] === a) last[1] = b; else where.push([a, b]);
      }
    }
    return { best, where };
  };
  if (!spans.length) return null;
  const top = deepest(spans);
  if (top.where.length !== 1) return null;
  const mid = (top.where[0][0] + top.where[0][1]) / 2;
  const agree = spans.filter(([lo, hi]) => lo <= mid && mid < hi);
  if (spans.length > 1) {
    // The frames that disagree, and how many of them agree with each other.
    const rest = spans.filter(([lo, hi]) => !(lo <= mid && mid < hi));
    const other = rest.length ? deepest(rest).best : 0;
    if (top.best < 2 || top.best < 2 * other) return null;
  }
  // The middle of where they all meet. Every span holds the drop, so the
  // frames that pin it are the ones at the edges: read a second apart against
  // a clock that ticks each second, the spans slide a hundredth a frame and
  // meet in a few tenths, and trimming the edges as outliers put the real
  // Split match's round 1 0.4 s early.
  return { at: Math.round(Math.max(...agree.map((s) => s[0])) / 2 + Math.min(...agree.map((s) => s[1])) / 2),
    frames: top.best, of: spans.length };
}

/**
 * Riot's death of a round on the wall clock (ms), from its barriers dropping
 * and Riot's milliseconds (its second when an older record has no
 * milliseconds), or null. Riot's plant takes the frames after it out of the
 * drop, so a post plant death is timed by the clock before the plant, and
 * without Riot's plant time it is not timed at all: a read after the plant
 * carries the clock of the read before it, which a frame alone cannot tell
 * from the clock before the plant (the rounds withRiotTimes has not seen).
 */
function deathMoment(records, round, window) {
  const r = round || {};
  if (!r.died || (r.afterPlant && !Number.isFinite(r.plantMs))) return null;
  const ms = Number.isFinite(r.deathMs) ? r.deathMs : typeof r.deathSec === 'number' ? r.deathSec * 1000 : null;
  if (ms === null || ms < 0) return null;
  const w = window || {};
  let drop = barrierDrop(records, r.n, { from: w.from, to: w.to });
  // Riot's plant, plantMs after the drop: the frames from a second before it
  // on are read again without, the drop they gave kept only if the rest give
  // none. A second, because a frame read just after the plant carries the
  // clock of the plant's own second, meets the others at their edge, and
  // moves the drop that would have placed the plant.
  if (drop && Number.isFinite(r.plantMs)) {
    drop = barrierDrop(records, r.n, { from: w.from, to: w.to, before: drop.at + r.plantMs - 1000 }) || drop;
  }
  if (!drop) return null;
  // AND INSIDE THE ROUND IT IS THE DEATH OF. One frame of the next round filed
  // under this one is a drop all the same: on the real Abyss session, read
  // every ten seconds, round 8's one clocked frame was round 9's, and put
  // round 8's death 15 s into round 9.
  const own = (records || []).filter((x) => x && x.round === r.n && Number.isFinite(x.at)).map((x) => x.at);
  const at = drop.at + ms;
  if (!own.length || at < Math.min(...own) - 2000 || at > Math.max(...own) + AFTER_WALL_MS) return null;
  return at;
}

/**
 * The reconciled rounds with Riot's own milliseconds beside them: when the
 * death was (deathMs) and the plant (plantMs), from Riot's round record.
 * reconcile() keeps the second alone, which is a frame's worth of error twice
 * over at a read a second. New objects; the rounds handed in are not changed.
 */
function withRiotTimes(rounds, riot) {
  const per = new Map((Array.isArray(riot && riot.perRound) ? riot.perRound : []).map((p) => [p.n, p]));
  return (rounds || []).map((r) => {
    const p = r && per.get(r.n);
    if (!p) return r;
    return {
      ...r,
      deathMs: r.died && Number.isFinite(p.deathMs) ? p.deathMs : null,
      plantMs: Number.isFinite(p.plantMs) ? p.plantMs : null,
    };
  });
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

  // Riot's death on the wall clock, from the round's own clock (8.3.1): the
  // last frame of the round at least FRAME_MARGIN_MS before it, and the first
  // one past it, the round before's banner death left out of both and this
  // round's own on the banner of the next one allowed as the frame after.
  const moment = death.verified ? deathMoment(inMatch, death, window) : null;
  if (moment !== null) {
    const borrowed = borrowedInto(inMatch, death.n);
    const own = round.filter((r) => r !== borrowed);
    const banner = bannerDeath(inMatch, death.n);
    let before = null;
    for (const r of own) {
      if (r.at <= moment - FRAME_MARGIN_MS && moment - r.at <= BEFORE_MS && (!before || r.at > before.at)) before = r;
    }
    const after = own.concat(banner && !own.some((r) => r.died) ? [banner] : [])
      .filter((r) => r.at > moment && r.at - moment <= AFTER_WALL_MS)
      .sort((a, b) => a.at - b.at)[0] || null;
    if (before) return after ? [before, after] : [before];
  }

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

/*
 * WHEN THE LOOK'S ROUND BEGAN, for its clip (8.4.1, clips.js lookWindow): the
 * drop Riot's moment was read from (deathMoment), else the one the round's own
 * clock gives (barrierDrop), else null. The player's Fracture round 6 death
 * came 3 s after its barriers dropped, and the clip cut 11 s before it opened
 * on 8 s of the buy phase.
 */
function dropOf(inMatch, r, window, moment) {
  const ms = Number.isFinite(r.deathMs) ? r.deathMs : typeof r.deathSec === 'number' ? r.deathSec * 1000 : null;
  if (Number.isFinite(moment) && ms !== null) return moment - ms;
  const w = window || {};
  const d = barrierDrop(inMatch, r.n, { from: w.from, to: w.to });
  return d ? d.at : null;
}

/**
 * One look: the death, its frames, the names they are kept under, and when the
 * first was taken. With Riot's death on the wall clock (`moment`, deathMoment)
 * it carries that moment too, and each frame's seconds against it (frameAt).
 * And when its round's barriers dropped (`drop`), where that is known.
 */
function lookAt(r, recs, moment, drop) {
  const first = recs[0] && typeof recs[0].at === 'number' ? recs[0].at : null;
  const began = Number.isFinite(drop) ? { drop } : {};
  if (Number.isFinite(moment) && first !== null) {
    // To the hundredth, the same either side of the death.
    const secs = (ms) => (ms < 0 ? -1 : 1) * Math.round(Math.abs(ms) / 10) / 100;
    return {
      round: r,
      frames: recs,
      names: recs.map((_, i) => `r${r.n}-${i === 0 ? 'before' : 'after'}.jpg`),
      // The seconds from the first frame to the death, the clip's own rule
      // before 8.3.1 and the server's fact for a look without frameAt.
      gap: moment >= first && moment - first <= BEFORE_MS ? secs(moment - first) : null,
      at: first,
      moment,
      frameAt: recs.map((f) => secs(f.at - moment)),
      ...began,
    };
  }
  const t = recs[0] ? secondsIn(recs[0]) : null;
  // Seconds from the first frame to Riot's death second, TRUSTED ONLY WHERE
  // THE ROUND CLOCK COULD HAVE PICKED THAT FRAME: no plant, and the death at
  // most BEFORE_MS after it, framesFor's own rule. A frame the other path
  // picked carries a clock that is not the round's: after the plant it is the
  // spike's, and at a read a second the model reads the buy timer as the round
  // clock. On the real Split match round 15's first frame was a buy phase
  // frame read as "active 0:18", 82 s into a round Riot has the death 2 s into:
  // clamped to 0, its clip was cut wholly inside the buy phase, 16 s before
  // the death, and the server was told the frame was taken in the second the
  // player died. Its round 1, a post plant death, gave 25 s, a moment 21 s
  // past the frame that registered the death. Untrusted, the gap is null and
  // the death is that registering frame's (shared/clips.js momentOf).
  const d = typeof r.deathSec === 'number' && t !== null ? r.deathSec - t : null;
  return {
    round: r,
    frames: recs,
    // r6-before.jpg, r6-after.jpg: beside the review in the library, and on
    // its round's card, so these are the names every saved review carries.
    names: recs.map((_, i) => `r${r.n}-${i === 0 ? 'before' : 'after'}.jpg`),
    gap: d !== null && !r.afterPlant && d >= 0 && d <= BEFORE_MS / 1000 ? d : null,
    // When the first frame was captured, so the review's eye can open the AI
    // log at that moment.
    at: recs[0] && typeof recs[0].at === 'number' ? recs[0].at : null,
    ...began,
  };
}

/**
 * The deaths a review looks at, each with the frames sent for it: up to
 * `limit` looks, in round order, none without a frame.
 *
 *   'riot'    the verified deaths (teachableDeaths), framed by Riot's second
 *   'screen'  a review Riot's record never reached (8.2): the deaths the
 *             screen saw (teachableScreenDeaths), framed by the frame that
 *             registered each one and the one before it. A death whose
 *             registering frame is all there is, with nothing before it in its
 *             round, is never chosen: that frame shows the player already dead,
 *             and the look is sent as the moment before the death. The next
 *             most teachable death takes its place.
 *
 * @param window  { from, to } wall clock bounds of the match, as framesFor
 * @returns [{ round, frames: [record...], names, gap, at }]
 */
function looksFor(records, rounds, window, source, limit = 4) {
  const w = window || {};
  const inMatch = (records || []).filter((r) => r && r.frame
    && (!w.from || r.at >= w.from) && (!w.to || r.at <= w.to + 5000));
  if (source !== 'screen') {
    return teachableDeaths(rounds, limit)
      .map((r) => {
        const moment = deathMoment(inMatch, r, window);
        return lookAt(r, framesFor(records, r, window), moment, dropOf(inMatch, r, window, moment));
      })
      .filter((x) => x.frames.length);
  }
  const framed = new Map();
  for (const r of rounds || []) {
    if (!r || !r.died || r.verified) continue;
    const recs = framesFor(records, r, window);
    if (recs.length && !recs[0].died) framed.set(r, recs);
  }
  return teachableScreenDeaths([...framed.keys()], limit)
    .map((r) => lookAt(r, framed.get(r), null, dropOf(inMatch, r, window, null)));
}

module.exports = {
  teachableDeaths, teachableScreenDeaths, framesFor, looksFor, secondsIn, barrierDrop, deathMoment, withRiotTimes, dropOf,
  borrowedInto,
  BEFORE_MS, AFTER_MS, FRAME_MARGIN_MS, CLOCK_SLACK_MS,
};
