'use strict';

/**
 * INVITES (8.7, server/routes/usage.js /referral and /referral/redeem).
 *
 *   THE LINK. GET /api/referral makes the caller's code on the first ask and
 *   keeps it, and answers the link (https://occlara.app/invite/<code>), how
 *   many friends joined and qualified, the games earned (never past 20), and
 *   the limits: 5 friends, 20 games.
 *   REDEEM. Only the invitee's Supabase token, only with REFERRALS_ON=1, ten a
 *   minute per IP. Refused: an unknown code, the inviter's own code, an
 *   account older than 30 minutes, an invitee with any game counted, a second
 *   redemption, an inviter with 5 friends already, and an invitee on the same
 *   /24 as one of the inviter's app sessions. Otherwise the invitee has 5
 *   free games and a pending redemption, which settle_game qualifies later.
 *
 * Against the in-memory Supabase of test-caller.js. Nothing leaves the machine.
 *
 * Run: npm run test:referral
 */

const path = require('path');
const { makeDb, makeIssuer, call, newToken, sha, USER_A, USER_B } = require('./test-caller');

const SERVER = path.join(__dirname, '..', 'server');
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

let clock = Date.parse('2026-11-04T12:00:00.000Z');
const env = { SUPABASE_URL: process.env.SUPABASE_URL, REFERRALS_ON: '1' };
const db = makeDb({ now: () => clock });
const issuer = makeIssuer();
const resolver = callers.createResolver({ supabase: db.client, fetch: issuer.fetch, now: () => clock, env,
  checkKey: async () => 'invalid', keyOwner: () => null });
const meter = usage.createMeter({ supabase: db.client, resolver, now: () => clock, env });
const router = usage.createRouter({ supabase: db.client, resolver, meter, env, now: () => clock });
const jwt = (sub) => ({ Authorization: `Bearer ${issuer.sign({ sub }, { nowS: Math.floor(clock / 1000) })}` });
const uid = (n) => `${String(n).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`.slice(0, 36);
const iso = (ms) => new Date(ms).toISOString();

/** A new account, made `ageMin` minutes ago. */
function account(id, ageMin = 5) {
  db.users.set(id, { id, email: `${id.slice(0, 4)}@example.com`, email_confirmed_at: iso(clock), created_at: iso(clock - ageMin * 60e3) });
  return id;
}

