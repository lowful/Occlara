'use strict';

/**
 * PUBLIC PROFILES AND PLAYER SEARCH (docs/claude/social.md).
 *
 * A player who opts in has a public profile under a username of their own:
 * Occlara's numbers from their own PC (a stats snapshot their app uploads)
 * and, once they PROVED CONTROL of a Riot ID in the game, that Riot ID and the
 * rank the server reads for it. Other signed in players find it by username
 * or by a whole Riot ID. This is the foundation Occlara Duos builds on.
 *
 * WHAT THIS FILE HOLDS, all pure but the store:
 *   the username rules   shape, reserved words, the block list, on the name
 *                        with its look alike letters folded (RULES, below,
 *                        word for word the same in src/shared/social.js)
 *   the keys             one normal form for names and Riot IDs (keyOf)
 *   the snapshot         what an app may upload: a whitelist, every number in
 *                        its range, the whole refused when it is impossible
 *   the views            what a route may answer, built field by field: no
 *                        email, user id, account key, puuid or its hash
 *   the proof of control the two agents to play and the judge of Riot's
 *                        record (pickAgents, judge)
 *   the store            one Supabase rpc per operation (social-001's
 *                        functions), each throwing, `notLive` when the SQL
 *                        has not run
 *
 * WHY NOT "VERIFIED BY PLAY". A Riot ID used to be verified when the app's
 * own match link named it three times. That proved nothing: the link names
 * whatever match and player the client sends, and a live row holds no match
 * id, so anyone could link a stranger's public matches and wear their Riot
 * ID. Passive observation cannot prove ownership (a player recording a
 * streamer's broadcast links the streamer's matches honestly). Only something
 * the owner does in the game, checked in Riot's own record, can.
 */

const valorantData = require('../valorant-data.generated.json');
const callers = require('./caller');

// ── Numbers ────────────────────────────────────────────────────────────────

const RANK_MS = 6 * 60 * 60 * 1000;         // a verified rank is asked of HenrikDev at most this often a profile
const SNAPSHOT_MAX_BYTES = 8192;            // a snapshot as JSON
const SEARCH_MAX = 10;
const SEARCH_MIN = 3;                       // a username start, at least
const BLOCK_MAX = 500;
const STATUS_MS = 30 * 1000;
// The proof of control.
// No limit here ever depends on what OTHER accounts did with a Riot ID: a
// cap per Riot account let three free accounts lock its owner out, and its
// refusal told a stranger someone was trying (the review of 25 Nov).
const CHALLENGE = Object.freeze({
  TTL_MS: 4 * 60 * 60 * 1000,               // three or four matches, four hours
  PER_DAY: 2,                               // starts per account in a rolling day, every attempt counted
  PER_MONTH: 6,                             // and in 30 days
  CHECK_GAP_MS: 60 * 1000,                  // a check at most once a minute
  CHECKS: 30,                               // and 30 times a challenge (a check Riot could not answer gives its count back)
  RECENT: 10,                               // the account's matches a sequence avoids
  GONE_MS: 6 * 60 * 60 * 1000,              // a name that no longer resolves twice, this far apart, unverifies
});
// THE FIVE AGENTS EVERY ACCOUNT OWNS. The game data (valorant-api.com, as
// sync:valorant writes it) carries no base content flag on an agent, so they
// are written out here; test:social holds each to the game data's names.
const BASE_AGENTS = Object.freeze(['Brimstone', 'Jett', 'Phoenix', 'Sage', 'Sova']);

// ── RULES START (word for word the same in src/shared/social.js) ──────────
const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const CHANGE_DAYS = 30;
const HOLD_DAYS = 30;
const USERNAME_SHAPE = /^[A-Za-z0-9_]{3,20}$/;
const HAS_LETTER = /[A-Za-z]/;

// LOOK ALIKES, folded before any word is looked for, in the name and in every
// word alike: pairs first (rn reads as m, vv as w, ph as f), then one letter
// at a time (l, I and 1 as i, 0 as o, v as u, the other digits as the
// letters they stand for). A capital I and an l are one letter here, so
// OccIara, Occ1ara and Occlara are one name.
const FOLD_PAIRS = [['rn', 'm'], ['vv', 'w'], ['ph', 'f']];
const FOLD_ONE = { l: 'i', 1: 'i', 0: 'o', v: 'u', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };

