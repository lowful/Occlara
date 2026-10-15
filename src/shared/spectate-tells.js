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

/*
 * THE SPECTATOR COUNTER IS ON A LIVING PLAYER'S HUD.
 *
 * "SPECTATORS 1" at the top right counts who is watching the PLAYER: a dead
 * teammate's camera on them. On the player's Sunset swiftplay the model wrote
 * it as "Spectating 1 top right" on the round 4 banner, at 99 health, and as
 * "SPECTATORS 1 top right" on the frame after, and a death registered in a
 * round Riot has the player surviving. A spectator screen names a teammate, a
 * banner or SWITCH PLAYER, never a number, and a teammate's name that ends in
 * one ("h20") is not the counter either. Whatever form of the word the number
 * follows (8.4.3): "Spectated 1 top right" and "spectated by 1" are the player
 * being watched, and read as a spectator screen each proved a death on one
 * frame at 99 health.
 */
const SPECTATOR_COUNT = /\bspectators\b|\bspectat(?:e|es|ing|or)\s*:?\s*\d{1,2}(?![\w/])|\bspectated(?:\s+by)?\s*:?\s*\d{1,2}(?![\w/])|\b\d{1,2}\s+spectators?\b|\bspectators?\s+(?:count|counter|number|icon)\b/i;

/** What only the death screen prints, which outranks both false friends. */
const DEATH_SCREEN = /switch player|kill ?cam|combat report|killed by/i;

/*
 * A DEATH WORD ITS OWN CLAUSE NEGATES IS NO DEATH WORD (8.4.3).
 *
 * Variant b of the read prompt, benched on the player's four sessions, wrote
 * "SWITCH PLAYER not shown", "SWITCH PLAYER not printed" and "no SWITCH
 * PLAYER or KILLED BY printed": nine tells, eight of them on a living player
 * in a buy phase, and every word list here took the words for the screen. So
 * a death word (spectating, SWITCH PLAYER, KILLED BY, the COMBAT REPORT, a
 * killcam, a death recap, YOU DIED, TEAM ELIMINATED, observer, respawn) counts
 * only where its own clause, to a comma, a full stop, a semicolon or a bar,
 * does not negate it: "no", "not", "without", "never", "neither" or "nor"
 * right before it, or "not shown", "not printed", "not visible", "not on
 * screen", "absent", "missing" or "hidden" right after it, at most two words
 * for what it is ("text", "prompt", "panel") or "is" between. Two joined by
 * "or" or "nor" share one negation. The "no" in "SWITCH PLAYER bottom left, no
 * own HP" and "KILLED BY Sage, no own health" is the health's, and the word
 * stands, as every word its clause leaves alone does: "KILLED BY PHOENIX and
 * COMBAT REPORT panel printed, SWITCH PLAYER not visible" still prints the
 * death screen, and it was the Abyss match's round 20 death. A phrase that is
 * no death word (a teammate's HP, "no hp") is taken as it always was.
 * MIRRORED by hand in server/routes/coach.js; test-spectate.js holds the two
 * equal.
 */
const DEATH_WORD = /^(?:spectat|switch player|kill ?cam|death ?recap|combat report|killed by|observer|you died|team eliminated|respawn)/i;
const NEGATED_BEFORE = /\b(?:no|not|without|never|neither|nor)\s+$/i;
const NEGATED_AFTER = /^\s+(?:(?:text|prompt|panel|banner|label|button|message|screen|is|are|was|were)\s+){0,2}(?:not\s+(?:shown|printed|visible|on\s+screen)|absent|missing|hidden)\b/i;
const OR_JOINED = /^\s+(?:or|nor)\s+$/i;
const EVERY = new WeakMap();   // each word list's global twin, made once

