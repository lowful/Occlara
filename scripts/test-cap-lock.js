'use strict';

/**
 * THE LOCK (8.7.3): an account that has used every game is locked, on every
 * route that costs a model, before the model is asked.
 *
 *   SHADOW. With ENFORCE_CAPS unset nothing is ever refused: a Free account
 *   at 4 of 4, a Pro at 25 of 25, one whose bonus games are used and a legacy
 *   licence key all read, are reviewed and claim, past the cap as 'shadow'.
 *   ENFORCED. With ENFORCE_CAPS=1 the same accounts are told capped by
 *   /account/me (what Start trusts), and the read, the agent look, the look at
 *   a death and the review are each 402 { error: 'cap' } with the model never
 *   called and no cost booked; a new game's claim is refused and writes no
 *   row. A legacy key is capped only from LEGACY_CAP_FROM.
 *   THE LAST GAME'S REVIEWS. An account whose last game is counted gets that
 *   game's reviews and looks (the engine's and the late one), REVIEWS_PER_GAME
 *   of each at most while it has no game left: the six hour window no longer
 *   hands it a review of every refused match after it.
 *   GIVEN BACK. A game that ended short is refunded within the three a day,
 *   and the player can play again; past three the game stays used.
 *   BOUGHT GAMES. Games added to the bonus pool (a purchase) let a capped
 *   account read and claim again.
 *
 * The real coach and usage routes against the in-memory Supabase of
 * test-caller.js and a scripted model. Nothing leaves the machine.
 *
 * Run: npm run test:caplock
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
for (const v of ['AI_PROVIDER', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_READ_MODEL', 'AI_REVIEW_MODEL',
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL', 'ENFORCE_CAPS', 'LEGACY_CAP_FROM']) delete process.env[v];
process.env.ADMIN_PASSWORD = 'lock-password';
process.env.OCCLARA_NO_METER_SWEEP = '1';

const { makeDb, call, newToken, sha } = require('./test-caller');

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
const REVIEW_TEXT = 'You held the angle well. You died first twice on B. Next match trade your duelist.';
const ai = { reply: 'LOBBY', calls: 0 };
global.fetch = async (url) => {
  if (!String(url).includes('/chat/completions')) throw new Error(`unexpected network call to ${url}`);
  ai.calls++;
  const json = { choices: [{ message: { content: typeof ai.reply === 'function' ? ai.reply() : ai.reply }, finish_reason: 'stop' }],
    usage: { cost: 0.001 } };
  return { status: 200, ok: true, text: async () => JSON.stringify(json), json: async () => json };
};

const SERVER = path.join(__dirname, '..', 'server');
const coach = require(path.join(SERVER, 'routes', 'coach.js'));
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));
const meter = usage.createMeter({ supabase: db.client, resolver: callers.shared, now: () => clock });
coach.__test.setMeter(meter);
const router = usage.createRouter({ supabase: db.client, resolver: callers.shared, meter, now: () => clock });
const { FREE_GAMES } = callers;
const { REVIEWS_PER_GAME, REFUNDS_PER_DAY } = usage.LIMITS;

const IN_MATCH = 'STATE: {"side":"attack","phase":"active","round":4,"team":2,"enemy":1,"hp":100,"alive":true}';
const IMG = 'aGVsbG8=';
const wait = () => new Promise((r) => setTimeout(r, 15));
const usageOf = (u) => db.tables.game_usage.filter((g) => g.user_id === u);
const entOf = (u) => db.tables.entitlements.find((x) => x.user_id === u);
const uid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const costs = () => JSON.stringify(coach.costs.report());

/** An account at `used` games: tier free (FREE_GAMES for life) or pro (25 a month), with bonus games used beside. */
async function account(id, { tier = 'free', used = 0, bonusUsed = 0, bonusPool = 0, session = true } = {}) {
  await db.client.rpc('ensure_entitlement', { p_user: id });
  const e = entOf(id);
  if (tier !== 'free') Object.assign(e, { tier, cap_monthly: tier === 'pro' ? 25 : 70, source: 'stripe' });
  e.bonus_pool = bonusPool;
  const row = (i, source) => db.tables.game_usage.push({ id: `used-${id}-${source}-${i}`, user_id: id, kind: 'riot', game: 'valorant',
    status: 'counted', source, period_start: e.period_anchor, created_at: new Date(clock - 864e5).toISOString(), match_reads: 0, reads: 0 });
  for (let i = 0; i < used; i++) row(i, tier === 'free' ? 'free' : 'allowance');
  for (let i = 0; i < bonusUsed; i++) row(i, 'bonus');
  if (!session) return null;
  const token = newToken();
  db.tables.app_sessions.push({ id: `s-${id}`, user_id: id, token_hash: sha(token), device_hash: sha(`dev-${id}`),
    created_at: new Date(clock).toISOString(), last_seen: new Date(Date.now()).toISOString(), revoked_at: null });
  return { Authorization: `Bearer ${token}`, 'X-Occlara-Version': '8.7.2' };
}

