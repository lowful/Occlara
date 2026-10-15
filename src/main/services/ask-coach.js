'use strict';

/**
 * ASK COACH, MAIN'S HALF (8.5.0): which match a question is about, what the
 * page may list, the hold, what is sent, and the one time fill.
 *
 * index.js's chat() and the fill live here, with everything they read handed
 * in (deps), so test:chatcontext runs them on fakes: no Electron, no network.
 *
 *   NOTHING MID MATCH. A question asked while a match is being played is
 *   refused here, before any request (matchInProgress()): Ask Coach is a page
 *   a second monitor could show, and the seal already hides it.
 *   NOTHING OF A HELD MATCH. A review saved after a Stop in the middle of its
 *   match (chat-context.js held) may be of a match still being played: never
 *   the default, never listed, refused when "Ask about this match" names it,
 *   and frame chat refuses its frames, until Riot's record links it, a later
 *   match is recorded, or 90 minutes pass.
 *   WHICH MATCH, IN CODE. The seeded or picked review, else the newest of the
 *   game, and a question naming a map moves it only by the map rule
 *   (chat-context.js pickMatch); a question naming a map two of the ten share
 *   is answered by asking which, with no model call.
 *   BOTH SHAPES. The v2 context (chat-context.js build) and today's fields
 *   beside it, so a server that does not serve v2 answers as it always did.
 *   Today's fields lose what was never to be sent: the engine's match memory,
 *   the tracker's _riotId, the match list's 0 to 100 rating.
 *   THE FILL, ONCE. A linked review saved before 8.5.0 has no kill feed, no
 *   plant time and no comps, though Riot's round record has them: Ask Coach
 *   opening on it asks /match-rounds once (purpose=fill, the connected Riot ID
 *   only), three seconds after any other HenrikDev request of this app, never
 *   mid match, never for a held match and never while the backfill or a
 *   review's own link is at work, and stores those fields and the stamp
 *   alone (chat-context.js applyRoundRecord). An answer that will not change
 *   stamps it asked, never asked again; a 503 asks again on the next open.
 */

const chatContext = require('../../shared/chat-context');
const patternsOf = require('../../shared/patterns');
const breakdownOf = require('../../shared/breakdown');

// Every review the breakdown counts (review-store.js MAX_REVIEWS), when a held
// match's are left out of it.
const LIBRARY_MAX = 300;

const MID_MATCH = 'A match is in progress. Ask Coach is back once it ends.';
const HELD_FRAME = 'This match may still be going on. Ask about its frames once Riot\'s record has it, or in 90 minutes.';
const FILL_GAP_MS = 3000;
// How long a question waits for a fill already under way before it is asked without it.
const FILL_WAIT_MS = 8000;
const CHAT_TIMEOUT_MS = 50000;

class AskCoach {
  /**
   * @param deps.store           get(key)
   * @param deps.api             get(path, key, ms), post(path, body, key, ms)
   * @param deps.reviews         list(game?), get(id), recent(game, n), saveFilled({ id, game, at, review })
   * @param deps.present         the review as a window is shown it (index.js present())
   * @param deps.matchInProgress () => boolean
   * @param deps.game            () => the game chosen in Settings
   * @param deps.patterns        (game) => patterns.js summarise() of the library
   * @param deps.breakdown       (game) => breakdown.js build() of the library
   * @param deps.tracker         async () => the tracker profile, or null
   * @param deps.recentMatches   async () => the tracker's recent matches
   * @param deps.countable       (review) => insights.countable(review)
   * @param deps.playbookMode    () => 'on' | 'off' | ...
   * @param deps.connectedRiotId () => the Riot ID Connect proved, or null
   * @param deps.busy            () => the backfill or a review's own link is at work
   * @param deps.lastHenrikAt    () => when this app last asked HenrikDev for something, in ms
   * @param deps.language        () => the player's language code
   * @param deps.advanced        () => Advanced coaching on
   * @param deps.failureText     (status, data) => a failed call in words (index.js chatFailureText)
   * @param deps.lastShownKind   () => the game of the review last shown, for "played before"
   * @param deps.now, deps.sleep, deps.log
   */
  constructor(deps) {
    this.d = deps;
    this.pick = { id: null, how: null };
    this.filling = new Map();
    this.lastFillAt = 0;
  }

