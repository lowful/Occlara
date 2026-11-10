'use strict';

/**
 * THE RATE LIMITS (8.7.3): one small fixed window limiter, its keys, and the
 * guard against made up credentials. server.js wires them; the table of what
 * guards which route, and why, is docs/claude/accounts.md "Rate limits".
 *
 * KEYED BY WHO IS CALLING when that is known: the verified caller's
 * accountKey (services/caller.js, set by server.js identifyFirst before any
 * limiter runs), so two players behind one router never share a bucket and
 * one account on two networks still has one. A caller not verified is keyed
 * by its address (caller.js ipBucket: an IPv4 address, an IPv6 /64), never by
 * a key or token it typed, so made up keys share one bucket per address.
 *
 * THE ADDRESS IS EXPRESS'S req.ip, with app.set('trust proxy', 1): the one
 * entry Railway's edge appended to X-Forwarded-For. A client that sends its
 * own X-Forwarded-For only adds entries to the left of it, which are never
 * read, so it cannot move to a fresh bucket (test:ratelimits).
 *
 * THE ANSWER is 429 { error: 'rate-limited', retryAfter } with a Retry-After
 * header in seconds. Every client in the field reads a 429 on a background
 * call as "try later" and says nothing (accounts.md), and nothing here is
 * ever said mid match.
 *
 * MEMORY IS BOUNDED. A key whose window has passed is dropped by the next
 * sweep (at most once a window), and past maxKeys the oldest keys go first.
 */

const callers = require('./caller');

/** The bucket of the request's verified caller, else of its address. */
function byCaller(req) {
  if (req && req.caller && req.caller.accountKey) return `a:${req.caller.accountKey}`;
  return byIp(req);
}

/** The bucket of the request's address alone. */
function byIp(req) {
  return callers.ipBucket((req && req.ip) || (req && req.socket && req.socket.remoteAddress));
}

/**
 * A fixed window limiter as Express middleware.
 *   name      what the answer names (`what`) and the logs say
 *   windowMs  the window
 *   max       requests a key may make in one window
 *   key       (req) => the bucket, byCaller by default
 *   skip      (req) => true to let a request through uncounted
 *   body      (retryAfterSec) => the 429's body, { error: 'rate-limited', retryAfter } by default
 *   now       the clock, for the tests
 *   maxKeys   the most keys kept
 */
function createLimiter(opts) {
  const o = opts || {};
  const name = o.name || 'limit';
  const windowMs = o.windowMs;
  const max = o.max;
  const keyOf = o.key || byCaller;
  const skip = o.skip || null;
  const now = o.now || (() => Date.now());
  const maxKeys = o.maxKeys || 20000;
  const bodyOf = o.body || ((retryAfter) => ({ error: 'rate-limited', what: name, retryAfter }));
  if (!(windowMs > 0) || !(max > 0)) throw new Error(`rate limit ${name} needs a window and a max`);

  const hits = new Map();   // key -> { start, n }
  let swept = now();

  function sweep(at) {
    if (at - swept < windowMs && hits.size <= maxKeys) return;
    swept = at;
    for (const [k, e] of hits) if (at - e.start >= windowMs) hits.delete(k);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
  }

  /** Count one request for a key: { ok } or { ok: false, retryAfter } (seconds). */
  function take(k) {
    const at = now();
    sweep(at);
    let e = hits.get(k);
    if (!e || at - e.start >= windowMs) {
      e = { start: at, n: 0 };
      hits.delete(k);
      hits.set(k, e);
    }
    if (e.n >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((e.start + windowMs - at) / 1000)) };
    e.n++;
    return { ok: true };
  }

  function middleware(req, res, next) {
    try {
      if (skip && skip(req)) return next();
      const r = take(String(keyOf(req)));
      if (r.ok) return next();
      if (typeof res.set === 'function') res.set('Retry-After', String(r.retryAfter));
      else if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(r.retryAfter));
      return res.status(429).json(bodyOf(r.retryAfter));
    } catch (e) {
      // A limiter that fails lets the request through: it guards cost, never access.
      console.warn(`[rate-limit] ${name} failed:`, e.message);
      return next();
    }
  }
  middleware.take = take;
  middleware.hits = hits;
  middleware.limits = { name, windowMs, max };
  return middleware;
}

/**
 * MADE UP CREDENTIALS COST A LOOKUP EACH. A key or token the caller caches do
 * not know is asked of the database before any limiter can key it by account,
 * so an address that keeps sending ones that are not valid is stopped here,
 * before the lookup: past `max` refused identifications in `windowMs`, its
 * requests WITH credentials are answered 429 without being looked up. A valid
 * caller is never counted, and neither is an outage ('unavailable'), the
 * activation limiter's rule. Requests carrying nothing are never touched.
 *
 * Returns { blocked(req) -> retryAfter seconds | 0, note(req, status) }.
 */
