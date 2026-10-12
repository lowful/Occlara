'use strict';

/**
 * Map fingerprint checks.
 *
 * The map lock is the guard everything else leans on. The callout gate refuses
 * any tip naming a location that is not on the confirmed map, so if the
 * fingerprint never locks, the coach can send a player to a callout from a
 * different map and nothing stops it.
 *
 * It broke in the quietest possible way. Every label counted the same, so one
 * wrong generic label ("B Main", a real callout on nine maps, none of them Bind)
 * silently vetoed "B Long", which exists on Bind and nowhere else. The candidate
 * set emptied and never refilled. No throw, no log line, just a guard that had
 * stopped guarding. Three sessions on the previous model happened to produce
 * clean labels, so nothing surfaced it until a model that words things slightly
 * differently made it fire within four frames.
 *
 * Every label set below is verbatim from a real recorded session.
 *
 * Run: npm run test:maps
 */
const path = require('path');
const { __test } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
const { mapFromLabels } = __test;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// Recorded sessions, each with the map it was confirmed to be.
const RECORDED = [
  ['Icebox', ['Defender Side Spawn', 'A Site', 'B Hut', 'A Pipes', 'A Rafters', 'A Belt', 'B Tube',
    'B Orange', 'B Site', 'B Yellow', 'Mid Boiler', 'A Screen', 'Attacker Side Spawn', 'B Garage', 'A Nest']],
  // The model guessed Lotus, Fracture, Abyss AND Ascent across this one session.
  // The labels are the only reason it resolved, which is the whole argument for
  // this guard existing.
  ['Abyss', ['A Link', 'B Link', 'A Tower', 'Defender Side Spawn', 'Mid Bend', 'B Main', 'B Site',
    'B Lobby', 'Attacker Side Spawn', 'Mid Catwalk', 'A Site']],
  ['Bind', ['Attacker Side Spawn', 'B Fountain', 'B Site', 'B Link', 'B Window', 'B Short', 'A Lobby',
    'A Short', 'A Lamps', 'A Site', 'A Tower', 'A Bath', 'A Teleporter', 'B Exit', 'Defender Side Spawn',
    'B Garden', 'B Elbow', 'B Long']],
];

console.log('recorded sessions still lock the right map:');
for (const [expected, labels] of RECORDED) {
  const r = mapFromLabels(labels);
  check(`  ${expected}`, r.confident && r.map === expected, `got ${r.map} from [${r.candidates}]`);
}

// Verbatim from the first session on a model that phrases labels differently.
// "Fountain" is what the game prints as "B Fountain", the parenthetical is the
// model qualifying the name, and "B Main" is simply wrong for this map.
const NOISY_BIND = ['Attacker Side Spawn', 'Fountain', 'B Long', 'B Site', 'B Main',
  'A Site', 'B Site (Attacker Side)', 'B Link', 'B Window'];

console.log('\nnoisy labels must not disable the lock:');
const noisy = mapFromLabels(NOISY_BIND);
check('  a Bind session with a wrong label still locks Bind',
  noisy.confident && noisy.map === 'Bind', `got ${noisy.map} from [${noisy.candidates}]`);
check('  a dropped site letter is still recognised',
  mapsOf('Fountain') === 1, 'B Fountain is Bind-exclusive and must not be discarded');
check('  a qualifier is stripped, not read as a new name',
  mapFromLabels(['B Site (Attacker Side)']).candidates.length > 1);

console.log('\na wrong lock is worse than none, so evidence is still required:');
check('  generic labels alone never lock',
  !mapFromLabels(['A Site', 'B Site', 'Attacker Side Spawn']).confident,
  'these exist on all thirteen maps and identify nothing');
check('  one map-exclusive label is enough', mapFromLabels(['B Long']).confident === true);
check('  two exclusive labels from DIFFERENT maps lock neither',
  !mapFromLabels(['B Long', 'B Hut']).confident,
  'Bind and Icebox cannot both be right, so neither may win');
check('  an unknown label alone locks nothing', !mapFromLabels(['Nonexistent Place']).confident);
check('  no labels yields no answer', mapFromLabels([]) === null);

// Weighing exists to stop one bad label vetoing good ones, which needs good ones
// to protect. On a handful of labels a single wrong-but-real callout can carry
// the vote outright: a real 3-frame sample locked Haven on a Bind session.
console.log('\ncontested labels need enough evidence before they are weighed:');
check('  a wrong callout cannot carry a thin sample',
  !mapFromLabels(['Attacker Side Spawn', 'A Tower', 'Garage']).confident,
  'three labels, one of them wrong, must not decide the map');
