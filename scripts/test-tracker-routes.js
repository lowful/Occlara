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

  // ── a weapon is its name, never its type (8.4.1) ─────────────────────────
  // HenrikDev gives a kill it cannot name weapon { name: null, type: 'Weapon' }:
  // the player's Fracture round 6 read "with a Weapon" on the card and in the
  // AI log's death check.
  henrik.match = async () => ({ status: 200, json: { data: { ...V4,
    kills: V4.kills.map((k, i) => (i === 1 ? { ...k, weapon: { id: 'hh', name: null, type: 'Weapon' } } : k)) } } });
  {
    const deaths = await call(coach, 'GET', `/match-deaths?matchId=md1&username=${ME}`, { headers: H });
    const rounds = await call(coach, 'GET', `/match-rounds?matchId=md1&username=${ME}`, { headers: H });
    const d = deaths.body && Array.isArray(deaths.body.deaths) ? deaths.body.deaths[0] : null;
    const r2 = rounds.body && Array.isArray(rounds.body.perRound) ? rounds.body.perRound.find((x) => x.n === 2) : null;
    ok(deaths.status === 200 && d && d.round === 2 && d.weapon === null && r2 && r2.died && r2.weapon === null,
      `a kill Riot names no weapon for has none, in the death check and the round record alike (${d && JSON.stringify(d.weapon)}, ${r2 && JSON.stringify(r2.weapon)})`);
  }
  henrik.match = async () => ({ status: 200, json: { data: V4 } });

  // ── Riot's death check names the killer by agent, never by Riot ID (8.4.1) ─
  // It answered the killer's full Riot ID, which the AI log painted ("killed by
  // Foe#NA1"): the rule of the roster (/matches, below) is the death check's.
  {
    const killer = async (id, data) => {
      henrik.match = async () => ({ status: 200, json: { data } });
      const r = await call(coach, 'GET', `/match-deaths?matchId=${id}&username=${ME}`, { headers: H });
      const d = r.body && Array.isArray(r.body.deaths) ? r.body.deaths[0] : null;
      return { r, d, text: JSON.stringify(r.body || {}) };
    };
    const named = await killer('mdk1', V4);
    ok(named.r.status === 200 && named.d && named.d.round === 2 && named.d.killer === 'Omen' && !/Foe|NA1/.test(named.text),
      `Riot's death check names the killer by their agent, and no other player's name or tag is in the reply (${JSON.stringify(named.d && named.d.killer)})`);
    const byId = await killer('mdk2', { ...V4,
      players: V4.players.map((p, i) => ({ ...p, puuid: `p${i}` })),
      kills: V4.kills.map((k) => ({ ...k, killer: { puuid: k.killer.name === 'Foe' ? 'p1' : 'p0' } })) });
    ok(byId.d && byId.d.killer === 'Omen', `a killer named by puuid alone is found by it (${JSON.stringify(byId.d && byId.d.killer)})`);
    const stranger = await killer('mdk3', { ...V4,
      kills: V4.kills.map((k, i) => (i === 1 ? { ...k, killer: { name: 'Stranger', tag: 'ZZ1' } } : k)) });
    ok(stranger.d && stranger.d.killer === null && !/Stranger|ZZ1/.test(stranger.text),
      `and a killer the roster does not have is no killer, never a name (${JSON.stringify(stranger.d && stranger.d.killer)})`);
  }
  henrik.match = async () => ({ status: 200, json: { data: V4 } });

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

  // ── /matches: a teammate's Riot ID never leaves the server (8.4.1) ───────
  // Stats' "Your team" showed every teammate's full Riot ID. Valorant lets a
  // player hide theirs, and Riot's policy is that no product shows a player's
  // identity to others without their opt in: a row is its agent and numbers.
  henrik.stored = async (u) => ({ status: 200, json: { data: /mode=competitive/.test(u) ? [row('roster1', 'Competitive', 13, 7, 30)] : [] } });
  henrik.match = async () => ({ status: 200, json: { data: { ...V4,
    players: [
      { name: 'Roster', tag: 'EUW', team_id: 'Red', agent: { name: 'Jett' }, stats: { kills: 20, deaths: 10, assists: 4, score: 6000 } },
      { name: 'Fade', tag: 'EUW', team_id: 'Red', agent: { name: 'Sova' }, stats: { kills: 15, deaths: 12, assists: 9, score: 4800 } },
      // The agent as a character object, which the roster used to hand on whole.
      { name: 'Hidden Friend', tag: 'ZZ9', team_id: 'Red', character: { name: 'Omen' }, stats: { kills: 8, deaths: 14, assists: 6, score: 2600 } },
      { name: 'Foe', tag: 'NA1', team_id: 'Blue', agent: { name: 'Reyna' }, stats: { kills: 12, deaths: 15, assists: 2, score: 4000 } },
    ],
    teams: [{ team_id: 'Red', rounds: { won: 13 } }, { team_id: 'Blue', rounds: { won: 7 } }] } } });
  {
    const r = await call(coach, 'GET', `/matches?mode=competitive&username=${encodeURIComponent('Roster#EUW')}`, { headers: H });
    const team = (((r.body.matches || [])[0] || {}).team) || [];
    const read = team.map((p) => `${p.agent}:${p.kills}/${p.deaths}/${p.assists}${p.me ? ':me' : ''}`).join(', ');
    ok(r.status === 200 && read === 'Jett:20/10/4:me, Sova:15/12/9, Omen:8/14/6',
      `a match's team is each teammate's agent and numbers, the player's own row marked (${read})`);
    ok(team.length === 3 && team.every((p) => !('name' in p) && !('tag' in p)) && !/Fade|Hidden Friend|ZZ9|Foe|NA1/.test(JSON.stringify(r.body)),
      `and no teammate's name or tag is anywhere in the reply (${JSON.stringify(team[1] || {})})`);
  }

  // ── /recent-matches: the matches Connect grades from Riot's record ──────
  regionCache.clear();
  calls.length = 0;
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.stored = async (u) => {
    if (/[?&]page=2\b/.test(u)) {
      return { status: 200, json: { data: [row('p2a', 'Competitive', 13, 7, 400), row('c3', 'Unrated', 13, 9, 30)] } };
    }
    return { status: 200, json: { data: [
      row('dm1', 'Deathmatch', null, null, 1), row('c1', 'Competitive', 13, 11, 10),
      row('dm2', 'Deathmatch', null, null, 50), row('c2', 'Swiftplay', 5, 3, 20),
      row('c3', 'Unrated', 13, 9, 30), row('dm3', 'Deathmatch', null, null, 60),
      row('dm4', 'Deathmatch', null, null, 70), row('dm5', 'Deathmatch', null, null, 80),
      row('dm6', 'Deathmatch', null, null, 90), row('dm7', 'Deathmatch', null, null, 95),
    ] } };
  };
  ok(/[?&]page=2\b/.test('/x?size=10&page=2') && !/[?&]page=2\b/.test('/x?size=10&page=20'),
    'the second page pattern matches page 2 and only page 2');
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${ME}`, { headers: H });
    const ids = (r.body.matches || []).map((m) => m.matchId);
    ok(r.status === 200 && ids.join() === 'c1,c2,c3,p2a',
      `round based matches only, newest first, once each across both pages (${ids.join()})`);
    ok(count('stored') === 2 && calls.some((u) => /[?&]page=2\b/.test(u)),
      'a full first page crowded by deathmatches asks for a second one');
    const c1 = (r.body.matches || [])[0] || {};
    ok(c1.result === 'Victory' && c1.score === '13-11' && c1.acs > 0 && c1.mode === 'Competitive' && c1.startedAt > 0,
      'each row is the row /last-match builds');
  }
  {
    calls.length = 0;
    const r = await call(coach, 'GET', `/recent-matches?username=${ME}`, { headers: H });
    ok(r.status === 200 && calls.length === 0 && (r.body.matches || []).length === 4,
      'asked again within two minutes, the list comes from memory');
  }
  henrik.stored = async () => ({ status: 429, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Other#EUW')}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `a rate limit is a 503 to retry, never an empty list (${r.status})`);
  }
  regionCache.clear();
  henrik.account = async () => ({ status: 404, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Nobody#000')}`, { headers: H });
    ok(r.status === 200 && /not found/i.test(r.body.error || ''), 'an account that does not exist is a plain answer');
  }
  {
    const r = await call(coach, 'GET', '/recent-matches?username=nohash', { headers: H });
    ok(r.status === 200 && /Name#TAG/.test(r.body.error || ''), 'a malformed Riot ID is refused');
  }
  // A key HenrikDev refuses is the server's fault, never "Account not found".
  regionCache.clear();
  henrik.account = async () => ({ status: 401, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Keyless#EUW')}`, { headers: H });
    ok(r.status === 200 && /refused the server key/.test(r.body.error || '') && !/not found/i.test(r.body.error || ''),
      `a refused server key is not reported as a missing account (${r.body.error})`);
  }
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  // A second page that fails: the first page's rows, answered and not kept.
  henrik.stored = async (u) => (/[?&]page=2\b/.test(u) ? { status: 429, json: {} } : { status: 200, json: { data: [
    row('q1', 'Competitive', 13, 4, 10), ...Array.from({ length: 9 }, (_, i) => row(`qdm${i}`, 'Deathmatch', null, null, 20 + i)),
  ] } });
  {
    const who = `/recent-matches?username=${encodeURIComponent('Paged#EUW')}`;
    const r1 = await call(coach, 'GET', who, { headers: H });
    calls.length = 0;
    const r2 = await call(coach, 'GET', who, { headers: H });
    ok(r1.status === 200 && (r1.body.matches || []).map((m) => m.matchId).join() === 'q1',
      'a failed second page still answers with the first page\'s matches');
    ok(r2.status === 200 && count('stored') === 2, 'and is not kept, so the next ask tries both pages again');
  }
  // A failed second page behind a first page of nothing but deathmatches is a
  // failure that passes: a 503 to ask again, never "no matches".
  henrik.stored = async (u) => (/[?&]page=2\b/.test(u) ? { status: 429, json: {} } : { status: 200, json: { data:
    Array.from({ length: 10 }, (_, i) => row(`wdm${i}`, 'Deathmatch', null, null, 5 + i)) } });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Warmup#EUW')}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `a page of deathmatches and a failed second page asks again (${r.status})`);
  }
  // No stored matches for an account that exists: an empty list, not a refusal.
  henrik.stored = async () => ({ status: 404, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Fresh#EUW')}`, { headers: H });
    ok(r.status === 200 && Array.isArray(r.body.matches) && r.body.matches.length === 0 && !r.body.error,
      `an account with no stored matches has none to grade (${JSON.stringify(r.body)})`);
  }

  // ── Riot's start and length come back with the rounds ───────────────────
  henrik.match = async () => ({ status: 200, json: { data: {
    ...V4, metadata: { ...V4.metadata, started_at: '2026-09-20T18:00:00.000Z', game_length_in_ms: 2400000 },
  } } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m-started&username=${ME}`, { headers: H });
    ok(r.body.startedAt === Date.parse('2026-09-20T18:00:00.000Z') && r.body.lengthMs === 2400000,
      `Riot's start and length come back with the rounds (${r.body.startedAt}, ${r.body.lengthMs})`);
  }
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m-unstarted&username=${ME}`, { headers: H });
    ok(r.body.startedAt === null && r.body.lengthMs === null, 'and are null when Riot leaves them out');
  }

  // ── 8.5.0: Riot's record grows by agent and gun, never by a name ─────────
  const riotRounds = require(path.join(__dirname, '..', 'server', 'services', 'riot-rounds.js'));
  const { henrikKey, FILL_MAX, matchMvpCache } = coach.__test;
  regionCache.clear();
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  const GROWN = {
    ...V4,
    metadata: { ...V4.metadata, Foe: 1 },
    players: [
      { name: 'Me', tag: 'EUW', puuid: 'puuid-me-0001', team_id: 'Red', agent: { name: 'Jett' }, stats: { kills: 1, deaths: 1, assists: 0, score: 300 },
        economy: { loadout_value: { overall: 3900 }, spent: { overall: 3900 } } },
      { name: 'Foe', tag: 'NA1', puuid: 'puuid-foe-0002', team_id: 'Blue', agent: { name: 'Omen' }, stats: { kills: 1, deaths: 1, assists: 0, score: 280 } },
      { name: 'Hidden Friend', tag: 'ZZ9', puuid: 'puuid-friend-0003', team_id: 'Red', agent: { name: 'Sova' }, stats: {} },
    ],
    rounds: [
      { winning_team: 'Red', plant: { round_time_in_ms: 20000, site: 'A', player: { puuid: 'puuid-me-0001' } },
        stats: [{ player: { puuid: 'puuid-me-0001' }, economy: { loadout_value: 3900, remaining: 100, weapon: { name: 'Vandal' } },
          damage_events: [{ player: { puuid: 'puuid-foe-0002' }, damage: 150, headshots: 1 }], ability_casts: { grenade: 1 } }] },
      { winning_team: 'Blue', defuse: { round_time_in_ms: 60000 } },
    ],
    kills: [
      { round: 0, time_in_round_in_ms: 30000, killer: { puuid: 'puuid-me-0001', name: 'Me', tag: 'EUW' }, victim: { puuid: 'puuid-foe-0002', name: 'Foe', tag: 'NA1' },
        weapon: { id: 'v', name: 'Vandal', type: 'Weapon' }, location: { x: 1, y: 2 }, player_locations: [{ player: { puuid: 'puuid-foe-0002' }, view_radians: 1, location: { x: 3, y: 4 } }] },
      { round: 1, time_in_round_in_ms: 20000, killer: { puuid: 'puuid-foe-0002', name: 'Foe', tag: 'NA1' }, victim: { puuid: 'puuid-me-0001', name: 'Me', tag: 'EUW' },
        weapon: { id: 'p', name: 'Phantom', type: 'Weapon' } },
      { round: 1, time_in_round_in_ms: 21000, killer: { puuid: 'puuid-friend-0003' }, victim: { puuid: 'puuid-foe-0002' },
        weapon: { id: 'x', name: null, type: 'Ability' } },
    ],
  };
  const MID = '0c1d2e3f-aaaa-4bbb-8ccc-1234567890ab';
  henrik.match = async () => ({ status: 200, json: { data: GROWN } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=${MID}&username=${ME}`, { headers: H });
    const text = JSON.stringify(r.body || {});
    const feed = (r.body.perRound || []).map((p) => p.feed);
    ok(r.status === 200 && JSON.stringify(r.body.comps) === JSON.stringify({
      us: [{ agent: 'Jett', role: 'Duelist' }, { agent: 'Sova', role: 'Initiator' }], them: [{ agent: 'Omen', role: 'Controller' }] }),
    `both team comps come back, agents and roles sorted by agent (${JSON.stringify(r.body.comps)})`);
    ok(JSON.stringify(feed) === JSON.stringify([
      [{ ms: 30000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Omen', w: 'Vandal' }],
      [{ ms: 20000, by: 'enemy', on: 'me', ka: 'Omen', va: 'Jett', w: 'Phantom' }, { ms: 21000, by: 'mate', on: 'enemy', ka: 'Sova', va: 'Omen', w: null }]]),
    `each kill of the feed says both ends by agent and its gun by name, never its type (${JSON.stringify(feed)})`);
    const s = r.body.shape || {};
    ok(JSON.stringify(s['rounds[0].stats[0]']) === '["player","economy","damage_events","ability_casts"]'
      && JSON.stringify(s['rounds[0].stats[0].economy']) === '["loadout_value","remaining","weapon"]'
      && JSON.stringify(s['rounds[0].stats[0].damage_events[0]']) === '["player","damage","headshots"]'
      && JSON.stringify(s['rounds[0].stats[0].ability_casts']) === '["grenade"]' && JSON.stringify(s['rounds[].plant']) === '["round_time_in_ms","site","player"]'
      && JSON.stringify(s['rounds[].defuse']) === '["round_time_in_ms"]' && JSON.stringify(s['kills[0].weapon']) === '["id","name","type"]'
      && JSON.stringify(s['kills[0].location']) === '["x","y"]' && JSON.stringify(s['kills[0].player_locations[0]']) === '["player","view_radians","location"]'
      && JSON.stringify(s['players[0].economy']) === '["loadout_value","spent"]' && JSON.stringify(s['teams[0]']) === '["team_id","rounds"]'
      && JSON.stringify(s.metadata) === '["map","queue"]' && JSON.stringify(s.top) === JSON.stringify(Object.keys(GROWN)),
    'the shape goes one level deeper, key names only, and a key that is a player\'s name is left out of it');
    ok(!/Foe|NA1|Hidden|Friend|ZZ9|puuid-/.test(text), `and no other player's name, tag or id is anywhere in the reply (${text.length} characters)`);
    const names = riotRounds.nameSetOf(MID);
    ok(names && names.has('a teammate called Friend') && names.has('FOE') && names.has('the NA1 tag') && !names.has('Hold the angle with Jett')
      && JSON.stringify(names) === '{}' && Object.keys(names).join() === 'has',
    "the match's name set is held on the server, hashed, answering has() and printing nothing");
    ok(riotRounds.nameSetOf('another-match') === null && riotRounds.nameSetOf('') === null && riotRounds.nameSetOf(MID.toUpperCase()) !== null,
      'and only for its own match, by id in any case');
    const realNow = Date.now;
    const later = realNow() + riotRounds.NAME_SET_MS + 1000;
    Date.now = () => later;
    try {
      ok(riotRounds.nameSetOf(MID) === null, 'a day on, the set is gone, and only the gates\' own rule runs');
    } finally { Date.now = realNow; }
  }

  // ── 8.5.0: the MVP badge and the roster are each player's own ────────────
  matchMvpCache.clear();
  henrik.stored = async (u) => ({ status: 200, json: { data: /mode=competitive/.test(u) ? [row('duo1', 'Competitive', 13, 7, 30)] : [] } });
  henrik.match = async () => ({ status: 200, json: { data: { ...V4,
    players: [
      { name: 'Carry', tag: 'EUW', team_id: 'Red', agent: { name: 'Jett' }, stats: { kills: 20, deaths: 10, assists: 4, score: 6000 } },
      { name: 'Duo', tag: 'EUW', team_id: 'Red', agent: { name: 'Sova' }, stats: { kills: 15, deaths: 12, assists: 9, score: 4800 } },
      { name: 'Foe', tag: 'NA1', team_id: 'Blue', agent: { name: 'Reyna' }, stats: { kills: 12, deaths: 15, assists: 2, score: 4000 } },
    ],
    teams: [{ team_id: 'Red', won: true, rounds: { won: 13 } }, { team_id: 'Blue', won: false, rounds: { won: 7 } }] } } });
  {
    const one = await call(coach, 'GET', `/matches?mode=competitive&username=${encodeURIComponent('Carry#EUW')}`, { headers: H });
    const two = await call(coach, 'GET', `/matches?mode=competitive&username=${encodeURIComponent('Duo#EUW')}`, { headers: H });
    const a = (one.body.matches || [])[0] || {};
    const b = (two.body.matches || [])[0] || {};
    const mine = (m) => ((m.team || []).find((p) => p.me) || {}).agent;
    ok(a.mvp === 'match' && mine(a) === 'Jett' && b.mvp === null && mine(b) === 'Sova',
      `two Occlara players of one match each get their own badge and their own row marked (${a.mvp}/${mine(a)}, ${b.mvp}/${mine(b)})`);
    ok(matchMvpCache.has('duo1|carry#euw') && matchMvpCache.has('duo1|duo#euw') && !matchMvpCache.has('duo1'),
      'the badge cache is keyed by match and player, lower case');
  }

  // ── 8.5.0: a fill waits its turn on the shared HenrikDev key ─────────────
  regionCache.clear();
  henrikKey.throttledAt = 0;
  henrikKey.fills.length = 0;
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const rounds = (id, extra) => call(coach, 'GET', `/match-rounds?matchId=${id}&username=${ME}${extra || ''}`, { headers: H });
    const first = await rounds('fill-1', '&purpose=fill');
    ok(first.status === 200 && first.body.perRound && henrikKey.fills.length === 1, 'a fill on a quiet key is served, and counted');
    henrik.match = async () => ({ status: 429, json: {} });
    const throttled = await rounds('live-429');
    ok(throttled.status === 503 && henrikKey.throttledAt > 0, 'a live link turned away with a 429 marks the key throttled');
    henrik.match = async () => ({ status: 200, json: { data: V4 } });
    calls.length = 0;
    const held = await rounds('fill-2', '&purpose=fill');
    const live = await rounds('live-2');
    ok(held.status === 503 && held.body.retry === true && live.status === 200 && calls.filter((u) => u.includes('fill-2')).length === 0,
      `within two minutes of a 429 a fill is a 503 to ask again, without a call, while a live link goes on (${held.status}, ${live.status})`);
    const realNow = Date.now;
    const at = realNow() + coach.__test.FILL_HOLD_MS + 1000;
    Date.now = () => at;
    try {
      const after = await rounds('fill-3', '&purpose=fill');
      ok(after.status === 200, 'two minutes on, a fill is served again');
      henrikKey.fills.length = 0;
      const burst = [];
      for (let i = 0; i < FILL_MAX + 1; i++) burst.push((await rounds(`burst-${i}`, '&purpose=fill')).status);
      ok(burst.slice(0, FILL_MAX).every((s) => s === 200) && burst[FILL_MAX] === 503,
        `ten fills a minute go upstream, server wide, and the eleventh waits (${burst.join(', ')})`);
      const cached = await rounds('burst-0', '&purpose=fill');
      const liveNow = await rounds('live-3');
      ok(cached.status === 200 && liveNow.status === 200, 'while a fill the reply cache answers is served, and a live link never waits');
    } finally { Date.now = realNow; }
    henrikKey.fills.length = 0;
    henrikKey.throttledAt = 0;
  }

  // ── every tracker call can time out ──────────────────────────────────────
  ok(signals.length > 0 && signals.every((s) => s && typeof s.aborted === 'boolean'),
    'every HenrikDev request carries an abort signal, so a hung one ends instead of holding the route');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' tracker route checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
