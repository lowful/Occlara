'use strict';

/**
 * Should this player switch, and why.
 *
 * The one line of advice a hero shooter can give that a Valorant coach cannot:
 * you picked wrong for what you are looking at, and you can fix it at the next
 * respawn. That is worth saying, and it is worth saying RARELY, which is what
 * most of the rules below are actually for.
 *
 * FOUR THINGS IT WILL NOT DO:
 *
 * 1. It will not speak about a hero it does not know. rivals-heroes.js is
 *    deliberately partial and returns null for anything unverified, and every
 *    rule here treats null as "say nothing". A confident switch call about a
 *    flyer who is not flying is worse than silence.
 * 2. It will not fire on one enemy. A single hitscan pick is the normal state
 *    of a match; two of them aiming at you is a reason to move.
 * 3. It will not tell you to switch off a hero you are winning on. Impact beats
 *    theory, so a positive scoreline suppresses the call entirely.
 * 4. It will not repeat. Once per match per reason, because a coach who says it
 *    twice is nagging and a player who ignored it once has decided.
 */

const heroes = require('./rivals-heroes');
const { ARCHETYPES } = require('./rivals-knowledge');

/** Two of a thing is a pattern; one is a coincidence. */
const PATTERN = 2;

/**
 * Heroes who can switch a diver's mobility OFF, and the ability that does it.
 *
 * NAMED BY MECHANISM, NOT BY MATCHUP. "The Thing counters Black Panther" is a
 * tier list entry: unarguable, unteachable, and stale the moment a patch lands.
 * "Yancy Street Charge leaves a zone that prevents the use of mobility
 * abilities, and Panther's escape IS a mobility ability" is a fact about the
 * game that a player can act on and check.
 *
 * WHY THIS BEATS DIVE SPECIFICALLY. A dive hero's damage and their escape are
 * the same button. Black Panther's Spirit Rend refreshes off the Vibranium Mark
 * his lunges apply, so he chains as long as marks keep landing; deny the lunge
 * and he is standing still at 150 base health. Spider-Man's exit is Web-Swing.
 * Inside a lockout zone neither has a way out, and neither has the health to go
 * without one. Nothing about that is true of a poke or brawl hero, who were
 * never leaving in the first place.
 *
 * EVERY ability name and quoted effect here comes from the generated data, which
 * comes from the game's own hero pages, and check:rivalsknowledge fails if one
 * stops matching. That is not ceremony: Dexerto and TheGamer both call The
 * Thing's ability "Earthbound", a string that appears on none of the 54 official
 * pages. Two reputable outlets, same wrong name, and a coach naming it that way
 * would be confidently wrong about the one fact it was built to get right.
 *
 * The Punisher is deliberately ABSENT. Culling Turret contains the word
 * "grounds", and it grounds Punisher himself while he mans it. A text search for
 * anti-dive tools finds it; a reader does not.
 */
const MOBILITY_LOCKOUT = [
  { hero: 'the thing',       ability: 'Yancy Street Charge',
    quote: 'prevents the use of mobility abilities',
    does:  'leaves a zone that turns your dash off' },
  { hero: 'namor',           ability: 'Horn of Proteus',
    quote: 'disabling their mobility abilities',
    does:  'disables your mobility where Giganto lands' },
  { hero: 'hulk',            ability: 'Radioactive Lockdown',
    quote: 'immobilize',
    does:  'immobilises you and blocks your abilities' },
  { hero: 'peni parker',     ability: 'Cyber-Web Snare',
    quote: 'Immobilizes',
    does:  'immobilises you on contact, over her mines' },
  { hero: 'mister fantastic', ability: 'Distended Grip',
    quote: 'Immobilized',
    does:  'entangles you and pulls you back out' },
  { hero: 'elsa bloodstone', ability: 'Prehistoric Trap',
    quote: 'Immobilizes',
    does:  'is set before you arrive and immobilises you' },
];


/** The lockout heroes on a given enemy list, with the reason each one matters. */
function lockoutsAmong(enemies) {
  const seen = new Set((enemies || []).map((e) => {
    const t = heroes.traits(e);
    return t ? t.name : null;
  }).filter(Boolean));
  return MOBILITY_LOCKOUT.filter((l) => seen.has(l.hero));
}

/**
 * @param {object} p
 * @param {string} p.mine        the hero the player is on
 * @param {string[]} p.enemies   enemy heroes read off the scoreboard or feed
 * @param {object} [p.score]     { kills, deaths } this life or this match
 * @returns {{reason: string, text: string}|null}
 */