  now() { return this.d.now ? this.d.now() : Date.now(); }

  rows() {
    try { return (this.d.reviews.list() || []).filter(Boolean); } catch { return []; }
  }

  /** The library row of a review, or null. */
  row(id) {
    return this.rows().find((r) => r.id === id) || null;
  }

  /** Whether a review is held now (chat-context.js held). */
  isHeld(id) {
    const rows = this.rows();
    const row = rows.find((r) => r.id === id);
    return !!row && chatContext.held(row, rows, this.now());
  }

  /** The game the page is on: a picked or seeded review's, else Settings'. */
  game() {
    const row = this.pick.id ? this.row(this.pick.id) : null;
    return (row && row.game) || this.d.game();
  }

  /**
   * The ten newest of the game, held ones left out, as the page names them,
   * and the match "Ask about this match" or the chip named when it is older
   * than those ten: it stays the match. Without it, asking about the player's
   * eleventh review answered about the newest (the verifier's probe, 15 Oct).
   */
  list(game) {
    const g = game || this.game();
    const rows = this.rows();
    const out = chatContext.chatList(rows, g, this.now());
    const id = this.pick.id;
    if (id && !out.some((r) => r.id === id)) {
      const row = rows.find((r) => r.id === id);
      if (row && (!g || row.game === g) && !chatContext.held(row, rows, this.now())) out.push(row);
    }
    return out;
  }

  /** The match the page is on: { id, how }, the newest when nothing is chosen. */
  chosen(list) {
    const rows = list || this.list();
    if (this.pick.how === 'none') return { id: null, how: 'none' };
    if (this.pick.id && rows.some((r) => r.id === this.pick.id)) return { id: this.pick.id, how: this.pick.how };
    return { id: rows[0] ? rows[0].id : null, how: 'newest' };
  }

  /** What the page paints: the list, the match chosen and its starters. */
  matches() {
    const game = this.game();
    const list = this.list(game);
    const chosen = this.chosen(list);
    const entry = chosen.id ? this.d.reviews.get(chosen.id) : null;
    if (entry) this.fillSoon(entry.id);
    return {
      game,
      list: list.map(chatContext.labelOf),
      chosen,
      current: chosen.id ? chatContext.labelOf(list.find((r) => r.id === chosen.id)) : null,
      starters: entry ? chatContext.startersOf(entry.review) : null,
    };
  }

  /** The chip: a review's id, 'none' for general questions, or null for the newest. */
  choose(id) {
    if (id === 'none') this.pick = { id: null, how: 'none' };
    else if (typeof id === 'string' && id && this.list().some((r) => r.id === id)) this.pick = { id, how: 'picked' };
    else this.pick = { id: null, how: null };
    return this.matches();
  }

  /** Opened from the sidebar: the newest. */
  plain() {
    this.pick = { id: null, how: null };
  }

  /**
   * "Ask about this match" (OPEN_CHAT_SEEDED { reviewId, round? }): the
   * review picked, or, held, refused with when its hold lifts. What the page
   * takes once (CHAT_SEED).
   */
  seed(seed) {
    const id = seed && typeof seed.reviewId === 'string' ? seed.reviewId : null;
    const entry = id ? this.d.reviews.get(id) : null;
    if (!entry) return null;
    const rows = this.rows();
    const row = rows.find((r) => r.id === id);
    if (row && chatContext.held(row, rows, this.now())) {
      return { reviewId: id, held: true, until: chatContext.holdEndsAt(row) };
    }
    this.pick = { id, how: 'seeded' };
    const g = entry.review.game || {};
    return {
      reviewId: id,
      round: Number.isInteger(seed.round) && seed.round > 0 && seed.round <= 40 ? seed.round : null,
      title: [g.map, g.agent || g.champion, g.score].filter(Boolean).join(' ') || 'last',
      ...chatContext.startersOf(entry.review),
    };
  }

  /** The fill of a review, started and not waited for. */
  fillSoon(id) {
    this.fill(id).catch(() => {});
  }

