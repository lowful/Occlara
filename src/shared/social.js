'use strict';

/**
 * PUBLIC PROFILES AND PLAYER SEARCH, the app's half (docs/claude/social.md).
 *
 * Pure: no Electron, no network, no file system, so test:social drives it.
 *
 *   the username rules   RULES, below, word for word server/services/
 *                        social.js's (src/ never requires server/, so
 *                        test:social holds the two blocks equal), for the
 *                        Profile page's instant answer as the player types;
 *                        the server checks again and decides
 *   snapshotOf(rows)     the stats snapshot the app uploads, from the year
 *                        record's rows and the rank of the Riot ID in
 *                        Settings: numbers, agents, maps and tiers, never a
 *                        mistake, a weakness, a name or a word from a review
 *   the words            every line the Profile section and the Players page
 *                        say, finished here so the pages count nothing
 */


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

const VERIFY_HOURS = 4;
const SEARCH_MIN = 3;
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

// ── The snapshot the app uploads ──────────────────────────────────────────

const TREND = 20;
const RECENT = 10;
const RESULT = { win: 'W', loss: 'L', draw: 'D' };
const counted = (r) => r.grade && Number.isFinite(r.grade.score) && !r.grade.provisional;

/** The top three of a field by matches (ties: the later played first), with wins for maps. */
function topOf(rows, field, withWins) {
  const m = new Map();
  for (const r of rows) {
    const v = r[field];
    if (typeof v !== 'string' || !v) continue;
    const t = m.get(v) || { name: v, n: 0, w: 0, last: 0 };
    t.n += 1;
    if (r.result === 'win') t.w += 1;
    t.last = Math.max(t.last, r.at);
    m.set(v, t);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 3)
    .map((t) => (withWins ? { name: t.name, n: t.n, w: t.w } : { name: t.name, n: t.n }));
}

/**
 * The stats snapshot of a player's own Valorant play, from the year record's
 * rows (any year), or null with no Valorant match. What it holds is all it
 * may hold: counts, the average of the counted grades and their last 20, K/D,
 * the headshot share, the three most played agents and maps, the multi kills
 * and clutches Riot's record proves, the last 10 (result, agent, map, grade),
 * Wrapped's title id, and the current and peak tier of the Riot ID in
 * Settings as the app's tracker profile holds it (opts.rank). Never a
 * mistake (Duos will share more between friends), never a name, never a
 * sentence. Every number is what the server's checks accept: an integer, the
 * record within the matches, the lists within the record.
 */
function snapshotOf(rows, opts = {}) {
  const v = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.game === 'valorant' && Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
  if (!v.length) return null;
  const wins = v.filter((r) => r.result === 'win').length;
  const losses = v.filter((r) => r.result === 'loss').length;
  const draws = v.filter((r) => r.result === 'draw').length;
  const graded = v.filter(counted);
  const grade = graded.length ? {
    avg: Math.max(0, Math.min(100, Math.round(graded.reduce((s, r) => s + r.grade.score, 0) / graded.length))),
    n: graded.length,
    trend: graded.slice(-TREND).map((r) => Math.max(0, Math.min(100, Math.round(r.grade.score)))),
  } : null;
  const withK = v.filter((r) => Number.isFinite(r.k) && Number.isFinite(r.d));
  const kills = withK.reduce((s, r) => s + r.k, 0);
  const deaths = withK.reduce((s, r) => s + r.d, 0);
  const kd = withK.length && deaths > 0 ? Math.min(20, Math.round((100 * kills) / deaths) / 100) : null;
  const withHs = v.filter((r) => Number.isFinite(r.hs));
  const hs = withHs.length ? Math.max(0, Math.min(100, Math.round(withHs.reduce((s, r) => s + r.hs, 0) / withHs.length))) : null;
  const multi = { k2: 0, k3: 0, k4: 0, k5: 0 };
  let clutches = 0;
  for (const r of v) {
    const m = r.multi && typeof r.multi === 'object' ? r.multi : {};
    for (const k of [2, 3, 4, 5]) multi[`k${k}`] += Number.isInteger(m[k]) && m[k] > 0 ? m[k] : 0;
    clutches += Number.isInteger(r.clutches) && r.clutches > 0 ? r.clutches : 0;
  }
  const recent = v.slice().reverse().filter((r) => RESULT[r.result]).slice(0, RECENT).map((r) => {
    const out = { r: RESULT[r.result], agent: r.agent || null, map: r.map || null };
    if (counted(r)) out.grade = Math.max(0, Math.min(100, Math.round(r.grade.score)));
    return out;
  });
  const rk = opts.rank && typeof opts.rank === 'object' ? { current: tierOf(opts.rank.current), peak: tierOf(opts.rank.peak) } : null;
  return {
    v: 1, matches: v.length, wins, losses, draws, grade, kd, hs,
    agents: topOf(v, 'agent', false), maps: topOf(v, 'map', true),
    multi, clutches, recent,
    title: typeof opts.title === 'string' ? opts.title : null,
    rank: rk && (rk.current || rk.peak) ? rk : null,
  };
}

