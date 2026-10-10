'use strict';

/**
 * Across matches: what keeps happening.
 *
 * One match can show a mistake twice. Only several matches can show a HABIT,
 * and a habit is what a player can actually work on between sessions. So this
 * counts the insights (insights.js) of the last matches of one game by their
 * stable keys, and ranks them:
 *
 *   mistakes   in how many of the matches it showed up, how many times in all,
 *              weighted by how much it costs a round; most serious first
 *   strengths  the same, for what goes well
 *   missed     the chances left most often
 *
 * A PATTERN NEEDS TWO MATCHES. One match is already the review's job, and a
 * "habit" seen once is the same coincidence the per match floors exist to
 * stop. With fewer than two recorded matches the lists are empty and the
 * library says it is still learning the player.
 *
 * The trend compares the newer half of the window with the older half:
 * 'rising' means it shows up more in the recent matches, 'falling' less, so a
 * falling mistake is progress and a falling strength is not, and "getting
 * better" never rests on the latest match alone happening to be clean.
 *
 * THE GRADES COUNT EVERY MATCH, THE LISTS ONLY THE RECORDED ONES. A match
 * graded from Riot's record alone has a grade like any other and nothing to
 * count in a list (insights.countable): counted, its lists made Home's "most
 * repeated mistake" mostly a quote from matches Occlara never saw. So the
 * lists come from the last ten RECORDED matches, looked for among the last
 * forty, and `recorded` says how many beside `matches`, the ones the grades
 * are over.
 *
 * Pure: the library hands it the saved reviews, newest first.
 */

const { repeatTitle, specificOf, countable } = require('./insights');

const MIN_MATCHES = 2;
const WINDOW = 10;
// How many saved reviews the library hands over (index.js), so the last
// WINDOW recorded ones are found behind the matches graded from Riot's record:
// Connect grades ten of those in one run.
const LOOK_BACK = 40;

function tally(reviews, list) {
  const map = new Map();
  reviews.forEach((rv, i) => {
    const seen = new Set();
    for (const e of countable(rv.review)[list]) {
      if (!e || !e.key || seen.has(e.key)) continue;
      seen.add(e.key);
      const t = map.get(e.key) || {
        key: e.key, title: e.title, weight: e.weight || 1, matches: 0, total: 0,
        newer: 0, older: 0, examples: [], judged: !!e.judged, fix: e.fix || null, specifics: new Set(),
      };
      t.specifics.add(specificOf(e, rv.review.game && rv.review.game.map));
      t.matches++;
      t.total += e.count || 1;
      if (i < reviews.length / 2) t.newer++; else t.older++;
      // Reviews arrive newest first, so the title, the fix and the first
      // example are the latest sighting's: "Dying at A Site" as it is now.
      if (t.examples.length < 3) t.examples.push({ id: rv.id, at: rv.at, detail: e.detail, rounds: e.rounds || [] });
      map.set(e.key, t);
    }
  });
  const half = reviews.length / 2;
  return [...map.values()]
    .filter((t) => t.matches >= MIN_MATCHES)
    .map((t) => {
      const newerRate = t.newer / Math.max(1, Math.ceil(half));
      const olderRate = t.older / Math.max(1, Math.floor(half));
      const trend = reviews.length < 4 ? null
        : newerRate > olderRate + 0.15 ? 'rising' : newerRate < olderRate - 0.15 ? 'falling' : 'steady';
      // The title and fix the count may carry (insights.repeatTitle): the
      // newest one's only when every sighting named the same place or agent.
      const { title, fix } = repeatTitle(t.key, list, t, t.specifics);
      const { specifics, ...rest } = t;
      return { ...rest, title, fix, share: t.matches / reviews.length, trend };
    });
}

/**
 * @param saved  whole saved reviews ({ id, at, game, review }), newest first:
 *               up to LOOK_BACK of them, for the lists' last WINDOW recorded
 * @returns matches    the last WINDOW matches, which the grades and categories are over
 *          fromRiot   how many of those were graded from Riot's record alone
 *          recorded   the recorded matches the lists are over, up to WINDOW
 *          enough     whether the lists can speak: MIN_MATCHES recorded
 */
function summarise(saved) {
  const all = (saved || []).filter((s) => s && s.review);
  const reviews = all.slice(0, WINDOW);
  const recorded = all.filter((s) => s.review.source !== 'riot').slice(0, WINDOW);
  const grades = reviews
    .filter((s) => s.review.grade && typeof s.review.grade.score === 'number')
    .map((s) => ({ id: s.id, at: s.at, score: s.review.grade.score, letter: s.review.grade.letter,
      provisional: !!s.review.grade.provisional }));
  const out = {
    matches: reviews.length,
    fromRiot: reviews.filter((s) => s.review.source === 'riot').length,
    recorded: recorded.length,
    enough: recorded.length >= MIN_MATCHES,
    mistakes: [], strengths: [], missed: [],
    grades,
    average: grades.length ? Math.round(grades.reduce((a, g) => a + g.score, 0) / grades.length) : null,
    categories: [],
  };

  // Each grade category over the window, with its newest value beside the average.
  const cats = new Map();
  for (const s of reviews) {
    for (const c of ((s.review.grade || {}).categories || [])) {
      if (typeof c.score !== 'number') continue;
      const e = cats.get(c.key) || { key: c.key, label: c.label, scores: [] };
      e.scores.push(c.score);
      cats.set(c.key, e);
    }
  }
  out.categories = [...cats.values()].filter((c) => c.scores.length >= MIN_MATCHES).map((c) => ({
    key: c.key, label: c.label, last: c.scores[0],
    average: Math.round(c.scores.reduce((a, b) => a + b, 0) / c.scores.length),
    matches: c.scores.length,
  }));
  if (!out.enough) return out;

  out.mistakes = tally(recorded, 'mistakes')
    .sort((a, b) => b.share * b.weight * (b.total / b.matches) - a.share * a.weight * (a.total / a.matches));
  out.strengths = tally(recorded, 'strengths').sort((a, b) => b.share - a.share || b.total - a.total);
  out.missed = tally(recorded, 'missed').sort((a, b) => b.share - a.share || b.total - a.total);
  return out;
}

module.exports = { summarise, MIN_MATCHES, WINDOW, LOOK_BACK };
