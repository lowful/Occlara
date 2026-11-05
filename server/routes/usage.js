'use strict';

/**
 * GAMES, ACCOUNTS AND INVITES (8.7): the usage meter and its routes.
 *
 * THE METER counts games. A live Valorant match is one game, claimed on the
 * first read whose reply is IN a match (not LOBBY, not a menu), counted once
 * its review is written or it reaches 120 in-match reads, and given back when
 * it ended short (fewer than 120 in-match reads and no review). A Riot record
 * review and a League review are claimed and counted at once through
 * POST /api/usage/claim, since there are no reads to wait for.
 *
 * NOTHING IS REFUSED UNLESS ENFORCE_CAPS=1. With it unset every claim is made
 * with p_enforce false, which always grants and marks a game past the cap as
 * 'shadow', so the counts can be read on /api/admin/costs before a single
 * player is turned away. And nothing is refused on an error: a database that
 * cannot answer lets the read through, as the licence outage rule does.
 *
 * WHEN THE TABLES DO NOT EXIST (the migration not applied yet) every call
 * here fails with 42P01, PGRST202 or PGRST205, caller.js marks accounts not
 * live, and the meter does nothing at all: 8.6 exactly.
 *
 * THE ROUTES, mounted under /api:
 *   POST /account/handoff   a signed in site (Supabase JWT) asks for a one time code
 *   POST /account/exchange  the app trades the code (PKCE) for an app session
 *   POST /account/signout   the app session revokes itself
 *   GET  /account/me        account_state for any caller
 *   POST /usage/claim       a Riot record or League review claims its game
 *   GET  /referral          the caller's invite link and counts
 *   POST /referral/redeem   an invitee (Supabase JWT) redeems a code
 */

const express = require('express');
const crypto = require('crypto');
const callers = require('../services/caller');

const { sha256, safeEqual, enforced, ipPrefixHash, isMissing, FREE_GAMES, INVITE_EXTRA_GAMES } = callers;

// An invited account's free games: the Free tier's own and the friend's extra.
const INVITED_FREE_TOTAL = FREE_GAMES + INVITE_EXTRA_GAMES;

const MATCH_READS_COUNTED = 120;      // a live game with this many in-match reads is counted
const FLUSH_MS = 10 * 1000;           // match_reads written at most this often per row
const ALLOW_MS = 30 * 1000;           // the read gate's allowance is remembered this long
const MATCH_GAP_MS = 4 * 60 * 1000;   // no in-match read for this long: that match is over
const SHORT_END_MS = 45 * 60 * 1000;  // a match over this long with no review is given back
const REVIEW_WINDOW_MS = 6 * 60 * 60 * 1000; // a review may follow its live game this long
const OPEN_MS = 3 * 60 * 60 * 1000;   // a reserved live row this young is still open (claim_game's 3 h)
const LATE_REVIEW_GAP_MS = 60 * 1000; // a late review never counts a row read in a match this recently
const COUNTED_ROW_MS = 2 * 60 * 60 * 1000; // a counted live game is over this long after its claim
const NEW_MATCH_FROM = 4;             // a counted game whose steady score reached this...
const NEW_MATCH_AT = 1;               // ...and then reads this or less...
const NEW_MATCH_READS = 3;            // ...this many in-match reads in a row is the next match
const MAP_MAX = 10000;                // every per account map here is trimmed to this
const REFUNDS_PER_DAY = 3;
const REVIEWS_PER_GAME = 4;          // reviews (and looks) one live game gets while the account has none left
const CLAIM_RETRY_MS = 30 * 1000;
const HANDOFF_MS = 120 * 1000;
const MAX_FRIENDS = 5;
const MAX_EARNED = 20;
const INVITE_BASE = 'https://occlara.app/invite/';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const B64URL = /^[A-Za-z0-9_-]+$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const REF_CODE = /^[A-Za-z0-9]{4,16}$/;
const GAMES = new Set(['valorant', 'lol']);
const CLAIM_KINDS = new Set(['riot', 'league']);

const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const iso = (ms) => new Date(ms).toISOString();

// ─── The meter ─────────────────────────────────────────────────────────────

