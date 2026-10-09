'use strict';

/**
 * The breakdown: the same saved reviews the patterns count, cut by map and by
 * agent (by map and hero for Marvel Rivals, by champion for League).
 *
 * EVERY NUMBER IS COUNTED, NONE IS WRITTEN. The model never reaches this file.
 * The one model judgement inside a saved review, the death cause label, only
 * arrives here inside a mistake the review had already counted.
 *
 * EACH FACT COMES FROM THE ONLY PLACE THAT KNOWS IT.
 *   rounds (sides, pistols, post plants, retakes, openings, trades, survival)
 *     only Riot checked rounds. The screen files a round result a round late
 *     often enough (valorant-rounds.js) that a side win rate built on it
 *     would measure the lag, not the player.
 *   where the player died  only recorded rounds. Riot records no locations.
 *   the scoreboard         only matches that have one.
 *
 * EVERY NUMBER CARRIES ITS SAMPLE. A rate under its floor comes back with
 * pct null, and the window shows "3 of 7" instead of a percentage one round
 * would swing by fourteen points. The floors are in FLOOR, beside what they
 * guard.
 *
 * A HEADLINE IS A CLAIM, so it has to beat chance: a map is called strongest
 * or weakest, an agent best, only with three graded matches on it, three
 * elsewhere, six in all, and a gap of at least six points that is also at
 * least one and a half standard errors of the grade.
 *
 * OLD CARDS STILL COUNT. A card saved before 8.0.3 has no structured fields,
 * only the sentences roundFacts() wrote, and those are fixed strings, so they
 * are read back here. test-breakdown.js holds the two readings equal on the
 * real match.
 *
 * Pure, no Electron.
 */

const { roleOf } = require('./agent-roles');
const { letter } = require('./grade');
const { repeatTitle } = require('./insights');

const FLOOR = {
  winMatches: 3,      // a match win rate
  sideRounds: 10,     // attack or defence rounds
  pistols: 4,         // pistol rounds
  plants: 5,          // post plants on attack, retakes on defence
  openings: 20,       // first kills, first deaths, survival, over rounds
  trades: 8,          // deaths whose trade Riot's feed could say
  spotDeaths: 3,      // a death spot: this many deaths there,
  spotShare: 0.25,    //   and this share of the deaths the screen placed
  spotsShown: 5,      // placed deaths before any spot is listed
  repeatMatches: 2,   // a mistake or strength repeated on one map or agent,
  repeatShare: 0.4,   //   in this share of its matches
  vsRest: 3,          // matches in the row and outside it, for a comparison
  headlineRow: 3,     // graded matches on a called row, and outside it
  headlineAll: 6,     // graded matches in all
  headlineGap: 6,     // points of grade
  headlineSe: 1.5,    // standard errors
  mostPlayed: 3,      // matches
};

// The queues the Valorant breakdown counts. Spike Rush, Replication,
// Escalation, customs and the deathmatches are played on other rules, and a
// side win rate that mixes them in is a number about nothing. 'Standard' is
// the screen's own name for a match whose queue Riot never named.
const VALORANT_QUEUES = new Set(['Competitive', 'Unrated', 'Swiftplay', 'Premier', 'Standard']);

const SPOT_RE = /^Died at ([^,]+)/;
const KILLS_RE = /^(\d+) kills?$/;
const SCORE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

const keyOf = (s) => String(s || '').trim().toLowerCase();
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rate(count, n, floor) {
  return { count, n, pct: n > 0 && n >= floor ? Math.round((count / n) * 100) : null };
}

