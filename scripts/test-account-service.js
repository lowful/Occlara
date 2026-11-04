'use strict';

/**
 * The account's sign in and session (8.7, src/main/services/account-service.js),
 * on a real loopback socket with a stub browser, server, store and safeStorage:
 *
 *   - the loopback is one shot: the browser's callback with the flow's state
 *     is taken once, the page says the tab can close, the listener closes,
 *     and the code goes to the exchange with the verifier whose sha256 the
 *     browser was handed as the challenge
 *   - another state, another path or another method is refused and the flow
 *     keeps waiting
 *   - occlara://auth is taken only while a flow is pending, and only with its
 *     state
 *   - a flow ends after its time, and Cancel ends it
 *   - the token is kept through safeStorage, never in plain text, read back by
 *     the next run, and in memory only where encryption is not available
 *   - the token is never logged, never in the view a page is handed
 *   - auth() sends the session, else the key, else nothing; me() caches 60 s,
 *     an error is null, a refused session ends the sign in
 *   - claim(): the server's no is a no, anything else is granted
 *   - api-client.js authHeaders, the third argument as a provider
 *
 * Run: npm run test:accountservice
 */

const http = require('http');
const crypto = require('crypto');
const { createAccountService, challengeOf, normalizeState, TOKEN_KEY } = require('../src/main/services/account-service');
const { authHeaders } = require('../src/main/services/api-client');

let failed = 0;
let passed = 0;
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function memStore(init) {
  const data = { licenseKey: '', ...(init || {}) };
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}

// A safeStorage that "encrypts" reversibly, so the test can tell plain text
// from what it wrote.
function stubSafe(available) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('enc:' + Buffer.from(s, 'utf8').toString('hex'), 'utf8'),
    decryptString: (b) => {
      const s = Buffer.from(b).toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('not ours');
      return Buffer.from(s.slice(4), 'hex').toString('utf8');
    },
  };
}

function newToken() { return 'occ_' + b64url(crypto.randomBytes(32)); }

/** A server stub: records calls, answers by route. */
function stubApi(routes) {
  const calls = [];
  const answer = async (method, path, body, auth) => {
    calls.push({ method, path, body, headers: authHeaders(auth) });
    const r = routes[`${method} ${path}`];
    if (!r) return { ok: false, status: 404, data: {} };
    return typeof r === 'function' ? r(body, authHeaders(auth)) : r;
  };
  return {
    calls,
    post: (path, body, auth) => answer('POST', path, body, auth),
    get: (path, auth) => answer('GET', path, null, auth),
  };
}

function fetchLocal(port, pathAndQuery, method) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathAndQuery, method: method || 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    req.end();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function harness(opts) {
  const o = opts || {};
  const logs = [];
  const opened = [];
  const token = o.token || newToken();
  const exchanged = [];
  const api = stubApi({
    'POST /api/account/exchange': (body) => {
      exchanged.push(body);
      if (o.refuse) return { ok: false, status: 400, data: { error: 'bad code' } };
      return { ok: true, status: 200, data: { token, account: { tier: 'free', used: 0, left: 3, free_total: 3, account_key: 'GC-AAAA-BBBB-CCCC-DDDD' } } };
    },
    'POST /api/account/signout': { ok: true, status: 200, data: { ok: true } },
    ...(o.routes || {}),
  });
  const store = o.store || memStore();
  let clock = o.clock || 1000000;
  const svc = createAccountService({
    store,
    api,
    safeStorage: o.safe || stubSafe(true),
    openExternal: async (url) => { opened.push(url); if (o.browserFails) throw new Error('no browser'); },
    deviceId: () => 'dev-1',
    deviceName: () => 'PC-1',
    log: (...a) => logs.push(a.join(' ')),
    now: () => clock,
    ...(o.deps || {}),
  });
  return { svc, api, store, logs, opened, token, exchanged, tick: (ms) => { clock += ms; } };
}

