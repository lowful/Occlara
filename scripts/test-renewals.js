'use strict';

/**
 * A renewal must reach the licence, and a failed write must say so.
 *
 * THE BUG (B1). No renewal ever reached a licence. The licences table's trigger
 * refused the service role's writes to status and expires_at, nothing read the
 * error, and "renewed. New expiry" was logged anyway, so every subscriber lost
 * the app at the end of the first period while Stripe kept charging them. Even
 * with the database fixed, three more things would have done it:
 *
 *   an endpoint on Stripe's API 2025-03-31.basil sends an Invoice with no
 *   `subscription` (it is parent.subscription_details.subscription), so both
 *   invoice handlers broke out silently
 *   the expiry was the old one plus 7 or 30 days, with no yearly at all, while
 *   Stripe charges after the period ends and months are 28 to 31 days
 *   a failed write answered 200, so Stripe never retried it
 *
 * Held here: the expiry is the paid invoice's latest line period end plus two
 * days, in both API versions and for every plan; a refused write is a 500; a
 * failed payment and a cancelled subscription are written and checked, and an
 * out of order delivery cannot lock out a customer who has since paid; a
 * failed payment leaves the licence usable through its grace, its expiry
 * unmoved, until Stripe ends the subscription; a site
 * purchase is not logged as an orphan, and no key or email is printed.
 *
 * The real webhook runs against fake-billing.js: a Stripe and a licences table
 * that refuse what the real ones refuse. Nothing touches a network.
 *
 * Run: npm run test:renewals
 */

const path = require('path');
const { makeSupabase, makeStripe, loadWith, deliver, captureLogs, callRouter, SERVER, DAY } = require('./fixtures/fake-billing');

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
const license = loadWith(path.join(SERVER, 'routes', 'license.js'), { supabase: sb, stripe: st.api });
const allLogs = [];
async function fire(evt) {
  let res;
  const lines = await captureLogs(async () => { res = await deliver(handler, evt); });
  allLogs.push(...lines);
  return { res, lines };
}
const row = (id) => sb._db.rows.find((r) => r.id === id);
const now = () => Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString();
const same = (a, b) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) < 1000;
const VERSIONS = ['2023-10-16', '2025-03-31.basil'];

/**
 * A subscription that has just renewed: the period before it, the new one,
 * the renewal invoice paying for the new one, and its licence as the site
 * minted it (now plus 7, 30 or 365 days from the first checkout).
 */
function renewal({ sub = 'sub_1', interval = 'month', days = 30, plan = 'monthly', id = 'lic_1', key = 'GC-AAAA-AAAA-AAAA-AAAA', status = 'active' } = {}) {
  st.reset();
  const newStart = now() - 3600;                    // the period ended an hour ago,
  const newEnd = newStart + days * DAY;             // and Stripe charged for the next
  const n = sub.slice(4);
  st.s.subs.set(sub, { id: sub, customer: `cus_${n}`, status: 'active', cancel_at_period_end: false,
    current_period_start: newStart, current_period_end: newEnd, interval });
  st.s.invoices.set(`in_${n}`, { id: `in_${n}`, customer: `cus_${n}`, subscription: sub, status: 'paid', charge: `ch_${n}`,
    billing_reason: 'subscription_cycle', lines: [{ id: `il_${n}`, subscription: sub, start: newStart, end: newEnd }] });
  const minted = iso(newStart - 3600 + 2 * DAY);    // the expiry the key carries now: about to run out
  return { lic: { id, user_id: 'user_1', license_key: key, plan, status, expires_at: minted,
    stripe_customer_id: `cus_${n}`, stripe_subscription_id: sub, stripe_session_id: `cs_${n}` }, newEnd, invoice: `in_${n}` };
}
const paid = (inv, version) => st.event('invoice.paid', 'invoice', st.s.invoices.get(inv), version);
const failed = (inv, version) => st.event('invoice.payment_failed', 'invoice', st.s.invoices.get(inv), version);