function roundsIn(score) {
  const m = SCORE_RE.exec(String(score || ''));
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

/** 'won' | 'lost' | 'drawn' | null, for every game's way of writing a result. */
function outcome(result) {
  const r = String(result || '');
  if (/vict|\bwin\b|\bwon\b/i.test(r)) return 'won';
  if (/defeat|\bloss\b|\blost\b|\blose\b/i.test(r)) return 'lost';
  if (/\bdraw\b|\btie\b/i.test(r)) return 'drawn';
  return null;
}

function recordOf(entries) {
  const r = { won: 0, lost: 0, drawn: 0, known: 0 };
  for (const e of entries) {
    const o = outcome(e.result);
    if (!o) continue;
    r[o]++;
    r.known++;
  }
  return r;
}

/** The average of the grades that are not provisional, and how many were left out. */
function gradeOf(entries) {
  const scored = entries.filter((e) => e.grade && typeof e.grade.score === 'number');
  const firm = scored.filter((e) => !e.grade.provisional).map((e) => e.grade.score);
  const raw = mean(firm);
  const avg = raw === null ? null : Math.round(raw);
  return { avg, raw, letter: avg === null ? null : letter(avg), n: firm.length, provisional: scored.length - firm.length };
}

/**
 * What one insight is counted as across a row's matches, and its title there.
 *
 * A KEY THAT NAMES ONE MATCH'S SPECIFICS REPEATS ONLY WITH THEM. 'same-spot'
 * is "Dying at A Site", with a fix that names the place, and 'same-killer' is
 * "Skye kept winning". Counted by key alone, A Site in one match and B Main in
 * the next read as a repeat, under whichever place the newest match had. So the
 * place and the agent the entry carries are counted with the key, case folded
 * as the review folds them, and a repeat is the same place or the same agent.
 *
 * A RIVALS COMPARISON'S TITLE CARRIES ONE MATCH'S NUMBER, "Kills down 52%",
 * and what repeats across matches is the direction, never that number. So the
 * title says only the direction, by the rule the patterns use too
 * (insights.repeatTitle): deaths are lower is better, so a deaths mistake is
 * above the average and a deaths strength below it.
 */
function countedAs(x, list, map) {
  const key = String(x.key);
  // A place is a place ON A MAP: A Site, B Main and Mid exist on nearly every
  // map, so on an agent row, which spans maps, the map is part of the place.
  if (key === 'same-spot') return { id: `${key}:${keyOf(map)}:${keyOf(x.place || x.title)}`, title: x.title };
  if (key === 'same-killer') return { id: `${key}:${keyOf(x.agent || x.title)}`, title: x.title };
  if (key.startsWith('vs:')) return { id: key, title: repeatTitle(key, list, x, null).title };
  return { id: key, title: x.title };
}

/** Whatever repeats in the row's matches, once a match, past its floor. */
function repeated(entries, list) {
  const tally = new Map();
  for (const e of entries) {
    const seen = new Set();
    for (const x of ((e.insights || {})[list] || [])) {
      if (!x || !x.key) continue;
      const c = countedAs(x, list, e.map);
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      // Entries arrive newest first, so the title and the fix are the newest
      // sighting's, of this place, this agent, this direction.
      const t = tally.get(c.id) || { key: x.key, title: c.title, fix: x.fix || null, weight: x.weight || 1, matches: 0, total: 0 };
      t.matches++;
      t.total += x.count || 1;
      tally.set(c.id, t);
    }
  }
  const best = [...tally.values()]
    .filter((t) => t.matches >= FLOOR.repeatMatches && t.matches >= entries.length * FLOOR.repeatShare)
    .sort((a, b) => b.matches - a.matches || b.weight - a.weight || b.total - a.total)[0];
  if (!best) return null;
  return list === 'mistakes'
    ? { key: best.key, title: best.title, fix: best.fix, matches: best.matches, of: entries.length }
    : { key: best.key, title: best.title, matches: best.matches, of: entries.length };
}

/** The other dimension inside a row: the agents on a map, the maps of an agent. */
function cross(entries, by) {
  const groups = new Map();
  for (const e of entries) {
    if (!e[by]) continue;
    const k = keyOf(e[by]);
    if (!groups.has(k)) groups.set(k, { label: e[by], list: [] });
    groups.get(k).list.push(e);
  }
  return [...groups.values()]
    .map((g) => ({ label: g.label, matches: g.list.length, record: recordOf(g.list), grade: gradeOf(g.list) }))
    .sort((a, b) => b.matches - a.matches || (b.grade.raw ?? -1) - (a.grade.raw ?? -1) || a.label.localeCompare(b.label));
}

/** Rows for one dimension, each made by `make(label, its entries, the rest)`. */
function rowsBy(entries, by, make) {
  const groups = new Map();
  for (const e of entries) {
    if (!e[by]) continue;
    const k = keyOf(e[by]);
    if (!groups.has(k)) groups.set(k, { label: e[by], list: [] });
    groups.get(k).list.push(e);
  }
  return [...groups.values()]
    .map((g) => make(g.label, g.list, entries.filter((e) => !g.list.includes(e))))
    .sort((a, b) => b.matches - a.matches || (b.grade.raw ?? -1) - (a.grade.raw ?? -1) || a.label.localeCompare(b.label));
}

/** This row against everything outside it. Null when neither side has enough. */
function against(es, rest, extra) {
  const a = gradeOf(es);
  const b = gradeOf(rest);
  const ra = recordOf(es);
  const rb = recordOf(rest);
  const out = {
    grade: a.n >= FLOOR.vsRest && b.n >= FLOOR.vsRest ? Math.round(a.raw - b.raw) : null,
    winRate: ra.known >= FLOOR.vsRest && rb.known >= FLOOR.vsRest
      ? Math.round((ra.won / ra.known - rb.won / rb.known) * 100) : null,
    firstDeath: extra && extra.firstDeath !== undefined ? extra.firstDeath : null,
  };
  return out.grade === null && out.winRate === null && out.firstDeath === null ? null : out;
}

/** The queues present, most played first. */
function queuesOf(entries) {
  const m = new Map();
  for (const e of entries) if (e.mode) m.set(e.mode, (m.get(e.mode) || 0) + 1);
  return [...m.entries()].map(([label, matches]) => ({ label, matches }))
    .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label));
}

