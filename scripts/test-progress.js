'use strict';

/**
 * Progress (src/shared/progress.js): one match against the ones before it.
 * The deltas on the last match and the average, a best only over three or
 * more graded matches and never from a provisional grade, a run of B or
 * better broken by a C, a habit cleared with judged entries and `cause:` keys
 * skipped, the focus check's four outcomes and its nulls, the library's marks,
 * and the lines: no dash in any, and every number in one a field beside it.
 * Then the real Abyss review, built from its fixture, read as a library of
 * six, and a League review, graded only.
 *
 * Run: npm run test:progress
 */

const fs = require('fs');
const path = require('path');
const { matchProgress, libraryProgress, RUN_LETTERS, BEST_FLOOR } = require('../src/shared/progress');
const { letter } = require('../src/shared/grade');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const DASH = /[\u2013\u2014]/;
ok(DASH.test('a \u2014 b') && DASH.test('1\u20132') && !DASH.test('a - b'), 'the dash finder finds a known em and en dash, and not a hyphen');

const T0 = Date.parse('2026-10-01T18:00:00Z');
const HOUR = 3600000;
const cats = (s) => [
  { key: 'impact', label: 'Impact', score: s },
  { key: 'survival', label: 'Survival', score: s },
];
/** One saved review: `i` places it, 0 newest. */
function rv(i, score, opts = {}) {
  const id = opts.id || `valorant-${T0 - i * HOUR}-t${i}`;
  return {
    id, game: opts.game || 'valorant', at: T0 - i * HOUR,
    review: {
      kind: opts.kind || 'valorant', source: opts.source || 'watched', verified: opts.verified !== false,
      grade: score === null ? null : { score, letter: letter(score), provisional: !!opts.provisional,
        categories: opts.categories || cats(score) },
      insights: { mistakes: opts.mistakes || [], strengths: [], missed: [] },
      focus: opts.focus || null,
    },
  };
}
const m = (key, count, extra = {}) => ({ key, title: extra.title || `Title ${key}`, count, rounds: [], weight: 1, ...extra });

/** Every number in a line is one of the progress's own fields. */
function numbersMatch(p) {
  const allowed = new Set();
  const add = (v) => { if (typeof v === 'number') allowed.add(String(Math.abs(v))); };
  if (p.vsLast) add(p.vsLast.delta);
  if (p.vsAverage) { add(p.vsAverage.delta); add(p.vsAverage.average); add(p.vsAverage.matches); add(p.vsAverage.of); }
  if (p.best.grade) add(p.best.grade.matches);
  if (p.best.firstLetter) add(p.best.firstLetter.matches);
  for (const c of p.best.categories) { add(c.matches); add(c.score); }
  if (p.run) add(p.run.count);
  for (const c of p.cleared) add(c.streak);
  if (p.focus) { add(p.focus.before); add(p.focus.now); }
  const titles = [...p.cleared.map((c) => c.title), p.focus && p.focus.title].filter(Boolean);
  return p.lines.every((l) => {
    let t = l.text;
    for (const x of titles) t = t.split(x).join('');
    return (t.match(/\d+/g) || []).every((n) => allowed.has(n));
  });
}
const NUM = /\d+/g;
ok(('Up 6 on 23 matches.'.match(NUM) || []).join(',') === '6,23', 'the number finder finds the numbers in a known line');
const allLines = [];
const check = (p, what) => {
  ok(p.lines.every((l) => l && typeof l.kind === 'string' && ['good', 'bad', 'even'].includes(l.tone) && typeof l.text === 'string' && l.text),
    `${what}: every line has a kind, a tone and a text`);
  ok(p.lines.every((l) => !DASH.test(l.text)), `${what}: no dash in any line`);
  ok(numbersMatch(p), `${what}: every number in its lines is a field (${p.lines.map((l) => l.text).join(' | ')})`);
  allLines.push(...p.lines);
};

