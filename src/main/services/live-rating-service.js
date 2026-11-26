'use strict';

/**
 * THE LIVE RATING IN MAIN (docs/claude/rating.md "Live", the owner's second
 * exception, docs/claude/screen-silence.md "The live rating").
 *
 * Two inputs, only while the Settings switch `liveRating` is on (off, nothing
 * is kept and what was kept goes, reset):
 *   - every read the live Valorant reader applies (its AI log record and its
 *     guarded context): the CONTEXT alone (round, side, score, spike, alive);
 *     the read's own frame is never read here for kills;
 *   - the recorder page's kill feed rows, five times a second (`tap`), read
 *     off the recorder's own frames by src/shared/killfeed.js.
 * They feed src/shared/live-rating.js, ONE RATING PER MATCH ID: a new id is a
 * new rating, and a match the reader resumes (resumeMatch restores its id)
 * goes back to its own. Nothing of it leaves main but `field` (PUSH_LIVE's
 * `rating`) and `widget` (the stream widget's payload), both built by `pick`:
 * the number, its tier, the last move with a label that says what happened and
 * no numbers standing ("Kill", "Opening kill", "Died first"), the line; or, when
 * the feed is not being read, `{ reading: false }` and no number at all.
 *
 * An import never reaches here (its reader has no hook); League has no reader.
 * Each match's live final is kept at its end (`end`) so the review's confirmed
 * rating can be logged against it (`compare`), never shown.
 */

const { createLiveRating } = require('../../shared/live-rating');
const rating = require('../../shared/rating');

const KEEP_MATCHES = 4;
const LINE_OUT = 40;             // points of the line a window is sent
const TAP_STALE_MS = 3000;       // the recorder's rows stopped arriving this long: not reading
const BUDGET_MS = 15;            // a corner read slower than this, three in a row: the page stops
const LAG_LIMIT_MS = 1500;       // the recorder's chunks this late: the feed is let go

/*
 * THE LIVE LABEL says what happened and nothing of the numbers standing (the
 * coordinator's ruling: the exception never says who is alive, and a feed read
 * wrong would make them wrong). The review's labels keep theirs.
 */
function liveLabel(label) {
  let t = String(label || '').replace(/,\s*\d+v\d+/g, '').trim();
  if (/^First kill\b/.test(t)) t = 'Opening kill';
  else if (/^Traded a teammate\b/.test(t)) t = 'Trade kill';
  else if (/^Kill as the last one up\b/.test(t)) t = 'Kill';
  else if (/^Died last\b/.test(t)) t = 'Died';
  return t;
}

/** Only the view's own fields, a fresh object: nothing else can ride along. */
function pick(v) {
  if (!v || typeof v.value !== 'number') return null;
  const last = v.last && typeof v.last === 'object'
    ? { delta: String(v.last.delta), up: !!v.last.up, down: !!v.last.down, label: liveLabel(v.last.label) } : null;
  return { value: v.value, shown: String(v.shown), tier: String(v.tier), last, line: (Array.isArray(v.line) ? v.line : []).slice(-LINE_OUT).filter((x) => typeof x === 'number') };
}

/**
 * WHETHER THE RECORDER SHOULD READ THE CORNER: only with the switch on, a
 * Valorant session recording at 700 rows or more, and the page not stopped
 * for its cost (a read over BUDGET_MS three times running) or a recorder
 * falling behind (its chunks over LAG_LIMIT_MS late). Answers { on, why }.
 */
function wantFeed(s) {
  const o = s || {};
  if (o.on !== true) return { on: false, why: 'off' };
  if (o.game !== 'valorant' || o.valorantSession !== true) return { on: false, why: 'game' };
  if (!(Number(o.height) >= 700)) return { on: false, why: 'height' };
  if (o.slow === true) return { on: false, why: 'slow' };
  if (Number(o.lagMs) > LAG_LIMIT_MS) return { on: false, why: 'lag' };
  return { on: true, why: null };
}

