'use strict';

/**
 * OCCLARA WRAPPED (docs/claude/wrapped.md): the player's year, told as a short
 * animated story at the end of it.
 *
 * Pure, no Electron and no file system, so scripts/test-wrapped.js runs every
 * number Wrapped shows on a fixture year. Three halves:
 *
 *   rowOf(...)    one saved review as the year record's compact row
 *                 (services/year-record.js keeps them, never trimmed)
 *   story(...)    a year's rows as the story's slides, every figure on them
 *   the calendar  when a year's Wrapped is offered (15 December to 31
 *                 January, local time), and whether it may open by itself
 *
 * NOTHING IS INVENTED. A slide whose number cannot be computed honestly is
 * left out, a small sample says so on the slide, and an "improvement" needs
 * enough matches on both sides of it. A row holds numbers, agents, maps and
 * weapons only: never another player's name or Riot ID and never the
 * player's own (a string with '#' in it is never kept), and the killers are
 * agents the game data knows, nothing else.
 *
 * ONE GAME'S DATA STAYS UNDER ITS OWN NAME (games.md). Valorant and League
 * are counted apart: the Valorant slides read Valorant rows alone, and League
 * gets its own slide, named, only with enough League matches of its own.
 */

const valorantData = require('./valorant-data.generated.json');
const kitIndex = require('./valorant-kit-icons.generated.json');
const champions = require('./lol-champions');
const { repeatTitle } = require('./insights');
const { cardSatOut } = require('./sat-out');

const SCHEMA = 1;
// THE MINIMUM FOR A YEAR (docs/claude/wrapped.md): five reviewed matches of a
// game is the least that names a main agent, a time worth adding up and a best
// match worth framing; under it there is no story, only a list. The slides
// that need more ask for more on their own (MIN_GRADED, MIN_RECORDED, SIDE).
const MIN_MATCHES = 5;
// The first year Wrapped is offered (it shipped in late 2026).
const FIRST_YEAR = 2026;
// The grade journey needs this many counted grades, and a month this many to be a "best month".
const MIN_GRADED = 5;
const MONTH_MIN = 3;
// A mistake beaten or still to beat is read over the recorded matches, early
// half against late half, with at least SIDE matches on each side.
const SIDE = 5;
const MIN_RECORDED = SIDE * 2;
// A climb compares the first third of the graded matches with the last third, SIDE each at least.
const CLIMB_MIN = 4;
/** The bands a year's grades are counted in, by their numbers (one score, no letters, 9.1): [label, from, below]. */
const BANDS = [['90 and up', 90, 101], ['80s', 80, 90], ['70s', 70, 80], ['60s', 60, 70], ['Under 60', 0, 60]];
// A round is about 100 seconds (home-model.js puts a match back from its end by it).
const SECONDS_A_ROUND = 100;
const MAX_MINUTES = 240;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The mistake keys whose title is built from the match (insights.js: "Dying at
// <place>", "<agent> kept winning"): stored by key and count alone.
const MATCH_TEXT_KEYS = new Set(['same-spot', 'same-killer']);

// ── What a row may hold ─────────────────────────────────────────────────────

const key = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const AGENTS = new Map(Object.keys(valorantData.agents || {}).map((n) => [key(n), n]));
const MAPS = new Map((valorantData.maps || []).map((n) => [key(n), n]));
const WEAPONS = new Map(Object.keys((kitIndex && kitIndex.weapons) || {}).map((n) => [key(n), n]));

/** Text a row may keep: a short string with no '#', or null. */
function safe(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t || t.includes('#') || t.includes('@')) return null;
  return t.slice(0, max || 40);
}
/** An agent the game data knows, by its own spelling, or null. */
function agentOf(name) { const s = safe(name); return s ? AGENTS.get(key(s)) || null : null; }
function mapOf(name) { const s = safe(name); return s ? MAPS.get(key(s)) || null : null; }
function weaponOf(name) { const s = safe(name); return s ? WEAPONS.get(key(s)) || null : null; }
function championOf(name) {
  const s = safe(name);
  if (!s) return null;
  try { const c = champions.champion(s); return c && typeof c.name === 'string' ? c.name : null; } catch { return null; }
}

const int = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(max || 1e6, Math.round(v)) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function resultOf(s) {
  const t = String(s || '').toLowerCase();
  if (/victory|\bwin\b|\bwon\b/.test(t)) return 'win';
  if (/defeat|\bloss\b|\blost\b/.test(t)) return 'loss';
  if (/draw|\btie\b/.test(t)) return 'draw';
  return null;
}

