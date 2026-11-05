'use strict';

/**
 * GIFTS.SQL AS A FAKE (8.8), on top of fake-billing.js's accounts.
 *
 * withGifts(sb) wraps a makeSupabase() client: the gift functions (gift_mint,
 * gift_of_ref, gift_peek, gift_list, redeem_gift, void_gift) answer from a
 * model of gifts.sql, and ensure_entitlement, account_state and claim_game
 * settle the account's gifts first, as gifts.sql's ensure_entitlement does
 * before it returns (both of the others call it first). Everything else goes
 * to the wrapped client unchanged.
 *
 * gifts.sql runs each function as one transaction holding row locks in one
 * order (the account, its gift row, the gift). The fake runs every gift
 * function and every settling call one at a time (one queue), which is what
 * those locks give, so a test can fire twenty redemptions at once and count
 * what the routes made of them.
 *
 * entitlements.source takes 'gift' here as gifts.sql's CHECK does: the shared
 * ACCOUNT_TABLES spec gains it when this file loads (it is the test process's
 * own copy).
 *
 * live: false is the database before gifts.sql: every gift function is
 * PGRST202, and nothing settles.
 */

const crypto = require('crypto');
const { ACCOUNT_TABLES, addMonthsUTC } = require('./fake-billing');

if (!ACCOUNT_TABLES.entitlements.checks.source.includes('gift')) ACCOUNT_TABLES.entitlements.checks.source.push('gift');

const GIFT_FUNCTIONS = ['gift_mint', 'gift_of_ref', 'gift_peek', 'gift_list', 'redeem_gift', 'void_gift', 'gift_settle'];
const SETTLING = ['ensure_entitlement', 'account_state', 'claim_game'];
const HEX64 = /^[0-9a-f]{64}$/;

const pgError = (code, message) => ({ code, message, details: null, hint: null });

