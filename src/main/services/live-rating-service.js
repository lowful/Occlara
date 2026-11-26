'use strict';

/**
 * THE LIVE RATING IN MAIN (docs/claude/rating.md "Live", the owner's second
 * exception, docs/claude/screen-silence.md "The live rating").
 *
 * index.js hands every applied read of the live Valorant reader here (the AI
 * log's record, the read's own frame among it, and the reader's guarded
 * context), and only while the Settings switch `liveRating` is on: switched
 * off, nothing is read, decoded or kept, and what was kept goes (reset). The
 * frame's kill feed corner is decoded by the injected `decode` (nativeImage in
 * index.js), read by src/shared/killfeed.js and fed with the context to
 * src/shared/live-rating.js. Nothing of it leaves main but `view()`, which
 * index.js puts on PUSH_LIVE for the Recording screen and, with the second
 * switch, on the stream widget's events.
 *
 * An import never reaches here: it runs a reader of its own (import-video.js)
 * that has no such hook. League has no reader here at all.
 *
 * It also keeps each match's live final (`end`, at the match's end), so the
 * review's confirmed rating, once Riot's record is laid over, can be logged
 * against it in the match's AI log folder (`compare`), never shown.
 */

const killfeed = require('../../shared/killfeed');
const { createLiveRating } = require('../../shared/live-rating');

const rating = require('../../shared/rating');

const KEEP_FINALS = 4;
const LINE_OUT = 40;             // points of the line a window is sent

/** Only the view's own fields, a fresh object: nothing else can ride along. */
function pick(v) {
  if (!v || typeof v.value !== 'number') return null;
  const last = v.last && typeof v.last === 'object'
    ? { delta: String(v.last.delta), up: !!v.last.up, down: !!v.last.down, label: String(v.last.label || '') } : null;
  return { value: v.value, shown: String(v.shown), tier: String(v.tier), last, line: (Array.isArray(v.line) ? v.line : []).slice(-LINE_OUT).filter((x) => typeof x === 'number') };
}

/**
 * @param deps.decode (shotBase64) -> { img, H } | null: the kill feed region's
 *                    pixels (killfeed.regionOf) and the frame's height
 */
