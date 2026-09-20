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

// ── The patch note: quoted from the official balance post, never judged ─────
{
  const balance = require(path.join(__dirname, '..', 'src', 'shared', 'rivals-balance.generated.json'));
  const published = Date.parse(balance.published + 'T00:00:00Z');
  const fresh = published + 5 * 86400000;          // five days after the post
  const stale = published + 400 * 86400000;        // well past the window

  // A hero the post actually changed.
  const changed = Object.keys(balance.heroes).find((h) => balance.heroes[h].length === 1);
  const note = review.patchNote(changed, null, fresh);
  ok(note !== null, `a changed hero gets a patch note (${changed})`);
  ok(note && note.version === balance.version, 'carrying the game version');
  ok(note && note.published === balance.published, 'and the publish date');
  ok(note && typeof note.summary === 'string' && note.summary.length > 10,
    'and the official summary sentence');
  ok(note && /marvelrivals\.com/.test(note.source || ''), 'and a source URL the player can open');

  // NEVER CHARACTERISED. "reduce cooldown" is a buff and "reduce damage" is a
  // nerf, and the verb is identical, so the review must not use either word.
  const text = JSON.stringify(note).toLowerCase();
  for (const word of ['buff', 'nerf', 'stronger', 'weaker', 'better now', 'worse now']) {
    ok(!text.includes(word), `the patch note never says ${JSON.stringify(word)}`);
  }

  // AGE. A patch from a year ago is furniture, not news.
  ok(review.patchNote(changed, null, stale) === null, 'a stale patch produces no note');
  ok(review.patchNote(changed, null, published - 86400000) === null,
    'and neither does a clock set before the post');

  // A hero with no changes, and one that is not a hero.
  const untouched = Object.keys(
    require(path.join(__dirname, '..', 'src', 'shared', 'rivals-abilities.generated.json')).traits,
  ).map((n) => n.toLowerCase()).find((n) => !balance.heroes[n]);
  ok(review.patchNote(untouched, null, fresh) === null,
    `an unchanged hero gets no note (${untouched})`);
  ok(review.patchNote('Mephisto', null, fresh) === null, 'and neither does a non hero');
  ok(review.patchNote(null, null, fresh) === null, 'and neither does no hero at all');

  // DEADPOOL IS TRI-ROLE and the post gives him three sections with different
  // changes in each. Picking one at random would attribute Vanguard changes to
  // a Strategist, so without a role it declines.
  const multi = Object.keys(balance.heroes).find((h) => balance.heroes[h].length > 1);
  if (multi) {
    ok(review.patchNote(multi, null, fresh) === null,
      `a tri-role hero with no role says nothing (${multi})`);
    const role = balance.heroes[multi][0].role;
    const picked = review.patchNote(multi, role, fresh);
    ok(picked !== null, `but names the right section once the role is known (${role})`);
    ok(picked && picked.summary === balance.heroes[multi][0].summary,
      'and it is that section summary, not another role section');
  }
}

