'use strict';

/**
 * THE RATE LIMITS (8.7.3, server/services/rate-limits.js, wired in server.js).
 *
 *   EACH LIMIT trips at its number with 429 { error: 'rate-limited',
 *   retryAfter } and a Retry-After header (a licence route's keeps a
 *   sentence in `error`, which the activation window prints), lets the next
 *   window through, and is keyed per account where the caller is verified:
 *   two accounts never share a bucket, one account on two addresses has one.
 *   THE ADDRESS cannot be dodged: behind Railway's one proxy (trust proxy 1)
 *   a client's own X-Forwarded-For entries and X-Real-IP are never read.
 *   MADE UP CREDENTIALS are stopped before their lookup after sixty refusals
 *   in ten minutes from one address; a valid caller and an outage are never
 *   counted.
 *   MEMORY is bounded: keys whose window passed are swept, and past maxKeys
 *   the oldest go.
 *   A REAL PLAYER NEVER MEETS ONE: the five recorded sessions played back to
 *   back, twice, with every call the app makes around them (me, the licence
 *   check, the reviews and looks, Riot's data, telemetry, a Riot record run,
 *   the Invite page), and a cafe of twenty players on one address, answer no
 *   429 at all.
 *
 * Nothing leaves the machine: the express app in the address checks listens
 * on 127.0.0.1 only.
 *
 * Run: npm run test:ratelimits
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

const SERVER = path.join(__dirname, '..', 'server');
const express = require(path.join(SERVER, 'node_modules', 'express'));
const limits = require(path.join(SERVER, 'services', 'rate-limits.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

let clock = Date.parse('2026-11-04T12:00:00.000Z');
const now = () => clock;

/** One request through one middleware: 'next', or the answer. */
function hit(mw, req) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      set(k, v) { headers[k.toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers }); return this; },
    };
    mw(req, res, () => resolve('next'));
  });
}
const reqOf = ({ account, ip = '198.51.100.1', path: p = '/', body = {}, headers = {} } = {}) => ({
  ip, originalUrl: p, path: p, body, headers,
  ...(account ? { caller: { accountKey: account } } : {}),
});

