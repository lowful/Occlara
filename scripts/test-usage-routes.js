'use strict';

/**
 * THE ACCOUNT AND USAGE ROUTES (8.7, server/routes/usage.js).
 *
 *   HANDOFF. Only a Supabase access token may ask; state and the PKCE
 *   challenge are checked for shape; the one time code is 32 random bytes,
 *   stored only as its sha256, and lives 120 seconds; ensure_entitlement runs.
 *   EXCHANGE. No auth, ten a minute per IP. Single use (a second exchange of
 *   the same code fails, as does an expired one), the state and the PKCE
 *   verifier must match (S256), and the app session token (occ_ and 43
 *   characters) is stored only as its sha256 with the device and network
 *   hashed.
 *   SIGNOUT revokes the session at once. ME answers account_state for any
 *   caller, capped only when ENFORCE_CAPS=1 and nothing is left.
 *   CLAIM (Riot record and League reviews) is counted at once, idempotent on
 *   the client's match id, refused only on a definite no, and granted when
 *   accounts are not live or the database cannot answer.
 *
 * Against the in-memory Supabase of test-caller.js. Nothing leaves the machine.
 *
 * Run: npm run test:usageroutes
 */

const path = require('path');
const crypto = require('crypto');
const { makeDb, makeIssuer, call, USER_A, USER_B, sha, newToken } = require('./test-caller');

const SERVER = path.join(__dirname, '..', 'server');
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const { FREE_GAMES } = callers;
const usage = require(path.join(SERVER, 'routes', 'usage.js'));

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

function rig({ env: given = {}, missing = [] } = {}) {
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, ...given };
  let clock = Date.parse('2026-11-04T12:00:00.000Z');
  const db = makeDb({ now: () => clock });
  for (const t of missing) db.missing.add(t);
  const issuer = makeIssuer();
  const keys = new Map();
  const owners = new Map();
  const resolver = callers.createResolver({ supabase: db.client, fetch: issuer.fetch, now: () => clock, env,
    checkKey: async (k) => keys.get(k) || 'invalid', keyOwner: (k) => owners.get(k) });
  const meter = usage.createMeter({ supabase: db.client, resolver, now: () => clock, env });
  const router = usage.createRouter({ supabase: db.client, resolver, meter, env, now: () => clock });
  const jwt = (sub, claims = {}) => issuer.sign({ sub, ...claims }, { nowS: Math.floor(clock / 1000) });
  return { db, issuer, resolver, meter, router, jwt, keys, owners, env,
    tick: (ms) => { clock += ms; }, now: () => clock };
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    state: crypto.randomBytes(16).toString('base64url') };
};

