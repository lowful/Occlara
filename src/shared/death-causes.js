'use strict';

/**
 * Why a player died, as a label the review can COUNT.
 *
 * The server asks the model to pick one of these for each teachable death
 * (server/services/death-forensics.js), and this is the client's copy of the
 * same list, with the words the review shows. check:server forbids the server
 * reaching into src/, so the list lives twice, and npm run test:forensics
 * asserts the two copies carry exactly the same keys.
 *
 * A label is a count waiting to happen: "your most repeated mistake" is a
 * number, and a free text reason cannot be counted across rounds or matches.
 *
 * `title` names two or more, `one` names one (8.4.1): a single look's miss
 * under "What you missed" read "Repeeks" beside its round's "Repeek" chip on
 * the player's Fracture swiftplay (causeTitle, and insights.js inTodaysWords
 * for a review saved before).
 *
 * REPEEK, WIDENED (8.5.0), its key, chip and titles as they were. On that
 * Fracture match the coach's better play for rounds 2, 5 and 6 was the same
 * lesson, to get out of sight after the first shots, under three labels; a
 * look asked with variant b calls staying on the angle after the first
 * exchange a repeek too. Its words are drawn by key, so they must read true
 * of every repeek ever saved, the old "peeked it again" ones among them, and
 * "fought again from the same angle" is both.
 */

const CAUSES = {
  'dry-peek':   { title: 'Dry peeks',            one: 'Dry peek',                detail: 'peeked an angle with no utility or information first', avoidable: true },
  'isolated':   { title: 'Caught alone',          one: 'Caught alone',            detail: 'too far from the team for anyone to trade', avoidable: true },
  'repeek':     { title: 'Repeeks',               one: 'Repeek',                  detail: 'fought again from the same angle after the first exchange', avoidable: true },
  'crossfire':  { title: 'Walked into crossfires', one: 'Walked into a crossfire', detail: 'stepped into two enemies holding different angles', avoidable: true },
  'rotating':   { title: 'Caught rotating',       one: 'Caught rotating',         detail: 'moving between areas, not set for a fight', avoidable: true },
  'overextend': { title: 'Overextended',          one: 'Overextended',            detail: 'pushed past the team or chased a kill into their ground', avoidable: true },
  'exposed':    { title: 'Exposed on the spike',  one: 'Exposed on the spike',    detail: 'in the open while planting, defusing or holding the spike', avoidable: true },
  'lost-duel':  { title: 'Lost duels',            one: 'Lost the duel',           detail: 'a fair fight from a sound position that went the other way', avoidable: false },
  'unclear':    { title: 'Unclear',               one: 'Unclear',                 detail: 'the frame did not show enough to say', avoidable: false },
};

const isAvoidable = (key) => !!(CAUSES[key] && CAUSES[key].avoidable);

/** A cause's title for `count` of them: the singular for one, the plural for two or more. Null for no cause. */
function causeTitle(cause, count) {
  const c = CAUSES[cause];
  if (!c) return null;
  return count === 1 ? c.one : c.title;
}

/*
 * WHAT A LOOK ASKED WITH VARIANT B ALSO SAYS (8.5.0): its judgement of the
 * fight, the one thing its better play changes most, and the prompt it was
 * asked with (death-forensics.js FIGHTS, CHANGES, variantFor; held equal by
 * test:forensics). Data for Ask Coach and the bench, never the grade. A look
 * saved with no variant was asked with a.
 */
const FIGHTS = ['right', 'wrong-spot', 'wrong-time', 'not-needed', 'unclear'];
const CHANGES = ['aim', 'position', 'timing', 'decision', 'utility', 'team', 'none'];
const VARIANTS = ['a', 'b'];
/** The prompt a saved look was asked with: 'b', or 'a' for every look saved before. */
const variantOf = (look) => (look && look.variant === 'b' ? 'b' : 'a');

/*
 * THE PHRASE LISTS, the client's copy of the server's (death-forensics.js
 * PHRASES), held equal by test:forensics: what a better play says it
 * changes, in English. They set no label. Ask Coach is not given a saved
 * lost duel's label when its better play trips one but aim (movesPlayer),
 * since a better play that moves the player is no fair fight's, and the chat
 * then teaches what the look saw and its better play.
 */
const PHRASES = {
  decision: /\b(let them come|let the clock|play for time|make them come to you|no need to|do not take the fight|don't take the fight|hold the spike)\b/i,
  team: /\b(teammates?|trade|swing with|with your team|together)\b/i,
  reset: /\b(fall back|step back|back behind cover|back into cover|reset|disengage|pull back|after your first shots|after the first exchange|after the first burst|instead of staying|stop firing and)\b/i,
  utility: /\b(smoke|flash|drone|recon|utility|information first)\b/i,
  aim: /\b(crosshair|aim|head level|counter ?strafe|tap|burst|first bullet|spray)\b/i,
};
const PHRASE_ORDER = ['decision', 'team', 'reset', 'utility', 'aim'];

let KITS = null;
function kitOf(agent) {
  if (!KITS) {
    try { KITS = require('./valorant-data.generated.json').agents || {}; } catch { KITS = {}; }
  }
  const a = KITS[agent];
  return a && Array.isArray(a.abilities) ? a.abilities.map((x) => String(x).toLowerCase()) : [];
}

/** Which phrase lists a better play trips, in PHRASE_ORDER, the player's own abilities by name counted as utility. */
function phraseHits(text, agent) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const kit = kitOf(agent);
  const out = [];
  for (const k of PHRASE_ORDER) {
    const kitSaid = k === 'utility' && kit.some((ab) => new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
    if (PHRASES[k].test(t) || kitSaid) out.push(k);
  }
  return out;
}

/** Whether a better play moves the player: any phrase list but aim. */
function movesPlayer(text, agent) {
  return phraseHits(text, agent).some((k) => k !== 'aim');
}

module.exports = { CAUSES, isAvoidable, causeTitle, FIGHTS, CHANGES, VARIANTS, variantOf, PHRASES, PHRASE_ORDER, phraseHits, movesPlayer };
