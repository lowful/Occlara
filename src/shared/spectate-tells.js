'use strict';

/**
 * Is the HUD on screen the player's own, or a teammate's?
 *
 * WHY THIS EXISTS. Valorant puts you on a teammate's camera the instant you die,
 * so the health, the weapon and the abilities in the same corner of the screen
 * become THEIRS. Every guard in the coach that reasons "a readable health number
 * means the player is alive" is then reading somebody else's health.
 *
 * That is not hypothetical. In a real graded session the player's genuine first
 * death was rejected twice with "said the player was dead while they were alive
 * at 100 HP". The frames leading into it read, in order:
 *
 *     own HP 100 and Ghost bottom center      <- really theirs
 *     own HP 100 and Bandit bottom center     <- weapon changed mid round
 *     own HP 19 and Sova abilities bottom center
 *     Spectating iggly, teammate ... killed by Sage
 *
 * The player was Iso. By the third frame the model was describing SOVA's
 * abilities as "own", and the existing tell vocabulary matched none of it,
 * because it only looked for the words spectating, switch player, killcam or a
 * literal "teammate ... hp". So the health number won, the death never
 * registered, and with it went the death flag, the spectator merge guard (which
 * is why a teammate's Ghost, Bandit and Sword were logged as the player's own
 * weapon) and two correct death reviews.
 *
 * THE SIGNAL NOTHING IMPLEMENTED IS IDENTITY. A HUD that changes whose it is
 * mid round is spectating, whatever the health number says.
 */

const AGENT_DATA = (() => {
  try { return require('./valorant-data.generated.json').agents || {}; }
  catch { return {}; }          // renderer or a stripped build: degrade to names only
})();

/**
 * The model's own words for "I am looking at the spectator HUD".
 *
 * Every alternative is a phrasing taken from a real logged frame. `combat
 * report` and `killed by` were added after the session above: both appear on the
 * death screen and neither was matched before.
 */
const SPECTATE_TELL = new RegExp(
  [
    'spectat(?:e|es|ing|or)',
    'switch player',
    'kill ?cam',
    'death ?recap',
    'combat report',
    'observer',
    'you died',
    'killed by',
    'team eliminated',
    'teammate[^.]{0,24}hp',
    "watching (?:a |your )?teammate",
    "teammate'?s? (?:name|loadout)",
  ].join('|'),
  'i',
);

/**
 * THE ONE SCREEN A LIVING PLAYER ALSO OPENS.
 *
 * Measured across 129 matching frames, "spectating" almost always names a person
 * or the spectator interface. "Scoreboard" appeared once, on a frame where the
 * player was demonstrably alive at 100 HP with the scoreboard open, and the rule
 * declared them dead mid round. So spectating the scoreboard or the minimap is
 * explicitly not spectating a player.
 */
const SPECTATE_FALSE_FRIEND = /\bspectat(?:e|es|ing|or)\s+(?:the\s+)?(?:score\s?board|mini\s?map)\b/i;

/** A read the model itself was unsure about is never proof of anything. */
const UNSURE_TELL = /unreadable|kept previous|unclear|not sure|cannot tell|can.?t tell|assum/i;

/** "own HP 19 and Sova abilities" says the HUD is the player's own. */
const OWN_HUD = /\bown\s+(?:hp|health|loadout|weapon|abilit)/i;

