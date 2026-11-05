'use strict';

/**
 * GIFTS (8.8): Pro or Max bought for someone else, sent as a link, redeemed
 * once. docs/claude/accounts.md, "Gifts".
 *
 * Holds:
 *   - the code: 130 bits, Crockford base32, made from the checkout session
 *     with the secret (none without it), only its hash kept, every way a
 *     person pastes it read back to the same code, nothing else read as one;
 *   - the webhook: a paid gift checkout held to the offer's price mints one
 *     gift, a redelivery mints nothing new, a wrong amount or currency or
 *     line is refused with a 200, an unpaid one waits, no secret or no gifts
 *     SQL answers 500 so Stripe retries;
 *   - redeeming: once, atomically (twenty accounts at once, one gift), never
 *     by the buyer, never on an ended or lifetime account, malformed and
 *     unknown codes the same 404, a retry by the same account answered again;
 *   - the stacking rule: a free account is Pro or Max at once for a calendar
 *     month (or twelve) and goes back to exactly what it had, free games
 *     kept; a paid plan keeps running and the gift waits for it to end; two
 *     gifts run back to back; a plan bought mid gift takes over and the rest
 *     of the gift runs after it; the cap is the plan's;
 *   - a refund or a dispute voids: unredeemed, waiting or running (the time
 *     taken away now), before the mint too, a partial refund nothing, and
 *     never the buyer's own licence, even with one live Pro licence on the
 *     same Stripe customer;
 *   - codes cannot be guessed: 10 unknown codes an hour per address, then 429,
 *     and the route limits;
 *   - the buyer's list shows each link again, the recipient's what it got;
 *   - gifts.sql's own text, when OCCLARA_GIFTS_SQL names it.
 *
 * Runs the real handler and routes against scripts/fixtures/fake-billing.js
 * and fake-gifts.js (gifts.sql's model). No network.
 *
 * Run: npm run test:gifts
 */

const fs = require('fs');
const path = require('path');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, callRouter, SERVER, DAY } = require('./fixtures/fake-billing');
const { withGifts } = require('./fixtures/fake-gifts');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
const SECRET = 'test-gift-secret-0123456789abcdef0123456789abcdef';
process.env.GIFT_CODE_SECRET = SECRET;

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const gifts = require(path.join(SERVER, 'services', 'gifts.js'));
const rateLimits = require(path.join(SERVER, 'services', 'rate-limits.js'));

const BUYER = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const MANY = Array.from({ length: 20 }, (_, i) => `4444${String(i).padStart(4, '0')}-4444-4444-8444-444444444444`);

const base = makeSupabase();
const sb = withGifts(base);
const st = makeStripe();
const handler = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: sb, stripe: st.api });
const giftRoutes = loadWith(path.join(SERVER, 'routes', 'gifts.js'), { supabase: sb, stripe: st.api });

const T = (name) => base._db.tables[name];
const ent = (u) => T('entitlements').find((e) => e.user_id === u);
const giftOf = (ref) => sb._gifts.gifts.find((g) => g.ref === ref);
const nowS = () => Math.floor(Date.now() / 1000);
const MONTH_MS = 31 * DAY * 1000;
const ZOE = `Zo${String.fromCharCode(0xeb)}`;

const START = Date.UTC(2026, 10, 5, 12, 0, 0);
let clock = START;

function reset({ rows = [], entitlements = [], live = true, users = [BUYER, FRIEND, OTHER, ...MANY] } = {}) {
  st.reset();
  clock = START;
  sb.reset({ accounts: true, rows, authUsers: users, tables: { entitlements }, now: () => clock, gifts: live });
}
const advance = (msBy) => { clock += msBy; };

const account = (u, over = {}) => ({ user_id: u, tier: 'free', cap_monthly: 0, free_total: 2, bonus_pool: 0, bonus_earned: 0,
  source: 'free', status: 'active', period_anchor: new Date(START - 10 * DAY * 1000).toISOString(),
  account_key: `GC-FREE-${u.slice(0, 4)}-0000-0000`, created_at: new Date(START - 10 * DAY * 1000).toISOString(),
  updated_at: new Date(START - 10 * DAY * 1000).toISOString(), ...over });

async function fire(evt) {
  let res;
  const lines = await captureLogs(async () => { res = await deliver(handler, evt); });
  return { res, lines, said: (s) => lines.some((l) => l.includes(s)) };
}

