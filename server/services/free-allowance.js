'use strict';

/**
 * FREE GAMES ARE ONE PER PLAYER, NOT ONE PER ACCOUNT (8.8).
 *
 * The Free tier is FREE_GAMES for life (caller.js), and until 8.8 it was for
 * the life of an ACCOUNT: a player who spent them signed up again with another
 * email and had them again. Now the allowance belongs to the person, known by
 * several keys at once, any one of which is enough:
 *
 *   puuid    the Riot account, taken by the SERVER from Riot's record of a
 *            match (coach.js /match-rounds finds the player in it), never a
 *            puuid the client names, and ONLY on the app's live link of a
 *            match it recorded (purpose=live, index.js riotRoundsFor, a
 *            match that started in the last LINK_MS), and only when the
 *            server holds a live game of that account claimed within
 *            PROVEN_MS of Riot's start (playedLive): never a Riot ID typed
 *            into Settings or Connect, a fill or a backfill (linkMayNote),
 *            never a review the cap locked, never the purpose alone.
 *            Two fans who type a streamer's Riot ID, or a duo partner's
 *            typed by mistake, never merge. The database also ignores a
 *            puuid whose holders are on at least 3 different machines with
 *            at least 3 different emails, so a shared or griefed one never
 *            blocks anyone, while 3 accounts of one person on one PC still
 *            hold it (free-allowance.sql free_allowance_key_counts).
 *            ONE PER ACCOUNT: only the first puuid ever noted for an account
 *            is kept, a later different one is never noted (noteLinkPuuid,
 *            free_allowance_note), and accounts meet through that one only.
 *            A griefer gets one victim per account at most, and a person's
 *            own Riot account, read first off their own game, is the key
 *   device   the app's device id (licence-service computeDeviceId), as the
 *            session holds it since the exchange (app_sessions.device_hash)
 *   machine  Windows' own MachineGuid, hashed on the client, sent at sign in
 *            and, from 8.7.4, as X-Occlara-Machine on every /account/me, so
 *            a session made before it gains the key on its first 8.7.4
 *            launch: survives a new Windows user name or PC name.
 *            Cloned Windows images (a PC cafe, a school lab, VMs) share one,
 *            so met on the machine key ALONE a new account still plays one
 *            free game, and its second once a Riot account read off its own
 *            live game differs from every earlier holder's (the same one
 *            blocks it). The database also ignores a device or machine key
 *            whose holders played on at least 4 different Riot accounts,
 *            each holder counting its first noted one only
 *   email    the account's email from auth.users, in one canonical form
 *            (canonicalEmail: gmail dots and plus tags gone, and so on, at
 *            the providers' own domains only, each written out whole)
 *   net      the network (/24, /48) of a sign in: WEAK, recorded and never
 *            enough alone, since a household or a cafe shares one
 *
 * Every key is an HMAC with ACCOUNT_HASH_SALT, its kind inside it, so the
 * table holds no email, no puuid and no id, and two kinds never collide.
 *
 * THE DECISION IS THE DATABASE'S (free-allowance.sql): an account whose strong
 * keys meet another account that played a free game BEFORE this one played
 * its first, or an account a refund or a dispute ever ended (status 'ended',
 * remembered in free_allowance_ended after a later purchase revives it) made
 * before this one played its first and met on an email, a machine or a
 * device key (never a puuid alone), has no free games
 * (entitlement_allowance): a payer refunded from the start still counts as
 * the first holder of its keys. claim_game takes a
 * lock on each of its keys first, so two accounts of one person claiming at
 * the same moment run one after the other and the second is refused. This
 * file only hands the keys over (free_allowance_note) and reads the answer.
 *
 * NOTHING HERE EVER REFUSES OR SLOWS A PLAYER ON ITS OWN. A missing function
 * (the SQL not applied) is remembered for RECHECK_MS and every call is a no
 * op, WITHOUT telling the resolver accounts are not live (which would switch
 * caps off for everyone over a table this feature alone needs). An error or a
 * timeout is "cannot say": the caller carries on exactly as before 8.8.
 */

const crypto = require('crypto');