// ── The words ─────────────────────────────────────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
const dayText = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** What the username field says for a check's reason. */
function nameLine(reason, opts = {}) {
  switch (reason) {
    case 'free': return 'Available.';
    case 'yours': return 'This is your username.';
    case 'shape': return `Use only letters, digits and underscores, ${USERNAME_MIN} to ${USERNAME_MAX} of them.`;
    case 'digits': return 'Use at least one letter.';
    case 'reserved': return 'That name is kept for Occlara and Riot, or looks like one. Pick another.';
    case 'word': return 'That name is not allowed. Pick another.';
    case 'taken': return 'That username is taken.';
    case 'held': return `That username was given up recently. It is free again after ${HOLD_DAYS} days.`;
    case 'too-soon': {
      const d = dayText(opts.nextAt);
      return d ? `You can change your username again on ${d}.` : `A username can change once every ${CHANGE_DAYS} days.`;
    }
    case 'set': case 'same': case 'case': return 'Saved.';
    case 'offline': return 'Could not check right now. Try again in a moment.';
    default: return 'That username cannot be used.';
  }
}

const riotText = (id) => (id && id.name && id.tag ? `${id.name}#${id.tag}` : null);

const WHY_PROVE = 'This proves the Riot ID is yours, so nobody else can show it.';

/** The Riot ID line of the player's own profile, from /me's riot. */
function riotLine(riot) {
  const r = riot || {};
  if (r.state === 'verified') return `${riotText(r.riotId)} is verified. It shows on your profile and can be found by search, unless you turn it off here.`;
  if (r.state === 'lost') {
    if (r.lost === 'takeover') return 'Another Occlara account proved control of the Riot ID your profile showed, so it no longer shows on yours. If it is yours, prove it again below.';
    if (r.lost === 'renamed') return 'The Riot ID your profile showed now belongs to another Riot account, or was renamed, so it no longer shows. Prove your current Riot ID below.';
    return 'The Riot ID your profile showed can no longer be found, so it no longer shows. Prove your current Riot ID below.';
  }
  return `Your profile shows no Riot ID yet. Prove one: play three or four agents we name, back to back, on it. ${WHY_PROVE}`;
}

/** Time left as words: "2 h 41 min left". */
function timeLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'Time is up';
  const min = Math.ceil(ms / 60000);
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min left` : `${min} min left`;
}

const WORDS_N = ['', 'one', 'two', 'three', 'four'];
const listText = (xs) => (xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and then ${xs[xs.length - 1]}`);

/** The steps of a challenge, for its panel: three or four agents, in order. */
function challengeSteps(c) {
  const agents = c && Array.isArray(c.agents) ? c.agents.filter(Boolean) : [];
  const n = agents.length;
  return {
    plan: `Play ${WORDS_N[n] || n} matches in a row on ${riotText(c && c.riot) || 'this account'}, as ${listText(agents)}, in that order. Deathmatch is the quickest. Then press Check.`,
    steps: agents.map((a, i) => (i === 0 ? `First match as ${a}` : `Then as ${a}`)),
    note: `No other match between them, all within ${VERIFY_HOURS} hours of starting. Matches reach Riot's record a few minutes after they end.`,
  };
}