/** A gift checkout as create-gift-checkout makes it, its payment intent and charge. */
function giftCheckout({ n, user = BUYER, offer = 'pro_monthly', amount, currency = 'usd', status = 'paid', quantity = 1, unit,
  fromName, meta, customer = `cus_${n}` }) {
  const cents = gifts.GIFT_OFFERS[offer] ? gifts.GIFT_OFFERS[offer].cents : 2499;
  const md = meta !== undefined ? meta : { kind: 'gift', offer, user_id: user, ...(fromName ? { from_name: fromName } : {}) };
  const total = amount != null ? amount : cents;
  st.s.sessions.set(`cs_${n}`, { id: `cs_${n}`, mode: 'payment', customer, payment_intent: `pi_${n}`, payment_status: status,
    amount_total: total, currency, metadata: md, created: nowS(),
    lineItems: [{ quantity, unit_amount: unit != null ? unit : cents }] });
  st.s.intents.set(`pi_${n}`, { id: `pi_${n}`, amount: total, customer, metadata: md });
  st.s.charges.set(`ch_${n}`, { id: `ch_${n}`, customer, payment_intent: `pi_${n}`, invoice: null, amount: total, metadata: md });
  return { session: `cs_${n}`, code: gifts.codeFor(`cs_${n}`, SECRET) };
}
const completed = (n) => st.event('checkout.session.completed', 'session', st.s.sessions.get(`cs_${n}`));
const refunded = (n, part = null) => {
  const ch = st.s.charges.get(`ch_${n}`);
  const next = { ...ch, amount_refunded: part != null ? part : ch.amount, refunded: part == null };
  st.s.charges.set(`ch_${n}`, next);
  return st.event('charge.refunded', 'charge', next);
};
const disputed = (n) => {
  const ch = st.s.charges.get(`ch_${n}`);
  return st.event('charge.dispute.created', 'dispute', { id: `dp_${n}`, charge: ch.id, payment_intent: ch.payment_intent, amount: ch.amount });
};

// A resolver that knows each test account by its bearer token (the user id).
const resolver = {
  identify: async (req) => {
    const a = String((req.headers && req.headers.authorization) || '');
    const id = a.startsWith('Bearer ') ? a.slice(7) : '';
    if (!id) return { status: 'missing', body: { error: 'sign-in-required' } };
    return { status: 'valid', caller: { userId: id, accountKey: `u:${id}`, via: 'jwt' } };
  },
  forgetEntitlement: () => {},
  accountsLive: () => true,
};
const forgotten = [];
const router = () => giftRoutes.createRouter({ supabase: sb, resolver, forget: (u) => forgotten.push(u), now: () => clock });
const as = (u) => ({ authorization: `Bearer ${u}` });
const redeem = (r, user, code) => callRouter(r, 'POST', '/redeem', { headers: user ? as(user) : {}, body: { code } });
const peek = (r, code, user) => callRouter(r, 'POST', '/peek', { headers: user ? as(user) : {}, body: { code } });
const state = async (u) => (await sb.rpc('account_state', { p_user: u })).data;

/** A paid gift, minted through the webhook. */
async function bought(n, over = {}) {
  const g = giftCheckout({ n, ...over });
  const r = await fire(completed(n));
  if (r.res.code !== 200 || !giftOf(g.session)) throw new Error(`the gift ${n} was not minted: ${r.lines.join(' | ')}`);
  return g;
}