/** "13-11" as [13, 11], or null. */
function scoreOf(s) {
  const m = /^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** A rank point's tier and RR as the row keeps them, or null. */
function rankOf(r) {
  if (!r || typeof r !== 'object') return null;
  const tier = typeof r.tier === 'string' && /^[A-Za-z]{3,12}( [1-3])?$/.test(r.tier.trim()) ? r.tier.trim() : null;
  if (!tier || /^unrated$/i.test(tier)) return null;
  return { tier, elo: int(r.elo, 100000) };
}

/** How long the match ran, in minutes, and what says so. */
function minutesOf(review, at, rounds) {
  const l = review.ledger || {};
  const inRange = (ms) => Number.isFinite(ms) && ms > 60000 && ms < MAX_MINUTES * 60000;
  if (inRange(l.endedAt - l.startedAt)) return { minutes: Math.round((l.endedAt - l.startedAt) / 60000), by: 'ledger' };
  const start = num(review.matchStartedAt);
  if (start && inRange(at - start)) return { minutes: Math.round((at - start) / 60000), by: 'riot' };
  if (rounds > 0) return { minutes: Math.round((rounds * SECONDS_A_ROUND) / 60), by: 'estimate' };
  return { minutes: null, by: null };
}

const HL_CLIP = /^h\d{1,2}-clip\.mkv$/;
const DEATH_CLIP = /^[rd]\d{1,3}-clip\.mkv$/;
const satOut = (c) => cardSatOut(c);

/** A Valorant review's rounds: kills, clutches, first fights, weapons, killers and clips. */
function valorantRounds(review) {
  const cards = (Array.isArray(review.rounds) ? review.rounds : []).filter((c) => c && Number.isInteger(c.n));
  const out = { riotRounds: 0, multi: { 2: 0, 3: 0, 4: 0, 5: 0 }, clutches: 0, clutchBest: 0, fk: 0, fd: 0,
    weapons: {}, killedBy: {}, highlights: [], deathClips: [], highlightClips: [] };
  for (const c of cards) {
    const r = c.riot;
    if (c.forensics && typeof c.forensics.clip === 'string' && DEATH_CLIP.test(c.forensics.clip) && out.deathClips.length < 16) out.deathClips.push(c.forensics.clip);
    const hClip = c.highlight && typeof c.highlight.clip === 'string' && HL_CLIP.test(c.highlight.clip) ? c.highlight.clip : null;
    if (hClip && out.highlightClips.length < 16) out.highlightClips.push(hClip);
    if (!r || typeof r !== 'object') continue;
    out.riotRounds += 1;
    const k = int(r.kills, 9) || 0;
    if (k >= 2) out.multi[Math.min(5, k)] += 1;
    const won = r.clutch && r.clutch.won === true && Number.isFinite(r.clutch.vs) ? Math.max(1, Math.min(5, Math.round(r.clutch.vs))) : 0;
    if (won) { out.clutches += 1; out.clutchBest = Math.max(out.clutchBest, won); }
    if (r.firstKill === true) out.fk += 1;
    if (r.firstDeath === true && !satOut(c)) out.fd += 1;
    for (const f of Array.isArray(r.feed) ? r.feed : []) {
      if (!f || f.by !== 'me') continue;
      const w = weaponOf(f.w);
      if (w) out.weapons[w] = (out.weapons[w] || 0) + 1;
    }
    if (c.died && !satOut(c)) {
      const a = agentOf(r.killer);
      if (a) out.killedBy[a] = (out.killedBy[a] || 0) + 1;
    }
    if ((k >= 2 || won) && out.highlights.length < 12) {
      out.highlights.push({ r: c.n, k, cv: won, clip: hClip });
    }
  }
  return out;
}

/**
 * One saved review as its year record row, or null for one that is no match
 * to count (no result and no grade: a recording begun and abandoned).
 *
 * @param id      the review's id
 * @param game    'valorant' | 'lol'
 * @param at      when the match ended (the library's `at`)
 * @param review  the saved review
 * @param extra.rank  the rank history's point for its Riot match, if one is known
 */
function rowOf(id, game, at, review, extra) {
  const r = review && typeof review === 'object' ? review : null;
  if (!r || typeof id !== 'string' || !/^[a-z]+-\d{10,}-[a-z0-9]{4,}$/.test(id)) return null;
  const g = game === 'lol' || r.kind === 'lol' ? 'lol' : game === 'valorant' || r.kind === 'valorant' ? 'valorant' : null;
  if (!g || !Number.isFinite(at)) return null;
  const info = r.game || {};
  const result = resultOf(info.result);
  const grade = r.grade && Number.isFinite(r.grade.score)
    ? { score: Math.round(r.grade.score), provisional: !!r.grade.provisional } : null;
  if (!result && !grade) return null;
  const sl = r.scoreline || {};
  const source = r.imported === true ? 'import' : r.source === 'riot' ? 'riot' : 'watched';
  const flags = r.deathFlags && typeof r.deathFlags === 'object'
    ? ['rounds', 'unmatched', 'over'].reduce((n, k) => n + (Array.isArray(r.deathFlags[k]) ? r.deathFlags[k].length : 0), 0) : 0;
  const base = {
    v: SCHEMA, id, game: g, at: Math.round(at), source, result,
    mode: safe(info.mode, 24), grade,
    k: int(sl.kills, 999), d: int(sl.deaths, 999), a: int(sl.assists, 999),
    ...(flags ? { flags } : {}),
  };
  if (g === 'lol') {
    const dur = int(info.durationSec, 6 * 3600);
    return {
      ...base, champion: championOf(info.champion), role: safe(info.role, 16), cs: int(sl.cs, 2000),
      minutes: dur ? Math.round(dur / 60) : null, minutesBy: dur ? 'game' : null,
      deathClips: (Array.isArray(r.deathList) ? r.deathList : []).map((x) => x && x.clip).filter((c) => typeof c === 'string' && DEATH_CLIP.test(c)).slice(0, 16),
    };
  }
  const score = scoreOf(info.score);
  const rd = valorantRounds(r);
  const rounds = score ? score[0] + score[1] : (Array.isArray(r.rounds) ? r.rounds.filter((c) => c && Number.isInteger(c.n)).length : 0);
  const time = minutesOf(r, at, rounds);
  // The counted mistakes of a recorded match: key, count, and the list's own
  // title (a fixed phrase with at most an agent or a place in it). A match
  // graded from Riot's record alone has none to count (insights.countable).
  const mistakes = source === 'riot' ? null : (r.insights && Array.isArray(r.insights.mistakes) ? r.insights.mistakes : [])
    .filter((m) => m && typeof m.key === 'string' && /^[a-z][a-z0-9:-]{1,40}$/.test(m.key))
    .slice(0, 12)
    .map((m) => ({ key: m.key, n: int(m.count, 99) || (Array.isArray(m.rounds) ? m.rounds.length : 1),
      // A title built from the match's own text (an agent, a place) is never
      // kept: the page names those keys by their general title (mistakeTitle).
      ...(MATCH_TEXT_KEYS.has(m.key) ? {} : { title: safe(m.title, 60) }) }));
  const rank = rankOf(extra && extra.rank);
  return {
    ...base,
    map: mapOf(info.map), agent: agentOf(info.agent),
    team: score ? score[0] : null, enemy: score ? score[1] : null, rounds: rounds || null,
    acs: int(sl.acs, 1000), adr: int(sl.adr, 1000), hs: int(sl.headshotPct, 100),
    minutes: time.minutes, minutesBy: time.by,
    riotRounds: rd.riotRounds, multi: rd.multi, clutches: rd.clutches, clutchBest: rd.clutchBest,
    fk: rd.fk, fd: rd.fd, weapons: rd.weapons, killedBy: rd.killedBy,
    mistakes, highlights: rd.highlights, highlightClips: rd.highlightClips, deathClips: rd.deathClips,
    ...(rank ? { rank } : {}),
    matchStartedAt: num(r.matchStartedAt),
    // Riot's id for the match (a uuid, no name in it), so a rank the history
    // learns later is laid on its row (year-record.js fillRanks).
    matchId: typeof r.matchId === 'string' && /^[0-9a-f-]{16,64}$/i.test(r.matchId) ? r.matchId : null,
  };
}

/** A row as the record reads it back: one of the shape rowOf writes, or null. */
function cleanRow(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !Number.isFinite(x.at)) return null;
  if (x.game !== 'valorant' && x.game !== 'lol') return null;
  return x;
}