function pickQueue(entries, opts) {
  const queues = queuesOf(entries);
  const want = opts && typeof opts.queue === 'string' ? opts.queue : 'All';
  const queue = want !== 'All' && queues.some((q) => q.label === want) ? want : 'All';
  return { queues, queue, kept: queue === 'All' ? entries : entries.filter((e) => e.mode === queue) };
}

/**
 * The headline: strongest and weakest on the first dimension, best on the
 * second, most played on the second (or the only one). Every call beats
 * chance by the rule in the header; most played is a count and needs three.
 */
function headlineOf(dims, rows, entries) {
  const firm = entries.filter((e) => e.grade && typeof e.grade.score === 'number' && !e.grade.provisional)
    .map((e) => e.grade.score);
  const out = [];
  const say = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (firm.length >= FLOOR.headlineAll) {
    const m = mean(firm);
    const sd = Math.sqrt(firm.reduce((a, x) => a + (x - m) ** 2, 0) / (firm.length - 1));
    const callable = (list) => list.map((row) => {
      const n1 = row.grade.n;
      const n2 = firm.length - n1;
      if (n1 < FLOOR.headlineRow || n2 < FLOOR.headlineRow) return null;
      const rest = (m * firm.length - row.grade.raw * n1) / n2;
      const gap = row.grade.raw - rest;
      const se = sd * Math.sqrt(1 / n1 + 1 / n2);
      return Math.abs(gap) >= FLOOR.headlineGap && Math.abs(gap) >= FLOOR.headlineSe * se ? { row, gap } : null;
    }).filter(Boolean);
    const detail = (c, d) => `Average ${c.row.grade.avg} over ${say(c.row.grade.n, 'graded match', 'graded matches')}, `
      + `${Math.round(Math.abs(c.gap))} ${c.gap > 0 ? 'above' : 'below'} your other ${d.many}.`;
    const first = dims[0];
    const calls = callable(rows[first.key] || []);
    const top = calls.filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap)[0];
    const low = calls.filter((c) => c.gap < 0).sort((a, b) => a.gap - b.gap)[0];
    const two = dims.length > 1;
    if (top) out.push({ kind: 'strongest', dim: first.key, label: top.row.label, title: two ? `Strongest ${first.one}` : `Best ${first.one}`, detail: detail(top, first) });
    if (low) out.push({ kind: 'weakest', dim: first.key, label: low.row.label, title: `Weakest ${first.one}`, detail: detail(low, first) });
    if (two) {
      const second = dims[1];
      const best = callable(rows[second.key] || []).filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap)[0];
      if (best) out.push({ kind: 'best', dim: second.key, label: best.row.label, title: `Best ${second.one}`, detail: detail(best, second) });
    }
  }
  const d = dims[dims.length - 1];
  const list = (rows[d.key] || []).slice().sort((a, b) => b.matches - a.matches);
  if (list[0] && list[0].matches >= FLOOR.mostPlayed && !(list[1] && list[1].matches === list[0].matches)) {
    const r = list[0];
    const rec = r.record && r.record.known ? `, ${r.record.won}-${r.record.lost}${r.record.drawn ? `-${r.record.drawn}` : ''}` : '';
    out.push({ kind: 'most', dim: d.key, label: r.label, title: 'Most played',
      detail: `${r.matches} of your ${say(entries.length, 'match', 'matches')}${rec}.` });
  }
  const claims = out.filter((h) => h.kind !== 'most').length;
  const words = dims.map((x) => x.one).join(' or ');
  const note = entries.length && !claims
    ? `No ${words} stands out yet. That takes at least 3 graded matches on each and a gap bigger than chance.`
    : null;
  return { headline: out, note };
}

