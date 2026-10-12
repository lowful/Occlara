'use strict';

/**
 * The account's billing routes, held to what they promise.
 *
 *   /api/payments/cancel (B5). Only the newest licence's subscription was set
 *   to cancel, so a customer with two (a weekly, then a monthly on top) went on
 *   paying for one, and a licence the site marked cancelled while its Stripe
 *   call failed was refused as having nothing to cancel, still billing. Its
 *   expiry write was never checked. Now every subscription Stripe still bills
 *   is set to cancel at its period end, each licence runs to that end plus
 *   the grace (a cancel the customer renews in Stripe's portal is charged an
 *   hour after the end, and must not lapse meanwhile), one whose card is
 *   failing is ended now so Stripe stops retrying it, a Stripe failure is a
 *   502 and a refused write a 500, never a 200.
 *
 *   /api/payments/create-checkout and /success (H3) asked for no sign in: any
 *   userId, the old prices, and a licence key for any session id. Both 410.
 *
 *   /api/license/deactivate (S11) wrote two columns the live table does not
 *   have, PostgREST refused the whole write, and it answered success with the
 *   device still locked. Now it writes the columns the table has, and a
 *   refused write is a 503.
 *
 *   /api/admin/licenses/sync-expiry, the repair: every licence with a
 *   subscription put right from Stripe, a dry run unless ?apply=1. A failing
 *   card's licence runs to the period paid for plus the grace: it ran to the
 *   unpaid period's end, which a failed payment's grace (license.js usable)
 *   made a free month, or a free year.
 *
 *   /api/account/dashboard's renews read cancel_at_period_end alone, so a
 *   subscription Stripe had ended (canceled, incomplete_expired) or no longer
 *   has at all read renews: true, and an expired key's account page said it
 *   renewed. Now those are false, and a Stripe it could not ask is null.
 *
 * The real routers run against fake-billing.js. Nothing touches a network.
 *
 * Run: npm run test:billingroutes
 */

const path = require('path');
const {
  makeSupabase, makeStripe, render, loadWith, callRouter, captureLogs, SERVER, DAY, LIVE_COLUMNS,
} = require('./fixtures/fake-billing');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.ADMIN_PASSWORD = 'repair-password';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const sb = makeSupabase();
const st = makeStripe();
const payments = loadWith(path.join(SERVER, 'routes', 'payments.js'), { supabase: sb, stripe: st.api });
const license = loadWith(path.join(SERVER, 'routes', 'license.js'), { supabase: sb, stripe: st.api });
const admin = loadWith(path.join(SERVER, 'routes', 'admin.js'), { supabase: sb, stripe: st.api });
const account = loadWith(path.join(SERVER, 'routes', 'account.js'), { supabase: sb, stripe: st.api });
const billing = require(path.join(SERVER, 'services', 'billing.js'));

const ALICE = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'alice@example.test' };
const USERS = { 'token-alice': ALICE };
const as = (token) => ({ authorization: `Bearer ${token}` });
const row = (id) => sb._db.rows.find((r) => r.id === id);
const now = () => Math.floor(Date.now() / 1000);
const iso = (sec) => new Date(sec * 1000).toISOString();
const same = (a, b) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) < 1000;
const KEY_RE = /GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/;
async function quiet(fn) { let out; const lines = await captureLogs(async () => { out = await fn(); }); return { ...out, lines }; }

/** A subscription in Stripe and the licence that names it. */
function sub(id, { status = 'active', days = 30, cancel = false, ended = null, lic = {} } = {}) {
  const start = now() - 5 * DAY;
  const end = start + days * DAY;
  st.s.subs.set(id, { id, customer: `cus_${id}`, status, cancel_at_period_end: cancel, current_period_start: start,
    current_period_end: end, canceled_at: ended, ended_at: ended, interval: days === 7 ? 'week' : 'month' });
  return {
    start,
    end,
    lic: { id: `lic_${id}`, user_id: ALICE.id, license_key: `GC-${id.slice(4, 8).toUpperCase().padEnd(4, 'X')}-AAAA-BBBB-CCCC`, plan: 'monthly',
      status: 'active', expires_at: iso(start + 30 * DAY), stripe_customer_id: `cus_${id}`, stripe_subscription_id: id,
      stripe_session_id: `cs_${id}`, device_id: 'dev', device_name: 'PC', created_at: iso(start), ...lic },
  };
}