// ── The calendar ────────────────────────────────────────────────────────────

/** When year Y's Wrapped is offered, local time: 15 December Y to the end of 31 January Y + 1. */
function windowOf(year) {
  return { from: new Date(year, 11, 15).getTime(), to: new Date(year + 1, 1, 1).getTime() };
}

/** The year whose Wrapped is offered at `now`, or null outside every window. */
function yearOpenAt(now) {
  const d = new Date(now);
  if (d.getMonth() === 11 && d.getDate() >= 15) return d.getFullYear();
  if (d.getMonth() === 0) return d.getFullYear() - 1;
  return null;
}

/** The newest year whose Wrapped has been offered by `now` (its window begun), open or past. */
function latestYear(now) {
  const d = new Date(now);
  return d.getMonth() === 11 && d.getDate() >= 15 ? d.getFullYear() : d.getFullYear() - 1;
}

/** The local year a row's match ended in. */
const yearOfAt = (at) => new Date(at).getFullYear();

/** Whether the rows give a story: MIN_MATCHES of either game. */
function countsOf(rows) {
  const v = rows.filter((r) => r.game === 'valorant').length;
  const l = rows.filter((r) => r.game === 'lol').length;
  return { valorant: v, lol: l, all: v + l, enough: v >= MIN_MATCHES || l >= MIN_MATCHES };
}

/**
 * Whether year's Wrapped opens by itself now: ONCE, inside its window, with
 * enough matches, and only when nothing else forbids it (main decides the
 * window shown, no match live, no seal, onboarding done: `free`).
 * @param o.now     the clock
 * @param o.rows    every row of the record (any year)
 * @param o.opened  { [year]: when it opened by itself } from the store
 * @param o.free    main's word that the window may show it now
 */
function autoOpenYear(o) {
  const year = yearOpenAt(o.now);
  if (year === null || !o.free) return null;
  const opened = o.opened && typeof o.opened === 'object' ? o.opened : {};
  if (opened[year]) return null;
  const rows = (Array.isArray(o.rows) ? o.rows : []).filter((r) => r && yearOfAt(r.at) === year);
  return countsOf(rows).enough ? year : null;
}

