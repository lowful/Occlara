'use strict';

/**
 * THE SERVER CORE OF 8.5.0, run by test:serverguards (scripts/test-server-guards.js
 * hands it its `ok`, its request driver and the coach router it loaded).
 *
 *   WHAT A CLIENT BEFORE 8.5.0 GETS IS TODAY'S, byte for byte: its Ask Coach
 *   prompt by its sha256, the model, the room and the temperature, whatever
 *   CHAT_PROMPT says and whatever v2 fields ride along; its death look the
 *   look as 8.4.4 shipped it (scripts/fixtures/death-forensics-844.js), its
 *   room and its reply's keys, whatever FORENSICS_PROMPT says; its agent look
 *   the live prompt on the vision model.
 *   ONE VERSION GATE (clientAtLeast), and what each route gives by it: the
 *   look's variant b to 8.5.0 and later once promoted, or to an admin bench,
 *   with its room, its match id and its name set on the input; Ask Coach v2 the
 *   same way, admin benches naming v2 or its control.
 *   NO PINNED CALL FALLS BACK, AND A STRIKE IS ITS OWN MODEL'S: the review's
 *   Sol empty is no narrative from another model, and moves no other route's
 *   model; the configured text model moves only after its own strike, which
 *   /health's textModelNow says.
 *   ASK COACH V2'S ROUTE HALF, on a stand in for chat-prompt.js written to the
 *   spec's interface (the services' own tests are test:chatcontext and
 *   test:chatgates): the pinned model, 900 tokens at 0.4, no other model ever,
 *   the gates' one retry with its reasons at 500 tokens, the honest line, the
 *   40 s budget scaled down to a provider slow past it, paragraphs kept, the
 *   round read before the Riot ID scrub, the match's name set handed to the
 *   gates and its words dropped, the daily cap from the booked cost (refused
 *   past $0.15 with resetsAt, answered 24 hours later), an old client never
 *   capped, a bench never counted, frame chat from 8.5.0 inside the cap, and
 *   the day's counts behind the admin password, never on /health.
 *   FRAME CHAT: the tip line gone, a linked round's Riot facts in its facts
 *   line, bounded, and a sentence naming a player dropped.
 *   THE AGENT LOOK'S CROP VARIANT AND BENCH MODEL, an admin bench's alone.
 *
 * The provider is a stand in fetch, swapped in for this run and put back.
 * Nothing leaves the machine.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The em and en dash, built here so no dash is ever written in this file.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

module.exports = async function serverCore({ ok, call, coach, PW, SERVER }) {
  const T = coach.__test;
  const riotRounds = require(path.join(SERVER, 'services', 'riot-rounds.js'));
  const deathForensics = require(path.join(SERVER, 'services', 'death-forensics.js'));
  const frozen844 = require(path.join(__dirname, 'fixtures', 'death-forensics-844.js'));

  // ── The provider, a stand in: every request kept, every answer scripted ──
  const prov = { sent: [], next: null };
  const before = global.fetch;
  global.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const entry = { url: String(url), body, signal: init.signal, at: Date.now() };
    prov.sent.push(entry);
    const out = (prov.next ? await prov.next(body, init, prov.sent.length) : null)
      || { content: 'Hold your angle with a teammate close enough to trade you, then swing together.' };
    const json = { choices: [{ message: { content: out.content == null ? '' : out.content }, finish_reason: 'stop' }],
      ...(out.usage ? { usage: out.usage } : out.cost !== undefined ? { usage: { cost: out.cost } } : {}) };
    const status = out.status || 200;
    return { status, ok: status >= 200 && status < 300, headers: new Map(),
      text: async () => (status === 200 ? JSON.stringify(json) : (out.text || 'error')), json: async () => json };
  };
  const promptOf = (e) => {
    const msgs = (e && e.body && e.body.messages) || [];
    const c = msgs.length ? msgs[msgs.length - 1].content : '';
    return typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : '');
  };
  const envBefore = {};
  for (const k of ['CHAT_PROMPT', 'FORENSICS_PROMPT', 'CHAT_DAY_USD', 'CHAT_DAY_QUESTIONS', 'AI_TEXT_MODEL_FALLBACK']) {
    envBefore[k] = process.env[k];
    delete process.env[k];
  }
  const OLD = '8.4.4';
  const NEW = '8.5.0';
  const licence = (n) => `GC-CORE-${String(n).padStart(4, '0')}-AAAA-BBBB`;

  try {
    // ── One version gate ──────────────────────────────────────────────────
    {
      const at = (v) => T.clientAtLeast({ headers: v === undefined ? {} : { 'x-occlara-version': v } }, T.V85);
      ok(['8.5.0', '8.5.1', '8.10.0', '9.0.0', '8.5.0-beta.2'].every(at) && !['8.4.4', '8.4.10', '7.9.9', '', 'abc', undefined, '8.5'].some(at),
        'the version gate: 8.5.0 and later by X-Occlara-Version, as knowsGrace reads it, and nothing before or unreadable');
    }

    // ── A pinned call never falls back, and a strike is its own model's ────
    {
      T.textStrikes.clear();
      process.env.AI_TEXT_MODEL_FALLBACK = 'qwen/qwen3.7-flash';
      const textModel = T.AI.textModel;
      const reviewModel = T.AI.reviewModel;
      const ROUNDS = [1, 2, 3, 4].map((n) => ({ n, side: 'attacking', result: n % 2 ? 'won' : 'lost', died: n % 2 === 0, reads: [] }));
      prov.sent.length = 0;
      prov.next = () => ({ content: '' });
      const r = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1), 'X-Occlara-Version': OLD },
        body: { rounds: ROUNDS, context: { agent: 'Jett', map: 'Abyss' } } });
      ok(r.status === 200 && r.body.review === null && r.body.summary === null && prov.sent.length === 1
        && prov.sent[0].body.model === reviewModel,
      `the review's Sol coming back empty is no narrative, and no other model is asked to write it (${prov.sent.map((s) => s.body.model).join(', ')})`);
      ok(T.textModelNow() === textModel && coach.liveModels().textModelNow === textModel,
        `and Sol's strike is Sol's: the text model unpinned calls go to stays ${textModel}, as /health says`);
      prov.sent.length = 0;
      prov.next = () => ({ status: 500, text: 'upstream exploded' });
      const failed = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1) },
        body: { rounds: ROUNDS, context: { agent: 'Jett', map: 'Abyss' } } });
      ok(failed.status === 503 && prov.sent.length === 1, `a failing Sol is one call and a 503, never a second model (${prov.sent.length} calls)`);
      // An old client's review: the route sends the review's own prompt and
      // adds nothing to its reply but what the name gate drops.
      // (The review's prompt carries playbook notes retrieve() rotates, so it
      // is watched as the route builds it rather than built twice.)
      const matchReview = require(path.join(SERVER, 'services', 'match-review.js'));
      const reviewBody = { rounds: ROUNDS, context: { agent: 'Jett', map: 'Abyss' } };
      const realBuild = matchReview.buildPrompt;
      const built = [];
      matchReview.buildPrompt = (input) => { const p = realBuild(input); built.push({ input, p }); return p; };
      prov.sent.length = 0;
      prov.next = () => ({ content: 'SUMMARY: You won the rounds you opened with a trade behind you.\nR2: You took the duel alone.\nFOCUS: Wait for a teammate.' });
      let asToday;
      try {
        asToday = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1), 'X-Occlara-Version': OLD }, body: reviewBody });
      } finally { matchReview.buildPrompt = realBuild; }
      const want = matchReview.parse('SUMMARY: You won the rounds you opened with a trade behind you.\nR2: You took the duel alone.\nFOCUS: Wait for a teammate.',
        matchReview.normalise(reviewBody));
      ok(asToday.status === 200 && built.length === 1 && JSON.stringify(built[0].input) === JSON.stringify(matchReview.normalise(reviewBody))
        && promptOf(prov.sent[0]) === built[0].p && prov.sent[0].body.max_tokens === 1600 && prov.sent[0].body.model === reviewModel
        && JSON.stringify(Object.keys(asToday.body)) === '["review","summary","rounds","focus","study","variant"]'
        && asToday.body.summary === want.summary && asToday.body.focus === want.focus && asToday.body.rounds[2] === want.rounds[2],
      "an 8.4.4 install's review is its own prompt, the review model and its room, and the reply's own fields, nothing added");
      // STUDY BY CAUSE (match-review.js CAUSE_TOPICS) for a client of 8.5.0 or
      // later alone: an 8.4.4 install's study notes are today's, byte for byte.
      const dry = (n) => ({ n, side: 'attacking', result: 'lost', died: true, verified: true, cause: 'dry-peek' });
      const causeBody = { rounds: [dry(2), dry(5), { n: 3, side: 'attacking', result: 'won', died: false }], patterns: [],
        mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'Died 2 times', rounds: [2, 5], count: 2 }],
        context: { agent: 'Omen', map: 'Pearl' } };
      prov.next = () => ({ content: 'SUMMARY: You swung without utility.\nFOCUS: Use your smoke first.' });
      const oldStudy = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1), 'X-Occlara-Version': OLD }, body: causeBody });
      const newStudy = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1), 'X-Occlara-Version': NEW }, body: causeBody });
      const todayStudy = matchReview.study(matchReview.normalise(causeBody), 3);
      const causeStudy = matchReview.study({ ...matchReview.normalise(causeBody), byCause: true }, 3);
      ok(JSON.stringify(oldStudy.body.study) === JSON.stringify(todayStudy) && JSON.stringify(newStudy.body.study) === JSON.stringify(causeStudy)
        && JSON.stringify(todayStudy) !== JSON.stringify(causeStudy),
      'study by cause goes to a client of 8.5.0 or later, and an 8.4.4 install is listed today\'s study notes');
      // An unpinned call keeps its fallback, and its strike moves the text model.
      prov.sent.length = 0;
      prov.next = (body) => ({ content: body.model === textModel ? '' : 'Trade your teammate first, then take the angle with them.' });
      const old = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': licence(2), 'X-Occlara-Version': OLD },
        body: { messages: [{ role: 'user', content: 'How do I stop dying first?' }], context: { game: 'valorant' } } });
      ok(old.status === 200 && prov.sent.length === 2 && prov.sent[0].body.model === textModel && prov.sent[1].body.model === 'qwen/qwen3.7-flash',
        `an old client's Ask Coach, unpinned, still asks the backstop once when its model is empty (${prov.sent.map((s) => s.body.model).join(', ')})`);
      ok(T.textModelNow() === 'qwen/qwen3.7-flash' && coach.liveModels().textModelNow === 'qwen/qwen3.7-flash' && coach.liveModels().textModel === textModel,
        "and that model's own strike moves the text model, which /health's textModelNow says beside the configured one");
      // A PINNED CALL STRIKES NOTHING, even one pinned to the configured text
      // model itself: bench:review and bench:chat bench Gemini 3 Flash, the
      // text model's own default, and one bench answer empty or cut off by v2's
      // deadline moved every old client's Ask Coach to the backstop until a restart.
      T.textStrikes.clear();
      prov.sent.length = 0;
      prov.next = () => ({ content: '' });
      const benched = await call(coach, 'POST', '/match-review', { headers: { 'X-License-Key': licence(1), 'X-Admin-Password': PW },
        body: { ...reviewBody, benchModel: textModel } });
      ok(textModel === 'google/gemini-3-flash-preview' && benched.status === 200 && benched.body.summary === null && prov.sent.length === 1
        && prov.sent[0].body.model === textModel && T.textModelNow() === textModel && !T.textStrikes.has(textModel),
      `a review benched on the text model's own model coming back empty strikes nothing: unpinned calls stay on it (${T.textModelNow()})`);
      // With no pinned call striking, only the configured text model and its
      // backstops are ever struck; a strike on any other, should one be
      // booked, is that model's alone, and textModelNow reads its own.
      T.textStrikes.set('openai/gpt-6-sol', 1);
      ok(T.textModelNow() === textModel, `and a strike on another model is that model's alone: the text model stays (${T.textModelNow()})`);
      T.textStrikes.clear();
      delete process.env.AI_TEXT_MODEL_FALLBACK;
      ok(T.textModelNow() === textModel, 'struck by nothing, the configured text model is the one called');
    }

    // ── /health names the models, and no count of Ask Coach's ──────────────
    {
      const live = coach.liveModels();
      ok(live.chatModel === 'openai/gpt-6-sol' && live.textModelNow === live.textModel && !/asked|honest|capped|retried/.test(JSON.stringify(live)),
        `/health names chatModel (${live.chatModel}) and textModelNow, and carries none of Ask Coach's counts`);
    }

    // ── Ask Coach: a client before 8.5.0 gets today's, byte for byte ───────
    // The prompts an 8.4.4 install's /chat sent before 8.5.0 (scratchpad
    // baseline at ff3ebbc): their length and sha256, the model, its room and
    // its temperature. Playbook off, so no note in them moves.
    const STATS = { rank: 'Gold 2', peakRank: 'Gold 3', kd: 1.12, winRate: 52, headshotPct: 21, bodyshotPct: 70, topAgent: 'Jett',
      matches: 25, kpr: 0.78, dpr: 0.7, apr: 0.2, adr: 141, acs: 221 };
    const SEEDED = {
      messages: [{ role: 'user', content: 'Why did I lose round 5?' }],
      context: {
        game: 'valorant', agent: 'Jett', sessionTips: [], matchMemory: [], stats: STATS, noSessionYet: false,
        recentMatches: [{ map: 'Fracture', agent: 'Jett', result: 'Victory', score: '5-1', kills: 9, deaths: 4, assists: 1, kd: 2.25,
          acs: 290, adr: 180, headshotPct: 25, rating: 92, queue: 'Swiftplay', when: 'Oct 13, 9:40 PM' }],
        recentSessions: [{ date: 'Oct 13', map: 'Fracture', overall: 84, scores: { survival: 70, impact: 90, teamplay: 80, decisions: 50 },
          strengths: 'Multi kill rounds', weaknesses: 'Repeeks' }],
        matchReview: 'Fracture, Jett, Victory 5-1 (Swiftplay). Grade 84 A.\nRound 5: lost, died 33s in to Jett with a Sheriff.',
        proPlaybook: 'off',
      },
    };
    const PLAIN = {
      messages: [{ role: 'user', content: 'How do I stop dying first?' }, { role: 'assistant', content: 'Wait for a teammate.' },
        { role: 'user', content: 'And on attack?' }],
      context: { game: 'valorant', agent: null, sessionTips: [], matchMemory: [], stats: null, noSessionYet: true, recentMatches: [],
        recentSessions: [], matchReview: null, proPlaybook: 'off' },
    };
    const LEAGUE = {
      messages: [{ role: 'user', content: 'How do I farm better?' }],
      context: { game: 'lol', agent: null, sessionTips: [], matchMemory: [], stats: null, noSessionYet: false, recentMatches: [],
        recentSessions: [], matchReview: 'League review text', proPlaybook: 'off' },
    };
    const TODAY = [
      [SEEDED, 4940, '298727a70b655501f89917ca9264b0c67beaa44bbc66d3022f9eaf1effc3291e'],
      [PLAIN, 3607, '64ca5976c1930f43da157e98a30f3ef18e9c03ca8c05b9defbda0629a89563fe'],
      [LEAGUE, 2622, '4e6f85a3aff6bbdc5eb95636d2a3a44184f9d13fa28db4f1142f934a0eb12560'],
    ];
    const MATCH_ID = '8b9f0c2e-1d3a-4c5b-9e7f-0a1b2c3d4e5f';
    const V2 = (extra) => ({ v: 2, game: 'valorant', language: 'en', advanced: false,
      match: { id: 'valorant-1791938248922-eq7o3v', matchId: MATCH_ID, map: 'Fracture', agent: 'Jett', result: 'Victory', score: '5-1' },
      player: {}, ask: { round: 5 }, ...(extra || {}) });
    const ask = async (body, headers) => {
      prov.sent.length = 0;
      const r = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': licence(3), ...(headers || {}) }, body });
      return { r, body: r.body || {}, sent: prov.sent.slice() };
    };
    const sameAsToday = (out, len, hash) => out.r.status === 200 && out.sent.length === 1 && promptOf(out.sent[0]).length === len
      && sha(promptOf(out.sent[0])) === hash && out.sent[0].body.model === T.AI.textModel && out.sent[0].body.max_tokens === 420
      && out.sent[0].body.temperature === 0.5 && JSON.stringify(Object.keys(out.body)) === '["reply"]';
    prov.next = null;
    {
      const moved = [];
      for (const [body, len, hash] of TODAY) {
        const out = await ask(body, { 'X-Occlara-Version': OLD });
        if (!sameAsToday(out, len, hash)) moved.push(`${promptOf(out.sent[0]).length} characters where ${len} were`);
      }
      ok(moved.length === 0, `an 8.4.4 install's Ask Coach is today's prompt, model, room and temperature, byte for byte${moved.length ? ` (${moved.join('; ')})` : ''}`);
      process.env.CHAT_PROMPT = 'v2';
      const v2fields = await ask({ ...SEEDED, context: { ...SEEDED.context, ...V2() }, variant: 'v2', benchModel: 'qwen/qwen3.7-flash' },
        { 'X-Occlara-Version': OLD });
      ok(sameAsToday(v2fields, TODAY[0][1], TODAY[0][2]),
        'and so it is with CHAT_PROMPT=v2 set, a v2 context beside today\'s fields, and v2 and a bench model named without the admin password');
      const noV = await ask({ ...SEEDED, context: { ...SEEDED.context, ...V2(), v: 1 } }, { 'X-Occlara-Version': NEW });
      ok(sameAsToday(noV, TODAY[0][1], TODAY[0][2]), 'and for an 8.5.0 client whose context is not v2');
      // v2 is the default for 8.5.0 and later since 23 Oct; CHAT_PROMPT=v1
      // turns it off.
      process.env.CHAT_PROMPT = 'v1';
      const off = await ask({ ...SEEDED, context: { ...SEEDED.context, ...V2() } }, { 'X-Occlara-Version': NEW });
      ok(sameAsToday(off, TODAY[0][1], TODAY[0][2]), 'and for an 8.5.0 client with CHAT_PROMPT=v1: v2 is off');
      // An 8.5.0 client sends its matches without the 0 to 100 rating, and
      // today's prompt, which answers it while v2 is off, said "rating
      // undefined" on every line.
      const unrated = SEEDED.context.recentMatches.map(({ rating, ...m }) => m);
      const noRating = await ask({ ...SEEDED, context: { ...SEEDED.context, ...V2(), recentMatches: unrated } }, { 'X-Occlara-Version': NEW });
      const p = promptOf(noRating.sent[0]);
      ok(noRating.r.status === 200 && !/rating undefined|rating is 0-100/.test(p) && p.includes('Their recent matches (newest first):\n')
        && p.includes('ACS 290, ADR 180, HS 25%\n'),
      `and its matches without a rating are listed without one, never "rating undefined" (${(p.match(/HS 25%[^\n]*/) || [''])[0]})`);
      delete process.env.CHAT_PROMPT;
      const oldDefault = await ask(TODAY[0][0], { 'X-Occlara-Version': OLD });
      ok(sameAsToday(oldDefault, TODAY[0][1], TODAY[0][2]), 'and with CHAT_PROMPT unset, v2\'s default, an 8.4.4 install\'s Ask Coach is still today\'s, byte for byte');
    }

    // ── Ask Coach v2, on a stand in for chat-prompt.js ────────────────────
    // The interface the route is written to: normalise(context) -> input;
    // buildPrompt(input, messages, { variant }) -> the prompt; parseReply(raw,
    // input, { messages, names, nameSet, language, variant }) -> { reply,
    // retry, reasons, dropped }. This stand in drops a sentence saying BAD and
    // asks again when the first sentence went or fewer than two are left.
    const stand = {
      seen: [],
      normalise(ctx) { return { v: 2, language: ctx.language || 'en', map: ctx.match ? ctx.match.map : null }; },
      buildPrompt(input, messages, opts) {
        return `V2 PROMPT (${opts && opts.variant}) on ${input.map}\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`;
      },
      parseReply(raw, input, opts) {
        this.seen.push({ raw, opts });
        const dropped = {};
        let n = 0;
        let kept = 0;
        let firstGone = false;
        const paras = String(raw || '').split(/\n\s*\n/).map((p) => (p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).filter((s) => {
          n++;
          if (/BAD/.test(s)) { dropped.number = (dropped.number || 0) + 1; if (n === 1) firstGone = true; return false; }
          kept++;
          return true;
        }).join(' ').trim()).filter(Boolean);
        const retry = firstGone || kept < 2;
        // The name rule in log mode: counted, never dropped.
        const logged = /\bLOGGED\b/.test(String(raw)) ? { 'name-log': 1 } : {};
        return { reply: paras.join('\n\n'), retry, reasons: retry ? ['your reply said BAD, which the facts do not hold.'] : [], dropped,
          logged, sentences: n };
      },
    };
    T.services({ chatPrompt: stand });
    const GOOD = 'Round 5 was the pistol round after the swap, and your team lost it.\n\nNext time, take your shot from cover, then step out of that sightline.';
    const v2body = (extra) => ({ messages: [{ role: 'user', content: 'Why did I lose round 5?' }],
      context: { ...SEEDED.context, ...V2() }, ...(extra || {}) });
    process.env.CHAT_PROMPT = 'v2';
    {
      prov.next = () => ({ content: GOOD });
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      const s = out.sent[0] || { body: {} };
      ok(out.r.status === 200 && out.sent.length === 1 && s.body.model === 'openai/gpt-6-sol' && s.body.max_tokens === 900
        && s.body.temperature === 0.4 && promptOf(s).startsWith('V2 PROMPT (v2) on Fracture'),
      `an 8.5.0 client with CHAT_PROMPT=v2 is answered by v2: its prompt, the pinned chat model, 900 tokens at 0.4 (${s.body.model}, ${s.body.max_tokens}, ${s.body.temperature})`);
      ok(out.body.v === 2 && out.body.reply === GOOD && /\n\n/.test(out.body.reply) && out.body.honest === false && out.body.retried === false
        && !('model' in out.body) && !('variant' in out.body),
      'its reply keeps its paragraphs, and says v2 answered, nothing honest-lined or retried, no bench fields');
    }
    {
      prov.next = () => ({ content: `Your team lost round 5 ${EM} you took the fight early.\n\n**Next time** ${EN} hold the angle - then swing.` });
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(out.body.reply === 'Your team lost round 5, you took the fight early.\n\nNext time, hold the angle, then swing.'
        && ![0x2013, 0x2014].some((c) => out.body.reply.includes(String.fromCharCode(c))),
      `each paragraph sanitised on its own: dashes made commas, markdown gone, the paragraphs kept (${JSON.stringify(out.body.reply)})`);
    }
    {
      // Bench: an admin naming v2 or its control, with or without a version.
      prov.next = () => ({ content: GOOD });
      const bench = await ask(v2body({ variant: 'v2-noprimer', benchModel: 'google/gemini-3-flash-preview' }), { 'X-Admin-Password': PW });
      ok(bench.r.status === 200 && bench.sent[0].body.model === 'google/gemini-3-flash-preview' && promptOf(bench.sent[0]).startsWith('V2 PROMPT (v2-noprimer)')
        && bench.body.model === 'google/gemini-3-flash-preview' && bench.body.variant === 'v2-noprimer',
      'an admin bench naming v2-noprimer and a bench model gets both, and is told which answered, on no version at all');
      const player = await ask(v2body({ benchModel: 'google/gemini-3-flash-preview' }), { 'X-Occlara-Version': NEW });
      ok(player.sent[0].body.model === 'openai/gpt-6-sol' && player.body.model === 'openai/gpt-6-sol',
        'a licence naming a bench model on v2 is answered by the chat model, and told so, as /read tells one');
      process.env.CHAT_PROMPT = 'v1';
      const benchOff = await ask(v2body({ variant: 'v2' }), { 'X-Admin-Password': PW, 'X-Occlara-Version': OLD });
      ok(promptOf(benchOff.sent[0]).startsWith('V2 PROMPT (v2)') && benchOff.body.variant === 'v2',
        'and an admin bench gets v2 while CHAT_PROMPT=v1, on an old version header too');
      const playerOff = await ask(v2body({ variant: 'v2' }), { 'X-Occlara-Version': NEW });
      ok(sameAsToday(playerOff, TODAY[0][1], TODAY[0][2]), 'while a player naming v2 with CHAT_PROMPT=v1 gets today\'s, byte for byte');
      delete process.env.CHAT_PROMPT;
      prov.next = () => ({ content: GOOD });
      const byDefault = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(promptOf(byDefault.sent[0] || { body: {} }).startsWith('V2 PROMPT (v2) on Fracture') && byDefault.body.v === 2 && byDefault.sent[0].body.model === 'openai/gpt-6-sol',
        'and with CHAT_PROMPT unset an 8.5.0 client is answered by v2, the default since its bench');
      process.env.CHAT_PROMPT = 'v2';
    }
    {
      // No other model ever: empty twice is the honest line, both on the chat model.
      prov.next = () => ({ content: '' });
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(out.r.status === 200 && out.body.reply === T.HONEST_LINE && out.body.honest === true && out.body.retried === true
        && out.sent.length === 2 && out.sent.every((s) => s.body.model === 'openai/gpt-6-sol') && out.sent[1].body.max_tokens === 500,
      `an empty answer is asked again once, of the same model at 500 tokens, then the honest line: no other model answers (${out.sent.map((s) => `${s.body.model}/${s.body.max_tokens}`).join(', ')})`);
      ok(T.textModelNow() === T.AI.textModel, "and the chat model's strikes move nothing else");
      // bench:chat benches the text model's own model on v2: empty twice there
      // is the honest line too, and moves no old client's Ask Coach off it.
      T.textStrikes.clear();
      process.env.AI_TEXT_MODEL_FALLBACK = 'qwen/qwen3.7-flash';
      const benched = await ask(v2body({ variant: 'v2', benchModel: T.AI.textModel }), { 'X-Admin-Password': PW });
      ok(benched.body.honest === true && benched.sent.length === 2 && benched.sent.every((s) => s.body.model === T.AI.textModel)
        && T.textModelNow() === T.AI.textModel && !T.textStrikes.has(T.AI.textModel),
      `and a v2 bench on the text model's own model, empty twice, strikes nothing: unpinned calls stay on ${T.AI.textModel} (${T.textModelNow()})`);
      delete process.env.AI_TEXT_MODEL_FALLBACK;
      T.textStrikes.clear();
    }
    {
      // The gates' retry carries its reasons, and its answer is the reply.
      prov.next = (body, init, k) => ({ content: k === 1 ? 'The Sheriff does 160 BAD to the head. Then you died. Then the round.' : GOOD });
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(out.sent.length === 2 && /YOUR LAST REPLY COULD NOT BE USED\. your reply said BAD, which the facts do not hold\./.test(promptOf(out.sent[1]))
        && out.body.reply === GOOD && out.body.retried === true && out.body.honest === false && out.body.dropped.number === 1,
      `a reply whose first sentence the gates dropped is asked for again with the reasons named, and the answer that passes is the reply (${JSON.stringify(out.body.dropped)})`);
      prov.next = () => ({ content: 'BAD one. BAD two. Good three.' });
      const both = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(both.sent.length === 2 && both.body.reply === T.HONEST_LINE && both.body.honest && both.body.dropped.number === 4,
        `and one that fails the gates again is the honest line, its drops counted by gate (${JSON.stringify(both.body.dropped)})`);
      prov.next = () => ({ content: 'Good one. BAD two. Good three.\n\nGood four LOGGED.' });
      const fine = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(fine.sent.length === 1 && fine.body.reply === 'Good one. Good three.\n\nGood four LOGGED.' && fine.body.retried === false
        && fine.body.dropped.number === 1, 'a sentence dropped further in is dropped, never repaired, and asks nothing again');
      ok(fine.body.sentences === 4 && fine.body.logged['name-log'] === 1 && both.body.sentences === 6,
        `and the reply says how many sentences the gates weighed and what a rule in log mode would have dropped, for the bench's rates (${fine.body.sentences}, ${JSON.stringify(fine.body.logged)})`);
    }
    {
      // THE 40 s BUDGET, scaled: a provider slow past the first call's 28 s.
      const real = { ...T.CHAT_TIMES };
      Object.assign(T.CHAT_TIMES, { budgetMs: 600, firstMs: 420, retryMinMs: 225 });
      prov.next = (body, init) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ content: GOOD }), 900);
        if (init.signal) init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason || new Error('aborted')); });
      });
      const t0 = Date.now();
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      const took = Date.now() - t0;
      ok(out.body.reply === T.HONEST_LINE && out.body.honest && out.body.retried === false && out.sent.length === 1 && took < 600,
        `a provider slow past the first call's deadline is not asked again with too little left, and the honest line is out inside the budget (${took} ms of 600, ${out.sent.length} call)`);
      await sleep(1100);
      ok(out.sent[0].signal && out.sent[0].signal.aborted, 'and the abandoned call is cancelled upstream, not left generating');
      // Time for a retry, and none for a third.
      Object.assign(T.CHAT_TIMES, { budgetMs: 2000, firstMs: 1400, retryMinMs: 750 });
      prov.next = () => ({ content: 'BAD one. Good two.' });
      const quick = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(quick.sent.length === 2 && quick.body.honest, 'with the time for it, a failed reply is asked for once more, never a third time');
      Object.assign(T.CHAT_TIMES, { budgetMs: 2000, firstMs: 1400, retryMinMs: 2500 });
      const late = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(late.sent.length === 1 && late.body.honest, 'and with less than the retry\'s 15 s left (scaled), the honest line at once');
      Object.assign(T.CHAT_TIMES, real);
      ok(T.CHAT_TIMES.budgetMs === 40000 && T.CHAT_TIMES.firstMs === 28000 && T.CHAT_TIMES.retryMinMs === 15000
        && T.CHAT_TOKENS === 900 && T.CHAT_RETRY_TOKENS === 500 && T.CHAT_TEMPERATURE === 0.4 && T.CHAT_MAX_CHARS === 4000,
      'as shipped: 40 s in all, the first call abandoned at 28 s, a retry only with 15 s left at 500 tokens, 900 at 0.4, 4,000 characters');
    }
    {
      // The round is read before the Riot ID scrub; the match's names go to the gates and are dropped.
      ok(T.scrubAsked('what happened in round #12?') === 'what happened in round 12?'
        && T.scrubAsked('Morvane#EUW killed me in round 5') === 'a player killed me in round 5'
        && T.scrubAsked('around #3 seconds') === 'around #3 seconds' && T.scrubAsked('round#7 and round # 8') === 'round 7 and round 8',
      'round #12 is round 12, read before the Riot ID scrub, which still takes Morvane#EUW, and "around #3" is no round');
      riotRounds.noteNames(MATCH_ID, { players: [{ name: 'Morvane', tag: 'EUW', team_id: 'Red' }, { name: 'Me', tag: 'EUW', team_id: 'Blue' }] });
      stand.seen.length = 0;
      prov.next = () => ({ content: 'You lost round 12 on the plant.\n\nYour teammate morvane was ahead of you. Hold the angle together next time. Swing as two.' });
      const out = await ask({ messages: [{ role: 'user', content: 'what happened in round #12? Morvane#EUW was with me' }],
        context: { ...SEEDED.context, ...V2() } }, { 'X-Occlara-Version': NEW });
      const seen = stand.seen[0] || { opts: {} };
      ok(promptOf(out.sent[0]).includes('user: what happened in round 12? a player was with me'),
        `the question reaches the prompt with its round and without the Riot ID (${promptOf(out.sent[0]).split('\n').pop()})`);
      ok(seen.opts.names && seen.opts.nameSet === seen.opts.names && seen.opts.names.has('teammate morvane') && seen.opts.language === 'en'
        && Array.isArray(seen.opts.messages) && !JSON.stringify(seen.opts.names).includes('morvane'),
      "the gates are handed the match's name set, which answers has() and prints nothing");
      ok(out.body.reply === 'You lost round 12 on the plant.\n\nHold the angle together next time. Swing as two.' && out.body.dropped.nameSet === 1,
        `and a sentence the gates let through with a word of a player's name in it is dropped here (${JSON.stringify(out.body.dropped)})`);
    }
    {
      // AN ADMIN BENCH IS SENT THE MODEL'S OWN TEXT (bench:chat scores raw
      // replies): the first reply and the retry's, as written, with a sentence
      // carrying a word of the match's name set withheld even there, and the
      // calls' usage, the cached prompt tokens beside the rest. Never to a
      // licence's own question, raw: true or not.
      const nameGate = require(path.join(SERVER, 'services', 'name-gate.js'));
      const usage = { prompt_tokens: 6100, completion_tokens: 320, prompt_tokens_details: { cached_tokens: 4800 }, cost: 0.02 };
      const FIRST = 'BAD start, the facts do not hold it. Your teammate morvane was ahead of you. Hold the angle.';
      prov.next = (body, init, k) => ({ content: k === 1 ? FIRST : GOOD, usage });
      const bench = await ask(v2body({ variant: 'v2', benchModel: 'google/gemini-3-flash-preview', raw: true }), { 'X-Admin-Password': PW });
      ok(bench.sent.length === 2 && bench.body.reply === GOOD && bench.body.retried === true
        && bench.body.raw === `BAD start, the facts do not hold it. ${nameGate.WITHHELD} Hold the angle.` && bench.body.rawRetry === GOOD,
      `an admin bench asking raw: true is sent the model's own first reply and the retry's, a sentence naming a player of the match withheld even there (${JSON.stringify(bench.body.raw)})`);
      ok(bench.body.usage && bench.body.usage.prompt === 12200 && bench.body.usage.cached === 9600 && bench.body.usage.completion === 640
        && bench.body.usage.calls === 2 && !/morvane/i.test(JSON.stringify(bench.body)),
      `and both calls' usage, the cached prompt tokens apart, so the bench can see the prefix cache work (${JSON.stringify(bench.body.usage)})`);
      prov.next = () => ({ content: GOOD, usage });
      const player = await ask(v2body({ raw: true }), { 'X-Occlara-Version': NEW });
      const notAdmin = await ask(v2body({ variant: 'v2', benchModel: 'google/gemini-3-flash-preview', raw: true }), { 'X-Admin-Password': 'guess', 'X-Occlara-Version': NEW });
      ok(player.body.v === 2 && !('raw' in player.body) && !('rawRetry' in player.body) && !('usage' in player.body)
        && !('raw' in notAdmin.body) && !('usage' in notAdmin.body),
      'a licence asking raw: true, or a bench with the wrong password, is sent the reply alone');
    }
    {
      // The cap: $0.15 a rolling day, from what was booked.
      const KEY = licence(9);
      const realNow = Date.now;
      let now = Date.parse('2030-03-01T12:00:00.000Z');
      Date.now = () => now;
      try {
        const asks = [];
        prov.next = () => ({ content: GOOD, cost: 0.06 });
        for (let i = 0; i < 4; i++) {
          prov.sent.length = 0;
          const r = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': KEY, 'X-Occlara-Version': NEW }, body: v2body() });
          asks.push({ status: r.status, body: r.body, calls: prov.sent.length });
          now += 60 * 1000;
        }
        const fourth = asks[3];
        ok(asks.slice(0, 3).every((a) => a.status === 200 && a.calls === 1) && fourth.status === 429 && fourth.body.error === 'chat-daily'
          && fourth.calls === 0 && fourth.body.resetsAt === new Date(Date.parse('2030-03-01T12:00:00.000Z') + 24 * 3600 * 1000).toISOString(),
        `three questions at $0.06 book $0.18, and the next is 429 chat-daily before any model is called, back when the first leaves the day (${fourth.status} ${JSON.stringify(fourth.body)})`);
        const oldClient = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': KEY, 'X-Occlara-Version': OLD }, body: SEEDED });
        ok(oldClient.status === 200 && JSON.stringify(Object.keys(oldClient.body)) === '["reply"]', 'a client before 8.5.0 on the same licence is never capped');
        const ledger = (T.chatLedger.get(KEY) || []).length;
        const bench = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': KEY, 'X-Admin-Password': PW }, body: v2body({ variant: 'v2' }) });
        ok(bench.status === 200 && bench.body.v === 2 && (T.chatLedger.get(KEY) || []).length === ledger,
          'an admin bench on the same licence is answered and never counted in it');
        const frameBody = { question: 'Why did I die here?', images: ['x'.repeat(200)], state: { map: 'Fracture' } };
        const frameNew = await call(coach, 'POST', '/frame-chat', { headers: { 'X-License-Key': KEY, 'X-Occlara-Version': NEW }, body: frameBody });
        const frameOld = await call(coach, 'POST', '/frame-chat', { headers: { 'X-License-Key': KEY, 'X-Occlara-Version': OLD }, body: frameBody });
        ok(frameNew.status === 429 && frameNew.body.error === 'chat-daily' && frameOld.status === 200 && frameOld.body.reply,
          `from 8.5.0 frame chat is inside the cap, and before it never (${frameNew.status}, ${frameOld.status})`);
        now = Date.parse('2030-03-02T12:00:30.000Z');
        prov.sent.length = 0;
        const nextDay = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': KEY, 'X-Occlara-Version': NEW }, body: v2body() });
        ok(nextDay.status === 200 && nextDay.body.v === 2 && prov.sent.length === 1, 'and 24 hours after the first question, the next is answered');
        process.env.CHAT_DAY_QUESTIONS = '2';
        process.env.CHAT_DAY_USD = '5';
        const q = licence(10);
        prov.next = () => ({ content: GOOD, cost: 0.0001 });
        const counted = [];
        for (let i = 0; i < 3; i++) {
          counted.push((await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': q, 'X-Occlara-Version': NEW }, body: v2body() })).status);
        }
        ok(counted.join() === '200,200,429' && T.chatCap().questions === 2 && T.chatCap().usd === 5,
          `CHAT_DAY_QUESTIONS bounds the list and CHAT_DAY_USD the dollars, as Railway sets them (${counted.join(', ')})`);
        delete process.env.CHAT_DAY_QUESTIONS;
        delete process.env.CHAT_DAY_USD;
        ok(T.chatCap().usd === 0.15 && T.chatCap().questions === 40, 'and unset, $0.15 and 40 questions');
      } finally {
        Date.now = realNow;
      }
    }
    {
      const rep = T.chatReport();
      ok(rep.asked.v2 > 5 && rep.honest > 0 && rep.retried > 0 && rep.capped >= 2 && rep.dropped.number > 0 && rep.dropped.nameSet === 1
        && rep.asked.frame > 0 && rep.asked.v1 > 0 && !/GC-CORE|morvane/i.test(JSON.stringify(rep)),
      `the day's counts for /api/admin/chat: questions, drops by gate, retries, honest lines and refusals, no licence and no name (${JSON.stringify({ asked: rep.asked, honest: rep.honest, retried: rep.retried, capped: rep.capped })})`);
    }
    {
      // A v2 context the service cannot take, or no service at all: today's answer.
      const broken = { ...stand, normalise() { throw new Error('a context it could not read'); } };
      T.services({ chatPrompt: broken });
      prov.next = null;
      const out = await ask(v2body(), { 'X-Occlara-Version': NEW });
      ok(out.r.status === 200 && promptOf(out.sent[0]).length > 1000 && !promptOf(out.sent[0]).startsWith('V2') && !('v' in out.body),
        'a v2 context chat-prompt.js cannot take is answered as today, never left unanswered');
      T.services({ chatPrompt: stand });
    }
    {
      // And the real chat-prompt.js: the route's half and the prompt's half fit.
      T.services({ chatPrompt: null });
      const context = { ...SEEDED.context, v: 2, game: 'valorant', language: 'en', advanced: false,
        match: { id: 'valorant-1791938248922-eq7o3v', matchId: MATCH_ID, at: Date.parse('2026-10-13T21:40:00Z'), source: 'watched',
          verified: true, endedEarly: false, map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1', rounds: 6,
          watched: [1, 2, 3, 4, 5, 6], comps: { us: [{ agent: 'Jett', role: 'Duelist' }], them: [{ agent: 'Jett', role: 'Duelist' }] },
          cards: [{ n: 5, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: true,
            riot: { sec: 33, killer: 'Jett', weapon: 'Sheriff', firstDeath: false, firstKill: true, kills: 2, traded: false, trades: 0,
              alive: { mates: 4, enemies: 3 }, clutch: null, afterPlant: true, plantSite: 'A', plantSec: 20,
              feed: [{ s: 10, by: 'me', on: 'enemy', ka: 'Jett', va: 'Sova', w: 'Bandit' }, { s: 33, by: 'enemy', on: 'me', ka: 'Jett', va: 'Jett', w: 'Sheriff' }] },
            look: null, why: null }] },
        player: { patterns: [], recent: [] }, ask: { round: 5 } };
      prov.next = () => ({ content: 'You lost round 5 on Fracture after the plant, with your team up 4 against 3.\n\nNext time, take your shot from cover, then step out of that sightline.' });
      process.env.CHAT_PROMPT = 'v2';
      const out = await ask({ messages: [{ role: 'user', content: 'Why did I lose round 5?' }], context }, { 'X-Occlara-Version': NEW });
      const s = out.sent[0] || { body: {} };
      ok(out.r.status === 200 && out.body.v === 2 && promptOf(s).startsWith("You are Occlara's Valorant coach") && s.body.model === 'openai/gpt-6-sol'
        && s.body.max_tokens === 900 && typeof out.body.reply === 'string' && out.body.reply.length > 20 && out.body.sentences > 0,
      `and with the real chat-prompt.js the two halves fit: its prompt, the pinned model and its room, a reply and its counts (${out.r.status}, ${promptOf(s).length} characters)`);
      T.services({ chatPrompt: stand });
    }
    delete process.env.CHAT_PROMPT;

    // ── The death look: today's for a client before 8.5.0, b by the gate ────
    {
      const IMG = 'x'.repeat(5000);
      const lookBody = (extra) => ({ agent: 'Jett', map: 'Fracture', matchId: MATCH_ID,
        deaths: [{ n: 5, side: 'attacking', sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false, firstDeath: false,
          alive: { mates: 4, enemies: 3 }, planted: true, afterPlant: true, frames: [IMG, IMG, IMG, IMG, IMG],
          frameAt: [-3, -1.5, -0.7, -0.3, 0.7], framesFrom: 'recording' },
        { n: 2, side: 'attacking', sec: 20, killer: 'Raze', weapon: 'Vandal', traded: true, frames: [IMG, IMG] }], ...(extra || {}) });
      const look = async (body, headers) => {
        prov.sent.length = 0;
        const r = await call(coach, 'POST', '/death-forensics', { headers: { 'X-License-Key': licence(4), ...(headers || {}) }, body });
        return { r, body: r.body || {}, sent: prov.sent.slice() };
      };
      prov.next = () => ({ content: '{"cause": "lost-duel", "what": "You fired at Jett from cover.", "better": "Fall back after your first shots."}' });
      const asToday = (out, body) => {
        const want = frozen844.normalise(body);
        const prompts = want.deaths.map((d) => frozen844.buildPrompt(want, d));
        const sent = out.sent.map(promptOf).sort();
        return out.r.status === 200 && JSON.stringify(sent) === JSON.stringify(prompts.slice().sort())
          && out.sent.every((s) => s.body.max_tokens === 320) && JSON.stringify(Object.keys(out.body)) === '["deaths","model"]';
      };
      process.env.FORENSICS_PROMPT = 'b';
      const old = await look(lookBody(), { 'X-Occlara-Version': OLD });
      ok(asToday(old, lookBody()), `an 8.4.4 install's look is the look 8.4.4 shipped: the same prompt for every death, 320 tokens, a reply of deaths and model alone, with FORENSICS_PROMPT=b set (${old.sent.length} looks)`);
      const named = await look(lookBody({ variant: 'b' }), { 'X-Occlara-Version': OLD });
      ok(named.sent.every((s) => s.body.max_tokens === 320) && named.body.variant === 'a',
        'a licence naming b is looked at with today\'s prompt, and told so (variant a)');
      delete process.env.FORENSICS_PROMPT;
      // b2 is the default for 8.5.0 and later since its bench (22 Oct), and
      // never reaches a client before it.
      const oldDefault = await look(lookBody(), { 'X-Occlara-Version': OLD });
      ok(asToday(oldDefault, lookBody()), `and with FORENSICS_PROMPT unset, b2's default, an 8.4.4 install's look is still the look 8.4.4 shipped (${oldDefault.sent.length} looks)`);

      // What the route hands the look: watched on the module itself. The
      // match's name set noted again: the cap's day on a clock four years on
      // let the one above lapse, as a day does.
      riotRounds.noteNames(MATCH_ID, { players: [{ name: 'Morvane', tag: 'EUW', team_id: 'Red' }, { name: 'Me', tag: 'EUW', team_id: 'Blue' }] });
      const realBuild = deathForensics.buildPrompt;
      const realVariants = deathForensics.VARIANTS;
      const handed = [];
      deathForensics.buildPrompt = (input, death) => { handed.push({ variant: input.variant, matchId: input.matchId, version: input.version,
        names: input.names, n: death.n }); return realBuild(input, death); };
      if (!Array.isArray(deathForensics.VARIANTS) || !deathForensics.VARIANTS.includes('b')) deathForensics.VARIANTS = ['b'];
      try {
        process.env.FORENSICS_PROMPT = 'a';
        const live = await look(lookBody(), { 'X-Occlara-Version': NEW });
        ok(live.body.variant === 'a' && handed.every((h) => h.variant !== 'b' && h.variant !== 'b2') && live.sent.every((s) => s.body.max_tokens === 320),
          'an 8.5.0 client is looked at with today\'s prompt when FORENSICS_PROMPT=a, and told so');
        handed.length = 0;
        delete process.env.FORENSICS_PROMPT;
        const byDefault = await look(lookBody(), { 'X-Occlara-Version': NEW });
        ok(byDefault.body.variant === 'b2' && handed.length === 2 && handed.every((h) => h.variant === 'b2')
          && byDefault.sent.every((s) => s.body.max_tokens === 400),
        `and with FORENSICS_PROMPT unset it gets b2, the default since its bench, its 400 tokens, and is told so (${JSON.stringify(handed.map((h) => h.variant))})`);
        handed.length = 0;
        process.env.FORENSICS_PROMPT = 'b';
        const b = await look(lookBody(), { 'X-Occlara-Version': NEW });
        ok(b.body.variant === 'b' && handed.length === 2 && handed.every((h) => h.variant === 'b' && h.matchId === MATCH_ID && h.version === NEW)
          && b.sent.every((s) => s.body.max_tokens === 400),
        `once promoted, an 8.5.0 client gets variant b, its 400 tokens, and the look its version and match id (${JSON.stringify(handed.map((h) => h.variant))})`);
        ok(handed.every((h) => h.names && typeof h.names.has === 'function' && h.names.has('killed by Morvane') && !h.names.has('Hold the angle')),
          "and the match's name set, which the look's name gate reads and nothing prints");
        const control = await look(lookBody({ variant: 'a' }), { 'X-Admin-Password': PW, 'X-Occlara-Version': NEW });
        ok(control.body.variant === 'a' && control.sent.every((s) => s.body.max_tokens === 320),
          'an admin bench naming a gets today\'s prompt, its control, whatever FORENSICS_PROMPT says');
        delete process.env.FORENSICS_PROMPT;
        handed.length = 0;
        const bench = await look(lookBody({ variant: 'b', matchId: undefined }), { 'X-Admin-Password': PW });
        ok(bench.body.variant === 'b' && handed.every((h) => h.variant === 'b' && h.names === null),
          'an admin bench naming b gets it on no version, and no name set without a match id');
        // AN ADMIN BENCH IS SENT EACH REPLY'S LABEL WORDS RAW (bench A scores
        // raw replies): its keys or "unknown", never a sentence, never a word
        // off a list, since the model's words can carry a name.
        prov.next = () => ({ content: JSON.stringify({ what: 'Morvane watched you stay on the angle.', fight: 'Right',
          better: 'Fall back after the first exchange.', change: 'timing', cause: 'Bad luck from Morvane', alt: 'Lost Duel' }) });
        const rawBench = await look(lookBody({ variant: 'b', raw: true }), { 'X-Admin-Password': PW });
        const raws = (rawBench.body.deaths || []).map((d) => d.raw);
        ok(raws.length === 2 && raws.every((x) => x && x.json === true && x.fight === 'right' && x.cause === 'unknown' && x.alt === 'lost-duel'
          && x.change === 'timing' && x.what === true) && !/Morvane|Bad luck|watched|exchange/i.test(JSON.stringify(raws)),
        `an admin bench asking raw: true is sent each look's label words as the model wrote them, never a sentence or a word off a list (${JSON.stringify(raws[0])})`);
        const rawPlayer = await look(lookBody({ variant: 'b', raw: true }), { 'X-Occlara-Version': NEW });
        const rawGuess = await look(lookBody({ variant: 'b', raw: true }), { 'X-Admin-Password': 'guess' });
        ok((rawPlayer.body.deaths || []).length === 2 && (rawPlayer.body.deaths || []).every((d) => !('raw' in d))
          && (rawGuess.body.deaths || []).length === 2 && (rawGuess.body.deaths || []).every((d) => !('raw' in d)),
        'and a licence asking raw: true, or a wrong password, is sent the looks alone');
      } finally {
        deathForensics.buildPrompt = realBuild;
        deathForensics.VARIANTS = realVariants;
        delete process.env.FORENSICS_PROMPT;
      }
      ok(T.gateWord({ why: 'hookah' }) === 'hookah' && T.gateWord({ why: 'Sova' }) === 'Sova'
        && T.gateWord({ why: 'Morvane' }) === "a word that is not the game's" && T.gateWord({ why: 'Morvane', gate: 'name' }) === 'name',
      'what a dropped look sentence is logged as: a game word as the word, any other word never');
    }

    // ── The agent look: its crop variant and a bench model, admins alone ───
    {
      const lookAt = async (body, headers) => {
        prov.sent.length = 0;
        const r = await call(coach, 'POST', '/detect-agent', { headers: { 'X-License-Key': licence(5), ...(headers || {}) },
          body: { image: 'aGVsbG8=', ...body } });
        return { r, body: r.body || {}, prompt: promptOf(prov.sent[0]), model: prov.sent[0] && prov.sent[0].body.model };
      };
      prov.next = () => ({ content: 'Jett' });
      const crop = T.detectPrompt('crop');
      const player = await lookAt({ variant: 'crop', benchModel: 'openai/gpt-6-sol' });
      ok(player.prompt === T.detectPrompt(null) && player.model === T.AI.visionModel && player.body.variant === null
        && player.body.model === T.AI.visionModel && player.body.agent === 'Jett',
      'a player naming crop and a bench model is looked at with the live prompt on the vision model, and told so (variant null, the vision model)');
      const plain = await lookAt({});
      ok(JSON.stringify(plain.body) === '{"agent":"Jett"}' && plain.model === T.AI.visionModel, 'and a plain look is the reply it always was');
      const bench = await lookAt({ variant: 'crop', benchModel: 'openai/gpt-6-sol' }, { 'X-Admin-Password': PW });
      ok(bench.prompt === crop && bench.model === 'openai/gpt-6-sol' && bench.body.variant === 'crop' && bench.body.model === 'openai/gpt-6-sol'
        && bench.body.agent === 'Jett', 'an admin bench naming crop and a bench model gets both, and is told which answered');
      const unknown = await lookAt({ benchModel: 'some/unknown-model' }, { 'X-Admin-Password': PW });
      ok(unknown.model === T.AI.visionModel && unknown.body.model === T.AI.visionModel, 'and a model off the bench list is not one: the vision model answers, and says so');
      ok(crop.includes(T.AGENT_KIT_LINES) && /health number/.test(crop) && /four ability icons/.test(crop) && /ammo count/.test(crop)
        && /C, Q, E and X unless the player rebound one, as MB4/.test(crop) && /UNKNOWN/.test(crop)
        && !/portrait|COMBAT REPORT|SWITCH PLAYER|kill feed|scoreboard|top bar|just above their HP bar/.test(crop)
        && ![0x2013, 0x2014].some((c) => crop.includes(String.fromCharCode(c))),
      'the crop prompt is the bar alone: the health number, the four icons with their keys, the ammo count, no face, panel or feed, no dash');
    }

    // ── Frame chat: no tip, a linked round's facts, no name ────────────────
    {
      const frame = async (body, headers) => {
        prov.sent.length = 0;
        const r = await call(coach, 'POST', '/frame-chat', { headers: { 'X-License-Key': licence(6), 'X-Occlara-Version': OLD, ...(headers || {}) },
          body: { question: 'Why did I die here?', images: ['x'.repeat(200)], state: { map: 'Fracture', roundNumber: 5 }, ...body } });
        return { r, body: r.body || {}, prompt: promptOf(prov.sent[0]) };
      };
      prov.next = () => ({ content: 'You peeked the angle alone. Your teammate was behind you.' });
      const tipped = await frame({ shown: 'Hold the angle with a teammate.' });
      ok(tipped.r.status === 200 && !/THE TIP IT GAVE THEN|Hold the angle with a teammate\.|repeat the tip/.test(tipped.prompt),
        'THE TIP IT GAVE THEN is gone: what an old client sends as shown is never read');
      const riot = await frame({ riot: { round: 5, won: false, died: true, sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false,
        alive: { mates: 4, enemies: 3 }, afterPlant: true, plantSite: 'A' } });
      ok(riot.prompt.includes("RIOT'S RECORD OF THIS ROUND, exact, it wins over the recorded facts: round 5: your team lost the round, the player died 33 s in, to Jett with a Sheriff, not traded, 4 against 3 standing, after the spike was planted at A."),
        'a frame of a linked match has its round\'s Riot facts in its facts line');
      const fake = T.riotFrameFacts({ round: 99, killer: 'Morvane#EUW', weapon: 'Morvane', sec: 'soon', alive: { mates: 9, enemies: 1 }, plantSite: 'Z' });
      ok(fake === null && T.riotFrameFacts({ died: true, killer: 'Morvane', weapon: 'Vandal' }) === 'the player died.',
        `and each of them bounded: a killer only an agent the game knows, a gun only a word of the game's, numbers in range (${JSON.stringify(fake)})`);
      const gate = { namesSomeone: (s) => (/\bMorvane\b/.test(s) ? 'Morvane' : null) };
      T.services({ nameGate: gate });
      prov.next = () => ({ content: 'You were killed by Morvane with a Vandal. You peeked the angle alone. Wait for a teammate next time.' });
      const named = await frame({});
      ok(named.body.reply === 'You peeked the angle alone. Wait for a teammate next time.',
        `a sentence of frame chat's answer naming a player is dropped, never repaired (${JSON.stringify(named.body.reply)})`);
      prov.next = () => ({ content: 'Morvane killed you.' });
      const onlyName = await frame({});
      ok(onlyName.body.error && !onlyName.body.reply, 'and an answer that was nothing but a name is no answer');
      T.services({ nameGate: null });
      // With the real name gate (name-gate.js): frame chat speaks as its prompt
      // asks ("I cannot tell from this frame") and names the game's gear, which
      // the capital rule took for names, "I" and "Heavy Shields" both; a name
      // still goes; and a sentence dropped takes no number with it, since a
      // decimal point is no sentence's end ("1. 5 seconds" was what was left).
      prov.next = () => ({ content: 'From this frame alone, I cannot tell why you died. You had Heavy Shields and 23 health 1.5 seconds before it. '
        + 'You were killed by Morvane with a Vandal. Next time, I would wait for the Sova dart.' });
      const real = await frame({});
      ok(real.body.reply === 'From this frame alone, I cannot tell why you died. You had Heavy Shields and 23 health 1.5 seconds before it. Next time, I would wait for the Sova dart.',
        `with the real name gate, "I" and the game's gear are no names, a name still is, and the decimal survives the drop (${JSON.stringify(real.body.reply)})`);
      const net = T.withoutNames('You went 31 and 21 as Jett, a 1.48 K/D, and your ACS of 245.5 led the lobby. Your teammate Tessik carried. Trade first next time.',
        { names: null, language: 'en' });
      ok(net.dropped === 1 && net.text === 'You went 31 and 21 as Jett, a 1.48 K/D, and your ACS of 245.5 led the lobby. Trade first next time.'
        && T.sentencesOf('A 1.5 K/D. Then 3.25 s in. Round 5.').length === 3 && T.sentencesOf('Hold the angle').length === 1,
      `and a review's: "1.48" and "245.5" are kept whole, each sentence still one (${JSON.stringify(net.text)})`);
    }

    // ── /health and /api/admin/chat from the server as Railway starts it ───
    {
      const port = await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
      });
      const env = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (!/^(AI_|STRIPE_|SUPABASE_|ADMIN_|GEMINI|OPENROUTER|HENRIKDEV|TRACKER|RIOT|CHAT_|FORENSICS_)/i.test(k)) env[k] = v;
      }
      Object.assign(env, { PRIMER_LIVE_CHECK: 'off', PORT: String(port), SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_KEY: 'stand-in-core-1',
        AI_API_KEY: 'sk-or-v1-stand-in-core-2', AI_BASE_URL: 'https://openrouter.ai/api/v1', STRIPE_SECRET_KEY: 'sk_test_stand_in_core_3',
        ADMIN_PASSWORD: 'stand-in-core-4' });
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-core-'));
      const child = spawn(process.execPath, [path.join(SERVER, 'server.js')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      const get = (p, headers) => new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 3000, headers: headers || {} }, (res) => {
          let text = '';
          res.on('data', (c) => { text += c; });
          res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json, text }); });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      const got = {};
      try {
        for (let i = 0; i < 120 && !got.health && child.exitCode === null; i++) {
          got.health = await get('/health');
          if (!got.health) await sleep(150);
        }
        got.chat = await get('/api/admin/chat', { 'X-Admin-Password': 'stand-in-core-4' });
        got.refused = await get('/api/admin/chat', { 'X-Admin-Password': 'guess' });
        got.primer = await get('/api/admin/primer', { 'X-Admin-Password': 'stand-in-core-4' });
        got.primerRefused = await get('/api/admin/primer', { 'X-Admin-Password': 'guess' });
      } finally {
        child.kill();
        await exited;
        try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* the folder outlives a slow exit */ }
      }
      const h = got.health && got.health.json;
      ok(h && h.chatModel === 'openai/gpt-6-sol' && h.textModelNow === h.textModel && h.textModel === 'google/gemini-3-flash-preview'
        && !/asked|honest|capped|retried|licencesAtCap/.test(got.health.text) && !got.health.text.includes('stand-in-core'),
      `GET /health names chatModel and textModelNow, and no count of Ask Coach's and no secret (${got.health ? got.health.status : `no answer: ${output.slice(-200)}`})`);
      const c = got.chat && got.chat.json;
      ok(c && got.chat.status === 200 && c.asked && typeof c.asked.v2 === 'number' && c.cap && c.cap.usd === 0.15 && c.served === 'v2'
        && got.refused && got.refused.status === 401,
      `/api/admin/chat gives the day's counts behind the admin password, v2 served by default, and 401 without it (${got.chat && got.chat.status}, ${c && c.served}, ${got.refused && got.refused.status})`);
      // The primer's live check: what it found behind the password, and never
      // started here (PRIMER_LIVE_CHECK=off, and no Railway): no test calls valorant-api.com.
      const pr = got.primer && got.primer.json;
      ok(pr && got.primer.status === 200 && pr.synced && typeof pr.synced.patch === 'string' && pr.running === false
        && Array.isArray(pr.withheld) && pr.live && pr.live.checkedAt === null && got.primerRefused && got.primerRefused.status === 401
        && /primer live check off/.test(output),
      `/api/admin/primer says the synced patch and what the live check found, behind the password, and the check never ran in a test (${got.primer && got.primer.status}, ${pr && pr.running}, ${got.primerRefused && got.primerRefused.status})`);
    }
  } finally {
    global.fetch = before;
    T.services({ chatPrompt: null, nameGate: null });
    for (const [k, v] of Object.entries(envBefore)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