(async () => {
  // ── /cancel: every subscription Stripe still bills ────────────────────────
  {
    st.reset();
    const w = sub('sub_week', { days: 7, lic: { plan: 'weekly', created_at: iso(now() - 20 * DAY) } });
    const m = sub('sub_month', { lic: { created_at: iso(now() - 2 * DAY) } });
    sb.reset({ rows: [w.lic, m.lic], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: { userId: ALICE.id } }));
    ok(r.status === 200 && r.body.cancelled === true, `two subscriptions: cancel answers 200 (${r.status} ${r.body && r.body.error})`);
    ok(st.s.subs.get('sub_week').cancel_at_period_end && st.s.subs.get('sub_month').cancel_at_period_end,
      'and BOTH are set to cancel at their period end, not just the newest licence\'s');
    ok(same(row('lic_sub_week').expires_at, iso(w.end + 2 * DAY)) && same(row('lic_sub_month').expires_at, iso(m.end + 2 * DAY)),
      'each licence runs to its own period end plus the two day grace');
    ok(row('lic_sub_week').status === 'active' && row('lic_sub_month').status === 'active',
      'and keeps its status, so access lasts to the end of what was paid for');
    ok(r.body.subscriptions.length === 2 && same(r.body.accessUntil, iso(Math.max(w.end, m.end)))
      && r.body.subscriptions.every((s) => same(s.accessUntil, iso(s.id === 'sub_week' ? w.end : m.end))),
      'the answer lists both, each with Stripe\'s own end, and accessUntil is the later end');
  }
  {
    // CANCEL, THEN RENEW IN STRIPE'S PORTAL (the site's Manage subscription),
    // which tells this server nothing. Stripe charges the renewal about an
    // hour after the period ends: the licence must still be good then, or the
    // app stops the match being recorded for that hour.
    st.reset();
    const u = sub('sub_undo', { lic: { expires_at: iso(now() + 27 * DAY) } });
    sb.reset({ rows: [u.lic], schema: 'migrated', users: USERS });
    await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    st.s.subs.get('sub_undo').cancel_at_period_end = false;
    const chargedAt = (u.end + 3600) * 1000;
    ok(Date.parse(row('lic_sub_undo').expires_at) > chargedAt,
      `a cancel renewed in the portal has not expired when Stripe charges the renewal an hour after the end (${row('lic_sub_undo').expires_at})`);
  }
  {
    // A CARD THAT IS FAILING: past_due means the period was never paid. Set to
    // cancel at its period end, Stripe would go on retrying the unpaid invoice
    // and could charge a customer who had cancelled; ended now, it cannot.
    st.reset();
    const due = sub('sub_due', { status: 'past_due', lic: { status: 'payment_failed', created_at: iso(now() - 9 * DAY) } });
    const ok2 = sub('sub_fine', { lic: { created_at: iso(now() - DAY) } });
    sb.reset({ rows: [due.lic, ok2.lic], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    ok(r.status === 200 && st.s.subs.get('sub_due').status === 'canceled'
      && st.calls('subscriptions.cancel').some((c) => c.id === 'sub_due'),
      `a past_due subscription is cancelled now, which stops Stripe's retries of its unpaid invoice (${r.status} ${st.s.subs.get('sub_due').status})`);
    const entry = (r.body.subscriptions || []).find((s) => s.id === 'sub_due') || {};
    ok(entry.cancelled === true && entry.endedNow === true && entry.accessUntil === null,
      'and the answer says it ended now, promising no access');
    ok(st.s.subs.get('sub_fine').status === 'active' && st.s.subs.get('sub_fine').cancel_at_period_end === true
      && same(r.body.accessUntil, iso(ok2.end)),
      'while the one that is paid for still runs to its period end');
  }
  {
    // The site marked the licence cancelled, and its call to stop billing
    // failed: Stripe is still charging it. That is a subscription to stop.
    st.reset();
    const c = sub('sub_site', { lic: { status: 'cancelled' } });
    sb.reset({ rows: [c.lic], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    ok(r.status === 200 && st.s.subs.get('sub_site').cancel_at_period_end === true,
      `a licence cancelled on the site whose subscription still bills is stopped, not refused (${r.status})`);
  }
  {
    // Made lifetime by hand, still naming the monthly it was: that
    // subscription is stopped, and the lifetime licence is given no expiry.
    st.reset();
    const h = sub('sub_hand', { lic: { plan: 'lifetime', expires_at: null } });
    sb.reset({ rows: [h.lic], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    ok(r.status === 200 && st.s.subs.get('sub_hand').cancel_at_period_end === true && row('lic_sub_hand').expires_at === null,
      `a lifetime licence that names a billing subscription: billing stops, and the licence keeps no expiry (${r.status})`);
  }
  {
    st.reset();
    const gone = sub('sub_gone', { status: 'canceled', ended: now() - DAY });
    const life = { id: 'lic_life', user_id: ALICE.id, license_key: 'GC-LIFE-AAAA-BBBB-CCCC', plan: 'lifetime', status: 'active',
      expires_at: null, created_at: iso(now()) };
    sb.reset({ rows: [gone.lic, life], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    ok(r.status === 400 && r.body.reason === 'no-subscription' && r.body.plan === 'lifetime' && /nothing to cancel/.test(r.body.error),
      `a lifetime licence beside a subscription Stripe already ended is the 400 it always was (${r.status})`);
    ok(st.calls('subscriptions.update').length === 0 && sb._db.writes.length === 0, 'and nothing is asked of Stripe or written');
  }
  {
    st.reset();
    const a = sub('sub_aaa');
    const b = sub('sub_bbb');
    sb.reset({ rows: [a.lic, b.lic], schema: 'migrated', users: USERS });
    const realUpdate = st.api.subscriptions.update;
    st.api.subscriptions.update = async (id, p) => {
      if (id === 'sub_bbb') throw Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' });
      return realUpdate(id, p);
    };
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    st.api.subscriptions.update = realUpdate;
    ok(r.status === 502 && r.body.partial === true && r.body.cancelled === false && /not all/.test(r.body.error),
      `Stripe failing to stop one of two is a 502 saying so, never "cancelled" (${r.status})`);
    ok(st.s.subs.get('sub_aaa').cancel_at_period_end === true, 'the one it could stop is stopped');
  }
  {
    st.reset();
    // Its expiry is not its period end plus the grace (minted by the calendar,
    // say), so cancelling moves it there: a write to a protected field, which
    // the live trigger refuses.
    const t = sub('sub_trig', { lic: { expires_at: iso(now() + 40 * DAY) } });
    sb.reset({ rows: [t.lic], schema: 'migrated', users: USERS, trigger: 'broken' });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { headers: as('token-alice'), body: {} }));
    ok(r.status === 500 && r.body.billingStopped === true && /Billing is stopped/.test(r.body.error),
      `an expiry write the database refuses is a 500 that says billing is stopped, not a 200 (${r.status})`);
    ok(st.s.subs.get('sub_trig').cancel_at_period_end === true, 'and billing really is stopped');
  }
  {
    st.reset();
    sb.reset({ rows: [sub('sub_any').lic], schema: 'migrated', users: USERS });
    const r = await quiet(() => callRouter(payments, 'POST', '/cancel', { body: { userId: ALICE.id } }));
    ok(r.status === 401 && st.s.calls.length === 0, 'and nobody cancels without signing in');
  }

  // ── /api/account/dashboard: whether the subscription renews ──────────────
  {
    const dashboard = async (rows) => {
      sb.reset({ rows, schema: 'migrated', users: USERS });
      return quiet(() => callRouter(account, 'GET', '/dashboard', { headers: as('token-alice') }));
    };
    const renewsFor = async (id, opts) => {
      st.reset();
      const s = sub(id, opts);
      const r = await dashboard([s.lic]);
      return { status: r.status, renews: r.body && r.body.license ? r.body.license.renews : 'no licence', sub: r.body && r.body.subscription };
    };
    const live = await renewsFor('sub_live');
    ok(live.status === 200 && live.renews === true, `a subscription Stripe bills renews (${live.status} ${live.renews})`);
    const leaving = await renewsFor('sub_leaving', { cancel: true });
    ok(leaving.renews === false, `one set to cancel at its period end does not (${leaving.renews})`);
    const ended = await renewsFor('sub_ended', { status: 'canceled', ended: now() - DAY });
    ok(ended.status === 200 && ended.renews === false && ended.sub && ended.sub.stripe_status === 'canceled',
      `one Stripe has ended (canceled) does not renew, though it was never set to cancel at its period end (${ended.renews})`);
    const expired = await renewsFor('sub_expired', { status: 'incomplete_expired' });
    ok(expired.renews === false, `nor one whose first payment never came (incomplete_expired) (${expired.renews})`);
    const due = await renewsFor('sub_due2', { status: 'past_due' });
    ok(due.renews === true, `while one whose card is failing still renews once Stripe's retry pays (${due.renews})`);
    st.reset();
    const g = sub('sub_vanished');
    st.s.subs.delete('sub_vanished');
    const gone = await dashboard([g.lic]);
    ok(gone.status === 200 && gone.body.license && gone.body.license.renews === false && gone.body.subscription === null,
      `a subscription Stripe has no record of is gone and does not renew (${gone.status} ${gone.body.license && gone.body.license.renews})`);
    st.reset();
    const f = sub('sub_flaky');
    st.s.fail.add('subscriptions.retrieve');
    const flaky = await dashboard([f.lic]);
    ok(flaky.status === 200 && flaky.body.license && flaky.body.license.renews === null,
      `a Stripe that cannot be asked just now says nothing either way, and the page still answers (${flaky.status} ${flaky.body.license && flaky.body.license.renews})`);
    st.reset();
    const life = await dashboard([{ id: 'lic_lifeonly', user_id: ALICE.id, license_key: 'GC-LIFO-AAAA-BBBB-CCCC', plan: 'lifetime',
      status: 'active', expires_at: null }]);
    ok(life.body.license && life.body.license.renews === null && st.calls('subscriptions.retrieve').length === 0,
      'and a lifetime licence has no subscription to ask about: null, Stripe never asked');
  }

  // ── The old public checkout and its success page ──────────────────────────
  {
    st.reset();
    sb.reset({ rows: [sub('sub_old').lic], schema: 'migrated' });
    const c = await callRouter(payments, 'POST', '/create-checkout', { body: { plan: 'lifetime', userId: 'anyone', email: 'x@example.test' } });
    ok(c.status === 410 && /occlara\.app/.test(c.body.error), `POST /create-checkout is 410 Gone with a sentence (${c.status})`);
    ok(st.calls('checkout.sessions.create').length === 0, 'and creates no Checkout session, at any price');
    const s = await callRouter(payments, 'GET', '/success?session_id=cs_sub_old');
    ok(s.status === 410 && !KEY_RE.test(JSON.stringify(s.body)), `GET /success is 410 and hands out no key (${s.status})`);
  }

  // ── /api/license/deactivate on the live table's columns ───────────────────
  {
    sb.reset({ rows: [sub('sub_dev').lic], schema: 'migrated', users: USERS });
    ok(!Object.prototype.hasOwnProperty.call(row('lic_sub_dev'), 'deactivation_count'), 'the live table has no deactivation_count column');
    const r = await quiet(() => callRouter(license, 'POST', '/deactivate', { headers: as('token-alice'), body: {} }));
    ok(r.status === 200 && r.body.success === true, `deactivate answers 200 (${r.status} ${r.body && r.body.error})`);
    ok(row('lic_sub_dev').device_id === null && row('lic_sub_dev').device_name === null,
      'and the device lock really is cleared, where PostgREST refused the old write whole');
    ok(r.body.deactivationsThisMonth === null && r.body.deactivationsRemaining === null, 'and it claims no count the table cannot keep');
  }
  {
    sb.reset({ rows: [sub('sub_dev').lic], schema: 'migrated', users: USERS, failWrites: true });
    const r = await quiet(() => callRouter(license, 'POST', '/deactivate', { headers: as('token-alice'), body: {} }));
    ok(r.status === 503 && r.body.retry === true && !r.body.success, `a write that fails is a 503 with retry, never a success (${r.status})`);
  }
  {
    // A table that does keep the count: the monthly limit holds.
    const cols = LIVE_COLUMNS.concat(['deactivation_count', 'last_deactivation_date']);
    const full = { ...sub('sub_cnt').lic, deactivation_count: 3, last_deactivation_date: new Date().toISOString() };
    sb.reset({ rows: [full], schema: 'migrated', users: USERS, columns: cols });
    const r = await quiet(() => callRouter(license, 'POST', '/deactivate', { headers: as('token-alice'), body: {} }));
    ok(r.status === 429 && row('lic_sub_cnt').device_id === 'dev', `where the table counts, the fourth in a month is refused (${r.status})`);
    row('lic_sub_cnt').deactivation_count = 1;
    const r2 = await quiet(() => callRouter(license, 'POST', '/deactivate', { headers: as('token-alice'), body: {} }));
    ok(r2.status === 200 && r2.body.deactivationsThisMonth === 2 && row('lic_sub_cnt').deactivation_count === 2,
      'and the second is counted');
  }
  {
    sb.reset({ rows: [{ ...sub('sub_act').lic, device_id: null, device_name: null }], schema: 'migrated' });
    const r = await quiet(() => callRouter(license, 'POST', '/activate', { body: { key: 'GC-ACTX-AAAA-BBBB-CCCC', device_id: 'pc-1', device_name: 'PC' } }));
    ok(r.status === 200 && r.body.valid === true && row('lic_sub_act').device_id === 'pc-1', 'activation still binds the device');
    ok(!r.lines.join('\n').match(KEY_RE), 'and logs the licence by its id, never its key');
  }

  // ── The repair: /api/admin/licenses/sync-expiry ───────────────────────────
  const T0 = now();
  function repairWorld() {
    st.reset();
    const rows = [];
    const add = (id, opts) => { const s = sub(id, opts); rows.push(s.lic); return s; };
    const w = {
      // Minted with now plus 30 days at a checkout ten days ago; Stripe's period ends elsewhere.
      stale:    add('sub_01', { lic: { expires_at: iso(T0 + 20 * DAY) } }),
      site:     add('sub_02', { days: 7, lic: { plan: 'weekly', status: 'cancelled' } }),
      ended:    add('sub_03', { status: 'canceled', ended: T0 - 3 * DAY, lic: { plan: 'yearly' } }),
      refunded: add('sub_04', { status: 'canceled', ended: T0 - 3 * DAY, lic: { status: 'refunded', expires_at: iso(T0 - 4 * DAY) } }),
      disputed: add('sub_05', { lic: { status: 'disputed', expires_at: iso(T0 - DAY) } }),
      lifetime: add('sub_06', { lic: { plan: 'lifetime', expires_at: null } }),
      missing:  add('sub_07'),
      pastDue:  add('sub_08', { status: 'past_due' }),
      cancels:  add('sub_09', { cancel: true, lic: { expires_at: iso(T0 + 40 * DAY) } }),
      right:    add('sub_10'),
    };
    st.s.subs.delete('sub_07');
    w.right.lic.expires_at = iso(w.right.end + 2 * DAY);
    rows.find((r) => r.id === 'lic_sub_10').expires_at = w.right.lic.expires_at;
    rows.push({ id: 'lic_plain', user_id: ALICE.id, license_key: 'GC-PLAN-AAAA-BBBB-CCCC', plan: 'lifetime', status: 'active', expires_at: null });
    return { rows, w };
  }
  // A reply that is not a report (a 404, say) still has its lists, so every
  // check below reports a FAIL rather than the test crashing on it.
  const sync = async (q = '', pw = 'repair-password') => {
    const r = await quiet(() => callRouter(admin, 'POST', `/licenses/sync-expiry${q}`,
      { headers: pw ? { 'X-Admin-Password': pw } : {} }));
    r.body = { changes: [], held: [], errors: [], ...(r.body || {}) };
    return r;
  };
  {
    const { rows } = repairWorld();
    sb.reset({ rows, schema: 'migrated' });
    const none = await sync('', null);
    const wrong = await sync('', 'guess');
    ok(none.status === 401 && wrong.status === 401 && st.s.calls.length === 0, 'the repair needs the admin password, and asks Stripe nothing without it');
  }
  {
    const { rows, w } = repairWorld();
    sb.reset({ rows, schema: 'migrated' });
    const before = JSON.stringify(sb._db.rows);
    const r = await sync();
    const by = (id) => r.body.changes.find((c) => c.id === id);
    ok(r.status === 200 && r.body.apply === false && JSON.stringify(sb._db.rows) === before && sb._db.writes.length === 0,
      `a dry run by default: it writes nothing (${r.status})`);
    ok(r.body.checked === 10 && r.body.subscriptions === 9, `every licence with a subscription is checked, each subscription read once (${r.body.checked}, ${r.body.subscriptions})`);
    ok(by('lic_sub_01') && by('lic_sub_01').to.status === 'active' && same(by('lic_sub_01').to.expires_at, iso(w.stale.end + 2 * DAY))
      && by('lic_sub_01').from.expires_at === w.stale.lic.expires_at,
      'a stale expiry moves to Stripe\'s period end plus two days, before and after both listed');
    ok(by('lic_sub_02') && by('lic_sub_02').to.status === 'active' && /active again/.test(by('lic_sub_02').note || ''),
      'a licence cancelled on the site while Stripe bills it is active again, and says why');
    ok(by('lic_sub_03') && by('lic_sub_03').to.status === 'cancelled' && same(by('lic_sub_03').to.expires_at, iso(T0 - 3 * DAY)),
      'one whose subscription Stripe ended is cancelled, at the moment it ended');
    ok(!by('lic_sub_04'), 'a refunded licence whose subscription ended is left as it is');
    ok(r.body.held.some((h) => h.id === 'lic_sub_05' && /cancel it in Stripe/.test(h.note)),
      'a disputed licence whose subscription Stripe still bills is held, and named for a human');
    ok(r.body.held.some((h) => h.id === 'lic_sub_06') && !by('lic_sub_06'), 'a lifetime licence is never given an expiry');
    ok(r.body.errors.some((e) => e.id === 'lic_sub_07' && /not in Stripe/.test(e.error)), 'a subscription Stripe has no record of is listed as an error');
    ok(by('lic_sub_08') && by('lic_sub_08').to.status === 'payment_failed' && same(by('lic_sub_08').to.expires_at, iso(w.pastDue.start + 2 * DAY)),
      `a past_due subscription makes its licence payment_failed, to the end of the period paid for (where the unpaid one began) plus two days (${by('lic_sub_08') && by('lic_sub_08').to.expires_at})`);
    ok(by('lic_sub_09') && same(by('lic_sub_09').to.expires_at, iso(w.cancels.end + 2 * DAY)),
      'one set to cancel at its period end gets the grace too, as the customer can still renew it in the portal');
    ok(!by('lic_sub_10') && r.body.unchanged >= 2, 'one already right is unchanged');
    ok(!KEY_RE.test(JSON.stringify(r.body)) && !JSON.stringify(r.body).includes('@'), 'the report carries no licence key and no email');
  }
  {
    const { rows, w } = repairWorld();
    sb.reset({ rows, schema: 'migrated' });
    admin.__test.SYNC.page = 3;            // several pages of the table
    const r = await sync('?apply=1');
    admin.__test.SYNC.page = 500;
    ok(r.status === 200 && r.body.apply === true && r.body.applied === r.body.changes.length && r.body.applied === 5,
      `?apply=1 writes every change (${r.status}, ${r.body.applied} of ${r.body.changes.length}), across pages`);
    ok(row('lic_sub_01').status === 'active' && same(row('lic_sub_01').expires_at, iso(w.stale.end + 2 * DAY))
      && row('lic_sub_03').status === 'cancelled' && row('lic_sub_06').expires_at === null && row('lic_sub_05').status === 'disputed',
      'and the table now follows Stripe, the held rows as they were');
    const again = await sync();
    ok(again.status === 200 && again.body.changes.length === 0, 'a second dry run finds nothing left to change');
  }
  {
    const { rows } = repairWorld();
    sb.reset({ rows, schema: 'migrated', trigger: 'broken' });
    const r = await sync('?apply=1');
    ok(r.status === 500 && r.body.applied === 0 && r.body.errors.filter((e) => /P0001/.test(e.error)).length === r.body.changes.length,
      `writes the database refuses are a 500 listing each one, never a quiet success (${r.status})`);
  }
  {
    // The rule reads a basil Subscription too, whose period is on its items.
    const s = { id: 'sub_b', customer: 'cus_b', status: 'active', cancel_at_period_end: false, current_period_start: T0, current_period_end: T0 + 30 * DAY, interval: 'month' };
    const basil = render('subscription', s, '2025-03-31.basil');
    ok(!('current_period_end' in basil) && billing.periodEndOf(basil) === T0 + 30 * DAY && same(billing.expiryFor(basil), iso(T0 + 32 * DAY)),
      "a basil Subscription has no current_period_end of its own; its items' is read");
    const due = render('subscription', { ...s, id: 'sub_bd', status: 'past_due' }, '2025-03-31.basil');
    ok(!('current_period_start' in due) && billing.periodStartOf(due) === T0 && same(billing.failingExpiryFor(due, null), iso(T0 + 2 * DAY)),
      "and a failing one's period start is read off its items the same way");
  }

  // ── The repair and a failing card: the period paid for, never the one being collected ──
  // Stripe moves a subscription's period on when it bills the renewal, paid or
  // not, so a past_due one's current period is the unpaid one. A failed payment
  // is usable until its expiry now (license.js usable), so an expiry at that
  // period's end was all of it free: 32 days on a monthly plan, 367 on a yearly.
  {
    const T = now();
    const hourAgo = T - 3600;
    const failing = (id, { status, plan = 'monthly', len = 30, lic }) => {
      st.s.subs.set(id, { id, customer: `cus_${id}`, status, cancel_at_period_end: false, current_period_start: hourAgo,
        current_period_end: hourAgo + len * DAY, canceled_at: null, ended_at: null, interval: plan === 'yearly' ? 'year' : 'month' });
      return { id: `lic_${id}`, user_id: ALICE.id, license_key: lic.key, plan, status: lic.status, expires_at: lic.expires_at,
        stripe_customer_id: `cus_${id}`, stripe_subscription_id: id, stripe_session_id: `cs_${id}`, device_id: 'dev', device_name: 'PC',
        created_at: iso(T - 90 * DAY) };
    };
    st.reset();
    sb.reset({ schema: 'migrated', rows: [
      // As invoice.payment_failed leaves it, an hour into the unpaid period: its grace still to run.
      failing('sub_f1', { status: 'past_due', lic: { key: 'GC-FAIL-MNTH-AAAA-BBBB', status: 'payment_failed', expires_at: iso(hourAgo + 2 * DAY) } }),
      failing('sub_f2', { status: 'past_due', plan: 'yearly', len: 365, lic: { key: 'GC-FAIL-YEAR-AAAA-BBBB', status: 'payment_failed', expires_at: iso(hourAgo + 2 * DAY) } }),
      // Its renewals never reached it (the trigger refused them): still active, its expiry from the day it was minted.
      failing('sub_f3', { status: 'past_due', lic: { key: 'GC-FAIL-STAL-AAAA-BBBB', status: 'active', expires_at: iso(T - 60 * DAY) } }),
      // Stripe done retrying (unpaid), its period rolled on an hour ago: the licence ended weeks ago.
      failing('sub_f4', { status: 'unpaid', lic: { key: 'GC-FAIL-UNPD-AAAA-BBBB', status: 'payment_failed', expires_at: iso(T - 20 * DAY) } }),
    ] });
    const r = await sync('?apply=1');
    // As an app that knows the grace asks (8.3.2 and later, license.js knowsGrace).
    const act = async (key) => (await quiet(() => callRouter(license, 'POST', '/activate',
      { headers: { 'X-Occlara-Version': '8.3.2' }, body: { key, device_id: 'dev', device_name: 'PC' } }))).body;
    const m = await act('GC-FAIL-MNTH-AAAA-BBBB');
    const y = await act('GC-FAIL-YEAR-AAAA-BBBB');
    ok(r.status === 200 && m.valid === true && same(m.expiresAt, iso(hourAgo + 2 * DAY)) && y.valid === true && same(y.expiresAt, iso(hourAgo + 2 * DAY)),
      `a licence in its payment grace keeps that grace through the repair, the paid period's end plus two days, never the unpaid period's end (monthly ${m.expiresAt}, yearly ${y.expiresAt})`);
    const s3 = await act('GC-FAIL-STAL-AAAA-BBBB');
    ok(row('lic_sub_f3').status === 'payment_failed' && s3.valid === true && same(s3.expiresAt, iso(hourAgo + 2 * DAY)),
      `one whose renewals never reached it is given the same grace, and no more (${row('lic_sub_f3').status} ${s3.expiresAt})`);
    const u = await act('GC-FAIL-UNPD-AAAA-BBBB');
    ok(u.valid === false && u.status === 'expired' && same(row('lic_sub_f4').expires_at, iso(T - 20 * DAY)),
      `one Stripe has stopped retrying (unpaid) is never brought back by its period rolling on (${u.status} ${row('lic_sub_f4').expires_at})`);
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' billing route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
