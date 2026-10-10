'use strict';

/**
 * Grade the player's recent matches from Riot's record, the moment a Riot ID
 * is connected.
 *
 * A new player's library was empty until they had recorded two matches, and
 * the patterns and the grade's own role baseline with it. Riot keeps a record
 * of every match they have played, so Connect now grades the last ten in the
 * queues the grade is built for, oldest first, each against the matches before
 * it, and the next match they record is graded against their own baseline from
 * the start.
 *
 * NEVER TWICE. Every match is planned before anything is fetched (plan()): one
 * already in the library is skipped, one a recording 8.0.0 or 8.0.1 linked is
 * given the matchId those versions never kept, one a recording is still
 * linking is left to that recording, one a recording watched but never linked
 * is checked against Riot's record in place, and one a recording overlaps but
 * cannot be told apart is left alone rather than guessed. The plan places a
 * match by an estimate of its length, so once Riot's record of it is in, its
 * own start and length decide again (confirm()). A duplicate is a match
 * counted twice in every pattern and twice in the role baseline.
 *
 * ONLY THE ACCOUNT IN SETTINGS. A run is for one Riot ID, and it stops before
 * listing and before every save once Settings holds another: a typo that was
 * somebody's real account, corrected, never files their matches, and what the
 * run changed is put back (takeBack()).
 *
 * GENTLE ON THE ONE KEY. Every player shares one HenrikDev key, so requests
 * are three seconds apart, a failure that will pass is retried twice, and
 * three matches in a row that Riot did not answer end the run. It waits while
 * a match is being played: the reader's reads in flight (up to four) need the
 * bandwidth more than a match from last week does, and nothing new reaches a
 * window mid match.
 *
 * No model is called (riot-review.js says why). Plain Node with every
 * dependency injected, so test-backfill.js drives it against a fake server.
 */

const { verifyCoachedMatch, matchEndEstimate, ROUND_MS } = require('./match-link');
const { newId } = require('./review-store');
const riotReview = require('../../shared/riot-review');
const valorantReview = require('../../shared/valorant-review');

const MAX_MATCHES = 10;
const GAP_MS = 3000;
const RETRY_MS = [30000, 60000];
const WAIT_MS = 5000;
const MAX_FAILS_IN_A_ROW = 3;
// How long a run waits for the Riot ID in Settings to come back to its own
// before it stops, so a player in the middle of retyping it is not taken for
// a player who changed it.
const SETTLE_MS = 5000;
// A minute and a half for the PC clock against Riot's, on every share of
// time. Measured on the real pacing timelines in test-backfill.js: with one
// minute, a recording of only the last round on a clock two minutes fast was
// filed twice; with two, a short recording just after a match was held to it.
// Cutting the menus and queues out of a recording's window by its rounds was
// tried too and changed no timeline, so a window is taken whole.
const CLOCK_SLACK_MS = 90 * 1000;
// The queues the grade's curves were set against. The others have no rounds,
// or are played on rules the curves know nothing about.
const QUEUES = new Set(['competitive', 'unrated', 'swiftplay', 'premier']);
const SCORE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

const queueOk = (mode) => QUEUES.has(String(mode || '').toLowerCase().replace(/[^a-z]/g, ''));
const sameAccount = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// A failure that passes, the same test the server makes (upstreamTransient):
// no answer, a timeout, a rate limit, or a server error. Railway's edge
// answers 502 while the server restarts.
const passing = (status) => status === 0 || status === 408 || status === 429 || status >= 500;

function idle() {
  return { state: 'idle', account: null, found: 0, have: 0, skipped: 0, pending: 0, ambiguous: 0, old: 0,
    total: 0, done: 0, graded: 0, upgraded: 0, failed: 0, items: [], error: null, message: null };
}

/** The window, map, agent and score a saved review would be linked with. */
function windowOf(entry) {
  const r = (entry && entry.review) || {};
  const l = r.ledger || null;
  const lc = (l && l.context) || {};
  const g = r.game || {};
  const endedAt = (l && l.endedAt) || entry.meta.at;
  const watchedRounds = r.watched && typeof r.watched.rounds === 'number'
    ? r.watched.rounds : (Array.isArray(r.rounds) ? r.rounds.length : 0);
  const startedAt = (l && l.startedAt) || endedAt - (watchedRounds + 2) * ROUND_MS;
  const m = SCORE_RE.exec(String(g.score || ''));
  const team = typeof lc.teamScore === 'number' ? lc.teamScore : m ? Number(m[1]) : 0;
  const enemy = typeof lc.enemyScore === 'number' ? lc.enemyScore : m ? Number(m[2]) : 0;
  return {
    startedAt,
    endedAt,
    mctx: {
      map: lc.map || g.map || null,
      // Only an agent the player confirmed, the rule linkRiotRecord keeps. A
      // review saved before the ledger existed cannot say, so it offers none.
      agent: l && lc.agentConfirmed ? lc.agent || null : null,
      score: { team, enemy, final: ((l && l.endedBy) || r.endedBy) === 'score' },
    },
  };
}

