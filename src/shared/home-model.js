'use strict';

/**
 * What Home shows, read from the library: the last match and its grade, the
 * focus the review set for the next one, the most repeated mistake, the grade
 * over the last five matches, and the recent matches.
 *
 * NOTHING IS INVENTED HERE. Every figure is one the library already holds,
 * and an empty library gives empty fields rather than zeros: a new player's
 * Home says there is nothing yet, not that they graded 0. The pattern and the
 * average need two matches, the rule patterns.js keeps.
 *
 * Pure: home.js hands it the index rows, the patterns and the newest review.
 */

const TREND = 5;
const RECENT = 5;

function rowOf(r) {
  return {
    id: r.id, title: r.title || null, map: r.map || null, mode: r.mode || null,
    result: r.result || null, score: r.score || null, at: r.at || null,
    grade: r.grade || null, verified: !!r.verified, source: r.source || null,
  };
}

/**
 * @param rows      the library index of the game, newest first (reviewStore.list(game))
 * @param patterns  patterns.summarise() of the same game
 * @param review    the newest whole review of the game, or null
 */
function homeModel({ rows, patterns, review }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const p = patterns || {};
  const newest = list[0] || null;
  const whole = review && newest && review.id === newest.id ? review : null;

  const last = newest ? {
    ...rowOf(newest),
    categories: whole && whole.grade && Array.isArray(whole.grade.categories)
      ? whole.grade.categories.map((c) => ({ key: c.key || null, label: c.label, score: typeof c.score === 'number' ? c.score : null }))
      : [],
  } : null;

  const first = Array.isArray(p.mistakes) && p.mistakes[0] ? p.mistakes[0] : null;
  const top = first ? {
    title: first.title,
    detail: `In ${first.matches} of your last ${p.matches} matches.`,
    fix: first.fix || null,
    trend: first.trend || null,
  } : null;

  const grades = Array.isArray(p.grades) ? p.grades : [];
  const trend = grades.slice(0, TREND).reverse().map((g) => {
    const row = list.find((r) => r.id === g.id);
    return { id: g.id, score: g.score, letter: g.letter, at: g.at, map: row ? row.map || null : null };
  });

  return {
    last,
    focus: whole && typeof whole.focus === 'string' && whole.focus.trim() ? whole.focus : null,
    top,
    trend,
    average: grades.length >= 2 && typeof p.average === 'number' ? p.average : null,
    recent: list.slice(0, RECENT).map(rowOf),
  };
}

module.exports = { homeModel, TREND, RECENT };