function createGuessGuard({ windowMs = 10 * 60 * 1000, max = 60, now = () => Date.now(), maxKeys = 20000 } = {}) {
  const misses = new Map();   // ip bucket -> { start, n }
  let swept = now();
  function sweep(at) {
    if (at - swept < windowMs && misses.size <= maxKeys) return;
    swept = at;
    for (const [k, e] of misses) if (at - e.start >= windowMs) misses.delete(k);
    while (misses.size > maxKeys) misses.delete(misses.keys().next().value);
  }
  function blocked(req) {
    const at = now();
    sweep(at);
    const e = misses.get(byIp(req));
    if (!e || at - e.start >= windowMs || e.n < max) return 0;
    return Math.max(1, Math.ceil((e.start + windowMs - at) / 1000));
  }
  function note(req, status) {
    if (status !== 'invalid') return;
    const at = now();
    const k = byIp(req);
    let e = misses.get(k);
    if (!e || at - e.start >= windowMs) { e = { start: at, n: 0 }; misses.delete(k); misses.set(k, e); }
    e.n++;
  }
  return { blocked, note, misses, limits: { windowMs, max } };
}

const MIN = 60 * 1000;

/** The licence a licence route's body names, for its bucket beside the address. */
function bodyKey(req) {
  const b = (req && req.body) || {};
  return String(b.key || b.licenseKey || (req && req.headers && req.headers['x-license-key']) || '').trim().toUpperCase().slice(0, 40);
}

// A licence route's 429 keeps a sentence in `error`: the activation window of
// every installed client prints that field as it is (license-service.js), and
// reads any 429 as "the licence server could not check", keeping the cache.
const LICENCE_BODY = (retryAfter) => ({
  error: 'Too many licence checks from this network. Try again in a few minutes.',
  code: 'rate-limited', retryAfter, retry: true,
});

/**
 * THE ROUTE LIMITS server.js mounts, in order, after the caller is named
 * (identifyFirst) and the body parsed. Each is { paths, mw }. The numbers are
 * the "Rate limits" table of docs/claude/accounts.md; every one is at least
 * five times what a real client sends (test:ratelimits replays them).
 *
 *   deps.now      the clock (tests)
 *   deps.isAdmin  (req) => the request carries the right admin password: a
 *                 bench's own review and look calls are never counted
 *   deps.hasCredentials (req) => the request names a caller at all
 */
