'use strict';

/**
 * WHAT A PURCHASE ENTITLES REACHES THE ACCOUNT, AND A REFUND TAKES IT AWAY (8.7).
 *
 * The Stripe webhook writes the account (entitlements) beside the licence:
 *
 *   - checkout.session.completed and invoice.paid set the tier from the
 *     price's lookup_key, occlara_{pro,max}_{monthly,yearly}: cap 25 or 70,
 *     source stripe, the subscription, period_anchor its current period start.
 *     An old price maps by the payer rules: weekly and monthly are Pro, a
 *     yearly is Max until its renewal and Pro from it, lifetime is Max.
 *   - a key this server mints is plan monthly or yearly, never pro or max, so
 *     an 8.6 client keeps working, and it becomes the account's account_key.
 *   - customer.subscription.deleted sets the tier free and the cap 0, free
 *     games kept.
 *   - a full refund or any dispute revokes the licence and cancels the
 *     subscription FIRST, as before, and then ends the account: tier free,
 *     free_total 0, bonus_pool 0, status ended, every write checked and
 *     thrown. A partial refund changes nothing.
 *   - the refund's customer fallback ignores free keys.
 *   - without the accounts tables the licence path is exactly as it was.
 *
 * Runs the real handler against scripts/fixtures/fake-billing.js, with the
 * accounts tables from scripts/fixtures/fake-accounts.js. No network.
 *
 * Run: npm run test:entitlementwebhook
 */

const path = require('path');
const assert = require('assert');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, callRouter, SERVER, DAY } = require('./fixtures/fake-billing');
const { withAccounts, notLive } = require('./fixtures/fake-accounts');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const billing = require(path.join(SERVER, 'services', 'billing.js'));

// ── The pure rules first ────────────────────────────────────────────────────
{
  // Every new regex asserted against a known positive and a negative.
  assert.ok(billing.LOOKUP_KEY.test('occlara_pro_monthly') && billing.LOOKUP_KEY.test('occlara_max_yearly'));
  assert.ok(!billing.LOOKUP_KEY.test('occlara_pro_weekly') && !billing.LOOKUP_KEY.test('xocclara_pro_monthly'));
  const t = (price, o) => billing.tierOfPrice(price, o);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(same(t({ lookup_key: 'occlara_pro_monthly', recurring: { interval: 'month' } }),
    { tier: 'pro', cap: 25, source: 'stripe', plan: 'monthly', renewAs: null }), 'occlara_pro_monthly is Pro, 25 a month, plan monthly');
  ok(same(t({ lookup_key: 'occlara_max_yearly', recurring: { interval: 'year' } }),
    { tier: 'max', cap: 70, source: 'stripe', plan: 'yearly', renewAs: null }), 'occlara_max_yearly is Max, 70 a month, plan yearly');
  ok(t({ recurring: { interval: 'week' } }).tier === 'pro' && t({ recurring: { interval: 'week' } }).source === 'legacy_weekly',
    'an old weekly price is Pro (legacy_weekly)');
  ok(t({ recurring: { interval: 'month' } }).tier === 'pro' && t({ recurring: { interval: 'month' } }).source === 'legacy_monthly',
    'an old monthly price is Pro (legacy_monthly)');
  ok(same(t({ recurring: { interval: 'year' } }), { tier: 'max', cap: 70, source: 'legacy_yearly', plan: 'yearly', renewAs: 'pro_yearly' }),
    'an old yearly is Max until its renewal, renew_as pro_yearly');
  ok(same(t({ recurring: { interval: 'year' } }, { renewal: true }), { tier: 'pro', cap: 25, source: 'legacy_yearly', plan: 'yearly', renewAs: null }),
    'and at its renewal it is Pro yearly, 25 a month');
  ok(same(t({ recurring: null }), { tier: 'max', cap: 70, source: 'legacy_lifetime', plan: 'lifetime', renewAs: null }),
    'an old one-time price (lifetime) is Max for life');
  ok(t(null) === null && billing.tierOfPlan('free') === null, 'no price, or a plan that is none of the old ones, entitles nothing');
  ok(['42P01', 'PGRST205', 'PGRST202', '42883'].every((code) => billing.accountsMissing({ code }))
    && !billing.accountsMissing({ code: '23505' }) && !billing.accountsMissing(null),
  'a missing table or function reads as accounts not live, nothing else does');
}

// ── The handler ────────────────────────────────────────────────────────────
const base = makeSupabase();
const sb = withAccounts(base);
const st = makeStripe();