/**
 * The span each listed match can have been played in, from Riot's start: to
 * Riot's own length once its round record is in (`real`, matchId ->
 * { start, end }), until then 100 seconds a round, which a real match misses
 * by minutes either way. Never past the next listed match's start, because a
 * player cannot be in two matches at once.
 */
function spansOf(rows, real) {
  const spans = rows.map((row) => {
    const r = real ? real.get(row.matchId) : null;
    const start = r ? r.start : (row.startedAt || 0);
    return { start, end: r ? r.end : (matchEndEstimate(row) || start), real: !!r };
  });
  for (const s of spans) {
    for (const t of spans) if (t.start > s.start && t.start < s.end) s.end = t.start;
  }
  return spans;
}

/** How much of a recording's window lies inside a span, with slack for the two clocks. */
function shared(span, w) {
  return Math.min(span.end, w.endedAt) - Math.max(span.start, w.startedAt) + CLOCK_SLACK_MS;
}

/**
 * The recordings a listed match can be: Valorant, not Riot's own, never
 * linked. Only what the claims need is kept, not the whole review, because a
 * run holds these for its whole length, waits out a match included.
 */
function openOf(library) {
  return (Array.isArray(library) ? library : [])
    .filter((e) => e && e.meta && !e.meta.matchId && e.meta.source !== 'riot' && e.review && e.review.kind === 'valorant')
    .map((e) => ({ id: e.meta.id, verified: !!e.review.verified, w: windowOf(e) }));
}

/**
 * Which listed matches each recording claims. ITS OWN MATCH IS THE ONE THAT
 * SHARES THE MOST OF ITS WINDOW, and at least half of it. A recording opens in
 * the menus or in agent select, often inside the estimate of the match before,
 * and any share at all used to be a claim: back to back matches claimed each
 * other, and a match nobody recorded beside one that was could never be
 * graded. It also claims any match it covers half of: a window that holds an
 * hour of menus before its match, and one that ran through two matches.
 *
 * A SHARE THAT IS MOSTLY CLOCK SLACK DECIDES NOTHING. A stop two minutes
 * into a match, on a PC clock two minutes slow, lies across the seam: the
 * match before won it by the slack alone, the stub was checked against that
 * match's record, and its own match was filed again beside it. When the best
 * share is under twice the slack, any match within two slacks of it is the
 * recording's too, and both are left alone.
 *
 * `near` is every match within two slacks of a recording's best share. A
 * recording whose own link is still running holds all of those back (a stop
 * keeps trying for over half an hour, so its match can be listed meanwhile),
 * because filed now, the match would be in the library twice once the link
 * lands, or refused by it.
 */
function claimsOf(rows, open, real) {
  const spans = spansOf(rows, real);
  const claims = new Map();   // row index -> [{ id, verified, fits }]
  const claimed = new Map();  // review id -> [row index]
  const near = new Map();     // row index -> [review id]
  for (const { id, verified, w } of open) {
    const seen = w.endedAt - w.startedAt;
    const shares = spans.map((s) => shared(s, w));
    const best = Math.max(0, ...shares);
    const shaky = best < 2 * CLOCK_SLACK_MS;
    rows.forEach((row, i) => {
      const s = shares[i];
      if (s <= 0) return;
      if (best - s < 2 * CLOCK_SLACK_MS) near.set(i, [...(near.get(i) || []), id]);
      const len = spans[i].end - spans[i].start;
      const top = s === best || (shaky && s > best - 2 * CLOCK_SLACK_MS);
      const own = top && best >= seen / 2;
      if (!own && !(len > 0 && s >= len / 2)) return;
      // The link's own checks, against Riot's real end when it is known.
      const lm = spans[i].real ? { ...row, startedAt: spans[i].start, endedAt: spans[i].end } : row;
      const fits = verifyCoachedMatch(lm, w.startedAt, w.endedAt, w.mctx).ok;
      claims.set(i, [...(claims.get(i) || []), { id, verified, fits }]);
      claimed.set(id, [...(claimed.get(id) || []), i]);
    });
  }
  return { claims, claimed, near };
}

/** A listed match no review holds, from the recordings that claim it or lie near it. */
function claimStep(row, cs, claimed, active, nearIds) {
  if (active && (nearIds || []).some((id) => active.has(id))) return { row, action: 'pending' };
  if (!cs.length) return { row, action: 'new' };
  if (cs.some((c) => active && active.has(c.id))) return { row, action: 'pending' };
  const only = cs.length === 1 && cs[0].fits && (claimed.get(cs[0].id) || []).length === 1 ? cs[0] : null;
  if (!only) return { row, action: 'ambiguous' };
  return { row, action: only.verified ? 'stamp' : 'upgrade', savedId: only.id };
}

/**
 * Whether a saved scoreline is this row's: the link wrote it from the
 * player's own row, so a row for the same match with other numbers is
 * somebody else's line in it. One that cannot say is taken at its word.
 */