/** Whether app.use(p) would run for url: the same path, or one below it. */
const under = (p, url) => url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`);

(async () => {
  // ── The limiter itself ──────────────────────────────────────────────────
  {
    const mw = limits.createLimiter({ name: 't', windowMs: 60000, max: 3, now });
    const A = reqOf({ account: 'u:A' });
    const got = [];
    for (let i = 0; i < 4; i++) got.push(await hit(mw, A));
    const last = got[3];
    ok(got.slice(0, 3).every((g) => g === 'next') && last.status === 429 && last.body.error === 'rate-limited'
      && last.body.retryAfter === 60 && last.headers['retry-after'] === '60',
    `the fourth of three in a window is 429 rate-limited with retryAfter and Retry-After (${last.status}, ${last.headers['retry-after']})`);
    ok(await hit(mw, reqOf({ account: 'u:B' })) === 'next', 'another account has its own bucket');
    ok(await hit(mw, reqOf({ account: 'u:A', ip: '203.0.113.99' })) !== 'next', 'and one account on another address is the same bucket');
    clock += 30000;
    const mid = await hit(mw, A);
    ok(mid.status === 429 && mid.body.retryAfter === 30, `half way through, it says thirty seconds (${mid.body.retryAfter})`);
    clock += 30000;
    ok(await hit(mw, A) === 'next', 'and once the window has passed it lets the next one through');
    // Not verified: the address.
    const ipOnly = limits.createLimiter({ name: 'ip', windowMs: 60000, max: 1, now });
    await hit(ipOnly, reqOf({ ip: '192.0.2.5' }));
    ok((await hit(ipOnly, reqOf({ ip: '192.0.2.5', headers: { 'x-license-key': 'GC-MADE-UPXX-0000-0000' } }))).status === 429,
      'a caller not verified is keyed by its address, never by a key it typed');
    ok((await hit(ipOnly, reqOf({ ip: '2001:db8:1:2:aaaa::1' }))) === 'next'
      && (await hit(ipOnly, reqOf({ ip: '2001:db8:1:2:bbbb::9' }))).status === 429,
    'an IPv6 caller is keyed by its /64');
    // A limiter that throws lets the request through.
    const broken = limits.createLimiter({ name: 'broken', windowMs: 1000, max: 1, now, key: () => { throw new Error('boom'); } });
    const warn = console.warn; console.warn = () => {};
    ok(await hit(broken, reqOf()) === 'next', 'a limiter that fails lets the request through');
    console.warn = warn;
  }

  // ── Memory: every limiter forgets ──────────────────────────────────────
  {
    const mw = limits.createLimiter({ name: 'mem', windowMs: 60000, max: 5, now, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) await hit(mw, reqOf({ account: `u:${i}` }));
    ok(mw.hits.size <= 101, `a thousand accounts keep at most maxKeys keys (${mw.hits.size})`);
    clock += 61000;
    await hit(mw, reqOf({ account: 'u:late' }));
    ok(mw.hits.size === 1, `a window on, the old keys are swept (${mw.hits.size} left)`);
    const g = limits.createGuessGuard({ now, windowMs: 60000, max: 2, maxKeys: 50 });
    for (let i = 0; i < 500; i++) g.note(reqOf({ ip: `10.0.${i >> 8}.${i & 255}` }), 'invalid');
    g.blocked(reqOf());
    ok(g.misses.size <= 50, `the guess guard keeps at most its maxKeys addresses (${g.misses.size})`);
    // The per IP limiters of usage.js are bounded too, and now say when.
    const ip = usage.ipLimiter({ windowMs: 60000, max: 1, name: 'redeem' });
    await hit(ip, reqOf());
    const r = await hit(ip, reqOf());
    ok(r.status === 429 && r.body.error === 'rate-limited' && r.body.what === 'redeem' && r.body.retryAfter > 0 && Number(r.headers['retry-after']) > 0,
      `usage.js's per IP limiters (handoff, exchange, redeem) answer retryAfter and Retry-After too (${r.headers['retry-after']})`);
  }

  // ── Every route limit: trips at its number, resets, per account ────────
  const table = limits.routeLimits({ now, isAdmin: (req) => req.headers['x-admin-password'] === 'right' });
  for (const { paths, mw } of table) {
    const { name, windowMs, max } = mw.limits;
    const p = paths[0];
    const byAddress = ['licence', 'licence-network', 'dashboard', 'billing', 'public', 'anonymous', 'gift-peek'].includes(name);
    const base = { path: p, body: { key: 'GC-AAAA-BBBB-CCCC-DDDD' } };
    const one = (who) => (byAddress ? reqOf({ ...base, ip: who }) : reqOf({ ...base, account: who }));
    const me = byAddress ? '198.51.100.20' : 'u:me';
    const other = byAddress ? '198.51.100.21' : 'u:other';
    let through = 0;
    for (let i = 0; i < max; i++) if (await hit(mw, one(me)) === 'next') through++;
    const over = await hit(mw, one(me));
    const licence = name.startsWith('licence');
    const shape = licence
      ? over.body && over.body.code === 'rate-limited' && /Try again/.test(over.body.error) && over.body.retry === true
      : over.body && over.body.error === 'rate-limited' && over.body.what === name;
    ok(through === max && over.status === 429 && shape && Number(over.headers['retry-after']) > 0 && over.body.retryAfter > 0,
      `${name} (${paths.join(', ')}): ${max} in ${windowMs / 60000} min pass, the next is 429 with Retry-After ${over.headers['retry-after']}`);
    ok(await hit(mw, one(other)) === 'next', `${name}: ${byAddress ? 'another address' : 'another account'} is not in that bucket`);
    clock += windowMs;
    ok(await hit(mw, one(me)) === 'next', `${name}: and the window after it lets the caller through again`);
  }
  {
    const review = table.find((t) => t.mw.limits.name === 'review').mw;
    for (let i = 0; i < 200; i++) await hit(review, reqOf({ account: 'u:bench', headers: { 'x-admin-password': 'right' } }));
    const wrong = [];
    for (let i = 0; i < 61; i++) wrong.push(await hit(review, reqOf({ account: 'u:guess', headers: { 'x-admin-password': 'wrong' } })));
    ok(await hit(review, reqOf({ account: 'u:bench' })) === 'next' && wrong[60].status === 429,
      'a bench with the right admin password is never counted on the review and look limits, a wrong one is');
    // The agent look (8.11.0): an hourly limit per account like the review's
    // and the look's, where only the coach routes' 90 a minute held it.
    const agent = table.find((t) => t.mw.limits.name === 'agent-look');
    ok(agent && agent.paths.length === 1 && agent.paths[0] === '/api/coach/detect-agent'
      && agent.mw.limits.max === 60 && agent.mw.limits.windowMs === 60 * 60 * 1000,
    `the agent look is limited to 60 an hour per account (${agent && `${agent.mw.limits.max} in ${agent.mw.limits.windowMs / 60000} min`})`);
    const agentWhen = [];
    for (let i = 0; i < 61; i++) agentWhen.push(await hit(agent.mw, reqOf({ path: '/api/coach/detect-agent', account: 'u:agent' })));
    for (let i = 0; i < 100; i++) await hit(agent.mw, reqOf({ path: '/api/coach/detect-agent', account: 'u:agent-bench', headers: { 'x-admin-password': 'right' } }));
    ok(agentWhen.slice(0, 60).every((r) => r === 'next') && agentWhen[60].status === 429 && agentWhen[60].body.what === 'agent-look'
      && await hit(agent.mw, reqOf({ path: '/api/coach/detect-agent', account: 'u:agent-bench' })) === 'next',
    'its 61st in an hour is 429 agent-look, and a bench with the admin password is never counted');
    const anon = table.find((t) => t.mw.limits.name === 'anonymous').mw;
    const credentialed = [];
    for (let i = 0; i < 400; i++) credentialed.push(await hit(anon, reqOf({ ip: '198.51.100.30', headers: { authorization: 'Bearer occ_x' } })));
    let hook = 'next';
    for (let i = 0; i < 400; i++) hook = await hit(anon, reqOf({ ip: '198.51.100.31', path: '/api/payments/webhook' }));
    ok(credentialed.every((r) => r === 'next') && hook === 'next',
      'the anonymous ceiling skips a request with credentials and never counts the Stripe webhook');
  }

  // ── Made up credentials, before their lookup ───────────────────────────
  {
    const g = limits.createGuessGuard({ now });
    const R = reqOf({ ip: '203.0.113.50' });
    for (let i = 0; i < 59; i++) g.note(R, 'invalid');
    for (let i = 0; i < 500; i++) { g.note(R, 'valid'); g.note(R, 'unavailable'); }
    ok(g.blocked(R) === 0, 'fifty nine refused credentials, and any number of valid ones or outages, block nothing');
    g.note(R, 'invalid');
    const wait = g.blocked(R);
    ok(wait > 0 && g.blocked(reqOf({ ip: '203.0.113.51' })) === 0, `the sixtieth blocks that address for the rest of its window (${wait} s), and no other`);
    clock += g.limits.windowMs;
    ok(g.blocked(R) === 0, 'and the next window is open again');
  }

  // ── The wiring in server.js ────────────────────────────────────────────
  {
    const src = fs.readFileSync(path.join(SERVER, 'server.js'), 'utf8');
    const hookAt = src.indexOf("app.post('/api/payments/webhook'");
    const firstLimit = src.indexOf('app.use(');
    const mounted = src.indexOf('rateLimits.routeLimits(');
    const routesAt = src.indexOf("app.use('/api/payments', paymentRoutes)");
    ok(/app\.set\('trust proxy', 1\)/.test(src), 'server.js trusts exactly one proxy, Railway\'s edge');
    ok(mounted > src.indexOf('app.use(IDENTIFIED, identifyFirst)') && mounted < routesAt && mounted > src.indexOf('express.json('),
      'the route limits are mounted after the caller is named and the body parsed, before every route');
    ok(hookAt > 0 && hookAt < src.indexOf('app.use(IDENTIFIED') && hookAt < mounted,
      'the Stripe webhook is mounted before any limiter, so we never rate limit it (Stripe retries, the signature verifies it)');
    ok(/guessGuard\.blocked\(req\)[\s\S]{0,400}callers\.identify\(req\)[\s\S]{0,80}guessGuard\.note\(req, r\.status\)/.test(src),
      'identifyFirst asks the guess guard before the lookup and tells it the answer after');
    ok(firstLimit > 0, 'server.js mounts its middleware with app.use');
  }

  // ── Behind Railway's proxy: X-Forwarded-For cannot be rotated ──────────
  {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    const seen = [];
    app.use((req, res, next) => { seen.push(req.ip); next(); });
    for (const { paths, mw } of limits.routeLimits({ now })) app.use(paths, mw);
    app.use((req, res) => res.json({ ok: true }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = server.address().port;
    const send = (p, headers) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, retry: res.headers['retry-after'], body: b }));
      });
      r.on('error', reject); r.end();
    });
    // Railway's edge appends the address it saw as the LAST entry; anything before it is the client's own.
    const statuses = [];
    for (let i = 0; i < 125; i++) {
      statuses.push((await send('/health', { 'X-Forwarded-For': `10.${i}.0.1, 172.16.${i}.9, 198.51.100.77`, 'X-Real-IP': `10.9.${i}.1` })).status);
    }
    ok(new Set(seen).size === 1 && seen[0] === '198.51.100.77',
      `every request is the edge's address whatever the client put in front of it (${[...new Set(seen)].join(', ')})`);
    ok(statuses.slice(0, 120).every((s) => s === 200) && statuses.slice(120).every((s) => s === 429),
      `so rotating X-Forwarded-For and X-Real-IP dodges nothing: the 121st in a minute is 429 (${statuses.filter((s) => s === 429).length} refused)`);
    const other = await send('/health', { 'X-Forwarded-For': '198.51.100.78' });
    ok(other.status === 200, 'a different real address is its own bucket');
    const last = await send('/health', { 'X-Forwarded-For': '1.2.3.4, 198.51.100.77' });
    ok(last.status === 429 && Number(last.retry) > 0, `the refusal carries Retry-After over HTTP (${last.retry})`);
    await new Promise((r) => server.close(r));
  }

  // ── On Railway: the address is X-Real-IP (measured 5 Nov 2026) ────────
  {
    const run = (env, headers, ip) => {
      const req = { headers, ip };
      Object.defineProperty(req, 'ip', { value: ip, configurable: true, writable: false });
      limits.realIpMiddleware(env)(req, {}, () => {});
      return req.ip;
    };
    const edge = '84.17.44.227';
    ok(run({ RAILWAY_ENVIRONMENT: 'production' }, { 'x-real-ip': '72.197.1.2' }, edge) === '72.197.1.2',
      'on Railway the player\'s own address (X-Real-IP, which Railway overwrites) replaces the edge node\'s');
    ok(run({}, { 'x-real-ip': '72.197.1.2' }, edge) === edge, 'off Railway a client\'s X-Real-IP is never trusted');
    ok(run({ RAILWAY_ENVIRONMENT: 'production' }, { 'x-real-ip': 'not an address' }, edge) === edge, 'a header that is not an address changes nothing');
    ok(/realIpMiddleware\(process\.env\)/.test(fs.readFileSync(path.join(SERVER, 'server.js'), 'utf8')), 'server.js installs it');
  }

  // ── A real player never meets one ──────────────────────────────────────
  {
    const routes = limits.routeLimits({ now });
    let refused = [];
    const send = async (url, who, extra = {}) => {
      for (const { paths, mw } of routes) {
        if (!paths.some((p) => under(p, url))) continue;
        const r = await hit(mw, reqOf({ path: url, account: who.account, ip: who.ip, body: { key: who.key },
          headers: who.key ? { 'x-license-key': who.key } : { authorization: 'Bearer occ_x' }, ...extra }));
        if (r !== 'next') { refused.push(`${url} ${mw.limits.name}`); return; }
      }
    };
    const SESSIONS = fs.readdirSync(path.join(__dirname, 'fixtures')).filter((f) => /^valorant-session-.*\.json$/.test(f)).sort();
    const sessions = SESSIONS.map((f) => require(path.join(__dirname, 'fixtures', f)));
    // The recorded read rate, the busiest minute of any session (thinned frames put back).
    let peak = 0;
    for (const s of sessions) {
      const per = new Map();
      for (const fr of s.frames) per.set(Math.floor(fr.t / 60), (per.get(Math.floor(fr.t / 60)) || 0) + 1);
      for (const [m, k] of per) peak = Math.max(peak, k + ((Array.isArray(s.thinned) && s.thinned[m]) || 0));
    }
    console.log(`note  the busiest minute of the recorded sessions read ${peak} frames; /read keeps its own limit of 150 a minute, unchanged`);
    ok(peak * 2 <= 150, `the read limit is untouched and above twice the busiest recorded minute (${peak})`);

    const RIOT = ['/api/coach/player-stats', '/api/coach/last-match', '/api/coach/recent-matches', '/api/coach/rank-history',
      '/api/coach/matches', '/api/coach/match-rounds', '/api/coach/match-deaths'];
    const player = { account: 'u:heavy', ip: '198.51.100.40', key: 'GC-HEAV-YPLA-YER0-0001' };
    clock += 3 * 60 * 60 * 1000;
    const start = clock;
    // Launch: the licence, me, the Invite page.
    await send('/api/license/activate', player);
    await send('/api/account/me', player);
    await send('/api/referral', player);
    let lastMe = clock;
    let lastLicence = clock;
    for (let lap = 0; lap < 2; lap++) {
      // A Riot record run (ten claims) and its take back of two, once a lap.
      for (let i = 0; i < 10; i++) await send('/api/usage/claim', player);
      for (let i = 0; i < 2; i++) await send('/api/usage/release', player);
      for (const s of sessions) {
        const t0 = clock;
        const end = t0 + (s.frames[s.frames.length - 1].t - s.frames[0].t) * 1000;
        // The match: me every minute (its cache), the licence every three, Start's own me.
        await send('/api/account/me', player);
        for (; clock < end; clock += 1000) {
          if (clock - lastMe >= 60000) { await send('/api/account/me', player); lastMe = clock; }
          if (clock - lastLicence >= 180000) { await send('/api/license/activate', player); lastLicence = clock; }
        }
        // Its end: two reviews, two looks, telemetry, me forced twice, Riot's data, the Stats page.
        for (let i = 0; i < 2; i++) { await send('/api/coach/match-review', player); await send('/api/coach/death-forensics', player); }
        await send('/api/coach/session-report', player);
        await send('/api/account/me', player); await send('/api/account/me', player);
        for (const r of RIOT) { await send(r, player); await send(r, player); }
        // A two minute queue before the next.
        clock += 120000;
      }
      await send('/api/referral', player);
    }
    ok(!refused.length, `the five recorded sessions back to back, twice (${Math.round((clock - start) / 60000)} min), with every call the app makes around them, meet no limit${refused.length ? ': ' + refused.slice(0, 5).join('; ') : ''}`);

    // A cafe: twenty players behind one address, each with their own key and account.
    refused = [];
    for (let min = 0; min < 30; min++) {
      for (let p = 0; p < 20; p++) {
        const who = { account: `u:cafe${p}`, ip: '198.51.100.60', key: `GC-CAFE-0000-0000-${String(p).padStart(4, '0')}` };
        await send('/api/account/me', who);
        if (min % 3 === p % 3) await send('/api/license/activate', who);
      }
      clock += 60000;
    }
    ok(!refused.length, `twenty players on one address for half an hour meet no limit${refused.length ? ': ' + refused.slice(0, 3).join('; ') : ''}`);
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' rate limit checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