(async () => {
  // The inviter, signed in to the app from a home network.
  account(USER_A, 60 * 24 * 30);
  const token = newToken();
  db.tables.app_sessions.push({ id: 's-a', user_id: USER_A, token_hash: sha(token), device_hash: sha('dev-a'),
    ip_prefix_hash: callers.ipPrefixHash('198.51.100.20', env), created_at: iso(clock), last_seen: iso(clock), revoked_at: null });
  await db.client.rpc('ensure_entitlement', { p_user: USER_A });
  const A = { Authorization: `Bearer ${token}` };

  // ── The link ───────────────────────────────────────────────────────────
  const first = await call(router, 'GET', '/referral', { headers: A });
  const code = first.body && first.body.code;
  ok(first.status === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(code || '') && first.body.link === `https://occlara.app/invite/${code}`
    && first.body.invited === 0 && first.body.qualified === 0 && first.body.earned === 0 && first.body.max_friends === 5 && first.body.max_games === 20,
  `the first ask makes the code and answers the link and the limits (${first.body && first.body.link})`);
  ok(/^[A-HJ-NP-Z2-9]{8}$/.test('K7Q2M9XA') && !/^[A-HJ-NP-Z2-9]{8}$/.test('K7Q2M9X0'), 'the code pattern this test holds codes to matches a known code and not a 0');
  const again = await call(router, 'GET', '/referral', { headers: A });
  ok(again.body.code === code && db.tables.referral_codes.length === 1, 'and the same code every time after');
  ok((await call(router, 'GET', '/referral')).status === 401, 'nobody unknown has a link');

  const redeem = (who, c = code, ip = '203.0.113.9') => call(router, 'POST', '/referral/redeem', { headers: jwt(who), body: { code: c }, ip });

  // ── Refusals ───────────────────────────────────────────────────────────
  env.REFERRALS_ON = '0';
  const off = await redeem(account(USER_B));
  ok(off.status === 403 && off.body.reason === 'referrals-off', 'with REFERRALS_ON off nothing is redeemed');
  env.REFERRALS_ON = '1';
  ok((await call(router, 'POST', '/referral/redeem', { headers: A, body: { code } })).status === 401, 'only the invitee\'s Supabase token may redeem, not an app session');
  const unknown = await redeem(USER_B, 'ZZZZZZZZ');
  ok(unknown.status === 404 && unknown.body.reason === 'code-unknown', 'an unknown code is refused');
  const self = await redeem(USER_A);
  ok(self.status === 409 && self.body.reason === 'self', 'the inviter cannot redeem their own code');
  const old = await redeem(account(uid(3), 31));
  ok(old.status === 409 && old.body.reason === 'account-old', 'an account older than 30 minutes is refused');
  const played = account(uid(4));
  db.tables.game_usage.push({ id: 'g-4', user_id: played, kind: 'riot', status: 'counted', created_at: iso(clock) });
  const pl = await redeem(played);
  ok(pl.status === 409 && pl.body.reason === 'already-played', 'an invitee who has a game already is refused');
  const net = await redeem(account(uid(5)), code, '198.51.100.77');
  ok(net.status === 409 && net.body.reason === 'same-network', 'an invitee on the same /24 as the inviter\'s app is refused');

  // ── Success, once ──────────────────────────────────────────────────────
  const good = await redeem(USER_B);
  const ent = db.tables.entitlements.find((e) => e.user_id === USER_B);
  const red = db.tables.referral_redemptions.find((r) => r.invitee_id === USER_B);
  ok(good.status === 200 && good.body.free_total === 5 && ent && ent.free_total === 5 && red && red.status === 'pending' && red.inviter_id === USER_A,
    `a new friend redeems: 5 free games and a pending redemption (${good.status})`);
  const twice = await redeem(USER_B);
  ok(twice.status === 409 && twice.body.reason === 'already-redeemed', 'and cannot redeem twice');
  const st = await call(router, 'GET', '/referral', { headers: A });
  ok(st.body.invited === 1 && st.body.qualified === 0, 'the inviter sees one friend joined, none qualified yet');

  // ── Five friends at most ───────────────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const r = await redeem(account(uid(6 + i)), code, `192.0.2.${10 + i}`);
    if (r.status !== 200) console.log('unexpected', r.status, r.body);
  }
  const sixth = await redeem(account('aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa'), code, '192.0.2.99');
  ok(sixth.status === 409 && sixth.body.reason === 'inviter-full', 'a sixth friend is refused');
  // Qualification is settle_game's (SQL); the earned count is read from the entitlement, never past 20.
  db.tables.entitlements.find((e) => e.user_id === USER_A).bonus_earned = 24;
  db.tables.referral_redemptions.forEach((r) => { r.status = 'qualified'; });
  const full = await call(router, 'GET', '/referral', { headers: A });
  ok(full.body.invited === 5 && full.body.qualified === 5 && full.body.earned === 20, `five friends qualified show 20 games earned at most (${full.body.earned})`);

  // ── Rate limited per IP ────────────────────────────────────────────────
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await redeem(USER_B, code, '192.0.2.200')).status);
  ok(statuses[10] === 429, `redeem is ten a minute per IP (${statuses.join(',')})`);

  // ── A refused write is never answered as done ──────────────────────────
  {
    const Q = account('cccccccc-0000-4000-8000-cccccccccccc', 60 * 24);
    const qTok = newToken();
    db.tables.app_sessions.push({ id: 's-q', user_id: Q, token_hash: sha(qTok), ip_prefix_hash: callers.ipPrefixHash('198.51.200.1', env), revoked_at: null });
    const qCode = (await call(router, 'GET', '/referral', { headers: { Authorization: 'Bearer ' + qTok } })).body.code;
    const W = account('dddddddd-0000-4000-8000-dddddddddddd');
    const realFrom = db.client.from;
    db.client.from = (t) => {
      const q = realFrom(t);
      if (t !== 'entitlements') return q;
      q.update = () => {
        const c = { eq: () => c, select: () => c, then: (res) => res({ data: null, error: { code: '23514', message: 'check violation' } }) };
        return c;
      };
      return q;
    };
    const r = await call(router, 'POST', '/referral/redeem', { headers: jwt(W), body: { code: qCode }, ip: '192.0.2.201' });
    db.client.from = realFrom;
    ok(r.status === 500 && r.body.error === 'account-failed', `an entitlement write the database refuses is a 500, never ok (${r.status})`);
  }

  // ── A refund or a dispute ended the invitee's account: no free games back ─
  {
    const R = account('eeeeeeee-0000-4000-8000-eeeeeeeeeeee', 60 * 24);
    const rTok = newToken();
    db.tables.app_sessions.push({ id: 's-r', user_id: R, token_hash: sha(rTok), ip_prefix_hash: callers.ipPrefixHash('198.51.201.1', env), revoked_at: null });
    const rCode = (await call(router, 'GET', '/referral', { headers: { Authorization: 'Bearer ' + rTok } })).body.code;
    const V = account('ffffffff-0000-4000-8000-ffffffffffff');
    await db.client.rpc('ensure_entitlement', { p_user: V });
    Object.assign(db.tables.entitlements.find((e) => e.user_id === V), { tier: 'free', cap_monthly: 0, free_total: 0, bonus_pool: 0, status: 'ended' });
    const r = await call(router, 'POST', '/referral/redeem', { headers: jwt(V), body: { code: rCode }, ip: '192.0.2.210' });
    const e = db.tables.entitlements.find((x) => x.user_id === V);
    ok(r.status === 409 && r.body.reason === 'account-ended' && e.free_total === 0
      && !db.tables.referral_redemptions.some((x) => x.invitee_id === V),
    `an invitee whose account a refund ended (free_total 0, ended) is refused, its free games left at 0 (${r.status} ${r.body.reason})`);
    // Ended between the read and the write: the update changes no row, the redemption is undone.
    const V2 = account('abababab-0000-4000-8000-abababababab');
    await db.client.rpc('ensure_entitlement', { p_user: V2 });
    const realFrom = db.client.from;
    db.client.from = (t) => {
      const q = realFrom(t);
      if (t !== 'entitlements') return q;
      const update = q.update;
      q.update = (p) => { Object.assign(db.tables.entitlements.find((x) => x.user_id === V2), { status: 'ended', free_total: 0 }); return update(p); };
      return q;
    };
    const raced = await call(router, 'POST', '/referral/redeem', { headers: jwt(V2), body: { code: rCode }, ip: '192.0.2.211' });
    db.client.from = realFrom;
    ok(raced.status === 409 && raced.body.reason === 'account-ended' && db.tables.entitlements.find((x) => x.user_id === V2).free_total === 0
      && !db.tables.referral_redemptions.some((x) => x.invitee_id === V2),
    'and one ended between the read and the write: the write changes no row, the redemption is taken back, refused');
  }

  // ── An inviter known on no network cannot invite ───────────────────────
  {
    const N = account('acacacac-0000-4000-8000-acacacacacac', 60 * 24);
    await db.client.rpc('ensure_entitlement', { p_user: N });
    db.tables.referral_codes.push({ user_id: N, code: 'NONETWRK', created_at: iso(clock) });
    const r = await call(router, 'POST', '/referral/redeem', { headers: jwt(account('adadadad-0000-4000-8000-adadadadadad')),
      body: { code: 'NONETWRK' }, ip: '192.0.2.212' });
    ok(r.status === 409 && r.body.reason === 'inviter-unverified',
      'an inviter with no app session (no network to tell the invitee apart from their own alt) is refused');
  }



  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' referral checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
