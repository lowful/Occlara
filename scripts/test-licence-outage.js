'use strict';

/**
 * A licence database that cannot be reached must never read as "no such key".
 *
 * THE BUG. supabase-js answers a network failure, a pooler timeout or a paused
 * project with { data: null, error }, the same shape as a missing row, and
 * every licence check read both as invalid. /activate answered 404 valid:false,
 * the desktop app took that as final, stored the licence as expired, stopped
 * the recording in progress mid match and told a paying player to renew. The
 * coach routes answered 403 the same way, which made the client re-check the
 * licence through that same failing lookup.
 *
 * The real route handlers run here against a fake Supabase, and the real
 * client licence service against a scripted server, so the whole contract is
 * exercised end to end: 503 with retry and no valid field from the server, and
 * a client that keeps its stored status through it. Nothing touches a network.
 *
 * Run: npm run test:licenceoutage
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

// ── A fake Supabase whose outage can be switched on ─────────────────────────
const OUTAGE = { data: null, error: { code: '', message: 'TypeError: fetch failed', details: '', hint: '' } };
const db = { rows: [], outage: false, queries: 0 };
function query() {
  const q = { filters: [], patch: null };
  const match = () => db.rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
  const api = {
    select: () => api,
    update: (p) => { q.patch = p; return api; },
    eq: (c, v) => { q.filters.push([c, v]); return api; },
    order: () => api,
    limit: () => api,
    abortSignal: () => api,
    single: async () => {
      db.queries++;
      if (db.outage) return OUTAGE;
      const m = match();
      return m.length === 1 ? { data: m[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    },
    then: (res, rej) => {
      db.queries++;
      if (db.outage) return Promise.resolve(OUTAGE).then(res, rej);
      const hit = match();
      if (q.patch) for (const r of hit) Object.assign(r, q.patch);
      return Promise.resolve({ data: hit, error: null }).then(res, rej);
    },
  };
  return api;
}
const fakeSupabase = { from: () => query(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } };

// Every server module that asks for the database gets the fake.
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return fakeSupabase;
  return realLoad(request, parent, isMain);
};

const SERVER = path.join(__dirname, '..', 'server');
const licenseRouter = require(path.join(SERVER, 'routes', 'license.js'));
const coach = require(path.join(SERVER, 'routes', 'coach.js'));
const rivalsRouter = require(path.join(SERVER, 'routes', 'rivals.js'));
const { checkKey, validKeys, licenceDb, STALE_KEY_MS } = coach.__test;

/** Drive one request through a real Express router and resolve with its answer. */
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

const KEY = 'GC-AAAA-BBBB-CCCC-DDDD';
const ACTIVE = { id: 'lic_1', license_key: KEY, plan: 'monthly', status: 'active',
  expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), device_id: 'dev-1', device_name: 'PC' };