const RECHECK_MS = 5 * 60 * 1000;     // a missing function is asked about again after this
const NOTE_MS = 10 * 60 * 1000;       // a key noted for a user is not sent again for this long
const SHARED_MS = 30 * 1000;          // whether an account shares a key, remembered this long
const CALL_MS = 4000;                 // one database call waits at most this long
const MAX_USERS = 10000;
const MAX_PUUIDS = 5000;
const MAX_KEYS = 8;
const LINK_MS = 24 * 60 * 60 * 1000;  // a live link asks for a match that started at most this long ago
const LINK_AHEAD_MS = 10 * 60 * 1000; // a start this far in the future is still believed (clock skew)
const PROVEN_MS = 2 * 60 * 60 * 1000; // the account's own live game was claimed within this of the match's start
// When the database ignores a key as crowded (free-allowance.sql
// free_allowance_key_counts): only when its holders are different people by an
// independent key, never by a count of accounts one person can make. A puuid
// whose holders span this many distinct machines AND distinct emails (a shared
// or griefed Riot account), a device or a machine whose holders span this many
// distinct puuids (a cloned Windows image).
const CROWD = { puuid: { machines: 3, emails: 3 }, device: { puuids: 4 }, machine: { puuids: 4 } };

const KINDS = ['puuid', 'device', 'machine', 'email', 'net'];
const STRONG = new Set(['puuid', 'device', 'machine', 'email']);
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

const HEX64 = /^[0-9a-f]{64}$/;
const PUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ONLY THE PROVIDERS' OWN DOMAINS ARE FOLDED, each written out whole. A
// pattern on the first word (outlook., live., yahoo.) also folded a domain
// that merely starts with it, live.example.org or yahoo.example.net, whose
// mailboxes are someone else's to define: there a.b+x and ab can be two
// people, and folding them blocked one for the other's games.
const HOTMAIL = ['hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es',
  'hotmail.nl', 'hotmail.be', 'hotmail.ca', 'hotmail.com.au', 'hotmail.com.br', 'hotmail.com.ar', 'hotmail.com.mx',
  'hotmail.co.jp', 'hotmail.co.in', 'hotmail.co.nz', 'hotmail.co.za', 'hotmail.ch', 'hotmail.at', 'hotmail.se',
  'hotmail.dk', 'hotmail.no', 'hotmail.fi', 'hotmail.gr', 'hotmail.com.tr', 'hotmail.sg', 'hotmail.my', 'hotmail.ph'];
const YAHOO = ['yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.ie', 'yahoo.ca',
  'yahoo.com.au', 'yahoo.com.br', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.co.jp', 'yahoo.co.in', 'yahoo.co.id',
  'yahoo.co.nz', 'yahoo.co.th', 'yahoo.com.sg', 'yahoo.com.ph', 'yahoo.com.my', 'yahoo.com.hk', 'yahoo.com.tw',
  'yahoo.com.vn', 'yahoo.com.tr', 'yahoo.gr', 'yahoo.se', 'yahoo.dk', 'yahoo.no', 'yahoo.fi', 'yahoo.pl', 'yahoo.ro',
  'ymail.com'];
// Providers that deliver local+anything to local (a plus tag), by exact domain.
const PLUS_DOMAINS = new Set([
  'gmail.com', 'outlook.com', ...HOTMAIL, 'live.com', 'msn.com',
  'proton.me', 'icloud.com', 'me.com', 'mac.com',
]);
// Yahoo's disposable addresses are base-keyword: the part after the hyphen goes.
const HYPHEN_DOMAINS = new Set(YAHOO);
// One domain per provider: googlemail is gmail, and Proton delivers name@proton.me,
// name@protonmail.com, name@protonmail.ch and name@pm.me to one mailbox.
const DOMAIN_ALIASES = {
  'googlemail.com': 'gmail.com',
  'protonmail.com': 'proton.me', 'protonmail.ch': 'proton.me', 'pm.me': 'proton.me',
};

/**
 * One address per mailbox: lowercase, the provider's alias domain folded,
 * a plus tag (or Yahoo's hyphen keyword) dropped where the provider ignores
 * it, and Gmail's dots gone. Null for anything that is not an address.
 */
function canonicalEmail(email) {
  if (typeof email !== 'string') return null;
  const s = email.trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1 || s.length > 320) return null;
  let local = s.slice(0, at);
  let domain = s.slice(at + 1).replace(/\.+$/, '');
  if (!domain.includes('.') || /\s/.test(local) || /\s/.test(domain)) return null;
  domain = DOMAIN_ALIASES[domain] || domain;
  if (PLUS_DOMAINS.has(domain)) local = local.split('+')[0];
  if (HYPHEN_DOMAINS.has(domain)) local = local.split('-')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return null;
  return `${local}@${domain}`;
}