// ── Deltas ────────────────────────────────────────────────────────────────
{
  const saved = [rv(0, 78), rv(1, 72), rv(2, 70), rv(3, 65)];
  const p = matchProgress(saved, saved[0].id);
  ok(p.id === saved[0].id && p.score === 78 && p.letter === 'B' && p.provisional === false, 'the match itself: its id, score and letter');
  ok(p.vsLast && p.vsLast.delta === 6 && p.vsLast.score === 72 && p.vsLast.letter === 'B' && p.vsLast.at === saved[1].at,
    `up 6 on the last match (${JSON.stringify(p.vsLast)})`);
  ok(p.vsAverage && p.vsAverage.average === 69 && p.vsAverage.delta === 9 && p.vsAverage.matches === 3,
    `9 over the average of the 3 before it (${JSON.stringify(p.vsAverage)})`);
  ok(p.lines.some((l) => l.kind === 'last' && l.tone === 'good' && l.text === 'Up 6 on your last match.'), 'the last line carries its sign as a word');
  ok(p.lines.some((l) => l.kind === 'average' && l.text === 'Up 9 on your average of 69 over your last 3 graded matches.'),
    'the average line names its window');
  check(p, 'deltas');

  const down = matchProgress(saved, saved[1].id);
  ok(down.vsLast.delta === 2 && down.vsAverage && down.vsAverage.matches === 2 && down.vsAverage.average === 68, 'an older match reads only what came before it');
  const level = matchProgress([rv(0, 70), rv(1, 70)], `valorant-${T0}-t0`);
  ok(level.vsLast.delta === 0 && level.lines.some((l) => l.tone === 'even' && l.text === 'Level with your last match.'), 'a level match says so');
  ok(level.vsAverage === null, 'no average from one match before it');
  const lower = matchProgress([rv(0, 60), rv(1, 70), rv(2, 72)], `valorant-${T0}-t0`);
  ok(lower.lines.some((l) => l.tone === 'bad' && l.text === 'Down 10 on your last match.'), 'a lower match says Down, never a minus');
  check(lower, 'a lower match');

  // A provisional grade is no final one (breakdown.js gradeOf leaves it out).
  // A verified 80 over two provisional 40s said "Up 40 on your average of 40
  // over your last 2 graded matches." with no provisional mark.
  const prov = matchProgress([rv(0, 80), rv(1, 40, { provisional: true }), rv(2, 40, { provisional: true })], `valorant-${T0}-t0`);
  ok(prov.vsAverage && prov.vsAverage.provisional === true
    && prov.lines.some((l) => l.kind === 'average' && /Provisional grade\.$/.test(l.text)),
  `an average of provisional grades says it is provisional (${JSON.stringify(prov.vsAverage)})`);
  check(prov, 'an average of provisional grades');
  const finals = matchProgress([rv(0, 80), rv(1, 40, { provisional: true }), rv(2, 70), rv(3, 72)], `valorant-${T0}-t0`);
  ok(finals.vsAverage && finals.vsAverage.average === 71 && finals.vsAverage.matches === 2 && finals.vsAverage.left === 1
    && finals.vsAverage.provisional === false
    && finals.lines.some((l) => l.kind === 'average' && l.text === 'Up 9 on your average of 71 over 2 of your last 3 graded matches, provisional grades left out.'),
  `with two final grades or more, the provisional ones are left out and the line says so (${JSON.stringify(finals.vsAverage)})`);
  check(finals, 'an average with a provisional grade left out');
  ok(matchProgress(saved, 'valorant-1-nope') === null, 'an id not in the list is null');
  ok(matchProgress([rv(0, 80)], `valorant-${T0}-t0`).vsLast === null, 'the first match has nothing to compare with');
}

// ── Best: three or more before it, provisional excluded ───────────────────
{
  const two = [rv(0, 85), rv(1, 70), rv(2, 72)];
  ok(matchProgress(two, two[0].id).best.grade === null, `no best over ${BEST_FLOOR - 1} graded matches`);
  const three = [rv(0, 85), rv(1, 70), rv(2, 72), rv(3, 75)];
  const p = matchProgress(three, three[0].id);
  ok(p.best.grade && p.best.grade.over === 3 && p.best.grade.matches === 4, `a best over 3 before it (${JSON.stringify(p.best.grade)})`);
  ok(p.best.firstLetter && p.best.firstLetter.letter === 'A', 'and the first A in the window');
  ok(p.lines[0].kind === 'first' && p.lines[0].text === 'First A in your last 4 graded matches.', 'a first A leads the lines, naming its window');
  ok(p.best.categories.length === 2 && p.best.categories[0].previous === 75 && p.best.categories[0].score === 85,
    `per category bests (${JSON.stringify(p.best.categories)})`);
  check(p, 'a best');

  const tie = [rv(0, 75), rv(1, 70), rv(2, 72), rv(3, 75)];
  ok(matchProgress(tie, tie[0].id).best.grade === null, 'a tie is no best');
  const prov = [rv(0, 95, { provisional: true }), rv(1, 70), rv(2, 72), rv(3, 75)];
  const pp = matchProgress(prov, prov[0].id);
  ok(pp.best.grade === null && pp.best.firstLetter === null && pp.best.categories.length === 0 && pp.run === null,
    'a provisional grade makes no best and no run');
  ok(pp.vsLast && pp.vsLast.provisional === true && pp.lines.some((l) => l.kind === 'last' && /Provisional grade\.$/.test(l.text)),
    'its delta is still given, flagged provisional');
  const bestAfterA = [rv(0, 84), rv(1, 70), rv(2, 82), rv(3, 75)];
  const q = matchProgress(bestAfterA, bestAfterA[0].id);
  ok(q.best.grade && q.best.firstLetter === null && q.lines[0].kind === 'best'
    && q.lines[0].text === 'Best grade in your last 4 graded matches.', 'a best with an A before it is a best, not a first');
  const cap = [rv(0, 80, { categories: [{ key: 'impact', label: 'Impact', score: 109 }] }),
    rv(1, 70, { categories: [{ key: 'impact', label: 'Impact', score: 104 }] }), rv(2, 70), rv(3, 70)];
  ok(matchProgress(cap, cap[0].id).best.categories.length === 0, 'a category is compared as the card shows it, capped at 100');
}

