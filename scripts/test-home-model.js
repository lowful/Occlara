'use strict';

/**
 * Home's figures (src/shared/home-model.js), read from the library on the real
 * Abyss match: the last match, the focus for the next one, the most repeated
 * mistake, the grade trend and the recent matches. Nothing is invented: an
 * empty library gives nothing to show.
 *
 * Run: npm run test:homemodel
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const valorantReview = require('../src/shared/valorant-review');
const patterns = require('../src/shared/patterns');
const { metaOf } = require('../src/main/services/review-store');
const { homeModel } = require('../src/shared/home-model');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const riot = load('riot-abyss-13-11.json');
const { rounds } = verify.reconcile(played.rounds, riot);
const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score',
  ai: { focus: 'Enter second for a match: let a teammate or your utility take first contact, then trade.' },
  role: 'Duelist', history: [], riotMe: riot.me });

const T0 = Date.parse('2026-09-20T18:00:00Z');
const HOUR = 3600000;
// Six saved matches, newest first, the oldest graded lower so the trend moves.
const saved = Array.from({ length: 6 }, (_, i) => {
  const review = JSON.parse(JSON.stringify(built));
  review.id = `valorant-${T0 + (6 - i) * HOUR}-abc${i}`;
  review.at = T0 + (6 - i) * HOUR;
  if (i === 5 && review.grade) review.grade = { ...review.grade, score: 58, letter: 'D' };
  return { id: review.id, game: 'valorant', at: review.at, review };
});
const rows = saved.map((s) => metaOf(s.id, s.game, s.review, s.at));
const summary = patterns.summarise(saved);

{
  const m = homeModel({ rows, patterns: summary, review: saved[0].review });
  ok(m.last && m.last.id === saved[0].id && m.last.map === built.game.map && m.last.result === built.game.result,
    `the last match is the newest review (${m.last && m.last.map}, ${m.last && m.last.result})`);
  ok(m.last.grade && m.last.grade.score === built.grade.score && m.last.grade.letter === built.grade.letter,
    `with its grade (${m.last.grade && m.last.grade.score} ${m.last.grade && m.last.grade.letter})`);
  ok(Array.isArray(m.last.categories) && m.last.categories.length === built.grade.categories.length
    && m.last.categories.every((c) => typeof c.label === 'string' && 'score' in c),
    `and its categories (${m.last.categories.map((c) => `${c.label} ${c.score}`).join(', ')})`);
  ok(m.focus === built.focus, 'the focus is the newest review\'s next match line');
  ok(m.top && m.top.title === summary.mistakes[0].title && m.top.fix === summary.mistakes[0].fix
    && /^In \d+ of your last \d+ matches\.$/.test(m.top.detail),
    `the top mistake is the first pattern (${m.top && m.top.title}: ${m.top && m.top.detail})`);
  ok(m.trend.length === 5 && m.trend[m.trend.length - 1].id === saved[0].id,
    `the trend is the last five grades, oldest first (${m.trend.map((t) => t.score).join(', ')})`);
  ok(m.average === summary.average, `the average is the patterns' (${m.average})`);
  ok(m.recent.length === 5 && m.recent[0].id === saved[0].id, 'and five recent matches, newest first');
}
{
  const m = homeModel({ rows: [], patterns: patterns.summarise([]), review: null });
  ok(m.last === null && m.focus === null && m.top === null && m.trend.length === 0 && m.average === null
    && m.recent.length === 0, 'an empty library shows nothing, not zeros');
}
{
  const one = homeModel({ rows: rows.slice(0, 1), patterns: patterns.summarise(saved.slice(0, 1)), review: saved[0].review });
  ok(one.last && one.top === null && one.average === null,
    'one match has a last match, but no pattern and no average, since a pattern needs two');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' home checks passed'}`);
process.exit(fails ? 1 : 0);
