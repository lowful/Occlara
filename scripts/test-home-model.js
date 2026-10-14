'use strict';

/**
 * Home's figures (src/shared/home-model.js), read from the library on the real
 * Abyss match: the last match, the focus for the next one, the most repeated
 * mistake, the grade trend and the recent matches. Nothing is invented: an
 * empty library gives nothing to show, and a match graded from Riot's record
 * alone is graded and repeats nothing. And the record beside the Matches
 * title (winLoss): a match with no result is never counted as a loss.
 *
 * And the rank (8.2.1): the rank card Stats' own rules make of the rank
 * history (rankModel), and the RR beside each rated recent match, placed on
 * its own game in that history and never a neighbour's (rrForRows), by Riot's
 * own start where the review kept it; the newest rated match Riot had not put
 * in the history yet, asked about again (rrWaiting); and the history main
 * keeps, read past both caches once a review links (rank-history.js).
 *
 * Run: npm run test:homemodel
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const patterns = require('../src/shared/patterns');
const { metaOf } = require('../src/main/services/review-store');
const { homeModel, winLoss, rankModel, rrForRows, rrWaiting, RR_WINDOW_MS, RR_EXACT_MS } = require('../src/shared/home-model');

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
  // A result is read in whatever case it was saved in.
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

// ── The eye on the last match (8.2.1) ──────────────────────────────────────
// The one word main puts on a library row, and nothing else: a place in the
// AI log is main's to find, never a page's.
{
  const word = (aiLog) => homeModel({ rows: [{ ...rows[0], aiLog }], patterns: summary, review: null }).last.aiLog;
  ok(word('kept') === 'kept' && word('gone') === 'gone', 'the last match carries whether the AI log still holds it');
  ok(word(null) === null && word(undefined) === null && word({ session: 'session-x', from: 1, to: 2 }) === null,
    'and nothing else: no word is no eye, and a place in the log never reaches the page');
  ok(homeModel({ rows: [{ ...rows[0], aiLog: 'kept' }, { ...rows[1], aiLog: 'gone' }], patterns: summary, review: null })
    .recent.map((r) => r.aiLog).join() === 'kept,gone', 'the recent rows carry it the same way');
}

// ── A review still being built (8.4.1) ──────────────────────────────────────
// The step main puts on its library row (review-work.js workOf, index.js
// listReviews), so Home's last match and its row say it is being checked
// where its grade, result and score would be: which way it is finished and
// the step, nothing more.
{
  const WORK = { path: 'riot', steps: ['saved', 'riot', 'deaths', 'look', 'writing'], step: 'riot', endedAt: T0, until: T0 + 360000, scoreboard: false };
  const m = homeModel({ rows: [{ ...rows[0], work: WORK }, rows[1]], patterns: summary, review: saved[0].review });
  ok(same(m.last.work, { path: 'riot', step: 'riot' }) && same(m.recent[0].work, { path: 'riot', step: 'riot' }) && m.recent[1].work === null,
    `the last match and its recent row carry the step it is on, the other rows none (${JSON.stringify(m.last.work)})`);
  const screen = homeModel({ rows: [{ ...rows[0], work: { path: 'screen', step: 'writing' } }], patterns: summary, review: null });
  ok(same(screen.last.work, { path: 'screen', step: 'writing' }), 'from the screen alone, the same');
  const odd = (work) => homeModel({ rows: [{ ...rows[0], work }], patterns: summary, review: null }).last.work;
  ok(odd(null) === null && odd(undefined) === null && odd('riot') === null && odd({ path: 'other', step: 'riot' }) === null
    && same(odd({ path: 'riot' }), { path: 'riot', step: null }),
  'no work, or work in any other shape, is none: the grade shows as it always did');
  ok(m.last.grade === rows[0].grade && m.last.result === rows[0].result,
    'the row keeps its grade and result: Home leaves them unsaid while it is being checked, nothing here drops them');
  const wl = winLoss([{ ...rows[0], result: 'Defeat', work: WORK }, { ...rows[1], result: 'Victory' }]);
  ok(same(wl, { wins: 1, losses: 0, draws: 0, unknown: 1 }),
    `the Matches header counts no result for a review still being checked, as its row paints none (${JSON.stringify(wl)})`);
}

// ── The rank card (8.2.1): Stats' rules, on the history Stats reads ────────
// Oldest first, as the rank history route returns them.
{
  const DAY = 24 * HOUR;
  const pt = (elo, change, tier, i) => ({ date: T0 + (i || 0) * DAY, elo, change, tier: tier || 'Gold 2' });
  const card = rankModel({ points: [pt(1180, -21, 'Gold 1', 0), pt(1218, 18, 'Gold 2', 1)] });
  ok(card && card.tier === 'Gold 2' && card.change === 18 && same(card.line, [1180, 1218]) && card.games === 2 && card.from === 'Gold 1',
    `the rank is the newest rated game's tier, with its RR and the journey (${JSON.stringify(card)})`);
  // The Stats tile's own case: a placement jump and an unrated point are
  // passed over for the newest rated game's RR.
  const placed = rankModel({ points: [pt(1203, -15, 'Gold 2', 0), pt(1500, 297, 'Gold 3', 1), pt(0, 0, 'Unrated', 2)] });
  ok(placed && placed.change === -15 && placed.tier === 'Gold 3' && same(placed.line, [1203, 1500]),
    `a placement's jump and an unrated point are no game's RR, and the unrated point is no rank (${JSON.stringify(placed)})`);
  ok(rankModel({ points: [pt(1203, 0)] }).change === 0, 'no change is a 0, not nothing');
  // The journey is one stretch: cut at the newest jump of more than 300.
  const reset = rankModel({ points: [pt(420, 20, 'Iron 3', 0), pt(445, 25, 'Iron 3', 1), pt(1200, 755, 'Gold 1', 2),
    pt(1221, 21, 'Gold 1', 3), pt(1250, 29, 'Gold 2', 4)] });
  ok(reset && same(reset.line, [1200, 1221, 1250]) && reset.games === 3 && reset.from === 'Gold 1' && reset.change === 29,
    `after an act reset the journey starts at the jump (${JSON.stringify(reset)})`);
  const edge = rankModel({ points: [pt(1000, 10, 'Gold 1', 0), pt(1300, 300, 'Gold 3', 1)] });
  ok(edge && edge.line.length === 2, 'a jump of exactly 300 is still one stretch, as Stats draws it');
  const one = rankModel({ points: [pt(1218, 18)] });
  ok(one && one.tier === 'Gold 2' && same(one.line, []) && one.games === 1, 'one rated game is a rank with no line, since one point draws none');
  for (const [what, history] of [['no history', { points: [] }], ['no Riot ID', { error: 'no-riot-id' }], ['no answer', null],
    ['only unrated points', { points: [pt(0, 0, 'Unrated'), pt(1100, 12, 'Unranked', 1)] }],
    ['a point with no tier', { points: [{ date: T0, elo: 1100, change: 10, tier: null }] }]]) {
    ok(rankModel(history) === null, `${what}: no rank card at all`);
  }
}

// ── The RR beside a rated recent match (8.2.1) ─────────────────────────────
{
  const MIN = 60000;
  const ROUND = 100 * 1000;
  // A row as the library lists it: when the match ENDED, and its score.
  const row = (id, start, score, mode) => {
    const [a, b] = score.split(/[-:]/).map(Number);
    return { id, at: start + (a + b) * ROUND, score, mode: mode === undefined ? 'Competitive' : mode };
  };
  const point = (start, change, extra) => ({ date: start, elo: 1500, change, tier: 'Platinum 1', ...(extra || {}) });
  const START_A = T0 + 20 * HOUR;
  const START_B = START_A + 44 * MIN;   // straight after A: its 24 rounds, then the queue
  const a = row('a', START_A, '13-11');
  const b = row('b', START_B, '13-9');
  ok(Math.abs(START_B - a.at) < Math.abs(START_A - a.at),
    'the setup: A ended nearer B\'s start than its own, the trap of measuring from the end');
  const both = rrForRows([b, a], { points: [point(START_A + 2 * MIN, 18), point(START_B + MIN, -14)] });
  ok(same(both, { b: -14, a: 18 }), `back to back, each match takes its own game's RR (${JSON.stringify(both)})`);
  // B's game not published yet: A's point is within 45 minutes of B's start,
  // and still A's alone.
  const unpublished = rrForRows([b, a], { points: [point(START_A + 2 * MIN, 18)] });
  ok(Math.abs(START_B - (START_A + 2 * MIN)) <= RR_WINDOW_MS && same(unpublished, { a: 18 }),
    `a game goes to one match: B shows nothing rather than A's RR (${JSON.stringify(unpublished)})`);
  // Only a match Riot's record calls Competitive is rated.
  const modes = ['Unrated', 'Swiftplay', 'Standard', 'Premier', null, 'competitive'].map((mode, i) => row(`m${i}`, START_A, '13-11', mode));
  ok(same(rrForRows(modes, { points: [point(START_A, 20)] }), { m5: 20 }),
    'an Unrated, Swiftplay, Standard or Premier match, or one with no mode, shows no RR; Competitive in any case does');
  // The start is put back from the end and the score, however the score is written.
  for (const score of ['13-11', '13 - 11', '13:11']) {
    const r = { id: 's', at: START_A + 24 * ROUND, score, mode: 'Competitive' };
    ok(same(rrForRows([r], { points: [point(START_A, 7)] }), { s: 7 }), `a score written "${score}" places the match`);
  }
  ok(same(rrForRows([{ id: 'n', at: START_A + 24 * ROUND, score: null, mode: 'Competitive' }], { points: [point(START_A, 7)] }), {}),
    'a match with no score cannot be placed, so it shows nothing');
  ok(same(rrForRows([a], { points: [point(START_A + RR_WINDOW_MS + MIN, 9)] }), {}), 'a game more than 45 minutes from the match is not its');
  // A row that kept Riot's own start is placed exactly: its game is within
  // minutes of that start or not in the history yet. Given 45 minutes, its own
  // game unpublished, the game before it (not in the library, so nothing else
  // claims it) was taken: a 10-13 loss shown as +21, and never asked for again.
  const exactLoss = { id: 'c', at: START_B + 23 * ROUND, score: '10-13', mode: 'Competitive', matchStartedAt: START_B };
  const before = rrForRows([exactLoss], { points: [point(START_B - 37 * MIN, 21)] });
  ok(same(before, {}), `a row on Riot's own start takes no game 37 minutes before it (${JSON.stringify(before)})`);
  ok(same(rrForRows([exactLoss], { points: [point(START_B - 37 * MIN, 21), point(START_B + 20000, -18)] }), { c: -18 }),
    'and takes its own game the moment Riot has it');
  ok(same(rrForRows([exactLoss], { points: [point(START_B + RR_EXACT_MS - MIN, -18)] }), { c: -18 })
    && same(rrForRows([exactLoss], { points: [point(START_B + RR_EXACT_MS + MIN, -18)] }), {}),
    `within ${RR_EXACT_MS / MIN} minutes of Riot's start, and no further`);
  ok(same(rrForRows([a], { points: [point(START_A, 297)] }), {}) && same(rrForRows([a], { points: [point(START_A, 12, { elo: 0, tier: 'Unrated' })] }), {}),
    'a placement\'s jump or an unrated point shows no RR, the rank tile\'s rule');
  ok(same(rrForRows([a], { error: 'no-riot-id' }), {}) && same(rrForRows(null, null), {}) && same(rrForRows([a], { points: [{ elo: 1500, change: 5 }] }), {}),
    'no history, no rows or an undated point: nothing');
}

// ── Placed by Riot's own start (8.2.1) ─────────────────────────────────────
// A row's end is when the watch ended the match or Stop was pressed, and once
// linked its score is Riot's final, so put back from that end a match ended
// early or stopped landed 20 to 30 minutes before its start, the game before
// it nearer, and showed that game's RR. A review linked to Riot's record keeps
// Riot's start (valorant-review.js build, from the tracker match the link
// found), the library row carries it (metaOf), and Home places it by it.
{
  const MIN = 60000;
  const ROUND = 100 * 1000;
  /** A recording linked to Riot's record, saved as the library saves it. */
  const linked = (id, startedAt, endedAt, score, endedBy) => {
    const review = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy, ai: {},
      tracker: { matchId: id, map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score,
        kills: 20, deaths: 14, assists: 5, kd: 1.43, acs: 240, adr: 150, headshotPct: 24, startedAt },
      queue: 'Competitive', role: 'Duelist', history: [], riotMe: riot.me });
    return metaOf(`valorant-${endedAt}-${id}`, 'valorant', review, endedAt);
  };
  const point = (date, change) => ({ date, elo: 1500, change, tier: 'Platinum 1' });

  // Ended early by the watch at 3-5 after round 8, 929 seconds in (the real
  // Split case), and linked as Riot's 13-7: twenty rounds put back from there.
  const START_X = T0 + 30 * HOUR;
  const x = linked('earlyx', START_X, START_X + 929 * 1000, '13-7', 'score');
  const before = point(START_X - 33 * MIN, 21);   // the game before, not recorded
  const own = point(START_X + MIN, 19);
  const guessX = x.at - 20 * ROUND;
  ok(x.matchStartedAt === START_X && x.mode === 'Competitive' && x.score === '13-7',
    'the library row of a linked recording keeps Riot\'s start, beside Riot\'s mode and score');
  ok(Math.abs(guessX - before.date) < Math.abs(guessX - own.date),
    'the setup: put back from where the watch ended it, the match sits nearer the game before');
  ok(same(rrForRows([x], { points: [before, own] }), { [x.id]: 19 }),
    `a match the watch ended early takes its own game's RR, not the one before (${JSON.stringify(rrForRows([x], { points: [before, own] }))})`);

  // Stopped at round 6 of a 13-11 match, linked as Riot's 13-11.
  const START_S = T0 + 40 * HOUR;
  const s = linked('stoppeds', START_S, START_S + 6 * ROUND, '13-11', 'stop');
  const prior = point(START_S - 50 * MIN, 19);
  const mine = point(START_S + MIN, -20);
  const guessS = s.at - 24 * ROUND;
  ok(Math.abs(guessS - prior.date) < Math.abs(guessS - mine.date),
    'the setup: put back from the Stop, the match sits nearer the game before');
  ok(same(rrForRows([s], { points: [prior, mine] }), { [s.id]: -20 }),
    `a match Stop was pressed in takes its own game's RR, not the one before (${JSON.stringify(rrForRows([s], { points: [prior, mine] }))})`);

  // Without Riot's start, as from the screen alone or saved before 8.2.1, it
  // is still put back from the end.
  const screen = metaOf('valorant-1-screen', 'valorant', built, T0);
  ok(screen.matchStartedAt === null && built.matchStartedAt === null, 'a review from the screen alone has no Riot start, and its row says none');
  const old = { id: 'o', at: START_X + 24 * ROUND, score: '13-11', mode: 'Competitive' };
  ok(same(rrForRows([old], { points: [point(START_X, 7)] }), { o: 7 }), 'a row with no Riot start is placed from its end and its score, as before');
}

