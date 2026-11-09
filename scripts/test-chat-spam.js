'use strict';

/**
 * ASK COACH CANNOT BE SPAMMED (8.7.3): services/chat-guard.js, on its own on
 * a stand in clock, then through the real /chat and /frame-chat routes
 * against the in-memory Supabase of test-caller.js and a scripted model.
 *
 *   ONE AT A TIME. A second question while the first is being answered is
 *   429 'chat-one-at-a-time' with the "one at a time" sentence, no model call.
 *   A GAP. A question under 2 s after the last began is 429 'chat-gap'.
 *   A BURST. The sixth accepted question in a minute is 429 'chat-burst'.
 *   A REPEAT. The same question about the same match within 30 s is the
 *   answer again from memory, no model call; a failure, the honest line and a
 *   cap line are never remembered, so a retry after an error reaches the model.
 *   Every refusal carries Retry-After, two accounts never share a bucket,
 *   each is free again once its window passes, old keys are swept and the
 *   maps never pass MAX_KEYS. A bench is never guarded. The question is
 *   clipped before any prompt (frame chat 500, a chat message 1,200).
 *
 * Nothing leaves the machine. Run: npm run test:chatspam
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
for (const v of ['AI_PROVIDER', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_READ_MODEL', 'AI_REVIEW_MODEL', 'AI_CHAT_MODEL',
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL', 'ENFORCE_CAPS', 'LEGACY_CAP_FROM', 'CHAT_PROMPT',
  'CHAT_DAY_USD', 'CHAT_DAY_QUESTIONS']) delete process.env[v];
process.env.ADMIN_PASSWORD = 'spam-password';
process.env.OCCLARA_NO_METER_SWEEP = '1';

const { makeDb, newToken, sha } = require('./test-caller');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const SERVER = path.join(__dirname, '..', 'server');
const guardMod = require(path.join(SERVER, 'services', 'chat-guard.js'));
const { CHAT_LIMITS, createChatGuard, questionKey, ONE_AT_A_TIME, TOO_FAST } = guardMod;

// ── The guard alone, on a stand in clock ───────────────────────────────────
function unit() {
  let t = 1_000_000;
  const g = createChatGuard({ now: () => t });
  const q = (s) => questionKey('chat', s, 'm1');

  ok(CHAT_LIMITS.BURST_MAX === 5 && CHAT_LIMITS.BURST_WINDOW_MS === 60000 && CHAT_LIMITS.GAP_MS === 2000
    && CHAT_LIMITS.REPEAT_MS === 30000 && CHAT_LIMITS.LIMITER_MAX === 25 && CHAT_LIMITS.LIMITER_WINDOW_MS === 300000,
  'the numbers: 5 a minute, a 2 s gap, one at a time, a repeat within 30 s, and the limiter\'s 25 in 5 minutes');
  ok([ONE_AT_A_TIME, TOO_FAST].every((l) => !new RegExp(`[${String.fromCharCode(0x2013, 0x2014)};]`).test(l)), 'the guard\'s sentences carry no dash and no semicolon');

  // One at a time.
  const a = g.begin('a:1', q('first'));
  const b = g.begin('a:1', q('second'));
  ok(a.ok && !b.ok && b.body.what === 'chat-one-at-a-time' && b.body.message === ONE_AT_A_TIME && b.retryAfter >= 1,
    `a second question while the first is answered is refused, one at a time (${b.body && b.body.what}, Retry-After ${b.retryAfter})`);
  const other = g.begin('a:2', q('first'));
  ok(other.ok, 'another account is not held up by it');
  other.end();
  a.end();
  a.end();
  // The gap: under 2 s since the first began.
  t += 500;
  const c = g.begin('a:1', q('third'));
  ok(!c.ok && c.body.what === 'chat-gap' && c.retryAfter === 2 && c.body.message === TOO_FAST,
    `a question 0.5 s after the last began is refused with Retry-After 2 (${c.body && c.body.what})`);
  t += 1500;
  const d = g.begin('a:1', q('third'));
  ok(d.ok, 'at 2 s it goes');
  d.end();
  // The burst: 5 accepted a minute (a and d so far).
  let accepted = 2;
  let refused = null;
  for (let i = 0; i < 6; i++) {
    t += 2000;
    const r = g.begin('a:1', q(`burst ${i}`));
    if (r.ok) { accepted++; r.end(); } else if (!refused) refused = r;
  }
  ok(accepted === CHAT_LIMITS.BURST_MAX && refused && refused.body.what === 'chat-burst' && refused.retryAfter > 0 && refused.retryAfter <= 60,
    `the sixth question in a minute is refused (${accepted} accepted, Retry-After ${refused && refused.retryAfter})`);
  // Refusals do not count: the account is free once the window turns.
  t = 1_000_000 + CHAT_LIMITS.BURST_WINDOW_MS + 1;
  const e = g.begin('a:1', q('after the window'));
  ok(e.ok, 'once the minute has passed the account asks again');
  // The repeat: an answer is remembered, a failure is not.
  e.keep({ reply: 'Trade your duelist.' });
  e.end();
  t += 100;
  const rep = g.begin('a:1', q('After  the WINDOW'));
  ok(!rep.ok && rep.repeat && rep.repeat.reply === 'Trade your duelist.',
    'the same question again (case and spaces aside) within 30 s is the answer from memory, ahead of the gap');
  const elsewhere = g.begin('a:1', questionKey('chat', 'after the window', 'm2'));
  ok(!elsewhere.ok && elsewhere.body && elsewhere.body.what === 'chat-gap', 'the same words about another match are a new question');
  t += 2000;
  const f = g.begin('a:1', q('one that fails'));
  f.keep({ error: 'Chat failed' });
  f.keep(null);
  f.end();
  t += 2000;
  const retry = g.begin('a:1', q('one that fails'));
  ok(retry.ok, 'a retry after a failure goes to the model: a failure is never remembered');
  retry.end();
  t += CHAT_LIMITS.REPEAT_MS + 1;
  const old = g.begin('a:1', q('after the window'));
  ok(old.ok, 'past 30 s the same question is asked again');
  old.end();
  // A turn never ended stops holding the account after IN_FLIGHT_MS.
  t += 5000;
  const stuck = g.begin('a:3', q('stuck'));
  t += CHAT_LIMITS.IN_FLIGHT_MS + 1;
  const freed = g.begin('a:3', q('next'));
  ok(stuck.ok && freed.ok, 'a turn that never ended stops holding its account after a minute');
  freed.end();
  // Sweeping and the bound.
  t += 10 * 60 * 1000;
  g.begin('a:4', q('sweep')).end();
  ok(!g.bursts.has('a:1') && !g.answers.size && !g.last.has('a:1') && !g.flying.has('a:3'),
    'old keys are swept: past their window nothing of an account is kept');
  const small = createChatGuard({ now: () => t, limits: { MAX_KEYS: 50 } });
  for (let i = 0; i < 400; i++) { const r = small.begin(`a:${i}`, q('x')); r.keep({ reply: 'y' }); r.end(); }
  ok(small.bursts.size <= 50 && small.last.size <= 50 && small.answers.size <= 50 && small.flying.size <= 50,
    `no map passes MAX_KEYS (${small.bursts.size}, ${small.last.size}, ${small.answers.size})`);
}

// ── The routes ─────────────────────────────────────────────────────────────
let clock = Date.parse('2026-11-04T12:00:00.000Z');
const db = makeDb({ now: () => Date.now() });
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return db.client;
  return realLoad(request, parent, isMain);
};

const ai = { reply: 'Hold the angle on B and trade your duelist.', calls: 0, hold: null, fail: false };
global.fetch = async (url) => {
  if (!String(url).includes('/chat/completions')) throw new Error(`unexpected network call to ${url}`);
  ai.calls++;
  if (ai.hold) await ai.hold;
  if (ai.fail) return { status: 500, ok: false, text: async () => '{"error":"down"}', json: async () => ({ error: 'down' }) };
  const json = { choices: [{ message: { content: ai.reply }, finish_reason: 'stop' }], usage: { cost: 0.0001 } };
  return { status: 200, ok: true, text: async () => JSON.stringify(json), json: async () => json };
};

const coach = require(path.join(SERVER, 'routes', 'coach.js'));

/** test-caller's call, keeping the headers set. */
function call(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 60000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const set = {};
    const req = { method, url, originalUrl: `/api/coach${url}`, path: url, body, ip: '203.0.113.9',
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), query: {} };
    const res = {
      statusCode: 200, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { set[k.toLowerCase()] = v; }, set(k, v) { set[k.toLowerCase()] = v; return this; }, type() { return this; },
      json(b) { this.headersSent = true; done({ status: this.statusCode, body: b, headers: set }); return this; },
      send(b) { this.headersSent = true; done({ status: this.statusCode, body: b, headers: set }); return this; },
      end() { this.headersSent = true; done({ status: this.statusCode, body: null, headers: set }); return this; },
    };
    router(req, res, (err) => (err ? reject(err) : done({ status: 404, body: null, headers: set })));
  });
}

