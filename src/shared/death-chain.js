'use strict';

/**
 * A DEATH IS A CHAIN OF MISTAKES, READ IN THE CONTEXT OF THE MATCH (the
 * owner's goal, Nov 2026). A review used to give a death one label, the
 * coach's look (death-causes.js), and Ask Coach read a round with little
 * memory of the rounds before it. On the owner's Bind match, round 6, the
 * look said one thing (a risky spot with no escape) where Riot's record says
 * three: the spot, nobody close enough to trade, and a five against four
 * given back in a round the team lost.
 *
 * Everything here is arithmetic over Riot's record and the look's closed
 * label, never a sentence a model wrote, and never a fact the record does not
 * hold. A model only phrases what this hands it (match-review.js, chat-prompt.js),
 * and the claim gates hold what it says back to the same record
 * (record-claims.js checkEarlier).
 *
 *   chainOf(row, rows)     one death: the first mistake (the earliest one that
 *                          made it likely), up to two that made it worse, the
 *                          round's situation and what happened earlier in the
 *                          match that bears on it. Null for a round with no
 *                          verified death, a round the player sat out, or a
 *                          death the record finds nothing in.
 *   memoryOf(rows)         the match's own memory: places and enemies the
 *                          player kept dying to, a run of deaths nobody
 *                          traded, the first fights, an enemy who started
 *                          winning from a round on, and what the player did
 *                          in the first half and stopped doing in the second.
 *   chainsOf(rows)         every death's chain, [{ n, chain }].
 *
 * Rows are ledger rows (build's and requestBody's input: killerAgent,
 * riotSpot, mateNear, aliveAtDeath) or saved round cards (riot.killer,
 * riot.place, riot.mate, riot.alive), read by one rule (rowOf). The economy is
 * out of scope here as everywhere the coach speaks: no buy is read. The
 * record holds no health, armour or position before the fight, so nothing
 * here says any.
 *
 * The server keeps the kind keys and the memory's rules in its own copy
 * (server/services/match-memory.js, since server/ never requires src/), and
 * test:deathchain holds the two to the same lines on the same rounds.
 *
 * Pure, no Electron.
 */

const { CAUSES, isAvoidable, recordCause, answeredKill } = require('./death-causes');
const { satOut } = require('./sat-out');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const lower = (s) => String(s == null ? '' : s).toLowerCase();

/*
 * THE KINDS A CHAIN IS MADE OF. The look's avoidable causes keep their own
 * keys and words (death-causes.js CAUSES); these are the record's. `short` is
 * the evidence in a few words, `gerund` the habit said across the match.
 * `cause` kinds may be a chain's first mistake; the others are what a death
 * cost or what made it worse, never its first mistake.
 */
const KINDS = {
  'untradeable':    { one: 'Nobody close to trade', cause: true, gerund: 'dying where no teammate was close enough to trade' },
  'early-attack':   { one: 'Early death on attack', cause: true, gerund: 'dying in the first 30 seconds on attack with the whole team still up' },
  'no-utility':     { one: 'No ability used', cause: true, gerund: 'taking fights with no ability used that round' },
  'repeat-spot':    { one: 'Same spot again', cause: true, gerund: 'dying at a spot you had already died at twice' },
  'first-death':    { one: 'First down, not traded', cause: false, gerund: 'being the first one down with nobody trading it' },
  'gave-advantage': { one: 'Advantage given back', cause: false, gerund: 'dying with your team up in numbers in a round it then lost' },
  'same-killer':    { one: 'Same enemy again', cause: false, gerund: 'dying to an enemy who had already killed you twice' },
  'untraded-close': { one: 'Close teammate, no trade', cause: false, gerund: 'dying near a teammate with nobody trading it' },
};
/** The look's avoidable causes, in a chain by their own key. */
const LOOK_KINDS = Object.keys(CAUSES).filter((k) => isAvoidable(k));
const LOOK_GERUND = {
  'dry-peek': 'peeking an angle with no utility or information first',
  'isolated': 'getting caught too far from the team to be traded',
  'repeek': 'fighting again from the same angle after the first exchange',
  'crossfire': 'stepping into two enemies holding different angles',
  'rotating': 'getting caught while moving between areas',
  'overextend': 'pushing past the team',
  'exposed': 'being in the open on the spike',
  'no-escape': 'taking a kill from a spot with no way out',
};
/** Every key a chain can carry, the look's and the record's. */
const CHAIN_KEYS = [...LOOK_KINDS, ...Object.keys(KINDS)];

