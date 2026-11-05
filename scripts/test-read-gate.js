'use strict';

/**
 * THE READ GATE AND THE LIVE GAME (8.7): coach.js /read, /death-forensics and
 * /match-review with the usage meter (routes/usage.js).
 *
 *   BEFORE THE MODEL. With ENFORCE_CAPS=1 a caller with no live game open and
 *   no game left is answered 402 { error: 'cap', left: 0 } and the model is
 *   never called. ENFORCE_CAPS unset never refuses, and counts in shadow.
 *   THE FIRST IN-MATCH READ claims the game, once however many reads arrive at
 *   once; a LOBBY reply never does. match_reads is written at most once every
 *   ten seconds per game; the 120th in-match read counts it.
 *   THE REVIEW GATE. The look at a death and the review need the live game,
 *   open or counted, before any model is asked; a review written counts it.
 *   ENDED SHORT. A game with fewer than 120 in-match reads and no review is
 *   given back, three a day; the fourth is counted ('refund-cap'). A new
 *   match after a gap settles the last one first, so two matches are never
 *   one game.
 *   NOT LIVE. With the accounts tables or functions missing (42P01, PGRST205,
 *   PGRST202) an 8.6 key reads exactly as before, ENFORCE_CAPS=1 or not.
 *   A BENCH is never metered.
 *
 * Real coach routes against the in-memory Supabase of test-caller.js and a
 * scripted model. Nothing leaves the machine.
 *
 * Run: npm run test:readgate
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
for (const v of ['AI_PROVIDER', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_READ_MODEL', 'AI_REVIEW_MODEL',
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL', 'ENFORCE_CAPS', 'LEGACY_CAP_FROM']) delete process.env[v];
process.env.ADMIN_PASSWORD = 'gate-password';
process.env.OCCLARA_NO_METER_SWEEP = '1';

const { makeDb, call, newToken, sha, USER_A, USER_B } = require('./test-caller');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

let clock = Date.parse('2026-11-04T12:00:00.000Z');
const db = makeDb({ now: () => clock });
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return db.client;
  return realLoad(request, parent, isMain);
};

// ── The model, scripted ─────────────────────────────────────────────────────
const ai = { reply: 'LOBBY', calls: 0 };
global.fetch = async (url) => {
  if (!String(url).includes('/chat/completions')) throw new Error(`unexpected network call to ${url}`);
  ai.calls++;
  const json = { choices: [{ message: { content: typeof ai.reply === 'function' ? ai.reply() : ai.reply }, finish_reason: 'stop' }] };
  return { status: 200, ok: true, text: async () => JSON.stringify(json), json: async () => json };
};

const SERVER = path.join(__dirname, '..', 'server');
const coach = require(path.join(SERVER, 'routes', 'coach.js'));
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));
const meter = usage.createMeter({ supabase: db.client, resolver: callers.shared, now: () => clock });
coach.__test.setMeter(meter);

const IN_MATCH = 'STATE: {"side":"attack","phase":"active","round":4,"team":2,"enemy":1,"hp":100,"alive":true}';
const IMG = 'aGVsbG8=';
const wait = () => new Promise((r) => setTimeout(r, 15));
const usageOf = (u) => db.tables.game_usage.filter((g) => g.user_id === u);
const claims = (u) => db.rpcCalls.filter((c) => c.name === 'claim_game' && c.args.p_user === u).length;

/** A signed in player: an entitlement and an app session. */
async function player(id, { tier = 'free', used = 0 } = {}) {
  await db.client.rpc('ensure_entitlement', { p_user: id });
  const e = db.tables.entitlements.find((x) => x.user_id === id);
  if (tier !== 'free') Object.assign(e, { tier, cap_monthly: tier === 'pro' ? 25 : 70, source: 'stripe' });
  for (let i = 0; i < used; i++) {
    db.tables.game_usage.push({ id: `used-${id}-${i}`, user_id: id, kind: 'riot', game: 'valorant', status: 'counted', source: 'free',
      period_start: e.period_anchor, created_at: new Date(clock - 864e5).toISOString(), match_reads: 0, reads: 0 });
  }
  const token = newToken();
  db.tables.app_sessions.push({ id: `s-${id}`, user_id: id, token_hash: sha(token), device_hash: sha(`dev-${id}`),
    created_at: new Date(clock).toISOString(), last_seen: new Date(Date.now()).toISOString(), revoked_at: null });
  return { Authorization: `Bearer ${token}` };
}
const read = (headers, extra = {}) => call(coach, 'POST', '/read', { headers, body: { image: IMG, context: {}, ...extra } });

