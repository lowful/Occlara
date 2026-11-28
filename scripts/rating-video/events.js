'use strict';

/**
 * THE RATING VIDEO'S EVENTS, FROM THE VIDEO ALONE (docs/claude/rating.md
 * "The video tool"). The live rating's own feed (src/shared/live-rating.js)
 * read offline: every frame's kill feed rows (killfeed.js detect) go in with a
 * context the video cannot give and this file makes up honestly:
 *
 *   round    counted here: a new round starts at the first row seen after a
 *            side was wiped out (the round is over) or after GAP_S seconds with
 *            no row at all (the buy phase alone is 30 s and the next round's
 *            first kill comes after it). Measured on Riot's record of 72 rounds
 *            (rating.md): 65 of 67 rounds ended in a wipe, the rule splits every
 *            boundary but at most one, and splits 6 rounds where none was (a
 *            long quiet stretch after the plant).
 *   side     only from the caller (--side), swapped at the half and every round
 *            of overtime; unknown otherwise (the engine's neutral value).
 *   result   a wipe says it: the enemy wiped is a round won, the team wiped one
 *            lost. Otherwise unknown (the engine's neutral value).
 *   the spike, the clock, the score: not read (the plant's swing is missing).
 *
 * Everything else, the rows lined up frame to frame, the player's yellow on
 * two frames, no yellow kill while the player watches a teammate, the caps, is
 * the live rating's own, measured there (rating.md "Live").
 *
 * Answers the editable event list (the --dump-events file):
 *   { t, kind: 'round', round, side } | { t, kind: 'kill', round, killer, victim }
 *   | { t, kind: 'end', round, won }
 * t in seconds of the video, killer and victim 'me', 'us' or 'them'.
 */

const { createLiveRating } = require('../../src/shared/live-rating');

const GAP_S = 40;          // no new row this long: a new round
const ROW_S = 5;           // a row stays on the feed about this long, so the rows are unseen GAP_S less this
const WIPE_GAP_S = 8;      // after a wipe, the next row this long after the last one seen is the next round's
const T0 = 1800000000000;  // the live rating's clock, offline

/** The player's side in round n, from the side of the first round given. */
function sideOf(n, o) {
  const first = o && (o.side === 'attacking' || o.side === 'defending') ? o.side : null;
  if (!first) return null;
  const start = o.startRound || 1;
  const half = o.half || 12;
  const other = (s) => (s === 'attacking' ? 'defending' : 'attacking');
  // Which half each round is in: 1 to half, half+1 to 2*half, then one a round in overtime.
  const part = (k) => (k <= half ? 0 : k <= 2 * half ? 1 : 2 + (k - 2 * half - 1));
  return (part(n) - part(start)) % 2 === 0 ? first : other(first);
}

/**
 * @param o.side        the player's side in the first round of the video ('attacking' | 'defending')
 * @param o.startRound  the first round's number (1)
 * @param o.half        the last round of the first half (12, Swiftplay 4)
 * @param o.mode        'standard' | 'swiftplay' (the engine's length rule)
 * @param o.agent       the player's agent, for the engine
 */
