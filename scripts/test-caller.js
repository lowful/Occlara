'use strict';

/**
 * WHO IS CALLING (8.7, server/services/caller.js).
 *
 * A caller is an app session (Bearer occ_...), a Supabase access token
 * (Bearer <JWT>, verified here with node's crypto against the JWKS) or a
 * licence key (the 8.6 checkKey path). Held here:
 *
 *   THE JWT. ES256 against the JWKS, the JWKS fetched once and cached ten
 *   minutes, a new kid fetched again; the issuer, the audience, exp, nbf, the
 *   alg, the signature, an anonymous user and an unconfirmed email each
 *   refused; a JWKS that cannot be fetched is an outage (unavailable), never
 *   a refusal.
 *   THE SESSION. Looked up by its sha256 only, remembered a minute, last_seen
 *   written at most every five minutes, a revoked one refused, an outage
 *   unavailable and a session confirmed in the last half hour honoured.
 *   THE KEY. checkKey's answer, the licence's user as `u:<id>`, a key with no
 *   user keyed by itself as the ledgers always were, and whether it is legacy
 *   (uncapped until LEGACY_CAP_FROM): yes for a paid plan key with no app
 *   session, no for a free plan key or a user who signed in to the app.
 *   NOT LIVE. app_sessions missing (42P01, PGRST205) falls back to the key, so
 *   an 8.6 key works exactly as before the migration.
 *   ENFORCED. ENFORCE_CAPS unset or 0 never caps anyone.
 *
 * Also exports the in-memory Supabase stand in (makeDb) and the JWT helpers
 * the other 8.7 server tests share, since scripts/fixtures/fake-billing.js
 * did not yet carry the accounts tables when this was written.
 *
 * Run: npm run test:caller
 */

const path = require('path');
const crypto = require('crypto');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.OCCLARA_NO_METER_SWEEP = '1';

const SERVER = path.join(__dirname, '..', 'server');