/** What a start or a check said, as one line. */
function challengeLine(result, c) {
  const agents = c && Array.isArray(c.agents) && c.agents.length ? c.agents : ['the agents named'];
  const done = c && Number.isInteger(c.progress) ? c.progress : 0;
  switch (result) {
    case 'passed': return `Verified. ${riotText(c && c.riot) || 'Your Riot ID'} now shows on your profile.`;
    case 'not-yet': return 'No match since you started yet. Matches reach Riot\'s record a few minutes after they end, so check again shortly.';
    case 'half': return done > 0 && done < agents.length
      ? `${listText(agents.slice(0, done))} ${done === 1 ? 'is' : 'are'} in. Now play ${listText(agents.slice(done))}, then check again.`
      : 'Part of the sequence is in. Play the rest in order, then check again.';
    case 'wrong-agent': return `Your matches since you started were not ${listText(agents)} in that order. Play them in that order, back to back.`;
    case 'in-between': return `Another match came between them. Play ${listText(agents)} back to back, with nothing between.`;
    case 'used': return 'Those matches were already used to prove this Riot ID. Play the sequence again, then check.';
    case 'expired': return `This check ran out of time. Start a new one: you have ${VERIFY_HOURS} hours each time.`;
    case 'other-account': return 'Those matches were not played on this Riot account, or the Riot ID now leads to another Riot account. Start again with your current Riot ID.';
    case 'too-soon': return 'Wait a minute between checks.';
    case 'too-many': return 'This check was tried too many times. Start a new one.';
    case 'try-later': return 'Riot\'s record could not be read just now. Try again in a few minutes.';
    case 'day': return 'You can start 2 checks a day. Try again tomorrow.';
    case 'month': return 'You have started 6 checks in the last 30 days. Try again later.';
    case 'riot-id': return 'Type the Riot ID as Name#TAG.';
    case 'riot-not-found': return 'Riot has no account with that Riot ID. Check the name and the tag after #.';
    case 'no-username': return 'Pick a username first.';
    case 'none': return 'There is no check to run. Start one first.';
    case 'not-available': return 'Showing a Riot ID is not open yet.';
    case 'offline': return 'Could not reach Occlara. Check your connection and try again.';
    default: return 'Something went wrong. Try again in a moment.';
  }
}

/** What others see, said in plain words for the public switch (the Riot ID only while the proof is open). */
const PUBLIC_EXPLAIN = 'Signed in Occlara players can find you by your username, and by your whole Riot ID once you prove it is yours.';
const PUBLIC_EXPLAIN_NAME = 'Signed in Occlara players can find you by your username.';
const PUBLIC_MORE = 'They see your rank, your average grade, your record, K/D and headshots, your main agents and maps, your last 10 matches, multi kills, clutches and your Wrapped title. Never your mistakes, your reviews, your clips or your email. Turned off, your profile leaves search at once and its numbers are deleted from the server.';
// Discoverable, said by what it does (docs/claude/duos.md): with Duos open,
// what a teammate sees; with it off, no word of Duos at all.
const DISCOVER_EXPLAIN = 'After a match you played on one team, a teammate who also uses Occlara and turned this on too sees your username and the agent you played, and you see theirs, so either of you can invite the other to a duo. Never an opponent, never anyone else, never your Riot ID. It does not let anyone invite you by typing your username: that reaches public profiles only.';
const DISCOVER_EXPLAIN_OFF = 'Lets teammates who also use Occlara find you after a match you played together, once that opens. Nothing is shared yet.';
const FROM_PC = "These are Occlara's numbers from this player's own PC, from the matches they reviewed.";
const FROM_MY_PC = "These are Occlara's numbers from your own PC, from the matches you reviewed. They update when you save a review.";
const RANK_LABEL = { verified: 'Verified', pc: "From this player's PC" };

/** "12 W, 9 L" with draws only when there are some. */
function recordLine(s) {
  if (!s) return null;
  const parts = [`${s.wins} W`, `${s.losses} L`];
  if (s.draws) parts.push(`${s.draws} D`);
  return parts.join(', ');
}

/**
 * The profile view's model, from /profile's profile: every line the Players
 * page paints, and what it may draw (agent and map names the art is looked
 * up by). The rank is one of two, never both: the server's for a verified
 * profile ("Verified"), else the one the player's app sent ("From this
 * player's PC"). Null for nothing.
 */