// ── Valorant ────────────────────────────────────────────────────────────────

/** Riot's per round facts from a card's fact lines, for a card saved before 8.0.3. */
function legacyRiot(facts, died) {
  let kills = 0;
  for (const f of facts) {
    const m = KILLS_RE.exec(String(f));
    if (m) kills = Number(m[1]);
  }
  return {
    firstDeath: facts.includes('First death of the round'),
    firstKill: facts.includes('First kill of the round'),
    kills,
    traded: !died ? null : facts.includes('Traded by a teammate') ? true : facts.includes('Not traded') ? false : null,
  };
}

/** One round card, as the breakdown counts it. */
function roundOf(card, review) {
  const facts = Array.isArray(card.facts) ? card.facts : [];
  const verified = typeof card.verified === 'boolean' ? card.verified : !!review.verified;
  const side = card.sideKey !== undefined ? card.sideKey
    : card.side === 'Attack' ? 'attacking' : card.side === 'Defence' ? 'defending' : null;
  const watched = typeof card.watched === 'boolean' ? card.watched
    : review.source !== 'riot' && !facts.includes('Not watched by the coach');
  let spot = null;
  if (card.died && watched) {
    if (card.spot !== undefined) spot = card.spot || null;
    else {
      for (const f of facts) {
        const m = SPOT_RE.exec(String(f));
        if (m) { spot = m[1].trim(); break; }
      }
    }
  }
  return {
    n: card.n, side, result: card.result || null, died: !!card.died, planted: !!card.planted, verified, watched, spot,
    riot: verified ? (card.riot || legacyRiot(facts, !!card.died)) : null,
  };
}

function valorantEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  const cards = Array.isArray(r.rounds) ? r.rounds : [];
  return {
    id: s.id, at: s.at,
    map: g.map || null, agent: g.agent || null, mode: g.mode || null, result: g.result || null,
    grade: r.grade || null, scoreline: r.scoreline || null, insights: r.insights || {},
    totalRounds: roundsIn(g.score),
    riotOnly: r.source === 'riot',
    halftime: typeof r.halftimeAfter === 'number' ? r.halftimeAfter : null,
    rounds: cards.map((c) => roundOf(c, r)),
  };
}

// The last round of regulation in the longest mode counted, twelve a half.
// Overtime swaps sides every round, so a side change there is never a pistol.
const REGULATION = 24;

/**
 * The first round of the second half, from the verified cards' own sides.
 *
 * RIOT'S SIDES OUTRANK halftimeAfter. A review linked by 8.0.0 or 8.0.1 took
 * halftimeAfter from the screen's mode, and the screen has locked swiftplay on
 * a competitive match, which put the second pistol on round 5 of 24. A
 * verified card's side is Riot's, worked out from Riot's own queue, so the
 * second pistol is the first verified round after round 1 on the other side,
 * within regulation. Where the sides are all known and never change (a match
 * that ended in its first half) there is no second pistol. halftimeAfter
 * speaks only where the sides are unknown: no verified round 1 with a side,
 * or no later verified round with one.
 */
