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
  'AI_TEXT_MODEL_FALLBACK', 'AI_FORENSICS_MODEL']) delete process.env[v];
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

  // ── /match-review, pinned with no fallback (8.5.0) ───────────────────────
  {
    ai.sent.length = 0;
    ai.next = reply('');
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(r.status === 200 && r.body.review === null && r.body.summary === null && ai.sent.length === 1 && ai.sent[0].model === 'openai/gpt-6-sol',
      `Sol empty is no narrative, never one from another model (${ai.sent.map((s) => s.model).join(', ')})`);
    ai.sent.length = 0;
    ai.next = () => ({ status: 500, text: 'upstream exploded' });
    const failed = await call(coach, 'POST', '/match-review', { headers: H, body: reviewBody });
    ok(failed.status === 503 && ai.sent.length === 1, `and Sol failing is one call and a 503 (${ai.sent.length})`);
  }

  // ── /match-review, no player named (8.5.0) ───────────────────────────────
  {
    const riotRounds = require(path.join(__dirname, '..', 'server', 'services', 'riot-rounds.js'));
    const MID = '1a2b3c4d-eeee-4fff-8aaa-0123456789ab';
    riotRounds.noteNames(MID, { players: [{ name: 'Tessik', tag: 'EUW' }, { name: 'Me', tag: 'EUW' }] });
    const named = 'SUMMARY: You won the rounds you opened with a trade behind you. Tessik carried the rest.\n'
      + 'R2: Your teammate Tessik was ahead of you, so wait for the trade.\nR4: Take the duel with a teammate close.\nFOCUS: Wait for a teammate before you peek.';
    const clean = 'SUMMARY: You won the rounds you opened with a trade behind you.\nR2: You took the duel alone.\nFOCUS: Wait for a teammate before you peek.';
    const ROUND4 = ROUNDS.map((r) => ({ ...r }));
    const body = (extra) => ({ ...reviewBody, rounds: ROUND4, ...(extra || {}) });
    ai.next = reply(clean);
    const plain = await call(coach, 'POST', '/match-review', { headers: H, body: body() });
    const plainMatch = await call(coach, 'POST', '/match-review', { headers: H, body: body({ matchId: MID }) });
    ok(plain.status === 200 && JSON.stringify(plain.body) === JSON.stringify(plainMatch.body) && plain.body.summary && plain.body.rounds[2],
      'a review naming nobody comes back the same with or without its match id');
    ai.next = reply(named);
    const set = await call(coach, 'POST', '/match-review', { headers: H, body: body({ matchId: MID }) });
    ok(set.body.summary === 'You won the rounds you opened with a trade behind you.' && !set.body.rounds[2] && set.body.rounds[4]
      && set.body.focus === 'Wait for a teammate before you peek.' && !/Tessik/.test(JSON.stringify(set.body)),
    `with the match's name set, a summary sentence naming a player goes and a round line naming one goes whole (${JSON.stringify(set.body.rounds)})`);
    const gate = { namesSomeone: (s) => (/\bTessik\b/.test(s) ? 'Tessik' : null), asked: [] };
    const watched = { namesSomeone: (s, o) => { gate.asked.push(o && o.language); return gate.namesSomeone(s); } };
    coach.__test.services({ nameGate: watched });
    const heur = await call(coach, 'POST', '/match-review', { headers: H, body: body() });
    ok(heur.body.summary === 'You won the rounds you opened with a trade behind you.' && !heur.body.rounds[2] && heur.body.rounds[4]
      && gate.asked.every((l) => l === 'en'), 'without it, the name gate (name-gate.js) drops the same, in English');
    gate.asked.length = 0;
    const de = await call(coach, 'POST', '/match-review', { headers: H, body: body({ context: { agent: 'Jett', map: 'Abyss', language: 'de' } }) });
    ok(gate.asked.length > 0 && gate.asked.every((l) => l === 'de'), 'and in German it is asked as German, whose capitals are no names to it');
    coach.__test.services({ nameGate: null });
    // The review's own words are no names to the real gate: the scoreboard's,
    // the result's, the sides' (REVIEW_WORDS), while a name still is.
    const SAYS = ['You were the match MVP with 31 kills.', 'Your ACS of 290 led the lobby.', 'You finished with a K/D of 1.5.',
      'You won on Split as Jett, a Victory 13 to 7.', 'Your ADR was 180 and your HS 25 percent.', 'You lost the pistol round on Attack.',
      'You traded well on Defense.', 'The COMBAT REPORT shows you dealt no damage.', 'With SWITCH PLAYER at the bottom left you were dead.',
      'The SPECTATORS counter is no sign of death.', 'It was MATCH POINT and your team had the ULTIMATE ready.'];
    const kept = SAYS.filter((s) => !coach.__test.namesSomeoneHere(s, { language: 'en' }));
    const caught = ['You were killed by Morvane with a Vandal.', 'Your teammate Tessik was ahead of you.', 'Your Acer friend was there.',
      'You and xX_slayer_Xx held A.'].filter((s) => coach.__test.namesSomeoneHere(s, { language: 'en' }));
    ok(kept.length === SAYS.length && caught.length === 4,
      `the scoreboard, the result and the sides pass the name gate, where a name, a word only like one, and a handle do not (${kept.length} of ${SAYS.length} kept, ${caught.length} of 4 caught)`);
    coach.__test.services({ nameGate: { namesSomeone: () => { throw new Error('a broken gate'); } } });
    ai.next = reply(clean);
    const broken = await call(coach, 'POST', '/match-review', { headers: H, body: body() });
    ok(broken.status === 200 && JSON.stringify(broken.body) === JSON.stringify(plain.body), 'and a gate that throws decides nothing, the review answered as it was');
    coach.__test.services({ nameGate: null });
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
      await coach.__test.visionInfer('aGVsbG8=', 'read this', 10, false, 'deepseek/deepseek-v4.1-flash', { abortMs: 80 });
    } catch (e) { err = e; }
    ok(err && ai.sent[0].signal.aborted && Date.now() - t0 < 3000,
      `a call past its deadline is aborted, not left running (${err && err.name}, ${Date.now() - t0}ms)`);

    ai.sent.length = 0;
    let err2 = null;
    try { await coach.__test.textInfer('say something', 20, { timeoutMs: 60 }); } catch (e) { err2 = e; }
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
