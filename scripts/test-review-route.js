'use strict';

/**
 * What the AI routes send when the model fails, and what they ask it to run.
 *
 *   /match-review answered a failure with HTTP 200 { review: 'Review
 *   generation failed.' }, and a reply whose summary the count gate emptied
 *   with 200 { review: 'Could not generate review.' }. Every client keeps a
 *   200's body and prints `review` as the coach's read, so the placeholder sat
 *   in the review window, went into the library and to Ask Coach, and the
 *   honest "the coach could not be reached" line never showed. Now: 503 (402
 *   for an empty wallet) with review: null, and an emptied summary is null
 *   with its round lines and focus kept.
 *
 *   /chat answered an empty wallet with 500 "Chat failed". Now 402.
 *
 *   /read ran whatever benchModel a licence named. Now only beside the admin
 *   password, and a bench is told which model answered.
 *
 *   A timed out call is now cancelled upstream, not just stopped waiting for.
 *
 * The provider is a stubbed fetch. Nothing leaves the machine.
 *
 * Run: npm run test:reviewroute
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'http://ai.test/v1';
for (const v of ['AI_PROVIDER', 'AI_READ_MODEL', 'AI_REVIEW_MODEL', 'AI_TEXT_MODEL', 'AI_VISION_MODEL',
  'AI_VISION_MODEL_DEEP', 'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL']) delete process.env[v];
process.env.ADMIN_PASSWORD = 'bench-password';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const KEY = 'GC-AAAA-BBBB-CCCC-DDDD';
const fakeSupabase = {
  from: () => {
    const api = {
      select: () => api, eq: () => api, abortSignal: () => api,
      single: async () => ({ data: { status: 'active', expires_at: null }, error: null }),
    };
    return api;
  },
};
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return fakeSupabase;
  return realLoad(request, parent, isMain);
};

// ── The AI provider, scripted ───────────────────────────────────────────────
// ai.next(body, init) answers { status, content } or returns a promise that
// never settles on its own. Every request is recorded.
const ai = { next: null, sent: [] };
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('http://ai.test/v1/chat/completions')) throw new Error(`unexpected network call to ${u}`);
  const body = JSON.parse(init.body);
  ai.sent.push({ model: body.model, signal: init.signal });
  const out = await ai.next(body, init);
  const json = { choices: [{ message: { content: out.content || '' }, finish_reason: 'stop' }] };
  return {
    status: out.status, ok: out.status >= 200 && out.status < 300,
    text: async () => (out.status === 200 ? JSON.stringify(json) : (out.text || 'error')),
    json: async () => json,
  };
};
const reply = (content) => () => ({ status: 200, content });

const coach = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));

function call(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const [, qs] = url.split('?');
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 8000);
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
const H = { 'X-License-Key': KEY };
const ROUNDS = [1, 2, 3, 4].map((n) => ({ n, side: 'attacking', result: n % 2 ? 'won' : 'lost', died: n % 2 === 0, reads: [] }));
const reviewBody = { rounds: ROUNDS, context: { agent: 'Jett', map: 'Abyss' } };

(async () => {
  // ── /match-review, the round ledger branch ────────────────────────────────
  ai.next = reply('SUMMARY: You won the rounds you opened with a trade behind you.\nR2: You took the duel alone.\nFOCUS: Wait for a teammate before you peek.');
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(r.status === 200 && r.body.summary && r.body.review === r.body.summary, 'a real summary is sent as the review');
  }
  // Every summary sentence carries an "N of M" count, so the count gate drops them all.
  ai.next = reply('SUMMARY: You died first in 6 of 12 attack rounds. You lost 3 of 4 rounds after the plant.\n'
    + 'R2: You took the duel alone, with nobody to trade you.\nFOCUS: Wait for a teammate before you peek.');
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(r.status === 200 && r.body.review === null && r.body.summary === null,
      `a summary the gate emptied is null, not "Could not generate review." (${JSON.stringify(r.body.review)})`);
    ok(r.body.rounds && r.body.rounds[2] && r.body.focus, 'and the round lines and focus that survived are kept');
  }
  ai.next = () => ({ status: 500, text: 'upstream exploded' });
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(r.status === 503 && r.body.review === null && r.body.error === 'review-unavailable',
      `a model failure is 503 with review null, not 200 "Review generation failed." (${r.status} ${JSON.stringify(r.body)})`);
    ok(!/failed|could not/i.test(JSON.stringify(r.body.review)), 'and no placeholder text rides along');
  }
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: { rounds: ROUNDS.slice(0, 2) } });
    ok(r.status === 200 && r.body.review === null && r.body.thin === true, 'under three rounds is still a thin null review');
  }

  // ── /match-review, the tips branch older clients send ────────────────────
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: { tips: ['one', 'two'] } });
    ok(r.status === 200 && r.body.review === null, 'too few tips is review null, not "Not enough data for a review."');
  }
  ai.next = () => ({ status: 500, text: 'upstream exploded' });
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: { tips: ['a tip', 'b tip', 'c tip'] } });
    ok(r.status === 503 && r.body.review === null, 'and a failure there is 503 with review null too');
  }

  // ── /read: who picks the model ────────────────────────────────────────────
  ai.next = reply('STATE: {"phase":"buy","team":3,"enemy":2}');
  const dear = 'google/gemini-3.5-flash-lite';
  {
    ai.sent.length = 0;
    const r = await call(coach, 'POST', '/read', { headers: H, body: { image: 'aGVsbG8=', context: {}, benchModel: dear } });
    ok(r.status === 200 && ai.sent[0] && ai.sent[0].model === 'deepseek/deepseek-v4.1-flash',
      `a licence asking for ${dear} still reads on the live model (${ai.sent[0] && ai.sent[0].model})`);
    ok(r.body.model === 'deepseek/deepseek-v4.1-flash', 'and a bench is told which model really answered');
  }
  {
    ai.sent.length = 0;
    const r = await call(coach, 'POST', '/read', {
      headers: { ...H, 'X-Admin-Password': 'bench-password' },
      body: { image: 'aGVsbG8=', context: {}, benchModel: dear },
    });
    ok(r.status === 200 && ai.sent[0].model === dear && r.body.model === dear, 'with the admin password the bench model runs');
  }
  {
    ai.sent.length = 0;
    const r = await call(coach, 'POST', '/read', { headers: H, body: { image: 'aGVsbG8=', context: {} } });
    ok(r.status === 200 && r.body.context && r.body.context.teamScore === 3 && !('model' in r.body),
      'a normal read is unchanged: STATE parsed, and no model field it never had');
    ok(ai.sent[0].signal && typeof ai.sent[0].signal.aborted === 'boolean', 'and its upstream request carries a deadline');
  }

  // ── a timed out call is cancelled upstream ───────────────────────────────
  {
    ai.sent.length = 0;
    ai.next = (body, init) => new Promise((_, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason || new Error('aborted')));
    });
    const t0 = Date.now();
    let err = null;
    try {
      await coach.ai.visionInfer('aGVsbG8=', 'read this', 10, false, 'deepseek/deepseek-v4.1-flash', { abortMs: 80 });
    } catch (e) { err = e; }
    ok(err && ai.sent[0].signal.aborted && Date.now() - t0 < 3000,
      `a call past its deadline is aborted, not left running (${err && err.name}, ${Date.now() - t0}ms)`);

    ai.sent.length = 0;
    let err2 = null;
    try { await coach.ai.textInfer('say something', 20, { timeoutMs: 60 }); } catch (e) { err2 = e; }
    await new Promise((r) => setTimeout(r, 1300));
    ok(err2 && ai.sent.length >= 1 && ai.sent[0].signal.aborted,
      'a text call that timed out is cancelled upstream a second later, rather than generating on');
  }

  // ── an empty wallet is 402, not a failure ────────────────────────────────
  ai.next = () => ({ status: 402, text: 'Insufficient credits' });
  {
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(r.status === 402 && r.body.error === 'ai-credits' && r.body.review === null,
      `out of credits, the review says so with 402 and no review text (${r.status})`);
  }
  {
    // The breaker is open now, so this one never reaches the provider at all.
    ai.sent.length = 0;
    const r = await call(coach, 'POST', '/chat', { headers: H,
      body: { messages: [{ role: 'user', content: 'How do I stop dying first?' }], context: {} } });
    ok(r.status === 402 && r.body.error === 'ai-credits',
      `Ask Coach out of credits is 402, which it has words for, not 500 "Chat failed" (${r.status})`);
    ok(ai.sent.length === 0, 'and the open breaker spent nothing finding that out');
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' review route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