(async () => {
  // ── invoice.paid, in both API versions ────────────────────────────────────
  for (const version of VERSIONS) {
    const r = renewal();
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    const evt = paid(r.invoice, version);
    if (version !== '2023-10-16') {
      ok(!('subscription' in evt.data.object) && evt.data.object.parent.subscription_details.subscription === 'sub_1',
        'a basil Invoice has no subscription field: it is parent.subscription_details.subscription');
    }
    const { res } = await fire(evt);
    ok(res.code === 200, `${version}: invoice.paid answers 200 (${res.code})`);
    ok(row('lic_1').status === 'active' && same(row('lic_1').expires_at, iso(r.newEnd + 2 * DAY)),
      `${version}: the licence runs to the new period's end plus two days (${row('lic_1').expires_at})`);
  }

  // ── Every plan, by Stripe's own period, never the old expiry plus a count ─
  for (const [plan, interval, days] of [['weekly', 'week', 7], ['monthly', 'month', 31], ['yearly', 'year', 365]]) {
    const r = renewal({ plan, interval, days });
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2025-03-31.basil'));
    ok(same(row('lic_1').expires_at, iso(r.newEnd + 2 * DAY)),
      `a ${plan} licence${days === 31 ? ' in a 31 day month' : ''} runs to its period end plus two days, not its old expiry plus a count`);
  }
  {
    // The old rule added 30 days to the old expiry, whatever the period was.
    const r = renewal({ plan: 'monthly', interval: 'month', days: 31 });
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    const oldRule = new Date(Math.max(Date.parse(r.lic.expires_at), Date.now()) + 30 * DAY * 1000).toISOString();
    ok(!same(row('lic_1').expires_at, oldRule) && Date.parse(row('lic_1').expires_at) > Date.parse(oldRule),
      'a 31 day month is not cut a day short, as old expiry plus 30 days cut it');
  }

  // ── A write the database refuses is a 500, and is never logged as done ───
  {
    const r = renewal();
    sb.reset({ rows: [r.lic], schema: 'migrated', trigger: 'broken' });
    const { res, lines } = await fire(paid(r.invoice, '2023-10-16'));
    ok(res.code === 500, `a renewal the licences trigger refuses answers 500, so Stripe retries it (${res.code})`);
    ok(row('lic_1').expires_at === r.lic.expires_at, 'and the licence is untouched');
    ok(!lines.some((l) => /renewed/i.test(l)), 'and nothing logs it as renewed');
    ok(lines.some((l) => l.includes('P0001')), 'the log names the refusal by its code');
    sb._db.trigger = 'fixed';
    const again = await fire(paid(r.invoice, '2023-10-16'));
    ok(again.res.code === 200 && same(row('lic_1').expires_at, iso(r.newEnd + 2 * DAY)), 'the retry, once the database takes it, renews');
  }

  // ── What a renewal leaves alone ───────────────────────────────────────────
  {
    const r = renewal();
    sb.reset({ rows: [], schema: 'migrated' });
    const { res } = await fire(paid(r.invoice, '2025-03-31.basil'));
    ok(res.code === 200 && sb._db.writes.length === 0,
      'an invoice for a subscription with no licence yet (the site mints it at /success) writes nothing and answers 200');
  }
  {
    const r = renewal({ plan: 'lifetime' });
    sb.reset({ rows: [{ ...r.lic, expires_at: null }], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    ok(row('lic_1').expires_at === null, 'a lifetime licence that names a subscription (made lifetime by hand) is never given an expiry');
  }
  {
    // A paid invoice for a period long over (a replay) while the current one
    // is failing: it must not set the licence active again.
    const r = renewal({ status: 'payment_failed' });
    const inv = st.s.invoices.get(r.invoice);
    inv.lines = [{ id: 'il_old', subscription: 'sub_1', start: now() - 40 * DAY, end: now() - 10 * DAY }];
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    ok(row('lic_1').status === 'payment_failed' && row('lic_1').expires_at === r.lic.expires_at,
      'a paid invoice for a period that ended over two days ago writes nothing, the status included');
  }
  {
    // A one-off charge invoiced on the subscription mid period: its line ends
    // now, and it must not cut short the period already paid for.
    const r = renewal();
    st.s.invoices.get(r.invoice).lines = [{ id: 'il_once', subscription: 'sub_1', start: now(), end: now() + 60 }];
    st.s.invoices.get(r.invoice).billing_reason = 'manual';
    const paidFor = iso(now() + 20 * DAY);
    sb.reset({ rows: [{ ...r.lic, expires_at: paidFor }], schema: 'migrated' });
    await fire(paid(r.invoice, '2025-03-31.basil'));
    ok(same(row('lic_1').expires_at, paidFor) && row('lic_1').status === 'active',
      'a paid invoice that ends sooner than the licence never moves its expiry earlier');
  }
  {
    // No period on the lines: the subscription's own, read in the server's version.
    const r = renewal();
    st.s.invoices.get(r.invoice).lines = [];
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2025-03-31.basil'));
    ok(same(row('lic_1').expires_at, iso(r.newEnd + 2 * DAY)), "with no period on its lines, the subscription's own period end is used");
  }
  {
    // The site cancelled the licence (its cancel_own_license call) while the
    // Railway call that stops billing failed: Stripe charged again, so the
    // customer has paid for the period and has it.
    const r = renewal({ status: 'cancelled' });
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    ok(row('lic_1').status === 'active' && same(row('lic_1').expires_at, iso(r.newEnd + 2 * DAY)),
      'a licence cancelled on the site while Stripe kept billing is active again for the period paid');
  }
  {
    const r = renewal({ status: 'cancelled' });
    st.s.subs.get('sub_1').status = 'canceled';
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    ok(row('lic_1').status === 'cancelled', 'but one whose subscription Stripe ended stays ended');
  }
  {
    // Revoked for a refund, and Stripe charged again anyway (its cancel had
    // failed): a payment does not undo a refund. A human does.
    const r = renewal({ status: 'refunded' });
    sb.reset({ rows: [{ ...r.lic, expires_at: new Date().toISOString() }], schema: 'migrated' });
    const { res, lines } = await fire(paid(r.invoice, '2025-03-31.basil'));
    ok(res.code === 200 && row('lic_1').status === 'refunded', 'a licence revoked for a refund is never brought back by a payment');
    ok(lines.some((l) => l.includes('Needs a human')), 'and the payment is logged for a human to stop or refund');
  }

  // ── invoice.payment_failed ────────────────────────────────────────────────
  for (const version of VERSIONS) {
    const r = renewal();
    st.s.invoices.get(r.invoice).status = 'open';
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    const { res } = await fire(failed(r.invoice, version));
    ok(res.code === 200 && row('lic_1').status === 'payment_failed', `${version}: a failed renewal marks the licence payment_failed`);
  }
  {
    const r = renewal();
    st.s.invoices.get(r.invoice).status = 'open';
    sb.reset({ rows: [r.lic], schema: 'migrated', trigger: 'broken' });
    const { res } = await fire(failed(r.invoice, '2023-10-16'));
    ok(res.code === 500, `and answers 500 when the database refuses the write (${res.code})`);
  }
  {
    // Smart Retries charged the card again and it worked, and the failure's
    // own event arrives after: it must not lock out a paying customer.
    const r = renewal();
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(paid(r.invoice, '2023-10-16'));
    const evt = st.event('invoice.payment_failed', 'invoice', { ...st.s.invoices.get(r.invoice), status: 'open' }, '2023-10-16');
    await fire(evt);
    ok(row('lic_1').status === 'active', 'a failure delivered after the retry that paid leaves the licence active');
  }
  {
    const r = renewal({ status: 'refunded' });
    st.s.invoices.get(r.invoice).status = 'open';
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(failed(r.invoice, '2023-10-16'));
    ok(row('lic_1').status === 'refunded', 'and a failure never rewrites a licence revoked for a refund');
  }
  {
    // A FAILED PAYMENT IS A GRACE, NOT AN END. The failure marks the licence
    // and leaves its expiry where it was, two days past the period end, and the
    // licence routes take it until then; Stripe giving up and ending the
    // subscription is what ends it.
    const r = renewal();
    st.s.invoices.get(r.invoice).status = 'open';
    sb.reset({ rows: [r.lic], schema: 'migrated' });
    await fire(failed(r.invoice, '2025-03-31.basil'));
    // Activation logs the licence it bound (by id); kept out of this test's output.
    const activate = async () => {
      let res = null;
      await captureLogs(async () => {
        // As an app that knows the grace asks (8.3.2 and later, license.js knowsGrace).
        res = await callRouter(license, 'POST', '/activate', { headers: { 'X-Occlara-Version': '8.3.2' },
          body: { key: r.lic.license_key, device_id: 'pc-1', device_name: 'PC' } });
      });
      return res;
    };
    const a = await activate();
    ok(row('lic_1').status === 'payment_failed' && row('lic_1').expires_at === r.lic.expires_at
      && Date.parse(r.lic.expires_at) > Date.now() && a.body.valid === true && a.body.status === 'payment_failed',
    `a failed renewal leaves the licence usable through its grace: its expiry unmoved, /activate valid with status payment_failed (${JSON.stringify(a.body)})`);
    await fire(st.event('customer.subscription.deleted', 'subscription', { ...st.s.subs.get('sub_1'), status: 'canceled' }, '2025-03-31.basil'));
    const b = await activate();
    ok(row('lic_1').status === 'cancelled' && b.body.valid === false && b.body.status === 'cancelled',
      `and Stripe giving up on the card ends it (${b.body.status})`);
  }

  // ── customer.subscription.deleted ─────────────────────────────────────────
  for (const version of VERSIONS) {
    const r = renewal();
    const life = { ...r.lic, id: 'lic_life', license_key: 'GC-LLLL-LLLL-LLLL-LLLL', plan: 'lifetime', expires_at: null, stripe_session_id: null };
    const gone = { ...r.lic, id: 'lic_ref', license_key: 'GC-RRRR-RRRR-RRRR-RRRR', status: 'refunded', stripe_session_id: null };
    sb.reset({ rows: [r.lic, life, gone], schema: 'migrated' });
    const { res } = await fire(st.event('customer.subscription.deleted', 'subscription', { ...st.s.subs.get('sub_1'), status: 'canceled' }, version));
    ok(res.code === 200 && row('lic_1').status === 'cancelled', `${version}: Stripe ending the subscription cancels its licence`);
    ok(row('lic_ref').status === 'refunded' && row('lic_life').status === 'active',
      `${version}: but a refunded licence keeps its reason, and a lifetime one is not touched`);
  }
  {
    const r = renewal();
    sb.reset({ rows: [r.lic], schema: 'migrated', trigger: 'broken' });
    const { res } = await fire(st.event('customer.subscription.deleted', 'subscription', { ...st.s.subs.get('sub_1'), status: 'canceled' }, '2023-10-16'));
    ok(res.code === 500 && row('lic_1').status === 'active', `and answers 500 when the database refuses (${res.code})`);
  }

  // ── checkout.session.completed: what is minted, and what is logged ────────
  const checkout = (session, version = '2023-10-16') => {
    st.s.sessions.set(session.id, session);
    return st.event('checkout.session.completed', 'session', session, version);
  };
  {
    st.reset();
    sb.reset({ rows: [], schema: 'migrated' });
    const { res, lines } = await fire(checkout({ id: 'cs_site', mode: 'subscription', customer: 'cus_s', subscription: 'sub_s',
      metadata: { user_id: 'user_site', plan: 'yearly' }, customer_details: { email: 'buyer@example.test' }, payment_status: 'paid' }));
    const text = lines.join('\n');
    ok(res.code === 200 && sb._db.rows.length === 0, 'a site purchase (metadata.user_id) mints nothing here: the site mints its own');
    ok(!text.includes('UNLINKED PURCHASE') && !text.includes('CRITICAL'), 'and is not logged as an UNLINKED PURCHASE or CRITICAL');
    ok(!text.includes('buyer@example.test'), "and the buyer's email is not printed");
  }
  {
    st.reset();
    sb.reset({ rows: [], schema: 'migrated' });
    const { lines } = await fire(checkout({ id: 'cs_orphan', mode: 'payment', customer: 'cus_o', metadata: {},
      customer_details: { email: 'orphan@example.test' }, payment_status: 'paid' }));
    const line = lines.find((l) => l.includes('UNLINKED PURCHASE')) || '';
    ok(line.includes('cs_orphan') && line.includes('cus_o'), 'a purchase with no user at all is still an UNLINKED PURCHASE, naming the session and customer');
    ok(!lines.join('\n').includes('orphan@example.test'), 'without printing the email: the buyer is on the session in Stripe');
  }
  {
    // The old Railway checkout's path, still minting: a yearly from its price.
    st.reset();
    sb.reset({ rows: [], schema: 'migrated' });
    const { res } = await fire(checkout({ id: 'cs_old', mode: 'subscription', customer: 'cus_y', subscription: 'sub_y',
      client_reference_id: 'user_y', metadata: { userId: 'user_y' }, interval: 'year', payment_status: 'paid' }));
    const lic = sb._db.rows[0];
    ok(res.code === 200 && lic && lic.plan === 'yearly', `a yearly price mints a yearly licence (${lic && lic.plan})`);
    ok(lic && Math.abs(Date.parse(lic.expires_at) - (Date.now() + 367 * DAY * 1000)) < 5000,
      'running a year plus the two day grace, where a missing yearly branch once gave an expiry of now');
    const lines = await captureLogs(async () => { await deliver(handler, checkout(st.s.sessions.get('cs_old'))); });
    ok(sb._db.rows.length === 1 && lines.some((l) => l.includes('already has its licence')), 'and a second delivery mints nothing more');
  }
  {
    st.reset();
    sb.reset({ rows: [], schema: 'today' });
    const { res, lines } = await fire(checkout({ id: 'cs_old2', mode: 'subscription', customer: 'cus_y2', subscription: 'sub_y2',
      client_reference_id: 'user_y2', metadata: { userId: 'user_y2', plan: 'yearly' }, payment_status: 'paid' }));
    ok(res.code === 500 && sb._db.rows.length === 0,
      `before the site's migration the plan CHECK refuses 'yearly': 500, so Stripe retries until it is allowed (${res.code})`);
    ok(!lines.join('\n').match(/GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/), 'and the refused row, key and all, is not logged');
  }
  {
    // ANOTHER APP'S CHECKOUT ON THE SAME STRIPE ACCOUNT: client_reference_id
    // names its own user, whom Occlara's licences table (user_id, a uuid that
    // references auth.users) does not have. Nothing is minted and the answer
    // is 200: as a 500, Stripe retried each such sale for three days.
    const OCCLARA_USER = 'aaaaaaaa-1111-4111-8111-111111111111';
    for (const [who, code] of [['bbbbbbbb-2222-4222-8222-222222222222', '23503'], ['user_elsewhere', '22P02']]) {
      st.reset();
      sb.reset({ rows: [], schema: 'migrated', authUsers: [OCCLARA_USER] });
      const { res, lines } = await fire(checkout({ id: `cs_x${code}`, mode: 'subscription', customer: 'cus_x', subscription: 'sub_x',
        client_reference_id: who, metadata: { supabase_user_id: who, plan: 'pro', period: 'monthly' }, interval: 'month', payment_status: 'paid' }));
      ok(res.code === 200 && sb._db.rows.length === 0 && sb._db.writes.some((w) => w.error && w.error.code === code),
        `a checkout naming a user Occlara does not have (${code}) mints nothing and answers 200, not a retry (${res.code})`);
      ok(lines.some((l) => l.includes('nothing minted')), 'and says why in one line');
    }
    st.reset();
    sb.reset({ rows: [], schema: 'migrated', authUsers: [OCCLARA_USER] });
    const { res } = await fire(checkout({ id: 'cs_fk_ok', mode: 'subscription', customer: 'cus_k', subscription: 'sub_k',
      client_reference_id: OCCLARA_USER, metadata: { userId: OCCLARA_USER, plan: 'monthly' }, payment_status: 'paid' }));
    ok(res.code === 200 && sb._db.rows.length === 1 && sb._db.rows[0].user_id === OCCLARA_USER,
      'while a buyer Occlara has is still minted, the foreign key in force');
  }
  {
    // Keys come from the operating system's random source, not Math.random.
    const { generateLicenseKey } = handler.__test;
    const real = Math.random;
    Math.random = () => 0;
    let a; let b;
    try { a = generateLicenseKey(); b = generateLicenseKey(); } finally { Math.random = real; }
    ok(/^GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(a) && a !== b,
      'a minted key keeps its shape and does not come from Math.random');
  }
  {
    // The yearly-less copies that lived in utils/license.js, extendExpiresAt
    // among them, are gone, so nothing can pick them up again.
    const utils = require(path.join(SERVER, 'utils', 'license.js'));
    ok(typeof utils.generateLicenseKey === 'function' && !('getExpiresAt' in utils) && !('extendExpiresAt' in utils),
      'no copy of the old expiry rule is left to require');
  }
  {
    const { getExpiresAt } = handler.__test;
    const t = Date.parse('2026-10-12T00:00:00.000Z');
    ok(getExpiresAt('lifetime', t) === null && getExpiresAt('weekly', t) === '2026-10-21T00:00:00.000Z'
      && getExpiresAt('yearly', t) === '2027-10-14T00:00:00.000Z',
      'getExpiresAt knows every plan: lifetime never, weekly 7 days and yearly 365, each plus two');
  }

  ok(!allLogs.join('\n').match(/GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/), 'no licence key appears anywhere in what the webhook logged');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' renewal checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
