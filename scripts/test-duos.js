'use strict';

/**
 * OCCLARA DUOS (docs/claude/duos.md), end to end with no network beyond
 * localhost:
 *   - the rules, the app's copy byte for byte; the codes; the team word;
 *   - the sheet: what the app builds from a real shaped review holds no
 *     sentence of it (no summary, why, read, look's words) and no name, and
 *     the server keeps exactly what the app sends; impossible sheets refused;
 *   - the clock of two clips (duo-time.js), cuts and all;
 *   - THE SWITCH: SOCIAL_DUOS_ON and SOCIAL_ON both exactly 1, else every
 *     route answers not live before any work and /api/social/status says
 *     duos false; a licence key is 403, no credentials 401;
 *   - the real routes on the real SQL (PGlite) and a faithful Supabase
 *     Storage stand-in (its signed upload and download URLs over HTTP):
 *     a code made with Max and joined with no plan; both apps report one
 *     match; main's half (duos-service.js) uploads the sheet and the clips
 *     one at a time to the URLs the server issued, PAUSES the moment a match
 *     starts mid upload and sends it again after, never sends a stored clip
 *     twice, respects the switch; the partner downloads a clip only when it
 *     is opened, refuses a file that is not Matroska, plays it through the
 *     clip scheme; pins; a lapsed plan pauses the duo on the next call; a
 *     block and an expiry leave no file in the bucket after the sweep;
 *   - no answer holds an email, a user id, a profile id, a match id, a hash
 *     or a code's hash, and the only URLs are the signed ones, their path
 *     made of refs;
 *   - the limits and the 250 ms floor through the real wiring;
 *   - the Duos page in the fake DOM, every state; the shell's row; the
 *     Discoverable copy both ways.
 *
 * Run: npm run test:duos
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
const SALT = 'test-salt-for-duos';

const express = require(path.join(ROOT, 'server', 'node_modules', 'express'));
const SD = require(path.join(ROOT, 'server', 'services', 'duos.js'));
const SS = require(path.join(ROOT, 'server', 'services', 'social.js'));
const duoRoutes = require(path.join(ROOT, 'server', 'routes', 'duos.js'));
const socialRoutes = require(path.join(ROOT, 'server', 'routes', 'social.js'));
const rateLimits = require(path.join(ROOT, 'server', 'services', 'rate-limits.js'));
const AD = require(path.join(ROOT, 'src', 'shared', 'duos.js'));
const AS = require(path.join(ROOT, 'src', 'shared', 'social.js'));
const DT = require(path.join(ROOT, 'src', 'renderer', 'duos', 'duo-time.js'));
const scheme = require(path.join(ROOT, 'src', 'main', 'services', 'clip-scheme.js'));
const { createDuos } = require(path.join(ROOT, 'src', 'main', 'services', 'duos-service.js'));
const pg = require('./fixtures/pglite-duos');
const { createStorage } = require('./fixtures/storage-stand-in');
const fx = require('./fixtures/duos-stand-in');

let fails = 0;
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${extra !== undefined ? `  ${JSON.stringify(extra).slice(0, 600)}` : ''}`); } else console.log(`ok    ${what}`);
};
const U = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const MATCH_ID = '7c1d3e5f-2a4b-4c6d-8e0f-123456789abc';
const MATCH_ID_2 = '8d2e4f60-3b5c-4d7e-9f10-23456789abcd';
const US = ['Jett', 'Sova', 'Omen', 'Sage', 'Breach'];
const THEM = ['Fade', 'Raze', 'Killjoy', 'Cypher', 'Reyna'];
const FIXTURE = fs.readFileSync(fx.CLIP);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const blockOf = (raw) => { const t = raw.split(String.fromCharCode(13)).join(''); return t.slice(t.indexOf('// ── DUO RULES START'), t.indexOf('\n', t.indexOf('// ── DUO RULES END')) + 1); };

function listen(app) {
  return new Promise((resolve) => { const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })); });
}

/** A saved review shaped as the app keeps one, with free text everywhere a review has it, and a name in it. */
function reviewOf(id, matchId, agent) {
  return {
    id, at: Date.now() - 20 * 60000, game: 'valorant',
    review: {
      kind: 'valorant', source: 'watched', matchId, summary: 'You played well, Kestrel#EUW1 said so.',
      comps: { us: US.map((a) => ({ agent: a })), them: THEM.map((a) => ({ agent: a })) },
      game: { agent, map: 'Ascent', mode: 'Competitive', result: 'Victory', score: '13-9' },
      grade: { score: 74.4, letter: 'B' }, scoreline: { kills: 21, deaths: 15, assists: 6 },
      rounds: [
        { n: 1, sideKey: 'attacking', result: 'won', died: false, planted: true, why: 'a free text why',
          riot: { firstKill: true, kills: 2, feed: [{ ms: 18200, by: 'me', on: 'enemy' }, { ms: 23100, by: 'me', on: 'enemy' }], plantSite: 'A', plantSec: 41.2, killPlaces: ['A Main'] } },
        { n: 2, sideKey: 'attacking', result: 'lost', died: true, spot: 'A Main', reads: ['a read of the screen'],
          riot: { sec: 34, killer: 'Raze', weapon: 'Vandal', firstDeath: false, traded: false, alive: { mates: 2, enemies: 3 }, place: 'A Main',
            feed: [{ ms: 12000, by: 'me', on: 'enemy' }, { ms: 34200, by: 'enemy', on: 'me' }] },
          forensics: { cause: 'isolated', what: 'You swung alone, near Kestrel#EUW1.', better: 'Wait.', clip: 'r2-clip.mkv', clipDeath: 2600 } },
        { n: 3, sideKey: 'attacking', result: 'won', died: false, riot: { kills: 2, feed: [{ ms: 22100, by: 'me', on: 'enemy' }, { ms: 30400, by: 'me', on: 'enemy' }] },
          highlight: { clip: 'h3-clip.mkv', length: 9000, kills: [600, 2400], cuts: [{ at: 1500, skipped: 5000 }] } },
      ],
      deathFlags: { rounds: [{ n: 2, clip: 'd1-clip.mkv', clipDeath: 4000 }] },
    },
  };
}

