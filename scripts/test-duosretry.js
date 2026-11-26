'use strict';

/**
 * OCCLARA DUOS, THE SECOND REVIEW OF 25 NOV (docs/claude/duos.md): one case
 * for each finding, pure node, no window:
 *   1  a refused sheet is final for its match, a 429 backs off, no item blocks
 *      the queue; sheetOf never builds what cleanSheet refuses, over every
 *      review the fixtures can build
 *   2  a clip start's answers: which are final, which back off and are never
 *      final
 *   3  Duos OFF: no request of the duos service's own over 24 hours
 *   4  GET /me: stamped on any answer, 403 not engaged, 500 and 429 backed off,
 *      a licence key alone asks nothing
 *   5  the trash keeps a dropped upload's path 26 hours; the sweep's
 *      reconciliation removes a file no row holds once it is a day old, a late
 *      landing included, and keeps a younger one and a live one
 *   6  a failing report backs off, at most 20 an hour, and stops at the window
 *   7  a decline holds the sender off 7 days from the decline
 *   8  an invite an account was SENT never makes it engaged, here or on the server
 *   9  a partner is never told which side pays; a teammate never shown cannot
 *      be reported by name; a cached clip expires with its match
 *   10 a file grown after it was settled is refused and deleted at download;
 *      a 400 whose body says 413 is too large
 *
 * Run: npm run test:duosretry
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

const express = require(path.join(ROOT, 'server', 'node_modules', 'express'));
const SD = require(path.join(ROOT, 'server', 'services', 'duos.js'));
const duoRoutes = require(path.join(ROOT, 'server', 'routes', 'duos.js'));
const AD = require(path.join(ROOT, 'src', 'shared', 'duos.js'));
const verify = require(path.join(ROOT, 'src', 'shared', 'valorant-verify.js'));
const vreview = require(path.join(ROOT, 'src', 'shared', 'valorant-review.js'));
const { createDuos } = require(path.join(ROOT, 'src', 'main', 'services', 'duos-service.js'));
const pg = require('./fixtures/pglite-duos');
const { createStorage } = require('./fixtures/storage-stand-in');
const fx = require('./fixtures/duos-stand-in');

let fails = 0;
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${extra !== undefined ? `  ${JSON.stringify(extra).slice(0, 500)}` : ''}`); } else console.log(`ok    ${what}`);
};
const U = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const MIN = 60000;
const MATCH = '7c1d3e5f-2a4b-4c6d-8e0f-123456789abc';
const US = ['Jett', 'Sova', 'Omen', 'Sage', 'Breach'];
const THEM = ['Fade', 'Raze', 'Killjoy', 'Cypher', 'Reyna'];
const CLIP = fs.readFileSync(fx.CLIP);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duosretry-'));

function savedOf(id, o = {}) {
  return { id, at: o.at || Date.now(), game: 'valorant', review: { kind: 'valorant', source: 'watched', matchId: o.matchId || MATCH,
    comps: { us: US.map((a) => ({ agent: a })), them: THEM.map((a) => ({ agent: a })) },
    game: { agent: 'Jett', map: 'Ascent', mode: 'Competitive', result: 'Victory', score: '13-9' }, grade: { score: 70 }, scoreline: { kills: 5, deaths: 3, assists: 1 },
    rounds: [{ n: 1, sideKey: 'attacking', result: 'lost', died: true, riot: { sec: 30, feed: [{ ms: 30000, by: 'enemy', on: 'me' }] }, forensics: { cause: 'isolated', clip: 'r1-clip.mkv', clipDeath: 2000 } }] } };
}

/** Main's half over a scripted server: answer(method, path, body) -> { ok, status, data }. */
function service(answer, o = {}) {
  let t = o.t0 || 1e12;
  const kept = { ...(o.kept || {}) };
  const calls = [];
  const dir = path.join(tmp, `s${Math.random().toString(16).slice(2)}`);
  const saved = o.saved || {};
  for (const id of Object.keys(saved)) { fs.mkdirSync(path.join(dir, id), { recursive: true }); fs.writeFileSync(path.join(dir, id, 'r1-clip.mkv'), CLIP); }
  const req = async (m, p, b) => { calls.push({ m, p, at: t }); return answer(m, p, b); };
  const svc = createDuos({
    api: { authHeaders: () => (o.headers || { Authorization: 'Bearer occ_x' }), get: (p) => req('GET', p), post: (p, b) => req('POST', p, b) },
    auth: {}, busy: () => false, now: () => t, peekStatus: o.peek === undefined ? (() => ({ live: true, duos: true, at: t })) : o.peek,
    reviews: { list: () => Object.values(saved).map((x) => ({ id: x.id, at: x.at, matchId: x.review.matchId })), get: (id) => saved[id] || null,
      hasClip: (x, n) => fs.existsSync(path.join(dir, x, n)), clipFile: (x, n) => path.join(dir, x, n) },
    store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } }, cacheDir: path.join(dir, 'cache'), fetch: o.fetch || (async () => ({ ok: true, status: 200 })), log: () => {},
  });
  return { svc, kept, calls, step: (ms) => { t += ms; }, now: () => t };
}
const OK = (data) => ({ ok: true, status: 200, data });
const ST = (status, data) => ({ ok: false, status, data: data || {} });
const REF = 'aaaaaaaaaaaaaaaa';
const REF2 = 'cccccccccccccccc';
const queued = (ids) => Object.fromEntries(ids.map(([ref, id]) => [ref, { review: id, partner: 'P', at: 1e12, sheet: 'wait', clips: {}, state: 'active' }]));

