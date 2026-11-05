'use strict';

/**
 * WHO IS CALLING A COACH OR USAGE ROUTE (8.7).
 *
 * Until 8.7 every client call carried a licence key and nothing else, and the
 * key was both the proof and the name every ledger used. 8.7 adds accounts: the
 * app signs in through the browser and is handed an app session token, and the
 * site calls with its Supabase access token. So a caller is now one of three:
 *
 *   `Authorization: Bearer occ_...`  an app session. Looked up by its sha256 in
 *       app_sessions (never the token itself), not revoked, remembered for a
 *       minute, and its last_seen moved at most every five minutes.
 *   `Authorization: Bearer <JWT>`    a Supabase access token, verified HERE with
 *       node's own crypto against the project's JWKS (ES256), its issuer,
 *       audience, expiry, not-before and a confirmed email checked. No new
 *       dependency, and no round trip to Supabase auth per request.
 *   `X-License-Key`                  the 8.6 path, the same checkKey as before
 *       (coach.js, with its 503 outage rule and its stale-if-error half hour),
 *       then the licence's user_id.
 *
 * Every caller gets an `accountKey`, the one id every ledger keys by (the cost
 * ledger, Ask Coach's daily cap, presence and the rate limiters): `u:<userId>`
 * for an app session, a site token and a key whose user has signed in to the
 * app, else the licence key itself, which is exactly what those ledgers were
 * keyed by before 8.7. So an 8.6 key (legacy, its user never signed in, and
 * every key while accounts are not live) is counted where it always was: one
 * user who bought two keys for two PCs still has two Ask Coach caps and two
 * sets of limiter buckets, as in 8.6.
 *
 * ACCOUNTS MAY NOT BE LIVE YET. The tables and functions come from the site's
 * migration, applied by hand. Until then every query naming them fails with a
 * relation or function missing (42P01, PGRST205, PGRST202, 42883), and that is
 * read as "accounts not live": the key path alone, no caps, nothing refused,
 * exactly 8.6. It is asked again every five minutes, so applying the migration
 * needs no redeploy.
 *
 * AN OUTAGE IS NOT A REFUSAL, here as everywhere: a session lookup or a JWKS
 * fetch that fails is `unavailable` (the route answers 503 with retry), never
 * `invalid`, and a session confirmed in the last half hour is still honoured.
 * So is "accounts not live" for a session: a migration re-run or a schema
 * cache reload answering 42P01 or PGRST202 for a few minutes is no reason to
 * tell every signed in app its sign in has ended (the app drops its token for
 * good on a 401). Only a lookup that succeeded and found no row, or a revoked
 * one, is `invalid`.
 *
 * AND AN OUTAGE COSTS A KEY NOTHING. checkKey answers a known key at once
 * through its breaker and stale rule, as in 8.6; the account lookups behind it
 * (entitlementOf, userHasSession, a session past its minute) have a breaker of
 * their own: once one fails or times out, none is asked for DOWN_MS and the
 * last answer (or none) is served, remembered afresh, so a hanging database
 * never adds its timeouts to every live read.
 */

const crypto = require('crypto');