// fake-billing renders lookupKey, on the canonical subscription and session,
// as the price's lookup_key, which the server reads off the subscription's
// item and the checkout's line item.

const handler = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: sb, stripe: st.api });
async function fire(evt) {
  let res;
  const lines = await captureLogs(async () => { res = await deliver(handler, evt); });
  return { res, lines };
}
const now = () => Math.floor(Date.now() / 1000);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const ent = (u) => sb.entitlementOf(u);
const lic = (id) => base._db.rows.find((r) => r.id === id);
const iso = (sec) => new Date(sec * 1000).toISOString();

function reset({ rows = [], accounts = [], schema = 'migrated' } = {}) {
  st.reset();
  base.reset({ rows, schema });
  sb.accounts.rows = accounts.map((a) => ({
    tier: 'free', cap_monthly: null, free_total: 2, bonus_pool: 0, bonus_earned: 0, source: 'free',
    stripe_subscription_id: null, period_anchor: null, status: 'active', renew_as: null, account_key: null, ...a,
  }));
  sb.accounts.writes = [];
  sb.accounts.ensures = [];
  sb.accounts.failWrites = null;
  sb.accounts.failEnsure = null;
}

/** A subscription with its invoice, charge and checkout, as the site makes them. */
function subscription({ n, user = U1, interval = 'month', lookupKey = null, plan = 'monthly', amount = 2499,
  billingReason = 'subscription_create', meta = null }) {
  const sub = `sub_${n}`;
  const start = now() - 3 * DAY;
  const end = start + (interval === 'year' ? 365 : interval === 'week' ? 7 : 30) * DAY;
  st.s.subs.set(sub, { id: sub, customer: `cus_${n}`, status: 'active', current_period_start: start, current_period_end: end, interval, lookupKey });
  st.s.invoices.set(`in_${n}`, { id: `in_${n}`, customer: `cus_${n}`, subscription: sub, status: 'paid', charge: `ch_${n}`,
    payment_intent: `pi_${n}`, billing_reason: billingReason, lines: [{ id: `il_${n}`, subscription: sub, start, end }] });
  st.s.charges.set(`ch_${n}`, { id: `ch_${n}`, customer: `cus_${n}`, invoice: `in_${n}`, payment_intent: `pi_${n}`, amount });
  st.s.sessions.set(`cs_${n}`, { id: `cs_${n}`, mode: 'subscription', customer: `cus_${n}`, subscription: sub, payment_intent: null,
    invoice: `in_${n}`, metadata: meta || { user_id: user, plan }, interval, lookupKey });
  return { sub, start, end };
}
const licenceOf = ({ n, user = U1, plan = 'monthly', key, end }) => ({
  id: `lic_${n}`, user_id: user, license_key: key, plan, status: 'active', expires_at: iso(end + 2 * DAY),
  stripe_customer_id: `cus_${n}`, stripe_subscription_id: `sub_${n}`, stripe_session_id: `cs_${n}`,
});
const refundOf = (n, over = {}) => {
  const ch = { ...st.s.charges.get(`ch_${n}`), amount_refunded: st.s.charges.get(`ch_${n}`).amount, refunded: true, ...over };
  st.s.charges.set(`ch_${n}`, ch);
  return st.event('charge.refunded', 'charge', ch);
};