(async () => {
  // ── The patterns ────────────────────────────────────────────────────────
  {
    const { B64URL, VERIFIER, REF_CODE } = usage.PATTERNS;
    const p = pkce();
    ok(B64URL.test(p.challenge) && p.challenge.length === 43 && !B64URL.test('a+b/c=') && VERIFIER.test(p.verifier)
      && !VERIFIER.test('short') && REF_CODE.test('K7Q2M9XA') && !REF_CODE.test('no spaces!'),
    'the base64url, PKCE verifier and invite code patterns hold their known positives and refuse the rest');
  }

  const t = rig();
  const { db, router } = t;
  db.users.set(USER_A, { id: USER_A, email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
  const auth = (tok) => ({ Authorization: `Bearer ${tok}` });

  // ── Handoff ──────────────────────────────────────────────────────────────
  const p = pkce();
  ok((await call(router, 'POST', '/account/handoff', { body: { state: p.state, challenge: p.challenge } })).status === 401,
    'a handoff with no token is refused');
  const bad1 = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: 'x', challenge: p.challenge } });
  const bad2 = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: p.state, challenge: 'not base64url!' } });
  ok(bad1.status === 400 && bad2.status === 400, 'a state or challenge of the wrong shape is refused');
  const h = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: p.state, challenge: p.challenge } });
  const code = h.body && h.body.code;
  ok(h.status === 200 && typeof code === 'string' && code.length === 43, `a signed in site gets a one time code of 32 random bytes (${h.status})`);
  const stored = db.tables.auth_handoffs[0] || {};
  ok(stored.code_hash === sha(code) && !JSON.stringify(db.tables.auth_handoffs).includes(code)
    && Date.parse(stored.expires_at) - t.now() === 120 * 1000 && stored.user_id === USER_A,
  'stored only as its sha256, for 120 seconds, for that user');
  ok(db.rpcCalls.some((c) => c.name === 'ensure_entitlement' && c.args.p_user === USER_A) && db.tables.entitlements.length === 1,
    'and the account has its entitlement (ensure_entitlement)');

  // ── Exchange ─────────────────────────────────────────────────────────────
  const ex = (body, ip) => call(router, 'POST', '/account/exchange', { body, ip });
  const body = { code, verifier: p.verifier, state: p.state, device_id: 'machine-guid-1', device_name: 'Gaming PC' };
  ok((await ex({ ...body, verifier: pkce().verifier }, '198.51.100.1')).status === 400, 'the wrong PKCE verifier is refused');
  // That burned the code: single use means a failed try uses it up too.
  ok((await ex(body, '198.51.100.1')).status === 400, 'and the code it was tried with cannot be used again');
  const p2 = pkce();
  const h2 = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: p2.state, challenge: p2.challenge } });
  ok((await ex({ code: h2.body.code, verifier: p2.verifier, state: pkce().state }, '198.51.100.2')).status === 400, 'a state that does not match is refused');
  const p3 = pkce();
  const h3 = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: p3.state, challenge: p3.challenge } });
  t.tick(121 * 1000);
  ok((await ex({ code: h3.body.code, verifier: p3.verifier, state: p3.state }, '198.51.100.3')).status === 400, 'a code older than 120 seconds is refused');
  const p4 = pkce();
  const h4 = await call(router, 'POST', '/account/handoff', { headers: auth(t.jwt(USER_A)), body: { state: p4.state, challenge: p4.challenge } });
  const good = await ex({ code: h4.body.code, verifier: p4.verifier, state: p4.state, device_id: 'machine-guid-1', device_name: 'Gaming PC' }, '203.0.113.40');
  const token = good.body && good.body.token;
  ok(good.status === 200 && /^occ_[A-Za-z0-9_-]{43}$/.test(token || '') && good.body.account && good.body.account.tier === 'free'
    && good.body.account.left === FREE_GAMES, `the right code, state and verifier give an app session and the account (${good.status})`);
  const sess = db.tables.app_sessions[0] || {};
  ok(sess.token_hash === sha(token) && !JSON.stringify(db.tables.app_sessions).includes(token) && sess.device_hash === sha('machine-guid-1')
    && sess.device_name === 'Gaming PC' && sess.ip_prefix_hash === callers.ipPrefixHash('203.0.113.99') && !JSON.stringify(sess).includes('203.0.113'),
  'the session is stored as hashes: the token, the device and the /24, never the token or the address');
  ok((await ex({ code: h4.body.code, verifier: p4.verifier, state: p4.state }, '203.0.113.40')).status === 400, 'and the same code twice is refused');
  {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await ex({ code: 'x'.repeat(43), verifier: p4.verifier, state: p4.state }, '192.0.2.50')).status);
    ok(statuses.slice(0, 10).every((s) => s === 400) && statuses[10] === 429, `exchange is ten a minute per IP (${statuses.join(',')})`);
  }

  // ── Me, and signout ──────────────────────────────────────────────────────
  const me = await call(router, 'GET', '/account/me', { headers: auth(token) });
  ok(me.status === 200 && me.body.live === true && me.body.tier === 'free' && me.body.left === FREE_GAMES && me.body.capped === false
    && me.body.via === 'session' && me.body.email === 'a@example.com' && me.body.account_key,
  'GET /account/me answers account_state for the session: tier, games left, account key, email');
  const meJwt = await call(router, 'GET', '/account/me', { headers: auth(t.jwt(USER_A)) });
  ok(meJwt.status === 200 && meJwt.body.via === 'jwt' && meJwt.body.left === FREE_GAMES, 'and for a Supabase token too');
  const out = await call(router, 'POST', '/account/signout', { headers: auth(token) });
  ok(out.status === 200 && db.tables.app_sessions[0].revoked_at, 'signout revokes the session');
  ok((await call(router, 'GET', '/account/me', { headers: auth(token) })).status === 401, 'at once: the token no longer works');
  ok((await call(router, 'POST', '/account/signout', { headers: auth(t.jwt(USER_A)) })).status === 401, 'and only an app session can sign out');

  // ── Claim ────────────────────────────────────────────────────────────────
  {
    const c = rig();
    c.db.users.set(USER_B, { id: USER_B, email: 'b@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
    // The app claims, on its app session (its device fixed at exchange).
    const tok = newToken();
    c.db.tables.app_sessions.push({ id: 'sess-claim', user_id: USER_B, token_hash: sha(tok), device_hash: sha('dev-session'),
      device_name: 'PC', created_at: new Date(c.now()).toISOString(), last_seen: new Date(c.now()).toISOString(), revoked_at: null });
    const claim = (b, h = auth(tok)) => call(c.router, 'POST', '/usage/claim', { headers: h, body: b });
    ok((await claim({ game: 'valorant', kind: 'live', client_match_id: 'm1' })).status === 400
      && (await claim({ game: 'valorant', kind: 'league', client_match_id: 'm1' })).status === 400
      && (await claim({ game: 'valorant', kind: 'riot' })).status === 400, 'a claim must be riot or league, of its game, with a match id');
    const viaSite = await claim({ game: 'valorant', kind: 'riot', client_match_id: 'riot-site', device_id: 'dev-fresh' }, auth(c.jwt(USER_B)));
    ok(viaSite.status === 401 && c.db.tables.game_usage.length === 0, 'a site token (no device) cannot claim a game');
    const a = await claim({ game: 'valorant', kind: 'riot', client_match_id: 'riot-1', device_id: 'dev-x' });
    const row = c.db.tables.game_usage[0] || {};
    ok(a.status === 200 && a.body.granted === true && a.body.left === FREE_GAMES - 1 && row.status === 'counted' && row.kind === 'riot',
      `a Riot record review claims a game and it is counted at once (${JSON.stringify(a.body)})`);
    ok(row.device_hash === sha('dev-session'),
      'on the session\'s own device, never the device_id the body names (a fresh one per request walked past the device rule)');
    const again = await claim({ game: 'valorant', kind: 'riot', client_match_id: 'riot-1' });
    ok(again.body.granted === true && c.db.tables.game_usage.length === 1, 'the same match claimed twice is one game');
    await claim({ game: 'lol', kind: 'league', client_match_id: 'lol-1' });
    const third = await claim({ game: 'lol', kind: 'league', client_match_id: 'lol-3' });
    ok(FREE_GAMES === 2 && third.body.granted === true && c.db.tables.game_usage[2].source === 'shadow' && c.db.tables.game_usage[2].over_cap === true,
      'with ENFORCE_CAPS off a third free game is granted, counted in shadow, past the 2');
    c.env.ENFORCE_CAPS = '1';
    const fifth = await claim({ game: 'lol', kind: 'league', client_match_id: 'lol-4' });
    ok(fifth.body.granted === false && fifth.body.reason === 'cap', 'with ENFORCE_CAPS=1 it is refused');
    const meCapped = await call(c.router, 'GET', '/account/me', { headers: auth(tok) });
    ok(meCapped.body.capped === true && meCapped.body.enforce === true && meCapped.body.left === 0,
      'and /account/me says capped, so Start can refuse it before a match');
    c.db.outage = true;
    const down = await claim({ game: 'lol', kind: 'league', client_match_id: 'lol-5' }, { 'X-License-Key': 'GC-NONE-NONE-NONE-NONE' });
    ok(down.status === 403, 'a key that is not valid is 403');
    c.resolver._caches.users.clear();
    c.meter.allow.clear();
    const errClaim = await claim({ game: 'lol', kind: 'league', client_match_id: 'lol-6' });
    ok(errClaim.status === 200 && errClaim.body.granted === true && errClaim.body.reason === 'unavailable',
      `a claim the database cannot answer is granted, never a locked review on an error (${JSON.stringify(errClaim.body)})`);
    c.db.outage = false;
  }

  // ── Release: a Riot record run taken back gives its games back ───────────
  {
    const c = rig();
    const tok = newToken();
    c.db.tables.app_sessions.push({ id: 'sess-rel', user_id: USER_B, token_hash: sha(tok), device_hash: sha('dev-r'),
      created_at: new Date(c.now()).toISOString(), last_seen: new Date(c.now()).toISOString(), revoked_at: null });
    const claim = (id) => call(c.router, 'POST', '/usage/claim', { headers: auth(tok), body: { game: 'valorant', kind: 'riot', client_match_id: id } });
    const release = (id, h = auth(tok)) => call(c.router, 'POST', '/usage/release', { headers: h, body: { client_match_id: id } });
    await claim('riot:a');
    await claim('riot:b');
    c.db.rpcCalls.length = 0;
    const r = await release('riot:a');
    ok(r.status === 200 && c.db.rpcCalls.some((x) => x.name === 'release_game' && x.args.p_user === USER_B && x.args.p_client_match_id === 'riot:a'),
      `POST /usage/release asks release_game for the caller's own riot claim (${r.status} ${JSON.stringify(r.body)})`);
    ok((await release('lol:x')).status === 400 && (await release('')).status === 400, 'only a riot: client id can be released');
    ok((await release('riot:a', auth(c.jwt(USER_B)))).status === 401, 'and only by the app, never a site token');
  }

  // ── A key alone invites nobody ───────────────────────────────────────────
  {
    const c = rig();
    const KEY = 'GC-INVK-INVK-INVK-INVK';
    c.keys.set(KEY, 'valid');
    c.owners.set(KEY, { userId: USER_B, plan: 'monthly' });
    const keyOnly = await call(c.router, 'GET', '/referral', { headers: { 'X-License-Key': KEY } });
    ok(keyOnly.status === 403 && keyOnly.body.error === 'sign-in-required',
      'GET /referral for a key whose user never signed in to the app asks for a sign in (no network or device to compare)');
    c.db.tables.app_sessions.push({ id: 'sess-inv', user_id: USER_B, token_hash: sha(newToken()), revoked_at: null });
    c.resolver._caches.hasSession.clear();
    const signed = await call(c.router, 'GET', '/referral', { headers: { 'X-License-Key': KEY } });
    ok(signed.status === 200 && /^https:\/\/occlara\.app\/invite\//.test(signed.body.link || ''), 'and gives the link once the user has signed in to the app');
  }

  // ── A counted live game is finished when the next match starts (S1) ───────
  {
    // Six matches of 130 in-match reads, 5 s apart, 3.5 minutes between them
    // and no review (a review that failed, or a client that skips it): the
    // first is counted at 120 and every later match is a game of its own.
    // Before, the counted row stayed open under the 4 minute gap, gate() let
    // every read through and one game was charged for six.
    const s = rig({ env: { ENFORCE_CAPS: '1' } });
    await s.db.client.rpc('ensure_entitlement', { p_user: USER_A });
    const e = s.db.tables.entitlements.find((x) => x.user_id === USER_A);
    Object.assign(e, { tier: 'pro', cap_monthly: 3, source: 'stripe' });
    const caller = { userId: USER_A, accountKey: 'GC-METR-AAAA-BBBB-CCCC', deviceHash: sha('dev-meter') };
    let refused = 0;
    let readsLeft = 0;
    for (let match = 0; match < 6; match++) {
      for (let i = 0; i < 130; i++) {
        const g = await s.meter.gate(caller);
        if (!g.ok) { refused++; continue; }
        if (match >= 4) readsLeft++;
        // The score as the reply read it: 0-0 for the first reads, climbing a round a minute.
        const round = Math.floor((i * 5) / 60);
        await s.meter.noteRead(caller, { inMatch: true, score: { team: Math.ceil(round / 2), enemy: Math.floor(round / 2) } });
        s.tick(5000);
      }
      s.tick(3.5 * 60 * 1000);
    }
    const live = s.db.tables.game_usage.filter((g) => g.user_id === USER_A && g.kind === 'live');
    ok(live.length === 3 && live.every((g) => g.status === 'counted'),
      `a counted game whose next match reads 0-0 again is over: three games for a cap of three (${live.map((g) => `${g.status}/${g.match_reads}`).join(', ')})`);
    ok(refused > 0 && readsLeft <= 3 * 4,
      `and with no game left the matches after them are refused at the gate (${refused} refused, ${readsLeft} let through past the cap)`);
  }
  {
    // A score misread once (a 7 in round 2) and then the true 1-0 is no new match.
    const s = rig({ env: { ENFORCE_CAPS: '1' } });
    await s.db.client.rpc('ensure_entitlement', { p_user: USER_A });
    Object.assign(s.db.tables.entitlements.find((x) => x.user_id === USER_A), { tier: 'pro', cap_monthly: 25, source: 'stripe' });
    const caller = { userId: USER_A, accountKey: 'GC-METR-AAAA-BBBB-DDDD', deviceHash: sha('dev-meter-2') };
    for (let i = 0; i < 125; i++) {
      const score = i === 121 ? { team: 7, enemy: 0 } : { team: 1, enemy: 0 };
      await s.meter.noteRead(caller, { inMatch: true, score });
      s.tick(5000);
    }
    const live = s.db.tables.game_usage.filter((g) => g.user_id === USER_A && g.kind === 'live');
    ok(live.length === 1, `one misread score inside a counted match never starts a new game (${live.length} rows)`);
    // And a counted row is finished two hours after its claim whatever the
    // reads say, even with one every three minutes, under the 4 minute gap.
    for (let i = 0; i < 41; i++) { s.tick(3 * 60 * 1000); await s.meter.noteRead(caller, { inMatch: true, score: { team: 1, enemy: 0 } }); }
    const after = s.db.tables.game_usage.filter((g) => g.user_id === USER_A && g.kind === 'live');
    ok(after.length === 2, `a counted game read on for two hours is over, the next read claims a new one (${after.length} rows)`);
  }
  {
    // S12: the meter's small maps are bounded like `opens`.
    const s = rig();
    for (let i = 0; i < 10050; i++) {
      s.meter.allow.set(`k${i}`, { at: 0, left: 1 });
      s.meter.refunds.set(`k${i}`, { day: 'x', n: 1 });
      s.meter.ensured.set(`u${i}`, 0);
    }
    s.meter.trim();
    ok(s.meter.allow.size <= 10000 && s.meter.refunds.size <= 10000 && s.meter.ensured.size <= 10000,
      `the allowance, refund and entitlement maps are evicted past 10000 entries (${s.meter.allow.size}, ${s.meter.refunds.size}, ${s.meter.ensured.size})`);
  }

  // ── Not live: 8.6 exactly ────────────────────────────────────────────────
  for (const code of ['42P01', 'PGRST205', 'PGRST202']) {
    const n = rig({ env: { ENFORCE_CAPS: '1' } });
    if (code === 'PGRST202') n.db.rpcMissing = true;
    else { n.db.missingCode = code; for (const tb of ['entitlements', 'game_usage', 'app_sessions', 'auth_handoffs', 'referral_codes', 'referral_redemptions']) n.db.missing.add(tb); }
    const KEY = 'GC-OLDK-OLDK-OLDK-OLDK';
    n.keys.set(KEY, 'valid');
    n.owners.set(KEY, { userId: USER_A, plan: 'free' });
    const kh = { 'X-License-Key': KEY, 'X-Occlara-Version': '8.7.0' };
    const c1 = await call(n.router, 'POST', '/usage/claim', { headers: kh, body: { game: 'valorant', kind: 'riot', client_match_id: 'r1' } });
    const c2 = await call(n.router, 'POST', '/usage/claim', { headers: kh, body: { game: 'valorant', kind: 'riot', client_match_id: 'r2' } });
    const m = await call(n.router, 'GET', '/account/me', { headers: kh });
    ok(c1.body.granted === true && c1.body.reason === 'not-live' && c2.body.granted === true && m.status === 200 && m.body.live === false
      && m.body.capped === false, `with the migration not applied (${code}) a claim is granted and /me says not live, never capped, even with ENFORCE_CAPS=1`);
    const p5 = pkce();
    n.db.users.set(USER_A, { id: USER_A, email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
    const hand = await call(n.router, 'POST', '/account/handoff', { headers: auth(n.jwt(USER_A)), body: { state: p5.state, challenge: p5.challenge } });
    ok(hand.status === 503 && hand.body.error === 'accounts-not-live', `and a handoff says accounts are not live (${hand.status})`);
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' usage route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
