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

  function reset() { live = null; match = null; }

  /**
   * One applied read.
   * @param rec  the reader's AI log record: { at, image, round, died, match }
   * @param ctx  the reader's guarded context as it stands (matchContext)
   */
  function frame(rec, ctx) {
    if (!rec || !Number.isFinite(rec.at)) return;
    const c = ctx || {};
    // A new match is the live rating's own to tell (the reader's match id and
    // a lower score); a match that resumes keeps its rating.
    if (!live) live = createLiveRating({ queue: c.gameMode === 'swiftplay' ? 'swiftplay' : null, meAgent: c.agentConfirmed ? c.agent : null });
    match = rec.match || match;
    let det = null;
    if (typeof rec.image === 'string' && rec.image && typeof d.decode === 'function') {
      try {
        const got = d.decode(rec.image);
        if (got && got.img) det = killfeed.detect(got.img, got.H);
      } catch { det = null; }
    }
    live.frame({
      at: rec.at, match: rec.match || null, round: Number.isInteger(rec.round) ? rec.round : null,
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
    });
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

  return { frame, feed, field, widget, view, end, compare, reset, finalOf: (id) => finals.get(id) || null, active: () => !!live };
}

module.exports = { createLiveRatingService, pick };