// Reserved: names that pass for Occlara, Riot or the people who run them.
// LONG ones anywhere in the name, SHORT ones as a whole part of it (split on
// underscores) or the whole name, START ones at its very start too
// ("riotjames", "admin2", "staffer"), never "patriot", "badminton", "mustafa".
const RESERVED_LONG = ['occlara', 'ghostcoach', 'valorant', 'riotgames', 'support', 'official', 'moderator'];
const RESERVED_SHORT = ['riot', 'admin', 'administrator', 'staff', 'mod', 'mods', 'dev', 'devs', 'team', 'help', 'root', 'system', 'owner', 'occ'];
const RESERVED_START = ['riot', 'admin', 'staff'];

// THE BLOCK LIST. Children use Occlara (schools are a market), so a name is
// the one thing a player types that others see, and it is held to this.
// ANYWHERE words are found inside the name; WHOLE words only as a whole part
// of it, so "classic" and "therapist" pass. Matched with each letter allowed
// to repeat (fuuuck) and a doubled letter needing two (so "niger" is not
// the slur), on the folded name and on it with its digits dropped.
const WORDS_ANYWHERE = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'fagot', 'retard',
  'whore', 'slut', 'pussy', 'penis', 'vagina', 'porn', 'nazi', 'hitler', 'kike', 'chink', 'wetback',
  'tranny', 'twat', 'wank', 'jizz', 'molest', 'pedophile', 'paedophile', 'incest', 'dildo', 'milf', 'boobs',
  'blowjob', 'handjob', 'cumshot', 'nutsack', 'bollock', 'bastard', 'asshole', 'arsehole', 'motherf', 'beaner',
  'gook', 'killyourself', 'heilhitler', 'siegheil', 'raghead', 'towelhead'];
const WORDS_WHOLE = ['ass', 'asses', 'arse', 'tit', 'tits', 'titty', 'fag', 'fags', 'nig', 'nigs', 'hoe', 'hoes', 'cum',
  'sex', 'sexy', 'rape', 'raped', 'raping', 'rapist', 'pedo', 'pedos', 'anal', 'anus', 'cock', 'cocks', 'dick', 'dicks',
  'kys', 'paki', 'pakis', 'homo', 'jap', 'japs', 'wop', 'nonce', 'skank', 'thot', 'prick', 'piss', 'crap', 'damn',
  'sperm', 'semen', 'horny', 'nude', 'nudes', 'naked', 'xxx', 'kkk', 'negro', 'negros', 'coon', 'coons', 'spic', 'spics',
  'dyke', 'dykes'];

/** Lower case, look alikes folded. */
function fold(s) {
  let t = String(s || '').toLowerCase();
  for (const [a, b] of FOLD_PAIRS) t = t.split(a).join(b);
  return t.split('').map((c) => (FOLD_ONE[c] !== undefined ? FOLD_ONE[c] : c)).join('');
}

/** A word as a pattern: each letter may repeat, a doubled letter needs two (strict), or any run at all (loose). */
function wordPattern(w, loose) {
  let src = '';
  let i = 0;
  while (i < w.length) {
    let j = i;
    while (j < w.length && w[j] === w[i]) j++;
    src += j - i >= 2 && !loose ? `${w[i]}{2,}` : `${w[i]}+`;
    i = j;
  }
  return src;
}
const ANYWHERE_RE = WORDS_ANYWHERE.map((w) => new RegExp(wordPattern(fold(w))));
const WHOLE_RE = WORDS_WHOLE.map((w) => new RegExp(`^${wordPattern(fold(w))}$`));
const LONG_RE = RESERVED_LONG.map((w) => new RegExp(wordPattern(fold(w), true)));
const SHORT_RE = RESERVED_SHORT.map((w) => new RegExp(`^${wordPattern(fold(w), true)}s?$`));
const START_RE = RESERVED_START.map((w) => new RegExp(`^${wordPattern(fold(w), true)}`));

/** The forms a name is read in: folded, and folded with its digits dropped; whole and each part. */
function forms(name) {
  const parts = String(name || '').toLowerCase().split('_').filter(Boolean);
  const bare = (s) => fold(s.split('').filter((c) => !(c >= '0' && c <= '9')).join(''));
  return {
    whole: [fold(parts.join('')), bare(parts.join(''))],
    parts: parts.flatMap((p) => [fold(p), bare(p)]).filter(Boolean),
  };
}