function profileModel(p) {
  if (!p || typeof p.username !== 'string') return null;
  const s = p.stats || null;
  const g = s && s.grade ? s.grade : null;
  const rk = p.rank && (p.rank.current || p.rank.peak) ? p.rank : null;
  return {
    username: p.username,
    self: p.self === true,
    privateNote: p.self && !p.public ? 'Only you can see this. Your profile is private.' : null,
    riot: riotText(p.riot),
    riotNote: p.riot ? 'Verified' : p.verified ? null : 'No Riot ID shown',
    rank: rk ? { current: rk.current || 'Unranked', peak: rk.peak || null, label: RANK_LABEL[rk.source] || RANK_LABEL.pc } : null,
    grade: g ? { avg: String(g.avg), sample: `over ${plural(g.n, 'graded match', 'graded matches')}`, trend: Array.isArray(g.trend) ? g.trend : [] } : null,
    matches: s ? plural(s.matches, 'match reviewed', 'matches reviewed') : null,
    record: s ? recordLine(s) : null,
    kd: s && Number.isFinite(s.kd) ? s.kd.toFixed(2) : null,
    hs: s && Number.isFinite(s.hs) ? `${s.hs}%` : null,
    agents: s ? s.agents.map((a) => ({ name: a.name, line: plural(a.n, 'match', 'matches') })) : [],
    maps: s ? s.maps.map((m) => ({ name: m.name, line: `${plural(m.n, 'match', 'matches')}, ${m.w} won` })) : [],
    multi: s ? [['2K', s.multi.k2], ['3K', s.multi.k3], ['4K', s.multi.k4], ['Ace', s.multi.k5], ['Clutches won', s.clutches]]
      .map(([label, n]) => ({ label, n: String(n) })) : [],
    recent: s ? s.recent.map((r) => ({ r: r.r, word: r.r === 'W' ? 'Win' : r.r === 'L' ? 'Loss' : 'Draw', agent: r.agent, map: r.map,
      grade: Number.isFinite(r.grade) ? String(r.grade) : null })) : [],
    title: s && s.title ? s.title.name : null,
    empty: !s ? (p.self ? 'Your numbers upload when your profile is public and you save a review.' : 'No numbers yet. They show once this player saves a review with their profile public.') : null,
    fromPc: s ? (p.self ? FROM_MY_PC : FROM_PC) : null,
    updated: p.statsAt ? `Updated ${dayText(p.statsAt)}` : null,
  };
}

/** One search result's lines. */
function resultModel(r) {
  if (!r || typeof r.username !== 'string') return null;
  const rank = r.rank && r.rank.tier ? `${r.rank.tier}${r.rank.source === 'verified' ? '' : ' (own PC)'}` : null;
  const bits = [rank, r.agent, r.grade ? `grade ${r.grade.avg}` : null].filter(Boolean);
  return { username: r.username, riot: riotText(r.riot), line: bits.join(', ') || 'No numbers yet', agent: r.agent || null };
}

/**
 * What the search box may send, the same reading as the server's (social.js
 * queryOf), as a yes or no: a whole Riot ID as Name#TAG, or the start of a
 * username, 3 letters, digits or underscores at least.
 */
function searchable(q) {
  const s = typeof q === 'string' ? q.trim() : '';
  if (!s || s.length > 40) return false;
  if (s.includes('#')) {
    const t = s.replace(/\s+/g, ' ');
    const hash = t.indexOf('#');
    if (hash < 1 || t.indexOf('#', hash + 1) >= 0) return false;
    return /^[\p{L}\p{N} ._-]{1,24}$/u.test(t.slice(0, hash).trim()) && /^[\p{L}\p{N}]{2,8}$/u.test(t.slice(hash + 1).trim());
  }
  return new RegExp(`^[A-Za-z0-9_]{${SEARCH_MIN},20}$`).test(s);
}

module.exports = {
  USERNAME_MIN, USERNAME_MAX, CHANGE_DAYS, HOLD_DAYS, VERIFY_HOURS, SEARCH_MIN,
  RESERVED_LONG, RESERVED_SHORT, RESERVED_START, WORDS_ANYWHERE, WORDS_WHOLE, FOLD_PAIRS, FOLD_ONE,
  checkUsername, wordPattern, fold, forms, keyOf, tierOf, snapshotOf, nameLine, riotLine, riotText, timeLeft, challengeSteps,
  challengeLine, profileModel, resultModel, recordLine, searchable,
  PUBLIC_EXPLAIN, PUBLIC_EXPLAIN_NAME, PUBLIC_MORE, DISCOVER_EXPLAIN, DISCOVER_EXPLAIN_OFF, FROM_PC, FROM_MY_PC, WHY_PROVE, RANK_LABEL,
};
