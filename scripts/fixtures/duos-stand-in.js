'use strict';

/**
 * OCCLARA DUOS' SERVER, A STAND-IN (docs/claude/duos.md), for the checks that
 * boot the real app (check:mainwindow) and the Duos pictures. The real
 * services/duos-service.js runs on top of it; only its `api` and its `fetch`
 * are this: /api/social/duos/* answered from a small model in the shapes
 * routes/duos.js answers, and a clip's signed URL answered with the repo's
 * own fixture recording, with NO network. The players are invented.
 *
 *   createApi({ live, me, matches, match })  the fake api-client
 *   fetchClip(url)                           the fake signed download
 *   wrap(mod, { live })                      services/duos-service.js with createDuos handed both
 *
 * export:siteproof boots it NOT live (OCCLARA_PROOF_DUOS off), so the website
 * shows what players have today: no trace of Duos.
 */

const fs = require('fs');
const path = require('path');

const CLIP = path.join(__dirname, 'recording-canvas.mkv');
const H = 3600000;
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * H).toISOString();
const until = (days) => new Date(Date.now() + days * 86400000).toISOString();

const ME = {
  username: 'Kestrel_9', discoverable: true, max: true,
  partners: [
    { username: 'Harrier', state: 'active', max: 'both', since: at(24 * 9), rank: { tier: 'Diamond 1', source: 'pc' }, newPins: 2, matches: 3 },
    { username: 'Wren_PC', state: 'paused', max: null, since: at(24 * 20), rank: null, newPins: 0, matches: 1 },
  ],
  ended: [{ username: 'Merlin_Fox', byMe: false, at: at(30) }],
  invitesIn: [{ username: 'Osprey_7', at: at(5), expiresAt: until(6.8) }],
  invitesOut: [{ ref: 'a1b2c3d4e5f60718', name: 'Fieldfare', code: false, at: at(26), expiresAt: until(5.9) },
    { ref: 'b1b2c3d4e5f60718', name: null, code: true, at: at(2), expiresAt: until(6.9) }],
  found: [{ username: 'Hartley_7', agent: 'Reyna', at: at(1.5) }],
  quota: { up: 412 * 1024 * 1024, upMax: 2 * 1024 ** 3, down: 0, downMax: 1536 * 1024 * 1024 },
};

const sheet = (agent, grade, rounds, score, line) => ({ v: 1, agent, map: 'Ascent', mode: 'Competitive', result: score.us > score.them ? 'W' : 'L',
  score, grade: { score: grade, letter: grade >= 90 ? 'S' : grade >= 80 ? 'A' : grade >= 70 ? 'B' : grade >= 60 ? 'C' : 'D' }, line, rounds });
const MINE = sheet('Jett', 74, [
  { n: 1, side: 'atk', won: true, died: false, kills: [18, 23], fk: true, clutch: null, alive: null, plant: { site: 'A', sec: 41 }, cause: null, killPlaces: ['A Main'], sec: null, place: null, killer: null, weapon: null, fd: false, traded: null },
  { n: 2, side: 'atk', won: false, died: true, sec: 34, place: 'A Main', killer: 'Raze', weapon: 'Vandal', kills: [12], fk: false, fd: false, traded: false, clutch: null, alive: { mates: 2, enemies: 3 }, plant: null, cause: 'isolated', killPlaces: [] },
  { n: 3, side: 'atk', won: true, died: true, sec: 61, place: 'Mid Market', killer: 'Sova', weapon: 'Phantom', kills: [22, 30, 44], fk: false, fd: false, traded: true, clutch: null, alive: { mates: 1, enemies: 1 }, plant: { site: 'B', sec: 52 }, cause: null, killPlaces: [] },
  { n: 4, side: 'atk', won: false, died: true, sec: 19, place: 'B Main', killer: 'Jett', weapon: 'Operator', kills: [], fk: false, fd: true, traded: false, clutch: null, alive: { mates: 4, enemies: 5 }, plant: null, cause: 'dry-peek', killPlaces: [] },
], { us: 13, them: 9 }, { k: 21, d: 15, a: 6 });
const THEIRS = sheet('Sova', 81, [
  { n: 1, side: 'atk', won: true, died: true, sec: 47, place: 'A Site', killer: 'Killjoy', weapon: 'Spectre', kills: [30], fk: false, fd: false, traded: true, clutch: null, alive: { mates: 3, enemies: 1 }, plant: { site: 'A', sec: 41 }, cause: null, killPlaces: [] },
  { n: 2, side: 'atk', won: false, died: true, sec: 39, place: 'A Lobby', killer: 'Raze', weapon: 'Vandal', kills: [], fk: false, fd: false, traded: false, clutch: null, alive: { mates: 1, enemies: 3 }, plant: null, cause: null, killPlaces: [] },
  { n: 3, side: 'atk', won: true, died: false, kills: [57, 63], fk: false, clutch: { vs: 1, won: true }, alive: null, plant: { site: 'B', sec: 52 }, cause: null, killPlaces: [], sec: null, place: null, killer: null, weapon: null, fd: false, traded: null },
  { n: 4, side: 'atk', won: false, died: true, sec: 28, place: 'B Main', killer: 'Jett', weapon: 'Operator', kills: [24], fk: false, fd: false, traded: false, clutch: null, alive: { mates: 3, enemies: 4 }, plant: null, cause: null, killPlaces: [] },
], { us: 13, them: 9 }, { k: 18, d: 13, a: 9 });

