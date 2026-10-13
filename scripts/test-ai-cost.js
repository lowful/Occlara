'use strict';

/**
 * What the model calls cost, as the provider bills them (8.3.1).
 *
 * The admin cost view used to multiply calls by a flat price written for a
 * model the server no longer calls, so it could not say what a match costs
 * or which feature spends it, the question a change of price turns on. Every
 * call now asks OpenRouter for its usage (usage: { include: true }) and books
 * the cost it returns against the route it served and the licence that made
 * it, by day and by month; the flat price stays only for a call that comes
 * back with no cost.
 *
 * Held here, on a scripted provider (no network, no money):
 *   every call to OpenRouter asks for its usage, and only OpenRouter is asked
 *   each route's calls are booked under it: read, forensics, review and chat,
 *     each with its licence, and a call outside any request under other with
 *     none; no other route is kept (Marvel Rivals' went with the game)
 *   a reply with no cost books the flat price per image, counted apart
 *   a call aborted at its deadline books the flat price (it is billed), one
 *     the provider refused books nothing
 *   a new day starts today's count again and keeps the month's, a new month
 *     both, in all and by licence
 *   /api/admin/costs shows it: today and this month by route, the real and the
 *     estimated apart, and each licence's own, by its hash
 *
 * Run: npm run test:aicost
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
for (const v of ['AI_PROVIDER', 'AI_READ_MODEL', 'AI_REVIEW_MODEL', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_COST_PER_CALL',
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL']) delete process.env[v];
process.env.ADMIN_PASSWORD = 'cost-password';

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
// The view gives dollars to the millionth.
const near = (a, b) => Math.abs(a - b) < 1e-6;

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

// ── The provider, scripted: every request recorded, every reply chosen ──────
const ai = { next: null, sent: [] };
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://openrouter.ai/api/v1/chat/completions')) throw new Error(`unexpected network call to ${u}`);
  const body = JSON.parse(init.body);
  const images = Array.isArray(body.messages[0].content) ? body.messages[0].content.filter((c) => c.type === 'image_url').length : 0;
  ai.sent.push({ model: body.model, usage: body.usage, images });
  const out = await ai.next(body, init);
  const json = { choices: [{ message: { content: out.content || '' }, finish_reason: 'stop' }],
    ...(out.cost !== undefined ? { usage: { prompt_tokens: 1200, completion_tokens: 40, cost: out.cost } } : {}) };
  return {
    status: out.status || 200, ok: !out.status || (out.status >= 200 && out.status < 300),
    text: async () => (out.status && out.status !== 200 ? (out.text || 'error') : JSON.stringify(json)),
    json: async () => json,
  };
};
const priced = (content, cost) => () => ({ content, cost });

const coach = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));
const admin = require(path.join(__dirname, '..', 'server', 'routes', 'admin.js'));
const { hashOf } = require(path.join(__dirname, '..', 'server', 'services', 'presence.js'));

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

const A = 'GC-AAAA-AAAA-AAAA-AAAA';
const B = 'GC-BBBB-BBBB-BBBB-BBBB';
const IMG = 'x'.repeat(5000);
const ROUNDS = [1, 2, 3, 4].map((n) => ({ n, side: 'attacking', result: n % 2 ? 'won' : 'lost', died: n % 2 === 0, reads: [] }));
const routes = (r) => Object.fromEntries(Object.entries(r.routes).map(([k, v]) => [k, v.calls]));

(async () => {
  const costs = coach.costs;
  ok(costs.asksUsage('https://openrouter.ai/api/v1') && costs.asksUsage('https://openrouter.ai/api/v1/') && costs.asksUsage('http://eu.openrouter.ai/v1')
    && !costs.asksUsage('https://api.openai.com/v1') && !costs.asksUsage('https://openrouter.ai.evil.example/v1') && !costs.asksUsage('https://notopenrouter.ai/v1')
    && !costs.asksUsage('') && costs.asking(),
  'OpenRouter is asked what each call cost, and no other provider: a look alike host is not OpenRouter');
  ok(costs.routes.join() === 'read,forensics,review,chat,other', `the routes a call is booked under, and no other: ${costs.routes.join(', ')}`);

  // ── Each route's calls, with what the provider said they cost ─────────────
  ai.next = priced('STATE: {"phase":"buy","team":3,"enemy":2}', 0.00042);
  const read = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': A }, body: { image: 'aGVsbG8=', context: {} } });
  ai.next = priced('{"cause": "isolated", "what": "You held the site alone.", "better": "Hold it with your team."}', 0.0031);
  const look = await call(coach, 'POST', '/death-forensics', { headers: { 'X-License-Key': A }, body: { agent: 'Jett', map: 'Abyss',
    deaths: [{ n: 2, frames: [IMG, IMG], frameAt: [-0.4, 0.6], framesFrom: 'reads' }, { n: 5, frames: [IMG, IMG, IMG, IMG, IMG],
      frameAt: [-3, -1.5, -0.7, -0.3, 0.7], framesFrom: 'recording' }] } });
  ai.next = priced('SUMMARY: You won the rounds you opened with a trade behind you.\nR2: You took the duel alone.\nFOCUS: Wait for a teammate.', 0.0105);
  const review = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': B }, body: { rounds: ROUNDS, context: { agent: 'Jett', map: 'Abyss' } } });
  ai.next = priced('Hold the angle with a teammate close enough to trade you, and swing only once they can.', 0.0007);
  const chat = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': B }, body: { messages: [{ role: 'user', content: 'How do I stop dying first?' }], context: {} } });
  ok(read.status === 200 && look.status === 200 && look.body.deaths.length === 2 && review.status === 200 && chat.status === 200,
    `the routes answer as before (${[read, look, review, chat].map((r) => r.status).join(', ')})`);
  ok(ai.sent.length === 5 && ai.sent.every((s) => s.usage && s.usage.include === true),
    `every call asked the provider for its usage (${ai.sent.length} calls)`);
  ok(ai.sent[2].images === 5 && ai.sent[1].images === 2, 'and the look sent each death its frames, five timed stills for one');
  // A call outside any request at all.
  ai.next = priced('ok', 0.0002);
  await coach.__test.textInfer('say ok', 5);

  let rep = costs.report(null);
  const t = rep.today.routes;
  ok(t.read.calls === 1 && near(t.read.real, 0.00042) && t.forensics.calls === 2 && near(t.forensics.real, 0.0062)
    && t.review.calls === 1 && near(t.review.real, 0.0105) && t.chat.calls === 1 && near(t.chat.real, 0.0007)
    && t.other.calls === 1 && near(t.other.real, 0.0002) && JSON.stringify(Object.keys(t)) === JSON.stringify(costs.routes),
  `each call booked at its own cost under the route it served, one outside a request under other (${JSON.stringify(routes(rep.today))})`);
  ok(rep.today.calls === 6 && rep.today.priced === 6 && near(rep.today.real, 0.00042 + 0.0062 + 0.0105 + 0.0007 + 0.0002)
    && rep.today.estimated === 0 && near(rep.today.cost, rep.today.real) && near(rep.month.cost, rep.today.cost),
  `in all, today and this month, every one priced by the provider ($${rep.today.cost})`);
  const a = costs.report(A).today;
  const b = costs.report(B).today;
  ok(a.calls === 3 && near(a.real, 0.00042 + 0.0062) && a.routes.read.calls === 1 && a.routes.forensics.calls === 2
    && b.calls === 2 && near(b.real, 0.0112) && b.routes.review.calls === 1 && b.routes.chat.calls === 1,
  `and under the licence that made it (A $${a.real}, B $${b.real})`);
  ok(JSON.stringify(costs.keys().sort()) === JSON.stringify([A, B].sort()),
    `and the call outside any request under no licence at all (${costs.keys().length} licences booked)`);
  ok(costs.report('GC-NOBODY').today.calls === 0, 'a licence that made no call has spent nothing');

  // ── No cost said, aborted, refused ────────────────────────────────────────
  const flat = costs.perCall;
  ai.next = () => ({ content: '{"cause": "unclear"}' });
  await call(coach, 'POST', '/death-forensics', { headers: { 'X-License-Key': A }, body: { agent: 'Jett', map: 'Abyss',
    deaths: [{ n: 3, frames: [IMG, IMG, IMG], frameAt: [-1, -0.5, 0.5], framesFrom: 'recording' }] } });
  rep = costs.report(null);
  ok(rep.today.routes.forensics.calls === 3 && rep.today.routes.forensics.priced === 2 && near(rep.today.routes.forensics.estimated, 3 * flat),
    `a reply that says nothing of its cost books the flat price for each image it carried, apart ($${rep.today.routes.forensics.estimated})`);
  ai.next = (body, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(init.signal.reason || new Error('aborted'))); });
  let aborted = null;
  try { await coach.__test.visionInfer(IMG, 'read this', 10, false, null, { abortMs: 60 }); } catch (e) { aborted = e; }
  rep = costs.report(null);
  ok(aborted && rep.today.routes.other.calls === 2 && near(rep.today.routes.other.estimated, flat),
    `a call aborted at its deadline is billed all the same: the flat price (${aborted && aborted.name})`);
  ai.next = () => ({ status: 500, text: 'upstream exploded' });
  const before = costs.report(null).today.calls;
  await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': B }, body: { rounds: ROUNDS, context: {} } });
  ok(costs.report(null).today.calls === before, 'and one the provider refused is not billed and books nothing');

  // ── /api/admin/costs ──────────────────────────────────────────────────────
  const view = await call(admin, 'GET', '/costs', { headers: { 'X-Admin-Password': 'cost-password' } });
  const v = view.body;
  ok(view.status === 200 && v.spend && near(v.spend.today.cost, costs.report(null).today.cost) && v.spend.today.routes.forensics.calls === 3
    && v.global.costToday === v.spend.today.cost && typeof v.global.estCostToday === 'string' && v.spend.asksProvider === true && v.since,
  `/api/admin/costs shows the spend today and this month by route, the real and the estimated apart ($${v.spend && v.spend.today.real} real, $${v.spend && v.spend.today.estimated} estimated)`);
  const listed = (x) => JSON.stringify(Object.keys((x && x.routes) || {}));
  ok(v.spend && v.spend.routes.join() === 'read,forensics,review,chat,other' && listed(v.spend.today) === JSON.stringify(v.spend.routes)
    && listed(v.spend.month) === listed(v.spend.today) && !/rivals/i.test(JSON.stringify(v)),
  `listing read, forensics, review, chat and other, and no route of a game Occlara no longer coaches (${v.spend && v.spend.routes.join(', ')})`);
  const rowA = (v.topUsers || []).find((r) => r.user === hashOf(A));
  ok(rowA && near(rowA.costToday, costs.report(A).today.cost) && rowA.spendToday.routes.forensics.calls === 3 && !JSON.stringify(v).includes(A),
    "and each licence's own, by its hash, no part of a key in it");
  ok((await call(admin, 'GET', '/costs', { headers: {} })).status === 401, 'and nobody without the admin password sees any of it');

  // ── The calendar ──────────────────────────────────────────────────────────
  const at = async (iso, fn) => {
    const Real = Date;
    global.Date = class extends Real {
      constructor(...args) { super(...(args.length ? args : [iso])); }
      static now() { return new Real(iso).getTime(); }
    };
    try { await fn(); } finally { global.Date = Real; }
  };
  // A call of that licence, made as the read's route makes it.
  const book = async (key, cost) => {
    ai.next = priced('ok', cost);
    await coach.__test.asRoute('read', key, () => coach.__test.visionInfer(IMG, 'x', 5, false));
  };
  let byA = null;
  await at('2030-01-30T12:00:00.000Z', async () => { await book(A, 0.5); await book(A, 0.25); rep = costs.report(null); });
  ok(near(rep.today.cost, 0.75) && near(rep.month.cost, 0.75), 'a new day of a new month starts from nothing, in all');
  await at('2030-01-31T09:00:00.000Z', async () => { await book(A, 1); rep = costs.report(null); byA = costs.report(A); });
  ok(near(rep.today.cost, 1) && near(rep.month.cost, 1.75) && near(byA.month.cost, 1.75) && near(byA.today.cost, 1),
    `the next day starts today's again and keeps the month's, in all and by licence ($${rep.today.cost} today, $${rep.month.cost} this month)`);
  await at('2030-02-01T09:00:00.000Z', async () => { await book(A, 2); rep = costs.report(null); byA = costs.report(A); });
  ok(near(rep.today.cost, 2) && near(rep.month.cost, 2) && near(byA.month.cost, 2), 'and the next month starts both again');
  await at('2030-02-05T09:00:00.000Z', async () => { rep = costs.report(null); });
  ok(rep.today.cost === 0 && near(rep.month.cost, 2), 'a day nothing was called on reads as nothing today, the month kept');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' cost checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
