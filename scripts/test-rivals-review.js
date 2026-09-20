'use strict';

/**
 * The Rivals post match review, asserted mostly on what it REFUSES to say.
 *
 * The plan for this module named the negative half as the important one and it
 * is right: a review that states the printed numbers is easy, and a review that
 * quietly starts commenting on positioning, on the enemy comp, or on whether
 * the scoreline was good is the failure that ships. None of those can be
 * computed from one frame, so each has a test asserting the text never appears.
 */

const path = require('path');
const review = require(path.join(__dirname, '..', 'src', 'shared', 'rivals-review.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

/** Everything the review produces, flattened, so a forbidden word can be hunted. */
const allText = (r) => JSON.stringify(r).toLowerCase();

const SCOREBOARD = {
  phase: 'scoreboard',
  result: 'victory',
  map: 'Klyntar: Symbiotic Surface',
  mode: 'Convergence',
  me: { name: 'you', role: 'Duelist', kills: 22, deaths: 7, assists: 9,
    damage: 41230, blocked: 1200, healing: 0, accuracy: 38 },
  mvp: 'someone else',
};

// ── It reports what was printed ─────────────────────────────────────────────
{
  const r = review.buildReview({ hero: 'The Punisher', state: SCOREBOARD });
  ok(r.empty === false, 'a real scoreboard produces a review');
  ok(r.game.hero === 'The Punisher', `it names the hero read at hero select (${r.game.hero})`);
  ok(r.game.role === 'Duelist', `and the role that hero actually is (${r.game.role})`);
  ok(r.game.roleSource === 'hero', `sourced from the hero, not the icon (${r.game.roleSource})`);
  ok(r.scoreline.kills === 22 && r.scoreline.deaths === 7, 'the scoreline is carried through');
  ok(r.game.result === 'victory', 'the result is carried through');
  ok(r.game.mode === 'Convergence', 'the mode is carried through');
}

// ── The archetype says what the hero is FOR, and passes no verdict ──────────
{
  const r = review.buildReview({ hero: 'Black Panther', state: SCOREBOARD });
  ok(r.archetype && r.archetype.name === 'dive', 'Black Panther is named as a dive hero');
  ok(/isolated target/.test(r.archetype.purpose), 'and what dive is for is stated');
  const t = allText(r);
  ok(!/dived well|dived badly|good dive|bad dive|should have dived/.test(t),
    'but no verdict is passed on how the dives went');
}

// ── A hero still in PENDING is NAMED, and gets no archetype ─────────────────
// The name and the archetype are different claims. Deadpool is officially
// tri-role so no single archetype describes him, but a player on Deadpool is on
// Deadpool, and blanking the one line they can verify at a glance reads as the
// app being broken rather than careful.
{
  const r = review.buildReview({ hero: 'Deadpool', state: SCOREBOARD });
  ok(r.game.hero === 'Deadpool', `an unclassified hero is still named (${r.game.hero})`);
  ok(r.archetype === null, 'but gets no archetype');
  ok(r.game.roleSource === 'unverified', `and no role is claimed from him (${r.game.roleSource})`);
}

// ── A name that is not a hero at all is refused ─────────────────────────────
{
  const r = review.buildReview({ hero: 'Mephisto', state: SCOREBOARD });
  ok(r.game.hero === null, 'a name outside the roster is dropped');
  ok(r.archetype === null, 'and carries no archetype');
}

// ── THE MID MATCH SWITCH, which is the one contradiction that IS detectable ──
{
  // Read as The Punisher at hero select, but the healing column proves a
  // Strategist finished the match. They switched.
  const healed = { ...SCOREBOARD, me: { ...SCOREBOARD.me, healing: 19400 } };
  const r = review.buildReview({ hero: 'The Punisher', state: healed });
  ok(r.game.hero === null, 'a contradicted hero is dropped rather than carried');
  ok(r.game.role === 'Strategist', `and the proven role wins (${r.game.role})`);
  ok(r.refused.some((x) => /switched/.test(x)), 'and the review says why it cannot name the hero');
}
{
  // The same numbers WITHOUT a contradiction: a real Strategist who healed.
  const healed = { ...SCOREBOARD, me: { ...SCOREBOARD.me, role: 'Strategist', healing: 19400 } };
  const r = review.buildReview({ hero: 'Luna Snow', state: healed });
  ok(r.game.hero === 'Luna Snow', 'a Strategist who healed keeps her name');
  ok(r.shape && r.shape.ok === true, 'and the role shape check passes');
}

// ── The one judgement it makes, in both directions ──────────────────────────
{
  const lazy = { ...SCOREBOARD, me: { ...SCOREBOARD.me, role: 'Strategist', healing: 340 } };
  const r = review.buildReview({ hero: 'Luna Snow', state: lazy });
  ok(r.shape && r.shape.ok === false, 'a Strategist who did not heal is told so');
  ok(/340/.test(r.shape.text), 'and the number is quoted rather than described');
}
{
  // A Duelist is NOT judged on healing, or on anything else.
  const r = review.buildReview({ hero: 'The Punisher', state: SCOREBOARD });
  ok(r.shape === null, 'a Duelist gets no shape verdict, because no column proves one');
}
{
  // Damage blocked must never become a Vanguard verdict. The real rows overlap:
  // the lowest Vanguard blocked 8,431 and the highest Duelist 12,283.
  const tank = { ...SCOREBOARD, me: { ...SCOREBOARD.me, role: 'Vanguard', blocked: 3000, healing: 0 } };
  const r = review.buildReview({ hero: 'The Thing', state: tank });
  ok(r.shape === null, 'a Vanguard is not judged on damage blocked');
}

// ── THE REFUSALS, which are the point ───────────────────────────────────────
{
  const r = review.buildReview({ hero: 'The Punisher', state: SCOREBOARD });
  const t = allText(r);

  // No enemy hero may be named, because the enemy read failed its gate.
  for (const enemy of ['venom', 'hulk', 'scarlet witch', 'mantis', 'iron man']) {
    ok(!t.includes(enemy), `the review never names an enemy hero (${enemy})`);
  }

  // No positioning, no timing, no fight narrative. One frame has none of it.
  for (const word of ['position', 'angle you', 'you should have', 'too late', 'rotate',
    'out of place', 'overextend', 'flank route']) {
    ok(!t.includes(word), `the review says nothing about ${JSON.stringify(word)}`);
  }

  // No verdict on the scoreline. There is no baseline to judge it against.
  for (const word of ['good k/d', 'bad k/d', 'too many deaths', 'died too', 'poor game',
    'strong game', 'carried']) {
    ok(!t.includes(word), `the review passes no verdict on the scoreline (${JSON.stringify(word)})`);
  }

  ok(r.refused.length >= 3, `and it says out loud what it cannot say (${r.refused.length} items)`);
  ok(r.refused.some((x) => /enemy team/.test(x)), 'including that it did not see the enemy team');
}

// ── Missing data degrades to a gap, never to a guess ────────────────────────
{
  const r = review.buildReview({ hero: null, state: SCOREBOARD });
  ok(r.game.hero === null, 'no hero read means no hero named');
  ok(r.archetype === null, 'and no archetype invented');
  ok(r.game.role === 'Duelist', 'the model role read still comes through, unverified');
  ok(r.game.roleSource === 'unverified', `and is labelled as such (${r.game.roleSource})`);
}
{
  const r = review.buildReview({ hero: 'The Punisher', state: { phase: 'scoreboard' } });
  ok(r.empty === true, 'a frame with no scoreline is reported empty, not rendered as nulls');
}
{
  const r = review.buildReview({});
  ok(r.empty === true, 'and so is no state at all');
}
{
  const partial = { ...SCOREBOARD, me: { kills: 4, deaths: 4, assists: 4 } };
  const r = review.buildReview({ hero: 'The Punisher', state: partial });
  ok(r.scoreline.damage === null, 'an uncaptured column is null rather than zero');
  ok(r.scoreline.kills === 4, 'while the captured ones still report');
}

// ── Numbers arriving as strings, which is what a model returns ──────────────
{
  const asText = { ...SCOREBOARD, me: { ...SCOREBOARD.me, role: 'Strategist', healing: '19,400', kills: '22' } };
  const r = review.buildReview({ hero: 'Luna Snow', state: asText });
  ok(r.scoreline.healing === 19400, `a comma separated number parses (${r.scoreline.healing})`);
  ok(r.scoreline.kills === 22, 'and so does a plain numeric string');
}

// ── The mode is printed text, tidied but never checked against a list ───────
// marvelrivals.com publishes no game modes page: /gamemodes/ and /gameinfo/
// both 404. So a list here would be written from memory and presented as fact,
// which is how "Earthbound" nearly reached players. What IS checkable is shape:
// a mode is a short label, not a sentence, and a model answering with the
// objective line is misreading rather than naming a mode we have not heard of.
{
  ok(review.modeName('CONVERGENCE') === 'Convergence', 'a printed mode is title cased');
  ok(review.modeName('Convoy') === 'Convoy', 'one already cased is left alone');
  ok(review.modeName('DOMINATION') === 'Domination', 'and so is any other');
  ok(review.modeName("Escort Knull's Essence to the Underground") === null,
    'the objective line is not a mode');
  ok(review.modeName('') === null, 'an empty mode is null');
  ok(review.modeName(null) === null, 'a missing mode is null');

  // THE IMPORTANT ONE. A mode nobody here has heard of still comes through.
  // Dropping it would be this code substituting its own memory for what the
  // game printed, and the game is the source.
  ok(review.modeName('SKIRMISH') === 'Skirmish', 'an unfamiliar mode is NOT dropped');

  const r = review.buildReview({ hero: 'The Punisher',
    state: { ...SCOREBOARD, mode: "Escort Knull's Essence to the Underground" } });
  ok(r.game.mode === null, 'and a misread mode reaches the review as absent');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all rivals review checks passed'}`);
process.exit(fails ? 1 : 0);
