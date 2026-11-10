'use strict';

/**
 * THE MATCH'S OWN MEMORY AND EACH DEATH'S CHAIN, ON THE SERVER (Nov 2026).
 * The client reads a death as a chain of mistakes and the match as a memory
 * (src/shared/death-chain.js), and server/ never requires src/
 * (check:server), so this is the server's copy of the memory's rules and the
 * chain's kinds, which test:deathchain holds to the client's: the same lines
 * from the same rounds, the same keys.
 *
 * Nothing the client wrote is said. A review request carries each chain as
 * kinds alone (valorant-review.js chainsSent), and every kind is checked here
 * against the server's own rounds (chainWords): one its rounds do not bear
 * out is dropped, and the words are this file's. The memory is counted here
 * from the rounds themselves. Ask Coach's cards are read the same way
 * (rowsOfCards).
 *
 *   rowsOfReview(rounds)  match-review.js normalise's rounds as rows
 *   rowsOfCards(cards)    chat-prompt.js normalise's cards as rows
 *   memoryLines(rows, half)   [{ key, text, rounds }], the client's memoryOf
 *   earlierLines(rows, n)     what came before round n, the client's earlierOf
 *   chainWords(sent, rows)    one chain checked and worded, or null
 *   mainWords(main, chains)   the match's biggest repeat, or null
 *
 * Agents and callouts only, never a name. No economy.
 */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const lower = (s) => String(s == null ? '' : s).toLowerCase();