/** Captures the name in "Sova abilities", "Jett's abilities", "Killjoy ability bar". */
const ABILITY_OWNER = /\b([A-Z][a-zA-Z/]+)(?:'s)?\s+(?:abilit|ult|ability bar)/g;

const lower = (v) => String(v || '').toLowerCase();

/** Does the tell name a spectator screen, allowing for the scoreboard exception? */
function tellSaysSpectating(tell) {
  const t = String(tell || '');
  if (!t || !SPECTATE_TELL.test(t)) return false;
  // The scoreboard exception only applies when nothing stronger is present.
  if (SPECTATE_FALSE_FRIEND.test(t) && !/switch player|kill ?cam|combat report|killed by/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * An agent named in the tell who is NOT the player's locked agent.
 *
 * This is the strongest single signal available, because the model has to have
 * been looking at another character's kit to write it. Matched two ways: the
 * ability-owner phrasing above, and any agent's own ability NAME appearing while
 * that agent is not the player's.
 */
function foreignAgentInTell(tell, lockedAgent) {
  const t = String(tell || '');
  const mine = lower(lockedAgent);
  if (!t || !mine) return null;

  ABILITY_OWNER.lastIndex = 0;
  let m;
  while ((m = ABILITY_OWNER.exec(t)) !== null) {
    const who = m[1];
    if (!Object.prototype.hasOwnProperty.call(AGENT_DATA, who)) continue;  // not an agent name
    if (lower(who) !== mine) return who;
  }

  // A named ability belonging to another agent, e.g. "Recon Bolt" while on Iso.
  for (const [name, rec] of Object.entries(AGENT_DATA)) {
    if (lower(name) === mine) continue;
    for (const ab of (rec && rec.abilities) || []) {
      if (ab && ab.length > 3 && t.toLowerCase().includes(lower(ab))) return name;
    }
  }
  return null;
}

/**
 * Weigh every signal and say whose HUD this is.
 *
 * @param f.tell        the model's aliveTell for this frame
 * @param f.agent       the player's LOCKED agent, or falsy if not yet confirmed
 * @param f.weapon      playerWeapon this frame
 * @param f.prevWeapon  playerWeapon last frame
 * @param f.weaponChurn how many distinct weapons have been seen this round
 * @param f.hp          playerHp this frame
 * @param f.prevHp      playerHp last frame
 * @param f.roundChanged true when the round advanced since the last frame
 *
 * Returns { spectating, confidence, signals }. `spectating` is true on ONE
 * strong signal or TWO weak ones. It is deliberately conservative: declaring a
 * living player dead silences the coach mid round, which is the same failure
 * from the other direction.
 */
function readHudOwner(f) {
  const o = f || {};
  const signals = [];
  let strong = 0;
  let weak = 0;

  const tell = String(o.tell || '');
  const unsure = UNSURE_TELL.test(tell);

  if (!unsure && tellSaysSpectating(tell)) {
    signals.push('tell names a spectator screen');
    strong += 1;
  }

  const foreign = unsure ? null : foreignAgentInTell(tell, o.agent);
  if (foreign) {
    // The model called another agent's kit "own". It cannot be looking at the
    // player's own HUD to write that.
    signals.push(`tell describes ${foreign} while the player is ${o.agent}`);
    strong += 1;
  }

  // A HUD that changes weapon repeatedly inside one round is not one person's.
  if (!o.roundChanged && typeof o.weaponChurn === 'number' && o.weaponChurn >= 3) {
    signals.push(`${o.weaponChurn} different weapons this round`);
    weak += 1;
  } else if (!o.roundChanged && o.weapon && o.prevWeapon && o.weapon !== o.prevWeapon) {
    signals.push(`weapon changed ${o.prevWeapon} to ${o.weapon} mid round`);
    weak += 1;
  }

  // Health does not heal upward mid round without a round boundary.
  if (!o.roundChanged && typeof o.hp === 'number' && typeof o.prevHp === 'number'
      && o.hp > o.prevHp + 10) {
    signals.push(`health rose ${o.prevHp} to ${o.hp} mid round`);
    weak += 1;
  }

  // "own HP" is the model asserting the HUD is the player's. It is only counted
  // as evidence FOR being alive, never against, because the session above proves
  // the model writes it while spectating.
  const claimsOwn = OWN_HUD.test(tell);

  const spectating = strong >= 1 || weak >= 2;
  return {
    spectating,
    confidence: strong >= 1 ? 'strong' : (weak >= 2 ? 'weak' : 'none'),
    signals,
    claimsOwn,
    unsure,
  };
}

module.exports = {
  SPECTATE_TELL, SPECTATE_FALSE_FRIEND, UNSURE_TELL, OWN_HUD,
  tellSaysSpectating, foreignAgentInTell, readHudOwner,
};