(async () => {
  // ── A site checkout sets the tier at once ──────────────────────────────────
  for (const [lookupKey, interval, tier, cap] of [['occlara_pro_monthly', 'month', 'pro', 25], ['occlara_max_yearly', 'year', 'max', 70]]) {
    for (const plan of ['pro_monthly', interval === 'year' ? 'yearly' : 'monthly']) {
      reset();
      const { start } = subscription({ n: 'A', lookupKey, interval, plan });
      const { res } = await fire(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_A')));
      const e = ent(U1);
      ok(res.code === 200 && e && e.tier === tier && e.cap_monthly === cap && e.source === 'stripe',
        `a site checkout on ${lookupKey} (metadata plan ${plan}) sets the account ${tier}, ${cap} a month, source stripe (${e && e.tier} ${e && e.cap_monthly})`);
      ok(e && e.stripe_subscription_id === 'sub_A' && e.period_anchor === iso(start) && e.status === 'active',
        'with its subscription and period_anchor at the subscription\'s current period start');
      ok(e && e.free_total === 2 && e.bonus_pool === 0, 'and the free games and the bonus as they were');
      ok(base._db.rows.length === 0, 'and the site still mints the key, so nothing is minted here');
    }
  }

  // ── A key minted here is monthly or yearly, never pro or max ──────────────
  for (const [lookupKey, interval, want] of [['occlara_max_monthly', 'month', 'monthly'], ['occlara_pro_yearly', 'year', 'yearly']]) {
    reset();
    subscription({ n: 'B', lookupKey, interval, meta: { userId: U1 } });
    const s = st.s.sessions.get('cs_B');
    s.client_reference_id = U1;
    const { res } = await fire(st.event('checkout.session.completed', 'session', s));
    const minted = base._db.rows[0];
    ok(res.code === 200 && minted && minted.plan === want, `a checkout on ${lookupKey} mints a ${want} key, never pro or max (${minted && minted.plan})`);
    ok(minted && ent(U1).account_key === minted.license_key, 'and the account\'s account_key is that key');
    ok(ent(U1).tier === lookupKey.split('_')[1], `and the account is ${lookupKey.split('_')[1]}`);
  }

  // ── invoice.paid renews the licence and the account together ──────────────
  {
    reset();
    const { end, start } = subscription({ n: 'C', lookupKey: 'occlara_pro_monthly', billingReason: 'subscription_cycle' });
    base.reset({ rows: [licenceOf({ n: 'C', key: 'GC-CCCC-CCCC-CCCC-CCCC', end: end - 30 * DAY })], schema: 'migrated' });
    sb.accounts.rows = [];
    const { res } = await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_C')));
    ok(res.code === 200 && lic('lic_C').expires_at === iso(end + 2 * DAY), 'invoice.paid renews the licence as before');
    const e = ent(U1);
    ok(e && e.tier === 'pro' && e.cap_monthly === 25 && e.period_anchor === iso(start) && e.stripe_subscription_id === 'sub_C',
      'and sets the account pro, 25 a month, anchored at the new period');
    ok(e && e.account_key === 'GC-CCCC-CCCC-CCCC-CCCC', 'and the account key is the licence the subscription bought');
  }
  {
    // The site mints the key at /success, often after the first invoice.
    reset();
    subscription({ n: 'D', lookupKey: 'occlara_max_monthly' });
    const { res } = await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_D'), '2025-03-31.basil'));
    ok(res.code === 200 && ent(U1) && ent(U1).tier === 'max', 'an invoice paid before any licence exists still reaches the account, by its checkout (basil event)');
  }
  {
    // A free key is never the account key a purchase sets.
    reset({ accounts: [{ user_id: U1, account_key: 'GC-FREE-FREE-FREE-FREE' }] });
    subscription({ n: 'E', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [{ id: 'lic_free', user_id: U1, license_key: 'GC-FREE-FREE-FREE-FREE', plan: 'free', status: 'active', expires_at: null }], schema: 'migrated' });
    await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_E')));
    ok(ent(U1).tier === 'pro' && ent(U1).account_key === 'GC-FREE-FREE-FREE-FREE', 'a free key stays the account key until a paid one names the subscription');
  }

  // ── The payer rules for old prices ────────────────────────────────────────
  for (const [interval, reason, tier, cap, source, renewAs] of [
    ['week', 'subscription_cycle', 'pro', 25, 'legacy_weekly', null],
    ['month', 'subscription_cycle', 'pro', 25, 'legacy_monthly', null],
    ['year', 'subscription_create', 'max', 70, 'legacy_yearly', 'pro_yearly'],
    ['year', 'subscription_cycle', 'pro', 25, 'legacy_yearly', null],
  ]) {
    reset({ accounts: [{ user_id: U1, tier: 'max', cap_monthly: 70, source: 'legacy_yearly', renew_as: 'pro_yearly', stripe_subscription_id: 'sub_F' }] });
    const plan = { week: 'weekly', month: 'monthly', year: 'yearly' }[interval];
    const { end } = subscription({ n: 'F', interval, plan, billingReason: reason });
    base.reset({ rows: [licenceOf({ n: 'F', plan, key: 'GC-FFFF-FFFF-FFFF-FFFF', end })], schema: 'migrated' });
    const { res } = await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_F')));
    const e = ent(U1);
    ok(res.code === 200 && e.tier === tier && e.cap_monthly === cap && e.source === source && e.renew_as === renewAs,
      `an old ${plan} price on ${reason} is ${tier}, ${cap} a month, ${source}, renew_as ${renewAs} (${e.tier} ${e.cap_monthly} ${e.renew_as})`);
    ok(lic('lic_F').plan === plan, `and its key stays plan ${plan}`);
  }
  {
    // The old one-time lifetime, through the old Railway checkout.
    reset({ schema: 'migrated' });
    st.s.sessions.set('cs_L', { id: 'cs_L', mode: 'payment', customer: 'cus_L', payment_intent: 'pi_L', metadata: { plan: 'lifetime', userId: U1 },
      client_reference_id: U1 });
    const { res } = await fire(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_L')));
    const e = ent(U1);
    ok(res.code === 200 && e.tier === 'max' && e.cap_monthly === 70 && e.source === 'legacy_lifetime' && e.stripe_subscription_id === null,
      'an old lifetime purchase is Max for life, with no subscription');
    // A subscription never moves it.
    subscription({ n: 'G', lookupKey: 'occlara_pro_monthly' });
    await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_G')));
    ok(ent(U1).tier === 'max' && ent(U1).source === 'legacy_lifetime', 'and a subscription bought on top never moves a lifetime account');
  }

  // ── Stripe ending the subscription ────────────────────────────────────────
  {
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe', stripe_subscription_id: 'sub_H', free_total: 4, bonus_pool: 4 }] });
    subscription({ n: 'H', lookupKey: 'occlara_pro_monthly' });
    st.s.subs.get('sub_H').status = 'canceled';
    const { res } = await fire(st.event('customer.subscription.deleted', 'subscription', st.s.subs.get('sub_H')));
    const e = ent(U1);
    ok(res.code === 200 && e.tier === 'free' && e.cap_monthly === 0 && e.free_total === 4 && e.bonus_pool === 4 && e.status === 'active',
      `a subscription Stripe ended sets the account free, cap 0, its free games and bonus kept (${e.tier} ${e.cap_monthly} ${e.free_total})`);
  }
  {
    reset({ accounts: [{ user_id: U1, tier: 'max', cap_monthly: 70, source: 'comp', stripe_subscription_id: 'sub_I' }] });
    subscription({ n: 'I' });
    await fire(st.event('customer.subscription.deleted', 'subscription', st.s.subs.get('sub_I')));
    ok(ent(U1).tier === 'max', 'and an account given by hand (comp) is not moved by it');
  }

  // ── A full refund or a dispute: the licence first, then the account ───────
  for (const kind of ['refund', 'dispute']) {
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe', stripe_subscription_id: 'sub_J', free_total: 4, bonus_pool: 8, bonus_earned: 8 }] });
    const { end } = subscription({ n: 'J', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'J', key: 'GC-JJJJ-JJJJ-JJJJ-JJJJ', end })], schema: 'migrated' });
    const evt = kind === 'refund' ? refundOf('J')
      : st.event('charge.dispute.created', 'dispute', { id: 'dp_J', charge: 'ch_J', payment_intent: 'pi_J', amount: 2499 });
    const { res } = await fire(evt);
    const e = ent(U1);
    ok(res.code === 200 && lic('lic_J').status === (kind === 'refund' ? 'refunded' : 'disputed') && st.s.subs.get('sub_J').status === 'canceled',
      `a ${kind} revokes the licence and cancels the subscription as before`);
    ok(e.tier === 'free' && e.cap_monthly === 0 && e.free_total === 0 && e.bonus_pool === 0 && e.status === 'ended',
      `and then ends the account: free, free_total 0, bonus_pool 0, status ended (${e.tier} ${e.free_total} ${e.bonus_pool} ${e.status})`);
  }
  {
    // Every account write checks its error and throws, AFTER the licence.
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe', stripe_subscription_id: 'sub_K' }] });
    const { end } = subscription({ n: 'K', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'K', key: 'GC-KKKK-KKKK-KKKK-KKKK', end })], schema: 'migrated' });
    sb.accounts.failWrites = '08006';
    const { res, lines } = await fire(refundOf('K'));
    ok(res.code === 500, `an account write the database refuses answers 500, so Stripe retries (${res.code})`);
    ok(lic('lic_K').status === 'refunded' && st.s.subs.get('sub_K').status === 'canceled',
      'and the licence was revoked and the billing stopped before it, the order unchanged');
    ok(lines.some((l) => /could not .*end the accounts/.test(l)) && !lines.some((l) => l.includes('GC-KKKK')),
      'and the failure is logged by code and message, no key in it');
    sb.accounts.failWrites = null;
    const again = await fire(refundOf('K'));
    ok(again.res.code === 200 && ent(U1).status === 'ended', 'and Stripe\'s retry lands it');
  }
  {
    // A refund that lands before the site minted the key still reaches the buyer.
    reset({ accounts: [{ user_id: U1, tier: 'max', cap_monthly: 70, source: 'stripe', stripe_subscription_id: 'sub_M', free_total: 2 }] });
    subscription({ n: 'M', lookupKey: 'occlara_max_monthly' });
    const { res } = await fire(refundOf('M'));
    ok(res.code === 200 && ent(U1).status === 'ended' && ent(U1).free_total === 0 && st.s.subs.get('sub_M').status === 'canceled',
      'a refund before any key exists cancels the subscription and ends the account that names it');
  }
  {
    // The refunded user with no account row yet gets one, ended: none starts later with free games.
    reset();
    const { end } = subscription({ n: 'N', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'N', key: 'GC-NNNN-NNNN-NNNN-NNNN', end })], schema: 'migrated' });
    await fire(refundOf('N'));
    ok(ent(U1) && ent(U1).status === 'ended' && ent(U1).free_total === 0, 'a refunded buyer with no account yet has one made and ended, free games 0');
  }
  {
    // Partial refund: nothing.
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe', stripe_subscription_id: 'sub_O', free_total: 2 }] });
    const { end } = subscription({ n: 'O', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'O', key: 'GC-OOOO-OOOO-OOOO-OOOO', end })], schema: 'migrated' });
    const { res } = await fire(refundOf('O', { amount_refunded: 500, refunded: false }));
    ok(res.code === 200 && ent(U1).tier === 'pro' && ent(U1).free_total === 2 && sb.accounts.writes.length === 0 && sb.accounts.ensures.length === 0,
      'a partial refund changes nothing on the account, not one write');
    ok(lic('lic_O').status === 'active' && st.s.subs.get('sub_O').status === 'active', 'nor on the licence or the subscription');
  }
  {
    // A late invoice.paid of the refunded subscription does not revive the account.
    reset({ accounts: [{ user_id: U1, tier: 'free', cap_monthly: 0, source: 'stripe', stripe_subscription_id: 'sub_P', free_total: 0, status: 'ended' }] });
    subscription({ n: 'P', lookupKey: 'occlara_pro_monthly' });
    await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_P')));
    ok(ent(U1).status === 'ended' && ent(U1).tier === 'free', 'a late invoice.paid of a refunded subscription leaves its account ended');
    st.s.subs.get('sub_P').status = 'canceled';
    await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_P')));
    ok(ent(U1).status === 'ended', 'and so does one Stripe delivers after the cancel');
  }

  // ── A retried refund the customer fallback matched still ends the account ─
  {
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe', free_total: 2, bonus_pool: 4 }] });
    st.s.charges.set('ch_S', { id: 'ch_S', customer: 'cus_S', invoice: null, payment_intent: 'pi_S', amount: 2499 });
    base.reset({ rows: [{ id: 'lic_S', user_id: U1, license_key: 'GC-SSSS-SSSS-SSSS-SSSS', plan: 'monthly', status: 'active',
      expires_at: iso(now() + 20 * DAY), stripe_customer_id: 'cus_S' }], schema: 'migrated' });
    const evt = st.event('charge.refunded', 'charge', { ...st.s.charges.get('ch_S'), amount_refunded: 2499, refunded: true });
    sb.accounts.failWrites = '08006';
    const first = await fire(evt);
    ok(first.res.code === 500 && lic('lic_S').status === 'refunded' && ent(U1).status === 'active',
      'the first delivery revokes the licence by the customer fallback, then fails on the account (500)');
    sb.accounts.failWrites = null;
    const again = await fire(evt);
    ok(again.res.code === 200 && ent(U1).status === 'ended' && ent(U1).free_total === 0 && ent(U1).bonus_pool === 0,
      `and Stripe's retry, which the fallback can no longer match, still ends the account (${ent(U1).status})`);
  }
  {
    // Two revoked licences for one customer: which account is unknown, so none is ended by the retry rule.
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, source: 'stripe' }, { user_id: U2, tier: 'pro', cap_monthly: 25, source: 'stripe' }] });
    st.s.charges.set('ch_S2', { id: 'ch_S2', customer: 'cus_S2', invoice: null, payment_intent: 'pi_S2', amount: 2499 });
    base.reset({ rows: [
      { id: 'lic_S2a', user_id: U1, license_key: 'GC-SS2A-SSSS-SSSS-SSSS', plan: 'monthly', status: 'refunded', expires_at: iso(now()), stripe_customer_id: 'cus_S2' },
      { id: 'lic_S2b', user_id: U2, license_key: 'GC-SS2B-SSSS-SSSS-SSSS', plan: 'monthly', status: 'disputed', expires_at: iso(now()), stripe_customer_id: 'cus_S2' },
    ], schema: 'migrated' });
    await fire(st.event('charge.refunded', 'charge', { ...st.s.charges.get('ch_S2'), amount_refunded: 2499, refunded: true }));
    ok(ent(U1).status === 'active' && ent(U2).status === 'active', 'a customer with several revoked licences is left for a human');
  }

  // ── A replayed checkout of a refunded one-time purchase does not revive it ─
  {
    const lifetimeSession = (id, created) => {
      st.s.sessions.set(id, { id, mode: 'payment', customer: 'cus_L', subscription: null, payment_intent: `pi_${id}`,
        created, metadata: { user_id: U1, plan: 'lifetime' } });
      return st.s.sessions.get(id);
    };
    const endedAt = new Date().toISOString();
    reset({ accounts: [{ user_id: U1, tier: 'free', cap_monthly: 0, free_total: 0, source: 'legacy_lifetime', status: 'ended', updated_at: endedAt }] });
    base.reset({ rows: [{ id: 'lic_L', user_id: U1, license_key: 'GC-LLLL-LLLL-LLLL-LLLL', plan: 'lifetime', status: 'refunded',
      expires_at: endedAt, stripe_customer_id: 'cus_L', stripe_session_id: 'cs_L' }], schema: 'migrated' });
    const { res } = await fire(st.event('checkout.session.completed', 'session', lifetimeSession('cs_L', now() - 2 * DAY)));
    ok(res.code === 200 && ent(U1).status === 'ended' && ent(U1).tier === 'free' && ent(U1).free_total === 0,
      `a redelivered completion of a refunded lifetime checkout leaves the account ended (${ent(U1).tier} ${ent(U1).status})`);
    base.reset({ rows: [], schema: 'migrated' });
    await fire(st.event('checkout.session.completed', 'session', lifetimeSession('cs_L2', now() - 2 * DAY)));
    ok(ent(U1).status === 'ended', 'and one bought before the account ended, with no licence row, does not revive it either');
    await fire(st.event('checkout.session.completed', 'session', lifetimeSession('cs_L3', now() + 60)));
    ok(ent(U1).status === 'active' && ent(U1).tier === 'max', `a new purchase made after it ended does (${ent(U1).tier} ${ent(U1).status})`);
  }

  // ── A refund before the licence and before the checkout event ended nothing ─
  {
    reset({ accounts: [{ user_id: U1, tier: 'free', cap_monthly: 0, free_total: 2, bonus_pool: 2, source: 'free' }] });
    subscription({ n: 'T', lookupKey: 'occlara_pro_monthly' });
    const { res } = await fire(refundOf('T'));
    ok(res.code === 200 && st.s.subs.get('sub_T').status === 'canceled' && ent(U1).status === 'ended'
      && ent(U1).free_total === 0 && ent(U1).bonus_pool === 0,
    `a refund before any key and any account naming the subscription ends the buyer the checkout names (${ent(U1).status} ${ent(U1).free_total})`);
    await fire(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_T')));
    ok(ent(U1).status === 'ended', 'and the checkout event retried after it leaves the account ended');
  }
  {
    reset({ accounts: [{ user_id: U1, tier: 'pro', cap_monthly: 25, free_total: 2, source: 'stripe', stripe_subscription_id: 'sub_OTHER' }] });
    subscription({ n: 'T2', lookupKey: 'occlara_pro_monthly' });
    await fire(refundOf('T2'));
    ok(ent(U1).status === 'active' && ent(U1).tier === 'pro', 'but a buyer whose account another live subscription pays for is left for a human');
  }

  // ── The customer fallback ignores free keys ───────────────────────────────
  {
    reset();
    st.s.charges.set('ch_Q', { id: 'ch_Q', customer: 'cus_Q', invoice: null, payment_intent: 'pi_Q', amount: 2499 });
    base.reset({ rows: [
      { id: 'lic_Qf', user_id: U1, license_key: 'GC-QQQQ-FREE-QQQQ-QQQQ', plan: 'free', status: 'active', expires_at: null, stripe_customer_id: 'cus_Q' },
      { id: 'lic_Qp', user_id: U1, license_key: 'GC-QQQQ-PAID-QQQQ-QQQQ', plan: 'monthly', status: 'active', expires_at: iso(now() + 20 * DAY), stripe_customer_id: 'cus_Q' },
    ], schema: 'migrated' });
    await fire(st.event('charge.refunded', 'charge', { ...st.s.charges.get('ch_Q'), amount_refunded: 2499, refunded: true }));
    ok(lic('lic_Qp').status === 'refunded' && lic('lic_Qf').status === 'active',
      'a customer with one paid key and one free key: the paid one is revoked, the free key is no reason to refuse');
    ok(ent(U1) && ent(U1).status === 'ended' && ent(U1).free_total === 0, 'and the account behind it is ended');
  }
  {
    reset();
    st.s.charges.set('ch_R', { id: 'ch_R', customer: 'cus_R', invoice: null, payment_intent: 'pi_R', amount: 2499 });
    base.reset({ rows: [{ id: 'lic_R', user_id: U2, license_key: 'GC-RRRR-FREE-RRRR-RRRR', plan: 'free', status: 'active', expires_at: null, stripe_customer_id: 'cus_R' }], schema: 'migrated' });
    await fire(st.event('charge.refunded', 'charge', { ...st.s.charges.get('ch_R'), amount_refunded: 2499, refunded: true }));
    ok(lic('lic_R').status === 'active' && !ent(U2), 'a customer holding only a free key is never revoked by the fallback');
  }

  // ── Failures that must not loop, and ones that must ───────────────────────
  {
    reset();
    subscription({ n: 'S', lookupKey: 'occlara_pro_monthly' });
    sb.accounts.failEnsure = '23503';
    const { res } = await fire(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_S')));
    ok(res.code === 200 && !ent(U1), 'a checkout naming a user Occlara does not have makes no account and answers 200');
    sb.accounts.failEnsure = '57014';
    const again = await fire(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_S')));
    ok(again.res.code === 500, 'while any other failure making the account answers 500');
  }
  {
    reset({ accounts: [{ user_id: U2, account_key: 'GC-TTTT-TTTT-TTTT-TTTT' }] });
    const { end } = subscription({ n: 'T', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'T', key: 'GC-TTTT-TTTT-TTTT-TTTT', end })], schema: 'migrated' });
    const { res } = await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_T')));
    ok(res.code === 200 && ent(U1).tier === 'pro' && ent(U1).account_key !== 'GC-TTTT-TTTT-TTTT-TTTT',
      'an account key another account holds (23505) is left, the tier still written, so the event does not retry forever');
  }

  // ── Without the accounts tables, the licence path alone ───────────────────
  {
    const bare = notLive(base);
    const plain = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: bare, stripe: st.api });
    reset();
    const { end } = subscription({ n: 'V', lookupKey: 'occlara_pro_monthly' });
    base.reset({ rows: [licenceOf({ n: 'V', key: 'GC-VVVV-VVVV-VVVV-VVVV', end })], schema: 'migrated' });
    let res;
    const lines = await captureLogs(async () => { res = await deliver(plain, refundOf('V')); });
    ok(res.code === 200 && lic('lic_V').status === 'refunded' && st.s.subs.get('sub_V').status === 'canceled',
      'without the entitlements table a full refund revokes and cancels as in 8.6 and answers 200');
    ok(lines.some((l) => l.includes('accounts are not live')), 'and says once that accounts are not live');
    const paid = await captureLogs(async () => { res = await deliver(plain, st.event('invoice.paid', 'invoice', st.s.invoices.get('in_V'))); });
    ok(res.code === 200 && paid.length > 0, 'and an invoice.paid answers 200 with no account to write');
  }

  // ── The same flows against fake-billing's own accounts model ──────────────
  // (its ensure_entitlement maps licences by the payer rules and mints a free
  // key for an account that has none, as the migration's does)
  if (typeof base.rpc === 'function') {
    const real = makeSupabase();
    const wired = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: real, stripe: st.api });
    const send = async (evt) => { let r; await captureLogs(async () => { r = await deliver(wired, evt); }); return r; };
    const entOf = (u) => (real._db.tables.entitlements || []).find((e) => e.user_id === u);
    st.reset();
    real.reset({ accounts: true, rows: [] });
    const { start } = subscription({ n: 'X', lookupKey: 'occlara_max_yearly', interval: 'year', plan: 'max_yearly' });
    let r = await send(st.event('checkout.session.completed', 'session', st.s.sessions.get('cs_X')));
    ok(r.code === 200 && entOf(U1) && entOf(U1).tier === 'max' && entOf(U1).cap_monthly === 70 && entOf(U1).period_anchor === iso(start),
      `fake-billing accounts: a site checkout on occlara_max_yearly sets the account max, 70 a month (${r.code} ${entOf(U1) && entOf(U1).tier})`);
    st.s.subs.get('sub_X').status = 'canceled';
    r = await send(st.event('customer.subscription.deleted', 'subscription', st.s.subs.get('sub_X')));
    ok(r.code === 200 && entOf(U1).tier === 'free' && entOf(U1).cap_monthly === 0 && entOf(U1).free_total === 2,
      'fake-billing accounts: Stripe ending it sets the account free, cap 0, free games kept');

    st.reset();
    const { end } = subscription({ n: 'Y', lookupKey: 'occlara_pro_monthly' });
    real.reset({ accounts: true, rows: [licenceOf({ n: 'Y', key: 'GC-YYYY-YYYY-YYYY-YYYY', end })] });
    r = await send(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_Y')));
    ok(r.code === 200 && entOf(U1).tier === 'pro' && entOf(U1).account_key === 'GC-YYYY-YYYY-YYYY-YYYY',
      'fake-billing accounts: invoice.paid sets the account pro, its key the licence\'s');
    r = await send(refundOf('Y'));
    const e = entOf(U1);
    ok(r.code === 200 && real._db.rows.find((x) => x.id === 'lic_Y').status === 'refunded'
      && e.tier === 'free' && e.free_total === 0 && e.bonus_pool === 0 && e.status === 'ended',
    `fake-billing accounts: a full refund revokes the key and ends the account (${r.code} ${e.tier} ${e.free_total} ${e.status})`);
  } else {
    console.log('skip  fake-billing has no accounts model yet');
  }

  // ── A free key is usable (routes/license.js) ──────────────────────────────
  {
    const license = loadWith(path.join(SERVER, 'routes', 'license.js'), { supabase: base, stripe: st.api });
    // The schema with 'free' in licenses_plan_check (accounts, 20261104000000):
    // a free key exists only there, and /activate now reads its lock write's
    // error (S8), which the 'migrated' check refused for plan free.
    base.reset({ rows: [{ id: 'lic_W', user_id: U1, license_key: 'GC-WWWW-WWWW-WWWW-WWWW', plan: 'free', status: 'active', expires_at: null }], schema: 'accounts' });
    const a = await callRouter(license, 'POST', '/activate', { body: { key: 'GC-WWWW-WWWW-WWWW-WWWW', device_id: 'dev1' }, headers: { 'X-Occlara-Version': '8.7.0' } });
    ok(a.status === 200 && a.body.valid === true && a.body.plan === 'free', `a free key activates, valid, plan free (${JSON.stringify(a.body)})`);
    const v = await callRouter(license, 'POST', '/validate', { body: { key: 'GC-WWWW-WWWW-WWWW-WWWW', device_id: 'dev1' }, headers: { 'X-Occlara-Version': '8.7.0' } });
    ok(v.status === 200 && v.body.valid === true, 'and validates, the cap enforced elsewhere, never by the licence');
    // An app older than 8.7 reads a cap's 402 as the AI out of credits: it is told to update instead.
    for (const [route, version] of [['/activate', '8.6.0'], ['/validate', '8.6.0'], ['/validate', null]]) {
      const old = await callRouter(license, 'POST', route, { body: { key: 'GC-WWWW-WWWW-WWWW-WWWW', device_id: 'dev1' },
        headers: version ? { 'X-Occlara-Version': version } : {} });
      ok(old.status === 200 && old.body.valid === false && old.body.status === 'update-required' && /Update Occlara/.test(old.body.error),
        `a free key from ${version || 'an app with no version'} on ${route} is refused, update-required`);
    }
    base.reset({ rows: [{ id: 'lic_W2', user_id: U1, license_key: 'GC-WWWW-PAID-WWWW-WWWW', plan: 'monthly', status: 'active', expires_at: null }], schema: 'migrated' });
    const paidOld = await callRouter(license, 'POST', '/validate', { body: { key: 'GC-WWWW-PAID-WWWW-WWWW', device_id: 'dev1' }, headers: { 'X-Occlara-Version': '8.6.0' } });
    ok(paidOld.body.valid === true, 'a paid key from 8.6 validates exactly as before');
    ok(license.usable('active', null) === true && license.usable('free', null) === false,
      'usable reads the status, never the plan: an active free key is usable, and no plan name is a status');
  }

  console.log(fails ? `\n${fails} of ${checks} entitlement webhook checks FAILED` : `\nall ${checks} entitlement webhook checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