// ── Run ───────────────────────────────────────────────────────────────────
{
  ok(['S', 'A', 'B'].every((l) => RUN_LETTERS.has(l)) && !RUN_LETTERS.has('C'), 'the run letters are S, A and B');
  const saved = [rv(0, 81), rv(1, 74), rv(2, 90), rv(3, 65), rv(4, 88)];
  const p = matchProgress(saved, saved[0].id);
  ok(p.run && p.run.count === 3 && p.run.floor === 'B', `3 in a row, broken by the C before them (${JSON.stringify(p.run)})`);
  ok(p.lines.some((l) => l.kind === 'run' && l.text === '3 matches in a row at B or better.'), 'the run line');
  ok(matchProgress(saved, saved[3].id).run === null, 'the C itself has no run');
  ok(matchProgress(saved, saved[4].id).run === null, 'one match is no run');
  const prov = [rv(0, 81), rv(1, 80, { provisional: true }), rv(2, 85)];
  ok(matchProgress(prov, prov[0].id).run === null, 'a provisional grade ends a run');
  const gap = [rv(0, 81), rv(1, null), rv(2, 85)];
  ok(matchProgress(gap, gap[0].id).run.count === 2, 'a match with no grade is passed over, not a break');
  check(p, 'a run');
}

// ── Cleared ───────────────────────────────────────────────────────────────
{
  const saved = [
    rv(0, 70), rv(1, 70, { mistakes: [m('other', 1)] }),
    rv(2, 70, { mistakes: [m('first-death', 4), m('cause:repeek', 3, { judged: true }), m('look-x', 2, { judged: true })] }),
    rv(3, 70, { mistakes: [m('first-death', 3), m('cause:repeek', 2), m('look-x', 2, { judged: true })] }),
    rv(4, 70, { mistakes: [m('cause:repeek', 2)] }),
  ];
  const p = matchProgress(saved, saved[0].id);
  ok(p.cleared.length === 1 && p.cleared[0].key === 'first-death' && p.cleared[0].streak === 2 && p.cleared[0].before === 2,
    `2 recorded matches without First to die (${JSON.stringify(p.cleared)})`);
  ok(!p.cleared.some((c) => c.key.startsWith('cause:') || c.key === 'look-x'), 'judged entries and cause: keys are skipped');
  ok(p.lines.some((l) => l.kind === 'cleared' && l.text === '2 recorded matches in a row without Title first-death.'), 'the cleared line');
  const once = [rv(0, 70), rv(1, 70), rv(2, 70, { mistakes: [m('first-death', 4)] })];
  ok(matchProgress(once, once[0].id).cleared.length === 0, 'a mistake seen once is no habit to clear');
  const riotBetween = [rv(0, 70), rv(1, 70, { source: 'riot', mistakes: [m('first-death', 4)] }), rv(2, 70),
    rv(3, 70, { mistakes: [m('first-death', 4)] }), rv(4, 70, { mistakes: [m('first-death', 4)] })];
  const r = matchProgress(riotBetween, riotBetween[0].id);
  ok(r.cleared.length === 1 && r.cleared[0].streak === 2, 'a match graded from Riot\'s record alone is not counted in a streak');
  ok(matchProgress(riotBetween, riotBetween[1].id).cleared.length === 0, 'and a Riot only match clears nothing');
  // A recorded match Riot's record never reached cannot count a first death,
  // an advantage given back or an untraded death (insights.js counts them on
  // verified rounds only), so it is no match "without" one. Two unverified
  // matches said "2 recorded matches in a row without First to die".
  const early = m('early', 4);
  const unlinked = [rv(0, 55, { verified: false, mistakes: [early] }), rv(1, 50, { verified: false, mistakes: [early] }),
    rv(2, 70, { mistakes: [m('first-death', 4), m('untraded', 5), early] }), rv(3, 72, { mistakes: [m('first-death', 3), m('untraded', 4)] }),
    rv(4, 68, { mistakes: [m('first-death', 3), m('lost-advantage', 2)] }), rv(5, 68, { mistakes: [m('lost-advantage', 2), m('untraded', 4)] })];
  const u = matchProgress(unlinked, unlinked[0].id);
  ok(!u.cleared.some((c) => ['first-death', 'lost-advantage', 'untraded'].includes(c.key)),
    `an unverified match is no streak without a Riot only key (${JSON.stringify(u.cleared)})`);
  const um = libraryProgress(unlinked).marks;
  ok(![unlinked[0].id, unlinked[1].id].some((id) => (um[id] || []).some((x) => x.kind === 'cleared')),
    `and the library marks neither unverified match (${JSON.stringify(um)})`);
  const linkedAgain = [rv(0, 70, { mistakes: [early] }), rv(1, 70, { mistakes: [early] }), ...unlinked.slice(2)];
  const la = matchProgress(linkedAgain, linkedAgain[0].id);
  ok(la.cleared.some((c) => c.key === 'first-death' && c.streak === 2), 'two verified matches without it still clear it');
  const partial = rv(1, 70, { verified: false, mistakes: [early] });
  partial.review.rounds = [{ n: 1, verified: true }, { n: 2, verified: false }];
  const mixed = [rv(0, 70, { mistakes: [early] }), partial, ...unlinked.slice(2)];
  ok(matchProgress(mixed, mixed[0].id).cleared.some((c) => c.key === 'first-death' && c.streak === 2),
    'and one with Riot\'s rounds laid over some of it counts');
  check(p, 'cleared');
}

