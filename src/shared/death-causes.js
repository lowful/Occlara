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
 */

const CAUSES = {
  'dry-peek':   { title: 'Dry peeks',            one: 'Dry peek',                detail: 'peeked an angle with no utility or information first', avoidable: true },
  'isolated':   { title: 'Caught alone',          one: 'Caught alone',            detail: 'too far from the team for anyone to trade', avoidable: true },
  'repeek':     { title: 'Repeeks',               one: 'Repeek',                  detail: 'peeked the same angle again after being seen', avoidable: true },
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

module.exports = { CAUSES, isAvoidable, causeTitle };
