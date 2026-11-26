'use strict';

/**
 * OCCLARA DUOS (docs/claude/duos.md): two friends who both use Occlara see
 * each other's side of the matches they played together, on one team: a
 * round by round sheet of numbers and fixed words, and their clips, which the
 * other may pin a moment of with a label from a fixed list.
 *
 * WHAT THIS FILE HOLDS, all pure but the store:
 *   the rules      every number, the pin labels, the reactions and the code's
 *                  alphabet (DUO RULES, below, word for word the same in
 *                  src/shared/duos.js, test:duos holds the two equal)
 *   the codes      an invite code made from random bytes, read back from what
 *                  a player pasted, kept only as its salted hash
 *   the report     a match id and the team as its agents, made safe
 *   the sheet      what an app may upload of one match: a whitelist, every
 *                  number in its range, names only as the game data spells
 *                  them, the whole refused when it cannot be true
 *   the views      what a route may answer, built field by field: no email,
 *                  user id, account key, puuid, match id or hash
 *   the store      one Supabase rpc per operation (social-002-duos.sql), and
 *                  the private bucket, each throwing, `notLive` when the SQL
 *                  has not run
 */

const crypto = require('crypto');
const valorantData = require('../valorant-data.generated.json');
const callers = require('./caller');
const social = require('./social');

// ── DUO RULES START (word for word the same in src/shared/duos.js) ────────
const DUO = Object.freeze({
  PARTNERS_MAX: 5,                          // live duos an account may be in, active or paused
  INVITES_OPEN_MAX: 10,                     // open invites an account may have sent
  INVITE_DAYS: 7,                           // an invite, by name or by code, lasts this long
  CODE_LEN: 10,                             // 10 of 32 letters: 50 bits
  GUESSES_PER_DAY: 10,                      // wrong codes an account may paste in a rolling day
  KEEP_DAYS: 30,                            // a shared match, its sheets, clips and pins, from the match
  REPORT_DAYS: 3,                           // a report of a reviewed match is kept this long
  REPORT_GAME_HOURS: 4,                     // the live game a report spends is at most this old
  PAIR_WINDOW_MIN: 180,                     // two reports of one match pair up within this
  CLIP_MAX_BYTES: 80 * 1024 * 1024,         // one clip, the bucket's own file limit too
  CLIPS_PER_MATCH: 18,                      // one account's clips of one shared match
  UPLOAD_BYTES: 2 * 1024 * 1024 * 1024,     // uploaded by one account in QUOTA_DAYS, every upload counted
  QUOTA_DAYS: 30,
  DOWNLOAD_BYTES_DAY: 1536 * 1024 * 1024,   // downloaded by one account in a rolling day
  DOWNLOAD_URLS_DAY: 120,                   // download URLs one account may be given in a rolling day
  DOWNLOAD_URL_SEC: 10,                     // a download URL's life: enough to START a fetch on a slow line
  ISSUES_MAX: 6,                            // upload URLs one clip may be given, retries included
  PINS_PER_CLIP: 20,                        // one author's pins on one clip
  SHEET_MAX_BYTES: 24 * 1024,
  ROUNDS_MAX: 50,
  CACHE_BYTES: 2 * 1024 * 1024 * 1024,      // the partner's clips kept on this PC, least recently used first out
  ENDED_DAYS: 14,                           // an ended duo is said on the page this long
  MATCHES_MAX: 60,
});
const PIN_LABELS = Object.freeze(['good-trade', 'should-trade', 'too-far', 'good-utility', 'wait-for-me', 'nice-shot', 'wrong-timing', 'my-mistake']);
const PIN_WORDS = Object.freeze({
  'good-trade': 'Good trade', 'should-trade': 'Should have traded', 'too-far': 'Too far from me', 'good-utility': 'Good utility',
  'wait-for-me': 'Wait for me', 'nice-shot': 'Nice shot', 'wrong-timing': 'Wrong timing', 'my-mistake': 'My mistake',
});
const REACTIONS = Object.freeze(['nice', 'wow', 'agreed', 'oops']);
const REACTION_WORDS = Object.freeze({ nice: 'Nice', wow: 'Wow', agreed: 'Agreed', oops: 'Oops' });
// No 0, 1, I or O: a code read aloud or retyped is never two codes.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CLIP_NAME = /^[rdh]\d{1,3}-clip\.mkv$/;
const CLIP_KINDS = Object.freeze(['death', 'flag', 'highlight']);
const CAUSE_KEYS = Object.freeze(['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed', 'no-escape', 'lost-duel']);
const MODES = Object.freeze(['Competitive', 'Unrated', 'Swiftplay', 'Spike Rush', 'Premier', 'Standard', 'New Map']);