function secondPistol(rs, halftime) {
  const sided = rs.filter((r) => r.n > 0 && r.n <= REGULATION && (r.side === 'attacking' || r.side === 'defending'))
    .sort((a, b) => a.n - b.n);
  const first = sided.find((r) => r.n === 1);
  const later = sided.filter((r) => r.n > 1);
  if (!first || !later.length) return halftime ? halftime + 1 : null;
  const swap = later.find((r) => r.side !== first.side);
  return swap ? swap.n : null;
}

function roundStats(entries) {
  const c = { checked: 0, rounds: 0, aw: 0, a: 0, dw: 0, d: 0, pw: 0, p: 0, ppw: 0, pp: 0, rw: 0, rt: 0, fk: 0, fd: 0, lived: 0, tk: 0, td: 0 };
  for (const e of entries) {
    const rs = e.rounds.filter((r) => r.verified);
    if (!rs.length) continue;
    c.checked++;
    // Round 1, and the first round after halftime. Never overtime.
    const pistols = new Set([1]);
    const second = secondPistol(rs, e.halftime);
    if (second) pistols.add(second);
    for (const r of rs) {
      c.rounds++;
      const decided = r.result === 'won' || r.result === 'lost';
      const won = r.result === 'won';
      if (decided && r.side === 'attacking') { c.a++; if (won) c.aw++; }
      if (decided && r.side === 'defending') { c.d++; if (won) c.dw++; }
      if (decided && pistols.has(r.n)) { c.p++; if (won) c.pw++; }
      if (decided && r.planted && r.side === 'attacking') { c.pp++; if (won) c.ppw++; }
      if (decided && r.planted && r.side === 'defending') { c.rt++; if (won) c.rw++; }
      if (r.riot && r.riot.firstKill) c.fk++;
      if (r.riot && r.riot.firstDeath) c.fd++;
      if (!r.died) c.lived++;
      if (r.died && r.riot && typeof r.riot.traded === 'boolean') { c.td++; if (r.riot.traded) c.tk++; }
    }
  }
  return {
    checked: c.checked,
    rounds: c.rounds,
    attack: rate(c.aw, c.a, FLOOR.sideRounds),
    defence: rate(c.dw, c.d, FLOOR.sideRounds),
    pistol: rate(c.pw, c.p, FLOOR.pistols),
    postPlant: rate(c.ppw, c.pp, FLOOR.plants),
    retake: rate(c.rw, c.rt, FLOOR.plants),
    firstKill: rate(c.fk, c.rounds, FLOOR.openings),
    firstDeath: rate(c.fd, c.rounds, FLOOR.openings),
    survived: rate(c.lived, c.rounds, FLOOR.openings),
    traded: rate(c.tk, c.td, FLOOR.trades),
  };
}

/** The scoreboard: K/D as total kills over total deaths, the rest weighted by rounds. */
function scoreStats(entries) {
  let kills = 0; let deaths = 0; let kdN = 0;
  const w = { acs: [0, 0, 0], adr: [0, 0, 0], hs: [0, 0, 0] };
  const add = (k, v, weight) => { if (num(v) === null) return; w[k][0] += v * weight; w[k][1] += weight; w[k][2]++; };
  for (const e of entries) {
    const s = e.scoreline;
    if (!s) continue;
    const weight = e.totalRounds || e.rounds.length || 1;
    if (num(s.kills) !== null && num(s.deaths) !== null) { kills += s.kills; deaths += s.deaths; kdN++; }
    add('acs', s.acs, weight);
    add('adr', s.adr, weight);
    add('hs', s.headshotPct, weight);
  }
  const avg = (k) => ({ value: w[k][2] ? Math.round(w[k][0] / w[k][1]) : null, n: w[k][2] });
  return {
    kd: { value: kdN ? round2(kills / Math.max(1, deaths)) : null, kills, deaths, n: kdN },
    acs: avg('acs'), adr: avg('adr'), hs: avg('hs'),
  };
}