function sameLine(line, row) {
  const keys = ['kills', 'deaths', 'assists'];
  const known = (o) => o && keys.every((k) => typeof o[k] === 'number');
  if (!known(line) || !known(row)) return true;
  return keys.every((k) => line[k] === row[k]);
}

/**
 * What to do with each listed match, before any round record is fetched.
 *
 * A RECORDING AND A MATCH ARE THE SAME WHEN THEY SHARE THE TIME, because a
 * player cannot play two at once (claimsOf()). So a recording claims its
 * match whatever else it says. When it also passes the
 * match link's own checks (verifyCoachedMatch) and claims nothing else, it is
 * that match; otherwise the match is left alone. Before this, a recording
 * whose map lock was wrong failed the checks, its match was graded again as a
 * new review, and one match became a pattern. A linked match still takes
 * part, so a recording inside one is never handed a neighbour.
 *
 * A recording 8.0.0 or 8.0.1 linked to Riot is verified and has no matchId,
 * because those versions never stored one. It is the match already, so the
 * action is 'stamp': the id is written into it, never a second review.
 *
 * LINKED BUT NEVER CHECKED. A recording whose scoreboard linked and whose
 * round record never landed (a rate limit through all three tries, a quit
 * before the retry) holds its match with the screen's deaths for good: it is
 * an 'upgrade' in place too (`relink`), its baseline row already written by
 * the link. Unless the listed row carries another line than the one the link
 * saved: then the Riot ID is someone else who played the match, a duo
 * partner's typed by mistake, and checking against it would fill the
 * player's recording with that player's match (`held`, left alone).
 *
 * @param rows     every listed match, graded queue or not
 * @param library  [{ meta, review }]: every saved Valorant review's index row,
 *                 with the whole review for the ones not verified against Riot
 * @param active   Set of review ids whose own link is still running
 * @param real     optional Map matchId -> { start, end } from Riot's record
 * @returns [{ row, action, savedId, relink, held }], action one of
 *          'have' | 'stamp' | 'pending' | 'upgrade' | 'ambiguous' | 'new'
 */
function plan(rows, library, active, real) {
  const lib = Array.isArray(library) ? library : [];
  const held = new Map(lib.filter((e) => e && e.meta && e.meta.matchId).map((e) => [e.meta.matchId, e]));
  const { claims, claimed, near } = claimsOf(rows, openOf(lib), real);
  return rows.map((row, i) => {
    const h = held.get(row.matchId);
    if (h) {
      const unchecked = h.meta.source !== 'riot' && !h.meta.verified && h.review && h.review.kind === 'valorant';
      if (!unchecked) return { row, action: 'have' };
      if (active && active.has(h.meta.id)) return { row, action: 'pending' };
      if (!sameLine(h.review.scoreline, row)) return { row, action: 'ambiguous', held: true };
      return { row, action: 'upgrade', savedId: h.meta.id, relink: true };
    }
    return claimStep(row, claims.get(i) || [], claimed, active, near.get(i));
  });
}

function itemOf(row, status) {
  return {
    matchId: row.matchId, map: row.map || null, agent: row.agent || null, mode: row.mode || null,
    result: row.result || null, score: row.score || null, startedAt: row.startedAt || null,
    status, id: null, grade: null,
  };
}

/** Why the list could not be had, in words a player can act on. */
function whyNot(res) {
  const err = String((res && res.data && res.data.error) || '');
  if (res && (res.status === 401 || res.status === 403 || res.status === 402)) {
    return { error: 'licence', message: 'Your licence could not be checked, so nothing was graded. Try again in a minute.' };
  }
  if (/not found|Name#TAG/i.test(err)) {
    return { error: 'not-found', message: 'Riot has no account under that ID. Check the name and the tag.' };
  }
  return { error: 'unreachable', message: "Riot's record could not be reached. Try again in a few minutes from Matches." };
}

/** The closing line of a run, from its counts. */
function summary(s, stopped) {
  const n = s.graded + s.upgraded;
  const parts = [];
  if (n) parts.push(`Graded ${plural(n, 'recent match', 'recent matches')} from Riot's record.`);
  else if (stopped) parts.push("Riot's record could not be reached, so nothing was graded.");
  else if (s.failed) parts.push("None of your recent matches could be fetched from Riot's record.");
  else if (s.have && !s.pending && !s.ambiguous && !s.old) parts.push('Your recent matches are already in your library.');
  // A match graded and then too old to keep was new; the old line says why.
  else if (!s.old) parts.push('There was nothing new to grade.');
  if (s.have && (n || stopped || s.failed || s.pending || s.ambiguous || s.old)) {
    parts.push(`${plural(s.have, 'was', 'were')} already in your library.`);
  }
  if (s.failed && n) parts.push(`${plural(s.failed, 'match', 'matches')} could not be fetched.`);
  // A stop still linking holds back the match before it too, so this names
  // the wait, not whose recording each one is.
  if (s.pending) {
    parts.push(`${plural(s.pending, 'match waits', 'matches wait')} for a recording that is still being linked.`);
  }
  if (s.ambiguous) {
    parts.push(`${plural(s.ambiguous, 'match', 'matches')} could not be told apart from a recording, `
      + `so ${s.ambiguous === 1 ? 'it was' : 'they were'} left alone.`);
  }
  if (s.old) {
    parts.push(`${plural(s.old, 'match was', 'matches were')} older than anything your library keeps.`);
  }
  if (stopped && n) parts.push('Riot stopped answering, so the rest can be graded later from Matches.');
  return parts.join(' ');
}