const isSite = (p) => /^[abc] site$/i.test(String(p || ''));
const roundsWord = (ns) => (ns.length === 1 ? `round ${ns[0]}` : `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
const timesWord = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function ordinal(n) {
  if (ORDINAL_WORDS[n]) return ORDINAL_WORDS[n];
  const t = n % 100;
  const end = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${end}`;
}
const secsWord = (gap) => {
  const s = Math.round(gap * 10) / 10;
  return s <= 1 ? 'a second' : `${s} seconds`;
};
/** The list of rounds in a list's words: "rounds 1, 3, 5, 6, 7, 8 and 3 more" (insights.js roundList). */
function roundList(ns) {
  if (!ns.length) return '';
  if (ns.length === 1) return `round ${ns[0]}`;
  const shown = ns.slice(0, 6);
  const rest = ns.length - shown.length;
  if (rest > 0) return `rounds ${shown.join(', ')} and ${rest} more`;
  return `rounds ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/*
 * THE KINDS, the client's keys (death-chain.js KINDS and the look's avoidable
 * causes), each with its title and the habit said across the match.
 */
const LOOK_KINDS = {
  'dry-peek': { one: 'Dry peek', gerund: 'peeking an angle with no utility or information first' },
  'isolated': { one: 'Caught alone', gerund: 'getting caught too far from the team to be traded' },
  'repeek': { one: 'Repeek', gerund: 'fighting again from the same angle after the first exchange' },
  'crossfire': { one: 'Walked into a crossfire', gerund: 'stepping into two enemies holding different angles' },
  'rotating': { one: 'Caught rotating', gerund: 'getting caught while moving between areas' },
  'overextend': { one: 'Overextended', gerund: 'pushing past the team' },
  'exposed': { one: 'Exposed on the spike', gerund: 'being in the open on the spike' },
  'no-escape': { one: 'Risky spot, no escape', gerund: 'taking a kill from a spot with no way out' },
};
const RECORD_KINDS = {
  'untradeable': { one: 'Nobody close to trade', gerund: 'dying where no teammate was close enough to trade' },
  'early-attack': { one: 'Early death on attack', gerund: 'dying in the first 30 seconds on attack with the whole team still up' },
  'no-utility': { one: 'No ability used', gerund: 'taking fights with no ability used that round' },
  'repeat-spot': { one: 'Same spot again', gerund: 'dying at a spot you had already died at twice' },
  'first-death': { one: 'First down, not traded', gerund: 'being the first one down with nobody trading it' },
  'gave-advantage': { one: 'Advantage given back', gerund: 'dying with your team up in numbers in a round it then lost' },
  'same-killer': { one: 'Same enemy again', gerund: 'dying to an enemy who had already killed you twice' },
  'untraded-close': { one: 'Close teammate, no trade', gerund: 'dying near a teammate with nobody trading it' },
};
const KINDS = { ...LOOK_KINDS, ...RECORD_KINDS };
const CHAIN_KEYS = Object.keys(KINDS);
const FIRST_KINDS = new Set(['isolated', 'overextend', 'rotating', 'no-escape', 'dry-peek', 'crossfire', 'exposed', 'repeek',
  'untradeable', 'early-attack', 'no-utility']);
const NO_ESCAPE_SEC = 1.5;

/** match-review.js normalise's rounds as rows. */
function rowsOfReview(rounds) {
  return (Array.isArray(rounds) ? rounds : []).filter((r) => r && Number.isInteger(r.n)).map((r) => ({
    n: r.n, side: r.side || null, result: r.result || null, died: !!r.died, verified: !!r.verified, out: r.afk === true,
    place: r.verified && r.died && typeof r.place === 'string' && r.place ? r.place : null,
    killer: r.verified && r.killer ? r.killer : null,
    traded: typeof r.traded === 'boolean' ? r.traded : null,
    mate: r.mate === 'close' || r.mate === 'far' ? r.mate : null,
    alive: r.alive && fin(r.alive.mates) && fin(r.alive.enemies) ? r.alive : null,
    firstDeath: !!r.firstDeath, firstKill: !!r.firstKill, kills: Number.isInteger(r.kills) ? r.kills : null,
    sec: fin(r.sec) ? r.sec : null, early: r.timing === 'early' || (fin(r.sec) && r.sec <= 30 && r.afterPlant !== true && !(fin(r.plantSec) && r.sec > r.plantSec)),
    afterPlant: r.afterPlant === true,
    casts: Array.isArray(r.casts) && r.casts.length ? r.casts.map((c) => c.n) : null,
    cause: r.cause || null,
  })).sort((a, b) => a.n - b.n);
}

/** chat-prompt.js normalise's cards as rows. */
function rowsOfCards(cards) {
  return (Array.isArray(cards) ? cards : []).filter((c) => c && Number.isInteger(c.n)).map((c) => {
    const r = c.riot || null;
    return {
      n: c.n, side: c.side || null, result: c.result || null, died: !!c.died, verified: !!c.verified && !!r, out: !!(r && r.afk),
      place: r && c.died && r.place ? r.place : null,
      killer: r && r.killer ? r.killer : null,
      traded: r && typeof r.traded === 'boolean' ? r.traded : null,
      mate: r && (r.mate === 'close' || r.mate === 'far') ? r.mate : null,
      alive: r && r.alive ? r.alive : null,
      firstDeath: !!(r && r.firstDeath), firstKill: !!(r && r.firstKill), kills: r && Number.isInteger(r.kills) ? r.kills : null,
      sec: r && fin(r.sec) ? r.sec : null,
      early: !!(r && fin(r.sec) && r.sec <= 30 && !r.afterPlant),
      afterPlant: !!(r && r.afterPlant),
      casts: r && Array.isArray(r.casts) && r.casts.length ? r.casts.map((x) => x.n) : null,
      cause: c.look && c.look.cause ? c.look.cause : null,
    };
  }).sort((a, b) => a.n - b.n);
}

const judged = (x) => !!(x && x.died && x.verified && !x.out);
const earlierAt = (rows, n, key, value) => rows.filter((x) => x.n < n && judged(x) && x[key] && lower(x[key]) === lower(value)).map((x) => x.n);
const lastAlive = (x) => !!(x.alive && x.alive.mates <= 1);

/** What came before round n that bears on its death (death-chain.js earlierOf). */
function earlierLines(rows, n) {
  const x = rows.find((r) => r.n === n);
  if (!judged(x)) return [];
  const out = [];
  if (x.place && !isSite(x.place)) {
    const at = earlierAt(rows, n, 'place', x.place);
    if (at.length) out.push(`you died at ${x.place} in ${roundsWord(at)} too`);
  }
  if (x.killer) {
    const by = earlierAt(rows, n, 'killer', x.killer);
    if (by.length) out.push(`${x.killer} killed you in ${roundsWord(by)} too`);
  }
  if (x.traded === false && !lastAlive(x)) {
    const deaths = rows.filter((y) => y.n <= n && judged(y) && typeof y.traded === 'boolean' && !lastAlive(y));
    let run = 0;
    for (let i = deaths.length - 1; i >= 0 && deaths[i].traded === false; i--) run += 1;
    if (run >= 3) out.push(`your ${ordinal(run)} death in a row that nobody traded`);
  }
  return out;
}

/** The match's own memory (death-chain.js memoryOf), the same lines from the same rounds. */
function memoryLines(rows, half) {
  const deaths = rows.filter(judged);
  const out = [];
  const add = (key, text, rounds) => out.push({ key, text, rounds });
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
  const byKiller = new Map();
  for (const d of deaths) if (d.killer) byKiller.set(d.killer, [...(byKiller.get(d.killer) || []), d.n]);
  const topKiller = [...byKiller.entries()].filter(([, ns]) => ns.length >= 3).sort((a, b) => b[1].length - a[1].length || a[1][0] - b[1][0])[0];
  if (topKiller) add('killer', `${topKiller[0]} killed you ${timesWord(topKiller[1].length)}, ${roundsWord(topKiller[1])}.`, topKiller[1]);
  const shifts = [...byKiller.entries()].filter(([, ns]) => ns.length >= 3)
    .map(([agent, ns]) => ({ agent, ns, before: deaths.filter((d) => d.n < ns[0]).length }))
    .filter((x) => x.before >= 3).sort((a, b) => b.ns.length - a.ns.length || b.before - a.before);
  if (shifts.length) {
    const x = shifts[0];
    add('shift', `${x.agent} killed you in none of your ${x.before} deaths before round ${x.ns[0]}, and in ${roundsWord(x.ns)} from then on.`, x.ns);
  }
  const tradeable = deaths.filter((d) => typeof d.traded === 'boolean' && !lastAlive(d));
  let best = [];
  let cur = [];
  for (const d of tradeable) {
    if (d.traded === false) { cur.push(d.n); if (cur.length > best.length) best = cur.slice(); } else cur = [];
  }
  if (best.length >= 3) {
    add('streak', `${best.length} deaths in a row nobody traded, ${best.length > 4 ? `from round ${best[0]} to round ${best[best.length - 1]}` : roundsWord(best)}.`, best);
  }
  const played = rows.filter((x) => x.verified && !x.out);
  const firstKills = played.filter((x) => x.firstKill).map((x) => x.n);
  const firstDeaths = played.filter((x) => x.firstDeath).map((x) => x.n);
  if (firstKills.length + firstDeaths.length >= 3) {
    add('first-contact', `You were in the round's first fight ${firstKills.length + firstDeaths.length} times: you won it in ${firstKills.length ? roundsWord(firstKills) : 'none'}, and died first in ${firstDeaths.length ? roundsWord(firstDeaths) : 'none'}.`,
      [...firstKills, ...firstDeaths].sort((a, b) => a - b));
  }
  const h = Number.isInteger(half) && half > 0 ? half : null;
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

