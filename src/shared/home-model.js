'use strict';

/**
 * What Home shows, read from the library: the last match and its grade, the
 * focus the review set for the next one, the most repeated mistake, the grade
 * over the last five matches, and the recent matches.
 *
 * NOTHING IS INVENTED HERE. Every figure is one the library already holds,
 * and an empty library gives empty fields rather than zeros: a new player's
 * Home says there is nothing yet, not that they graded 0. The most repeated
 * mistake needs two recorded matches and the average two graded ones, the
 * rules patterns.js keeps.
 *
 * Pure: home.js hands it the index rows, the patterns and the newest review.
 * The library's header counts its record here too (winLoss), from the same
 * index rows.
 */

const TREND = 5;
const RECENT = 5;

// The result tests the library's rows colour by (matches.js row()), so the
// header never counts a match the row below it does not paint as won or lost.
// Rivals results are read off the screen, in whatever case it printed them.
const WON = /vict|win/i;
const LOST = /defeat|loss/i;
const DRAWN = /draw|\btie\b/i;

/**
 * The matches won and lost in one game's library, for the header beside the
 * Matches title. A draw is counted on its own, and a match with no result is
 * unknown, never a loss: League reviews carry no result at all, and a match
 * whose recording was stopped part way claims none.
 *
 * @param rows  the library index of one game (reviewStore.list(game))
 * @returns {{ wins: number, losses: number, draws: number, unknown: number }}
 */
function winLoss(rows) {
  const out = { wins: 0, losses: 0, draws: 0, unknown: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const result = String(r.result || '');
    if (WON.test(result)) out.wins++;
    else if (LOST.test(result)) out.losses++;
    else if (DRAWN.test(result)) out.draws++;
    else out.unknown++;
  }
  return out;
}

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

  // Out of the RECORDED matches the patterns counted it in: a match graded
  // from Riot's record alone has no mistakes to repeat (patterns.js).
  const first = Array.isArray(p.mistakes) && p.mistakes[0] ? p.mistakes[0] : null;
  const top = first ? {
    title: first.title,
    detail: `In ${first.matches} of your last ${p.recorded} recorded matches.`,
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

module.exports = { homeModel, winLoss, TREND, RECENT };
