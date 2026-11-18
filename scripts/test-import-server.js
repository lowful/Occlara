'use strict';

/**
 * THE SERVER'S HALF OF IMPORTED RECORDINGS (8.12, docs/claude/import.md):
 * the three /api/usage/import routes, the gate on an import's reads and its
 * review, and how its row is settled. claim_import itself is SQL, and is stood
 * in for here with the rule it holds; the SQL file's own numbers and grants are
 * checked as text.
 *
 * Run: npm run test:importserver
 */

const fs = require('fs');
const path = require('path');
const { makeDb, makeIssuer, call, USER_A, USER_B, newToken, sha } = require('./test-caller');

const SERVER = path.join(__dirname, '..', 'server');
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));
const clientUsage = require('../src/shared/usage');
const limits = require(path.join(SERVER, 'services', 'rate-limits.js'));

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

function rig() {
  let clock = Date.parse('2026-11-17T12:00:00.000Z');
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, ENFORCE_CAPS: '0' };
  const db = makeDb({ now: () => clock });
  const issuer = makeIssuer();
  const plans = new Map();
  const realRpc = db.client.rpc;
  const importRows = (u) => db.tables.game_usage.filter((g) => g.user_id === u && g.kind === 'import');
  const state = (u) => {
    const p = plans.get(u) || { tier: 'free', allowance: 4, bonus: 0 };
    const used = importRows(u).filter((g) => ['reserved', 'counted'].includes(g.status) && !g.import_past_limit).length;
    const monthly = p.tier === 'pro' ? 5 : null;
    return { p, used, monthly, imports_left: monthly === null ? null : Math.max(monthly - used, 0) };
  };
  db.client.rpc = async (name, args) => {
    if (name === 'import_state') {
      const { p, monthly, imports_left } = state(args.p_user);
      const paid = p.tier !== 'free';
      const reason = !paid ? 'plan' : monthly && imports_left === 0 && p.bonus <= 0 ? 'imports' : p.allowance + p.bonus <= 0 ? 'games' : null;
      return { data: { tier: p.tier, allowed: !reason, reason, monthly, imports_left, games_left: p.allowance + p.bonus, bonus_pool: p.bonus }, error: null };
    }
    if (name === 'claim_import') {
      if (db.claimMissing) return { data: null, error: { code: '42883', message: 'no function' } };
      const { p, monthly, imports_left } = state(args.p_user);
      const answer = (o) => ({ data: { tier: p.tier, monthly, imports_left, games_left: p.allowance + p.bonus, bonus_pool: p.bonus, ...o }, error: null });
      const had = importRows(args.p_user).find((g) => g.client_match_id === args.p_client_match_id);
      if (had) return answer({ granted: had.status !== 'refunded', usage_id: had.id, reason: 'existing' });
      if (p.tier === 'free') return answer({ granted: false, reason: 'plan' });
      let past = false;
      if (monthly && imports_left === 0) {
        if (p.bonus <= 0) return answer({ granted: false, reason: 'imports' });
        p.bonus--; past = true;
      } else if (p.allowance > 0) p.allowance--;
      else if (p.bonus > 0) p.bonus--;
      else return answer({ granted: false, reason: 'games' });
      const row = { id: `use-${db.tables.game_usage.length + 1}`, user_id: args.p_user, kind: 'import', game: 'valorant',
        client_match_id: args.p_client_match_id, status: 'reserved', source: 'allowance', reads: 0, match_reads: 0,
        import_past_limit: past, created_at: new Date(clock).toISOString() };
      db.tables.game_usage.push(row);
      return answer({ granted: true, usage_id: row.id, imports_left: state(args.p_user).imports_left, games_left: p.allowance + p.bonus });
    }
    return realRpc(name, args);
  };
  const resolver = callers.createResolver({ supabase: db.client, fetch: issuer.fetch, now: () => clock, env,
    checkKey: async () => 'invalid', keyOwner: () => null });
  const meter = usage.createMeter({ supabase: db.client, resolver, now: () => clock, env });
  const router = usage.createRouter({ supabase: db.client, resolver, meter, env, now: () => clock });
  const sign = (user) => {
    const token = newToken();
    db.tables.app_sessions.push({ id: `s-${token.slice(4, 10)}`, user_id: user, token_hash: sha(token), device_hash: 'dev',
      created_at: new Date(clock).toISOString(), last_seen: new Date(clock).toISOString(), revoked_at: null });
    return { Authorization: `Bearer ${token}` };
  };
  return { db, plans, resolver, meter, router, sign, tick: (ms) => { clock += ms; } };
}