/** A code as a player pasted it ("k7m2-q9xh 4p", any case), as its 10 letters, or null. */
function codeOf(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const t = input.toUpperCase().split('').filter((c) => c !== ' ' && c !== '-').join('');
  if (t.length !== DUO.CODE_LEN) return null;
  return t.split('').every((c) => CODE_ALPHABET.includes(c)) ? t : null;
}

/** A code as it is shown: "K7M2Q-9XH4P". */
const codeShown = (code) => (typeof code === 'string' && code.length === DUO.CODE_LEN ? `${code.slice(0, 5)}-${code.slice(5)}` : '');
// ── DUO RULES END ──────────────────────────────────────────────────────────

const PLAN = 'max';
// The app starts its download the moment the URL arrives, so a URL needs to
// live only long enough for that request to reach Supabase on a slow line.
const SIGNED_DOWNLOAD_SEC = DUO.DOWNLOAD_URL_SEC;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[0-9a-f]{16}$/;

const saltOf = (env) => String((env && env.ACCOUNT_HASH_SALT) || 'occlara-network');
const hmac = (kind, value, env) => crypto.createHmac('sha256', saltOf(env)).update(`${kind}|${value}`).digest('hex');

/** A fresh code from `bytes` (crypto.randomBytes by default): each letter one of 32, no bias. */
function mintCode(random = crypto.randomBytes) {
  const b = random(DUO.CODE_LEN);
  let out = '';
  for (let i = 0; i < DUO.CODE_LEN; i++) out += CODE_ALPHABET[b[i] & 31];
  return out;
}
const codeHash = (code, env = process.env) => hmac('duo-code', code, env);
/** Riot's match id, as the server's salted hash: the database never holds the id. */
const matchHash = (id, env = process.env) => hmac('duo-match', String(id).toLowerCase(), env);
const matchIdOf = (s) => (typeof s === 'string' && UUID_RE.test(s.trim()) ? s.trim().toLowerCase() : null);
const refOf = (s) => (typeof s === 'string' && REF_RE.test(s) ? s : null);

const agentOf = (s) => social.agentOf(s);
const mapOf = (s) => social.mapOf(s);

/**
 * The team a report names, as one word both teammates send alike: their
 * team's agents sorted, a bar, the other team's sorted ("Jett,Omen,...|
 * Fade,..."), or null. A team the own agent is not in, a team of fewer than
 * two, a repeated agent, or a mirror (both teams the same agents, so a
 * teammate and an enemy would send the same word) is null: never paired.
 */
function teamOf(us, them, agent) {
  const list = (xs) => (Array.isArray(xs) ? xs.slice(0, 5).map(agentOf) : []);
  const a = list(us);
  const b = list(them);
  if (a.length < 2 || a.length > 5 || b.length > 5 || a.some((x) => !x) || b.some((x) => !x)) return null;
  if (new Set(a).size !== a.length || new Set(b).size !== b.length) return null;
  const me = agentOf(agent);
  if (!me || !a.includes(me)) return null;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  if (sa.join(',') === sb.join(',')) return null;
  return `${sa.join(',')}|${sb.join(',')}`;
}

// ── The sheet ──────────────────────────────────────────────────────────────