function routeLimits(deps = {}) {
  const now = deps.now;
  const isAdmin = deps.isAdmin || (() => false);
  const hasCredentials = deps.hasCredentials || callers.hasCredentials;
  const bench = (req) => !!(req && req.headers && req.headers['x-admin-password'] !== undefined && isAdmin(req));
  const L = (o) => createLimiter({ now, ...o });
  const RIOT_DATA = ['/api/coach/player-stats', '/api/coach/rank-history', '/api/coach/match-deaths',
    '/api/coach/match-rounds', '/api/coach/matches', '/api/coach/last-match', '/api/coach/recent-matches'];
  return [
    // Accounts and games (8.7). me() is asked at launch, on the licence watch,
    // after every game and on Start, a minute's cache between: about ten in
    // ten minutes at the most.
    { paths: ['/api/account/me'], mw: L({ name: 'account-me', windowMs: 10 * MIN, max: 120 }) },
    // A Riot record run claims at most ten games (backfill.js MAX_MATCHES), a
    // League game one; a take back releases what the run claimed.
    { paths: ['/api/usage'], mw: L({ name: 'usage', windowMs: 10 * MIN, max: 60 }) },
    // The Invite page asks once a visit; the site redeems once after signup.
    { paths: ['/api/referral'], mw: L({ name: 'referral', windowMs: 10 * MIN, max: 30 }) },
    // Gifts (8.8): the /gift page peeks once a visit, a redemption is one call,
    // the Profile and Account pages list once a visit. Codes cannot be guessed
    // (130 bits), and routes/gifts.js stops an address after 10 unknown codes an hour.
    { paths: ['/api/gifts/peek'], mw: L({ name: 'gift-peek', windowMs: 10 * MIN, max: 60, key: byIp }) },
    { paths: ['/api/gifts/redeem'], mw: L({ name: 'gift-redeem', windowMs: 10 * MIN, max: 20 }) },
    { paths: ['/api/gifts'], mw: L({ name: 'gifts', windowMs: 10 * MIN, max: 60 }) },
    // A sign in is one handoff; a sign out one call. Per IP limits stay in usage.js.
    { paths: ['/api/account/handoff', '/api/account/signout'], mw: L({ name: 'account-session', windowMs: 10 * MIN, max: 30 }) },
    // The licence check: the app re-checks every three minutes through
    // /activate, so ten minutes is four calls. Keyed by the address AND the
    // key it names (one bucket per licence per network), and by the address
    // alone with a ceiling a whole cafe never meets, so made up keys share it.
    { paths: ['/api/license/activate', '/api/license/validate'],
      mw: L({ name: 'licence', windowMs: 10 * MIN, max: 30, key: (req) => `${byIp(req)}|${bodyKey(req)}`, body: LICENCE_BODY }) },
    { paths: ['/api/license/activate', '/api/license/validate'],
      mw: L({ name: 'licence-network', windowMs: 10 * MIN, max: 300, key: byIp, body: LICENCE_BODY }) },
    // The site's signed in routes. Each asks Supabase Auth for the user before
    // anything else, and the portal, cancel and deactivate call Stripe or
    // write: by address, since the user is only known inside the route.
    { paths: ['/api/account/dashboard'], mw: L({ name: 'dashboard', windowMs: 10 * MIN, max: 60, key: byIp }) },
    { paths: ['/api/account/portal', '/api/payments/cancel', '/api/license/deactivate'],
      mw: L({ name: 'billing', windowMs: 10 * MIN, max: 20, key: byIp }) },
    // The recording's telemetry block: one a session.
    { paths: ['/api/coach/session-report'], mw: L({ name: 'telemetry', windowMs: 60 * MIN, max: 30 }) },
    // The two costly model routes: a match asks for its review twice (the
    // engine's and the late one) and its look twice (the screen's and
    // Riot's). Six matches an hour is twenty four; a bench is not counted.
    { paths: ['/api/coach/match-review'], mw: L({ name: 'review', windowMs: 60 * MIN, max: 60, skip: bench }) },
    { paths: ['/api/coach/death-forensics'], mw: L({ name: 'look', windowMs: 60 * MIN, max: 60, skip: bench }) },
    // The agent look (8.11.0): a vision call too, and before this only the
    // 90 a minute of every coach route held it, 5400 an hour. The app sends
    // none since the look was turned off (AGENT_LOOKS_PER_MATCH 0), at most a
    // few a match when on, and an app before 8.4.4 retried every 30 s until
    // an agent locked, 120 in an hour that never locks. 60 an hour leaves
    // every match its looks; a bench is not counted.
    { paths: ['/api/coach/detect-agent'], mw: L({ name: 'agent-look', windowMs: 60 * MIN, max: 60, skip: bench }) },
    // HenrikDev's quota, shared by every player: for every tier now, the free
    // tier's tighter limit (server.js freeRiotLimiter) as well.
    { paths: RIOT_DATA, mw: L({ name: 'riot-data', windowMs: 10 * MIN, max: 120 }) },
    // What answers with nothing to look up still answers: a ceiling per address.
    { paths: ['/health', '/api/health', '/admin'], mw: L({ name: 'public', windowMs: MIN, max: 120, key: byIp }) },
    // Any /api request carrying no credentials at all, per address. The
    // Stripe webhook is mounted before every limiter and never reaches one.
    { paths: ['/api'], mw: L({ name: 'anonymous', windowMs: MIN, max: 300, key: byIp,
      skip: (req) => hasCredentials(req) || String(req.originalUrl || '').startsWith('/api/payments/webhook') }) },
  ];
}

/*
 * On Railway, req.ip becomes X-Real-IP: Railway's edge sets it to the real client and
 * overwrites one a client sends, while trust proxy 1 lands on the edge node's own
 * address (two hops). Only when Railway's own variables are present, so a local run
 * or a test never trusts a header a client could write.
 */
function realIpMiddleware(env = process.env) {
  const onRailway = !!(env && (env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID));
  return (req, _res, next) => {
    if (onRailway) {
      const real = String((req.headers && req.headers['x-real-ip']) || '').trim();
      if (require('net').isIP(real)) Object.defineProperty(req, 'ip', { value: real, configurable: true });
    }
    next();
  };
}

/*
 * REPORT A PROBLEM (docs/claude/feedback.md): 5 reports an hour and 20 a day
 * per account, a person writing them by hand never meets either. Keyed by
 * the verified caller (routes/feedback.js runs them after it has one), so
 * two players behind one router never share a bucket. A report refused by
 * them is answered 429 and says "try again later" in the app.
 */
// ALL is a ceiling across every account, so many accounts together cannot fill the picture bucket.
const FEEDBACK_LIMITS = Object.freeze({ HOUR: 5, DAY: 20, ALL: 300 });
function feedbackLimits(deps = {}) {
  const now = deps.now;
  return [
    createLimiter({ name: 'feedback-hour', windowMs: 60 * MIN, max: FEEDBACK_LIMITS.HOUR, now }),
    createLimiter({ name: 'feedback-day', windowMs: 24 * 60 * MIN, max: FEEDBACK_LIMITS.DAY, now }),
    createLimiter({ name: 'feedback-all', windowMs: 24 * 60 * MIN, max: FEEDBACK_LIMITS.ALL, now, key: () => 'all' }),
  ];
}

module.exports = { createLimiter, createGuessGuard, routeLimits, feedbackLimits, FEEDBACK_LIMITS, byCaller, byIp, bodyKey, LICENCE_BODY, realIpMiddleware };
