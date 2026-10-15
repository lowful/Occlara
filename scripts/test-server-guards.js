'use strict';

/**
 * The server's own guard rails: the admin password, the admin limiter, who may
 * pick a bench model, which errors are the client's, and the live view's
 * bookkeeping.
 *
 *   ADMIN. Every admin route took unlimited guesses, accepted the password in
 *   the query string and compared it with !==. Now: the header only, compared
 *   in constant time, failures limited to ten an hour per IP.
 *
 *   BENCH MODEL. Any licence could send benchModel and run every read on a
 *   model nine times the price. Now only beside the admin password.
 *
 *   READ PROMPT VARIANT (8.4.1). Variant b of the live read is an admin
 *   bench's alone, the same way: a player naming it is read with the live
 *   prompt, which is byte for byte the one every install has read with, and
 *   the variant says what the player's Fracture swiftplay showed it must.
 *   Variant c, written from the judging of b's bench, is served the same way:
 *   it is the live prompt with its alive and clock lines given the judge's
 *   lines word for word, nothing else moved, and keeps 120 characters of the
 *   tell. And the agent look's variant b (8.4.4), the same way again: a
 *   player's look is answered with the live prompt, an admin bench's with b.
 *
 *   ASK COACH'S CONTEXT (8.4.1). It was told Stats' four Overview scores were
 *   a coached-session trend and to drill the weakest of them. They are sums
 *   over the tracker profile it already has, and neither is said any more.
 *
 *   CLIENT ERRORS. A malformed or aborted body and a refused origin were all
 *   answered 500 and filed under Recent errors on the admin page. Now 400, and
 *   kept out of it.
 *
 *   LIVE VIEW. The account cache grew forever and marked everyone past the
 *   first hundred as nobody; any 8 character header became a person; and the
 *   route list evicted its busiest route first.
 *
 *   A GAME NO LONGER COACHED. Marvel Rivals was removed after 8.3.2, and an
 *   install from before that left on it still calls /api/rivals/draft,
 *   /review and /identify. Every path under /api/rivals, by any method, with
 *   a licence or none, answers 410 with one sentence and asks neither the
 *   licence table nor a model, and is never rate limited, in the server as
 *   Railway starts it. Ask Coach asked about that game answers as for any
 *   game it does not know, no other server code or data names it, and no
 *   file of the app calls those routes, so a current install loses nothing.
 *
 * Real modules throughout, against a fake Supabase and a fake model. Nothing
 * leaves the machine: the server as Railway starts it runs on a local port.
 *
 * Run: npm run test:serverguards
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
delete process.env.ADMIN_PASSWORD;
// The model is a fake (below), so Ask Coach's prompt can be read as it is sent.
process.env.AI_API_KEY = 'test-ai-key';
process.env.AI_BASE_URL = 'http://ai.test/v1';
for (const v of ['AI_PROVIDER', 'AI_TEXT_MODEL', 'AI_VISION_MODEL', 'AI_TEXT_MODEL_FALLBACK']) delete process.env[v];

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── A fake Supabase for the admin account lookups ───────────────────────────
const sb = { inCalls: [], lookups: 0, inFlight: 0, maxInFlight: 0, fail: false, tables: 0 };
const fakeSupabase = {
  from: () => {
    sb.tables++;
    const api = {
      select: () => api, eq: () => api, abortSignal: () => api,
      single: async () => ({ data: { status: 'active', expires_at: null }, error: null }),
      in: async (col, keys) => {
        sb.inCalls.push(keys.slice());
        if (sb.fail) return { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
        return { data: keys.map((k, i) => ({ license_key: k, plan: 'monthly', user_id: `user-${k}` })), error: null };
      },
    };
    return api;
  },
  auth: {
    admin: {
      getUserById: async (id) => {
        sb.lookups++;
        sb.inFlight++;
        sb.maxInFlight = Math.max(sb.maxInFlight, sb.inFlight);
        await new Promise((r) => setTimeout(r, 2));
        sb.inFlight--;
        return { data: { user: { id, email: `${id.slice(5, 9).toLowerCase()}@example.test` } }, error: null };
      },
    },
  },
};
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === '../db/supabase') return fakeSupabase;
  return realLoad(request, parent, isMain);
};

// ── A fake model: every request it is sent is kept ──────────────────────────
// `reply` scripts its answer (a read's STATE line); null is the coach's sentence.
const model = { sent: [], reply: null };
global.fetch = async (url, init = {}) => {
  model.sent.push({ url: String(url), body: JSON.parse(init.body || '{}') });
  const content = model.reply != null ? model.reply : 'Hold your angle with a teammate close enough to trade you, then swing together.';
  const json = { choices: [{ message: { content }, finish_reason: 'stop' }] };
  return { status: 200, ok: true, text: async () => JSON.stringify(json), json: async () => json };
};
/** The prompt a request to the fake model carried, a vision call's or a text call's. */
const promptOf = (sent) => {
  const msgs = (sent && sent.body && sent.body.messages) || [];
  const c = msgs.length ? msgs[msgs.length - 1].content : '';
  return typeof c === 'string' ? c : (Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : '');
};

const SERVER = path.join(__dirname, '..', 'server');
const { adminPasswordOk, isAdmin, makeAdminLimiter } = require(path.join(SERVER, 'services', 'admin-auth.js'));
const { errorHandler, corsRefusal } = require(path.join(SERVER, 'services', 'http-errors.js'));
const presenceMod = require(path.join(SERVER, 'services', 'presence.js'));
const { Presence, presence, hashOf } = presenceMod;
const adminRouter = require(path.join(SERVER, 'routes', 'admin.js'));
const coach = require(path.join(SERVER, 'routes', 'coach.js'));
const retired = require(path.join(SERVER, 'routes', 'retired.js'));

function call(router, method, url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const [, qs] = url.split('?');
    const timer = setTimeout(() => reject(new Error(`${method} ${url} never answered`)), 5000);
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

/** One request through a real express-rate-limit instance. */
async function throughLimiter(limiter, { ip, status }) {
  const req = { ip, app: { get: () => 1 }, headers: {}, method: 'GET', url: '/api/admin/live' };
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200, headersSent: false, writableEnded: false,
    setHeader() {}, getHeader() {},
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; this.writableEnded = true; return this; },
  });
  let passed = false;
  await limiter(req, res, () => { passed = true; });
  if (passed) { res.statusCode = status; res.writableEnded = true; res.emit('finish'); }
  await new Promise((r) => setImmediate(r));
  return { passed, status: res.statusCode };
}