const plain = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const WEAPONS = new Map(Object.keys(valorantData.weapons || {}).map((k) => [plain(k), k.charAt(0).toUpperCase() + k.slice(1)]));
const KIT = new Map();
for (const a of Object.values(valorantData.agents || {})) for (const k of (a && a.kit) || []) if (k && k.name) KIT.set(plain(k.name), k.name);
/** A gun the game data knows, Melee, or an agent's ability by its kit name; null for anything else. */
function weaponOf(s) {
  if (typeof s !== 'string' || s.length > 32) return null;
  const t = plain(s);
  if (!t) return null;
  if (t === 'melee' || t === 'knife') return 'Melee';
  return WEAPONS.get(t) || KIT.get(t) || null;
}
const placesCache = new Map();
/** A map's places, as valorant-verify.js placesOf names them: callouts, areas, "A site". */
function placesOf(map) {
  const key = String(map || '').toLowerCase();
  if (placesCache.has(key)) return placesCache.get(key);
  const geo = (valorantData.mapGeometry || {})[key];
  let out = null;
  if (geo && Array.isArray(geo.callouts)) {
    out = new Map();
    const add = (s) => { if (typeof s === 'string' && s) out.set(s.toLowerCase(), s); };
    for (const c of geo.callouts) {
      add(c && c.n);
      add(c && c.a);
      if (c && /^[abc]$/i.test(String(c.s || ''))) add(`${String(c.s).toUpperCase()} site`);
      else add(c && c.s);
    }
  }
  placesCache.set(key, out);
  return out;
}
function placeOf(map, s) {
  const p = placesOf(map);
  const t = typeof s === 'string' && s.length <= 40 ? s.trim().toLowerCase() : '';
  return (p && t && p.get(t)) || null;
}
const THREE_SITES = new Set((valorantData.threeSiteMaps || []).map((m) => String(m).toLowerCase()));

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** A whole number in [min, max]: the number, undefined when absent, NaN when out of range or not one. */
function int(v, min, max) {
  if (v === undefined || v === null) return undefined;
  return Number.isInteger(v) && v >= min && v <= max ? v : NaN;
}
const bad = (x) => Number.isNaN(x);
const bool = (v) => (v === true ? true : v === false ? false : null);
const ROUND_SEC_MAX = 200;

/**
 * The sheet an app uploaded for one shared match, made safe: { ok: true,
 * sheet } or { ok: false, error }. Untrusted input, so: only the keys below
 * are read; a number out of range, or numbers that cannot be true together
 * (a round twice, more rounds won than the score, kills in a round over 5,
 * a death with no death, more kills listed than the scoreline holds), refuse
 * the WHOLE sheet; an agent, a map, a gun, a place or a cause the game data
 * or the fixed lists do not know is dropped. NUMBERS, AGENTS, MAPS, PLACES,
 * GUNS AND FIXED KEYS: no string from the app survives but one the game data
 * spells or a list here holds. 24 KB at most.
 */