const saltOf = (env) => String((env && env.ACCOUNT_HASH_SALT) || 'occlara-network');

/** The salted key of one value of one kind, or null. */
function keyOf(kind, value, env = process.env) {
  if (!KINDS.includes(kind) || value === null || value === undefined || value === '') return null;
  return crypto.createHmac('sha256', saltOf(env)).update(`${kind}|${String(value)}`).digest('hex');
}

/**
 * The keys of one account, from what is known of it: { email, deviceHash,
 * machineId, puuid, netHash }. Each is checked for its shape and dropped when
 * it is not one, so a body can never smuggle in a key of another kind.
 */
function keysFor(parts = {}, env = process.env) {
  const out = [];
  const add = (kind, v) => {
    const key = keyOf(kind, v, env);
    if (key && !out.some((k) => k.key === key)) out.push({ kind, key });
  };
  const email = canonicalEmail(parts.email);
  if (email) add('email', email);
  const dev = typeof parts.deviceHash === 'string' ? parts.deviceHash.trim().toLowerCase() : '';
  if (HEX64.test(dev)) add('device', dev);
  const mach = typeof parts.machineId === 'string' ? parts.machineId.trim().toLowerCase() : '';
  if (HEX64.test(mach)) add('machine', mach);
  const puuid = typeof parts.puuid === 'string' ? parts.puuid.trim().toLowerCase() : '';
  if (PUUID.test(puuid)) add('puuid', puuid);
  const net = typeof parts.netHash === 'string' ? parts.netHash.trim().toLowerCase() : '';
  if (HEX64.test(net)) add('net', net);
  return out.slice(0, MAX_KEYS);
}

/** The puuid of the player name#tag in a v4 match, or null. */
function puuidInMatch(players, name, tag) {
  const n = String(name || '').trim().toLowerCase();
  const t = String(tag || '').trim().toLowerCase();
  if (!n || !t || !Array.isArray(players)) return null;
  for (const p of players) {
    if (!p) continue;
    if (String(p.name || '').trim().toLowerCase() !== n || String(p.tag || '').trim().toLowerCase() !== t) continue;
    const id = typeof p.puuid === 'string' ? p.puuid.trim().toLowerCase() : '';
    return PUUID.test(id) ? id : null;
  }
  return null;
}

/**
 * Whether a /match-rounds call may note the puuid it found in Riot's record:
 * only the app's live link of a match it recorded (purpose 'live', sent by
 * index.js riotRoundsFor for a match fetchCoachedMatch verified against the
 * recording), of a match Riot says started in the last LINK_MS. A Riot ID
 * typed into Settings or Connect (a backfill), a fill, an old client that
 * sends no purpose, a match with no start or an old one: never.
 */
function linkMayNote(link, at = Date.now()) {
  if (!link || link.purpose !== 'live') return false;
  const t = Number(link.startedAt);
  if (!Number.isFinite(t) || t <= 0) return false;
  return t <= at + LINK_AHEAD_MS && at - t <= LINK_MS;
}

function bounded(map, k, v, max) {
  map.delete(k);
  map.set(k, v);
  while (map.size > max) map.delete(map.keys().next().value);
}

/**
 * deps: { supabase, resolver (for userOf), now, env }. Never throws.
 */
