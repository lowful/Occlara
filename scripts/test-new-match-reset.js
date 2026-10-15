'use strict';

/**
 * A second match in one session has to be allowed to be a different map.
 *
 * The new-match reset cleared matchContext.map so the map could be re-read, but
 * left the LABEL FINGERPRINT from the previous match in place. applyMapRead
 * returns immediately while mapConfirmedByLabels is set:
 *
 *     if (this.mapConfirmedByLabels) return;
 *
 * so after one match had been confirmed from printed labels, the next match
 * could never lock a map at all. It sat permanently unknown, and an unknown map
 * makes the callout gate reject every named callout, so the coach spent a whole
 * match unable to say where anything was. The stale seenLabels made it worse by
 * filtering the new map's labels against the old map's candidates.
 *
 * Whatever a match reset means, it cannot mean "half the map state".
 *
 * AND A NEW MATCH NEEDS TIME, NOT TWO READS (8.4.3). At a read a second two
 * reads are one moment read twice: the low score has to be read over ten
 * seconds, on three reads at least, with no read of the held score or a
 * higher one between them, and all of it within thirty seconds of the wait's
 * first read, or the wait starts again. Once the watch has ended the match,
 * one read.
 *
 * Run: npm run test:newmatch
 */
const path = require('path');
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// Labels the game prints beside the minimap. These two together occur on
// exactly one map, which is what lets the fingerprint be decisive.
const SUNSET_LABELS = ['B Market', 'Mid Top'];

// Every read below is taken on this clock, `s` seconds in.
const T0 = Date.parse('2026-10-14T00:30:00Z');
const at = (s) => T0 + s * 1000;

/** A session that has played most of a match on a label-confirmed map. */
function matchInProgress() {
  const e = new CoachingEngine({});
  e.updateMatchContext({ roundNumber: 9, teamScore: 5, enemyScore: 4, phase: 'active', side: 'attack' }, at(0));
  for (const l of SUNSET_LABELS) e.applyLocationLabel(l);
  return e;
}

/** The next match's buy phase at 0 to 0, its timer at 0:44 at 60 s, read once a second for `n` reads from `from` seconds. */
function zeroes(e, from, n) {
  for (let s = from; s < from + n; s++) {
    e.updateMatchContext({ roundNumber: 1, teamScore: 0, enemyScore: 0, phase: 'buy', clock: `0:${String(Math.max(0, 104 - s)).padStart(2, '0')}` },
      at(s));
  }
}
const reset = (e) => e.mapConfirmedByLabels === false && e.matchContext.map === null;
/** A read with no score of its own at `s` seconds: the player dead, a menu over the score, the line left out. */
const noScore = (e, s) => e.updateMatchContext({ phase: 'active', clock: '1:20', playerAlive: true, playerHp: 100 }, at(s));

console.log('a match confirmed from the printed labels:');
const warm = matchInProgress();
check('  the map was identified', !!warm.matchContext.map, 'the fingerprint should have resolved');
check('  and locked by labels', warm.mapConfirmedByLabels === true);
const firstMap = warm.matchContext.map;
console.log(`        (identified as ${firstMap} from ${SUNSET_LABELS.join(' + ')})`);

console.log('\nthe model cannot overturn a label lock, which must not regress:');
{
  const e = matchInProgress();
  e.applyMapRead('Ascent');
  e.applyMapRead('Ascent');
  check('  two agreeing model reads are refused', e.matchContext.map === firstMap,
    `became ${e.matchContext.map}`);
}

console.log('\nnow a NEW MATCH starts in the same session:');
{
  const e = matchInProgress();
  // Round falls back and both scores reset, read over ten seconds: the bar the
  // reset needs, since a misread 0 to 0 must not wipe a live match's locks,
  // and the model reads one frame's misread again on the frames after it.
  zeroes(e, 60, 1);
  check('  one 0 to 0 read is not enough to reset a live match', e.mapConfirmedByLabels === true);
  zeroes(e, 61, 2);
  check('  nor three in two seconds, one moment read three times', e.mapConfirmedByLabels === true && e.matchContext.map === firstMap,
    'two reads a second apart reset the match');
  zeroes(e, 63, 7);
  check('  nor nine seconds of them', e.mapConfirmedByLabels === true && e.matchContext.map === firstMap,
    'reset under ten seconds');
  zeroes(e, 70, 1);

  check('  ten seconds of them reset it: the map was cleared', e.matchContext.map === null, `still ${e.matchContext.map}`);
  check('  THE LABEL LOCK WAS CLEARED TOO', e.mapConfirmedByLabels === false,
    'this is the assertion the whole file exists for');
  check('  the old labels are gone', (e.seenLabels || []).length === 0,
    `still holding ${(e.seenLabels || []).join(', ')}`);
  check('  no stale doubt', !e.mapDoubt && !e.mapChallenger);
  check('  the map is not flagged uncertain', e.matchContext.mapUncertain === false);

  // The point of clearing it: the new match can now lock its own map.
  e.applyMapRead('Ascent');
  check('  one read does not lock yet', e.matchContext.map === null);
  e.applyMapRead('Ascent');
  check('  TWO AGREEING READS LOCK THE NEW MAP', e.matchContext.map === 'Ascent',
    `got ${e.matchContext.map}, so the new match could never be coached with callouts`);
}

console.log('\nand a new match can be identified from its own labels:');
{
  const e = matchInProgress();
  zeroes(e, 60, 11);
  e.applyLocationLabel('A Wine');          // occurs on exactly one map: Ascent
  e.applyLocationLabel('B Boat House');
  check('  the fingerprint resolves again', !!e.matchContext.map, 'the new labels should identify a map');
  check('  and it is the new match\'s map, not the old one',
    e.matchContext.map && e.matchContext.map.toLowerCase() === 'ascent',
    `got ${e.matchContext.map}, previous match was ${firstMap}`);
  check('  locked by labels again', e.mapConfirmedByLabels === true);
}

