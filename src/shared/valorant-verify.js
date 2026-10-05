'use strict';

/**
 * Check the screen's round ledger against Riot's record of the same match.
 *
 * THE SCREEN IS WRONG IN WAYS ONLY RIOT CAN SHOW. On the real 24 round Abyss
 * match in scripts/fixtures the ledger read 22 deaths where Riot has 21 (an
 * invented one in round 17), and put 6 deaths in the first 30 seconds where
 * Riot puts 19 of 21 there. That second one is the spectator trap: the instant
 * a player dies the HUD becomes a teammate's, alive at 100 health, so the coach
 * believes the player lived another thirty seconds. A review built on that
 * tells an entry player their problem is mid round positioning.
 *
 * So when the match links, Riot decides every fact it records exactly:
 *
 *   died or not, and when, to the second
 *   which agent killed them, and with what
 *   whether they were the first death of the round, or got the first kill
 *   their kills in the round, who won it, which side they were on
 *   whether the spike went down
 *
 * The screen keeps only what Riot does not record: where the player was, the
 * ultimate icon, and what the coach said at the time. A screen death spot is
 * kept only in a round Riot confirms a death, and a plant site only in a round
 * Riot says was planted.
 *
 * AND THE COACH'S OWN READS ARE CHECKED. A death review in a round Riot says
 * the player survived is dropped, and so is one naming a killer Riot says did
 * not kill them. "You died to Viper" when Skye killed you is a confident wrong
 * sentence in the one place the player is most likely to check it.
 *
 * Pure, so the tests run it against the real fixture and Riot's real record.
 */

let AGENTS = [];
try {
  const d = require('./valorant-data.generated.json');
  AGENTS = Object.keys(d.agents || {});
} catch {
  AGENTS = [];
}

/** The agent a read names as the killer, or null. Plain string search, no regex. */
function namedKiller(text) {
  const t = String(text || '').toLowerCase();
  for (const agent of AGENTS) {
    const a = agent.toLowerCase();
    if (t.includes(`died to ${a}`) || t.includes(`killed by ${a}`) || t.includes(`${a} killed you`)
        || t.includes(`${a} caught you`) || t.includes(`died to an enemy ${a}`)) {
      return agent;
    }
  }
  return null;
}

