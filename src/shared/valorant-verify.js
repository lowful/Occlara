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
 *
 * The screen keeps only what Riot does not record: where the player was, the
 * ultimate icon, and what the coach said at the time. A screen death spot is
 * kept only in a round Riot confirms a death.
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

  const byN = new Map((rounds || []).map((r) => [r.n, r]));
  const checks = {
    screenDeaths: (rounds || []).filter((r) => r.died).length,
    riotDeaths: per.filter((r) => r.died).length,
    invented: [],        // rounds the screen called a death and Riot did not
    missed: [],          // rounds Riot has a death the screen did not see
    readsDropped: 0,     // coach reads Riot contradicts
    roundsAdded: 0,      // rounds Riot has that the coach never watched
  };

  const merged = per.map((rr) => {
    const r = byN.get(rr.n);
    if (r && r.died && !rr.died) checks.invented.push(rr.n);
    if (rr.died && r && !r.died) checks.missed.push(rr.n);
    if (!r) checks.roundsAdded++;

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
      deathSpot: rr.died && r ? r.deathSpot : null,
      deathSec: sec,
      // Kept in the ledger's own unit so every existing reader of deathClock
      // still works: seconds LEFT on a 100 second round.
      deathClock: sec !== null ? Math.max(0, 100 - sec) : null,
      early: !!rr.died && !rr.afterPlant && sec !== null && sec <= 30,
      ultAtDeath: rr.died && r ? r.ultAtDeath : null,
      ultSeen: r ? r.ultSeen : null,
      planted: !!rr.planted || !!(r && r.planted),
      plantSpot: r ? r.plantSpot : null,
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
    };
  });

  return { rounds: merged, checks };
}

/** One line a player can read about what the check changed. */
function describe(checks) {
  if (!checks) return null;
  const bits = [];
  if (checks.screenDeaths !== checks.riotDeaths) {
    bits.push(`the screen read ${checks.screenDeaths} deaths and Riot has ${checks.riotDeaths}`);
  } else {
    bits.push(`Riot confirms all ${checks.riotDeaths} deaths the screen read`);
  }
  if (checks.readsDropped) {
    bits.push(`${checks.readsDropped} of the coach's reads contradicted Riot and are hidden`);
  }
  return `Checked against Riot's record of the match: ${bits.join(', and ')}.`;
}

module.exports = { reconcile, describe, namedKiller };