console.log('\na live match is never reset by one odd read:');
{
  const e = matchInProgress();
  // Round falls back but the scores do not agree, so this is a misread digit.
  e.updateMatchContext({ roundNumber: 1, teamScore: 5, enemyScore: 4 }, at(60));
  check('  the map lock survives', e.matchContext.map === firstMap);
  check('  the label lock survives', e.mapConfirmedByLabels === true);
  check('  the labels survive', (e.seenLabels || []).length > 0);
}

console.log('\na read of the held score between them starts the wait again:');
{
  const e = matchInProgress();
  zeroes(e, 60, 6);
  e.updateMatchContext({ teamScore: 5, enemyScore: 4, phase: 'active', clock: '1:20' }, at(66));
  zeroes(e, 67, 6);
  check('  twelve seconds of 0 to 0 with one read of 5 to 4 in them reset nothing',
    e.mapConfirmedByLabels === true && e.matchContext.map === firstMap, 'the read of the held score did not stop the wait');
  zeroes(e, 73, 4);
  check('  nor nine seconds of them after it', e.mapConfirmedByLabels === true);
  zeroes(e, 77, 1);
  check('  ten seconds after it do', reset(e), `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}
{
  const e = matchInProgress();
  zeroes(e, 60, 6);
  e.updateMatchContext({ teamScore: 6, enemyScore: 4, phase: 'active', clock: '1:20' }, at(66));
  zeroes(e, 67, 4);
  check('  and so does a score past it, one round on', e.mapConfirmedByLabels === true && e.matchContext.map === firstMap);
}

console.log('\na read with no score of its own is no evidence either way:');
{
  const e = matchInProgress();
  zeroes(e, 60, 1);
  for (let s = 61; s < 70; s++) e.updateMatchContext({ phase: 'buy', clock: `0:${44 - (s - 60)}`, playerAlive: true }, at(s));
  e.updateMatchContext({ teamScore: 5, phase: 'buy', clock: '0:34' }, at(70));
  zeroes(e, 71, 1);
  check('  two 0 to 0 reads eleven seconds apart are not three', e.mapConfirmedByLabels === true);
  zeroes(e, 72, 1);
  check('  a third is: the reads between, with no score or one digit of it, neither count nor stop the wait', reset(e),
    `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}

console.log('\nand all of it within thirty seconds of the wait\'s first read:');
{
  // A real session goes minutes with no score read (the Abyss match's AI log
  // has 144 seconds of it), and a read with no score never ends the wait.
  const e = matchInProgress();
  for (let s = 61; s <= 200; s++) {
    if ((s - 60) % 20 === 0) zeroes(e, s, 1);
    else noScore(e, s);
  }
  check('  seven 0 to 0 misreads twenty seconds apart, over two minutes of reads with no score, reset nothing',
    e.mapConfirmedByLabels === true && e.matchContext.map === firstMap, `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}
{
  const e = matchInProgress();
  zeroes(e, 60, 1);
  zeroes(e, 65, 1);
  for (let s = 66; s < 91; s++) noScore(e, s);
  zeroes(e, 91, 1);
  check('  a third 0 to 0 read 31 seconds after the first is no new match: the wait starts again on it',
    e.mapConfirmedByLabels === true && e.matchContext.map === firstMap, 'believed past thirty seconds');
  zeroes(e, 96, 1);
  check('  nor is one more five seconds on', e.mapConfirmedByLabels === true);
  zeroes(e, 101, 1);
  check('  and ten seconds and three reads from it, it is believed', reset(e), `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}
{
  const e = matchInProgress();
  zeroes(e, 60, 1);
  zeroes(e, 65, 1);
  for (let s = 66; s <= 91; s++) noScore(e, s);
  zeroes(e, 92, 1);
  zeroes(e, 97, 1);
  check('  ended past thirty seconds by a read with no score, the wait begins again on the next low read: two reads after it are not three',
    e.mapConfirmedByLabels === true && e.matchContext.map === firstMap, 'believed on reads from before the wait ended');
  zeroes(e, 102, 1);
  check('  and the third, ten seconds after it, is believed', reset(e), `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}
{
  // The slowest a real new match's first buy phase is read: every 5 s (the
  // slowest capture speed, or the buy phase asleep).
  const e = matchInProgress();
  zeroes(e, 60, 1);
  zeroes(e, 65, 1);
  check('  read every five seconds, two reads are not yet a new match', e.mapConfirmedByLabels === true);
  zeroes(e, 70, 1);
  check('  the third, ten seconds after the first, is', reset(e), `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}
{
  const e = matchInProgress();
  zeroes(e, 60, 1);
  for (const s of [65, 70, 75, 80]) noScore(e, s);
  zeroes(e, 85, 1);
  zeroes(e, 90, 1);
  check('  and with four of the six reads after its first carrying no score, still, on the seventh, thirty seconds after it',
    reset(e), `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}

console.log('\nonce the watch has ended the match, one read is enough:');
{
  const e = matchInProgress();
  e.endWatch.end('lobby', at(50));
  zeroes(e, 60, 1);
  check('  the next match\'s first 0 to 0 resets the locks at once', reset(e),
    `map ${e.matchContext.map}, label lock ${e.mapConfirmedByLabels}`);
}

console.log('\nstarting a session clears it too:');
{
  const e = matchInProgress();
  e.stop();
  e.start();
  check('  label lock cleared', e.mapConfirmedByLabels === false);
  check('  labels cleared', (e.seenLabels || []).length === 0);
  check('  doubt cleared', !e.mapDoubt && !e.mapChallenger);
  e.stop();
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