(async () => {
  // ── /api/license/activate and /validate ─────────────────────────────────
  db.rows = [{ ...ACTIVE }];
  db.outage = true;
  {
    const r = await call(licenseRouter, 'POST', '/activate', { body: { key: KEY, device_id: 'dev-1' } });
    ok(r.status === 503, `an unreachable database answers /activate 503, not 404 (${r.status})`);
    ok(r.body && !('valid' in r.body), 'and carries no valid field, which the client would take as final');
    ok(r.body && r.body.retry === true, 'and says to retry');
    ok(r.body.code === 'licence-check-unavailable' && /try again/i.test(r.body.error || ''),
      'with a code to branch on, and an error an installed client can print as it is');
  }
  {
    const r = await call(licenseRouter, 'POST', '/validate', { body: { key: KEY, device_id: 'dev-1' } });
    ok(r.status === 503 && !('valid' in r.body), `/validate answers an outage the same way (${r.status})`);
  }
  db.outage = false;
  {
    const r = await call(licenseRouter, 'POST', '/activate', { body: { key: 'GC-ZZZZ-ZZZZ-ZZZZ-ZZZZ', device_id: 'dev-1' } });
    ok(r.status === 404 && r.body.valid === false, `a key that really is not there is still 404 valid:false (${r.status})`);
  }
  {
    const r = await call(licenseRouter, 'POST', '/activate', { body: { key: KEY, device_id: 'dev-1' } });
    ok(r.status === 200 && r.body.valid === true, 'a good key on its own device still activates');
  }
  {
    db.rows = [{ ...ACTIVE, status: 'cancelled' }];
    const r = await call(licenseRouter, 'POST', '/activate', { body: { key: KEY, device_id: 'dev-1' } });
    ok(r.body.valid === false && r.body.status === 'cancelled', 'a cancelled licence is still refused, explicitly');
    db.rows = [{ ...ACTIVE }];
  }

  // ── coach.js checkKey: valid, invalid, unavailable ──────────────────────
  // licenceDb.downAt is set back to 0 wherever the test means "the database
  // has recovered and the fifteen second probe interval has passed".
  const recovered = () => { db.outage = false; licenceDb.downAt = 0; };
  validKeys.clear();
  db.outage = true;
  ok(await checkKey(KEY) === 'unavailable', 'a key never confirmed, during an outage, is unavailable rather than invalid');
  db.outage = false;
  {
    const before = db.queries;
    ok(await checkKey(KEY) === 'unavailable' && db.queries === before,
      'for fifteen seconds after a failure the database is not asked again, so a hung one cannot slow every read');
  }
  licenceDb.downAt = Date.now() - 16 * 1000;
  ok(await checkKey(KEY) === 'valid', 'after that one probe goes through, and the same key is valid once it answers');
  validKeys.set(KEY, Date.now() - 2 * 60 * 1000);   // past the one minute cache, inside the half hour
  db.outage = true;
  ok(await checkKey(KEY) === 'valid', 'confirmed two minutes ago, it is honoured through an outage (stale if error)');
  validKeys.set(KEY, Date.now() - STALE_KEY_MS - 1000);
  ok(await checkKey(KEY) === 'unavailable', 'confirmed over half an hour ago, an outage makes it unavailable');
  recovered();
  db.rows = [];
  validKeys.set(KEY, Date.now() - 2 * 60 * 1000);
  ok(await checkKey(KEY) === 'invalid', 'a key whose row is gone (PGRST116) is invalid');
  ok(!validKeys.has(KEY), 'and is forgotten, so it cannot ride the stale window');
  db.rows = [{ ...ACTIVE, expires_at: new Date(Date.now() - 1000).toISOString() }];
  ok(await checkKey(KEY) === 'invalid', 'an expired licence is invalid');
  ok(await checkKey('not-a-key') === 'invalid', 'a malformed key never reaches the database');

  // ── a coach route answers 503 during an outage, 403 for a bad key ───────
  validKeys.clear();
  db.rows = [{ ...ACTIVE }];
  db.outage = true;
  {
    const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'x' } });
    ok(r.status === 503 && r.body.error === 'licence-check-unavailable' && r.body.retry === true,
      `/read during an outage is 503 with retry, so the client never suspects the licence (${r.status})`);
  }
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m1&username=${encodeURIComponent('Me#EUW')}`,
      { headers: { 'X-License-Key': KEY } });
    ok(r.status === 503 && r.body.retry === true, `a route with the plain 403 body answers an outage 503 too (${r.status})`);
  }
  recovered();
  db.rows = [];
  {
    const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'x' } });
    ok(r.status === 403 && r.body.error === 'Invalid or expired license key', `a key with no row is still 403 (${r.status})`);
  }
  {
    const r = await call(coach, 'POST', '/read', { body: { image: 'x' } });
    ok(r.status === 400, `a request with no key at all is still 400 (${r.status})`);
  }

  // ── the Rivals routes share the answer ───────────────────────────────────
  validKeys.clear();
  db.rows = [{ ...ACTIVE }];
  db.outage = true;
  {
    const r = await call(rivalsRouter, 'POST', '/draft', { headers: { 'X-License-Key': KEY }, body: { image: 'x' } });
    ok(r.status === 503 && r.body.retry === true, `a Rivals read during an outage is 503 with retry (${r.status})`);
  }
  recovered();
  db.rows = [];
  {
    const r = await call(rivalsRouter, 'POST', '/draft', { headers: { 'X-License-Key': KEY }, body: { image: 'x' } });
    ok(r.status === 403, `and a Rivals read with a dead key is still 403 (${r.status})`);
  }

  // ── the client keeps its licence through a transient answer ─────────────
  const store = new Map();
  let answer = null;   // what the scripted server says next: { status, data } or an Error
  const fakeStore = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const fakeApi = {
    post: async () => {
      if (answer instanceof Error) throw answer;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, data: answer.data };
    },
  };
  Module._load = function patchedClient(request, parent, isMain) {
    if (request === './store') return fakeStore;
    if (request === './api-client') return fakeApi;
    if (request === '../db/supabase') return fakeSupabase;
    return realLoad(request, parent, isMain);
  };
  const licenseService = require(path.join(__dirname, '..', 'src', 'main', 'services', 'license-service.js'));
  const seed = (status = 'active') => {
    store.clear();
    store.set('licenseKey', KEY);
    store.set('licenseStatus', status);
    store.set('licensePlan', 'monthly');
    store.set('licenseExpiry', new Date(Date.now() + 7 * 864e5).toISOString());
    store.set('deviceId', licenseService.computeDeviceId());
  };

  seed();
  answer = { status: 503, data: { error: 'licence-check-unavailable', retry: true } };
  {
    const r = await licenseService.revalidate();
    ok(r.valid === true && r.transient === true, 'a 503 from the licence server keeps the licence valid');
    ok(store.get('licenseStatus') === 'active', 'and writes nothing over the stored status');
  }
  seed();
  answer = { status: 502, data: { valid: false, error: 'Bad gateway' } };
  {
    const r = await licenseService.revalidate();
    ok(r.valid === true && store.get('licenseStatus') === 'active',
      'a 5xx is transient even when its body says valid:false (a proxy in front of a dead process)');
  }
  seed();
  answer = { status: 429, data: { error: 'Too many activation attempts. Try again in 1 hour.' } };
  ok((await licenseService.revalidate()).valid === true && store.get('licenseStatus') === 'active',
    'a rate limited re-check keeps the licence');
  seed();
  answer = new Error('fetch failed');
  ok((await licenseService.revalidate()).valid === true && store.get('licenseStatus') === 'active',
    'an unreachable server keeps the licence');
  seed('cancelled');
  answer = { status: 503, data: { error: 'licence-check-unavailable', retry: true } };
  {
    const r = await licenseService.revalidate();
    ok(r.valid === false && store.get('licenseStatus') === 'cancelled',
      'and an outage does not revive a licence that had already ended');
  }
  seed();
  answer = { status: 404, data: { valid: false, error: 'License key not found' } };
  {
    const r = await licenseService.revalidate();
    ok(r.valid === false && store.get('licenseStatus') === 'expired',
      'an explicit 404 valid:false from a server that could check still ends it');
  }
  seed();
  answer = { status: 200, data: { valid: false, status: 'cancelled', error: 'License status: cancelled' } };
  {
    const r = await licenseService.revalidate();
    ok(r.valid === false && r.status === 'cancelled' && store.get('licenseStatus') === 'cancelled',
      'and so does a cancelled licence');
  }
  seed();
  answer = { status: 200, data: { valid: true, plan: 'monthly', status: 'active', expiresAt: store.get('licenseExpiry') } };
  ok((await licenseService.revalidate()).valid === true, 'a good answer is a good answer');

  // First activation through an outage.
  seed();
  answer = { status: 503, data: { error: 'licence-check-unavailable', retry: true } };
  {
    const r = await licenseService.activate(KEY);
    ok(r.valid === true, 'activating the cached key on its own device during an outage is allowed, as offline is');
  }
  store.clear();
  {
    const r = await licenseService.activate(KEY);
    ok(r.valid === false && r.ok === false && /try again/i.test(r.error || ''),
      `a new activation during an outage says to try again (${r.error})`);
    ok(!store.get('licenseKey'), 'and stores nothing');
    ok(!/licence-check-unavailable/.test(r.error || ''), 'and never shows the server code as the reason');
  }
  store.clear();
  answer = { status: 429, data: { error: 'Too many activation attempts. Try again in 1 hour.' } };
  {
    const r = await licenseService.activate(KEY);
    ok(r.valid === false && r.error === 'Too many activation attempts. Try again in 1 hour.',
      `the activation limiter's own sentence is shown, not "try again in a minute" (${r.error})`);
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' licence outage checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