let users = 0;
async function account() {
  users++;
  const id = `${String(users).padStart(8, '0')}-0000-4000-8000-${String(users).padStart(12, '0')}`;
  await db.client.rpc('ensure_entitlement', { p_user: id });
  const e = db.tables.entitlements.find((x) => x.user_id === id);
  Object.assign(e, { tier: 'pro', cap_monthly: 25, source: 'stripe' });
  const token = newToken();
  db.tables.app_sessions.push({ id: `s-${id}`, user_id: id, token_hash: sha(token), device_hash: sha(`dev-${id}`),
    created_at: new Date().toISOString(), last_seen: new Date().toISOString(), revoked_at: null });
  return { Authorization: `Bearer ${token}`, 'X-Occlara-Version': '8.7.3' };
}

const chat = (H, q, extra = {}) => call(coach, 'POST', '/chat', { headers: H,
  body: { messages: [{ role: 'user', content: q }], context: { matchReview: 'Ascent, Jett, 13 to 9' }, ...extra } });
const frame = (H, q, img = 'f'.repeat(300)) => call(coach, 'POST', '/frame-chat', { headers: H, body: { question: q, images: [img] } });

async function routes() {
  const t = { now: Date.now() };
  // A stand in clock for the guard alone; the rest of the route keeps real time.
  coach.__test.setChatGuard(createChatGuard({ now: () => t.now }));
  const tick = (ms) => { t.now += ms; };

  // One at a time, through the route: the first held at the model.
  {
    const H = await account();
    let release;
    ai.hold = new Promise((r) => { release = r; });
    const calls = ai.calls;
    const first = chat(H, 'How do I hold B on Ascent?');
    await new Promise((r) => setTimeout(r, 30));
    tick(3000);
    const second = await chat(H, 'And A?');
    const third = await frame(H, 'Why did I die here?');
    release();
    ai.hold = null;
    const one = await first;
    ok(second.status === 429 && second.body.what === 'chat-one-at-a-time' && second.body.message === ONE_AT_A_TIME
      && Number(second.headers['retry-after']) >= 1 && third.status === 429 && third.body.what === 'chat-one-at-a-time',
    `while a question is answered a second, chat or frame chat, is 429 one at a time with Retry-After (${second.status} ${third.status}, ${second.headers['retry-after']})`);
    ok(one.status === 200 && ai.calls === calls + 1, `and only the first reached the model (${ai.calls - calls} call)`);
    tick(3000);
    const after = await chat(H, 'And A?');
    ok(after.status === 200, `once it is answered the next goes (${after.status})`);
  }

  // The gap and the burst, per account, with Retry-After.
  {
    const H = await account();
    const H2 = await account();
    const a = await chat(H, 'q1');
    tick(500);
    const gap = await chat(H, 'q2');
    const other = await chat(H2, 'q1');
    ok(a.status === 200 && gap.status === 429 && gap.body.what === 'chat-gap' && gap.headers['retry-after'] === '2' && other.status === 200,
      `0.5 s later the same account is 429 with Retry-After 2, another account is answered (${gap.status} ${gap.headers['retry-after']}, ${other.status})`);
    let n = 1;
    let refused = null;
    const calls = ai.calls;
    for (let i = 0; i < 6; i++) {
      tick(2500);
      const r = await (i % 2 ? frame(H, `frame ${i}`) : chat(H, `burst ${i}`));
      if (r.status === 200) n++; else if (!refused) refused = r;
    }
    ok(n === CHAT_LIMITS.BURST_MAX && refused && refused.status === 429 && refused.body.what === 'chat-burst'
      && Number(refused.headers['retry-after']) > 0 && ai.calls === calls + (n - 1),
    `chat and frame chat share five a minute: the sixth is 429 with Retry-After, no model call (${n}, ${refused && refused.headers['retry-after']})`);
    tick(CHAT_LIMITS.BURST_WINDOW_MS);
    const back = await chat(H, 'after the minute');
    ok(back.status === 200, `a minute on the account is answered again (${back.status})`);
  }

  // The repeat: the answer again from memory; a failure and the honest line are not remembered.
  {
    const H = await account();
    const first = await chat(H, 'Where am I losing rounds?');
    tick(3000);
    const calls = ai.calls;
    const again = await chat(H, 'where am i  losing rounds?');
    ok(again.status === 200 && again.body.reply === first.body.reply && ai.calls === calls,
      'the same question about the same match within 30 s is the same answer, no model call');
    const otherMatch = await call(coach, 'POST', '/chat', { headers: H,
      body: { messages: [{ role: 'user', content: 'Where am I losing rounds?' }], context: { matchReview: 'Bind, Sova, 9 to 13' } } });
    ok(otherMatch.status === 200 && ai.calls === calls + 1, 'the same words about another match are a new question, asked of the model');
    tick(3000);
    ai.fail = true;
    // Not 'What should I buy?' since the economy went out of scope (Nov 2026): that is answered with the scope line, no model.
    const failed = await chat(H, 'What should I practise?');
    ai.fail = false;
    tick(3000);
    const c2 = ai.calls;
    const retry = await chat(H, 'What should I practise?');
    ok(failed.status >= 500 && retry.status === 200 && ai.calls > c2,
      `a retry after an error reaches the model and is answered (${failed.status} then ${retry.status})`);
    tick(CHAT_LIMITS.BURST_WINDOW_MS);   // five asked this minute already
    const f1 = await frame(H, 'Why did I die?', 'g'.repeat(300));
    tick(3000);
    const c3 = ai.calls;
    const f2 = await frame(H, 'why did I die?', 'g'.repeat(300));
    tick(3000);
    const f3 = await frame(H, 'why did I die?', 'h'.repeat(300));
    ok(f1.status === 200 && f2.body.reply === f1.body.reply && f3.status === 200 && ai.calls === c3 + 1,
      'frame chat: the same question about the same frame is remembered, about another frame it is asked');
    // v2's honest line is never remembered.
    tick(3000);
    ai.reply = 'not json at all {';
    const H3 = await account();
    const v2 = { context: { v: 2, language: 'en', match: { matchId: 'm-honest' } } };
    const h1 = await chat(H3, 'Walk me through round 4', v2);
    tick(3000);
    const c4 = ai.calls;
    const h2 = await chat(H3, 'Walk me through round 4', v2);
    ai.reply = 'Hold the angle on B and trade your duelist.';
    ok(h1.status === 200 && h2.status === 200 && ai.calls > c4,
      `the honest line, or any answer the gates could not stand behind, is never remembered (${h1.body && (h1.body.honest ? 'honest' : 'v1')}, asked again: ${ai.calls - c4} call)`);
  }

  // A bench is never guarded.
  {
    const H = { 'X-Admin-Password': 'spam-password', ...(await account()) };
    let all = true;
    for (let i = 0; i < 8; i++) {
      const r = await call(coach, 'POST', '/chat', { headers: H,
        body: { messages: [{ role: 'user', content: `bench ${i}` }], context: {}, benchModel: 'x' } });
      if (r.status === 429) all = false;
    }
    ok(all, 'an admin bench asking eight in a row is never guarded');
  }

  // The question is clipped before any prompt: confirmed, not changed.
  {
    const H = await account();
    let sent = '';
    const realFetch = global.fetch;
    global.fetch = async (url, init) => { sent = String((init && init.body) || ''); return realFetch(url, init); };
    tick(3000);
    await frame(H, `${'a'.repeat(499)}Z${'b'.repeat(2000)}`);
    const frameClipped = sent.includes(`${'a'.repeat(499)}Z`) && !sent.includes('Zb');
    tick(3000);
    await chat(H, `${'c'.repeat(1199)}Y${'d'.repeat(5000)}`);
    const chatClipped = sent.includes(`${'c'.repeat(1199)}Y`) && !sent.includes('Yd');
    global.fetch = realFetch;
    ok(frameClipped && chatClipped && CHAT_LIMITS.FRAME_QUESTION_CHARS === 500 && CHAT_LIMITS.CHAT_MESSAGE_CHARS === 1200,
      `a frame question is clipped at 500 characters and a chat message at 1,200 before the prompt (${frameClipped}, ${chatClipped})`);
  }
  coach.__test.setChatGuard(null);
  void clock;
}

(async () => {
  unit();
  await routes();
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' chat spam checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
