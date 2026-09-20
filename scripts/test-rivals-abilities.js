'use strict';

/**
 * The Rivals ability gate, asserted in both directions.
 *
 * The REJECTIONS are the easy half and the permissions are the half that
 * matters. A gate that rejects too much is indistinguishable from a coach with
 * nothing to say, and that failure is silent: no error, no log a player sees,
 * just an overlay that stopped talking. So every case below that must PASS is
 * there because a plausible implementation of this gate would eat it.
 */

const path = require('path');
const gate = require(path.join(__dirname, '..', 'src', 'shared', 'rivals-abilities.js'));

let failures = 0;
let checks = 0;

function ok(cond, what) {
  checks++;
  if (!cond) { failures++; console.log('  FAIL: ' + what); }
}

function reject(tip, hero, what) {
  const v = gate.validateTipForHero(tip, hero);
  checks++;
  if (v.ok) { failures++; console.log(`  FAIL: should have blocked (${what})\n         "${tip}" as ${hero}`); }
}

function allow(tip, hero, what) {
  const v = gate.validateTipForHero(tip, hero);
  checks++;
  if (!v.ok) {
    failures++;
    console.log(`  FAIL: should have allowed (${what})\n         "${tip}" as ${hero}\n         blocked on "${v.ability}" (${v.owner})`);
  }
}

// ── The data loaded at all ──────────────────────────────────────────────────
ok(gate.abilitiesOf('The Thing').length > 5, 'The Thing has abilities in the generated data');
ok(gate.abilitiesOf('Spider-Man').includes('web-swing'), 'Spider-Man has Web-Swing');
ok(gate.abilitiesOf('Nobody At All').length === 0, 'an invented hero has no abilities');

// ── Rejections: ordering a button the player does not have ──────────────────
reject('Use Web-Swing to get out before the dive lands.', 'The Punisher',
  'Punisher has no Web-Swing');
// BOTH SPELLINGS, because the folding in norm() exists for exactly this and a
// guard that only catches the spelling nobody writes is not a guard.
reject('Pop Ragnarok when they group.', 'Mantis',
  "Ragnarok, unaccented, is Gorr's");
reject('Pop Ragnarök when they group.', 'Mantis',
  "Ragnarök, as the game prints it, is Gorr's");
reject('Save Yancy Street Charge for when they dive you.', 'Luna Snow',
  'Yancy Street Charge belongs to The Thing');

// ── Permissions: the gate must not eat these ────────────────────────────────

// 1. THE COUNTER TABLE'S OWN SENTENCE. This is the exact string
//    rivals-counters.js produces, and it names an ability the player cannot
//    use ON PURPOSE, because the point is what the ENEMY will do to them.
allow('The Thing has Yancy Street Charge, which leaves a zone that turns your dash off. Go in once it is spent.',
  'Black Panther', 'the counter table names the owner');

// 2. Your own ability is always fine, including a team-up you share.
allow('Use Yancy Street Charge to break their line.', 'The Thing', 'his own ability');
allow('Wall Crawl above them and drop in behind.', 'Spider-Man', 'his own ability');
allow('Wall Crawl to the high ground and watch the point.', 'Peni Parker',
  'Wall Crawl is a team-up both heroes own');

// 3. Ordinary English that happens to be an ability name.
allow('Break line of sight and cloak out before they turn on you.', 'The Punisher',
  'cloak is generic English');
allow('Do not go for the backstab while both healers are looking.', 'Hela',
  'backstab is generic English');

// 4. A tip naming no ability at all is not this gate's business.
allow('Hold the high ground and make them come to you.', 'Hela', 'no ability named');
allow('Your team has no Vanguard, so nobody is holding the point.', 'Mantis', 'no ability named');

// 5. Hero not read yet means NO OPINION, not rejection. If this breaks, the
//    coach goes silent for every match where hero select was missed.
allow('Use Web-Swing to reposition.', null, 'unknown hero permits everything');
allow('Use Web-Swing to reposition.', '', 'empty hero permits everything');
allow('Use Web-Swing to reposition.', 'Some Hero Who Does Not Exist',
  'unrecognised hero permits everything');

// ── The scan must not stop at the first excused ability ─────────────────────
//
// A sentence that attributes one ability and then orders another is still
// wrong, and returning ok on the attribution would pass the whole sentence on
// the strength of its first half.
//
// THE HERO NAMES HERE ARE LOAD-BEARING, and the obvious version of this test
// does not work. Written as "The Thing has Yancy Street Charge, so use
// Web-Swing", it passes WITH THE BUG REINTRODUCED: the table iterates in the
// sorted order the sync writes, Spider-Man sits at index 41 and The Thing at
// 47, so Web-Swing is found and rejected before the attribution is ever
// reached. The test was green for a reason that had nothing to do with the
// fix.
//
// So the attributed ability must belong to a hero the scan meets FIRST. Adam
// Warlock is index 0, Spider-Man is 41, and Mantis owns neither.
reject('Adam Warlock has Karmic Revival, so use Web-Swing to get out.', 'Mantis',
  'attribution excuses Karmic Revival but not the Web-Swing ordered after it');
reject('The Thing has Yancy Street Charge, so use Web-Swing to get out.', 'The Punisher',
  'the same shape with the owners the other way round');

// ── checkable() draws the line where it says it does ────────────────────────
ok(gate.checkable('yancy street charge'), 'a multi word name is checkable');
ok(gate.checkable('web-swing'), 'a hyphenated name is checkable');
ok(!gate.checkable('cloak'), 'cloak is not checkable');
ok(!gate.checkable('dagger'), 'dagger is not checkable');
ok(!gate.checkable(''), 'an empty name is not checkable');

// ── ownersOf finds both halves of a team-up ─────────────────────────────────
const wallCrawl = gate.ownersOf('Wall Crawl').sort();
ok(wallCrawl.length === 2, `Wall Crawl has two owners, got ${wallCrawl.length}: ${wallCrawl}`);
ok(gate.ownersOf('Yancy Street Charge').length === 1, 'Yancy Street Charge has one owner');
ok(gate.ownersOf('Not An Ability').length === 0, 'an invented ability has no owner');

console.log(`ran ${checks} ability gate check(s)`);
if (failures) {
  console.log(`\nFAIL: ${failures} of ${checks} failed`);
  process.exit(1);
}
console.log('PASS: the gate blocks buttons the player does not have, and nothing else');