/**
 * What Home and Profile say about Wrapped: the year, whether it is in its
 * window (`open`), whether it has enough (`enough`), and the words. Null when
 * there is nothing to say (no window begun with any match in it).
 */
function entryOf(o) {
  const now = o.now;
  const open = yearOpenAt(now);
  const year = open !== null ? open : latestYear(now);
  // After its window a year is offered again only if it ever was offered:
  // from FIRST_YEAR, Wrapped's first, on, or a year the player had open. A
  // 2025 rebuilt from whatever reviews the cap left was never one.
  const opened = o.opened && typeof o.opened === 'object' ? o.opened : {};
  if (open === null && year < FIRST_YEAR && !opened[year]) return null;
  const rows = (Array.isArray(o.rows) ? o.rows : []).filter((r) => r && yearOfAt(r.at) === year);
  const c = countsOf(rows);
  if (open === null && !c.enough) return null;
  if (!c.enough) {
    const have = Math.max(c.valorant, c.lol);
    return { year, open: open !== null, enough: false, count: have, min: MIN_MATCHES,
      line: `Your ${year} Wrapped needs ${MIN_MATCHES} reviewed matches of one game. You have ${have} so far.`, button: null };
  }
  return { year, open: open !== null, enough: true, count: c.all, min: MIN_MATCHES,
    line: open !== null ? `Your ${year} in Occlara is ready: ${c.all} ${c.all === 1 ? 'match' : 'matches'} reviewed.` : `Your ${year} in Occlara, ${c.all} matches reviewed.`,
    button: open !== null ? `Play your ${year} Wrapped` : `Play ${year} again` };
}

// ── The story ───────────────────────────────────────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);
const round1 = (x) => Math.round(x * 10) / 10;
const dayKey = (at) => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayText = (at) => { const d = new Date(at); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

/** Counts of a field over rows, with wins, most first, ties to the newest. */
function tallyBy(rows, field) {
  const m = new Map();
  for (const r of rows) {
    const v = r[field];
    if (!v) continue;
    const t = m.get(v) || { name: v, matches: 0, wins: 0, decided: 0, last: 0 };
    t.matches += 1;
    if (r.result === 'win') t.wins += 1;
    if (r.result === 'win' || r.result === 'loss') t.decided += 1;
    t.last = Math.max(t.last, r.at);
    m.set(v, t);
  }
  return [...m.values()].map((t) => ({ ...t, winRate: t.decided >= 3 ? pct(t.wins, t.decided) : null }))
    .sort((a, b) => b.matches - a.matches || b.last - a.last || (a.name < b.name ? -1 : 1));
}

/** Sum of a { name: count } field over rows, most first. */
function mergeCounts(rows, field) {
  const m = new Map();
  for (const r of rows) for (const [k, n] of Object.entries(r[field] || {})) if (Number.isFinite(n) && n > 0) m.set(k, (m.get(k) || 0) + n);
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
}

/** The title a mistake key goes by across a year: the general one, never one match's own agent or place. */
function mistakeTitle(k, newest) {
  try { return repeatTitle(k, [], { title: newest || k }, new Set(['a', 'b'])).title || newest || null; } catch { return newest || null; }
}

/** Time: the matches, the hours, the days, the busiest month and day. */
function timeOf(rows) {
  const timed = rows.filter((r) => Number.isFinite(r.minutes));
  const minutes = sum(timed.map((r) => r.minutes));
  const estimated = timed.filter((r) => r.minutesBy === 'estimate').length;
  const months = Array.from({ length: 12 }, () => 0);
  for (const r of rows) months[new Date(r.at).getMonth()] += 1;
  const days = new Map();
  for (const r of rows) { const k = dayKey(r.at); const t = days.get(k) || { n: 0, at: r.at }; t.n += 1; days.set(k, t); }
  const busiestMonth = months.reduce((b, n, i) => (n > months[b] ? i : b), 0);
  const top = [...days.values()].sort((a, b) => b.n - a.n || a.at - b.at)[0];
  return {
    matches: rows.length,
    minutes,
    hours: minutes >= 600 ? Math.round(minutes / 60) : round1(minutes / 60),
    estimated, timed: timed.length,
    days: days.size,
    months,
    busiestMonth: months[busiestMonth] > 0 ? { month: busiestMonth, name: MONTHS[busiestMonth], matches: months[busiestMonth] } : null,
    busiestDay: top && top.n >= 2 ? { text: dayText(top.at), matches: top.n } : null,
  };
}

/** The grade journey: counted grades by month, the best month, the climb. */
function gradesOf(rows) {
  const graded = rows.filter((r) => r.grade && Number.isFinite(r.grade.score) && !r.grade.provisional).sort((a, b) => a.at - b.at);
  if (graded.length < MIN_GRADED) return null;
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const r of graded) byMonth[new Date(r.at).getMonth()].push(r.grade.score);
  const months = byMonth.map((xs, i) => (xs.length ? { month: i, name: MONTHS[i], avg: Math.round(sum(xs) / xs.length), n: xs.length } : null));
  const eligible = months.filter((m) => m && m.n >= MONTH_MIN);
  const bestMonth = eligible.length >= 2 ? eligible.slice().sort((a, b) => b.avg - a.avg || b.n - a.n)[0] : null;
  const third = Math.floor(graded.length / 3);
  let climb = null;
  if (third >= CLIMB_MIN) {
    const early = graded.slice(0, third).map((r) => r.grade.score);
    const late = graded.slice(-third).map((r) => r.grade.score);
    const from = Math.round(sum(early) / early.length);
    const to = Math.round(sum(late) / late.length);
    climb = { from, to, by: to - from, each: third };
  }
  // ONE SCORE, NO LETTERS (9.1): the year's grades counted by the band each
  // fell in, named by its numbers, never a letter.
  const bands = BANDS.map(([label, lo, hi]) => ({ label, n: graded.filter((r) => r.grade.score >= lo && r.grade.score < hi).length }));
  return {
    count: graded.length,
    avg: Math.round(sum(graded.map((r) => r.grade.score)) / graded.length),
    months, bestMonth, climb, bands,
    points: graded.map((r) => ({ at: r.at, score: r.grade.score })),
    small: graded.length < 12,
  };
}