function createMeter(deps = {}) {
  const now = deps.now || (() => Date.now());
  const env = () => deps.env || process.env;
  const db = () => deps.supabase || require('../db/supabase');
  const resolver = deps.resolver || callers.shared;
  const isEnforced = (caller) => enforced(caller, env(), now());

  const rows = new Map();     // accountKey|device -> the live game being metered
  const opens = new Map();    // accountKey|device -> { at, open } (an open live row in the database)
  const allow = new Map();    // accountKey -> { at, left }
  const ensured = new Map();  // user id -> when ensure_entitlement last succeeded
  const refunds = new Map();  // accountKey -> { day, n } (when the database cannot be counted)
  /** Every per account map is bounded: past MAP_MAX the oldest entries go (S12). */
  const trimMap = (map) => { while (map.size > MAP_MAX) map.delete(map.keys().next().value); };
  const put = (map, k, v) => { map.delete(k); map.set(k, v); trimMap(map); };
  const trim = () => { for (const map of [opens, allow, ensured, refunds, spent]) trimMap(map); };
  const counts = { claims: 0, refused: 0, gated: 0, counted: 0, refunded: 0, flushes: 0 };

  const live = () => resolver.accountsLive();
  const quiet = (where) => (r) => {
    const error = r && r.error;
    if (error && !resolver.noteError(error)) console.warn(`[usage] ${where} failed:`, error.code || error.message);
    return r;
  };

  async function rpc(name, args) {
    try {
      const r = await db().rpc(name, args);
      if (r && r.error) {
        if (!resolver.noteError(r.error)) console.warn(`[usage] ${name} failed:`, r.error.code || r.error.message);
        return { data: null, error: r.error };
      }
      resolver.markLive();
      return { data: r ? r.data : null, error: null };
    } catch (e) {
      console.warn(`[usage] ${name} failed:`, e.message);
      return { data: null, error: { code: '', message: e.message } };
    }
  }

  async function ensure(userId) {
    const at = ensured.get(userId);
    if (at && now() - at < 10 * 60 * 1000) return true;
    const { error } = await rpc('ensure_entitlement', { p_user: userId });
    if (error) return false;
    put(ensured, userId, now());
    return true;
  }

  /*
   * ONE ROW PER ACCOUNT AND DEVICE. One account signed in on two PCs, each
   * playing its own match at once, is two games: keyed by the account alone
   * both PCs' reads fed one row and two matches were counted as one. The
   * device is the session's (fixed at exchange) or the key's (licenses.
   * device_id); claim_game reuses an open live row of the same device only.
   */
  const rowKey = (caller) => `${caller.accountKey}|${caller.deviceHash || caller.sessionId || ''}`;
  /** The row being metered for a caller, or null. A finished one stays until replaced. */
  const rowOf = (caller) => rows.get(rowKey(caller)) || null;
  /** A game_usage query narrowed to the caller's device, as claim_game's open row is. */
  const onDevice = (q, caller) => (caller.deviceHash ? q.eq('device_hash', caller.deviceHash) : q.is('device_hash', null));
  /*
   * A COUNTED GAME IS FINISHED. A row settled at 120 reads stayed "open" for
   * as long as in-match reads kept coming under MATCH_GAP_MS, so a match whose
   * review was never written (a 503, a thin match, a client that skips it)
   * followed by a quick requeue rode on the last game: six matches were
   * measured as one, and with caps enforced gate() let every read through.
   * A settled row now also ends on a new match (row.newMatch, noteRead's
   * score reset) or once COUNTED_ROW_MS has passed since it was claimed.
   * A reserved row is untouched: it is still the game being played.
   */
  const ended = (row, at) => row.reviewed || (row.lastInMatch && at - row.lastInMatch > MATCH_GAP_MS)
    || (row.status !== 'reserved' && (row.newMatch || at - row.claimedAt > COUNTED_ROW_MS));

  /*
   * THE SCORE GOING BACK TO THE START is the next match. Team plus enemy only
   * climbs inside one match, so a counted row whose steady score (seen on two
   * reads in a row, so one misread never sets it) reached NEW_MATCH_FROM and
   * then reads NEW_MATCH_AT or less NEW_MATCH_READS times in a row is over.
   */
  function noteScore(row, score) {
    // A score the reply did not read (null, missing) says nothing: never a 0.
    const team = score && typeof score.team === 'number' ? score.team : NaN;
    const enemy = score && typeof score.enemy === 'number' ? score.enemy : NaN;
    if (!score || !Number.isFinite(team) || !Number.isFinite(enemy) || team < 0 || enemy < 0 || team + enemy > 60) return;
    const sum = team + enemy;
    if (row.status !== 'reserved' && row.topScore >= NEW_MATCH_FROM && sum <= NEW_MATCH_AT) {
      row.resetReads = (row.resetReads || 0) + 1;
      if (row.resetReads >= NEW_MATCH_READS) row.newMatch = true;
    } else row.resetReads = 0;
    if (typeof row.lastSum === 'number') row.topScore = Math.max(row.topScore || 0, Math.min(row.lastSum, sum));
    row.lastSum = sum;
  }

  /** account_state's games left, remembered ALLOW_MS, or null when it cannot be said. */
  async function leftOf(caller) {
    const hit = allow.get(caller.accountKey);
    if (hit && now() - hit.at < ALLOW_MS) return hit.left;
    const { data, error } = await rpc('account_state', { p_user: caller.userId });
    if (error) return null;
    const st = one(data);
    const left = st && typeof st.left === 'number' ? st.left : null;
    put(allow, caller.accountKey, { at: now(), left });
    return left;
  }

  /**
   * THE READ GATE, asked BEFORE the model is called: { ok: true }, or
   * { ok: false, status: 402, body: { error: 'cap', left: 0 } } only when
   * caps are enforced for this caller, it has no live game open, and
   * account_state says no game is left. Any doubt lets the read through.
   */
  async function gate(caller) {
    if (!caller || !caller.userId || !live() || !isEnforced(caller)) return { ok: true };
    const at = now();
    const row = rowOf(caller);
    if (row && row.status !== 'refunded' && !row.refused && !ended(row, at)) return { ok: true };
    if (row && row.refused && at - row.refusedAt < ALLOW_MS) { counts.gated++; return capped(); }
    const left = await leftOf(caller);
    if (typeof left === 'number' && left <= 0) {
      // After a restart the open game is only in the database, and it counts
      // as used in account_state: the player's own last game must not be
      // refused mid match. claim_game reuses that row (reason 'open').
      if (await openInDb(caller)) return { ok: true };
      counts.gated++;
      return capped();
    }
    return { ok: true };
  }

  /** Whether the caller has a reserved live row under 3 hours old on this device, remembered ALLOW_MS. */
  async function openInDb(caller) {
    const k = rowKey(caller);
    const hit = opens.get(k);
    if (hit && now() - hit.at < ALLOW_MS) return hit.open;
    let open = false;
    try {
      const r = await onDevice(db().from('game_usage').select('id')
        .eq('user_id', caller.userId).eq('kind', 'live').eq('status', 'reserved')
        .gte('created_at', iso(now() - OPEN_MS)), caller).limit(1);
      if (r && r.error) { quiet('open game')(r); open = true; } else open = !!(r && Array.isArray(r.data) && r.data.length);
    } catch { open = true; }   // any doubt lets the read through
    opens.set(k, { at: now(), open });
    trimMap(opens);
    return open;
  }
  const capped = () => ({ ok: false, status: 402, body: { error: 'cap', left: 0 } });

  async function settle(row, outcome, reason) {
    if (!row.usageId || row.status !== 'reserved') return;
    row.status = outcome;
    const { error } = await rpc('settle_game', { p_usage: row.usageId, p_outcome: outcome, p_reason: reason });
    if (error) { row.status = 'reserved'; return; }
    if (outcome === 'counted') counts.counted++; else counts.refunded++;
    allow.delete(row.accountKey);
  }

  /** How many games this account was given back today (UTC). */
  async function refundsToday(row) {
    const day = iso(now()).slice(0, 10);
    try {
      const { count, error } = await db().from('game_usage').select('id', { count: 'exact', head: true })
        .eq('user_id', row.userId).eq('status', 'refunded').gte('settled_at', `${day}T00:00:00.000Z`);
      if (!error && typeof count === 'number') return count;
    } catch { /* counted in memory below */ }
    const m = refunds.get(row.accountKey);
    return m && m.day === day ? m.n : 0;
  }

  /** A game that ended short is given back, three a day; past that it is counted ('refund-cap'). */
  async function endShort(row) {
    if (row.status !== 'reserved' || !row.usageId) return;
    await flush(row, true);
    if (row.matchReads >= MATCH_READS_COUNTED) return settle(row, 'counted', 'reads');
    const n = await refundsToday(row);
    if (n >= REFUNDS_PER_DAY) return settle(row, 'counted', 'refund-cap');
    await settle(row, 'refunded', 'short');
    if (row.status === 'refunded') {
      const day = iso(now()).slice(0, 10);
      const m = refunds.get(row.accountKey);
      put(refunds, row.accountKey, { day, n: m && m.day === day ? m.n + 1 : 1 });
    }
  }

  /** The reads not yet written go out: at most once every FLUSH_MS per row, unless forced. */
  async function flush(row, force) {
    if (!row.usageId) return;
    if (row.matchReads === row.flushed.matchReads && row.reads === row.flushed.reads) return;
    if (!force && now() - row.lastFlush < FLUSH_MS) return;
    row.lastFlush = now();
    const patch = { match_reads: row.matchReads, reads: row.reads };
    try {
      const r = await db().from('game_usage').update(patch).eq('id', row.usageId);
      if (r && r.error) { quiet('match_reads write')(r); return; }
      row.flushed = { matchReads: patch.match_reads, reads: patch.reads };
      counts.flushes++;
    } catch (e) { console.warn('[usage] match_reads write failed:', e.message); }
  }

  /*
   * A LIVE CLAIM NEVER CARRIES A CLIENT ID. claim_game answers an id it has
   * seen with the row it got the first time, whatever that row's status, so a
   * client sending the same id on every match would replay one counted game
   * forever. The open row of this device (claim_game, under 3 hours) is what
   * ties a restart back to its match.
   */
  async function claim(caller, row) {
    if (!await ensure(caller.userId)) { row.claimFailedAt = now(); return; }
    const p = {
      p_user: caller.userId, p_game: 'valorant', p_kind: 'live',
      p_client_match_id: null, p_device_hash: caller.deviceHash || null,
      p_enforce: isEnforced(caller),
    };
    const { data, error } = await rpc('claim_game', p);
    if (error) { row.claimFailedAt = now(); return; }
    counts.claims++;
    const g = one(data) || {};
    if (!g.granted || !g.usage_id) {
      row.refused = true;
      row.refusedAt = now();
      counts.refused++;
      put(allow, caller.accountKey, { at: now(), left: 0 });
      return;
    }
    row.usageId = g.usage_id;
    put(allow, caller.accountKey, { at: now(), left: typeof g.left === 'number' ? g.left : null });
    // A reused row (the same match after a restart) keeps what it already had.
    try {
      const r = await db().from('game_usage').select('match_reads,reads,status').eq('id', g.usage_id).maybeSingle();
      const prior = r && !r.error && r.data;
      if (prior) {
        row.matchReads += Number(prior.match_reads) || 0;
        row.reads += Number(prior.reads) || 0;
        row.flushed = { matchReads: Number(prior.match_reads) || 0, reads: Number(prior.reads) || 0 };
        if (prior.status === 'counted' || prior.status === 'refunded') row.status = prior.status;
      }
    } catch { /* the in-memory count carries on */ }
    if (row.status === 'reserved' && row.matchReads >= MATCH_READS_COUNTED) {
      await flush(row, true);
      await settle(row, 'counted', 'reads');
    }
  }

  /**
   * One read's reply, after the model answered. `inMatch` is whether the
   * reply was a match frame. The first one claims the game; each one bumps
   * match_reads, written in batches; 120 counts it. Never throws, and the
   * read's answer never waits for it.
   */
  function noteRead(caller, { inMatch, score } = {}) {
    if (!caller || !caller.userId || !live()) return Promise.resolve();
    return (async () => {
      const at = now();
      const key = rowKey(caller);
      let row = rowOf(caller);
      // A refusal is asked again once the allowance would be (a purchase, a new month).
      if (row && row.refused && at - row.refusedAt >= ALLOW_MS) { rows.delete(key); row = null; }
      // The score this reply read: a counted game whose score went back to the start is over.
      if (inMatch && row && !row.refused) noteScore(row, score);
      if (inMatch && row && ended(row, at)) {
        // A new match: the last one is settled first, so claim_game never
        // hands the new match the last one's open row.
        if (row.claiming) await row.claiming;
        if (row.status === 'reserved') await endShort(row);
        row = null;
      }
      if (!row) {
        if (!inMatch) return;
        row = { accountKey: caller.accountKey, userId: caller.userId, usageId: null, status: 'reserved',
          claimedAt: at, lastInMatch: 0, matchReads: 0, reads: 0, flushed: { matchReads: 0, reads: 0 },
          lastFlush: 0, reviewed: false, refused: false, refusedAt: 0, claiming: null, claimFailedAt: 0,
          topScore: 0, lastSum: null, resetReads: 0, newMatch: false };
        rows.set(key, row);
        opens.delete(key);
        noteScore(row, score);
      }
      if (row.refused) return;
      row.reads++;
      if (inMatch) { row.matchReads++; row.lastInMatch = at; }
      if (!row.usageId && !row.claiming && inMatch && (!row.claimFailedAt || at - row.claimFailedAt > CLAIM_RETRY_MS)) {
        row.claiming = claim(caller, row).finally(() => { row.claiming = null; });
        await row.claiming;
        return;
      }
      if (row.status === 'reserved' && row.usageId && row.matchReads >= MATCH_READS_COUNTED) {
        await flush(row, true);
        await settle(row, 'counted', 'reads');
        return;
      }
      await flush(row, false);
    })().catch((e) => console.warn('[usage] a read was not metered:', e.message));
  }

  /**
   * THE REVIEW GATE for /death-forensics and /match-review: with caps
   * enforced the caller needs a live game open or counted in the last six
   * hours, else 402. Any doubt lets it through.
   */
  /*
   * A CAPPED ACCOUNT'S LAST GAME IS NOT A PASS FOR SIX HOURS (8.7.3). The
   * window lets the late review of a counted game through (riotLook, often
   * during the next match), but it let through ANY review: an account with no
   * game left, whose next match the read gate had refused, was still handed
   * the model's review and look of it for six hours after its last counted
   * game, as many as the coach limiter allowed. So while the account has no
   * game left (account_state, the read gate's own answer) each live game in
   * the window carries a budget of REVIEWS_PER_GAME reviews and as many looks:
   * the engine's, the late one and two spare. Past it, 402 cap, before the
   * model. An account with games left, or one whose count cannot be had, is
   * as before.
   */
  const spent = new Map();   // usage id|what -> reviews asked while capped
  function withinBudget(usageId, what) {
    const k = `${usageId}|${what}`;
    const n = spent.get(k) || 0;
    if (n >= REVIEWS_PER_GAME) return false;
    put(spent, k, n + 1);
    return true;
  }

  async function reviewGate(caller, { what = 'review' } = {}) {
    if (!caller || !caller.userId || !live() || !isEnforced(caller)) return { ok: true };
    const row = rowOf(caller);
    let gameId = null;
    if (row && row.usageId && (row.status === 'reserved' || row.status === 'counted')
      && now() - row.claimedAt < REVIEW_WINDOW_MS) gameId = row.usageId;
    if (!gameId) {
      try {
        const r = await db().from('game_usage').select('id')
          .eq('user_id', caller.userId).eq('kind', 'live').in('status', ['reserved', 'counted'])
          .gte('created_at', iso(now() - REVIEW_WINDOW_MS)).order('created_at', { ascending: false }).limit(1);
        if (r && r.error) { quiet('review gate')(r); return { ok: true }; }
        if (r && Array.isArray(r.data) && r.data.length) gameId = r.data[0].id || 'unknown';
      } catch { return { ok: true }; }
    }
    if (!gameId) { counts.gated++; return capped(); }
    const left = await leftOf(caller);
    if (typeof left === 'number' && left <= 0 && !withinBudget(gameId, what)) { counts.gated++; return capped(); }
    return { ok: true };
  }

  /*
   * A review was written: its live game is counted (a failed one leaves it).
   *
   * A LATE REVIEW IS NOT THE MATCH BEING PLAYED. A Valorant match is reviewed
   * twice: by the engine as it ends, and again once Riot publishes its record
   * (src/main/index.js riotLook, 90 s to 8 minutes later, the request carrying
   * Riot's matchId), by which time the player is often in the next match. That
   * late review counted whatever row was open, the next match's, and marked it
   * reviewed, so the next match was charged twice. Now a late review (late)
   * leaves alone a row read in a match in the last minute, and never falls
   * back to the database, where the newest open row is the next match's. The
   * match it reviews was counted by the engine's review, or given back short
   * when the next one began.
   */
  async function reviewDone(caller, { late = false } = {}) {
    if (!caller || !caller.userId || !live()) return;
    try {
      const row = rowOf(caller);
      if (row && row.usageId) {
        if (row.claiming) await row.claiming;
        if (late && row.lastInMatch && now() - row.lastInMatch < LATE_REVIEW_GAP_MS) return;
        row.reviewed = true;
        await flush(row, true);
        await settle(row, 'counted', 'review');
        return;
      }
      if (late) return;
      // After a restart the row is only in the database: the newest open one of this device.
      const r = await onDevice(db().from('game_usage').select('id')
        .eq('user_id', caller.userId).eq('kind', 'live').eq('status', 'reserved')
        .gte('created_at', iso(now() - REVIEW_WINDOW_MS)), caller).order('created_at', { ascending: false }).limit(1);
      if (r && r.error) { quiet('review count')(r); return; }
      const hit = r && Array.isArray(r.data) && r.data[0];
      if (hit) {
        const { error } = await rpc('settle_game', { p_usage: hit.id, p_outcome: 'counted', p_reason: 'review' });
        if (!error) { counts.counted++; allow.delete(caller.accountKey); }
      }
    } catch (e) { console.warn('[usage] a review was not counted:', e.message); }
  }

  /** Every few minutes: write what is waiting, give back what ended short, forget what is done. */
  async function sweep() {
    const at = now();
    for (const [k, row] of rows) {
      if (row.claiming) continue;
      if (row.status === 'reserved' && row.usageId && !row.reviewed && row.lastInMatch && at - row.lastInMatch > SHORT_END_MS) {
        await endShort(row);
      } else {
        await flush(row, true);
      }
      const doneAt = row.lastInMatch || row.claimedAt;
      if ((row.status !== 'reserved' || row.refused || !row.usageId) && at - doneAt > REVIEW_WINDOW_MS) rows.delete(k);
    }
  }

  function start(everyMs = 60 * 1000) {
    const t = setInterval(() => { sweep().catch((e) => console.warn('[usage] sweep failed:', e.message)); }, everyMs);
    if (t.unref) t.unref();
    return t;
  }

  return { gate, noteRead, reviewGate, reviewDone, sweep, start, ensure, rpc, leftOf, rowKey,
    rows, allow, opens, ensured, refunds, spent, trim, counts, _endShort: endShort, _flush: flush };
}