class Backfill {
  constructor(deps) {
    this.deps = deps;
    this.status = idle();
    this.running = null;
    this.promise = Promise.resolve();
    this.lastCall = -Infinity;
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  /**
   * Grade an account's recent matches, or report the run already doing it.
   * An account that is not the one in Settings is refused: a Connect that
   * answered late, for an ID the player has since corrected, must not start.
   */
  start(account) {
    const acct = String(account || '').trim();
    if (!acct.includes('#')) return this.getStatus();
    if (this.deps.account && !sameAccount(this.deps.account(), acct)) return this.getStatus();
    if (this.running && sameAccount(this.running.account, acct)) return this.getStatus();
    // Settings holds another account now, so the run for the old one is not
    // wanted, and what it filed so far is taken back (takeBack()).
    if (this.running) { this.takeBack(this.running); this.running.cancelled = true; }
    const run = { account: acct, cancelled: false, resume: null, saved: [], changed: [], pruned: [], evicted: [],
      rowsAdded: new Set(), rows: [], open: [], real: new Map() };
    this.running = run;
    this.status = { ...idle(), state: 'listing', account: acct, message: "Finding your recent matches in Riot's record." };
    run.resume = { state: 'listing', message: this.status.message };
    this.emit();
    this.promise = this.work(run)
      .catch((e) => {
        this.deps.log('[backfill] stopped on an error:', e && e.message);
        this.update(run, { state: 'error', error: 'failed',
          message: 'Grading your recent matches stopped on an error. Try again from Matches.' });
      })
      .finally(() => { if (this.running === run) this.running = null; });
    return this.getStatus();
  }

  /** Stop at the next safe point. What is saved stays saved. */
  cancel() {
    const run = this.running;
    if (!run) return;
    run.cancelled = true;
    // SAID AT ONCE. A cancelled run stops without another word, so a status
    // left at "grading" had every window following a run that was over, with
    // the Matches button disabled under it, and a start for the same account
    // was taken for that run and did nothing.
    this.running = null;
    this.status = idle();
    this.emit();
  }

  emit() {
    try { this.deps.onStatus(this.getStatus()); } catch (e) { this.deps.log('[backfill] status push failed:', e.message); }
  }

  /** Change the status, unless a newer run owns it. */
  update(run, patch) {
    if (run !== this.running) return;
    Object.assign(this.status, patch);
    if (this.status.state !== 'waiting') run.resume = { state: this.status.state, message: this.status.message };
    this.emit();
  }

  /** Sleep in short steps, so a cancelled run lets go within seconds. */
  async pause(run, ms) {
    let left = ms;
    while (left > 0 && !run.cancelled) {
      const step = Math.min(left, WAIT_MS);
      await this.deps.sleep(step);
      left -= step;
    }
  }

  /** Wait while a match is being played. */
  async clear(run) {
    if (run.cancelled || !this.deps.inMatch()) return;
    const before = run.resume;
    this.update(run, { state: 'waiting', message: 'Waiting for your match to end. Grading carries on after it.' });
    while (!run.cancelled && this.deps.inMatch()) await this.deps.sleep(WAIT_MS);
    if (!run.cancelled && before) this.update(run, { state: before.state, message: before.message });
  }

  /**
   * Whether the Riot ID in Settings is still this run's. A different one is
   * given a few seconds to come back, because Settings saves the field as it
   * is typed; one that stays different stops the run.
   */
  async ours(run) {
    if (!this.deps.account) return !run.cancelled;
    let waited = 0;
    while (!run.cancelled && !sameAccount(this.deps.account(), run.account)) {
      if (waited >= SETTLE_MS) {
        this.takeBack(run);
        if (this.running === run) this.cancel();
        else run.cancelled = true;
        return false;
      }
      await this.deps.sleep(1000);
      waited += 1000;
    }
    return !run.cancelled;
  }

  /**
   * A RUN STOPPED BECAUSE THE RIOT ID CHANGED TAKES BACK WHAT IT DID. The
   * account was not the one the player wanted, often a typo that was somebody
   * else's real account, and its matches would sit in the library, the
   * patterns and the role baseline beside the player's own for good. So the
   * reviews it graded from Riot's record alone go, their baseline rows go,
   * and the player's own rows those pushed out of the ten come back. The
   * recordings it checked in place or stamped are put back as they were:
   * checked against a duo partner's ID they carry that player's kills and
   * agent. And the reviews its saves pushed out of a full library, of any
   * game, are saved again whole, frames and all. A run that finished keeps
   * everything.
   */
  takeBack(run) {
    const d = this.deps;
    if (!run) return;
    const take = (key) => (Array.isArray(run[key]) ? run[key].splice(0) : []);
    const saved = take('saved');
    const changed = take('changed');
    const added = run.rowsAdded instanceof Set ? run.rowsAdded : new Set();
    run.rowsAdded = new Set();
    const pruned = take('pruned');
    const ours = new Set(saved.map((s) => s.id));
    const evicted = new Map(take('evicted').filter((e) => e && !ours.has(e.id)).map((e) => [e.id, e]));
    if (!saved.length && !changed.length && !added.size && !evicted.size) return;
    // Removed first, so what is put back never pushes anything out again.
    for (const s of saved) {
      try { if (d.remove) d.remove(s.id); } catch (e) { d.log('[backfill] could not take back', s.id, e && e.message); }
    }
    for (const c of changed.reverse()) {
      const gone = evicted.get(c.id);
      evicted.delete(c.id);
      try {
        if (gone && d.restore) d.restore({ ...gone, review: c.before });
        else d.save(c.before);
      } catch (e) { d.log('[backfill] could not put back', c.before && c.before.id, e && e.message); }
    }
    // Last pushed out first: two reviews of the same moment go back in the
    // order the index had them.
    for (const e of [...evicted.values()].reverse()) {
      try { if (d.restore) d.restore(e); } catch (err) { d.log('[backfill] could not put back', e.id, err && err.message); }
    }
    try {
      const rows = (d.history.get() || []).filter((h) => !(h && h.matchId && added.has(h.matchId)));
      const back = pruned.filter((p) => !(p.matchId && rows.some((h) => h && h.matchId === p.matchId)));
      d.history.set([...rows, ...back].sort((a, b) => ((a && a.at) || 0) - ((b && b.at) || 0))
        .slice(-valorantReview.BASELINE_GAMES));
    } catch (e) { d.log('[backfill] could not put the baseline back', e && e.message); }
    d.log(`[backfill] took back ${saved.length} reviews and put back ${changed.length + evicted.size} for ${run.account}, `
      + 'which is no longer the Riot ID in Settings');
  }

  /** One request, at least GAP_MS after the last. Never throws. */
  async get(run, path, timeoutMs) {
    const wait = this.lastCall + GAP_MS - this.deps.now();
    if (wait > 0) await this.pause(run, wait);
    // A run cancelled while it waited for its turn lets go here. Sent anyway,
    // the request fetched a record for an account nobody was asking about any
    // more, in the same second as the first request of the run that took over.
    if (run.cancelled) return { ok: false, status: 0, data: null };
    this.lastCall = this.deps.now();
    try {
      return (await this.deps.get(path, timeoutMs)) || { ok: false, status: 0, data: null };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e && e.message };
    }
  }