/** Where the screen placed the deaths, recorded rounds only. */
function spotStats(entries) {
  const counts = new Map();
  let placed = 0;
  for (const e of entries) {
    if (e.riotOnly) continue;
    for (const r of e.rounds) {
      if (!r.died || !r.spot || !r.watched) continue;
      placed++;
      const k = keyOf(r.spot);
      const c = counts.get(k) || { spot: r.spot, deaths: 0 };
      c.deaths++;
      counts.set(k, c);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.deaths - a.deaths || a.spot.localeCompare(b.spot));
  const [lead, next] = top;
  // A CALLOUT NAMES THE ONE PLACE THE PLAYER DIES MOST, so it needs one. Out of
  // a tie the alphabet picked it, and A Site beat B Site for being spelled
  // first. A tie is shown as the top list instead.
  const leads = lead && !(next && next.deaths >= lead.deaths);
  return {
    placed,
    top: placed >= FLOOR.spotsShown ? top.slice(0, 3) : [],
    callout: leads && lead.deaths >= FLOOR.spotDeaths && lead.deaths >= placed * FLOOR.spotShare
      ? { spot: lead.spot, deaths: lead.deaths, placed } : null,
  };
}

function valorantRow(dim, label, es, rest) {
  const stats = { ...roundStats(es), ...scoreStats(es) };
  const record = recordOf(es);
  let firstDeath;
  if (dim === 'map') {
    const r = roundStats(rest);
    // THREE CHECKED MATCHES A SIDE, as every comparison with the rest needs.
    // One checked match is 24 rounds and clears the rounds floor on its own,
    // and one match against one match is a coincidence, not a comparison.
    firstDeath = stats.checked >= FLOOR.vsRest && r.checked >= FLOOR.vsRest
      && stats.firstDeath.n >= FLOOR.openings && r.firstDeath.n >= FLOOR.openings
      ? Math.round((stats.firstDeath.count / stats.firstDeath.n - r.firstDeath.count / r.firstDeath.n) * 100) : null;
  }
  return {
    key: keyOf(label), label,
    sub: dim === 'agent' ? roleOf(label) : null,
    matches: es.length,
    record,
    winRate: rate(record.won, record.known, FLOOR.winMatches),
    grade: gradeOf(es),
    stats,
    cross: cross(es, dim === 'map' ? 'agent' : 'map'),
    spots: dim === 'map' ? spotStats(es) : null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest, dim === 'map' ? { firstDeath } : null),
  };
}

