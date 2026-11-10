'use strict';

/**
 * GAMES BOUGHT ONE BY ONE REACH THE ACCOUNT, AND A REFUND OF THEM NEVER
 * REACHES THE LICENCE (8.8).
 *
 * A game is $2 (GAME_PRICE_CENTS 200), any whole number 1 to 500 in one
 * checkout. The site's create-games-checkout makes a mode payment session,
 * one line of quantity N at 200, metadata { kind: 'games', games, user_id }
 * on the session and its payment intent. The webhook:
 *
 *   - grants on checkout.session.completed (or async_payment_succeeded) of
 *     kind games, paid, once per session (game_purchases.ref), adding N to
 *     bonus_pool and never to bonus_earned;
 *   - refuses, with a 200 and "GAMES PURCHASE REFUSED", a session whose
 *     amount, currency, line or quantity is not N at 200, or that names no
 *     user, or a user Occlara does not have; grants nothing while unpaid;
 *   - on a full refund or a dispute of a games payment takes back the unused
 *     games of that purchase (never below 0), and on a partial one nothing;
 *   - NEVER revokes, expires or cancels a licence or a subscription, nor sets
 *     the tier or free_total, for a games payment, even for a customer with a
 *     live Pro licence, whom the old customer fallback would have revoked.
 *
 * And account_state's left (GET /api/account/me) counts the bought games,
 * uncapped by the referral's 20.
 *
 * Runs the real handler against scripts/fixtures/fake-billing.js, whose
 * grant_purchased_games and refund_purchased_games follow the games SQL. No
 * network.
 *
 * Run: npm run test:gamespurchase
 */

const path = require('path');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, SERVER, DAY, REFERRAL_MAX_EARNED } = require('./fixtures/fake-billing');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const billing = require(path.join(SERVER, 'services', 'billing.js'));

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';

const sb = makeSupabase();
const st = makeStripe();
const handler = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: sb, stripe: st.api });

async function fire(evt) {
  let res;
  const lines = await captureLogs(async () => { res = await deliver(handler, evt); });
  return { res, lines, said: (s) => lines.some((l) => l.includes(s)) };
}
const T = (name) => sb._db.tables[name];
const ent = (u) => T('entitlements').find((e) => e.user_id === u);
const purchase = (ref) => T('game_purchases').find((p) => p.ref === ref);
const lic = (id) => sb._db.rows.find((r) => r.id === id);
const nowS = () => Math.floor(Date.now() / 1000);

function reset({ rows = [], entitlements = [], games = true } = {}) {
  st.reset();
  sb.reset({ accounts: true, games, rows, authUsers: [U1, U2], tables: { entitlements } });
}

const account = (u, over = {}) => ({ user_id: u, tier: 'free', cap_monthly: 0, free_total: 2, bonus_pool: 0, bonus_earned: 0,
  source: 'free', status: 'active', period_anchor: new Date().toISOString(), account_key: `GC-FREE-${u.slice(0, 4)}-0000-0000`, ...over });

/**
 * A games checkout as create-games-checkout makes it, its payment intent and
 * charge. `meta` replaces the metadata everywhere; `charge`, `intent` and
 * `session` choose where the metadata is kept (all three by default).
 */
