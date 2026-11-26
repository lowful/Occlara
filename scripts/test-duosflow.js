'use strict';

/**
 * OCCLARA DUOS, THE REVIEW OF 25 NOV (docs/claude/duos.md): one case for each
 * finding of the independent review, on the real routes, the real SQL
 * (PGlite), the Supabase Storage stand-in and two real copies of main's half:
 *   1  a stored clip cannot be overwritten through its upload URL; done and
 *      a retry settle from the size STORAGE reports; the bucket never holds
 *      more than was charged
 *   2  whoever reports first uploads too, in both orders, and when the second
 *      report lands late in the window; past the window nothing pairs
 *   3  a download URL lives DOWNLOAD_URL_SEC, and the day's URLs are counted
 *   5  an account that opted in to nothing makes no duo request after a match
 *   6  Discoverable under 8.19's words reads off; an invite by name reaches
 *      public profiles only
 *   8  a partner's clips leave the cache on the tick: a block, signed out, not
 *      live, a stray .part
 *   9  a download running when a match starts is aborted, nothing kept
 *   10 Block and Report on invite and found rows; a report of a real found
 *      teammate is filed
 *   12 the status is reused from 8.19's answer, and asked at most every 15
 *      minutes while Duos is not live; Duos has its own overall limit
 *   13 a clip the server refuses as too large (413) is never retried
 *   14 an outsider with a valid ref gets nothing from any route
 *
 * No network beyond localhost. Run: npm run test:duosflow
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
const SS = require(path.join(ROOT, 'server', 'services', 'social.js'));
const duoRoutes = require(path.join(ROOT, 'server', 'routes', 'duos.js'));
const socialRoutes = require(path.join(ROOT, 'server', 'routes', 'social.js'));
const rateLimits = require(path.join(ROOT, 'server', 'services', 'rate-limits.js'));
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
const MATCHES = ['1c1d3e5f-2a4b-4c6d-8e0f-123456789abc', '2c1d3e5f-2a4b-4c6d-8e0f-123456789abc', '3c1d3e5f-2a4b-4c6d-8e0f-123456789abc',
  '4c1d3e5f-2a4b-4c6d-8e0f-123456789abc', '5c1d3e5f-2a4b-4c6d-8e0f-123456789abc'];
const US = ['Jett', 'Sova', 'Omen', 'Sage', 'Breach'];
const THEM = ['Fade', 'Raze', 'Killjoy', 'Cypher', 'Reyna'];
const CLIP = fs.readFileSync(fx.CLIP);
const MKV64 = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60)]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (app) => new Promise((res) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => res({ server: s, base: `http://127.0.0.1:${s.address().port}` })); });

function reviewOf(id, matchId, agent) {
  return { id, at: Date.now() - 600000, game: 'valorant', review: { kind: 'valorant', source: 'watched', matchId,
    comps: { us: US.map((a) => ({ agent: a })), them: THEM.map((a) => ({ agent: a })) },
    game: { agent, map: 'Ascent', mode: 'Competitive', result: 'Victory', score: '13-9' }, grade: { score: 70 }, scoreline: { kills: 5, deaths: 3, assists: 1 },
    rounds: [{ n: 1, sideKey: 'attacking', result: 'lost', died: true, riot: { sec: 30, feed: [{ ms: 30000, by: 'enemy', on: 'me' }] }, forensics: { cause: 'isolated', clip: 'r1-clip.mkv', clipDeath: 2000 } }] } };
}

(async () => {
  const db = await pg.makeDb();
  const sql = (q, p) => db.query(q, p);
  for (let i = 1; i <= 12; i++) await pg.addUser(db, U(i));
  const storage = createStorage({ buckets: { 'duo-clips': { fileSizeLimit: SD.DUO.CLIP_MAX_BYTES, allowedMimeTypes: ['video/x-matroska'] } } });
  await storage.listen();
  const store = SD.createStore({ rpc: pg.supabaseOf(db).rpc, storage });
  const resolver = { identify: async (req) => {
    const t = String(req.headers.authorization || '').replace('Bearer ', '');
    const m = /^occ_(\d+)$/.exec(t);
    return m ? { status: 'valid', caller: { userId: U(Number(m[1])), accountKey: `u:${U(Number(m[1]))}`, via: 'session' } } : { status: 'none' };
  } };
  const ON = { SOCIAL_ON: '1', SOCIAL_DUOS_ON: '1', ACCOUNT_HASH_SALT: 'flow-salt' };
  const filed = [];
  const router = duoRoutes.createRouter({ store, resolver, env: ON, log: () => {}, reports: { insert: async (row) => { filed.push(row); } } });
  const app = express();
  app.use(express.json());
  app.use('/api/social/duos', router);
  app.use('/api/social', socialRoutes.createRouter({ store: SS.createStore(pg.supabaseOf(db)), resolver, env: ON, log: () => {}, duos: router }));
  const { server, base } = await listen(app);
  const calls = [];
  async function req(method, p, tok, body) {
    calls.push({ tok, p: p.split('?')[0] });
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }
  const post = (p, b, tok) => req('POST', p, tok, b);
  const get = (p, tok) => req('GET', p, tok);
  const names = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Gum', 'Hazel', 'Ivy', 'Juniper', 'Kapok', 'Larch'];
  for (let i = 1; i <= 12; i++) await post('/api/social/username', { name: names[i - 1] }, `occ_${i}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duosflow-'));

  /** Main's half for one account, its review of `matchId` with a clip on disk. */
  function app_(n, matchId, agent, o = {}) {
    const tok = `occ_${n}`;
    const dir = path.join(tmp, `${n}-${matchId.slice(0, 2)}`);
    const id = `val-17000000000${n}-${matchId.slice(0, 4)}`;
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, 'r1-clip.mkv'), o.clip || CLIP);
    const saved = reviewOf(id, matchId, agent);
    const kept = {};
    let clock = Date.now();
    const api = { authHeaders: () => (o.signedOut && o.signedOut() ? {} : { Authorization: tok }), get: (p) => req('GET', p, tok), post: (p, b) => req('POST', p, tok, b) };
    const svc = createDuos({ api, auth: {}, busy: o.busy || (() => false), now: () => clock,
      reviews: { list: () => [{ id, at: saved.at, matchId }], get: (x) => (x === id ? saved : null), hasClip: (x, nm) => fs.existsSync(path.join(dir, x, nm)), clipFile: (x, nm) => path.join(dir, x, nm) },
      store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } }, cacheDir: path.join(dir, 'cache'), fetch: o.fetch || ((u, x) => fetch(u, x)), peekStatus: o.peekStatus, log: () => {} });
    return { svc, kept, tok, dir, advance: (ms) => { clock += ms; }, clockNow: () => clock };
  }
  const pairUp = async (a, b, code) => {
    await pg.setTier(db, U(a), 'max');
    const c = await post('/api/social/duos/code', {}, `occ_${a}`);
    return post('/api/social/duos/accept', { code: c.data.code }, `occ_${b}`);
  };
  const clipsBy = async (n, matchHash) => (await sql(`SELECT c.status FROM public.social_duo_clips c JOIN public.social_duo_matches m ON m.id = c.match_id
    WHERE c.user_id = $1 AND m.match_hash = $2`, [U(n), matchHash])).rows.map((x) => x.status);
  const hashOf = (id) => SD.matchHash(id, ON);

  try {
    // ── 2: whoever reports first uploads too ──────────────────────────────
    await pairUp(1, 2);
    for (const [first, second, m] of [[1, 2, MATCHES[0]], [2, 1, MATCHES[1]]]) {
      for (const n of [first, second]) await pg.addGame(db, U(n));
      const A = app_(first, m, 'Jett');
      const B = app_(second, m, 'Sova');
      await A.svc.tick();
      await B.svc.tick();
      A.advance(61000);
      await A.svc.tick();
      const a = await clipsBy(first, hashOf(m));
      const b = await clipsBy(second, hashOf(m));
      ok(a.join() === 'stored' && b.join() === 'stored', `the first reporter (${names[first - 1]}) uploads too, after the second pairs the match`, { a, b, q: A.kept.duoQueue });
    }
    // Late in the window: the partner reports 2.5 hours after.
    {
      const m = MATCHES[2];
      for (const n of [1, 2]) await pg.addGame(db, U(n));
      const A = app_(1, m, 'Jett');
      await A.svc.tick();
      await sql("UPDATE public.social_duo_reports SET at = now() - interval '150 minutes' WHERE match_hash = $1", [hashOf(m)]);
      A.advance(150 * 60000);
      const B = app_(2, m, 'Sova');
      await B.svc.tick();
      A.advance(61000);
      await A.svc.tick();
      ok((await clipsBy(1, hashOf(m))).join() === 'stored', 'a partner\'s report 2.5 hours after: the first still uploads');
      const pending = Object.values(A.kept.duoReported)[0];
      ok(pending && pending.pending === true, 'and keeps asking until the window passes', pending);
      A.advance(40 * 60000);
      await A.svc.tick();
      ok(Object.values(A.kept.duoReported)[0].done === true, 'then stops asking');
    }
    // Past the window nothing pairs.
    {
      const m = MATCHES[3];
      for (const n of [1, 2]) await pg.addGame(db, U(n));
      await post('/api/social/duos/report', { matchId: m, us: US, them: THEM, agent: 'Jett' }, 'occ_1');
      await sql("UPDATE public.social_duo_reports SET at = now() - interval '200 minutes' WHERE match_hash = $1", [hashOf(m)]);
      const late = await post('/api/social/duos/report', { matchId: m, us: US, them: THEM, agent: 'Sova' }, 'occ_2');
      ok(late.data.ok && late.data.matches.length === 0, 'a report more than 3 hours after the other pairs with nothing');
    }
    // Re-reporting costs no second live game.
    const games1 = (await sql("SELECT count(*)::int n FROM public.social_duo_reports WHERE user_id = $1", [U(1)])).rows[0].n;
    for (let i = 0; i < 3; i++) await post('/api/social/duos/report', { matchId: MATCHES[0], us: US, them: THEM, agent: 'Jett' }, 'occ_1');
    ok((await sql("SELECT count(*)::int n FROM public.social_duo_reports WHERE user_id = $1", [U(1)])).rows[0].n === games1, 'a report sent again spends no second live game');

    // ── 1: no overwrite, settled from storage ──────────────────────────────
    {
      const mref = (await sql('SELECT ref FROM public.social_duo_matches WHERE match_hash = $1', [hashOf(MATCHES[0])])).rows[0].ref;
      const st = await post('/api/social/duos/clip/start', { ref: mref, name: 'r5-clip.mkv', round: 5, kind: 'death', marks: {} }, 'occ_2');
      const put1 = await fetch(st.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: MKV64 });
      const done = await post('/api/social/duos/clip/done', { clip: st.data.clip }, 'occ_2');
      const big = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20 * 1024 * 1024)]);
      const put2 = await fetch(st.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: big });
      const key = [...storage.objects.keys()].find((k) => k.endsWith('r5-clip.mkv'));
      const charged = Number((await sql("SELECT bytes FROM public.social_duo_bytes WHERE user_id = $1 AND dir = 'up' AND clip_id = (SELECT id FROM public.social_duo_clips WHERE ref = $2)", [U(2), st.data.clip])).rows[0].bytes);
      ok(put1.ok && done.data.ok && put2.status === 409 && storage.objects.get(key).bytes.length === 64 && charged === 64,
        'the upload URL writes a path once: a bigger file through it again is refused, and the 64 bytes stored are what was charged', [put2.status, charged]);
      // A retry of a clip whose file landed but whose done never came: settled from storage, no new URL.
      const st2 = await post('/api/social/duos/clip/start', { ref: mref, name: 'r6-clip.mkv', round: 6, kind: 'death', marks: {} }, 'occ_2');
      await fetch(st2.data.url, { method: 'PUT', headers: { 'Content-Type': 'video/x-matroska' }, body: MKV64 });
      const signs = storage.calls.filter((c) => c.op === 'signUpload').length;
      const retry = await post('/api/social/duos/clip/start', { ref: mref, name: 'r6-clip.mkv', round: 6, kind: 'death', marks: {} }, 'occ_2');
      ok(retry.data.stored === true && retry.data.url === null && storage.calls.filter((c) => c.op === 'signUpload').length === signs,
        'a retry of a clip whose file is already there: settled from storage, no new URL', retry.data);
      // The bound: every byte in the bucket of this account was charged.
      const inBucket = [...storage.objects.values()].reduce((n, v) => n + v.bytes.length, 0);
      const chargedAll = Number((await sql("SELECT COALESCE(sum(bytes), 0)::bigint n FROM public.social_duo_bytes WHERE dir = 'up'")).rows[0].n);
      ok(inBucket <= chargedAll && chargedAll <= 2 * SD.DUO.UPLOAD_BYTES, 'every byte in the bucket is charged to someone\'s 2 GB', [inBucket, chargedAll]);
    }

    // ── 3: download URLs ─────────────────────────────────────────────────
    {
      const anyClip = (await sql("SELECT c.ref FROM public.social_duo_clips c WHERE c.user_id = $1 AND c.status = 'stored' LIMIT 1", [U(2)])).rows[0].ref;
      const d = await post('/api/social/duos/clip/url', { clip: anyClip }, 'occ_1');
      const sign = storage.calls.filter((c) => c.op === 'signDownload').pop();
      ok(d.data.ok && sign.expiresIn === SD.DUO.DOWNLOAD_URL_SEC && SD.DUO.DOWNLOAD_URL_SEC <= 10, `a download URL lives ${SD.DUO.DOWNLOAD_URL_SEC} seconds`, sign);
      storage.tokens.forEach((v) => { if (v.kind === 'down') v.exp = Date.now() - 1; });
      ok((await fetch(d.data.url)).status === 400, 'and is refused once it has run out');
    }

    // ── 14: an outsider with a valid ref ─────────────────────────────────
    {
      const mref = (await sql('SELECT ref FROM public.social_duo_matches WHERE match_hash = $1', [hashOf(MATCHES[0])])).rows[0].ref;
      const clip = (await sql("SELECT ref FROM public.social_duo_clips WHERE user_id = $1 AND status = 'stored' LIMIT 1", [U(2)])).rows[0].ref;
      const issued = (await post('/api/social/duos/clip/start', { ref: mref, name: 'r9-clip.mkv', round: 9, kind: 'death', marks: {} }, 'occ_1')).data.clip;
      const pin = (await post('/api/social/duos/pin', { clip, at: 100, label: 'nice-shot', reaction: null }, 'occ_1')).data.ref;
      const out = (await sql("SELECT ref FROM public.social_duo_invites WHERE from_user = $1 AND status = 'open' LIMIT 1", [U(1)])).rows[0];
      await pg.setTier(db, U(1), 'max');
      const inviteRef = out ? out.ref : (await post('/api/social/duos/code', {}, 'occ_1'), (await sql("SELECT ref FROM public.social_duo_invites WHERE from_user = $1 AND status = 'open' LIMIT 1", [U(1)])).rows[0].ref);
      const x = 'occ_9';
      const r = {
        match: await get(`/api/social/duos/match?ref=${mref}`, x),
        sheet: await post('/api/social/duos/sheet', { ref: mref, sheet: fx.MINE }, x),
        start: await post('/api/social/duos/clip/start', { ref: mref, name: 'r9-clip.mkv', round: 9, kind: 'death', marks: {} }, x),
        done: await post('/api/social/duos/clip/done', { clip: issued }, x),
        url: await post('/api/social/duos/clip/url', { clip }, x),
        pin: await post('/api/social/duos/pin', { clip, at: 100, label: 'nice-shot', reaction: null }, x),
      };
      await post('/api/social/duos/pin/remove', { ref: pin }, x);
      await post('/api/social/duos/cancel', { ref: inviteRef }, x);
      const pinLeft = (await sql('SELECT count(*)::int n FROM public.social_duo_pins WHERE ref = $1', [pin])).rows[0].n;
      const invLeft = (await sql("SELECT status FROM public.social_duo_invites WHERE ref = $1", [inviteRef])).rows[0].status;
      const issuedRow = (await sql('SELECT status FROM public.social_duo_clips WHERE ref = $1', [issued])).rows[0].status;
      ok(r.match.status === 404 && r.sheet.data.reason === 'none' && r.start.data.reason === 'none' && r.done.status === 404 && r.url.status === 404
        && r.pin.data.ok === false && pinLeft === 1 && invLeft === 'open' && issuedRow === 'issued',
      'an outsider with a valid ref: nothing from the match, the sheet, a clip start, done, a URL, a pin, a pin removal or an invite\'s cancel', Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status])));
    }

    // ── 5: opted in to nothing, no duo request after a match ─────────────
    {
      await pg.addGame(db, U(11));
      const L = app_(11, MATCHES[4], 'Omen');
      await L.svc.tick();   // learns, once, that this account opted in to nothing
      const before = calls.filter((c) => c.tok === 'occ_11' && c.p.startsWith('/api/social/duos')).length;
      L.advance(5 * 60000);
      await L.svc.tick();
      await L.svc.tick();
      const after = calls.filter((c) => c.tok === 'occ_11' && c.p.startsWith('/api/social/duos')).length;
      const kept = (await sql('SELECT count(*)::int n FROM public.social_duo_reports WHERE user_id = $1', [U(11)])).rows[0].n;
      ok(before === 1 && after === before && kept === 0, 'an account with no duo, no invite, not discoverable: after a match, no duo request and nothing kept', [before, after, kept]);
      const refused = await post('/api/social/duos/report', { matchId: MATCHES[4], us: US, them: THEM, agent: 'Omen' }, 'occ_11');
      ok(refused.data.reason === 'not-engaged' && (await sql('SELECT count(*)::int n FROM public.social_duo_reports WHERE user_id = $1', [U(11)])).rows[0].n === 0,
        'and a modified app reporting anyway is refused, nothing kept');
    }

    // ── 6: consent and invites by name ───────────────────────────────────
    {
      await post('/api/social/flags', { discoverable: true }, 'occ_12');
      ok((await get('/api/social/duos/discoverable', 'occ_12')).data.on === false, 'Discoverable set through 8.19\'s route reads off for Duos');
      await post('/api/social/duos/discoverable', { on: true }, 'occ_12');
      ok((await get('/api/social/duos/discoverable', 'occ_12')).data.on === true, 'turned on through Duos it counts');
      await post('/api/social/duos/invite', { name: 'Larch' }, 'occ_1');
      ok((await get('/api/social/duos/me', 'occ_12')).data.me.invitesIn.length === 0, 'a private profile, discoverable or not, is never reached by an invite by name');
    }

    // ── 10: a found teammate can be reported; Block and Report on rows ───
    {
      await post('/api/social/duos/discoverable', { on: true }, 'occ_5');
      await post('/api/social/duos/discoverable', { on: true }, 'occ_6');
      for (const n of [5, 6]) await pg.addGame(db, U(n));
      await post('/api/social/duos/report', { matchId: MATCHES[4], us: US, them: THEM, agent: 'Jett' }, 'occ_5');
      const f = await post('/api/social/duos/report', { matchId: MATCHES[4], us: US, them: THEM, agent: 'Sova' }, 'occ_6');
      ok(f.data.found.map((x) => x.username).join() === 'Elm', 'found', f.data);
      const n0 = filed.length;
      const r1 = await post('/api/social/duos/flag', { name: 'Elm', reason: 'username' }, 'occ_6');
      const r2 = await post('/api/social/duos/flag', { name: 'Kapok', reason: 'username' }, 'occ_6');
      ok(r1.data.ok && r2.data.ok && JSON.stringify(r1.data) === JSON.stringify(r2.data) && filed.length === n0 + 1 && /username Elm/.test(filed[filed.length - 1].text),
        'a report of a found teammate IS filed; a stranger\'s is answered alike and not filed');
      const { loadSurface, settle } = require('./fixtures/fake-dom');
      const CH = require(path.join(ROOT, 'src', 'shared', 'channels.js'));
      const AD = require(path.join(ROOT, 'src', 'shared', 'duos.js'));
      const q = loadSurface('duos', { handlers: { [CH.DUOS_STATE]: () => ({ duos: true, problem: null, home: AD.homeModel(fx.ME, fx.MATCHES), upload: { on: true, line: '' } }) } });
      await settle(); await settle();
      const rowActs = (sel) => q.document.querySelectorAll(`${sel} li`).map((li) => li.querySelectorAll('button').map((b) => b.textContent).join('|'));
      const inv = rowActs('#du-invites')[0];
      const found = rowActs('#du-found')[0];
      ok(/Block/.test(inv) && /Report/.test(inv) && /Block/.test(found) && /Report/.test(found), 'an incoming invite and a teammate found each have Block and Report', [inv, found]);
    }

    // ── 8 and 9: the cache, the download mid match ───────────────────────
    {
      const m = MATCHES[0];
      let busy = false;
      let slow = 0;
      const B = app_(2, m, 'Sova', { busy: () => busy, fetch: async (u, o) => { if (slow) await new Promise((res, rej) => { const t = setTimeout(res, slow); o.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }); return fetch(u, o); } });
      await B.svc.state();
      const mref = (await sql('SELECT ref FROM public.social_duo_matches WHERE match_hash = $1', [hashOf(m)])).rows[0].ref;
      const theirs = (await sql("SELECT ref, name FROM public.social_duo_clips WHERE user_id = $1 AND status = 'stored' AND match_id = (SELECT id FROM public.social_duo_matches WHERE ref = $2) LIMIT 1", [U(1), mref])).rows[0];
      slow = 1500;
      const opening = B.svc.openClip({ ref: theirs.ref, name: theirs.name, match: mref });
      await wait(300);
      busy = true;
      const midMatch = await opening;
      busy = false;
      slow = 0;
      ok(midMatch === null && !B.svc.cacheFile(theirs.ref, theirs.name) && fs.readdirSync(path.join(B.dir, 'cache')).every((f) => !f.endsWith('.mkv')),
        'a download running when a match starts is aborted at once, nothing kept');
      const opened = await B.svc.openClip({ ref: theirs.ref, name: theirs.name, match: mref });
      fs.writeFileSync(path.join(B.dir, 'cache', 'deadbeefdeadbeef-x.part'), 'crash');
      ok(opened.ok && B.svc.cacheFile(theirs.ref, theirs.name), 'opened after the match: cached');
      await B.svc.tick();
      ok(!fs.existsSync(path.join(B.dir, 'cache', 'deadbeefdeadbeef-x.part')), 'a stray .part a crash left is swept on the tick');
      // A block: the tick prunes it (no page opened), within PRUNE_MS.
      await post('/api/social/block', { name: 'Alder', on: true }, 'occ_2');
      B.advance(11 * 60000);
      await B.svc.tick();
      ok(!B.svc.cacheFile(theirs.ref, theirs.name), 'blocked: the partner\'s clip leaves the cache on the tick');
      // Signed out: everything goes, nothing asked.
      let out = false;
      const C = app_(1, MATCHES[1], 'Jett', { signedOut: () => out });
      fs.mkdirSync(path.join(C.dir, 'cache'), { recursive: true });
      fs.writeFileSync(path.join(C.dir, 'cache', 'index.json'), JSON.stringify({ entries: { aaaaaaaaaaaaaaaa: { name: 'r1-clip.mkv', match: 'bbbbbbbbbbbbbbbb', bytes: 3, at: Date.now() } } }));
      fs.writeFileSync(path.join(C.dir, 'cache', 'aaaaaaaaaaaaaaaa-r1-clip.mkv'), 'abc');
      out = true;
      const n0 = calls.length;
      await C.svc.tick();
      ok(!fs.existsSync(path.join(C.dir, 'cache', 'aaaaaaaaaaaaaaaa-r1-clip.mkv')) && calls.length === n0, 'signed out: every cached clip goes, nothing asked');
    }

    // ── 12: the status, reused and backed off ────────────────────────────
    {
      const counted = [];
      const offApi = { authHeaders: () => ({ Authorization: 'x' }), get: async (p) => { counted.push(p); return { ok: true, status: 200, data: { live: false, riotProof: false, duos: false } }; }, post: async () => ({ ok: false, status: 503, data: {} }) };
      let clock = Date.now();
      const kept = { duoEngaged: true, duoEngagedAt: clock };
      const s = createDuos({ api: offApi, auth: {}, now: () => clock, store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } } });
      for (let i = 0; i < 10; i++) { await s.tick(); clock += 60000; }
      ok(counted.length === 1, 'Duos not live: ten ticks a minute apart ask the status once', counted.length);
      clock += 6 * 60000;
      await s.tick();
      ok(counted.length === 2, 'and again after 15 minutes');
      const peeked = [];
      const p2 = createDuos({ api: { ...offApi, get: async (p) => { peeked.push(p); return offApi.get(p); } }, auth: {}, now: () => clock,
        peekStatus: () => ({ live: true, duos: false, at: clock }), store: { get: (k) => kept[k], set: (k, v) => { kept[k] = v; } } });
      await p2.tick();
      ok(peeked.filter((p) => p === '/api/social/status').length === 0, '8.19\'s fresh answer is reused: no status request of its own');
      const lim = rateLimits.routeLimits({});
      const social = lim.find((x) => x.mw.limits.name === 'social');
      const skipped = await new Promise((res) => {
        const reqd = { originalUrl: '/api/social/duos/me', ip: '1.2.3.4', caller: { accountKey: 'u:z' } };
        let n = 0;
        for (let i = 0; i < 300; i++) social.mw(reqd, { status: () => ({ json: () => {} }), set() {} }, () => { n++; });
        res(n);
      });
      ok(skipped === 300 && lim.some((x) => x.mw.limits.name === 'social-duos'), 'Duos\' calls are not counted against the profiles and search budget; they have their own');
    }

    // ── 13: too large for the server, never retried ──────────────────────
    {
      await pg.setTier(db, U(3), 'max');
      const c = await post('/api/social/duos/code', {}, 'occ_3');
      await post('/api/social/duos/accept', { code: c.data.code }, 'occ_4');
      const m = '6c1d3e5f-2a4b-4c6d-8e0f-123456789abc';
      for (const n of [3, 4]) await pg.addGame(db, U(n));
      let puts = 0;
      const A = app_(3, m, 'Jett', { fetch: async (u, o) => { if (o && o.method === 'PUT') { puts++; return { ok: false, status: 413 }; } return fetch(u, o); } });
      const B = app_(4, m, 'Sova');
      await A.svc.tick(); await B.svc.tick(); A.advance(61000); await A.svc.tick();
      for (let i = 0; i < 4; i++) { A.advance(61000); await A.svc.tick(); }
      const slot = Object.values(A.kept.duoQueue)[0].clips['r1-clip.mkv'];
      ok(puts === 1 && slot.st === 'too-large' && /too large for the server/.test(A.svc.uploadModel().line), 'a 413 from the server: the clip is said too large and never tried again', [puts, slot]);
    }
  } finally {
    server.close();
    storage.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left for the OS */ }
  }

  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
