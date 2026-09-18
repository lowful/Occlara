// Exercise the death-location gate against the real tips from the session the
// player flagged: the ones that named the right spot must still pass, and the
// ones that named a different place must be rejected.
const path = require('path');
const { isDeathReview, wrongDeathSpot } =
  require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js')).__test;

const deadCtx = (spot) => ({ playerAlive: false, phase: 'dead', deathSpot: spot });

// [tip, pinned death spot, should it be rejected]
const cases = [
  // Correct ones from the log: these must still reach the player.
  ['You died alone in A Sewer while your team was in spawn, wait for them.', 'A Sewer', false],
  ['You pushed A Sewer alone while your team was in spawn, giving Reyna a free kill.', 'A Sewer', false],
  ['You died in Mid Window while your team was stacking C Lobby, stay with your team.', 'Mid Window', false],
  // Wrong ones from the log: drifted to the spectator camera.
  ['You pushed into C Link alone while the spike was down, giving them an easy pick.', 'A Sewer', true],
  ['Still pushing solo into C Link while the spike is down, wait for your team.', 'A Sewer', true],
  ['You walked into Mid Window alone while flashed, giving the defenders a free kill.', 'A Sewer', true],
  // Invented a place when nothing was captured.
  ['You died alone at B Site while your team was in spawn, wait for them to contact.', null, true],
  ['You died dry peeking A Long alone, wait for your team to group.', 'A Lobby', true],
  // No location named at all: always fine.
  ['You died to a crossfire, reset after the kill instead of repeeking.', null, false],
  ['You died taking a dry duel with no trade partner nearby.', 'A Sewer', false],
];

let pass = 0, fail = 0;
for (const [tip, spot, shouldReject] of cases) {
  const isReview = isDeathReview(tip, deadCtx(spot));
  const wrong = isReview ? wrongDeathSpot(tip.toLowerCase(), spot) : null;
  const rejected = !!wrong;
  const ok = rejected === shouldReject;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${rejected ? 'REJECT' : 'allow '}  pinned=${String(spot).padEnd(11)} ${wrong ? `named "${wrong}"` : ''}`);
  if (!ok) console.log(`        tip: ${tip}`);
}

// What matters is whether a tip is ALLOWED THROUGH, not whether the gate looks
// at it. A tip that names no location must always survive, even while dead.
const allowed = (tip, ctx) => !(isDeathReview(tip, ctx) && wrongDeathSpot(tip.toLowerCase(), ctx.deathSpot));

const habit = 'Clear one angle at a time from cover, never wide swing into multiple angles.';
if (allowed(habit, deadCtx('A Sewer'))) { pass++; console.log('PASS  a general habit tip still gets through while dead'); }
else { fail++; console.log('FAIL  a general habit tip was blocked'); }

const mate = 'Trade your teammate the moment they die instead of holding your angle.';
if (allowed(mate, deadCtx('A Sewer'))) { pass++; console.log('PASS  a teammate death tip still gets through'); }
else { fail++; console.log('FAIL  a teammate death tip was blocked'); }

// And a live tip naming somewhere else is untouched once the player respawns.
const live = { playerAlive: true, phase: 'active', lastDeathAt: 0, deathSpot: null };
if (allowed('Hold a tight angle at C Link and wait for your team.', live)) {
  pass++; console.log('PASS  a live tip can name any location after respawn');
} else { fail++; console.log('FAIL  a live tip was blocked'); }

// While alive with no recent death, the gate stays off entirely.
if (!isDeathReview('You died at A Sewer.', { playerAlive: true, phase: 'active', lastDeathAt: 0 })) {
  pass++; console.log('PASS  gate is off when no death is in play');
} else { fail++; console.log('FAIL  gate fired with no death in play'); }

/*
 * ── THE SITE CHECK, from session 2026-09-18 ─────────────────────────────────
 *
 * That session blocked SIXTEEN death reviews here against seven that reached the
 * player, and death reviews are the most valuable tip the coach writes.
 *
 * Six of the sixteen were the model being MORE precise than the record, not
 * wrong: "a rafters" against a recorded "A Site", "b main" against "B Site".
 * Rafters is on A. The record is one coarse label from one frame, so naming a
 * specific place inside the right site is better coaching rather than a lie.
 *
 * Three more were blocked with "the player died at Defender Side Spawn", a
 * sentence the coach should never be able to form. Players do not die in their
 * own spawn, so that slot held a broken capture rather than a truth.
 *
 * The case this gate exists for has to keep working, which is the wrong SITE.
 */
console.log('\nthe site check:');
const spotWhy = (tip, truth, map) => {
  const r = wrongDeathSpot(tip.toLowerCase(), truth, map);
  return r ? r.why : 'allowed';
};
for (const [tip, truth, map, want, why] of [
  ['You died at A Rafters holding alone.', 'A Site', 'Ascent', 'allowed', 'finer detail inside the same site'],
  ['You died at B Main without a trade.', 'B Site', 'Ascent', 'allowed', 'B Main resolves to site B'],
  ['You died at A Garden pushing wide.', 'A Site', 'Ascent', 'allowed', 'A Garden resolves to site A'],
  ['You died at A Site holding alone.', 'A Site', 'Ascent', 'allowed', 'an exact match, as before'],
  ['You died at B Lobby alone.', 'A Site', 'Ascent', 'elsewhere', 'THE WRONG SITE STILL BLOCKS'],
  ['You died at A Main too wide.', 'Mid Bottom', 'Ascent', 'elsewhere', 'A against Mid still blocks'],
  ['You died at B Main without cover.', 'Defender Side Spawn', 'Ascent', 'spawn', 'a spawn is not a death location'],
  ['You died at B Lobby alone.', '', 'Ascent', 'uncaptured', 'nothing captured still blocks'],
  ['You played that fight well.', 'A Site', 'Ascent', 'allowed', 'no location claimed, nothing to check'],
]) {
  const got = spotWhy(tip, truth, map);
  if (got === want) { pass++; console.log('PASS  ' + why); }
  else { fail++; console.log('FAIL  ' + why + '  (got ' + got + ', want ' + want + ')'); }
}

// Without a map there is no geometry, so the site shortcut cannot apply and the
// gate falls back to exact matching. Losing the map must not start allowing
// things, only stop the extra leniency.
if (spotWhy('You died at A Rafters.', 'A Site', undefined) === 'elsewhere') {
  pass++; console.log('PASS  with no map known, it falls back to strict matching');
} else { fail++; console.log('FAIL  an unknown map changed the strict behaviour'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