const SESSION_MS = 60 * 1000;            // a confirmed session is remembered this long
const SESSION_STALE_MS = 30 * 60 * 1000; // and honoured this long through an outage
const LAST_SEEN_MS = 5 * 60 * 1000;      // last_seen is written at most this often
const ENTITLEMENT_MS = 60 * 1000;
const JWKS_MS = 10 * 60 * 1000;
const JWKS_REFETCH_MS = 60 * 1000;       // an unknown kid asks again at most this often
const USER_MS = 10 * 60 * 1000;          // auth.users facts (email confirmed, created_at)
const LIVE_RECHECK_MS = 5 * 60 * 1000;
const LOOKUP_MS = 5000;
const DOWN_MS = 30 * 1000;               // after a failed lookup, none is asked for this long
const OUTAGE_MS = 10 * 60 * 1000;        // and an answer held is served at once this long after one
const FREE_KEYS_FROM = [8, 7, 0];        // the first app that knows a free account
// The first app whose free games the free allowance can tie to a person: it
// sends the Windows machine id and purpose=live on its live link. An older
// one sends neither, so with caps enforced a free game claimed from it is
// refused with UPDATE_FOR_FREE (usage.js), never a paid tier's game or a
// bought one.
const FREE_PLAY_FROM = [8, 7, 4];
const UPDATE_FOR_FREE = 'Update Occlara to keep playing your free games.';
// The Free tier: FREE_GAMES for the life of the account, INVITE_EXTRA_GAMES
// more for a friend who redeems an invite. The site's SQL (free_total's
// DEFAULT and ensure_entitlement) must say the same number.
const FREE_GAMES = 2;
const INVITE_EXTRA_GAMES = 2;
const JWT_LEEWAY_S = 5;
const MAX_CACHE = 5000;

const MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
const KEY_REGEX = /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SESSION_TOKEN = /^occ_[A-Za-z0-9_-]{43}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Equal strings, compared in constant time (their hashes, so lengths never leak). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

/**
 * Whether the app asking is at least `from` ([major, minor, patch]), by the
 * X-Occlara-Version every client request carries. None is older than all.
 */
function clientAtLeast(req, from) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String((req && req.headers && req.headers['x-occlara-version']) || ''));
  if (!m) return false;
  for (let i = 0; i < from.length; i++) {
    const d = Number(m[i + 1]) - from[i];
    if (d !== 0) return d > 0;
  }
  return true;
}
/** An app that knows a free account (8.7): an older one reads a cap's 402 as the AI out of credits. */
const knowsFreeKeys = (req) => clientAtLeast(req, FREE_KEYS_FROM);
/** An app whose free games can be tied to a person (FREE_PLAY_FROM). */
const playsFree = (req) => clientAtLeast(req, FREE_PLAY_FROM);

/** A relation or function the accounts migration adds is missing. */
function isMissing(error) {
  return !!(error && MISSING_CODES.has(String(error.code || '')));
}

function cacheSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}

