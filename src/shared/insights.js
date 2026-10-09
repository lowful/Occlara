'use strict';

/**
 * What one match says about the player, in three lists:
 *
 *   mistakes   the repeated ones, most serious first
 *   strengths  what went well
 *   missed     chances left on the table, one-offs included
 *
 * Every entry is ARITHMETIC over the round record, never a sentence the model
 * wrote, for the reason every review here gives: a confident wrong sentence
 * costs most after the match, when the player can only check it against a half
 * memory. The one model judgement that is counted is the death cause from
 * death-forensics, and it is counted only as a label from a closed list.
 *
 * EACH ENTRY HAS A FLOOR, stated beside it. "Repeated" means at least twice,
 * and a share of the deaths large enough that it is a habit rather than a
 * coincidence. A thin match shows fewer entries, which is the honest outcome.
 *
 * Entries carry a stable `key`, because the match library counts them across
 * matches (patterns.js). Renaming a key orphans every saved review that used it.
 *
 * Pure, no Electron, so the tests build them from the real fixtures.
 */

const { CAUSES, isAvoidable } = require('./death-causes');

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** "round 4", "rounds 2 and 9", "rounds 2, 5, 9 and 3 more". */
function roundList(ns) {
  if (!ns.length) return '';
  if (ns.length === 1) return `round ${ns[0]}`;
  const shown = ns.slice(0, 6);
  const rest = ns.length - shown.length;
  if (rest > 0) return `rounds ${shown.join(', ')} and ${rest} more`;
  return `rounds ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** How much each repeated mistake weighs when ranking them. */
const WEIGHT = {
  'first-death': 3,       // the round starts four against five
  'lost-advantage': 3,    // the team was ahead in numbers and gave it back
  'untraded': 2,          // nobody could answer the death
  'early': 1.5,
  'same-spot': 1.5,
  'same-killer': 1,
  'ult-held': 1,
};
const CAUSE_WEIGHT = 2;

/** The habit that fixes each death cause, in one line. */
const CAUSE_FIX = {
  'dry-peek': 'Use a flash, a drone or a teammate before you swing an angle.',
  'isolated': 'Play within trading distance of a teammate: close enough that they can swing the moment you die.',
  'repeek': 'After you are seen or get a kill, change angle. Never peek the same spot twice.',
  'crossfire': 'Clear one angle at a time. Smoke or flash off the second one before you step out.',
  'rotating': 'Rotate early or rotate through cover, and have your crosshair up while you move.',
  'overextend': 'Take the space your team can hold with you. Stop chasing kills past them.',
  'exposed': 'Plant or defuse from cover, with a smoke or a teammate covering you.',
};

/**
 * Valorant.
 *
 * @param rounds  reconciled rounds (valorant-verify) or ledger rows, each
 *                optionally carrying `forensics: { cause, what, better }`
 * @param opts    { role }
 */
function valorant(rounds, opts = {}) {
  const rows = Array.isArray(rounds) ? rounds : [];
  const out = { mistakes: [], strengths: [], missed: [] };
  if (rows.length < 3) return out;
  const role = opts.role || null;
  const deaths = rows.filter((r) => r.died);
  const verified = rows.filter((r) => r.verified);
  const push = (list, e) => list.push({ ...e, rounds: e.rounds || [], count: e.count != null ? e.count : (e.rounds || []).length });

  // ── Mistakes ──────────────────────────────────────────────────────────────
  // First to die. Every player is first sometimes; a Duelist's job makes it
  // more common, so the floor is higher for one.
  const firsts = verified.filter((r) => r.firstDeath).map((r) => r.n);
  const fdFloor = role === 'Duelist' ? 0.25 : 0.15;
  if (firsts.length >= 3 && firsts.length >= verified.length * fdFloor) {
    push(out.mistakes, {
      key: 'first-death', title: 'First to die',
      detail: `You were the first player down in ${plural(firsts.length, 'round')}, ${roundList(firsts)}, `
        + 'so your team played those rounds four against five.',
      rounds: firsts, weight: WEIGHT['first-death'],
      fix: 'Let a teammate or your utility make first contact. Take the second fight, the one you can trade.',
    });
  }

  // Died with the team ahead in numbers, and the round was lost.
  const thrown = verified.filter((r) => r.died && r.aliveAtDeath && r.aliveAtDeath.mates > r.aliveAtDeath.enemies
    && r.result === 'lost');
  if (thrown.length >= 2) {
    push(out.mistakes, {
      key: 'lost-advantage', title: 'Gave back the advantage',
      detail: `In ${roundList(thrown.map((r) => r.n))} your team was up in numbers when you died, and the round was lost.`,
      rounds: thrown.map((r) => r.n), weight: WEIGHT['lost-advantage'],
      fix: 'When your team is up in numbers, stop taking duels. Group, hold the space you have and make them come to you.',
    });
  }

  // Nobody traded the death. Needs the feed, so only rounds where it spoke.
  const knownTrade = deaths.filter((r) => typeof r.traded === 'boolean');
  const untraded = knownTrade.filter((r) => r.traded === false);
  if (untraded.length >= 3 && untraded.length * 10 >= knownTrade.length * 6) {
    push(out.mistakes, {
      key: 'untraded', title: 'Died where nobody could trade',
      detail: `${untraded.length} of your ${plural(knownTrade.length, 'death')} went unanswered: no teammate killed your killer `
        + 'within five seconds.',
      rounds: untraded.map((r) => r.n), weight: WEIGHT.untraded,
      fix: 'Before you swing, check someone can see the same angle. If nobody can, wait or reposition.',
    });
  }

  // Early deaths. A Duelist entering dies early by design, so for one this
  // needs to be most of their deaths before it reads as a habit.
  const early = deaths.filter((r) => r.early);
  const earlyShare = role === 'Duelist' ? 0.7 : 0.4;
  if (early.length >= 3 && early.length >= deaths.length * earlyShare) {
    push(out.mistakes, {
      key: 'early', title: 'Dying in the first 30 seconds',
      detail: `${early.length} of your ${plural(deaths.length, 'death')} came in the first 30 seconds, before any plant.`,
      rounds: early.map((r) => r.n), weight: WEIGHT.early,
      fix: 'Slow the first 30 seconds down: clear one angle at a time and let information come to you.',
    });
  }

  // The same place.
  const spots = new Map();
  for (const r of deaths) {
    if (!r.deathSpot) continue;
    const k = r.deathSpot.toLowerCase();
    const e = spots.get(k) || { name: r.deathSpot, rounds: [] };
    e.rounds.push(r.n);
    spots.set(k, e);
  }
  const placed = deaths.filter((r) => r.deathSpot).length;
  const top = [...spots.values()].sort((a, b) => b.rounds.length - a.rounds.length)[0];
  if (top && top.rounds.length >= 3 && top.rounds.length * 10 >= placed * 3) {
    push(out.mistakes, {
      key: 'same-spot', title: `Dying at ${top.name}`,
      detail: `${top.rounds.length} of the deaths the coach could place were at ${top.name}, ${roundList(top.rounds)}. `
        + 'They know you play there.',
      rounds: top.rounds, weight: WEIGHT['same-spot'], place: top.name,
      fix: `Change your position at ${top.name} each round, or play one step off where they expect you.`,
    });
  }

  // The same killer, three times and a quarter of the deaths.
  const byKiller = new Map();
  for (const r of deaths) if (r.killerAgent) byKiller.set(r.killerAgent, [...(byKiller.get(r.killerAgent) || []), r.n]);
  const topKiller = [...byKiller.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topKiller && topKiller[1].length >= 3 && topKiller[1].length * 4 >= deaths.length) {
    push(out.mistakes, {
      key: 'same-killer', title: `${topKiller[0]} kept winning`,
      detail: `${topKiller[0]} killed you ${times(topKiller[1].length)}, ${roundList(topKiller[1])}.`,
      rounds: topKiller[1], weight: WEIGHT['same-killer'], agent: topKiller[0],
      fix: `Track where their ${topKiller[0]} plays, then fight them with a teammate or with utility, never alone.`,
    });
  }

  // The coach's look at the deaths: a cause from the closed list, twice or more.
  const byCause = new Map();
  for (const r of deaths) {
    const c = r.forensics && r.forensics.cause;
    if (!c || !isAvoidable(c)) continue;
    byCause.set(c, [...(byCause.get(c) || []), r.n]);
  }
  for (const [cause, ns] of byCause) {
    if (ns.length < 2) continue;
    push(out.mistakes, {
      key: `cause:${cause}`, title: CAUSES[cause].title,
      detail: `The coach looked at the moment before ${plural(ns.length, 'death')} and saw the same thing: `
        + `${CAUSES[cause].detail}, ${roundList(ns)}.`,
      rounds: ns, weight: CAUSE_WEIGHT, judged: true, fix: CAUSE_FIX[cause] || null,
    });
  }

  out.mistakes.sort((a, b) => b.weight * b.count - a.weight * a.count);

  // ── Strengths ─────────────────────────────────────────────────────────────
  const openers = verified.filter((r) => r.firstKill).map((r) => r.n);
  if (openers.length >= 3) {
    push(out.strengths, {
      key: 'first-kill', title: 'Opened rounds',
      detail: `You got the first kill of the round ${times(openers.length)}, ${roundList(openers)}.`,
      rounds: openers,
    });
  }
  const multi = verified.filter((r) => typeof r.kills === 'number' && r.kills >= 3);
  if (multi.length >= 2) {
    push(out.strengths, {
      key: 'multi-kill', title: 'Multi kill rounds',
      detail: `Three or more kills in ${plural(multi.length, 'round')}, ${roundList(multi.map((r) => r.n))}.`,
      rounds: multi.map((r) => r.n),
    });
  }
  const tradeRounds = verified.filter((r) => typeof r.trades === 'number' && r.trades > 0);
  const tradeCount = tradeRounds.reduce((a, r) => a + r.trades, 0);
  if (tradeCount >= 3) {
    push(out.strengths, {
      key: 'trades', title: 'Traded your teammates',
      detail: `You killed the player who had just killed a teammate ${times(tradeCount)}.`,
      rounds: tradeRounds.map((r) => r.n), count: tradeCount,
    });
  }
  const clutchWon = verified.filter((r) => r.clutch && r.clutch.won === true && r.clutch.vs >= 1);
  if (clutchWon.length >= 1) {
    push(out.strengths, {
      key: 'clutch', title: 'Won as the last one standing',
      detail: clutchWon.map((r) => `Round ${r.n}, one against ${r.clutch.vs}`).join('. ') + '.',
      rounds: clutchWon.map((r) => r.n),
    });
  }
  const decided = rows.filter((r) => r.result && r.side);
  const post = decided.filter((r) => r.planted && r.side === 'attacking');
  const postWon = post.filter((r) => r.result === 'won');
  if (post.length >= 3 && postWon.length * 10 >= post.length * 6) {
    push(out.strengths, {
      key: 'postplant', title: 'Closed out post plants',
      detail: `Won ${postWon.length} of ${post.length} attack rounds once the spike was down.`,
      rounds: postWon.map((r) => r.n),
    });
  }
  const retakes = decided.filter((r) => r.planted && r.side === 'defending');
  const retakeWon = retakes.filter((r) => r.result === 'won');
  if (retakes.length >= 3 && retakeWon.length * 2 >= retakes.length) {
    push(out.strengths, {
      key: 'retake', title: 'Won retakes',
      detail: `Won ${retakeWon.length} of ${retakes.length} defence rounds after they planted.`,
      rounds: retakeWon.map((r) => r.n),
    });
  }
  // Survival, only where Riot says who lived: the screen cannot.
  const lived = verified.filter((r) => !r.died);
  if (verified.length >= 6 && lived.length * 10 >= verified.length * 4) {
    push(out.strengths, {
      key: 'survived', title: 'Stayed alive',
      detail: `You survived ${lived.length} of ${plural(verified.length, 'round')}.`,
      rounds: lived.map((r) => r.n),
    });
  }

  // ── Missed ────────────────────────────────────────────────────────────────
  const heldUlt = deaths.filter((r) => r.ultAtDeath === 'ready');
  if (heldUlt.length >= 1) {
    push(out.missed, {
      key: 'ult-held', title: 'Died holding your ultimate',
      detail: `Your ultimate was ready when you died in ${roundList(heldUlt.map((r) => r.n))}.`,
      fix: 'Check your ultimate at every buy phase and plan the round it goes in.',
      rounds: heldUlt.map((r) => r.n),
    });
  }
  if (thrown.length === 1) {
    const r = thrown[0];
    push(out.missed, {
      key: 'lost-advantage', title: 'An advantage given back',
      detail: `Round ${r.n}: ${r.aliveAtDeath.mates} against ${r.aliveAtDeath.enemies} when you died, and the round was lost.`,
      rounds: [r.n],
    });
  }
  const clutchLost = verified.filter((r) => r.clutch && r.clutch.won === false && r.clutch.vs === 1);
  if (clutchLost.length >= 1) {
    push(out.missed, {
      key: 'one-v-one', title: 'One against one, lost',
      detail: `${roundList(clutchLost.map((r) => r.n))}: the round came down to you and one of them.`,
      rounds: clutchLost.map((r) => r.n),
    });
  }
  if (post.length >= 3 && postWon.length * 10 < post.length * 4) {
    push(out.missed, {
      key: 'postplant-lost', title: 'Post plants that slipped',
      detail: `Won only ${postWon.length} of ${post.length} attack rounds with the spike down.`,
      fix: 'After the plant, hold angles on the spike from cover instead of looking for fights.',
      rounds: post.filter((r) => r.result === 'lost').map((r) => r.n),
    });
  }
  // The coach's better play for each death it looked at, as a miss per round.
  for (const r of deaths) {
    const f = r.forensics;
    if (!f || !f.better || !isAvoidable(f.cause)) continue;
    if ((byCause.get(f.cause) || []).length >= 2) continue;   // already a repeated mistake
    push(out.missed, {
      // The title is the cause alone, never the round: the library counts this
      // key across matches, and "Round 3" means nothing in the next one.
      key: `cause:${f.cause}`, title: CAUSES[f.cause].title,
      detail: `Round ${r.n}: ${f.what || f.better}`, fix: f.better, rounds: [r.n], judged: true,
    });
  }
  return out;
}

/**
 * Marvel Rivals, from the computed review: this match against the player's own
 * role and hero average. Only metrics that HAVE a baseline speak, and a move of
 * under 15% is noise at ten matches.
 */
function rivals(review) {
  const out = { mistakes: [], strengths: [], missed: [] };
  if (!review || review.empty) return out;
  for (const a of review.against || []) {
    if (!a.baseline || a.better === null) continue;
    const move = Math.abs(a.delta) / Math.abs(a.baseline);
    if (move < 0.15) continue;
    const pctMove = Math.round(move * 100);
    const scope = a.scope === 'hero' ? `your ${review.game.hero || 'hero'} average` : `your ${review.game.role || 'role'} average`;
    // UP AND DOWN ARE THE NUMBER'S, never the verdict's. Taken from `better`,
    // a player who died less than usual read "Deaths up 38%", because fewer
    // deaths is the better way for that one.
    const entry = {
      key: `vs:${a.id}`, title: `${a.label} ${a.delta > 0 ? 'up' : 'down'} ${pctMove}%`,
      detail: `${a.label} ${fmt(a.value)} against ${scope} of ${fmt(a.baseline)}, over ${plural(a.games, 'match', 'matches')}.`,
      rounds: [], count: 1,
    };
    (a.better ? out.strengths : out.mistakes).push({ ...entry, weight: pctMove / 10 });
  }
  out.mistakes.sort((a, b) => b.weight - a.weight);
  const s = review.scoreline || {};
  if (typeof s.deaths === 'number' && typeof s.kills === 'number' && s.deaths >= 8 && s.deaths > s.kills + (s.assists || 0) / 2) {
    out.missed.push({ key: 'deaths-heavy', title: 'More deaths than fights won',
      detail: `${plural(s.deaths, 'death')} against ${plural(s.kills, 'kill')} and ${plural(s.assists || 0, 'assist')}. Every death is a respawn walk your team plays short.`,
      rounds: [], count: 1 });
  }
  return out;
}
const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100));

/**
 * League of Legends, from the computed review: the skills the grader judged
 * against the player's own baseline, and the death story the recorder saw.
 */
function lol(review) {
  const out = { mistakes: [], strengths: [], missed: [] };
  if (!review) return out;
  const lessons = require('./lol-lessons');
  for (const s of review.scored || []) {
    const m = lessons.metric(s.metric);
    const label = (m && m.label) || s.skill;
    const detail = typeof s.measured === 'number' && typeof s.baseline === 'number'
      ? `${label}: ${fmt(s.measured)} this game, against your average of ${fmt(s.baseline)}.` : label;
    const entry = { key: `skill:${s.skill}`, title: label, detail, rounds: [], count: 1 };
    if (s.verdict === 'pass') out.strengths.push(entry);
    else if (s.verdict === 'fail') out.mistakes.push({ ...entry, weight: 2 });
  }
  const f = review.fights || {};
  const total = typeof f.deaths === 'number' ? f.deaths : 0;
  if (total >= 3 && (f.caughtAlone || 0) * 10 >= total * 4) {
    out.mistakes.push({ key: 'caught-alone', title: 'Caught alone',
      detail: `${f.caughtAlone} of your ${plural(total, 'death')} happened with no ally dying anywhere near.`, rounds: [], count: f.caughtAlone, weight: 3 });
  }
  if (total >= 3 && (f.joinedLost || 0) * 10 >= total * 4) {
    out.mistakes.push({ key: 'joined-lost', title: 'Walked into lost fights',
      detail: `${f.joinedLost} of your ${plural(total, 'death')} came after an ally had already died there.`, rounds: [], count: f.joinedLost, weight: 2.5 });
  }
  out.mistakes.sort((a, b) => b.weight * b.count - a.weight * a.count);
  const o = review.objectives || {};
  const lost = (o.dragonsAgainst || 0) + (o.baronsAgainst || 0);
  if (lost >= 3) {
    // "2 dragons and 1 barons" and "3 dragons and 0 barons" both reached the
    // list: the recorder fills both counts, so a zero is left out of the
    // sentence rather than read out.
    const took = [[o.dragonsAgainst, 'dragon'], [o.baronsAgainst, 'baron']]
      .filter(([n]) => n > 0).map(([n, what]) => plural(n, what));
    out.missed.push({ key: 'objectives-lost', title: 'Objectives conceded',
      detail: `The enemy took ${took.join(' and ')}.`, rounds: [], count: lost });
  }
  return out;
}

/**
 * A REPEAT ACROSS MATCHES IS NOT ONE MATCH'S TITLE. Three entries are named
 * from one match's specifics: "Dying at A Site", "Skye kept winning", and a
 * Rivals comparison carrying that match's percentage ("Kills down 52%"). Counted
 * across matches under the newest one's title, "Dying at B Main, in 3 of your
 * last 3" was printed when only one of those deaths was at B Main. This is
 * the title and fix a count across matches may carry: the newest specific
 * one when every sighting names the same place or agent, otherwise one that
 * is true of all of them. A Rivals comparison keeps only its direction.
 *
 * @param key        the insight key
 * @param list       'mistakes' | 'strengths' | 'missed'
 * @param newest     the newest sighting ({ title, fix })
 * @param specifics  the distinct places or agents its sightings named (case folded)
 */
function repeatTitle(key, list, newest, specifics) {
  const one = specifics && specifics.size <= 1;
  if (key === 'same-spot' && !one) {
    return { title: 'Dying at the same spot', fix: 'Change your position each round, or play one step off where they expect you.' };
  }
  if (key === 'same-killer' && !one) {
    return { title: 'One enemy agent kept winning',
      fix: 'Track where their strongest player plays, then fight them with a teammate or with utility, never alone.' };
  }
  if (String(key).startsWith('vs:')) {
    // Lazily: the Rivals review loads its game data, and only Rivals needs it.
    const { METRICS } = require('./rivals-review');
    const id = String(key).slice(3);
    const m = (METRICS || []).find((x) => x.id === id);
    const label = m ? m.label : id.charAt(0).toUpperCase() + id.slice(1);
    const good = list === 'strengths';
    const higher = m && m.lowerIsBetter ? !good : good;
    return { title: `${label} ${higher ? 'above' : 'below'} your average`, fix: newest.fix || null };
  }
  return { title: newest.title, fix: newest.fix || null };
}

/**
 * The place or agent an entry is named after, case folded, or null. A place
 * is a place on one map (A Site exists on nearly every map), so the map the
 * match was played on is part of it.
 */
function specificOf(e, map) {
  if (!e) return null;
  if (e.key === 'same-spot') {
    const place = String(e.place || e.title || '').trim().toLowerCase();
    return place ? `${String(map || '').trim().toLowerCase()}:${place}` : null;
  }
  if (e.key === 'same-killer') return String(e.agent || e.title || '').trim().toLowerCase() || null;
  return null;
}

module.exports = { valorant, rivals, lol, roundList, repeatTitle, specificOf, WEIGHT };
