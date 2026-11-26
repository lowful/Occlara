'use strict';

/**
 * THE LIVE RATING (build 2 of the match rating, docs/claude/rating.md "Live").
 *
 * Pure: no Electron, no clock of its own, no network. Main hands it, for every
 * frame the reader applied, what the reader's GUARDED context says (round,
 * side, phase, the score, the spike, a death the engine registered or took
 * back) and what the kill feed detector saw on that frame (killfeed.js). It
 * turns them into the rating engine's events (rating.js, "The event shape"),
 * each with an id, pushes them, and keeps the view the Recording screen and
 * the stream widget may show: the number, its tier, its last move with the
 * engine's plain label, and a small line of the value so far. Nothing else of
 * the reader's context goes into the view.
 *
 * Where each event comes from (measured, rating.md "Live"):
 *   kills    every kill feed row, counted once: a row is known again in the
 *            next frame by its signature (killfeed.js sigOf). The killer's
 *            block teal is our side, red theirs. The player's own row is the
 *            one with the yellow edge at the killer's end, but ONLY while the
 *            player is up: dead, Valorant moves that highlight to the teammate
 *            being spectated. The player's kill counts only once the yellow
 *            was seen on two frames (opts.mineSeen): one frame's yellow was
 *            wrong too often to show (measured). A row without it waits for
 *            four sightings or 4 s before it is counted as a teammate's.
 *            Rows are lined up frame to frame by their place in the feed,
 *            which only moves up (overlap, below).
 *   deaths   the player's own row (yellow at the victim's end), once a round.
 *            The engine's own registration is NOT used by default
 *            (opts.engineDeaths): measured, it found no death the rows
 *            missed and added three that never happened (weak tells the
 *            trial did not take back);
 *            the row is Valorant's own word. Used, it counts at the round's
 *            end and only when no guard took it back (judgeTrial).
 *   plants   the guarded context's planted spike, the side from its side lock.
 *   results  the guarded scoreboard: the round ends when the score moves (2.5 s
 *            later, so the round's last kill, seen on the banner, still counts).
 * The round opens when the reader's ledger moves on AND the barriers drop (or
 * the score closed the round before), so a result read late is still the
 * right round's.
 */

const rating = require('./rating');

