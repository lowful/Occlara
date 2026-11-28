'use strict';

/**
 * THE STREAM WIDGET'S SERVER (src/main/services/rating-stream.js, the live
 * rating, docs/claude/rating.md "Live"). A real server on this machine's
 * loopback, asked as a browser and as a hostile page would ask it:
 *   - bound to 127.0.0.1 alone (never 0.0.0.0), on 47815 or the next free port;
 *   - the page and the events only under the per install token, compared
 *     whole; anything else, another method, a path, a directory, is a 404
 *     with no body, and never a CORS header;
 *   - the Host header must be the loopback address and port (DNS rebinding);
 *   - the events: text/event-stream, a retry, the last payload at once, each
 *     new one only when it changed, nothing but what main sent;
 *   - stopped, nothing answers and every viewer is cut;
 *   - the page made whole: no slot left, nothing fetched from the net.
 *
 * Pure node (http), no window. Run: npm run test:ratingstream
 */
const http = require('http');
const net = require('net');
const { createRatingStream, newToken, sameToken, DEFAULT_PORT } = require('../src/main/services/rating-stream');
const widgetPage = require('../src/main/services/rating-widget-page');

let checks = 0;
let fails = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}`); }
}

function get(port, path, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const req = http.request({ host: o.address || '127.0.0.1', port, path, method: o.method || 'GET', agent: false,
      ...(o.noHost ? { setHost: false } : {}),
      headers: { ...(o.noHost ? {} : { Host: o.host === undefined ? `127.0.0.1:${port}` : o.host }), ...(o.headers || {}) } }, (res) => {
      if (o.stream) return resolve({ status: res.statusCode, headers: res.headers, res, req });
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ error: e.code || 'error' }));
    req.end();
  });
}

/** Read SSE messages off an open response until n data lines came, or a time. */
function messages(res, n, ms) {
  return new Promise((resolve) => {
    const got = [];
    let buf = '';
    const done = () => { clearTimeout(t); res.removeAllListeners('data'); resolve({ got, raw: buf }); };
    const t = setTimeout(done, ms || 1500);
    res.on('data', (c) => {
      buf += c;
      const parts = buf.split('\n\n');
      for (const p of parts.slice(0, -1)) {
        const line = p.split('\n').find((l) => l.startsWith('data: '));
        if (line && !got.some((g) => g.raw === p)) got.push({ raw: p, data: JSON.parse(line.slice(6)) });
      }
      if (got.length >= n) done();
    });
  });
}

(async () => {
  const token = newToken();
  ok(/^[A-Za-z0-9_-]{32}$/.test(token) && newToken() !== token, `a token is 24 random bytes, URL safe (${token.length} characters), new every time`);
  ok(sameToken(token, token) && !sameToken(token, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')) && !sameToken('', '') && !sameToken(token, null), 'tokens compared whole, in constant time');
  let threw = false;
  try { createRatingStream({ token: 'short' }); } catch { threw = true; }
  ok(threw, 'no server without a long enough token');

  // Something already on the default port: the next one is taken.
  const blocker = net.createServer();
  const blocked = await new Promise((r) => blocker.once('error', () => r(false)).listen({ port: DEFAULT_PORT, host: '127.0.0.1' }, () => r(true)));
  const s = createRatingStream({ token, page: widgetPage.page });
  const st = await s.start();
  ok(st.ok && s.running() && (blocked ? st.port !== DEFAULT_PORT && st.port > DEFAULT_PORT && st.port <= DEFAULT_PORT + 9 : st.port === DEFAULT_PORT),
    `started on ${st.port}${blocked ? `, ${DEFAULT_PORT} being taken` : ''}`);
  ok(st.url === `http://127.0.0.1:${st.port}/${token}/` && s.url('compact') === `http://127.0.0.1:${st.port}/${token}/?size=compact`, 'its address for OBS, standard and compact');
  const again = await s.start();
  ok(again.ok && again.port === st.port, 'started twice is one server');
  const port = st.port;

  // Loopback only: the server's own address, and nothing on another of this PC's.
  const addrs = Object.values(require('os').networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  if (addrs.length) {
    const other = await get(port, `/${token}/`, { address: addrs[0], host: `127.0.0.1:${port}` });
    ok(other.error === 'ECONNREFUSED' || other.error === 'ETIMEDOUT' || other.error === 'EHOSTUNREACH', `nothing answers on this PC's network address (${other.error || other.status})`);
  } else ok(true, 'no network address on this PC to try: loopback only by its own bind');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'services', 'rating-stream.js'), 'utf8');
  ok(/host: '127\.0\.0\.1'/.test(src) && !/0\.0\.0\.0'|host: '::'|host: ''/.test(src), 'bound to 127.0.0.1 in the code, never 0.0.0.0');

  // The page.
  const pg = await get(port, `/${token}/`);
  ok(pg.status === 200 && /^text\/html/.test(pg.headers['content-type']) && /<main id="w"/.test(pg.body), 'the page under the token');
  ok(!Object.keys(pg.headers).some((h) => /^access-control-/i.test(h)), 'no CORS header on the page');
  ok(/default-src 'none'/.test(pg.headers['content-security-policy'] || '') && pg.headers['cache-control'] === 'no-store' && pg.headers['x-content-type-options'] === 'nosniff',
    'its own CSP, no cache, no sniffing');
  ok(!/\/\*(FONTS|THEME|BADGE_CSS|WIDGET_CSS|BADGE_JS|WIDGET_JS)\*\//.test(pg.body) && /font\/woff2;base64,/.test(pg.body) && !/(?:src|href)=["']?https?:/i.test(pg.body) && !/url\(\s*['"]?https?:/i.test(pg.body),
    'self contained: every slot filled, the fonts as data, nothing fetched from the net');
  ok(/background: transparent !important/.test(pg.body), 'its background transparent, for OBS to lay over the stream');
  const pgq = await get(port, `/${token}/?size=compact`);
  ok(pgq.status === 200, 'the compact size is the same page with ?size=compact');

  // Everything else.
  const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  for (const [what, p, o] of [
    ['no token', '/', {}], ['the favicon', '/favicon.ico', {}], ['a wrong token', `/${wrong}/`, {}], ['the token without its slash', `/${token}`, {}],
    ['a file under the token', `/${token}/widget.js`, {}], ['a directory walk', `/${token}/../`, {}], ['a path under events', `/${token}/events/x`, {}],
    ['a POST', `/${token}/`, { method: 'POST' }], ['an OPTIONS preflight', `/${token}/`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } }],
    ['a rebinding Host', `/${token}/`, { host: `evil.example:${port}` }], ['the Host of another port', `/${token}/`, { host: `127.0.0.1:${port + 1}` }],
    ['no Host at all', `/${token}/`, { noHost: true }], ['the events with a rebinding Host', `/${token}/events`, { host: `attacker.test:${port}` }],
  ]) {
    const r = await get(port, p, o);
    ok((r.status === 404 || (o.noHost && r.status === 400)) && !/<main|data:/.test(r.body || '') && !Object.keys(r.headers).some((h) => /^access-control-/i.test(h)), `${what}: refused, nothing served, no CORS header (${r.status})`);
  }
  const lh = await get(port, `/${token}/`, { host: `localhost:${port}` });
  ok(lh.status === 200, 'localhost with the port is the same machine: answered');

  // The events.
  s.send({ state: 'live', rating: { shown: '63', value: 6.3, tier: 'fair', last: { delta: '+3', up: true, down: false, label: 'First kill, 5v5' }, line: [6, 6.3] } });
  const ev = await get(port, `/${token}/events`, { stream: true });
  ok(ev.status === 200 && /^text\/event-stream/.test(ev.headers['content-type']) && ev.headers['cache-control'] === 'no-store'
    && !Object.keys(ev.headers).some((h) => /^access-control-/i.test(h)), 'the events: text/event-stream, no cache, no CORS header');
  const first = await messages(ev.res, 1, 1500);
  ok(/^retry: 2000/m.test(first.raw) && first.got[0] && first.got[0].data.state === 'live' && first.got[0].data.rating.shown === '63',
    'a viewer that joins is told to come back in two seconds and given the last payload at once');
  ok(s.clients() === 1, 'one viewer');
  const more = messages(ev.res, 2, 1500);
  ok(s.send({ state: 'live', rating: { shown: '63', value: 6.3, tier: 'fair', last: { delta: '+3', up: true, down: false, label: 'First kill, 5v5' }, line: [6, 6.3] } }) === false, 'the same payload again is not sent');
  s.send({ state: 'live', rating: { shown: '61', value: 6.1, tier: 'fair', last: { delta: '-2', up: false, down: true, label: 'Died, 4v4' }, line: [6, 6.3, 6.1] } });
  s.send({ state: 'idle' });
  const next = await more;
  ok(next.got.length === 2 && next.got[0].data.rating.shown === '61' && next.got[1].data.state === 'idle', 'each new payload once, in order');
  ok(next.got.every((g) => Object.keys(g.data).every((k) => k === 'state' || k === 'rating')), 'nothing but what main sent');

  // Stopped: every viewer cut, nothing answers.
  const closed = new Promise((r) => { ev.res.on('close', () => r(true)); ev.res.on('end', () => r(true)); setTimeout(() => r(false), 2000); });
  await s.stop();
  ok(await closed, 'stopping cuts the viewer');
  ok(!s.running() && s.url() === null, 'stopped: no address');
  const after = await get(port, `/${token}/`);
  ok(after.error === 'ECONNREFUSED', `stopped: nothing answers (${after.error || after.status})`);
  // Started again: the same port when free.
  const back = await s.start();
  ok(back.ok && back.port === port, 'started again, on the same port');
  await s.stop();
  // A stop while a start is still listening: the server is closed again, never left running.
  const racing = s.start();
  const stopped = s.stop();
  const raced = await racing;
  await stopped;
  const afterRace = await get(port, `/${token}/`);
  ok(!raced.ok && !s.running() && s.url() === null && afterRace.error === 'ECONNREFUSED', `a stop during a start leaves nothing running (${raced.error || 'ok'}, ${afterRace.error || afterRace.status})`);
  const again2 = await s.start();
  ok(again2.ok && s.running(), 'and a start after it serves again');
  await s.stop();
  if (blocked) blocker.close();

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' stream widget server checks passed'}`);
  process.exit(fails ? 1 : 0);
})();
