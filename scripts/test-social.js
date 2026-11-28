'use strict';

/**
 * PUBLIC PROFILES AND PLAYER SEARCH (docs/claude/social.md).
 *
 * Holds, against the REAL SQL (docs/sql/social-001-profiles.sql on PGlite,
 * fixtures/pglite-social.js), the real routes and the real limit wiring:
 *   - the username rules (look alikes folded), the app's copy byte for byte,
 *     and a name that reads as another (KestreI, Kestre1, 0sprey) is taken;
 *   - one key for every name: NFKC then lower case, never Postgres lower();
 *   - the snapshot: impossible numbers refuse the whole of it;
 *   - an account only (session or site sign in): a licence key, linked or
 *     not, is 403 on every route, the proof's too; no credentials is 401;
 *   - the 503 before the SQL runs; usernames, holds, privacy, blocks (the
 *     name as the blocker typed it), search;
 *   - THE RIOT ID PROOF OFF (SOCIAL_RIOT_PROOF not 1): start and check one
 *     fixed answer calling nothing, status riotProof false, a Riot ID search
 *     the empty miss, no profile showing a Riot ID;
 *   - THE PROOF ON, end to end on fixtures of Riot's match list and match
 *     records: three agents (four for an account that rotates the owned
 *     five), unique among the open challenges on a Riot account (two at once
 *     too), each match confirmed in its record (a record without the puuid
 *     fails closed), matches never used twice, the takeover, two challenges
 *     on one Riot account in both check orders (the attacker never passes),
 *     two passes at once (no 500), a changed name, every attempt counted
 *     before Riot is asked (a riot-not-found too, and no call on a refused
 *     repeat), no limit or answer across accounts (the lockout of the review
 *     fails), a try-later check giving its count back;
 *   - the account lookup fresh (5 minutes), a missing name remembered 10
 *     minutes, no budget spent on a cache hit (coach.js socialRiot, on a fake
 *     fetch);
 *   - the rank: a different account behind the name unverifies at once, no
 *     account only on a second failure 6 hours after the first;
 *   - a double slash refused before every limit; the 250 ms floor for real,
 *     /block included;
 *   - no answer holds an email, any uuid, a key, a puuid or a hash;
 *   - the Players page and the Profile panel in the fake DOM, both ways of
 *     the flag; main's half.
 *
 * No network beyond localhost. Run: npm run test:social
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.ACCOUNT_HASH_SALT = 'test-salt-for-social';

const express = require(path.join(ROOT, 'server', 'node_modules', 'express'));
const S = require(path.join(ROOT, 'server', 'services', 'social.js'));
const routes = require(path.join(ROOT, 'server', 'routes', 'social.js'));
const rateLimits = require(path.join(ROOT, 'server', 'services', 'rate-limits.js'));
const freeAllowance = require(path.join(ROOT, 'server', 'services', 'free-allowance.js'));
const C = require(path.join(ROOT, 'src', 'shared', 'social.js'));
const wrapped = require(path.join(ROOT, 'src', 'shared', 'wrapped.js'));
const valorantData = require(path.join(ROOT, 'server', 'valorant-data.generated.json'));
const pg = require('./fixtures/pglite-social');

let fails = 0;
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ''}`); } else console.log(`ok    ${what}`);
};

// Invented players only.
const U = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const A = U(1); const B = U(2); const Cc = U(3); const D = U(4); const E = U(5);
const PUUID_1 = '0f0f0f0f-1111-4222-8333-444455556666';
const PUUID_2 = '1e1e1e1e-1111-4222-8333-444455556666';
const hashOf = (p) => freeAllowance.keyOf('puuid', p);

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
function walk(x, keys = [], vals = []) {
  if (Array.isArray(x)) { for (const v of x) walk(v, keys, vals); return { keys, vals }; }
  if (x && typeof x === 'object') { for (const [k, v] of Object.entries(x)) { keys.push(k); walk(v, keys, vals); } return { keys, vals }; }
  if (typeof x === 'string') vals.push(x);
  return { keys, vals };
}
const FORBIDDEN_KEYS = /^(email|user_?id|userId|puuid|puuid_hash|riot_puuid_hash|key_hash|hash|account_?key|accountKey|public_id|key)$/i;
// Line endings aside: this checkout keeps CRLF in the working tree (core.autocrlf) and git stores LF.
const blockOf = (raw) => { const t = raw.split(String.fromCharCode(13)).join(''); return t.slice(t.indexOf('// ── RULES START'), t.indexOf('\n', t.indexOf('// ── RULES END')) + 1); };

(async () => {
  // ── The username rules ──────────────────────────────────────────────────
  const srvText = fs.readFileSync(path.join(ROOT, 'server', 'services', 'social.js'), 'utf8');
  const appText = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'social.js'), 'utf8');
  ok(blockOf(srvText).length > 3000 && blockOf(srvText) === blockOf(appText), 'the app\'s rules block is the server\'s, byte for byte');
  const pass = ['Kestrel_9', 'classic', 'therapist', 'badminton', 'patriot', 'Montenegro', 'raccoon', 'teammate', 'helpful', 'mustafa',
    'titan', 'analyst', 'cocktail', 'dickens', 'spicy', 'bookkeeper', 'sussex', 'niger', 'Grass_Hopper', 'ab_c', 'x9z', 'Oliver', 'Valerie'];
  const refuse = {
    ab: 'shape', 'has space': 'shape', toolongusername_12345: 'shape', 'dash-name': 'shape', '': 'shape', '12345': 'digits', ___: 'digits',
    Occlara: 'reserved', occlara_fan: 'reserved', '0ccl4ra': 'reserved', OccIara: 'reserved', Occ1ara: 'reserved', VaI0rant: 'reserved',
    RlOT_Games: 'reserved', Rlot: 'reserved', Riot: 'reserved', riotJames: 'reserved', Admln: 'reserved', admin2: 'reserved', Staf: 'reserved',
    staffer: 'reserved', mod: 'reserved', x_mod: 'reserved', Support: 'reserved', GhostCoach: 'reserved',
    Phuck: 'word', Fvck: 'word', fuuuck_it: 'word', sh1t_lord: 'word', ass123: 'word', big_ass: 'word', a55: 'word', nigger: 'word', p0rn_star: 'word', kys: 'word',
  };
  ok(pass.every((n) => S.checkUsername(n).ok), 'ordinary names pass, look alike folding or not', pass.filter((n) => !S.checkUsername(n).ok));
  const wrong = Object.entries(refuse).filter(([n, why]) => S.checkUsername(n).reason !== why);
  ok(!wrong.length, 'each refused name gives its reason, the look alikes included', wrong.map(([n]) => [n, S.checkUsername(n).reason]));
  const corpus = [...pass, ...Object.keys(refuse), 'Zephyr_77', 'wh0re', 'Bit_ch', 'hello', 'Lima_Bean', 'mods', 'devs', 'VVanker', 'Thorn'];
  ok(corpus.every((n) => JSON.stringify(S.checkUsername(n)) === JSON.stringify(C.checkUsername(n))), 'the app and the server answer every name the same');
  ok(S.fold('OccIara') === S.fold('Occlara') && S.fold('Occ1ara') === S.fold('occlara') && S.fold('rn') === 'm' && S.fold('vv') === 'w' && S.fold('ph') === 'f' && S.fold('v') === 'u',
    'the fold: I, l and 1 one letter, 0 an o, rn an m, vv a w, ph an f, v a u');
  ok(S.letter === undefined, 'ONE SCORE, NO LETTERS (9.1): the server makes no grade letter at all');
  ok(JSON.stringify(Object.keys(S.TITLES)) === JSON.stringify(wrapped.TITLES), 'the server knows the titles Wrapped can give');
  ok(S.BASE_AGENTS.every((a) => Object.prototype.hasOwnProperty.call(valorantData.agents, a)), 'the five owned agents are agents the game data names');

  // ── One key ─────────────────────────────────────────────────────────────
  const dotted = String.fromCharCode(0x130);
  ok(S.keyOf(`K${dotted}ra`) === `K${dotted}ra`.normalize('NFKC').toLowerCase() && S.keyOf(String.fromCharCode(0xFF2B) + 'estrel') === 'kestrel',
    'a key is NFKC then lower case in JavaScript (the dotted I, a full width K)');
  ok(C.keyOf === undefined || C.keyOf(`A${dotted}`) === S.keyOf(`A${dotted}`), 'and the app makes the same key');

  // ── The snapshot ────────────────────────────────────────────────────────
  const good = { v: 1, matches: 12, wins: 7, losses: 4, draws: 1, grade: { avg: 74, n: 10, trend: [60, 70, 80] }, kd: 1.234, hs: 22,
    agents: [{ name: 'jett', n: 6 }, { name: 'Sova', n: 4 }], maps: [{ name: 'Ascent', n: 5, w: 3 }], multi: { k2: 9, k3: 2, k4: 1, k5: 0 },
    clutches: 2, recent: [{ r: 'W', agent: 'Jett', map: 'Bind', grade: 81 }, { r: 'L', agent: 'Sova', map: 'Lotus' }], title: 'student',
    rank: { current: 'Gold 2', peak: 'Platinum 1' } };
  let c = S.cleanSnapshot(good);
  ok(c.ok && c.snapshot.agents[0].name === 'Jett' && c.snapshot.kd === 1.23 && c.snapshot.grade.avg === 74 && c.snapshot.title.name === 'The Student'
    && c.snapshot.recent[0].grade === 81 && c.snapshot.recent[1].grade === null && c.snapshot.rank.current === 'Gold 2', 'a real snapshot is kept, its rank tier too', c);
  ok(JSON.stringify(Object.keys(c.snapshot.grade)) === '["avg","n","trend"]' && c.snapshot.recent.every((r) => !('letter' in r)) && !/"letter"/.test(JSON.stringify(c.snapshot)),
    'ONE SCORE, NO LETTERS (9.1): the snapshot carries each grade as its score, and no letter anywhere', JSON.stringify(c.snapshot.grade));
  ok(!/"letter"/.test(JSON.stringify(S.statsOut(c.snapshot))), 'nor does a snapshot read back as stored');
  const found = S.resultView({ username: 'Kestrel', grade: 73.6, agent: 'jett', pc_rank: 'Gold 2' }, { proof: false });
  ok(found && JSON.stringify(found.grade) === '{"avg":74}', 'and a search result shows its average as the score alone', found && JSON.stringify(found.grade));
  const impossible = {
    'wins over matches': { ...good, wins: 13 }, 'the record over matches': { ...good, wins: 6, losses: 6, draws: 1 },
    'agents played more than matches': { ...good, agents: [{ name: 'Jett', n: 9 }, { name: 'Sova', n: 9 }] },
    'maps played more than matches': { ...good, maps: [{ name: 'Bind', n: 13, w: 1 }] }, 'more map wins than map games': { ...good, maps: [{ name: 'Bind', n: 3, w: 4 }] },
    'headshots over 100': { ...good, hs: 150 }, 'a grade of 101': { ...good, grade: { avg: 101, n: 3 } }, 'graded more than played': { ...good, grade: { avg: 90, n: 13 } },
    'a grade over 100000 matches with one game': { v: 1, matches: 1, grade: { avg: 100, n: 100000 } },
    'recent wins over wins': { ...good, wins: 0, recent: [{ r: 'W' }] }, 'more recent than matches': { ...good, matches: 1, wins: 1, losses: 0, draws: 0, agents: [], maps: [], recent: [{ r: 'W' }, { r: 'W' }] },
    'a fraction of a match': { ...good, matches: 1.5 }, 'negative': { ...good, losses: -1 }, 'kd 99': { ...good, kd: 99 },
    'multi kills no match could hold': { ...good, multi: { k2: 100000 } }, 'a string number': { ...good, wins: '7' },
  };
  const slipped = Object.entries(impossible).filter(([, s]) => S.cleanSnapshot(s).ok).map(([k]) => k);
  ok(!slipped.length, 'impossible numbers refuse the whole snapshot', slipped);
  c = S.cleanSnapshot({ ...good, email: 'someone@example.test', puuid: PUUID_1, notes: '<script>x</script>', agents: [{ name: 'Not An Agent', n: 3 }, { name: 'Jett', n: 2 }],
    title: 'The Hacker', rank: { current: 'Grandmaster 1', peak: 'Radiant' } });
  ok(c.ok && !/someone@|script|Not An|Hacker|Grandmaster/.test(JSON.stringify(c.snapshot)) && c.snapshot.rank.current === null && c.snapshot.rank.peak === 'Radiant',
    'free text never survives, unknown agents, titles and tiers are dropped', c.snapshot);
  ok(S.cleanSnapshot({ ...good, pad: 'x'.repeat(9000) }).error === 'too-big', 'over the size cap: refused');
  const rows = [];
  for (let i = 0; i < 14; i++) {
    rows.push({ v: 1, id: `val-17${String(i).padStart(9, '0')}-abcd`, game: 'valorant', at: Date.UTC(2026, 9, 1 + i), result: i % 3 ? 'win' : 'loss',
      grade: { score: 60 + i, provisional: i === 3 }, k: 18, d: 12, map: i % 2 ? 'Ascent' : 'Bind', agent: i < 9 ? 'Jett' : 'Omen', hs: 20,
      multi: { 2: 2, 3: i === 5 ? 1 : 0, 4: 0, 5: 0 }, clutches: i === 2 ? 1 : 0, mistakes: [{ key: 'no-trade' }], killedBy: { Reyna: 2 } });
  }
  const snap = C.snapshotOf(rows, { title: 'student', rank: { current: 'Silver 3', peak: 'Gold 1' } });
  ok(snap && snap.matches === 14 && snap.recent.length === 10 && snap.rank.current === 'Silver 3' && !/no-trade|Reyna|mistake/.test(JSON.stringify(snap)),
    'the app counts its snapshot from Valorant rows, with the Settings Riot ID\'s rank, and no mistake', snap);
  ok(S.cleanSnapshot(snap).ok, 'and the server accepts exactly what the app sends');

  // ── The proof of control: the sequence and the judge ───────────────────
  const T0 = Date.UTC(2026, 10, 25, 12);
  const H = 3600000;
  const seq3 = ['Sage', 'Jett', 'Sova'];
  const ch = { agents: seq3, issuedAt: T0, expiresAt: T0 + 4 * H };
  const m = (min, agent, puuid = PUUID_1) => ({ id: `m${min}`, startedAt: T0 + min * 60000, agent, puuid });
  const J = (list, o = {}) => S.judge(o.c || ch, list, { puuid: PUUID_1, now: T0 + H, ...o });
  let jr = J([m(-30, 'Omen'), m(10, 'Sage'), m(20, 'Jett'), m(30, 'Sova')]);
  ok(jr.result === 'passed' && jr.picks.map((x) => x.id).join() === 'm10,m20,m30', 'judge: the three in order, back to back, after the start: a candidate, its matches named', jr);
  ok(J([m(10, 'Jett'), m(20, 'Sage'), m(30, 'Sova')]).result === 'wrong-agent', 'judge: the wrong order is no pass');
  ok(J([m(10, 'Sage'), m(15, 'Reyna'), m(20, 'Jett'), m(30, 'Sova')]).result === 'in-between', 'judge: a match between is no pass, and is said');
  ok(J([m(-10, 'Sage'), m(20, 'Jett'), m(30, 'Sova')]).result !== 'passed', 'judge: a match before the start does not count');
  jr = J([m(10, 'Sage'), m(20, 'Jett')]);
  ok(jr.result === 'half' && jr.progress === 2 && J([]).result === 'not-yet', 'judge: two of three is progress 2; nothing yet is not yet', jr);
  ok(J([m(10, 'Sage'), m(20, 'Jett'), m(30, 'Sova')], { usedUntil: T0 + 15 * 60000 }).result !== 'passed', 'judge: matches a proof already used never count');
  ok(J([m(10, 'Sage')], { now: T0 + 5 * H }).result === 'expired', 'judge: past four hours, expired');
  ok(J([m(10, 'Sage', PUUID_2), m(20, 'Jett', PUUID_2), m(30, 'Sova', PUUID_2)]).result === 'other-account', 'judge: a list row of another Riot account is other-account');
  ok(J([m(10, 'Sage', null), m(20, 'Jett', null), m(30, 'Sova', null)]).result === 'passed', 'judge: rows with no puuid only make a CANDIDATE: the route confirms each in its record');
  let cand = S.candidatesFor(['Jett', 'Sage', 'Sova', 'Omen', 'Reyna']);
  ok(cand.length === 3 && cand.list.length === 18 && cand.list.every((x) => x.split(',').filter((a) => ['Brimstone', 'Phoenix'].includes(a)).length >= 2),
    'three agents, at least two the account has not played in its last 10', cand.list.length);
  ok(S.candidatesFor(['Omen']).list.length === 60, 'all 60 sequences of three when nothing owned was played');
  cand = S.candidatesFor(['Jett', 'Sage', 'Sova', 'Phoenix', 'Omen', 'Brimstone', 'Jett']);
  ok(cand.length === 4 && cand.list.length === 120 && cand.list.every((x) => new Set(x.split(',')).size === 4), 'an account that rotates the owned five gets FOUR agents (120 sequences)', cand.length);
  ok(S.CHALLENGE.TTL_MS === 4 * H && S.CHALLENGE.PER_RIOT === undefined, 'four hours, and no limit across accounts');

  // ── coach.js socialRiot, on a fake fetch: fresh, a missing name remembered, no budget on a hit ──
  {
    process.env.HENRIKDEV_API_KEY = 'test-key-not-a-real-one';
    const realFetch = global.fetch;
    const asked = [];
    global.fetch = async (url) => {
      const u = String(url);
      asked.push(u.replace('https://api.henrikdev.xyz', ''));
      const body = (status, data) => ({ status, ok: status < 300, text: async () => JSON.stringify(data) });
      if (u.includes('/v2/account/Nobody/ZZZ')) return body(404, { errors: [] });
      if (u.includes('/v2/account/')) return body(200, { data: { region: 'eu', puuid: PUUID_1, name: 'Nightjar', tag: 'EUW' } });
      if (u.includes('/v4/match/eu/')) return body(200, { data: { metadata: { started_at: new Date(T0).toISOString() }, players: [{ puuid: PUUID_1, agent: { name: 'Sage' } }, { puuid: PUUID_2, agent: { name: 'Jett' } }] } });
      return body(500, {});
    };
    try {
      const coach = require(path.join(ROOT, 'server', 'routes', 'coach.js'));
      const R = coach.socialRiot;
      const a1 = await R.account('Nobody', 'ZZZ');
      const a2 = await R.account('Nobody', 'ZZZ');
      ok(a1.status === 'none' && a2.status === 'none' && asked.filter((x) => x.includes('Nobody')).length === 1, 'a name with no account is remembered: asked once, not on the repeat');
      const b1 = await R.account('Nightjar', 'EUW');
      const n = asked.length;
      const b2 = await R.account('nightjar', 'euw');
      ok(b1.status === 'ok' && b1.name === 'Nightjar' && b2.status === 'ok' && asked.length === n, 'an account is remembered (5 minutes at most), and a hit asks nothing');
      const rec = await R.match('eu', '11111111-2222-4333-8444-555555555555');
      ok(rec.status === 'ok' && rec.startedAt === T0 && rec.agentOf(hashOf(PUUID_1)) === 'Sage' && rec.agentOf(hashOf(PUUID_2)) === 'Jett' && rec.agentOf(hashOf('x')) === null,
        'a match record names each player only by the salted hash of their puuid', rec.startedAt);
      const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'coach.js'), 'utf8');
      const block = src.slice(src.indexOf('const socialRiot = {'), src.indexOf('async function socialRank'));
      ok(!/regionOf\(/.test(block) && /SOCIAL_ACCOUNT_MS = 5 \* 60 \* 1000/.test(src) && /SOCIAL_NO_ACCOUNT_MS = 10 \* 60 \* 1000/.test(src),
        'the proof\'s account lookup never uses the day long region cache or a stale entry');
    } finally {
      global.fetch = realFetch;
      delete process.env.HENRIKDEV_API_KEY;
    }
  }

  // ── The routes, on the real SQL ─────────────────────────────────────────
  const db = await pg.makeDb();
  for (let i = 1; i <= 70; i++) await pg.addUser(db, U(i));
  const store = S.createStore(pg.supabaseOf(db));
  const sql = (q, p) => db.query(q, p);
  const rankCalls = [];
  let rankAnswer = { status: 'ok', puuid: PUUID_1, current: 'Gold 2', peak: 'Platinum 1' };
  const reportRows = [];
  // Riot's record, a fixture: accounts by Riot ID, the match list by Riot ID,
  // and each match's record by id (which players, by hash, played which agent).
  const riotAccounts = new Map();
  const riotLists = new Map();
  const riotRecords = new Map();
  const riotCalls = { account: 0, matches: 0, match: 0 };
  const riot = {
    async account(name, tag) { riotCalls.account++; const a = riotAccounts.get(`${name}#${tag}`.toLowerCase()); return a ? { status: 'ok', ...a } : { status: 'none' }; },
    async matches(region, name, tag) { riotCalls.matches++; return { status: 'ok', matches: riotLists.get(`${name}#${tag}`.toLowerCase()) || [] }; },
    async match(region, id) {
      riotCalls.match++;
      const r = riotRecords.get(id);
      return r ? { status: 'ok', startedAt: r.startedAt, agentOf: (h) => r.players.get(h) || null } : { status: 'none' };
    },
  };
  let seqN = 0;
  /** The account behind `riotId` (puuid) plays `agents` from `at` on, a minute apart: its list grows, and each match has its record. */
  const play = (riotId, puuid, agents, at, o = {}) => {
    const list = riotLists.get(riotId) || [];
    agents.forEach((agent, i) => {
      const id = `aaaaaaaa-0000-4000-8000-${String(++seqN).padStart(12, '0')}`;
      const startedAt = at + i * 60000;
      list.push({ id, startedAt, agent, puuid: o.listPuuid === undefined ? null : o.listPuuid });
      const players = new Map(o.recordWithout ? [] : [[hashOf(puuid), o.recordAgent || agent]]);
      riotRecords.set(id, { startedAt, players });
    });
    riotLists.set(riotId, list);
  };
  riotAccounts.set('nightjar#euw', { region: 'eu', puuid: PUUID_1, name: 'Nightjar', tag: 'EUW' });
  riotAccounts.set('wren#na1', { region: 'na', puuid: PUUID_2, name: 'Wren', tag: 'NA1' });
  const sessions = {};
  for (let i = 1; i <= 70; i++) sessions[`occ_${i}`] = U(i);
  const resolver = {
    identify: async (req) => {
      const auth = String(req.headers.authorization || '');
      const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (sessions[tok]) return { status: 'valid', caller: { userId: sessions[tok], accountKey: `u:${sessions[tok]}`, email: `${tok}@example.test`, via: 'session' } };
      if (tok === 'jwt_site') return { status: 'valid', caller: { userId: D, accountKey: `u:${D}`, via: 'jwt' } };
      // A licence key LINKED to an account: it carries the account's user id, and is still a key.
      if (req.headers['x-license-key'] === 'GC-LINKED') return { status: 'valid', caller: { userId: A, accountKey: `u:${A}`, via: 'key' } };
      if (req.headers['x-license-key'] === 'GC-KEY-ONLY') return { status: 'valid', caller: { userId: null, accountKey: 'GC-KEY-ONLY', via: 'key' } };
      if (req.headers['x-license-key'] === 'GC-OUTAGE') return { status: 'unavailable' };
      if (auth || req.headers['x-license-key']) return { status: 'invalid', body: { error: 'invalid' } };
      return { status: 'none' };
    },
  };
  let rnd = 0.42;
  const proofEnv = { ...process.env, SOCIAL_ON: '1', SOCIAL_RIOT_PROOF: '1' };
  const make = (env) => routes.createRouter({
    store, resolver, log: () => {}, riot, rand: () => rnd, env,
    rank: async (name, tag) => { rankCalls.push(`${name}#${tag}`); return rankAnswer; },
    reports: { insert: async (row) => { reportRows.push(row); } },
    uuid: () => '99999999-9999-4999-8999-999999999999',
  });
  const app = express();
  app.use(express.json());
  app.use('/api/social', make(proofEnv));
  app.use('/off', make({ ...process.env, SOCIAL_ON: '1', SOCIAL_RIOT_PROOF: '' }));
  app.use('/odd', make({ ...process.env, SOCIAL_ON: '1', SOCIAL_RIOT_PROOF: 'true' }));
  app.use('/shut', make({ ...process.env, SOCIAL_ON: '', SOCIAL_RIOT_PROOF: '1' }));
  app.use('/shutodd', make({ ...process.env, SOCIAL_ON: 'true', SOCIAL_RIOT_PROOF: '1' }));
  const deadStore = S.createStore(pg.supabaseOf(await pg.makeDb({ sql: false })));
  app.use('/dead', routes.createRouter({ store: deadStore, resolver, log: () => {}, riot, env: proofEnv }));
  const { server, base } = await listen(app);
  const answers = [];
  async function call(method, url, { as, key, body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Occlara-Version': '8.19.0' };
    if (as) headers.Authorization = `Bearer ${as}`;
    if (key) headers['X-License-Key'] = key;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    answers.push({ url, json });
    return { status: res.status, body: json };
  }
  const get = (url, as) => call('GET', url, { as });
  const post = (url, body, as) => call('POST', url, { as, body });
  const name = async (as, n) => post('/api/social/username', { name: n }, as);
  const back = (u) => sql("UPDATE public.social_riot_challenges SET last_check_at = now() - interval '2 minutes' WHERE status = 'open' AND user_id = $1", [u]);
  const challengeOf = async (u) => (await sql("SELECT agents, issued_at FROM public.social_riot_challenges WHERE user_id = $1 AND status = 'open'", [u])).rows[0];

  try {
    // The owner's switch: the tables are there, SOCIAL_ON is not exactly 1.
    {
      const st = await get('/shut/status');
      const st2 = await get('/shutodd/status');
      const me = await get('/shut/me', 'occ_a');
      const se = await get('/shut/search?q=abc', 'occ_a');
      const un = await post('/shut/username', { name: 'Kestrel_9' }, 'occ_a');
      const rs = await post('/shut/riot/start', { riotId: 'Harrier#NA1' }, 'occ_a');
      ok(st.status === 200 && st.body.live === false && st.body.riotProof === false && st2.body.live === false,
        'SOCIAL_ON unset or not exactly 1: status says not live, with the tables in place', [st.body, st2.body]);
      ok([me, se, un, rs].every((r) => r.status === 503 && r.body && r.body.error === 'social-not-live'),
        'and every other route answers 503 social-not-live, writing nothing', [me.status, se.status, un.status, rs.status]);
    }
    // An account only.
    let r = await get('/api/social/me');
    ok(r.status === 401 && r.body.error === 'sign-in-required', 'no credentials: 401 sign-in-required', r);
    for (const k of ['GC-KEY-ONLY', 'GC-LINKED']) {
      const res = [await call('GET', '/api/social/search?q=kes', { key: k }), await call('POST', '/api/social/username', { key: k, body: { name: 'Keyholder' } }),
        await call('POST', '/api/social/riot/start', { key: k, body: { riotId: 'Nightjar#EUW' } }), await call('POST', '/api/social/riot/check', { key: k })];
      ok(res.every((x) => x.status === 403 && x.body.error === 'sign-in-required'), `a licence key (${k === 'GC-LINKED' ? 'linked to an account' : 'alone'}): 403 on every route, the proof's too`, res.map((x) => x.status));
    }
    r = await get('/api/social/me', 'jwt_site');
    ok(r.status === 200, 'the site\'s own sign in is an account');

    // Not live.
    r = await get('/dead/status');
    ok(r.status === 200 && r.body.live === false && r.body.riotProof === false, 'before the SQL: live false, riotProof false', r);
    for (const [mth, u, b] of [['GET', '/dead/me'], ['GET', '/dead/search?q=kes'], ['POST', '/dead/username', { name: 'Kestrel' }], ['POST', '/dead/riot/start', { riotId: 'Nightjar#EUW' }]]) {
      r = await call(mth, u, { as: 'occ_1', body: b });
      ok(r.status === 503 && r.body.error === 'social-not-live', `before the SQL: ${mth} ${u.split('?')[0]} is 503`, r);
    }

    // Usernames, and names that read as another.
    r = await name('occ_1', 'Kestrel');
    ok(r.body.ok, 'a username is set');
    for (const n of ['KestreI', 'Kestre1', 'KESTREL']) {
      const c1 = await get(`/api/social/username?name=${n}`, 'occ_2');
      const c2 = await name('occ_2', n);
      ok(c1.body.reason === 'taken' && c2.body.reason === 'taken', `${n} reads as Kestrel: taken`, [c1.body, c2.body]);
    }
    await name('occ_3', 'Osprey');
    ok((await name('occ_4', '0sprey')).body.reason === 'taken', '0sprey reads as Osprey: taken');
    r = await name('occ_1', 'Harrier');
    ok(r.body.reason === 'too-soon', 'a change within 30 days: too soon');
    await sql("UPDATE public.social_profiles SET username_set_at = now() - interval '31 days' WHERE user_id = $1", [A]);
    r = await name('occ_1', 'Harrier');
    ok(r.body.ok, 'after 30 days it changes');
    ok((await name('occ_2', 'KestreI')).body.reason === 'held', 'and the old name is held, by its fold too');
    for (const [as, n] of [['occ_2', 'Fieldfare'], ['occ_4', 'Oxbow'], ['occ_5', 'Wren_one']]) await name(as, n);
    for (const as of ['occ_1', 'occ_2', 'occ_3', 'occ_4', 'occ_5']) await post('/api/social/flags', { public: true }, as);

    // Snapshot, privacy, blocks.
    r = await post('/api/social/stats', { snapshot: good }, 'occ_1');
    ok(r.body.ok, 'a public profile keeps its snapshot');
    r = await get('/api/social/profile?name=harrier', 'occ_2');
    ok(r.body.profile.riot === null && r.body.profile.rank.source === 'pc', 'unproved: no Riot ID, the PC\'s rank labelled as such');
    await post('/api/social/flags', { public: false }, 'occ_1');
    const priv = await get('/api/social/profile?name=harrier', 'occ_2');
    const none = await get('/api/social/profile?name=nobody_at_all', 'occ_2');
    ok(priv.status === 404 && JSON.stringify(priv.body) === JSON.stringify(none.body), 'private and missing are one answer');
    await post('/api/social/flags', { public: true }, 'occ_1');
    r = await post('/api/social/block', { name: 'oSPREY', on: true }, 'occ_1');
    const b1 = await get('/api/social/profile?name=osprey', 'occ_1');
    const b2 = await get('/api/social/profile?name=harrier', 'occ_3');
    ok(r.body.ok && b1.status === 404 && b2.status === 404, 'a block: neither opens the other');
    r = await get('/api/social/me', 'occ_1');
    ok(JSON.stringify(r.body.profile.blocked) === '["oSPREY"]', 'the list holds the name AS THE BLOCKER TYPED IT, never the target\'s casing', r.body.profile.blocked);
    await post('/api/social/block', { name: 'Osprey', on: false }, 'occ_1');
    ok((await get('/api/social/me', 'occ_1')).body.profile.blocked.length === 0, 'and unblocks by it, in any case');

    // THE PROOF OFF.
    let calls0 = { ...riotCalls };
    r = await get('/off/status');
    const offStart = await post('/off/riot/start', { riotId: 'Nightjar#EUW' }, 'occ_1');
    const offCheck = await post('/off/riot/check', {}, 'occ_1');
    const oddStart = await post('/odd/riot/start', { riotId: 'Nightjar#EUW' }, 'occ_1');
    ok(r.body.live === true && r.body.riotProof === false && offStart.status === 404 && offStart.body.reason === 'not-available'
      && JSON.stringify(offStart.body) === JSON.stringify(offCheck.body) && JSON.stringify(oddStart.body) === JSON.stringify(offStart.body)
      && JSON.stringify(riotCalls) === JSON.stringify(calls0) && (await sql('SELECT count(*)::int n FROM public.social_riot_attempts')).rows[0].n === 0,
      'proof off (unset, or anything but exactly 1): one fixed answer, nothing called, nothing counted', [offStart.body, oddStart.body]);
    ok((await get('/api/social/status')).body.riotProof === true, 'proof on: status says riotProof true');

    // THE PROOF ON: a start.
    play('nightjar#euw', PUUID_1, ['Jett', 'Sage', 'Sova', 'Omen', 'Reyna'], Date.now() - 5 * H);
    calls0 = { ...riotCalls };
    r = await post('/api/social/riot/start', { riotId: 'nightjar#euw' }, 'occ_3');
    let c3 = r.body.challenge;
    ok(r.body.ok && c3 && c3.agents.length === 3 && new Set(c3.agents).size === 3 && c3.agents.filter((a) => ['Brimstone', 'Phoenix'].includes(a)).length >= 2
      && c3.riot.name === 'Nightjar' && Date.parse(c3.expiresAt) - Date.parse(c3.issuedAt) === 4 * H,
      'a start: three different owned agents, two unplayed lately, Riot\'s spelling, four hours', c3);
    ok(riotCalls.match === calls0.match, 'a start reads no match record');
    r = await post('/api/social/riot/start', { riotId: 'Nightjar#EUW' }, 'occ_3');
    ok(r.body.reason === 'open' && r.body.challenge.agents.join() === c3.agents.join(), 'one open challenge an account');
    // Two open challenges on one Riot account never share a sequence.
    r = await post('/api/social/riot/start', { riotId: 'Nightjar#EUW' }, 'occ_5');
    const c5 = r.body.challenge;
    ok(r.body.ok && c5.agents.join() !== c3.agents.join(), 'a second account on the same Riot account gets ANOTHER sequence', [c3.agents, c5.agents]);
    // A rotating account gets four.
    riotAccounts.set('rota#tor', { region: 'eu', puuid: '2d2d2d2d-1111-4222-8333-444455556666', name: 'Rota', tag: 'TOR' });
    play('rota#tor', '2d2d2d2d-1111-4222-8333-444455556666', ['Jett', 'Sage', 'Sova', 'Phoenix', 'Brimstone', 'Jett'], Date.now() - 5 * H);
    r = await post('/api/social/riot/start', { riotId: 'Rota#TOR' }, 'occ_4');
    ok(r.body.ok && r.body.challenge.agents.length === 4, 'an account that rotates the owned agents is asked for four', r.body.challenge && r.body.challenge.agents);

    // Checks.
    const issued3 = Date.parse(c3.issuedAt);
    r = await post('/api/social/riot/check', {}, 'occ_3');
    ok(r.body.result === 'not-yet', 'no match yet: not yet', r.body);
    r = await post('/api/social/riot/check', {}, 'occ_3');
    ok(r.status === 429 && r.body.result === 'too-soon', 'a check within a minute: too soon, Riot not asked');
    // The attacker (account 5) checks first, on the owner's honest play: never a pass.
    play('nightjar#euw', PUUID_1, c3.agents.slice(0, 2), issued3 + 60000);
    await back(Cc);
    r = await post('/api/social/riot/check', {}, 'occ_3');
    ok(r.body.result === 'half' && r.body.challenge.progress === 2, 'two of three played: progress 2, said', r.body);
    play('nightjar#euw', PUUID_1, c3.agents.slice(2), issued3 + 3 * 60000);
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.ok === false, 'the other open challenge on that Riot account cannot pass on the owner\'s play (checked first)', r.body.result);
    await back(Cc);
    r = await post('/api/social/riot/check', {}, 'occ_3');
    ok(r.body.ok && r.body.result === 'passed' && r.body.profile.riot.state === 'verified', 'the owner passes, confirmed in each match record', r.body.result);
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.ok === false, 'and the other still cannot pass after (checked second)', r.body.result);
    const used = (await sql('SELECT last_used_at FROM public.social_riot_used WHERE puuid_hash = $1', [hashOf(PUUID_1)])).rows[0];
    ok(used && new Date(used.last_used_at).getTime() === issued3 + 3 * 60000, 'the matches are spent: the last one\'s start is kept for that Riot account');
    // The same matches for a later challenge, forced to the very sequence: never.
    await sql("UPDATE public.social_riot_challenges SET agents = $1, seq = $2, issued_at = $3 WHERE user_id = $4 AND status = 'open'",
      [c3.agents, c3.agents.join(','), new Date(issued3 - 60000).toISOString(), E]);
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.ok === false, 'the same matches never serve a later proof, even of the same sequence', r.body.result);

    // Fail closed: a record without the puuid; a list row of another puuid; a changed name.
    await sql("UPDATE public.social_riot_challenges SET status = 'expired' WHERE user_id = $1", [E]);
    await sql("UPDATE public.social_riot_attempts SET at = now() - interval '2 days' WHERE user_id = $1", [E]);
    riotAccounts.set('kite#kt1', { region: 'eu', puuid: '3c3c3c3c-1111-4222-8333-444455556666', name: 'Kite', tag: 'KT1' });
    r = await post('/api/social/riot/start', { riotId: 'Kite#KT1' }, 'occ_5');
    const ck = r.body.challenge;
    play('kite#kt1', '3c3c3c3c-1111-4222-8333-444455556666', ck.agents, Date.parse(ck.issuedAt) + 60000, { recordWithout: true });
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.ok === false && r.body.result === 'other-account', 'the list suggests a pass but the records hold no such player: fails closed', r.body.result);
    riotLists.set('kite#kt1', []);
    play('kite#kt1', '3c3c3c3c-1111-4222-8333-444455556666', ck.agents, Date.parse(ck.issuedAt) + 30 * 60000, { recordAgent: 'Omen' });
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.ok === false, 'the record says another agent than the list: no pass', r.body.result);
    riotLists.set('kite#kt1', []);
    play('kite#kt1', '3c3c3c3c-1111-4222-8333-444455556666', ck.agents, Date.parse(ck.issuedAt) + 60 * 60000, { listPuuid: PUUID_2 });
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.result === 'other-account', 'a list row naming another puuid: other-account', r.body.result);
    riotAccounts.set('kite#kt1', { region: 'eu', puuid: PUUID_2, name: 'Kite', tag: 'KT1' });
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    ok(r.body.result === 'other-account', 'the name now leads to another Riot account: other-account', r.body.result);
    // A check Riot could not answer gives its count back.
    const before = (await sql('SELECT checks FROM public.social_riot_challenges WHERE user_id = $1 AND status = \'open\'', [E])).rows[0].checks;
    riotAccounts.set('kite#kt1', undefined);
    const realAccount = riot.account;
    riot.account = async () => ({ status: 'transient' });
    await back(E);
    r = await post('/api/social/riot/check', {}, 'occ_5');
    riot.account = realAccount;
    const after = (await sql('SELECT checks FROM public.social_riot_challenges WHERE user_id = $1 AND status = \'open\'', [E])).rows[0].checks;
    ok(r.status === 503 && r.body.result === 'try-later' && after === before, 'a try-later check uses none of the 30', [before, after]);

    // Every attempt counted, before Riot is asked; no answer across accounts.
    calls0 = { ...riotCalls };
    const na = [];
    for (let k = 0; k < 4; k++) na.push(await post('/api/social/riot/start', { riotId: `Nobody${k}#ZZZ` }, 'occ_2'));
    const spent = (await sql('SELECT count(*)::int n FROM public.social_riot_attempts WHERE user_id = $1', [B])).rows[0].n;
    ok(na[0].body.reason === 'riot-not-found' && na[1].body.reason === 'riot-not-found' && na[2].body.reason === 'day' && na[3].body.reason === 'day'
      && spent === 2 && riotCalls.account - calls0.account === 2, 'a riot-not-found start spends an attempt; the refused repeats ask Riot nothing', [na.map((x) => x.body.reason), spent, riotCalls.account - calls0.account]);
    // The review's lockout: three free accounts starting against a Riot account lock nobody out and tell nobody anything.
    for (const i of [20, 21, 22, 23]) await name(`occ_${i}`, `Griefer_${i}`);
    const griefers = [];
    for (const i of [20, 21, 22]) griefers.push((await post('/api/social/riot/start', { riotId: 'Wren#NA1' }, `occ_${i}`)).body.ok);
    play('wren#na1', PUUID_2, ['Omen'], Date.now() - H);
    r = await post('/api/social/riot/start', { riotId: 'Wren#NA1' }, 'occ_23');
    ok(griefers.every(Boolean) && r.body.ok && !['riot'].includes(r.body.reason), 'three griefers on one Riot account: its owner still starts, and nothing says anyone else tried', r.body);

    // Uniqueness under two concurrent starts, and two passes at once.
    const pair = await Promise.all([30, 31].map(async (i) => {
      await name(`occ_${i}`, `Twin_start_${i}`);
      return post('/api/social/riot/start', { riotId: 'Wren#NA1' }, `occ_${i}`);
    }));
    ok(pair.every((x) => x.body.ok) && pair[0].body.challenge.agents.join() !== pair[1].body.challenge.agents.join(), 'two starts at once on one Riot account: two different sequences');
    const p30 = await challengeOf(U(30));
    const p31 = await challengeOf(U(31));
    play('wren#na1', PUUID_2, p30.agents, Date.parse(p30.issued_at) + 60000);
    play('wren#na1', PUUID_2, p31.agents, Date.parse(p31.issued_at) + 10 * 60000);
    await back(U(30)); await back(U(31));
    const both = await Promise.all([post('/api/social/riot/check', {}, 'occ_30'), post('/api/social/riot/check', {}, 'occ_31')]);
    ok(both.every((x) => x.status !== 500), 'two passes at once on one Riot account: no 500', both.map((x) => [x.status, x.body.result]));
    const holders = (await sql('SELECT count(*)::int n FROM public.social_profiles WHERE riot_verified AND riot_puuid_hash = $1', [hashOf(PUUID_2)])).rows[0].n;
    ok(holders === 1, 'and one profile holds the Riot account after');

    // The takeover; search; the flag hides it again.
    r = await get('/api/social/search?q=nightjar%23euw', 'occ_1');
    ok(r.body.results.length === 1 && r.body.results[0].username === 'Osprey', 'found by the whole Riot ID once proved');
    const offSearch = await get('/off/search?q=nightjar%23euw', 'occ_1');
    const offProfile = await get('/off/profile?name=osprey', 'occ_1');
    const offMe = await get('/off/me', 'occ_3');
    ok(JSON.stringify(offSearch.body) === '{"results":[]}' && offProfile.body.profile.riot === null && offProfile.body.profile.verified === false
      && offMe.body.profile.riot === null && offMe.body.profile.challenge === null, 'proof off: no Riot ID searchable, shown or answered at all', [offSearch.body, offProfile.body.profile.riot]);

    // The rank: a different account at once; a vanished name only on a second failure 6 hours on.
    rankCalls.length = 0;
    await get('/api/social/profile?name=osprey', 'occ_1');
    await new Promise((res) => setTimeout(res, 50));
    r = await get('/api/social/profile?name=osprey', 'occ_1');
    ok(r.body.profile.rank && r.body.profile.rank.source === 'verified', 'a proved profile shows the server\'s rank, labelled verified');
    await sql("UPDATE public.social_profiles SET rank_at = now() - interval '7 hours' WHERE user_id = $1", [Cc]);
    rankAnswer = { status: 'none' };
    await get('/api/social/profile?name=osprey', 'occ_1');
    await new Promise((res) => setTimeout(res, 50));
    ok((await sql('SELECT riot_verified, riot_gone_at FROM public.social_profiles WHERE user_id = $1', [Cc])).rows[0].riot_verified === true, 'one failed lookup is transient: still verified');
    await sql("UPDATE public.social_profiles SET rank_at = now() - interval '7 hours', riot_gone_at = now() - interval '7 hours' WHERE user_id = $1", [Cc]);
    await get('/api/social/profile?name=osprey', 'occ_1');
    await new Promise((res) => setTimeout(res, 50));
    const meC = await get('/api/social/me', 'occ_3');
    ok(meC.body.profile.riot.state === 'lost' && meC.body.profile.riot.lost === 'gone', 'a second failure 6 hours after the first: unverified, its owner told', meC.body.profile.riot);

    // Nothing that names an account, anywhere.
    const leaks = [];
    const ids = [A, B, Cc, D, E, PUUID_1, PUUID_2].map((x) => x.toLowerCase());
    for (const a of answers) {
      const { keys, vals } = walk(a.json);
      for (const k of keys) if (FORBIDDEN_KEYS.test(k)) leaks.push(`${a.url} key ${k}`);
      for (const v of vals) if (/@example\.test/.test(v) || ids.some((id) => v.toLowerCase().includes(id)) || /^[0-9a-f]{64}$/.test(v)
        || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v) || /^GC-/.test(v)) leaks.push(`${a.url} value ${v}`);
    }
    ok(answers.length > 80 && !leaks.length, `no answer of ${answers.length} holds an email, any uuid, a key, a puuid or a hash`, leaks.slice(0, 5));
  } finally {
    server.close();
  }

  // ── Through Express, with the real limit wiring ────────────────────────
  {
    const wire = express();
    wire.use(rateLimits.collapseSlashes);
    wire.use(express.json());
    wire.use(rateLimits.FLOOR_PATHS, rateLimits.answerFloor());
    wire.use((req, _res, next) => { req.caller = { accountKey: 'u:wire', userId: U(50), via: 'session' }; next(); });
    for (const { paths, mw } of rateLimits.routeLimits({})) wire.use(paths, mw);
    const searched = [];
    const r2 = express.Router();
    r2.get('/search', (req, res) => { searched.push(req.originalUrl); res.json({ results: [] }); });
    r2.get('/profile', (req, res) => { if (req.query.name === 'boom') throw new Error('boom'); res.status(404).json({ error: 'not-found' }); });
    r2.get('/username', (req, res) => res.json({ ok: true, reason: 'free' }));
    r2.post('/block', (req, res) => res.json({ ok: true }));
    r2.post('/riot/start', (req, res) => res.json({ ok: true }));
    wire.use('/api/social', r2);
    const coachR = express.Router();
    coachR.post('/read', (req, res) => res.json({ read: true }));
    wire.use('/api/coach', coachR);
    wire.use((err, req, res, _next) => res.status(500).json({ error: 'failed' }));
    const { server: s2, base: b2 } = await listen(wire);
    const timed = async (method, p) => { const t = Date.now(); const res = await fetch(b2 + p, { method, headers: { 'Content-Type': 'application/json' } }); await res.text(); return { status: res.status, ms: Date.now() - t }; };
    try {
      // A doubled slash is the same path: it reaches the same route, under
      // the same limit, with its query string untouched (never a way round).
      const d1 = await timed('GET', '/api/social//search?q=a//b');
      const d2 = await timed('POST', '/api/coach//read');
      const d3 = await timed('GET', '//api///social//search?q=abc');
      ok(d1.status === 200 && d2.status === 200 && d3.status === 200 && searched.length === 2
        && searched[0] === '/api/social/search?q=a//b' && searched[1] === '/api/social/search?q=abc',
      'a doubled slash is collapsed to the one path, the query left alone', [d1, d2, d3, searched]);
      const codes = [];
      for (let i = 0; i < 19; i++) codes.push((await timed('GET', i % 2 ? '/api/social//search?q=abc' : '/api/social/search?q=abc')).status);
      ok(codes.slice(0, 18).every((x) => x === 200) && codes[18] === 429, 'the search limit counts both spellings as one: 20 a minute through the real wiring', codes);
      const floors = {
        found: await timed('GET', '/api/social/username?name=abc'),
        missing: await timed('GET', '/api/social/profile?name=nobody'),
        failed: await timed('GET', '/api/social/profile?name=boom'),
        limited: await timed('GET', '/api/social/search?q=abc'),
        block: await timed('POST', '/api/social/block'),
      };
      ok(Object.values(floors).every((x) => x.ms >= rateLimits.FLOOR_MS - 5) && floors.limited.status === 429, 'found, missing, failed, rate limited and a block each answer no sooner than 250 ms', floors);
      const starts = [];
      for (let i = 0; i < 11; i++) starts.push((await timed('POST', '/api/social/riot/start')).status);
      ok(starts[9] === 200 && starts[10] === 429, 'riot start: 10 an hour per account through the wiring', starts);
      const lim = rateLimits.routeLimits({}).map((x) => x.mw.limits.name);
      ok(lim.includes('social-riot-start-network') && lim.includes('social-riot-check-network'), 'and per address limits on start and check');
    } finally {
      s2.close();
    }
  }

  // ── The pages, in the fake DOM ─────────────────────────────────────────
  {
    const { loadSurface, settle } = require('./fixtures/fake-dom');
    const CH = require(path.join(ROOT, 'src', 'shared', 'channels.js'));
    const fx = require('./fixtures/social-stand-in');
    const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'players', 'players.js'), 'utf8');
    ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page), 'the Players page sets every string as text');
    const handlers = (proof) => ({
      [CH.SOCIAL_STATE]: () => ({ live: true, riotProof: proof, signedIn: true, problem: null }),
      [CH.SOCIAL_SEARCH]: () => ({ ok: true, results: fx.RESULTS.map(C.resultModel) }),
      [CH.SOCIAL_VIEW]: (n) => (n === 'Wren_PC' ? { ok: true, profile: C.profileModel(fx.PROFILES.wren_pc) } : { ok: true, profile: C.profileModel(fx.PROFILES.harrier) }),
      [CH.SOCIAL_TAKE]: () => null,
    });
    let q = loadSurface('players', { handlers: handlers(false) });
    await settle(); await settle();
    ok(!/Riot/.test(q.$('pl-hint').textContent) && q.$('pl-q').placeholder === 'Username', 'proof off: the Players page speaks of usernames only', q.$('pl-hint').textContent);
    q = loadSurface('players', { handlers: handlers(true) });
    await settle(); await settle();
    ok(/Riot ID/.test(q.$('pl-hint').textContent), 'proof on: and of a whole Riot ID');
    q = loadSurface('players', { handlers: { ...handlers(true), [CH.SOCIAL_TAKE]: () => 'Wren_PC' } });
    await settle(); await settle(); await settle();
    ok(q.$('pv-rank-src').textContent === "From this player's PC", 'an unproved profile\'s rank is labelled as from its PC');
    // The Profile section, both ways.
    const prof = (proof) => ({
      [CH.PROFILE_GET]: () => ({ signedIn: true, hero: { state: 'games', number: '3', unit: 'games left', plan: 'Free' }, buy: { picks: [] }, play: {}, plans: { items: [] },
        gifts: { offers: { monthly: [], yearly: [] }, redeem: {}, bought: [] } }),
      [CH.SOCIAL_STATE]: () => ({ live: true, riotProof: proof, signedIn: true, problem: null, profile: { ...fx.ME, riot: proof ? fx.ME.riot : null, challenge: proof ? fx.CHALLENGE : null },
        words: { riotProof: proof, riotLine: proof ? C.riotLine(fx.ME.riot) : null, publicExplain: proof ? C.PUBLIC_EXPLAIN : C.PUBLIC_EXPLAIN_NAME, publicMore: C.PUBLIC_MORE,
          challenge: proof ? { ...C.challengeSteps(fx.CHALLENGE), art: [] } : null }, preview: null }),
    });
    q = loadSurface('profile', { handlers: prof(false) });
    await settle(); await settle(); await settle();
    const textOff = [q.$('pr-public-hint').textContent].join(' ');
    ok(q.$('pr-riot-block').hidden && q.$('pr-riot-opt').hidden && !/Riot/.test(textOff), 'proof off: the Profile section has no Riot ID step, no switch, no word of it', textOff);
    q = loadSurface('profile', { handlers: prof(true) });
    await settle(); await settle(); await settle();
    ok(!q.$('pr-riot-block').hidden && !q.$('pr-riot-opt').hidden && Array.from(q.$('pr-agents').querySelectorAll('li')).length === 3, 'proof on: the panel with its three agents');
  }

  // ── Main's half ────────────────────────────────────────────────────────
  {
    const { createSocial } = require(path.join(ROOT, 'src', 'main', 'services', 'social-service.js'));
    const fx = require('./fixtures/social-stand-in');
    let busy = true;
    const api = fx.createApi();
    const yearRows = [{ v: 1, id: 'val-1700000000000-aaaa', game: 'valorant', at: Date.UTC(2026, 10, 1), result: 'win', grade: { score: 77 }, k: 20, d: 10, agent: 'Jett', map: 'Bind', multi: { 2: 1 } }];
    const kept = {};
    const svc = createSocial({ api, auth: () => ({}), busy: () => busy, rows: () => yearRows, rank: () => ({ current: 'Gold 2', peak: 'Gold 3' }),
      store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } }, signedIn: async () => true });
    ok(await svc.state() === null && await svc.riotStart('A#BB') === null && await svc.riotCheck() === null, 'mid match every call answers null, the proof\'s too');
    busy = false;
    const st = await svc.state();
    ok(st.riotProof === true && st.words.riotProof === true, 'the server says the proof is on: main passes it on');
    const off = createSocial({ api: fx.createApi({ riotProof: false }), auth: () => ({}), busy: () => false, rows: () => yearRows, store: { get: () => undefined, set() {} }, signedIn: async () => true });
    const so = await off.state();
    ok(so.riotProof === false && so.words.riotLine === null && !/Riot/.test(so.words.publicExplain), 'off: no Riot ID line and no Riot ID in the words');
    ok((await off.state({ only: 'live' })).riotProof === false, 'and the Players page hears it off');
  }

  // ── The SQL's own text ─────────────────────────────────────────────────
  {
    const sqlText = fs.readFileSync(pg.SQL_FILE, 'utf8');
    const fns = [...sqlText.matchAll(/CREATE OR REPLACE FUNCTION public\.(social_[a-z_]+)\(/g)].map((x) => x[1]);
    const called = [...srvText.matchAll(/call\('(social_[a-z_]+)'/g)].map((x) => x[1]);
    ok(called.length >= 20 && called.every((f) => fns.includes(f)), 'every function the store calls is in the SQL', called.filter((f) => !fns.includes(f)));
    ok(!/\blower\(/.test(sqlText.replace(/--[^\n]*/g, '')), 'the SQL never matches by Postgres lower()');
    const dash = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    const files = [pg.SQL_FILE, pg.UNDO_FILE, path.join(ROOT, 'server', 'services', 'social.js'), path.join(ROOT, 'server', 'routes', 'social.js'),
      path.join(ROOT, 'src', 'shared', 'social.js'), __filename, path.join(__dirname, 'test-socialsql.js'), path.join(__dirname, 'fixtures', 'pglite-social.js')];
    ok(files.every((f) => !dash.test(fs.readFileSync(f, 'utf8'))), 'no em or en dash in any of its files');
  }

  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