const MATCH_ROW_MS = 9000;       // a row unseen this long is gone from the feed
const ROW_LIFE_MS = 6000;        // a row stays on the feed about five seconds (measured): one first seen longer ago is gone
const HOLD_ROW_MS = 4000;        // a plain row waits this long for its yellow
const HOLD_SEEN = 8;             // or this many sightings (1.6 s at five frames a second)
const MINE_SEEN = 2;             // the player's kill: the yellow seen on this many frames
const END_HOLD_MS = 2500;        // the score moved: the round's last rows still count this long
const OPEN_WAIT_MS = 25000;      // the ledger moved and nothing closed the round: closed unknown after this
const TOL_LEN = 0.01;            // a block's length may wobble this much (a share of H)
const TOL_RGB = 75;              // and the portrait's colour this much (the three summed)
const LOOSE_LEN = Number(process.env.LR_LL || 0.025);
const LOOSE_RGB = Number(process.env.LR_LR || 135);
const LINE_MAX = 60;             // points kept on the small line

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** Seconds left on a round clock "1:23", or null. */
function clockLeft(c) {
  const m = typeof c === 'string' ? /^(\d):([0-5]\d)$/.exec(c.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The same kill feed row in two frames: the same sides, the victim's block and portrait alike. */
function sameRow(a, b) {
  if (!a || !b || a.killer !== b.killer || a.victim !== b.victim) return false;
  if (!a.sig || !b.sig) return false;
  if (Math.abs(a.sig.v - b.sig.v) > TOL_LEN) return false;
  return Math.abs(a.sig.r - b.sig.r) + Math.abs(a.sig.g - b.sig.g) + Math.abs(a.sig.b - b.sig.b) <= TOL_RGB;
}

/** Two rows that may be one row seen twice: the same sides, the signature roughly alike. */
function mayBe(a, b) {
  if (!a || !b || a.killer !== b.killer || a.victim !== b.victim || !a.sig || !b.sig) return false;
  if (Math.abs(a.sig.v - b.sig.v) > LOOSE_LEN) return false;
  return Math.abs(a.sig.r - b.sig.r) + Math.abs(a.sig.g - b.sig.g) + Math.abs(a.sig.b - b.sig.b) <= LOOSE_RGB;
}

/*
 * THE FEED ONLY MOVES UP. Rows come in under the others and leave from the
 * top, so the rows on screen are always the newest few in the order they came,
 * and a row never moves down. A frame's rows (top to bottom) are lined up
 * against every row seen in the last row's life (oldest first) as an ordered
 * match: a row may be one already known only in that order, of the same
 * sides, at its place or above it, never one a row above it in this frame
 * came after; a known row may be skipped (gone, or missed by this frame); a
 * frame row matched to none is new, and new rows only come under the matched
 * ones. Of the alignments that fit, the one whose pairs' signatures are the
 * most alike wins, a known row near the end of its life costing more, and a
 * new row costing more than any fair match. Measured on the owner's clips at
 * 5 frames a second: the signature alone wobbles as a semi transparent row
 * crosses a changing wall and counted rows twice; the last frame alone
 * counted a row again after a frame missed it; this does neither.
 *
 * Answers, for each row of `now`, the known row it is, or null for a new one.
 */
const NEW_COST = 1.5;
const OLD_MS = 4500;
function sigCost(k, d) {
  if (!k.sig || !d.sig) return 1;
  return Math.abs(k.sig.v - d.sig.v) / 0.02 + (Math.abs(k.sig.r - d.sig.r) + Math.abs(k.sig.g - d.sig.g) + Math.abs(k.sig.b - d.sig.b)) / 150;
}
function align(known, now, t) {
  const K = known;
  const n = now.length;
  const memo = new Map();
  function best(i, j) {
    if (i >= n) return { cost: 0, pick: [] };
    const key = i * 64 + j;
    if (memo.has(key)) return memo.get(key);
    // The rest are new.
    let out = { cost: NEW_COST * (n - i), pick: now.slice(i).map(() => null) };
    for (let jj = j; jj < K.length; jj++) {
      const k = K[jj];
      const d = now[i];
      if (k.killer !== d.killer || k.victim !== d.victim || k.slot < d.slot) continue;
      const c = sigCost(k, d) * 0.2 + (t - k.firstAt > OLD_MS ? 0.8 : 0);
      const rest = best(i + 1, jj + 1);
      if (c + rest.cost < out.cost) out = { cost: c + rest.cost, pick: [k, ...rest.pick] };
    }
    memo.set(key, out);
    return out;
  }
  return best(0, 0).pick;
}

/**
 * @param opts.queue   the match's mode when known ('swiftplay', 'standard'), for the length rule
 * @param opts.meAgent the player's agent, when the look locked it
 * @param opts.mineSeen frames the yellow must be seen on for the player's kill (2)
 * @param opts.engineDeaths true: a death only the engine registered counts at the round's end (off)
 */
function createLiveRating(opts) {
  const o = opts || {};
  let queue = o.queue || null;
  const mineSeen = Number.isInteger(o.mineSeen) && o.mineSeen > 0 ? o.mineSeen : MINE_SEEN;
  let r = null;
  let match = null;            // the engine's matchStartedAt this rating follows
  let lastScore = null;        // { team, enemy }: the score as last read, never lower
  let cur = null;              // the round being played
  let nextN = null;            // the ledger's next round, waiting to open
  let nextSince = null;
  let skipped = [];            // rounds the score jumped over: [{ n, won }]
  let seq = 0;
  let rows = [];
  let prev = { at: null, list: [] };   // the rows of the last frame that had the feed read
  let last = null;             // the player's own last move: { delta, label, value }
  let line = [];
  let events = [];             // what was pushed, for the tests and the field log
  let changed = true;
  let nowAt = null;

  function reset() {
    r = rating.createRating({ subject: 'me', queue, meAgent: o.meAgent || null });
    lastScore = null; cur = null; nextN = null; nextSince = null; skipped = []; rows = []; prev = { at: null, list: [] };
    last = null; line = [rating.D.START]; events = []; changed = true;
  }
  reset();

  function push(ev) {
    const out = r.push(ev);
    events.push({ ...ev, at: nowAt, out: out ? { delta: out.delta, value: out.value, label: out.label, ignored: out.ignored || null } : null });
    if (!out || out.ignored) return out;
    if (out.label) { last = { delta: out.delta, label: out.label, value: out.value }; changed = true; }
    if (line[line.length - 1] !== out.value) {
      line.push(out.value);
      if (line.length > LINE_MAX) line = line.slice(-LINE_MAX);
      changed = true;
    }
    return out;
  }

  function openRound(n, side, at) {
    cur = { n, side: side === 'attacking' || side === 'defending' ? side : null, openedAt: at, base: null,
      ended: false, endPending: null, died: false, engineDeath: null, planted: false };
    push({ kind: 'round', id: `${n}:round`, round: n, side: cur.side });
  }

  const msOf = (at) => (!cur ? 0 : cur.base !== null ? Math.max(0, at - cur.base) : Math.max(0, at - cur.openedAt));

  function emitKill(row) {
    if (!cur || cur.ended) return;
    let killer = row.killer === 'ally' ? 'us' : row.killer === 'enemy' ? 'them' : null;
    let victim = row.victim === 'ally' ? 'us' : row.victim === 'enemy' ? 'them' : null;
    if (!killer || !victim) return;
    if (row.mine === 'kill' && killer === 'us' && row.kills >= mineSeen) killer = 'me';
    if (row.mine === 'death' && victim === 'us' && !cur.died) { victim = 'me'; cur.died = true; }
    const id = `${cur.n}:k:${killer}:${victim}:${row.sig ? row.sig.v : 0}:${seq++}`;
    push({ kind: 'kill', id, round: cur.n, ms: msOf(row.firstAt), killer, victim });
  }

  // Rows waiting for their yellow are counted once it shows, a second sighting
  // has had its chance, or the round ends; in the order they were first seen.
  function flushRows(at, all) {
    const waiting = rows.filter((x) => x.pending).sort((a, b) => a.firstAt - b.firstAt || a.slot - b.slot);
    for (const x of waiting) {
      const sure = x.mine === 'death' || (x.mine === 'kill' && x.kills >= mineSeen);
      // Gone from this frame's feed: it has had its chance to show the yellow.
      const gone = x.lastAt < at;
      if (!all && !sure && !gone && x.seen < HOLD_SEEN && at - x.firstAt < HOLD_ROW_MS) break;
      x.pending = false;
      emitKill(x);
    }
  }

  function closeRound(won) {
    if (!cur || cur.ended) return;
    flushRows(Infinity, true);
    // The engine's own death, no row seen for it all round and not taken back.
    if (!cur.died && cur.engineDeath && o.engineDeaths === true) {
      cur.died = true;
      push({ kind: 'kill', id: `${cur.n}:death`, round: cur.n, ms: msOf(cur.engineDeath.at), killer: 'them', victim: 'me' });
    }
    cur.ended = true;
    cur.endPending = null;
    push({ kind: 'end', id: `${cur.n}:end`, round: cur.n, won: won === true || won === false ? won : null });
  }

  /**
   * One applied read.
   * @param f { at, match, round, side, phase, alive, died, withdrew, spike, team, enemy, clock, mode, det }
   *   died      the engine registered the player's death on this read
   *   withdrew  the engine took back the death the read before registered
   *   det       killfeed.detect's answer for this frame, or null
   */
  function frame(f) {
    if (!f || num(f.at) === null) return;
    // A read handed over late (the reader logs a death on trial a read later)
    // is older than one already applied: the feed only moves forward.
    if (nowAt !== null && f.at < nowAt) return;
    const at = f.at;
    nowAt = at;
    const team = int(f.team);
    const enemy = int(f.enemy);
    if (f.mode === 'swiftplay' && queue !== 'swiftplay' && !events.some((e) => e.kind === 'kill')) { queue = 'swiftplay'; reset(); }
    // A new match: the engine's match id moved and the score read lower (a
    // match that resumes keeps a score at least as high, and its rating).
    if (f.match !== undefined && f.match !== null && f.match !== match) {
      const lower = !lastScore || (team !== null && enemy !== null && (team < lastScore.team || enemy < lastScore.enemy));
      if (match !== null && lower) reset();
      match = f.match;
    }

    // The score moved: the round being played is over (and any it jumped).
    if (team !== null && enemy !== null) {
      const sum = team + enemy;
      if (lastScore && team >= lastScore.team && enemy >= lastScore.enemy && sum > lastScore.team + lastScore.enemy) {
        const dt = team - lastScore.team;
        const de = enemy - lastScore.enemy;
        const oneWay = dt > 0 && de === 0 ? true : de > 0 && dt === 0 ? false : null;
        if (cur && !cur.ended && !cur.endPending && cur.n <= sum) cur.endPending = { at, won: oneWay };
        const from = cur ? cur.n + 1 : sum + 1;
        for (let k = from; k <= sum; k++) if (!skipped.some((x) => x.n === k)) skipped.push({ n: k, won: oneWay });
      }
      if (!lastScore || (team >= lastScore.team && enemy >= lastScore.enemy)) lastScore = { team, enemy };
    }

    // The ledger's round (or the score's), and the first round seen.
    let n = int(f.round);
    if (n === null && lastScore) n = lastScore.team + lastScore.enemy + 1;
    if (!cur && n !== null) { skipped = []; openRound(n, f.side, at); }
    if (!cur) return;
    if (n !== null && n > cur.n && (nextN === null || n > nextN)) { nextN = n; if (nextSince === null) nextSince = at; }

    // The engine's death and its judge, the plant, the round's own clock.
    if (!cur.ended) {
      if (f.withdrew) cur.engineDeath = null;
      if (f.died) cur.engineDeath = { at };
      if (!cur.side && (f.side === 'attacking' || f.side === 'defending') && nextN === null) {
        cur.side = f.side;
        push({ kind: 'round', id: `${cur.n}:side`, round: cur.n, side: cur.side });
      }
      if (cur.base === null && f.phase === 'active' && f.spike !== 'planted' && nextN === null) {
        const left = clockLeft(f.clock);
        if (left !== null && left > 45 && left <= 100) cur.base = at - (100 - left) * 1000;
      }
      if (!cur.planted && f.spike === 'planted' && f.phase !== 'buy' && nextN === null) {
        cur.planted = true;
        const by = cur.side === 'attacking' ? 'us' : cur.side === 'defending' ? 'them' : null;
        push({ kind: 'plant', id: `${cur.n}:plant`, round: cur.n, ms: msOf(at), by });
      }
    }

    // The kill feed. Up means the guarded context does not hold the player
    // dead this frame and no death of theirs was counted this round.
    const up = !cur.died && f.alive !== false && f.phase !== 'dead';
    const read = f.det && Array.isArray(f.det.list);
    const list = read ? f.det.list.filter((d) => d && d.killer && d.victim && d.sig).sort((a, b) => a.slot - b.slot) : [];
    // Every row still in its life, in the order it came (oldest first).
    const recent = rows.filter((x) => at - x.firstAt <= ROW_LIFE_MS).sort((p, q) => p.firstAt - q.firstAt || p.slot - q.slot);
    const same = read ? align(recent, list, at) : [];
    // The player's own death row on this frame, where one is (rows stack in time order).
    const deathRow = cur.died ? null : list.find((d) => d.mine === 'death');
    const deathSlot = deathRow ? deathRow.slot : null;
    const nowRows = [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      // A row under the player's own death row came after it: the player was
      // down, and its yellow is the spectated teammate's.
      const afterDeath = deathSlot !== null && d.slot > deathSlot;
      const mine = d.mine === 'kill' ? (up && !afterDeath ? 'kill' : null) : d.mine === 'death' ? (cur.died ? null : 'death') : null;
      const known = same[i] || null;
      if (known) {
        nowRows.push(known);
        known.lastAt = at;
        known.slot = d.slot;
        known.seen++;
        if (known.pending && !known.mine && mine) known.mine = mine;
        if (known.pending && mine === 'kill') known.kills = (known.kills || 0) + 1;
        continue;
      }
      // A row first seen once the round is over, or before the next opened, is
      // the last round's tail: known, never counted.
      const live = !cur.ended && nextN === null;
      const row = { ...d, mine, kills: mine === 'kill' ? 1 : 0, firstAt: at, lastAt: at, seen: 1, pending: live };
      rows.push(row);
      nowRows.push(row);
    }
    if (read) prev = { at, list: nowRows };
    rows = rows.filter((x) => x.pending || at - x.lastAt <= MATCH_ROW_MS * 2);
    if (read) flushRows(at, false);

    // The round's end, then the next round.
    if (cur.endPending && (at - cur.endPending.at >= END_HOLD_MS || nextN !== null)) closeRound(cur.endPending.won);
    if (nextN !== null) {
      const left = clockLeft(f.clock);
      const dropped = f.phase === 'active' && left !== null && left > 45 && left <= 100;
      if (!cur.ended && (dropped || at - nextSince >= OPEN_WAIT_MS)) closeRound(null);
      if (cur.ended) {
        for (const s of skipped.filter((x) => x.n > cur.n && x.n < nextN).sort((a, b) => a.n - b.n)) { openRound(s.n, null, at); closeRound(s.won); }
        skipped = skipped.filter((x) => x.n > nextN);
        openRound(nextN, f.side, at);
        nextN = null; nextSince = null;
        if (dropped) cur.base = at - (100 - left) * 1000;
      }
    }
  }

  /** What a window may show: the number, its tier, the last move and its label, the line. */
  function view() {
    const value = r.value();
    return {
      value,
      shown: value.toFixed(1),
      tier: rating.tierOf(value),
      last: last ? { delta: rating.signed(last.delta), up: last.delta > 0, down: last.delta < 0, label: last.label } : null,
      line: line.slice(),
    };
  }

  return {
    frame,
    view,
    value: () => r.value(),
    snapshot: () => r.snapshot(),
    events: () => events.slice(),
    changed: () => { const c = changed; changed = false; return c; },
    match: () => match,
  };
}

module.exports = { createLiveRating, clockLeft, sameRow, MATCH_ROW_MS, HOLD_ROW_MS, END_HOLD_MS, OPEN_WAIT_MS };
