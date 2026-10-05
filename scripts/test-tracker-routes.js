'use strict';

/**
 * What the tracker routes hand the review, and when they say "ask again".
 *
 * /last-match answered with the newest match of ANY mode. A warm up deathmatch
 * has no team rounds, so it came back as a 0-0 draw with 0 combat score, and on
 * the same map and agent it was linked as the coached match: the review was
 * repainted "Draw 0-0", Impact was graded on ACS 0 and the real match was never
 * linked. Rows that are not round based are now dropped before the newest is
 * picked, from `recent` too.
 *
 * /match-rounds looked up the account's region on every call, on the one
 * HenrikDev key every player shares, and answered a rate limit with HTTP 200
 * and an error, which reads exactly like "no record": the review kept the
 * screen's unverified rounds for good. The region is now cached per Riot ID,
 * and a failure that will pass is a 503 with retry.
 *
 * HenrikDev is a stubbed fetch here, scripted per path. Nothing leaves the
 * machine.
 *
 * Run: npm run test:trackerroutes
 */

const path = require('path');
const Module = require('module');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
process.env.HENRIKDEV_API_KEY = 'test-henrik-key';

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── Licences: one active key, so every route gets past the licence check ───
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

// ── HenrikDev, scripted ─────────────────────────────────────────────────────
// Each handler answers { status, json } or throws. Every call is recorded.
const henrik = { account: null, stored: null, match: null };
const calls = [];
const signals = [];
// The deadline each request was given: henrikGet asks AbortSignal.timeout for
// it immediately before its fetch, so the last value asked for is that call's.
const deadlines = [];
let lastDeadline = null;
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => { lastDeadline = ms; return realTimeout(ms); };
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.henrikdev.xyz')) throw new Error(`unexpected network call to ${u}`);
  calls.push(u);
  signals.push(init.signal);
  deadlines.push({ url: u, ms: lastDeadline });
  const route = u.includes('/v2/account/') ? 'account' : u.includes('/stored-matches/') ? 'stored'
    : u.includes('/v4/match/') ? 'match' : 'other';
  const handler = henrik[route];
  if (!handler) throw new Error(`no scripted answer for ${route}`);
  const out = await handler(u);
  return {
    status: out.status, ok: out.status >= 200 && out.status < 300,
    text: async () => JSON.stringify(out.json === undefined ? {} : out.json),
  };
};
const count = (route) => calls.filter((u) => (route === 'account' ? u.includes('/v2/account/')
  : route === 'stored' ? u.includes('/stored-matches/') : u.includes('/v4/match/'))).length;

const coach = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));
const { roundBased, regionCache } = coach.__test;

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
const H = { 'X-License-Key': KEY };
const ME = encodeURIComponent('Me#EUW');

// ── Stored match rows, shaped as HenrikDev's v1 stored-matches returns them ──
const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
const row = (id, mode, red, blue, min, over = {}) => ({
  meta: { id, mode, map: { name: 'Abyss' }, started_at: ago(min) },
  stats: { team: 'Red', kills: 20, deaths: 15, assists: 4, score: 6000, character: { name: 'Jett' },
    damage: { made: 3500 }, shots: { head: 30, body: 60, leg: 10 } },
  teams: { red, blue },
  ...over,
});

// ── A minimal v4 match payload riot-rounds.js can parse ─────────────────────
const V4 = {
  metadata: { map: { name: 'Abyss' }, queue: { id: 'competitive' } },
  players: [
    { name: 'Me', tag: 'EUW', team_id: 'Red', agent: { name: 'Jett' }, stats: { kills: 1, deaths: 1, assists: 0, score: 300 } },
    { name: 'Foe', tag: 'NA1', team_id: 'Blue', agent: { name: 'Omen' }, stats: { kills: 1, deaths: 1, assists: 0, score: 280 } },
  ],
  rounds: [{ winning_team: 'Red' }, { winning_team: 'Blue' }],
  kills: [
    { round: 0, time_in_round_in_ms: 30000, killer: { name: 'Me', tag: 'EUW' }, victim: { name: 'Foe', tag: 'NA1' }, weapon: { name: 'Vandal' } },
    { round: 1, time_in_round_in_ms: 20000, killer: { name: 'Foe', tag: 'NA1' }, victim: { name: 'Me', tag: 'EUW' }, weapon: { name: 'Phantom' } },
  ],
  teams: [{ team_id: 'Red', rounds: { won: 1 } }, { team_id: 'Blue', rounds: { won: 1 } }],
};

