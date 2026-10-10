'use strict';

/**
 * Home's figures (src/shared/home-model.js), read from the library on the real
 * Abyss match: the last match, the focus for the next one, the most repeated
 * mistake, the grade trend and the recent matches. Nothing is invented: an
 * empty library gives nothing to show, and a match graded from Riot's record
 * alone is graded and repeats nothing. And the record beside the Matches
 * title (winLoss): a match with no result is never counted as a loss.
 *
 * Run: npm run test:homemodel
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const patterns = require('../src/shared/patterns');
const { metaOf } = require('../src/main/services/review-store');
const { homeModel, winLoss } = require('../src/shared/home-model');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
    && m.top.detail === `In ${summary.mistakes[0].matches} of your last 6 recorded matches.`,
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

// ── Matches graded from Riot's record alone ────────────────────────────────
// They are graded like any other, and repeat nothing: the most repeated
// mistake is counted over the recorded matches, and says so.
{
  const fromRiot = (i) => {
    const r = riotReview.fromRiot({ row: { matchId: `r${i}`, map: 'Bind', agent: 'Jett', mode: 'Competitive', result: 'Defeat',
      score: '11-13', kills: 12, deaths: 18, assists: 3, kd: 0.67, acs: 190, adr: 120, headshotPct: 18,
      startedAt: T0 + (10 + i) * HOUR }, riot, history: [] }).review;
    r.id = `valorant-${r.at}-riot${i}`;
    return { id: r.id, game: 'valorant', at: r.at, review: r };
  };
  // Two from Riot's record, newer than two of the recorded ones above.
  const mix = [fromRiot(2), fromRiot(1), saved[0], saved[1]];
  const mixRows = mix.map((s) => metaOf(s.id, s.game, s.review, s.at));
  const sum = patterns.summarise(mix);
  const m = homeModel({ rows: mixRows, patterns: sum, review: mix[0].review });
  ok(m.last && m.last.id === mix[0].id && m.last.source === 'riot' && m.last.grade,
    'the last match is the newest, graded from Riot\'s record, with its grade');
  ok(m.top && m.top.title === saved[0].review.insights.mistakes[0].title
    && m.top.detail === 'In 2 of your last 2 recorded matches.',
    `the most repeated mistake is the recorded matches', out of them (${m.top && m.top.title}: ${m.top && m.top.detail})`);
  ok(m.trend.length === 4 && m.average === sum.average, 'while the trend and the average are every match\'s');
  const riotOnly = [fromRiot(2), fromRiot(1)];
  const none = homeModel({ rows: riotOnly.map((s) => metaOf(s.id, s.game, s.review, s.at)), patterns: patterns.summarise(riotOnly),
    review: riotOnly[0].review });
  ok(none.last && none.top === null && none.average !== null && none.trend.length === 2,
    'two matches from Riot\'s record alone: a grade, a trend and an average, and no repeated mistake');
  ok(mixRows.filter((r) => r.source === 'riot').every((r) => r.topMistake === null),
    'and no library row from Riot\'s record names a top mistake');
}

// ── The record beside the Matches title (winLoss) ──────────────────────────
{
  const wl = (results) => winLoss(results.map((result, i) => ({ id: `r${i}`, result })));
  ok(rows.every((r) => r.result === 'Victory') && same(winLoss(rows), { wins: 6, losses: 0, draws: 0, unknown: 0 }),
    `six real 13 to 11 Abyss matches are six wins (${JSON.stringify(winLoss(rows))})`);
  // Two of them lost, and one whose recording was stopped part way claims no
  // result: that one is unknown, never a loss.
  const mixed = rows.map((r, i) => (i < 2 ? { ...r, result: 'Defeat' } : i === 2 ? { ...r, result: null } : r));
  ok(same(winLoss(mixed), { wins: 3, losses: 2, draws: 0, unknown: 1 }),
    `three won, two lost, one with no result (${JSON.stringify(winLoss(mixed))})`);
  // Rivals reads its result off the screen, in whatever case it printed.
  ok(same(wl(['VICTORY', 'victory', 'Win', 'DEFEAT', 'defeat', 'Loss']), { wins: 3, losses: 3, draws: 0, unknown: 0 }),
    'a win and a loss read however they are cased or worded, as the rows colour them');
  ok(same(wl(['Draw', 'DRAW', 'Tie', 'Remake', '', null, undefined]), { wins: 0, losses: 0, draws: 3, unknown: 4 }),
    'a draw is its own count, and anything else is no result');
  // League reviews carry no result at all, so a League library has no record.
  const lolRows = [0, 1].map((i) => metaOf(`lol-${T0 + i * HOUR}-lol${i}`, 'lol',
    { game: { champion: 'Ahri', role: 'Middle', mode: 'CLASSIC', durationSec: 1800 }, grade: { score: 70, letter: 'B' } }, T0 + i * HOUR));
  ok(same(winLoss(lolRows), { wins: 0, losses: 0, draws: 0, unknown: 2 }), 'League rows win and lose nothing, they have no result');
  ok(same(winLoss([]), { wins: 0, losses: 0, draws: 0, unknown: 0 }) && same(winLoss(null), winLoss([]))
    && same(winLoss([null, undefined]), winLoss([])), 'an empty library, or no list at all, has no record');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' home checks passed'}`);
process.exit(fails ? 1 : 0);
