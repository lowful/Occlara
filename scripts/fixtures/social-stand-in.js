'use strict';

/**
 * THE PUBLIC PROFILE'S SERVER, A STAND-IN (docs/claude/social.md), for the
 * checks that boot the real app (check:mainwindow, export:siteproof) and the
 * Players pictures. The real services/social-service.js runs on top of it;
 * only its `api` is this: /api/social/* answered from a small model, in the
 * shapes routes/social.js answers, with NO network. The players are invented.
 *
 *   createApi({ live, me, profiles, results })  the fake api-client
 *   wrap(mod)  services/social-service.js with createSocial handed this api
 */

const SAMPLE_STATS = {
  v: 1, matches: 34, wins: 19, losses: 14, draws: 1,
  grade: { avg: 74, letter: 'B', n: 31, trend: [61, 66, 70, 72, 69, 75, 78, 74, 80, 77] },
  kd: 1.18, hs: 23,
  agents: [{ name: 'Jett', n: 18 }, { name: 'Raze', n: 9 }, { name: 'Omen', n: 4 }],
  maps: [{ name: 'Ascent', n: 9, w: 6 }, { name: 'Bind', n: 7, w: 3 }, { name: 'Lotus', n: 6, w: 4 }],
  multi: { k2: 41, k3: 12, k4: 3, k5: 1 }, clutches: 6,
  recent: [
    { r: 'W', agent: 'Jett', map: 'Ascent', grade: 81, letter: 'A' }, { r: 'W', agent: 'Jett', map: 'Lotus', grade: 77, letter: 'B' },
    { r: 'L', agent: 'Raze', map: 'Bind', grade: 64, letter: 'C' }, { r: 'W', agent: 'Jett', map: 'Haven', grade: 79, letter: 'B' },
    { r: 'L', agent: 'Omen', map: 'Split', grade: 58, letter: 'D' }, { r: 'D', agent: 'Jett', map: 'Ascent', grade: 70, letter: 'B' },
    { r: 'W', agent: 'Raze', map: 'Sunset', grade: 83, letter: 'A' }, { r: 'L', agent: 'Jett', map: 'Bind', grade: null, letter: null },
    { r: 'W', agent: 'Jett', map: 'Pearl', grade: 76, letter: 'B' }, { r: 'W', agent: 'Raze', map: 'Abyss', grade: 72, letter: 'B' },
  ],
  title: { id: 'entry', name: 'The Entry' },
};

const PROFILES = {
  kestrel_9: { username: 'Kestrel_9', self: true, public: true, verified: true, riot: { name: 'Kestrel', tag: 'EUW1' },
    rank: { source: 'verified', current: 'Gold 2', peak: 'Platinum 1' }, stats: SAMPLE_STATS, statsAt: '2026-11-25T09:40:00.000Z' },
  harrier: { username: 'Harrier', self: false, public: true, verified: true, riot: { name: 'Harrier', tag: 'NA1' },
    rank: { source: 'verified', current: 'Diamond 1', peak: 'Diamond 3' },
    stats: { ...SAMPLE_STATS, matches: 52, wins: 31, losses: 21, draws: 0, grade: { avg: 81, letter: 'A', n: 50, trend: [] }, agents: [{ name: 'Sova', n: 30 }, { name: 'Fade', n: 12 }], title: { id: 'student', name: 'The Student' } },
    statsAt: '2026-11-24T21:10:00.000Z' },
  merlin_fox: { username: 'Merlin_Fox', self: false, public: true, verified: false, riot: null, rank: null, stats: null, statsAt: null },
  // Unverified, with numbers and the rank its own app sent: labelled as from its PC.
  wren_pc: { username: 'Wren_PC', self: false, public: true, verified: false, riot: null,
    rank: { source: 'pc', current: 'Silver 3', peak: 'Gold 1' },
    stats: { ...SAMPLE_STATS, matches: 12, wins: 6, losses: 6, draws: 0, grade: { avg: 66, letter: 'C', n: 11, trend: [] },
      agents: [{ name: 'Reyna', n: 8 }], maps: [{ name: 'Split', n: 5, w: 2 }],
      recent: SAMPLE_STATS.recent.slice(0, 6).map((r, i) => ({ ...r, r: i % 2 ? 'L' : 'W', agent: 'Reyna' })), title: null },
    statsAt: '2026-11-23T18:00:00.000Z' },
};