function createOfflineReader(opts) {
  const o = opts || {};
  const live = createLiveRating({ queue: o.mode || null, meAgent: o.agent || null });
  let n = Number.isInteger(o.startRound) && o.startRound > 0 ? o.startRound : 1;
  let lastRowT = null;
  let lastT = 0;
  const opened = new Map();   // round -> t it opened
  const splits = [];          // { t, round, why }

  /** Each side's players down in round n, from what the live rating counted. */
  function downIn(round) {
    const d = { us: 0, them: 0 };
    for (const e of live.events()) {
      if (e.kind !== 'kill' || e.round !== round || !e.out || e.out.ignored) continue;
      if (e.victim === 'them') d.them++; else if (e.victim === 'us' || e.victim === 'me') d.us++;
    }
    return d;
  }

  function frame(t, det) {
    if (!Number.isFinite(t) || t < lastT) return;
    lastT = t;
    const list = det && Array.isArray(det.list) ? det.list : [];
    if (list.length) {
      if (lastRowT !== null) {
        const gap = t - lastRowT;
        const d = downIn(n);
        const wiped = d.us >= 5 || d.them >= 5;
        if (gap >= GAP_S - ROW_S || (wiped && gap >= WIPE_GAP_S)) {
          n++;
          splits.push({ t, round: n, why: wiped && gap < GAP_S - ROW_S ? 'wipe' : 'gap' });
          // The new round opens on a frame of its own before its first row is
          // read: a row first seen on the frame the round changes is, live, the
          // last round's tail and never counted, and here it is the new round's
          // first kill.
          live.frame({ at: T0 + Math.round(t * 1000), match: T0, round: n, side: sideOf(n, o), phase: 'active', alive: true, clock: '1:40', det: { list: [] } });
        }
      }
      lastRowT = t;
    }
    if (!opened.has(n)) opened.set(n, t);
    // The context the video can give: the round counted here, the side asked
    // for, a round live from its first frame (its clock read as just started,
    // so a new round opens at once), the player up unless their own row said
    // otherwise (the live rating keeps that itself).
    live.frame({ at: T0 + Math.round(t * 1000), match: T0, round: n, side: sideOf(n, o), phase: 'active', alive: true, clock: '1:40', det: { list } });
  }

  /** The event list, once every frame is in. tEnd: the video's length in seconds. */
  function finish(tEnd) {
    const end = Number.isFinite(tEnd) ? tEnd : lastT;
    // Rows still waiting for their yellow are counted once gone from the feed.
    live.frame({ at: T0 + Math.round((Math.max(end, lastT) + 10) * 1000), match: T0, round: n, side: sideOf(n, o), phase: 'active', alive: true, clock: '1:40', det: { list: [] } });
    const out = [];
    const base = new Map();
    for (const e of live.events()) {
      if (e.kind === 'round' && /:round$/.test(e.id)) {
        const t = (e.at - T0) / 1000;
        base.set(e.round, e.at);
        out.push({ t: round2(t), kind: 'round', round: e.round, side: e.side || null });
      } else if (e.kind === 'kill' && e.out && !e.out.ignored) {
        // The row's first sighting: the round's first frame and the event's ms.
        const t = ((base.get(e.round) || e.at) - T0 + (e.ms || 0)) / 1000;
        out.push({ t: round2(Math.min(t, end)), kind: 'kill', round: e.round, killer: e.killer, victim: e.victim });
      }
    }
    // Each round's end: before the next round opens or at the video's end,
    // won or lost only where a side was wiped out.
    const rounds = out.filter((e) => e.kind === 'round');
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      const kills = out.filter((e) => e.kind === 'kill' && e.round === r.round);
      const them = kills.filter((e) => e.victim === 'them').length;
      const us = kills.filter((e) => e.victim === 'us' || e.victim === 'me').length;
      const won = them >= 5 ? true : us >= 5 ? false : null;
      const next = rounds[i + 1];
      const lastKill = kills.length ? kills[kills.length - 1].t : r.t;
      const t = next ? Math.max(lastKill, next.t - 0.05) : Math.max(lastKill, end);
      out.push({ t: round2(t), kind: 'end', round: r.round, won });
    }
    return { events: sortEvents(out), splits: splits.slice() };
  }

  return { frame, finish };
}

const round2 = (v) => Math.round(v * 100) / 100;
const ORDER = { round: 0, plant: 1, kill: 2, defuse: 3, end: 4 };

/** By time, a round before what happened in it and its end after. */
function sortEvents(list) {
  return list.map((e, i) => ({ e, i })).sort((a, b) => (a.e.t - b.e.t) || ((a.e.round || 0) - (b.e.round || 0))
    || (ORDER[a.e.kind] - ORDER[b.e.kind]) || (a.i - b.i)).map((x) => x.e);
}

const SIDES = new Set(['me', 'us', 'them']);
/**
 * A hand corrected event list, checked: every event a finite time and a kind
 * the engine knows, every kill's ends 'me', 'us' or 'them'. Throws with the
 * first wrong line so the owner can fix it.
 */
function checkEvents(json) {
  const list = Array.isArray(json) ? json : json && Array.isArray(json.events) ? json.events : null;
  if (!list) throw new Error('the events file has no "events" list');
  const out = [];
  list.forEach((e, i) => {
    const where = `event ${i + 1}`;
    if (!e || typeof e !== 'object') throw new Error(`${where} is not an object`);
    if (!Number.isFinite(e.t) || e.t < 0) throw new Error(`${where} has no time "t" in seconds`);
    if (e.kind === 'round') {
      if (!Number.isInteger(e.round) || e.round < 1) throw new Error(`${where}: a round needs its number "round"`);
      if (e.side !== undefined && e.side !== null && e.side !== 'attacking' && e.side !== 'defending') throw new Error(`${where}: side is attacking, defending or null`);
      out.push({ t: e.t, kind: 'round', round: e.round, side: e.side || null });
    } else if (e.kind === 'kill') {
      if (!SIDES.has(e.killer) || !SIDES.has(e.victim)) throw new Error(`${where}: killer and victim are me, us or them`);
      if (e.killer === e.victim && e.killer === 'me') throw new Error(`${where}: the player cannot kill themself here`);
      const assists = Array.isArray(e.assists) ? e.assists.filter((a) => a === 'me') : [];
      out.push({ t: e.t, kind: 'kill', killer: e.killer, victim: e.victim, ...(assists.length ? { assists } : {}) });
    } else if (e.kind === 'plant' || e.kind === 'defuse') {
      if (e.by !== undefined && e.by !== null && !SIDES.has(e.by)) throw new Error(`${where}: by is me, us or them`);
      out.push({ t: e.t, kind: e.kind, by: e.by || null });
    } else if (e.kind === 'end') {
      if (e.won !== undefined && e.won !== null && typeof e.won !== 'boolean') throw new Error(`${where}: won is true, false or null`);
      out.push({ t: e.t, kind: 'end', won: typeof e.won === 'boolean' ? e.won : null });
    } else {
      throw new Error(`${where}: kind is round, kill, plant, defuse or end`);
    }
  });
  return sortEvents(out);
}

module.exports = { createOfflineReader, checkEvents, sortEvents, sideOf, GAP_S, ROW_S, WIPE_GAP_S };