function switchAdvice(p) {
  const me = heroes.traits(p && p.mine);
  if (!me) return null;                       // unknown hero, say nothing

  const enemy = (p.enemies || [])
    .map((n) => heroes.traits(n))
    .filter(Boolean);                          // unknown enemies simply do not count
  if (!enemy.length) return null;

  // Doing well beats any theory about matchups.
  const s = p.score || {};
  const winning = Number(s.kills) >= Number(s.deaths) + 2;
  if (winning) return null;

  /*
   * ── A named mechanical counter, FIRST ───────────────────────────────────
   *
   * This runs ahead of the archetype rules because it is a better sentence. The
   * rules below say a shape loses to a shape, which is true and general. This
   * one says a specific ability turns your escape off, names it, and quotes what
   * it does, so a player can go and look.
   *
   * ONE is enough here, where the archetype rules need two or three. Those count
   * a pattern because any single hitscan pick is the normal state of a match.
   * This is not a pattern, it is a hard interaction: one Thing on the field is
   * the whole reason a Panther dive does not come back.
   */
  if (me.arch === 'dive') {
    const locks = lockoutsAmong(p.enemies);
    if (locks.length) {
      const l = locks[0];
      return {
        reason: 'mobility-lockout',
        // Kept inside the 22 word tip contract, and it ends on the action.
        // Naming the ability is the point: it is the thing the player can go
        // and look up, where "they counter you" is only a mood.
        text: `${title(l.hero)} has ${l.ability}, which ${l.does}. Go in once it is spent.`,
      };
    }
  }

  // ── Flying into hitscan ────────────────────────────────────────────────
  // The clearest counter in the game and the one worth leading with: a flyer
  // is a large target on a predictable path with nothing to hide behind.
  if (me.air === 'flight') {
    const hitscan = enemy.filter((e) => e.aim === 'hitscan');
    if (hitscan.length >= PATTERN) {
      return {
        reason: 'flight-into-hitscan',
        text: `${cap(hitscan.length)} hitscan on the enemy team and you are in the air. `
            + `Stay behind cover or switch, a flyer is a free target for ${list(hitscan)}.`,
      };
    }
  }

  // ── Diving into a brawl ────────────────────────────────────────────────
  // Straight out of ARCHETYPES: a diver reaches an isolated target, but a
  // brawl team stands close enough to punish the dive together.
  if (me.arch === 'dive') {
    const brawl = enemy.filter((e) => e.arch === 'brawl');
    if (brawl.length >= 3) {
      return {
        reason: 'dive-into-brawl',
        text: `They are grouped for a brawl, so diving in alone gets you traded. `
            + `${ARCHETYPES.dive.losesTo === 'brawl' ? 'Dive loses to brawl' : 'Dive is the wrong shape here'}, `
            + `go in with a teammate or pick something that fights at range.`,
      };
    }
  }

  // ── Poking a dive comp ─────────────────────────────────────────────────
  // The mirror of the rule above, and the reason it is worth having both: a
  // poke player standing apart is exactly what a dive comp is looking for.
  if (me.arch === 'poke') {
    const dive = enemy.filter((e) => e.arch === 'dive');
    if (dive.length >= 3) {
      return {
        reason: 'poke-into-dive',
        text: `Three divers are hunting the backline and you are playing at range. `
            + `Hold an angle near your Vanguard, ${list(dive)} will find you alone.`,
      };
    }
  }

  return null;
}

function cap(n) { return n === 2 ? 'Two' : n === 3 ? 'Three' : String(n); }

function list(hs) {
  const names = hs.map((h) => title(h.name));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function title(n) {
  return String(n).replace(/(^|[\s\-&])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/**
 * A once-per-match gate over switchAdvice.
 *
 * Kept next to the advice rather than in the engine because "have I already
 * said this" is part of what makes the call worth listening to.
 */
function createSwitchGate() {
  const said = new Set();
  return {
    advise(p) {
      const a = switchAdvice(p);
      if (!a || said.has(a.reason)) return null;
      said.add(a.reason);
      return a;
    },
    reset() { said.clear(); },
    get saidCount() { return said.size; },
  };
}

module.exports = { switchAdvice, createSwitchGate, PATTERN, title,
  MOBILITY_LOCKOUT, lockoutsAmong };