// ── The personal baseline, and the scoping that makes it mean anything ──────
{
  const match = (role, hero, sc) => ({ at: Date.now(), hero, role, scoreline: sc });
  const duelist = (k, d, acc) => match('Duelist', 'hela',
    { kills: k, deaths: d, assists: 3, damage: 20000, healing: 0, blocked: 0, accuracy: acc });

  const three = [duelist(10, 8, 30), duelist(12, 9, 32), duelist(14, 7, 34)];
  const now = { phase: 'scoreboard', mode: 'CONVOY',
    me: { role: 'Duelist', kills: 20, deaths: 5, assists: 6,
      damage: 30000, healing: 0, blocked: 0, accuracy: 41 } };

  // BELOW THE FLOOR there is no comparison, because a delta off two matches is
  // not a baseline, it is noise wearing a number.
  const two = review.buildReview({ hero: 'Hela', state: now, history: three.slice(0, 2) });
  ok(two.against.length === 0, 'two prior matches produce no comparison');
  ok(two.historyCount === 2, 'but the count is reported so the surface can say why');

  const r = review.buildReview({ hero: 'Hela', state: now, history: three });
  ok(r.against.length > 0, `three prior matches produce one (${r.against.length} metrics)`);

  const kills = r.against.find((a) => a.id === 'kills');
  ok(kills && kills.baseline === 12, `the average is the real mean (${kills && kills.baseline})`);
  ok(kills && kills.delta === 8, `and the delta is real (${kills && kills.delta})`);
  ok(kills && kills.better === true, 'more kills than usual reads as better');

  // DEATHS ARE INVERTED, and without that the review congratulates a player for
  // dying more than usual.
  const deaths = r.against.find((a) => a.id === 'deaths');
  ok(deaths && deaths.delta === -3, `deaths delta is real (${deaths && deaths.delta})`);
  ok(deaths && deaths.better === true, 'FEWER deaths than usual reads as better');

  // ROLE SCOPING. A Strategist match must not enter a Duelist baseline: it
  // would manufacture a trend out of the player switching role.
  const mixed = [...three,
    match('Strategist', 'luna snow', { kills: 1, deaths: 14, assists: 30, accuracy: 20 })];
  const rm = review.buildReview({ hero: 'Hela', state: now, history: mixed });
  const k2 = rm.against.find((a) => a.id === 'kills');
  ok(k2 && k2.games === 3, `the Strategist match is excluded from a Duelist baseline (n=${k2 && k2.games})`);
  ok(k2 && k2.baseline === 12, 'so the average does not move');

  // HERO SCOPING for accuracy. rivals-knowledge.js states the reason: a
  // projectile hero is naturally lower than a hitscan one at the same skill.
  const otherHero = [...three, match('Duelist', 'spider-man',
    { kills: 11, deaths: 8, assists: 3, accuracy: 5 })];
  const ro = review.buildReview({ hero: 'Hela', state: now, history: otherHero });
  const acc = ro.against.find((a) => a.id === 'accuracy');
  ok(acc && acc.games === 3, `accuracy ignores a different hero (n=${acc && acc.games})`);
  ok(acc && acc.baseline === 32, `so a 5% Spider-Man game does not drag it (${acc && acc.baseline})`);
  // ... while a ROLE scoped metric DOES count that same match, since it is the
  // same role. If these two ever agree, one of the scopes has been lost.
  const k3 = ro.against.find((a) => a.id === 'kills');
  ok(k3 && k3.games === 4, `but kills counts it, because the role matches (n=${k3 && k3.games})`);

  // Only the last N matches feed a baseline.
  const many = Array.from({ length: 40 }, () => duelist(10, 8, 30));
  const rl = review.buildReview({ hero: 'Hela', state: now, history: many });
  const kl = rl.against.find((a) => a.id === 'kills');
  ok(kl && kl.games === review.RIVALS_BASELINE_GAMES,
    `the baseline is capped at ${review.RIVALS_BASELINE_GAMES} matches (n=${kl && kl.games})`);

  // A COLUMN THAT IS ZERO AND ALWAYS HAS BEEN is dropped, because "Blocked 0
  // (average 0)" is a row that says nothing. The inverse must survive: a zero
  // against a real average is the single most informative row there is, and a
  // filter written carelessly eats exactly that one.
  const stratHist = [1, 2, 3].map(() => match('Strategist', 'luna snow',
    { kills: 2, deaths: 9, assists: 18, damage: 8000, healing: 20000, blocked: 0, accuracy: 25 }));
  const stratNow = { phase: 'scoreboard',
    me: { role: 'Strategist', kills: 4, deaths: 11, assists: 21,
      damage: 9840, healing: 0, blocked: 0, accuracy: 29 } };
  const rs = review.buildReview({ hero: 'Luna Snow', state: stratNow, history: stratHist });
  ok(!rs.against.some((a) => a.id === 'blocked'), 'an always-zero column is dropped');
  const heal = rs.against.find((a) => a.id === 'healing');
  ok(heal, 'but healing 0 against an average of 20,000 is NOT dropped');
  ok(heal && heal.delta === -20000, `and carries the real drop (${heal && heal.delta})`);
  ok(heal && heal.better === false, 'and reads as worse');

  // No history at all is a gap, never a zero baseline.
  const none = review.buildReview({ hero: 'Hela', state: now });
  ok(none.against.length === 0, 'no history produces no comparison');
  ok(none.historyCount === 0, 'and says so');
}

// ── The history entry is built from the REVIEW, not from the raw frame ──────
{
  // A hero the review refused to believe must not enter the baseline as that
  // hero either, or the next match is compared against a lie.
  const healed = { phase: 'scoreboard', result: 'victory', mode: 'CONVOY',
    me: { role: 'Duelist', kills: 4, deaths: 9, assists: 21,
      damage: 9000, healing: 19400, blocked: 0, accuracy: 30 } };
  const r = review.buildReview({ hero: 'The Punisher', state: healed });
  ok(r.game.hero === null, 'the contradicted hero is dropped from the review');

  const entry = review.historyEntry(r, 1000);
  ok(entry !== null, 'and an entry is still recorded');
  ok(entry.hero === null, 'with no hero, rather than the one the review refused');
  ok(entry.role === 'Strategist', `and the role the review settled on (${entry.role})`);
  ok(entry.scoreline.kills === 4, 'carrying the scoreline');
  ok(entry.at === 1000, 'and the timestamp it was given');

  ok(review.historyEntry(null) === null, 'no review means no entry');
  ok(review.historyEntry({ empty: true }) === null, 'and neither does an empty one');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all rivals review checks passed'}`);
process.exit(fails ? 1 : 0);