/*
 * THE ORDER A DEATH IS READ IN. The first mistake is the earliest that made
 * the death likely: where the player stood (caught alone, pushed past the
 * team, a spot with no way out), then the fight as the coach's look saw it
 * on the frames (a dry peek, a crossfire, a repeek), which is more particular
 * than anything the record can say, then the record's own: nobody close to
 * trade, dead early on attack, no ability used, the same spot a third time.
 * What the death cost (first down, an advantage given back) and what the
 * match had already shown of the killer come after, never first.
 */
const FIRST_ORDER = ['isolated', 'overextend', 'rotating', 'no-escape', 'dry-peek', 'crossfire', 'exposed', 'repeek',
  'untradeable', 'early-attack', 'no-utility', 'repeat-spot'];
const WORSE_ORDER = ['no-escape', 'isolated', 'overextend', 'rotating', 'dry-peek', 'crossfire', 'exposed', 'repeek',
  'untradeable', 'no-utility', 'gave-advantage', 'first-death', 'early-attack', 'repeat-spot', 'same-killer', 'untraded-close'];
const WORSE_MAX = 2;

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function ordinal(n) {
  if (ORDINAL_WORDS[n]) return ORDINAL_WORDS[n];
  const t = n % 100;
  const end = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${end}`;
}
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five'];
const roundsWord = (ns) => (ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
const timesWord = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const isSite = (p) => /^[abc] site$/i.test(String(p || ''));
const secsWord = (gap) => {
  const s = Math.round(gap * 10) / 10;
  return s <= 1 ? 'a second' : `${s} seconds`;
};

/**
 * One row in the shape this file reads, from a ledger row or a saved card.
 * Null for anything without a round number.
 */
function rowOf(r) {
  if (!r || typeof r !== 'object' || !Number.isInteger(r.n)) return null;
  const card = Object.prototype.hasOwnProperty.call(r, 'riot') || Object.prototype.hasOwnProperty.call(r, 'sideKey');
  const rr = card ? (r.riot && typeof r.riot === 'object' ? r.riot : null) : r;
  const side = card ? (r.sideKey === 'attacking' || r.sideKey === 'defending' ? r.sideKey : null)
    : (r.side === 'attacking' || r.side === 'defending' ? r.side : null);
  const alive = rr && (card ? rr.alive : rr.aliveAtDeath);
  const castsIn = rr ? rr.casts : null;
  let casts = null;
  if (Array.isArray(castsIn)) {
    const xs = castsIn.filter((x) => x && Number.isInteger(x.n));
    if (xs.length) casts = xs.map((x) => x.n);
  } else if (castsIn && typeof castsIn === 'object') {
    const xs = ['C', 'Q', 'E', 'X'].filter((k) => Number.isInteger(castsIn[k])).map((k) => castsIn[k]);
    if (xs.length) casts = xs;
  }
  const f = r.forensics && r.forensics.cause ? (card ? r.forensics : recordCause(r.forensics, r)) : null;
  const plantSec = card ? (rr && fin(rr.plantSec) ? rr.plantSec : null)
    : (fin(r.riotPlantMs) ? Math.round(r.riotPlantMs / 100) / 10 : null);
  return {
    n: r.n,
    side,
    result: r.result === 'won' || r.result === 'lost' ? r.result : null,
    died: !!r.died,
    verified: !!r.verified && !!rr,
    out: satOut(r) || satOut(rr),
    early: !!r.early,
    sec: rr ? (fin(card ? rr.sec : r.deathSec) ? (card ? rr.sec : r.deathSec) : null) : null,
    killer: rr ? ((card ? rr.killer : r.killerAgent) || null) : null,
    place: rr ? ((card ? rr.place : r.riotSpot) || null) : null,
    mate: rr ? ((card ? rr.mate : r.mateNear) === 'close' ? 'close' : (card ? rr.mate : r.mateNear) === 'far' ? 'far' : null) : null,
    traded: rr && typeof rr.traded === 'boolean' ? rr.traded : null,
    alive: alive && fin(alive.mates) && fin(alive.enemies) ? { mates: alive.mates, enemies: alive.enemies } : null,
    firstDeath: !!(rr && rr.firstDeath),
    firstKill: !!(rr && rr.firstKill),
    feed: rr && Array.isArray(rr.feed) ? rr.feed : null,
    afterPlant: !!(rr && rr.afterPlant),
    plantSec,
    clutch: rr && rr.clutch && fin(rr.clutch.vs) ? { vs: rr.clutch.vs, won: typeof rr.clutch.won === 'boolean' ? rr.clutch.won : null } : null,
    casts,
    look: f ? { cause: f.cause, source: f.source === 'screen' ? 'screen' : 'riot' } : null,
  };
}

const rowsOf = (rows) => (Array.isArray(rows) ? rows : []).map(rowOf).filter(Boolean).sort((a, b) => a.n - b.n);
/** A death the record can judge: Riot's, in a round the player played. */
const judged = (x) => !!(x && x.died && x.verified && !x.out);
/** The rounds before n whose death Riot places at `place`, and whether every earlier death had a place. */
function earlierAt(rows, n, key, value) {
  return rows.filter((x) => x.n < n && judged(x) && x[key] && lower(x[key]) === lower(value)).map((x) => x.n);
}

/** The record's no-escape, for a death with no look to say it (death-causes.js answeredKill). */
function escapeOf(x) {
  if (!x.feed) return null;
  if (!(x.side === 'defending' || (x.side === 'attacking' && x.mate === 'far'))) return null;
  return answeredKill({ feed: x.feed, killer: x.killer });
}

/**
 * Each mistake the record shows in one death, keyed by kind:
 * Map kind -> { short, text }.
 */
function found(x, rows) {
  const out = new Map();
  const look = x.look && x.look.cause;
  const mates = x.alive ? x.alive.mates - 1 : null;
  const lastAlive = !!(x.alive && x.alive.mates <= 1);
  const placeAt = x.place ? ` at ${x.place}` : '';
  // The look's avoidable cause, its own words.
  if (look && LOOK_KINDS.includes(look)) {
    let short = CAUSES[look].detail;
    let text = null;
    if (look === 'no-escape') {
      const hit = answeredKill({ feed: x.feed, killer: x.killer });
      if (hit) {
        short = `a kill${placeAt}, then ${hit.death.ka} killed you ${secsWord(hit.gap)} later`;
        text = `You got a kill${placeAt}, and ${hit.death.ka} killed you ${secsWord(hit.gap)} later, too soon to leave the spot.`;
      }
    }
    out.set(look, { short, text: text || `${CAUSES[look].one}: the coach's look saw you ${short}.`, from: 'look' });
  }
  // A spot with no way out, from the feed, where no look said anything else.
  if (!look || look === 'unclear') {
    const hit = escapeOf(x);
    if (hit) {
      out.set('no-escape', {
        short: `a kill${placeAt}, then ${hit.death.ka} killed you ${secsWord(hit.gap)} later`,
        text: `You got a kill${placeAt}, and ${hit.death.ka} killed you ${secsWord(hit.gap)} later, too soon to leave the spot.`,
        from: 'record',
      });
    }
  }
  if (x.traded === false && x.mate === 'far' && !lastAlive && look !== 'isolated') {
    out.set('untradeable', {
      short: 'no teammate close, and nobody traded it',
      text: `No teammate was close when you died${mates !== null ? `, with ${COUNT[mates] || mates} teammate${mates === 1 ? '' : 's'} alive` : ''}, and nobody traded it.`,
      from: 'record',
    });
  }
  if (x.traded === false && x.mate === 'close' && !lastAlive) {
    out.set('untraded-close', { short: 'a teammate close, and nobody traded it', text: 'A teammate was close when you died, and nobody traded it.', from: 'record' });
  }
  // Every cast Riot holds for the player that round at zero: no ability at all.
  if (x.casts && x.casts.every((v) => v === 0)) {
    if (look === 'dry-peek' && out.has('dry-peek')) {
      const d = out.get('dry-peek');
      out.set('dry-peek', { ...d, text: `${d.text} Riot's record has no ability cast by you that round.` });
    } else {
      out.set('no-utility', { short: 'no ability cast that round', text: "Riot's record has no ability cast by you that round.", from: 'record' });
    }
  }
  if (x.side === 'attacking' && x.early && !x.afterPlant && x.alive && x.alive.mates === 5 && x.traded === false && fin(x.sec)) {
    out.set('early-attack', {
      short: `dead ${x.sec} seconds in on attack with all four teammates up`,
      text: `You died ${x.sec} seconds in on attack, before any plant, with all four teammates still up.`,
      from: 'record',
    });
  }
  if (x.firstDeath && x.traded === false) {
    out.set('first-death', { short: 'the first one down, not traded', text: 'You were the first one down and nobody traded it, so your team played the round a player down.', from: 'record' });
  }
  if (x.alive && x.alive.mates > x.alive.enemies && x.result === 'lost' && x.traded !== true) {
    out.set('gave-advantage', {
      short: `your team was up ${x.alive.mates} against ${x.alive.enemies} and lost the round`,
      text: `Your team was up ${x.alive.mates} against ${x.alive.enemies} when you died, and the round was lost.`,
      from: 'record',
    });
  }
  // What the match had already shown: the same callout (never a whole site) and the same enemy.
  if (x.place && !isSite(x.place)) {
    const before = earlierAt(rows, x.n, 'place', x.place);
    if (before.length >= 2) {
      const nth = ordinal(before.length + 1);
      out.set('repeat-spot', {
        short: `your ${nth} death at ${x.place}, after ${roundsWord(before)}`,
        text: `Your ${nth} death at ${x.place} this match, after ${roundsWord(before)}.`,
        from: 'record',
      });
    }
  }
  if (x.killer) {
    const before = earlierAt(rows, x.n, 'killer', x.killer);
    if (before.length >= 2) {
      out.set('same-killer', { short: `${x.killer} killed you in ${roundsWord(before)} too`, text: `${x.killer} also killed you in ${roundsWord(before)}.`, from: 'record' });
    }
  }
  return out;
}

