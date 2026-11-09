'use strict';

/**
 * server/services/game-claims.js: what the game itself makes certain (round 8).
 *
 *   1. checkOneShot: round 7's Outlaw "one-shot body at any range" caught, and
 *      the Marshal body and Phantom head "at any range"; true one shots (the
 *      Operator body, the Vandal head, the Outlaw head), an armour qualified,
 *      a negated, a partless and a close range Phantom claim kept. The primer
 *      path reads its own hits.
 *   2. checkMoveFire: "bursting and moving" caught; moving between bursts, a
 *      negation, a shotgun and the habit named as the error kept.
 *   3. soloDrillFrame and teamDrill: round 7's Split Silver aim caught across
 *      sentences, the disclaimer loophole closed, the rule itself and a drill
 *      moved to a match kept.
 *   4. checkUnobserved: "your crosshair sat too deep" caught, the imperative,
 *      the hypothetical and a look that says it kept.
 *   5. checkBullets: Contingency called a smoke bullets go through, High Tide
 *      called bullet blocking, both caught; the true lines kept.
 *   6. Every playbook note passes checkMoveFire, checkOneShot and checkBullets,
 *      so no note contradicts the primer again (round 7's "Burst, move, burst,
 *      move" came from one).
 *   7. No backspace byte in the source (CLAUDE.md, the shell regex hazard).
 *
 * Run: npm run test:gameclaims
 */

