'use strict';

/**
 * test:changelog. Two halves of the changelog that leave the app:
 *
 *   GET /api/changelog (server/routes/changelog.js) over real http on
 *   127.0.0.1: its shape, its headers, ?since, and that server.js mounts it
 *   after the route limits, so the anonymous limiter covers it (and a real
 *   anonymous limiter in front of it trips at its number).
 *
 *   The Discord post (scripts/post-changelog.js) with a fake fetch: the embed's
 *   structure and Discord's limits, no mentions, skipped with no webhook set,
 *   every failure swallowed, and the webhook URL never printed.
 *
 * Nothing leaves the machine. The webhook URL here is a made up one.
 *
 * Run: npm run test:changelog
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const express = require(path.join(SERVER, 'node_modules', 'express'));
const limits = require(path.join(SERVER, 'services', 'rate-limits.js'));
const changelogRoutes = require(path.join(SERVER, 'routes', 'changelog.js'));
const poster = require('./post-changelog');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const FAKE_URL = 'https://discord.com/api/webhooks/1/fake-token';
const DATA = JSON.parse(fs.readFileSync(path.join(SERVER, 'data', 'changelog.json'), 'utf8'));

function listen(app) {
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
function send(port, p, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let body = null;
        try { body = b ? JSON.parse(b) : null; } catch { body = b; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    r.on('error', reject); r.end();
  });
}

(async () => {
  // ── The route over http ─────────────────────────────────────────────────
  {
    const app = express();
    app.use('/api/changelog', changelogRoutes);
    const server = await listen(app);
    const port = server.address().port;

    const all = await send(port, '/api/changelog');
    ok(all.status === 200, `GET /api/changelog is 200 (${all.status})`);
    ok(all.body && typeof all.body.version === 'string' && Array.isArray(all.body.entries), 'the body is { version, entries }');
    ok(all.body.version === DATA[0].version, `version is the newest entry's (${all.body.version})`);
    ok(JSON.stringify(all.body.entries) === JSON.stringify(DATA), 'entries are server/data/changelog.json, in its order');
    ok(all.headers['cache-control'] === 'public, max-age=300', `Cache-Control is public, five minutes (${all.headers['cache-control']})`);
    ok(all.headers['access-control-allow-origin'] === '*', 'Access-Control-Allow-Origin is *');
    ok(String(all.headers['access-control-allow-methods'] || '').includes('GET'), 'Access-Control-Allow-Methods names GET');
    ok(/application\/json/.test(all.headers['content-type'] || ''), 'answered as JSON');

    const pre = await send(port, '/api/changelog', 'OPTIONS', { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' });
    ok(pre.status === 204 && pre.headers['access-control-allow-origin'] === '*', `OPTIONS is 204 with the open origin (${pre.status})`);

    const since = await send(port, '/api/changelog?since=8.7.1');
    const sv = (since.body.entries || []).map((e) => e.version);
    // 8.7.3 and 8.7.2 today, and whatever is released after them.
    const want = DATA.slice(0, DATA.findIndex((e) => e.version === '8.7.1')).map((e) => e.version);
    ok(since.status === 200 && sv.join(',') === want.join(',') && sv.includes('8.7.3') && sv.includes('8.7.2') && !sv.includes('8.7.1'),
      `?since=8.7.1 gives only the newer ones (${sv.join(', ')})`);
    ok(since.body.version === DATA[0].version, 'and version is still the newest');
    const none = await send(port, `/api/changelog?since=${DATA[0].version}`);
    ok(none.status === 200 && Array.isArray(none.body.entries) && none.body.entries.length === 0, '?since=newest gives no entries');
    const future = await send(port, '/api/changelog?since=99.0.0');
    ok(future.status === 200 && future.body.entries.length === 0, '?since a version from the future gives no entries');
    const old = await send(port, '/api/changelog?since=1.0.0');
    ok(old.body.entries.length === DATA.length, '?since=1.0.0 gives every entry');
    for (const bad of ['junk', '8.7', '8.7.1.2', '', '8.7.x']) {
      const r = await send(port, `/api/changelog?since=${encodeURIComponent(bad)}`);
      ok(r.status === 400 && r.body && r.body.error === 'since', `a malformed since (${JSON.stringify(bad)}) is 400 { error: 'since' }`);
    }
    const twice = await send(port, '/api/changelog?since=8.7.1&since=8.7.2');
    ok(twice.status === 400, 'a since given twice is 400, never a guess');
    const post = await send(port, '/api/changelog', 'POST');
    ok(post.status === 404, `POST is not answered by the route (${post.status})`);
    await new Promise((r) => server.close(r));
  }

  // ── The wiring in server.js ─────────────────────────────────────────────
  {
    const src = fs.readFileSync(path.join(SERVER, 'server.js'), 'utf8');
    const requires = src.match(/require\('\.\/routes\/changelog'\)/g) || [];
    const uses = src.match(/app\.use\('\/api\/changelog', changelogRoutes\)/g) || [];
    ok(requires.length === 1 && uses.length === 1, 'server.js requires the route once and mounts it once at /api/changelog');
    const limitsAt = src.indexOf('rateLimits.routeLimits(');
    const mountAt = src.indexOf("app.use('/api/changelog', changelogRoutes)");
    const notFoundAt = src.indexOf("app.use((_, res) => res.status(404)");
    ok(limitsAt > 0 && mountAt > limitsAt, 'it is mounted after the route limits, so the anonymous /api limiter runs first');
    ok(notFoundAt < 0 || mountAt < notFoundAt, 'and before the 404 catch all');
    const anon = limits.routeLimits({}).find((l) => l.mw.limits && l.mw.limits.name === 'anonymous');
    ok(anon && anon.paths.includes('/api'), 'the anonymous limiter is on /api, which /api/changelog is under');

    // A real anonymous limiter in front of the route, mounted as server.js does.
    let clock = Date.parse('2026-11-04T12:00:00.000Z');
    const app = express();
    for (const { paths, mw } of limits.routeLimits({ now: () => clock })) app.use(paths, mw);
    app.use('/api/changelog', changelogRoutes);
    const server = await listen(app);
    const port = server.address().port;
    const max = anon.mw.limits.max;
    const statuses = [];
    for (let i = 0; i <= max; i++) statuses.push((await send(port, '/api/changelog')).status);
    ok(statuses.slice(0, max).every((s) => s === 200) && statuses[max] === 429,
      `an anonymous caller is limited at the anonymous limiter's number (${max} a minute, then 429)`);
    clock += 61 * 1000;
    ok((await send(port, '/api/changelog')).status === 200, 'and let through again the next minute');
    await new Promise((r) => server.close(r));
  }

  // ── The Discord payload ─────────────────────────────────────────────────
  const BULLET = String.fromCharCode(0x2022);
  const within = (p) => {
    const e = p.embeds[0];
    const total = e.title.length + e.description.length + e.footer.text.length
      + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    return e.title.length <= 256 && e.description.length <= 4096 && e.fields.length <= 25
      && e.fields.every((f) => f.value.length <= 1024 && f.name.length <= 256 && f.value.length > 0) && total <= 6000;
  };
  {
    const entry = DATA.find((e) => e.version === '8.7.2');
    const p = poster.buildPayload(entry);
    const e = p.embeds && p.embeds[0];
    ok(p.embeds.length === 1 && e, 'one embed');
    ok(e.title === 'Occlara 8.7.2', `title is "Occlara <version>" (${e.title})`);
    ok(e.url === 'https://occlara.app/changelog', 'it links to occlara.app/changelog');
    ok(e.description === entry.summary, 'the summary is the description');
    ok(e.color === 0x0A0B0E, 'the colour is the dark ground');
    ok(e.footer && e.footer.text === 'occlara.app', 'the footer is occlara.app');
    ok(e.timestamp === '2026-11-04T12:00:00.000Z', 'the timestamp is the entry\'s date');
    ok(JSON.stringify(p.allowed_mentions) === JSON.stringify({ parse: [] }), 'allowed_mentions parses nothing');
    ok(!('content' in p) || !p.content, 'no message content beside the embed');
    const names = e.fields.map((f) => f.name);
    ok(names.join(',') === 'New,Improved,Fixed', `the items are grouped New, Improved, Fixed (${names.join(', ')})`);
    const newLines = e.fields[0].value.split('\n');
    ok(newLines.length === entry.items.filter((i) => i.kind === 'new').length && newLines.every((l) => l.startsWith(`${BULLET} `)),
      'each item is one bullet line in its group');
    ok(within(p), 'Discord\'s limits are kept');
    const only = poster.buildPayload(DATA.find((x) => x.version === '8.7.1'));
    ok(only.embeds[0].fields.map((f) => f.name).join(',') === 'Improved', 'an empty group is left out');
    const text = JSON.stringify(DATA.map((x) => poster.buildPayload(x)));
    ok(!/@everyone|@here|<@/.test(text), 'no mention anywhere in any version\'s payload');
    ok(!text.includes(String.fromCharCode(0x2013)) && !text.includes(String.fromCharCode(0x2014)) && !text.includes(';'),
      'no em dash, en dash or semicolon in any payload');
  }
  {
    const long = (n) => `${'Something changed for the better in a way players notice '.repeat(6)}`.slice(0, n);
    const big = { version: '9.9.9', date: '2026-12-01', title: 'Big', summary: 'A big one.',
      items: Array.from({ length: 12 }, (_, i) => ({ kind: ['new', 'improved', 'fixed'][i % 3], text: long(290) })) };
    const p = poster.buildPayload(big);
    ok(within(p), `12 items of 290 characters keep every limit (${p.embeds[0].fields.length} fields)`);
    ok(p.embeds[0].fields.reduce((n, f) => n + f.value.split('\n').length, 0) === 12, 'and all 12 lines are posted');
    const huge = { version: '9.9.10', date: '2026-12-01', title: 'Huge', summary: 'x'.repeat(5000),
      items: Array.from({ length: 60 }, (_, i) => ({ kind: ['new', 'improved', 'fixed'][i % 3], text: long(290) })) };
    const h = poster.buildPayload(huge);
    ok(within(h), `60 items and a 5000 character summary still keep every limit (${h.embeds[0].fields.length} fields, description ${h.embeds[0].description.length})`);
    ok(h.embeds[0].fields.some((f) => f.name === 'More' && f.value.includes('occlara.app/changelog')), 'and what does not fit points to the changelog');
    const one = { version: '9.9.11', date: '2026-12-01', title: 'One', summary: 'One.', items: [{ kind: 'fixed', text: 'y'.repeat(3000) }] };
    ok(within(poster.buildPayload(one)), 'a single line longer than a field is cut to fit');
    const tall = { version: '9.9.12', date: '2026-12-01', title: 't'.repeat(400), summary: 'Tall.', items: [{ kind: 'new', text: 'A thing.' }] };
    ok(poster.buildPayload({ ...tall, version: '1'.repeat(300) }).embeds[0].title.length <= 256, 'a title over 256 characters is cut');
  }

  // ── Sending it ──────────────────────────────────────────────────────────
  const entry = DATA[0];
  const capture = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)) }; };
  {
    const calls = [];
    const fake = async (...a) => { calls.push(a); return { ok: true, status: 204 }; };
    const c = capture();
    const r = await poster.post({ entry, env: {}, fetch: fake, log: c.log });
    ok(!r.sent && calls.length === 0 && c.lines.join('\n') === 'no Discord webhook set, skipping', 'with no webhook set it says so, skips, and fetch is never called');
    const c2 = capture();
    await poster.post({ entry, env: { DISCORD_WEBHOOK_URL: '   ' }, fetch: fake, log: c2.log });
    ok(calls.length === 0 && c2.lines[0] === 'no Discord webhook set, skipping', 'an empty one is the same as unset');
    const c3 = capture();
    const notDiscord = 'https://example.com/hook/secret-thing';
    await poster.post({ entry, env: { DISCORD_WEBHOOK_URL: notDiscord }, fetch: fake, log: c3.log });
    ok(calls.length === 0 && c3.lines[0] === 'the Discord webhook is not a Discord webhook URL, skipping' && !c3.lines.join('').includes('secret-thing'),
      'a URL that is not Discord\'s is refused without printing it');
    ok(poster.WEBHOOK.test(FAKE_URL) && poster.WEBHOOK.test('https://discordapp.com/api/webhooks/123/abc_DEF-9')
      && poster.WEBHOOK.test('https://canary.discord.com/api/webhooks/123/abc') && !poster.WEBHOOK.test('http://discord.com/api/webhooks/1/a')
      && !poster.WEBHOOK.test('https://discord.com.evil.io/api/webhooks/1/a'), 'the webhook shape takes Discord\'s hosts over https only');
  }
  {
    const calls = [];
    const fake = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 204 }; };
    const c = capture();
    const r = await poster.post({ entry, env: { DISCORD_WEBHOOK_URL: FAKE_URL }, fetch: fake, log: c.log });
    const sent = calls[0];
    ok(r.sent && calls.length === 1 && sent.url === FAKE_URL, 'with a webhook set it posts once, to that URL');
    ok(sent.opts.method === 'POST' && sent.opts.headers['Content-Type'] === 'application/json', 'as a POST of JSON');
    ok(JSON.stringify(JSON.parse(sent.opts.body)) === JSON.stringify(poster.buildPayload(entry)), 'the body is the payload');
    ok(sent.opts.signal && typeof sent.opts.signal.aborted === 'boolean', 'with a timeout signal');
    ok(!c.lines.join('\n').includes(FAKE_URL) && !c.lines.join('\n').includes('fake-token'), 'and the URL is never printed');
  }
  {
    const c = capture();
    const fake = async (url) => { throw new TypeError(`fetch failed for ${url}`); };
    let threw = false;
    let r;
    try { r = await poster.post({ entry, env: { DISCORD_WEBHOOK_URL: FAKE_URL }, fetch: fake, log: c.log }); } catch { threw = true; }
    const out = c.lines.join('\n');
    ok(!threw && r && !r.sent && c.lines.length === 1, `a network error is swallowed with one line (${out})`);
    ok(!out.includes(FAKE_URL) && !out.includes('fake-token') && !out.includes('webhooks'), 'and that line holds nothing of the URL');
    const c2 = capture();
    const r2 = await poster.post({ entry, env: { DISCORD_WEBHOOK_URL: FAKE_URL }, fetch: async () => ({ ok: false, status: 500 }), log: c2.log });
    ok(!r2.sent && /HTTP 500/.test(c2.lines.join('')) && !c2.lines.join('').includes('fake-token'), 'a 500 is swallowed and names only its status');
    const c3 = capture();
    const r3 = await poster.post({ entry: null, env: { DISCORD_WEBHOOK_URL: FAKE_URL }, fetch: async () => ({ ok: true }), log: c3.log });
    ok(!r3.sent && c3.lines.length === 1, 'a version with no entry posts nothing and says so');
    ok(poster.scrub(`x ${FAKE_URL} y fake-token`, FAKE_URL) === 'x [webhook] y [token]', 'scrub takes the URL and its token out of any text');
  }

  // ── The script as the release runs it ───────────────────────────────────
  {
    const script = path.join(__dirname, 'post-changelog.js');
    const env = { ...process.env, DISCORD_WEBHOOK_URL: FAKE_URL };
    const dry = spawnSync(process.execPath, [script, '--dry', '--version', '8.7.3'], { encoding: 'utf8', env });
    let parsed = null;
    try { parsed = JSON.parse(dry.stdout); } catch { parsed = null; }
    ok(dry.status === 0 && parsed && parsed.embeds && parsed.embeds[0].title === 'Occlara 8.7.3', '--dry prints the payload as JSON and exits 0');
    ok(!`${dry.stdout}${dry.stderr}`.includes(FAKE_URL) && !`${dry.stdout}${dry.stderr}`.includes('fake-token'), 'and with a webhook set prints nothing of it')
    const unset = { ...process.env };
    delete unset.DISCORD_WEBHOOK_URL;
    const skip = spawnSync(process.execPath, [script], { encoding: 'utf8', env: unset });
    ok(skip.status === 0 && skip.stdout.trim() === 'no Discord webhook set, skipping', `unset, the script says so and exits 0 (${skip.stdout.trim()})`);
    const missing = spawnSync(process.execPath, [script, '--version', '0.0.1'], { encoding: 'utf8', env });
    ok(missing.status === 0 && !`${missing.stdout}${missing.stderr}`.includes('fake-token'), 'a version with no entry exits 0 and prints nothing of the URL');
  }

  console.log(`\n${checks - fails} of ${checks} passed`);
  if (fails) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