/** A legacy licence key (a paid plan, its user never signed in to the app) at 25 of 25. */
let keys = 0;
async function legacyKey(id) {
  await account(id, { tier: 'pro', used: 25, session: false });
  keys++;
  const KEY = `GC-LEGA-CY${String(keys).padStart(2, '0')}-AAAA-BBBB`;
  db.tables.licenses.push({ license_key: KEY, status: 'active', plan: 'monthly', user_id: id,
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  return { 'X-License-Key': KEY, 'X-Occlara-Version': '8.6.0' };
}

const read = (H) => call(coach, 'POST', '/read', { headers: H, body: { image: IMG, context: {} } });
const look = (H) => call(coach, 'POST', '/death-forensics', { headers: H, body: { agent: 'Jett', map: 'Ascent',
  deaths: [{ n: 3, frames: ['x'.repeat(5000)], side: 'attack' }] } });
const review = (H, extra = {}) => call(coach, 'POST', '/match-review', { headers: H, body: { tips: ['a', 'b', 'c'], ...extra } });
const agent = (H) => call(coach, 'POST', '/detect-agent', { headers: H, body: { image: IMG } });
const me = (H) => call(router, 'GET', '/account/me', { headers: H });
const claim = (H, id) => call(router, 'POST', '/usage/claim', { headers: H, body: { game: 'valorant', kind: 'riot', client_match_id: id, device_id: 'pc-1' } });

function enforce(on, legacyFrom) {
  if (on) process.env.ENFORCE_CAPS = '1'; else delete process.env.ENFORCE_CAPS;
  if (legacyFrom) process.env.LEGACY_CAP_FROM = legacyFrom; else delete process.env.LEGACY_CAP_FROM;
  meter.allow.clear();
}

/** Every model route for a caller, in a match: their statuses, the model calls and the cost booked. */
async function everyModelRoute(H) {
  const calls = ai.calls;
  const cost = costs();
  const rows = db.tables.game_usage.length;
  ai.reply = IN_MATCH;
  const r = await read(H);
  await wait();
  const a = await agent(H);
  const l = await look(H);
  ai.reply = REVIEW_TEXT;
  const v = await review(H);
  await wait();
  return { read: r, agent: a, look: l, review: v, modelCalls: ai.calls - calls, costMoved: costs() !== cost,
    newRows: db.tables.game_usage.length - rows };
}

const ACCOUNTS = [
  ['a Free account at 4 of 4', (id) => account(id, { used: FREE_GAMES })],
  ['a Pro account at 25 of 25', (id) => account(id, { tier: 'pro', used: 25 })],
  ['a Free account whose bonus games are used too', (id) => account(id, { used: FREE_GAMES, bonusUsed: 3, bonusPool: 0 })],
];

(async () => {
  // ── ENFORCE_CAPS unset: shadow, never refused ──────────────────────────
  enforce(false);
  let n = 100;
  for (const [what, make] of ACCOUNTS) {
    const id = uid(++n);
    const H = await make(id);
    const m = await me(H);
    const r = await everyModelRoute(H);
    const live = usageOf(id).find((g) => g.kind === 'live');
    const c = await claim(H, `riot:shadow-${id}`);
    ok(m.status === 200 && m.body.capped === false && m.body.enforce === false,
      `shadow: ${what} is never told capped (${m.body.left} left)`);
    ok(r.read.status === 200 && r.agent.status === 200 && r.look.status === 200 && r.review.status === 200 && r.modelCalls >= 4,
      `shadow: ${what} reads, is looked at and reviewed (${r.read.status} ${r.agent.status} ${r.look.status} ${r.review.status})`);
    ok(live && live.source === 'shadow' && live.over_cap === true && c.body.granted === true && c.body.reason === 'shadow',
      `shadow: and its games are counted past the cap as shadow, never refused (${live && live.source}, claim ${c.body.reason})`);
  }
  {
    const id = uid(++n);
    const H = await legacyKey(id);
    const r = await everyModelRoute(H);
    ok(r.read.status === 200 && r.review.status === 200, `shadow: a legacy licence key at 25 of 25 reads and is reviewed (${r.read.status})`);
  }

  // ── ENFORCE_CAPS=1: every model route refused, before the model ────────
  enforce(true);
  for (const [what, make] of ACCOUNTS) {
    const id = uid(++n);
    const H = await make(id);
    const m = await me(H);
    ok(m.status === 200 && m.body.capped === true && m.body.left === 0,
      `enforced: ${what} is told capped by /account/me, which Start refuses on (${m.body.left} left)`);
    const r = await everyModelRoute(H);
    ok(r.read.status === 402 && r.read.body.error === 'cap' && r.agent.status === 402 && r.agent.body.error === 'cap'
      && r.look.status === 402 && r.look.body.error === 'cap' && r.review.status === 402 && r.review.body.review === null,
    `enforced: ${what} is 402 cap on the read, the agent look, the look at a death and the review (${r.read.status} ${r.agent.status} ${r.look.status} ${r.review.status})`);
    ok(r.modelCalls === 0 && !r.costMoved && r.newRows === 0,
      `enforced: and for ${what} no model is called, no cost is booked and no game is written (${r.modelCalls} calls)`);
    const c = await claim(H, `riot:capped-${id}`);
    ok(c.status === 200 && c.body.granted === false && c.body.reason === 'cap' && !usageOf(id).some((g) => g.client_match_id === `riot:capped-${id}`),
      `enforced: a new game's claim for ${what} is refused, so its review is saved locked (${c.body.reason})`);
  }
  {
    const id = uid(++n);
    const H = await legacyKey(id);
    const r = await everyModelRoute(H);
    ok(r.read.status === 200 && r.review.status === 200,
      `enforced: a legacy licence key is not capped while LEGACY_CAP_FROM is unset (${r.read.status})`);
    enforce(true, '2020-01-01');
    // A second legacy key with no game in the last six hours (the first's shadow game is reviewable).
    const H2 = await legacyKey(uid(++n));
    const r2 = await everyModelRoute(H2);
    ok(r2.read.status === 402 && r2.look.status === 402 && r2.review.status === 402 && r2.agent.status === 402 && r2.modelCalls === 0 && !r2.costMoved,
      `enforced: and from LEGACY_CAP_FROM it is locked like any account, no model called (${r2.read.status} ${r2.review.status})`);
    enforce(true);
  }

  // ── The last game's reviews, and no more ───────────────────────────────
  {
    const id = uid(++n);
    const H = await account(id, { tier: 'pro', used: 24 });
    ai.reply = IN_MATCH;
    for (let i = 0; i < 3; i++) await read(H);
    await wait();
    const g = usageOf(id).find((x) => x.kind === 'live');
    ok(g && g.status === 'reserved' && g.source === 'allowance', 'the 25th game is claimed on its first in-match read');
    ai.reply = REVIEW_TEXT;
    const engineLook = await look(H);
    const engineReview = await review(H);
    await wait();
    clock += 3 * 60 * 1000;
    const lateLook = await look(H);
    const lateReview = await review(H, { matchId: 'riot-25' });
    ok(engineLook.status === 200 && engineReview.status === 200 && lateLook.status === 200 && lateReview.status === 200 && g.status === 'counted',
      `the last game is looked at and reviewed twice, the engine's and the late one (${engineReview.status} ${lateReview.status}, ${g.status})`);
    // Match 26: the read gate refuses it before the model.
    clock += 5 * 60 * 1000;
    ai.reply = IN_MATCH;
    const calls = ai.calls;
    const next = await read(H);
    ok(next.status === 402 && next.body.error === 'cap' && ai.calls === calls, `the next match's read is 402 cap (${next.status})`);
    // A client that asks for the refused match's review anyway (an old or a changed one).
    ai.reply = REVIEW_TEXT;
    let reviews = 2;
    let looks = 2;
    for (let i = 0; i < 10; i++) {
      if ((await review(H)).status === 200) reviews++;
      if ((await look(H)).status === 200) looks++;
    }
    ok(reviews === REVIEWS_PER_GAME && looks === REVIEWS_PER_GAME,
      `with no game left, one counted game gets ${REVIEWS_PER_GAME} reviews and ${REVIEWS_PER_GAME} looks at most, then 402 (${reviews}, ${looks}); before 8.7.3 every one for six hours`);
    // An account WITH games left is not budgeted: its reviews are only rate limited.
    const id2 = uid(++n);
    const H2 = await account(id2, { tier: 'pro', used: 0 });
    ai.reply = IN_MATCH;
    await read(H2);
    await wait();
    ai.reply = REVIEW_TEXT;
    let free = 0;
    for (let i = 0; i < 8; i++) if ((await review(H2)).status === 200) free++;
    ok(free === 8, `an account with games left is never budgeted by the review gate (${free} of 8)`);
  }

  // ── Given back within three a day ──────────────────────────────────────
  {
    const id = uid(++n);
    const H = await account(id, { tier: 'pro', used: 24 });
    const statuses = [];
    for (let m = 0; m < REFUNDS_PER_DAY + 1; m++) {
      ai.reply = IN_MATCH;
      const r = await read(H);
      statuses.push(r.status);
      await wait();
      clock += 46 * 60 * 1000;
      await meter.sweep();
    }
    const live = usageOf(id).filter((g) => g.kind === 'live');
    ok(statuses.every((s) => s === 200) && live.slice(0, REFUNDS_PER_DAY).every((g) => g.status === 'refunded' && g.reason === 'short'),
      `a last game that ended short is given back and the player plays again, ${REFUNDS_PER_DAY} times a day (${live.map((g) => g.status).join(', ')})`);
    ok(live[REFUNDS_PER_DAY] && live[REFUNDS_PER_DAY].status === 'counted' && live[REFUNDS_PER_DAY].reason === 'refund-cap',
      'the fourth that day is counted (refund-cap)');
    meter.allow.clear();
    ai.reply = IN_MATCH;
    const after = await read(H);
    ok(after.status === 402, `so the account is capped again and the next match is refused (${after.status})`);
  }

  // ── Bought games let a capped account play again ───────────────────────
  {
    const id = uid(++n);
    const H = await account(id, { used: FREE_GAMES });
    ai.reply = IN_MATCH;
    const before = await read(H);
    ok(before.status === 402, 'a Free account at 4 of 4 is refused');
    entOf(id).bonus_pool = 5;            // the webhook's grant of five bought games
    clock += 31 * 1000;                  // past the gate's 30 second memory of the count
    callers.shared.forgetEntitlement(id);
    const m = await me(H);
    const r = await read(H);
    await wait();
    const live = usageOf(id).find((g) => g.kind === 'live');
    ok(m.body.capped === false && m.body.left === 5 && r.status === 200 && live && live.source === 'bonus' && entOf(id).bonus_pool === 4,
      `after buying five games it reads again, the game played on the bonus pool (${r.status}, ${live && live.source}, ${entOf(id).bonus_pool} left in the pool)`);
    const c = await claim(H, `riot:bought-${id}`);
    ok(c.body.granted === true && entOf(id).bonus_pool === 3, `and a Riot record review claims a bought game too (${c.body.granted})`);
  }

  // ── Ask Coach is locked too (8.7.3), said the way each client can say it ──
  {
    const { CHAT_LOCK_LINES, chatLedger } = coach.__test;
    const ANSWER = 'Hold the angle on B and trade your duelist.';
    const chat = (H, v, ctx = {}) => call(coach, 'POST', '/chat', { headers: { ...H, 'X-Occlara-Version': v },
      body: { messages: [{ role: 'user', content: `How do I hold B? (${Math.random()})` }], context: ctx } });
    const frame = (H, v) => call(coach, 'POST', '/frame-chat', { headers: { ...H, 'X-Occlara-Version': v },
      body: { question: `Why did I die here? (${Math.random()})`, images: [`${'x'.repeat(200)}${Math.random()}`] } });
    const noVersion = (H) => { const h = { ...H }; delete h['X-Occlara-Version']; return h; };
    // What each client version is told: [version, what, check(status, body)].
    const SHAPES = [
      ['no version', null, (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.site],
      ['8.4.4', '8.4.4', (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.site],
      ['8.6.0', '8.6.0', (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.site],
      ['8.7.0', '8.7.0', (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.site],
      ['8.7.1', '8.7.1', (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.site],
      ['8.7.2', '8.7.2', (s, b) => s === 200 && b.reply === CHAT_LOCK_LINES.profile],
      ['8.7.3', '8.7.3', (s, b) => s === 429 && b.error === 'chat-cap' && b.left === 0 && b.reply === undefined],
      ['8.8.0', '8.8.0', (s, b) => s === 429 && b.error === 'chat-cap'],
    ];
    ok(Object.values(CHAT_LOCK_LINES).every((l) => !new RegExp(`[${String.fromCharCode(0x2013, 0x2014)};]`).test(l)) && /Profile/.test(CHAT_LOCK_LINES.profile) && !/Profile/.test(CHAT_LOCK_LINES.site),
      'the lock\'s two lines carry no dash and no semicolon, and only 8.7.2\'s names the Profile page');
    enforce(true);
    for (const [what, make] of ACCOUNTS.slice(0, 2)) {
      const id = uid(++n);
      const H = await make(id);
      const calls = ai.calls;
      const cost = costs();
      ai.reply = ANSWER;
      const seen = [];
      for (const [label, v, shape] of SHAPES) {
        const h = v ? H : noVersion(H);
        const a = await chat(h, v || undefined);
        const v2 = v && v >= '8.5.0' ? await chat(h, v, { v: 2, language: 'en' }) : a;
        const f = await frame(h, v || undefined);
        seen.push(`${label} ${a.status}/${v2.status}/${f.status}`);
        ok(shape(a.status, a.body) && shape(v2.status, v2.body) && shape(f.status, f.body),
          `enforced: ${what} asking from ${label} is locked on chat${v && v >= '8.5.0' ? ', v2 chat' : ''} and frame chat (${a.status} ${JSON.stringify(a.body).slice(0, 60)})`);
      }
      ok(ai.calls === calls && costs() === cost && !chatLedger.has(`u:${id}`),
        `enforced: and for ${what} no model is called, no cost is booked and no daily cap line is written (${ai.calls - calls} calls)`);
    }
    // Shadow: nothing changes.
    enforce(false);
    {
      const id = uid(++n);
      const H = await account(id, { used: FREE_GAMES });
      ai.reply = ANSWER;
      const calls = ai.calls;
      const a = await chat(H, '8.7.3');
      ok(a.status === 200 && a.body.reply === ANSWER && ai.calls === calls + 1,
        `shadow: a Free account at 4 of 4 is answered by the model as before (${a.status})`);
    }
    // An outage: account_state cannot be read, so the question is answered as today.
    enforce(true);
    {
      const id = uid(++n);
      const H = await account(id, { used: FREE_GAMES });
      await me(H);                     // the session is known before the database goes
      meter.allow.clear();
      db.outage = true;
      ai.reply = ANSWER;
      const calls = ai.calls;
      const a = await chat(H, '8.7.3');
      db.outage = false;
      callers.shared.reset && callers.shared.reset();
      ok(a.status === 200 && a.body.reply === ANSWER && ai.calls === calls + 1,
        `enforced: when account_state cannot be read the question is answered, never locked on an unknown (${a.status})`);
    }
    // An account with games left is answered.
    {
      const id = uid(++n);
      const H = await account(id, { tier: 'pro', used: 3 });
      ai.reply = ANSWER;
      const a = await chat(H, '8.7.3');
      await new Promise((r) => setTimeout(r, 2100));   // the spam guard's 2 s gap (test:chatspam)
      const f = await frame(H, '8.7.3');
      ok(a.status === 200 && a.body.reply === ANSWER && f.status === 200 && f.body.reply,
        `enforced: a Pro account at 3 of 25 is answered on chat and frame chat (${a.status} ${f.status})`);
    }
    // Bought games unlock at once: the webhook's grant forgets the meter's memory.
    {
      const id = uid(++n);
      const H = await account(id, { used: FREE_GAMES });
      ai.reply = IN_MATCH;
      await read(H);                   // a refused read, remembered by the gate
      ai.reply = ANSWER;
      const before = await chat(H, '8.7.3');
      entOf(id).bonus_pool = 5;        // the webhook's grant_purchased_games
      let forgot = 'meter.forget';
      try {
        const hook = require(path.join(SERVER, 'routes', 'webhook.js')).__test.forgetGamesLeft;
        // The webhook finds the meter loaded in its process: the one these routes use is this test's.
        const real = usage.meter;
        usage.meter = meter;
        hook(id);
        usage.meter = real;
        forgot = 'the webhook\'s forgetGamesLeft';
      } catch { meter.forget(id); callers.shared.forgetEntitlement(id); }
      const calls = ai.calls;
      const after = await chat(H, '8.7.3');
      ok(before.status === 429 && before.body.error === 'chat-cap' && after.status === 200 && after.body.reply === ANSWER && ai.calls === calls + 1,
        `a capped Free account that buys games asks again at once, no 30 s wait, through ${forgot} (${before.status} then ${after.status})`);
    }
    // A Pro account whose month rolls over asks again.
    {
      const id = uid(++n);
      const H = await account(id, { tier: 'pro', used: 25 });
      ai.reply = ANSWER;
      const before = await chat(H, '8.7.2');
      const was = clock;
      clock += 32 * 864e5;
      const calls = ai.calls;
      const after = await chat(H, '8.7.3');
      clock = was;
      ok(before.status === 200 && before.body.reply === CHAT_LOCK_LINES.profile && after.status === 200 && after.body.reply === ANSWER && ai.calls === calls + 1,
        `a Pro account at 25 of 25 asks again once its month rolls over (${before.status} then ${after.status})`);
    }
  }

  coach.__test.setMeter(null);
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' cap lock checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