  /** A request, asked again while its failure is one that passes. */
  async getRetrying(run, path, timeoutMs) {
    let res = null;
    for (let i = 0; i <= RETRY_MS.length; i++) {
      if (i) await this.pause(run, RETRY_MS[i - 1]);
      if (run.cancelled) return res;
      await this.clear(run);
      if (run.cancelled) return res;
      res = await this.get(run, path, timeoutMs);
      if (!passing(res.status)) return res;
    }
    return res;
  }

  /** The recent matches on the account, or why there are none. */
  async list(run) {
    const q = '?username=' + encodeURIComponent(run.account);
    let res = await this.getRetrying(run, '/api/coach/recent-matches' + q, 20000);
    if (run.cancelled) return null;
    if (res && res.status === 404) {
      // A server from before the route: the newest match and the four before it.
      res = await this.getRetrying(run, '/api/coach/last-match' + q, 30000);
      if (run.cancelled) return null;
      const lm = res && res.ok && res.data && !res.data.error ? res.data : null;
      if (lm) return { rows: [lm, ...(Array.isArray(lm.recent) ? lm.recent : [])] };
      if (res && res.ok && res.data && /no recent match/i.test(String(res.data.error || ''))) return { rows: [] };
      // That route says "Account not found." for any failed region lookup, a
      // rate limit included, so from it that is no proof the ID is wrong, and
      // must not cost a real account its kept profile.
      const why = whyNot(res);
      return { error: why.error === 'not-found' ? whyNot(null) : why };
    } else if (res && res.ok && res.data && Array.isArray(res.data.matches)) {
      return { rows: res.data.matches };
    }
    return { error: whyNot(res) };
  }