/** The situation of the round, context and never a mistake: the score, the half, overtime, a clutch, the plant. */
function situationOf(x, rows, half) {
  const out = [];
  const h = Number.isInteger(half) && half > 0 ? half : null;
  // The score before the round, while every round before it has a result.
  let team = 0;
  let enemy = 0;
  let known = true;
  for (let k = 1; k < x.n; k++) {
    const y = rows.find((z) => z.n === k);
    if (!y || !y.result) { known = false; break; }
    if (y.result === 'won') team += 1; else enemy += 1;
  }
  if (known) {
    let tag = '';
    if (h) {
      const target = h + 1;
      const ot = h >= 12 && team >= h && enemy >= h;
      const mp = (a, b) => (ot ? a > b : a === target - 1 && b < target);
      if (mp(team, enemy) && mp(enemy, team)) tag = ', match point for both teams';
      else if (mp(team, enemy)) tag = ', your match point';
      else if (mp(enemy, team)) tag = ', their match point';
    }
    out.push(`the score was ${team} to ${enemy} before the round${tag}`);
  }
  if (h && (x.n === 1 || x.n === h + 1)) out.push('the first round of the half');
  else if (h && x.n === h) out.push('the last round of the first half');
  if (h && h >= 12 && x.n > 2 * h) out.push('an overtime round');
  if (x.clutch && x.clutch.vs >= 1) out.push(`you were the last one standing against ${x.clutch.vs}`);
  if (x.afterPlant && fin(x.plantSec) && fin(x.sec) && x.sec >= x.plantSec) out.push(`you died ${Math.round(x.sec - x.plantSec)} seconds after the plant`);
  return out;
}

