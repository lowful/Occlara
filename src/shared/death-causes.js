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
 */

const CAUSES = {
  'dry-peek':   { title: 'Dry peeks',            detail: 'peeked an angle with no utility or information first', avoidable: true },
  'isolated':   { title: 'Caught alone',          detail: 'too far from the team for anyone to trade', avoidable: true },
  'repeek':     { title: 'Repeeks',               detail: 'peeked the same angle again after being seen', avoidable: true },
  'crossfire':  { title: 'Walked into crossfires', detail: 'stepped into two enemies holding different angles', avoidable: true },
  'rotating':   { title: 'Caught rotating',       detail: 'moving between areas, not set for a fight', avoidable: true },
  'overextend': { title: 'Overextended',          detail: 'pushed past the team or chased a kill into their ground', avoidable: true },
  'exposed':    { title: 'Exposed on the spike',  detail: 'in the open while planting, defusing or holding the spike', avoidable: true },
  'lost-duel':  { title: 'Lost duels',            detail: 'a fair fight from a sound position that went the other way', avoidable: false },
  'unclear':    { title: 'Unclear',               detail: 'the frame did not show enough to say', avoidable: false },
};

const isAvoidable = (key) => !!(CAUSES[key] && CAUSES[key].avoidable);

module.exports = { CAUSES, isAvoidable };