check('  clean labels still lock on a thin sample',
  mapFromLabels(['Attacker Side Spawn', 'B Long']).confident === true,
  'the strict path must not be held back, it only fires when labels agree');
check('  the same contested set locks once evidence accumulates',
  mapFromLabels(['Attacker Side Spawn', 'A Tower', 'Garage', 'B Long', 'B Window', 'Hookah']).map === 'Bind');

// THE LOCK MUST FIT THE LABELS. On the player's Sunset swiftplay the model's
// Haven won the lock on the first two buy phase reads, the game printed B
// Lobby, B Main and Mid Bottom, none of them on Haven, and Haven went back to
// the model as context for three minutes. Two agreeing reads still acquire a
// lock; a lock two reads of the labels contradict is released, and a model
// read the labels rule out is refused.
console.log('\nthe map lock answers to the printed labels:');
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
function lockedOn(map) {
  const e = new CoachingEngine({});
  quiet(() => { e.applyMapRead(map); e.applyMapRead(map); });
  return e;
}
{
  const e = lockedOn('Haven');
  check('  two agreeing reads still acquire a lock', e.matchContext.map === 'Haven');
  quiet(() => e.applyLocationLabel('B Lobby'));
  check('  one label the locked map has not got is not enough', e.matchContext.map === 'Haven');
  quiet(() => e.applyLocationLabel('B Lobby'));
  check('  a second releases the lock', e.matchContext.map === null, `still ${e.matchContext.map}`);
  quiet(() => { e.applyMapRead('Haven'); e.applyMapRead('Haven'); });
  check('  and a map the labels rule out is refused, not even pending', e.matchContext.map === null && !e.pendingMap,
    `map ${e.matchContext.map}, pending ${e.pendingMap}`);
  quiet(() => { e.applyMapRead('Sunset'); e.applyMapRead('Sunset'); });
  check('  while one they leave locks on two agreeing reads', e.matchContext.map === 'Sunset');
}
{
  const e = lockedOn('Haven');
  quiet(() => { for (let i = 0; i < 4; i++) e.applyLocationLabel('A Site'); });
  check('  a label every map has proves nothing', e.matchContext.map === 'Haven');
  quiet(() => { e.applyLocationLabel('B Lobby'); e.applyLocationLabel('Mid Courtyard'); e.applyLocationLabel('B Main'); });
  check('  and one only some maps have, the locked one among them, clears the doubt', e.matchContext.map === 'Haven',
    `became ${e.matchContext.map}`);
}
{
  const e = lockedOn('Ascent');
  quiet(() => { e.applyLocationLabel('B Lobby'); e.applyMapRead('Sunset'); e.applyMapRead('Sunset'); });
  check('  two agreeing contradictions inside what the labels leave still correct it', e.matchContext.map === 'Sunset');
}
{
  const e = new CoachingEngine({});
  quiet(() => { e.applyLocationLabel('B Market'); e.applyLocationLabel('Mid Top'); });
  quiet(() => { e.applyLocationLabel('A Long'); e.applyLocationLabel('A Long'); });
  check('  a map the labels named outright is never released', e.mapConfirmedByLabels && e.matchContext.map === 'Sunset',
    `map ${e.matchContext.map}`);
}
{
  // A MAP THE GAME DATA DOES NOT KNOW, one released after the last sync, has
  // no labels in the index, so every label it prints would read as one it
  // lacks. The labels can say nothing about it, as the server's labelFitsMap
  // has no opinion on it either.
  const e = lockedOn('Tundra');
  quiet(() => { e.applyLocationLabel('B Lobby'); e.applyLocationLabel('B Main'); });
  check('  a map the game data does not know keeps its lock whatever is printed', e.matchContext.map === 'Tundra',
    `became ${e.matchContext.map}`);
  const f = new CoachingEngine({});
  quiet(() => { f.applyLocationLabel('B Lobby'); f.applyMapRead('Tundra'); f.applyMapRead('Tundra'); });
  check('  and locks on two agreeing reads, never refused', f.matchContext.map === 'Tundra', `map ${f.matchContext.map}`);
}

function mapsOf(label) {
  return mapFromLabels([label]).candidates.length;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