// ── Waiting for a game Riot has not published (8.2.1) ──────────────────────
// The newest Competitive match with no RR yet, while it is recent, is the one
// Home asks about again (home.js).
{
  const MIN = 60000;
  const NOW = T0 + 50 * HOUR;
  const r = (id, minsAgo, mode) => ({ id, at: NOW - minsAgo * MIN, mode: mode === undefined ? 'Competitive' : mode });
  ok(rrWaiting([r('a', 3), r('b', 60)], { b: -16 }, NOW) === 'a', 'the newest Competitive match ended minutes ago with no RR: it is waited for');
  ok(rrWaiting([r('a', 3), r('b', 60)], { a: 24, b: -16 }, NOW) === null && rrWaiting([r('a', 3)], { a: 0 }, NOW) === null,
    'one with its RR, a 0 included, is not');
  ok(rrWaiting([r('u', 1, 'Unrated'), r('a', 30)], {}, NOW) === 'a', 'an Unrated match after it does not hide it');
  ok(rrWaiting([r('a', 61)], {}, NOW) === null, 'one that ended over an hour ago is not: its game is not coming');
  ok(rrWaiting([r('u', 1, 'Unrated'), r('s', 2, 'Standard')], {}, NOW) === null && rrWaiting([], {}, NOW) === null
    && rrWaiting(null, null, NOW) === null, 'nor anything without a Competitive match');
}