/** The highlight of a row worth playing: an ace, a 4K, a 3K, a clutch won, a 2K, by that order. */
const hlRank = (h) => (h.k >= 5 ? 50 : h.k === 4 ? 40 : h.k === 3 ? 30 : 0) + (h.cv ? 10 + h.cv : 0) + (h.k === 2 ? 5 : 0);
const hlTitle = (h) => (h.k >= 5 ? 'An ace' : h.k >= 2 ? `A ${h.k}K` : `A 1v${h.cv} clutch`);

/**
 * The best clip of a set of rows: the highest highlight with a clip `has`
 * says is still on disk, the newest of equals. Null with none.
 */
function bestClip(rows, has) {
  let best = null;
  for (const r of rows) {
    for (const h of r.highlights || []) {
      if (!h.clip || !has(r.id, h.clip)) continue;
      const score = hlRank(h);
      if (!best || score > best.score || (score === best.score && r.at > best.at)) {
        best = { score, at: r.at, id: r.id, clip: h.clip, round: h.r, title: hlTitle(h), map: r.map, agent: r.agent };
      }
    }
  }
  return best ? { id: best.id, clip: best.clip, round: best.round, title: best.title, map: best.map, agent: best.agent, at: best.at } : null;
}

/** The match of the year: the highest counted grade, the newest of equals. */
function bestMatchOf(rows, has) {
  const graded = rows.filter((r) => r.grade && Number.isFinite(r.grade.score) && !r.grade.provisional);
  if (!graded.length) return null;
  const r = graded.slice().sort((a, b) => b.grade.score - a.grade.score || b.at - a.at)[0];
  const clip = bestClip([r], has);
  return {
    id: r.id, at: r.at, day: dayText(r.at), map: r.map, agent: r.agent, mode: r.mode,
    result: r.result, team: r.team, enemy: r.enemy, k: r.k, d: r.d, a: r.a, acs: r.acs,
    grade: r.grade, clip,
  };
}

/** Highlights: the multi kills by size and the clutches won, and the clip to play. */
function highlightsOf(rows, has) {
  const multi = { 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) for (const k of [2, 3, 4, 5]) multi[k] += (r.multi && Number.isFinite(r.multi[k]) ? r.multi[k] : 0);
  const clutches = sum(rows.map((r) => r.clutches || 0));
  const clutchBest = rows.reduce((b, r) => Math.max(b, r.clutchBest || 0), 0);
  const big = multi[3] + multi[4] + multi[5] + clutches;
  if (!big) return null;
  return { multi, threeK: multi[3], fourK: multi[4], aces: multi[5], twoK: multi[2], clutches, clutchBest, clip: bestClip(rows, has),
    riotMatches: rows.filter((r) => r.riotRounds > 0).length };
}

/**
 * The mistake beaten and the one still to beat: each key's share of the
 * recorded matches it showed in, the early half of the year's against the
 * late half, SIDE matches a side at least.
 */
