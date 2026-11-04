'use strict';

const http = require('http');
const crypto = require('crypto');
const usage = require('../../shared/usage');

/**
 * THE ACCOUNT (8.7): sign in through the browser, the app session it leaves,
 * the headers every request sends, and the account's games.
 *
 * SIGN IN IS A ONE SHOT LOOPBACK WITH PKCE. signIn() listens on 127.0.0.1 on
 * a random port, makes a state (16 random bytes) and a verifier (32), and
 * opens occlara.app/app/signin with the state, the verifier's sha256 (the
 * challenge) and the port. The site signs the player in, asks Railway for a
 * one time code bound to the state and the challenge, and sends the browser
 * to http://127.0.0.1:<port>/callback?code=..&state=... Only that path with
 * this flow's state is taken: anything else is refused and the flow keeps
 * waiting, the server closes on the one it takes, and the code is exchanged
 * with the verifier, which never left this process, for an app session
 * token. Ten minutes at most, and Cancel ends it.
 *
 * THE DEEP LINK IS THE FALLBACK, and only while a flow is pending:
 * occlara://auth?code=..&state=.. (Windows hands it to the running app in
 * `second-instance` argv) is taken only with the pending flow's state. With
 * none pending it is ignored, so a link cannot sign anybody in by itself.
 *
 * THE TOKEN IS NEVER LOGGED and is kept with safeStorage (DPAPI on Windows),
 * encrypted and base64 in the store under `accountToken`. Where encryption is
 * not available it is kept in memory for this run only, never in plain text.
 *
 * auth() is what every request sends: the session bearer when signed in, else
 * X-License-Key when a key is stored (the 8.6 path, unchanged: the store key
 * `licenseKey` still holds it). me() caches account_state for 60 s and never
 * throws: an error is null, which every caller reads as "go on".
 *
 * Built by createAccountService(deps) so test-account-service.js drives it
 * with a stub store, safeStorage, api and browser: nothing here requires
 * Electron.
 */

const SITE = 'https://occlara.app';
const SIGNIN_PATH = '/app/signin';
const FLOW_MS = 10 * 60 * 1000;
const ME_TTL_MS = 60 * 1000;
const TOKEN_KEY = 'accountToken';
const ROUTES = {
  EXCHANGE: '/api/account/exchange',
  SIGNOUT: '/api/account/signout',
  ME: '/api/account/me',
  CLAIM: '/api/usage/claim',
  RELEASE: '/api/usage/release',
  REFERRAL: '/api/referral',
};
// The app session token the exchange hands back: occ_ and 43 base64url
// characters by the contract, taken loosely so a longer one still works.
const TOKEN_SHAPE = /^occ_[A-Za-z0-9_-]{20,200}$/;
// A state or a code from the browser: base64url of sane length.
const PARAM_SHAPE = /^[A-Za-z0-9_-]{8,200}$/;
// The invite link GET /api/referral answers: the site's /invite/<code> route,
// the code as server/routes/usage.js REF_CODE takes it (4 to 16 letters and
// digits), which the site's isInviteCode accepts too.
const INVITE_LINK = /^https:\/\/occlara\.app\/invite\/[A-Za-z0-9]{4,16}$/;

const CLOSE_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Occlara</title>'
  + '<style>body{background:#0b0b0d;color:#f5f5f7;font:16px system-ui,sans-serif;display:flex;'
  + 'align-items:center;justify-content:center;height:100vh;margin:0}</style></head>'
  + '<body><p>You are signed in to Occlara. You can close this tab.</p></body></html>';
const REFUSED_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Occlara</title></head>'
  + '<body><p>This sign in link is not for the Occlara window waiting on this PC. Start again from the app.</p></body></html>';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function challengeOf(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}

/** A state or code as it came, or null when it is not one. */
function param(v) {
  return typeof v === 'string' && PARAM_SHAPE.test(v) ? v : null;
}

/** account_state as the pages read it, from the server's answer. */
function normalizeState(data) {
  if (!data || typeof data !== 'object') return null;
  const a = data.account && typeof data.account === 'object' ? data.account : data;
  const tier = typeof a.tier === 'string' ? a.tier.toLowerCase() : null;
  if (!tier) return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const inv = a.invites && typeof a.invites === 'object' ? a.invites : {};
  return {
    tier,
    used: num(a.used),
    left: num(a.left),
    cap_monthly: num(a.cap_monthly),
    period_end: a.period_end || null,
    free_total: num(a.free_total),
    bonus_pool: num(a.bonus_pool) || 0,
    bonus_earned: num(a.bonus_earned) || 0,
    invites: { pending: num(inv.pending) || 0, qualified: num(inv.qualified) || 0, refused: num(inv.refused) || 0 },
    account_key: typeof a.account_key === 'string' ? a.account_key : null,
    email: typeof (a.email || data.email) === 'string' ? (a.email || data.email) : null,
    // A definite cap: the server enforces and nothing is left. Start refuses
    // on this alone (index.js), never on a number worked out here.
    capped: (data.capped === true || a.capped === true),
  };
}

