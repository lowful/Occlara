'use strict';

/**
 * WHEN YOU PLAY BEST (9.1, the owner's item 15): src/shared/play-times.js,
 * the times of day a player's graded matches started in, and the best and
 * worst of them, only once there are enough to say it honestly.
 *
 * Every clock here is UTC (hourOf), so the test reads the same on every PC.
 *
 * Run: npm run test:playtimes
 */
const P = require('../src/shared/play-times');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const DASHES = /[–—]/;
const utc = (ms) => new Date(ms).getUTCHours();
const DAY = 24 * 3600 * 1000;
const BASE = Date.UTC(2026, 10, 1);

/** A row that STARTED at hour h of day d (Riot's start kept), graded g. */
const at = (d, h, g, result, extra) => ({
  id: `r${d}-${h}-${g}`, at: BASE + d * DAY + h * 3600000 + 40 * 60000, matchStartedAt: BASE + d * DAY + h * 3600000,
  grade: g === null ? null : { score: g, provisional: false }, result: result === undefined ? 'Victory' : result, score: '13-9', ...(extra || {}),
});

console.log('\nthe start of a match:');
{
  ok(P.startOf({ matchStartedAt: 5000, at: 9000 }) === 5000, "Riot's own start, where the review kept one");
  ok(P.startOf({ at: 10 * 3600000, score: '13-11' }) === 10 * 3600000 - 24 * 100000, 'else its end less 100 seconds a round of its score');
  ok(P.startOf({ at: 10 * 3600000, score: '7 : 13' }) === 10 * 3600000 - 20 * 100000, 'a score written with a colon reads the same');
  ok(P.startOf({ at: 10 * 3600000 }) === 10 * 3600000 - 30 * 60000, 'else its end less half an hour, with no score');
  ok(P.startOf({}) === null && P.startOf(null) === null, 'and nothing without a time');
}

console.log('\nthe times of day are named as a clock says them:');
{
  ok(P.slotLabel(0) === 'Midnight to 3 AM', P.slotLabel(0));
  ok(P.slotLabel(3) === '9 AM to noon', P.slotLabel(3));
  ok(P.slotLabel(4) === 'Noon to 3 PM', P.slotLabel(4));
  ok(P.slotLabel(6) === '6 PM to 9 PM', P.slotLabel(6));
  ok(P.slotLabel(7) === '9 PM to midnight', P.slotLabel(7));
  const all = Array.from({ length: 8 }, (_, i) => P.slotLabel(i));
  ok(new Set(all).size === 8 && all.every((l) => !DASHES.test(l)), 'eight names, all different, no dash', all.join(' | '));
}

console.log('\nbelow the threshold it says how many more it needs:');
{
  const none = P.playTimes([], { hourOf: utc });
  ok(!none.enough && none.need === P.MIN_TOTAL && none.best === null, 'an empty library needs the whole threshold', JSON.stringify(none.need));
  ok(/^Shows after 10 more graded matches, with at least 4 in each of two times of day\. No graded matches yet\.$/.test(none.text.note), none.text.note);

  // Seven matches, all in the evening: the total needs 3 more, a second time
  // of day needs 4, so 4 more.
  const evening = [0, 1, 2, 3, 4, 5, 6].map((d) => at(d, 19, 70 + d));
  const r = P.playTimes(evening, { hourOf: utc });
  ok(!r.enough && r.need === 4, 'one time of day full: it needs the second one\'s four', `need ${r.need}`);
  ok(r.text.note === 'Shows after 4 more graded matches, with at least 4 in each of two times of day. 7 graded matches so far.', r.text.note);
  ok(r.counted === 7 && r.slots[6].n === 7 && r.slots[6].compared, 'the seven counted, in 6 PM to 9 PM');

  // Twelve matches in one time of day: enough in all, one time to compare.
  const one = Array.from({ length: 12 }, (_, d) => at(d, 20, 75));
  const r1 = P.playTimes(one, { hourOf: utc });
  ok(!r1.enough && r1.need === 4 && r1.best === null, 'enough matches but one time of day: never a best of one', `need ${r1.need}`);

  // Two times of day at three each: the total and the times both short.
  const thin = [at(0, 19, 80), at(1, 19, 82), at(2, 19, 78), at(0, 1, 60), at(1, 1, 62), at(2, 1, 58)];
  const r2 = P.playTimes(thin, { hourOf: utc });
  ok(!r2.enough && r2.need === 4, 'six matches, three a time: four more for the total, two for the times, so four', `need ${r2.need}`);
  ok(r2.slots.every((s) => !s.compared), 'and neither time of day is compared at three');
  ok(!Object.prototype.hasOwnProperty.call(r2.slots[0], 'grades'), 'the grades themselves are not handed out');
}

console.log('\nwhat counts:');
{
  const rows = [at(0, 19, 80), at(1, 19, null), { ...at(2, 19, 90), work: { path: 'riot' } }, { id: 'x', grade: { score: 70 } }];
  const r = P.playTimes(rows, { hourOf: utc });
  ok(r.counted === 1 && r.undated === 1, 'a graded row counts; one ungraded, one still being checked and one with no time do not',
    JSON.stringify({ counted: r.counted, undated: r.undated }));
  const draws = [at(0, 19, 70, 'Victory'), at(1, 19, 70, 'Defeat'), at(2, 19, 70, 'Draw'), at(3, 19, 70, null)];
  const s = P.playTimes(draws, { hourOf: utc }).slots[6];
  ok(s.n === 4 && s.won === 1 && s.lost === 1 && s.decided === 2 && s.winPct === 50,
    'the win rate is over the matches with a result; a draw and none are in the average only', JSON.stringify(s));
}