function createAllowance(deps = {}) {
  const now = deps.now || (() => Date.now());
  const env = () => deps.env || process.env;
  const db = () => deps.supabase || require('../db/supabase');
  const resolver = () => deps.resolver || require('./caller').shared;
  const callMs = deps.callMs || CALL_MS;

  const off = { at: 0 };
  const noted = new Map();    // user id -> Map(key -> when sent)
  const shared = new Map();   // user id -> { at, value }
  const puuids = new Map();   // matchId|riot id -> puuid
  const held = new Map();     // user id -> the key of its one Riot account (its first noted)
  const counts = { notes: 0, skipped: 0, failed: 0, shared: 0, unproven: 0, secondPuuid: 0 };

  const live = () => !off.at || now() - off.at > RECHECK_MS;

  /** One rpc: { data } or { error } ({ missing: true } when the SQL is not there). Never throws. */
  async function call(name, args) {
    if (!live()) return { error: { code: 'off' }, missing: true };
    let timer = null;
    try {
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ error: { code: 'timeout', message: 'timed out' } }), callMs);
      });
      const r = await Promise.race([Promise.resolve(db().rpc(name, args)), timeout]);
      if (r && r.error) {
        if (MISSING.has(String(r.error.code || ''))) {
          if (live()) console.log(`[allowance] ${name} is not in the database yet (${r.error.code}): free games stay per account`);
          off.at = now();
          return { error: r.error, missing: true };
        }
        counts.failed++;
        console.warn(`[allowance] ${name} failed:`, r.error.code || r.error.message);
        return { error: r.error };
      }
      off.at = 0;
      return { data: r ? r.data : null };
    } catch (e) {
      counts.failed++;
      console.warn(`[allowance] ${name} failed:`, e.message);
      return { error: { code: '', message: e.message } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);

  /**
   * Hands the account's keys to the database. Keys sent in the last NOTE_MS
   * are not sent again unless `fresh` asks whether the account is shared.
   * Returns { shared: true | false | null } (null: cannot say).
   */
  async function note(userId, parts, { fresh = false } = {}) {
    if (!userId || !live()) return { shared: null };
    const keys = keysFor(parts, env());
    const sent = noted.get(userId);
    const at = now();
    const unsent = keys.filter((k) => !(sent && sent.has(k.key) && at - sent.get(k.key) < NOTE_MS));
    const hit = shared.get(userId);
    if (!unsent.length && hit && at - hit.at < SHARED_MS) { counts.skipped++; return { shared: hit.value }; }
    if (!unsent.length && !fresh) { counts.skipped++; return { shared: hit ? hit.value : null }; }
    const r = await call('free_allowance_note', { p_user: userId, p_keys: keys.map((k) => ({ kind: k.kind, key: k.key })) });
    if (r.error) return { shared: null };
    counts.notes++;
    const m = sent || new Map();
    for (const k of keys) m.set(k.key, at);
    bounded(noted, userId, m, MAX_USERS);
    const st = one(r.data);
    const value = !!(st && st.shared === true);
    if (value) counts.shared++;
    bounded(shared, userId, { at, value }, MAX_USERS);
    return { shared: value };
  }

  /** The parts of a caller the server can vouch for: its email (auth.users), its device, its network. */
  async function partsOf(caller, extra = {}) {
    const parts = { deviceHash: caller && caller.deviceHash, ...extra };
    let email = caller && typeof caller.email === 'string' ? caller.email : null;
    if (!email && caller && caller.userId) {
      try {
        const u = await resolver().userOf(caller.userId);
        email = (u && u.email) || null;
      } catch { /* no email key this time */ }
    }
    parts.email = email;
    return parts;
  }

  /** note() for a caller: never throws, never waits past CALL_MS for the database. */
  async function noteCaller(caller, extra = {}, opts = {}) {
    if (!caller || !caller.userId || !live()) return { shared: null };
    try {
      return await note(caller.userId, await partsOf(caller, extra), opts);
    } catch (e) {
      console.warn('[allowance] keys not noted:', e.message);
      return { shared: null };
    }
  }

  /** Whether two accounts share a strong key (one person): true, false or null. */
  async function related(a, b) {
    if (!a || !b || !live()) return null;
    const r = await call('free_allowance_related', { p_a: a, p_b: b });
    if (r.error) return null;
    if (typeof r.data === 'boolean') return r.data;
    const v = one(r.data);
    return !!(v && (v === true || v.related === true || v.free_allowance_related === true));
  }

  /** The Riot account found in a match for a Riot ID, kept so a cached match still names it. */
  function rememberPuuid(matchId, riotId, puuid) {
    if (!matchId || !riotId || !PUUID.test(String(puuid || ''))) return;
    bounded(puuids, `${String(matchId).toLowerCase()}|${String(riotId).trim().toLowerCase()}`, puuid, MAX_PUUIDS);
  }
  function puuidOf(matchId, riotId) {
    if (!matchId || !riotId) return null;
    return puuids.get(`${String(matchId).toLowerCase()}|${String(riotId).trim().toLowerCase()}`) || null;
  }

  /** A caller seen in Riot's record of a match: its Riot account becomes one of its keys. Fire and forget. */
  function notePuuid(caller, puuid) {
    if (!caller || !caller.userId || !PUUID.test(String(puuid || ''))) return Promise.resolve({ shared: null });
    return noteCaller(caller, { puuid }).catch(() => ({ shared: null }));
  }

  /**
   * Whether the account has a live game of its own (a game_usage row the
   * server reserved or counted for a live read, never a Riot record review
   * or a refunded one) created within PROVEN_MS of when Riot says the match
   * started. Any doubt (an error, a timeout, no table) is false: the puuid is
   * then simply not noted, which never refuses anyone.
   */
  async function playedLive(userId, startedAt) {
    if (!userId || !Number.isFinite(startedAt) || !live()) return false;
    let timer = null;
    try {
      const q = db().from('game_usage').select('id')
        .eq('user_id', userId).eq('game', 'valorant').eq('kind', 'live').in('status', ['reserved', 'counted'])
        .gte('created_at', new Date(startedAt - PROVEN_MS).toISOString())
        .lte('created_at', new Date(startedAt + PROVEN_MS).toISOString())
        .limit(1);
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: { code: 'timeout' } }), callMs); });
      const r = await Promise.race([Promise.resolve(q), timeout]);
      return !!(r && !r.error && Array.isArray(r.data) && r.data.length);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * The key of the one Riot account the account holds (its FIRST noted, by
   * first_seen then key), as { key } (null: none yet), or { error } when it
   * cannot be said. Once the database names it, it is kept: first wins, so it
   * never changes.
   */
  async function heldPuuid(userId) {
    if (held.has(userId)) return { key: held.get(userId) };
    if (!live()) return { error: true };
    let timer = null;
    try {
      const q = db().from('free_allowance_keys').select('key_hash,first_seen')
        .eq('user_id', userId).eq('kind', 'puuid').limit(MAX_KEYS);
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: { code: 'timeout' } }), callMs); });
      const r = await Promise.race([Promise.resolve(q), timeout]);
      if (!r || r.error || !Array.isArray(r.data)) return { error: true };
      const first = r.data.slice().sort((a, b) => (Date.parse(a.first_seen) - Date.parse(b.first_seen))
        || String(a.key_hash).localeCompare(String(b.key_hash)))[0];
      if (!first) return { key: null };
      bounded(held, userId, String(first.key_hash), MAX_USERS);
      return { key: String(first.key_hash) };
    } catch {
      return { error: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * notePuuid, for /match-rounds: only when the call is the live link of a
   * match the app recorded (linkMayNote) AND the server itself holds a live
   * game of this account around that match's start (playedLive). The purpose
   * is client sent, so it is never enough alone: a review the cap locked (no
   * claim, no row) notes nothing. The row proves the account played a live
   * game around then, NOT that it played this match: a modified client can
   * still name any match that started within PROVEN_MS of one of its own live
   * games, and any player in it (a live row holds no match id). The crowd
   * rule bounds that, it does not stop it. link: { purpose, startedAt }.
   *
   * ONE RIOT ACCOUNT PER ACCOUNT: only the first puuid ever noted for an
   * account is its key. A different one later is never noted (refused here,
   * and again by free_allowance_note in the database, which decides when this
   * cannot say), the same one again is fine. So a griefer who names another
   * player of its match takes at most one victim per account, and one
   * person's own Riot account, read first off their own game, stays the key.
   */
  async function noteLinkPuuid(caller, puuid, link) {
    if (!linkMayNote(link, now())) return { shared: null };
    if (!caller || !caller.userId || !PUUID.test(String(puuid || ''))) return { shared: null };
    const mine = keyOf('puuid', String(puuid).trim().toLowerCase(), env());
    const have = await heldPuuid(caller.userId);
    if (have.key && have.key !== mine) { counts.secondPuuid++; return { shared: null }; }
    if (!await playedLive(caller.userId, Number(link.startedAt))) { counts.unproven++; return { shared: null }; }
    return notePuuid(caller, puuid);
  }

  /** The account moved (a purchase, a refund): ask again next time. */
  function forget(userId) { shared.delete(userId); }

  function reset() { off.at = 0; noted.clear(); shared.clear(); puuids.clear(); held.clear(); }

  return { note, noteCaller, notePuuid, noteLinkPuuid, related, rememberPuuid, puuidOf, forget, reset, live, counts,
    _caches: { noted, shared, puuids, held, off } };
}

const shared = createAllowance();

module.exports = {
  createAllowance, shared, canonicalEmail, keyOf, keysFor, puuidInMatch, linkMayNote,
  KINDS, STRONG, CROWD, RECHECK_MS, NOTE_MS, SHARED_MS, CALL_MS, MAX_KEYS, LINK_MS, PROVEN_MS,
  ONE_PER_PLAYER: 'Free games are one per player.',
};
