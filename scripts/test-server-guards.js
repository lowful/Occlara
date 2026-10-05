'use strict';

/**
 * The server's own guard rails: the admin password, the admin limiter, who may
 * pick a bench model, which errors are the client's, and the live view's
 * bookkeeping.
 *
 *   ADMIN. Every admin route took unlimited guesses, accepted the password in
 *   the query string and compared it with !==. Now: the header only, compared
 *   in constant time, failures limited to ten an hour per IP.
 *
 *   BENCH MODEL. Any licence could send benchModel and run every read on a
 *   model nine times the price. Now only beside the admin password.
 *
 *   CLIENT ERRORS. A malformed or aborted body and a refused origin were all
 *   answered 500 and filed under Recent errors on the admin page. Now 400, and
 *   kept out of it.
 *
 *   LIVE VIEW. The account cache grew forever and marked everyone past the
 *   first hundred as nobody; any 8 character header became a person; and the
 *   route list evicted its busiest route first.
 *
 * Real modules throughout, against a fake Supabase. Nothing touches a network.
 *
 * Run: npm run test:serverguards
 */

const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
delete process.env.ADMIN_PASSWORD;

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── A fake Supabase for the admin account lookups ───────────────────────────
const sb = { inCalls: [], lookups: 0, inFlight: 0, maxInFlight: 0, fail: false };
const fakeSupabase = {
  from: () => {
    const api = {
      select: () => api, eq: () => api, abortSignal: () => api,
      single: async () => ({ data: { status: 'active', expires_at: null }, error: null }),
      in: async (col, keys) => {
        sb.inCalls.push(keys.slice());
        if (sb.fail) return { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
        return { data: keys.map((k, i) => ({ license_key: k, plan: 'monthly', user_id: `user-${k}` })), error: null };
      },
    };
    return api;
  },
  auth: {
    admin: {
      getUserById: async (id) => {
        sb.lookups++;
        sb.inFlight++;
        sb.maxInFlight = Math.max(sb.maxInFlight, sb.inFlight);
        await new Promise((r) => setTimeout(r, 2));
        sb.inFlight--;
        return { data: { user: { id, email: `${id.slice(5, 9).toLowerCase()}@example.test` } }, error: null };
      },
    },
  },
};
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return fakeSupabase;
  return realLoad(request, parent, isMain);
};

const SERVER = path.join(__dirname, '..', 'server');
const { adminPasswordOk, isAdmin, makeAdminLimiter } = require(path.join(SERVER, 'services', 'admin-auth.js'));
const { errorHandler, corsRefusal } = require(path.join(SERVER, 'services', 'http-errors.js'));
const presenceMod = require(path.join(SERVER, 'services', 'presence.js'));
const { Presence, presence, hashOf } = presenceMod;
const adminRouter = require(path.join(SERVER, 'routes', 'admin.js'));
const coach = require(path.join(SERVER, 'routes', 'coach.js'));

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

/** One request through a real express-rate-limit instance. */
async function throughLimiter(limiter, { ip, status }) {
  const req = { ip, app: { get: () => 1 }, headers: {}, method: 'GET', url: '/api/admin/live' };
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200, headersSent: false, writableEnded: false,
    setHeader() {}, getHeader() {},
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; this.writableEnded = true; return this; },
  });
  let passed = false;
  await limiter(req, res, () => { passed = true; });
  if (passed) { res.statusCode = status; res.writableEnded = true; res.emit('finish'); }
  await new Promise((r) => setImmediate(r));
  return { passed, status: res.statusCode };
}

const PW = 'correct horse battery staple';