const uid = (n) => `${String(n).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`.slice(0, 36);

(async () => {
  // ── What a read in a match is ───────────────────────────────────────────
  const { inMatchState } = coach.__test;
  ok(inMatchState({ phase: 'buy' }, true) && inMatchState({ roundNumber: 3 }, true) && inMatchState({ teamScore: 0, enemyScore: 0 }, true)
    && !inMatchState({}, true) && !inMatchState({ phase: 'buy' }, false) && !inMatchState({ teamScore: 1 }, true),
  'a reply is in a match when its STATE names a phase, a round or the score; an empty or unparsed one is not');

  // ── ENFORCE_CAPS off: never refused, counted in shadow ─────────────────
  const A = await player(USER_A);
  ai.reply = 'LOBBY';
  const lobby = await read(A);
  await wait();
  ok(lobby.status === 200 && lobby.body.lobby === true && claims(USER_A) === 0, 'a LOBBY reply claims nothing');
  ai.reply = IN_MATCH;
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => read(A)));
  await wait();
  ok(burst.every((r) => r.status === 200 && r.body.lobby === false) && claims(USER_A) === 1 && usageOf(USER_A).length === 1
    && usageOf(USER_A)[0].kind === 'live' && usageOf(USER_A)[0].status === 'reserved' && db.rpcCalls.find((c) => c.name === 'claim_game').args.p_enforce === false,
  `the first in-match reads claim ONE live game, however many arrive at once, with p_enforce false (${claims(USER_A)} claims)`);
  const writes = () => db.calls.filter((c) => c.table === 'game_usage' && c.op === 'update').length;
  const w0 = writes();
  for (let i = 0; i < 20; i++) await read(A);
  await wait();
  ok(writes() - w0 <= 1, `twenty reads inside ten seconds write match_reads at most once (${writes() - w0})`);
  clock += 11 * 1000;
  await read(A);
  await wait();
  ok(writes() - w0 >= 1 && usageOf(USER_A)[0].match_reads >= 20, `ten seconds on, they are written (${usageOf(USER_A)[0].match_reads} match reads)`);
  for (let i = 0; i < 100; i++) await read(A);
  await wait();
  const counted = usageOf(USER_A)[0];
  ok(counted.status === 'counted' && counted.reason === 'reads' && counted.match_reads >= 120,
    `the 120th in-match read counts the game (${counted.status}, ${counted.match_reads})`);

  // ── ENFORCE_CAPS=1: refused BEFORE the model ───────────────────────────
  process.env.ENFORCE_CAPS = '1';
  const B = await player(USER_B, { used: callers.FREE_GAMES });
  const before = ai.calls;
  const capped = await read(B);
  ok(capped.status === 402 && capped.body.error === 'cap' && capped.body.left === 0 && ai.calls === before,
    `a free account with its free games used and no game open is 402 cap, and the model is never called (${capped.status})`);
  const look = await call(coach, 'POST', '/death-forensics', { headers: B, body: { agent: 'Jett', map: 'Ascent',
    deaths: [{ n: 3, frames: ['x'.repeat(5000)], side: 'attack' }] } });
  const rev = await call(coach, 'POST', '/match-review', { headers: B, body: { tips: ['a', 'b', 'c'] } });
  ok(look.status === 402 && look.body.error === 'cap' && rev.status === 402 && rev.body.review === null && ai.calls === before,
    'and the look at a death and the review are 402 without a live game, the model never asked');
  // S9: the agent look called a vision model with no gate at all.
  const agentLook = await call(coach, 'POST', '/detect-agent', { headers: B, body: { image: IMG } });
  ok(agentLook.status === 402 && agentLook.body.error === 'cap' && ai.calls === before,
    `and so is the agent look, the model never asked (${agentLook.status})`);
  // A database that cannot answer lets the read through.
  meter.allow.clear();
  db.outage = true;
  callers.shared._caches.sessions.forEach((v) => { v.at = Date.now(); });
  const through = await read(B);
  db.outage = false;
  ok(through.status === 200 && ai.calls === before + 1, `a gate that cannot ask the database lets the read through (${through.status})`);
  // The paid account with its game open reads on and is reviewed.
  const r1 = await read(A);
  ok(r1.status === 200, 'a player whose live game is counted reads on in that match');
  const look2 = await call(coach, 'POST', '/death-forensics', { headers: A, body: { agent: 'Jett', map: 'Ascent',
    deaths: [{ n: 3, frames: ['x'.repeat(5000)], side: 'attack' }] } });
  ok(look2.status === 200 && Array.isArray(look2.body.deaths), `and the look at a death has its game, so it is asked (${look2.status})`);

  // ── A review counts its game ───────────────────────────────────────────
  const C_ID = uid(3);
  const C = await player(C_ID);
  ai.reply = IN_MATCH;
  for (let i = 0; i < 5; i++) await read(C);
  await wait();
  ok(usageOf(C_ID).length === 1 && usageOf(C_ID)[0].status === 'reserved' && db.rpcCalls.filter((c) => c.name === 'claim_game').pop().args.p_enforce === true,
    'with ENFORCE_CAPS=1 a session claims with p_enforce true');
  ai.reply = 'You held the angle well. You died first twice on B. Next match trade your duelist.';
  const review = await call(coach, 'POST', '/match-review', { headers: C, body: { tips: ['a', 'b', 'c'] } });
  await wait();
  ok(review.status === 200 && review.body.review && usageOf(C_ID)[0].status === 'counted' && usageOf(C_ID)[0].reason === 'review',
    `a review written counts its live game (${usageOf(C_ID)[0].status} ${usageOf(C_ID)[0].reason})`);

  // ── Ended short: given back, three a day ───────────────────────────────
  process.env.ENFORCE_CAPS = '0';
  const D_ID = uid(4);
  const D = await player(D_ID, { tier: 'pro' });
  for (let m = 0; m < 4; m++) {
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) await read(D);
    await wait();
    clock += 46 * 60 * 1000;
    await meter.sweep();
  }
  const dRows = usageOf(D_ID).filter((g) => g.kind === 'live');
  ok(dRows.length === 4 && dRows.slice(0, 3).every((g) => g.status === 'refunded' && g.reason === 'short')
    && dRows[3].status === 'counted' && dRows[3].reason === 'refund-cap',
  `a game that ended short is given back three times a day, the fourth counted (${dRows.map((g) => `${g.status}/${g.reason}`).join(', ')})`);
  // A new match after a gap settles the last one first.
  const E_ID = uid(5);
  const E = await player(E_ID, { tier: 'pro' });
  ai.reply = IN_MATCH;
  for (let i = 0; i < 3; i++) await read(E);
  await wait();
  clock += 5 * 60 * 1000;
  await read(E);
  await wait();
  const eRows = usageOf(E_ID);
  ok(eRows.length === 2 && eRows[0].status === 'refunded' && eRows[1].status === 'reserved' && eRows[0].id !== eRows[1].id,
    `a match read after a gap is a new game, the last one settled first (${eRows.map((g) => g.status).join(', ')})`);

  // ── A restart mid match on the last game: the open row lets it read on ──
  {
    process.env.ENFORCE_CAPS = '1';
    const G_ID = uid(8);
    const G = await player(G_ID, { used: callers.FREE_GAMES - 1 });
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) await read(G);
    await wait();
    ok(usageOf(G_ID).filter((g) => g.kind === 'live').length === 1, 'the last free game is claimed live');
    // A Railway deploy: the meter's memory is gone, the reserved row is only in the database.
    meter.rows.clear(); meter.allow.clear(); meter.opens.clear();
    const after = await read(G);
    await wait();
    ok(after.status === 200 && usageOf(G_ID).filter((g) => g.kind === 'live').length === 1,
      `after a restart mid match the player's own last game reads on, its open row reused (${after.status})`);
    // And a row a restart left reserved past 3 hours is given back where left is worked out.
    meter.rows.clear(); meter.allow.clear(); meter.opens.clear();
    clock += 4 * 60 * 60 * 1000;
    const later = await read(G);
    await wait();
    const live = usageOf(G_ID).filter((g) => g.kind === 'live');
    ok(later.status === 200 && live[0].status === 'refunded' && live[0].reason === 'stale',
      `four hours on, the orphaned row is refunded stale by account_state and the player is not locked out (${later.status} ${live[0].status})`);
    process.env.ENFORCE_CAPS = '0';
  }

  // ── One account on two PCs at once is two games ────────────────────────
  {
    const I_ID = uid(9);
    const I1 = await player(I_ID, { tier: 'pro' });
    const token2 = newToken();
    db.tables.app_sessions.push({ id: `s2-${I_ID}`, user_id: I_ID, token_hash: sha(token2), device_hash: sha(`dev2-${I_ID}`),
      created_at: new Date(clock).toISOString(), last_seen: new Date(Date.now()).toISOString(), revoked_at: null });
    const I2 = { Authorization: `Bearer ${token2}` };
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) { await read(I1); await read(I2); }
    await wait();
    const rowsI = usageOf(I_ID).filter((g) => g.kind === 'live');
    ok(rowsI.length === 2 && rowsI[0].device_hash !== rowsI[1].device_hash,
      `two PCs playing at once on one account are two live games, one per device (${rowsI.length})`);
  }

  // ── A late review never counts the next match ──────────────────────────
  {
    const J_ID = uid(1).replace(/^1/, 'a');
    const J = await player(J_ID, { tier: 'pro' });
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) await read(J);
    await wait();
    ai.reply = 'You held the angle well. You died first twice on B. Next match trade your duelist.';
    await call(coach, 'POST', '/match-review', { headers: J, body: { tips: ['a', 'b', 'c'] } });
    await wait();
    const m1 = usageOf(J_ID)[0];
    ok(m1.status === 'counted' && m1.reason === 'review', 'the engine\'s review at match end counts match 1');
    clock += 5 * 60 * 1000;
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) await read(J);
    await wait();
    const m2 = usageOf(J_ID)[1];
    ok(m2 && m2.status === 'reserved', 'match 2 is claimed');
    ai.reply = 'You held the angle well. You died first twice on B. Next match trade your duelist.';
    const lateReview = await call(coach, 'POST', '/match-review', { headers: J, body: { tips: ['a', 'b', 'c'], matchId: 'riot-match-1' } });
    await wait();
    ok(lateReview.status === 200 && m2.status === 'reserved',
      `Riot's late review of match 1 (it carries the matchId) leaves match 2, being played, alone (${m2.status})`);
    ai.reply = IN_MATCH;
    await read(J);
    await wait();
    ok(usageOf(J_ID).length === 2, 'so match 2 reads on in its own row, never charged twice');
    // Its own late review, a minute after its last in-match read, counts it.
    clock += 2 * 60 * 1000;
    ai.reply = 'You held the angle well. You died first twice on B. Next match trade your duelist.';
    await call(coach, 'POST', '/match-review', { headers: J, body: { tips: ['a', 'b', 'c'], matchId: 'riot-match-2' } });
    await wait();
    ok(m2.status === 'counted' && m2.reason === 'review', 'and a late review of a match that is over counts its row');
  }

  // ── A counted game is over when the read sees 0-0 again (S1) ───────────
  {
    const L_ID = uid(3).replace(/^3/, 'c');
    const L = await player(L_ID, { tier: 'pro' });
    ai.reply = 'STATE: {"side":"attack","phase":"active","round":9,"team":5,"enemy":3,"hp":100,"alive":true}';
    for (let i = 0; i < 125; i++) await read(L);
    await wait();
    ok(usageOf(L_ID).length === 1 && usageOf(L_ID)[0].status === 'counted', 'a match read 125 times at 5-3 is one counted game');
    clock += 3 * 60 * 1000;
    ai.reply = 'STATE: {"side":"defense","phase":"buy","round":1,"team":0,"enemy":0,"hp":100,"alive":true}';
    for (let i = 0; i < 3; i++) { await read(L); await wait(); }
    ok(usageOf(L_ID).length === 2 && usageOf(L_ID)[1].status === 'reserved',
      `the next match, read at 0-0 three minutes later with no review between, claims its own game through /read (${usageOf(L_ID).length} rows)`);
  }

  // ── No client match id is taken on /read ───────────────────────────────
  {
    const K_ID = uid(2).replace(/^2/, 'b');
    const K = await player(K_ID);
    ai.reply = IN_MATCH;
    await read(K, { clientMatchId: 'replayed-id' });
    await wait();
    const asked = db.rpcCalls.filter((c) => c.name === 'claim_game' && c.args.p_user === K_ID);
    ok(asked.length === 1 && asked[0].args.p_client_match_id === null,
      'a /read body\'s clientMatchId is ignored: a live claim never carries one (it would replay an old counted game)');
  }

  // ── A bench is never metered ───────────────────────────────────────────
  const F_ID = uid(6);
  const F = await player(F_ID);
  await read({ ...F, 'X-Admin-Password': 'gate-password' }, { variant: 'c' });
  await wait();
  ok(usageOf(F_ID).length === 0, 'an admin bench read claims nothing');

  // ── Not live: an 8.6 key reads exactly as before ───────────────────────
  for (const code of ['42P01', 'PGRST205', 'PGRST202']) {
    process.env.ENFORCE_CAPS = '1';
    callers.shared.reset();
    meter.rows.clear(); meter.allow.clear();
    const KEY = `GC-OLD${code.slice(-1)}-AAAA-BBBB-CCCC`;
    db.tables.licenses.push({ license_key: KEY, status: 'active', plan: 'free', user_id: uid(7),
      expires_at: new Date(Date.now() + 864e5).toISOString() });
    if (code === 'PGRST202') db.rpcMissing = true;
    else { db.missingCode = code; for (const t of ['entitlements', 'game_usage', 'app_sessions']) db.missing.add(t); }
    const rpcBefore = db.rpcCalls.length;
    const callsBefore = ai.calls;
    ai.reply = IN_MATCH;
    const results = [];
    // A free key needs an app that knows a free account (8.7, caller.js knowsFreeKeys).
    const H = { 'X-License-Key': KEY, 'X-Occlara-Version': '8.7.0' };
    for (let i = 0; i < 5; i++) results.push(await read(H));
    await wait();
    const look3 = await call(coach, 'POST', '/death-forensics', { headers: H, body: { agent: 'Jett', map: 'Ascent',
      deaths: [{ n: 3, frames: ['x'.repeat(5000)], side: 'attack' }] } });
    ok(results.every((r) => r.status === 200 && r.body.lobby === false) && ai.calls === callsBefore + 5 + 1 && look3.status === 200,
      `with the migration not applied (${code}) a free plan 8.6 key reads and is looked at, ENFORCE_CAPS=1 or not`);
    ok(db.rpcCalls.length - rpcBefore <= 2, `and the missing functions are not asked on every read (${db.rpcCalls.length - rpcBefore} calls)`);
    db.missing.clear(); db.rpcMissing = false;
  }
  process.env.ENFORCE_CAPS = '0';

  // ── No credentials: 400, as 8.6 ────────────────────────────────────────
  const bare = await call(coach, 'POST', '/read', { body: { image: IMG } });
  ok(bare.status === 400 && /X-License-Key/.test(bare.body.error), 'a read with no credentials is still 400');
  // (Accounts live again: while they read as not live a session is 503, never 401.)
  callers.shared.reset();
  const badSession = await read({ Authorization: `Bearer ${newToken()}` });
  ok(badSession.status === 401 && badSession.body.error === 'session-invalid', 'and one with a session nobody issued is 401');

  coach.__test.setMeter(null);
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' read gate checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