function mistakesOf(rows) {
  const recorded = rows.filter((r) => Array.isArray(r.mistakes)).sort((a, b) => a.at - b.at);
  if (recorded.length < MIN_RECORDED) return null;
  const half = Math.floor(recorded.length / 2);
  const early = recorded.slice(0, half);
  const late = recorded.slice(recorded.length - half);
  const keys = new Map();
  for (const r of recorded) for (const m of r.mistakes) if (!keys.has(m.key) || r.at >= keys.get(m.key).at) keys.set(m.key, { title: m.title, at: r.at });
  const rate = (side, k) => side.filter((r) => r.mistakes.some((m) => m.key === k)).length;
  const list = [...keys.entries()].map(([k, v]) => {
    const e = rate(early, k);
    const l = rate(late, k);
    return { key: k, title: mistakeTitle(k, v.title), early: e, late: l, side: half, drop: e / half - l / half };
  });
  // Counted in whole matches, never shares: 3 of 5 down to 2 of 5 is 20 points,
  // which 0.6 - 0.4 in floating point is not.
  const beaten = list.filter((m) => m.early >= 3 && 10 * m.early >= 3 * half && 5 * (m.early - m.late) >= half)
    .sort((a, b) => b.drop - a.drop || b.early - a.early || (a.key < b.key ? -1 : 1))[0] || null;
  const still = list.filter((m) => (!beaten || m.key !== beaten.key) && m.late >= 3 && 10 * m.late >= 3 * half)
    .sort((a, b) => b.late - a.late || a.drop - b.drop || (a.key < b.key ? -1 : 1))[0] || null;
  if (!beaten && !still) return null;
  return { recorded: recorded.length, side: half, beaten, still };
}