function createLiveRatingService(deps) {
  const d = deps || {};
  let live = null;
  let match = null;
  const finals = new Map();      // match id -> { value, at, kills, deaths, events }

  function reset() { live = null; match = null; last = null; lastAt = 0; tapAt = 0; }

  /**
   * One applied read.
   * @param rec  the reader's AI log record: { at, image, round, died, match }
   * @param ctx  the reader's guarded context as it stands (matchContext)
   */
  // The reader's last context, for the recorder's corner reads between reads.
  let last = null;           // { rec, ctx }
  let lastAt = 0;            // the newest time handed to the live rating
  let tapAt = 0;             // when the recorder's page last sent rows
  const TAP_FRESH_MS = 1500;

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

  /**
   * One applied read of the reader: its context, and its own frame's kill
   * feed unless the recorder's page is sending the feed itself (tap), five
   * times a second, in which case the read's frame is not even decoded.
   */
  function frame(rec, ctx) {
    if (!rec || !Number.isFinite(rec.at)) return;
    const c = ctx || {};
    // A new match is the live rating's own to tell (the reader's match id and
    // a lower score); a match that resumes keeps its rating.
    if (!live) live = createLiveRating({ queue: c.gameMode === 'swiftplay' ? 'swiftplay' : null, meAgent: c.agentConfirmed ? c.agent : null });
    match = rec.match || match;
    last = { rec, ctx: { ...c } };
    let det = null;
    const tapping = rec.at - tapAt < TAP_FRESH_MS || Date.now() - tapAt < TAP_FRESH_MS;
    if (!tapping && typeof rec.image === 'string' && rec.image && typeof d.decode === 'function') {
      try {
        const got = d.decode(rec.image);
        if (got && got.img) det = killfeed.detect(got.img, got.H);
      } catch { det = null; }
    }
    // A read is applied a second or so after its frame was taken: its time
    // never goes back past a corner the recorder already sent.
    lastAt = Math.max(lastAt, rec.at);
    live.frame(fields(rec, c, lastAt, det));
  }

  /**
   * The recorder page's read of the kill feed's corner (recorder.js setFeed),
   * five times a second: its rows with the reader's last context.
   * @param m { at, H, list }
   */
  function tap(m) {
    if (!m || !Number.isFinite(m.at) || !Array.isArray(m.list) || !last || !live) return false;
    tapAt = m.at;
    lastAt = Math.max(lastAt, m.at);
    const list = m.list.filter((r) => r && (r.killer === 'ally' || r.killer === 'enemy') && (r.victim === 'ally' || r.victim === 'enemy')
      && Number.isInteger(r.slot) && r.sig && typeof r.sig === 'object')
      .map((r) => ({ slot: r.slot, killer: r.killer, victim: r.victim, mine: r.mine === 'kill' || r.mine === 'death' ? r.mine : null,
        sig: { v: Number(r.sig.v) || 0, r: Number(r.sig.r) || 0, g: Number(r.sig.g) || 0, b: Number(r.sig.b) || 0 } }));
    // The read's own died flag belongs to its read alone.
    live.frame(fields({ ...last.rec, died: false }, last.ctx, lastAt, { list }));
    return true;
  }

  /** What a window may show, or null with nothing rated yet. */
  function view() {
    return live ? pick(live.view()) : null;
  }

  /*
   * THE GATES, main's whole decision in one place (index.js calls these and
   * nothing else): with the switch off a frame is not read, what was kept
   * goes, and no field and no widget payload exist.
   */
  /** One applied read, only while the switch is on; off, everything kept goes. */
  function feed(rec, ctx, gate) {
    if (!gate || gate.on !== true) { reset(); return false; }
    frame(rec, ctx);
    return true;
  }
  /** The recorder's corner rows, only while the switch is on. */
  function feedTap(m, gate) {
    if (!gate || gate.on !== true) { reset(); return false; }
    return tap(m);
  }
  /** PUSH_LIVE's `rating`: only with the switch on and a match under way, else undefined (no key). */
  function field(gate) {
    if (!gate || gate.on !== true || gate.inMatch !== true) return undefined;
    return view() || undefined;
  }
  /**
   * The widget's payload, or null with either switch off (the server is
   * stopped then). Mid match the live view; between matches nothing, but for
   * a short while after one whose confirmed rating came in, "Full time".
   */
  function widget(gate) {
    const g = gate || {};
    if (g.on !== true || g.stream !== true) return null;
    if (g.inMatch === true) { const v = view(); return v ? { state: 'live', rating: v } : { state: 'idle' }; }
    const ft = g.fullTime;
    if (ft && typeof ft.value === 'number' && Number.isFinite(g.now) && g.now < ft.until) {
      return { state: 'final', rating: { value: ft.value, shown: ft.value.toFixed(1), tier: rating.tierOf(ft.value) } };
    }
    return { state: 'idle' };
  }

  /** The match ended (the reader's watch): its live final kept for the review to be logged against. */
  function end(id) {
    if (!live || !id) return null;
    const evs = live.events().filter((e) => e.kind === 'kill' && e.out && !e.out.ignored);
    const kept = { value: live.value(), at: Date.now(), rounds: live.snapshot().rounds,
      kills: evs.filter((e) => e.killer === 'me').length, deaths: evs.filter((e) => e.victim === 'me').length, events: live.events().length };
    finals.set(id, kept);
    while (finals.size > KEEP_FINALS) finals.delete(finals.keys().next().value);
    return kept;
  }

  /**
   * The review's confirmed rating against the live final of its match, the
   * line the AI log keeps: { match, live, confirmed, gap, rounds, kills, deaths, version } or null.
   */
  function compare(id, confirmed) {
    const f = finals.get(id);
    if (!f || !confirmed || typeof confirmed.value !== 'number') return null;
    return { match: id, live: f.value, confirmed: confirmed.value, gap: Math.round((f.value - confirmed.value) * 10) / 10,
      liveRounds: f.rounds, confirmedRounds: confirmed.rounds || null, liveKills: f.kills, liveDeaths: f.deaths, version: confirmed.version || null };
  }

  return { frame, tap, feed, feedTap, field, widget, view, end, compare, reset, finalOf: (id) => finals.get(id) || null, active: () => !!live };
}

module.exports = { createLiveRatingService, pick };
