'use strict';

/**
 * THE GIFT ROUTES (8.8), under /api/gifts. What a gift is and the stacking
 * rule: services/gifts.js and docs/claude/accounts.md, "Gifts".
 *
 *   POST /api/gifts/peek    { code }  no sign in needed: what the link gives
 *     -> { status: 'unredeemed' | 'redeemed' | 'void', tier, months, from, yours }
 *        404 { error: 'gift-unknown' } for a code no gift has (or not a code)
 *        `yours` is 'buyer' or 'redeemer' when the caller is signed in and is one.
 *   POST /api/gifts/redeem  { code }  a signed in account (site JWT, app session, a key with an account)
 *     -> { ok: true, tier, months, started, starts_at, ends_at, waits_for, again }
 *        409/410/404 { error: 'refused', reason } reason one of unknown, void,
 *        already-redeemed, self, account-ended, lifetime
 *   GET  /api/gifts         the gifts the caller bought (each with its link) and redeemed
 *
 * CODES CANNOT BE GUESSED: 130 bits, and on top of that an address that names
 * codes no gift has is stopped, 10 an hour (peek and redeem together), with
 * 429 before any lookup. Per address and per account limits sit in
 * services/rate-limits.js routeLimits.
 *
 * NOT LIVE: until gifts.sql runs every route answers 503 { error:
 * 'gifts-not-live' }, and nothing else on the server changes.
 */

const express = require('express');
const callers = require('../services/caller');
const gifts = require('../services/gifts');
const { createGuessGuard } = require('../services/rate-limits');

const MISSES_PER_HOUR = 10;

function createRouter(deps = {}) {
  const router = express.Router();
  const db = () => deps.supabase || require('../db/supabase');
  const resolver = deps.resolver || callers.shared;
  const env = () => deps.env || process.env;
  const guard = deps.guard || createGuessGuard({ windowMs: 60 * 60 * 1000, max: MISSES_PER_HOUR, now: deps.now });
  const forget = deps.forget || forgetAccount;

  const NOT_LIVE = { error: 'gifts-not-live' };

  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.notLive) return res.status(503).json(NOT_LIVE);
      console.error('[gifts] route failed:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'gift-failed' });
    }
  };

  /** The caller with an account, answered for when there is none. */
  async function need(req, res) {
    const r = req.caller ? { status: 'valid', caller: req.caller } : await resolver.identify(req);
    if (r.status === 'valid' && r.caller.userId) return r.caller;
    if (r.status === 'unavailable') { res.status(503).json({ error: 'account-unavailable', retry: true }); return null; }
    if (r.status === 'valid') { res.status(403).json({ error: 'sign-in-required' }); return null; }
    res.status(401).json(r.body || { error: 'sign-in-required' });
    return null;
  }

  /** Stops an address that keeps naming codes no gift has. True when it answered. */
  function stopped(req, res) {
    const wait = guard.blocked(req);
    if (!wait) return false;
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'rate-limited', what: 'gift-codes', retryAfter: wait });
    return true;
  }
  const miss = (req) => guard.note(req, 'invalid');

  // POST /api/gifts/peek
  router.post('/peek', handle(async (req, res) => {
    if (stopped(req, res)) return;
    const code = gifts.normalizeCode(req.body && req.body.code);
    if (!code) { miss(req); return res.status(404).json({ error: 'gift-unknown' }); }
    const g = await gifts.peek(db(), code);
    if (!g || !g.found) { miss(req); return res.status(404).json({ error: 'gift-unknown' }); }
    // Whose it is, only for a caller already named (server.js identifyFirst):
    // the page says "this is your own gift" or "already on your account".
    let me = req.caller && req.caller.userId;
    if (!me && callers.hasCredentials(req)) {
      try { const r = await resolver.identify(req); if (r.status === 'valid') me = r.caller.userId; } catch { me = null; }
    }
    const yours = me && me === g.buyer_id ? 'buyer' : me && me === g.redeemed_by ? 'redeemer' : null;
    res.json({ status: g.status, tier: g.tier, months: g.months, from: g.from_name || null, yours });
  }));

  // POST /api/gifts/redeem
  router.post('/redeem', handle(async (req, res) => {
    if (stopped(req, res)) return;
    const caller = await need(req, res);
    if (!caller) return;
    const refuse = (reason, status = 409) => res.status(status).json({ error: 'refused', reason });
    const code = gifts.normalizeCode(req.body && req.body.code);
    if (!code) { miss(req); return refuse('unknown', 404); }
    const r = await gifts.redeem(db(), code, caller.userId);
    if (!r.redeemed) {
      switch (r.reason) {
        case 'unknown': miss(req); return refuse('unknown', 404);
        case 'void': return refuse('void', 410);
        case 'already': return refuse('already-redeemed');
        case 'self': return refuse('self');
        case 'account-ended': return refuse('account-ended');
        case 'lifetime': return refuse('lifetime');
        default: return refuse(r.reason || 'refused');
      }
    }
    forget(caller.userId, resolver);
    console.log(`[gifts] a ${r.tier} gift of ${r.months} month(s) redeemed${r.reason === 'existing' ? ' again (already this account\'s)' : ''}`
      + `, ${r.started ? 'running now' : `waiting for the ${r.waits_for || 'plan'} before it`}`);
    res.json({
      ok: true, again: r.reason === 'existing', tier: r.tier, months: r.months, started: !!r.started,
      starts_at: r.starts_at || null, ends_at: r.ends_at || null, waits_for: r.waits_for || null,
    });
  }));

  // GET /api/gifts
  router.get('/', handle(async (req, res) => {
    const caller = await need(req, res);
    if (!caller) return;
    const out = await gifts.list(db(), caller.userId, gifts.secretOf(env()));
    res.json(out);
  }));

  return router;
}

/**
 * The account's tier and games left changed: the meter's and the resolver's
 * memory of them go, in this process, only when they are loaded.
 */
function forgetAccount(userId, resolver) {
  try {
    if (resolver && typeof resolver.forgetEntitlement === 'function') resolver.forgetEntitlement(userId);
    const loaded = require.cache[require.resolve('./usage')];
    const meter = loaded && loaded.exports && loaded.exports.meter;
    if (meter && typeof meter.forget === 'function') meter.forget(userId);
  } catch (e) {
    console.warn('[gifts] the account was not forgotten, it refreshes within 30 s:', e.message);
  }
}

const router = createRouter();
module.exports = router;
module.exports.createRouter = createRouter;
module.exports.forgetAccount = forgetAccount;
module.exports.MISSES_PER_HOUR = MISSES_PER_HOUR;