  /** The one time fill (8.10): 'filled', 'asked', 'retry', or why it did not ask. */
  fill(id) {
    if (this.filling.has(id)) return this.filling.get(id);
    const run = this.fillOnce(id)
      .catch((e) => { this.log('[chat] the fill failed:', e && e.message); return 'error'; })
      .finally(() => this.filling.delete(id));
    this.filling.set(id, run);
    return run;
  }

  log(...a) { try { (this.d.log || console.log)(...a); } catch { /* never the question's problem */ } }

  async fillOnce(id) {
    const d = this.d;
    if (d.matchInProgress()) return 'mid-match';
    const entry = d.reviews.get(id);
    if (!entry || entry.game !== 'valorant') return 'none';
    if (this.isHeld(id)) return 'held';
    if (!chatContext.needsFill(entry.review)) return 'done';
    const riotId = d.connectedRiotId();
    if (!riotId) return 'no-id';
    if (d.busy()) return 'busy';
    const wait = Math.max(Number(d.lastHenrikAt()) || 0, this.lastFillAt) + FILL_GAP_MS - this.now();
    if (wait > 0) await d.sleep(wait);
    if (d.matchInProgress()) return 'mid-match';
    if (d.busy()) return 'busy';
    this.lastFillAt = this.now();
    const path = `/api/coach/match-rounds?matchId=${encodeURIComponent(entry.review.matchId)}`
      + `&username=${encodeURIComponent(riotId)}&purpose=fill`;
    let res = null;
    try { res = await d.api.get(path, d.store.get('licenseKey'), 30000); } catch { return 'unreachable'; }
    const data = res && res.data;
    if (!res || res.status === 503 || res.status === 429) return 'retry';
    // Read again: nothing between this read and the save, so a version the
    // review's own work saved meanwhile is never written over.
    const fresh = d.reviews.get(id);
    if (!fresh || fresh.review.matchId !== entry.review.matchId || !chatContext.needsFill(fresh.review)) return 'done';
    if (res.ok && data && !data.error && Array.isArray(data.perRound) && data.perRound.length) {
      d.reviews.saveFilled({ id: fresh.id, game: fresh.game, at: fresh.at, review: chatContext.applyRoundRecord(fresh.review, data, this.now()) });
      this.log(`[chat] filled ${fresh.id} from Riot's round record`);
      return 'filled';
    }
    if (chatContext.fillRefused(data)) {
      d.reviews.saveFilled({ id: fresh.id, game: fresh.game, at: fresh.at, review: { ...fresh.review, roundRecordAsked: this.now() } });
      this.log(`[chat] Riot's round record of ${fresh.id} will not change; not asked again`);
      return 'asked';
    }
    return 'retry';
  }

  /** A fill under way for this review, waited for a few seconds at most. */
  async fillWait(id) {
    const entry = this.d.reviews.get(id);
    if (!entry || !chatContext.needsFill(entry.review)) return;
    const run = this.fill(id);
    let timer = null;
    await Promise.race([run, new Promise((r) => { timer = setTimeout(r, FILL_WAIT_MS); })]);
    clearTimeout(timer);
  }

  /**
   * The library's patterns and breakdown as the chat is told them, A HELD
   * MATCH'S COUNTS LEFT OUT. Its mistakes and numbers went into "across your
   * last matches" while that match may still be being played (the verifier's
   * probe, 15 Oct): the hold kept it from being the topic and nothing else.
   * With nothing held they are the library's own (index.js getPatterns,
   * getBreakdown), as Home and Matches show them.
   */
  library(game) {
    const d = this.d;
    const rows = this.rows();
    const now = this.now();
    const held = new Set(rows.filter((r) => chatContext.held(r, rows, now)).map((r) => r.id));
    if (!held.size) return { patterns: safe(() => d.patterns(game)), breakdown: safe(() => d.breakdown(game)) };
    const recent = (n) => (safe(() => d.reviews.recent(game, n)) || []).filter((e) => e && e.review && !held.has(e.id));
    return {
      patterns: safe(() => ({ game, ...patternsOf.summarise(recent(patternsOf.LOOK_BACK)) })),
      breakdown: safe(() => breakdownOf.build(game, recent(LIBRARY_MAX), { queue: 'All' })),
    };
  }