/** Does the tell say one of re's words, a death word its own clause negates left out? */
function affirms(re, tell) {
  const t = String(tell || '');
  if (!t || t.search(re) < 0) return false;
  let every = EVERY.get(re);
  if (!every) {
    every = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    EVERY.set(re, every);
  }
  const words = [];
  for (const m of t.matchAll(every)) {
    if (!m[0]) continue;
    if (!DEATH_WORD.test(m[0])) return true;
    const from = m.index;
    const to = from + m[0].length;
    const head = t.slice(0, from);
    const before = head.slice(Math.max(head.lastIndexOf(','), head.lastIndexOf('.'), head.lastIndexOf(';'), head.lastIndexOf('|')) + 1);
    // To the end of its own clause, the rest of a cut word ("spectat|ing") left out.
    const tail = t.slice(to).replace(/^\w+/, '');
    const end = tail.search(/[,.;|]/);
    const after = end < 0 ? tail : tail.slice(0, end);
    words.push({ from, to, neg: NEGATED_BEFORE.test(before) ? 1 : (NEGATED_AFTER.test(after) ? -1 : 0) });
  }
  // "or" and "nor" carry a negation on: forwards from one before, back from one after.
  for (let i = 1; i < words.length; i++) {
    if (!words[i].neg && words[i - 1].neg === 1 && OR_JOINED.test(t.slice(words[i - 1].to, words[i].from))) words[i].neg = 1;
  }
  for (let i = words.length - 2; i >= 0; i--) {
    if (!words[i].neg && words[i + 1].neg === -1 && OR_JOINED.test(t.slice(words[i].to, words[i + 1].from))) words[i].neg = -1;
  }
  return words.some((w) => !w.neg);
}

/** A read the model itself was unsure about is never proof of anything. */
const UNSURE_TELL = /unreadable|kept previous|unclear|not sure|cannot tell|can.?t tell|assum/i;

/** "own HP 19 and Sova abilities" says the HUD is the player's own. */
const OWN_HUD = /\bown\s+(?:hp|health|loadout|weapon|abilit)/i;

/*
 * The player's OWN death banner, not a line about somebody else.
 *
 * Anchored to the start: Valorant writes "KILLED BY <name>" about you, and any
 * feed line about a third party carries the killer's name first. Without the
 * anchor this fires every time anyone on the server dies.
 */
const KILLED_BY_PLAYER = /^\s*(?:you (?:were|got) killed|killed by)\b/i;

/** Captures the name in "Sova abilities", "Jett's abilities", "Killjoy ability bar". */
const ABILITY_OWNER = /\b([A-Z][a-zA-Z/]+)(?:'s)?\s+(?:abilit|ult|ability bar)/g;

const lower = (v) => String(v || '').toLowerCase();

/** The spectator counter named, and nothing the death screen prints beside it. */
function countsSpectators(tell) {
  const t = String(tell || '');
  return SPECTATOR_COUNT.test(t) && !affirms(DEATH_SCREEN, t);
}

/** Does the tell name a spectator screen, allowing for the scoreboard and counter exceptions? */
function tellSaysSpectating(tell) {
  const t = String(tell || '');
  if (!t || !affirms(SPECTATE_TELL, t)) return false;
  // Both exceptions only apply when nothing stronger is present.
  if (SPECTATE_FALSE_FRIEND.test(t) && !affirms(DEATH_SCREEN, t)) return false;
  if (countsSpectators(t)) return false;
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
 * @param f.killFeed    the last kill feed line the model read
 * @param f.phase       the model's own phase verdict for this frame
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

  /*
   * THE KILL FEED SAYING THE PLAYER WAS KILLED IS A PRINTED FACT.
   *
   * Session 2026-09-18 frame 19: phase "dead", killFeed "Killed by Reyna",
   * playerNote "Died holding A Lobby alone", and alongside them playerAlive true
   * at 100 HP with a knife. Three signals said dead, none of them reached here,
   * and the spectated teammate's health won. The tip was right and the STATE
   * around it was self contradictory, which is what the accuracy gate then
   * flagged.
   *
   * This is the same class of evidence as the printed location label the map
   * lock is built on: Valorant puts KILLED BY <name> on screen, so reading it is
   * not inference. It is ANCHORED to the start deliberately. "Killed by Reyna"
   * is the player's own death banner; "Sova killed by Reyna" is a line about
   * somebody else, and treating the second as the first would call the player
   * dead every time anyone on the server died.
   */
  const feed = String(o.killFeed || '');
  if (KILLED_BY_PLAYER.test(feed)) {
    signals.push(`kill feed reads "${feed.trim().slice(0, 40)}"`);
    strong += 1;
  }

  /*
   * The model's own "dead" verdict is WEAK on purpose and never decides alone.
   * Trusting it outright is the bug the HP-beats-death rule exists to stop: it
   * announced deaths that had not happened. Paired with anything else, though, it
   * is the difference between a contradiction and a reading.
   */
  if (String(o.phase || '').toLowerCase() === 'dead') {
    signals.push('model reported phase dead');
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
  SPECTATE_TELL, SPECTATE_FALSE_FRIEND, SPECTATOR_COUNT, UNSURE_TELL, OWN_HUD, KILLED_BY_PLAYER,
  DEATH_SCREEN, DEATH_WORD,
  tellSaysSpectating, countsSpectators, foreignAgentInTell, readHudOwner, affirms,
};