function cleanSheet(input) {
  if (!isObj(input)) return { ok: false, error: 'invalid' };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { return { ok: false, error: 'invalid' }; }
  if (size > DUO.SHEET_MAX_BYTES) return { ok: false, error: 'too-big' };
  if (input.v !== 1) return { ok: false, error: 'version' };
  const no = { ok: false, error: 'invalid' };
  const map = mapOf(input.map);
  const agent = agentOf(input.agent);
  if (!agent) return no;
  const mode = MODES.includes(input.mode) ? input.mode : null;
  const result = ['W', 'L', 'D'].includes(input.result) ? input.result : null;
  let score = null;
  if (input.score !== undefined && input.score !== null) {
    if (!isObj(input.score)) return no;
    const us = int(input.score.us, 0, DUO.ROUNDS_MAX);
    const them = int(input.score.them, 0, DUO.ROUNDS_MAX);
    if (us === undefined || them === undefined || bad(us) || bad(them) || us + them > DUO.ROUNDS_MAX) return no;
    score = { us, them };
  }
  if (result && score && ((result === 'W' && score.us <= score.them) || (result === 'L' && score.us >= score.them) || (result === 'D' && score.us !== score.them))) return no;
  let grade = null;
  if (input.grade !== undefined && input.grade !== null) {
    const g = isObj(input.grade) ? int(input.grade.score, 0, 100) : NaN;
    if (g === undefined || bad(g)) return no;
    grade = { score: g, letter: social.letter(g) };
  }
  let line = null;
  if (input.line !== undefined && input.line !== null) {
    if (!isObj(input.line)) return no;
    const k = int(input.line.k, 0, 250);
    const d = int(input.line.d, 0, 250);
    const a = int(input.line.a, 0, 250);
    if ([k, d, a].some((x) => x === undefined || bad(x))) return no;
    line = { k, d, a };
  }
  const roundsIn = input.rounds === undefined ? [] : input.rounds;
  if (!Array.isArray(roundsIn) || roundsIn.length > DUO.ROUNDS_MAX) return no;
  if (score && roundsIn.length > score.us + score.them) return no;
  const rounds = [];
  let last = 0;
  let killsAll = 0;
  let deathsAll = 0;
  let won = 0;
  let lost = 0;
  for (const r of roundsIn) {
    if (!isObj(r)) return no;
    const n = int(r.n, 1, DUO.ROUNDS_MAX);
    if (n === undefined || bad(n) || n <= last) return no;
    if (score && n > score.us + score.them) return no;
    last = n;
    const side = r.side === 'atk' || r.side === 'def' ? r.side : null;
    const w = bool(r.won);
    if (w === true) won++;
    if (w === false) lost++;
    const died = r.died === true;
    if (r.died !== undefined && typeof r.died !== 'boolean') return no;
    const sec = int(r.sec, 0, ROUND_SEC_MAX);
    if (bad(sec) || (!died && sec !== undefined)) return no;
    if (!died && (r.killer || r.weapon || r.place || r.cause || r.traded === true || r.traded === false)) return no;
    const killsIn = r.kills === undefined ? [] : r.kills;
    if (!Array.isArray(killsIn) || killsIn.length > 5) return no;
    const kills = killsIn.map((x) => int(x, 0, ROUND_SEC_MAX));
    if (kills.some((x) => x === undefined || bad(x))) return no;
    kills.sort((a, b) => a - b);
    if (died && sec !== undefined && kills.some((x) => x > sec + 1)) return no;
    killsAll += kills.length;
    if (died) deathsAll++;
    let clutch = null;
    if (r.clutch !== undefined && r.clutch !== null) {
      const vs = isObj(r.clutch) ? int(r.clutch.vs, 1, 5) : NaN;
      if (vs === undefined || bad(vs)) return no;
      clutch = { vs, won: bool(r.clutch.won) };
    }
    let alive = null;
    if (r.alive !== undefined && r.alive !== null) {
      const mates = isObj(r.alive) ? int(r.alive.mates, 0, 4) : NaN;
      const enemies = isObj(r.alive) ? int(r.alive.enemies, 0, 5) : NaN;
      if (mates === undefined || enemies === undefined || bad(mates) || bad(enemies) || !died) return no;
      alive = { mates, enemies };
    }
    let plant = null;
    if (r.plant !== undefined && r.plant !== null) {
      if (!isObj(r.plant) || !['A', 'B', 'C'].includes(r.plant.site)) return no;
      if (r.plant.site === 'C' && map && !THREE_SITES.has(map.toLowerCase())) return no;
      const ps = int(r.plant.sec, 0, ROUND_SEC_MAX);
      if (bad(ps)) return no;
      plant = { site: r.plant.site, sec: ps === undefined ? null : ps };
    }
    const killPlaces = (Array.isArray(r.killPlaces) ? r.killPlaces : []).slice(0, 5).map((p) => placeOf(map, p)).filter(Boolean);
    rounds.push({
      n, side, won: w, died, sec: died && sec !== undefined ? sec : null,
      place: died ? placeOf(map, r.place) : null,
      killer: died ? agentOf(r.killer) : null,
      weapon: died ? weaponOf(r.weapon) : null,
      kills, fk: r.fk === true, fd: died && r.fd === true,
      traded: died ? bool(r.traded) : null,
      clutch, alive, plant,
      cause: died && CAUSE_KEYS.includes(r.cause) ? r.cause : null,
      killPlaces,
    });
  }
  if (score && (won > score.us || lost > score.them)) return no;
  if (line && (killsAll > line.k || deathsAll > line.d)) return no;
  return { ok: true, sheet: { v: 1, agent, map, mode, result, score, grade, line, rounds } };
}

