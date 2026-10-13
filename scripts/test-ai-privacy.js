'use strict';

/**
 * No model provider that keeps or trains on the frames.
 *
 * A read is a photograph of the player's whole main display once a second,
 * whatever else is on it. OpenRouter routes each call to one of a model's
 * providers, and its data_collection preference defaults to "allow", which
 * takes in providers that store requests and may train on them. chatCall sent
 * no preference at all.
 *
 * Held here, on a scripted provider (no network, no money):
 *   every call to OpenRouter carries provider: { data_collection: 'deny' },
 *     text and vision, the read route's, and both of chatCall's retries
 *   AI_DATA_COLLECTION=allow on Railway takes it off again, read on every call
 *   a provider that is not OpenRouter is sent no such field
 *
 * AND THE PREFERENCE NEVER TAKES THE PRODUCT DOWN. A model none of whose
 * providers deny collection has every call refused by OpenRouter (HTTP 404,
 * "No endpoints found matching your data policy"), so every read would fail.
 * Held: that one refusal is sent once more without the preference and
 * answers, booked as any call; it is counted under its route, said once a
 * route an hour, and GET /health shows dataPolicy { mode, fellBack,
 * refusedAgain, since } with nothing secret; a call refused again without it
 * (an account wide privacy setting, a model with no live provider) went to no
 * provider and is counted as refusedAgain, never as fallen back; any other
 * refusal (400, 401, 402, 403, 429, 5xx, a 404 for anything else) and a
 * timeout are never sent without it; with AI_DATA_COLLECTION=allow nothing is
 * sent and nothing retried.
 *
 * Run: npm run test:aiprivacy
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
for (const v of ['AI_PROVIDER', 'AI_READ_MODEL', 'AI_REVIEW_MODEL', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_COST_PER_CALL',
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL', 'AI_DATA_COLLECTION']) delete process.env[v];

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const fakeSupabase = {
  from: () => {
    const api = {
      select: () => api, eq: () => api, abortSignal: () => api, in: () => api,
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

// ── The provider, scripted: every request body kept ────────────────────────
// A reply with `hang` never answers: the call's own deadline aborts it.
const sent = [];
let reply = () => ({ status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });
global.fetch = async (url, init = {}) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  const r = reply(sent.length);
  if (r.hang) {
    return new Promise((_, rej) => {
      if (!init.signal) return;
      init.signal.addEventListener('abort', () => rej(init.signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }
  return {
    status: r.status, ok: r.status >= 200 && r.status < 300,
    text: async () => (r.status === 200 ? JSON.stringify(r.json) : (r.text || 'error')),
    json: async () => r.json,
  };
};

const COACH = path.join(__dirname, '..', 'server', 'routes', 'coach.js');
function loadCoach() {
  delete require.cache[require.resolve(COACH)];
  return require(COACH);
}

function call(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 8000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const req = { method, url, originalUrl: url, body, query: {},
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
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

// A test that stops early with nothing left to wait on exits 0 having checked
// nothing more: that is a failure, said as one.
let finished = false;
process.on('exit', (code) => {
  if (!finished && code === 0) { console.log('FAIL  the test ended before its last check'); process.exitCode = 1; }
});

const DENY = JSON.stringify({ data_collection: 'deny' });
const denies = (s) => s && JSON.stringify(s.body.provider) === DENY;
const IMG = 'x'.repeat(4000);

(async () => {
  let coach = loadCoach();

  // ── Every call to OpenRouter denies collection ────────────────────────────
  sent.length = 0;
  await coach.__test.textInfer('say ok', 5);
  ok(denies(sent[0]), `a text call asks OpenRouter for providers that keep nothing (${JSON.stringify(sent[0] && sent[0].body.provider)})`);
  sent.length = 0;
  await coach.__test.visionInfer(IMG, 'read this scoreboard', 20, false);
  ok(denies(sent[0]), 'and so does a call carrying a frame');
  ok(sent[0] && sent[0].body.usage && sent[0].body.usage.include === true, 'beside the usage it already asked for');

  sent.length = 0;
  const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': 'GC-AAAA-AAAA-AAAA-AAAA' },
    body: { image: 'aGVsbG8=', context: {} } });
  ok(r.status === 200 && sent.length >= 1 && sent.every(denies), `the live read's own request does (${r.status})`);

  // A provider that rejects the reasoning switch is asked again without it:
  // the second request still denies collection.
  sent.length = 0;
  reply = (n) => (n === 1 ? { status: 400, text: 'reasoning is not supported' }
    : { status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });
  await coach.__test.textInfer('say ok', 5);
  ok(sent.length === 2 && sent.every(denies), `and both requests of the retry without the reasoning switch (${sent.length})`);
  // A reasoner that spent its budget is asked again with headroom: the same.
  sent.length = 0;
  reply = (n) => (n === 1 ? { status: 200, json: { choices: [{ message: { content: '', reasoning: 'thinking' }, finish_reason: 'length' }] } }
    : { status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });
  await coach.__test.visionInfer(IMG, 'read this', 10, false);
  ok(sent.length === 2 && sent.every(denies), `and both requests of the retry with headroom (${sent.length})`);
  reply = () => ({ status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });

  // ── AI_DATA_COLLECTION=allow undoes it, without a deploy ──────────────────
  for (const v of ['allow', ' Allow ']) {
    process.env.AI_DATA_COLLECTION = v;
    sent.length = 0;
    await coach.__test.textInfer('say ok', 5);
    ok(sent[0] && !('provider' in sent[0].body), `AI_DATA_COLLECTION=${JSON.stringify(v)} sends the request as it was before, with no preference`);
  }
  for (const v of ['deny', '', 'yes']) {
    process.env.AI_DATA_COLLECTION = v;
    sent.length = 0;
    await coach.__test.textInfer('say ok', 5);
    ok(denies(sent[0]), `and any other value (${JSON.stringify(v)}) still denies`);
  }
  delete process.env.AI_DATA_COLLECTION;

  // ── The preference never takes the product down ───────────────────────────
  // OpenRouter's answer when no provider of the model takes the preference, as
  // integrators report it (HTTP 404; chatwise-releases#488 for the body).
  const POLICY_404 = (message) => ({ status: 404, text: JSON.stringify({ error: { message, code: 404 } }) });
  const REFUSED = POLICY_404('No endpoints found matching your data policy. Enable prompt training here: https://openrouter.ai/settings/privacy');
  const fine = (cost) => ({ status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    ...(cost !== undefined ? { usage: { prompt_tokens: 900, completion_tokens: 20, cost } } : {}) } });
  const KEY = 'GC-AAAA-AAAA-AAAA-AAAA';
  const caught = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };
  const logs = [];
  const realWarn = console.warn;
  const realError = console.error;
  console.warn = (...a) => { logs.push(a.join(' ')); };
  console.error = (...a) => { logs.push(a.join(' ')); };
  const policyLines = (route) => logs.filter((l) => l.startsWith(`[coach] ${route}: no provider of`));
  const refusedLines = (route) => logs.filter((l) => l.startsWith(`[coach] ${route}: `) && / was refused again without /.test(l));
  coach = loadCoach();
  // What /health is handed (liveModels), read so that a missing field fails the checks rather than crashing them.
  const policyNow = () => coach.liveModels().dataPolicy || {};
  const counts = () => policyNow().fellBack || {};
  const refused = () => policyNow().refusedAgain || {};
  const zero = { read: 0, forensics: 0, review: 0, chat: 0, other: 0 };
  ok(JSON.stringify(counts()) === JSON.stringify(zero) && JSON.stringify(refused()) === JSON.stringify(zero) && policyNow().mode === 'deny',
    `a server just started counts nothing, every route listed, asking deny (${JSON.stringify(coach.liveModels().dataPolicy)})`);
  {
    sent.length = 0;
    reply = (n) => (n === 1 ? REFUSED : fine(0.00042));
    const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'aGVsbG8=', context: {} } });
    ok(r.status === 200 && sent.length === 2 && denies(sent[0]) && !('provider' in sent[1].body),
      `a read OpenRouter refuses for the policy is sent once more without it, and answers (${r.status}, ${sent.length} requests)`);
    ok(sent[1] && sent[1].body.model === sent[0].body.model && sent[1].body.usage && sent[1].body.usage.include === true
      && JSON.stringify(sent[1].body.messages) === JSON.stringify(sent[0].body.messages),
    'the same request otherwise: the same model, the same frame, still asking its cost');
    const booked = coach.costs.report(null).today.routes.read;
    ok(booked.calls === 1 && booked.priced === 1 && Math.abs(booked.real - 0.00042) < 1e-9,
      `booked as usual: the answer at what it cost, the refusal at nothing (${JSON.stringify(booked)})`);
    ok(counts().read === 1, `and counted under the read (${JSON.stringify(counts())})`);
    ok(policyLines('read').length === 1 && /data_collection deny/.test(policyLines('read')[0])
      && /No endpoints found matching your data policy/.test(policyLines('read')[0]),
    `one line says so, OpenRouter's words in it (${policyLines('read')[0]})`);
  }
  {
    // Every route, each counted under its own name: the routes costScope books,
    // and a call made outside any route under other.
    const each = {
      forensics: () => coach.__test.asRoute('forensics', null, () => coach.__test.visionInfer([IMG, IMG], 'look at this death', 50, true)),
      review: () => coach.__test.asRoute('review', null, () => coach.__test.textInfer('write the review', 50, { json: true })),
      chat: () => coach.__test.asRoute('chat', null, () => coach.__test.textInfer('answer the player', 50)),
      other: () => coach.__test.textInfer('say ok', 5),
    };
    const answered = {};
    for (const [route, fn] of Object.entries(each)) {
      sent.length = 0;
      reply = (n) => (n === 1 ? REFUSED : fine(0.001));
      const out = await caught(fn);
      answered[route] = !out.error && sent.length === 2 && denies(sent[0]) && !('provider' in sent[1].body);
    }
    ok(Object.values(answered).every(Boolean), `the death look, the review, Ask Coach and the rest fall back the same (${JSON.stringify(answered)})`);
    ok(JSON.stringify(counts()) === JSON.stringify({ read: 1, forensics: 1, review: 1, chat: 1, other: 1 }),
      `each counted under its own route, and no other route is kept (${JSON.stringify(counts())})`);
    ok(['forensics', 'review', 'chat', 'other'].every((r) => policyLines(r).length === 1),
      'and each route says so in a line of its own');
  }
  {
    // One line a route an hour at most.
    for (let i = 0; i < 3; i++) {
      sent.length = 0;
      reply = (n) => (n === 1 ? REFUSED : fine(0.0004));
      await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'aGVsbG8=', context: {} } });
    }
    ok(counts().read === 4 && policyLines('read').length === 1,
      `three more reads that fall back are counted (${counts().read}) and say nothing more within the hour (${policyLines('read').length} line)`);
    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 60 * 1000;
    try {
      sent.length = 0;
      reply = (n) => (n === 1 ? REFUSED : fine(0.0004));
      await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'aGVsbG8=', context: {} } });
    } finally { Date.now = realNow; }
    ok(policyLines('read').length === 2 && /5 read call/.test(policyLines('read')[1]),
      `an hour on, the next says it again with the count (${policyLines('read')[1]})`);
    const all = logs.join('\n') + JSON.stringify(coach.liveModels().dataPolicy);
    const KEY_SHAPE = /GC-[A-Z0-9]{4}-/;
    ok(KEY_SHAPE.test(KEY) && !KEY_SHAPE.test(all) && !all.includes('test-ai-key'), 'no licence key and no provider key in the lines or the counts');
  }
  {
    // OpenRouter's other wordings of the same refusal.
    const wordings = ['No endpoints found matching your data policy (Zero data retention)', 'No endpoints found matching your data policy'];
    const took = [];
    for (const w of wordings) {
      sent.length = 0;
      reply = (n) => (n === 1 ? POLICY_404(w) : fine(0.0001));
      const out = await caught(() => coach.__test.textInfer('say ok', 5));
      took.push(!out.error && sent.length === 2 && !('provider' in sent[1].body));
    }
    sent.length = 0;
    reply = (n) => (n === 1 ? { status: 404, text: 'No endpoints found matching your data policy' } : fine(0.0001));
    const plain = await caught(() => coach.__test.textInfer('say ok', 5));
    took.push(!plain.error && sent.length === 2);
    ok(took.every(Boolean), `and so are its other wordings, JSON or plain text (${took.join(', ')})`);
  }
  {
    // A 404 for anything else would be refused without the preference all the same.
    const others = [
      'No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing',
      'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing',
      'No endpoints found for deepseek/deepseek-v4.1-flash.',
      'No allowed providers are available for the selected model.',
      'Not Found',
    ];
    const before = JSON.stringify(counts());
    const kept = [];
    for (const m of others) {
      sent.length = 0;
      reply = () => POLICY_404(m);
      const out = await caught(() => coach.__test.textInfer('say ok', 5));
      // textInfer tries its backstop model once on an error: every request still denies.
      kept.push(!!out.error && out.error.status === 404 && sent.length >= 1 && sent.every(denies));
    }
    ok(kept.every(Boolean) && JSON.stringify(counts()) === before,
      `a 404 for anything but the data policy is never sent without it (${kept.join(', ')})`);
  }
  {
    // Refused without it too (an account wide privacy setting, say): not asked a
    // third time, and COUNTED BY WHAT HAPPENED. No provider took that frame, so
    // it is no fall back: /health's fellBack says a frame went to a provider
    // that may keep it, and setting AI_DATA_COLLECTION=allow would not help.
    sent.length = 0;
    reply = () => REFUSED;
    const before = counts().other;
    const again = refused().other;
    const out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(out.error && out.error.status === 404 && sent.length === 2 && denies(sent[0]) && !('provider' in sent[1].body)
      && counts().other === before && refused().other === again + 1,
    `a call refused again without the preference is the call's 404, retried once, and counted as refused again, never as fallen back (${sent.length} requests, fellBack ${counts().other}, refusedAgain ${refused().other})`);
    ok(refusedLines('other').length === 1 && /refused again without data_collection deny/.test(refusedLines('other')[0])
      && /AI_DATA_COLLECTION=allow does not change/.test(refusedLines('other')[0]),
    `and one line says the preference is not what stops it (${refusedLines('other')[0]})`);
    // A model OpenRouter has no live provider for, refused for the policy first
    // and then for itself: the retry is harmless, and counted as what it was.
    sent.length = 0;
    reply = (n) => (n === 1 ? REFUSED : POLICY_404('No endpoints found for deepseek/deepseek-v9-flash.'));
    const gone = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(gone.error && gone.error.status === 404 && sent.length === 2 && counts().other === before && refused().other === again + 2
      && refusedLines('other').length === 1,
    `a model with no endpoint at all is the same: refused again, never fallen back, and said no more within the hour (fellBack ${counts().other}, refusedAgain ${refused().other})`);
    // Cut off on its way without the preference: a provider may have had the frame by then.
    sent.length = 0;
    reply = (n) => (n === 1 ? REFUSED : { hang: true });
    let watchdog = null;
    const cut = await Promise.race([
      caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false, null, { abortMs: 80 })),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve({ error: { name: 'no abort after 3s' } }), 3000); }),
    ]);
    clearTimeout(watchdog);
    ok(cut.error && /TimeoutError|AbortError/.test(cut.error.name) && sent.length === 2 && counts().other === before + 1
      && refused().other === again + 2,
    `while one cut off on its way without it counts as fallen back, as a provider may have had it (${cut.error && cut.error.name}, fellBack ${counts().other})`);
    // A 404 in any words but OpenRouter's "No endpoints found" could be a
    // provider's own: it may have had the frame, so it fell back.
    sent.length = 0;
    reply = (n) => (n === 1 ? REFUSED : { status: 404, text: 'Not Found' });
    const plain = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(plain.error && plain.error.status === 404 && sent.length === 2 && counts().other === before + 2 && refused().other === again + 2,
      `and so does one answered by a 404 in other words (fellBack ${counts().other}, refusedAgain ${refused().other})`);
  }
  {
    // The call's other retries carry what the call carries by then.
    sent.length = 0;
    reply = (n) => (n === 1 ? REFUSED : n === 2 ? { status: 400, text: 'reasoning is not supported' } : fine(0.0002));
    let out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(!out.error && sent.length === 3 && denies(sent[0]) && sent.slice(1).every((s) => !('provider' in s.body)),
      `after the fall back, the retry without the reasoning switch goes without the preference too (${sent.length} requests)`);
    sent.length = 0;
    reply = (n) => (n === 1 ? { status: 400, text: 'reasoning is not supported' } : n === 2 ? REFUSED : fine(0.0002));
    out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(!out.error && sent.length === 3 && denies(sent[0]) && denies(sent[1]) && !('provider' in sent[2].body),
      `and a refusal of the retry without the reasoning switch falls back the same (${sent.length} requests)`);
  }
  {
    // OpenRouter's errors page words the same refusal as a 503, "There is no
    // available model provider that meets your routing requirements", and the
    // data policy is the only routing requirement this server sends.
    const before = counts().read;
    sent.length = 0;
    reply = (n) => (n === 1
      ? { status: 503, text: JSON.stringify({ error: { message: 'There is no available model provider that meets your routing requirements', code: 503 } }) }
      : fine(0.0003));
    const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': KEY }, body: { image: 'aGVsbG8=', context: {} } });
    ok(r.status === 200 && sent.length === 2 && denies(sent[0]) && !('provider' in sent[1].body) && counts().read === before + 1,
      `a read refused with the 503 for its routing requirements is sent once more without the preference, and counted as fallen back (${r.status}, ${sent.length} requests, fellBack ${counts().read})`);
  }
  {
    // Never on any other error, a timeout included: each is the call's answer.
    const before = JSON.stringify(counts());
    const SAYS = 'No endpoints found matching your data policy';
    const cases = [
      [401, { status: 401, text: `${SAYS} (no such key)` }],
      [403, { status: 403, text: `${SAYS} (blocked)` }],
      [429, { status: 429, text: `${SAYS} (rate limited)` }],
      [500, { status: 500, text: SAYS }],
      [502, { status: 502, text: SAYS }],
      [503, { status: 503, text: JSON.stringify({ error: { message: 'Service temporarily unavailable', code: 503 } }) }],
    ];
    const held = [];
    for (const [status, r] of cases) {
      sent.length = 0;
      reply = () => r;
      const out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
      held.push(`${status} ${!!out.error && out.error.status === status && sent.length === 1 && denies(sent[0])}`);
    }
    // A 400 is asked once more without the reasoning switch, as always, and still denies.
    sent.length = 0;
    reply = () => ({ status: 400, text: SAYS });
    let out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    held.push(`400 ${!!out.error && out.error.status === 400 && sent.length === 2 && sent.every(denies)}`);
    sent.length = 0;
    reply = () => ({ hang: true });
    // Raced against a watchdog of our own: the deadline's timer does not keep
    // Node running, and a pending promise alone does not either, so without it
    // the test would exit 0 having printed nothing more.
    let watchdog = null;
    out = await Promise.race([
      caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false, null, { abortMs: 60 })),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve({ error: { name: 'no abort after 3s' } }), 3000); }),
    ]);
    clearTimeout(watchdog);
    held.push(`timeout ${!!out.error && /TimeoutError|AbortError/.test(out.error.name) && sent.length === 1 && denies(sent[0])}`);
    ok(held.every((h) => h.endsWith('true')) && JSON.stringify(counts()) === before,
      `no other refusal and no timeout is ever sent without the preference (${held.join(', ')})`);
    // Last, as it opens the credits breaker: the fresh load below closes it again.
    sent.length = 0;
    reply = () => ({ status: 402, text: SAYS });
    out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(out.error && out.error.status === 402 && sent.length === 1 && denies(sent[0]) && JSON.stringify(counts()) === before,
      `nor is an empty wallet (402) (${sent.length} request)`);
  }
  {
    // AI_DATA_COLLECTION=allow: nothing sent, so nothing refused for it or retried.
    coach = loadCoach();
    process.env.AI_DATA_COLLECTION = 'allow';
    sent.length = 0;
    reply = () => REFUSED;
    const out = await caught(() => coach.__test.visionInfer(IMG, 'read this', 10, false));
    ok(out.error && out.error.status === 404 && sent.length === 1 && !('provider' in sent[0].body)
      && JSON.stringify(counts()) === JSON.stringify(zero),
    `with AI_DATA_COLLECTION=allow nothing is asked and nothing retried (${sent.length} request)`);
    ok(policyNow().mode === 'allow', `and the policy reads allow (${policyNow().mode})`);
    delete process.env.AI_DATA_COLLECTION;
    ok(policyNow().mode === 'deny', 'and deny again the moment it is unset, without a restart');
    const since = policyNow().since;
    ok(typeof since === 'string' && new Date(since).toISOString() === since && Date.now() - Date.parse(since) < 60 * 1000,
      `counted since this server started (${since})`);
  }
  console.warn = realWarn;
  console.error = realError;
  reply = () => ({ status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });

  // ── Another provider is sent no such field ────────────────────────────────
  process.env.AI_BASE_URL = 'https://api.openai.com/v1';
  coach = loadCoach();
  sent.length = 0;
  await coach.__test.textInfer('say ok', 5);
  ok(sent[0] && sent[0].url.startsWith('https://api.openai.com/v1/') && !('provider' in sent[0].body) && !('usage' in sent[0].body),
    'a provider that is not OpenRouter gets neither OpenRouter field');
  ok(policyNow().mode === 'allow', `and /health says its calls carry no preference (${policyNow().mode})`);
  sent.length = 0;
  reply = () => ({ status: 404, text: JSON.stringify({ error: { message: 'No endpoints found matching your data policy', code: 404 } }) });
  try { await coach.__test.visionInfer(IMG, 'read this', 10, false); } catch (e) { /* the call's own 404 */ }
  ok(sent.length === 1 && counts().other === 0, 'and what it answers is never taken for a refusal of one');
  reply = () => ({ status: 200, json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } });
  process.env.AI_BASE_URL = 'https://openrouter.ai.evil.example/v1';
  coach = loadCoach();
  sent.length = 0;
  await coach.__test.textInfer('say ok', 5);
  ok(sent[0] && !('provider' in sent[0].body), 'nor does a host that only looks like OpenRouter');

  // ── GET /health shows it, from the server as Railway starts it ────────────
  // server/server.js in a process of its own, on a free local port, with stand
  // in secrets and a working folder holding no .env for dotenv to find. It
  // makes no call to anything: /health asks no database and no model.
  {
    const fs = require('fs');
    const os = require('os');
    const net = require('net');
    const http = require('http');
    const { spawn } = require('child_process');
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
    });
    const SECRETS = { AI_API_KEY: 'sk-or-v1-stand-in-health-1', SUPABASE_SERVICE_KEY: 'stand-in-health-2',
      STRIPE_SECRET_KEY: 'sk_test_stand_in_health_3', ADMIN_PASSWORD: 'stand-in-health-4' };
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(AI_|STRIPE_|SUPABASE_|ADMIN_|GEMINI|OPENROUTER|HENRIKDEV|TRACKER|RIOT)/i.test(k)) env[k] = v;
    }
    Object.assign(env, SECRETS, { PORT: String(port), SUPABASE_URL: 'http://localhost:54321', AI_BASE_URL: 'https://openrouter.ai/api/v1' });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-health-'));
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const get = (p) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    let health = null;
    let apiHealth = null;
    try {
      for (let i = 0; i < 120 && !health && child.exitCode === null; i++) {
        health = await get('/health');
        if (!health) await new Promise((r) => setTimeout(r, 150));
      }
      apiHealth = health ? await get('/api/health') : null;
    } finally {
      child.kill();
      await exited;
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* the folder outlives a slow exit */ }
    }
    let body = null;
    let apiBody = null;
    try { body = JSON.parse(health.body); apiBody = JSON.parse(apiHealth.body); } catch (e) { /* reported below */ }
    const dp = body && body.dataPolicy;
    ok(health && health.status === 200 && dp && dp.mode === 'deny' && JSON.stringify(dp.fellBack) === JSON.stringify(zero)
      && JSON.stringify(dp.refusedAgain) === JSON.stringify(zero),
    `GET /health shows dataPolicy: deny, nothing fallen back or refused again on every route (${health ? `${health.status} ${JSON.stringify(dp)}` : `no answer: ${output.slice(-300)}`})`);
    ok(dp && typeof dp.since === 'string' && new Date(dp.since).toISOString() === dp.since
      && Date.parse(dp.since) >= started - 2000 && Date.parse(dp.since) <= Date.now(),
    `counted since that server started (${dp && dp.since})`);
    ok(apiBody && JSON.stringify(apiBody.dataPolicy) === JSON.stringify(dp), 'and /api/health shows the same');
    const shown = `${health && health.body}${apiHealth && apiHealth.body}`;
    ok(!!health && Object.values(SECRETS).every((s) => !shown.includes(s)), 'with no secret in either: no provider, database, Stripe or admin key');
    ok(!!health && !!apiHealth && JSON.stringify(Object.keys((dp && dp.fellBack) || {})) === JSON.stringify(Object.keys(zero))
      && JSON.stringify(Object.keys((dp && dp.refusedAgain) || {})) === JSON.stringify(Object.keys(zero)) && !/rivals/i.test(shown),
    `and the routes it lists are read, forensics, review, chat and other, none of a game Occlara no longer coaches (${dp && Object.keys(dp.fellBack || {}).join(', ')})`);
  }

  finished = true;
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' AI privacy checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