(async () => {
  // ── The password check ────────────────────────────────────────────────────
  ok(!adminPasswordOk(PW), 'with no ADMIN_PASSWORD configured, nothing is the admin password');
  process.env.ADMIN_PASSWORD = PW;
  ok(adminPasswordOk(PW), 'the right password passes');
  ok(!adminPasswordOk('correct horse battery stapl') && !adminPasswordOk(PW + 'x') && !adminPasswordOk(''),
    'a prefix, a longer string and an empty one do not (and unequal lengths do not throw)');
  ok(!adminPasswordOk(undefined) && !adminPasswordOk(['x']), 'nor anything that is not a string');
  ok(isAdmin({ headers: { 'x-admin-password': PW } }), 'the header carries it');
  ok(!isAdmin({ headers: {}, query: { password: PW } }), 'the query string never does');

  // ── The limiter ───────────────────────────────────────────────────────────
  {
    const limiter = makeAdminLimiter();
    let through = 0;
    for (let i = 0; i < 10; i++) if ((await throughLimiter(limiter, { ip: '203.0.113.7', status: 401 })).passed) through++;
    const eleventh = await throughLimiter(limiter, { ip: '203.0.113.7', status: 200 });
    ok(through === 10 && !eleventh.passed && eleventh.status === 429,
      `ten wrong passwords an hour from one IP, then 429 (${through} through, then ${eleventh.status})`);
    const other = await throughLimiter(limiter, { ip: '198.51.100.9', status: 401 });
    ok(other.passed, 'counted per IP: another address is not locked out by it');
    let polls = 0;
    for (let i = 0; i < 25; i++) if ((await throughLimiter(limiter, { ip: '192.0.2.1', status: 200 })).passed) polls++;
    ok(polls === 25, 'the live page polling with the right password is never counted (25 of 25 through)');
    let broken = 0;
    for (let i = 0; i < 15; i++) if ((await throughLimiter(limiter, { ip: '192.0.2.2', status: 500 })).passed) broken++;
    const after = await throughLimiter(limiter, { ip: '192.0.2.2', status: 200 });
    ok(broken === 15 && after.passed,
      `a /live failing with 5xx while the page polls is not a guess and locks nobody out (${broken} through, then ${after.status})`);
  }

  // ── The admin routes ──────────────────────────────────────────────────────
  {
    const r = await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': PW } });
    ok(r.status === 200 && r.body && r.body.now, `the live view opens with the header (${r.status})`);
  }
  {
    const r = await call(adminRouter, 'GET', `/live?password=${encodeURIComponent(PW)}`);
    ok(r.status === 401, `and not with the password in the query string (${r.status})`);
  }
  ok((await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': 'guess' } })).status === 401,
    'a wrong password is 401');
  ok((await call(adminRouter, 'GET', `/costs?password=${encodeURIComponent(PW)}`)).status === 401
    && (await call(adminRouter, 'GET', `/coaching?password=${encodeURIComponent(PW)}`)).status === 401,
    '/costs and /coaching refuse the query string too');
  {
    const KEY = 'GC-QWER-TYUI-OPAS-DFGH';
    coach.trackCall(KEY, 1);
    const r = await call(adminRouter, 'GET', '/costs', { headers: { 'X-Admin-Password': PW } });
    const text = JSON.stringify(r.body);
    ok(r.status === 200 && !text.includes('GC-QWER') && !text.includes('QWER'),
      'the cost view no longer prints the start of anyone\'s licence key');
    ok(r.body.topUsers.some((u) => u.user === hashOf(KEY)), 'it names each user by the same hash the live view uses');
  }
  delete process.env.ADMIN_PASSWORD;
  ok((await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': PW } })).status === 503,
    'with no ADMIN_PASSWORD set the live view says so');
  process.env.ADMIN_PASSWORD = PW;

  // ── benchModel ────────────────────────────────────────────────────────────
  {
    const { benchModel } = coach.__test;
    const dear = 'google/gemini-3.5-flash-lite';
    ok(benchModel({ body: { benchModel: dear }, headers: {} }) === null,
      'a licence alone cannot switch the read to a dearer model');
    ok(benchModel({ body: { benchModel: dear }, headers: { 'x-admin-password': 'guess' } }) === null,
      'nor with a wrong admin password');
    ok(benchModel({ body: { benchModel: dear }, headers: {}, query: { password: PW } }) === null,
      'nor with the password in the query string');
    ok(benchModel({ body: { benchModel: dear }, headers: { 'x-admin-password': PW } }) === dear,
      'a bench with the admin password gets its model');
    ok(benchModel({ body: { benchModel: 'some/unknown-model' }, headers: { 'x-admin-password': PW } }) === null,
      'and only one on the allowlist');
  }

  // ── Client errors are 4xx and stay out of Recent errors ──────────────────
  {
    const before = presence.errors.length;
    const res = () => {
      const r = { statusCode: 200, headersSent: false, body: null, statusCalls: 0 };
      r.status = (c) => { r.statusCode = c; r.statusCalls++; return r; };
      r.json = (b) => { r.body = b; r.headersSent = true; return r; };
      return r;
    };
    const parse = Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' });
    let r = res();
    errorHandler(parse, { originalUrl: '/api/coach/read' }, r, () => {});
    ok(r.statusCode === 400 && r.body.error === 'Malformed JSON body', `a malformed JSON body is 400 (${r.statusCode})`);
    const aborted = Object.assign(new Error('request aborted'), { status: 400, type: 'request.aborted' });
    r = res();
    errorHandler(aborted, { originalUrl: '/api/coach/read' }, r, () => {});
    ok(r.statusCode === 400, `an upload the client abandoned is 400 (${r.statusCode})`);
    r = res();
    errorHandler(corsRefusal(), { originalUrl: '/api/payments/cancel' }, r, () => {});
    ok(r.statusCode === 400 && r.body.error === 'Origin not allowed', `a refused origin is 400 (${r.statusCode})`);
    ok(presence.errors.length === before, 'and none of the three is recorded as a server error');
    r = res();
    errorHandler(Object.assign(new Error('too big'), { type: 'entity.too.large', status: 413 }), { originalUrl: '/x' }, r, () => {});
    ok(r.statusCode === 413, 'a body over the limit is still 413');
    r = res();
    errorHandler(new Error('the server broke'), { originalUrl: '/api/coach/read?x=1' }, r, () => {});
    ok(r.statusCode === 500 && presence.errors.length === before + 1, 'the server\'s own failure is still a 500 and recorded');
    ok(presence.errors[presence.errors.length - 1].where === '/api/coach/read', 'under its route, query string removed');
    r = res();
    r.headersSent = true;
    errorHandler(parse, { originalUrl: '/x' }, r, () => {});
    ok(r.statusCalls === 0, 'and nothing is written over a response already sent');
  }

  // ── presence: who counts as a person, and which route is evicted ─────────
  {
    const p = new Presence({ now: () => Date.parse('2026-10-04T18:00:00Z') });
    p.touch({ key: 'Bearer eyJhbGciOiJIUzI1NiJ9', path: '/api/coach/read' });
    p.touch({ key: 'not a licence key at all', path: '/api/license/activate' });
    p.touch({ key: { key: 'GC-AAAA-BBBB-CCCC-DDDD' }, path: '/api/coach/read' });
    ok(p.snapshot().users.length === 0, 'a junk header, a mistyped key or an object is not a person');
    p.touch({ key: 'gc-aaaa-bbbb-cccc-dddd', path: '/api/coach/read' });
    ok(p.snapshot().users.length === 1, 'a real licence key is, in any case');

    for (let i = 0; i < 200; i++) p.finish({ path: `/api/r${i}`, status: 200, ms: 5 });
    p.finish({ path: '/api/r0', status: 200, ms: 5 });   // the busiest route, used again
    p.finish({ path: '/api/new', status: 200, ms: 5 });
    ok(p.routes.size === 200 && p.routes.has('/api/r0') && !p.routes.has('/api/r1'),
      'at the cap the least recently used route goes, not the first one ever seen');
  }

  // ── the admin view's account lookups ─────────────────────────────────────
  {
    const { resolveWho, who } = adminRouter.__test;
    presence.users.clear();
    presence.keys.clear();
    who.clear();
    const keyN = (i) => `GC-${String(i).padStart(4, '0')}-AAAA-BBBB-CCCC`;
    for (let i = 0; i < 150; i++) presence.touch({ key: keyN(i), path: '/api/coach/read' });
    ok(presence.keys.size === 150, '150 people seen today');

    sb.inCalls.length = 0;
    const a = resolveWho();
    const b = resolveWho();
    ok(a === b, 'two page loads at once share one lookup');
    const first = await a;
    ok(sb.inCalls.length === 1 && sb.inCalls[0].length === 100, 'one query, for the first hundred keys');
    ok(Object.keys(first).length === 100 && Object.values(first).every((w) => w.email),
      `only the hundred asked about get an entry, each with an email (${Object.keys(first).length})`);
    ok(sb.maxInFlight > 1 && sb.maxInFlight <= 8, `account lookups run in parallel, at most eight at once (${sb.maxInFlight})`);
    const second = await resolveWho();
    ok(Object.keys(second).length === 150 && Object.values(second).every((w) => w.email),
      'the next refresh resolves the other fifty instead of skipping them forever');

    const gone = [...presence.keys.keys()].slice(0, 10);
    for (const h of gone) { presence.keys.delete(h); presence.users.delete(h); }
    const third = await resolveWho();
    ok(gone.every((h) => !(h in third)) && Object.keys(third).length === 140,
      'someone presence has forgotten is forgotten here too');

    sb.fail = true;
    presence.touch({ key: 'GC-ZZZZ-AAAA-BBBB-CCCC', path: '/api/coach/read' });
    const fourth = await resolveWho();
    ok(!(hashOf('GC-ZZZZ-AAAA-BBBB-CCCC') in fourth), 'a failed lookup writes nobody as unknown for ten minutes');
    sb.fail = false;
    const fifth = await resolveWho();
    ok(fifth[hashOf('GC-ZZZZ-AAAA-BBBB-CCCC')] && fifth[hashOf('GC-ZZZZ-AAAA-BBBB-CCCC')].email,
      'and the next refresh simply asks again');
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' server guard checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