// ── The rank history main keeps (8.2.1, services/rank-history.js) ──────────
// A review linking to Riot's record means Riot has published the match, so
// the history both caches held from the match's end is read past, once.
(async () => {
  const fs = require('fs');
  const path = require('path');
  const { RankHistory, TTL_MS } = require('../src/main/services/rank-history');
  let clock = T0;
  const asked = [];
  let answer = () => ({ ok: true, data: { points: [] } });
  const rh = new RankHistory({ get: async (p) => { asked.push(p); return answer(p); }, now: () => clock });
  const ID = 'Me#EUW';
  const past = (i) => /&refresh=1$/.test(asked[i] || '');
  await rh.read(ID);
  await rh.read(ID);
  ok(asked.length === 1 && !past(0) && asked[0] === '/api/coach/rank-history?username=Me%23EUW',
    'read twice inside five minutes, it is asked for once, and the server may answer from its own');
  rh.published();
  await rh.read(ID);
  ok(asked.length === 2 && past(1), 'a review linked: the next read goes past both caches');
  await rh.read(ID);
  ok(asked.length === 2, 'and the reads after it share that one');
  clock += TTL_MS + 1;
  await rh.read(ID);
  ok(asked.length === 3 && !past(2), 'five minutes on, an ordinary read again');
  // A read past both that fails keeps the history held, and the next goes past both again.
  rh.published();
  answer = () => { throw new Error('offline'); };
  const held = await rh.read(ID);
  ok(asked.length === 4 && past(3) && same(held, { points: [] }), 'a read past both that fails gives the history held');
  answer = () => ({ ok: true, data: { points: [1] } });
  await rh.read(ID);
  ok(asked.length === 5 && past(4), 'and the read after it goes past both again');
  // A link while that read is out is one it did not follow.
  let release = null;
  answer = () => new Promise((res) => { release = () => res({ ok: true, data: { points: [2] } }); });
  rh.published();
  const out = rh.read(ID);
  rh.published();
  release();
  await out;
  answer = () => ({ ok: true, data: { points: [3] } });
  await rh.read(ID);
  ok(asked.length === 7 && past(5) && past(6), 'a link while a read past both is out makes the next read go past both too');
  await rh.read(ID, true);
  ok(asked.length === 8 && past(7), 'Stats\' Refresh goes past both, as it did');
  rh.clear();
  await rh.read(ID);
  ok(asked.length === 9 && !past(8), 'cleared (a stop, another game), it is asked for again');
  await rh.read('Other#EUW');
  ok(asked.length === 10 && /Other%23EUW/.test(asked[9]), 'another Riot ID is another history');
  ok(same(await rh.read(''), { error: 'no-riot-id' }) && asked.length === 10, 'no Riot ID: nothing asked');

  // A plain read still out when a match links, answering AFTER the read past
  // both caches, never puts its older history over the newer one.
  {
    const rh2 = new RankHistory({ get: async (p) => answer2(p), now: () => clock });
    let releaseOld = null;
    let answer2 = () => new Promise((res) => { releaseOld = () => res({ ok: true, data: { points: ['before'] } }); });
    const old = rh2.read(ID);              // plain, out before the link
    rh2.published();
    answer2 = () => ({ ok: true, data: { points: ['after'] } });
    const fresh = await rh2.read(ID);      // past both caches, answers first
    releaseOld();
    await old;                             // the older answer lands last
    answer2 = () => ({ ok: true, data: { points: ['third'] } });
    const next = await rh2.read(ID);       // inside five minutes: what is held
    ok(same(fresh, { points: ['after'] }) && same(next, { points: ['after'] }),
      `an older read landing after a newer one leaves the newer history held (${JSON.stringify(next)})`);
  }

  // Wired where a review first links (index.js withTracker), before the save
  // whose PUSH_REVIEWS has Home read the rank, and read through by Stats and Home.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
  const BODY = /const withTracker = \(lm\) => \{([\s\S]*?)\n {2}\};/;
  ok(BODY.test('  const withTracker = (lm) => {\n    go();\n  };'), 'the withTracker reader finds a known body');
  const body = (src.match(BODY) || [])[1] || '';
  const mark = body.indexOf('rankHistory.published()');
  const save = body.indexOf('repaintReview(job, next.built)');
  ok(mark !== -1 && save !== -1 && mark < save, 'a review linking marks the rank history stale before the save that has Home read it');
  ok(/getRankHistory\(force\) \{\s*return rankHistory\.read\(/.test(src), 'and STATS_RANK_HISTORY reads through it');

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' home checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL  the rank history checks ran to the end\n        ${(e && e.stack) || e}`);
  process.exit(1);
});