/**
 * Whether a username may be used: { ok: true, name, key } or { ok: false,
 * reason } with reason 'shape' (3 to 20 letters, digits or underscores),
 * 'digits' (no letter at all), 'reserved' or 'word' (the block list).
 */
function checkUsername(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!USERNAME_SHAPE.test(name)) return { ok: false, reason: 'shape' };
  if (!HAS_LETTER.test(name)) return { ok: false, reason: 'digits' };
  const f = forms(name);
  const all = [...f.whole, ...f.parts];
  if (all.some((s) => LONG_RE.some((re) => re.test(s)))) return { ok: false, reason: 'reserved' };
  if (all.some((s) => SHORT_RE.some((re) => re.test(s)))) return { ok: false, reason: 'reserved' };
  if (f.whole.some((s) => START_RE.some((re) => re.test(s)))) return { ok: false, reason: 'reserved' };
  if (all.some((s) => ANYWHERE_RE.some((re) => re.test(s)))) return { ok: false, reason: 'word' };
  if (all.some((s) => WHOLE_RE.some((re) => re.test(s)))) return { ok: false, reason: 'word' };
  return { ok: true, name, key: keyOf(name) };
}

/** One normal form for matching: NFKC, then lower case. The database compares these and nothing else. */
function keyOf(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase();
}
// ── RULES END ──────────────────────────────────────────────────────────────

// ── The grade letter, the titles and the tiers (the app's own, held equal) ─

/** S 90+, A 80+, B 70+, C 60+, D below (src/shared/grade.js letter). */
function letter(score) {
  if (!Number.isFinite(score)) return null;
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
}

/** Wrapped's titles by id and name (src/shared/wrapped.js titleOf). */
const TITLES = Object.freeze({
  entry: 'The Entry', clutch: 'The Closer', climber: 'The Climber', specialist: 'The Specialist', fragger: 'The Fragger',
  anchor: 'The Anchor', flex: 'The Flex', grinder: 'The Grinder', student: 'The Student',
});

const LADDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'];
/** A rank tier as Riot names it ("Gold 2", "Radiant"), or null. */
function tierOf(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim();
  if (s === 'Radiant') return s;
  const [name, div, extra] = s.split(' ');
  if (extra !== undefined || !LADDER.includes(name) || !['1', '2', '3'].includes(div)) return null;
  return `${name} ${div}`;
}

// ── The snapshot ───────────────────────────────────────────────────────────

const plain = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const AGENTS = new Map(Object.keys(valorantData.agents || {}).map((n) => [plain(n), n]));
const MAPS = new Map((valorantData.maps || []).map((n) => [plain(n), n]));
const agentOf = (s) => (typeof s === 'string' && s.length <= 24 ? AGENTS.get(plain(s)) || null : null);
const mapOf = (s) => (typeof s === 'string' && s.length <= 24 ? MAPS.get(plain(s)) || null : null);

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
/** A whole number in [min, max]: the number, undefined when absent, NaN when out of range or not one. */
function int(v, min, max) {
  if (v === undefined || v === null) return undefined;
  return Number.isInteger(v) && v >= min && v <= max ? v : NaN;
}
const bad = (x) => Number.isNaN(x);
const RESULTS = new Set(['W', 'L', 'D']);
// Rounds a match can hold at the very most (overtime included): the ceiling
// on multi kills and clutches a match.
const ROUNDS_MAX = 50;

/**
 * The snapshot an app uploaded, made safe: { ok: true, snapshot } or
 * { ok: false, error }. Untrusted input, so: only the keys below are read;
 * a number outside its range, or numbers that cannot be true together (more
 * wins than matches, agents or maps played more often than there are
 * matches, a recent list that disagrees with the record), refuse the WHOLE
 * snapshot; an agent or a map the game data does not know, an unknown title
 * and a tier that is no tier are dropped; lists are cut to their length; 8 KB
 * at most. It is NUMBERS, AGENTS, MAPS AND TIERS: no string from the app
 * survives but a name the game data spells, a result letter, a title id and
 * a tier Riot names.
 */