(async () => {
  const t = rig();
  const { db, plans, meter, router } = t;
  for (const id of [USER_A, USER_B]) {
    db.users.set(id, { id, email: `${id[0]}@example.com`, email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' });
  }
  const a = t.sign(USER_A);
  const claim = (job, headers = a) => call(router, 'POST', '/usage/import', { headers, body: { job_id: job } });
  const end = (job, outcome, headers = a) => call(router, 'POST', '/usage/import/end', { headers, body: { job_id: job, outcome } });
  const job = (n) => `job-${String(n).padStart(8, '0')}`;
  const rowOf = (j) => db.tables.game_usage.find((g) => g.client_match_id === `import:${j}`);

  ok((await call(router, 'POST', '/usage/import', { body: { job_id: job(0) } })).status === 401, 'no account, no import');
  plans.set(USER_A, { tier: 'free', allowance: 4, bonus: 3 });
  ok((await call(router, 'GET', '/usage/import', { headers: a })).body.reason === 'plan', 'the panel tells Free it is a plan feature');
  const free = await claim(job(1));
  ok(free.status === 403 && free.body.error === 'plan' && !rowOf(job(1)), 'Free is refused 403 plan, bonus games or not, and nothing is written');
  ok((await claim('NOT A JOB!')).status === 400, 'a malformed job id is refused');

  plans.set(USER_A, { tier: 'pro', allowance: 25, bonus: 0 });
  for (let i = 10; i < 15; i++) ok((await claim(job(i))).status === 200, `Pro import ${i - 9} of 5 is granted`);
  const again = await claim(job(10));
  ok(again.status === 200 && db.tables.game_usage.length === 5, 'the same job claimed again takes nothing more');
  const sixth = await claim(job(15));
  ok(sixth.status === 402 && sixth.body.error === 'imports' && sixth.body.importsLeft === 0, 'the sixth is refused 402 imports');
  plans.get(USER_A).bonus = 1;
  const bought = await claim(job(16));
  ok(bought.status === 200 && rowOf(job(16)).import_past_limit === true && plans.get(USER_A).bonus === 0, 'a bought game opens one more');
  plans.set(USER_A, { tier: 'max', allowance: 0, bonus: 0 });
  const noGame = await claim(job(17));
  ok(noGame.status === 402 && noGame.body.error === 'games', 'Max with no game left is refused, with ENFORCE_CAPS off too');
  plans.set(USER_A, { tier: 'max', allowance: 2, bonus: 0 });
  ok((await claim(job(18))).body.importsLeft === null, 'Max has no monthly import count');

  // Reads
  const caller = { userId: USER_A, accountKey: `u:${USER_A}`, deviceHash: 'dev' };
  const other = { userId: USER_B, accountKey: `u:${USER_B}`, deviceHash: 'dev' };
  ok((await meter.importGate(caller, job(18))).ok, 'a claimed import may read');
  const stolen = await meter.importGate(other, job(18));
  ok(!stolen.ok && stolen.status === 402 && stolen.body.error === 'cap', "another account cannot read on it");
  ok(!(await meter.importGate(caller, job(99))).ok, 'an id nobody claimed reads nothing');
  await meter.noteImportRead(caller, job(18), { inMatch: true });
  await meter.noteImportRead(caller, job(18), { inMatch: false });
  const live = meter.imports.get(`${USER_A}|${job(18)}`);
  ok(live.reads === 2 && live.matchReads === 1 && meter.rows.size === 0, 'its reads go on its row and open no live game');
  live.reads = usage.LIMITS.IMPORT_MAX_READS;
  ok(!(await meter.importGate(caller, job(18))).ok, 'and stop at the most an hour of video needs');
  live.reads = 2;

  // Settling
  ok((await end(job(18), 'cancelled')).body.status === 'refunded' && rowOf(job(18)).status === 'refunded', 'cancelled before 120 match frames: given back');
  ok(!(await meter.importGate(caller, job(18))).ok, 'and it can read no more');
  await claim(job(19));
  await meter.importGate(caller, job(19));
  meter.imports.get(`${USER_A}|${job(19)}`).matchReads = 120;
  ok((await end(job(19), 'cancelled')).body.status === 'counted', 'cancelled from 120 match frames: counted');
  plans.get(USER_A).allowance = 3;
  await claim(job(20));
  ok((await end(job(20), 'failed')).body.status === 'refunded', 'failed: given back');
  await claim(job(21));
  await meter.importGate(caller, job(21));
  await meter.importReviewed(caller, job(21));
  ok(rowOf(job(21)).status === 'counted', 'its review being written counts it');
  ok(!(await meter.importGate(caller, job(21))).ok, 'after which an old id reads nothing');
  let looks = 0;
  for (let i = 0; i < 6; i++) if ((await meter.importGate(caller, job(21), { what: 'look' })).ok) looks++;
  ok(looks === usage.LIMITS.REVIEWS_PER_GAME, `its looks stop at ${usage.LIMITS.REVIEWS_PER_GAME}`);
  ok((await end(job(21), 'failed')).body.status === 'counted', 'a settled import does not move');
  ok((await end(job(21), 'nonsense')).status === 400, 'an unknown outcome is refused');

  plans.get(USER_A).allowance = 3;
  db.claimMissing = true;
  const missing = await claim(job(22));
  ok(missing.status === 503 && missing.body.error === 'imports-not-ready', 'before the SQL runs an import fails closed');
  ok(t.resolver.accountsLive() === true, 'and the missing function does not take accounts down for everyone');

  // The header, the limit, the numbers
  ok(usage.importIdOf({ headers: { 'x-occlara-import': job(1) } }) === job(1) && usage.importIdOf({ headers: { 'x-occlara-import': 'x y' } }) === null,
    'the import header holds its known positive and refuses the rest');
  const row = limits.routeLimits({ now: () => 0 }).find((r) => r.paths.includes('/api/usage/import'));
  ok(!!row, 'the claim has a rate limit of its own');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sql', '0012_imported_recordings.sql'), 'utf8');
  ok(callers.IMPORTS_PER_MONTH_PRO === 5 && clientUsage.IMPORTS_PRO === 5 && (sql.match(/e\.tier = 'pro' THEN 5 ELSE NULL/g) || []).length === 2,
    'the server, the app and both SQL functions say 5');
  for (const fn of ['count_imports(uuid, timestamptz)', 'import_state(uuid)', 'claim_import(uuid, text, text)', 'entitlement_settle_stale(uuid)']) {
    ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
      && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`), `${fn} is for the service role only`);
  }
  console.log(fails ? `\n${fails} of ${checks} import server checks FAILED` : `\nall ${checks} import server checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e); process.exit(1); });