console.log('\nwith enough, the best and worst times, said with their counts:');
{
  // Evenings strong, nights weak, mornings in between, all with spread.
  const rows = [];
  [84, 88, 79, 86, 90, 82].forEach((g, d) => rows.push(at(d, 19, g, d % 3 === 2 ? 'Defeat' : 'Victory')));
  [58, 62, 55, 64, 60].forEach((g, d) => rows.push(at(d, 1, g, d === 1 ? 'Victory' : 'Defeat')));
  [72, 70, 74].forEach((g, d) => rows.push(at(d, 10, g)));
  const r = P.playTimes(rows, { hourOf: utc });
  ok(r.enough && r.counted === 14 && r.need === 0, 'fourteen graded, two times of day compared', JSON.stringify({ enough: r.enough, need: r.need }));
  ok(r.best && r.best.label === '6 PM to 9 PM' && r.best.avg === 85 && r.best.n === 6 && r.best.won === 4 && r.best.decided === 6,
    'the best: the evening, its average, its count and its wins', JSON.stringify(r.best));
  ok(r.worst && r.worst.label === 'Midnight to 3 AM' && r.worst.avg === 60 && r.worst.n === 5 && r.worst.won === 1,
    'the worst: the night', JSON.stringify(r.worst));
  ok(!r.slots[3].compared && r.slots[3].n === 3, 'the morning, at three, is drawn and not compared');
  ok(r.clear && r.gap === 25, 'a gap of 25 over these counts is clear', `gap ${r.gap}, clear ${r.clear}`);
  ok(r.text.best.line === 'Average grade 85 over 6 matches, won 4 of 6.', r.text.best.line);
  ok(r.text.worst.line === 'Average grade 60 over 5 matches, won 1 of 5.', r.text.worst.line);
  ok(r.text.note === 'From 14 graded matches, by when each started.', r.text.note);
  ok(r.text.title === 'Best time to play' && r.text.best.kicker === 'Best time to play' && r.text.worst.kicker === 'Worst time to play',
    'clear, they are called the best and the worst time to play', JSON.stringify(r.text));
  const all = JSON.stringify(r.text);
  ok(!DASHES.test(all), 'no dash in anything it says');
}

console.log('\ntoo close to call is said, never a best by chance:');
{
  const rows = [];
  [70, 82, 64, 76, 74].forEach((g, d) => rows.push(at(d, 19, g)));
  [68, 80, 62, 74, 70].forEach((g, d) => rows.push(at(d, 13, g)));
  const r = P.playTimes(rows, { hourOf: utc });
  ok(r.enough && !r.clear && r.gap === 2, 'two points apart with this spread is not clear', JSON.stringify({ gap: r.gap, clear: r.clear }));
  ok(/^Too close to call yet: your best time is 2 points over your worst across 5 and 5 matches, which chance alone can give\. More matches will tell\.$/.test(r.text.note), r.text.note);
  ok(r.text.best && r.text.worst && /over 5 matches/.test(r.text.best.line), 'the two are still named, with their counts');
  ok(r.text.title === 'No clear best time yet' && r.text.best.kicker === 'Highest so far' && r.text.worst.kicker === 'Lowest so far',
    'and called the highest and lowest so far, never the best and the worst', JSON.stringify(r.text));

  // A steady player: every grade the same. The floor on the spread keeps a
  // 4 point gap from being called clear on four matches.
  const steady = [];
  for (let d = 0; d < 5; d++) steady.push(at(d, 19, 76));
  for (let d = 0; d < 5; d++) steady.push(at(d, 13, 72));
  const s = P.playTimes(steady, { hourOf: utc });
  ok(s.enough && !s.clear, 'four points between two very steady times of day over five each is not clear', JSON.stringify({ gap: s.gap, clear: s.clear }));

  // A big real gap over many matches is.
  const many = [];
  for (let d = 0; d < 12; d++) many.push(at(d, 19, 80 + (d % 3)));
  for (let d = 0; d < 12; d++) many.push(at(d, 13, 66 + (d % 3)));
  ok(P.playTimes(many, { hourOf: utc }).clear, 'fourteen points over twelve matches each is clear');
}

console.log('\nthe player\'s own clock decides the hour:');
{
  // 23:30 UTC is 1:30 the next day two hours east.
  const row = { id: 'tz', at: Date.UTC(2026, 10, 1, 23, 30) + 1800000, matchStartedAt: Date.UTC(2026, 10, 1, 23, 30), grade: { score: 70 } };
  const east = P.playTimes([row], { hourOf: (ms) => new Date(ms + 2 * 3600000).getUTCHours() });
  ok(east.slots[0].n === 1 && east.slots[7].n === 0, 'a match at 23:30 UTC is midnight to 3 AM two hours east');
  ok(P.playTimes([row], { hourOf: utc }).slots[7].n === 1, 'and 9 PM to midnight in UTC');
  ok(P.playTimes([row]).counted === 1, 'with no clock given, the local clock reads it');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