function cleanSnapshot(input) {
  if (!isObj(input)) return { ok: false, error: 'invalid' };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { return { ok: false, error: 'invalid' }; }
  if (size > SNAPSHOT_MAX_BYTES) return { ok: false, error: 'too-big' };
  if (input.v !== 1) return { ok: false, error: 'version' };
  const no = { ok: false, error: 'invalid' };
  const matches = int(input.matches, 1, 100000);
  if (matches === undefined || bad(matches)) return no;
  const wins = int(input.wins, 0, matches) || 0;
  const losses = int(input.losses, 0, matches) || 0;
  const draws = int(input.draws, 0, matches) || 0;
  if ([input.wins, input.losses, input.draws].some((x) => bad(int(x, 0, matches)))) return no;
  if (wins + losses + draws > matches) return no;

  let grade = null;
  if (input.grade !== undefined && input.grade !== null) {
    if (!isObj(input.grade)) return no;
    const avg = int(input.grade.avg, 0, 100);
    const n = int(input.grade.n, 1, matches);
    const trendIn = input.grade.trend === undefined ? [] : input.grade.trend;
    if (avg === undefined || bad(avg) || n === undefined || bad(n) || !Array.isArray(trendIn)) return no;
    const trend = trendIn.slice(0, 20).map((x) => int(x, 0, 100));
    if (trend.some((x) => x === undefined || bad(x)) || trend.length > n) return no;
    grade = { avg, letter: letter(avg), n, trend };
  }

  let kd = null;
  if (input.kd !== undefined && input.kd !== null) {
    if (typeof input.kd !== 'number' || !Number.isFinite(input.kd) || input.kd < 0 || input.kd > 20) return no;
    kd = Math.round(input.kd * 100) / 100;
  }
  const hs = int(input.hs, 0, 100);
  if (bad(hs)) return no;

  const tally = (list, nameOf, withWins) => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > 10) return null;
    const out = [];
    let sum = 0;
    for (const x of list) {
      if (!isObj(x)) return null;
      const n = int(x.n, 1, matches);
      if (n === undefined || bad(n)) return null;
      sum += n;
      let w;
      if (withWins) { w = int(x.w, 0, n); if (bad(w)) return null; }
      const name = nameOf(x.name);
      if (!name || out.some((o) => o.name === name) || out.length >= 3) continue;
      out.push(withWins ? { name, n, w: w || 0 } : { name, n });
    }
    return sum <= matches ? out : null;
  };
  const agents = tally(input.agents, agentOf, false);
  const maps = tally(input.maps, mapOf, true);
  if (!agents || !maps) return no;

  const m = input.multi === undefined ? {} : input.multi;
  if (!isObj(m)) return no;
  const cap = matches * ROUNDS_MAX;
  const multi = {};
  for (const k of ['k2', 'k3', 'k4', 'k5']) {
    const v = int(m[k], 0, cap);
    if (bad(v)) return no;
    multi[k] = v || 0;
  }
  if (multi.k2 + multi.k3 + multi.k4 + multi.k5 > cap) return no;
  const clutches = int(input.clutches, 0, cap);
  if (bad(clutches)) return no;

  const recentIn = input.recent === undefined ? [] : input.recent;
  if (!Array.isArray(recentIn) || recentIn.length > 10 || recentIn.length > matches) return no;
  const recent = [];
  for (const r of recentIn) {
    if (!isObj(r) || !RESULTS.has(r.r)) return no;
    const g = int(r.grade, 0, 100);
    if (bad(g)) return no;
    recent.push({ r: r.r, agent: agentOf(r.agent), map: mapOf(r.map), grade: g === undefined ? null : g, letter: g === undefined ? null : letter(g) });
  }
  const count = (x) => recent.filter((r) => r.r === x).length;
  if (count('W') > wins || count('L') > losses || count('D') > draws) return no;

  const title = typeof input.title === 'string' && Object.prototype.hasOwnProperty.call(TITLES, input.title)
    ? { id: input.title, name: TITLES[input.title] } : null;

  let rank = null;
  if (isObj(input.rank)) {
    const current = tierOf(input.rank.current);
    const peak = tierOf(input.rank.peak);
    if (current || peak) rank = { current, peak };
  }

  return { ok: true, snapshot: { v: 1, matches, wins, losses, draws, grade, kd, hs: hs === undefined ? null : hs,
    agents, maps, multi, clutches: clutches || 0, recent, title, rank } };
}