/** What happened earlier in the match that bears on this death, from Riot's record. */
function earlierOf(x, rows) {
  const out = [];
  if (x.place && !isSite(x.place)) {
    const at = earlierAt(rows, x.n, 'place', x.place);
    if (at.length) out.push(`you died at ${x.place} in ${roundsWord(at)} too`);
  }
  if (x.killer) {
    const by = earlierAt(rows, x.n, 'killer', x.killer);
    if (by.length) out.push(`${x.killer} killed you in ${roundsWord(by)} too`);
  }
  // A run of deaths nobody traded, this one among them, counted over the
  // deaths a teammate alive could have traded.
  if (x.traded === false && !(x.alive && x.alive.mates <= 1)) {
    const deaths = rows.filter((y) => y.n <= x.n && judged(y) && typeof y.traded === 'boolean' && !(y.alive && y.alive.mates <= 1));
    let run = 0;
    for (let i = deaths.length - 1; i >= 0 && deaths[i].traded === false; i--) run += 1;
    if (run >= 3) out.push(`your ${ordinal(run)} death in a row that nobody traded`);
  }
  return out;
}

/** One death's chain, or null. half: the rounds in a half (12, 4), or null. */
function chainOf(row, rows, opts = {}) {
  return chainIn(rowOf(row), rowsOf(rows), opts);
}
/** chainOf on rows already read (rowOf). */
function chainIn(x, all, opts = {}) {
  if (!judged(x)) return null;
  const kinds = found(x, all);
  const fair = !!(x.look && x.look.cause === 'lost-duel');
  const firstKey = fair ? null : FIRST_ORDER.find((k) => kinds.has(k)) || null;
  const item = (k) => ({ kind: k, title: (KINDS[k] || CAUSES[k]).one, short: kinds.get(k).short, text: kinds.get(k).text, from: kinds.get(k).from });
  // No first mistake the record or the look can name, and no fair fight: what
  // the death cost is no chain of mistakes, so none is said (a close teammate
  // with no trade, or the first one down, on their own, are not the player's
  // mistake the record can show).
  const worse = firstKey || fair ? WORSE_ORDER.filter((k) => k !== firstKey && kinds.has(k)).slice(0, WORSE_MAX).map(item) : [];
  // What made it worse already says the same spot or the same enemy: not twice.
  const said = new Set([firstKey, ...worse.map((w) => w.kind)]);
  const earlier = earlierOf(x, all).filter((t) => !(said.has('repeat-spot') && /^you died at /.test(t))
    && !(said.has('same-killer') && x.killer && t.startsWith(`${x.killer} killed you`)));
  const situation = situationOf(x, all, opts.half);
  if (!firstKey && !worse.length && !earlier.length) return null;
  return {
    first: firstKey ? item(firstKey) : null,
    worse,
    fair,
    mistakes: (firstKey ? 1 : 0) + worse.length,
    earlier,
    situation,
  };
}