function gamesCheckout({ n, user = U1, games = 5, amount, quantity, unit = 200, customer = `cus_${n}`, status = 'paid',
  currency = 'usd', meta, where = { charge: true, intent: true, session: true } }) {
  const md = meta !== undefined ? meta : { kind: 'games', games: String(games), user_id: user };
  const total = amount != null ? amount : games * 200;
  st.s.sessions.set(`cs_${n}`, { id: `cs_${n}`, mode: 'payment', customer, payment_intent: `pi_${n}`, payment_status: status,
    amount_total: total, currency, metadata: where.session ? md : {}, created: nowS(),
    lineItems: [{ quantity: quantity != null ? quantity : games, unit_amount: unit }] });
  st.s.intents.set(`pi_${n}`, { id: `pi_${n}`, amount: total, customer, metadata: where.intent ? md : {} });
  st.s.charges.set(`ch_${n}`, { id: `ch_${n}`, customer, payment_intent: `pi_${n}`, invoice: null, amount: total,
    metadata: where.charge ? md : {} });
  return { session: `cs_${n}`, charge: `ch_${n}` };
}
const completed = (n, type = 'checkout.session.completed', version) => st.event(type, 'session', st.s.sessions.get(`cs_${n}`), version);
const refunded = (n, part = null, version) => {
  const ch = st.s.charges.get(`ch_${n}`);
  const next = { ...ch, amount_refunded: part != null ? part : ch.amount, refunded: part == null };
  st.s.charges.set(`ch_${n}`, next);
  return st.event('charge.refunded', 'charge', next, version);
};
const disputed = (n, version) => {
  const ch = st.s.charges.get(`ch_${n}`);
  return st.event('charge.dispute.created', 'dispute', { id: `dp_${n}`, charge: ch.id, payment_intent: ch.payment_intent, amount: ch.amount }, version);
};

/** A live Pro subscriber: subscription, invoice, charge, session, licence and account, on customer cus_PRO. */
function proSubscriber(user = U1) {
  const start = nowS() - 3 * DAY;
  const end = start + 30 * DAY;
  st.s.subs.set('sub_P', { id: 'sub_P', customer: 'cus_PRO', status: 'active', current_period_start: start, current_period_end: end,
    interval: 'month', lookupKey: 'occlara_pro_monthly' });
  st.s.invoices.set('in_P', { id: 'in_P', customer: 'cus_PRO', subscription: 'sub_P', status: 'paid', charge: 'ch_P', payment_intent: 'pi_P',
    lines: [{ id: 'il_P', subscription: 'sub_P', start, end }] });
  st.s.charges.set('ch_P', { id: 'ch_P', customer: 'cus_PRO', invoice: 'in_P', payment_intent: 'pi_P', amount: 999 });
  st.s.sessions.set('cs_P', { id: 'cs_P', mode: 'subscription', customer: 'cus_PRO', subscription: 'sub_P', payment_intent: null,
    invoice: 'in_P', metadata: { user_id: user, plan: 'pro_monthly' }, interval: 'month', lookupKey: 'occlara_pro_monthly' });
  const expires = new Date((end + 2 * DAY) * 1000).toISOString();
  return {
    rows: [{ id: 'lic_P', user_id: user, license_key: 'GC-PROO-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active', expires_at: expires,
      stripe_customer_id: 'cus_PRO', stripe_subscription_id: 'sub_P', stripe_session_id: 'cs_P' }],
    entitlements: [account(user, { tier: 'pro', cap_monthly: 25, free_total: 2, source: 'stripe', stripe_subscription_id: 'sub_P',
      account_key: 'GC-PROO-AAAA-BBBB-CCCC' })],
    expires,
  };
}