/*
 * ONE KIND, CHECKED AGAINST THE ROUND AND WORDED: { kind, title, short } or
 * null where the server's own rounds do not bear it out. The look's kinds
 * need the round's own look to have said it; the record's, the record's facts.
 */
function kindWords(kind, x, rows, sent) {
  if (!KINDS[kind]) return null;
  const title = KINDS[kind].one;
  const mates = x.alive ? x.alive.mates : null;
  const at = x.place ? ` at ${x.place}` : '';
  switch (kind) {
    case 'no-escape': {
      const gap = sent && fin(sent.gap) ? sent.gap : null;
      const lookSaid = x.cause === 'no-escape';
      const recordFits = (x.side === 'defending' || (x.side === 'attacking' && x.mate === 'far')) && x.kills >= 1 && x.killer;
      if (!lookSaid && !(recordFits && gap !== null && gap >= 0 && gap <= NO_ESCAPE_SEC)) return null;
      return { kind, title, short: gap !== null && x.killer && recordFits ? `a kill${at}, then ${x.killer} killed you ${secsWord(gap)} later` : null };
    }
    case 'untradeable':
      return x.traded === false && x.mate === 'far' && mates >= 2 && x.cause !== 'isolated' ? { kind, title, short: 'no teammate close, and nobody traded it' } : null;
    case 'untraded-close':
      return x.traded === false && x.mate === 'close' && mates >= 2 ? { kind, title, short: 'a teammate close, and nobody traded it' } : null;
    case 'no-utility':
      return x.casts && x.casts.every((v) => v === 0) ? { kind, title, short: 'no ability cast that round' } : null;
    case 'early-attack':
      return x.side === 'attacking' && x.early && !x.afterPlant && mates === 5 && x.traded === false && fin(x.sec)
        ? { kind, title, short: `dead ${x.sec} seconds in on attack with all four teammates up` } : null;
    case 'first-death':
      return x.firstDeath && x.traded === false ? { kind, title, short: 'the first one down, not traded' } : null;
    case 'gave-advantage':
      return x.alive && x.alive.mates > x.alive.enemies && x.result === 'lost' && x.traded !== true
        ? { kind, title, short: `your team was up ${x.alive.mates} against ${x.alive.enemies} and lost the round` } : null;
    case 'repeat-spot': {
      if (!x.place || isSite(x.place)) return null;
      const before = earlierAt(rows, x.n, 'place', x.place);
      return before.length >= 2 ? { kind, title, short: `your ${ordinal(before.length + 1)} death at ${x.place}, after ${roundsWord(before)}` } : null;
    }
    case 'same-killer': {
      if (!x.killer) return null;
      const before = earlierAt(rows, x.n, 'killer', x.killer);
      return before.length >= 2 ? { kind, title, short: `${x.killer} killed you in ${roundsWord(before)} too` } : null;
    }
    default:
      // A look's kind stands only where this round's look said it.
      return x.cause === kind ? { kind, title, short: null } : null;
  }
}