  /**
   * Riot's round record of one match: { riot }, or { failure } saying which
   * kind. A failure that would have passed and did not (a rate limit, no
   * answer, a server error) says Riot is not answering, and three in a row
   * end the run. One that will not change on a retry ("this Riot ID is not
   * in that match") says nothing about the next match, so it never counts.
   */
  async rounds(run, row) {
    const path = `/api/coach/match-rounds?matchId=${encodeURIComponent(row.matchId)}`
      + `&username=${encodeURIComponent(run.account)}`;
    const res = await this.getRetrying(run, path, 30000);
    const d = res && res.ok ? res.data : null;
    if (d && !d.error && Array.isArray(d.perRound) && d.perRound.length) return { riot: d };
    return { failure: !res || passing(res.status) ? 'passing' : 'lasting' };
  }

  /** The index rows, and one whole review: the cheap reads a step needs. */
  metas() {
    const d = this.deps;
    return d.metas ? d.metas() : d.library().map((e) => e && e.meta).filter(Boolean);
  }

  whole(id) {
    const d = this.deps;
    return d.whole ? d.whole(id) : ((d.library().find((e) => e && e.meta && e.meta.id === id) || {}).review || null);
  }

  /**
   * The review for one planned match: false when it is no longer this run's
   * to save. THE INDEX ANSWERS "LINKED ALREADY?", and only the review an
   * upgrade rewrites is read whole: reading every unlinked recording before
   * each match was thousands of JSON parses on the main process for a player
   * with a long library.
   */
  build(step, riot, account) {
    const d = this.deps;
    const metas = this.metas();
    // Another review holds the match: only a relink's own review may.
    const holder = metas.find((m) => m && m.matchId === step.row.matchId);
    if (holder && !(step.relink && holder.id === step.savedId)) return false;
    const history = d.history.get() || [];
    if (step.action === 'upgrade') {
      const meta = metas.find((m) => m && m.id === step.savedId);
      const review = meta ? this.whole(step.savedId) : null;
      const linkedElsewhere = meta && meta.matchId && !(step.relink && meta.matchId === step.row.matchId);
      if (!meta || !review || review.verified || linkedElsewhere || d.activeIds().has(step.savedId)) return false;
      const out = riotReview.upgradeWatched({ saved: { id: meta.id, at: meta.at, review },
        row: step.row, riot, history, account });
      // A scoreboard link wrote its baseline row then (8.0.0 and 8.0.1 without
      // a matchId, later ones with it). A second row would count the match twice.
      out.hadBaseline = !!review.scoreline || !!step.relink;
      out.before = review;
      return out;
    }
    const out = riotReview.fromRiot({ row: step.row, riot, history, account });
    out.review.id = newId('valorant', out.review.at);
    return out;
  }

  /**
   * A recording given the matchId its match has, and Riot's name for the
   * queue and its halftime, which it took from the screen's guess: one 8.0.0
   * or 8.0.1 linked to Riot without storing the id, whose facts are Riot's
   * already, or one of a queue the grade is not built for (Spike Rush and the
   * like), which is not graded, only named for what it was, so the breakdown
   * leaves it out.
   */
  stamp(run, step) {
    const review = this.whole(step.savedId);
    if (!review || review.matchId) return false;
    const out = { ...review, matchId: step.row.matchId };
    const label = valorantReview.queueLabel(step.row.mode);
    const halves = valorantReview.queueHalves(step.row.mode);
    if (label) out.game = { ...(review.game || {}), mode: label };
    if (halves && Array.isArray(review.rounds)) out.halftimeAfter = valorantReview.halftimeAfter(halves, review.rounds);
    this.deps.save(out);
    run.changed.push({ id: review.id, before: review });
    return true;
  }

  /**
   * One baseline row per graded match, in time order, never twice. The rows
   * the ten push out are kept with the run, so a take back can put the
   * player's own back (takeBack()).
   */
  remember(run, built) {
    const row = valorantReview.historyEntry(built.tracker, built.role);
    if (!row) return;
    const entry = { ...row, at: built.review.matchStartedAt || built.review.at, matchId: built.review.matchId || null };
    const ours = (h) => h && h.matchId && run.rowsAdded.has(h.matchId);
    const before = this.deps.history.get() || [];
    const past = before.filter((h) => !(h && entry.matchId && h.matchId === entry.matchId));
    const all = [...past, entry].sort((a, b) => (a.at || 0) - (b.at || 0));
    const rows = all.slice(-valorantReview.BASELINE_GAMES);
    const kept = new Set(rows);
    for (const h of before) if (h && !ours(h) && !kept.has(h)) run.pruned.push(h);
    if (entry.matchId) run.rowsAdded.add(entry.matchId);
    this.deps.history.set(rows);
  }