// ─── The in-memory Supabase ─────────────────────────────────────────────────

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
let seq = 0;
const uuid = () => { seq++; return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`; };

const UNIQUE = {
  entitlements: [['user_id'], ['account_key']],
  app_sessions: [['token_hash']],
  auth_handoffs: [['code_hash']],
  referral_codes: [['user_id'], ['code']],
  referral_redemptions: [['invitee_id']],
  devices: [['device_hash']],
  game_usage: [['user_id', 'client_match_id']],
};

/**
 * A Supabase stand in: tables in memory, the query builder supabase-js has
 * (select, insert, update, eq, is, gt, gte, in, order, limit, maybeSingle,
 * single, count/head), the accounts SQL functions as the contract describes
 * them, auth.admin.getUserById, and switches for an outage and for the
 * migration not applied (a table missing: 42P01 or PGRST205; a function
 * missing: PGRST202).
 */
function makeDb({ now = () => Date.now() } = {}) {
  const db = {
    tables: { entitlements: [], game_usage: [], app_sessions: [], auth_handoffs: [], referral_codes: [],
      referral_redemptions: [], devices: [], licenses: [] },
    missing: new Set(), missingCode: '42P01', rpcMissing: false, outage: false,
    calls: [], rpcCalls: [], users: new Map(), now,
  };
  const iso = (ms) => new Date(ms).toISOString();

  function from(table) {
    const q = { op: 'select', filters: [], patch: null, rows: null, count: null, head: false, limit: null, order: null, wantSelect: false };
    const run = () => {
      db.calls.push({ table, op: q.op, patch: q.patch && clone(q.patch) });
      if (db.outage) return Promise.resolve({ data: null, error: { code: '', message: 'TypeError: fetch failed' } });
      if (db.missing.has(table)) {
        return Promise.resolve({ data: null, error: { code: db.missingCode, message: `relation "public.${table}" does not exist` } });
      }
      const t = db.tables[table] || (db.tables[table] = []);
      if (q.op === 'insert') {
        const added = [];
        for (const row of q.rows) {
          const r = { id: uuid(), ...clone(row) };
          for (const cols of UNIQUE[table] || []) {
            if (cols.some((c) => r[c] == null)) continue;
            if (t.some((x) => cols.every((c) => x[c] === r[c]))) {
              return Promise.resolve({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${cols.join(',')}` } });
            }
          }
          added.push(r);
        }
        t.push(...added);
        return Promise.resolve({ data: q.wantSelect ? clone(added) : null, error: null });
      }
      let hit = t.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === 'update') {
        for (const r of hit) Object.assign(r, clone(q.patch));
        return Promise.resolve({ data: q.wantSelect ? clone(hit) : null, error: null });
      }
      if (q.op === 'delete') {
        db.tables[table] = t.filter((r) => !hit.includes(r));
        return Promise.resolve({ data: q.wantSelect ? clone(hit) : null, error: null });
      }
      if (q.order) {
        const [c, asc] = q.order;
        hit = hit.slice().sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      const count = hit.length;
      if (q.limit != null) hit = hit.slice(0, q.limit);
      if (q.head) return Promise.resolve({ data: null, count, error: null });
      return Promise.resolve({ data: clone(hit), count: q.count ? count : null, error: null });
    };
    const val = (r, c) => (r[c] === undefined ? null : r[c]);
    const api = {
      select(cols, o = {}) {
        if (q.op === 'select') { q.count = o.count || null; q.head = !!o.head; } else q.wantSelect = true;
        return api;
      },
      insert(rows) { q.op = 'insert'; q.rows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(p) { q.op = 'update'; q.patch = p; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filters.push((r) => val(r, c) === v); return api; },
      is(c, v) { q.filters.push((r) => val(r, c) === v); return api; },
      gt(c, v) { q.filters.push((r) => val(r, c) != null && String(r[c]) > String(v)); return api; },
      gte(c, v) { q.filters.push((r) => val(r, c) != null && String(r[c]) >= String(v)); return api; },
      in(c, vs) { q.filters.push((r) => vs.includes(val(r, c))); return api; },
      order(c, o = {}) { q.order = [c, o.ascending !== false]; return api; },
      limit(n) { q.limit = n; return api; },
      abortSignal() { return api; },
      maybeSingle: () => run().then((r) => (r.error ? r : { data: (r.data || [])[0] || null, error: null })),
      single: () => run().then((r) => {
        if (r.error) return r;
        return (r.data || []).length === 1 ? { data: r.data[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      }),
      then: (res, rej) => run().then(res, rej),
    };
    return api;
  }

  // ── The SQL functions, as the contract has them ───────────────────────────
  const ent = (u) => db.tables.entitlements.find((e) => e.user_id === u);
  function periodStart(e) {
    const anchor = Date.parse(e.period_anchor || '') || Date.parse(e.created_at || '') || now();
    const d = new Date(anchor);
    const n = new Date(now());
    let months = (n.getUTCFullYear() - d.getUTCFullYear()) * 12 + (n.getUTCMonth() - d.getUTCMonth());
    const at = (m) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
    while (months > 0 && at(months) > now()) months--;
    return at(Math.max(0, months));
  }
  function leftOf(e) {
    const mine = db.tables.game_usage.filter((g) => g.user_id === e.user_id && (g.status === 'counted' || g.status === 'reserved')
      && g.source !== 'bonus' && g.source !== 'shadow');
    let allowance;
    if (e.tier === 'free') allowance = e.free_total - mine.length;
    else {
      const ps = iso(periodStart(e));
      allowance = e.cap_monthly - mine.filter((g) => g.period_start >= ps).length;
    }
    return { allowance: Math.max(0, allowance), bonus: e.bonus_pool };
  }
  // entitlement_settle_stale: a live row reserved past 3 hours and short of 120 reads is given back.
  function settleStale(user) {
    for (const g of db.tables.game_usage) {
      if (g.user_id !== user || g.kind !== 'live' || g.status !== 'reserved' || now() - Date.parse(g.created_at) < 3 * 3600e3) continue;
      if ((g.match_reads || 0) >= 120) Object.assign(g, { status: 'counted', reason: 'reads', settled_at: iso(now()) });
      else Object.assign(g, { status: 'refunded', reason: 'stale', settled_at: iso(now()) });
    }
  }
  const fns = {
    ensure_entitlement({ p_user }) {
      let e = ent(p_user);
      if (!e) {
        e = { user_id: p_user, tier: 'free', cap_monthly: 0, free_total: 3, bonus_pool: 0, bonus_earned: 0, source: 'free',
          stripe_subscription_id: null, period_anchor: iso(now()), status: 'active', renew_as: null,
          account_key: `GC-${crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-')}`.slice(0, 22),
          created_at: iso(now()), updated_at: iso(now()) };
        db.tables.entitlements.push(e);
      }
      return clone(e);
    },
    claim_game({ p_user, p_game, p_kind, p_client_match_id, p_device_hash, p_enforce }) {
      const e = ent(p_user);
      if (!e) return { granted: false, usage_id: null, left: 0, reason: 'no-entitlement' };
      settleStale(p_user);
      const rows = db.tables.game_usage;
      if (p_client_match_id) {
        const same = rows.find((g) => g.user_id === p_user && g.client_match_id === p_client_match_id);
        if (same) return { granted: same.status !== 'refunded', usage_id: same.id, left: leftOf(e).allowance, reason: 'same' };
      }
      if (p_kind === 'live' && !p_client_match_id) {
        const open = rows.find((g) => g.user_id === p_user && g.kind === 'live' && g.status === 'reserved'
          && now() - Date.parse(g.created_at) < 3 * 3600e3 && (g.device_hash || null) === (p_device_hash || null));
        if (open) return { granted: true, usage_id: open.id, left: leftOf(e).allowance, reason: 'open' };
      }
      const { allowance, bonus } = leftOf(e);
      let source = null;
      if (allowance > 0) source = e.tier === 'free' ? 'free' : 'allowance';
      else if (bonus > 0) { source = 'bonus'; e.bonus_pool--; }
      if (!source && p_enforce) return { granted: false, usage_id: null, left: 0, reason: 'cap' };
      const row = { id: uuid(), user_id: p_user, period_start: iso(e.tier === 'free' ? Date.parse(e.created_at) : periodStart(e)),
        game: p_game, kind: p_kind, client_match_id: p_client_match_id || null, device_hash: p_device_hash || null,
        status: 'reserved', source: source || 'shadow', over_cap: !source, reads: 0, match_reads: 0, reason: null,
        created_at: iso(now()), settled_at: null };
      rows.push(row);
      return { granted: true, usage_id: row.id, left: Math.max(0, leftOf(e).allowance), reason: source ? null : 'shadow' };
    },
    settle_game({ p_usage, p_outcome, p_reason }) {
      const g = db.tables.game_usage.find((x) => x.id === p_usage);
      if (!g || g.status !== 'reserved') return { ok: false };
      g.status = p_outcome; g.reason = p_reason; g.settled_at = iso(now());
      if (p_outcome === 'refunded' && g.source === 'bonus') { const e = ent(g.user_id); if (e) e.bonus_pool++; }
      return { ok: true };
    },
    account_state({ p_user }) {
      const e = ent(p_user);
      if (!e) return null;
      settleStale(p_user);
      const { allowance, bonus } = leftOf(e);
      const used = db.tables.game_usage.filter((g) => g.user_id === p_user && (g.status === 'counted' || g.status === 'reserved')).length;
      const inv = {};
      for (const r of db.tables.referral_redemptions.filter((x) => x.inviter_id === p_user)) inv[r.status] = (inv[r.status] || 0) + 1;
      return { tier: e.tier, used, left: allowance + bonus, period_end: null, free_total: e.free_total, bonus_pool: e.bonus_pool,
        invites: inv, account_key: e.account_key };
    },
  };
  async function rpc(name, args) {
    db.rpcCalls.push({ name, args: clone(args) });
    if (db.outage) return { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
    if (db.rpcMissing || !fns[name]) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    return { data: fns[name](args), error: null };
  }

  const auth = { admin: { getUserById: async (id) => {
    if (db.outage) return { data: null, error: { status: 0, message: 'fetch failed' } };
    const u = db.users.get(id);
    return u ? { data: { user: clone(u) }, error: null } : { data: { user: null }, error: { status: 404, message: 'User not found' } };
  } }, getUser: async () => ({ data: { user: null }, error: { status: 401, message: 'no' } }) };

  db.client = { from, rpc, auth };
  return db;
}

// ─── A JWKS and tokens signed by it ─────────────────────────────────────────

function makeIssuer({ kid = 'kid-1', iss = `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1` } = {}) {
  const keys = [];
  const add = (k) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: k, alg: 'ES256', use: 'sig' };
    keys.push({ kid: k, privateKey, jwk });
    return k;
  };
  add(kid);
  const fetches = { n: 0, fail: false };
  const fetch = async (url) => {
    fetches.n++;
    if (fetches.fail) throw new Error('fetch failed');
    if (!String(url).endsWith('/auth/v1/.well-known/jwks.json')) throw new Error(`unexpected fetch ${url}`);
    return { ok: true, status: 200, json: async () => ({ keys: keys.map((k) => k.jwk) }) };
  };
  const sign = (claims, { useKid = keys[0].kid, alg = 'ES256', headerKid, nowS = Math.floor(Date.now() / 1000) } = {}) => {
    const k = keys.find((x) => x.kid === useKid);
    const header = { alg, typ: 'JWT', kid: headerKid || useKid };
    const body = { iss, aud: 'authenticated', role: 'authenticated', exp: nowS + 3600, iat: nowS,
      email: 'player@example.com', user_metadata: { email_verified: true }, ...claims };
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${h}.${p}.${sig}`;
  };
  return { sign, fetch, fetches, add, keys, iss };
}

/** Drive one request through an Express router and resolve with its answer. */
function call(router, method, url, { headers = {}, body = {}, ip = '203.0.113.7' } = {}) {
  return new Promise((resolve, reject) => {
    const [pathPart, qs] = url.split('?');
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 8000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const req = {
      method, url, originalUrl: url, path: pathPart, body, ip,
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

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => `occ_${crypto.randomBytes(32).toString('base64url')}`;

module.exports = { makeDb, makeIssuer, call, USER_A, USER_B, sha, newToken, uuid };

// ─── The checks ─────────────────────────────────────────────────────────────

if (require.main === module) {
  let fails = 0;
  let checks = 0;
  const ok = (cond, what) => {
    checks++;
    if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
  };
  const callerMod = require(path.join(SERVER, 'services', 'caller.js'));
  const { createResolver, enforced, ipPrefix, ipBucket, ipPrefixHash, safeEqual, bearerOf, tierOfPlan,
    KEY_REGEX, SESSION_TOKEN } = callerMod;

  (async () => {
    // ── The patterns, each against a known positive and negative ──────────
    ok(KEY_REGEX.test('GC-AB12-CD34-EF56-GH78') && !KEY_REGEX.test('GC-AB12-CD34-EF56'), 'the licence key pattern matches a key and not a short one');
    const tok = newToken();
    ok(tok.length === 47 && SESSION_TOKEN.test(tok) && !SESSION_TOKEN.test('occ_short') && !SESSION_TOKEN.test(tok.slice(4)),
      'an app session token is occ_ and 43 base64url characters, and the pattern holds it to that');
    ok(bearerOf({ headers: { authorization: 'Bearer abc.def.ghi' } }) === 'abc.def.ghi' && bearerOf({ headers: { authorization: 'Basic x' } }) === null,
      'the bearer is read off Authorization');
    ok(ipPrefix('203.0.113.77') === 'v4:203.0.113' && ipPrefix('::ffff:203.0.113.9') === 'v4:203.0.113'
      && ipPrefix('2001:db8:abcd:12::1') === 'v6:2001:db8:abcd' && ipPrefix('') === null,
    'a network is an IPv4 /24 or an IPv6 /48, a mapped IPv4 read as IPv4');
    ok(ipPrefixHash('203.0.113.5') === ipPrefixHash('203.0.113.200') && ipPrefixHash('203.0.113.5') !== ipPrefixHash('203.0.114.5')
      && /^[0-9a-f]{64}$/.test(ipPrefixHash('203.0.113.5')), 'and is stored as a hash: one /24 is one hash, the next /24 another');
    ok(ipBucket('2001:db8:1:2:3:4:5:6') === ipBucket('2001:db8:1:2:9:9:9:9') && ipBucket('198.51.100.1') === 'ip:198.51.100.1',
      'a rate limit buckets an IPv6 caller by its /64 and an IPv4 one by its address');
    ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd') && !safeEqual('abc', null), 'safeEqual compares in constant time');
    ok(tierOfPlan('weekly') === 'pro' && tierOfPlan('monthly') === 'pro' && tierOfPlan('yearly') === 'max' && tierOfPlan('lifetime') === 'max'
      && tierOfPlan('free') === 'free', 'weekly and monthly are Pro, yearly and lifetime Max, free is free');

    // ── The JWT ─────────────────────────────────────────────────────────────
    const db = makeDb();
    const issuer = makeIssuer();
    let clock = Date.now();
    const owners = new Map();
    const keyAnswers = new Map();
    const r = createResolver({ supabase: db.client, fetch: issuer.fetch, now: () => clock,
      checkKey: async (k) => keyAnswers.get(k) || 'invalid', keyOwner: (k) => owners.get(k), env: process.env });
    const jwtReq = (t) => ({ headers: { authorization: `Bearer ${t}` } });
    const nowS = () => Math.floor(clock / 1000);
    // Confirmed is auth.users' word (email_confirmed_at), never the token's.
    db.users.set(USER_A, { id: USER_A, email: 'a@example.com', email_confirmed_at: new Date(clock).toISOString(), created_at: new Date(clock).toISOString() });

    const good = await r.identify(jwtReq(issuer.sign({ sub: USER_A }, { nowS: nowS() })));
    ok(good.status === 'valid' && good.caller.via === 'jwt' && good.caller.userId === USER_A && good.caller.accountKey === `u:${USER_A}`,
      `a Supabase access token signed by the JWKS is the user, keyed u:<id> (${good.status})`);
    await r.identify(jwtReq(issuer.sign({ sub: USER_A }, { nowS: nowS() })));
    ok(issuer.fetches.n === 1, `the JWKS is fetched once and cached (${issuer.fetches.n} fetches)`);
    const refused = async (claims, o, why) => {
      const x = await r.identify(jwtReq(issuer.sign({ sub: USER_A, ...claims }, { nowS: nowS(), ...o })));
      ok(x.status === 'invalid' && x.via === 'jwt', `refused: ${why} (${x.status})`);
    };
    await refused({ iss: 'https://evil.example/auth/v1' }, {}, 'another issuer');
    await refused({ aud: 'anon' }, {}, 'another audience');
    await refused({ exp: nowS() - 60 }, {}, 'an expired token');
    await refused({ nbf: nowS() + 600 }, {}, 'a token not valid yet (nbf)');
    await refused({ is_anonymous: true }, {}, 'an anonymous user');
    await refused({ role: 'service_role' }, {}, 'a role other than authenticated');
    await refused({ sub: 'not-a-uuid' }, {}, 'a sub that is not a uuid');
    await refused({}, { alg: 'HS256' }, 'an alg other than ES256');
    {
      const t = issuer.sign({ sub: USER_A }, { nowS: nowS() });
      const [h, p] = t.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: USER_B })).toString('base64url');
      const x = await r.identify(jwtReq(`${h}.${forged}.${t.split('.')[2]}`));
      ok(x.status === 'invalid', 'refused: a payload changed after signing');
    }
    // An unconfirmed email: the token does not say, and auth.users says no, then yes.
    db.users.set(USER_B, { id: USER_B, email: 'b@example.com', email_confirmed_at: null, created_at: new Date(clock).toISOString() });
    const unconfirmed = await r.identify(jwtReq(issuer.sign({ sub: USER_B, user_metadata: {} }, { nowS: nowS() })));
    ok(unconfirmed.status === 'invalid' && unconfirmed.body && unconfirmed.body.error === 'email-unconfirmed',
      'a token whose email is not confirmed is refused, auth.users asked when the token does not say');
    r._caches.users.clear();
    db.users.get(USER_B).email_confirmed_at = new Date(clock).toISOString();
    const confirmed = await r.identify(jwtReq(issuer.sign({ sub: USER_B, user_metadata: {} }, { nowS: nowS() })));
    ok(confirmed.status === 'valid', 'and taken once auth.users says it is confirmed');
    // user_metadata is the user's own to write (updateUser({ data: { email_verified: true } })): never trusted.
    const USER_C = '33333333-3333-4333-8333-333333333333';
    db.users.set(USER_C, { id: USER_C, email: 'c@example.com', email_confirmed_at: null, created_at: new Date(clock).toISOString() });
    const forgedMeta = await r.identify(jwtReq(issuer.sign({ sub: USER_C, user_metadata: { email_verified: true }, email_verified: true },
      { nowS: nowS() })));
    ok(forgedMeta.status === 'invalid' && forgedMeta.body && forgedMeta.body.error === 'email-unconfirmed',
      'a token whose user_metadata says email_verified, for an email auth.users has not confirmed, is refused');
    // A new signing key: an unknown kid fetches the JWKS again, at most once a minute.
    issuer.add('kid-2');
    clock += 61 * 1000;
    const rotated = await r.identify(jwtReq(issuer.sign({ sub: USER_A }, { useKid: 'kid-2', nowS: nowS() })));
    ok(rotated.status === 'valid' && issuer.fetches.n === 2, `a rotated key (new kid) is fetched and taken (${issuer.fetches.n} fetches)`);
    const before = issuer.fetches.n;
    const ghost = await r.identify(jwtReq(issuer.sign({ sub: USER_A }, { headerKid: 'kid-nobody', nowS: nowS() })));
    ok(ghost.status === 'invalid' && issuer.fetches.n === before, 'a kid nobody published is refused, without a second fetch inside the minute');
    // The JWKS cannot be fetched: an outage, not a refusal.
    const r2 = createResolver({ supabase: db.client, fetch: issuer.fetch, now: () => clock, checkKey: async () => 'invalid', keyOwner: () => null });
    issuer.fetches.fail = true;
    const down = await r2.identify(jwtReq(issuer.sign({ sub: USER_A }, { nowS: nowS() })));
    ok(down.status === 'unavailable', `a JWKS that cannot be fetched is unavailable (503), never invalid (${down.status})`);
    issuer.fetches.fail = false;

    // ── The app session ────────────────────────────────────────────────────
    const token = newToken();
    db.tables.app_sessions.push({ id: 'sess-1', user_id: USER_A, token_hash: sha(token), device_hash: sha('device-1'),
      device_name: 'PC', created_at: new Date(clock).toISOString(), last_seen: new Date(clock - 10 * 60e3).toISOString(), revoked_at: null });
    db.tables.entitlements.push({ user_id: USER_A, tier: 'pro', account_key: 'GC-PROA-AAAA-AAAA-AAAA', cap_monthly: 25, free_total: 3, bonus_pool: 0, status: 'active', source: 'stripe' });
    r._caches.entitlements.clear();   // the JWT checks above remembered USER_A with none
    const sreq = () => ({ headers: { authorization: `Bearer ${token}` } });
    db.calls.length = 0;
    const s1 = await r.identify(sreq());
    ok(s1.status === 'valid' && s1.caller.via === 'session' && s1.caller.userId === USER_A && s1.caller.tier === 'pro'
      && s1.caller.key === 'GC-PROA-AAAA-AAAA-AAAA' && s1.caller.deviceHash === sha('device-1') && s1.caller.legacy === false,
    'an app session is its user, its tier and account key from entitlements, its device');
    ok(!JSON.stringify(db.tables.app_sessions).includes(token), 'and the token itself is stored nowhere, only its sha256');
    await new Promise((res) => setImmediate(res));
    const seenWrites = () => db.calls.filter((c) => c.table === 'app_sessions' && c.op === 'update').length;
    ok(seenWrites() === 1, 'a session last seen ten minutes ago has last_seen written');
    const lookups = db.calls.filter((c) => c.table === 'app_sessions' && c.op === 'select').length;
    await r.identify(sreq());
    await r.identify(sreq());
    ok(db.calls.filter((c) => c.table === 'app_sessions' && c.op === 'select').length === lookups,
      'within a minute the session is not looked up again');
    clock += 61 * 1000;
    await r.identify(sreq());
    await new Promise((res) => setImmediate(res));
    ok(seenWrites() === 1, 'and a minute later it is looked up, but last_seen is not written again inside five minutes');
    clock += 5 * 60 * 1000;
    await r.identify(sreq());
    await new Promise((res) => setImmediate(res));
    ok(seenWrites() === 2, 'and is past five minutes');
    // An outage: a session seen in the last half hour is honoured, an older one is unavailable.
    clock += 61 * 1000;
    db.outage = true;
    const stale = await r.identify(sreq());
    ok(stale.status === 'valid', 'through an outage a session confirmed minutes ago is still the user');
    clock += 31 * 60 * 1000;
    const gone = await r.identify(sreq());
    ok(gone.status === 'unavailable', 'past half an hour an outage is unavailable (503), never invalid');
    db.outage = false;
    // The lookups' breaker: for DOWN_MS after a failure nothing is asked, so a
    // hanging database adds no timeouts to every request.
    const askedBefore = db.calls.length;
    const paused = await r.identify(sreq());
    ok(paused.status === 'unavailable' && db.calls.length === askedBefore,
      'just after a failed lookup the next one is not asked (the breaker), unavailable, never invalid');
    clock += callerMod.DOWN_MS + 1000;
    db.tables.app_sessions[0].revoked_at = new Date(clock).toISOString();
    const revoked = await r.identify(sreq());
    ok(revoked.status === 'invalid' && revoked.via === 'session', 'a revoked session is refused');
    const unknown = await r.identify({ headers: { authorization: `Bearer ${newToken()}` } });
    ok(unknown.status === 'invalid', 'and so is one nobody issued');

    // ── The licence key ────────────────────────────────────────────────────
    const KEY = 'GC-AAAA-BBBB-CCCC-DDDD';
    keyAnswers.set(KEY, 'valid');
    owners.set(KEY, { userId: USER_B, plan: 'monthly', deviceId: 'pc-9' });
    const kreq = (extra = {}) => ({ headers: { 'x-license-key': KEY, ...extra } });
    const k1 = await r.identify(kreq());
    ok(k1.status === 'valid' && k1.caller.via === 'key' && k1.caller.userId === USER_B && k1.caller.tier === 'pro'
      && k1.caller.legacy === true && k1.caller.deviceHash === sha('pc-9'),
    'a licence key is its user, a monthly plan Pro, and legacy while the user has no app session');
    ok(k1.caller.accountKey === KEY,
      'and a legacy key keeps its 8.6 ledgers (accountKey is the key): two keys of one user are two Ask Coach caps, as in 8.6');
    const LONE = 'GC-LONE-LONE-LONE-LONE';
    keyAnswers.set(LONE, 'valid');
    const k2 = await r.identify({ headers: { 'x-license-key': LONE } });
    ok(k2.status === 'valid' && k2.caller.accountKey === LONE && k2.caller.userId === null,
      'a key with no user is keyed by itself, where the ledgers always kept it');
    const FREE = 'GC-FREE-FREE-FREE-FREE';
    keyAnswers.set(FREE, 'valid');
    owners.set(FREE, { userId: USER_A, plan: 'free' });
    const k3 = await r.identify({ headers: { 'x-license-key': FREE, 'x-occlara-version': '8.7.0' } });
    ok(k3.status === 'valid' && k3.caller.legacy === false && k3.caller.accountKey === `u:${USER_A}`,
      'a free plan key is never legacy, keyed u:<id>');
    for (const v of ['8.6.0', null]) {
      const old = await r.identify({ headers: { 'x-license-key': FREE, ...(v ? { 'x-occlara-version': v } : {}) } });
      ok(old.status === 'invalid' && old.via === 'key' && old.body && old.body.error === 'update-required',
        `a free plan key from ${v || 'an app with no version'} is refused as a key (8.6 reads a cap 402 as out of credits)`);
    }
    db.tables.app_sessions.push({ id: 'sess-2', user_id: USER_B, token_hash: sha(newToken()), revoked_at: null });
    r._caches.hasSession.clear();
    const k4 = await r.identify(kreq());
    ok(k4.caller.legacy === false && k4.caller.accountKey === `u:${USER_B}`,
      'and a paid key whose user signed in to the app is not legacy either, keyed u:<id> with the session');
    keyAnswers.set('GC-DOWN-DOWN-DOWN-DOWN', 'unavailable');
    ok((await r.identify({ headers: { 'x-license-key': 'GC-DOWN-DOWN-DOWN-DOWN' } })).status === 'unavailable'
      && (await r.identify({ headers: { 'x-license-key': 'GC-NOPE-NOPE-NOPE-NOPE' } })).status === 'invalid'
      && (await r.identify({ headers: {} })).status === 'none',
    "checkKey's three answers are kept: unavailable, invalid, and no credentials at all");
    const once = kreq();
    const p1 = r.identify(once);
    ok(p1 === r.identify(once), 'a request is identified once: the limiter and the route share one answer');
    await p1;

    // ── Accounts not live ──────────────────────────────────────────────────
    for (const code of ['42P01', 'PGRST205']) {
      const dbn = makeDb();
      dbn.missing.add('app_sessions'); dbn.missing.add('entitlements'); dbn.missingCode = code;
      const rn = createResolver({ supabase: dbn.client, fetch: issuer.fetch, now: () => clock,
        checkKey: async (k) => (k === KEY ? 'valid' : 'invalid'), keyOwner: (k) => owners.get(k) });
      const both = await rn.identify({ headers: { authorization: `Bearer ${newToken()}`, 'x-license-key': KEY } });
      ok(both.status === 'valid' && both.caller.via === 'key' && !rn.accountsLive(),
        `with app_sessions missing (${code}) a session falls back to the key, and accounts are not live`);
      const sessionsAsked = dbn.calls.filter((c) => c.table === 'app_sessions').length;
      await rn.identify({ headers: { authorization: `Bearer ${newToken()}`, 'x-license-key': KEY } });
      ok(dbn.calls.filter((c) => c.table === 'app_sessions').length === sessionsAsked,
        'and the missing table is not asked again on every request');
      const alone = await rn.identify({ headers: { authorization: `Bearer ${newToken()}` } });
      ok(alone.status === 'unavailable' && alone.via === 'session',
        `with accounts not live (${code}) a session with no key is unavailable (503, retry), never invalid (the app would sign out)`);
    }
    {
      // A migration re-run mid flight: a session confirmed minutes ago is still the user.
      const dbm = makeDb();
      let t = Date.now();
      const rm = createResolver({ supabase: dbm.client, fetch: issuer.fetch, now: () => t, checkKey: async () => 'invalid', keyOwner: () => null });
      const tk = newToken();
      dbm.tables.app_sessions.push({ id: 'sess-m', user_id: USER_A, token_hash: sha(tk), device_hash: null, revoked_at: null,
        last_seen: new Date(t).toISOString() });
      const first = await rm.identify({ headers: { authorization: `Bearer ${tk}` } });
      dbm.missing.add('app_sessions'); dbm.missingCode = 'PGRST205';
      t += 2 * 60 * 1000;
      const during = await rm.identify({ headers: { authorization: `Bearer ${tk}` } });
      ok(first.status === 'valid' && during.status === 'valid', 'a session confirmed in the last half hour is honoured while accounts read as not live');
      t += 2 * 60 * 1000;
      const still = await rm.identify({ headers: { authorization: `Bearer ${tk}` } });
      ok(still.status === 'valid' && !rm.accountsLive(), 'and on the next ask too, the missing table not asked again');
    }
    {
      // A hanging entitlements lookup costs a key request one wait, not one every minute.
      const dbh = makeDb();
      let t = Date.now();
      const KH = 'GC-HANG-HANG-HANG-HANG';
      const rh = createResolver({ supabase: dbh.client, fetch: issuer.fetch, now: () => t,
        checkKey: async (k) => (k === KH ? 'valid' : 'invalid'), keyOwner: () => ({ userId: USER_B, plan: 'monthly' }) });
      dbh.outage = true;
      const a = await rh.identify({ headers: { 'x-license-key': KH } });
      const asked = dbh.calls.length;
      t += 20 * 1000;
      const b = await rh.identify({ headers: { 'x-license-key': KH } });
      ok(a.status === 'valid' && b.status === 'valid' && dbh.calls.length === asked,
        'through an outage a key is served at once: inside the breaker no account lookup is asked');
      // Then the database hangs: past the cache and the breaker, the request
      // is answered from what is held, the lookup left running behind it.
      const realFrom = dbh.client.from;
      const hanging = () => {
        const q = { select: () => q, eq: () => q, is: () => q, limit: () => q, abortSignal: () => q,
          maybeSingle: () => new Promise(() => {}), then: () => {} };
        return q;
      };
      dbh.client.from = hanging;
      t += 2 * 60 * 1000;
      const raced = await Promise.race([rh.identify({ headers: { 'x-license-key': KH } }),
        new Promise((res) => setTimeout(() => res('waited'), 300))]);
      ok(raced !== 'waited' && raced.status === 'valid',
        'and a hanging database adds no wait to a key request after the first: the held answer is served at once');
      dbh.client.from = realFrom;
    }

    // ── Presence names the account ─────────────────────────────────────────
    {
      const { Presence, hashOf, ACCOUNT_FORMAT } = require(path.join(SERVER, 'services', 'presence.js'));
      const pr = new Presence();
      pr.touch({ key: KEY, account: `u:${USER_B}`, path: '/api/coach/read' });
      pr.touch({ key: KEY, path: '/api/coach/read' });
      pr.touch({ account: 'u:not-a-uuid', path: '/api/coach/read' });
      ok(ACCOUNT_FORMAT.test(`u:${USER_B}`) && !ACCOUNT_FORMAT.test('u:not-a-uuid')
        && pr.keys.get(hashOf(`u:${USER_B}`)) === `u:${USER_B}` && pr.keys.get(hashOf(KEY)) === KEY && pr.users.size === 2,
      'presence keeps a signed in player by account and a bare key by its hash as before, and ignores a junk account');
    }

    // ── Enforced ───────────────────────────────────────────────────────────
    const sess = s1.caller;
    const legacyKey = k1.caller;
    const freeKey = k3.caller;
    const E = (over) => ({ ...over });
    ok(!enforced(sess, E({})) && !enforced(sess, E({ ENFORCE_CAPS: '0' })), 'ENFORCE_CAPS unset or 0 caps nobody');
    ok(enforced(sess, E({ ENFORCE_CAPS: '1' })) && enforced(freeKey, E({ ENFORCE_CAPS: '1' })),
      'with ENFORCE_CAPS=1 a session and a free plan key are capped');
    ok(!enforced(legacyKey, E({ ENFORCE_CAPS: '1' })) && !enforced(legacyKey, E({ ENFORCE_CAPS: '1', LEGACY_CAP_FROM: '2999-01-01' }))
      && enforced(legacyKey, E({ ENFORCE_CAPS: '1', LEGACY_CAP_FROM: '2020-01-01' })),
    'a legacy key is not capped until LEGACY_CAP_FROM has passed, and unset means never');
    ok(!enforced(k2.caller, E({ ENFORCE_CAPS: '1' })), 'and a key with no user is never capped');

    console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' caller checks passed'}`);
    process.exit(fails ? 1 : 0);
  })().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
}