/** Every judged death's chain, [{ n, chain }], chains only. */
function chainsOf(rows, opts = {}) {
  const all = rowsOf(rows);
  return all.filter(judged).map((x) => ({ n: x.n, chain: chainIn(x, all, opts) })).filter((e) => e.chain);
}

/*
 * THE MATCH'S OWN MEMORY: finished lines, each a count over Riot's record of
 * the rounds the player played, with its rounds. A line only clears its
 * floor: twice at one callout (three times for a killer), three deaths in a
 * row nobody traded, three first fights, an enemy who killed the player three
 * times from a round on after none in three deaths or more before it, and a
 * half that kept something the next one dropped by half its share or more.
 */
function memoryOf(rows, opts = {}) {
  const all = rowsOf(rows);
  const deaths = all.filter(judged);
  const out = [];
  const add = (key, text, rounds) => out.push({ key, text, rounds });
  // The callouts the player kept dying at, and to whom there.
  const byPlace = new Map();
  for (const d of deaths) if (d.place && !isSite(d.place)) byPlace.set(d.place, [...(byPlace.get(d.place) || []), d]);
  const places = [...byPlace.entries()].filter(([, ds]) => ds.length >= 2).sort((a, b) => b[1].length - a[1].length || a[1][0].n - b[1][0].n).slice(0, 2);
  for (const [place, ds] of places) {
    add('place', `You died at ${place} ${timesWord(ds.length)}, ${roundsWord(ds.map((d) => d.n))}.`, ds.map((d) => d.n));
    const killers = new Map();
    for (const d of ds) if (d.killer) killers.set(d.killer, [...(killers.get(d.killer) || []), d.n]);
    const top = [...killers.entries()].filter(([, ns]) => ns.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
    if (top) add('place-killer', `${top[0]} killed you at ${place} ${timesWord(top[1].length)}, ${roundsWord(top[1])}.`, top[1]);
  }
  // The enemy who killed the player most, three times at least.
  const byKiller = new Map();
  for (const d of deaths) if (d.killer) byKiller.set(d.killer, [...(byKiller.get(d.killer) || []), d.n]);
  const topKiller = [...byKiller.entries()].filter(([, ns]) => ns.length >= 3).sort((a, b) => b[1].length - a[1].length || a[1][0] - b[1][0])[0];
  if (topKiller) add('killer', `${topKiller[0]} killed you ${timesWord(topKiller[1].length)}, ${roundsWord(topKiller[1])}.`, topKiller[1]);
  // An enemy who started winning from a round on.
  // The one whose run started latest after the most deaths to others.
  const shifts = [...byKiller.entries()].filter(([, ns]) => ns.length >= 3)
    .map(([agent, ns]) => ({ agent, ns, before: deaths.filter((d) => d.n < ns[0]).length }))
    .filter((x) => x.before >= 3).sort((a, b) => b.ns.length - a.ns.length || b.before - a.before);
  if (shifts.length) {
    const x = shifts[0];
    add('shift', `${x.agent} killed you in none of your ${x.before} deaths before round ${x.ns[0]}, and in ${roundsWord(x.ns)} from then on.`, x.ns);
  }
  // The longest run of deaths in a row nobody traded, a teammate alive.
  const tradeable = deaths.filter((d) => typeof d.traded === 'boolean' && !(d.alive && d.alive.mates <= 1));
  let best = [];
  let cur = [];
  for (const d of tradeable) {
    if (d.traded === false) { cur.push(d.n); if (cur.length > best.length) best = cur.slice(); } else cur = [];
  }
  // A long run is said as its span, never a list of more than four rounds.
  if (best.length >= 3) {
    add('streak', `${best.length} deaths in a row nobody traded, ${best.length > 4 ? `from round ${best[0]} to round ${best[best.length - 1]}` : roundsWord(best)}.`, best);
  }
  // The round's first fight: the first kill or the first death.
  const played = all.filter((x) => x.verified && !x.out);
  const firstKills = played.filter((x) => x.firstKill).map((x) => x.n);
  const firstDeaths = played.filter((x) => x.firstDeath).map((x) => x.n);
  if (firstKills.length + firstDeaths.length >= 3) {
    add('first-contact', `You were in the round's first fight ${firstKills.length + firstDeaths.length} times: you won it in ${firstKills.length ? roundsWord(firstKills) : 'none'}, and died first in ${firstDeaths.length ? roundsWord(firstDeaths) : 'none'}.`,
      [...firstKills, ...firstDeaths].sort((a, b) => a - b));
  }
  // What the first half kept and the second dropped.
  const h = Number.isInteger(opts.half) && opts.half > 0 ? opts.half : null;
  if (h) {
    const halves = [tradeable.filter((d) => d.n <= h), tradeable.filter((d) => d.n > h && d.n <= 2 * h)];
    const tr = halves.map((ds) => ds.filter((d) => d.traded === true).length);
    if (halves.every((ds) => ds.length >= 3) && tr[0] * 2 >= halves[0].length && tr[1] * 2 * halves[0].length <= tr[0] * halves[1].length) {
      add('half', `In the first half ${tr[0]} of your ${halves[0].length} deaths were traded, and in the second half ${tr[1]} of ${halves[1].length}.`,
        halves[0].concat(halves[1]).filter((d) => d.traded === true).map((d) => d.n));
    }
    const fk = [played.filter((x) => x.n <= h && x.firstKill).length, played.filter((x) => x.n > h && x.n <= 2 * h && x.firstKill).length];
    if (fk[0] >= 3 && fk[1] * 2 <= fk[0]) {
      add('half-open', `You got the round's first kill ${timesWord(fk[0])} in the first half, and ${fk[1] ? timesWord(fk[1]) : 'never'} in the second.`,
        played.filter((x) => x.firstKill && x.n <= 2 * h).map((x) => x.n));
    }
  }
  return out;
}

module.exports = { chainOf, chainsOf, memoryOf, rowOf, rowsOf, situationOf, earlierOf, KINDS, LOOK_KINDS, LOOK_GERUND, CHAIN_KEYS, FIRST_ORDER, WORSE_ORDER, WORSE_MAX };