/** A sheet as stored, read back through the same cleaner: never trusted twice. */
function sheetOut(stored) {
  if (!isObj(stored)) return null;
  const c = cleanSheet({ ...stored, grade: stored.grade && isObj(stored.grade) ? { score: stored.grade.score } : stored.grade });
  return c.ok ? c.sheet : null;
}
/** The line of a match in the list: the sheet without its rounds. */
function sheetHead(stored) {
  const s = sheetOut(stored);
  return s ? { agent: s.agent, map: s.map, mode: s.mode, result: s.result, score: s.score, grade: s.grade, line: s.line, rounds: s.rounds.length } : null;
}

/** A clip's marks as an app sent them: ms on the clip's own timeline, numbers only. */
function cleanMarks(m) {
  const o = isObj(m) ? m : {};
  const ms = (x) => (Number.isFinite(x) && x >= 0 && x <= 600000 ? Math.round(x) : null);
  const death = ms(o.death);
  const kills = (Array.isArray(o.kills) ? o.kills : []).slice(0, 10).map(ms).filter((x) => x !== null).sort((a, b) => a - b);
  const cuts = (Array.isArray(o.cuts) ? o.cuts : []).slice(0, 10)
    .map((c) => (isObj(c) && ms(c.at) !== null && ms(c.skipped) !== null ? { at: ms(c.at), skipped: ms(c.skipped) } : null)).filter(Boolean);
  // One moment on both clocks: the clip's ms, and the round's ms from its
  // start (Riot's moment of the death or of the first kill).
  const anchor = isObj(o.anchor) && ms(o.anchor.clip) !== null && ms(o.anchor.round) !== null && o.anchor.round <= ROUND_SEC_MAX * 1000
    ? { clip: ms(o.anchor.clip), round: ms(o.anchor.round) } : null;
  return { death, kills, cuts, anchor };
}

// ── What a route answers ───────────────────────────────────────────────────

const iso = (t) => (t ? new Date(t).toISOString() : null);
const name = (s) => (typeof s === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(s) ? s : null);
const count = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0);

/**
 * The Duos page's state, from social_duo_me. With the Riot ID proof off
 * (o.proof false) a partner's rank is only the one their own app sent.
 */