(async () => {
  // ── The rules, the codes, the team ──────────────────────────────────────
  const srvText = fs.readFileSync(path.join(ROOT, 'server', 'services', 'duos.js'), 'utf8');
  const appText = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'duos.js'), 'utf8');
  ok(blockOf(srvText).length > 2000 && blockOf(srvText) === blockOf(appText), 'the app\'s duo rules block is the server\'s, byte for byte');
  const code = SD.mintCode();
  ok(code.length === 10 && code.split('').every((c) => SD.CODE_ALPHABET.includes(c)) && SD.CODE_ALPHABET.length === 32 && !/[01IO]/.test(SD.CODE_ALPHABET),
    'a code: 10 of 32 letters, no 0, 1, I or O', code);
  ok(SD.codeOf(`${code.slice(0, 5).toLowerCase()}-${code.slice(5)} `) === code && SD.codeOf('K7M2Q9XH4') === null && SD.codeOf('K7M2Q-9XH40') === null && AD.codeOf(SD.codeShown(code)) === code,
    'a code read back from any case, a dash and spaces; a short one, or one with a 0, is none');
  const t1 = SD.teamOf(['Sova', 'Jett', 'Omen'], ['Raze', 'Fade'], 'Jett');
  const t2 = SD.teamOf(['Omen', 'Jett', 'Sova'], ['Fade', 'Raze'], 'Omen');
  ok(t1 && t1 === t2 && t1 === 'Jett,Omen,Sova|Fade,Raze', 'teammates name one team word, in any order', t1);
  ok(SD.teamOf(['Jett', 'Sova'], ['Sova', 'Jett'], 'Jett') === null && SD.teamOf(['Sova', 'Omen'], ['Fade'], 'Jett') === null && SD.teamOf(['Jett', 'Jett'], [], 'Jett') === null
    && SD.teamOf(['Jett', 'Not an agent'], [], 'Jett') === null, 'a mirror, a team without the own agent, a repeat or an unknown agent: never paired');

  // ── The sheet ───────────────────────────────────────────────────────────
  const saved = reviewOf('val-1700000000000-aaaa', MATCH_ID, 'Jett');
  const sheet = AD.sheetOf(saved);
  const clean = SD.cleanSheet(sheet);
  ok(clean.ok, 'the server takes the sheet the app builds', clean);
  const text = JSON.stringify(clean.sheet);
  ok(!/Kestrel|free text|a read|swung|Wait\.|You played/.test(text) && JSON.stringify(sheet).indexOf('Kestrel') === -1,
    'no sentence of the review reaches the sheet: no summary, why, read, look\'s words, and no name', text.slice(0, 200));
  const r2 = clean.sheet.rounds.find((x) => x.n === 2);
  ok(r2 && r2.sec === 34 && r2.place === 'A Main' && r2.killer === 'Raze' && r2.weapon === 'Vandal' && r2.kills.join() === '12' && r2.cause === 'isolated' && r2.traded === false
    && r2.alive.mates === 2 && clean.sheet.rounds[0].plant.site === 'A' && clean.sheet.rounds[0].kills.join() === '18,23' && clean.sheet.grade.letter === 'B',
  'Riot\'s facts kept: the second, the place, the killer and gun, the kills, the cause\'s key, the trade, the odds, the plant', r2);
  const bad = {
    'a round twice': { ...clean.sheet, rounds: [clean.sheet.rounds[0], clean.sheet.rounds[0]] },
    'more wins than the score': { ...clean.sheet, score: { us: 0, them: 3 } },
    'six kills in a round': { ...clean.sheet, rounds: [{ n: 1, died: false, kills: [1, 2, 3, 4, 5, 6] }] },
    'a killer with no death': { ...clean.sheet, rounds: [{ n: 1, died: false, killer: 'Raze', kills: [] }] },
    'kills after the death': { ...clean.sheet, rounds: [{ n: 1, died: true, sec: 10, kills: [40] }] },
    'more kills than the scoreline': { ...clean.sheet, line: { k: 1, d: 15, a: 0 } },
    'a C site on Ascent': { ...clean.sheet, rounds: [{ n: 1, died: false, kills: [], plant: { site: 'C', sec: 30 } }] },
    'a victory lost on score': { ...clean.sheet, result: 'W', score: { us: 9, them: 13 } },
    'a string number': { ...clean.sheet, rounds: [{ n: '1', died: false, kills: [] }] },
  };
  const slipped = Object.entries(bad).filter(([, s]) => SD.cleanSheet(s).ok).map(([k]) => k);
  ok(!slipped.length, 'an impossible sheet is refused whole', slipped);
  const loose = SD.cleanSheet({ ...clean.sheet, note: 'hello', rounds: [{ n: 1, died: true, sec: 30, place: 'Kestrel#EUW1', killer: 'Nobody', weapon: '<b>x</b>', cause: 'You swung', kills: [] }] });
  ok(loose.ok && !/hello|Kestrel|Nobody|<b>|swung/.test(JSON.stringify(loose.sheet)), 'a place, an agent, a gun or a cause no list knows is dropped, and any other key too', loose.sheet && loose.sheet.rounds);
  ok(SD.cleanSheet({ ...clean.sheet, pad: 'x'.repeat(30000) }).error === 'too-big', 'over 24 KB: refused');
  ok(SD.cleanSheet(fx.MINE).ok && SD.cleanSheet(fx.THEIRS).ok, 'the stand-in\'s sheets are ones the server takes');
  const rep = AD.reportOf(saved);
  ok(rep && rep.matchId === MATCH_ID && rep.agent === 'Jett' && rep.us.length === 5 && SD.teamOf(rep.us, rep.them, rep.agent), 'the report: Riot\'s match id, both teams, the agent', rep);
  ok(AD.reportOf({ review: { ...saved.review, matchId: null } }) === null && AD.reportOf({ review: { ...saved.review, source: 'riot' } }) === null,
    'a review not linked to Riot, or graded from Riot alone, is never reported');
  const clips = AD.clipsOf(saved);
  ok(clips.map((c) => `${c.name}:${c.kind}`).join() === 'd1-clip.mkv:flag,r2-clip.mkv:death,h3-clip.mkv:highlight'
    && clips[1].marks.anchor.clip === 2600 && clips[1].marks.anchor.round === 34200 && clips[2].marks.anchor.clip === 600 && clips[2].marks.anchor.round === 22100
    && clips[0].marks.anchor.round === 34200, 'every r, d and h clip, each anchored on Riot\'s moment of its death or first kill', clips);

  // ── One clock for two clips ─────────────────────────────────────────────
  const m1 = { anchor: { clip: 2600, round: 34200 } };
  ok(DT.roundAt(m1, 2600) === 34200 && DT.roundAt(m1, 0) === 31600 && DT.clipAt(m1, 34200, 15000).clip === 2600 && DT.clipAt(m1, 1000, 15000).inside === false,
    'a death clip: the round\'s clock off its death, before its start said so');
  const m2 = { anchor: { clip: 600, round: 22100 }, cuts: [{ at: 1500, skipped: 5000 }] };
  ok(DT.roundAt(m2, 1400) === 22900 && DT.roundAt(m2, 2400) === 28900 && DT.clipAt(m2, 28900, 9000).clip === 2400,
    'a highlight: past a cut the round runs on by what it skipped, and back');
  const gap = DT.clipAt(m2, 25000, 9000);
  ok(gap.gap === true && gap.clip === 1500, 'a moment a cut skipped lands on the cut', gap);
  ok(DT.roundAt({}, 100) === null && DT.clipAt({ anchor: null }, 1, 1) === null, 'no anchor: no clock, the clip plays alone');
  ok(DT.clockOf(34200) === '0:34.2' && DT.clockOf(61000) === '1:01.0', 'the round\'s time in words');

  // ── The clip scheme's duo host ──────────────────────────────────────────
  ok(scheme.duoUrlFor('a1b2c3d4e5f60718', 'r2-clip.mkv') === 'occlara-clip://duo/a1b2c3d4e5f60718/r2-clip.mkv'
    && JSON.stringify(scheme.parseDuo('occlara-clip://duo/a1b2c3d4e5f60718/r2-clip.mkv')) === '{"ref":"a1b2c3d4e5f60718","name":"r2-clip.mkv"}'
    && ['occlara-clip://duo/../r2-clip.mkv', 'occlara-clip://duo/a1b2/r2-clip.mkv', 'occlara-clip://duo/a1b2c3d4e5f60718/x.mkv', 'occlara-clip://review/a1b2c3d4e5f60718/r2-clip.mkv?x=1']
      .every((u) => scheme.parseDuo(u) === null) && scheme.parse('occlara-clip://duo/a1b2c3d4e5f60718/r2-clip.mkv') === null,
  'a duo clip\'s URL: its ref and its name, nothing else read as one, and never as a review\'s');

  // ── The routes, on the real SQL and the storage stand-in ────────────────
  const db = await pg.makeDb();
  for (let i = 1; i <= 12; i++) await pg.addUser(db, U(i));
  const storage = createStorage({ buckets: { 'duo-clips': { fileSizeLimit: SD.DUO.CLIP_MAX_BYTES, allowedMimeTypes: ['video/x-matroska'] } } });
  await storage.listen();
  const supa = { rpc: pg.supabaseOf(db).rpc, storage };
  const store = SD.createStore(supa);
  let storeCalls = 0;
  const counted = new Proxy(store, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { storeCalls++; return t[k](...a); } : t[k]) });
  const sessions = {};
  for (let i = 1; i <= 12; i++) sessions[`occ_${i}`] = U(i);
  const resolver = {
    identify: async (req) => {
      const auth = String(req.headers.authorization || '');
      const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (sessions[tok]) return { status: 'valid', caller: { userId: sessions[tok], accountKey: `u:${sessions[tok]}`, email: `${tok}@example.test`, via: 'session', tier: 'max' } };
      if (req.headers['x-license-key'] === 'GC-LINKED') return { status: 'valid', caller: { userId: U(1), accountKey: `u:${U(1)}`, via: 'key', tier: 'max' } };
      if (auth || req.headers['x-license-key']) return { status: 'invalid' };
      return { status: 'none' };
    },
  };
  const reportRows = [];
  const ON = { SOCIAL_ON: '1', SOCIAL_DUOS_ON: '1', ACCOUNT_HASH_SALT: SALT };
  const make = (env, st) => duoRoutes.createRouter({ store: st || store, resolver, env, log: () => {}, reports: { insert: async (row) => { reportRows.push(row); } },
    uuid: () => '99999999-9999-4999-8999-999999999999' });
  const duoRouter = make(ON);
  const app = express();
  app.use(express.json());
  app.use('/api/social/duos', duoRouter);
  app.use('/api/social', socialRoutes.createRouter({ store: SS.createStore(pg.supabaseOf(db)), resolver, env: ON, log: () => {}, duos: duoRouter }));
  for (const [mount, env] of [['/off', { ...ON, SOCIAL_DUOS_ON: '' }], ['/nosocial', { ...ON, SOCIAL_ON: '' }], ['/odd', { ...ON, SOCIAL_DUOS_ON: 'true' }]]) {
    const r = make(env, counted);
    app.use(`${mount}/duos`, r);
    app.use(mount, socialRoutes.createRouter({ store: SS.createStore(pg.supabaseOf(db)), resolver, env, log: () => {}, duos: r }));
  }
  const { server, base } = await listen(app);
  const answers = [];
  async function req(method, url, { as, key, body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Occlara-Version': '8.20.0' };
    if (as) headers.Authorization = `Bearer ${as}`;
    if (key) headers['X-License-Key'] = key;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    answers.push({ url, json });
    return { ok: res.ok, status: res.status, data: json || {} };
  }
  const get = (url, as) => req('GET', url, { as });
  const post = (url, body, as) => req('POST', url, { as, body });
  /** main's api-client, pointed at this server. */
  const apiAs = (tok) => ({ authHeaders: () => ({ Authorization: `Bearer ${tok}` }), get: (p) => req('GET', p, { as: tok }), post: (p, b) => req('POST', p, { as: tok, body: b }) });
  const sql = (q, p) => db.query(q, p);
  // The status the profiles service holds (social-service.js peekStatus): Duos live.
  const LIVE_AT = Date.now();
  const livePeek = () => ({ live: true, duos: true, at: LIVE_AT });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duos-test-'));

  try {
    // THE SWITCH: off, every route is not live before any work, and status says so.
    for (const mount of ['/off', '/nosocial', '/odd']) {
      storeCalls = 0;
      const rs = [await get(`${mount}/duos/me`, 'occ_1'), await post(`${mount}/duos/code`, {}, 'occ_1'), await post(`${mount}/duos/report`, { matchId: MATCH_ID, us: US, them: THEM, agent: 'Jett' }, 'occ_1'),
        await post(`${mount}/duos/clip/start`, {}, 'occ_1'), await get(`${mount}/duos/match?ref=a1b2c3d4e5f60718`)];
      const st = await get(`${mount}/status`);
      ok(rs.every((r) => r.status === 503 && r.data.error === 'duos-not-live') && storeCalls === 0 && st.data.duos === false,
        `${mount}: every duo route 503 duos-not-live before any work, signed in or not, and /status says duos false`, [rs.map((r) => r.status), storeCalls, st.data]);
    }
    ok((await get('/api/social/status')).data.duos === true, 'both switches exactly 1, the SQL run: /status says duos true');
    ok((await get('/api/social/duos/me')).status === 401 && (await req('GET', '/api/social/duos/me', { key: 'GC-LINKED' })).status === 403
      && (await req('POST', '/api/social/duos/code', { key: 'GC-LINKED' })).status === 403, 'no credentials 401; a licence key, even linked, 403');

    // Usernames: Alder (Max), Birch (no plan), Cedar (Max, a stranger), Dogwood.
    for (const [i, n] of [[1, 'Alder'], [2, 'Birch'], [3, 'Cedar'], [4, 'Dogwood']]) await post('/api/social/username', { name: n }, `occ_${i}`);
    await pg.setTier(db, U(1), 'max');
    await pg.setTier(db, U(3), 'max');
    ok((await post('/api/social/duos/code', {}, 'occ_2')).data.reason === 'no-max', 'no Max (whatever the client says): no code');
    const made = await post('/api/social/duos/code', {}, 'occ_1');
    ok(made.data.ok && /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/.test(made.data.code), 'Max: a code, shown once', made.data);
    const stored = (await sql('SELECT code_hash FROM public.social_duo_invites')).rows.map((x) => x.code_hash);
    ok(stored.length === 1 && stored[0] === SD.codeHash(SD.codeOf(made.data.code), { ACCOUNT_HASH_SALT: SALT }) && !stored[0].includes(SD.codeOf(made.data.code)), 'kept only as its salted hash');
    const joined = await post('/api/social/duos/accept', { code: made.data.code.toLowerCase() }, 'occ_2');
    ok(joined.data.ok && joined.data.reason === 'paired' && joined.data.username === 'Alder', 'joined with no plan at all', joined.data);
    ok((await post('/api/social/duos/accept', { code: 'zzzzzzzzzz' }, 'occ_4')).data.reason === 'bad-code', 'a wrong code, or one of the wrong shape: bad code');

    // Both report the match: Birch first, then Alder's app (main's half) does it after its match.
    await pg.addGame(db, U(1));
    await pg.addGame(db, U(2));
    const birch = await post('/api/social/duos/report', { matchId: MATCH_ID, us: [...US].reverse(), them: THEM, agent: 'Sova' }, 'occ_2');
    ok(birch.data.ok && birch.data.matches.length === 0, 'the first report waits for the partner', birch.data);
    ok((await post('/api/social/duos/report', { matchId: 'not-a-match', us: US, them: THEM, agent: 'Sova' }, 'occ_2')).status === 400, 'a report of no match id: refused');

    // ── main's half, Alder's PC ──────────────────────────────────────────
    const dirA = path.join(tmp, 'a');
    fs.mkdirSync(path.join(dirA, 'reviews', 'val-1700000000000-aaaa'), { recursive: true });
    for (const n of ['r2-clip.mkv', 'h3-clip.mkv', 'd1-clip.mkv']) fs.writeFileSync(path.join(dirA, 'reviews', 'val-1700000000000-aaaa', n), FIXTURE);
    const keptA = {};
    let busyA = false;
    let slowPut = 0;
    const puts = [];
    const fetchA = async (url, o) => {
      if (o && o.method === 'PUT') { puts.push(url); if (slowPut) await new Promise((res, rej) => { const t = setTimeout(res, slowPut); o.signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); }); }
      return fetch(url, o);
    };
    const reviewsA = {
      list: () => [{ id: saved.id, at: saved.at, matchId: MATCH_ID }],
      get: (id) => (id === saved.id ? saved : null),
      hasClip: (id, n) => fs.existsSync(path.join(dirA, 'reviews', id, n)),
      clipFile: (id, n) => path.join(dirA, 'reviews', id, n),
    };
    const svcA = createDuos({ peekStatus: livePeek, api: apiAs('occ_1'), auth: {}, busy: () => busyA, reviews: reviewsA, clipUrl: (id, n) => scheme.urlFor(id, n),
      store: { get: (k) => keptA[k], set: (k, v) => { keptA[k] = v; } }, cacheDir: path.join(dirA, 'duo-cache'), fetch: fetchA, log: () => {} });
    busyA = true;
    ok(await svcA.state() === null && await svcA.tick() === null && await svcA.openClip({ ref: 'a1b2c3d4e5f60718', name: 'r2-clip.mkv', match: 'a1b2c3d4e5f60718' }) === null
      && await svcA.invite('Birch') === null && await svcA.pin({}) === null, 'mid match: every call null, the tick nothing, no request');
    busyA = false;
    // The first clip's upload is slow, and a match starts during it.
    slowPut = 1500;
    const run = svcA.tick();
    await wait(400);
    busyA = true;
    await run;
    const q1 = keptA.duoQueue[Object.keys(keptA.duoQueue)[0]];
    const firstSlot = Object.values(q1.clips)[0];
    ok(q1.sheet === 'sent' && firstSlot && firstSlot.st === 'wait' && (firstSlot.tries || 0) === 0 && puts.length === 1 && storage.objects.size === 0,
      'Alder\'s app reported, the match is shared, the sheet went up, and the clip in flight was ABORTED the moment a match started, no try spent', [q1, puts.length]);
    busyA = false;
    slowPut = 0;
    await svcA.tick();
    const objs = [...storage.objects.keys()];
    const q2 = keptA.duoQueue[Object.keys(keptA.duoQueue)[0]];
    ok(objs.length === 3 && Object.values(q2.clips).every((c) => c.st === 'done') && objs.every((k) => /^duo-clips\/[0-9a-f]{16}\/[0-9a-f]{16}\/[0-9a-f]{16}\/[0-9a-f]{16}-[rdh]\d-clip\.mkv$/.test(k)),
      'after the match: the three clips went up, one at a time, at the paths the server chose', objs);
    ok(storage.calls.filter((c) => c.op === 'PUT').every((c) => c.size === FIXTURE.length) && [...storage.objects.values()].every((o) => o.type === 'video/x-matroska'), 'each its whole file, as Matroska');
    const putsBefore = puts.length;
    keptA.duoQueue[Object.keys(keptA.duoQueue)[0]].clips = {};
    await svcA.tick();
    ok(puts.length === putsBefore, 'a clip the server says is stored is never sent again, even when this PC forgot it was');
    const sizes = (await sql("SELECT status, size, reserved FROM public.social_duo_clips WHERE user_id = $1", [U(1)])).rows;
    const upHeld = Number((await sql("SELECT sum(bytes)::bigint n FROM public.social_duo_bytes WHERE user_id = $1 AND dir = 'up'", [U(1)])).rows[0].n);
    ok(sizes.every((x) => x.status === 'stored' && Number(x.size) === FIXTURE.length) && upHeld === FIXTURE.length * 3, 'the server looked each file up in storage: stored, its quota settled to the real size', upHeld);
    const lineA = svcA.uploadModel();
    ok(/Shared one match with your duo: 3 clips/.test(lineA.line), 'the upload line says what was shared', lineA.line);
    // The switch off: nothing more goes up.
    svcA.setUpload(false);
    fs.writeFileSync(path.join(dirA, 'reviews', saved.id, 'r4-clip.mkv'), FIXTURE);
    saved.review.rounds.push({ n: 4, died: true, riot: { sec: 19, feed: [{ ms: 19400, by: 'enemy', on: 'me' }] }, forensics: { cause: 'dry-peek', clip: 'r4-clip.mkv', clipDeath: 3000 } });
    const before2 = puts.length;
    await svcA.tick();
    ok(puts.length === before2 && /One clip waits for the switch/.test(svcA.uploadModel().line), 'Upload my clips off: the new clip waits, said so', svcA.uploadModel().line);
    svcA.setUpload(true);
    await wait(400);

    // ── Birch's PC: the shared match, a clip opened ─────────────────────────
    const dirB = path.join(tmp, 'b');
    const keptB = {};
    const svcB = createDuos({ peekStatus: livePeek, api: apiAs('occ_2'), auth: {}, busy: () => false, reviews: { list: () => [], get: () => null, hasClip: () => false, clipFile: () => null },
      store: { get: (k) => keptB[k], set: (k, v) => { keptB[k] = v; } }, cacheDir: path.join(dirB, 'duo-cache'), fetch: (u, o) => fetch(u, o), log: () => {} });
    const stB = await svcB.state();
    ok(stB.duos === true && stB.problem === null && stB.home.partners[0].username === 'Alder' && stB.home.partners[0].state === 'active' && stB.home.max === false
      && stB.home.matches.length === 1, 'Birch\'s page: the duo, active on Alder\'s Max, one shared match', stB.home.partners);
    const mref = stB.home.matches[0].ref;
    const mB = await svcB.match(mref);
    const r2B = mB.match.rounds.find((x) => x.n === 2);
    ok(mB.ok && r2B.theirClips.length === 2 && r2B.theirClips[0].kind === 'death' && r2B.theirClips[0].url === null && r2B.them.line === 'Died at 0:34 at A Main to Raze, Vandal',
      'the shared match: Alder\'s round 2 in words, the death clip first, nothing downloaded yet', r2B.them);
    const gets0 = storage.calls.filter((c) => c.op === 'GET').length;
    const opened = await svcB.openClip({ ref: r2B.theirClips[0].ref, name: r2B.theirClips[0].name, match: mref });
    const cachedFile = svcB.cacheFile(r2B.theirClips[0].ref, r2B.theirClips[0].name);
    ok(opened.ok && opened.url === scheme.duoUrlFor(r2B.theirClips[0].ref, 'r2-clip.mkv') && storage.calls.filter((c) => c.op === 'GET').length === gets0 + 1
      && cachedFile && fs.readFileSync(cachedFile).equals(FIXTURE), 'opened: downloaded once through its signed URL into the duo cache, whole', opened);
    await svcB.openClip({ ref: r2B.theirClips[0].ref, name: r2B.theirClips[0].name, match: mref });
    ok(storage.calls.filter((c) => c.op === 'GET').length === gets0 + 1, 'opened again: from the cache, nothing downloaded');
    const handle = scheme.createHandler({ fileOf: () => null, duoFileOf: (ref, n) => svcB.cacheFile(ref, n) });
    const served = await handle(new Request(opened.url, { headers: { range: 'bytes=0-3' } }));
    const head = Buffer.from(await served.arrayBuffer());
    ok(served.status === 206 && head.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && (await handle(new Request(scheme.duoUrlFor('ffffffffffffffff', 'r2-clip.mkv')))).status === 404,
      'played through the clip scheme from the cache; a ref not in it is a 404');
    // A file that is not Matroska is never kept.
    const h3 = mB.match.rounds.find((x) => x.n === 3).theirClips[0];
    const h3path = (await sql('SELECT path FROM public.social_duo_clips WHERE ref = $1', [h3.ref])).rows[0].path;
    // The same size as the file the server settled (a different size is refused by the server itself: test:duosflow), only its header wrong.
    storage.put('duo-clips', h3path, Buffer.alloc(FIXTURE.length, 0x3c), 'video/x-matroska');
    const notClip = await svcB.openClip({ ref: h3.ref, name: h3.name, match: mref });
    ok(notClip.ok === false && /not a clip/.test(notClip.line) && !svcB.cacheFile(h3.ref, h3.name), 'a file that is not Matroska: refused, never cached', notClip);
    // A pin on Alder's clip.
    const pinned = await svcB.pin({ clip: r2B.theirClips[0].ref, at: 2100, label: 'too-far', reaction: 'oops' });
    ok(pinned.ok && /^[0-9a-f]{16}$/.test(pinned.ref), 'Birch pins a moment of Alder\'s clip, from the fixed list');
    ok((await post('/api/social/duos/pin', { clip: r2B.theirClips[0].ref, at: 100, label: 'you are bad', reaction: null }, 'occ_2')).status === 400, 'a label off the list: refused');
    const stA = await svcA.state();
    ok(stA.home.partners[0].pins === '1 new pin on your clips', 'Alder sees it when the Duos page is opened next', stA.home.partners[0]);
    const stA2 = await svcA.state();
    ok(!stA2.home.partners[0].pins, 'and once the page was opened, it is seen');

    // Found: Cedar (Max, discoverable) and Dogwood (discoverable) on Birch's team.
    await post('/api/social/duos/discoverable', { on: true }, 'occ_2');
    await post('/api/social/duos/discoverable', { on: true }, 'occ_3');
    await pg.addGame(db, U(3));
    const cedar = await post('/api/social/duos/report', { matchId: MATCH_ID, us: US, them: THEM, agent: 'Omen' }, 'occ_3');
    ok(cedar.data.found.map((f) => `${f.username}:${f.agent}`).join() === 'Birch:Sova', 'a discoverable teammate is found, with the agent they played, never Alder (not discoverable)', cedar.data.found);
    const stB2 = await svcB.state();
    ok(stB2.home.found.map((f) => f.username).join() === 'Cedar' && stB2.home.foundNote.includes('Ask one with Max'), 'and finds the asker in return, mutual', stB2.home.found);

    // A lapsed plan: paused on the next call.
    await pg.setTier(db, U(1), 'free');
    const pausedSheet = await post('/api/social/duos/sheet', { ref: mref, sheet: clean.sheet }, 'occ_2');
    const pausedClip = await post('/api/social/duos/clip/start', { ref: mref, name: 'r9-clip.mkv', round: 9, kind: 'death', marks: {} }, 'occ_2');
    const stB3 = await svcB.state();
    ok(pausedSheet.data.reason === 'paused' && pausedClip.data.reason === 'paused' && stB3.home.partners[0].state === 'paused' && /neither of you has Max/.test(stB3.home.partners[0].stateLine)
      && (await svcB.match(mref)).ok, 'Alder\'s Max gone: nothing new uploads, the page says why, what was shared stays viewable', stB3.home.partners[0]);
    await pg.setTier(db, U(1), 'max');

    // The quota line, the budget.
    ok((await post('/api/social/duos/clip/start', { ref: mref, name: 'r8-clip.mkv', round: 8, kind: 'death', size: SD.DUO.CLIP_MAX_BYTES + 1 }, 'occ_2')).status === 413,
      'a declared size over the cap: refused before anything is held');

    // A block: everything gone both ways, and the files leave the bucket at the sweep.
    const pathsBefore = [...storage.objects.keys()].length;
    await post('/api/social/block', { name: 'Alder', on: true }, 'occ_2');
    ok((await get(`/api/social/duos/match?ref=${mref}`, 'occ_1')).status === 404 && (await get(`/api/social/duos/match?ref=${mref}`, 'occ_2')).status === 404, 'a block: the shared match is gone for both at once');
    const swept = await duoRouter.sweep(50);
    ok(pathsBefore >= 3 && storage.objects.size === 0 && swept.removed === 0, 'the sweep removed every file of it from the bucket (kept in the trash until no upload URL could land one)', [pathsBefore, storage.objects.size, swept]);
    await sql("UPDATE public.social_duo_trash SET not_before = now() - interval '1 second'");
    const swept2 = await duoRouter.sweep(50);
    ok(swept2.removed >= 3 && (await sql('SELECT count(*)::int n FROM public.social_duo_trash')).rows[0].n === 0, 'and once none could, the trash is empty', swept2);
    const stB4 = await svcB.state();
    ok(stB4.home.partners.length === 0 && !svcB.cacheFile(r2B.theirClips[0].ref, 'r2-clip.mkv'), 'Birch\'s PC: no duo, and Alder\'s clip left the cache');

    // Expiry: Alder and Cedar, a match whose 30 days ran out.
    const c2 = await post('/api/social/duos/code', {}, 'occ_1');
    await post('/api/social/duos/accept', { code: c2.data.code }, 'occ_3');
    await pg.addGame(db, U(1)); await pg.addGame(db, U(3));
    await post('/api/social/duos/report', { matchId: MATCH_ID_2, us: US, them: THEM, agent: 'Jett' }, 'occ_1');
    const m3 = (await post('/api/social/duos/report', { matchId: MATCH_ID_2, us: US, them: THEM, agent: 'Omen' }, 'occ_3')).data.matches[0].ref;
    const up = await post('/api/social/duos/clip/start', { ref: m3, name: 'r1-clip.mkv', round: 1, kind: 'death', marks: { death: 1000, anchor: { clip: 1000, round: 20000 } } }, 'occ_3');
    const putRes = await fetch(up.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: FIXTURE });
    const done = await post('/api/social/duos/clip/done', { clip: up.data.clip }, 'occ_3');
    ok(putRes.ok && done.data.ok && storage.objects.size === 1, 'an upload straight to the bucket by its signed URL, confirmed by the server looking it up');
    const wrongType = await fetch(up.data.url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: Buffer.from('x') });
    ok(wrongType.status === 415, 'the bucket itself refuses another type at that URL');
    const dl = await post('/api/social/duos/clip/url', { clip: up.data.clip }, 'occ_1');
    ok(dl.data.ok && /\/object\/sign\/duo-clips\//.test(dl.data.url) && (await fetch(dl.data.url)).ok, 'the partner gets a signed URL that downloads it', dl.data.url && dl.data.url.split('?')[0]);
    ok((await post('/api/social/duos/clip/url', { clip: up.data.clip }, 'occ_4')).status === 404, 'anyone else: not found');
    await sql('UPDATE public.social_duo_matches SET expires_at = now() - interval \'1 second\' WHERE ref = $1', [m3]);
    ok((await post('/api/social/duos/clip/url', { clip: up.data.clip }, 'occ_1')).status === 404 && (await get(`/api/social/duos/match?ref=${m3}`, 'occ_1')).status === 404,
      'expired: no URL and no match, before the sweep runs');
    await duoRouter.sweep(50);
    ok(storage.objects.size === 0, 'and the sweep takes its file out of the bucket');

    // Remove, ended said; flag.
    await post('/api/social/duos/remove', { name: 'Alder' }, 'occ_3');
    const stC = await createDuos({ peekStatus: livePeek, api: apiAs('occ_1'), auth: {}, busy: () => false, store: { get: () => undefined, set() {} }, log: () => {} }).state();
    ok(stC.home.ended.length === 1 && /Cedar ended your duo/.test(stC.home.ended[0].line), 'a removal is said to the other side', stC.home.ended);
    const flagged = await post('/api/social/duos/flag', { name: 'Cedar', reason: 'pins' }, 'occ_1');
    const flaggedStranger = await post('/api/social/duos/flag', { name: 'Dogwood', reason: 'pins' }, 'occ_1');
    ok(flagged.data.ok && flaggedStranger.data.ok && reportRows.length === 1 && /Duo report \(pins\): username Cedar/.test(reportRows[0].text), 'a report: a former partner reaches the inbox, a stranger by name does not, the same answer', reportRows.map((r) => r.text));

    // Invites by name: one answer whoever it is.
    const inv = await Promise.all(['Birch', 'Dogwood', 'Nobody_at_all'].map((n) => post('/api/social/duos/invite', { name: n }, 'occ_3')));
    ok(inv.every((x) => JSON.stringify(x.data) === '{"ok":true,"reason":"sent"}'), 'an invite by name: the same answer for a blocked, a reachable and a missing name', inv.map((x) => x.data));

    // Nothing that names an account, anywhere; URLs only the signed ones, their path refs.
    const leaks = [];
    const forbiddenVals = [U(1), U(2), U(3), U(4), MATCH_ID, MATCH_ID_2, SD.matchHash(MATCH_ID, { ACCOUNT_HASH_SALT: SALT }), stored[0]];
    const pubIds = (await sql('SELECT public_id FROM public.social_profiles')).rows.map((x) => x.public_id);
    forbiddenVals.push(...pubIds);
    const walk = (x, at) => {
      if (Array.isArray(x)) return x.forEach((v) => walk(v, at));
      if (x && typeof x === 'object') return Object.entries(x).forEach(([k, v]) => { if (/^(email|user_?id|userId|puuid|public_id|hash|match_?hash|code_hash|account_?key|path)$/i.test(k)) leaks.push(`${at} key ${k}`); walk(v, `${at}.${k}`); });
      if (typeof x !== 'string') return;
      if (/@example\.test/.test(x) || forbiddenVals.some((v) => x.toLowerCase().includes(String(v).toLowerCase())) || /^[0-9a-f]{64}$/.test(x)) leaks.push(`${at} value ${x.slice(0, 60)}`);
      if (/^https?:/.test(x)) {
        const u = new URL(x);
        const parts = u.pathname.split('/').filter(Boolean);
        const tail = parts.slice(parts.indexOf('duo-clips') + 1);
        if (!/\.url$/.test(at) || tail.length !== 4 || !tail.slice(0, 3).every((p) => /^[0-9a-f]{16}$/.test(p))) leaks.push(`${at} url ${u.pathname}`);
      }
    };
    for (const a of answers) walk(a.json, a.url.split('?')[0]);
    ok(answers.length > 40 && !leaks.length, `no answer of ${answers.length} holds an email, an id, a match id, a hash or a code's hash; the only URLs are signed ones of refs`, leaks.slice(0, 6));
  } finally {
    server.close();
    storage.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left for the OS */ }
  }

  // ── The purge before the undo ──────────────────────────────────────────
  {
    const { purge } = require(path.join(ROOT, 'server', 'scripts', 'duos-purge.js'));
    const st = createStorage({ buckets: { 'duo-clips': { fileSizeLimit: SD.DUO.CLIP_MAX_BYTES, allowedMimeTypes: ['video/x-matroska'] } } });
    const pdb = await pg.makeDb();
    st.put('duo-clips', 'a1a1a1a1a1a1a1a1/b2b2b2b2b2b2b2b2/c3c3c3c3c3c3c3c3/r2-clip.mkv', FIXTURE);
    st.put('duo-clips', 'a1a1a1a1a1a1a1a1/b2b2b2b2b2b2b2b2/d4d4d4d4d4d4d4d4/h3-clip.mkv', FIXTURE);
    st.put('duo-clips', 'e5e5e5e5e5e5e5e5/f6f6f6f6f6f6f6f6/a7a7a7a7a7a7a7a7/r9-clip.mkv', FIXTURE);
    const said = [];
    const dry = await purge({ rpc: pg.supabaseOf(pdb).rpc, storage: st }, { log: (l) => said.push(l) });
    ok(dry.found === 3 && st.objects.size === 3, 'the purge, a dry run: every file the bucket holds found (rows or none), nothing removed', dry);
    const done = await purge({ rpc: pg.supabaseOf(pdb).rpc, storage: st }, { apply: true, log: (l) => said.push(l) });
    ok(done.removed === 3 && st.objects.size === 0 && !said.some((l) => /a1a1|r2-clip/.test(l)), 'with --apply: every one removed, no path printed', said);
    ok(/bucket not found/i.test('Bucket not found'), 'the purge reads the bucket\'s own "Bucket not found"');
  }

  // ── Through Express, with the real limit wiring ────────────────────────
  {
    const wire = express();
    wire.use(rateLimits.collapseSlashes);
    wire.use(express.json());
    wire.use(rateLimits.FLOOR_PATHS, rateLimits.answerFloor());
    wire.use((req, _res, next) => { req.caller = { accountKey: 'u:wire', userId: U(50), via: 'session' }; next(); });
    for (const { paths, mw } of rateLimits.routeLimits({})) wire.use(paths, mw);
    const r = express.Router();
    r.post('/accept', (req, res) => res.json({ ok: false, reason: 'bad-code' }));
    r.post('/invite', (req, res) => res.json({ ok: true, reason: 'sent' }));
    r.post('/clip/start', (req, res) => res.json({ ok: true }));
    wire.use('/api/social/duos', r);
    const { server: s2, base: b2 } = await listen(wire);
    const timed = async (p) => { const t = Date.now(); const res = await fetch(b2 + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await res.text(); return { status: res.status, ms: Date.now() - t }; };
    try {
      const inv = await timed('/api/social/duos/invite');
      const acc = await timed('/api/social/duos//accept');
      ok(inv.ms >= rateLimits.FLOOR_MS - 5 && acc.ms >= rateLimits.FLOOR_MS - 5, 'an invite and an accept answer no sooner than 250 ms, a doubled slash too', [inv, acc]);
      const codes = [];
      for (let i = 0; i < 20; i++) codes.push((await timed(i % 2 ? '/api/social/duos//accept' : '/api/social/duos/accept')).status);
      ok(codes.slice(0, 19).every((x) => x === 200) && codes[19] === 429, 'accept: 20 an hour per account through the real wiring, both spellings one', codes);
      const names = rateLimits.routeLimits({}).map((x) => x.mw.limits.name);
      ok(['social-duos-accept-network', 'social-duos-invite', 'social-duos-report', 'social-duos-clip', 'social-duos-flag', 'social-duos'].every((n) => names.includes(n)), 'every duo limit is mounted');
    } finally {
      s2.close();
    }
  }

  // ── The page, in the fake DOM ──────────────────────────────────────────
  {
    const { loadSurface, settle } = require('./fixtures/fake-dom');
    const CH = require(path.join(ROOT, 'src', 'shared', 'channels.js'));
    const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'duos', 'duos.js'), 'utf8');
    ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page), 'the Duos page sets every string as text');
    const homeOf = (me) => AD.homeModel(me, fx.MATCHES, { now: Date.now() });
    const H = (s, extra = {}) => ({ [CH.DUOS_STATE]: () => s, [CH.DUOS_MATCH]: () => ({ ok: true, match: AD.matchModel(fx.MATCH), names: AD.NAMES_NOTE }), ...extra });
    const up = { on: true, line: 'Shared one match with your duo: 3 clips, 1 MB.' };
    let q = loadSurface('duos', { handlers: H({ duos: true, problem: null, home: homeOf(fx.ME), upload: up }) });
    await settle(); await settle();
    const names = q.document.querySelectorAll('#du-partners .pl-name').map((n) => n.textContent);
    ok(names.join() === 'Harrier,Wren_PC' && !q.$('du-can-invite').hidden && q.$('du-needs-max').hidden && q.$('du-state').hidden
      && q.document.querySelectorAll('#du-matches .pl-result').length === 2 && q.document.querySelectorAll('#du-found .pl-name').map((n) => n.textContent).join() === 'Hartley_7',
    'with Max: the duos, the invite box, the matches and the teammates found', names);
    ok(/Paused/.test(q.document.querySelectorAll('#du-partners .du-state-word')[1].textContent) && q.$('du-upload-line').textContent === up.line, 'a paused duo says why; the upload line is main\'s');
    q = loadSurface('duos', { handlers: H({ duos: true, problem: null, home: homeOf({ ...fx.ME, max: false }), upload: up }) });
    await settle(); await settle();
    ok(q.$('du-can-invite').hidden && !q.$('du-needs-max').hidden && /Max plan on one side/.test(q.$('du-needs-line').textContent)
      && q.document.querySelectorAll('#du-found .du-acts').map((n) => n.textContent).join().includes('Ask them to invite you'), 'without Max: what Duos is, that it needs Max on one side, See plans, and "Ask them to invite you"');
    for (const [p, want, act] of [['signed-out', /Sign in/, 'Sign in'], ['no-username', /username/, 'Open Profile'], ['offline', /could not reach/, 'Try again']]) {
      q = loadSurface('duos', { handlers: H({ duos: p !== 'not-live', problem: p, home: null, upload: up }) });
      await settle(); await settle();
      ok(!q.$('du-state').hidden && want.test(q.$('du-state-line').textContent) && q.$('du-state-act').textContent === act && q.$('du-partners-sec').hidden, `${p}: one line, its action, nothing else`);
    }
    q = loadSurface('duos', { handlers: H({ duos: true, problem: null, home: homeOf(fx.ME), upload: up }) });
    await settle(); await settle();
    q.document.querySelectorAll('#du-matches .pl-result-btn')[0].click();
    await settle(); await settle();
    const rounds = q.document.querySelectorAll('#dm-rounds .du-round');
    ok(!q.$('du-match').hidden && q.$('dm-title').textContent === 'Ascent, 13-9' && rounds.length === 4 && q.document.querySelectorAll('#dm-rounds .du-mark.death').length === 6
      && q.document.querySelectorAll('#dm-rounds .du-mark.kill').length === 10, 'a shared match: both players round by round, every kill and death on its round\'s axis', [q.$('dm-title').textContent, rounds.length]);
    ok(q.document.querySelectorAll('#dm-rounds .du-watch').length === 3 && /names in the kill feed/.test(q.$('dm-names').textContent), 'a round with a clip can be watched; the note on names is said');
    const mm = AD.matchModel(fx.MATCH);
    ok(mm.rounds[1].myClips[0].pins.length === 2 && mm.rounds[1].theirClips[0].pins[0].word === 'Good utility' && mm.rounds[1].them.line === 'Died at 0:39 at A Lobby to Raze, Vandal', 'the model: pins in words, both sides');
  }

  // ── The shell, Discoverable, the site's proof ─────────────────────────────
  {
    const shellHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'shell', 'index.html'), 'utf8');
    ok(/id="nav-duos"[^>]*hidden/.test(shellHtml) && shellHtml.indexOf('nav-duos') > shellHtml.indexOf('nav-players'), 'the Duos row: under Players in the account menu, hidden until the server says Duos is open');
    const { createSocial } = require(path.join(ROOT, 'src', 'main', 'services', 'social-service.js'));
    const standIn = require('./fixtures/social-stand-in');
    const off = await createSocial({ api: standIn.createApi(), auth: () => ({}), busy: () => false, store: { get: () => undefined, set() {} }, signedIn: async () => true }).state();
    ok(!/Duo/.test(off.words.discoverExplain) && /once that opens/.test(off.words.discoverExplain), 'Duos off: the Discoverable switch says no word of Duos', off.words.discoverExplain);
    const onApi = standIn.createApi();
    const realGet = onApi.get;
    onApi.get = async (u) => (u === '/api/social/status' ? { ok: true, status: 200, data: { live: true, riotProof: false, duos: true } } : realGet(u));
    const on = await createSocial({ api: onApi, auth: () => ({}), busy: () => false, store: { get: () => undefined, set() {} }, signedIn: async () => true }).state();
    ok(on.words.discoverExplain === AS.DISCOVER_EXPLAIN && /teammate/.test(on.words.discoverExplain) && /Never an opponent/.test(on.words.discoverExplain) && /public profiles only/.test(on.words.discoverExplain), 'Duos on: it says what a teammate sees');
    const proof = fs.readFileSync(path.join(ROOT, 'scripts', 'export-site-proof.js'), 'utf8');
    ok(/OCCLARA_PROOF_DUOS: process\.env\.OCCLARA_PROOF_DUOS === 'on' \? 'on' : 'off'/.test(proof), 'the site\'s proof boots Duos not live unless asked');
    const offSvc = fx.wrap({ createDuos }, { live: false }).createDuos({ auth: {}, busy: () => false, store: { get: () => undefined, set() {} } });
    ok((await offSvc.state({ only: 'live' })).duos === false && (await offSvc.state()).problem === 'not-live', 'and the stand-in not live: no Duos row, no page');
  }

  // ── No dash in any of its files ───────────────────────────────────────────
  {
    const dash = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    const files = ['server/services/duos.js', 'scripts/test-duosflow.js', 'scripts/test-duosretry.js', 'server/routes/duos.js', 'src/shared/duos.js', 'src/main/services/duos-service.js', 'src/preload/duos-preload.js',
      'src/renderer/duos/index.html', 'src/renderer/duos/duos.js', 'src/renderer/duos/duos.css', 'src/renderer/duos/duo-time.js', 'scripts/test-duos.js', 'scripts/test-duossql.js',
      'scripts/fixtures/storage-stand-in.js', 'scripts/fixtures/duos-stand-in.js', 'scripts/fixtures/pglite-duos.js', 'docs/claude/duos.md', 'server/scripts/duos-purge.js']
      .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
    const bad = files.filter((f) => dash.test(fs.readFileSync(f, 'utf8')));
    ok(files.length >= 15 && !bad.length, 'no em or en dash in any Duos file', bad);
  }

  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
