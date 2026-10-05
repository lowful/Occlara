'use strict';

/**
 * The account routes act on the signed in user, and only on them.
 *
 * THE HOLE. /api/account/dashboard, /api/account/portal, /api/payments/cancel
 * and /api/license/deactivate took a userId from the caller and acted on it:
 * read that account's licence key, open its Stripe billing portal, cancel its
 * subscription, clear its device lock. Nothing checked the caller was that
 * user, and a Supabase user id is an identifier, not a secret.
 *
 * Now each one needs `Authorization: Bearer <Supabase access token>`, acts on
 * the user Supabase says the token belongs to, and refuses a userId that names
 * anyone else. An outage of Supabase's auth is a 503, never a 401.
 *
 * Also here: /cancel for a repeat buyer. The webhook writes one licence row
 * per purchase and /cancel used .single(), which fails on two rows, so a
 * monthly subscriber who also bought lifetime could not stop the monthly.
 *
 * The real handlers run against a fake Supabase and a fake Stripe. Nothing
 * touches a network.
 *
 * Run: npm run test:accountauth
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── Two users, their tokens, and Supabase's auth answers ────────────────────
const ALICE = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'alice@example.test' };
const BOB = { id: 'bbbbbbbb-2222-4222-8222-222222222222', email: 'bob@example.test' };
const TOKENS = { 'token-alice': ALICE, 'token-bob': BOB };
const auth = { mode: 'ok' };   // 'ok' | 'down' | 'broken' | 'throttled' | 'hung'

const authError = (message, name, status) => Object.assign(new Error(message), { name, status, __isAuthError: true });
async function getUser(token) {
  if (auth.mode === 'down') return { data: { user: null }, error: authError('fetch failed', 'AuthRetryableFetchError', 0) };
  if (auth.mode === 'broken') return { data: { user: null }, error: authError('internal', 'AuthApiError', 500) };
  if (auth.mode === 'throttled') return { data: { user: null }, error: authError('rate limited', 'AuthApiError', 429) };
  // What a real supabase-js getUser does against a server that accepts the
  // connection and never answers: nothing, for as long as undici allows.
  if (auth.mode === 'hung') return new Promise(() => {});
  const user = TOKENS[token];
  return user ? { data: { user }, error: null }
    : { data: { user: null }, error: authError('invalid JWT', 'AuthApiError', 403) };
}

// ── A fake Supabase with real filtering, ordering and updates ───────────────
const OUTAGE = { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
const db = { rows: [], outage: false, updates: [] };
function query() {
  const q = { filters: [], order: null, limit: null, patch: null };
  const match = () => {
    let out = db.rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
    if (q.order) {
      const { col, asc } = q.order;
      out = out.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    return q.limit == null ? out : out.slice(0, q.limit);
  };
  const api = {
    select: () => api,
    update: (p) => { q.patch = p; return api; },
    eq: (c, v) => { q.filters.push([c, v]); return api; },
    order: (col, o) => { q.order = { col, asc: !(o && o.ascending === false) }; return api; },
    limit: (n) => { q.limit = n; return api; },
    abortSignal: () => api,
    single: async () => {
      if (db.outage) return OUTAGE;
      const m = match();
      return m.length === 1 ? { data: m[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    },
    then: (res, rej) => {
      if (db.outage) return Promise.resolve(OUTAGE).then(res, rej);
      const hit = match();
      if (q.patch) {
        for (const r of hit) Object.assign(r, q.patch);
        db.updates.push({ patch: q.patch, ids: hit.map((r) => r.id) });
      }
      return Promise.resolve({ data: hit, error: null }).then(res, rej);
    },
  };
  return api;
}
const fakeSupabase = { from: () => query(), auth: { getUser } };

// ── A fake Stripe that records what it was asked to do ──────────────────────
const stripeCalls = [];
const PERIOD_END = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);
const fakeStripe = {
  subscriptions: {
    update: async (id, patch) => { stripeCalls.push({ op: 'update', id, patch }); return { id, current_period_end: PERIOD_END }; },
    retrieve: async (id) => ({ id, status: 'active', cancel_at_period_end: false, current_period_end: PERIOD_END }),
  },
  billingPortal: {
    sessions: { create: async (o) => { stripeCalls.push({ op: 'portal', customer: o.customer }); return { url: `https://billing.test/${o.customer}` }; } },
  },
  checkout: { sessions: { create: async () => ({ url: 'x', id: 'cs' }), retrieve: async () => ({}) } },
};

const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return fakeSupabase;
  if (request === 'stripe') return () => fakeStripe;
  return realLoad(request, parent, isMain);
};

const SERVER = path.join(__dirname, '..', 'server');
const { verifyCaller, bearerOf } = require(path.join(SERVER, 'services', 'account-auth.js'));
const accountRouter = require(path.join(SERVER, 'routes', 'account.js'));
const paymentsRouter = require(path.join(SERVER, 'routes', 'payments.js'));
const licenseRouter = require(path.join(SERVER, 'routes', 'license.js'));

function call(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const [, qs] = url.split('?');
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 5000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const req = {
      method, url, originalUrl: url, body,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      query: Object.fromEntries(new URLSearchParams(qs || '')),
    };
    const res = {
      statusCode: 200, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader() {}, set() { return this; }, type() { return this; },
      json(b) { this.headersSent = true; done({ status: this.statusCode, body: b }); return this; },
      send(b) { this.headersSent = true; done({ status: this.statusCode, body: b }); return this; },
      end() { this.headersSent = true; done({ status: this.statusCode, body: null }); return this; },
    };
    router(req, res, (err) => (err ? reject(err) : done({ status: 404, body: null })));
  });
}
// Lowercase, as Node hands every incoming header to a route.
const as = (token) => ({ authorization: `Bearer ${token}` });

const lic = (over) => ({
  id: 'lic', user_id: ALICE.id, license_key: 'GC-AAAA-AAAA-AAAA-AAAA', plan: 'monthly', status: 'active',
  expires_at: '2026-10-20T00:00:00.000Z', created_at: '2026-09-01T00:00:00.000Z',
  stripe_customer_id: null, stripe_subscription_id: null, device_id: 'dev', device_name: 'PC',
  deactivation_count: 0, last_deactivation_date: null, ...over,
});
const reset = (rows) => { db.rows = rows.map((r) => ({ ...r })); db.updates = []; db.outage = false; stripeCalls.length = 0; auth.mode = 'ok'; };

(async () => {
  // ── The check itself ──────────────────────────────────────────────────────
  ok(bearerOf({ headers: { authorization: 'Bearer abc.def' } }) === 'abc.def', 'the bearer token is read from the header');
  ok(bearerOf({ headers: {} }) === null && bearerOf({ headers: { authorization: 'Basic abc' } }) === null,
    'and nothing else counts as one');
  {
    const r = await verifyCaller(fakeSupabase, { headers: {}, body: { userId: ALICE.id } });
    ok(r.status === 401 && r.body.error === 'sign-in-required', 'a userId with no token is refused, 401');
  }
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('forged'), body: {} });
    ok(r.status === 401 && r.body.error === 'session-invalid', 'a token Supabase does not accept is 401');
  }
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('token-bob'), body: { userId: ALICE.id } });
    ok(r.status === 403 && r.body.error === 'user-mismatch', "a good token naming someone else's userId is 403");
  }
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('token-bob'), query: { userId: ALICE.id }, body: {} });
    ok(r.status === 403, 'and so is one naming them in the query string');
  }
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('token-alice'), body: { userId: ALICE.id } });
    ok(r.user && r.user.id === ALICE.id && r.user.email === ALICE.email, 'a token for the named user passes');
  }
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('token-alice'), body: {} });
    ok(r.user && r.user.id === ALICE.id, 'and needs no userId at all');
  }
  auth.mode = 'down';
  {
    const r = await verifyCaller(fakeSupabase, { headers: as('token-alice'), body: {} });
    ok(r.status === 503 && r.body.retry === true, 'Supabase auth unreachable is 503 with retry, not "signed out"');
  }
  auth.mode = 'broken';
  ok((await verifyCaller(fakeSupabase, { headers: as('token-alice'), body: {} })).status === 503,
    'and so is Supabase auth failing with a 5xx');
  auth.mode = 'throttled';
  ok((await verifyCaller(fakeSupabase, { headers: as('token-alice'), body: {} })).status === 503,
    'and Supabase throttling this server (429), which says nothing about the session');
  auth.mode = 'hung';
  {
    // Raced against a watchdog of our own: without the deadline this await
    // never settles, and a pending promise alone does not keep Node running,
    // so the test would exit 0 having printed nothing at all.
    const t0 = Date.now();
    let watchdog = null;
    const r = await Promise.race([
      verifyCaller(fakeSupabase, { headers: as('token-alice'), body: {} }, { timeoutMs: 60 }),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve({ status: 'no answer after 2s', body: {} }), 2000); }),
    ]);
    clearTimeout(watchdog);
    ok(r.status === 503 && r.body.retry === true && Date.now() - t0 < 1000,
      `Supabase auth that never answers is a 503 at the deadline, not a request held open (${r.status}, ${Date.now() - t0}ms)`);
  }
  auth.mode = 'ok';

  // ── /api/account/dashboard ────────────────────────────────────────────────
  reset([lic({ id: 'a1' }), lic({ id: 'b1', user_id: BOB.id, license_key: 'GC-BBBB-BBBB-BBBB-BBBB' })]);
  {
    const r = await call(accountRouter, 'GET', `/dashboard?userId=${ALICE.id}`);
    ok(r.status === 401, `the dashboard with only a userId is refused (${r.status})`);
  }
  {
    const r = await call(accountRouter, 'GET', `/dashboard?userId=${ALICE.id}`, { headers: as('token-bob') });
    ok(r.status === 403 && !JSON.stringify(r.body).includes('GC-AAAA'), "Bob cannot read Alice's licence key");
  }
  {
    const r = await call(accountRouter, 'GET', '/dashboard', { headers: as('token-alice') });
    ok(r.status === 200 && r.body.license && r.body.license.key === 'GC-AAAA-AAAA-AAAA-AAAA',
      'Alice reads her own, with no userId needed');
  }
  db.outage = true;
  {
    const r = await call(accountRouter, 'GET', '/dashboard', { headers: as('token-alice') });
    ok(r.status === 503 && r.body.retry === true, `a database outage is 503, not "no licence" (${r.status})`);
  }

  // ── /api/license/deactivate ───────────────────────────────────────────────
  reset([lic({ id: 'a1' }), lic({ id: 'b1', user_id: BOB.id, license_key: 'GC-BBBB-BBBB-BBBB-BBBB' })]);
  {
    const r = await call(licenseRouter, 'POST', '/deactivate', { body: { userId: ALICE.id } });
    ok(r.status === 401 && db.rows[0].device_id === 'dev', "nobody clears Alice's device lock with her id alone");
  }
  {
    const r = await call(licenseRouter, 'POST', '/deactivate', { headers: as('token-bob'), body: { userId: ALICE.id } });
    ok(r.status === 403 && db.rows[0].device_id === 'dev', 'nor with their own token and her id');
  }
  {
    const r = await call(licenseRouter, 'POST', '/deactivate', { headers: as('token-alice'), body: { userId: ALICE.id } });
    ok(r.status === 200 && db.rows[0].device_id === null && db.rows[1].device_id === 'dev',
      'Alice clears her own, and only hers');
  }

  // ── /api/payments/cancel ──────────────────────────────────────────────────
  // A monthly subscriber who later bought lifetime: two rows, lifetime newest.
  const MONTHLY = lic({ id: 'm1', plan: 'monthly', stripe_customer_id: 'cus_m', stripe_subscription_id: 'sub_m',
    created_at: '2026-08-01T00:00:00.000Z' });
  const LIFETIME = lic({ id: 'l1', plan: 'lifetime', expires_at: null, stripe_customer_id: null,
    stripe_subscription_id: null, license_key: 'GC-LLLL-LLLL-LLLL-LLLL', created_at: '2026-09-15T00:00:00.000Z' });
  reset([MONTHLY, LIFETIME]);
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { body: { userId: ALICE.id } });
    ok(r.status === 401 && stripeCalls.length === 0, 'a cancel with only a userId is refused and Stripe is never called');
  }
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-bob'), body: { userId: ALICE.id, email: ALICE.email } });
    ok(r.status === 403 && stripeCalls.length === 0, "Bob cannot cancel Alice's subscription");
  }
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: { userId: ALICE.id, email: ALICE.email } });
    ok(r.status === 200 && r.body.success === true && r.body.cancelled === true,
      `a repeat buyer can cancel (${r.status} ${JSON.stringify(r.body)})`);
    ok(stripeCalls.length === 1 && stripeCalls[0].id === 'sub_m' && stripeCalls[0].patch.cancel_at_period_end === true,
      'and it is the subscription that is still charging that gets cancelled');
    const m = db.rows.find((x) => x.id === 'm1');
    const l = db.rows.find((x) => x.id === 'l1');
    ok(m.expires_at === new Date(PERIOD_END * 1000).toISOString() && m.status === 'active',
      'the monthly keeps access to the end of the paid period');
    ok(l.expires_at === null && l.status === 'active', 'and the lifetime licence is not touched');
  }
  reset([LIFETIME]);
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: { userId: ALICE.id } });
    ok(r.status === 400 && r.body.cancelled === false && r.body.reason === 'no-subscription' && r.body.plan === 'lifetime',
      `a lifetime licence keeps the 400 it always got, never a 200 a page could read as "cancelled" (${r.status})`);
    ok(/nothing to cancel/.test(r.body.error || '') && r.body.success === false,
      'with the reason as a sentence in error, the field a page prints');
    ok(stripeCalls.length === 0 && db.updates.length === 0 && db.rows[0].status === 'active',
      'and nothing is written: it used to set a row with no subscription to cancelled on the spot');
  }
  reset([lic({ id: 'g1', plan: 'monthly', stripe_subscription_id: null })]);
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: {} });
    ok(r.status === 400 && /no active subscription/.test(r.body.error || '') && db.updates.length === 0
      && db.rows[0].status === 'active',
      `a licence with no subscription behind it is a 400 too, and keeps its access (${r.status})`);
  }
  reset([lic({ id: 'p1', status: 'payment_failed', stripe_customer_id: 'cus_p', stripe_subscription_id: 'sub_p' })]);
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: {} });
    ok(r.status === 200 && stripeCalls[0] && stripeCalls[0].id === 'sub_p',
      'a subscription whose card is failing can still be stopped');
  }
  reset([]);
  ok((await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: {} })).status === 404,
    'no licence at all is still a 404');
  reset([MONTHLY]);
  db.outage = true;
  {
    const r = await call(paymentsRouter, 'POST', '/cancel', { headers: as('token-alice'), body: {} });
    ok(r.status === 503 && stripeCalls.length === 0, `a database outage is 503 and touches nothing (${r.status})`);
  }

  // ── /api/account/portal ───────────────────────────────────────────────────
  reset([MONTHLY, LIFETIME]);
  {
    const r = await call(accountRouter, 'POST', '/portal', { body: { userId: ALICE.id } });
    ok(r.status === 401 && stripeCalls.length === 0, 'no billing portal for a bare userId');
  }
  {
    const r = await call(accountRouter, 'POST', '/portal', { headers: as('token-alice'), body: { userId: ALICE.id } });
    ok(r.status === 200 && stripeCalls[0] && stripeCalls[0].customer === 'cus_m',
      `the portal opens on the newest licence that HAS a Stripe customer, not the lifetime (${r.status})`);
  }
  reset([LIFETIME]);
  ok((await call(accountRouter, 'POST', '/portal', { headers: as('token-alice'), body: {} })).status === 400,
    'and says so when no licence has one');
  // If a one time purchase ever does get a customer of its own, it is not the
  // one the subscription bills, and its portal has nothing to cancel.
  reset([MONTHLY, { ...LIFETIME, stripe_customer_id: 'cus_l' }]);
  {
    const r = await call(accountRouter, 'POST', '/portal', { headers: as('token-alice'), body: {} });
    ok(r.status === 200 && stripeCalls[0] && stripeCalls[0].customer === 'cus_m',
      `the customer behind the subscription wins over a newer one time customer (${stripeCalls[0] && stripeCalls[0].customer})`);
  }

  // ── the dashboard tells the site the portal can open ─────────────────────
  reset([MONTHLY, LIFETIME]);
  {
    const r = await call(accountRouter, 'GET', '/dashboard', { headers: as('token-alice') });
    ok(r.status === 200 && r.body.license && r.body.license.plan === 'lifetime',
      'a repeat buyer is still shown the newest licence');
    ok(r.body.stripe && r.body.stripe.can_manage_subscription === true,
      'and can_manage_subscription is true, because the older monthly has a customer the portal opens on');
  }
  reset([LIFETIME]);
  {
    const r = await call(accountRouter, 'GET', '/dashboard', { headers: as('token-alice') });
    ok(r.status === 200 && r.body.stripe.can_manage_subscription === false,
      'a lifetime only account has nothing to manage');
  }
  reset([]);
  {
    const r = await call(accountRouter, 'GET', '/dashboard', { headers: as('token-alice') });
    ok(r.status === 200 && r.body.license === null && r.body.stripe.can_manage_subscription === false,
      'and an account with no licence is an empty dashboard, not an error');
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' account auth checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