(async () => {
  // ── The rate and the count ─────────────────────────────────────────────────
  {
    ok(billing.GAME_PRICE_CENTS === 200 && billing.MAX_GAMES_PER_PURCHASE === 500, 'a game is 200 cents, at most 500 in one checkout');
    const w = billing.wholeGames;
    ok(w('5') === 5 && w(1) === 1 && w('500') === 500 && w(' 25 ') === 25, 'a whole number 1 to 500 is a count, as a number or a digit string');
    ok([0, 501, '0', '501', '2.5', 2.5, '-1', 'five', '', null, undefined, '1e2', '0x10'].every((v) => w(v) === null),
      'nothing else is: 0, 501, fractions, negatives, words, exponents, hex');
  }

  // ── Granted once ───────────────────────────────────────────────────────────
  {
    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'A', games: 5 });
    const r = await fire(completed('A'));
    ok(r.res.code === 200 && ent(U1).bonus_pool === 5 && T('game_purchases').length === 1, 'a paid games checkout adds its 5 games to bonus_pool');
    const p = purchase('cs_A');
    ok(p && p.user_id === U1 && p.games === 5 && p.amount_cents === 1000 && p.status === 'granted' && p.granted_games === 5,
      'and records the purchase by its session id: user, games, amount, granted');
    ok(ent(U1).bonus_earned === 0 && ent(U1).free_total === 2 && ent(U1).tier === 'free', 'never bonus_earned, free_total or the tier');
    ok(sb._db.rows.every((l) => l.plan === 'free') && st.calls('subscriptions.retrieve').length === 0, 'and mints no licence, asks for no subscription');

    const again = await fire(completed('A'));
    ok(again.res.code === 200 && ent(U1).bonus_pool === 5 && T('game_purchases').length === 1, 'delivered twice it grants once');
    const late = await fire(completed('A', 'checkout.session.async_payment_succeeded'));
    ok(late.res.code === 200 && ent(U1).bonus_pool === 5, 'and async_payment_succeeded of the same session grants nothing more');
    const basil = await fire(completed('A', 'checkout.session.completed', '2025-03-31.basil'));
    ok(basil.res.code === 200 && ent(U1).bonus_pool === 5, 'nor does a basil shaped redelivery');

    gamesCheckout({ n: 'B', games: 500 });
    await fire(completed('B'));
    ok(ent(U1).bonus_pool === 505 && T('game_purchases').length === 2, 'a second checkout, 500 games, adds its own');
  }

  // ── Bought on an account that did not exist yet, and paid later ────────────
  {
    reset();
    gamesCheckout({ n: 'C', user: U2, games: 1 });
    await fire(completed('C'));
    ok(ent(U2) && ent(U2).bonus_pool === 1 && ent(U2).tier === 'free', 'the account is made (ensure_entitlement) and holds the game');

    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'D', games: 10, status: 'unpaid' });
    const unpaid = await fire(completed('D'));
    ok(unpaid.res.code === 200 && ent(U1).bonus_pool === 0 && T('game_purchases').length === 0, 'an unpaid session grants nothing');
    st.s.sessions.get('cs_D').payment_status = 'paid';
    await fire(completed('D', 'checkout.session.async_payment_succeeded'));
    ok(ent(U1).bonus_pool === 10, 'and its async_payment_succeeded, paid, grants it');
  }

  // ── Refused for good, answered 200 ─────────────────────────────────────────
  {
    const refused = async (what, setup) => {
      reset({ entitlements: [account(U1)] });
      setup();
      const r = await fire(completed('X'));
      ok(r.res.code === 200 && r.said('GAMES PURCHASE REFUSED') && ent(U1).bonus_pool === 0 && T('game_purchases').length === 0,
        `${what}: refused with a 200, nothing granted`);
      return r;
    };
    await refused('an amount that is not games times 200', () => gamesCheckout({ n: 'X', games: 5, amount: 999 }));
    await refused('a cheaper amount for more games', () => gamesCheckout({ n: 'X', games: 50, amount: 1000 }));
    await refused('a line quantity that is not the games', () => gamesCheckout({ n: 'X', games: 5, quantity: 4 }));
    await refused('a unit amount that is not 200', () => gamesCheckout({ n: 'X', games: 5, unit: 100, quantity: 10 }));
    await refused('a currency that is not usd', () => gamesCheckout({ n: 'X', games: 5, currency: 'eur' }));
    // Adaptive Pricing: paid in eur, priced in usd. Held to the usd source.
    const adaptive = (n, games, source, srcCur = 'usd') => {
      gamesCheckout({ n, games, currency: 'eur', amount: Math.round(games * 200 * 0.93) });
      const s = st.s.sessions.get(`cs_${n}`);
      s.currency_conversion = { amount_total: source, amount_subtotal: source, fx_rate: '0.93', source_currency: srcCur };
      s.lineItems = [{ quantity: games, unit_amount: 200, currency: 'eur', amount_total: Math.round(games * 200 * 0.93) }];
    };
    await refused('Adaptive Pricing with a usd source below games times 200', () => adaptive('X', 5, 999));
    await refused('Adaptive Pricing priced in another source currency', () => adaptive('X', 5, 1000, 'gbp'));
    {
      reset({ entitlements: [account(U1)] });
      adaptive('AP', 5, 1000);
      const r = await fire(completed('AP'));
      ok(r.res.code === 200 && !r.said('GAMES PURCHASE REFUSED') && ent(U1).bonus_pool === 5 && T('game_purchases').length === 1,
        'Adaptive Pricing: paid in eur for a usd 1000 checkout of 5 games, the 5 are granted');
    }
    await refused('no user id', () => gamesCheckout({ n: 'X', meta: { kind: 'games', games: '5' } }));
    await refused('a user id that is no uuid', () => gamesCheckout({ n: 'X', meta: { kind: 'games', games: '5', user_id: 'bob' } }));
    await refused('a user Occlara does not have', () => gamesCheckout({ n: 'X', user: STRANGER }));
    await refused('0 games', () => gamesCheckout({ n: 'X', meta: { kind: 'games', games: '0', user_id: U1 }, amount: 0 }));
    await refused('501 games', () => gamesCheckout({ n: 'X', games: 501 }));
    await refused('a fraction of a game', () => gamesCheckout({ n: 'X', meta: { kind: 'games', games: '2.5', user_id: U1 }, amount: 500 }));
  }

  // ── A wrong kind goes the old licence path, unchanged ─────────────────────
  {
    reset();
    st.s.subs.set('sub_K', { id: 'sub_K', customer: 'cus_K', status: 'active', current_period_start: nowS() - DAY,
      current_period_end: nowS() + 29 * DAY, interval: 'month', lookupKey: 'occlara_pro_monthly' });
    st.s.sessions.set('cs_K', { id: 'cs_K', mode: 'subscription', customer: 'cus_K', subscription: 'sub_K',
      metadata: { kind: 'licence', user_id: U1, plan: 'pro_monthly' }, interval: 'month', lookupKey: 'occlara_pro_monthly' });
    const r = await fire(completed('K'));
    ok(r.res.code === 200 && ent(U1).tier === 'pro' && ent(U1).cap_monthly === 25 && ent(U1).bonus_pool === 0
      && T('game_purchases').length === 0 && !r.said('GAMES'), 'kind licence sets the Pro tier as before and buys no games');
  }

  // ── Refunds of games ───────────────────────────────────────────────────────
  {
    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'R', games: 5 });
    await fire(completed('R'));
    const part = await fire(refunded('R', 400));
    ok(part.res.code === 200 && ent(U1).bonus_pool === 5 && purchase('cs_R').status === 'granted', 'a partial refund takes nothing back');
    const full = await fire(refunded('R'));
    ok(full.res.code === 200 && ent(U1).bonus_pool === 0 && purchase('cs_R').status === 'refunded' && purchase('cs_R').taken_back === 5
      && purchase('cs_R').refunded_at, 'a full refund takes back its 5 unused games and marks the purchase refunded');
    ok(ent(U1).free_total === 2 && ent(U1).tier === 'free' && ent(U1).status === 'active', 'and leaves free_total, the tier and the status');
    const twice = await fire(refunded('R'));
    ok(twice.res.code === 200 && ent(U1).bonus_pool === 0 && purchase('cs_R').taken_back === 5, 'delivered twice it takes back once');
    const after = await fire(completed('R'));
    ok(after.res.code === 200 && ent(U1).bonus_pool === 0, 'and a late redelivery of its checkout never grants it again');

    // Played first: 2 free games, then 3 of the 5 bought.
    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'S', games: 5 });
    await fire(completed('S'));
    for (let i = 0; i < 5; i++) {
      const c = await sb.rpc('claim_game', { p_user: U1, p_game: 'valorant', p_kind: 'riot', p_client_match_id: `m${i}` });
      if (c.error || !c.data.granted) ok(false, `claim ${i} was granted`);
    }
    const bonusPlayed = T('game_usage').filter((g) => g.source === 'bonus' && g.status === 'counted').length;
    ok(ent(U1).bonus_pool === 2 && bonusPlayed === 3, 'five games played: two free, three of the bought, two left');
    await fire(refunded('S'));
    ok(ent(U1).bonus_pool === 0 && purchase('cs_S').taken_back === 2
      && T('game_usage').filter((g) => g.source === 'bonus' && g.status === 'counted').length === 3,
    'a refund after play takes back only the 2 unused, the 3 played stay played');

    // All played: nothing to take, never below 0.
    reset({ entitlements: [account(U1, { free_total: 0 })] });
    gamesCheckout({ n: 'Z', games: 2 });
    await fire(completed('Z'));
    for (let i = 0; i < 2; i++) await sb.rpc('claim_game', { p_user: U1, p_game: 'valorant', p_kind: 'riot', p_client_match_id: `z${i}` });
    const zero = await fire(refunded('Z'));
    ok(zero.res.code === 200 && ent(U1).bonus_pool === 0 && purchase('cs_Z').taken_back === 0 && purchase('cs_Z').status === 'refunded',
      'every game played: the refund takes back 0, bonus_pool stays 0, never below');

    // Earned by invites beside it: only the purchase's games go, bonus_earned untouched.
    reset({ entitlements: [account(U1, { bonus_pool: 4, bonus_earned: 4 })] });
    gamesCheckout({ n: 'E', games: 5 });
    await fire(completed('E'));
    ok(ent(U1).bonus_pool === 9 && ent(U1).bonus_earned === 4, 'bought games sit beside the 4 an invite earned');
    await fire(refunded('E'));
    ok(ent(U1).bonus_pool === 4 && ent(U1).bonus_earned === 4, 'and a refund takes back the 5 bought, the 4 earned stay');

    // A dispute is a full refund.
    for (const version of ['2023-10-16', '2025-03-31.basil']) {
      reset({ entitlements: [account(U1)] });
      gamesCheckout({ n: 'Q', games: 10 });
      await fire(completed('Q'));
      const d = await fire(disputed('Q', version));
      ok(d.res.code === 200 && ent(U1).bonus_pool === 0 && purchase('cs_Q').status === 'refunded', `${version}: a dispute takes back the games as a full refund`);
      const d2 = await fire(disputed('Q', version));
      ok(d2.res.code === 200 && purchase('cs_Q').taken_back === 10 && ent(U1).bonus_pool === 0, `${version}: and twice, once`);
    }

    // A refund that arrives before its grant.
    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'O', games: 5 });
    const early = await fire(refunded('O'));
    ok(early.res.code === 200 && purchase('cs_O') && purchase('cs_O').status === 'refunded' && purchase('cs_O').granted_games === 0,
      'a refund before its grant is recorded as refunded, nothing granted');
    await fire(completed('O'));
    ok(ent(U1).bonus_pool === 0, 'and the grant that follows adds nothing');
  }

  // ── THE KEY TEST: a games refund never touches a Pro licence ──────────────
  {
    const cases = [
      ['charge.refunded, metadata everywhere', 'refund', { charge: true, intent: true, session: true }, '2023-10-16'],
      ['charge.refunded, basil', 'refund', { charge: true, intent: true, session: true }, '2025-03-31.basil'],
      ['charge.refunded, the kind only on the payment intent', 'refund', { charge: false, intent: true, session: false }, '2023-10-16'],
      ['charge.refunded, the kind only on the session', 'refund', { charge: false, intent: false, session: true }, '2023-10-16'],
      ['charge.refunded, no kind anywhere but the purchase row', 'refund', { charge: false, intent: false, session: false }, '2023-10-16', true],
      ['charge.dispute.created', 'dispute', { charge: true, intent: true, session: true }, '2023-10-16'],
      ['charge.dispute.created, basil, kind only on the intent', 'dispute', { charge: false, intent: true, session: false }, '2025-03-31.basil'],
    ];
    for (const [what, kind, where, version, rowOnly] of cases) {
      const pro = proSubscriber(U1);
      reset({ rows: pro.rows, entitlements: pro.entitlements });
      proSubscriber(U1);   // reset cleared Stripe
      gamesCheckout({ n: 'G', games: 5, customer: 'cus_PRO' });
      await fire(completed('G'));
      // The grant read the kind off the session; then it is kept only where
      // the case says (nowhere at all for the row only case).
      if (rowOnly || !where.session) st.s.sessions.get('cs_G').metadata = {};
      if (rowOnly || !where.intent) st.s.intents.get('pi_G').metadata = {};
      if (rowOnly || !where.charge) st.s.charges.get('ch_G').metadata = {};
      ok(ent(U1).bonus_pool === 5, `${what}: the Pro subscriber bought 5 games`);
      const r = await fire(kind === 'refund' ? refunded('G', null, version) : disputed('G', version));
      const l = lic('lic_P');
      const e = ent(U1);
      ok(r.res.code === 200 && e.bonus_pool === 0 && purchase('cs_G').status === 'refunded', `${what}: the games are taken back`);
      ok(l.status === 'active' && l.expires_at === pro.expires, `${what}: the Pro licence is NOT revoked and its expiry NOT moved`);
      ok(st.calls('subscriptions.cancel').length === 0 && st.s.subs.get('sub_P').status === 'active', `${what}: the subscription is NOT cancelled`);
      ok(e.tier === 'pro' && e.cap_monthly === 25 && e.free_total === 2 && e.status === 'active' && e.source === 'stripe'
        && e.stripe_subscription_id === 'sub_P', `${what}: the account stays Pro, free_total and status untouched`);
      ok(sb._db.writes.filter((w) => w.op === 'update' && !w.table).length === 0, `${what}: not one write to the licences table`);
    }

    // The control: the same refund with no kind anywhere, no purchase row and
    // no checkout session is no games payment, and the customer fallback
    // revokes the customer's one live licence. That is what the games check
    // stands in front of.
    const pro = proSubscriber(U1);
    reset({ rows: pro.rows, entitlements: pro.entitlements });
    proSubscriber(U1);
    gamesCheckout({ n: 'H', games: 5, customer: 'cus_PRO', where: { charge: false, intent: false, session: false } });
    st.s.sessions.delete('cs_H');
    await fire(refunded('H'));
    ok(lic('lic_P').status !== 'active', 'control: a $10 charge that is no games payment and names no checkout goes the licence path, and its fallback revokes the Pro licence');
    // And with its checkout session there (a payment that names its own
    // purchase), the licence path no longer asks the customer at all: a
    // second wall, behind the games check.
    const pro2 = proSubscriber(U1);
    reset({ rows: pro2.rows, entitlements: pro2.entitlements });
    proSubscriber(U1);
    gamesCheckout({ n: 'H2', games: 5, customer: 'cus_PRO', where: { charge: false, intent: false, session: false } });
    const r2 = await fire(refunded('H2'));
    ok(r2.res.code === 200 && lic('lic_P').status === 'active' && st.s.subs.get('sub_P').status === 'active' && ent(U1).tier === 'pro',
      'and one whose checkout session is found names its own purchase, so the customer fallback is never asked and the Pro licence stays');
  }

  // ── A licence refund is exactly as it was ─────────────────────────────────
  {
    const pro = proSubscriber(U1);
    reset({ rows: pro.rows, entitlements: [{ ...pro.entitlements[0], bonus_pool: 0 }] });
    proSubscriber(U1);
    const r = await fire(st.event('charge.refunded', 'charge', { ...st.s.charges.get('ch_P'), amount_refunded: 999, refunded: true }));
    ok(r.res.code === 200 && lic('lic_P').status === 'refunded' && st.s.subs.get('sub_P').status === 'canceled'
      && ent(U1).status === 'ended' && ent(U1).tier === 'free', 'a full refund of the Pro charge still revokes, cancels and ends the account');
    ok(st.calls('paymentIntents.retrieve').length === 0, 'and a subscription charge is never asked about games beyond its invoice');
  }

  // ── Before the games migration, and when a write fails ────────────────────
  {
    reset({ entitlements: [account(U1)], games: false });
    gamesCheckout({ n: 'M', games: 5 });
    const r = await fire(completed('M'));
    ok(r.res.code === 500 && ent(U1).bonus_pool === 0, 'without the games functions a paid checkout answers 500, so Stripe retries');
    const lifetimeRefund = (() => {
      st.s.sessions.set('cs_L', { id: 'cs_L', mode: 'payment', customer: 'cus_L', payment_intent: 'pi_L', metadata: { plan: 'lifetime', userId: U2 } });
      st.s.charges.set('ch_L', { id: 'ch_L', customer: 'cus_L', payment_intent: 'pi_L', invoice: null, amount: 9900, amount_refunded: 9900, refunded: true });
      return st.event('charge.refunded', 'charge', st.s.charges.get('ch_L'));
    })();
    sb._db.rows.push({ id: 'lic_L', user_id: U2, license_key: 'GC-LIFE-0000-0000-0000', plan: 'lifetime', status: 'active', expires_at: null,
      device_id: null, device_name: null, stripe_customer_id: 'cus_L', stripe_subscription_id: null, stripe_session_id: 'cs_L', created_at: new Date().toISOString() });
    const lr = await fire(lifetimeRefund);
    ok(lr.res.code === 200 && lic('lic_L').status === 'refunded', 'and a lifetime refund there (no games table) still revokes as before');

    reset({ entitlements: [account(U1)] });
    gamesCheckout({ n: 'W', games: 5 });
    sb._db.failWrites = true;
    const w = await fire(completed('W'));
    ok(w.res.code === 500 && ent(U1).bonus_pool === 0, 'a grant the database refuses answers 500, never a quiet 200');
    sb._db.failWrites = false;
    const w2 = await fire(completed('W'));
    ok(w2.res.code === 200 && ent(U1).bonus_pool === 5, 'and the retry lands');
    sb._db.failWrites = true;
    const wr = await fire(refunded('W'));
    ok(wr.res.code === 500 && ent(U1).bonus_pool === 5, 'a take back the database refuses answers 500 too');
    sb._db.failWrites = false;
  }

  // ── Games left counts every bought game ───────────────────────────────────
  {
    reset({ entitlements: [account(U1, { tier: 'pro', cap_monthly: 25, source: 'stripe', bonus_pool: 4, bonus_earned: REFERRAL_MAX_EARNED })] });
    gamesCheckout({ n: 'P1', games: 500 });
    gamesCheckout({ n: 'P2', games: 30 });
    await fire(completed('P1'));
    await fire(completed('P2'));
    const s = await sb.rpc('account_state', { p_user: U1 });
    ok(!s.error && s.data.bonus_pool === 534 && s.data.left === 25 + 534 && s.data.bonus_earned === REFERRAL_MAX_EARNED,
      'account_state (GET /api/account/me) says 25 a month plus 534 bonus left, nothing capped at the referral 20');
    const c = await sb.rpc('claim_game', { p_user: U1, p_game: 'lol', p_kind: 'league', p_client_match_id: 'x1' });
    ok(c.data.granted && c.data.left === 24 + 534, 'and the month is played before the bought games');
  }

  // ── The games SQL holds what the fake models ─────────────────────────────
  {
    const fs = require('fs');
    // The site's file is 0006_game_purchases.sql (game, not games): the old
    // pattern missed it, so OCCLARA_SITE_DIR skipped the SQL checks in silence.
    const isGamesSql = (f) => /games?_purchases?\.sql$|games?-purchases?\.sql$/.test(f);
    ok(isGamesSql('0006_games_purchase.sql') && isGamesSql('games-purchase.sql') && isGamesSql('0006_game_purchases.sql')
      && !isGamesSql('0004_accounts_tiers_referral.sql') && !isGamesSql('0008_gift_plans.sql'),
      'the games migration name pattern matches its known names and not the accounts one');
    const dirs = [process.env.OCCLARA_SITE_DIR, path.join(__dirname, '..', '..', 'ghostcoach-9a45ac05'), path.join(__dirname, '..', '..', 'occlara-site')]
      .filter(Boolean).flatMap((d) => [path.join(d, 'supabase', 'migrations'), path.join(d, 'drizzle', 'migrations')]);
    const file = process.env.OCCLARA_GAMES_SQL || dirs.filter((d) => fs.existsSync(d))
      .flatMap((d) => fs.readdirSync(d).filter(isGamesSql).sort().map((f) => path.join(d, f)))[0];
    if (!file || !fs.existsSync(file)) {
      console.log('SKIP  the games SQL was not found (set OCCLARA_SITE_DIR to the site repo, or OCCLARA_GAMES_SQL to the file)');
    } else {
      const sql = fs.readFileSync(file, 'utf8');
      const body = (fn) => {
        const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`));
        return m ? m[1] : '';
      };
      ok(body('x') === '' && /FOR UPDATE/.test('WHERE user_id = p_user FOR UPDATE;'), 'the body pattern finds nothing for an unknown function');
      const { GAMES_TABLES } = require('./fixtures/fake-billing');
      const table = sql.match(/CREATE TABLE IF NOT EXISTS public\.game_purchases \(([\s\S]*?)\n\);/);
      const missing = Object.keys(GAMES_TABLES.game_purchases.columns).filter((c) => !new RegExp(`\\n\\s+${c} `).test(table ? table[1] : ''));
      ok(table && missing.length === 0, `game_purchases has every column the fake models${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
      ok(/ref TEXT NOT NULL UNIQUE/.test(sql) && /CHECK \(games BETWEEN 1 AND 500\)/.test(sql), 'its ref is unique and its games 1 to 500');
      ok(/ALTER TABLE public\.game_purchases ENABLE ROW LEVEL SECURITY/.test(sql)
        && /REVOKE ALL ON public\.game_purchases FROM anon, authenticated/.test(sql), 'RLS on, revoked from anon and authenticated');
      const policies = [...sql.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.(\w+) FOR (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
      ok(policies.join() === 'game_purchases:SELECT' && /USING \(auth\.uid\(\) = user_id\)/.test(sql), 'the one policy is the owner reading their own');
      const sigs = { grant_purchased_games: 'uuid, integer, text, integer', refund_purchased_games: 'text, uuid, integer' };
      for (const [fn, types] of Object.entries(sigs)) {
        const b = body(fn);
        ok(b.length > 0 && new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?SECURITY DEFINER\\s+SET search_path TO 'public'`).test(sql),
          `${fn} is security definer with its search_path set`);
        ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn}(${types}) FROM PUBLIC, anon, authenticated;`)
          && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(${types}) TO service_role;`), `${fn} is executable by service_role only`);
        ok(/PERFORM public\.ensure_entitlement\(/.test(b) && /FROM public\.entitlements WHERE user_id = \w+ FOR UPDATE/.test(b)
          && b.indexOf('entitlements WHERE user_id') < b.indexOf('game_purchases WHERE ref = p_ref FOR UPDATE'),
        `${fn} makes sure of the account and locks it FOR UPDATE before the purchase`);
        ok(!/public\.licenses/.test(b) && !/bonus_earned|free_total|tier\s*=|status\s*=\s*'ended'/.test(b.replace(/WHEN status = 'ended'/g, '')),
          `${fn} never touches licences, bonus_earned, free_total, the tier or the account status`);
      }
      ok(!/licenses/.test('UPDATE public.entitlements SET bonus_pool = 1') && /public\.licenses/.test('UPDATE public.licenses SET status'),
        'the licence pattern refuses a known negative and matches a known positive');
      const LONG_DASH = new RegExp('[\\u2013\\u2014]');
      ok(LONG_DASH.test(`a${String.fromCharCode(0x2014)}b`) && !LONG_DASH.test('a, b'), 'the long dash pattern matches a known dash');
      ok(!LONG_DASH.test(sql), 'and the SQL has no long dashes');
    }
  }

  console.log(fails ? `\n${fails} of ${checks} games purchase checks FAILED` : `\nall ${checks} games purchase checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