// ── What a route answers ───────────────────────────────────────────────────

/** A snapshot as stored, read back through the same cleaner: never trusted twice. */
function statsOut(stored) {
  if (!isObj(stored)) return null;
  // Kept as cleanSnapshot wrote it: the title as { id, name }, read back by its id.
  const title = isObj(stored.title) ? stored.title.id : stored.title;
  const recent = Array.isArray(stored.recent) ? stored.recent.map((r) => (isObj(r) ? { r: r.r, agent: r.agent, map: r.map, grade: r.grade === null ? undefined : r.grade } : r)) : stored.recent;
  const c = cleanSnapshot({ ...stored, v: 1, title, recent });
  return c.ok ? c.snapshot : null;
}

const iso = (t) => (t ? new Date(t).toISOString() : null);
const riotOf = (name, tag) => (typeof name === 'string' && name && typeof tag === 'string' && tag ? { name, tag } : null);

/** A challenge as its owner may see it: its sequence, the time, the count, what the last check found. */
function challengeView(c) {
  if (!isObj(c)) return null;
  const agents = (Array.isArray(c.agents) ? c.agents : []).map((a) => agentOf(a)).filter(Boolean);
  return {
    status: ['open', 'passed', 'expired', 'spent'].includes(c.status) ? c.status : 'expired',
    agents,
    riot: riotOf(c.riot_name, c.riot_tag),
    issuedAt: iso(c.issued_at),
    expiresAt: iso(c.expires_at),
    checks: Number.isInteger(c.checks) ? c.checks : 0,
    maxChecks: CHALLENGE.CHECKS,
    lastResult: typeof c.last_result === 'string' ? c.last_result : null,
    progress: Number.isInteger(c.progress) ? Math.max(0, Math.min(agents.length, c.progress)) : 0,
  };
}

/**
 * The owner's own profile, from social_me (and its challenge). Never an id,
 * an email or a hash. With the proof off (o.proof false: SOCIAL_RIOT_PROOF is
 * not 1), nothing of a Riot ID is answered at all.
 */
function meView(row, challenge, o = {}) {
  if (!isObj(row)) return null;
  const proof = o.proof !== false;
  const verified = proof && row.riot_verified === true;
  const setAt = row.username_set_at ? Date.parse(row.username_set_at) : null;
  const lost = proof && !verified && ['takeover', 'renamed', 'gone'].includes(row.riot_lost_reason) ? row.riot_lost_reason : null;
  return {
    username: typeof row.username === 'string' ? row.username : null,
    public: row.public === true,
    showRiotId: row.show_riot_id !== false,
    discoverable: row.discoverable === true,
    riot: proof ? {
      state: verified ? 'verified' : lost ? 'lost' : 'none',
      riotId: verified ? riotOf(row.riot_name, row.riot_tag) : null,
      verifiedAt: verified ? iso(row.riot_verified_at) : null,
      lost,
      lostAt: lost ? iso(row.riot_lost_at) : null,
    } : null,
    rank: verified && (tierOf(row.rank_current) || tierOf(row.rank_peak))
      ? { source: 'verified', current: tierOf(row.rank_current), peak: tierOf(row.rank_peak), at: iso(row.rank_at) } : null,
    challenge: proof ? challengeView(challenge) : null,
    statsAt: iso(row.stats_at),
    nameChangeAt: setAt ? new Date(setAt + CHANGE_DAYS * 86400000).toISOString() : null,
    blocked: (Array.isArray(row.blocked) ? row.blocked : []).filter((u) => typeof u === 'string').slice(0, BLOCK_MAX),
  };
}

/**
 * The rank a profile shows, from one place only: a verified profile the
 * server's (source 'verified'), else the one the player's own app sent
 * (source 'pc'). Never both.
 */
function rankFor(verified, current, peak, stats) {
  if (verified) return (tierOf(current) || tierOf(peak)) ? { source: 'verified', current: tierOf(current), peak: tierOf(peak) } : null;
  const r = stats && stats.rank;
  return r && (r.current || r.peak) ? { source: 'pc', current: r.current || null, peak: r.peak || null } : null;
}

