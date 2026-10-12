'use strict';

/**
 * A refund must take the licence away, and a partial one must not.
 *
 * THE FIRST HOLE. The webhook handled four events and none was a refund. A
 * lifetime purchase writes `expires_at: null` and `status: 'active'`, has no
 * subscription to cancel, and validateKey asks only for an active status and an
 * unexpired date. So buy lifetime, refund it, keep the product forever.
 *
 * THE SECOND, which this test used to pass straight over. Every plan on the site
 * is a subscription, and none of the fix reached them: a subscription's
 * Checkout Session has no payment intent (this test's old fake Stripe found a
 * session for any), a Dispute has no customer, a refund left the subscription
 * billing, and the status written ('refunded') is one the licences table's
 * CHECK refuses (the old fake database had no CHECK). Now:
 *
 *   the charge is read as the server's API version renders it (2023-10-16 has
 *   charge.invoice; a basil event does not), and its subscription's licences
 *   are revoked first, then the session's, then the customer's only one
 *   a full refund or any dispute cancels the subscription, a partial refund
 *   changes nothing, and billing stops even while the database refuses
 *   the status is 'refunded' or 'disputed' once the site's migration allows it,
 *   and 'cancelled' with the expiry now until then
 *   a refused write answers 500 so Stripe retries, and never prints the row
 *
 * The real handler runs against fake-billing.js: a Stripe and a licences table
 * that refuse what the real ones refuse. Nothing touches a network.
 *
 * Run: npm run test:refundrevoke
 */

const path = require('path');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, SERVER, DAY } = require('./fixtures/fake-billing');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const sb = makeSupabase();
const st = makeStripe();
const handler = loadWith(path.join(SERVER, 'routes', 'webhook.js'), { supabase: sb, stripe: st.api });
const allLogs = [];
async function fire(evt) {
  let res;
  const lines = await captureLogs(async () => { res = await deliver(handler, evt); });
  allLogs.push(...lines);
  return { res, lines };
}
const row = (id) => sb._db.rows.find((r) => r.id === id);
const now = () => Math.floor(Date.now() / 1000);
const dead = (lic) => !(lic.status === 'active' && !(lic.expires_at && new Date(lic.expires_at) < new Date()));