/** Fights: the gun, the agent that got the player most, first fights, the longest run of wins. */
function fightsOf(rows) {
  const weapons = mergeCounts(rows, 'weapons');
  const killers = mergeCounts(rows, 'killedBy');
  const riotRows = rows.filter((r) => r.riotRounds > 0);
  const riotRounds = sum(riotRows.map((r) => r.riotRounds));
  const fk = sum(riotRows.map((r) => r.fk || 0));
  const fd = sum(riotRows.map((r) => r.fd || 0));
  let run = 0;
  let longest = 0;
  for (const r of rows.slice().sort((a, b) => a.at - b.at)) {
    run = r.result === 'win' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const weaponKills = sum(weapons.map((w) => w.n));
  const gun = weapons[0] && weapons[0].n >= 10 ? { name: weapons[0].name, kills: weapons[0].n, share: pct(weapons[0].n, weaponKills) } : null;
  const nemesis = killers[0] && killers[0].n >= 5 ? { agent: killers[0].name, times: killers[0].n } : null;
  const first = riotRounds >= 40 ? { fk, fd, rounds: riotRounds, matches: riotRows.length, fkRate: round1((100 * fk) / riotRounds), fdRate: round1((100 * fd) / riotRounds) } : null;
  const streak = longest >= 2 ? longest : null;
  if (!gun && !nemesis && !first && !streak) return null;
  return { gun, nemesis, first, streak };
}

/** The rank, as far as the record knows it: the first and the last tier it holds, and the peak. */
const LADDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'];
const tierIndex = (t) => { const [name, div] = String(t).split(' '); const i = LADDER.indexOf(name); return i < 0 ? -1 : i * 3 + (Number(div) || 1); };
function rankJourneyOf(rows) {
  const known = rows.filter((r) => r.rank && r.rank.tier && tierIndex(r.rank.tier) >= 0).sort((a, b) => a.at - b.at);
  if (known.length < 2) return null;
  const first = known[0].rank;
  const last = known[known.length - 1].rank;
  const peak = known.slice().sort((a, b) => tierIndex(b.rank.tier) - tierIndex(a.rank.tier) || (b.rank.elo || 0) - (a.rank.elo || 0) || b.at - a.at)[0].rank;
  return { first: first.tier, last: last.tier, peak: peak.tier, games: known.length, moved: tierIndex(last.tier) - tierIndex(first.tier) };
}

/**
 * THE PLAYER'S TITLE: one of a small set, chosen by the numbers, each with the
 * two numbers that earned it. Every candidate is scored as how far past its
 * own bar the player is; the highest wins, the list's order breaks a tie, and
 * the Student, who reviewed their matches, is always there to fall back on.
 */
const TITLES = ['entry', 'clutch', 'climber', 'specialist', 'fragger', 'anchor', 'flex', 'grinder', 'student'];
function titleOf(v) {
  const c = [];
  const { time, agents, fights, grades, highlights, kd } = v;
  const f = fights && fights.first;
  if (f && f.rounds >= 80 && f.fkRate >= 12 && f.fk > f.fd) {
    c.push({ id: 'entry', name: 'The Entry', line: 'You took the first fight, and you won it.', strength: f.fkRate / 12,
      facts: [{ n: f.fk, label: 'first kills' }, { n: `${f.fkRate}%`, label: 'of rounds opened by you' }] });
  }
  if (highlights && highlights.clutches >= 3 && highlights.clutches / time.matches >= 0.2) {
    c.push({ id: 'clutch', name: 'The Closer', line: 'Last one standing, and still winning it.', strength: (highlights.clutches / time.matches) / 0.2,
      facts: [{ n: highlights.clutches, label: 'clutches won' }, { n: `1v${highlights.clutchBest}`, label: 'your biggest' }] });
  }
  if (grades && grades.climb && grades.climb.by >= 6) {
    c.push({ id: 'climber', name: 'The Climber', line: 'Every month a little sharper than the last.', strength: grades.climb.by / 6,
      facts: [{ n: grades.climb.from, label: 'your grade early on' }, { n: grades.climb.to, label: 'your grade by the end' }] });
  }
  const main = agents && agents[0];
  if (main && main.matches >= 10 && main.matches / time.matches >= 0.6) {
    c.push({ id: 'specialist', name: 'The Specialist', line: `One agent, mastered. ${main.name} was yours.`, strength: (main.matches / time.matches) / 0.6,
      facts: [{ n: main.matches, label: `matches on ${main.name}` }, { n: `${pct(main.matches, time.matches)}%`, label: 'of your year' }] });
  }
  if (kd && kd.kd >= 1.2 && kd.matches >= 10) {
    c.push({ id: 'fragger', name: 'The Fragger', line: 'Where you went, the kill feed followed.', strength: kd.kd / 1.2,
      facts: [{ n: kd.kd.toFixed(2), label: 'kills per death' }, { n: kd.kills, label: 'kills' }] });
  }
  if (f && f.rounds >= 80 && f.fdRate <= 8 && v.winRate !== null) {
    c.push({ id: 'anchor', name: 'The Anchor', line: 'Rarely the first to fall. The team could build on you.', strength: 8 / Math.max(2, f.fdRate),
      facts: [{ n: `${f.fdRate}%`, label: 'of rounds you died first' }, { n: `${v.winRate}%`, label: 'matches won' }] });
  }
  if (agents && agents.length >= 6 && agents[0].matches / time.matches <= 0.35 && time.matches >= 15) {
    c.push({ id: 'flex', name: 'The Flex', line: 'Whatever the team needed, you could play it.', strength: agents.length / 6,
      facts: [{ n: agents.length, label: 'agents played' }, { n: `${pct(agents[0].matches, time.matches)}%`, label: 'on your most played' }] });
  }
  if (time.matches >= 60 || time.days >= 40) {
    c.push({ id: 'grinder', name: 'The Grinder', line: 'You kept showing up. That is the whole secret.', strength: Math.max(time.matches / 60, time.days / 40),
      facts: [{ n: time.matches, label: 'matches reviewed' }, { n: time.days, label: 'days played' }] });
  }
  c.push({ id: 'student', name: 'The Student', line: 'You watched your own matches back. Most players never do.', strength: 1,
    facts: [{ n: time.matches, label: 'matches reviewed' }, time.hours > 0
      ? { n: time.hours, label: time.estimated ? 'hours, about' : 'hours played' }
      : { n: time.days, label: time.days === 1 ? 'day played' : 'days played' }] });
  c.sort((a, b) => b.strength - a.strength || TITLES.indexOf(a.id) - TITLES.indexOf(b.id));
  return c[0];
}

/** Valorant's half of the story, or null without MIN_MATCHES. */
function valorantStory(rows, has) {
  if (rows.length < MIN_MATCHES) return null;
  const time = timeOf(rows);
  const agents = tallyBy(rows, 'agent');
  const maps = tallyBy(rows, 'map');
  const decided = rows.filter((r) => r.result === 'win' || r.result === 'loss');
  const wins = rows.filter((r) => r.result === 'win').length;
  const winRate = decided.length >= MIN_MATCHES ? pct(wins, decided.length) : null;
  const withK = rows.filter((r) => Number.isFinite(r.k) && Number.isFinite(r.d));
  const kills = sum(withK.map((r) => r.k));
  const deaths = sum(withK.map((r) => r.d));
  const kd = withK.length >= MIN_MATCHES && deaths > 0 ? { kd: Math.round((100 * kills) / deaths) / 100, kills, deaths, matches: withK.length } : null;
  const grades = gradesOf(rows);
  const v = {
    game: 'valorant', time, agents, maps, wins, decided: decided.length, winRate, kd, grades,
    best: bestMatchOf(rows, has), highlights: highlightsOf(rows, has), mistakes: mistakesOf(rows),
    fights: fightsOf(rows), rank: rankJourneyOf(rows),
    sources: { watched: rows.filter((r) => r.source === 'watched').length, riot: rows.filter((r) => r.source === 'riot').length, import: rows.filter((r) => r.source === 'import').length },
  };
  v.title = titleOf(v);
  return v;
}

/** League's own slide, or null without MIN_MATCHES League matches. */
function lolStory(rows) {
  if (rows.length < MIN_MATCHES) return null;
  const time = timeOf(rows);
  const champs = tallyBy(rows, 'champion');
  const decided = rows.filter((r) => r.result === 'win' || r.result === 'loss');
  const wins = rows.filter((r) => r.result === 'win').length;
  const graded = rows.filter((r) => r.grade && Number.isFinite(r.grade.score) && !r.grade.provisional);
  const best = graded.slice().sort((a, b) => b.grade.score - a.grade.score || b.at - a.at)[0] || null;
  return {
    game: 'lol', time, champion: champs[0] || null, champions: champs.slice(0, 3),
    winRate: decided.length >= MIN_MATCHES ? pct(wins, decided.length) : null,
    avgGrade: graded.length >= MIN_GRADED ? Math.round(sum(graded.map((r) => r.grade.score)) / graded.length) : null,
    best: best ? { grade: best.grade, champion: best.champion, day: dayText(best.at), k: best.k, d: best.d, a: best.a } : null,
  };
}

/**
 * The year as slides. Valorant first, League its own closing slide, and a
 * slide only where its numbers stand.
 *
 * @param rows        the record's rows (any year; only `year`'s are read)
 * @param opts.year   the year told
 * @param opts.has    (id, clipName) => whether that clip is still on disk
 * @param opts.extras { trainer, drills } counted from their own stores, this year's
 */
function story(rows, opts) {
  const o = opts || {};
  const year = o.year;
  const has = typeof o.has === 'function' ? o.has : () => false;
  const all = (Array.isArray(rows) ? rows : []).map(cleanRow).filter((r) => r && yearOfAt(r.at) === year).sort((a, b) => a.at - b.at);
  const val = valorantStory(all.filter((r) => r.game === 'valorant'), has);
  const lol = lolStory(all.filter((r) => r.game === 'lol'));
  const extras = o.extras && typeof o.extras === 'object' ? o.extras : {};
  const trainer = Number.isInteger(extras.trainer) && extras.trainer > 0 ? extras.trainer : 0;
  const drills = Number.isInteger(extras.drills) && extras.drills > 0 ? extras.drills : 0;
  const flags = sum(all.map((r) => r.flags || 0));
  const out = { v: SCHEMA, year, enough: !!(val || lol), counts: countsOf(all), valorant: val, lol, extras: { trainer, drills, flags }, slides: [] };
  if (!out.enough) return out;
  const s = out.slides;
  if (val) {
    s.push({ kind: 'open', game: 'valorant', agent: val.agents[0] ? val.agents[0].name : null, matches: val.time.matches });
    s.push({ kind: 'time', ...val.time });
    if (val.agents[0] || val.maps[0]) s.push({ kind: 'mains', agent: val.agents[0] || null, agents: val.agents.slice(0, 3), map: val.maps[0] || null, maps: val.maps.slice(0, 3), totalMatches: val.time.matches });
    if (val.grades) s.push({ kind: 'grades', ...val.grades });
    if (val.best) s.push({ kind: 'best', ...val.best });
    if (val.highlights) s.push({ kind: 'highlights', ...val.highlights });
    if (val.mistakes) s.push({ kind: 'mistakes', ...val.mistakes });
    if (val.fights) s.push({ kind: 'fights', ...val.fights });
    s.push({ kind: 'title', ...val.title });
    if (val.rank) s.push({ kind: 'rank', ...val.rank });
  } else {
    s.push({ kind: 'open', game: 'lol', champion: lol.champion ? lol.champion.name : null, matches: lol.time.matches });
  }
  if (lol) s.push({ kind: 'lol', ...lol });
  s.push({ kind: 'summary', ...summaryOf(out) });
  return out;
}

/** The closing card's figures: the year, the title and up to six numbers that stand. */
function summaryOf(st) {
  const v = st.valorant;
  const l = st.lol;
  const figures = [];
  if (v) {
    figures.push({ n: v.time.matches, label: 'matches reviewed' });
    if (v.time.hours > 0) figures.push({ n: v.time.hours, label: v.time.estimated ? 'hours, about' : 'hours played' });
    if (v.agents[0]) figures.push({ n: v.agents[0].name, label: 'main agent', agent: v.agents[0].name });
    if (v.best) figures.push({ n: v.best.grade.score, label: 'best grade' });
    if (v.winRate !== null) figures.push({ n: `${v.winRate}%`, label: 'matches won' });
    const big = v.highlights ? v.highlights.threeK + v.highlights.fourK + v.highlights.aces : 0;
    if (big > 0) figures.push({ n: big, label: '3K or better' });
  }
  if (l) {
    figures.push({ n: l.time.matches, label: 'League matches' });
    if (!v && l.champion) figures.push({ n: l.champion.name, label: 'main champion' });
  }
  if (st.extras.trainer) figures.push({ n: st.extras.trainer, label: 'Trainer runs' });
  if (st.extras.drills) figures.push({ n: st.extras.drills, label: 'drills practiced' });
  return { title: v ? { id: v.title.id, name: v.title.name } : null, figures: figures.slice(0, 6), agent: v && v.agents[0] ? v.agents[0].name : null, champion: !v && l && l.champion ? l.champion.name : null };
}

module.exports = {
  SCHEMA, MIN_MATCHES, FIRST_YEAR, MATCH_TEXT_KEYS, MIN_GRADED, MIN_RECORDED, SIDE, MONTH_MIN, CLIMB_MIN, MONTHS, TITLES, LADDER,
  rowOf, cleanRow, windowOf, yearOpenAt, latestYear, yearOfAt, countsOf, autoOpenYear, entryOf,
  story, titleOf, bestClip, mistakesOf, gradesOf, fightsOf, timeOf, highlightsOf, rankJourneyOf, summaryOf,
  agentOf, mapOf, weaponOf, resultOf, safe, plural,
};