function createAccountService(deps) {
  const d = {
    store: null,
    api: null,
    safeStorage: null,
    openExternal: async () => {},
    deviceId: () => '',
    deviceName: () => '',
    log: (...a) => console.log(...a),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    site: SITE,
    flowMs: FLOW_MS,
    ...deps,
  };

  let memToken = null;      // the session token, decrypted, for this run
  let tokenRead = false;
  let flow = null;          // the sign in in progress
  let me = null;            // { at, state } the last account_state
  let meAsk = null;         // the me() call in flight
  const listeners = new Set();
  const refusedListeners = new Set();

  function emit() {
    const v = view();
    for (const cb of listeners) { try { cb(v); } catch (e) { d.log('[account] listener:', e.message); } }
  }

  // ── the token ───────────────────────────────────────────────────────────────
  function canEncrypt() {
    try { return !!(d.safeStorage && d.safeStorage.isEncryptionAvailable && d.safeStorage.isEncryptionAvailable()); }
    catch { return false; }
  }

  function token() {
    if (memToken) return memToken;
    if (tokenRead) return null;
    tokenRead = true;
    const kept = d.store && d.store.get(TOKEN_KEY);
    if (!kept || typeof kept !== 'string') return null;
    if (!canEncrypt()) return null;
    try {
      const t = d.safeStorage.decryptString(Buffer.from(kept, 'base64'));
      memToken = TOKEN_SHAPE.test(t) ? t : null;
    } catch (e) {
      d.log('[account] the kept sign in could not be read, signing in again is needed');
      memToken = null;
    }
    return memToken;
  }

  function keepToken(t) {
    memToken = t;
    tokenRead = true;
    if (!canEncrypt()) {
      d.log('[account] encryption is not available on this PC: the sign in lasts until the app closes');
      try { d.store.set(TOKEN_KEY, ''); } catch {}
      return;
    }
    try {
      d.store.set(TOKEN_KEY, d.safeStorage.encryptString(t).toString('base64'));
    } catch (e) {
      d.log('[account] the sign in could not be kept on disk:', e.message);
    }
  }

  function dropToken() {
    memToken = null;
    tokenRead = true;
    try { d.store.set(TOKEN_KEY, ''); } catch {}
  }

  function signedIn() { return !!token(); }

  function licenceKey() {
    const k = d.store && d.store.get('licenseKey');
    return typeof k === 'string' && k ? k : '';
  }

  /** The headers every request sends: the session, else the key, else none. */
  function auth() {
    const t = token();
    if (t) return { Authorization: `Bearer ${t}` };
    const k = licenceKey();
    return k ? { 'X-License-Key': k } : {};
  }

  function hasAuth() { return signedIn() || !!licenceKey(); }

  // ── sign in ─────────────────────────────────────────────────────────────────
  function finish(f, result) {
    if (!f || f.done) return;
    f.done = true;
    if (f.timer) d.clearTimeout(f.timer);
    try { if (f.server) f.server.close(); } catch {}
    if (flow === f) flow = null;
    f.resolve(result);
    emit();
  }

  async function exchange(f, code) {
    if (f.exchanging || f.done) return;
    f.exchanging = true;
    // The loopback has done its one job: nothing else is taken on it.
    try { if (f.server) f.server.close(); } catch {}
    emit();
    let res;
    try {
      res = await d.api.post(ROUTES.EXCHANGE, {
        code, verifier: f.verifier, state: f.state,
        device_id: d.deviceId(), device_name: d.deviceName(),
      }, null, 15000);
    } catch (e) {
      d.log('[account] sign in exchange could not reach the server:', e.message);
      finish(f, { ok: false, error: 'unreachable' });
      return;
    }
    if (f.done) return;
    const t = res && res.ok && res.data && typeof res.data.token === 'string' ? res.data.token : null;
    if (!t || !TOKEN_SHAPE.test(t)) {
      d.log('[account] sign in exchange refused, status', res && res.status);
      finish(f, { ok: false, error: 'refused' });
      return;
    }
    keepToken(t);
    const st = normalizeState(res.data.account);
    me = st ? { at: d.now(), state: st } : null;
    d.log('[account] signed in through the browser');
    finish(f, { ok: true, account: view() });
  }

  function onRequest(f, req, res) {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { url = null; }
    if (!url || req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const state = param(url.searchParams.get('state'));
    const code = param(url.searchParams.get('code'));
    if (f.done || f.exchanging || !state || state !== f.state || !code) {
      // Refused, and the flow goes on waiting for its own state.
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REFUSED_PAGE);
      if (!f.done && !f.exchanging) d.log('[account] a sign in callback with another state was refused');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(CLOSE_PAGE);
    exchange(f, code);
  }

  /**
   * Sign in through the browser. Resolves { ok: true, account } once signed
   * in, or { ok: false, error: 'cancelled' | 'timeout' | 'refused' |
   * 'unreachable' | 'browser' | 'listen' }. One flow at a time: a second call
   * while one waits gets the same promise.
   */
  function signIn(opts) {
    if (flow) return flow.promise;
    const f = {
      state: b64url(crypto.randomBytes(16)),
      verifier: b64url(crypto.randomBytes(32)),
      done: false, exchanging: false, server: null, timer: null, port: null,
    };
    f.promise = new Promise((resolve) => { f.resolve = resolve; });
    flow = f;
    const ms = (opts && opts.timeoutMs) || d.flowMs;
    const server = http.createServer((req, res) => onRequest(f, req, res));
    f.server = server;
    server.on('error', (e) => {
      d.log('[account] the sign in listener failed:', e.message);
      finish(f, { ok: false, error: 'listen' });
    });
    server.listen(0, '127.0.0.1', async () => {
      if (f.done) { try { server.close(); } catch {} return; }
      f.port = server.address().port;
      f.timer = d.setTimeout(() => {
        d.log('[account] sign in timed out');
        finish(f, { ok: false, error: 'timeout' });
      }, ms);
      const q = new URLSearchParams({ state: f.state, challenge: challengeOf(f.verifier), port: String(f.port) });
      f.url = `${d.site}${SIGNIN_PATH}?${q.toString()}`;
      emit();
      try {
        await d.openExternal(f.url);
      } catch (e) {
        d.log('[account] the browser could not be opened:', e.message);
        finish(f, { ok: false, error: 'browser' });
      }
    });
    return f.promise;
  }

  function cancel() {
    if (!flow) return false;
    finish(flow, { ok: false, error: 'cancelled' });
    return true;
  }

  function pending() { return !!flow && !flow.done; }

  /**
   * occlara://auth?code=..&state=.., taken only while a flow is pending and
   * only with its state. True when it was taken.
   */
  function handleDeepLink(raw) {
    const f = flow;
    if (!f || f.done || f.exchanging) return false;
    let url;
    try { url = new URL(String(raw || '')); } catch { return false; }
    if (url.protocol !== 'occlara:') return false;
    const where = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
    if (where !== 'auth') return false;
    const state = param(url.searchParams.get('state'));
    const code = param(url.searchParams.get('code'));
    if (!state || state !== f.state || !code) {
      d.log('[account] a sign in link with another state was refused');
      return false;
    }
    exchange(f, code);
    return true;
  }

  /** The first occlara:// argument of a command line, or null. */
  function deepLinkIn(argv) {
    for (const a of Array.isArray(argv) ? argv : []) {
      if (typeof a === 'string' && /^occlara:\/\//i.test(a)) return a;
    }
    return null;
  }

  // ── the account ─────────────────────────────────────────────────────────────
  function sessionRefused() {
    if (!token()) return;
    d.log('[account] the server no longer accepts this sign in');
    dropToken();
    me = null;
    emit();
    for (const cb of refusedListeners) { try { cb(); } catch {} }
  }

  /**
   * account_state, cached for 60 s, or null when it cannot be said: not
   * signed in and no key, accounts not live on the server, an error. Never
   * throws, and nothing waits on it longer than `timeoutMs`.
   */
  async function meNow(opts) {
    const o = opts || {};
    if (!hasAuth()) return null;
    if (!o.force && me && d.now() - me.at < ME_TTL_MS) return me.state;
    if (meAsk) return meAsk;
    const viaSession = signedIn();
    meAsk = (async () => {
      try {
        const res = await d.api.get(ROUTES.ME, auth, o.timeoutMs || 8000);
        if (res && res.ok) {
          const st = normalizeState(res.data);
          const before = me && JSON.stringify(me.state);
          me = st ? { at: d.now(), state: st } : null;
          if (JSON.stringify(st) !== before) emit();
          return st;
        }
        if (res && res.status === 401 && viaSession) sessionRefused();
        return null;
      } catch (e) {
        return null;
      } finally {
        meAsk = null;
      }
    })();
    return meAsk;
  }

  /** The last account_state, however old, or null. */
  function cached() { return me ? me.state : null; }

  /** Whether the last account_state is younger than the cache's 60 s. */
  function fresh() { return !!me && d.now() - me.at < ME_TTL_MS; }

  /** How old the last account_state is, in ms, or Infinity with none. */
  function age() { return me ? Math.max(0, d.now() - me.at) : Infinity; }

  /**
   * Count one game recorded outside the live read: a League game or a review
   * from Riot's record alone. { granted, left, reason }. Anything but the
   * server's own no is granted: an old server, accounts not live, an outage.
   */
  async function claim(c) {
    const o = c || {};
    if (!hasAuth()) return { granted: true, skipped: true };
    let res;
    try {
      res = await d.api.post(ROUTES.CLAIM, {
        game: o.game, kind: o.kind, client_match_id: o.clientMatchId || null, device_id: d.deviceId(),
      }, auth, o.timeoutMs || 10000);
    } catch (e) {
      return { granted: true, unknown: true };
    }
    me = null;   // the count moved, whatever the answer
    if (res && res.ok && res.data && typeof res.data === 'object') {
      const granted = res.data.granted !== false;
      meNow({ force: true }).catch(() => {});
      return { granted, left: Number.isFinite(Number(res.data.left)) ? Number(res.data.left) : null, reason: res.data.reason || null };
    }
    if (res && res.status === 402) {
      meNow({ force: true }).catch(() => {});
      return { granted: false, left: 0, reason: (res.data && res.data.reason) || 'cap' };
    }
    return { granted: true, unknown: true };
  }

  /**
   * POST /api/usage/release: a Riot record game claimed by a run that was
   * taken back is given back. { released } and never throws: a release that
   * does not land costs a game, never anything else.
   */
  async function release(clientMatchId) {
    if (!hasAuth() || typeof clientMatchId !== 'string' || !clientMatchId) return { released: false };
    let res;
    try {
      res = await d.api.post(ROUTES.RELEASE, { client_match_id: clientMatchId }, auth, 10000);
    } catch (e) {
      return { released: false };
    }
    const released = !!(res && res.ok && res.data && res.data.released === true);
    if (released) { me = null; meNow({ force: true }).catch(() => {}); }
    return { released };
  }

  /** GET /api/referral with its progress line, or null. */
  async function referral() {
    if (!hasAuth()) return null;
    try {
      const res = await d.api.get(ROUTES.REFERRAL, auth, 10000);
      if (!res || !res.ok || !res.data || typeof res.data !== 'object') return null;
      const r = res.data;
      return {
        code: typeof r.code === 'string' ? r.code : null,
        // Only the site's /invite/<code> route, with a code the server's
        // redeem (REF_CODE) and the site's isInviteCode both accept.
        link: typeof r.link === 'string' && INVITE_LINK.test(r.link) ? r.link : null,
        invited: Number(r.invited) || 0,
        qualified: Number(r.qualified) || 0,
        earned: Number(r.earned) || 0,
        max_friends: Number(r.max_friends) || usage.MAX_FRIENDS,
        max_games: Number(r.max_games) || usage.MAX_EARNED,
        line: usage.inviteProgress(r),
        how: usage.INVITE_HOW.slice(),
      };
    } catch {
      return null;
    }
  }

  /** Sign out: the server is told when it can be, the token goes either way. */
  async function signOut() {
    const t = token();
    if (flow) cancel();
    // Signed out here first, so nothing waits on the server to stop using it.
    dropToken();
    me = null;
    emit();
    if (t) {
      try { await d.api.post(ROUTES.SIGNOUT, {}, { Authorization: `Bearer ${t}` }, 5000); }
      catch (e) { d.log('[account] sign out could not reach the server, signed out here'); }
    }
    d.log('[account] signed out');
    return { ok: true };
  }

  /** What the pages are handed: finished strings and flags, never the token. */
  function view() {
    const st = cached();
    const via = signedIn() ? 'session' : (licenceKey() ? 'key' : null);
    return {
      signedIn: via === 'session',
      via,
      pending: pending(),
      waiting: !!(flow && flow.exchanging),
      email: st ? st.email : null,
      tier: st ? st.tier : null,
      tierLabel: st ? usage.tierLabel(st) : '',
      gamesLeft: st ? usage.gamesLeft(st) : '',
      cap: st ? usage.capState(st) : null,
      capped: !!(st && st.capped),
      accountKey: (st && st.account_key) || (via === 'key' ? licenceKey() : null),
      invites: st ? st.invites : null,
      urls: { upgrade: usage.UPGRADE_URL, account: usage.ACCOUNT_URL, signup: usage.SIGNUP_URL },
    };
  }

  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function onRefused(cb) { refusedListeners.add(cb); return () => refusedListeners.delete(cb); }

  return {
    signIn, cancel, pending, handleDeepLink, deepLinkIn,
    signedIn, hasAuth, auth, me: meNow, cached, fresh, age, claim, release, referral, signOut, view,
    onChange, onRefused, sessionRefused,
    // For the tests: the flow's state and port, never its verifier.
    _flow: () => (flow ? { state: flow.state, port: flow.port, url: flow.url } : null),
  };
}

module.exports = { createAccountService, normalizeState, challengeOf, ROUTES, SITE, TOKEN_KEY, FLOW_MS, ME_TTL_MS, INVITE_LINK };