  /**
   * THE PLAN PLACES A MATCH BY AN ESTIMATE, 100 seconds a round from Riot's
   * start, and a real match misses it by minutes either way: a recording of
   * only the last rounds of a slow match fell outside its own match, which was
   * filed again beside it, and one played a few minutes after a fast match
   * fell inside it, which was left alone. Riot's record carries the match's
   * own start and length, so once it is in, the match is decided again on
   * them, against the recordings still unlinked. A match that is decided is
   * real for the rest of the run, so the next one is decided against it.
   */
  confirm(run, step, riot) {
    if (step.relink) return step;
    const start = riotReview.startOf(step.row, riot);
    const end = riotReview.endOf(step.row, riot);
    const i = run.rows.findIndex((r) => r.matchId === step.row.matchId);
    if (!start || !(end > start) || i < 0) return step;
    run.real.set(step.row.matchId, { start, end });
    const metas = new Map(this.metas().filter(Boolean).map((m) => [m.id, m]));
    const open = run.open.filter((o) => {
      const m = metas.get(o.id);
      return m && !m.matchId;
    });
    const { claims, claimed, near } = claimsOf(run.rows, open, run.real);
    return claimStep(step.row, claims.get(i) || [], claimed, this.deps.activeIds(), near.get(i));
  }

