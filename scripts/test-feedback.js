'use strict';

/**
 * test:feedback. Report a problem (docs/claude/feedback.md), held to its rules:
 *
 *   - the server's numbers and the app's are the same (server/services/
 *     feedback.js and src/shared/feedback.js, which cannot require each other)
 *   - POST /api/feedback over real http with a fake store: auth required, an
 *     outage 503, every field validated, control characters, bidi marks and
 *     angle brackets taken out, the body cap (413), 5 an hour and 20 a day per
 *     account (429), a missing table or bucket a calm 503 and no half report,
 *     the account kept as an id and never the licence key
 *   - the Discord ping: skipped silently when unset, no mention can ping, the
 *     first 300 characters and the id, and the URL scrubbed from every error
 *   - the admin routes: the password, the list with signed URLs, the mark
 *   - the triage script (scripts/feedback-inbox.js) against a fake admin route
 *   - main's service: every picture checked, downscaled to 1600 px and
 *     recompressed, the words scrubbed of the Riot ID, keys and emails, the
 *     review only when ticked, every answer a finished sentence, and all of
 *     it refused mid match (the seal)
 *   - the page's wiring, in the fake DOM: kind, words, pictures by drop and
 *     paste, Send, the thank you; the preload, the channels, the shell's
 *     button above the Discord
 *   - feedback.sql's text, when it is at hand (OCCLARA_FEEDBACK_SQL)
 *
 * Run: npm run test:feedback
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const C = require('../src/shared/channels');
const F = require('../src/shared/feedback');
const nav = require('../src/shared/shell-nav');
const { createFeedback } = require('../src/main/services/feedback-service');
const { loadSurface, loadPreload, settle, Document } = require('./fixtures/fake-dom');
const express = require(path.join(ROOT, 'server', 'node_modules', 'express'));
const fb = require('../server/services/feedback');
const routes = require('../server/routes/feedback');
const rateLimits = require('../server/services/rate-limits');
const inbox = require('./feedback-inbox');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && !DASHES.test('a-b'), 'the dash detector finds a dash and passes a hyphen');

// A real JPEG's first bytes, then filler: what the server sniffs.
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(2000, 3)]);
const good = (extra) => ({ kind: 'broke', text: 'The review never opened after my match ended.', version: '8.8.0', os: 'Windows 11 Home 10.0.26200', game: 'valorant', reviewId: null, images: [], ...extra });

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
async function call(base, p, { method = 'POST', body, headers = {} } = {}) {
  const res = await fetch(`${base}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, headers: res.headers };
}

function fakeStore(over = {}) {
  const s = {
    rows: [], files: new Map(), removed: [], marks: [],
    async insert(row) { if (over.insert) return over.insert(row); s.rows.push(row); },
    async upload(p, buf) { if (over.upload) return over.upload(p, buf); s.files.set(p, buf); },
    async remove(id) { s.removed.push(id); s.rows = s.rows.filter((r) => r.id !== id); },
    async list({ status, limit }) { return s.rows.filter((r) => !status || r.status === status).slice(0, limit).map((r) => ({ created_at: '2026-11-06T10:00:00Z', ...r })); },
    async signedUrl(p) { return over.signedUrl ? over.signedUrl(p) : `https://example.supabase.co/storage/v1/object/sign/feedback/${p}?token=t`; },
    async mark(id, status, note) { s.marks.push([id, status, note]); const r = s.rows.find((x) => x.id === id); if (!r) return 0; r.status = status; if (note !== null) r.notes = note; return 1; },
  };
  return s;
}
const notLive = (what) => { const e = new Error(`${what}: relation missing`); e.notLive = true; throw e; };

(async () => {
  // ── 1. The two copies of the numbers ──────────────────────────────────────
  ok(JSON.stringify(F.KINDS) === JSON.stringify(fb.KINDS) && F.TEXT_MIN === fb.TEXT_MIN && F.TEXT_MAX === fb.TEXT_MAX
    && F.MAX_IMAGES === fb.MAX_IMAGES && F.SEND_MAX_BYTES === fb.IMAGE_MAX_BYTES,
  'the app and the server keep the same kinds, lengths, picture count and picture size');
  ok(F.LONG_SIDE === 1600 && F.FILE_MAX_BYTES === 5 * 1024 * 1024 && F.MAX_IMAGES === 3
    && JSON.stringify(F.FILE_TYPES) === JSON.stringify(['image/png', 'image/jpeg', 'image/webp']),
  'up to 3 pictures, PNG, JPG or WebP, 5 MB each, 1600 px on the long side');
  const words = [...Object.values(F.SAID), F.WHAT_IS_SENT, F.NEVER_SENT, ...Object.values(F.KIND_LABEL)];
  ok(words.every((w) => !DASHES.test(w) && !w.includes(';')), 'every sentence the app says has no dash and no semicolon');
  ok(/Riot ID/.test(F.NEVER_SENT) && /licence key/.test(F.NEVER_SENT) && /email/.test(F.NEVER_SENT), 'the note says the Riot ID, the key and the email are never sent');

  // ── 2. validate and clean ─────────────────────────────────────────────────
  {
    const v = fb.validate(good());
    ok(v.ok && v.report.kind === 'broke' && v.report.version === '8.8.0' && v.images.length === 0, 'a good report passes');
    const bad = (b, error, field, what) => { const r = fb.validate(b); ok(!r.ok && r.error === error && r.field === field, what, JSON.stringify(r)); };
    bad(null, 'invalid', 'body', 'no body is refused');
    bad([], 'invalid', 'body', 'an array is refused');
    bad(good({ kind: 'rant' }), 'invalid', 'kind', 'a kind not on the list is refused');
    bad(good({ text: 'short' }), 'too-short', 'text', 'fewer than 10 characters is too short');
    bad(good({ text: `   ${'<>'.repeat(10)}   ` }), 'too-short', 'text', 'words that are only brackets and spaces are too short');
    bad(good({ text: 'x'.repeat(4001) }), 'too-long', 'text', 'more than 4000 characters is too long');
    bad(good({ text: 7 }), 'invalid', 'text', 'text that is not a string is refused');
    bad(good({ version: '8.8' }), 'invalid', 'version', 'a version not x.y.z is refused');
    bad(good({ version: '8.8.0; drop' }), 'invalid', 'version', 'a version with more after it is refused');
    bad(good({ game: 'rivals' }), 'invalid', 'game', 'a game that is not coached is refused');
    bad(good({ reviewId: '../../etc' }), 'invalid', 'reviewId', 'a review id that is a path is refused');
    bad(good({ images: 'x' }), 'invalid', 'images', 'images that are not a list are refused');
    const img = { type: 'image/jpeg', data: JPEG.toString('base64') };
    bad(good({ images: [img, img, img, img] }), 'too-many', 'images', 'four pictures are too many');
    bad(good({ images: [{ type: 'image/png', data: PNG.toString('base64') }] }), 'invalid', 'images', 'a picture that is not the JPEG the app makes is refused');
    bad(good({ images: [{ type: 'image/jpeg', data: PNG.toString('base64') }] }), 'invalid', 'images', 'a PNG labelled JPEG is refused by its bytes');
    bad(good({ images: [{ type: 'image/jpeg', data: 'not base64 at all!' }] }), 'invalid', 'images', 'data that is not base64 is refused');
    const huge = Buffer.concat([JPEG, Buffer.alloc(fb.IMAGE_MAX_BYTES, 1)]);
    bad(good({ images: [{ type: 'image/jpeg', data: huge.toString('base64') }] }), 'too-big', 'images', 'a picture over 2 MB is refused');
    const three = fb.validate(good({ images: [img, img, img], reviewId: 'r_123-abc', game: 'lol' }));
    ok(three.ok && three.images.length === 3 && three.images[0].equals(JPEG) && three.report.reviewId === 'r_123-abc' && three.report.game === 'lol',
      'three JPEG pictures, a review id and League pass, the bytes as sent');

    const ctl = `one${String.fromCharCode(0)}two${String.fromCharCode(7)}three${String.fromCharCode(27)}[31m four${String.fromCharCode(0x202E)}five${String.fromCharCode(0x200B)}six\r\nnext\tline`;
    const cleaned = fb.cleanText(ctl);
    ok(cleaned === 'onetwothree[31m fourfivesix\nnext\tline', 'control characters, bidi overrides and zero width marks are taken out, newline and tab kept', JSON.stringify(cleaned));
    ok(fb.cleanText('<script>alert(1)</script> it <b>broke</b>') === 'scriptalert(1)/script it bbroke/b', 'no angle bracket survives, so no HTML does');
    ok(fb.cleanText(`a\n\n\n\n\nb`) === 'a\n\n\nb' && fb.cleanText('  padded  ') === 'padded', 'long runs of blank lines are cut, ends trimmed');
    ok(fb.cleanLine(`Windows${String.fromCharCode(10)}11`, 80) === 'Windows 11', 'a one line field stays on one line');
    ok(fb.sniff(JPEG) === 'image/jpeg' && fb.sniff(PNG) === 'image/png' && fb.sniff(Buffer.from('RIFF0000WEBPVP8 ')) === 'image/webp' && fb.sniff(Buffer.from('GIF89a......')) === null,
      'pictures are told apart by their bytes');
    ok(fb.accountIdOf({ userId: 'abc' }) === 'u:abc', 'an account is kept as u: and its id');
    const kid = fb.accountIdOf({ accountKey: 'GC-AAAA-BBBB-CCCC-DDDD', key: 'GC-AAAA-BBBB-CCCC-DDDD' });
    ok(/^k:[0-9a-f]{16}$/.test(kid) && !kid.includes('AAAA'), 'a licence with no account is kept as a hash, never the key', kid);
    ok(fb.UUID.test('3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b') && !fb.UUID.test('3f2b8c1e'), 'the report id shape matches a uuid and nothing short');
  }

  // ── 3. POST /api/feedback over http ───────────────────────────────────────
  {
    let clock = 1_000_000;
    const now = () => clock;
    const store = fakeStore();
    const pings = [];
    const resolver = {
      async identify(req) {
        const h = req.headers.authorization || '';
        if (h === 'Bearer down') return { status: 'unavailable' };
        if (h === 'Bearer occ_one') return { status: 'valid', caller: { userId: 'user-1', accountKey: 'u:user-1' } };
        if (h === 'Bearer occ_two') return { status: 'valid', caller: { userId: 'user-2', accountKey: 'u:user-2' } };
        if (req.headers['x-license-key'] === 'GC-AAAA-BBBB-CCCC-DDDD') return { status: 'valid', caller: { userId: null, accountKey: 'GC-AAAA-BBBB-CCCC-DDDD', key: 'GC-AAAA-BBBB-CCCC-DDDD' } };
        if (h) return { status: 'invalid', body: { error: 'session-invalid' } };
        return { status: 'none' };
      },
    };
    let seq = 0;
    const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    const app = express();
    app.use('/api/feedback', express.json({ limit: fb.BODY_LIMIT }));
    app.use('/api/feedback', routes.createRouter({ store, resolver, now, uuid, ping: (id, report, n) => { pings.push({ id, report, n }); }, log: () => {} }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type || 'error' }));
    const { server, base } = await listen(app);
    try {
      const one = { Authorization: 'Bearer occ_one' };
      let r = await call(base, '/api/feedback', { body: good() });
      ok(r.status === 401 && r.data.error === 'sign-in-required' && !store.rows.length, 'no account and no key: 401, nothing kept');
      r = await call(base, '/api/feedback', { body: good(), headers: { Authorization: 'Bearer occ_wrong' } });
      ok(r.status === 401 && !store.rows.length, 'a session the server does not know: 401');
      r = await call(base, '/api/feedback', { body: good(), headers: { Authorization: 'Bearer down' } });
      ok(r.status === 503 && r.data.error === 'account-unavailable' && !store.rows.length, 'an outage naming the caller: 503 with retry, nothing kept');

      const pic = { type: 'image/jpeg', data: JPEG.toString('base64') };
      r = await call(base, '/api/feedback', { body: good({ images: [pic, pic], reviewId: 'abc123' }), headers: one });
      const row = store.rows[0];
      ok(r.status === 201 && r.data.ok === true && r.data.id === row.id && fb.UUID.test(row.id), 'a signed in report is kept: 201 with its id', JSON.stringify(r.data));
      ok(row.account_id === 'u:user-1' && row.kind === 'broke' && row.status === 'new' && row.pictures === 2 && row.review_id === 'abc123'
        && row.app_version === '8.8.0' && row.os === 'Windows 11 Home 10.0.26200' && row.game === 'valorant',
      'the row holds the account id, kind, status new, the version, Windows, the game and the review id', JSON.stringify(row));
      ok(store.files.has(`${row.id}/1.jpg`) && store.files.has(`${row.id}/2.jpg`) && store.files.get(`${row.id}/1.jpg`).equals(JPEG), 'its pictures are stored by the report id');
      await new Promise((res) => setTimeout(res, 20));
      ok(pings.length === 1 && pings[0].id === row.id && pings[0].n === 2, 'and one ping is sent after the answer');

      r = await call(base, '/api/feedback', { body: good(), headers: { 'X-License-Key': 'GC-AAAA-BBBB-CCCC-DDDD' } });
      const keyed = store.rows[store.rows.length - 1];
      ok(r.status === 201 && /^k:[0-9a-f]{16}$/.test(keyed.account_id) && !JSON.stringify(store.rows).includes('GC-AAAA'), 'a licence key alone sends a report, and the key is kept nowhere');

      r = await call(base, '/api/feedback', { body: good({ kind: 'nope' }), headers: { Authorization: 'Bearer occ_two' } });
      ok(r.status === 400 && r.data.error === 'invalid' && r.data.field === 'kind', 'a bad field: 400 naming it');
      r = await call(base, '/api/feedback', { body: '{"kind":', headers: { Authorization: 'Bearer occ_two' } });
      ok(r.status === 400, 'a body that is not JSON: 400');
      const tooBig = JSON.stringify(good({ text: 'x'.repeat(10 * 1024 * 1024) }));
      r = await call(base, '/api/feedback', { body: tooBig, headers: { Authorization: 'Bearer occ_two' } });
      ok(r.status === 413, 'a body over the cap: 413 before the route runs', String(r.status));

      // 5 an hour per account: user-1 has sent one.
      const before = store.rows.length;
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await call(base, '/api/feedback', { body: good(), headers: one })).status);
      ok(statuses.join(',') === '201,201,201,201,429' && store.rows.length === before + 4, 'the sixth report in an hour is 429', statuses.join(','));
      r = await call(base, '/api/feedback', { body: good(), headers: one });
      ok(r.status === 429 && r.data.error === 'rate-limited' && Number(r.headers.get('retry-after')) > 0, 'with Retry-After');
      r = await call(base, '/api/feedback', { body: good(), headers: { Authorization: 'Bearer occ_two' } });
      ok(r.status === 201, 'another account behind the same address is not counted with it');
      // 20 a day: an hour on at a time.
      const day = [];
      for (let h = 0; h < 5; h++) {
        clock += 60 * 60 * 1000 + 1000;
        for (let i = 0; i < 5; i++) day.push((await call(base, '/api/feedback', { body: good(), headers: one })).status);
      }
      ok(day.filter((s) => s === 201).length === 15 && day.slice(-5).every((s) => s === 429), 'and past 20 in a day every hour is 429', day.join(','));
      ok(rateLimits.FEEDBACK_LIMITS.HOUR === 5 && rateLimits.FEEDBACK_LIMITS.DAY === 20, 'the limits are 5 an hour and 20 a day');
    } finally { server.close(); }
  }

  // ── 4. The table or the bucket not there yet ──────────────────────────────
  {
    const resolver = { identify: async () => ({ status: 'valid', caller: { userId: 'u9', accountKey: 'u:u9' } }) };
    const noTable = fakeStore({ insert: () => notLive('insert') });
    const noBucket = fakeStore({ upload: () => notLive('upload') });
    const broken = fakeStore({ insert: () => { throw new Error('connection reset'); } });
    const pings = [];
    const app = express();
    app.use(express.json({ limit: fb.BODY_LIMIT }));
    app.use('/a', routes.createRouter({ store: noTable, resolver, ping: () => pings.push(1), log: () => {} }));
    app.use('/b', routes.createRouter({ store: noBucket, resolver, ping: () => pings.push(1), log: () => {} }));
    app.use('/c', routes.createRouter({ store: broken, resolver, ping: () => pings.push(1), log: () => {} }));
    const { server, base } = await listen(app);
    const quiet = console.error;
    console.error = () => {};
    try {
      let r = await call(base, '/a', { body: good() });
      ok(r.status === 503 && r.data.error === 'feedback-not-live' && /Try again later/.test(r.data.said), 'no table yet: 503 and a calm try again later', JSON.stringify(r.data));
      const pic = { type: 'image/jpeg', data: JPEG.toString('base64') };
      r = await call(base, '/b', { body: good({ images: [pic] }) });
      ok(r.status === 503 && r.data.error === 'feedback-not-live' && noBucket.rows.length === 0 && noBucket.removed.length === 1,
        'no bucket yet: 503, and the row written first is taken back out', JSON.stringify({ r: r.data, rows: noBucket.rows.length }));
      r = await call(base, '/c', { body: good() });
      ok(r.status === 503 && r.data.error === 'feedback-failed' && /Try again later/.test(r.data.said), 'a database failure: 503, try again later');
      ok(!pings.length, 'and no ping for a report not kept');
    } finally { server.close(); console.error = quiet; }
    ok(fb.isNotLive({ code: '42P01' }) && fb.isNotLive({ code: 'PGRST205' }) && fb.isNotLive({ message: 'Bucket not found', statusCode: '404' })
      && !fb.isNotLive({ message: 'timeout' }), 'a missing relation and a missing bucket read as not live, a timeout does not');
    // The real store's shape against a fake supabase client.
    const calls = [];
    const chain = (result) => {
      const q = { select() { calls.push('select'); return q; }, order() { return q; }, limit() { return q; }, eq(k, v) { calls.push(`eq:${k}=${v}`); return q; },
        update(p) { calls.push(`update:${JSON.stringify(p)}`); return q; }, delete() { calls.push('delete'); return q; },
        insert(row) { calls.push(`insert:${row.id}`); return Promise.resolve(result); }, then(fn, rej) { return Promise.resolve(result).then(fn, rej); } };
      return q;
    };
    const supa = (result, storage) => ({ from: () => chain(result), storage: { from: () => storage } });
    const real = fb.createStore(supa({ error: { code: '42P01', message: 'relation "feedback_reports" does not exist' } }, {}));
    let threw = null;
    try { await real.insert({ id: 'x' }); } catch (e) { threw = e; }
    ok(threw && threw.notLive, 'the Supabase store reads a missing table as not live');
    const realBucket = fb.createStore(supa({ error: null }, { upload: async () => ({ error: { message: 'Bucket not found', statusCode: '404' } }) }));
    threw = null;
    try { await realBucket.upload('x/1.jpg', JPEG); } catch (e) { threw = e; }
    ok(threw && threw.notLive, 'and a missing bucket too');
  }

  // ── 5. The ping ───────────────────────────────────────────────────────────
  {
    const URL = 'https://discord.com/api/webhooks/123456/SECRET-token_part';
    const report = { kind: 'coaching', text: `@everyone ${'w'.repeat(400)}`, version: '8.8.0', game: 'valorant' };
    let sent = 0;
    const skip = await fb.ping('id-1', report, 1, { env: {}, fetch: () => { sent++; } });
    ok(skip === 'skipped' && sent === 0, 'unset, nothing is sent and nothing said');
    let body = null;
    let to = null;
    const okFetch = async (u, o) => { to = u; body = JSON.parse(o.body); return { ok: true, status: 204 }; };
    const r = await fb.ping('3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b', report, 2, { env: { FEEDBACK_WEBHOOK_URL: URL }, fetch: okFetch });
    ok(r === 'sent' && to === URL, 'set, the ping goes to it');
    ok(body && JSON.stringify(body.allowed_mentions) === '{"parse":[]}' && body.flags === 4, 'no mention can ping, no link preview');
    ok(body.content.includes('Wrong coaching') && body.content.includes('8.8.0') && body.content.includes('3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b')
      && body.content.includes('w'.repeat(290)) && !body.content.includes('w'.repeat(301)) && body.content.includes('2 pictures'),
    'it carries the kind, the version, the first 300 characters and the id', body && body.content.slice(0, 120));
    {
      // A masked link, a heading and a spoiler arrive as their characters, never as markdown.
      const BS = String.fromCharCode(92);
      const sly = fb.webhookPayload('id', { kind: 'broke', text: 'see [my clip](https://evil.example/x) and # big ||hidden|| *bold*', version: '8.8.0' }, 0).content;
      ok(sly.includes(`${BS}[my clip${BS}]${BS}(https://evil.example/x${BS})`) && sly.includes(`${BS}# big`) && sly.includes(`${BS}|${BS}|hidden`) && sly.includes(`${BS}*bold${BS}*`)
        && !sly.includes('](https'), 'the words reach Discord literally, no masked link, heading or spoiler', sly);
    }
    const logs = [];
    const boom = async () => { throw new Error(`request to ${URL} failed, reason: getaddrinfo ENOTFOUND`); };
    const f = await fb.ping('id', report, 0, { env: { FEEDBACK_WEBHOOK_URL: URL }, fetch: boom, log: (l) => logs.push(l) });
    ok(f === 'failed' && logs.length === 1 && !logs[0].includes('SECRET') && !logs[0].includes('123456') && logs[0].includes('[webhook]'), 'a failure is one line with the URL scrubbed', logs[0]);
    const cut = fb.scrub('fetch https://discordapp.com/api/webhooks/987/OTHER-secret) failed', URL);
    ok(!cut.includes('OTHER-secret') && cut.includes('/api/webhooks/[hidden]'), 'and any webhook path in an error is hidden', cut);
    logs.length = 0;
    const refused = await fb.ping('id', report, 0, { env: { FEEDBACK_WEBHOOK_URL: URL }, fetch: async () => ({ ok: false, status: 401 }), log: (l) => logs.push(l) });
    ok(refused === 'failed' && !logs.join('').includes('SECRET'), 'a refusal says its status only');
    logs.length = 0;
    const plain = await fb.ping('id', report, 0, { env: { FEEDBACK_WEBHOOK_URL: 'http://plain.example/hook' }, fetch: okFetch, log: (l) => logs.push(l) });
    ok(plain === 'failed' && !logs.join('').includes('plain.example'), 'a URL that is not https is not used, and not printed');
    const server = fs.readFileSync(path.join(ROOT, 'server', 'services', 'feedback.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'server', 'routes', 'feedback.js'), 'utf8');
    ok(!/console\.\w+\([^)]*FEEDBACK_WEBHOOK_URL[^)]*\)/.test(server.split('fb.scrub(').join('')), 'no log line prints the webhook URL');
  }

  // ── 6. The admin routes and the triage script ─────────────────────────────
  {
    const store = fakeStore();
    const id = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
    store.rows.push({ id, account_id: 'u:x', kind: 'broke', text: 'The review never opened.\nIt stayed on Recording.', app_version: '8.8.0', os: 'Windows 11', game: 'valorant', review_id: 'r1', status: 'new', notes: null, pictures: 2 });
    store.rows.push({ id: '00000000-0000-4000-8000-000000000002', account_id: 'u:y', kind: 'idea', text: 'Show my aim trend.', app_version: '8.8.0', os: null, game: null, review_id: null, status: 'fixed', notes: 'done', pictures: 0 });
    const isAdmin = (req) => req.headers['x-admin-password'] === 'pw';
    const app = express();
    app.use(express.json());
    let base = '';
    const pics = express.Router();
    pics.get('/pic/:id/:n', (req, res) => res.type('image/jpeg').send(JPEG));
    app.use(pics);
    app.use('/api/admin/feedback', routes.createAdminRouter({ store: { ...store, list: store.list, mark: store.mark, signedUrl: async (p) => `${base}/pic/${p}` }, isAdmin }));
    const s = await listen(app);
    base = s.base;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-feedback-inbox-'));
    try {
      let r = await call(base, '/api/admin/feedback', { method: 'GET' });
      ok(r.status === 401, 'the inbox needs the admin password');
      r = await call(base, '/api/admin/feedback', { method: 'GET', headers: { 'X-Admin-Password': 'pw' } });
      ok(r.status === 200 && r.data.reports.length === 1 && r.data.reports[0].id === id && r.data.reports[0].pictures.length === 2
        && r.data.reports[0].pictures[0].url.endsWith(`/pic/${id}/1.jpg`) && r.data.reports[0].reviewId === 'r1',
      'it lists the new reports with a signed URL a picture', JSON.stringify(r.data).slice(0, 200));
      r = await call(base, '/api/admin/feedback?status=all', { method: 'GET', headers: { 'X-Admin-Password': 'pw' } });
      ok(r.status === 200 && r.data.reports.length === 2, 'and every report with status=all');
      r = await call(base, '/api/admin/feedback?status=lost', { method: 'GET', headers: { 'X-Admin-Password': 'pw' } });
      ok(r.status === 400, 'a status not on the list is refused');
      r = await call(base, `/api/admin/feedback/${id}`, { body: { status: 'done' }, headers: { 'X-Admin-Password': 'pw' } });
      ok(r.status === 400, 'marking with a status not on the list is refused');
      r = await call(base, '/api/admin/feedback/not-an-id', { body: { status: 'fixed' }, headers: { 'X-Admin-Password': 'pw' } });
      ok(r.status === 400, 'and an id that is not an id');
      r = await call(base, `/api/admin/feedback/${id}`, { body: { status: 'fixed' } });
      ok(r.status === 401, 'marking needs the password too');

      // The script, against the same routes.
      const out = [];
      const env = { ADMIN_PASSWORD: 'pw', OCCLARA_SERVER: `${base}/` };
      let code = await inbox.main([], { env, dir, out: (l) => out.push(l), allowHttp: true });
      const own = path.join(dir, id);
      ok(code === 0 && fs.existsSync(path.join(own, 'report.json')) && fs.readFileSync(path.join(own, 'report.txt'), 'utf8').includes('It stayed on Recording.')
        && fs.readFileSync(path.join(own, '1.jpg')).equals(JPEG) && fs.readFileSync(path.join(own, '2.jpg')).equals(JPEG),
      'npm run feedback writes each new report and its pictures to the inbox folder', out.join(' | '));
      ok(out.some((l) => l.startsWith(id) && l.includes('2/2 pictures')) && !out.join('').includes('pw'), 'one line a report, and the password is never printed');
      code = await inbox.main(['--mark', id, 'fixed', 'reproduced', 'and', 'fixed'], { env, dir, out: (l) => out.push(l) });
      ok(code === 0 && store.rows[0].status === 'fixed' && store.rows[0].notes === 'reproduced and fixed', '--mark sets the status and the note', out[out.length - 1]);
      code = await inbox.main(['--mark', '00000000-0000-4000-8000-000000000099', 'triaged'], { env, dir, out: (l) => out.push(l) });
      ok(code === 1 && out[out.length - 1].includes('no report'), 'a report that is not there says so');
      code = await inbox.main(['--mark', id, 'closed'], { env, dir, out: (l) => out.push(l) });
      ok(code === 1 && out[out.length - 1].includes('status must be'), 'a status not on the list is refused before asking');
      code = await inbox.main([], { env: { ...env, ADMIN_PASSWORD: 'wrong' }, dir, out: (l) => out.push(l) });
      ok(code === 1 && out[out.length - 1].includes('refused'), 'a wrong password says it was refused');
      code = await inbox.main([], { env: { OCCLARA_SERVER: base }, dir, out: (l) => out.push(l) });
      ok(code === 0 && out[out.length - 1].includes('no ADMIN_PASSWORD'), 'no password, nothing asked, exit 0');
      const notLiveApp = express();
      notLiveApp.use('/api/admin/feedback', routes.createAdminRouter({ store: fakeStore({}), isAdmin: () => true }));
      const n = await listen(express().use('/api/admin/feedback', routes.createAdminRouter({ store: { list: () => notLive('list') }, isAdmin: () => true })));
      code = await inbox.main([], { env: { ADMIN_PASSWORD: 'pw', OCCLARA_SERVER: n.base }, dir, out: (l) => out.push(l) });
      n.server.close();
      ok(code === 0 && out[out.length - 1].includes('not live'), 'the inbox not live yet is one calm line');
      ok(inbox.parse(['--limit', '0']).error && inbox.parse(['--what']).error && !inbox.parse(['--status', 'all']).error, 'the arguments are checked');
      const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
      ok(ignore.split(/\r?\n/).includes('feedback-inbox/'), 'the inbox folder is gitignored');
      const pkg = require('../package.json');
      ok(pkg.scripts.feedback === 'node scripts/feedback-inbox.js' && pkg.scripts['test:feedback'] === 'node scripts/test-feedback.js', 'npm run feedback and npm run test:feedback are registered');
    } finally { s.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // ── 7. Main's service: pictures, words, the seal ──────────────────────────
  {
    // A fake nativeImage that records what it is asked.
    const made = [];
    const fakeImage = (w, h, tag) => {
      const img = {
        w, h, tag,
        isEmpty: () => w === 0,
        getSize: () => ({ width: w, height: h }),
        resize: (o) => { made.push({ from: [w, h], to: [o.width, o.height], quality: o.quality }); return fakeImage(o.width, o.height, 'resized'); },
        toJPEG: (q) => { made.push({ jpeg: q, size: [w, h] }); return Buffer.concat([JPEG.subarray(0, 12), Buffer.alloc(tag === 'heavy' && q > 75 ? 3 * 1024 * 1024 : 1000, 1)]); },
      };
      return img;
    };
    let nextImage = fakeImage(3200, 1800);
    const nativeImage = { createFromBuffer: () => nextImage };
    let busy = false;
    const posted = [];
    let answer = { ok: true, status: 201, data: { ok: true, id: '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b' } };
    const api = { post: async (route, body, auth, ms) => { posted.push({ route, body, auth, ms }); if (answer instanceof Error) throw answer; return answer; } };
    const auth = () => ({ Authorization: 'Bearer occ_x' });
    const svc = createFeedback({
      api, auth, nativeImage, busy: () => busy, version: '8.8.0', osLine: () => 'Windows 11 Home 10.0.26200', game: () => 'valorant', gameLabel: () => 'Valorant',
      lastReview: () => ({ id: 'rev_1', map: 'Abyss', title: 'Jett' }), riotId: () => 'Lowful#EUW', email: () => 'player@example.com', signedIn: () => true,
    });
    const info = await svc.info();
    ok(info && info.version === '8.8.0' && info.os.startsWith('Windows') && info.gameLabel === 'Valorant' && info.review.id === 'rev_1'
      && info.review.line === 'Your last match, Abyss as Jett' && info.signedIn === true && info.said.auth === F.SAID.auth,
    'info says the version, Windows, the game and the last review', JSON.stringify(info && info.review));
    ok(!JSON.stringify(info).includes('Lowful') && !JSON.stringify(info).includes('player@example.com'), 'and never the Riot ID or the email');

    const p = svc.prepare({ type: 'image/png', size: 400000, bytes: PNG });
    ok(p.ok && typeof p.token === 'string' && p.width === 1600 && p.height === 900 && p.preview.startsWith('data:image/jpeg;base64,'),
      'a 3200 by 1800 picture is downscaled to 1600 by 900 and recompressed to JPEG', JSON.stringify({ ...p, preview: undefined }));
    ok(made.some((m) => m.to && m.to[0] === 1600 && m.to[1] === 900 && m.quality === 'good') && made.some((m) => m.jpeg === F.JPEG_QUALITY && m.size[0] === 1600),
      'by nativeImage, at good quality, then to JPEG at 85');
    made.length = 0;
    nextImage = fakeImage(900, 1400);
    const tall = svc.prepare({ type: 'image/jpeg', size: 300000, bytes: JPEG });
    ok(tall.ok && tall.width === 900 && tall.height === 1400 && !made.some((m) => m.to && m.to[0] === 900 && m.to[1] === 1400), 'a picture under 1600 px keeps its size');
    nextImage = fakeImage(1000, 3000);
    const portrait = svc.prepare({ type: 'image/jpeg', size: 300000, bytes: JPEG });
    ok(portrait.ok && portrait.height === 1600 && portrait.width === 533, 'a tall one is cut on its long side', `${portrait.width}x${portrait.height}`);
    made.length = 0;
    nextImage = fakeImage(1600, 1000, 'heavy');
    const heavy = svc.prepare({ type: 'image/png', size: 4000000, bytes: PNG });
    ok(heavy.ok && made.some((m) => m.jpeg === F.JPEG_QUALITY) && made.some((m) => m.jpeg === F.JPEG_QUALITY_SMALLER), 'one too heavy at 85 is made again at 70');
    const refuse = (file, error, what) => { const r = svc.prepare(file); ok(!r.ok && r.error === error && r.said === F.SAID[error], what, JSON.stringify(r)); };
    refuse({ type: 'image/gif', size: 100, bytes: PNG }, 'type', 'a GIF is refused');
    refuse({ type: 'image/png', size: 6 * 1024 * 1024, bytes: PNG }, 'size', 'a file over 5 MB is refused');
    refuse({ type: 'image/png', size: 100, bytes: Buffer.from('MZ not a picture at all') }, 'type', 'bytes that are no picture are refused');
    nextImage = fakeImage(0, 0);
    refuse({ type: 'image/png', size: 100, bytes: PNG }, 'image', 'a picture nativeImage cannot read is refused');
    nextImage = fakeImage(3200, 1800);

    // Sending.
    let s = await svc.send({ kind: 'broke', text: 'short', tokens: [] });
    ok(!s.ok && s.error === 'short' && s.said === F.SAID.short && !posted.length, 'too short is said and nothing is sent');
    s = await svc.send({ kind: 'rant', text: 'long enough words', tokens: [] });
    ok(!s.ok && s.error === 'kind' && !posted.length, 'a kind not on the list is refused');
    s = await svc.send({ kind: 'broke', text: 'long enough words', tokens: ['made-up'] });
    ok(!s.ok && s.error === 'image' && !posted.length, 'a picture token main does not hold is refused');
    const text = 'I am Lowful#EUW, also lowful #euw, key gc-abcd-efgh-ijkl-mnop, mail player@example.com or other.person@mail.co.uk and the review broke';
    s = await svc.send({ kind: 'broke', text, tokens: [p.token, tall.token], withReview: false });
    const sent = posted[0];
    ok(s.ok && s.id === answer.data.id && s.said === F.SAID.sent && sent.route === '/api/feedback' && sent.auth === auth && sent.ms === 30000, 'a good report is POSTed with the account\'s auth');
    ok(!/lowful/i.test(sent.body.text) && !/gc-abcd/i.test(sent.body.text) && !sent.body.text.includes('@') && sent.body.text.includes('my Riot ID')
      && sent.body.text.includes('my licence key') && sent.body.text.includes('my email') && sent.body.text.includes('an email'),
    'the Riot ID, the key and every email are taken out of the words', sent.body.text);
    ok(sent.body.reviewId === null && sent.body.version === '8.8.0' && sent.body.game === 'valorant' && sent.body.os.startsWith('Windows')
      && sent.body.images.length === 2 && sent.body.images.every((im) => im.type === 'image/jpeg' && Buffer.from(im.data, 'base64')[0] === 0xFF),
    'the review is left out unless ticked, and the two pictures go as JPEG');
    ok(!svc._held.has(p.token) && !svc._held.has(tall.token), 'pictures sent are let go');
    await svc.send({ kind: 'idea', text: 'Show my aim trend please', tokens: [], withReview: true });
    ok(posted[1].body.reviewId === 'rev_1', 'ticked, the last review\'s id goes');
    const map = async (a, err) => { answer = a; const r = await svc.send({ kind: 'idea', text: 'Show my aim trend please', tokens: [] }); ok(!r.ok && r.error === err && r.said === F.SAID[err], `${a instanceof Error ? 'no answer' : a.status} is said as ${err}`); };
    await map({ ok: false, status: 429, data: {} }, 'busy');
    await map({ ok: false, status: 503, data: {} }, 'later');
    await map({ ok: false, status: 401, data: {} }, 'auth');
    await map({ ok: false, status: 413, data: {} }, 'size');
    await map(new Error('ECONNRESET'), 'unreachable');

    // THE SEAL: mid match or sealed, all of it is refused and nothing leaves.
    busy = true;
    const count = posted.length;
    ok(await svc.info() === null, 'mid match, info is null');
    const pm = svc.prepare({ type: 'image/png', size: 100, bytes: PNG });
    ok(!pm.ok && pm.error === 'match', 'mid match, a picture is refused');
    const sm = await svc.send({ kind: 'broke', text: 'the words are long enough', tokens: [] });
    ok(!sm.ok && sm.error === 'match' && sm.said === F.SAID.match && posted.length === count, 'mid match, Send is refused and nothing is posted');
    busy = false;
    // A match starting while the report is being put together: asked again right before it leaves.
    let asks = 0;
    const late = createFeedback({ api, auth, nativeImage, busy: () => (asks++ > 0), version: '8.8.0', osLine: () => 'Windows', game: () => 'valorant', lastReview: () => null });
    const lr = await late.send({ kind: 'broke', text: 'the words are long enough', tokens: [] });
    ok(!lr.ok && lr.error === 'match' && posted.length === count, 'a match that starts as it is sent stops it');

    ok(F.reviewLine(null) === null && F.reviewLine({ id: 'x' }).line === 'Your last match' && F.reviewLine({ id: 'x', map: 'Bind' }).line === 'Your last match, Bind',
      'the review line with and without its map and agent');
    ok(F.scrubText('mail me at a.b@c.de now', {}) === 'mail me at an email now' && F.scrubText('GC-AAAA-BBBB-CCCC-DDDD', {}) === 'my licence key',
      'the email and key shapes match their known strings');
  }

  // ── 8. The page, the preload, the channels and the shell ──────────────────
  {
    ok(['FEEDBACK_INFO', 'FEEDBACK_PREPARE', 'FEEDBACK_DROP', 'FEEDBACK_SEND'].every((k) => typeof C[k] === 'string' && C[k].startsWith('feedback:')), 'the four channels are in channels.js');
    const page = nav.pageOf('feedback');
    ok(page && page.surface === 'feedback' && page.preload === 'feedback-preload.js' && page.nav === false, 'Report a problem is a page of its own, out of the nav list', JSON.stringify(page));
    ok(nav.direction('settings', 'feedback') === 'forward' && nav.direction('feedback', 'review') === 'forward', 'deeper than Settings, the window moves forward into it');
    {
      const n = nav.createNav();
      n.seal(true);
      const s = n.go('feedback');
      ok(s.shown === null && s.page === 'feedback' && n.seal(false).shown === 'feedback', 'sealed, it is only remembered, and shows once the seal lifts');
    }
    const reg = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'register-ipc.js'), 'utf8');
    ok(['FEEDBACK_INFO', 'FEEDBACK_PREPARE', 'FEEDBACK_DROP', 'FEEDBACK_SEND'].every((k) => reg.includes(`C.${k}`)), 'register-ipc.js handles all four');
    const index = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
    ok(/createFeedback\(\{[\s\S]*?busy: \(\) => matchInProgress\(\) \|\| windowSealed\(\)/.test(index) && index.includes('feedback: feedbackIpc'),
      'index.js builds it with the seal\'s own test and hands it to register-ipc');

    const bridge = loadPreload('feedback', {});
    ok(['info', 'prepare', 'drop', 'send', 'go', 'onPage', 'pageReady'].every((k) => typeof bridge.api[k] === 'function'), 'the preload exposes the page\'s calls and the page motion');
    await bridge.api.send({ kind: 'idea' });
    await bridge.api.prepare({ type: 'image/png' });
    ok(bridge.invoked.some(([ch]) => ch === C.FEEDBACK_SEND) && bridge.invoked.some(([ch]) => ch === C.FEEDBACK_PREPARE), 'and asks main over the channels');

    const files = ['index.html', 'feedback.js', 'feedback.css'].map((f) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'feedback', f), 'utf8'));
    ok(files.every((x) => !DASHES.test(x)), 'no dash in the page');
    const shown = files[0].replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    ok(!shown.includes(';'), 'and no semicolon in what it shows');
    ok(!/https?:\/\//.test(files[0].replace(/<!--[\s\S]*?-->/g, '')) && !/https?:\/\//.test(files[1].replace(/\/\*[\s\S]*?\*\//g, '')), 'the page names no URL');
    ok(files[2].split('\n')[0].trim() === '/* palette: tokens only */', 'its stylesheet is held to tokens');
    ok(/accept="image\/png,image\/jpeg,image\/webp"/.test(files[0]) && /multiple/.test(files[0]), 'the picker takes PNG, JPG and WebP, several at once');
    const ids = [...files[1].matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);
    const missing = [...new Set(ids)].filter((id) => !files[0].includes(`id="${id}"`));
    ok(ids.length > 10 && !missing.length, 'every element the script asks for is in the page', missing.join(', '));

    // The page in the fake DOM: kind, words, a drop, a paste, Send, the thank you.
    const prepared = [];
    let sentReport = null;
    const handlers = {
      [C.FEEDBACK_INFO]: () => ({ version: '8.8.0', os: 'Windows 11 Home 10.0.26200', game: 'valorant', gameLabel: 'Valorant', review: { id: 'rev_1', line: 'Your last match, Abyss as Jett' },
        signedIn: true, limits: { min: 10, max: 4000, images: 3, fileBytes: 5 * 1024 * 1024, types: F.FILE_TYPES }, whatIsSent: F.WHAT_IS_SENT, neverSent: F.NEVER_SENT, said: F.SAID }),
      [C.FEEDBACK_PREPARE]: (file) => { prepared.push(file); return { ok: true, token: `t${prepared.length}`, preview: 'data:image/jpeg;base64,AAAA' }; },
      [C.FEEDBACK_SEND]: (r) => { sentReport = r; return { ok: true, id: '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b', said: F.SAID.sent }; },
    };
    const q = loadSurface('feedback', { handlers });
    await settle();
    ok(q.$('fb-review-sec').hidden === false && q.$('fb-review-line').textContent === 'Your last match, Abyss as Jett', 'the last review is offered by its line');
    ok(q.$('fb-what').textContent === F.WHAT_IS_SENT && q.$('fb-never').textContent === F.NEVER_SENT && q.$('fb-facts').textContent === 'Occlara 8.8.0, Windows 11 Home 10.0.26200, Valorant',
      'the note says what is sent, what never is, and the facts');
    ok(q.$('fb-send').disabled, 'Send waits for the words');
    q.$('fb-kind').querySelectorAll('button')[1].click();
    ok(q.$('fb-kind').querySelectorAll('button')[1].getAttribute('aria-checked') === 'true' && q.$('fb-kind').querySelectorAll('button')[0].getAttribute('aria-checked') === 'false', 'a kind is chosen');
    q.$('fb-text').value = 'The coach said I died to an Operator but it was a Vandal.';
    q.fire(q.$('fb-text'), 'input');
    ok(!q.$('fb-send').disabled && q.$('fb-count').textContent === `${q.$('fb-text').value.length} of 4000`, 'with words, Send is ready and the count follows');
    const file = (type, size) => ({ type, size, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) });
    const dt = (fs2) => ({ types: ['Files'], files: fs2, dropEffect: '' });
    const fire = (type, e) => { for (const fn of q.document._listeners[type] || []) fn(Object.assign({ type, preventDefault() { this.defaultPrevented = true; } }, e)); };
    fire('dragenter', { dataTransfer: dt([]) });
    ok(q.$('fb-drop').classList.contains('over'), 'pictures held over the page light the drop target');
    fire('drop', { dataTransfer: dt([file('image/png', 1000), file('image/gif', 1000)]) });
    await settle(); await settle();
    ok(!q.$('fb-drop').classList.contains('over') && prepared.length === 1 && prepared[0].type === 'image/png' && prepared[0].size === 1000 && prepared[0].bytes,
      'a dropped PNG goes to main to be prepared, its bytes with it');
    ok(q.$('fb-pic-said').textContent === F.SAID.type && q.$('fb-pics').querySelectorAll('img').length === 1, 'the GIF beside it is refused in words, the PNG shows');
    fire('paste', { clipboardData: { items: [{ kind: 'file', getAsFile: () => file('image/jpeg', 2000) }, { kind: 'string' }] } });
    await settle(); await settle();
    ok(prepared.length === 2 && q.$('fb-pics').querySelectorAll('img').length === 2, 'a pasted picture is added');
    fire('drop', { dataTransfer: dt([file('image/jpeg', 6 * 1024 * 1024)]) });
    await settle();
    ok(prepared.length === 2 && q.$('fb-pic-said').textContent === F.SAID.size, 'a picture over 5 MB is refused before it is read');
    fire('drop', { dataTransfer: dt([file('image/jpeg', 10), file('image/jpeg', 10)]) });
    await settle(); await settle();
    ok(prepared.length === 3 && q.$('fb-pics').querySelectorAll('img').length === 3 && q.$('fb-pic-said').textContent === F.SAID.many && q.$('fb-pick').disabled,
      'three at most: the fourth is refused and the picker is closed');
    q.$('fb-pics').querySelectorAll('button')[0].click();
    await settle();
    ok(q.$('fb-pics').querySelectorAll('img').length === 2 && !q.$('fb-pick').disabled && q.bridge.invoked.some(([ch, t]) => ch === C.FEEDBACK_DROP && t === 't1'), 'Remove takes one away and tells main');
    q.$('fb-review').querySelectorAll('button')[0].click();
    q.fire(q.$('fb-form'), 'submit');
    await settle(); await settle();
    ok(sentReport && sentReport.kind === 'coaching' && sentReport.text.includes('Vandal') && sentReport.withReview === true && JSON.stringify(sentReport.tokens) === '["t2","t3"]',
      'Send hands main the kind, the words, the pictures\' tokens and the review choice', JSON.stringify(sentReport));
    ok(q.$('fb-form').hidden && !q.$('fb-done').hidden && q.$('fb-done-said').textContent === F.SAID.sent && q.$('fb-done-id').textContent === '3f2b8c1e',
      'then a calm thank you with the report\'s number');
    q.$('fb-again').click();
    await settle();
    ok(!q.$('fb-form').hidden && q.$('fb-done').hidden && q.$('fb-text').value === '' && q.$('fb-send').disabled, 'Send another starts a fresh one');

    // Refused, the page says main's sentence.
    const r2 = loadSurface('feedback', { handlers: { ...handlers, [C.FEEDBACK_SEND]: () => ({ ok: false, error: 'busy', said: F.SAID.busy }) } });
    await settle();
    r2.$('fb-text').value = 'Something broke on the Moments page.';
    r2.fire(r2.$('fb-text'), 'input');
    r2.fire(r2.$('fb-form'), 'submit');
    await settle(); await settle();
    ok(r2.$('fb-said').textContent === F.SAID.busy && r2.$('fb-said').classList.contains('bad') && !r2.$('fb-form').hidden, 'a refusal is said in main\'s words and the report stays');
    // No account: it says how to get one and Send stays shut.
    const out = loadSurface('feedback', { handlers: { ...handlers, [C.FEEDBACK_INFO]: () => ({ ...handlers[C.FEEDBACK_INFO](), signedIn: false, review: null }) } });
    await settle();
    out.$('fb-text').value = 'Something broke on the Moments page.';
    out.fire(out.$('fb-text'), 'input');
    ok(!out.$('fb-out').hidden && out.$('fb-out').textContent === F.SAID.auth && !out.$('fb-settings').hidden && out.$('fb-send').disabled && out.$('fb-review-sec').hidden,
      'with no account and no key it says to sign in, and Send stays shut');
    out.$('fb-settings').click();
    ok(out.bridge.sent.some(([ch, pg]) => ch === C.SHELL_NAV && pg === 'settings'), 'Open Settings goes there');
    // Mid match main answers null: the page paints its defaults and sends nothing.
    const mid = loadSurface('feedback', { handlers: { [C.FEEDBACK_INFO]: () => null } });
    await settle();
    ok(mid.$('fb-review-sec').hidden && mid.$('fb-send').disabled, 'info null (mid match) offers no review and sends nothing');

    // The shell: the button at the end of Profile's row, directly above the Discord.
    const shell = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'shell', 'index.html'), 'utf8');
    const doc = new Document(shell);
    const foot = doc.querySelector('.foot').children.map((c) => c.id);
    ok(foot.indexOf('nav-feedback') === foot.indexOf('nav-profile') + 1 && foot.indexOf('nav-settings') === foot.indexOf('nav-feedback') + 1 && foot.indexOf('discord') === foot.indexOf('nav-settings') + 1,
      'the foot reads Profile, Report a problem, Settings, the Discord', foot.join(', '));
    const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'shell', 'shell.css'), 'utf8');
    ok(css.includes('.foot > #nav-profile { grid-column: 1; }') && css.includes('.foot > .foot-icon { grid-column: 2; }') && /id="nav-feedback" class="foot-icon"/.test(shell),
      'so on the grid it sits at the end of Profile\'s row, directly above the Discord at the end of Settings\'');
    const sjs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'shell', 'shell.js'), 'utf8');
    ok(sjs.includes("navButtons.set('feedback', $('nav-feedback'))") && /PAGE_ICO = \{[\s\S]*feedback:/.test(sjs), 'it is one of the pages the seal locks, with its own icon back after');
  }

  // ── 9. feedback.sql ───────────────────────────────────────────────────────
  {
    const file = process.env.OCCLARA_FEEDBACK_SQL;
    if (!file || !fs.existsSync(file)) {
      console.log('skip  feedback.sql text (set OCCLARA_FEEDBACK_SQL to its path)');
    } else {
      const sql = fs.readFileSync(file, 'utf8');
      ok(/CREATE TABLE IF NOT EXISTS public\.feedback_reports/.test(sql), 'the table is made only if it is not there');
      const cols = ['id', 'account_id', 'created_at', 'kind', 'text', 'app_version', 'os', 'game', 'review_id', 'status', 'notes', 'pictures'];
      ok(cols.every((c) => new RegExp(`\\n\\s+${c}\\s+`).test(sql)), 'with every column the server writes and reads');
      const grant = sql.indexOf('GRANT ALL ON public.feedback_reports TO service_role');
      const revoke = sql.indexOf('REVOKE ALL ON public.feedback_reports FROM PUBLIC, anon, authenticated');
      const rls = sql.indexOf('ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY');
      ok(grant > 0 && revoke > 0 && rls > grant && rls > revoke, 'grants before row level security');
      ok(!/CREATE POLICY/i.test(sql) && !/REFERENCES\s+auth\.users/i.test(sql), 'no policy for anyone, no foreign key to auth.users');
      ok(/INSERT INTO storage\.buckets[\s\S]*'feedback', 'feedback', false[\s\S]*ON CONFLICT \(id\) DO NOTHING/.test(sql), 'the bucket is made private, once');
      ok(/DROP CONSTRAINT IF EXISTS feedback_reports_kind_check/.test(sql) && /'broke', 'coaching', 'idea'/.test(sql) && /'new', 'triaged', 'fixed', 'wontfix'/.test(sql), 'safe to run twice, with the kinds and statuses');
      ok(!DASHES.test(sql), 'no dash but hyphens');
    }
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  crashed: ${e.stack}`); process.exit(1); });