const same = (a, b) => String(a || '').toLowerCase().replace(/[^a-z]/g, '')
  === String(b || '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * @param rounds  ledger.list() rows
 * @param riot    the /api/coach/match-rounds reply: { perRound: [...] }
 * @returns { rounds, checks }
 */
function reconcile(rounds, riot) {
  const per = Array.isArray(riot && riot.perRound) ? riot.perRound : [];
  if (!per.length) return { rounds, checks: null };

  const ledger = rounds || [];
  const byN = new Map(ledger.map((r) => [r.n, r]));
  const riotN = new Set(per.map((rr) => rr.n));
  /*
   * THE CHECK IS PER ROUND, AND ONLY OVER THE ROUNDS THE COACH WATCHED. It used
   * to compare two totals: every death the screen read against every death in
   * Riot's record. A session started in round 15 of the real Abyss match then
   * read "the screen read 9 deaths and Riot has 21", twelve deaths the screen
   * was never in a position to see, and a death filed one round late (the
   * banner lag) left both totals equal, so the line said Riot confirmed every
   * death while it had moved one.
   */
  const checks = {
    watched: 0,          // rounds the coach watched that Riot has
    screenDeaths: 0,     // deaths the screen read in them
    riotDeaths: 0,       // Riot's deaths in those same rounds
    agreed: 0,           // rounds both have a death in
    invented: [],        // rounds the screen called a death and Riot did not
    missed: [],          // rounds Riot has a death the screen did not see
    readsDropped: 0,     // coach reads Riot contradicts
    roundsAdded: 0,      // rounds Riot has that the coach never watched
  };
  // A death in a round Riot does not have at all, past the final score, is
  // one Riot does not confirm either.
  for (const r of ledger) {
    if (riotN.has(r.n) || !r.died) continue;
    checks.screenDeaths++;
    checks.invented.push(r.n);
  }

  // RIOT'S PLANT, WHEN ITS RECORD HAS PLANTS. Riot sets the flag on every
  // round, so a round it says was not planted was not, and the screen's plant
  // there was a banner read of the round before (valorant-rounds.js). The OR
  // that used to sit here kept every one of them. Only a record with no plant
  // in any round falls back to the screen, because that is also what a renamed
  // field in Riot's payload looks like.
  const riotPlants = per.some((rr) => rr.planted === true);
  // THE KILL FEED, ROUND BY ROUND. Riot's names are stripped before the record
  // leaves the server, but each kill still says which side it was by and on,
  // and teamworkOf() counts nobody in a round where one kill could not be
  // placed. That is what makes "no trade" a fact rather than a missing number,
  // and what a match with few deaths needs to be graded on its feed at all.
  const feedSeen = per.some((rr) => Array.isArray(rr.feed) && rr.feed.length > 0);
  const feedOf = (rr) => (feedSeen && Array.isArray(rr.feed)
    ? rr.feed.every((k) => !!(k && k.by && k.on)) : null);

  const merged = per.map((rr) => {
    const r = byN.get(rr.n);
    if (r) {
      checks.watched++;
      if (r.died) checks.screenDeaths++;
      if (rr.died) checks.riotDeaths++;
      if (r.died && rr.died) checks.agreed++;
      if (r.died && !rr.died) checks.invented.push(rr.n);
      if (rr.died && !r.died) checks.missed.push(rr.n);
    } else {
      checks.roundsAdded++;
    }
    const feedKnown = feedOf(rr);
    const planted = riotPlants ? rr.planted === true : !!(r && r.planted);

    const reads = [];
    for (const x of (r ? r.reads : [])) {
      if (x.death && !rr.died) { checks.readsDropped++; continue; }
      const named = namedKiller(x.text);
      if (named && rr.killerAgent && !same(named, rr.killerAgent)) { checks.readsDropped++; continue; }
      reads.push(x);
    }

    const sec = rr.died && typeof rr.deathMs === 'number' ? Math.round(rr.deathMs / 1000) : null;
    return {
      n: rr.n,
      side: rr.side || (r && r.side) || null,
      result: rr.won === true ? 'won' : rr.won === false ? 'lost' : (r ? r.result : null),
      died: !!rr.died,
      // Whether the screen filed a death in this round itself. The frame
      // picker needs it: only a death the screen registered has a frame that
      // registered it (death-frames.js).
      screenDied: !!(r && r.died),
      deathSpot: rr.died && r ? r.deathSpot : null,
      deathSec: sec,
      // Kept in the ledger's own unit so every existing reader of deathClock
      // still works: seconds LEFT on a 100 second round.
      deathClock: sec !== null ? Math.max(0, 100 - sec) : null,
      early: !!rr.died && !rr.afterPlant && sec !== null && sec <= 30,
      ultAtDeath: rr.died && r ? r.ultAtDeath : null,
      ultSeen: r ? r.ultSeen : null,
      planted,
      // The site is the screen's, and only in a round that was planted.
      plantSpot: planted && r ? r.plantSpot : null,
      locs: r ? r.locs.slice() : [],
      reads,
      frames: r ? r.frames : 0,
      watched: !!r,
      verified: true,
      kills: typeof rr.kills === 'number' ? rr.kills : null,
      killerAgent: rr.killerAgent || null,
      weapon: rr.weapon || null,
      firstDeath: !!rr.firstDeath,
      firstKill: !!rr.firstKill,
      // From Riot's kill feed, null when the feed could not say (a record
      // fetched before the server parsed teamwork has none of these). The
      // server sends trades as 0 when it could not place a kill, which is not
      // a count, so it is only kept where the round's feed was read whole.
      feedKnown,
      traded: typeof rr.traded === 'boolean' ? rr.traded : null,
      trades: typeof rr.trades === 'number' && feedKnown !== false ? rr.trades : null,
      aliveAtDeath: rr.aliveAtDeath && typeof rr.aliveAtDeath.mates === 'number' ? rr.aliveAtDeath : null,
      clutch: rr.clutch && typeof rr.clutch.vs === 'number' ? rr.clutch : null,
      afterPlant: !!rr.afterPlant,
    };
  });

  checks.invented.sort((a, b) => a - b);
  return { rounds: merged, checks };
}

/** "round 6", "rounds 6 and 17", "rounds 2, 6 and 17". */
function roundsText(ns) {
  if (ns.length === 1) return `round ${ns[0]}`;
  return `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}
const deathsText = (n) => (n === 0 ? 'no deaths' : n === 1 ? '1 death' : `${n} deaths`);

/**
 * One line a player can read about what the check changed.
 *
 * WORDED FROM THE ROUNDS, NEVER FROM THE TWO TOTALS. Equal totals said "Riot
 * confirms all 2 deaths the screen read" over a match where Riot rejected one
 * and the screen had missed another, which is the one sentence on the page
 * written to say what the check corrected. And it is scoped to the rounds the
 * coach watched, because a session started partway is the normal way the app
 * is used and Riot's other rounds are no fault of the screen's.
 */
function describe(checks) {
  if (!checks) return null;
  if (!checks.watched) {
    return "Checked against Riot's record of the match: the coach watched none of its rounds, so every round here is Riot's.";
  }
  const S = checks.screenDeaths;
  const R = checks.riotDeaths;
  const I = checks.invented;
  const M = checks.missed;
  const w = checks.watched;
  const scope = checks.roundsAdded > 0 ? `the ${w === 1 ? 'one round' : `${w} rounds`} the coach watched` : 'the match';
  let deaths;
  if (!I.length && !M.length) {
    deaths = S === 0 ? 'the screen read no deaths, and Riot has none either'
      : S === 1 ? 'Riot confirms the one death the screen read'
        : `Riot confirms all ${S} deaths the screen read`;
  } else if (R === 0) {
    deaths = `the screen read ${deathsText(S)}, in ${roundsText(I)}, and Riot has none`;
  } else if (S === 0) {
    deaths = `the screen read no deaths and Riot has ${R}, in ${roundsText(M)}`;
  } else {
    const where = [];
    if (I.length) where.push(`none in ${roundsText(I)}`);
    if (M.length) {
      where.push(M.length === 1 ? `one in round ${M[0]} the screen missed` : `deaths in ${roundsText(M)} the screen missed`);
    }
    deaths = `the screen read ${deathsText(S)} and Riot has ${R}, with ${where.join(' and ')}`;
  }
  const n = checks.readsDropped;
  const reads = n === 1 ? " Riot contradicts one of the coach's reads, so it is hidden."
    : n > 1 ? ` Riot contradicts ${n} of the coach's reads, so they are hidden.` : '';
  return `Checked against Riot's record of ${scope}: ${deaths}.${reads}`;
}

module.exports = { reconcile, describe, namedKiller };