async function opened(h) {
  for (let i = 0; i < 100 && !h.opened.length; i++) await wait(5);
  const u = new URL(h.opened[h.opened.length - 1]);
  return { url: u, state: u.searchParams.get('state'), challenge: u.searchParams.get('challenge'), port: Number(u.searchParams.get('port')) };
}

async function main() {
  // Every log line of the run, the console's included, to hold the token to.
  const consoleLines = [];
  const realLog = console.log;
  const realWarn = console.warn;
  const realError = console.error;
  const capture = (...a) => consoleLines.push(a.join(' '));

  console.log('\n[accountservice] the shapes it trusts');
  {
    const t = newToken();
    ok(/^occ_[A-Za-z0-9_-]{43}$/.test(t), 'a contract token is occ_ and 43 base64url characters', t.length);
    const h = harness();
    ok(h.svc.deepLinkIn(['C:\\Occlara.exe', '--x', 'occlara://auth?code=abcdefgh&state=ijklmnop']) === 'occlara://auth?code=abcdefgh&state=ijklmnop',
      'the deep link is found in a second instance\'s argv');
    ok(h.svc.deepLinkIn(['C:\\Occlara.exe', 'https://occlara.app']) === null, 'and nothing else is taken for one');
    const st = normalizeState({ tier: 'PRO', left: '18', cap_monthly: 25, capped: false, invites: { qualified: 1 } });
    ok(st && st.tier === 'pro' && st.left === 18 && st.invites.qualified === 1 && st.capped === false,
      'account_state is normalized: tier lower case, numbers as numbers', JSON.stringify(st));
    ok(normalizeState({ error: 'nope' }) === null, 'and an answer with no tier is no state');
  }

  console.log('\n[accountservice] the loopback is one shot, with PKCE');
  {
    console.log = capture; console.warn = capture; console.error = capture;
    const h = harness();
    const done = h.svc.signIn();
    const again = h.svc.signIn();
    const f = await opened(h);
    console.log = realLog; console.warn = realWarn; console.error = realError;
    ok(again === done, 'a second Sign in while one waits is the same flow');
    ok(f.url.origin === 'https://occlara.app' && f.url.pathname === '/app/signin', 'the browser is sent to occlara.app/app/signin', f.url.href);
    ok(/^[A-Za-z0-9_-]{22}$/.test(f.state || ''), 'the state is 16 random bytes, base64url', f.state);
    ok(/^[A-Za-z0-9_-]{43}$/.test(f.challenge || ''), 'the challenge is a sha256, base64url', f.challenge);
    ok(Number.isInteger(f.port) && f.port >= 1024 && f.port <= 65535, 'on a port the site accepts', f.port);
    ok(h.svc.pending(), 'the flow is pending while the browser is out');

    const other = await fetchLocal(f.port, '/elsewhere?code=abcdefgh&state=' + f.state);
    ok(other.status === 404, 'another path is not found', other.status);
    const posted = await fetchLocal(f.port, '/callback?code=abcdefgh&state=' + f.state, 'POST');
    ok(posted.status === 404, 'nor is a POST to the callback', posted.status);
    const wrong = await fetchLocal(f.port, '/callback?code=abcdefghij&state=zzzzzzzzzzzzzzzzzzzzzz');
    ok(wrong.status === 400 && h.exchanged.length === 0 && h.svc.pending(),
      'a callback with another state is refused, nothing is exchanged, and the flow goes on waiting', JSON.stringify(wrong));
    const noCode = await fetchLocal(f.port, '/callback?state=' + f.state);
    ok(noCode.status === 400 && h.svc.pending(), 'and one with no code too');

    const good = await fetchLocal(f.port, '/callback?code=thecode123&state=' + f.state);
    ok(good.status === 200 && /You can close this tab/.test(good.body), 'the flow\'s own callback says the tab can close', good.body.slice(0, 120));
    const r = await done;
    ok(r && r.ok === true && r.account && r.account.signedIn === true, 'and the sign in lands', JSON.stringify(r));
    const ex = h.exchanged[0] || {};
    ok(ex.code === 'thecode123' && ex.state === f.state && ex.device_id === 'dev-1' && ex.device_name === 'PC-1',
      'the code is exchanged with its state and the device', JSON.stringify({ ...ex, verifier: '(kept)' }));
    ok(typeof ex.verifier === 'string' && challengeOf(ex.verifier) === f.challenge && ex.verifier !== f.challenge,
      'with the verifier whose sha256 the browser was handed, the verifier itself never in the URL');
    ok(!h.opened[0].includes(ex.verifier), 'the verifier never left in the browser\'s URL');
    await wait(20);
    const after = await fetchLocal(f.port, '/callback?code=thecode123&state=' + f.state);
    ok(after.status === 0, 'and the listener is closed: a second callback reaches nothing', JSON.stringify(after));
    ok(!h.svc.pending(), 'no flow is pending after it');

    // The token through safeStorage, never in plain text.
    const kept = h.store.data[TOKEN_KEY];
    ok(typeof kept === 'string' && kept.length > 0 && !kept.includes(h.token)
      && !Buffer.from(kept, 'base64').toString('utf8').includes(h.token),
    'the token is kept encrypted in the store, never in plain text');
    ok(JSON.stringify(h.svc.auth()) === JSON.stringify({ Authorization: `Bearer ${h.token}` }), 'auth() sends the session bearer');
    const view = h.svc.view();
    ok(!JSON.stringify(view).includes(h.token) && view.gamesLeft === '3 of 3 free games left' && view.accountKey === 'GC-AAAA-BBBB-CCCC-DDDD',
      'the view a page gets has the games left and the account key, never the token', JSON.stringify(view));

    // The next run reads it back through safeStorage.
    const next = harness({ store: h.store });
    ok(next.svc.signedIn() && next.svc.auth().Authorization === `Bearer ${h.token}`, 'the next run reads the sign in back through safeStorage');
    const foreign = harness({ store: memStore({ [TOKEN_KEY]: Buffer.from('plain').toString('base64') }) });
    ok(!foreign.svc.signedIn(), 'and a kept value safeStorage cannot read is no sign in');

    // Never logged, anywhere.
    const allLines = [...h.logs, ...next.logs, ...consoleLines];
    ok(allLines.length > 0 && allLines.every((l) => !l.includes(h.token)), 'the token is in no log line', allLines.join(' | '));
    ok(h.logs.some((l) => /signed in/.test(l)), 'the sign in is logged, by what happened alone');
  }

  console.log('\n[accountservice] without encryption, memory only');
  {
    const h = harness({ safe: stubSafe(false) });
    const done = h.svc.signIn();
    const f = await opened(h);
    await fetchLocal(f.port, '/callback?code=thecode123&state=' + f.state);
    const r = await done;
    ok(r.ok && h.svc.signedIn(), 'the sign in lands for this run');
    ok(!h.store.data[TOKEN_KEY], 'and nothing is written to the store', String(h.store.data[TOKEN_KEY]));
    ok(!harness({ store: h.store, safe: stubSafe(false) }).svc.signedIn(), 'so the next run asks again');
  }

  console.log('\n[accountservice] the deep link, only while pending');
  {
    const h = harness();
    ok(h.svc.handleDeepLink('occlara://auth?code=thecode123&state=abcdefghijklmnop') === false && h.exchanged.length === 0,
      'with no sign in waiting, a link signs nobody in');
    const done = h.svc.signIn();
    const f = await opened(h);
    ok(h.svc.handleDeepLink('occlara://auth?code=thecode123&state=zzzzzzzzzzzzzzzzzzzzzz') === false && h.exchanged.length === 0 && h.svc.pending(),
      'a link with another state is refused, the flow still waiting');
    ok(h.svc.handleDeepLink(`https://auth?code=thecode123&state=${f.state}`) === false, 'and another scheme is no link');
    ok(h.svc.handleDeepLink(`occlara://elsewhere?code=thecode123&state=${f.state}`) === false, 'nor another host');
    ok(h.svc.handleDeepLink(`occlara://auth?code=thecode123&state=${f.state}`) === true, 'the flow\'s own link is taken');
    const r = await done;
    ok(r.ok && h.exchanged.length === 1 && h.exchanged[0].code === 'thecode123', 'and signs in, exchanged once', JSON.stringify(r));
    await wait(20);
    const late = await fetchLocal(f.port, '/callback?code=thecode123&state=' + f.state);
    ok(late.status === 0, 'the loopback is closed by the link too');
    ok(h.svc.handleDeepLink(`occlara://auth?code=thecode123&state=${f.state}`) === false && h.exchanged.length === 1,
      'and the same link again, with no flow pending, does nothing');
  }

  console.log('\n[accountservice] a flow ends: timeout, Cancel, a refused code, no browser');
  {
    const h = harness();
    const r = await h.svc.signIn({ timeoutMs: 60 });
    ok(r.ok === false && r.error === 'timeout' && !h.svc.pending(), 'a flow ends after its time', JSON.stringify(r));
    const f = await opened(h);
    const late = await fetchLocal(f.port, '/callback?code=thecode123&state=' + f.state);
    ok(late.status === 0 && h.exchanged.length === 0, 'and its listener is closed', JSON.stringify(late));

    const c = harness();
    const done = c.svc.signIn();
    await opened(c);
    ok(c.svc.cancel() === true, 'Cancel ends a waiting flow');
    const cr = await done;
    ok(cr.ok === false && cr.error === 'cancelled' && !c.svc.pending(), 'which resolves cancelled', JSON.stringify(cr));
    ok(c.svc.cancel() === false, 'and Cancel with none waiting does nothing');

    const x = harness({ refuse: true });
    const xd = x.svc.signIn();
    const xf = await opened(x);
    await fetchLocal(xf.port, '/callback?code=thecode123&state=' + xf.state);
    const xr = await xd;
    ok(xr.ok === false && xr.error === 'refused' && !x.svc.signedIn() && !x.store.data[TOKEN_KEY],
      'a code the server refuses signs nobody in and keeps nothing', JSON.stringify(xr));

    const b = harness({ browserFails: true });
    const br = await b.svc.signIn();
    ok(br.ok === false && br.error === 'browser' && !b.svc.pending(), 'a browser that cannot be opened ends the flow', JSON.stringify(br));
  }

  console.log('\n[accountservice] auth(), me(), claim(), sign out');
  {
    const none = harness();
    ok(JSON.stringify(none.svc.auth()) === '{}' && !none.svc.hasAuth(), 'no session and no key: no auth header');
    ok(await none.svc.me() === null && none.api.calls.length === 0, 'and me() asks nobody');
    const keyed = harness({ store: memStore({ licenseKey: 'GC-1111-2222-3333-4444' }) });
    ok(JSON.stringify(keyed.svc.auth()) === JSON.stringify({ 'X-License-Key': 'GC-1111-2222-3333-4444' }) && keyed.svc.view().via === 'key',
      'a stored key alone: X-License-Key, the 8.6 path');

    let meAnswer = { ok: true, status: 200, data: { tier: 'pro', used: 7, left: 18, cap_monthly: 25, period_end: '2026-11-30T12:00:00Z' } };
    const tok = newToken();
    const store = memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok).toString('base64'), licenseKey: 'GC-1111-2222-3333-4444' });
    const h = harness({ store, routes: {
      'GET /api/account/me': () => meAnswer,
      'POST /api/usage/claim': (body) => (body.client_match_id === 'riot:capped'
        ? { ok: false, status: 402, data: { error: 'cap', granted: false, left: 0 } }
        : body.client_match_id === 'lol:down' ? { ok: false, status: 503, data: {} }
          : { ok: true, status: 200, data: { granted: body.client_match_id !== 'riot:no', left: 4, reason: null } }),
    } });
    ok(h.svc.auth().Authorization === `Bearer ${tok}` && !h.svc.auth()['X-License-Key'], 'signed in with a key stored too, the session is sent and the key is not');
    const st = await h.svc.me();
    ok(st && st.tier === 'pro' && st.left === 18, 'me() reads account_state', JSON.stringify(st));
    ok(h.api.calls.filter((c) => c.path === '/api/account/me').length === 1 && h.api.calls[0].headers.Authorization === `Bearer ${tok}`,
      'with the session');
    await h.svc.me();
    h.tick(30 * 1000);
    await h.svc.me();
    ok(h.api.calls.filter((c) => c.path === '/api/account/me').length === 1 && h.svc.fresh(), 'and is cached for 60 s');
    h.tick(31 * 1000);
    ok(!h.svc.fresh(), 'then stale');
    await h.svc.me();
    ok(h.api.calls.filter((c) => c.path === '/api/account/me').length === 2, 'and asked again');
    meAnswer = { ok: false, status: 500, data: {} };
    ok(await h.svc.me({ force: true }) === null && h.svc.signedIn() && h.svc.cached().tier === 'pro',
      'an error is null, the sign in and the last state kept');
    h.api.get = async () => { throw new Error('offline'); };
    ok(await h.svc.me({ force: true }) === null, 'and so is a network failure, never a throw');

    const claimApi = harness({ store, routes: {
      'POST /api/usage/claim': (body) => (body.client_match_id === 'riot:capped'
        ? { ok: false, status: 402, data: { error: 'cap', granted: false, left: 0 } }
        : body.client_match_id === 'lol:down' ? { ok: false, status: 503, data: {} }
          : { ok: true, status: 200, data: { granted: body.client_match_id !== 'riot:no', left: 4, reason: null } }),
    } });
    const g = await claimApi.svc.claim({ game: 'valorant', kind: 'riot', clientMatchId: 'riot:yes' });
    const sent = claimApi.api.calls.find((c) => c.path === '/api/usage/claim');
    ok(g.granted === true && g.left === 4 && sent.body.kind === 'riot' && sent.body.client_match_id === 'riot:yes' && sent.body.device_id === 'dev-1',
      'claim() sends the game, kind, client match id and device', JSON.stringify({ g, body: sent.body }));
    ok((await claimApi.svc.claim({ game: 'valorant', kind: 'riot', clientMatchId: 'riot:no' })).granted === false, 'the server\'s granted:false is a no');
    ok((await claimApi.svc.claim({ game: 'valorant', kind: 'riot', clientMatchId: 'riot:capped' })).granted === false, 'and so is its 402');
    ok((await claimApi.svc.claim({ game: 'lol', kind: 'league', clientMatchId: 'lol:down' })).granted === true, 'an outage is granted');
    claimApi.api.post = async () => { throw new Error('offline'); };
    ok((await claimApi.svc.claim({ game: 'lol', kind: 'league', clientMatchId: 'lol:x' })).granted === true, 'and so is a network failure');

    // release(): a taken back run's game given back, never a throw.
    const relApi = harness({ store, routes: {
      'POST /api/usage/release': (body) => ({ ok: true, status: 200, data: { released: body.client_match_id === 'riot:yes', reason: null } }),
    } });
    const rel = await relApi.svc.release('riot:yes');
    const relSent = relApi.api.calls.find((c) => c.path === '/api/usage/release');
    ok(rel.released === true && relSent && relSent.body.client_match_id === 'riot:yes', 'release() posts the client match id and says it was released');
    ok((await relApi.svc.release('riot:no')).released === false && (await relApi.svc.release('')).released === false,
      'a release the server did not make, or of nothing, is released false');
    relApi.api.post = async () => { throw new Error('offline'); };
    ok((await relApi.svc.release('riot:yes')).released === false, 'and a network failure is released false, never a throw');

    // A refused session ends the sign in, once, and says so to main.
    const tok2 = newToken();
    const rs = memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok2).toString('base64') });
    const r = harness({ store: rs, routes: { 'GET /api/account/me': { ok: false, status: 401, data: { error: 'session' } } } });
    let refused = 0;
    r.svc.onRefused(() => { refused++; });
    let changes = 0;
    r.svc.onChange(() => { changes++; });
    ok(await r.svc.me() === null && !r.svc.signedIn() && refused === 1 && changes >= 1 && !rs.data[TOKEN_KEY],
      'a 401 to the session ends the sign in, the token gone and main told', JSON.stringify({ refused, changes }));
    const k401 = harness({ store: memStore({ licenseKey: 'GC-1111-2222-3333-4444' }), routes: { 'GET /api/account/me': { ok: false, status: 401, data: {} } } });
    let kRefused = 0;
    k401.svc.onRefused(() => { kRefused++; });
    await k401.svc.me();
    ok(kRefused === 0 && k401.store.data.licenseKey === 'GC-1111-2222-3333-4444', 'a 401 on a key alone ends no sign in and leaves the key');

    // Sign out.
    const so = harness({ store: memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok).toString('base64') }) });
    await so.svc.signOut();
    const call = so.api.calls.find((c) => c.path === '/api/account/signout');
    ok(call && call.headers.Authorization === `Bearer ${tok}` && !so.svc.signedIn() && !so.store.data[TOKEN_KEY],
      'sign out tells the server with the session, and the token goes');
    const offline = harness({ store: memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok).toString('base64') }) });
    offline.api.post = async () => { throw new Error('offline'); };
    await offline.svc.signOut();
    ok(!offline.svc.signedIn(), 'and goes when the server cannot be told too');
  }

  console.log('\n[accountservice] the referral');
  {
    const tok = newToken();
    const h = harness({ store: memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok).toString('base64') }), routes: {
      'GET /api/referral': { ok: true, status: 200, data: { code: 'ABC123', link: 'https://occlara.app/invite/ABC123', invited: 2, qualified: 1, earned: 4, max_friends: 5, max_games: 20 } },
    } });
    const r = await h.svc.referral();
    ok(r && r.link === 'https://occlara.app/invite/ABC123' && r.line === '1 of 5 friends joined, 4 games earned, 1 still to record a match'
      && Array.isArray(r.how) && r.how.length === 2, 'GET /api/referral with its line and the two lines of how', JSON.stringify(r));
    const bad = harness({ store: memStore({ [TOKEN_KEY]: stubSafe(true).encryptString(tok).toString('base64') }), routes: {
      'GET /api/referral': { ok: true, status: 200, data: { code: 'X', link: 'https://evil.example/invite/X', qualified: 0 } },
    } });
    ok((await bad.svc.referral()).link === null, 'a link anywhere but occlara.app/invite is never handed to a page');
  }

  console.log('\n[accountservice] api-client.js, the third argument');
  {
    ok(JSON.stringify(authHeaders('GC-1')) === JSON.stringify({ 'X-License-Key': 'GC-1' }), 'a string is a licence key, as before');
    ok(JSON.stringify(authHeaders(() => ({ Authorization: 'Bearer occ_x' }))) === JSON.stringify({ Authorization: 'Bearer occ_x' }),
      'a function is a provider, called per request');
    ok(JSON.stringify(authHeaders({ 'X-License-Key': 'GC-2', bad: 5 })) === JSON.stringify({ 'X-License-Key': 'GC-2' }), 'an object is headers, strings only');
    ok(JSON.stringify(authHeaders(() => { throw new Error('x'); })) === '{}' && JSON.stringify(authHeaders(null)) === '{}' && JSON.stringify(authHeaders('')) === '{}',
      'a provider that throws, or nothing, sends no auth');
  }

  console.log(`\n[accountservice] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