const PW = 'correct horse battery staple';

(async () => {
  // ── The password check ────────────────────────────────────────────────────
  ok(!adminPasswordOk(PW), 'with no ADMIN_PASSWORD configured, nothing is the admin password');
  process.env.ADMIN_PASSWORD = PW;
  ok(adminPasswordOk(PW), 'the right password passes');
  ok(!adminPasswordOk('correct horse battery stapl') && !adminPasswordOk(PW + 'x') && !adminPasswordOk(''),
    'a prefix, a longer string and an empty one do not (and unequal lengths do not throw)');
  ok(!adminPasswordOk(undefined) && !adminPasswordOk(['x']), 'nor anything that is not a string');
  ok(isAdmin({ headers: { 'x-admin-password': PW } }), 'the header carries it');
  ok(!isAdmin({ headers: {}, query: { password: PW } }), 'the query string never does');

  // ── The limiter ───────────────────────────────────────────────────────────
  {
    const limiter = makeAdminLimiter();
    let through = 0;
    for (let i = 0; i < 10; i++) if ((await throughLimiter(limiter, { ip: '203.0.113.7', status: 401 })).passed) through++;
    const eleventh = await throughLimiter(limiter, { ip: '203.0.113.7', status: 200 });
    ok(through === 10 && !eleventh.passed && eleventh.status === 429,
      `ten wrong passwords an hour from one IP, then 429 (${through} through, then ${eleventh.status})`);
    const other = await throughLimiter(limiter, { ip: '198.51.100.9', status: 401 });
    ok(other.passed, 'counted per IP: another address is not locked out by it');
    let polls = 0;
    for (let i = 0; i < 25; i++) if ((await throughLimiter(limiter, { ip: '192.0.2.1', status: 200 })).passed) polls++;
    ok(polls === 25, 'the live page polling with the right password is never counted (25 of 25 through)');
    let broken = 0;
    for (let i = 0; i < 15; i++) if ((await throughLimiter(limiter, { ip: '192.0.2.2', status: 500 })).passed) broken++;
    const after = await throughLimiter(limiter, { ip: '192.0.2.2', status: 200 });
    ok(broken === 15 && after.passed,
      `a /live failing with 5xx while the page polls is not a guess and locks nobody out (${broken} through, then ${after.status})`);
  }

  // ── The admin routes ──────────────────────────────────────────────────────
  {
    const r = await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': PW } });
    ok(r.status === 200 && r.body && r.body.now, `the live view opens with the header (${r.status})`);
  }
  {
    const r = await call(adminRouter, 'GET', `/live?password=${encodeURIComponent(PW)}`);
    ok(r.status === 401, `and not with the password in the query string (${r.status})`);
  }
  ok((await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': 'guess' } })).status === 401,
    'a wrong password is 401');
  ok((await call(adminRouter, 'GET', `/costs?password=${encodeURIComponent(PW)}`)).status === 401
    && (await call(adminRouter, 'GET', `/coaching?password=${encodeURIComponent(PW)}`)).status === 401,
    '/costs and /coaching refuse the query string too');
  {
    const KEY = 'GC-QWER-TYUI-OPAS-DFGH';
    coach.trackCall(KEY, 1);
    const r = await call(adminRouter, 'GET', '/costs', { headers: { 'X-Admin-Password': PW } });
    const text = JSON.stringify(r.body);
    ok(r.status === 200 && !text.includes('GC-QWER') && !text.includes('QWER'),
      'the cost view no longer prints the start of anyone\'s licence key');
    ok(r.body.topUsers.some((u) => u.user === hashOf(KEY)), 'it names each user by the same hash the live view uses');
  }
  delete process.env.ADMIN_PASSWORD;
  ok((await call(adminRouter, 'GET', '/live', { headers: { 'X-Admin-Password': PW } })).status === 503,
    'with no ADMIN_PASSWORD set the live view says so');
  process.env.ADMIN_PASSWORD = PW;

  // ── benchModel ────────────────────────────────────────────────────────────
  {
    const { benchModel } = coach.__test;
    const dear = 'google/gemini-3.5-flash-lite';
    ok(benchModel({ body: { benchModel: dear }, headers: {} }) === null,
      'a licence alone cannot switch the read to a dearer model');
    ok(benchModel({ body: { benchModel: dear }, headers: { 'x-admin-password': 'guess' } }) === null,
      'nor with a wrong admin password');
    ok(benchModel({ body: { benchModel: dear }, headers: {}, query: { password: PW } }) === null,
      'nor with the password in the query string');
    ok(benchModel({ body: { benchModel: dear }, headers: { 'x-admin-password': PW } }) === dear,
      'a bench with the admin password gets its model');
    ok(benchModel({ body: { benchModel: 'some/unknown-model' }, headers: { 'x-admin-password': PW } }) === null,
      'and only one on the allowlist');
  }

  // ── The read prompt, and its variant b (8.4.1) ────────────────────────────
  {
    const crypto = require('crypto');
    const readPrompt = require(path.join(SERVER, 'services', 'read-prompt.js'));
    const { readVariant } = coach.__test;
    const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    // THE LIVE PROMPT, BYTE FOR BYTE: its length and sha256 for three
    // contexts. c's since 15 Oct 2026 (bench:sessions against the prompt
    // before it, and verify:ai plain and at --lag 4). It changes only when a
    // variant is made the default, once its bench has passed it live.
    const CTXS = [{},
      { agent: 'Jett', map: 'Fracture', side: 'attacking', teamScore: 4, enemyScore: 1, playerAlive: false, gameMode: 'swiftplay' },
      { map: 'Abyss', teamScore: 0, enemyScore: 0, playerAlive: true }];
    const LIVE = [
      [5365, '156952fc388cb467b54a3ad06548b3b174bcc9c24fc7c8f707662a39fe304f4c'],
      [5565, 'b1b26fea14540b05210b989094692001cdff81e8983e5b6274fc7b78d74e0f71'],
      [5458, '938b110fad0532c5c7cee22c212105a8b916a980d7515abe6c098e0a1d31b21b'],
    ];
    // And the prompt every install read with before it, kept as variant a,
    // byte for byte, for the benches to measure against.
    const BEFORE = [
      [4378, 'fca5c78206bda89f06c50b8f72068830c4cae5afa70e90b018e041646949b64c'],
      [4578, '4d932b23cac299d678df47bca121bd89f1e8aa53f336c50a9c1c76fdfedc1e84'],
      [4471, '32ac2fcd61539669fd7c2193a662cde813da0a32576210b7756e0b7deca31507'],
    ];
    const movedOf = (pins, variant) => pins.map(([len, h], i) => ({ p: readPrompt.buildReadPrompt(CTXS[i], variant), len, h }))
      .filter(({ p, len, h }) => p.length !== len || sha(p) !== h).map(({ p, len }) => `${p.length} characters where ${len} were`);
    const moved = movedOf(LIVE);
    ok(moved.length === 0, `the live read prompt is byte for byte c's, the one every install reads with${moved.length ? ` (${moved.join('; ')})` : ''}`);
    ok(CTXS.every((c) => readPrompt.buildReadPrompt(c) === readPrompt.buildReadPrompt(c, 'c')), 'and a bench naming c is read with that very prompt');
    const movedA = movedOf(BEFORE, 'a');
    ok(movedA.length === 0, `variant a is the prompt before it, byte for byte${movedA.length ? ` (${movedA.join('; ')})` : ''}`);
    ok(sha(readPrompt.FIELDS) === '307ee0dac94c7ae22b2bf0cc707dcda0e8ff3c2521c03c5e8d3289b366a4fcdc',
      'and its STATE line, the shape mapState parses, is the one it always was');

    // Who may ask for it: an admin bench, as for a bench model.
    ok(readVariant({ body: { variant: 'b' }, headers: {} }) === null, 'a licence alone cannot switch its read to variant b');
    ok(readVariant({ body: { variant: 'b' }, headers: { 'x-admin-password': 'guess' } }) === null, 'nor with a wrong admin password');
    ok(readVariant({ body: { variant: 'b' }, headers: {}, query: { password: PW } }) === null, 'nor with the password in the query string');
    ok(readVariant({ body: { variant: 'b' }, headers: { 'x-admin-password': PW } }) === 'b'
      && readVariant({ body: { variant: ' B ' }, headers: { 'x-admin-password': PW } }) === 'b', 'an admin bench naming it gets it');
    ok(readVariant({ body: { variant: 'z' }, headers: { 'x-admin-password': PW } }) === null
      && readVariant({ body: {}, headers: { 'x-admin-password': PW } }) === null, 'and only a variant the prompt has');

    // Through the route, the fake model answering a tell longer than either cap.
    const CTX = { map: 'Fracture', teamScore: 2, enemyScore: 0, agent: 'Jett' };
    const TELL = 'Spectating, teammate\'s health 89 with Knife bottom-left, SPECTATORS 1 top right, Blade Storm in hand';
    model.reply = `STATE: ${JSON.stringify({ phase: 'active', alive: true, hp: 89, aliveTell: TELL, weapon: 'Knife' })}`;
    const read = async (body, headers) => {
      model.sent.length = 0;
      const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': 'GC-READ-TEST-AAAA-BBBB', ...(headers || {}) },
        body: { image: 'aGVsbG8=', context: CTX, ...body } });
      return { r, body: r.body || {}, prompt: promptOf(model.sent[0]) };
    };
    const live = readPrompt.buildReadPrompt(CTX);
    const plain = await read({});
    ok(plain.r.status === 200 && plain.prompt === live && !('variant' in plain.body) && !('model' in plain.body)
      && plain.body.context.aliveTell === TELL.slice(0, 120),
    `a client's read is the live prompt, its tell kept to 120 characters, and its reply the shape it always was (${plain.r.status})`);
    const player = await read({ variant: 'b' });
    ok(player.r.status === 200 && player.prompt === live && player.body.variant === null && player.body.context.aliveTell === TELL.slice(0, 120),
      'a player naming the variant is read with the live prompt and its cap, and told it was (variant null)');
    const bench = await read({ variant: 'b' }, { 'X-Admin-Password': PW });
    ok(bench.r.status === 200 && bench.prompt === readPrompt.buildReadPrompt(CTX, 'b') && bench.prompt !== live && bench.body.variant === 'b',
      'an admin bench naming it is read with variant b, and told so');
    const before = await read({ variant: 'a' }, { 'X-Admin-Password': PW });
    ok(before.r.status === 200 && before.prompt === readPrompt.buildReadPrompt(CTX, 'a') && before.prompt !== live && before.body.variant === 'a',
      'an admin bench naming a is read with the prompt before c, and told so');
    ok(bench.body.context.aliveTell === TELL.slice(0, 90) && /SPECTATORS 1/.test(bench.body.context.aliveTell)
      && /SPECTATORS 1/.test(plain.body.context.aliveTell) && !/SPECTATORS/.test(before.body.context.aliveTell)
      && before.body.context.aliveTell === TELL.slice(0, 60),
    `the live tell's 120 and b's 90 keep "SPECTATORS 1", where a's 60 cut it to "${before.body.context.aliveTell.slice(-3)}"`);
    ok(plain.body.context.playerAlive === true && plain.body.context.playerHp === 89
      && bench.body.context.playerAlive === true && bench.body.context.playerHp === 89
      && before.body.context.playerAlive === false && before.body.context.playerHp === undefined,
    'and the counter it keeps is seen for what it is (SPECTATOR_COUNT): the living player\'s 89 stands, where a\'s cut tell read them dead');

    // Variant c, asked for the same way, and served the same way.
    ok(readVariant({ body: { variant: 'c' }, headers: {} }) === null
      && readVariant({ body: { variant: 'c' }, headers: { 'x-admin-password': 'guess' } }) === null
      && readVariant({ body: { variant: 'c' }, headers: {}, query: { password: PW } }) === null,
    'a licence alone cannot switch its read to variant c, nor with a wrong admin password, nor with it in the query string');
    ok(readVariant({ body: { variant: 'c' }, headers: { 'x-admin-password': PW } }) === 'c'
      && readVariant({ body: { variant: ' C ' }, headers: { 'x-admin-password': PW } }) === 'c', 'an admin bench naming c gets it');
    const { TELL_MAX } = coach.__test;
    ok(readPrompt.VARIANTS.every((v) => Number.isInteger(TELL_MAX[v]))
      && TELL_MAX.live === 120 && TELL_MAX.c === TELL_MAX.live && TELL_MAX.b === 90 && TELL_MAX.a === 60,
    `every variant keeps its own length of the tell, 120 on the live prompt and on c, 90 on b, 60 on a (${JSON.stringify(TELL_MAX)})`);
    // A tell naming the counter past its 90th character, as the Sunset
    // swiftplay's frame-00309 did, on a living player at 99.
    const TELL_C = 'own HP 99 and Classic bottom left, WON banner at the top center, round 4 is won, SPECTATORS 1 top right, the kill feed shows the player killed Reyna';
    model.reply = `STATE: ${JSON.stringify({ phase: 'active', alive: true, hp: 99, aliveTell: TELL_C, weapon: 'Classic' })}`;
    const playerC = await read({ variant: 'c' });
    ok(playerC.r.status === 200 && playerC.prompt === live && playerC.body.variant === null
      && playerC.body.context.aliveTell === TELL_C.slice(0, 120),
    'a player naming variant c is read with the live prompt and its cap, and told it was (variant null)');
    const benchC = await read({ variant: 'c' }, { 'X-Admin-Password': PW });
    const promptC = readPrompt.buildReadPrompt(CTX, 'c');
    ok(benchC.r.status === 200 && benchC.prompt === promptC && promptC === live && promptC !== readPrompt.buildReadPrompt(CTX, 'b')
      && promptC !== readPrompt.buildReadPrompt(CTX, 'a') && benchC.body.variant === 'c',
    'an admin bench naming c is read with c, the live prompt\'s own text, neither b nor a, and told so');
    const benchB = await read({ variant: 'b' }, { 'X-Admin-Password': PW });
    const tellC = benchC.body.context.aliveTell || '';
    const tellB = benchB.body.context.aliveTell || '';
    ok(TELL_C.length > 120 && tellC === TELL_C.slice(0, 120) && /SPECTATORS 1/.test(tellC)
      && tellB === TELL_C.slice(0, 90) && /SPECTATOR$/.test(tellB),
    `on c the tell keeps 120 characters, so "SPECTATORS 1" past the 90th survives, where b's 90 cut it to "${tellB.slice(-9)}"`);
    ok(benchC.body.context.playerAlive === true && benchC.body.context.playerHp === 99
      && benchB.body.context.playerAlive === false && benchB.body.context.playerHp === undefined,
    'and the living player\'s 99 stands on c, where the tell cut to "SPECTATOR" read them dead on b');
    model.reply = null;

    // What b says, against what the prompt before c said (a, the live one
    // when b and c were written).
    const B = readPrompt.buildReadPrompt({}, 'b');
    const A = readPrompt.buildReadPrompt({}, 'a');
    const aliveOf = (p) => p.split('\n').find((l) => l.startsWith('- alive and aliveTell:')) || '';
    const deadOf = (p) => { const l = aliveOf(p); return l.slice(l.indexOf('No:')); };
    const changed = B.split('\n').filter((l) => !A.split('\n').includes(l));
    ok(B.includes(readPrompt.FIELDS) && changed.length === 3, `b keeps the STATE line and changes three lines (${changed.length})`);
    ok(/the word "Spectating"/.test(A) && !/the word "Spectating"|"Spectating"/.test(B), 'b never offers "Spectating" as a dead tell, where the live prompt does');
    ok(/SPECTATORS and a number at the top right counts the people watching/.test(B) && /never a sign of death/.test(B)
      && !/SPECTATORS/.test(A), 'b says what SPECTATORS and a number is, and that it is never a sign of death');
    ok(['SWITCH PLAYER', 'KILLED BY', 'COMBAT REPORT'].every((w) => deadOf(B).includes(w))
      && /only when they are printed on this frame/.test(deadOf(B)), 'b asks for SWITCH PLAYER, KILLED BY or COMBAT REPORT only when they are printed on the frame');
    ok(/"/.test(deadOf(A)) && /portrait and name above "SWITCH PLAYER"/.test(A) && deadOf(B).length > 200 && !/"/.test(deadOf(B))
      && !/portrait and name above/.test(B), 'with nothing quoted for the model to copy, where the live prompt handed it the sentence it copied');
    ok(/After a plant it is the spike timer/.test(A) && !/spike timer/i.test(B) && /spike icon there and no timer at all: clock null/.test(B),
      'and b says a planted spike shows no timer, where the live prompt said it had one');

    // What c says: the judge's lines, word for word, each change for the
    // frames b's bench was judged on.
    const SAYS = {
      ask: '- alive and aliveTell: CHECK THIS FIRST. Is the player\'s OWN health number visible at the bottom-center with their OWN weapon and abilities at the bottom-left?',
      low: 'Yes: alive true, aliveTell names what you saw ("own HP 87 and Vandal bottom left"), however low or red the number is.',
      dead: 'The player is dead only when this frame prints SWITCH PLAYER at the bottom-left, or a COMBAT REPORT panel with KILLED BY at its top and ROUND ONGOING at its foot, or shows no health number at the bottom-center at all.',
      absent: 'Then alive false, and aliveTell names which of these is on this frame, never a word the frame does not print and never a word to say it is absent.',
      spectating: 'WHILE SPECTATING THE HEALTH NUMBER BELONGS TO THE TEAMMATE BEING WATCHED: report hp null and alive false.',
      unsure: 'If you cannot tell, alive null.',
      buy: '- THE BUY PHASE IS NEVER DEATH. Each round opens with the COMBAT REPORT of the round before still on screen, KILLED BY at its top when the player died in it, beside a BUY PHASE, LAST ROUND BEFORE SWAP or MATCH POINT banner with PRESS B TO BUY: the player is alive, so alive true, and aliveTell names the own health and loadout, never that panel.',
      notDeath: '- None of these is a sign of death, and none goes in aliveTell: SPECTATORS and a number at the top right (it counts who is watching the player), a skull icon at the bottom-center (the player\'s own kill banner), a name in the kill feed, the scoreboard, the map, the buy menu, a WON, LOST or FLAWLESS banner, a flash, a smoke or a scope.',
      clock: '- clock: the timer at the top-center exactly as shown ("1:12"). When the spike icon stands in its place there is no timer: clock null. A timer still counting there means the spike is not down: then phase is not "postplant" and spike is not "planted".',
    };
    const C = readPrompt.buildReadPrompt({}, 'c');
    const clockOf = (p) => p.split('\n').find((l) => l.startsWith('- clock:')) || '';
    const OWN = [[SAYS.ask, SAYS.low, SAYS.dead, SAYS.absent, SAYS.spectating, SAYS.unsure].join(' '), SAYS.buy, SAYS.notDeath];
    const rebuilt = A.split('\n').flatMap((l) => (l === aliveOf(A) ? OWN : (l === clockOf(A) ? [SAYS.clock] : [l]))).join('\n');
    const cOnly = C.split('\n').filter((l) => !A.split('\n').includes(l));
    ok(C.includes(readPrompt.FIELDS) && rebuilt === C && aliveOf(A).length > 200 && clockOf(A).length > 40,
      `c keeps the STATE line and is the live prompt with its alive line given three lines and its clock line one, word for word, nothing else moved (${cOnly.length} lines its own)`);
    // Quoted in c's own alive lines, whatever they say.
    const quotedC = cOnly.filter((l) => !l.startsWith('- clock:')).join('\n').match(/"[^"]*"/g) || [];
    ok(!/"Spectating"/.test(C) && /the word "Spectating"/.test(A) && !/portrait and name above/.test(C)
      && quotedC.length === 1 && quotedC[0] === '"own HP 87 and Vandal bottom left"',
    'c never offers "Spectating" as a dead tell, and quotes nothing for the model to copy but the living example, where the live prompt handed it the portrait sentence');
    ok(C.includes(SAYS.dead) && !/"KILLED BY" upper right|a "COMBAT REPORT"/.test(C) && /"KILLED BY" upper right/.test(A)
      && !/KILLED BY at the upper right and a COMBAT REPORT panel/.test(C) && /KILLED BY at the upper right and a COMBAT REPORT panel/.test(B),
    'c is dead only on SWITCH PLAYER, a COMBAT REPORT with ROUND ONGOING at its foot, or no health number, never on KILLED BY or a COMBAT REPORT alone as the live prompt and b have it');
    ok(C.split('\n').includes(SAYS.buy) && !/BUY PHASE IS NEVER DEATH/.test(A + B),
      'c says the buy phase is never death, the round before\'s COMBAT REPORT and its KILLED BY over it included, where neither the live prompt nor b says it');
    ok(C.split('\n').includes(SAYS.notDeath) && !/A flash, a smoke or a scope is not death/.test(C)
      && /A flash, a smoke or a scope is not death/.test(A),
      'c names what is no sign of death and stays out of the tell: the SPECTATORS counter, the own kill banner\'s skull, the kill feed, the scoreboard, the map, the buy menu, a round\'s banner, a flash, a smoke, a scope');
    ok(C.includes(SAYS.absent), 'c asks for no word the frame does not print and none to say a word is absent, as b\'s "SWITCH PLAYER not shown" was');
    ok(C.includes(SAYS.unsure) && C.includes(SAYS.low) && !/in place of the player's own health and loadout/.test(C)
      && /in place of the player's own health and loadout/.test(B),
    'c says alive null when it cannot tell, and alive however low the health, where b had the model name what it saw in place of the health');
    ok(C.split('\n').includes(SAYS.clock) && !/spike timer/i.test(C) && /spike timer/i.test(A)
      && !/no timer at all/.test(C) && /no timer at all/.test(B),
      'c reads the timer until the spike icon takes its place and a timer still counting is no plant, where the live prompt had a spike timer and b no timer after a plant');
  }

  // ── The agent look's prompt, and its variant b (8.4.4) ───────────────────
  // Through the route, the fake model answering one word, as the prompt asks.
  // The live prompt is the one every install is answered with; b is an admin
  // bench's alone, as the read prompt's variants are, and told back.
  {
    const { detectPrompt } = coach.__test;
    model.reply = 'Jett';
    const look = async (body, headers) => {
      model.sent.length = 0;
      const r = await call(coach, 'POST', '/detect-agent', { headers: { 'X-License-Key': 'GC-READ-TEST-AAAA-BBBB', ...(headers || {}) },
        body: { image: 'aGVsbG8=', ...body } });
      return { r, body: r.body || {}, prompt: promptOf(model.sent[0]) };
    };
    const plain = await look({});
    ok(plain.r.status === 200 && plain.prompt === detectPrompt(null) && plain.body.agent === 'Jett' && !('variant' in plain.body),
      `a client's look is the live prompt, and its reply the shape it always was (${JSON.stringify(plain.body)})`);
    const player = await look({ variant: 'b' });
    ok(player.r.status === 200 && player.prompt === detectPrompt(null) && player.body.variant === null && player.body.agent === 'Jett',
      'a player naming b is answered with the live prompt, and told it was (variant null)');
    const bench = await look({ variant: 'b' }, { 'X-Admin-Password': PW });
    ok(bench.r.status === 200 && bench.prompt === detectPrompt('b') && bench.prompt !== detectPrompt(null)
      && bench.body.variant === 'b' && bench.body.agent === 'Jett', 'an admin bench naming b is answered with b, and told so');
    model.reply = null;
  }

  // ── A death word its own clause negates is no death word (8.4.3) ──────────
  {
    // Through the read route, a client's read with the live prompt, the fake
    // model answering as b did on a living player in the Split's round 4 buy
    // phase (frame 00148). Its tell negates SWITCH PLAYER, and the spectator
    // rule dropped the health the player's own HUD printed beside it.
    const said = async (aliveTell) => {
      model.reply = `STATE: ${JSON.stringify({ phase: 'buy', alive: true, hp: 100, aliveTell, weapon: 'Knife' })}`;
      const r = await call(coach, 'POST', '/read', { headers: { 'X-License-Key': 'GC-READ-TEST-AAAA-BBBB' },
        body: { image: 'aGVsbG8=', context: { map: 'Split', teamScore: 2, enemyScore: 1 } } });
      return { status: r.status, ctx: (r.body && r.body.context) || {} };
    };
    const NONE = ['SWITCH PLAYER not shown; scoreboard open, own HP 100',
      'no SWITCH PLAYER or KILLED BY printed, own HP 100 and knife', 'no own health, KILLED BY not visible'];
    const STILL = ['SWITCH PLAYER bottom left, no own HP', 'KILLED BY Sage, no own health'];
    const none = [];
    for (const t of NONE) none.push({ t, ...(await said(t)) });
    const still = [];
    for (const t of STILL) still.push({ t, ...(await said(t)) });
    model.reply = null;
    const cap = coach.__test.TELL_MAX.live;
    ok(NONE.every((t) => t.length <= cap) && STILL.every((t) => t.length <= cap),
      `every tell here fits the live prompt's ${cap} characters, so the rule weighs it whole`);
    ok(none.every((x) => x.status === 200 && x.ctx.playerAlive === true && x.ctx.playerHp === 100 && x.ctx.aliveTell === x.t),
      `a death word its own clause negates ("SWITCH PLAYER not shown", "no SWITCH PLAYER or KILLED BY printed") leaves the living player's 100 as the model read it (${none.map((x) => `${x.ctx.playerAlive}/${x.ctx.playerHp}`).join(', ')})`);
    ok(still.every((x) => x.status === 200 && x.ctx.playerAlive === false && x.ctx.playerHp === undefined),
      `where the "no" is the health's, SWITCH PLAYER and KILLED BY still name the screen, and the 100 beside them, a teammate's, is dropped (${still.map((x) => `${x.ctx.playerAlive}/${x.ctx.playerHp}`).join(', ')})`);
  }

  // ── Ask Coach's context (8.4.1) ───────────────────────────────────────────
  {
    // What an 8.4.0 install sends, Stats' four Overview scores as a trend.
    const TREND = { impact: { avg: 83, direction: 'flat' }, positioning: { avg: 62, direction: 'down' },
      utility: { avg: 65, direction: 'up' }, aim: { avg: 71, direction: 'flat' } };
    model.sent.length = 0;
    const r = await call(coach, 'POST', '/chat', { headers: { 'X-License-Key': 'GC-CHAT-TEST-AAAA-BBBB' },
      body: { messages: [{ role: 'user', content: 'What should I work on?' }], context: { game: 'valorant', coachTrend: TREND } } });
    const prompt = promptOf(model.sent[0]);
    const TOLD = /coached.session|weakest or falling|falling category|impact 83|positioning 62|utility 65|aim 71/i;
    ok(TOLD.test('Their coached-session trend (0-100 per category, last 10 sessions vs the 10 before): impact 83 flat')
      && TOLD.test('Target the weakest or falling category when giving drills.') && !TOLD.test('Their tracker profile (last 25 competitive matches)'),
    'the check finds the old trend line and its order, and not the tracker profile');
    ok(r.status === 200 && prompt.length > 500 && !TOLD.test(prompt),
      `Ask Coach is never told Stats' four scores are a coached-session trend, nor to drill the weakest, whatever a client sends (${r.status})`);
    // Ask Coach's chat() is services/ask-coach.js's since 8.5.0, its context the
    // old shape (oldShape) beside v2's (src/shared/chat-context.js).
    const srcOf = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const askSrc = srcOf('src', 'main', 'services', 'ask-coach.js');
    // Line ends as git checks the file out on this PC (CRLF) or as it is stored (LF).
    const chatFn = (askSrc.match(/\r?\n {2}async chat\(messages, opts\) \{[\s\S]*?\r?\n {2}\}\r?\n/) || [''])[0];
    const oldShape = (askSrc.match(/\r?\n {2}async oldShape\([^)]*\) \{[\s\S]*?\r?\n {2}\}\r?\n/) || [''])[0];
    ok(/coachTrend\s*:/.test('      coachTrend:   valorant ? trend : null,') && !/coachTrend\s*:/.test('      // No coachTrend (8.4.1): Stats'),
      'the app check finds a coachTrend field, and not a comment naming it');
    ok(chatFn.length > 1000 && /api\.post\('\/api\/coach\/chat'/.test(chatFn) && oldShape.length > 500
      && ![chatFn, oldShape, srcOf('src', 'shared', 'chat-context.js')].some((s) => /coachTrend\s*:/.test(s)),
      `and the app sends none: chat()'s context, the old shape and v2's, has no coachTrend (${chatFn.length} and ${oldShape.length} characters read)`);
  }

  // ── Client errors are 4xx and stay out of Recent errors ──────────────────
  {
    const before = presence.errors.length;
    const res = () => {
      const r = { statusCode: 200, headersSent: false, body: null, statusCalls: 0 };
      r.status = (c) => { r.statusCode = c; r.statusCalls++; return r; };
      r.json = (b) => { r.body = b; r.headersSent = true; return r; };
      return r;
    };
    const parse = Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' });
    let r = res();
    errorHandler(parse, { originalUrl: '/api/coach/read' }, r, () => {});
    ok(r.statusCode === 400 && r.body.error === 'Malformed JSON body', `a malformed JSON body is 400 (${r.statusCode})`);
    const aborted = Object.assign(new Error('request aborted'), { status: 400, type: 'request.aborted' });
    r = res();
    errorHandler(aborted, { originalUrl: '/api/coach/read' }, r, () => {});
    ok(r.statusCode === 400, `an upload the client abandoned is 400 (${r.statusCode})`);
    r = res();
    errorHandler(corsRefusal(), { originalUrl: '/api/payments/cancel' }, r, () => {});
    ok(r.statusCode === 400 && r.body.error === 'Origin not allowed', `a refused origin is 400 (${r.statusCode})`);
    ok(presence.errors.length === before, 'and none of the three is recorded as a server error');
    r = res();
    errorHandler(Object.assign(new Error('too big'), { type: 'entity.too.large', status: 413 }), { originalUrl: '/x' }, r, () => {});
    ok(r.statusCode === 413, 'a body over the limit is still 413');
    r = res();
    errorHandler(new Error('the server broke'), { originalUrl: '/api/coach/read?x=1' }, r, () => {});
    ok(r.statusCode === 500 && presence.errors.length === before + 1, 'the server\'s own failure is still a 500 and recorded');
    ok(presence.errors[presence.errors.length - 1].where === '/api/coach/read', 'under its route, query string removed');
    r = res();
    r.headersSent = true;
    errorHandler(parse, { originalUrl: '/x' }, r, () => {});
    ok(r.statusCalls === 0, 'and nothing is written over a response already sent');
  }

  // ── presence: who counts as a person, and which route is evicted ─────────
  {
    const p = new Presence({ now: () => Date.parse('2026-10-04T18:00:00Z') });
    p.touch({ key: 'Bearer eyJhbGciOiJIUzI1NiJ9', path: '/api/coach/read' });
    p.touch({ key: 'not a licence key at all', path: '/api/license/activate' });
    p.touch({ key: { key: 'GC-AAAA-BBBB-CCCC-DDDD' }, path: '/api/coach/read' });
    ok(p.snapshot().users.length === 0, 'a junk header, a mistyped key or an object is not a person');
    p.touch({ key: 'gc-aaaa-bbbb-cccc-dddd', path: '/api/coach/read' });
    ok(p.snapshot().users.length === 1, 'a real licence key is, in any case');

    for (let i = 0; i < 200; i++) p.finish({ path: `/api/r${i}`, status: 200, ms: 5 });
    p.finish({ path: '/api/r0', status: 200, ms: 5 });   // the busiest route, used again
    p.finish({ path: '/api/new', status: 200, ms: 5 });
    ok(p.routes.size === 200 && p.routes.has('/api/r0') && !p.routes.has('/api/r1'),
      'at the cap the least recently used route goes, not the first one ever seen');
  }

  // ── the admin view's account lookups ─────────────────────────────────────
  {
    const { resolveWho, who } = adminRouter.__test;
    presence.users.clear();
    presence.keys.clear();
    who.clear();
    const keyN = (i) => `GC-${String(i).padStart(4, '0')}-AAAA-BBBB-CCCC`;
    for (let i = 0; i < 150; i++) presence.touch({ key: keyN(i), path: '/api/coach/read' });
    ok(presence.keys.size === 150, '150 people seen today');

    sb.inCalls.length = 0;
    const a = resolveWho();
    const b = resolveWho();
    ok(a === b, 'two page loads at once share one lookup');
    const first = await a;
    ok(sb.inCalls.length === 1 && sb.inCalls[0].length === 100, 'one query, for the first hundred keys');
    ok(Object.keys(first).length === 100 && Object.values(first).every((w) => w.email),
      `only the hundred asked about get an entry, each with an email (${Object.keys(first).length})`);
    ok(sb.maxInFlight > 1 && sb.maxInFlight <= 8, `account lookups run in parallel, at most eight at once (${sb.maxInFlight})`);
    const second = await resolveWho();
    ok(Object.keys(second).length === 150 && Object.values(second).every((w) => w.email),
      'the next refresh resolves the other fifty instead of skipping them forever');

    const gone = [...presence.keys.keys()].slice(0, 10);
    for (const h of gone) { presence.keys.delete(h); presence.users.delete(h); }
    const third = await resolveWho();
    ok(gone.every((h) => !(h in third)) && Object.keys(third).length === 140,
      'someone presence has forgotten is forgotten here too');

    sb.fail = true;
    presence.touch({ key: 'GC-ZZZZ-AAAA-BBBB-CCCC', path: '/api/coach/read' });
    const fourth = await resolveWho();
    ok(!(hashOf('GC-ZZZZ-AAAA-BBBB-CCCC') in fourth), 'a failed lookup writes nobody as unknown for ten minutes');
    sb.fail = false;
    const fifth = await resolveWho();
    ok(fifth[hashOf('GC-ZZZZ-AAAA-BBBB-CCCC')] && fifth[hashOf('GC-ZZZZ-AAAA-BBBB-CCCC')].email,
      'and the next refresh simply asks again');
  }

  // ── A game no longer coached: Marvel Rivals ──────────────────────────────
  const GONE = { error: 'Marvel Rivals is no longer supported by Occlara. Update Occlara at occlara.app.' };
  const LICENCE = { 'X-License-Key': 'GC-QWER-TYUI-OPAS-DFGH' };
  {
    // The three paths the Rivals routes served, and any other, by any method.
    const OLD = [['POST', '/draft'], ['POST', '/review'], ['POST', '/identify'], ['GET', '/'], ['GET', '/review'],
      ['PUT', '/draft'], ['DELETE', '/identify'], ['POST', '/scoreboard/12?x=1']];
    const tables = sb.tables;
    const sent = model.sent.length;
    const wrong = [];
    for (const [method, url] of OLD) {
      for (const headers of [LICENCE, {}]) {
        const r = await call(retired.rivals, method, url, { headers, body: { image: 'aGVsbG8=' } });
        if (r.status !== 410 || JSON.stringify(r.body) !== JSON.stringify(GONE)) {
          wrong.push(`${method} ${url} ${headers === LICENCE ? 'with' : 'without'} a licence: ${r.status} ${JSON.stringify(r.body)}`);
        }
      }
    }
    ok(wrong.length === 0, `every /api/rivals path, by any method, with a licence or none, answers 410 with the one sentence${wrong.length ? `: ${wrong.join('; ')}` : ''}`);
    ok(sb.tables === tables && model.sent.length === sent,
      `and asks neither the licence table nor a model (${sb.tables - tables} lookups, ${model.sent.length - sent} model calls)`);
  }
  {
    // Ask Coach from an older install still on that game: answered as for any
    // game it does not know, its prompt naming neither the game nor heroes.
    const ask = async (game) => {
      model.sent.length = 0;
      const r = await call(coach, 'POST', '/chat', { headers: LICENCE,
        body: { messages: [{ role: 'user', content: 'How do I stop dying first?' }], context: { game } } });
      const first = model.sent[0];
      return { status: r.status, prompt: String((first && first.body.messages && first.body.messages[0].content) || '') };
    };
    const old = await ask('rivals');
    const unknown = await ask('a game Occlara never coached');
    const lol = await ask('lol');
    ok(old.status === 200 && old.prompt.length > 500 && old.prompt === unknown.prompt
      && /a Radiant-level Valorant coach/.test(old.prompt) && !/marvel|rivals|\bheroes\b/i.test(old.prompt),
    `Ask Coach asked about Marvel Rivals by an older install answers as for any game it does not know, naming neither (${old.status})`);
    ok(lol.status === 200 && /a high level League of Legends coach/.test(lol.prompt) && /\bchampions\b/.test(lol.prompt)
      && !/marvel|rivals|\bheroes\b/i.test(lol.prompt), 'and League is still asked about as League');
  }
  {
    // And no other server code or data names the game: what is left is the
    // 410 itself (routes/retired.js) and the line in server.js mounting it.
    const NAMES_IT = /rivals|marvel|netease/i;
    const MOUNT = /^app\.use\('\/api\/rivals',\s*retiredRoutes\.rivals\);$/;
    ok(['rivals', 'Marvel', 'NetEase'].every((w) => NAMES_IT.test(w)) && !NAMES_IT.test('Valorant and League of Legends')
      && MOUNT.test("app.use('/api/rivals',   retiredRoutes.rivals);") && !MOUNT.test("app.use('/api/rivals',   rivalsRoutes);"),
    'the scan finds the game when it is named, and knows its mount');
    const hits = [];
    let read = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(js|json)$/.test(e.name)) continue;
        const rel = path.relative(SERVER, p).split(path.sep).join('/');
        read++;
        if (rel === 'routes/retired.js') continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (!NAMES_IT.test(line)) return;
          if (rel === 'server.js' && MOUNT.test(line.trim())) return;
          hits.push(`${rel}:${i + 1}`);
        });
      }
    };
    walk(SERVER);
    ok(read > 20 && hits.length === 0,
      `no other server code or data names it (${read} files read${hits.length
        ? `; named ${hits.length} times, at ${hits.slice(0, 12).join(', ')}${hits.length > 12 ? ' and more' : ''}` : ''})`);

    // And no file of the app calls one, so a current install loses nothing to the 410.
    const SRC = path.join(__dirname, '..', 'src');
    const files = [];
    const walkSrc = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkSrc(p);
        else if (/\.(js|html)$/.test(e.name)) files.push(p);
      }
    };
    walkSrc(SRC);
    // A comment may say what the server does with them; a line of code may not name one.
    const COMMENT = /^\s*(\/\/|\/?\*|<!--)/;
    ok(COMMENT.test('  // the server answers /api/rivals with 410') && COMMENT.test(' * /api/rivals/draft')
      && !COMMENT.test("const DRAFT_ROUTE = '/api/rivals/draft';"), 'the app scan tells a comment from a call');
    const callers = files.filter((f) => fs.readFileSync(f, 'utf8').split('\n')
      .some((line) => line.includes('/api/rivals') && !COMMENT.test(line))).map((f) => path.relative(SRC, f));
    ok(files.length > 50 && callers.length === 0,
      `no file of the app calls a Rivals route, so a current install loses nothing to the 410 (${files.length} files read${callers.length ? `; called from ${callers.join(', ')}` : ''})`);
  }
  {
    // The server as Railway starts it: server.js in a process of its own, on a
    // free local port, with stand in secrets and a working folder holding no
    // .env for dotenv to find. Nothing it is asked here looks anything up.
    const os = require('os');
    const net = require('net');
    const http = require('http');
    const { spawn } = require('child_process');
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
    });
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(AI_|STRIPE_|SUPABASE_|ADMIN_|GEMINI|OPENROUTER|HENRIKDEV|TRACKER|RIOT)/i.test(k)) env[k] = v;
    }
    Object.assign(env, { PRIMER_LIVE_CHECK: 'off', PORT: String(port), SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_KEY: 'stand-in-guards-1',
      AI_API_KEY: 'sk-or-v1-stand-in-guards-2', AI_BASE_URL: 'https://openrouter.ai/api/v1', STRIPE_SECRET_KEY: 'sk_test_stand_in_guards_3' });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-guards-'));
    const child = spawn(process.execPath, [path.join(SERVER, 'server.js')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const send = (method, p, { headers = {}, body = null } = {}) => new Promise((resolve) => {
      const data = body === null ? null : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, method, path: p, timeout: 3000,
        headers: { ...headers, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json, text }); });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      if (data) req.write(data);
      req.end();
    });
    const results = {};
    try {
      let up = null;
      for (let i = 0; i < 120 && !up && child.exitCode === null; i++) {
        up = await send('GET', '/health');
        if (!up) await new Promise((r) => setTimeout(r, 150));
      }
      results.health = up;
      results.old = [];
      for (const [method, p] of [['POST', '/api/rivals/draft'], ['POST', '/api/rivals/review'], ['POST', '/api/rivals/identify'],
        ['GET', '/api/rivals'], ['GET', '/api/rivals/heroes?all=1']]) {
        for (const headers of [LICENCE, {}]) {
          const r = await send(method, p, { headers, body: method === 'GET' ? null : { image: 'aGVsbG8=' } });
          results.old.push({ what: `${method} ${p} ${headers === LICENCE ? 'with' : 'without'} a licence`, r });
        }
      }
      results.burst = [];
      for (let i = 0; i < 95; i++) results.burst.push(await send('POST', '/api/rivals/draft', { headers: LICENCE, body: { image: 'aGVsbG8=' } }));
      results.read = await send('POST', '/api/coach/read', { body: { image: 'aGVsbG8=' } });
      results.nothing = await send('GET', '/api/nothing-here');
    } finally {
      child.kill();
      await exited;
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* the folder outlives a slow exit */ }
    }
    const h = results.health;
    ok(h && h.status === 200, `the server starts as Railway starts it (${h ? h.status : `no answer: ${output.slice(-300)}`})`);
    const off = (results.old || []).filter(({ r }) => !r || r.status !== 410 || JSON.stringify(r.json) !== JSON.stringify(GONE));
    ok(h && results.old.length === 10 && off.length === 0,
      `and answers every old Rivals path 410 with the sentence where those routes were mounted${off.length ? `: ${off.map((o) => `${o.what} ${o.r ? `${o.r.status} ${o.r.text.slice(0, 80)}` : 'no answer'}`).join('; ')}` : ''}`);
    const burst = results.burst || [];
    ok(h && burst.length === 95 && burst.every((r) => r && r.status === 410),
      `however often it asks: 95 in a minute from one licence are all 410, no rate limit turns one into a 429 (${burst.map((r) => (r ? r.status : 'none')).filter((s) => s !== 410).join(', ') || 'all 410'})`);
    ok(results.read && results.read.status === 400 && results.nothing && results.nothing.status === 404,
      `while the coach routes beside it answer as before, and a path nobody serves is still 404 (${results.read && results.read.status}, ${results.nothing && results.nothing.status})`);
  }

  // ── The server core of 8.5.0: scripts/server-guards-core.js ─────────────
  await require('./server-guards-core.js')({ ok, call, coach, PW, SERVER });

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' server guard checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