(async () => {
  // ── roundBased, the rule itself ──────────────────────────────────────────
  for (const mode of ['Deathmatch', 'Team Deathmatch', 'Escalation', 'Snowball Fight', 'hurm', 'ggteam']) {
    ok(!roundBased(row('x', mode, 13, 11, 5)), `"${mode}" is not round based, whatever its team scores`);
  }
  // Replication is one agent per team but played in rounds, first to five,
  // with a spike: a real match the old any-mode code linked and this must too.
  for (const mode of ['Competitive', 'Unrated', 'Swiftplay', 'Premier', 'Spike Rush', 'Custom Game', 'New Map',
    'Replication', 'onefa']) {
    ok(roundBased(row('x', mode, 5, 3, 5)), `"${mode}" is round based`);
  }
  ok(!roundBased(row('x', 'Competitive', 0, 0, 5)), 'a match with no rounds played is not, whatever its name (a remake)');
  ok(!roundBased(row('x', 'Mystery Mode', null, null, 5)), 'and neither is an unknown mode with no team scores');
  ok(roundBased(row('x', undefined, 5, 3, 5)), 'a row with no mode but real rounds is kept');

  // ── /last-match drops the warm up deathmatch ─────────────────────────────
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.stored = async () => ({ status: 200, json: { data: [
    row('dm', 'Deathmatch', null, null, 2),                    // the newest: a deathmatch after the match
    row('tdm', 'Team Deathmatch', 100, 87, 6),
    row('comp', 'Competitive', 13, 11, 40),
    row('swift', 'Swiftplay', 5, 3, 70),
  ] } });
  {
    const r = await call(coach, 'GET', `/last-match?username=${ME}`, { headers: H });
    ok(r.status === 200 && r.body.matchId === 'comp', `the newest ROUND BASED match is the one handed back (${r.body.matchId})`);
    ok(r.body.result === 'Victory' && r.body.score === '13-11' && r.body.acs > 0,
      `with a real result and combat score, not Draw 0-0 at ACS 0 (${r.body.result} ${r.body.score}, ACS ${r.body.acs})`);
    ok(r.body.mode === 'Competitive', 'and its mode, so the client can see it');
    const ids = (r.body.recent || []).map((m) => m.matchId);
    ok(ids.length === 1 && ids[0] === 'swift', `recent holds only round based matches too (${ids.join(', ')})`);
    ok(calls.some((u) => u.includes('/stored-matches/') && /[?&]size=10\b/.test(u)),
      'ten rows are asked for, so a real match behind a few deathmatches is still found');
  }
  henrik.stored = async () => ({ status: 200, json: { data: [row('dm1', 'Deathmatch', null, null, 2), row('dm2', 'Deathmatch', 0, 0, 12)] } });
  {
    const r = await call(coach, 'GET', `/last-match?username=${ME}`, { headers: H });
    ok(r.body.error && !r.body.matchId, 'only deathmatches means no match, never a deathmatch passed off as one');
  }

  // ── the region is looked up once ─────────────────────────────────────────
  regionCache.clear();
  calls.length = 0;
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const r1 = await call(coach, 'GET', `/match-rounds?matchId=m1&username=${ME}`, { headers: H });
    const r2 = await call(coach, 'GET', `/match-rounds?matchId=m2&username=${ME}`, { headers: H });
    ok(r1.status === 200 && Array.isArray(r1.body.perRound) && r1.body.perRound.length === 2,
      `Riot's record comes back, round by round (${r1.status})`);
    ok(r2.status === 200 && count('account') === 1,
      `two matches, one account lookup: the region is remembered (${count('account')} lookups)`);
  }
  {
    calls.length = 0;
    const r = await call(coach, 'GET', `/match-rounds?matchId=m1&username=${ME}`, { headers: H });
    ok(r.status === 200 && calls.length === 0, 'a match already fetched makes no upstream call at all');
  }
  {
    calls.length = 0;
    await call(coach, 'GET', `/last-match?username=${ME}`, { headers: H });
    ok(count('account') === 0, 'and the other tracker routes use the same remembered region');
  }

  // ── a failure that will pass is a 503 with retry ─────────────────────────
  regionCache.clear();
  henrik.account = async () => ({ status: 429, json: { errors: [{ message: 'Rate Limited' }] } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `a rate limited account lookup is 503 with retry, not 200 (${r.status})`);
  }
  henrik.account = async () => { throw new Error('The operation was aborted due to timeout'); };
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `an account lookup that never answered is 503 too (${r.status})`);
  }
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.match = async () => ({ status: 429, json: {} });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `a rate limited match lookup is 503 with retry (${r.status})`);
  }
  henrik.match = async () => ({ status: 502, json: {} });
  ok((await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H })).status === 503,
    'a tracker 5xx is 503');
  henrik.match = async () => ({ status: 404, json: {} });
  ok((await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H })).status === 503,
    "a 404 for a match the tracker itself listed is the record not being ready yet, so 503");
  henrik.match = async () => { throw new Error('The operation was aborted due to timeout'); };
  ok((await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H })).status === 503,
    'a match lookup that timed out is 503');
  henrik.match = async () => ({ status: 400, json: { errors: [{ message: 'Bad request' }] } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H });
    ok(r.status === 200 && r.body.error && !r.body.retry, `a refusal a retry cannot change is a plain 200 error (${r.status})`);
  }
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m3&username=${ME}`, { headers: H });
    ok(r.status === 200 && r.body.perRound, 'and the same match links once the tracker answers');
  }

  // ── what will not change on a retry stays a 200 ──────────────────────────
  regionCache.clear();
  henrik.account = async () => ({ status: 404, json: { errors: [{ message: 'Not found' }] } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m4&username=${encodeURIComponent('Nobody#000')}`, { headers: H });
    ok(r.status === 200 && r.body.error && !r.body.retry, `an unknown Riot ID is a plain 200 error, no retry (${r.status})`);
  }
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m5&username=${encodeURIComponent('Stranger#XYZ')}`, { headers: H });
    ok(r.status === 200 && /not in this match/.test(r.body.error || ''), 'a Riot ID that is not in the match is a 200 error too');
  }

  // ── an old region outlives a failed refresh ──────────────────────────────
  regionCache.clear();
  regionCache.set('me#euw', { region: 'eu', at: Date.now() - 25 * 60 * 60 * 1000 });
  henrik.account = async () => ({ status: 429, json: {} });
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m6&username=${ME}`, { headers: H });
    ok(r.status === 200 && r.body.perRound, 'a day old region is still used when the fresh lookup is rate limited');
  }

  // ── Riot's record gets the longer deadline ───────────────────────────────
  regionCache.clear();
  deadlines.length = 0;
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  await call(coach, 'GET', `/match-rounds?matchId=m7&username=${ME}`, { headers: H });
  {
    const acct = deadlines.find((d) => d.url.includes('/v2/account/'));
    const detail = deadlines.find((d) => d.url.includes('/v4/match/'));
    ok(acct && acct.ms === 8000 && detail && detail.ms === 20000,
      `the account lookup gets 8s and the match record 20s, inside the client's 30 (${acct && acct.ms}, ${detail && detail.ms})`);
  }

  // ── /matches: one queue timing out is one failed queue, not a failed tab ─
  henrik.match = async () => ({ status: 404, json: {} });
  henrik.stored = async (u) => ({ status: 200, json: { data: /mode=swiftplay/.test(u)
    ? [row('s1', 'Swiftplay', 5, 3, 30)] : [row('u1', 'Unrated', 13, 9, 60)] } });
  {
    const r = await call(coach, 'GET', `/matches?mode=unrated&username=${ME}`, { headers: H });
    ok(r.status === 200 && (r.body.matches || []).length === 2, `both queues are listed (${JSON.stringify(r.body).slice(0, 80)})`);
  }
  henrik.stored = async (u) => {
    if (/mode=swiftplay/.test(u)) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return { status: 200, json: { data: [row('u2', 'Unrated', 13, 7, 10), row('u1', 'Unrated', 13, 9, 60)] } };
  };
  {
    const r = await call(coach, 'GET', `/matches?mode=unrated&refresh=1&username=${ME}`, { headers: H });
    const ids = (r.body.matches || []).map((m) => m.id);
    ok(r.status === 200 && r.body.cached === false && r.body.partial === true && ids.includes('u2') && ids.includes('s1'),
      `a swiftplay call past its deadline keeps that queue's last rows beside the fresh unrated ones (${ids.join(', ')})`);
  }

  // ── every tracker call can time out ──────────────────────────────────────
  ok(signals.length > 0 && signals.every((s) => s && typeof s.aborted === 'boolean'),
    'every HenrikDev request carries an abort signal, so a hung one ends instead of holding the route');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' tracker route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