/** A profile as another player sees it (or its owner, `self`), from social_view. With the proof off, no Riot ID and the PC's rank. */
function profileView(row, o = {}) {
  if (!isObj(row) || typeof row.username !== 'string') return null;
  const verified = o.proof !== false && row.verified === true;
  const stats = statsOut(row.stats);
  const rank = rankFor(verified, row.rank_current, row.rank_peak, stats);
  if (stats) delete stats.rank;
  return {
    username: row.username,
    self: row.self === true,
    public: row.public === true,
    riot: verified ? riotOf(row.riot_name, row.riot_tag) : null,
    verified,
    rank,
    stats,
    statsAt: iso(row.stats_at),
  };
}

/** One search result, from social_search. With the proof off, no Riot ID and the PC's rank. */
function resultView(row, o = {}) {
  if (!isObj(row) || typeof row.username !== 'string') return null;
  const g = row.grade !== null && row.grade !== undefined && Number.isFinite(Number(row.grade)) ? Math.round(Number(row.grade)) : null;
  const verified = o.proof !== false && row.verified === true;
  const tier = verified ? tierOf(row.rank_current) : tierOf(row.pc_rank);
  return {
    username: row.username,
    riot: verified ? riotOf(row.riot_name, row.riot_tag) : null,
    rank: tier ? { tier, source: verified ? 'verified' : 'pc' } : null,
    agent: agentOf(row.agent),
    grade: g === null || g < 0 || g > 100 ? null : { avg: g, letter: letter(g) },
  };
}

// ── The search query ───────────────────────────────────────────────────────

const RIOT_NAME = /^[\p{L}\p{N} ._-]{1,24}$/u;
const RIOT_TAG = /^[\p{L}\p{N}]{2,8}$/u;
/** A Riot ID as typed, "Name#TAG", as { name, tag, key } or null. */
function riotIdOf(input) {
  if (typeof input !== 'string') return null;
  const q = input.trim().replace(/\s+/g, ' ');
  const hash = q.indexOf('#');
  if (hash < 1 || q.indexOf('#', hash + 1) >= 0) return null;
  const name = q.slice(0, hash).trim();
  const tag = q.slice(hash + 1).trim();
  if (!RIOT_NAME.test(name) || !RIOT_TAG.test(tag)) return null;
  return { name, tag, key: `${keyOf(name)}#${keyOf(tag)}` };
}

/**
 * What a search box holds, as one of two searches, or null:
 *   Name#TAG          { mode: 'riot', key }   the whole Riot ID, exactly, any case
 *   a username start  { mode: 'name', key }   3 letters, digits or underscores at least
 * A Riot name alone is no search: every public profile could be listed by
 * its first letters.
 */
function queryOf(input) {
  if (typeof input !== 'string') return null;
  const q = input.trim();
  if (!q || q.length > 40) return null;
  if (q.includes('#')) {
    const r = riotIdOf(q);
    return r ? { mode: 'riot', key: r.key } : null;
  }
  if (new RegExp(`^[A-Za-z0-9_]{${SEARCH_MIN},20}$`).test(q)) return { mode: 'name', key: keyOf(q) };
  return null;
}

// ── The proof of control ───────────────────────────────────────────────────

/** Every ordered sequence of `n` different agents from `pool`. */
function sequences(pool, n) {
  const out = [];
  const walk = (seq) => {
    if (seq.length === n) { out.push(seq.slice()); return; }
    for (const a of pool) if (!seq.includes(a)) { seq.push(a); walk(seq); seq.pop(); }
  };
  walk([]);
  return out;
}

/**
 * The sequences a challenge for this account may be, as "A,B,C" words: of
 * THREE different owned agents with at least two the account has not played
 * in its last RECENT matches (from the 60 of three), or, when fewer than two
 * owned agents are unplayed there (a player who rotates them, as a new
 * account does), of FOUR different owned agents (all 120). `recent` is the
 * account's agents, newest first. The database picks one that no other OPEN
 * challenge on the same Riot account holds (social_challenge_start).
 */