function meView(row, o = {}) {
  if (!isObj(row)) return null;
  const proof = o.proof === true;
  const partners = (Array.isArray(row.partners) ? row.partners : []).filter((p) => isObj(p) && name(p.username)).map((p) => {
    const mine = p.mine_max === true;
    const theirs = p.their_max === true;
    const tier = proof && p.verified === true ? social.tierOf(p.rank_current) : social.tierOf(p.pc_rank);
    return {
      username: p.username,
      state: mine || theirs ? 'active' : 'paused',
      max: mine && theirs ? 'both' : mine ? 'you' : theirs ? 'them' : null,
      since: iso(p.since),
      rank: tier ? { tier, source: proof && p.verified === true ? 'verified' : 'pc' } : null,
      newPins: count(p.new_pins),
      matches: count(p.matches),
    };
  });
  return {
    username: name(row.username),
    discoverable: row.discoverable === true,
    max: row.max === true,
    partners,
    ended: (Array.isArray(row.ended) ? row.ended : []).filter((e) => isObj(e) && name(e.username)).slice(0, 10)
      .map((e) => ({ username: e.username, byMe: e.by_me === true, at: iso(e.at) })),
    invitesIn: (Array.isArray(row.invites_in) ? row.invites_in : []).filter((i) => isObj(i) && name(i.username)).slice(0, 20)
      .map((i) => ({ username: i.username, at: iso(i.at), expiresAt: iso(i.expires_at) })),
    invitesOut: (Array.isArray(row.invites_out) ? row.invites_out : []).filter((i) => isObj(i) && refOf(i.ref)).slice(0, DUO.INVITES_OPEN_MAX)
      .map((i) => ({ ref: i.ref, name: i.code === true ? null : name(i.name), code: i.code === true, at: iso(i.at), expiresAt: iso(i.expires_at) })),
    found: (Array.isArray(row.found) ? row.found : []).filter((f) => isObj(f) && name(f.username)).slice(0, 20)
      .map((f) => ({ username: f.username, agent: agentOf(f.agent), at: iso(f.at) })),
    quota: { up: count(row.up_bytes), upMax: DUO.UPLOAD_BYTES, down: count(row.down_bytes), downMax: DUO.DOWNLOAD_BYTES_DAY },
  };
}

/** The shared matches, from social_duo_matches_of. */
function matchesView(rows) {
  return (Array.isArray(rows) ? rows : []).filter((m) => isObj(m) && refOf(m.ref) && name(m.partner)).slice(0, DUO.MATCHES_MAX).map((m) => ({
    ref: m.ref, partner: m.partner, playedAt: iso(m.played_at), expiresAt: iso(m.expires_at), active: m.active === true,
    mine: sheetHead(m.mine), theirs: sheetHead(m.theirs), myClips: count(m.my_clips), theirClips: count(m.their_clips),
  }));
}

/** One shared match, from social_duo_match: both sheets whole, the stored clips with their marks, the pins. */
function matchView(m) {
  if (!isObj(m) || !refOf(m.ref) || !name(m.partner)) return null;
  const clips = (Array.isArray(m.clips) ? m.clips : []).filter((c) => isObj(c) && refOf(c.ref) && CLIP_NAME.test(String(c.name || ''))).slice(0, 2 * DUO.CLIPS_PER_MATCH)
    .map((c) => ({ ref: c.ref, mine: c.mine === true, name: c.name, round: count(c.round), kind: CLIP_KINDS.includes(c.kind) ? c.kind : 'death',
      marks: cleanMarks(c.marks), size: count(c.size) }));
  const known = new Set(clips.map((c) => c.ref));
  const pins = (Array.isArray(m.pins) ? m.pins : []).filter((p) => isObj(p) && refOf(p.ref) && known.has(p.clip) && PIN_LABELS.includes(p.label)).slice(0, 400)
    .map((p) => ({ ref: p.ref, clip: p.clip, at: count(p.at_ms), label: p.label, reaction: REACTIONS.includes(p.reaction) ? p.reaction : null,
      mine: p.mine === true, createdAt: iso(p.at) }));
  return {
    ref: m.ref, partner: m.partner, playedAt: iso(m.played_at), expiresAt: iso(m.expires_at), active: m.active === true,
    mine: sheetOut(m.mine), theirs: sheetOut(m.theirs), clips, pins,
  };
}

// ── The store ──────────────────────────────────────────────────────────────

const BUCKET = 'duo-clips';
const MIME = 'video/x-matroska';

function isNotLive(error) {
  if (!error) return false;
  if (callers.isMissing(error)) return true;
  const m = `${error.message || ''} ${error.error || ''}`.toLowerCase();
  return m.includes('bucket not found');
}
function failed(error, what) {
  const e = new Error(`${what}: ${(error && (error.message || error.code)) || 'failed'}`);
  if (isNotLive(error)) e.notLive = true;
  e.code = error && error.code;
  return e;
}

/**
 * social-002-duos.sql's functions, one rpc each, and the private bucket,
 * through the service role. Every method throws on an error, `notLive` set
 * when the SQL has not run or the bucket is not there. Every number of a
 * limit goes in from DUO, so the SQL holds none of its own.
 */