const MATCHES = [
  { ref: 'c1c2c3c4c5c6c7c8', partner: 'Harrier', playedAt: at(3), expiresAt: until(29.8), active: true,
    mine: { agent: 'Jett', map: 'Ascent', mode: 'Competitive', result: 'W', score: { us: 13, them: 9 }, grade: { score: 74, letter: 'B' }, line: MINE.line, rounds: 22 },
    theirs: { agent: 'Sova', map: 'Ascent', mode: 'Competitive', result: 'W', score: { us: 13, them: 9 }, grade: { score: 81, letter: 'A' }, line: THEIRS.line, rounds: 22 },
    myClips: 3, theirClips: 2 },
  { ref: 'd1d2d3d4d5d6d7d8', partner: 'Harrier', playedAt: at(28), expiresAt: until(28.8), active: true,
    mine: { agent: 'Jett', map: 'Lotus', mode: 'Competitive', result: 'L', score: { us: 10, them: 13 }, grade: { score: 66, letter: 'C' }, line: null, rounds: 23 },
    theirs: null, myClips: 4, theirClips: 0 },
];

const MATCH = {
  ref: 'c1c2c3c4c5c6c7c8', partner: 'Harrier', playedAt: at(3), expiresAt: until(29.8), active: true, mine: MINE, theirs: THEIRS,
  clips: [
    { ref: 'e1e2e3e4e5e6e7e8', mine: true, name: 'r2-clip.mkv', round: 2, kind: 'death', marks: { death: 2600, kills: [], cuts: [], anchor: { clip: 2600, round: 34200 } }, size: 216409 },
    { ref: 'f1f2f3f4f5f6f7f8', mine: false, name: 'r2-clip.mkv', round: 2, kind: 'death', marks: { death: 1800, kills: [], cuts: [], anchor: { clip: 1800, round: 39100 } }, size: 216409 },
    { ref: 'a9a2a3a4a5a6a7a8', mine: true, name: 'h3-clip.mkv', round: 3, kind: 'highlight', marks: { death: null, kills: [600, 2400], cuts: [{ at: 1500, skipped: 5000 }], anchor: { clip: 600, round: 22100 } }, size: 216409 },
    { ref: 'b9b2b3b4b5b6b7b8', mine: true, name: 'r4-clip.mkv', round: 4, kind: 'death', marks: { death: 3000, kills: [], cuts: [], anchor: { clip: 3000, round: 19400 } }, size: 216409 },
  ],
  pins: [
    { ref: 'aa11bb22cc33dd44', clip: 'e1e2e3e4e5e6e7e8', at: 2100, label: 'too-far', reaction: null, mine: false, createdAt: at(1) },
    { ref: 'ab11bb22cc33dd44', clip: 'e1e2e3e4e5e6e7e8', at: 2900, label: 'should-trade', reaction: 'oops', mine: false, createdAt: at(1) },
    { ref: 'ac11bb22cc33dd44', clip: 'f1f2f3f4f5f6f7f8', at: 1200, label: 'good-utility', reaction: 'nice', mine: true, createdAt: at(2) },
  ],
};

function createApi(opts = {}) {
  const o = { live: true, me: ME, matches: MATCHES, match: MATCH, ...opts };
  const calls = [];
  const ok = (data) => ({ ok: true, status: 200, data });
  const answer = (method, url, body) => {
    calls.push({ method, url, body });
    const u = new URL(url, 'http://stand.in');
    const p = u.pathname;
    if (p === '/api/social/status') return ok({ live: true, riotProof: false, duos: !!o.live });
    if (!o.live) return { ok: false, status: 503, data: { error: 'duos-not-live' } };
    if (p === '/api/social/duos/me') return ok({ me: o.me });
    if (p === '/api/social/duos/matches') return ok({ matches: o.matches });
    if (p === '/api/social/duos/match') return u.searchParams.get('ref') === o.match.ref ? ok({ match: o.match }) : { ok: false, status: 404, data: { error: 'not-found' } };
    if (p === '/api/social/duos/invite') return ok({ ok: true, reason: 'sent' });
    if (p === '/api/social/duos/code') return ok({ ok: true, reason: null, code: 'K7M2Q-9XH4P', expiresAt: until(7) });
    if (p === '/api/social/duos/accept') return ok({ ok: false, reason: 'bad-code', username: null });
    if (p === '/api/social/duos/clip/url') return ok({ ok: true, reason: null, url: `https://stand.in/clip/${body && body.clip}`, size: 216409 });
    if (p === '/api/social/duos/pin') return ok({ ok: true, reason: null, ref: 'ad11bb22cc33dd44' });
    if (p === '/api/social/duos/report') return ok({ ok: true, reason: null, matches: [], found: [] });
    if (p.startsWith('/api/social/duos/')) return ok({ ok: true, reason: null });
    return { ok: false, status: 404, data: { error: 'Not found' } };
  };
  return {
    calls,
    authHeaders: () => ({ Authorization: 'Bearer occ_stand_in' }),
    get: async (url) => answer('GET', url),
    post: async (url, body) => answer('POST', url, body),
  };
}

/** The signed download, answered with the fixture recording (a real Matroska file). */
async function fetchClip(url) {
  if (!String(url).startsWith('https://stand.in/clip/')) throw new Error('no network in the stand-in');
  const bytes = fs.readFileSync(CLIP);
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
}

/** services/duos-service.js, its createDuos handed the stand-in api and fetch. */
function wrap(mod, opts) {
  const api = createApi(opts);
  // The profiles service's own status ask, answered by the stand-in, unless the app hands its own.
  const socialLive = async () => (await api.get('/api/social/status')).data;
  return { ...mod, standIn: api, createDuos: (deps) => mod.createDuos({ socialLive, ...deps, api, fetch: fetchClip }) };
}

module.exports = { createApi, fetchClip, wrap, ME, MATCHES, MATCH, MINE, THEIRS, CLIP };