function candidatesFor(recent) {
  const lastN = (Array.isArray(recent) ? recent : []).slice(0, CHALLENGE.RECENT).map((a) => agentOf(a));
  const unplayed = BASE_AGENTS.filter((a) => !lastN.includes(a));
  if (unplayed.length >= 2) {
    const list = sequences(BASE_AGENTS, 3).filter((s) => s.filter((a) => unplayed.includes(a)).length >= 2);
    return { length: 3, list: list.map((s) => s.join(',')) };
  }
  return { length: 4, list: sequences(BASE_AGENTS, 4).map((s) => s.join(',')) };
}

/**
 * The account's match list judged against a challenge, to FIND a proof: only
 * the list's word, so a pass here is a CANDIDATE the route confirms match by
 * match from Riot's own match records (identity never rests on the name).
 * 'passed' when the account's matches hold the sequence as CONSECUTIVE
 * matches of its history (no other match of it between), each started after
 * the challenge was issued, after `usedUntil` (the last proof's matches on
 * this Riot account) and before it expired.
 *
 * @param c        { agents: [..], issuedAt, expiresAt } (ms)
 * @param matches  [{ id, startedAt (ms), agent, puuid | null }], any order
 * @param o.puuid  the Riot account's puuid (lower case); a row that carries
 *                 another puuid is another account's
 * @param o.usedUntil, o.now
 * Returns { result, progress, picks } with result 'passed' (picks: the
 * matches, oldest first) | 'half' (the first `progress` agents done in a row,
 * the rest to play) | 'in-between' | 'wrong-agent' | 'not-yet' | 'expired' |
 * 'other-account'.
 */
function judge(c, matches, o = {}) {
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const me = String(o.puuid || '').toLowerCase();
  const seq = (Array.isArray(c.agents) ? c.agents : []).map((a) => agentOf(a));
  const k = seq.length;
  const all = (Array.isArray(matches) ? matches : []).filter((m) => m && Number.isFinite(m.startedAt))
    .sort((a, b) => a.startedAt - b.startedAt);
  if (all.some((m) => m.puuid && String(m.puuid).toLowerCase() !== me)) return { result: 'other-account', progress: 0, picks: [] };
  const floor = Math.max(c.issuedAt, Number.isFinite(o.usedUntil) ? o.usedUntil : -Infinity);
  const inside = (m) => m.startedAt > floor && m.startedAt < c.expiresAt;
  for (let i = 0; i + k <= all.length; i++) {
    const run = all.slice(i, i + k);
    if (run.every((m, j) => inside(m) && agentOf(m.agent) === seq[j])) return { result: 'passed', progress: k, picks: run };
  }
  if (now >= c.expiresAt) return { result: 'expired', progress: 0, picks: [] };
  const after = all.filter(inside);
  if (!after.length) return { result: 'not-yet', progress: 0, picks: [] };
  // How far into the sequence the newest matches are, in a row.
  for (let j = Math.min(k - 1, after.length); j >= 1; j--) {
    const tail = after.slice(after.length - j);
    if (tail.every((m, x) => agentOf(m.agent) === seq[x])) return { result: 'half', progress: j, picks: [] };
  }
  // Every agent of the sequence played in order, with others between.
  let at = 0;
  for (const m of after) if (at < k && agentOf(m.agent) === seq[at]) at++;
  if (at === k) return { result: 'in-between', progress: 0, picks: [] };
  return { result: 'wrong-agent', progress: 0, picks: [] };
}

// ── The store ──────────────────────────────────────────────────────────────

function failed(error, what) {
  const e = new Error(`${what}: ${(error && (error.message || error.code)) || 'failed'}`);
  if (callers.isMissing(error)) e.notLive = true;
  e.code = error && error.code;
  return e;
}

/**
 * social-001-profiles.sql's functions, one rpc each, through the service role.
 * Every method throws on an error, `notLive` set when the SQL has not run.
 * Every name and Riot ID goes in as its key and fold, made here.
 */