function createStore(supabase) {
  const db = () => (typeof supabase === 'function' ? supabase() : supabase);
  async function call(fn, args) {
    const { data, error } = await db().rpc(fn, args);
    if (error) throw failed(error, fn);
    return data;
  }
  const bucket = () => db().storage.from(BUCKET);
  const D = DUO;
  const windowMs = D.PAIR_WINDOW_MIN * 60 * 1000;
  return {
    async status() {
      try { return (await call('social_duo_status', {})) === true; } catch (e) { if (e.notLive) return false; throw e; }
    },
    me: (user) => call('social_duo_me', { p_user: user, p_window_ms: windowMs, p_ended_days: D.ENDED_DAYS, p_quota_days: D.QUOTA_DAYS }),
    inviteName: (user, nm) => call('social_duo_invite_name', { p_user: user, p_name: nm, p_key: social.keyOf(nm), p_ttl_ms: D.INVITE_DAYS * 86400000,
      p_open_max: D.INVITES_OPEN_MAX, p_partner_max: D.PARTNERS_MAX }),
    inviteCode: (user, hash) => call('social_duo_invite_code', { p_user: user, p_code_hash: hash, p_ttl_ms: D.INVITE_DAYS * 86400000,
      p_open_max: D.INVITES_OPEN_MAX, p_partner_max: D.PARTNERS_MAX }),
    acceptCode: (user, hash) => call('social_duo_accept_code', { p_user: user, p_code_hash: hash, p_partner_max: D.PARTNERS_MAX, p_guess_day: D.GUESSES_PER_DAY }),
    acceptFrom: (user, nm) => call('social_duo_accept_from', { p_user: user, p_from_key: social.keyOf(nm), p_partner_max: D.PARTNERS_MAX }),
    decline: (user, nm) => call('social_duo_decline', { p_user: user, p_from_key: social.keyOf(nm) }),
    cancel: (user, ref) => call('social_duo_cancel', { p_user: user, p_ref: ref }),
    remove: (user, nm) => call('social_duo_remove', { p_user: user, p_key: social.keyOf(nm) }),
    report: (user, hash, team, agent) => call('social_duo_report', { p_user: user, p_match_hash: hash, p_team: team, p_agent: agent,
      p_usage_hours: D.REPORT_GAME_HOURS, p_window_ms: windowMs, p_report_days: D.REPORT_DAYS, p_keep_days: D.KEEP_DAYS }),
    matchesOf: (user) => call('social_duo_matches_of', { p_user: user, p_limit: D.MATCHES_MAX }),
    match: (user, ref) => call('social_duo_match', { p_user: user, p_ref: ref }),
    sheetPut: (user, ref, sheet) => call('social_duo_sheet_put', { p_user: user, p_ref: ref, p_sheet: sheet, p_max: D.SHEET_MAX_BYTES * 2 }),
    clipStart: (user, ref, c) => call('social_duo_clip_start', { p_user: user, p_ref: ref, p_name: c.name, p_round: c.round, p_kind: c.kind, p_marks: c.marks,
      p_reserve: D.CLIP_MAX_BYTES, p_per_match: D.CLIPS_PER_MATCH, p_quota: D.UPLOAD_BYTES, p_quota_days: D.QUOTA_DAYS, p_issues: D.ISSUES_MAX }),
    clipPath: (user, ref) => call('social_duo_clip_path', { p_user: user, p_ref: ref }),
    clipDone: (user, ref, size) => call('social_duo_clip_done', { p_user: user, p_ref: ref, p_size: size, p_cap: D.CLIP_MAX_BYTES }),
    clipGet: (user, ref) => call('social_duo_clip_get', { p_user: user, p_ref: ref, p_down: D.DOWNLOAD_BYTES_DAY, p_urls: D.DOWNLOAD_URLS_DAY }),
    setDiscoverable: (user, on) => call('social_duo_set_discoverable', { p_user: user, p_on: !!on }),
    discoverable: (user) => call('social_duo_discoverable', { p_user: user }),
    pin: (user, clip, at, label, reaction) => call('social_duo_pin', { p_user: user, p_clip: clip, p_at_ms: at, p_label: label, p_reaction: reaction, p_max: D.PINS_PER_CLIP }),
    pinRemove: (user, ref) => call('social_duo_pin_remove', { p_user: user, p_ref: ref }),
    seen: (user) => call('social_duo_seen', { p_user: user }),
    reportTarget: (user, nm) => call('social_duo_report_target', { p_user: user, p_key: social.keyOf(nm) }),
    sweep: (limit) => call('social_duo_sweep', { p_limit: limit, p_ended_days: D.ENDED_DAYS, p_report_days: D.REPORT_DAYS, p_quota_days: D.QUOTA_DAYS }),
    trashDone: (paths) => call('social_duo_trash_done', { p_paths: paths }),
    clipDrop: (ref) => call('social_duo_clip_drop', { p_ref: ref }),
    clipSettle: (ref, size) => call('social_duo_clip_done', { p_user: null, p_ref: ref, p_size: size, p_cap: D.CLIP_MAX_BYTES }),
    allPaths: (limit, after) => call('social_duo_all_paths', { p_limit: limit, p_after: after || null }),

    // ── The bucket ────────────────────────────────────────────────────────
    /**
     * A signed upload URL for exactly this path (Supabase's, about 2 hours),
     * WITHOUT upsert: a path is written once. A file stored there can never
     * be overwritten by a bigger one through the same URL (its quota and its
     * downloads are charged by the size storage reports once).
     */
    async signUpload(p) {
      const { data, error } = await bucket().createSignedUploadUrl(p, { upsert: false });
      if (error) throw failed(error, 'sign upload');
      if (!data || typeof data.signedUrl !== 'string') throw new Error('sign upload: no URL');
      return data.signedUrl;
    },
    /** A signed download URL for SIGNED_DOWNLOAD_SEC. */
    async signDownload(p) {
      const { data, error } = await bucket().createSignedUrl(p, SIGNED_DOWNLOAD_SEC);
      if (error) throw failed(error, 'sign download');
      if (!data || typeof data.signedUrl !== 'string') throw new Error('sign download: no URL');
      return data.signedUrl;
    },
    /** The stored file's size in bytes, or null when there is no file at the path. */
    async stat(p) {
      const cut = p.lastIndexOf('/');
      const { data, error } = await bucket().list(p.slice(0, cut), { limit: 10, search: p.slice(cut + 1) });
      if (error) throw failed(error, 'list');
      const hit = (Array.isArray(data) ? data : []).find((o) => o && o.name === p.slice(cut + 1));
      if (!hit) return null;
      const sz = Number(hit.metadata && hit.metadata.size);
      return Number.isFinite(sz) ? sz : null;
    },
    async removeFiles(paths) {
      if (!paths.length) return;
      const { error } = await bucket().remove(paths);
      if (error) throw failed(error, 'remove');
    },
  };
}

/** Whether Duos is switched on: SOCIAL_DUOS_ON exactly '1', and SOCIAL_ON exactly '1' too. Off by default. */
const duosOn = (env = process.env) => String((env && env.SOCIAL_DUOS_ON) || '') === '1' && String((env && env.SOCIAL_ON) || '') === '1';

module.exports = {
  DUO, PIN_LABELS, PIN_WORDS, REACTIONS, REACTION_WORDS, CODE_ALPHABET, CLIP_NAME, CLIP_KINDS, CAUSE_KEYS, MODES, PLAN, BUCKET, MIME,
  SIGNED_DOWNLOAD_SEC, codeOf, codeShown, mintCode, codeHash, matchHash, matchIdOf, refOf, teamOf, weaponOf, placeOf, cleanSheet,
  sheetOut, sheetHead, cleanMarks, meView, matchesView, matchView, createStore, duosOn, isNotLive,
};