  /** Today's fields, as a server that does not read v2 answers from them. */
  async oldShape(game, entry, review, tracker) {
    const d = this.d;
    const valorant = game === 'valorant';
    const rows = this.rows();
    const hasSessionData = rows.some((r) => r.game === game) || d.lastShownKind() === game;
    let recentMatches = [];
    if (valorant) {
      try {
        recentMatches = ((await d.recentMatches()) || []).slice(0, 5).map((m) => ({
          map: m.map, agent: m.agent, result: m.result, score: m.score,
          kills: m.kills, deaths: m.deaths, assists: m.assists,
          kd: m.kd, acs: m.acs, adr: m.adr, headshotPct: m.headshotPct,
          queue: m.queue,
          when: m.startedAt
            ? new Date(m.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : null,
        }));
      } catch { recentMatches = []; }
    }
    const recentSessions = (d.reviews.recent(game, 6) || []).filter((e) => e && !this.isHeld(e.id)).slice(0, 3).map((e) => ({
      date: new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      map: e.review.game && e.review.game.map, overall: e.review.grade && e.review.grade.score,
      scores: Object.fromEntries(((e.review.grade && e.review.grade.categories) || []).map((c) => [c.key, c.score])),
      strengths: d.countable(e.review).strengths.slice(0, 2).map((x) => x.title).join('. '),
      weaknesses: d.countable(e.review).mistakes.slice(0, 2).map((x) => x.title).join('. '),
    }));
    return {
      game,
      agent: valorant && review ? ((review.game && review.game.agent) || null) : null,
      sessionTips: [],
      matchMemory: [],
      stats: valorant ? chatContext.oldStats(tracker) : null,
      noSessionYet: !hasSessionData,
      recentMatches,
      recentSessions,
      matchReview: entry && review ? chatContext.oldText(entry.game, entry.at, review) : null,
      proPlaybook: valorant ? d.playbookMode() : 'off',
    };
  }

  /**
   * One question. `opts.reviewId` is the match on the page's chip, or 'none';
   * main's own pick when the page sends none.
   *
   * @returns { ok: true, reply, honest, match, moved, from }
   *        | { ok: true, which: { map, count }, match } | { ok: true, none: { map }, match }
   *        | { ok: false, kind: 'mid-match' | 'held' | 'chat-daily' | 'error', error, resetsAt?, until? }
   */
  async chat(messages, opts) {
    const d = this.d;
    const key = d.store.get('licenseKey');
    if (!key) return { ok: false, kind: 'error', error: 'No license active.' };
    // NOTHING MID MATCH, not even the request.
    if (d.matchInProgress()) return { ok: false, kind: 'mid-match', error: MID_MATCH };
    const thread = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 1200) }));
    const last = [...thread].reverse().find((m) => m.role === 'user');
    if (!last) return { ok: false, kind: 'error', error: 'Ask a question first.' };
    const o = opts || {};
    if (o.reviewId === 'none') this.pick = { id: null, how: 'none' };
    else if (typeof o.reviewId === 'string' && o.reviewId && o.reviewId !== this.pick.id) {
      if (this.isHeld(o.reviewId)) {
        const row = this.row(o.reviewId);
        return { ok: false, kind: 'held', until: chatContext.holdEndsAt(row) };
      }
      if (this.row(o.reviewId)) this.pick = { id: o.reviewId, how: this.pick.how === 'seeded' && this.pick.id === o.reviewId ? 'seeded' : 'picked' };
    }
    if (this.pick.id && this.isHeld(this.pick.id)) {
      const row = this.row(this.pick.id);
      return { ok: false, kind: 'held', until: chatContext.holdEndsAt(row) };
    }
    const game = this.game();
    const list = this.list(game);
    const chosen = this.chosen(list);
    const pick = chatContext.pickMatch(last.content, chosen, list);
    const label = (id) => chatContext.labelOf(list.find((r) => r.id === id) || null);
    // A map two of the ten share, or none of them: asked, with no model call.
    if (pick.which) return { ok: true, which: pick.which, match: label(chosen.id) };
    if (pick.none) return { ok: true, none: pick.none, match: label(chosen.id) };
    let send = thread;
    let from = null;
    if (pick.moved) {
      from = list.find((r) => r.id === pick.from) || null;
      this.pick = { id: pick.id, how: 'picked' };
      // The thread was about another match: only the question goes.
      send = [last];
    }
    let entry = pick.id ? d.reviews.get(pick.id) : null;
    if (entry) {
      await this.fillWait(entry.id);
      if (d.matchInProgress()) return { ok: false, kind: 'mid-match', error: MID_MATCH };
      entry = d.reviews.get(entry.id);
    }
    const review = entry ? d.present(entry.review) : null;
    const tracker = game === 'valorant' ? await Promise.resolve().then(() => d.tracker()).catch(() => null) : null;
    const context = {
      ...(await this.oldShape(game, entry, review, tracker)),
      ...chatContext.build(review, { rows: this.rows(), ...this.library(game) },
        tracker, last.content, { game, language: d.language(), advanced: d.advanced(), switchedFrom: from, now: this.now() }),
    };
    // Asked again here: the fill and the tracker took time, and a match may have begun.
    if (d.matchInProgress()) return { ok: false, kind: 'mid-match', error: MID_MATCH };
    let res;
    try {
      res = await d.api.post('/api/coach/chat', { messages: send, context }, key, CHAT_TIMEOUT_MS);
    } catch (e) {
      this.log('[chat] failed:', e && e.message);
      return { ok: false, kind: 'error', error: 'Could not reach the coach server.' };
    }
    const data = (res && res.data) || {};
    const match = label(pick.id);
    if (res && res.ok && typeof data.reply === 'string' && data.reply) {
      return { ok: true, reply: data.reply, honest: !!data.honest, match, moved: !!pick.moved, from: from ? chatContext.labelOf(from) : null };
    }
    if (res && res.status === 429 && data.error === 'chat-daily') {
      const at = Date.parse(data.resetsAt);
      return { ok: false, kind: 'chat-daily', resetsAt: Number.isFinite(at) ? at : null, error: d.failureText(429, data) };
    }
    this.log(`[chat] status=${res && res.status} ${(data && (data.error || data.message)) || 'no reply'}`);
    return { ok: false, kind: 'error', error: d.failureText(res && res.status, data) };
  }

  /**
   * A frame of the AI log, for its chat: held when it is a held match's, and
   * its round's facts from Riot's record when its match is linked. Matched to
   * a review by the review's place in the log (8.2, aiLog).
   */
  frame(session, record) {
    const rows = this.rows();
    const rec = record || {};
    const row = rows.find((r) => r && r.game === 'valorant' && r.aiLog && r.aiLog.session === session
      && (rec.match === r.aiLog.match || (typeof rec.at === 'number' && rec.at >= r.aiLog.from && rec.at <= r.aiLog.to)));
    if (!row) return { held: false, riot: null };
    if (chatContext.held(row, rows, this.now())) return { held: true, until: chatContext.holdEndsAt(row), riot: null };
    if (!row.verified || !Number.isInteger(rec.round)) return { held: false, riot: null };
    const e = this.d.reviews.get(row.id);
    const card = e && Array.isArray(e.review.rounds) ? e.review.rounds.find((c) => c && c.n === rec.round) : null;
    if (!card || !card.riot) return { held: false, riot: null };
    const r = card.riot;
    const site = /^[ABC]$/.test(String(r.plantSite || '')) ? r.plantSite : null;
    return {
      held: false,
      riot: {
        round: card.n,
        won: card.result === 'won' ? true : card.result === 'lost' ? false : null,
        died: !!card.died,
        sec: typeof r.sec === 'number' ? r.sec : null,
        killer: r.killer || null,
        weapon: r.weapon || null,
        firstDeath: !!r.firstDeath,
        traded: typeof r.traded === 'boolean' ? r.traded : null,
        alive: r.alive || null,
        plantSite: site,
        afterPlant: !!r.afterPlant,
      },
    };
  }
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

module.exports = { AskCoach, MID_MATCH, HELD_FRAME, FILL_GAP_MS, FILL_WAIT_MS, CHAT_TIMEOUT_MS };
