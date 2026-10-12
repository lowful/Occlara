'use strict';

/**
 * The live tip routes are retired, for every caller.
 *
 * POST /api/coach/analyze, /recap, /summary/round, /summary/match and
 * /suggest-library-tip served the tip era's prompts to installs older than 8.0,
 * which still show a tip over the game while it is played: the exact use
 * Riot's VALORANT policy lists as unapproved, and the one a player was banned a
 * week for. Each now answers 410 with one sentence, and does nothing else: no
 * licence lookup, no model call.
 *
 * Held here: the five answer 410 with exactly that sentence, with or without a
 * licence; neither the licence table nor the model is asked; the routes 8.x
 * uses still answer; and no file of the app (src/) calls any of the five, so
 * an 8.x install loses nothing.
 *
 * Run: npm run test:tiproutes
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const db = { queries: 0 };
const fakeSupabase = {
  from: () => {
    db.queries++;
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
let modelCalls = 0;
global.fetch = async () => {
  modelCalls++;
  const json = { choices: [{ message: { content: 'STATE: {"phase":"buy"}' }, finish_reason: 'stop' }] };
  return { status: 200, ok: true, text: async () => JSON.stringify(json), json: async () => json };
};

const coach = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));

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

const SENTENCE = 'This version of Occlara is no longer supported. Update it at occlara.app.';
const KEY = { 'X-License-Key': 'GC-AAAA-AAAA-AAAA-AAAA' };
const ROUTES = [
  ['/analyze', { image: 'aGVsbG8=', context: { phase: 'active' } }],
  ['/recap', { tips: ['Hold the angle.', 'Trade your duelist.'] }],
  ['/summary/match', { tips: ['a', 'b', 'c', 'd'] }],
  ['/summary/round', Buffer.from('jpeg bytes')],
  // It asked the model to "pick the BEST tip from this list to show the player
  // right now": the old library tips, chosen mid match.
  ['/suggest-library-tip', { context: { phase: 'active', roundNumber: 4 }, availableTips: ['Hold the angle.', 'Trade your duelist.'] }],
];

(async () => {
  // ── The four answer 410, and nothing else ─────────────────────────────────
  for (const [route, body] of ROUTES) {
    db.queries = 0;
    modelCalls = 0;
    const r = await call(coach, 'POST', route, { headers: KEY, body });
    ok(r.status === 410 && JSON.stringify(r.body) === JSON.stringify({ error: SENTENCE }),
      `POST ${route} answers 410 with the sentence and nothing else (${r.status} ${JSON.stringify(r.body)})`);
    ok(db.queries === 0 && modelCalls === 0, `and asks neither the licence table nor a model (${db.queries}, ${modelCalls})`);
    const bare = await call(coach, 'POST', route, { body });
    ok(bare.status === 410, `and is 410 with no licence at all, not a 400 asking for one (${bare.status})`);
  }

  // ── What 8.x uses still answers ───────────────────────────────────────────
  {
    modelCalls = 0;
    const r = await call(coach, 'POST', '/read', { headers: KEY, body: { image: 'aGVsbG8=', context: {} } });
    ok(r.status === 200 && modelCalls === 1, `the live read 8.x makes is still served (${r.status})`);
  }

  // ── And no 8.x client calls any of the four ───────────────────────────────
  {
    const SRC = path.join(__dirname, '..', 'src');
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html)$/.test(e.name)) files.push(p);
      }
    };
    walk(SRC);
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      // config.js declares API.ANALYZE as an unused constant; any use of it, or
      // of a retired path, is a call.
      if (/API\.ANALYZE\b/.test(text)) hits.push(`${path.relative(SRC, f)} uses API.ANALYZE`);
      for (const p of ['/api/coach/recap', '/api/coach/summary/', 'suggest-library-tip']) if (text.includes(p)) hits.push(`${path.relative(SRC, f)} names ${p}`);
      const analyze = text.split('\n').filter((l) => l.includes('/api/coach/analyze') && !/ANALYZE:\s*'\/api\/coach\/analyze'/.test(l));
      if (analyze.length) hits.push(`${path.relative(SRC, f)} names /api/coach/analyze`);
    }
    ok(files.length > 50, `the app's sources were read (${files.length} files)`);
    ok(/API\.ANALYZE\b/.test('this.callServer(API.ANALYZE, body)') && !/API\.ANALYZE\b/.test('API.ANALYZER'),
      'the check finds a use of API.ANALYZE when there is one');
    ok(hits.length === 0, `no file of the app calls a retired route${hits.length ? `: ${hits.join('; ')}` : ''}`);
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' retired tip route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