// ── Focus ─────────────────────────────────────────────────────────────────
{
  const prev = (n) => rv(1, 70, { mistakes: [m('cause:repeek', 9, { judged: true }), m('first-death', n), m('early', 1)],
    focus: 'Enter second: let a teammate take first contact.' });
  const cases = [['gone', []], ['fewer', [m('first-death', 2)]], ['same', [m('first-death', 4)]], ['more', [m('first-death', 6)]]];
  for (const [outcome, mistakes] of cases) {
    const saved = [rv(0, 72, { mistakes }), prev(4)];
    const f = matchProgress(saved, saved[0].id).focus;
    ok(f && f.outcome === outcome && f.key === 'first-death' && f.before === 4 && f.now === (mistakes[0] ? mistakes[0].count : 0)
      && f.text === 'Enter second: let a teammate take first contact.', `focus ${outcome} (${JSON.stringify(f)})`);
  }
  const gone = matchProgress([rv(0, 72), prev(4)], `valorant-${T0}-t0`);
  ok(gone.lines.some((l) => l.kind === 'focus' && l.tone === 'good' && l.text === "Title first-death, last match's top mistake: none this match, from 4."),
    'the focus line says last match\'s top mistake, never that the focus was done');
  ok(matchProgress([rv(0, 72, { mistakes: [m('first-death', 6)] }), prev(4)], `valorant-${T0}-t0`).lines.some((l) => l.kind === 'focus' && l.tone === 'bad'),
    'more is bad');
  check(gone, 'focus');
  ok(matchProgress([rv(0, 72, { source: 'riot' }), prev(4)], `valorant-${T0}-t0`).focus === null, 'null for a review from Riot\'s record alone');
  ok(matchProgress([rv(0, 72, { verified: false }), prev(4)], `valorant-${T0}-t0`).focus === null, 'null for an unverified review');
  const unverifiedPrev = rv(1, 70, { verified: false, mistakes: [m('first-death', 4)] });
  ok(matchProgress([rv(0, 72), unverifiedPrev], `valorant-${T0}-t0`).focus === null, 'null when the match before was unverified');
  ok(matchProgress([rv(0, 72)], `valorant-${T0}-t0`).focus === null, 'null with no match before');
  const skipRiot = [rv(0, 72), rv(1, 70, { source: 'riot', mistakes: [] }), rv(2, 70, { mistakes: [m('early', 3)] })];
  const f2 = matchProgress(skipRiot, skipRiot[0].id).focus;
  ok(f2 && f2.key === 'early' && f2.outcome === 'gone' && f2.text === null, 'the previous RECORDED review is the one checked');
}