const RESULTS = [
  { username: 'Harrier', riot: { name: 'Harrier', tag: 'NA1' }, rank: { tier: 'Diamond 1', source: 'verified' }, agent: 'Sova', grade: { avg: 81, letter: 'A' } },
  { username: 'Harrow', riot: null, rank: { tier: 'Gold 2', source: 'pc' }, agent: 'Killjoy', grade: { avg: 68, letter: 'C' } },
  { username: 'Hartley_7', riot: { name: 'Hartley', tag: 'EU7' }, rank: { tier: 'Silver 3', source: 'verified' }, agent: 'Reyna', grade: null },
];

// An open proof of control, as /me answers it.
const CHALLENGE = { status: 'open', agents: ['Sage', 'Phoenix', 'Brimstone'], riot: { name: 'Kestrel', tag: 'EUW1' },
  issuedAt: '2026-11-25T09:00:00.000Z', expiresAt: '2026-11-25T13:00:00.000Z', checks: 1, maxChecks: 30, lastResult: 'half', progress: 1 };

const ME = {
  username: 'Kestrel_9', public: true, showRiotId: true, discoverable: false,
  riot: { state: 'verified', riotId: { name: 'Kestrel', tag: 'EUW1' }, verifiedAt: '2026-11-25T08:00:00.000Z', lost: null, lostAt: null },
  rank: { source: 'verified', current: 'Gold 2', peak: 'Platinum 1', at: '2026-11-25T10:00:00.000Z' }, challenge: null, statsAt: '2026-11-25T09:40:00.000Z',
  nameChangeAt: '2026-12-20T09:00:00.000Z', blocked: ['Rook_Seven'],
};

function createApi(opts = {}) {
  const o = { live: true, me: ME, profiles: PROFILES, results: RESULTS, ...opts };
  const calls = [];
  const answer = (method, url, body) => {
    calls.push({ method, url, body });
    const u = new URL(url, 'http://stand.in');
    const p = u.pathname;
    if (p === '/api/social/status') return { ok: true, status: 200, data: { live: !!o.live, riotProof: !!o.live && o.riotProof !== false, duos: !!o.live && o.duos === true } };
    // Discoverable as Duos reads it (docs/claude/duos.md): off until turned on through Duos.
    if (p === '/api/social/duos/discoverable') return { ok: true, status: 200, data: method === 'GET' ? { on: false } : { ok: true, reason: null } };
    if (!o.live) return { ok: false, status: 503, data: { error: 'social-not-live' } };
    if (p === '/api/social/me') return { ok: true, status: 200, data: { profile: o.me, rules: { usernameMin: 3, usernameMax: 20, changeDays: 30, holdDays: 30, need: 3 } } };
    if (p === '/api/social/username' && method === 'GET') return { ok: true, status: 200, data: { ok: true, reason: 'free' } };
    if (p === '/api/social/username') return { ok: true, status: 200, data: { ok: false, reason: 'too-soon', nextAt: o.me && o.me.nameChangeAt } };
    if (p === '/api/social/flags') return { ok: true, status: 200, data: { ok: true, reason: null, profile: o.me } };
    if (p === '/api/social/stats') return { ok: true, status: 200, data: { ok: true, reason: null } };
    if (p === '/api/social/profile') {
      const hit = o.profiles[String(u.searchParams.get('name') || '').toLowerCase()];
      return hit ? { ok: true, status: 200, data: { profile: hit } } : { ok: false, status: 404, data: { error: 'not-found' } };
    }
    if (p === '/api/social/search') {
      const q = String(u.searchParams.get('q') || '').toLowerCase();
      return { ok: true, status: 200, data: { results: o.results.filter((r) => r.username.toLowerCase().startsWith(q.split('#')[0])) } };
    }
    if (p === '/api/social/block' || p === '/api/social/report') return { ok: true, status: 200, data: { ok: true } };
    if (p === '/api/social/riot/start') return { ok: true, status: 200, data: { ok: true, reason: null, challenge: CHALLENGE } };
    if (p === '/api/social/riot/check') return { ok: true, status: 200, data: { ok: false, result: 'not-yet', challenge: CHALLENGE, profile: o.me } };
    return { ok: false, status: 404, data: { error: 'Not found' } };
  };
  return {
    calls,
    authHeaders: () => ({ Authorization: 'Bearer occ_stand_in' }),
    get: async (url) => answer('GET', url),
    post: async (url, body) => answer('POST', url, body),
  };
}

/** services/social-service.js, its createSocial handed the stand-in api and an account signed in. */
function wrap(mod, opts) {
  const api = createApi(opts);
  return { ...mod, standIn: api, createSocial: (deps) => mod.createSocial({ ...deps, api, signedIn: async () => true }) };
}

module.exports = { createApi, wrap, PROFILES, RESULTS, ME, SAMPLE_STATS, CHALLENGE };