function withGifts(sb, opts = {}) {
  const st = { live: opts.live !== false, gifts: [], accounts: new Map(), calls: [] };
  let queue = Promise.resolve();
  /** One at a time, as the row locks make them. */
  const serial = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  const now = () => sb._db.clock();
  const iso = (t) => (t == null ? null : new Date(t).toISOString());
  const ms = (t) => (t == null ? null : Date.parse(t));
  const entOf = (user) => sb._db.tables.entitlements.find((e) => e.user_id === user) || null;
  const byId = (id) => st.gifts.find((g) => g.id === id) || null;
  const zero = (r) => !r || (!(r.months > 0) && !(r.ms > 0));
  const endOf = (start, r) => (r.months ? addMonthsUTC(start, r.months) : start + r.ms);
  const remainingOut = (r) => (zero(r) ? '00:00:00' : r.months ? `${r.months} mons` : `${Math.round(r.ms / 1000)} seconds`);

  async function ensure(user) {
    const r = await sb.rpc('ensure_entitlement', { p_user: user });
    if (r.error) throw Object.assign(new Error(r.error.message), { pg: r.error });
    return r.data;
  }

  function writeEnt(user, patch) {
    const e = entOf(user);
    Object.assign(e, patch, { updated_at: e.status === 'ended' ? e.updated_at : iso(now()) });
    return e;
  }

  /** gift_end_running */
  function endRunning(user, at, isVoid) {
    const ga = st.accounts.get(user);
    if (!ga || !ga.gift_id) return;
    const g = byId(ga.gift_id);
    g.remaining = { ms: 0 };
    g.ends_at = Math.min(g.ends_at == null ? at : g.ends_at, at);
    if (!isVoid) g.used_up_at = at;
    const e = entOf(user);
    if (ga.prev && e && e.source === 'gift') {
      writeEnt(user, {
        tier: ga.prev.tier || 'free', cap_monthly: ga.prev.cap_monthly || 0, source: ga.prev.source || 'free',
        stripe_subscription_id: ga.prev.stripe_subscription_id, period_anchor: ga.prev.period_anchor, renew_as: ga.prev.renew_as,
      });
    }
    Object.assign(ga, { gift_id: null, gift_until: null, prev: null });
  }

  /** gift_settle, the entitlement row already made. */
  function settle(user) {
    const ga = st.accounts.get(user);
    let e = entOf(user);
    if (!ga || !e) return;
    let at = null;
    for (let n = 0; n < 60; n++) {
      if (ga.gift_id) {
        const g = byId(ga.gift_id);
        if (e.source !== 'gift' || e.status !== 'active' || e.tier !== g.tier) {
          const over = Math.min(Math.max(ms(e.updated_at), g.starts_at), now());
          g.remaining = { ms: Math.max(g.ends_at - over, 0) };
          g.starts_at = null;
          g.ends_at = null;
          Object.assign(ga, { gift_id: null, gift_until: null, prev: null });
          at = null;
        } else if (ga.gift_until <= now()) {
          at = ga.gift_until;
          endRunning(user, ga.gift_until, false);
          e = entOf(user);
        } else break;
      }
      if (e.status !== 'active' || e.tier !== 'free') break;
      const g = st.gifts
        .filter((x) => x.redeemed_by === user && x.status === 'redeemed' && x.starts_at == null && !zero(x.remaining))
        .sort((a, b) => a.redeemed_at - b.redeemed_at || String(a.id).localeCompare(String(b.id)))[0];
      if (!g) break;
      const start = Math.max(at == null ? now() : at, g.redeemed_at);
      const end = endOf(start, g.remaining);
      g.starts_at = start;
      g.ends_at = end;
      Object.assign(ga, {
        gift_id: g.id, gift_until: end,
        prev: { tier: e.tier, cap_monthly: e.cap_monthly, source: e.source, stripe_subscription_id: e.stripe_subscription_id,
          period_anchor: e.period_anchor, renew_as: e.renew_as },
      });
      e = writeEnt(user, { tier: g.tier, cap_monthly: g.cap_monthly, source: 'gift', stripe_subscription_id: null,
        period_anchor: iso(start), renew_as: null });
    }
  }

  const stateOf = (g, forBuyer) => {
    if (g.status === 'void') return 'void';
    if (g.status === 'unredeemed') return 'unredeemed';
    const ga = st.accounts.get(g.redeemed_by);
    if (ga && ga.gift_id === g.id && (!forBuyer || ga.gift_until > now())) return 'running';
    if (g.starts_at == null && !zero(g.remaining)) return 'waiting';
    if (forBuyer && g.ends_at != null && g.ends_at > now()) return 'running';
    return 'used';
  };

  const FN = {
    async gift_mint(a) {
      if (!a.p_ref) throw Object.assign(new Error('gift_mint: no ref'), { pg: pgError('P0001', 'gift_mint: no ref') });
      if (!a.p_buyer) throw Object.assign(new Error('gift_mint: no buyer'), { pg: pgError('P0001', 'gift_mint: no buyer') });
      const have = st.gifts.find((g) => g.ref === a.p_ref);
      if (have) return { minted: false, reason: 'existing', status: have.status };
      const bad = !HEX64.test(String(a.p_code_hash || '')) || !['pro', 'max'].includes(a.p_tier) || ![1, 12].includes(a.p_months)
        || !(a.p_cap > 0) || !(a.p_amount_cents >= 0) || (a.p_from_name != null && (a.p_from_name.length < 1 || a.p_from_name.length > 20));
      if (bad) throw Object.assign(new Error('check'), { pg: pgError('23514', 'new row for relation "gifts" violates a check constraint') });
      if (st.gifts.some((g) => g.code_hash === a.p_code_hash)) {
        throw Object.assign(new Error('dup'), { pg: pgError('23505', 'duplicate key value violates unique constraint "gifts_code_hash_key"') });
      }
      const g = {
        id: crypto.randomUUID(), code_hash: a.p_code_hash, ref: a.p_ref, payment_intent: a.p_payment_intent || null,
        buyer_id: a.p_buyer, from_name: a.p_from_name ? String(a.p_from_name).trim() || null : null, tier: a.p_tier,
        months: a.p_months, cap_monthly: a.p_cap, amount_cents: a.p_amount_cents, status: 'unredeemed', redeemed_by: null,
        redeemed_at: null, remaining: null, starts_at: null, ends_at: null, used_up_at: null, void_reason: null, voided_at: null,
        created_at: now(),
      };
      st.gifts.push(g);
      return { minted: true, reason: null, status: g.status };
    },
    async gift_of_ref(a) {
      const g = st.gifts.find((x) => x.ref === a.p_ref);
      return g ? { found: true, buyer_id: g.buyer_id, tier: g.tier, months: g.months, status: g.status } : { found: false };
    },
    async gift_peek(a) {
      const g = st.gifts.find((x) => x.code_hash === a.p_code_hash);
      return g ? { found: true, status: g.status, tier: g.tier, months: g.months, from_name: g.from_name, buyer_id: g.buyer_id,
        redeemed_by: g.redeemed_by } : { found: false };
    },
    async gift_list(a) {
      await ensure(a.p_user);
      settle(a.p_user);
      const bought = st.gifts.filter((g) => g.buyer_id === a.p_user).sort((x, y) => y.created_at - x.created_at).map((g) => ({
        id: g.id, ref: g.ref, code_hash: g.code_hash, tier: g.tier, months: g.months, from_name: g.from_name,
        created_at: iso(g.created_at), redeemed_at: iso(g.redeemed_at), state: stateOf(g, true),
      }));
      const received = st.gifts.filter((g) => g.redeemed_by === a.p_user).sort((x, y) => y.redeemed_at - x.redeemed_at).map((g) => ({
        id: g.id, tier: g.tier, months: g.months, from_name: g.from_name, redeemed_at: iso(g.redeemed_at),
        starts_at: iso(g.starts_at), ends_at: iso(g.ends_at), state: stateOf(g, false),
      }));
      return { bought, received };
    },
    async gift_settle(a) {
      await ensure(a.p_user);
      settle(a.p_user);
      return entOf(a.p_user);
    },
    async redeem_gift(a) {
      if (!a.p_user) throw Object.assign(new Error('redeem_gift: no user'), { pg: pgError('P0001', 'redeem_gift: no user') });
      if (!HEX64.test(String(a.p_code_hash || ''))) return { redeemed: false, reason: 'unknown' };
      await ensure(a.p_user);
      settle(a.p_user);
      const e = entOf(a.p_user);
      const g = st.gifts.find((x) => x.code_hash === a.p_code_hash);
      let reason = null;
      if (!g) reason = 'unknown';
      else if (g.status === 'void') reason = 'void';
      else if (g.status === 'redeemed' && g.redeemed_by === a.p_user) {
        return { redeemed: true, reason: 'existing', tier: g.tier, months: g.months, started: g.starts_at != null,
          starts_at: iso(g.starts_at), ends_at: iso(g.ends_at), waits_for: null };
      } else if (g.status === 'redeemed') reason = 'already';
      else if (g.buyer_id === a.p_user) reason = 'self';
      else if (e.status !== 'active') reason = 'account-ended';
      else if (['legacy_lifetime', 'comp'].includes(e.source)) reason = 'lifetime';
      if (reason) return { redeemed: false, reason };
      Object.assign(g, { status: 'redeemed', redeemed_by: a.p_user, redeemed_at: now(), remaining: { months: g.months } });
      if (!st.accounts.has(a.p_user)) st.accounts.set(a.p_user, { user_id: a.p_user, gift_id: null, gift_until: null, prev: null });
      settle(a.p_user);
      const ga = st.accounts.get(a.p_user);
      return { redeemed: true, reason: null, tier: g.tier, months: g.months, started: g.starts_at != null,
        starts_at: iso(g.starts_at), ends_at: iso(g.ends_at),
        waits_for: g.starts_at != null ? null : ga.gift_id ? 'gift' : 'plan' };
    },
    async void_gift(a) {
      if (!a.p_ref) throw Object.assign(new Error('void_gift: no ref'), { pg: pgError('P0001', 'void_gift: no ref') });
      if (!['refunded', 'disputed', 'admin'].includes(a.p_reason)) {
        throw Object.assign(new Error('reason'), { pg: pgError('P0001', `void_gift: unknown reason ${a.p_reason}`) });
      }
      const g = st.gifts.find((x) => x.ref === a.p_ref);
      if (!g) return { voided: false, reason: 'none' };
      const user = g.redeemed_by;
      if (user) { await ensure(user); settle(user); }
      if (g.status === 'void') return { voided: false, reason: 'already', was: 'void', running: false, user };
      const was = g.status;
      const ga = user ? st.accounts.get(user) : null;
      let running = false;
      if (ga && ga.gift_id === g.id) { running = true; endRunning(user, now(), true); }
      Object.assign(g, { status: 'void', void_reason: a.p_reason, voided_at: now(), remaining: { ms: 0 } });
      if (user) settle(user);
      return { voided: true, reason: null, was, running, user };
    },
  };

  const missing = (name) => ({ data: null, error: pgError('PGRST202',
    `Could not find the function public.${name} without parameters in the schema cache`) });

  function rpc(name, args = {}) {
    const run = async () => {
      st.calls.push({ name, args });
      if (GIFT_FUNCTIONS.includes(name)) {
        if (!st.live) return missing(name);
        return serial(async () => {
          const snap = { gifts: JSON.parse(JSON.stringify(st.gifts)), accounts: JSON.parse(JSON.stringify([...st.accounts])) };
          try {
            return { data: JSON.parse(JSON.stringify(await FN[name](args || {}))), error: null };
          } catch (err) {
            if (!err.pg) throw err;
            st.gifts = snap.gifts;
            st.accounts = new Map(snap.accounts);
            return { data: null, error: err.pg };
          }
        });
      }
      if (st.live && SETTLING.includes(name) && args && args.p_user) {
        return serial(async () => {
          const first = await sb.rpc('ensure_entitlement', { p_user: args.p_user });
          if (first.error) return first;
          settle(args.p_user);
          return sb.rpc(name, args);
        });
      }
      return sb.rpc(name, args);
    };
    const b = {
      single() { return b; },
      maybeSingle() { return b; },
      abortSignal() { return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return b;
  }

  function reset(next = {}) {
    sb.reset(next);
    st.live = next.gifts !== false;
    st.gifts = [];
    st.accounts = new Map();
    st.calls = [];
    queue = Promise.resolve();
  }

  return {
    from: (...a) => sb.from(...a), auth: sb.auth, rpc, _db: sb._db, setNow: sb.setNow, advance: sb.advance, reset,
    _gifts: st, settleNow: (user) => settle(user),
  };
}

module.exports = { withGifts, GIFT_FUNCTIONS, SETTLING };
