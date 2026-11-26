'use strict';

/**
 * THE STREAM WIDGET'S SERVER (the live rating, docs/claude/rating.md "Live",
 * docs/claude/screen-silence.md "The live rating, the second exception").
 *
 * A browser source a streamer adds to OBS, so viewers watch the rating move.
 * Occlara draws nothing over the game: OBS fetches this page and lays it on
 * the stream. Node's own http, no dependency. Main starts it only while both
 * switches are on (liveRating and liveRatingStream) and stops it the moment
 * either goes off, every connection cut.
 *
 * Locked down, because a page on the player's PC can be reached by any web
 * page the player opens:
 *   - bound to 127.0.0.1 only, never 0.0.0.0, never another address;
 *   - every path starts with a per install random token (index.js keeps it,
 *     no page can write it), compared in constant time, so no other page can
 *     guess the address;
 *   - the Host header must be this loopback address and port (127.0.0.1 or
 *     localhost), so a DNS rebinding page whose name now points here is
 *     refused;
 *   - it answers two things, GET /<token>/ (the page) and GET /<token>/events
 *     (the server sent events), and 404 with no body to everything else: no
 *     directory, no file, no other method, no CORS header ever.
 *
 * What the events carry is main's to decide (index.js widgetPayload): only
 * what the Recording screen may show of the rating, nothing else of the match.
 */

const http = require('http');
const crypto = require('crypto');

const DEFAULT_PORT = 47815;
const FALLBACKS = 9;             // 47815 to 47824, then any free port
const MAX_CLIENTS = 8;
const HEARTBEAT_MS = 15000;

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** A new token: 24 random bytes, URL safe. */
function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * @param o.token  the per install token (required, at least 16 characters)
 * @param o.page   () -> the page's HTML (built by main, self contained)
 * @param o.port   the port to try first (the last one that worked), else 47815
 * @param o.log    (line) -> void
 */
function createRatingStream(o) {
  const opts = o || {};
  const token = String(opts.token || '');
  if (token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('rating-stream: a token of 16 URL safe characters or more is needed');
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  let server = null;
  let port = null;
  const sockets = new Set();
  const clients = new Set();
  let last = null;               // the last payload, for a client that joins
  let beat = null;
  let starting = null;
  let gen = 0;                   // every stop() moves it: a start in flight then stands down

  const hostOk = (host) => {
    const h = String(host || '').toLowerCase();
    return port !== null && (h === `127.0.0.1:${port}` || h === `localhost:${port}`);
  };

  function nothing(res) {
    res.writeHead(404, { 'Content-Length': '0', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end();
  }

  function handle(req, res) {
    try {
      if (req.method !== 'GET' || !hostOk(req.headers.host)) return nothing(res);
      const url = String(req.url || '');
      const q = url.indexOf('?');
      const p = q >= 0 ? url.slice(0, q) : url;
      const m = /^\/([A-Za-z0-9_-]{16,})\/(events)?$/.exec(p);
      if (!m || !sameToken(m[1], token)) return nothing(res);
      if (m[2] === 'events') return events(req, res);
      const html = typeof opts.page === 'function' ? String(opts.page() || '') : '';
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    } catch {
      try { nothing(res); } catch { /* the socket went */ }
    }
  }

  function events(req, res) {
    if (clients.size >= MAX_CLIENTS) return nothing(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    // The browser source reconnects by itself, two seconds after a drop.
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(last || { state: 'idle' })}\n\n`);
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
  }

  function listen(p) {
    return new Promise((resolve) => {
      const s = http.createServer(handle);
      s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
      s.once('error', (e) => resolve({ ok: false, error: e && e.code ? e.code : 'listen' }));
      s.listen({ port: p, host: '127.0.0.1', exclusive: true }, () => resolve({ ok: true, server: s }));
    });
  }

  /** Start on the first free port of the list (the last one that worked first). */
  async function start() {
    if (server) return { ok: true, port, url: url() };
    if (starting) return starting;
    const mine = gen;
    starting = (async () => {
      const first = Number.isInteger(opts.port) && opts.port >= 1024 && opts.port <= 65535 ? opts.port : DEFAULT_PORT;
      const tries = [first, ...Array.from({ length: FALLBACKS + 1 }, (_, i) => DEFAULT_PORT + i).filter((x) => x !== first), 0];
      for (const p of tries) {
        if (mine !== gen) return { ok: false, error: 'stopped' };
        const got = await listen(p);
        // Stopped while it was listening: closed again, never left running.
        if (got.ok && mine !== gen) { await new Promise((r) => got.server.close(() => r())); return { ok: false, error: 'stopped' }; }
        if (got.ok) {
          server = got.server;
          port = server.address().port;
          beat = setInterval(() => { for (const c of clients) { try { c.write(': \n\n'); } catch { clients.delete(c); } } }, HEARTBEAT_MS);
          if (beat.unref) beat.unref();
          log(`[widget] the stream widget is served on 127.0.0.1:${port}`);
          return { ok: true, port, url: url() };
        }
        if (got.error !== 'EADDRINUSE' && got.error !== 'EACCES') return { ok: false, error: got.error };
      }
      return { ok: false, error: 'EADDRINUSE' };
    })();
    try { return await starting; } finally { starting = null; }
  }

  /** Stop: the server closed and every connection cut, SSE ones included. */
  function stop() {
    gen += 1;
    if (beat) { clearInterval(beat); beat = null; }
    for (const c of clients) { try { c.end(); } catch { /* gone */ } }
    clients.clear();
    const s = server;
    server = null;
    port = null;
    for (const sock of sockets) { try { sock.destroy(); } catch { /* gone */ } }
    sockets.clear();
    if (!s) return Promise.resolve();
    return new Promise((resolve) => s.close(() => resolve()));
  }

  /** One payload to every viewer, kept for the next to join. Only when it changed. */
  function send(payload) {
    const text = JSON.stringify(payload || { state: 'idle' });
    if (last && JSON.stringify(last) === text) return false;
    last = JSON.parse(text);
    for (const c of clients) { try { c.write(`data: ${text}\n\n`); } catch { clients.delete(c); } }
    return true;
  }

  /** The address to give OBS, or null while stopped. size: 'standard' | 'compact'. */
  function url(size) {
    if (port === null) return null;
    return `http://127.0.0.1:${port}/${token}/${size === 'compact' ? '?size=compact' : ''}`;
  }

  return { start, stop, send, url, running: () => !!server, port: () => port, clients: () => clients.size };
}

module.exports = { createRatingStream, newToken, sameToken, DEFAULT_PORT };