  async work(run) {
    const d = this.deps;
    await this.clear(run);
    if (!(await this.ours(run))) return;
    const listed = await this.list(run);
    if (run.cancelled || !listed) return;
    if (listed.error) {
      this.update(run, { state: 'error', error: listed.error.error, message: listed.error.message });
      return;
    }
    // PLANNED AGAINST EVERY LISTED MATCH, then cut to the graded queues and
    // the ten: a recording of a Spike Rush match, or of one past the ten,
    // claims its own match and is never handed a neighbour.
    const listedRows = listed.rows.filter((r) => r && r.matchId)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    // The library is read once: the recordings' windows are kept with the run
    // for confirm(), and the index alone says later which got linked since.
    const library = d.library();
    const planned = plan(listedRows, library, d.activeIds());
    run.rows = listedRows;
    run.open = openOf(library);
    // STAMPS NEED NO REQUEST AND GRADE NOTHING, so they run over every listed
    // match before the cut: a recording 8.0.0 or 8.0.1 linked, and a recording
    // of a queue the grade is not built for, which keeps the screen's guess at
    // its mode otherwise and is counted under it. Each waits out a match.
    // A stamp that finds the id already written is in the library all the
    // same; one whose save failed is counted with the failures, so the counts
    // add up to what was found (but for the matches a run stopped early never
    // reached, which its last line says are left for later).
    let stamped = 0;
    let stampFailed = 0;
    for (const step of planned) {
      const graded = queueOk(step.row.mode);
      const isStamp = step.action === 'stamp' || (step.action === 'upgrade' && !step.relink && !graded);
      if (!isStamp) continue;
      await this.clear(run);
      if (!(await this.ours(run))) return;
      let ok = true;
      try { this.stamp(run, step); } catch (e) { ok = false; d.log('[backfill] could not stamp', step.row.matchId, e && e.message); }
      if (graded && ok) stamped++;
      else if (graded) stampFailed++;
    }
    const steps = planned.filter((s) => queueOk(s.row.mode)).slice(0, MAX_MATCHES);
    if (!steps.length) {
      this.update(run, { state: 'done', found: 0, message: 'No recent Competitive, Unrated, Swiftplay or Premier '
        + 'matches on this account yet. Your next recorded match is graded when it ends.' });
      return;
    }
    const count = (action) => steps.filter((s) => s.action === action).length;
    // A match the plan could not tell apart from a recording is fetched too:
    // Riot's own start and length may tell them apart (confirm()). One whose
    // link saved another line than its row is not, the record cannot help.
    const todo = steps.filter((s) => s.action === 'new' || s.action === 'upgrade' || (s.action === 'ambiguous' && !s.held))
      .sort((a, b) => (a.row.startedAt || 0) - (b.row.startedAt || 0));
    const pending = count('pending');
    const ambiguous = steps.filter((s) => s.action === 'ambiguous' && s.held).length;
    this.update(run, {
      state: todo.length ? 'grading' : 'done',
      found: steps.length,
      have: count('have') + stamped,
      failed: stampFailed,
      pending, ambiguous, skipped: pending + ambiguous,
      total: todo.length, done: 0,
      items: todo.map((s) => itemOf(s.row, 'pending')).reverse(),
    });
    if (!todo.length) {
      this.update(run, { message: summary(this.status, false) });
      return;
    }
    this.update(run, { message: `Grading ${plural(todo.length, 'match', 'matches')} from Riot's record.` });

    let failsInRow = 0;
    for (const step of todo) {
      if (run.cancelled) return;
      this.update(run, { message: `Grading match ${this.status.done + 1} of ${todo.length} from Riot's record.` });
      const got = await this.rounds(run, step.row);
      if (run.cancelled) return;
      await this.clear(run);
      if (!(await this.ours(run))) return;
      const item = this.status.items.find((x) => x.matchId === step.row.matchId);
      let built = null;
      let now = step;
      if (got.riot) {
        // Riot answered, so Riot is not failing, whatever this match becomes.
        failsInRow = 0;
        now = this.confirm(run, step, got.riot);
        if (now.action === 'stamp') {
          let ok = true;
          try { this.stamp(run, now); } catch (e) { ok = false; d.log('[backfill] could not stamp', now.row.matchId, e && e.message); }
          if (item) item.status = ok ? 'have' : 'failed';
          this.update(run, ok ? { done: this.status.done + 1, have: this.status.have + 1 }
            : { done: this.status.done + 1, failed: this.status.failed + 1 });
          continue;
        }
        if (now.action === 'pending' || now.action === 'ambiguous') {
          if (item) item.status = 'skipped';
          this.update(run, { done: this.status.done + 1, [now.action]: this.status[now.action] + 1,
            skipped: this.status.skipped + 1 });
          continue;
        }
        try { built = this.build(now, got.riot, run.account); } catch (e) { d.log('[backfill] could not build', step.row.matchId, e.message); }
      }
      if (built === false) {
        if (item) item.status = 'have';
        this.update(run, { done: this.status.done + 1, have: this.status.have + 1 });
        continue;
      }
      if (!built) {
        // An answer that will not change on a retry is Riot answering too.
        if (got.failure === 'passing') failsInRow++;
        else failsInRow = 0;
        if (item) item.status = 'failed';
        this.update(run, { done: this.status.done + 1, failed: this.status.failed + 1 });
        if (failsInRow >= MAX_FAILS_IN_A_ROW) {
          this.update(run, { state: 'error', error: 'unreachable', message: summary(this.status, true) });
          return;
        }
        continue;
      }
      // OLDER THAN THE LIBRARY KEEPS. A full library prunes its oldest
      // review on every save, and a match older than all of them would be
      // written and deleted in the same call, then fetched again on every
      // later Connect as a match that "could not be fetched".
      if (now.action === 'new' && d.keeps && !d.keeps(built.review.at)) {
        if (item) item.status = 'old';
        this.update(run, { done: this.status.done + 1, old: this.status.old + 1 });
        continue;
      }
      // What a new review pushes out of a full library, read whole before the
      // save deletes it, so a take back can put it back.
      let evicted = [];
      if (now.action === 'new' && d.evicts) {
        try { evicted = d.evicts(built.review) || []; } catch (e) { d.log('[backfill] could not read what a save pushes out', e && e.message); }
      }
      // A review that never reached the library is not graded, and gets no
      // baseline row: the library and the baseline would disagree about it.
      try {
        d.save(built.review);
      } catch (e) {
        d.log('[backfill] could not save', step.row.matchId, e && e.message);
        if (item) item.status = 'failed';
        this.update(run, { done: this.status.done + 1, failed: this.status.failed + 1 });
        continue;
      }
      // What this run filed from Riot's record alone, and the recordings it
      // checked as they were, to take back if the Riot ID turns out not to be
      // the player's (takeBack()). Kept before the baseline write, so a write
      // that throws cannot leave a saved review out of the take back.
      if (now.action === 'new') {
        // The library's oldest can be this run's own last review, and then
        // this save just pushed it out: it is counted old, not graded.
        const ownOut = new Set();
        for (const gone of evicted) {
          const own = run.saved.findIndex((x) => x.id === gone.id);
          if (own < 0) continue;
          run.saved.splice(own, 1);
          ownOut.add(gone.id);
          const was = this.status.items.find((x) => x.id === gone.id);
          if (was) was.status = 'old';
          this.update(run, { graded: this.status.graded - 1, old: this.status.old + 1 });
        }
        run.saved.push({ id: built.review.id, matchId: built.review.matchId || null });
        run.evicted.push(...evicted.filter((x) => !ownOut.has(x.id)));
      }
      if (now.action === 'upgrade' && built.before) run.changed.push({ id: built.review.id, before: built.before });
      if (!built.hadBaseline) {
        try { this.remember(run, built); } catch (e) { d.log('[backfill] could not write the baseline row', step.row.matchId, e && e.message); }
      }
      const upgraded = now.action === 'upgrade';
      if (item) {
        const g = built.review.grade;
        const game = built.review.game || {};
        Object.assign(item, {
          status: upgraded ? 'upgraded' : 'graded',
          id: built.review.id,
          grade: g && typeof g.score === 'number' ? { score: g.score, letter: g.letter, provisional: !!g.provisional } : null,
          map: game.map || item.map, agent: game.agent || item.agent,
          result: game.result || item.result, score: game.score || item.score,
        });
      }
      this.update(run, {
        done: this.status.done + 1,
        graded: this.status.graded + (upgraded ? 0 : 1),
        upgraded: this.status.upgraded + (upgraded ? 1 : 0),
      });
    }
    if (run.cancelled) return;
    this.update(run, { state: 'done', message: summary(this.status, false) });
    const n = this.status.graded + this.status.upgraded;
    if (n) d.notice(`Graded ${plural(n, 'recent match', 'recent matches')} from Riot's record. ${n === 1 ? 'It is' : 'They are'} in Matches.`);
  }
}

module.exports = { Backfill, plan, windowOf, spansOf, claimsOf, sameLine, queueOk, passing, summary, MAX_MATCHES,
  GAP_MS, RETRY_MS, QUEUES, SETTLE_MS };