function createLiveRatingService() {
  const matches = new Map();     // match id -> { live, last: { rec, ctx }, lastAt, tapAt }
  let current = null;            // the id rated now
  const finals = new Map();      // match id -> { value, at, rounds, kills, deaths, events }
  let halted = null;             // why the feed stopped ('slow', 'lag', ...) or null

  function reset() { matches.clear(); current = null; halted = null; }

  function entry(id, ctx) {
    const key = id === undefined || id === null ? 'none' : String(id);
    if (!matches.has(key)) {
      const c = ctx || {};
      matches.set(key, { live: createLiveRating({ queue: c.gameMode === 'swiftplay' ? 'swiftplay' : null, meAgent: c.agentConfirmed ? c.agent : null }),
        last: null, lastAt: 0, tapAt: 0 });
      while (matches.size > KEEP_MATCHES) matches.delete(matches.keys().next().value);
    }
    current = key;
    return matches.get(key);
  }

  function fields(rec, c, at, det) {
    return {
      at, match: rec.match || null, round: Number.isInteger(rec.round) ? rec.round : null,
      side: c.side === 'attacking' || c.side === 'defending' ? c.side : null,
      phase: typeof c.phase === 'string' ? c.phase : null,
      alive: c.playerAlive === false ? false : c.playerAlive === true ? true : null,
      died: !!rec.died, withdrew: false,
      spike: c.spike === 'planted' ? 'planted' : null,
      team: Number.isInteger(c.teamScore) ? c.teamScore : null,
      enemy: Number.isInteger(c.enemyScore) ? c.enemyScore : null,
      clock: typeof c.clock === 'string' ? c.clock : null,
      mode: c.gameMode === 'swiftplay' || c.gameMode === 'standard' ? c.gameMode : null,
      det,
    };
  }

  /** One applied read of the reader: the context alone, for its match's rating. */
  function frame(rec, ctx) {
    if (!rec || !Number.isFinite(rec.at)) return;
    const c = ctx || {};
    const e = entry(rec.match, c);
    e.last = { rec, ctx: { ...c } };
    // A read is applied a second or so after its frame was taken: its time
    // never goes back past a corner the recorder already sent.
    e.lastAt = Math.max(e.lastAt, rec.at);
    e.live.frame(fields(rec, c, e.lastAt, null));
  }

  /**
   * The recorder page's rows (five a second), with the reader's last context
   * for the match being rated.
   * @param m { at, H, list }
   */
  function tap(m) {
    const e = current !== null ? matches.get(current) : null;
    if (!m || !Number.isFinite(m.at) || !Array.isArray(m.list) || !e || !e.last) return false;
    e.tapAt = m.at;
    e.lastAt = Math.max(e.lastAt, m.at);
    const list = m.list.filter((r) => r && (r.killer === 'ally' || r.killer === 'enemy') && (r.victim === 'ally' || r.victim === 'enemy')
      && Number.isInteger(r.slot) && r.sig && typeof r.sig === 'object')
      .map((r) => ({ slot: r.slot, killer: r.killer, victim: r.victim, mine: r.mine === 'kill' || r.mine === 'death' ? r.mine : null,
        sig: { v: Number(r.sig.v) || 0, r: Number(r.sig.r) || 0, g: Number(r.sig.g) || 0, b: Number(r.sig.b) || 0 } }));
    // The read's own died flag belongs to its read alone.
    e.live.frame(fields({ ...e.last.rec, died: false }, e.last.ctx, e.lastAt, { list }));
    return true;
  }

  /** Whether the feed is being read for the match rated now, and if not why. */
  function readingNow(now) {
    const e = current !== null ? matches.get(current) : null;
    if (halted) return { reading: false, why: halted };
    if (!e) return { reading: false, why: 'waiting' };
    if (!e.tapAt || (Number.isFinite(now) && now - e.tapAt > TAP_STALE_MS)) return { reading: false, why: 'stopped' };
    if (!e.live.reading()) return { reading: false, why: 'rows' };
    return { reading: true, why: null };
  }

  /** What a window may show, or null with nothing rated yet. */
  function view(now) {
    const e = current !== null ? matches.get(current) : null;
    if (!e) return null;
    const r = readingNow(Number.isFinite(now) ? now : Date.now());
    if (!r.reading) return { reading: false };
    return pick(e.live.view());
  }

  /*
   * THE GATES, main's whole decision in one place (index.js calls these and
   * nothing else): with the switch off nothing is read, what was kept goes,
   * and no field and no widget payload exist.
   */
  function feed(rec, ctx, gate) {
    if (!gate || gate.on !== true) { reset(); return false; }
    frame(rec, ctx);
    return true;
  }
  function feedTap(m, gate) {
    if (!gate || gate.on !== true) { reset(); return false; }
    return tap(m);
  }
  /** The page stopped reading (its budget), or main let the feed go: the "not reading" state. */
  function halt(why) { halted = why ? String(why) : null; }
  /** PUSH_LIVE's `rating`: only with the switch on and a match under way, else undefined (no key). */
  function field(gate) {
    if (!gate || gate.on !== true || gate.inMatch !== true) return undefined;
    return view(gate.now) || undefined;
  }
  /**
   * The widget's payload, or null with either switch off (the server is
   * stopped then). Mid match the live view (or "not reading"); between
   * matches nothing, but for a short while after one whose confirmed rating
   * came in, "Full time".
   */
  function widget(gate) {
    const g = gate || {};
    if (g.on !== true || g.stream !== true) return null;
    if (g.inMatch === true) {
      const v = view(g.now);
      if (!v) return { state: 'idle' };
      return v.reading === false ? { state: 'blind' } : { state: 'live', rating: v };
    }
    const ft = g.fullTime;
    if (ft && typeof ft.value === 'number' && Number.isFinite(g.now) && g.now < ft.until) {
      return { state: 'final', rating: { value: ft.value, shown: ft.value.toFixed(1), tier: rating.tierOf(ft.value) } };
    }
    return { state: 'idle' };
  }

  /** The match ended (the reader's watch): its live final kept for the review to be logged against. */
  function end(id) {
    const e = matches.get(String(id));
    if (!e || !id) return null;
    const live = e.live;
    const evs = live.events().filter((x) => x.kind === 'kill' && x.out && !x.out.ignored);
    const kept = { value: live.value(), at: Date.now(), rounds: live.snapshot().rounds,
      kills: evs.filter((x) => x.killer === 'me').length, deaths: evs.filter((x) => x.victim === 'me').length, events: live.events().length,
      reading: live.reading() };
    finals.set(String(id), kept);
    while (finals.size > KEEP_MATCHES) finals.delete(finals.keys().next().value);
    return kept;
  }

  /**
   * The review's confirmed rating against the live final of its match, the
   * line the AI log keeps, or null.
   */
  function compare(id, confirmed) {
    const f = finals.get(String(id));
    if (!f || !confirmed || typeof confirmed.value !== 'number') return null;
    return { match: id, live: f.value, confirmed: confirmed.value, gap: Math.round((f.value - confirmed.value) * 10) / 10,
      liveRounds: f.rounds, confirmedRounds: confirmed.rounds || null, liveKills: f.kills, liveDeaths: f.deaths, reading: f.reading,
      version: confirmed.version || null };
  }

  return { frame, tap, feed, feedTap, halt, field, widget, view, readingNow, end, compare, reset,
    finalOf: (id) => finals.get(String(id)) || null, active: () => matches.size > 0, current: () => current };
}

module.exports = { createLiveRatingService, pick, liveLabel, wantFeed, BUDGET_MS, LAG_LIMIT_MS, TAP_STALE_MS };