// ── Library ───────────────────────────────────────────────────────────────
{
  const saved = [rv(0, 84), rv(1, 78), rv(2, 74), rv(3, 65), rv(4, 70), rv(5, 72)];
  const lib = libraryProgress(saved);
  ok(lib.run && lib.run.count === 3, `the library's run is the newest match's (${JSON.stringify(lib.run)})`);
  ok(lib.latest && lib.latest.kind === 'first' && lib.latest.text === matchProgress(saved, saved[0].id).lines[0].text, 'latest is the newest match\'s first line');
  const marks = lib.marks[saved[0].id] || [];
  ok(marks.some((x) => x.kind === 'first' && x.text === 'First A') && marks.some((x) => x.kind === 'run' && x.text === '3 in a row'),
    `the newest row is marked (${JSON.stringify(marks)})`);
  ok(!(lib.marks[saved[1].id] || []).some((x) => x.kind === 'run'), 'a run is marked on its newest match only');
  ok(!lib.marks[saved[3].id], 'a C with nothing to mark has no marks');
  ok(Object.values(lib.marks).every((list) => list.every((x) => !DASH.test(x.text))), 'no dash in any mark');
  const empty = libraryProgress([]);
  ok(empty.run === null && empty.latest === null && Object.keys(empty.marks).length === 0, 'an empty library marks nothing');
  const clr = [rv(0, 70), rv(1, 70), rv(2, 70, { mistakes: [m('first-death', 4)] }), rv(3, 70, { mistakes: [m('first-death', 4)] })];
  const cl = libraryProgress(clr);
  ok((cl.marks[clr[0].id] || []).some((x) => x.kind === 'cleared' && x.text === '2 without Title first-death'), 'a cleared habit is marked');
}

// ── League: the grade alone ───────────────────────────────────────────────
{
  const lol = [0, 1, 2, 3].map((i) => rv(i, [88, 70, 72, 75][i], { kind: 'lol', game: 'lol', mistakes: [m('cs', 3)] }));
  const p = matchProgress(lol, lol[0].id);
  ok(p.vsLast.delta === 18 && p.best.grade && p.cleared.length === 0 && p.focus === null, 'a League review gets the grade parts only');
  check(p, 'League');
}

// ── The real Abyss review ─────────────────────────────────────────────────
{
  const { replay, load } = require('./fixtures/replay-match');
  const verify = require('../src/shared/valorant-verify');
  const valorantReview = require('../src/shared/valorant-review');
  const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riot = load('riot-abyss-13-11.json');
  const { rounds } = verify.reconcile(played.rounds, riot);
  const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score',
    ai: { focus: 'Enter second for a match.' }, role: 'Duelist', history: [], riotMe: riot.me });
  const saved = Array.from({ length: 6 }, (_, i) => {
    const review = JSON.parse(JSON.stringify(built));
    review.id = `valorant-${T0 - i * HOUR}-abc${i}`;
    if (i > 0 && review.grade) review.grade = { ...review.grade, score: review.grade.score - 5 - i, letter: letter(review.grade.score - 5 - i) };
    return { id: review.id, game: 'valorant', at: T0 - i * HOUR, review };
  });
  const p = matchProgress(saved, saved[0].id);
  ok(p.score === built.grade.score && p.vsLast && p.vsLast.delta === 6, `the real review against its last (${JSON.stringify(p.vsLast)})`);
  ok(built.grade.provisional ? p.best.grade === null : !!p.best.grade, 'a best on the real review, unless it is provisional');
  ok(p.focus && p.focus.outcome === 'same' && p.focus.before === p.focus.now, `the same match twice: its top mistake the same (${JSON.stringify(p.focus)})`);
  check(p, 'the real review');
  const lib = libraryProgress(saved);
  ok(lib.latest && lib.latest.text === p.lines[0].text, 'the library\'s latest is its first line');
}

// No dash anywhere in the module or this test, as the rule is for every file.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'progress.js'), 'utf8');
  ok(!DASH.test(src) && !DASH.test(fs.readFileSync(__filename, 'utf8')), 'no dash character in progress.js or this test');
  ok(!/require\([^)]*server/.test(src) && !/require\('electron'\)/.test(src), 'progress.js requires neither server nor Electron');
  ok(/require\('electron'\)/.test("require('electron')") && /require\([^)]*server/.test("require('../../server/x')"),
    'the Electron and server finders find a known require');
  ok(allLines.length > 10, `lines were checked (${allLines.length})`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' progress checks passed'}`);
process.exit(fails ? 1 : 0);