/** The bearer token on a request, or null. */
function bearerOf(req) {
  const h = String((req && req.headers && req.headers.authorization) || '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

const keyOf = (req) => String((req && req.headers && req.headers['x-license-key']) || '').trim().toUpperCase();

/** Whether a request carries anything that could name a caller. */
function hasCredentials(req) {
  return !!(bearerOf(req) || keyOf(req));
}

/**
 * The network a request came from, as a bucket: an IPv4 /24 or an IPv6 /48,
 * so two devices behind one home router are one network. Null when unknown.
 */
function ipPrefix(ip) {
  let s = String(ip || '').trim();
  if (!s) return null;
  if (s.startsWith('::ffff:')) s = s.slice(7);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) return `v4:${v4[1]}.${v4[2]}.${v4[3]}`;
  if (s.includes(':')) {
    const head = s.split('::')[0].split(':').filter(Boolean);
    const parts = head.concat(['0', '0', '0']).slice(0, 3).map((p) => p.toLowerCase().replace(/^0+(?=.)/, ''));
    return `v6:${parts.join(':')}`;
  }
  return null;
}

/** The hashed network a request came from, as app_sessions stores it. */
function ipPrefixHash(ip, env = process.env) {
  const p = ipPrefix(ip);
  return p ? sha256(`${env.ACCOUNT_HASH_SALT || 'occlara-network'}|${p}`) : null;
}

/** An IPv6 caller's /64, an IPv4 caller's address: what a rate limiter keys an unknown caller by. */
function ipBucket(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (!s) return 'ip:unknown';
  if (s.includes(':')) {
    const head = s.split('::')[0].split(':').filter(Boolean);
    return `ip6:${head.concat(['0', '0', '0', '0']).slice(0, 4).join(':').toLowerCase()}`;
  }
  return `ip:${s}`;
}

/** The tier a licence plan maps to, the payer rules: weekly and monthly are Pro, yearly and lifetime Max. */
function tierOfPlan(plan) {
  const p = String(plan || '').toLowerCase();
  if (p === 'free') return 'free';
  if (p === 'weekly' || p === 'monthly' || p === 'pro') return 'pro';
  if (p === 'yearly' || p === 'lifetime' || p === 'max') return 'max';
  return null;
}

/**
 * Whether caps are ENFORCED for this caller: refusals happen only then. With
 * ENFORCE_CAPS unset or 0 nothing is ever refused (games are still counted, in
 * shadow). A legacy key with no app session is not capped until
 * LEGACY_CAP_FROM (an ISO date; unset means never); a free plan key always is.
 */
function enforced(caller, env = process.env, now = Date.now()) {
  if (String(env.ENFORCE_CAPS || '0').trim() !== '1') return false;
  if (!caller || !caller.userId) return false;
  if (caller.legacy) {
    const from = Date.parse(String(env.LEGACY_CAP_FROM || '').trim());
    return Number.isFinite(from) && now >= from;
  }
  return true;
}

const b64urlJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * One resolver: its caches, its view of whether accounts are live, and what it
 * asks. `deps`: { supabase, checkKey(key), keyOwner(key), fetch, now, env }.
 * checkKey and keyOwner default to coach.js's own, asked lazily, since coach.js
 * requires this file.
 */
function createResolver(deps = {}) {
  const now = deps.now || (() => Date.now());
  const env = () => deps.env || process.env;
  const db = () => deps.supabase || require('../db/supabase');
  const coach = () => require('../routes/coach');
  const checkKey = (k) => (deps.checkKey ? deps.checkKey(k) : coach().checkKey(k));
  const keyOwner = (k) => (deps.keyOwner ? deps.keyOwner(k) : coach().__test.keyOwners.get(k)) || null;
  const doFetch = (...a) => (deps.fetch || globalThis.fetch)(...a);

  const live = { offAt: 0 };
  const down = { at: 0, lastAt: 0 }; // the account lookups' breaker (DOWN_MS), and the last failure
  const sessions = new Map();     // token hash -> { caller, at, seenAt }
  const entitlements = new Map(); // user id -> { row, at }
  const hasSession = new Map();   // user id -> { yes, at }
  const users = new Map();        // user id -> { user, at }
  const jwks = { keys: new Map(), at: 0, tried: 0, pending: null };

  const accountsLive = () => !live.offAt || now() - live.offAt > LIVE_RECHECK_MS;
  /** Note an error: a missing relation marks accounts not live. Returns whether it was one. */
  function noteError(error) {
    if (!isMissing(error)) return false;
    if (!live.offAt || now() - live.offAt > LIVE_RECHECK_MS) {
      console.log(`[caller] accounts not live (${error.code}): the key path alone, no caps`);
    }
    live.offAt = now();
    return true;
  }
  const markLive = () => { live.offAt = 0; };
  const lookupsDown = () => !!down.at && now() - down.at < DOWN_MS;
  /** A lookup failed (not a missing relation): the breaker opens, and says so once. */
  const noteDown = (what, why) => {
    if (!lookupsDown()) console.warn(`[caller] ${what} failed, account lookups paused ${DOWN_MS / 1000} s:`, why);
    down.at = now();
    down.lastAt = now();
  };
  const noteUp = () => { down.at = 0; };

  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(LOOKUP_MS) : undefined);
  const withSignal = (q) => { const s = timeout(); return s && typeof q.abortSignal === 'function' ? q.abortSignal(s) : q; };

  /*
   * ONE ACCOUNT LOOKUP, remembered ENTITLEMENT_MS. Never throws. A failed one
   * (an error that is not a missing relation, or a timeout) opens the breaker
   * and serves the last answer (or `fallback`), remembered afresh. And in the
   * OUTAGE_MS after any failure, an answer already held is served at once
   * when it expires, the lookup finishing behind it, so a database that hangs
   * costs a known key one wait, not one every minute. `ask` resolves
   * { value } or { error }.
   */
  const asking = new Map();   // kind:user -> the lookup in flight
  async function remembered(kind, map, userId, fallback, ask) {
    const hit = map.get(userId);
    if (hit && now() - hit.at < ENTITLEMENT_MS) return hit.value;
    const stale = () => {
      const value = hit ? hit.value : fallback;
      cacheSet(map, userId, { value, at: now() });
      return value;
    };
    if (lookupsDown()) return stale();
    const k = `${kind}:${userId}`;
    let p = asking.get(k);
    if (!p) {
      p = (async () => {
        try {
          const { value, error } = await ask();
          if (error) {
            if (noteError(error)) return fallback;
            noteDown(`${kind} lookup`, error.code || error.message);
            return stale();
          }
          markLive();
          noteUp();
          cacheSet(map, userId, { value, at: now() });
          return value;
        } catch (e) {
          noteDown(`${kind} lookup`, e.message);
          return stale();
        }
      })().finally(() => asking.delete(k));
      asking.set(k, p);
    }
    if (hit && down.lastAt && now() - down.lastAt < OUTAGE_MS) return hit.value;
    return p;
  }

  /** The user's entitlement row, or null (none yet, or accounts not live). Never throws. */
  async function entitlementOf(userId) {
    if (!userId || !accountsLive()) return null;
    return remembered('entitlement', entitlements, userId, null, async () => {
      const { data, error } = await withSignal(db().from('entitlements')
        .select('tier,account_key,cap_monthly,free_total,bonus_pool,status,source')
        .eq('user_id', userId)).maybeSingle();
      return error ? { error } : { value: data || null };
    });
  }

  /** Whether the user has any app session that is not revoked (so their key is no longer legacy). Never throws. */
  async function userHasSession(userId) {
    if (!userId || !accountsLive()) return false;
    return remembered('app session', hasSession, userId, false, async () => {
      const { data, error } = await withSignal(db().from('app_sessions').select('id')
        .eq('user_id', userId).is('revoked_at', null).limit(1));
      return error ? { error } : { value: Array.isArray(data) && data.length > 0 };
    });
  }

  /** auth.users facts for a user ({ email, email_confirmed_at, created_at }), or throws when Supabase cannot say. */
  async function userOf(userId) {
    const hit = users.get(userId);
    if (hit && now() - hit.at < USER_MS) return hit.user;
    const { data, error } = await db().auth.admin.getUserById(userId);
    if (error) {
      const status = Number(error.status) || 0;
      if (status === 404) { cacheSet(users, userId, { user: null, at: now() }); return null; }
      const e = new Error(error.message || 'user lookup failed');
      e.unavailable = true;
      throw e;
    }
    const u = (data && data.user) || null;
    cacheSet(users, userId, { user: u, at: now() });
    return u;
  }

  // ── The JWKS and a Supabase access token ──────────────────────────────────
  const baseUrl = () => String(env().SUPABASE_URL || '').replace(/\/+$/, '');
  const issuer = () => String(env().SUPABASE_JWT_ISSUER || `${baseUrl()}/auth/v1`).replace(/\/+$/, '');
  const jwksUrl = () => `${issuer()}/.well-known/jwks.json`;

  async function loadJwks() {
    if (jwks.pending) return jwks.pending;
    jwks.tried = now();
    jwks.pending = (async () => {
      const r = await doFetch(jwksUrl(), { signal: timeout() });
      if (!r || !r.ok) throw Object.assign(new Error(`JWKS answered ${r && r.status}`), { unavailable: true });
      const body = await r.json();
      const keys = new Map();
      for (const jwk of (body && Array.isArray(body.keys) ? body.keys : [])) {
        if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.kid) continue;
        if (jwk.use && jwk.use !== 'sig') continue;
        try { keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })); } catch { /* skip a bad key */ }
      }
      jwks.keys = keys;
      jwks.at = now();
      return keys;
    })().finally(() => { jwks.pending = null; });
    return jwks.pending;
  }

  async function keyFor(kid) {
    const fresh = jwks.at && now() - jwks.at < JWKS_MS;
    if (fresh && jwks.keys.has(kid)) return jwks.keys.get(kid);
    if (!fresh || now() - jwks.tried > JWKS_REFETCH_MS) {
      try { await loadJwks(); } catch (e) {
        if (jwks.keys.has(kid)) return jwks.keys.get(kid);   // a stale key beats an outage
        throw Object.assign(e, { unavailable: true });
      }
    }
    return jwks.keys.get(kid) || null;
  }

  /**
   * A Supabase access token checked locally: { ok, claims } or { ok: false,
   * unavailable? , reason }. ES256 only, signed by a key the JWKS lists, issued
   * by this project to `authenticated`, inside exp and nbf, a real user (a
   * uuid sub, role authenticated, not anonymous).
   */
  async function verifyJwt(token) {
    if (typeof token !== 'string' || !JWT_SHAPE.test(token)) return { ok: false, reason: 'shape' };
    const [h, p, s] = token.split('.');
    let header;
    let claims;
    try { header = b64urlJson(h); claims = b64urlJson(p); } catch { return { ok: false, reason: 'shape' }; }
    if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string') return { ok: false, reason: 'alg' };
    let key;
    try { key = await keyFor(header.kid); } catch (e) { return { ok: false, unavailable: true, reason: 'jwks' }; }
    if (!key) return { ok: false, reason: 'kid' };
    const sig = Buffer.from(s, 'base64url');
    if (sig.length !== 64) return { ok: false, reason: 'signature' };
    let good = false;
    try { good = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, sig); } catch { good = false; }
    if (!good) return { ok: false, reason: 'signature' };
    const t = Math.floor(now() / 1000);
    if (!claims || typeof claims !== 'object') return { ok: false, reason: 'claims' };
    if (claims.iss !== issuer()) return { ok: false, reason: 'iss' };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes('authenticated')) return { ok: false, reason: 'aud' };
    if (typeof claims.exp !== 'number' || claims.exp + JWT_LEEWAY_S <= t) return { ok: false, reason: 'exp' };
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - JWT_LEEWAY_S > t)) return { ok: false, reason: 'nbf' };
    if (typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return { ok: false, reason: 'sub' };
    if (claims.role && claims.role !== 'authenticated') return { ok: false, reason: 'role' };
    if (claims.is_anonymous === true) return { ok: false, reason: 'anonymous' };
    return { ok: true, claims };
  }

  /**
   * Whether the token's user has confirmed their email: auth.users is asked
   * (email_confirmed_at), remembered ten minutes. Never the token's
   * user_metadata: the signed in user writes that themselves
   * (supabase.auth.updateUser({ data: { email_verified: true } })), and the
   * next token carries whatever they wrote.
   */
  async function emailConfirmed(claims) {
    const u = await userOf(claims.sub);
    return !!(u && (u.email_confirmed_at || u.confirmed_at));
  }

  // ── The three ways in ─────────────────────────────────────────────────────
  async function bySession(token) {
    if (!SESSION_TOKEN.test(token)) return { status: 'invalid', via: 'session', body: { error: 'session-invalid' } };
    const hash = sha256(token);
    const hit = sessions.get(hash);
    const age = hit ? now() - hit.at : Infinity;
    if (age < SESSION_MS) return { status: 'valid', caller: hit.caller };
    // Not live, or the lookups paused: a session confirmed in the last half
    // hour is honoured, any other is not-live or unavailable, never invalid.
    if (!accountsLive()) return age < SESSION_STALE_MS ? { status: 'valid', caller: hit.caller } : { status: 'not-live' };
    if (lookupsDown()) return age < SESSION_STALE_MS ? { status: 'valid', caller: hit.caller } : { status: 'unavailable', via: 'session' };
    let data = null;
    let error = null;
    try {
      ({ data, error } = await withSignal(db().from('app_sessions')
        .select('id,user_id,device_hash,revoked_at,last_seen')
        .eq('token_hash', hash)).maybeSingle());
    } catch (e) { error = { code: '', message: e.message }; }
    if (error) {
      const missing = noteError(error);
      if (!missing) noteDown('session lookup', error.message || error.code);
      if (age < SESSION_STALE_MS) return { status: 'valid', caller: hit.caller };
      return missing ? { status: 'not-live' } : { status: 'unavailable', via: 'session' };
    }
    markLive();
    noteUp();
    if (!data || data.revoked_at || !data.user_id) {
      sessions.delete(hash);
      return { status: 'invalid', via: 'session', body: { error: 'session-invalid' } };
    }
    const ent = await entitlementOf(data.user_id);
    const caller = {
      userId: data.user_id, accountKey: `u:${data.user_id}`, key: (ent && ent.account_key) || null,
      tier: (ent && ent.tier) || 'free', via: 'session', legacy: false,
      sessionId: data.id, tokenHash: hash, deviceHash: data.device_hash || null,
    };
    const seenAt = Date.parse(data.last_seen || '') || 0;
    if (now() - seenAt > LAST_SEEN_MS && (!hit || now() - (hit.seenAt || 0) > LAST_SEEN_MS)) {
      const at = now();
      Promise.resolve().then(() => db().from('app_sessions').update({ last_seen: new Date(at).toISOString() }).eq('id', data.id))
        .then((r) => { if (r && r.error) console.warn('[caller] last_seen not written:', r.error.code || r.error.message); })
        .catch((e) => console.warn('[caller] last_seen not written:', e.message));
      cacheSet(sessions, hash, { caller, at: now(), seenAt: at });
    } else {
      cacheSet(sessions, hash, { caller, at: now(), seenAt: hit ? hit.seenAt : seenAt });
    }
    return { status: 'valid', caller };
  }

  async function byJwt(token) {
    const v = await verifyJwt(token);
    if (!v.ok) {
      if (v.unavailable) return { status: 'unavailable', via: 'jwt' };
      return { status: 'invalid', via: 'jwt', body: { error: 'session-invalid' } };
    }
    let confirmed;
    try { confirmed = await emailConfirmed(v.claims); } catch (e) {
      console.warn('[caller] could not ask whether an email is confirmed:', e.message);
      return { status: 'unavailable', via: 'jwt' };
    }
    if (!confirmed) return { status: 'invalid', via: 'jwt', body: { error: 'email-unconfirmed' } };
    const ent = await entitlementOf(v.claims.sub);
    return { status: 'valid', caller: {
      userId: v.claims.sub, accountKey: `u:${v.claims.sub}`, key: (ent && ent.account_key) || null,
      tier: (ent && ent.tier) || 'free', via: 'jwt', legacy: false,
      email: typeof v.claims.email === 'string' ? v.claims.email : null, deviceHash: null,
    } };
  }

  async function byKey(key, req) {
    const v = await checkKey(key);
    if (v === 'unavailable') return { status: 'unavailable', via: 'key' };
    if (v !== 'valid') return { status: 'invalid', via: 'key' };
    const owner = keyOwner(key) || {};
    const userId = typeof owner.userId === 'string' && owner.userId ? owner.userId : null;
    const planTier = tierOfPlan(owner.plan);
    // A FREE KEY NEEDS AN APP THAT KNOWS FREE ACCOUNTS (8.7). The shipped 8.6
    // reads any 402 as the AI out of credits, so a free key that used its
    // games would be told the service is broken: refused as a key instead,
    // which 8.6 answers by checking the licence (license.js answers it with
    // "update Occlara").
    if (planTier === 'free' && !knowsFreeKeys(req)) return { status: 'invalid', via: 'key', body: { error: 'update-required' } };
    // Asked side by side, each behind the lookups' breaker.
    const [ent, signed] = userId
      ? await Promise.all([entitlementOf(userId), planTier === 'free' ? false : userHasSession(userId)])
      : [null, false];
    // A key is legacy (uncapped until LEGACY_CAP_FROM, and kept in its 8.6
    // ledgers) unless it is a free plan key or its user has signed in to the
    // app (an app session).
    const legacy = planTier !== 'free' && !signed;
    return { status: 'valid', caller: {
      userId, accountKey: userId && !legacy ? `u:${userId}` : key, key,
      tier: (ent && ent.tier) || planTier, via: 'key', legacy, plan: owner.plan || null,
      deviceHash: owner.deviceId ? sha256(owner.deviceId) : null,
    } };
  }

  /**
   * Who is calling: { status: 'valid', caller } | { status: 'invalid', via,
   * body } | { status: 'unavailable', via } | { status: 'none' }. Asked once a
   * request, so the limiter, admit and the route share one answer. Never throws.
   */
  function identify(req) {
    if (req && req._identity) return req._identity;
    const p = (async () => {
      try {
        const bearer = bearerOf(req);
        const key = keyOf(req);
        if (bearer && bearer.startsWith('occ_')) {
          const r = await bySession(bearer);
          if (r.status === 'valid' || r.status === 'unavailable') return r;
          // Accounts not live is an outage for a session, never a refusal.
          if (!key) return r.status === 'not-live' ? { status: 'unavailable', via: 'session' } : r;
        } else if (bearer && JWT_SHAPE.test(bearer)) {
          const r = await byJwt(bearer);
          if (r.status === 'valid') return r;
          if (!key) return r;
        }
        if (key) return await byKey(key, req);
        return { status: 'none' };
      } catch (e) {
        console.warn('[caller] could not identify a caller:', e.message);
        return { status: 'unavailable' };
      }
    })();
    if (req && typeof req === 'object') {
      Object.defineProperty(req, '_identity', { value: p, enumerable: false, configurable: true, writable: true });
    }
    return p;
  }

  /** The caller, or null. */
  async function resolveCaller(req) {
    const r = await identify(req);
    return r.status === 'valid' ? r.caller : null;
  }

  /** A session revoked here is forgotten at once, not a minute later. */
  function forgetSession(tokenHash) { sessions.delete(tokenHash); }
  function forgetEntitlement(userId) { entitlements.delete(userId); }

  function reset() {
    sessions.clear(); entitlements.clear(); hasSession.clear(); users.clear();
    jwks.keys = new Map(); jwks.at = 0; jwks.tried = 0; live.offAt = 0; down.at = 0; down.lastAt = 0; asking.clear();
  }

  return {
    identify, resolveCaller, verifyJwt, entitlementOf, userHasSession, userOf, accountsLive, noteError, markLive,
    forgetSession, forgetEntitlement, reset, enforced: (caller) => enforced(caller, env(), now()),
    _caches: { sessions, entitlements, hasSession, users, jwks, live, down },
  };
}

// The one resolver the server uses.
const shared = createResolver();

module.exports = {
  createResolver, shared,
  identify: (req) => shared.identify(req),
  resolveCaller: (req) => shared.resolveCaller(req),
  enforced, tierOfPlan, isMissing, sha256, safeEqual, bearerOf, hasCredentials, clientAtLeast, knowsFreeKeys, playsFree,
  ipPrefix, ipPrefixHash, ipBucket,
  KEY_REGEX, SESSION_TOKEN, MISSING_CODES, SESSION_MS, LAST_SEEN_MS, JWKS_MS, DOWN_MS, FREE_KEYS_FROM, FREE_PLAY_FROM, UPDATE_FOR_FREE,
  FREE_GAMES, INVITE_EXTRA_GAMES,
};