function createStore(supabase) {
  const db = () => (typeof supabase === 'function' ? supabase() : supabase);
  async function call(name, args) {
    const { data, error } = await db().rpc(name, args);
    if (error) throw failed(error, name);
    return data;
  }
  const C = CHALLENGE;
  const foldOf = (name) => fold(name).slice(0, 20);
  return {
    async status() {
      try { return (await call('social_status', {})) === true; } catch (e) { if (e.notLive) return false; throw e; }
    },
    me: (user) => call('social_me', { p_user: user }),
    nameFree: (user, name) => call('social_name_free', { p_user: user, p_key: keyOf(name), p_fold: foldOf(name), p_hold_days: HOLD_DAYS }),
    setUsername: (user, name) => call('social_set_username', { p_user: user, p_username: name, p_key: keyOf(name), p_fold: foldOf(name), p_change_days: CHANGE_DAYS, p_hold_days: HOLD_DAYS }),
    setFlags: (user, f) => call('social_set_flags', { p_user: user, p_public: f.public, p_show_riot_id: f.showRiotId, p_discoverable: f.discoverable }),
    putStats: (user, stats) => call('social_put_stats', { p_user: user, p_stats: stats, p_max: SNAPSHOT_MAX_BYTES * 2 }),
    view: (viewer, key) => call('social_view', { p_viewer: viewer, p_key: key, p_rank_ms: RANK_MS }),
    search: (viewer, q) => call('social_search', { p_viewer: viewer, p_mode: q.mode, p_key: q.key, p_limit: SEARCH_MAX }),
    block: (user, name, on) => call('social_block', { p_user: user, p_key: keyOf(name), p_name: name, p_on: !!on, p_max: BLOCK_MAX }),
    reportTarget: (viewer, key) => call('social_report_target', { p_viewer: viewer, p_key: key }),
    challengeAttempt: (user) => call('social_challenge_attempt', { p_user: user, p_day: C.PER_DAY, p_month: C.PER_MONTH }),
    challengeStart: (user, s) => call('social_challenge_start', { p_user: user, p_hash: s.hash, p_name: s.name, p_tag: s.tag, p_region: s.region,
      p_candidates: s.candidates, p_seed: s.seed, p_ttl_ms: C.TTL_MS }),
    challengeGet: (user) => call('social_challenge_get', { p_user: user }),
    challengeNoteCheck: (user) => call('social_challenge_note_check', { p_user: user, p_gap_ms: C.CHECK_GAP_MS, p_max: C.CHECKS }),
    challengeRefund: (user, id) => call('social_challenge_refund', { p_user: user, p_id: id }),
    challengeResult: (user, id, result, progress) => call('social_challenge_result', { p_user: user, p_id: id, p_result: result, p_progress: progress || 0 }),
    challengePass: (user, id, name, tag, first, last) => call('social_challenge_pass', { p_user: user, p_id: id, p_name: name, p_tag: tag,
      p_key: `${keyOf(name)}#${keyOf(tag)}`, p_first: new Date(first).toISOString(), p_last: new Date(last).toISOString() }),
    unverify: (key, hash) => call('social_unverify', { p_key: key, p_hash: hash }),
    noteGone: (key, hash) => call('social_note_gone', { p_key: key, p_hash: hash, p_min_ms: C.GONE_MS }),
    rankDue: (who) => call('social_rank_due', { p_user: who.user || null, p_key: who.key || null, p_rank_ms: RANK_MS }),
    setRank: (key, hash, current, peak) => call('social_set_rank', { p_key: key, p_hash: hash, p_current: current, p_peak: peak }),
  };
}

/** Whether the Riot ID proof is on: SOCIAL_RIOT_PROOF exactly '1'. Off by default. */
const riotProofOn = (env = process.env) => String((env && env.SOCIAL_RIOT_PROOF) || '') === '1';

module.exports = {
  USERNAME_MIN, USERNAME_MAX, CHANGE_DAYS, HOLD_DAYS, RANK_MS, SNAPSHOT_MAX_BYTES, SEARCH_MAX, SEARCH_MIN, BLOCK_MAX, STATUS_MS,
  CHALLENGE, BASE_AGENTS, RESERVED_LONG, RESERVED_SHORT, RESERVED_START, WORDS_ANYWHERE, WORDS_WHOLE, FOLD_PAIRS, FOLD_ONE,
  TITLES, LADDER, checkUsername, wordPattern, fold, forms, keyOf, letter, tierOf, cleanSnapshot, statsOut, meView,
  profileView, resultView, challengeView, rankFor, riotIdOf, queryOf, sequences, candidatesFor, judge, createStore, agentOf, mapOf,
  riotProofOn,
};