function valorant(list, opts) {
  const all = list.filter((s) => (s.review || {}).kind === 'valorant').map(valorantEntry);
  const eligible = all.filter((e) => !e.mode || VALORANT_QUEUES.has(e.mode));
  const { queues, queue, kept } = pickQueue(eligible, opts);
  const dims = [
    { key: 'map', label: 'By map', one: 'map', many: 'maps' },
    { key: 'agent', label: 'By agent', one: 'agent', many: 'agents' },
  ];
  const rows = {
    map: rowsBy(kept, 'map', (label, es, rest) => valorantRow('map', label, es, rest)),
    agent: rowsBy(kept, 'agent', (label, es, rest) => valorantRow('agent', label, es, rest)),
  };
  return {
    game: 'valorant', matches: kept.length, total: eligible.length, queue, queues,
    left: all.length - eligible.length,
    checked: kept.filter((e) => e.rounds.some((r) => r.verified)).length,
    unknown: { map: kept.filter((e) => !e.map).length, agent: kept.filter((e) => !e.agent).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

// ── Marvel Rivals ───────────────────────────────────────────────────────────

const RIVALS_DUTY = { Strategist: ['healing', 'Healing'], Vanguard: ['blocked', 'Blocked'] };

function rivalsEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  return {
    id: s.id, at: s.at, map: g.map || null, hero: g.hero || null, role: g.role || null, mode: g.mode || null,
    result: g.result || null, grade: r.grade || null, scoreline: r.scoreline || {}, insights: r.insights || {},
  };
}

function avgOf(entries, key) {
  const xs = entries.map((e) => num(e.scoreline[key])).filter((v) => v !== null);
  return { value: xs.length ? Math.round(mean(xs)) : null, n: xs.length };
}

function rivalsRow(dim, label, es, rest) {
  let kills = 0; let deaths = 0; let kdN = 0;
  for (const e of es) {
    if (num(e.scoreline.kills) !== null && num(e.scoreline.deaths) !== null) {
      kills += e.scoreline.kills; deaths += e.scoreline.deaths; kdN++;
    }
  }
  const roles = cross(es, 'role');
  const role = dim === 'hero' && roles[0] ? roles[0].label : null;
  // THE DUTY OF THE ROLE THE ROW IS LABELLED WITH, over the matches played in
  // that role. Deadpool is three roles: a match he played as a Vanguard healed
  // nothing, and averaging it in read as a Strategist who stopped healing.
  const inRole = role ? es.filter((e) => keyOf(e.role) === keyOf(role)) : [];
  const duty = role && RIVALS_DUTY[role] ? { label: RIVALS_DUTY[role][1], ...avgOf(inRole, RIVALS_DUTY[role][0]) } : null;
  const record = recordOf(es);
  return {
    key: keyOf(label), label, sub: role, matches: es.length,
    record, winRate: rate(record.won, record.known, FLOOR.winMatches), grade: gradeOf(es),
    stats: {
      kd: { value: kdN ? round2(kills / Math.max(1, deaths)) : null, kills, deaths, n: kdN },
      damage: avgOf(es, 'damage'),
      // Duty and accuracy only on a hero: averaged across heroes they compare
      // a projectile hero's accuracy with a hitscan one's, and healing with
      // blocking.
      duty: duty && duty.value !== null ? duty : null,
      accuracy: dim === 'hero' ? avgOf(es, 'accuracy') : null,
    },
    cross: cross(es, dim === 'map' ? 'hero' : 'map'),
    spots: null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest),
  };
}

function rivals(list, opts) {
  const all = list.filter((s) => (s.review || {}).kind === 'rivals' && !(s.review || {}).empty).map(rivalsEntry);
  const { queues, queue, kept } = pickQueue(all, opts);
  const dims = [
    { key: 'map', label: 'By map', one: 'map', many: 'maps' },
    { key: 'hero', label: 'By hero', one: 'hero', many: 'heroes' },
  ];
  const rows = {
    map: rowsBy(kept, 'map', (label, es, rest) => rivalsRow('map', label, es, rest)),
    hero: rowsBy(kept, 'hero', (label, es, rest) => rivalsRow('hero', label, es, rest)),
  };
  return {
    game: 'rivals', matches: kept.length, total: all.length, queue, queues, left: 0, checked: 0,
    unknown: { map: kept.filter((e) => !e.map).length, hero: kept.filter((e) => !e.hero).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

// ── League of Legends ───────────────────────────────────────────────────────

function lolEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  return {
    id: s.id, at: s.at, champion: g.champion || null, role: g.role || null, mode: g.mode || null,
    minutes: num(g.durationSec) ? g.durationSec / 60 : null,
    support: /support|utility/i.test(g.role || ''),
    result: null, grade: r.grade || null, scoreline: r.scoreline || {}, insights: r.insights || {},
  };
}

function lolRow(label, es, rest) {
  let k = 0; let d = 0; let a = 0; let kdaN = 0;
  let cs = 0; let csMin = 0; let csN = 0;
  let ward = 0; let wardMin = 0; let wardN = 0;
  let dMin = 0; let dSum = 0; let dN = 0;
  for (const e of es) {
    const s = e.scoreline;
    if (num(s.kills) !== null && num(s.deaths) !== null) { k += s.kills; d += s.deaths; a += num(s.assists) || 0; kdaN++; }
    if (!e.minutes) continue;
    if (!e.support && num(s.cs) !== null) { cs += s.cs; csMin += e.minutes; csN++; }
    if (num(s.ward) !== null) { ward += s.ward; wardMin += e.minutes; wardN++; }
    if (num(s.deaths) !== null) { dSum += s.deaths; dMin += e.minutes; dN++; }
  }
  const roles = cross(es, 'role');
  return {
    key: keyOf(label), label, sub: roles[0] ? roles[0].label : null, matches: es.length,
    record: null, winRate: null, grade: gradeOf(es),
    stats: {
      kda: { value: kdaN ? round2((k + a) / Math.max(1, d)) : null, n: kdaN },
      csPerMin: { value: csN ? round1(cs / csMin) : null, n: csN },
      visionPerMin: { value: wardN ? round1(ward / wardMin) : null, n: wardN },
      deathsPer10: { value: dN ? round1((dSum / dMin) * 10) : null, n: dN },
    },
    cross: [],
    spots: null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest),
  };
}

/**
 * ONE LEAGUE MODE AT A TIME, and no All. The recorder keeps the Live Client
 * Data API's gameMode: Summoner's Rift reads 'CLASSIC', and ARAM, Arena
 * ('CHERRY'), Swiftplay and URF are other maps or other clocks. A CS or
 * vision a minute folding them together is a number about nothing, the
 * reason the Valorant breakdown leaves Spike Rush out. Left out instead, a
 * player whose games are all ARAM or Swiftplay had no breakdown at all, so
 * each mode is its own, the most played first. A game with no mode recorded
 * is the Rift, since nothing says it was not; the practice tool and the
 * tutorial are no games.
 */
const LOL_MODES = {
  CLASSIC: "Summoner's Rift", ARAM: 'ARAM', CHERRY: 'Arena', SWIFTPLAY: 'Swiftplay', URF: 'URF', ARURF: 'ARURF',
  ONEFORALL: 'One for All', NEXUSBLITZ: 'Nexus Blitz', ULTBOOK: 'Ultimate Spellbook', PRACTICETOOL: null, TUTORIAL: null,
};
function lolMode(mode) {
  const m = String(mode || '').trim().toUpperCase();
  if (!m) return LOL_MODES.CLASSIC;
  if (Object.prototype.hasOwnProperty.call(LOL_MODES, m)) return LOL_MODES[m];
  return m.charAt(0) + m.slice(1).toLowerCase();
}

function lol(list, opts) {
  const all = list.filter((s) => s.game === 'lol' || ((s.review || {}).game && (s.review || {}).game.champion))
    .map(lolEntry).map((e) => ({ ...e, mode: lolMode(e.mode) }));
  const games = all.filter((e) => e.mode);
  const queues = queuesOf(games);
  const want = opts && typeof opts.queue === 'string' ? opts.queue : null;
  const queue = queues.some((q) => q.label === want) ? want : queues[0] ? queues[0].label : LOL_MODES.CLASSIC;
  const kept = games.filter((e) => e.mode === queue);
  const dims = [{ key: 'champion', label: 'By champion', one: 'champion', many: 'champions' }];
  const rows = { champion: rowsBy(kept, 'champion', lolRow) };
  return {
    game: 'lol', matches: kept.length, total: games.length, queue, queues, allQueue: false,
    left: all.length - games.length, checked: 0,
    unknown: { champion: kept.filter((e) => !e.champion).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

/**
 * @param game   'valorant' | 'rivals' | 'lol'
 * @param saved  every saved review of that game, newest first ({ id, game, at, review })
 * @param opts   { queue: 'All' | a queue label }; League has no All, and starts on its most played mode
 */
function build(game, saved, opts = {}) {
  const list = (Array.isArray(saved) ? saved : []).filter((s) => s && s.review);
  if (game === 'valorant') return valorant(list, opts);
  if (game === 'rivals') return rivals(list, opts);
  if (game === 'lol') return lol(list, opts);
  return { game, matches: 0, total: 0, queue: 'All', queues: [], left: 0, checked: 0, unknown: {}, dims: [], rows: {}, headline: [], note: null };
}

module.exports = { build, roundOf, outcome, secondPistol, FLOOR, VALORANT_QUEUES };