/**
 * One chain a client sent ({ n, first, worse, fair, gap }), checked against
 * the server's rows and worded: { n, first, worse, fair, earlier } or null.
 * A first mistake the rows do not bear out takes the chain with it: what
 * made it worse is only said beside a first mistake or a fair fight.
 */
function chainWords(sent, rows) {
  if (!sent || typeof sent !== 'object' || !Number.isInteger(sent.n)) return null;
  const x = rows.find((r) => r.n === sent.n);
  if (!judged(x)) return null;
  const fair = sent.fair === true && x.cause === 'lost-duel';
  // Nobody close to trade is never first on defence before the plant (death-chain.js firstAllowed).
  const firstOk = !(sent.first === 'untradeable' && x.side === 'defending' && !x.afterPlant);
  const first = typeof sent.first === 'string' && FIRST_KINDS.has(sent.first) && firstOk && !fair ? kindWords(sent.first, x, rows, sent) : null;
  if (!first && !fair) return null;
  const worse = (Array.isArray(sent.worse) ? sent.worse : []).filter((k) => typeof k === 'string' && k !== (first && first.kind))
    .slice(0, 2).map((k) => kindWords(k, x, rows, sent)).filter(Boolean);
  if (fair && !worse.length) return null;
  return { n: x.n, first, worse, fair };
}

/** A chain as a clause of its round line: "first X (short), made worse by Y (short) and Z (short)". */
function chainCore(c) {
  const said = (w) => `${w.title.toLowerCase()}${w.short ? ` (${w.short})` : ''}`;
  const worse = c.worse.map(said);
  const list = worse.length === 2 ? `${worse[0]} and ${worse[1]}` : worse[0] || '';
  if (c.fair) return `a fair fight by the coach's look, where what made it cost more was ${list}`;
  return `first ${said(c.first)}${list ? `, made worse by ${list}` : ''}`;
}
function chainClause(c) {
  return `the death as a chain of mistakes, read in code from Riot's record and the coach's look: ${chainCore(c)}`;
}

/**
 * The match's biggest repeat a client sent ({ kind, rounds, beside }), held
 * to the checked chains: its rounds those whose chain carries the kind, the
 * beside count the chains' own. The client's sentence (insights.js
 * chainCounts main), from the server's words. Null where it does not hold.
 */
function mainWords(main, chains) {
  if (!main || typeof main !== 'object' || !KINDS[main.kind]) return null;
  const kindsOf = (c) => [c.first && c.first.kind, ...c.worse.map((w) => w.kind)].filter(Boolean);
  const has = chains.filter((c) => kindsOf(c).includes(main.kind)).map((c) => c.n);
  const sent = (Array.isArray(main.rounds) ? main.rounds : []).filter((n) => Number.isInteger(n));
  if (has.length < 2 || sent.length !== has.length || !sent.every((n) => has.includes(n))) return null;
  let tail = '.';
  const b = main.beside;
  if (b && KINDS[b.kind] && Number.isInteger(b.count) && b.count >= 2) {
    const real = chains.filter((c) => has.includes(c.n) && kindsOf(c).includes(b.kind)).length;
    if (real === b.count) tail = `, and in ${b.count} of those rounds also ${KINDS[b.kind].gerund}.`;
  }
  return `Your biggest repeat: ${KINDS[main.kind].gerund}, in ${has.length} rounds, ${roundList(has)}${tail}`;
}

module.exports = { rowsOfReview, rowsOfCards, memoryLines, earlierLines, chainWords, chainClause, chainCore, mainWords, kindWords,
  KINDS, LOOK_KINDS, RECORD_KINDS, CHAIN_KEYS, FIRST_KINDS, NO_ESCAPE_SEC, roundList };
