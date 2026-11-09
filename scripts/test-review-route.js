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
  // ── ROUND 8: THE REVIEW FLOOR, on the Fracture 5 to 1 match ──────────────
  // The Plat review of round 7 was served with no ROUND line (round 5 the one
  // round worth one) and the focus "You give up a quick kill attempt...".
  {
    const audit = require('./fixtures/audit-round3-reviews.json').reviews;
    const fx = audit.find((x) => x.id === 'review-fracture-5-1-plat_diamond');
    // Riot's plant times and the nearest teammate as the 8.8 client sends them (records-parsed of the audit).
    const RIOT = { 2: { mate: 'far' }, 5: { plantSec: 32.1, afterPlant: true, mate: 'close' }, 6: { plantSec: 50.8, afterPlant: false, mate: 'close' } };
    const fbody = (band) => ({ rounds: fx.rounds.map((x) => ({ ...x, ...(RIOT[x.n] || {}) })), swing: [], mistakes: [], strengths: [], patterns: [],
      counts: { deaths: 3, known: 3, untraded: 2, alone: 0, tradeable: 3, untradedMate: 2 },
      context: { agent: fx.agent, map: fx.map, rankBand: band },
      final: { team: 5, enemy: 1, result: 'Victory', verified: true, scoreline: fx.scoreline } });
    const SERVED = 'SUMMARY: You won 5 to 1 by opening fights and backing up teammates. You died 3 times in 6 rounds. '
      + '2 of your 3 deaths were not traded by a teammate within five seconds.\n'
      + 'FOCUS: You give up a quick kill attempt to keep the advantage while the clock runs.';
    const INSTRUCTS = require(path.join(__dirname, '..', 'server', 'services', 'coherence.js')).instructs;
    // The retry answers with what the first could not show.
    let asked = [];
    ai.sent.length = 0;
    ai.next = (b) => {
      asked.push(JSON.stringify(b));
      return asked.length === 1 ? { status: 200, content: SERVED }
        : { status: 200, content: 'SUMMARY: You won 5 to 1.\nR5: After the plant, hold the spike from cover and let the defenders come to you, because the clock is theirs.\nFOCUS: After the plant, hold the spike from cover and make them come to you.' };
    };
    let r = await call(coach, 'POST', '/match-review', { headers: H, body: fbody('plat_diamond') });
    ok(r.status === 200 && ai.sent.length === 2 && /YOUR LAST REPLY COULD NOT BE SHOWN IN FULL/.test(asked[1]) && /no ROUND line could be shown/.test(asked[1])
      && /the FOCUS did not say what to do/.test(asked[1]) && !/YOUR LAST REPLY/.test(asked[0]),
    'a review short of the floor is asked for once more, with its reasons in plain words');
    ok(r.body.rounds[5] && /hold the spike from cover/.test(r.body.rounds[5]) && INSTRUCTS(r.body.focus)
      && r.body.summary.startsWith('You won 5 to 1 by opening fights and backing up teammates.'),
    `and the retry fills only what the first could not show, the first reply's summary kept (${JSON.stringify(r.body.rounds)} ${r.body.focus})`);
    ok(r.body.dropped && r.body.dropped.focus === 1, `and the response counts the focus that did not instruct (${JSON.stringify(r.body.dropped)})`);
    // Every band, the retry no better: the floor computes the line and the focus.
    for (const band of ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus']) {
      ai.sent.length = 0;
      ai.next = reply(SERVED);
      r = await call(coach, 'POST', '/match-review', { headers: H, body: fbody(band) });
      ok(r.status === 200 && ai.sent.length === 2 && r.body.rounds[5] && /^After the plant with your team up 4 against 3, hold the spike from cover/.test(r.body.rounds[5])
        && INSTRUCTS(r.body.focus) && /^After the plant/.test(r.body.focus),
      `${band}: with the retry no better, round 5's line and the focus are computed from its facts (${r.body.rounds[5]} | ${r.body.focus})`);
    }
    // A reply that meets the floor is never asked for again, and its glued SWING line is split.
    ai.sent.length = 0;
    ai.next = reply('SUMMARY: You won 5 to 1, opening fights and winning key duels despite this: you died 3 times in 6 rounds. 2 of your 3 deaths were not traded by a teammate within five seconds.\n'
      + 'R5: After the plant, hold cover for the spike and delay the next duel.\nFOCUS: After the plant, hold cover for the spike before taking another duel.');
    r = await call(coach, 'POST', '/match-review', { headers: H, body: fbody('asc_plus') });
    ok(ai.sent.length === 1 && r.body.summary.startsWith('You won 5 to 1 by opening fights and winning key duels. You died 3 times in 6 rounds.'),
      `a reply that meets the floor is asked once, and "despite this:" is split where it glued the SWING line on (${r.body.summary})`);
    // The SWING line is the server's: put in as sentence two when the summary does not give it.
    ai.sent.length = 0;
    ai.next = reply('SUMMARY: You won 5 to 1 by opening fights. 2 of your 3 deaths were not traded by a teammate within five seconds.\n'
      + 'R5: After the plant, hold cover for the spike and delay the next duel.\nFOCUS: After the plant, hold cover for the spike before taking another duel.');
    r = await call(coach, 'POST', '/match-review', { headers: H, body: fbody('asc_plus') });
    ok(r.body.summary === 'You won 5 to 1 by opening fights. You died 3 times in 6 rounds. 2 of your 3 deaths were not traded by a teammate within five seconds.',
      `the SWING AND COUNTS block's first line is put in as the summary's second sentence (${r.body.summary})`);
    // A client before round 4 (no counts) gets no inserted line.
    ai.next = reply('SUMMARY: You won 5 to 1 by opening fights.\nR5: After the plant, hold cover for the spike.\nFOCUS: After the plant, hold cover for the spike.');
    const { counts, ...old } = fbody('asc_plus');
    r = await call(coach, 'POST', '/match-review', { headers: H, body: old });
    ok(r.body.summary === 'You won 5 to 1 by opening fights.', `and a client before round 4 is served its summary as written (${r.body.summary})`);
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
    ok(r.status === 200 && r.body.review === null && r.body.summary === null && ai.sent.length === 1 && ai.sent[0].model === 'openai/gpt-6.1-terra',
      `The review model empty is no narrative, never one from another model (${ai.sent.map((s) => s.model).join(', ')})`);
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
    // ROUND 8: THE NAME PASS RUNS INSIDE PARSE, before the coherence pass, so
    // a sentence leaning on a name drop goes with it; and a coaching word of
    // a name ("aim") is no name used as a word, so the round line keeps.
    {
      const AIMED = '2b3c4d5e-ffff-4aaa-8bbb-123456789abc';
      riotRounds.noteNames(AIMED, { players: [{ name: 'Aim Tessik', tag: 'EUW' }] });
      ai.next = reply('SUMMARY: You won the rounds you opened with a trade behind you. Your aim held up in the duels you took.\n'
        + 'R2: Your aim won the first duel, so hold that angle instead of swinging a second time.\n'
        + 'R4: Take the duel with a teammate close.\n'
        + 'FOCUS: Wait for Tessik before you peek. It keeps the trade alive.');
      ai.sent.length = 0;
      const aimed = await call(coach, 'POST', '/match-review', { headers: H, body: body({ matchId: AIMED }) });
      // The focus the name pass emptied is floored (round 8): asked again, the
      // same reply comes back, and the focus is computed from the round's facts.
      ok(aimed.status === 200 && aimed.body.rounds[2] && /Your aim won/.test(aimed.body.rounds[2]) && /Your aim held up/.test(aimed.body.summary)
        && aimed.body.focus && !/It keeps/.test(aimed.body.focus) && !/Tessik/.test(JSON.stringify(aimed.body)) && ai.sent.length === 2,
      `"aim" as a word keeps its summary sentence and its round line, while the focus's name goes, "It keeps..." goes with it, and the floor gives a focus (${JSON.stringify({ r2: aimed.body.rounds[2], focus: aimed.body.focus, calls: ai.sent.length })})`);
      ok(aimed.body.dropped && aimed.body.dropped.name >= 1 && aimed.body.dropped.orphan >= 1 && !/Tessik/.test(JSON.stringify(aimed.body.dropped)),
        `and the response counts the drops by kind, never their words (${JSON.stringify(aimed.body.dropped)})`);
      const matchReview = require(path.join(__dirname, '..', 'server', 'services', 'match-review.js'));
      const input = matchReview.normalise({ ...body(), rounds: ROUND4 });
      const names = riotRounds.nameSetOf(AIMED);
      const p = matchReview.parse('SUMMARY: You won the rounds you opened.\nFOCUS: Wait for Tessik before you peek. It keeps the trade alive.', input,
        { withoutNames: (t) => coach.__test.withoutNames(t, { names, language: 'en' }) });
      ok(p.focus === null && p.dropped.some((d) => d.said === 'focus name') && p.dropped.some((d) => d.said === 'focus orphan'),
        `in parse, the name drop is a drop like any other, and the orphan pass reads it (${JSON.stringify(p.dropped)})`);
      const bare = matchReview.parse('SUMMARY: You won the rounds you opened.\nFOCUS: Wait for Tessik before you peek. It keeps the trade alive.', input);
      ok(bare.focus === 'Wait for Tessik before you peek. It keeps the trade alive.', 'and a parse with no name pass handed in is as it was');
      // ROUND 8 REVIEW: a connective after a NAME drop loses the connective,
      // not its sentence; the name pass moved into parse emptied these fields.
      const pass = { withoutNames: (t) => coach.__test.withoutNames(t, { names, language: 'en', count: false }) };
      const cases = [
        ['FOCUS: Tessik was ahead of you on B in both lost rounds. Also, use your smoke before you swing wide on A.', 'focus', 'Use your smoke before you swing wide on A.'],
        ['FOCUS: Tessik was ahead of you on B in both lost rounds. Then clear the angle with your flash before you peek.', 'focus', 'Clear the angle with your flash before you peek.'],
        ['FOCUS: Warm up in TDM before ranked. Then wait for a teammate before you peek.', 'focus', 'Warm up in TDM before ranked. Then wait for a teammate before you peek.'],
      ];
      for (const [said, field, want] of cases) {
        const q = matchReview.parse(`SUMMARY: You won the rounds you opened.\n${said}`, input, pass);
        ok(q[field] === want, `MUST KEEP after a name drop: ${JSON.stringify(said)} gives ${JSON.stringify(q[field])}`);
      }
      const sum = matchReview.parse('SUMMARY: You won the rounds you opened with a trade. Tessik carried the late rounds. So your opening duels were the difference.', input, pass);
      ok(sum.summary === 'You won the rounds you opened with a trade. Your opening duels were the difference.', `and in the summary, "So" goes and its sentence keeps (${JSON.stringify(sum.summary)})`);
      // A referential opener still goes after a name drop, and a connective
      // after any other gate's drop still goes whole (cohere, unchanged).
      ok(matchReview.cohere('Tessik was there. So hold the angle.', 'So hold the angle.').text === null
        && matchReview.cohere('Tessik was there. So hold the angle.', 'So hold the angle.', new Set(['Tessik was there.'.slice(0, 24)])).text === 'Hold the angle.'
        && matchReview.cohere('Tessik was there. It keeps the trade.', 'It keeps the trade.', new Set(['Tessik was there.'.slice(0, 24)])).text === null,
      'a connective is stripped only after a name drop, and "It" still goes after one');
      // nameSpared counts each served spared sentence once, not once per lookup.
      const spared0 = riotRounds.nameSetCounts().spared;
      ai.next = reply('SUMMARY: You won the rounds you opened with a trade behind you. Your aim held up in the duels you took.\nR4: Take the duel with a teammate close.\nFOCUS: Take the duel with a teammate close.');
      const once = await call(coach, 'POST', '/match-review', { headers: H, body: body({ matchId: AIMED }) });
      ok(once.status === 200 && riotRounds.nameSetCounts().spared === spared0 + 1,
        `one spared summary sentence through the route counts once (${riotRounds.nameSetCounts().spared - spared0})`);
    }
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
  {
    // S3: thirty tips of 60,000 characters each went to the model whole,
    // 1.8M characters a call. Each tip is now clipped as /summary's are (160).
    let sent = 0;
    ai.next = (body) => { sent = JSON.stringify(body.messages).length; return { status: 200, content: 'Keep trading. You peeked alone. Next match, trade.' }; };
    const big = Array.from({ length: 30 }, (_, i) => `${i} ${'x'.repeat(60000)}`);
    const r = await call(coach, 'POST', '/match-review', { headers: H, body: { tips: big, notes: big } });
    ok(r.status === 200 && sent > 0 && sent < 20000, `a tips review sends each tip clipped, never 1.8M characters (${sent} sent)`);
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