const meter = createMeter();
if (!process.env.OCCLARA_NO_METER_SWEEP) meter.start();

// ─── Small per IP limiters (deterministic, so the tests can drive them) ────

function ipLimiter({ windowMs, max, name }) {
  const hits = new Map();
  return (req, res, next) => {
    const at = Date.now();
    const k = callers.ipBucket(req.ip || (req.socket && req.socket.remoteAddress));
    const list = (hits.get(k) || []).filter((t) => at - t < windowMs);
    if (list.length >= max) {
      hits.set(k, list);
      // When the oldest request in the window leaves it, in whole seconds (8.7.3).
      const retryAfter = Math.max(1, Math.ceil((list[0] + windowMs - at) / 1000));
      if (typeof res.set === 'function') res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate-limited', what: name, retryAfter });
    }
    list.push(at);
    hits.delete(k);
    hits.set(k, list);
    while (hits.size > 10000) hits.delete(hits.keys().next().value);
    next();
  };
}

// ─── The routes ────────────────────────────────────────────────────────────

function createRouter(deps = {}) {
  const router = express.Router();
  const db = () => deps.supabase || require('../db/supabase');
  const resolver = deps.resolver || callers.shared;
  const m = deps.meter || meter;
  const env = () => deps.env || process.env;
  const now = deps.now || (() => Date.now());

  const NOT_LIVE = { error: 'accounts-not-live' };
  const UNAVAILABLE = { error: 'account-unavailable', retry: true };

  /** Throw a database error as one, so a write that was refused is never answered as done. */
  const must = (r, what) => {
    if (r && r.error) {
      const e = new Error(`${what}: ${r.error.code || ''} ${r.error.message || ''}`.trim());
      e.dbError = r.error;
      throw e;
    }
    return r ? r.data : null;
  };
  /** A handler whose failures answer 503 (accounts not live) or 500, logged by code only. */
  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.dbError && isMissing(e.dbError)) { resolver.noteError(e.dbError); return res.status(503).json(NOT_LIVE); }
      console.error('[usage] route failed:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'account-failed' });
    }
  };

  /** The caller, answered for when there is none: 401 / 503. */
  async function need(req, res, { via } = {}) {
    const r = await resolver.identify(req);
    if (r.status === 'valid' && (!via || via.includes(r.caller.via))) return r.caller;
    if (r.status === 'unavailable') { res.status(503).json(UNAVAILABLE); return null; }
    if (r.status === 'valid') { res.status(401).json({ error: 'sign-in-required' }); return null; }
    res.status(r.status === 'invalid' && r.via === 'key' ? 403 : 401).json(r.body || { error: 'sign-in-required' });
    return null;
  }

  const handoffLimit = ipLimiter({ windowMs: 60 * 1000, max: 20, name: 'handoff' });
  const exchangeLimit = ipLimiter({ windowMs: 60 * 1000, max: 10, name: 'exchange' });
  const redeemLimit = ipLimiter({ windowMs: 60 * 1000, max: 10, name: 'redeem' });

  // POST /api/account/handoff  (the site, Supabase JWT): { state, challenge } -> { code }
  router.post('/account/handoff', handoffLimit, handle(async (req, res) => {
    const caller = await need(req, res, { via: ['jwt'] });
    if (!caller) return;
    if (!resolver.accountsLive()) return res.status(503).json(NOT_LIVE);
    const state = clip(req.body && req.body.state, 200);
    const challenge = clip(req.body && req.body.challenge, 200);
    if (!B64URL.test(state) || state.length < 16 || state.length > 128) return res.status(400).json({ error: 'bad-state' });
    if (!B64URL.test(challenge) || challenge.length !== 43) return res.status(400).json({ error: 'bad-challenge' });
    must(await db().rpc('ensure_entitlement', { p_user: caller.userId }), 'ensure_entitlement');
    const code = crypto.randomBytes(32).toString('base64url');
    must(await db().from('auth_handoffs').insert({
      code_hash: sha256(code), user_id: caller.userId, state, challenge,
      expires_at: iso(now() + HANDOFF_MS), used_at: null,
    }), 'handoff insert');
    res.json({ code });
  }));

  // POST /api/account/exchange  (no auth): { code, verifier, state, device_id, device_name } -> { token, account }
  router.post('/account/exchange', exchangeLimit, handle(async (req, res) => {
    if (!resolver.accountsLive()) return res.status(503).json(NOT_LIVE);
    const b = req.body || {};
    const code = clip(b.code, 100);
    const verifier = clip(b.verifier, 200);
    const state = clip(b.state, 200);
    if (!B64URL.test(code) || code.length !== 43 || !VERIFIER.test(verifier) || !B64URL.test(state)) {
      return res.status(400).json({ error: 'code-invalid' });
    }
    // Single use, atomically: only an unused, unexpired code is marked used
    // and handed back. A second exchange of the same code finds nothing.
    const at = now();
    const rowsUsed = must(await db().from('auth_handoffs').update({ used_at: iso(at) })
      .eq('code_hash', sha256(code)).is('used_at', null).gt('expires_at', iso(at))
      .select('user_id,state,challenge'), 'handoff use');
    const h = one(rowsUsed);
    if (!h || !h.user_id) return res.status(400).json({ error: 'code-invalid' });
    const pkce = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!safeEqual(String(h.state || ''), state) || !safeEqual(String(h.challenge || ''), pkce)) {
      return res.status(400).json({ error: 'code-invalid' });
    }
    const token = `occ_${crypto.randomBytes(32).toString('base64url')}`;
    const deviceId = clip(b.device_id, 200);
    must(await db().from('app_sessions').insert({
      user_id: h.user_id, token_hash: sha256(token),
      device_hash: deviceId ? sha256(deviceId) : null,
      device_name: clip(b.device_name, 80) || null,
      ip_prefix_hash: ipPrefixHash(req.ip, env()),
      created_at: iso(at), last_seen: iso(at), revoked_at: null,
    }), 'session insert');
    let account = null;
    try {
      const r = await db().rpc('account_state', { p_user: h.user_id });
      if (!r.error) account = one(r.data);
    } catch { /* the token is good; the account is asked for again with it */ }
    res.json({ token, account });
  }));

  // POST /api/account/signout  (the app session)
  router.post('/account/signout', handle(async (req, res) => {
    const caller = await need(req, res, { via: ['session'] });
    if (!caller) return;
    must(await db().from('app_sessions').update({ revoked_at: iso(now()) }).eq('token_hash', caller.tokenHash), 'signout');
    resolver.forgetSession(caller.tokenHash);
    res.json({ ok: true });
  }));

  // GET /api/account/me  (any caller): account_state, and whether Start would be refused
  router.get('/account/me', handle(async (req, res) => {
    const caller = await need(req, res);
    if (!caller) return;
    const base = { via: caller.via, tier: caller.tier || null, enforce: enforced(caller, env(), now()) };
    if (!caller.userId || !resolver.accountsLive()) return res.json({ ...base, live: false, capped: false });
    let r = await m.rpc('account_state', { p_user: caller.userId });
    let st = one(r.data);
    if (!r.error && !st) {
      if (await m.ensure(caller.userId)) { r = await m.rpc('account_state', { p_user: caller.userId }); st = one(r.data); }
    }
    if (r.error || !st) {
      if (r.error && isMissing(r.error)) return res.json({ ...base, live: false, capped: false });
      return res.status(503).json(UNAVAILABLE);
    }
    let email = caller.email || null;
    if (!email) { try { const u = await resolver.userOf(caller.userId); email = (u && u.email) || null; } catch { /* no email shown */ } }
    res.json({ ...st, email, via: caller.via, live: true, enforce: base.enforce,
      capped: base.enforce && typeof st.left === 'number' && st.left <= 0 });
  }));

  /*
   * POST /api/usage/claim  { game, kind ('riot'|'league'), client_match_id, device_id } -> { granted, left, reason }
   *
   * THE APP ONLY (an app session or a key): a site token has no device. And
   * the device is the caller's own whenever it has one, the session's (fixed
   * at exchange) or the key's (licenses.device_id), never one the body names:
   * a fresh device_id on every request walked past the device rule for free
   * games and qualified invites with nobody playing. The body's device is
   * used only for a key that is not activated on a device.
   */
  router.post('/usage/claim', handle(async (req, res) => {
    const caller = await need(req, res, { via: ['session', 'key'] });
    if (!caller) return;
    const b = req.body || {};
    const game = clip(b.game, 20).toLowerCase();
    const kind = clip(b.kind, 20).toLowerCase();
    const clientMatchId = clip(b.client_match_id, 120);
    if (!GAMES.has(game) || !CLAIM_KINDS.has(kind) || !clientMatchId) return res.status(400).json({ error: 'bad-claim' });
    if ((kind === 'league') !== (game === 'lol')) return res.status(400).json({ error: 'bad-claim' });
    if (!caller.userId || !resolver.accountsLive()) return res.json({ granted: true, left: null, reason: 'not-live' });
    if (!await m.ensure(caller.userId)) {
      return res.json({ granted: true, left: null, reason: resolver.accountsLive() ? 'unavailable' : 'not-live' });
    }
    const deviceId = caller.deviceHash ? '' : clip(b.device_id, 200);
    const { data, error } = await m.rpc('claim_game', {
      p_user: caller.userId, p_game: game, p_kind: kind, p_client_match_id: clientMatchId,
      p_device_hash: caller.deviceHash || (deviceId ? sha256(deviceId) : null),
      p_enforce: enforced(caller, env(), now()),
    });
    // Never refused on an error: a review is only locked on a definite no.
    if (error) return res.json({ granted: true, left: null, reason: isMissing(error) ? 'not-live' : 'unavailable' });
    const g = one(data) || {};
    if (g.granted && g.usage_id) {
      await m.rpc('settle_game', { p_usage: g.usage_id, p_outcome: 'counted', p_reason: kind });
      m.allow.delete(caller.accountKey);
    }
    res.json({ granted: !!g.granted, left: typeof g.left === 'number' ? g.left : null, reason: g.reason || null });
  }));

  /*
   * POST /api/usage/release  { client_match_id } -> { released, reason }
   *
   * A Riot record run taken back (the Riot ID was someone else's) gives back
   * the games it claimed: release_game refunds the caller's own counted 'riot'
   * row of that id, claimed in the last day, within the same 3 a day refund
   * cap as any refund. Nothing else can be released.
   */
  router.post('/usage/release', handle(async (req, res) => {
    const caller = await need(req, res, { via: ['session', 'key'] });
    if (!caller) return;
    const clientMatchId = clip(req.body && req.body.client_match_id, 120);
    if (!clientMatchId || !clientMatchId.startsWith('riot:')) return res.status(400).json({ error: 'bad-release' });
    if (!caller.userId || !resolver.accountsLive()) return res.json({ released: false, reason: 'not-live' });
    const { data, error } = await m.rpc('release_game', { p_user: caller.userId, p_client_match_id: clientMatchId });
    if (error) return res.status(isMissing(error) ? 200 : 503).json({ released: false, reason: isMissing(error) ? 'not-live' : 'unavailable' });
    const g = one(data) || {};
    if (g.changed) m.allow.delete(caller.accountKey);
    res.json({ released: !!g.changed, reason: g.reason || null });
  }));

  async function codeOf(userId) {
    const found = one(must(await db().from('referral_codes').select('code').eq('user_id', userId).limit(1), 'referral code'));
    if (found && found.code) return found.code;
    for (let i = 0; i < 6; i++) {
      const bytes = crypto.randomBytes(8);
      const code = [...bytes].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
      const r = await db().from('referral_codes').insert({ user_id: userId, code, created_at: iso(now()) });
      if (!r.error) return code;
      if (r.error.code !== '23505') must(r, 'referral code insert');
      // 23505: the code was taken, or this user's row was made by a request beside this one.
      const again = one(must(await db().from('referral_codes').select('code').eq('user_id', userId).limit(1), 'referral code'));
      if (again && again.code) return again.code;
    }
    throw new Error('no free referral code after six tries');
  }

  /*
   * GET /api/referral  (any caller with an account)
   *
   * A KEY ALONE INVITES NOBODY. The redeem checks compare the invitee with the
   * networks and devices the inviter is known on, and an install that never
   * signed in (the key fallback) is known on none, so its owner could refer
   * their own alt from the same PC and the same home network. A key caller
   * whose user has no app session is asked to sign in (the Invite page shows
   * "Invites need an account").
   */
  router.get('/referral', handle(async (req, res) => {
    const caller = await need(req, res);
    if (!caller) return;
    if (!caller.userId || !resolver.accountsLive()) return res.status(503).json(NOT_LIVE);
    if (caller.via === 'key' && typeof resolver.userHasSession === 'function' && !await resolver.userHasSession(caller.userId)) {
      return res.status(403).json({ error: 'sign-in-required' });
    }
    const code = await codeOf(caller.userId);
    const reds = must(await db().from('referral_redemptions').select('status').eq('inviter_id', caller.userId), 'redemptions') || [];
    const ent = one(must(await db().from('entitlements').select('bonus_earned').eq('user_id', caller.userId).limit(1), 'entitlement'));
    const invited = reds.filter((r) => r.status === 'pending' || r.status === 'qualified').length;
    res.json({ code, link: `${INVITE_BASE}${code}`, invited,
      qualified: reds.filter((r) => r.status === 'qualified').length,
      earned: Math.min(MAX_EARNED, Number(ent && ent.bonus_earned) || 0),
      max_friends: MAX_FRIENDS, max_games: MAX_EARNED });
  }));

  // POST /api/referral/redeem  (the invitee, Supabase JWT): { code }
  router.post('/referral/redeem', redeemLimit, handle(async (req, res) => {
    const caller = await need(req, res, { via: ['jwt'] });
    if (!caller) return;
    const refuse = (reason, status = 409) => res.status(status).json({ error: 'refused', reason });
    if (String(env().REFERRALS_ON || '0').trim() !== '1') return refuse('referrals-off', 403);
    if (!resolver.accountsLive()) return res.status(503).json(NOT_LIVE);
    const code = clip(req.body && req.body.code, 40).toUpperCase();
    if (!REF_CODE.test(code)) return refuse('code-unknown', 404);
    const owner = one(must(await db().from('referral_codes').select('user_id').eq('code', code).limit(1), 'referral lookup'));
    if (!owner || !owner.user_id) return refuse('code-unknown', 404);
    const inviter = owner.user_id;
    const invitee = caller.userId;
    if (inviter === invitee) return refuse('self');
    // No limit on the account's age: an invitee only has to have played nothing yet
    // (below), so a friend who confirms their email days later still gets the games.
    const played = must(await db().from('game_usage').select('id').eq('user_id', invitee).limit(1), 'invitee usage') || [];
    if (played.length) return refuse('already-played');
    const mine = must(await db().from('referral_redemptions').select('inviter_id').eq('invitee_id', invitee).limit(1), 'invitee redemption') || [];
    if (mine.length) return refuse('already-redeemed');
    const theirs = must(await db().from('referral_redemptions').select('status').eq('inviter_id', inviter), 'inviter redemptions') || [];
    if (theirs.filter((r) => r.status === 'pending' || r.status === 'qualified').length >= MAX_FRIENDS) return refuse('inviter-full');
    const net = ipPrefixHash(req.ip, env());
    const nets = must(await db().from('app_sessions').select('ip_prefix_hash').eq('user_id', inviter), 'inviter networks') || [];
    // An inviter known on no network (never signed in to the app) cannot be
    // told apart from the invitee's own second account: refused.
    if (!nets.some((s) => s && s.ip_prefix_hash)) return refuse('inviter-unverified');
    if (net && nets.some((s) => s && s.ip_prefix_hash && safeEqual(s.ip_prefix_hash, net))) return refuse('same-network');
    // A refund or a dispute ended this account and zeroed its free games for
    // good: an invite never gives them back.
    const mineEnt = one(must(await db().rpc('ensure_entitlement', { p_user: invitee }), 'ensure_entitlement'));
    if (!mineEnt || mineEnt.status === 'ended' || Number(mineEnt.free_total) === 0) return refuse('account-ended');
    const ins = await db().from('referral_redemptions').insert({
      invitee_id: invitee, inviter_id: inviter, code, status: 'pending', created_at: iso(now()),
    });
    if (ins.error && ins.error.code === '23505') return refuse('already-redeemed');
    must(ins, 'redemption insert');
    const raised = must(await db().from('entitlements').update({ free_total: INVITED_FREE_TOTAL, updated_at: iso(now()) })
      .eq('user_id', invitee).eq('status', 'active').select('user_id'), 'invitee free games') || [];
    if (!raised.length) {
      // Ended between the read and the write: the redemption goes too.
      must(await db().from('referral_redemptions').delete().eq('invitee_id', invitee), 'redemption undo');
      return refuse('account-ended');
    }
    resolver.forgetEntitlement(invitee);
    res.json({ ok: true, free_total: INVITED_FREE_TOTAL });
  }));

  return router;
}

const router = createRouter();
module.exports = router;
module.exports.createRouter = createRouter;
module.exports.createMeter = createMeter;
module.exports.meter = meter;
module.exports.ipLimiter = ipLimiter;
module.exports.LIMITS = { MATCH_READS_COUNTED, FLUSH_MS, ALLOW_MS, MATCH_GAP_MS, SHORT_END_MS, REVIEW_WINDOW_MS,
  OPEN_MS, LATE_REVIEW_GAP_MS,
  REFUNDS_PER_DAY, REVIEWS_PER_GAME, HANDOFF_MS, MAX_FRIENDS, MAX_EARNED, FREE_GAMES, INVITE_EXTRA_GAMES, INVITED_FREE_TOTAL };
module.exports.PATTERNS = { B64URL, VERIFIER, REF_CODE };
module.exports.CODE_ALPHABET = CODE_ALPHABET;
module.exports.INVITE_BASE = INVITE_BASE;