const fs = require('fs');
const path = require('path');
const G = require('../server/services/game-claims');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}`);
}
const hit = (fn, ...a) => !!fn(...a);

// ── 1. One shot ───────────────────────────────────────────────────────────
const ONE_CAUGHT = [
  "With the spike down and your team up a player, the defenders have to come to you, so the Outlaw's one-shot body at any range only matters if you walk into its line.",
  'One body shot from the Outlaw kills you, so never peek it.',
  'The Marshal one-shots body, so do not wide swing it.',
  'The Phantom one-taps the head at any range.',
  'The Sheriff one-taps the head at any range.',
];
for (const s of ONE_CAUGHT) ok(hit(G.checkOneShot, s), `one shot caught: ${s}`);
const ONE_KEPT = [
  'The Outlaw one-shots body only against Light Armor or no armour, and needs two on Heavy Armor.',
  'An Operator one-shots body at any range, so never dry peek it.',
  'The Vandal one-taps the head at any range.',
  'The Outlaw one-shots the head at any range.',
  'The Outlaw does not one-shot body against heavy shields.',
  'Their Outlaw one-shots you if you walk into it.',
  'Up close the Phantom one-taps the head.',
  'A Marshal body shot kills an enemy with no armour.',
  'The Judge one-shots body up close.',
  'Your Outlaw does 140 a body at any range, which kills through Light Armor but not Heavy Armor.',
];
for (const s of ONE_KEPT) ok(!hit(G.checkOneShot, s), `one shot kept: ${s}`);
ok(/Heavy Armor from full health takes 2/.test(G.checkOneShot(ONE_CAUGHT[0]) || ''), 'the reason names the hits Heavy Armor takes');
ok(G.hitsToKill(140, { absorbed: 0.66, capacity: 50 }) === 2 && G.hitsToKill(140, { absorbed: 0.66, capacity: 25 }) === 1 && G.hitsToKill(150, { absorbed: 0.66, capacity: 50 }) === 1,
  'hitsToKill: the Outlaw body kills Light Armor, not Heavy; 150 kills Heavy');
// The primer's own hits win over the data: a patch that made the Outlaw body one shot Heavy Armor.
const primer = [{ subjectKind: 'gun', subject: 'Outlaw', attribute: 'hits', part: 'body', armor: 'Heavy Armor', band: { from: 0, to: 50 }, value: 1 }];
ok(!hit(G.checkOneShot, ONE_CAUGHT[1], primer) && hit(G.checkOneShot, ONE_CAUGHT[1], []), 'the primer path reads its own hits');
ok(G.ONE_SHOT.test('one-shots') && G.ONE_SHOT.test('a single body hit from it kills') && !G.ONE_SHOT.test('take a shot and reset, then shoot again'), 'ONE_SHOT both ways');
ok(G.ARMOUR_QUALIFIED.test('against no armour') && G.ARMOUR_QUALIFIED.test('on an eco') && !G.ARMOUR_QUALIFIED.test('so never peek it'), 'ARMOUR_QUALIFIED both ways');

// ── 2. Firing while moving ────────────────────────────────────────────────
const MOVE_CAUGHT = [
  'Pair that with bursting and moving, since the kills come from being hard to hit as much as from the first bullet landing.',
  'Shoot while strafing so you are harder to hit.',
  'With the Spectre you can run and gun around the corner.',
  'Burst, move, burst, move, the kills come from being hard to hit.',
];
for (const s of MOVE_CAUGHT) ok(hit(G.checkMoveFire, s), `move fire caught: ${s}`);
const MOVE_KEPT = [
  'Never shoot while moving, stop first.',
  'Fire a burst, strafe to a new spot between bursts, and stop dead before the next one.',
  'A Judge forgives shooting while moving up close.',
  'Stop moving before you shoot, because a moving shot goes wide.',
  'You kept firing while moving and missed, so stop before the shot.',
  'Burst, then strafe to a new spot between bursts and stop dead before the next one, because a moving shot goes wide and the move is what makes you hard to hit.',
];
for (const s of MOVE_KEPT) ok(!hit(G.checkMoveFire, s), `move fire kept: ${s}`);

// ── 3. Solo drill frame ───────────────────────────────────────────────────
const split = [
  { p: 2, s: 'To practise this, play Deathmatch but treat it as a positioning drill, not a frag race.' },
  { p: 2, s: 'Before every engagement, ask whether you have an escape or a teammate nearby, and skip the fights where the answer is no.' },
  { p: 2, s: "In your next matches, watch for the moment you're about to peek an angle alone early in the round, and hold instead." },
];
const r1 = G.soloDrillFrame(split);
ok(r1.length === 1 && r1[0].index === 1, 'Split Silver aim: the team rule after the Deathmatch drill is caught');
ok(G.soloDrillFrame([{ p: 0, s: 'Practise in Deathmatch, where there are no teammates: before each peek, ask yourself whether a teammate could trade you.' }]).length === 1,
  'a disclaimer does not license the team rule after it');
ok(G.soloDrillFrame([{ p: 0, s: 'Play Deathmatch and make yourself say before each fight whether anyone could help you.' }]).length === 1, 'anyone could help, in the frame sentence');
const KEPT_ROWS = [
  [{ p: 0, s: 'Build it in Deathmatch: pick one angle, stop dead, put the crosshair at head height before the enemy appears.' },
    { p: 0, s: 'In your next match, check that a teammate can see the same angle before you swing.' }],
  [{ p: 0, s: 'Practise it in your next match, not Deathmatch, since it needs teammates.' }],
  [{ p: 0, s: 'Play Deathmatch and stop before every shot.' }, { p: 1, s: 'Your teammate Sova was close in round 5.' }],
  [{ p: 0, s: 'Drill it in a match, because Deathmatch has no teammates.' }],
  [{ p: 0, s: 'Play Deathmatch, since it needs no teammates: pick one angle and hold it.' }],
  [{ p: 0, s: 'Warm up in Deathmatch.' }, { p: 0, s: 'There are no teammates there, so the trade habit waits for a match.' }],
  [{ p: 0, s: 'Deathmatch has no teammates, so do not practise trades there.' }],
];
for (const rows of KEPT_ROWS) ok(G.soloDrillFrame(rows).length === 0, `drill kept: ${rows.map((r) => r.s).join(' / ')}`);
ok(G.teamDrill('Practise in Deathmatch, where there are no teammates: ask whether a teammate could trade you.')
  && !G.teamDrill('Practise it in your next match rather than in Deathmatch, because it needs teammates.')
  && !G.teamDrill('Deathmatch has no teammates, so do not practise trades there.'), 'teamDrill both ways');
ok(G.TEAM_WORDS.test('a teammate backs you up') && G.TEAM_WORDS.test('backed you up') && !G.TEAM_WORDS.test('back up your aim'), 'TEAM_WORDS reads backing you up');
ok(G.stripDisclaimer('Practise in Deathmatch, where there are no teammates: ask').indexOf('teammates') < 0, 'stripDisclaimer drops the disclaimer');

// ── 4. Unobserved ─────────────────────────────────────────────────────────
const look12 = 'You held the gap at B Main with a Guardian, and Fade appeared in it and killed you with a Vandal before you fired.';
ok(hit(G.checkUnobserved, 'Your crosshair sat too deep toward the wall, so when Fade swung into the gap their movement opened the angle toward you.', look12), 'round 7 crosshair claim caught');
ok(hit(G.checkUnobserved, 'You had your crosshair low on that angle.', look12), 'you had your crosshair caught');
ok(hit(G.checkUnobserved, 'You never saw him coming from Heaven.', ''), 'a sight claim with no look caught');
ok(!hit(G.checkUnobserved, 'Keep the crosshair back from the corner edge, out in the open space a peeker will move into.', look12), 'the imperative kept');
ok(!hit(G.checkUnobserved, 'If your crosshair sat deep in the wall, a peeker who swings into you lands off it.', look12), 'the hypothetical kept');
ok(!hit(G.checkUnobserved, 'Your crosshair was low when Jett peeked.', 'Your crosshair was low on the B Long angle when Jett peeked.'), 'a look that says it kept');
ok(!hit(G.checkUnobserved, 'You saw him on the minimap and still peeked.', ''), 'the minimap kept');
ok(!hit(G.checkUnobserved, 'Note whether you see the enemy before they see you.', ''), 'a present tense question kept');

// ── 5. Bullets ────────────────────────────────────────────────────────────
ok(hit(G.checkBullets, 'Contingency is just a smoke that moves, bullets go through it.'), 'Contingency called a smoke caught');
ok(hit(G.checkBullets, 'High Tide blocks bullets, so push behind it.'), 'High Tide blocking bullets caught');
ok(!hit(G.checkBullets, 'Contingency blocks bullets as it moves forward, so walk behind it.'), 'Contingency blocks bullets kept');
ok(!hit(G.checkBullets, 'Contingency blocks vision as it moves forward.'), 'a vision only claim is no bullet claim');
ok(!hit(G.checkBullets, 'Bullets go through High Tide, so it only hides you.'), 'High Tide letting bullets through kept');

// ── 6. Every playbook note ────────────────────────────────────────────────
// Every note the coach retrieves: playbook.json merged into knowledge.js's own.
const notes = require('../server/services/knowledge').all();
const bad = [];
for (const n of notes) {
  if (!n || typeof n.text !== 'string') continue;
  for (const [k, fn] of [['move-fire', G.checkMoveFire], ['oneshot', G.checkOneShot], ['bullets', G.checkBullets], ['unseen', (t) => G.checkUnobserved(t, '')]]) {
    if (fn(n.text)) bad.push(`${k}: ${n.text}`);
  }
  if (G.teamDrill(n.text)) bad.push(`drill: ${n.text}`);
}
ok(notes.length > 900 && !bad.length, `every playbook note agrees with the game data (${bad.join(' | ')})`);
ok(!hit(G.checkUnobserved, 'Keep your crosshair where you saw him until he could have walked to the other exit.', ''), 'where you saw him is a place, kept');
const outlaw = notes.find((n) => n && /sniper fires 2 shots/.test(n.text || ''));
ok(outlaw && /kills through Light Armor but not Heavy Armor/.test(outlaw.text), 'the Outlaw note says the armour its body hit kills through');

// ── 8. The review findings (8.8) ──────────────────────────────────────────
{
  // checkBullets: a negation before the claim, every claim in the clip, a name as a whole word.
  for (const s of ["Viper's Toxic Screen will not stop bullets, so they can spray you through it.",
    "Toxic Screen won't stop bullets, so never hide behind it.", 'Dark Cover never stops bullets, so do not hold behind it.',
    'High Tide cannot block bullets.', 'Barrier Orb is not just a smoke, it blocks bullets until it breaks.',
    "Omen's Dark Cover does not stop bullets, so shoot through it.", 'Dark Cover is just a smoke, bullets go through it.',
    'Cover is everything here: shoot through the smoke only when you know they are there.']) {
    ok(!hit(G.checkBullets, s), `true bullets line kept: ${s} (${G.checkBullets(s)})`);
  }
  for (const s of ['Toxic Screen blocks bullets.', 'Barrier Orb is just a smoke.', 'Cove does not stop bullets.',
    'Dark Cover stops bullets.', 'High Tide will block bullets for you.']) {
    ok(hit(G.checkBullets, s), `wrong bullets line caught: ${s}`);
  }
  // checkMoveFire: the habit diagnosed is kept, the habit taught is caught.
  for (const s of ['You were running while shooting, so your bullets went everywhere.', 'Most of your duels were lost shooting while moving.',
    'Firing while moving is inaccurate with every rifle in Valorant.', 'Shooting while moving makes your rifle inaccurate, so counter-strafe before each burst.']) {
    ok(!hit(G.checkMoveFire, s), `move fire diagnosis kept: ${s}`);
  }
  for (const s of ['Try shooting while moving to dodge.', 'Pair that with firing while strafing.', 'Burst, move, burst, move.']) {
    ok(hit(G.checkMoveFire, s), `move fire as the play caught: ${s}`);
  }
  ok(G.MOVE_FIRE_PAST.test('You were ') && !G.MOVE_FIRE_PAST.test('Try '), 'MOVE_FIRE_PAST matches a past lead and not an imperative');
  ok(G.MOVE_FIRE_COST.test('it is inaccurate') && !G.MOVE_FIRE_COST.test('to dodge their shots'), 'MOVE_FIRE_COST matches a cost and not a plain aim');
  // soloDrillFrame: the match named with "the", or "once the match starts", ends the frame.
  const rows = (t) => t.split(/(?<=\.)\s+/).map((s) => ({ p: 0, s }));
  ok(!G.soloDrillFrame(rows('Play Deathmatch for ten minutes on head height before you queue. In the match itself, swing right after your teammate so they can trade you.')).length,
    'In the match itself ends the drill frame');
  ok(!G.soloDrillFrame(rows('Play Deathmatch for ten minutes on head height before you queue. Then, once the match starts, stay close enough that a teammate can trade you.')).length,
    'once the match starts ends the drill frame');
  ok(G.soloDrillFrame(rows('Play Deathmatch for ten minutes. Then swing with a teammate so they can trade you.')).length === 1,
    'a team rule still inside the drill is caught');
  ok(G.MATCH_FRAME.test('In the match itself') && G.MATCH_FRAME.test('once the match starts') && !G.MATCH_FRAME.test('Play Deathmatch before you queue.'),
    'MATCH_FRAME matches the match and not the warm up');
  // PRONOUN_DRILL and MODE_AWAY are case spelled: the range of a fight is no Range.
  ok(!G.pronounDrill('Practise that at the range you died from next time.', 'Nobody could trade you there.'), 'the range as a distance is kept');
  ok(G.pronounDrill('Practise that in the Range before you queue.', 'Nobody could trade you there.'), 'the Range as the mode is caught');
  ok(G.PRONOUN_DRILL.test('Practise that in Deathmatch') && !G.PRONOUN_DRILL.test('practise that at the range you died from'), 'PRONOUN_DRILL both ways');
  ok(G.MODE_AWAY.test('rather than in the Range') && !G.MODE_AWAY.test('not the range you died from'), 'MODE_AWAY both ways');
}

// ── 7. No backspace byte ──────────────────────────────────────────────────
for (const f of ['server/services/game-claims.js', 'scripts/test-game-claims.js']) {
  ok(!fs.readFileSync(path.join(__dirname, '..', f)).includes(8), `${f} carries no backspace byte`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