(async () => {
  // ── 1: the sheet ───────────────────────────────────────────────────────
  {
    for (const [status, why] of [[400, 'invalid'], [413, 'too-big']]) {
      const saved = { v1: savedOf('v1'), v2: savedOf('v2', { matchId: '8d2e4f60-3b5c-4d7e-9f10-23456789abcd' }) };
      const s = service((m, p, b) => {
        if (p.endsWith('/sheet')) return b.ref === REF ? ST(status, { ok: false, reason: why }) : OK({ ok: true, reason: null });
        if (p.endsWith('/clip/start')) return OK({ ok: true, stored: true, clip: 'bbbbbbbbbbbbbbbb' });
        return OK({ matches: [] });
      }, { saved, kept: { duoEngaged: true, duoEngagedAt: 1e12, duoQueue: queued([[REF, 'v1'], [REF2, 'v2']]) } });
      for (let i = 0; i < 10; i++) { s.step(MIN); await s.svc.tick(); }
      const sheets = s.calls.filter((c) => c.p.endsWith('/sheet') && c.m === 'POST').length;
      const q = s.kept.duoQueue;
      ok(sheets === 2 && q[REF].sheet === 'refused' && q[REF].sheetWhy === why && q[REF2].sheet === 'sent' && q[REF2].clips['r1-clip.mkv'].st === 'done'
        && /refused one match's sheet/.test(s.svc.uploadModel().line),
      `a sheet refused with ${status} is final for its match, said on the page, and the next match goes up`, { sheets, q });
    }
    const n429 = { left: 2 };
    const s = service((m, p) => {
      if (p.endsWith('/sheet')) { if (n429.left) { n429.left--; return ST(429, { error: 'rate-limited' }); } return OK({ ok: true }); }
      return p.endsWith('/clip/start') ? OK({ ok: true, stored: true, clip: 'bbbbbbbbbbbbbbbb' }) : OK({ matches: [] });
    }, { saved: { v1: savedOf('v1') }, kept: { duoEngaged: true, duoEngagedAt: 1e12, duoQueue: queued([[REF, 'v1']]) } });
    const at = [];
    for (let i = 0; i < 30; i++) { s.step(MIN); const before = s.calls.length; await s.svc.tick(); if (s.calls.slice(before).some((c) => c.p.endsWith('/sheet'))) at.push(i + 1); }
    ok(at.length === 3 && at[1] - at[0] >= 5 && s.kept.duoQueue[REF].sheet === 'sent', 'a 429 on the sheet backs off on its own time stamp, then goes', at);

    // sheetOf agrees with cleanSheet over every review the fixtures build.
    const corpus = [];
    corpus.push(['valorant-review-split-801', require('./fixtures/valorant-review-split-801.json')]);
    const pr = require('./fixtures/proof-reviews');
    const b = pr.build({ now: Date.now() });
    corpus.push(['proof built', { review: { ...b.built, kind: 'valorant' } }], ['proof looked', { review: { ...b.builtLooked, kind: 'valorant' } }]);
    for (const f of ['riot-abyss-13-11', 'riot-fracture-5-1', 'riot-split-13-7', 'riot-sunset-2-5']) {
      const riot = require(`./fixtures/${f}.json`);
      const { rounds } = verify.reconcile([], riot);
      // A scoreline that disagrees with Riot's rounds (a tracker counted early), and one that agrees.
      for (const riotMe of [{ kills: 3, deaths: 2, assists: 1 }, { kills: 99, deaths: 99, assists: 9 }]) {
        corpus.push([`${f} ${riotMe.kills}`, { review: { ...vreview.build({ rounds, context: { agent: 'Jett', map: 'Ascent' }, endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotMe, source: 'riot' }), kind: 'valorant' } }]);
      }
    }
    for (const f of ['audit-round3-reviews.json', 'audit-round3-after-reviews.json']) {
      const all = require(`./fixtures/${f}`).reviews;
      (Array.isArray(all) ? all : Object.values(all)).forEach((a, i) => {
        corpus.push([`${f}:${i}`, { review: { kind: 'valorant', source: 'watched', game: { agent: a.agent, map: a.map, score: a.score, result: a.result, mode: 'Competitive' },
          scoreline: a.scoreline, rounds: (a.rounds || []).map((r) => ({ n: r.n, sideKey: r.side, result: r.result, died: r.died, planted: r.planted, spot: r.deathSpot,
            riot: r.verified ? { sec: r.sec, killer: r.killer, weapon: r.weapon, traded: r.traded, alive: r.alive, firstDeath: r.firstDeath, firstKill: r.firstKill, kills: r.kills } : null })) } }]);
      });
    }
    // Made worse on purpose: the score behind the rounds, a C site on a two site map, a kill after the death.
    corpus.push(['worse', { review: { ...savedOf('w').review, game: { agent: 'Jett', map: 'Ascent', result: 'Victory', score: '0-1' }, scoreline: { kills: 0, deaths: 0, assists: 0 },
      rounds: [{ n: 1, result: 'won', died: true, planted: true, riot: { sec: 10, plantSite: 'C', feed: [{ ms: 40000, by: 'me', on: 'enemy' }, { ms: 10000, by: 'enemy', on: 'me' }] } },
        { n: 2, result: 'won', died: false, riot: {} }, { n: 3, result: 'won', died: false }] } }]);
    const refused = [];
    for (const [name, rv] of corpus) {
      const sheet = AD.sheetOf(rv);
      if (!sheet) { if (AD.agentOf(rv.review.game && rv.review.game.agent)) refused.push(`${name}: no sheet`); continue; }
      const c = SD.cleanSheet(sheet);
      if (!c.ok) refused.push(`${name}: ${c.error}`);
    }
    ok(corpus.length >= 60 && !refused.length, `sheetOf over ${corpus.length} reviews: the server takes every one it builds`, refused.slice(0, 5));
  }

  // ── 2: a clip start's answers ────────────────────────────────────────────
  {
    const outcome = async (answerStart) => {
      const s = service((m, p) => (p.endsWith('/clip/start') ? answerStart() : p.endsWith('/sheet') ? OK({ ok: true }) : OK({ matches: [] })),
        { saved: { v1: savedOf('v1') }, kept: { duoEngaged: true, duoEngagedAt: 1e12, duoQueue: queued([[REF, 'v1']]) } });
      s.step(MIN); await s.svc.tick(); s.step(MIN); await s.svc.tick();
      const it = s.kept.duoQueue[REF];
      return { it, slot: it && it.clips['r1-clip.mkv'], starts: s.calls.filter((c) => c.p.endsWith('/clip/start')).length };
    };
    const finals = { 'too-big': 'too-large', count: 'failed', issues: 'failed', clip: 'failed' };
    for (const [reason, st] of Object.entries(finals)) {
      const r = await outcome(() => OK({ ok: false, reason }));
      ok(r.slot && r.slot.st === st && r.starts === 1, `clip start '${reason}': final (${st}), never asked again`, r);
    }
    const gone = await outcome(() => OK({ ok: false, reason: 'none' }));
    ok(!gone.it, "clip start 'none' (no pair, expired): the match leaves the queue");
    for (const status of [429, 401, 403, 404, 500]) {
      const r = await outcome(() => ST(status, { error: 'x' }));
      ok(r.slot && r.slot.st === 'wait' && r.slot.waits >= 1 && r.slot.next > 0 && r.starts === 1, `clip start answered ${status}: counted, backed off, never final`, r.slot);
    }
  }

  // ── 3 and 4: what the tick asks ─────────────────────────────────────────
  {
    const day = async (s) => { for (let i = 0; i < 24 * 60; i++) { s.step(MIN); await s.svc.tick(); } return s.calls; };
    const off = service(() => OK({ live: true, duos: false }), { peek: () => ({ live: true, duos: false, at: 1e12 }), saved: { v1: savedOf('v1', { at: 1e12 }) } });
    ok((await day(off)).length === 0, 'Duos off: no request from the duos service in 24 hours, a review just saved included');
    const unknown = service(() => OK({}), { peek: () => ({ live: null, duos: false, at: 0 }) });
    ok((await day(unknown)).length === 0, 'Duos not yet known: no request either');
    const key = service(() => ST(403, {}), { headers: { 'X-License-Key': 'OCC-XXXX' } });
    ok((await day(key)).length === 0, 'a licence key alone (no session): nothing asked');
    for (const [status, most] of [[403, 1], [500, 12], [429, 12]]) {
      const s = service((m, p) => (p === '/api/social/duos/me' ? ST(status, { error: 'x' }) : OK({ live: true, duos: true })));
      const calls = await day(s);
      const me = calls.filter((c) => c.p === '/api/social/duos/me').length;
      ok(me >= 1 && me <= most, `GET /me answering ${status}: ${me} in a day (stamped on a 403, backed off 1, 5, 15, 60 minutes then daily otherwise)`, me);
    }
  }

  // ── 6: a failing report ────────────────────────────────────────────────
  {
    const saved = {};
    for (let i = 0; i < 12; i++) saved[`val-${i}`] = savedOf(`val-${i}`, { at: 1e12 - i * MIN, matchId: `7c1d3e5f-2a4b-4c6d-8e0f-1234567890${String(i).padStart(2, '0')}` });
    for (const status of [500, 429]) {
      const s = service((m, p) => (p.endsWith('/report') ? ST(status, { error: 'x' }) : OK({ matches: [] })), { saved, kept: { duoEngaged: true, duoEngagedAt: 1e12 } });
      const per = [];
      for (let h = 0; h < 24; h++) {
        const before = s.calls.filter((c) => c.p.endsWith('/report')).length;
        for (let m = 0; m < 60; m++) { s.step(MIN); await s.svc.tick(); }
        per.push(s.calls.filter((c) => c.p.endsWith('/report')).length - before);
      }
      ok(Math.max(...per) <= 20 && per.slice(4).every((x) => x === 0), `reports answered ${status}: at most 20 an hour, none after the pairing window`, per.join(' '));
    }
  }

  // ── 8: an invite this account was sent ───────────────────────────────────
  {
    const s = service((m, p) => (p === '/api/social/duos/me' ? OK({ me: { username: 'u', discoverable: false, partners: [], invitesIn: [{ username: 'Stranger' }], invitesOut: [] } }) : OK({})));
    s.step(MIN); await s.svc.tick();
    ok(s.kept.duoEngaged === false, 'an invite this account was SENT (by a stranger) does not make it engaged');
    const t = service((m, p) => (p === '/api/social/duos/me' ? OK({ me: { username: 'u', discoverable: false, partners: [], invitesIn: [], invitesOut: [{ ref: REF }] } }) : OK({})));
    t.step(MIN); await t.svc.tick();
    ok(t.kept.duoEngaged === true, 'an invite it sent does');
  }

  // ── 9: who pays; expiry of a cached clip ──────────────────────────────
  {
    const view = SD.meView({ username: 'a', max: false, partners: [{ username: 'Harrier', mine_max: false, their_max: true }] });
    ok(view.partners[0].state === 'active' && !('max' in view.partners[0]) && !/Harrier's Max/.test(AD.homeModel(view, []).partners[0].stateLine),
      'a partner is told the duo is active, never which side pays', view.partners[0]);
    const model = AD.matchModel(fx.MATCH);
    const reg = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'register-ipc.js'), 'utf8');
    const pre = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'duos-preload.js'), 'utf8');
    const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'duos', 'duos.js'), 'utf8');
    ok(model.expiresAt === fx.MATCH.expiresAt && /expiresAt: text\(o\.expiresAt/.test(reg) && /expiresAt: String\(\(x && x\.expiresAt\)/.test(pre) && /expiresAt: current\.expiresAt/.test(page),
      'the match\'s expiry goes from the page through the preload and the IPC to the cache');
    const dir = path.join(tmp, 'exp');
    const s = service((m, p) => (p.endsWith('/clip/url') ? OK({ ok: true, url: 'https://stand.in/clip/x', size: CLIP.length }) : OK({})),
      { fetch: fx.fetchClip });
    const soon = new Date(s.now() + 2 * MIN).toISOString();
    const r = await s.svc.openClip({ ref: REF, name: 'r1-clip.mkv', match: REF2, expiresAt: soon });
    s.svc.pruneCache(new Set([REF2]));
    const before = !!s.svc.cacheFile(REF, 'r1-clip.mkv');
    s.step(3 * MIN);
    s.svc.pruneCache(new Set([REF2]));
    ok(r.ok && before && !s.svc.cacheFile(REF, 'r1-clip.mkv'), 'a cached clip leaves when its MATCH expires, not 30 days after the download');
    void dir;
  }

  // ── 10b: a 400 whose body says 413 ───────────────────────────────────────
  {
    const s = service((m, p) => (p.endsWith('/clip/start') ? OK({ ok: true, stored: false, clip: 'bbbbbbbbbbbbbbbb', url: 'https://stand.in/up' }) : p.endsWith('/sheet') ? OK({ ok: true }) : OK({ matches: [] })),
      { saved: { v1: savedOf('v1') }, kept: { duoEngaged: true, duoEngagedAt: 1e12, duoQueue: queued([[REF, 'v1']]) },
        fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ statusCode: '413', error: 'Payload too large' }) }) });
    for (let i = 0; i < 3; i++) { s.step(MIN); await s.svc.tick(); }
    const slot = s.kept.duoQueue[REF].clips['r1-clip.mkv'];
    ok(slot.st === 'too-large' && s.calls.filter((c) => c.p.endsWith('/clip/start')).length === 1, 'a 400 with statusCode "413" in its body is too large, never retried', slot);
  }

  // ── 5, 7, 8, 9, 10a on the server ──────────────────────────────────────
  {
    const db = await pg.makeDb();
    const q1 = async (sql, a) => (await db.query(sql, a)).rows[0];
    for (let i = 1; i <= 6; i++) {
      await pg.addUser(db, U(i));
      await db.query('INSERT INTO public.social_profiles (user_id, username, username_key, username_fold, is_public) VALUES ($1,$2,$3,$3,true)', [U(i), `User${i}`, `user${i}`]);
    }
    await pg.setTier(db, U(1), 'max');
    const rpc = (n, a) => pg.rpc(db, n, a);
    // 7: the decline counts from the decline.
    const inv = () => rpc('social_duo_invite_name', { p_user: U(1), p_name: 'User2', p_key: 'user2', p_ttl_ms: 604800000, p_open_max: 10, p_partner_max: 5 });
    await inv();
    await db.query("UPDATE public.social_duo_invites SET created_at = now() - interval '6 days 23 hours'");
    await rpc('social_duo_decline', { p_user: U(2), p_from_key: 'user1' });
    await db.query("UPDATE public.social_duo_invites SET created_at = now() - interval '7 days 1 minute' WHERE status = 'declined'");
    await inv();
    ok((await q1("SELECT count(*)::int n FROM public.social_duo_invites WHERE to_user = $1 AND status = 'open'", [U(2)])).n === 0,
      'an invite made 7 days ago and declined an hour ago: the sender is held off 7 days from the DECLINE');
    // 8: an incoming invite does not make an account's report count.
    await pg.addGame(db, U(2));
    const rep = await rpc('social_duo_report', { p_user: U(2), p_match_hash: 'a'.repeat(64), p_team: 'Jett,Sova|Fade,Omen', p_agent: 'Jett', p_usage_hours: 4, p_window_ms: 10800000, p_report_days: 3, p_keep_days: 30 });
    await db.query("UPDATE public.social_duo_invites SET status = 'open', declined_at = NULL, to_user = $1 WHERE from_user = $2", [U(3), U(1)]);
    await pg.addGame(db, U(3));
    const rep3 = await rpc('social_duo_report', { p_user: U(3), p_match_hash: 'b'.repeat(64), p_team: 'Jett,Sova|Fade,Omen', p_agent: 'Jett', p_usage_hours: 4, p_window_ms: 10800000, p_report_days: 3, p_keep_days: 30 });
    ok(rep.reason === 'not-engaged' && rep3.reason === 'not-engaged', 'the server: an invite an account was SENT does not let it report', [rep, rep3]);
    // 9: a teammate never shown cannot be reported by name.
    for (const u of [4, 5]) { await pg.addGame(db, U(u)); await rpc('social_duo_set_discoverable', { p_user: U(u), p_on: u === 4 }); }
    await rpc('social_duo_report', { p_user: U(4), p_match_hash: 'c'.repeat(64), p_team: 'Jett,Sova|Fade,Omen', p_agent: 'Jett', p_usage_hours: 4, p_window_ms: 10800000, p_report_days: 3, p_keep_days: 30 });
    await db.query("INSERT INTO public.social_duo_reports (user_id, match_hash, team, agent, usage_id) VALUES ($1, repeat('c', 64), 'Jett,Sova|Fade,Omen', 'Sova', 'x')", [U(5)]);
    ok(await rpc('social_duo_report_target', { p_user: U(4), p_key: 'user5' }) === null, 'a teammate who reported the match but was never shown (not discoverable) cannot be reported by name');
    await rpc('social_duo_set_discoverable', { p_user: U(5), p_on: true });
    ok((await rpc('social_duo_report_target', { p_user: U(4), p_key: 'user5' })).username === 'User5', 'once both are discoverable and it is shown, it can');

    // 5 and 10a through the routes and the storage stand-in.
    const storage = createStorage({ buckets: { 'duo-clips': { fileSizeLimit: SD.DUO.CLIP_MAX_BYTES, allowedMimeTypes: ['video/x-matroska'] } } });
    await storage.listen();
    const store = SD.createStore({ rpc: pg.supabaseOf(db).rpc, storage });
    let clock = Date.now();
    const router = duoRoutes.createRouter({ store, env: { SOCIAL_ON: '1', SOCIAL_DUOS_ON: '1' }, log: () => {}, now: () => clock,
      resolver: { identify: async (req) => { const m = /occ_(\d)/.exec(String(req.headers.authorization || '')); return m ? { status: 'valid', caller: { userId: U(Number(m[1])), via: 'session' } } : { status: 'none' }; } } });
    const app = express();
    app.use(express.json());
    app.use('/api/social/duos', router);
    const server = await new Promise((res) => { const sv = http.createServer(app).listen(0, '127.0.0.1', () => res(sv)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (p, b, tok) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
    try {
      await db.query('INSERT INTO public.social_duo_pairs (user_a, user_b) VALUES ($1, $2)', [U(1), U(6)]);
      const pair = await q1('SELECT id FROM public.social_duo_pairs WHERE user_b = $1', [U(6)]);
      await db.query("INSERT INTO public.social_duo_matches (pair_id, match_hash, played_at, expires_at) VALUES ($1, repeat('d', 64), now(), now() + interval '30 days')", [pair.id]);
      const mref = (await q1('SELECT ref FROM public.social_duo_matches WHERE pair_id = $1', [pair.id])).ref;
      // 10a: a file that grew after it was settled.
      const st = await post('/api/social/duos/clip/start', { ref: mref, name: 'r1-clip.mkv', round: 1, kind: 'death', marks: {} }, 'occ_6');
      await fetch(st.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: CLIP });
      await post('/api/social/duos/clip/done', { clip: st.data.clip }, 'occ_6');
      const key = [...storage.objects.keys()][0];
      storage.objects.get(key).bytes = Buffer.concat([CLIP, Buffer.alloc(1000)]);
      const url = await post('/api/social/duos/clip/url', { clip: st.data.clip }, 'occ_1');
      ok(url.status === 404 && !storage.objects.has(key) && (await q1('SELECT count(*)::int n FROM public.social_duo_clips WHERE ref = $1', [st.data.clip])).n === 0,
        'a stored file that grew after it was settled: no URL, the file and its row deleted');
      // 5: a dropped upload's path is kept 26 hours; a file landing late is removed by the reconciliation.
      const st2 = await post('/api/social/duos/clip/start', { ref: mref, name: 'r2-clip.mkv', round: 2, kind: 'death', marks: {} }, 'occ_6');
      const path2 = (await q1('SELECT path FROM public.social_duo_clips WHERE ref = $1', [st2.data.clip])).path;
      await db.query("UPDATE public.social_duo_clips SET issued_at = now() - interval '2 hours 11 minutes' WHERE ref = $1", [st2.data.clip]);
      await router.sweep(50);
      const kept = await q1('SELECT not_before FROM public.social_duo_trash WHERE path = $1', [path2]);
      ok(kept && new Date(kept.not_before) - Date.now() > 23 * 3600000, 'a dropped upload\'s path stays in the trash until 26 hours after its issue', kept);
      // The PUT lands late, after every row and trash row is gone.
      await db.query('DELETE FROM public.social_duo_trash');
      storage.put('duo-clips', path2, CLIP, 'video/x-matroska', Date.now() - 27 * 3600000);
      storage.put('duo-clips', 'eeeeeeeeeeeeeeee/ffffffffffffffff/aaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb-r3-clip.mkv', CLIP, 'video/x-matroska', Date.now() - 2 * 3600000);
      const st3 = await post('/api/social/duos/clip/start', { ref: mref, name: 'r3-clip.mkv', round: 3, kind: 'death', marks: {} }, 'occ_6');
      await fetch(st3.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: CLIP });
      const live3 = (await q1('SELECT path FROM public.social_duo_clips WHERE ref = $1', [st3.data.clip])).path;
      storage.objects.get(`duo-clips/${live3}`).at = Date.now() - 40 * 3600000;
      for (let i = 0; i < 6; i++) await router.sweep(50);
      ok(!storage.objects.has(`duo-clips/${path2}`) && storage.objects.has('duo-clips/eeeeeeeeeeeeeeee/ffffffffffffffff/aaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb-r3-clip.mkv')
        && storage.objects.has(`duo-clips/${live3}`), 'the reconciliation removes a late landed file no row holds once a day old, keeps a younger one and a live one');
    } finally {
      server.close();
      storage.close();
    }
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left for the OS */ }
  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