// ── The old lifetime purchase: a one-time Checkout, found by its session ────
const LIFETIME = {
  id: 'lic_1', user_id: 'user_1', license_key: 'GC-AAAA-BBBB-CCCC-DDDD', plan: 'lifetime', status: 'active',
  expires_at: null, stripe_customer_id: 'cus_1', stripe_session_id: 'cs_1', stripe_subscription_id: null,
};
function lifetimeStripe() {
  st.reset();
  st.s.sessions.set('cs_1', { id: 'cs_1', mode: 'payment', customer: 'cus_1', payment_intent: 'pi_1', metadata: { plan: 'lifetime', userId: 'user_1' } });
  st.s.charges.set('ch_1', { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', invoice: null, amount: 9900 });
}
const lifetimeRefund = (over = {}) => {
  const ch = { ...st.s.charges.get('ch_1'), amount_refunded: 9900, refunded: true, ...over };
  return st.event('charge.refunded', 'charge', ch);
};

// ── A site subscription: its subscription, invoice, charge and licence ──────
function subscription({ sub, customer, interval = 'month', key, id, user = 'user_1', plan = 'monthly', amount = 2999 }) {
  const start = now() - 3 * DAY;
  const end = start + (interval === 'week' ? 7 : interval === 'year' ? 365 : 30) * DAY;
  const n = sub.slice(4);
  st.s.subs.set(sub, { id: sub, customer, status: 'active', cancel_at_period_end: false, current_period_start: start, current_period_end: end, interval });
  st.s.invoices.set(`in_${n}`, { id: `in_${n}`, customer, subscription: sub, status: 'paid', charge: `ch_${n}`, payment_intent: `pi_${n}`,
    billing_reason: 'subscription_create', lines: [{ id: `il_${n}`, subscription: sub, start, end }] });
  st.s.charges.set(`ch_${n}`, { id: `ch_${n}`, customer, invoice: `in_${n}`, payment_intent: `pi_${n}`, amount });
  // A subscription's Checkout Session has no payment intent.
  st.s.sessions.set(`cs_${n}`, { id: `cs_${n}`, mode: 'subscription', customer, subscription: sub, payment_intent: null, invoice: `in_${n}`,
    metadata: { user_id: user, plan } });
  return { id, user_id: user, license_key: key, plan, status: 'active', expires_at: new Date((end + 2 * DAY) * 1000).toISOString(),
    stripe_customer_id: customer, stripe_subscription_id: sub, stripe_session_id: `cs_${n}` };
}
const refundOf = (chargeId, version, over = {}) => {
  const ch = st.s.charges.get(chargeId);
  const refunded = { ...ch, amount_refunded: ch.amount, refunded: true, ...over };
  st.s.charges.set(chargeId, refunded);
  return st.event('charge.refunded', 'charge', refunded, version);
};
const disputeOf = (chargeId, version) => {
  const ch = st.s.charges.get(chargeId);
  return st.event('charge.dispute.created', 'dispute', { id: `dp_${chargeId.slice(3)}`, charge: chargeId, payment_intent: ch.payment_intent, amount: ch.amount }, version);
};

(async () => {
  // ── THE FIRST HOLE: a fully refunded lifetime licence must die ────────────
  for (const schema of ['migrated', 'today']) {
    lifetimeStripe();
    sb.reset({ rows: [LIFETIME], schema });
    const { res } = await fire(lifetimeRefund());
    const lic = row('lic_1');
    const want = schema === 'migrated' ? 'refunded' : 'cancelled';
    ok(lic.status === want, `${schema === 'migrated' ? 'after' : 'before'} the site's migration a refunded lifetime licence is '${want}' (${lic.status})`);
    ok(lic.expires_at && new Date(lic.expires_at) <= new Date(), 'and its expiry is set to now, so it dies twice over');
    ok(dead(lic), 'and validateKey would now reject it');
    ok(res.code === 200, `and the webhook answers 200 (${res.code})`);
  }

  // ── A PARTIAL refund must NOT revoke ──────────────────────────────────────
  {
    lifetimeStripe();
    sb.reset({ rows: [LIFETIME], schema: 'migrated' });
    await fire(lifetimeRefund({ amount_refunded: 2000, refunded: false }));
    ok(row('lic_1').status === 'active', 'a partial refund leaves the licence alone');
    ok(sb._db.writes.length === 0, 'and writes nothing at all');
  }
  {
    // Stripe says refunded true but the amounts disagree. The amounts win.
    lifetimeStripe();
    sb.reset({ rows: [LIFETIME], schema: 'migrated' });
    await fire(lifetimeRefund({ amount_refunded: 5000, refunded: true }));
    ok(row('lic_1').status === 'active', 'a flag saying fully refunded is not trusted over the amounts');
  }

  // ── A chargeback revokes on the same terms ────────────────────────────────
  {
    lifetimeStripe();
    sb.reset({ rows: [LIFETIME], schema: 'migrated' });
    await fire(st.event('charge.dispute.created', 'dispute', { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', amount: 9900 }));
    ok(row('lic_1').status === 'disputed', `a chargeback revokes too, with its own reason (${row('lic_1').status})`);
  }

  // ── The customer fallback, and its safety rail ────────────────────────────
  {
    // No session resolves (one made by hand, say), one active licence on the
    // customer: safe to revoke.
    lifetimeStripe();
    st.s.sessions.clear();
    sb.reset({ rows: [LIFETIME], schema: 'migrated' });
    await fire(lifetimeRefund());
    ok(row('lic_1').status === 'refunded', 'with no session it falls back to the customer when that is unambiguous');
  }
  {
    // TWO active licences on one customer. Revoking both over one refund is a
    // worse bug than the one being fixed, so it refuses and says so.
    lifetimeStripe();
    st.s.sessions.clear();
    sb.reset({ rows: [LIFETIME, { ...LIFETIME, id: 'lic_2', license_key: 'GC-EEEE-FFFF-GGGG-HHHH', stripe_session_id: 'cs_2' }], schema: 'migrated' });
    const { lines } = await fire(lifetimeRefund());
    ok(sb._db.rows.filter((r) => r.status === 'active').length === 2,
      'but refuses when the customer has two active licences, rather than guessing');
    ok(lines.some((l) => l.includes('needs a human')), 'and says it needs a human');
  }
  {
    // A failed payment's licence works through its grace, so it is the
    // customer's live licence too: refunded, it is revoked.
    lifetimeStripe();
    st.s.sessions.clear();
    sb.reset({ rows: [{ ...LIFETIME, status: 'payment_failed', expires_at: new Date(Date.now() + 864e5).toISOString() }], schema: 'migrated' });
    await fire(lifetimeRefund());
    ok(row('lic_1').status === 'refunded', `a licence in its payment grace is the customer's live one, revoked by the fallback (${row('lic_1').status})`);
  }
  {
    // A repeat customer whose OTHER licence was already refunded: the one live
    // licence is still unambiguous, so this must not be blocked by history.
    lifetimeStripe();
    st.s.sessions.clear();
    sb.reset({ rows: [{ ...LIFETIME, id: 'lic_old', license_key: 'GC-OOOO-OOOO-OOOO-OOOO', status: 'refunded', stripe_session_id: 'cs_old' }, LIFETIME], schema: 'migrated' });
    await fire(lifetimeRefund());
    ok(row('lic_1').status === 'refunded', 'an already refunded past licence does not block the fallback');
  }
  {
    // A chargeback names no customer: a Dispute has none. The charge does.
    lifetimeStripe();
    st.s.sessions.clear();
    sb.reset({ rows: [LIFETIME], schema: 'migrated' });
    const evt = st.event('charge.dispute.created', 'dispute', { id: 'dp_1', charge: 'ch_1', payment_intent: null, amount: 9900 });
    ok(!('customer' in evt.data.object), 'a Dispute carries no customer field');
    await fire(evt);
    ok(row('lic_1').status === 'disputed', `so the customer comes from its charge, and the chargeback still revokes (${row('lic_1').status})`);
  }

  // ── Unrelated licences are never touched ──────────────────────────────────
  {
    lifetimeStripe();
    const other = { ...LIFETIME, id: 'lic_x', license_key: 'GC-XXXX-XXXX-XXXX-XXXX', stripe_customer_id: 'cus_other', stripe_session_id: 'cs_other' };
    sb.reset({ rows: [LIFETIME, other], schema: 'migrated' });
    await fire(lifetimeRefund());
    ok(row('lic_x').status === 'active', "another customer's licence is untouched");
  }

  // ── THE SECOND HOLE: a refund on a subscription, in both API versions ─────
  // The customer bought weekly, then monthly on top of it, so the customer
  // fallback sees two active licences and would refuse. The monthly's charge
  // is refunded: its subscription names exactly its own licence.
  for (const version of ['2023-10-16', '2025-03-31.basil']) {
    st.reset();
    const W = subscription({ sub: 'sub_W', customer: 'cus_9', interval: 'week', key: 'GC-WWWW-WWWW-WWWW-WWWW', id: 'lic_w', plan: 'weekly', amount: 1000 });
    const M = subscription({ sub: 'sub_M', customer: 'cus_9', key: 'GC-MMMM-MMMM-MMMM-MMMM', id: 'lic_m' });
    sb.reset({ rows: [W, M], schema: 'migrated' });
    const evt = refundOf('ch_M', version);
    if (version !== '2023-10-16') ok(!('invoice' in evt.data.object), 'a basil Charge carries no invoice, so the event alone cannot name the subscription');
    const { res } = await fire(evt);
    ok(row('lic_m').status === 'refunded' && dead(row('lic_m')),
      `${version}: a refunded subscription's licence is revoked by its subscription (${row('lic_m').status})`);
    ok(row('lic_w').status === 'active', `${version}: and the customer's other subscription's licence is untouched`);
    ok(st.s.subs.get('sub_M').status === 'canceled', `${version}: the refunded subscription is cancelled, so it is never charged again`);
    ok(st.s.subs.get('sub_W').status === 'active', `${version}: and the other one goes on billing`);
    ok(res.code === 200, `${version}: answered 200 (${res.code})`);
  }

  // ── A dispute on a subscription: no customer, still revoked and cancelled ─
  for (const version of ['2023-10-16', '2025-03-31.basil']) {
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_D', customer: 'cus_d', key: 'GC-DDDD-DDDD-DDDD-DDDD', id: 'lic_d' })], schema: 'migrated' });
    await fire(disputeOf('ch_D', version));
    ok(row('lic_d').status === 'disputed' && dead(row('lic_d')), `${version}: a chargeback on a subscription revokes its licence (${row('lic_d').status})`);
    ok(st.s.subs.get('sub_D').status === 'canceled', `${version}: and cancels the subscription`);
  }

  // ── Another product's subscription on the same Stripe account is left alone ─
  // Every event of the account reaches this endpoint. A subscription no
  // Occlara checkout started and no licence names keeps billing, whatever is
  // refunded or disputed: it is not Occlara's to stop.
  for (const kind of ['refund', 'dispute']) {
    st.reset();
    subscription({ sub: 'sub_O', customer: 'cus_o', key: 'GC-OOOO-ZZZZ-OOOO-ZZZZ', id: 'lic_o' });
    // That product's own checkout: its own user field and its own plan name.
    Object.assign(st.s.sessions.get('cs_O'), { client_reference_id: 'u-other',
      metadata: { supabase_user_id: 'u-other', plan: 'pro', period: 'monthly' } });
    sb.reset({ rows: [], schema: 'migrated' });
    const { res } = await fire(kind === 'refund' ? refundOf('ch_O', '2025-03-31.basil') : disputeOf('ch_O', '2025-03-31.basil'));
    ok(st.s.subs.get('sub_O').status === 'active' && st.calls('subscriptions.cancel').length === 0,
      `a ${kind} of another product's subscription charge leaves that subscription billing (${st.s.subs.get('sub_O').status})`);
    ok(res.code === 200 && sb._db.writes.every((w) => !w.error && (!w.ids || !w.ids.length)),
      `and changes no row, answering 200 (${res.code})`);
  }
  {
    // Refunded before the buyer reached /success, where the site mints the
    // key: no licence names it yet, and its checkout says it is Occlara's.
    st.reset();
    subscription({ sub: 'sub_E', customer: 'cus_e', key: 'GC-EEEE-ZZZZ-EEEE-ZZZZ', id: 'lic_e' });
    sb.reset({ rows: [], schema: 'migrated' });
    await fire(refundOf('ch_E', '2023-10-16'));
    ok(st.s.subs.get('sub_E').status === 'canceled',
      `an Occlara subscription refunded before its key was minted is still cancelled, by its checkout (${st.s.subs.get('sub_E').status})`);
  }
  {
    // Made by hand in the dashboard: no checkout started it, its licence names
    // it. The licences trigger refusing the revoke, billing still stops first:
    // a read is never refused.
    st.reset();
    const H = subscription({ sub: 'sub_H', customer: 'cus_h', key: 'GC-HHHH-ZZZZ-HHHH-ZZZZ', id: 'lic_h' });
    st.s.sessions.delete('cs_H');
    sb.reset({ rows: [H], schema: 'migrated', trigger: 'broken' });
    const { res } = await fire(refundOf('ch_H', '2023-10-16'));
    ok(res.code === 500 && st.s.subs.get('sub_H').status === 'canceled',
      `a subscription only its licence ties to Occlara is cancelled first, while the revoke is refused (${res.code}, ${st.s.subs.get('sub_H').status})`);
    sb._db.trigger = 'fixed';
    await fire(refundOf('ch_H', '2023-10-16'));
    ok(row('lic_h').status === 'refunded', `and revoked on the retry (${row('lic_h').status})`);
  }
  {
    // The licences table unreachable: billing still stops, from Stripe alone,
    // and the revoke is a 500 for Stripe to deliver again.
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_Q', customer: 'cus_q', key: 'GC-QQQQ-ZZZZ-QQQQ-ZZZZ', id: 'lic_q' })],
      schema: 'migrated', outage: true });
    const { res } = await fire(refundOf('ch_Q', '2023-10-16'));
    ok(res.code === 500 && st.s.subs.get('sub_Q').status === 'canceled',
      `with the licences table down, the refunded subscription is still cancelled first (${res.code}, ${st.s.subs.get('sub_Q').status})`);
  }

  // ── A partial refund on a subscription changes nothing, Stripe included ───
  {
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_P', customer: 'cus_p', key: 'GC-PPPP-PPPP-PPPP-PPPP', id: 'lic_p' })], schema: 'migrated' });
    await fire(refundOf('ch_P', '2025-03-31.basil', { amount_refunded: 500, refunded: false }));
    ok(row('lic_p').status === 'active' && sb._db.writes.length === 0, 'a partial refund on a subscription revokes nothing');
    ok(st.calls('subscriptions.cancel').length === 0 && st.s.subs.get('sub_P').status === 'active', 'and cancels nothing');
  }

  // ── Before the site's migration: 'cancelled', the expiry now, and no row in the log ─
  {
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_T', customer: 'cus_t', key: 'GC-TTTT-TTTT-TTTT-TTTT', id: 'lic_t' })], schema: 'today' });
    const { res, lines } = await fire(refundOf('ch_T', '2023-10-16'));
    ok(row('lic_t').status === 'cancelled' && dead(row('lic_t')),
      `the table's status CHECK refuses 'refunded' today, so 'cancelled' with the expiry now is written instead (${row('lic_t').status})`);
    ok(sb._db.writes.some((w) => w.error && w.error.code === '23514'), 'the refused write is the real CHECK violation');
    ok(res.code === 200, 'and the refund is still answered 200, done');
    ok(!lines.join('\n').includes('GC-TTTT'), "and the CHECK violation's details, the whole row with its key, are never logged");
  }

  // ── The database refusing: billing stops anyway, and Stripe is asked to retry ─
  {
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_B', customer: 'cus_b', key: 'GC-BBBB-BBBB-BBBB-BBBB', id: 'lic_b' })], schema: 'today', trigger: 'broken' });
    const { res } = await fire(refundOf('ch_B', '2023-10-16'));
    ok(res.code === 500, `a revoke the trigger refuses answers 500, so Stripe delivers it again (${res.code})`);
    ok(st.s.subs.get('sub_B').status === 'canceled', 'and the subscription is cancelled first, so billing stops while the database refuses');
    sb._db.trigger = 'fixed';
    const again = await fire(refundOf('ch_B', '2023-10-16'));
    ok(again.res.code === 200 && dead(row('lic_b')), 'the retry, once the database takes it, revokes the licence');
    ok(st.calls('subscriptions.cancel').length === 1, 'and does not try to cancel the ended subscription again');
  }
  {
    st.reset();
    sb.reset({ rows: [subscription({ sub: 'sub_S', customer: 'cus_s', key: 'GC-SSSS-SSSS-SSSS-SSSS', id: 'lic_s' })], schema: 'migrated' });
    st.s.fail.add('charges.retrieve');
    const { res } = await fire(refundOf('ch_S', '2023-10-16'));
    ok(res.code === 500 && row('lic_s').status === 'active' && sb._db.writes.length === 0,
      `Stripe failing to answer is a 500 and a retry, not a refund given up on (${res.code})`);
  }

  // ── After a refund, Stripe's later events do not undo it ──────────────────
  {
    st.reset();
    const R = subscription({ sub: 'sub_R', customer: 'cus_r', key: 'GC-RRRR-RRRR-RRRR-RRRR', id: 'lic_r' });
    sb.reset({ rows: [R], schema: 'migrated' });
    await fire(refundOf('ch_R', '2023-10-16'));
    await fire(st.event('customer.subscription.deleted', 'subscription', st.s.subs.get('sub_R'), '2025-03-31.basil'));
    ok(row('lic_r').status === 'refunded', `the subscription.deleted that follows the cancel keeps the reason 'refunded' (${row('lic_r').status})`);
    // The refunded invoice's own invoice.paid, delivered late: Stripe does not
    // promise order, and a renewal used to set any licence active again.
    await fire(st.event('invoice.paid', 'invoice', st.s.invoices.get('in_R'), '2025-03-31.basil'));
    ok(row('lic_r').status === 'refunded' && dead(row('lic_r')), 'and a late invoice.paid for the refunded invoice does not bring the licence back');
  }

  ok(!allLogs.join('\n').match(/GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/),
    'no licence key appears anywhere in what the webhook logged');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' refund revoke checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