(async () => {
  // ── The code ───────────────────────────────────────────────────────────────
  {
    ok(gifts.CODE_BITS >= 128 && gifts.CODE_LENGTH === 26 && gifts.ALPHABET.length === 32, 'a code is 26 base32 characters, 130 bits');
    ok(new Set(gifts.ALPHABET).size === 32 && !/[ilou]/.test(gifts.ALPHABET), 'the alphabet is 32 distinct symbols, no i, l, o or u');
    const known = gifts.codeFor('cs_known', SECRET);
    ok(gifts.CODE.test(known) && known.length === 26, `the code regex matches a code it made (${known.slice(0, 4)}...)`);
    ok(!gifts.CODE.test(`${known.slice(0, 25)}u`) && !gifts.CODE.test(known.slice(0, 25)) && !gifts.CODE.test(`${known}0`),
      'and refuses a u, a short code and a long one');
    ok(gifts.codeFor('cs_known', SECRET) === known, 'the same session makes the same code (a redelivery is the same gift)');
    ok(gifts.codeFor('cs_known', `${SECRET}x`) !== known, 'another secret makes another code');
    let threw = false;
    try { gifts.codeFor('cs_known', null); } catch { threw = true; }
    ok(threw, 'no code is made without the secret');
    ok(gifts.secretOf({ GIFT_CODE_SECRET: 'short' }) === null && gifts.secretOf({}) === null
      && gifts.secretOf({ GIFT_CODE_SECRET: SECRET }) === SECRET, 'a secret under 32 characters is no secret');
    // Spread: 4000 codes, all distinct, every symbol in use about equally.
    const seen = new Set();
    const counts = new Map();
    for (let i = 0; i < 4000; i++) {
      const c = gifts.codeFor(`cs_${i}`, SECRET);
      seen.add(c);
      for (const ch of c) counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    const expected = (4000 * 26) / 32;
    const chi = [...gifts.ALPHABET].reduce((s, ch) => s + ((counts.get(ch) || 0) - expected) ** 2 / expected, 0);
    ok(seen.size === 4000, '4000 sessions make 4000 different codes');
    ok(chi < 80, `every symbol is used about equally (chi square ${chi.toFixed(1)} over 31 degrees of freedom)`);
    const h = gifts.hashCode(known);
    ok(/^[0-9a-f]{64}$/.test(h) && !h.includes(known) && gifts.hashCode(known) === h, 'what is kept is a SHA-256, never the code');
    // Every way a person pastes it.
    const upper = known.toUpperCase();
    const dashed = `${known.slice(0, 5)}-${known.slice(5, 10)}-${known.slice(10)}`;
    const forms = [known, upper, ` ${dashed} `, `https://occlara.app/gift/${known}`, `occlara.app/gift/${upper}/`,
      `https://www.occlara.app/gift/${known}?utm=x`];
    ok(forms.every((f) => gifts.normalizeCode(f) === known), 'a link, upper case, dashes and spaces are all the same code');
    const withO = known.replace(/0/g, 'O').replace(/1/g, 'I');
    ok(gifts.normalizeCode(withO) === known, 'O read as 0 and I as 1, as Crockford reads them');
    ok(['', 'abc', null, 42, `${known}x`, 'https://evil.example/gift/' + known, 'u'.repeat(26), 'x'.repeat(300)]
      .every((v) => gifts.normalizeCode(v) === null), 'nothing else is a code: short, long, another site, a u, not a string');
    ok(gifts.linkOf(known) === `https://occlara.app/gift/${known}` && gifts.linkOf('nope') === null, 'the link is occlara.app/gift/<code>');
    ok(gifts.cleanFromName('Sam') === 'Sam' && gifts.cleanFromName(` ${ZOE} `) === ZOE && gifts.cleanFromName('Mary-Jane') === 'Mary-Jane',
      'a first name signs the gift: Sam, Zoe with its accent, Mary-Jane');
    ok([null, '', '<b>x</b>', 'a'.repeat(21), '123', 'http://x.y', 'Sam;drop'].every((v) => gifts.cleanFromName(v) === null),
      'anything else is dropped: markup, 21 letters, digits, a link');
  }

  // ── The webhook mints one gift per paid checkout ───────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const g = giftCheckout({ n: 'A', offer: 'max_yearly', fromName: 'Sam' });
    const r = await fire(completed('A'));
    const row = giftOf(g.session);
    ok(r.res.code === 200 && row && row.status === 'unredeemed', 'a paid gift checkout makes one unredeemed gift');
    ok(row && row.tier === 'max' && row.months === 12 && row.cap_monthly === 70 && row.amount_cents === 69999 && row.buyer_id === BUYER,
      'Max for a year, 70 games a month, at the yearly price, bought by the buyer');
    ok(row && row.code_hash === gifts.hashCode(g.code) && !JSON.stringify(row).includes(g.code), 'only the code hash is kept');
    ok(row && row.from_name === 'Sam', 'signed with the first name the buyer chose');
    const again = await fire(completed('A'));
    ok(again.res.code === 200 && sb._gifts.gifts.length === 1, 'a redelivered event makes nothing new (webhook idempotency)');
    ok(ent(BUYER).tier === 'free' && !base._db.rows.some((l) => l.stripe_session_id === 'cs_A'), 'the buyer gets no plan and no licence');

    for (const [n, over, why] of [
      ['B', { amount: 999 }, 'a wrong amount'],
      ['C', { currency: 'eur' }, 'another currency'],
      ['D', { quantity: 2 }, 'two of it on one line'],
      ['E', { meta: { kind: 'gift', offer: 'max_lifetime', user_id: BUYER } }, 'an offer Occlara does not sell'],
      ['F', { meta: { kind: 'gift', offer: 'pro_monthly' } }, 'no buyer'],
    ]) {
      giftCheckout({ n, ...over });
      const x = await fire(completed(n));
      ok(x.res.code === 200 && x.said('GIFT PURCHASE REFUSED') && !giftOf(`cs_${n}`), `${why} is refused with a 200 and no gift`);
    }
    giftCheckout({ n: 'G', status: 'unpaid' });
    const unpaid = await fire(completed('G'));
    ok(unpaid.res.code === 200 && !giftOf('cs_G'), 'an unpaid checkout makes no gift until it is paid');

    // No secret: Stripe retries until it is set.
    delete process.env.GIFT_CODE_SECRET;
    giftCheckout({ n: 'H' });
    const noSecret = await fire(completed('H'));
    ok(noSecret.res.code === 500 && !giftOf('cs_H'), 'without GIFT_CODE_SECRET the event answers 500 (Stripe retries)');
    process.env.GIFT_CODE_SECRET = SECRET;
    const retried = await fire(completed('H'));
    ok(retried.res.code === 200 && giftOf('cs_H'), 'and the retry makes it once the secret is set');

    // gifts.sql not live: 500, retried.
    reset({ entitlements: [account(BUYER)], live: false });
    giftCheckout({ n: 'I' });
    const notLive = await fire(completed('I'));
    ok(notLive.res.code === 500, 'before gifts.sql runs a paid gift answers 500, so Stripe retries');
    const r0 = await callRouter(router(), 'POST', '/redeem', { headers: as(FRIEND), body: { code: gifts.codeFor('cs_I', SECRET) } });
    ok(r0.status === 503 && r0.body.error === 'gifts-not-live', 'and redeem answers 503 gifts-not-live');
    const l0 = await callRouter(router(), 'GET', '/', { headers: as(BUYER) });
    ok(l0.status === 503, 'and so does the list');
  }

  // ── Redeeming ──────────────────────────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND), account(OTHER)] });
    const g = await bought('R1', { offer: 'pro_monthly', fromName: 'Sam' });
    const rt = router();
    const p = await peek(rt, g.code);
    ok(p.status === 200 && p.body.status === 'unredeemed' && p.body.tier === 'pro' && p.body.months === 1 && p.body.from === 'Sam'
      && p.body.yours === null, 'the link says what it gives and who it is from, and no id');
    ok(!JSON.stringify(p.body).includes(BUYER), 'the peek never names the buyer\'s account');
    const mine = await peek(rt, g.code, BUYER);
    ok(mine.body.yours === 'buyer', 'the buyer is told it is their own gift');

    const self = await redeem(rt, BUYER, g.code);
    ok(self.status === 409 && self.body.reason === 'self' && giftOf(g.session).status === 'unredeemed', 'the buyer cannot redeem their own gift');
    const out = await redeem(rt, null, g.code);
    ok(out.status === 401, 'signed out cannot redeem');

    const before = { ...ent(FRIEND) };
    const r = await redeem(rt, FRIEND, `https://occlara.app/gift/${g.code.toUpperCase()}`);
    const e = ent(FRIEND);
    ok(r.status === 200 && r.body.ok && r.body.started && r.body.tier === 'pro', 'a free account redeems a pasted link and is Pro at once');
    ok(e.tier === 'pro' && e.cap_monthly === 25 && e.source === 'gift' && e.free_total === before.free_total,
      'Pro, 25 games a month, source gift, its free games kept');
    ok(Date.parse(r.body.ends_at) === Date.UTC(2026, 11, 5, 12, 0, 0), 'for one calendar month, to the same day next month');
    ok(forgotten.includes(FRIEND), 'the server forgets what it remembered of the account');
    const s1 = await state(FRIEND);
    ok(s1.tier === 'pro' && s1.cap_monthly === 25 && s1.left === 25, 'account_state: Pro with 25 games this month');

    const twice = await redeem(rt, FRIEND, g.code);
    ok(twice.status === 200 && twice.body.again === true, 'the same account again is answered again, nothing added');
    const taken = await redeem(rt, OTHER, g.code);
    ok(taken.status === 409 && taken.body.reason === 'already-redeemed', 'another account cannot redeem it again');
    ok(sb._gifts.gifts.filter((x) => x.redeemed_by).length === 1, 'one redemption only');
    const after = await peek(rt, g.code, FRIEND);
    ok(after.body.status === 'redeemed' && after.body.yours === 'redeemer', 'the link says it is redeemed, on this account');

    const unknown = await redeem(rt, OTHER, gifts.codeFor('cs_never', SECRET));
    ok(unknown.status === 404 && unknown.body.reason === 'unknown', 'a code no gift has is 404 unknown');
    const malformed = await redeem(rt, OTHER, 'not-a-code');
    ok(malformed.status === 404 && malformed.body.reason === 'unknown', 'a malformed code is the same 404');
    const pk = await peek(rt, 'not-a-code');
    ok(pk.status === 404 && pk.body.error === 'gift-unknown', 'and peeking one is 404 gift-unknown');

    // The games cap is the plan's.
    for (let i = 0; i < 25; i++) {
      await sb.rpc('claim_game', { p_user: FRIEND, p_game: 'valorant', p_kind: 'riot', p_client_match_id: `riot:m${i}`, p_enforce: true });
    }
    const capped = await sb.rpc('claim_game', { p_user: FRIEND, p_game: 'valorant', p_kind: 'riot', p_client_match_id: 'riot:m26', p_enforce: true });
    ok(capped.data && capped.data.granted === false, 'the 26th game of the gifted month is refused, as Pro\'s cap');
    ok(T('game_usage').filter((u) => u.user_id === FRIEND && u.source === 'allowance').length === 25, 'the 25 are the plan\'s, never free games');

    // Expiry returns the account to what it had.
    advance(MONTH_MS);
    const back = await state(FRIEND);
    ok(back.tier === 'free' && ent(FRIEND).source === 'free' && ent(FRIEND).cap_monthly === 0 && ent(FRIEND).free_total === 2,
      'after the month the account is free again, its free games as they were');
    ok(ent(FRIEND).period_anchor === before.period_anchor, 'and its period anchor as it was');
  }

  // ── Ended and lifetime accounts ────────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND, { status: 'ended', free_total: 0 }),
      account(OTHER, { tier: 'max', cap_monthly: 70, source: 'legacy_lifetime' })] });
    const g = await bought('L1');
    const rt = router();
    const ended = await redeem(rt, FRIEND, g.code);
    ok(ended.status === 409 && ended.body.reason === 'account-ended', 'an account a refund ended cannot redeem');
    const life = await redeem(rt, OTHER, g.code);
    ok(life.status === 409 && life.body.reason === 'lifetime' && giftOf(g.session).status === 'unredeemed',
      'a lifetime account cannot (the gift would never start), and the code stays for someone else');
  }

  // ── Single use under concurrency ───────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), ...MANY.map((u) => account(u))] });
    const g = await bought('C1');
    const rt = router();
    const answers = await Promise.all(MANY.map((u) => redeem(rt, u, g.code)));
    const won = answers.filter((a) => a.status === 200);
    ok(won.length === 1, `twenty accounts at once: one redeemed (${won.length})`);
    ok(answers.filter((a) => a.status === 409 && a.body.reason === 'already-redeemed').length === 19, 'the nineteen others are told it is taken');
    ok(MANY.filter((u) => ent(u).tier === 'pro').length === 1, 'one account became Pro');
  }

  // ── Stacking ───────────────────────────────────────────────────────────────
  {
    // A paid subscriber keeps their plan; the gift waits for it to end.
    reset({ entitlements: [account(BUYER), account(FRIEND, { tier: 'pro', cap_monthly: 25, source: 'stripe',
      stripe_subscription_id: 'sub_F', period_anchor: new Date(START - 3 * DAY * 1000).toISOString() })] });
    st.s.subs.set('sub_F', { id: 'sub_F', customer: 'cus_F', status: 'canceled', current_period_start: nowS() - 3 * DAY,
      current_period_end: nowS() + 27 * DAY, interval: 'month', lookupKey: 'occlara_pro_monthly' });
    const g = await bought('S1', { offer: 'max_yearly' });
    const rt = router();
    const r = await redeem(rt, FRIEND, g.code);
    ok(r.status === 200 && r.body.started === false && r.body.waits_for === 'plan', 'a Pro subscriber redeems a Max year: it waits for the plan');
    ok(ent(FRIEND).tier === 'pro' && ent(FRIEND).source === 'stripe' && ent(FRIEND).stripe_subscription_id === 'sub_F',
      'the subscription runs untouched');
    advance(20 * DAY * 1000);
    const ev = await fire(st.event('customer.subscription.deleted', 'subscription', st.s.subs.get('sub_F')));
    ok(ev.res.code === 200, 'Stripe ends the subscription');
    const s = await state(FRIEND);
    const run = giftOf(g.session);
    ok(s.tier === 'max' && s.cap_monthly === 70 && ent(FRIEND).source === 'gift', 'the gift starts then: Max, 70 a month');
    ok(run.starts_at === clock && run.ends_at === Date.UTC(2027, 10, 25, 12, 0, 0), 'for the whole year, from the day it started');

    // Two gifts back to back on a free account.
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const a = await bought('B1');
    const b = await bought('B2');
    const rt2 = router();
    const ra = await redeem(rt2, FRIEND, a.code);
    const rb = await redeem(rt2, FRIEND, b.code);
    ok(ra.body.started && !rb.body.started && rb.body.waits_for === 'gift', 'a second gift waits for the first');
    advance(45 * DAY * 1000);
    await state(FRIEND);
    const ga = giftOf(a.session);
    const gb = giftOf(b.session);
    ok(gb.starts_at === ga.ends_at && ent(FRIEND).tier === 'pro', 'nobody asked for 45 days: the second started the moment the first ended');
    ok(ent(FRIEND).period_anchor === new Date(ga.ends_at).toISOString(), 'its month counts from its own start');
    advance(MONTH_MS);
    await state(FRIEND);
    ok(ent(FRIEND).tier === 'free' && ent(FRIEND).source === 'free' && ent(FRIEND).free_total === 2, 'then free again, free games kept');

    // A plan bought mid gift takes over; the rest of the gift runs after it.
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const c = await bought('P1');
    await redeem(router(), FRIEND, c.code);
    advance(10 * DAY * 1000);
    Object.assign(ent(FRIEND), { tier: 'max', cap_monthly: 70, source: 'stripe', stripe_subscription_id: 'sub_X',
      period_anchor: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString() });
    const left = giftOf(c.session).ends_at - clock;
    advance(DAY * 1000);
    await state(FRIEND);
    const paused = giftOf(c.session);
    ok(ent(FRIEND).tier === 'max' && paused.starts_at == null && paused.remaining.ms === left,
      'a Max plan bought on day 10 takes over, the gift keeps exactly what was left');
    advance(30 * DAY * 1000);
    Object.assign(ent(FRIEND), { tier: 'free', cap_monthly: 0, updated_at: new Date(clock).toISOString() });
    await state(FRIEND);
    const resumed = giftOf(c.session);
    ok(ent(FRIEND).tier === 'pro' && ent(FRIEND).source === 'gift' && resumed.ends_at - resumed.starts_at === left,
      'when the plan ends the rest of the gift runs');
  }

  // ── Refunds and disputes void ──────────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND), account(OTHER)] });
    const rt = router();
    const u = await bought('V1');
    const rf = await fire(refunded('V1'));
    ok(rf.res.code === 200 && giftOf(u.session).status === 'void' && giftOf(u.session).void_reason === 'refunded',
      'a refund of an unredeemed gift voids it');
    const pv = await peek(rt, u.code);
    const rv = await redeem(rt, FRIEND, u.code);
    ok(pv.body.status === 'void' && rv.status === 410 && rv.body.reason === 'void', 'its link says so and it cannot be redeemed');

    const running = await bought('V2');
    await redeem(rt, FRIEND, running.code);
    ok(ent(FRIEND).tier === 'pro', 'a redeemed gift is running');
    advance(5 * DAY * 1000);
    const rr = await fire(refunded('V2'));
    const sv = await state(FRIEND);
    ok(rr.res.code === 200 && sv.tier === 'free' && ent(FRIEND).source === 'free' && giftOf(running.session).status === 'void',
      'a refund after redemption takes the gifted time away now, the account back to free');
    ok(ent(FRIEND).free_total === 2 && ent(FRIEND).status === 'active', 'the recipient keeps their free games, nothing else ended');

    const disp = await bought('V3', { offer: 'max_monthly' });
    await redeem(rt, OTHER, disp.code);
    const dd = await fire(disputed('V3'));
    ok(dd.res.code === 200 && ent(OTHER).tier === 'free' && giftOf(disp.session).void_reason === 'disputed', 'a dispute does the same');
    const again = await fire(refunded('V3'));
    ok(again.res.code === 200 && again.said('void before'), 'a second refund event changes nothing');

    const part = await bought('V4');
    await redeem(rt, FRIEND, part.code);
    const pr = await fire(refunded('V4', 500));
    ok(pr.res.code === 200 && giftOf(part.session).status === 'redeemed' && ent(FRIEND).tier === 'pro', 'a partial refund does nothing');

    // Refund before the mint: the mint that follows finds it void.
    giftCheckout({ n: 'V5' });
    const early = await fire(refunded('V5'));
    ok(early.res.code === 200 && giftOf('cs_V5') && giftOf('cs_V5').status === 'void', 'a refund that lands first records the gift void');
    const late = await fire(completed('V5'));
    const lr = await redeem(rt, OTHER, gifts.codeFor('cs_V5', SECRET));
    ok(late.res.code === 200 && giftOf('cs_V5').status === 'void' && lr.status === 410, 'and the late mint makes nothing redeemable');

    // A waiting gift refunded never starts.
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const w1 = await bought('W1');
    const w2 = await bought('W2');
    await redeem(router(), FRIEND, w1.code);
    await redeem(router(), FRIEND, w2.code);
    await fire(refunded('W2'));
    advance(MONTH_MS);
    await state(FRIEND);
    ok(ent(FRIEND).tier === 'free' && giftOf(w2.session).starts_at == null, 'a waiting gift refunded never starts');
  }

  // ── A gift's refund never reaches the buyer's licence ──────────────────────
  {
    const start = nowS() - 3 * DAY;
    reset({
      rows: [{ id: 'lic_P', user_id: BUYER, license_key: 'GC-PROO-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active',
        expires_at: new Date((start + 32 * DAY) * 1000).toISOString(), stripe_customer_id: 'cus_PRO', stripe_subscription_id: 'sub_P',
        stripe_session_id: 'cs_P' }],
      entitlements: [account(BUYER, { tier: 'pro', cap_monthly: 25, source: 'stripe', stripe_subscription_id: 'sub_P' }), account(FRIEND)],
    });
    st.s.subs.set('sub_P', { id: 'sub_P', customer: 'cus_PRO', status: 'active', current_period_start: start,
      current_period_end: start + 30 * DAY, interval: 'month', lookupKey: 'occlara_pro_monthly' });
    await bought('K1', { customer: 'cus_PRO' });
    // Metadata only on the session: the charge and the intent carry none.
    st.s.charges.get('ch_K1').metadata = {};
    st.s.intents.get('pi_K1').metadata = {};
    const r = await fire(refunded('K1'));
    const lic = base._db.rows.find((x) => x.id === 'lic_P');
    ok(r.res.code === 200 && lic.status === 'active' && ent(BUYER).tier === 'pro' && ent(BUYER).status === 'active',
      'a Pro subscriber refunded a gift: their licence, plan and account are untouched');
    ok(!st.calls('subscriptions.cancel').length && !st.calls('subscriptions.update').length, 'and their subscription is not cancelled');
    ok(giftOf('cs_K1').status === 'void', 'the gift alone is voided');
    // Every metadata lost: the gifts table is the last word.
    await bought('K2', { customer: 'cus_PRO' });
    st.s.sessions.get('cs_K2').metadata = {};
    st.s.charges.get('ch_K2').metadata = {};
    st.s.intents.get('pi_K2').metadata = {};
    const r2 = await fire(refunded('K2'));
    ok(r2.res.code === 200 && base._db.rows.find((x) => x.id === 'lic_P').status === 'active' && giftOf('cs_K2').status === 'void',
      'with no metadata anywhere the gifts table names it, and the licence is still untouched');
  }

  // ── Codes cannot be guessed ────────────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const real = await bought('G1');
    const rt = router();
    for (let i = 0; i < 10; i++) await peek(rt, gifts.codeFor(`cs_guess${i}`, `${SECRET}!`));
    const stoppedPeek = await peek(rt, real.code);
    ok(stoppedPeek.status === 429 && stoppedPeek.body.what === 'gift-codes', 'after 10 unknown codes an address is stopped, a real code too');
    const stoppedRedeem = await redeem(rt, FRIEND, real.code);
    ok(stoppedRedeem.status === 429 && giftOf(real.session).status === 'unredeemed', 'redeem as well, before any lookup');
    advance(61 * 60 * 1000);
    const later = await redeem(rt, FRIEND, real.code);
    ok(later.status === 200, 'an hour later it works again');
    const fresh = router();
    for (let i = 0; i < 9; i++) await redeem(fresh, FRIEND, 'abc');
    ok((await peek(fresh, real.code)).status === 200, 'nine misses stop nothing');

    const limits = rateLimits.routeLimits({ now: () => clock });
    const peekLimit = limits.find((l) => l.mw.limits.name === 'gift-peek');
    const redeemLimit = limits.find((l) => l.mw.limits.name === 'gift-redeem');
    ok(peekLimit && peekLimit.paths.includes('/api/gifts/peek') && peekLimit.mw.limits.max === 60, 'peek: 60 in 10 minutes per address');
    ok(redeemLimit && redeemLimit.mw.limits.max === 20, 'redeem: 20 in 10 minutes per account');
    let last = null;
    for (let i = 0; i < 61; i++) {
      last = await new Promise((resolve) => {
        const res = { set() {}, status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c, body: b }); } };
        peekLimit.mw({ ip: '203.0.113.9', headers: {} }, res, () => resolve({ status: 200 }));
      });
    }
    ok(last.status === 429, 'the 61st peek from one address in ten minutes is refused');
  }

  // ── The lists ──────────────────────────────────────────────────────────────
  {
    reset({ entitlements: [account(BUYER), account(FRIEND)] });
    const a = await bought('L1', { offer: 'max_monthly', fromName: 'Sam' });
    const b = await bought('L2');
    await redeem(router(), FRIEND, a.code);
    const mine = await callRouter(router(), 'GET', '/', { headers: as(BUYER) });
    const la = mine.body.bought.find((x) => x.checkout === 'cs_L1');
    const lb = mine.body.bought.find((x) => x.checkout === 'cs_L2');
    ok(mine.status === 200 && la && lb, 'the buyer lists both gifts');
    ok(la.link === `https://occlara.app/gift/${a.code}` && lb.link === `https://occlara.app/gift/${b.code}`, 'each with its link again');
    ok(la.state === 'running' && lb.state === 'unredeemed', 'and how each stands: running, not redeemed');
    ok(!JSON.stringify(mine.body).includes(FRIEND), 'the buyer is never told who redeemed it');
    const theirs = await callRouter(router(), 'GET', '/', { headers: as(FRIEND) });
    ok(theirs.body.received.length === 1 && theirs.body.received[0].tier === 'max' && theirs.body.received[0].state === 'running'
      && theirs.body.received[0].from_name === 'Sam', 'the recipient sees what they got, from whom, running');
    ok(!theirs.body.received[0].link && !('checkout' in theirs.body.received[0]), 'with no link and no checkout of the buyer\'s');
    delete process.env.GIFT_CODE_SECRET;
    const noSecret = await callRouter(router(), 'GET', '/', { headers: as(BUYER) });
    ok(noSecret.body.bought.every((x) => x.link === null), 'without the secret no link is made up');
    process.env.GIFT_CODE_SECRET = SECRET;
  }

  // ── The app's side (src/shared/gifts.js, profile.js) ───────────────────────
  {
    const app = require('../src/shared/gifts');
    const profile = require('../src/shared/profile');
    const samples = [gifts.codeFor('cs_app', SECRET)];
    const k = samples[0];
    const inputs = [k, k.toUpperCase(), `https://occlara.app/gift/${k}`, ` ${k.slice(0, 13)}-${k.slice(13)} `, k.replace(/1/g, 'L'),
      'nope', '', `${k}x`, `https://evil.example/gift/${k}`, null];
    ok(inputs.every((v) => app.normalizeCode(v) === gifts.normalizeCode(v)), 'the app reads a pasted code exactly as the server does');
    ok(app.CODE.source === gifts.CODE.source && app.CODE.test(k), 'the same code shape on both sides, and it matches a real code');
    ok(app.isGiftLink(`https://occlara.app/gift/${k}`) && !app.isGiftLink(`http://occlara.app/gift/${k}`)
      && !app.isGiftLink(`https://occlara.app/gift/${k}/x`), 'a gift link is exactly https://occlara.app/gift/<code>');
    ok(app.OFFER_IDS.every((id) => app.isGiftBuyUrl(app.giftBuyUrl(id))) && app.OFFER_IDS.every((id) => gifts.isOffer(id))
      && Object.keys(gifts.GIFT_OFFERS).length === app.OFFER_IDS.length, 'the app opens the four gifts the server sells, and checks each URL');
    ok(['https://occlara.app/buy?gift=pro_lifetime', 'https://occlara.app/buy?gift=pro_monthly&games=5', 'https://evil.example/buy?gift=pro_monthly',
      'https://occlara.app/buy?gift=pro_monthly#x', app.giftBuyUrl('toString')].every((u) => !app.isGiftBuyUrl(u)), 'and nothing else');
    const prices = profile.giftOffers();
    ok(prices.monthly.map((o) => `${o.id} ${o.price}`).join(', ') === 'pro_monthly $24.99 for a month, max_monthly $69.99 for a month'
      && prices.yearly.map((o) => `${o.id} ${o.price}`).join(', ') === 'pro_yearly $249.99 for a year, max_yearly $699.99 for a year',
    'Gift Pro and Gift Max at the plans\' own prices');
    ok(Object.entries(gifts.GIFT_OFFERS).every(([id, o]) => prices[id.endsWith('yearly') ? 'yearly' : 'monthly']
      .some((p) => p.id === id && p.price.startsWith(profile.money(o.cents)))), 'the app\'s gift prices are the server\'s');
    const said = [{ ok: true, tier: 'pro', months: 1, started: true, ends_at: '2026-12-05T12:00:00Z' },
      { ok: true, tier: 'max', months: 12, started: false, waits_for: 'plan' }, { ok: true, tier: 'pro', months: 1, started: false, waits_for: 'gift' },
      { ok: true, tier: 'pro', months: 1, started: false, waits_for: null, again: true },
      ...['unknown', 'code', 'already-redeemed', 'void', 'self', 'account-ended', 'lifetime', 'signin', 'rate-limited', 'match', 'not-live', 'network']
        .map((reason) => ({ ok: false, reason }))].map((r) => app.redeemSentence(r, { utc: true }));
    ok(said[0] === 'Done. Pro for a month is on your account, until Dec 5.' && said[1].includes('starts when your current plan ends'),
      'redeemed: what it is and until when, or that it waits for the plan', said.slice(0, 2).join(' | '));
    ok(said[2].includes('the gift you have now ends') && !said[2].includes('plan'), 'a gift that waits for a gift says so', said[2]);
    ok(said[3].startsWith('This gift is already on your account') && !said[3].includes('plan') && !said[3].includes('the gift you have'),
      'a retried waiting gift (no waits_for) names neither a plan nor a gift', said[3]);
    const life = said[4 + 6];
    ok(life.includes('would never start') && !/for life/i.test(life), 'lifetime (also comp) claims no "for life"', life);
    ok(said.every((s) => s && /[.]$/.test(s) && !s.includes(';') && !new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(s)),
      'every sentence ends calmly, no semicolon, no dash');
    const sec = profile.giftSection({ bought: [
      { id: 'g1', tier: 'max', months: 1, state: 'unredeemed', created_at: '2026-11-05T12:00:00Z', link: `https://occlara.app/gift/${k}` },
      { id: 'g2', tier: 'pro', months: 12, state: 'void', created_at: '2026-11-01T12:00:00Z', link: `https://occlara.app/gift/${k}` },
      { id: 'g3', tier: 'pro', months: 1, state: 'running', created_at: '2026-11-02T12:00:00Z', link: 'https://evil.example/x' },
    ], received: [{ id: 'r1', tier: 'max', months: 12, state: 'running', ends_at: '2027-11-05T12:00:00Z', from_name: 'Sam' }] }, true, { utc: true });
    ok(sec.bought.map((b) => `${b.what}|${b.state}|${b.canCopy}`).join(', ')
      === 'Max for a month|Not redeemed yet|true, Pro for a year|Refunded|false, Pro for a month|Redeemed, in use|false',
    'the bought list: what, how it stands, Copy link only for a real link not refunded');
    ok(sec.received === 'Your gift of Max for a year from Sam runs until Nov 5.', 'the running gift in one line', sec.received);
    ok(!JSON.stringify(sec).includes('occlara.app/gift'), 'the page is never handed a link: main copies it');
    const built = profile.build({ signedIn: false, via: 'key' }, [], { riotId: '' }, { utc: true }, null);
    ok(built.gifts && built.gifts.signedIn === false && built.gifts.bought.length === 0, 'signed out, the section asks to sign in first');
  }

  // ── gifts.sql's own text ───────────────────────────────────────────────────
  {
    const file = process.env.OCCLARA_GIFTS_SQL;
    if (!file || !fs.existsSync(file)) {
      console.log('skip  gifts.sql text (set OCCLARA_GIFTS_SQL to its path)');
    } else {
      const sql = fs.readFileSync(file, 'utf8');
      const fns = ['gift_end_running', 'gift_settle', 'ensure_entitlement', 'gift_mint', 'gift_of_ref', 'gift_peek', 'gift_list', 'redeem_gift', 'void_gift'];
      ok(fns.every((f) => sql.includes(`CREATE OR REPLACE FUNCTION public.${f}(`)), 'gifts.sql defines every function the server calls');
      ok(fns.every((f) => new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`).test(sql)
        && new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`).test(sql)),
      'each is the service role\'s only');
      const rls = sql.indexOf('ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY');
      ok(rls > 0 && rls < sql.indexOf('GRANT ALL ON public.gifts TO service_role'), 'RLS is on before any grant');
      ok(!/REFERENCES\s+auth\.users/i.test(sql), 'no foreign key to auth.users');
      ok(/CREATE TABLE IF NOT EXISTS public\.gifts/.test(sql) && /CREATE TABLE IF NOT EXISTS public\.gift_accounts/.test(sql)
        && /DROP CONSTRAINT IF EXISTS entitlements_source_check/.test(sql), 'safe to run twice');
      ok(/'comp', 'gift'\)\)/.test(sql), 'entitlements.source takes gift');
      ok((sql.match(/RETURN public\.gift_settle\(p_user\);/g) || []).length === 3, 'ensure_entitlement settles the gifts on each of its returns');
      ok(!new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']').test(sql), 'no dashes but hyphens');
    }
  }

  console.log(`\n${checks - fails} of ${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
