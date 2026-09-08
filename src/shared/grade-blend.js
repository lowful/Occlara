'use strict';

/**
 * Turn four category scores and a real scoreboard into one overall number.
 *
 * WHY THIS EXISTS. A real session: Icebox, Iso, thirteen minutes, and Riot's own
 * record says Victory 5-3, 11/6/1, 386 ACS, 252 ADR, 45% headshots, grade S.
 * Occlara graded it 66 out of 100.
 *
 * The scoreboard was not missing. That row carries `gradedWithMatch: true`, so
 * the match WAS in the grading prompt. The 66 came from arithmetic: `overall`
 * was an unweighted mean of impact, positioning, utility and aim, and it never
 * looked at `match.grade` or `match.result` at all. Positioning scored 45,
 * because positioning is where a coach's corrections land, and a flat mean let
 * one category of corrections outvote a scoreboard that said the player had one
 * of their best games of the season.
 *
 * THE MATCH CAN ONLY RAISE THE SCORE, NEVER LOWER IT. That asymmetry is the
 * whole design. A great scoreboard is proof the player did something right, so
 * it should lift a grade that only counted what they did wrong. A bad scoreboard
 * is not proof the coaching was wrong, and dragging the number down would just
 * kick someone who already lost. So a poor game keeps whatever its habits earned.
 */

/**
 * What a tracker grade is worth on a 0-100 scale.
 *
 * The ladder mirrors the one the server builds the grade with in the first place
 * (ACS bands, adjusted for KD), so this is a translation rather than a second
 * opinion.
 */
const GRADE_SCORE = { S: 92, A: 82, B: 70, C: 55, D: 40 };

/** Winning is worth a little, but not much: the scoreline is the team's, the categories are yours. */
const VICTORY_BONUS = 4;

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/** The mean of whatever categories are present, or null when there are none. */
function categoryMean(scores) {
  const s = scores || {};
  const vals = ['impact', 'positioning', 'utility', 'aim']
    .map((k) => num(s[k]))
    .filter((v) => v !== null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * The scoreboard as a 0-100 number, or null when there is no verified match.
 *
 * Null is the common case and is not a failure: a session that could not be
 * linked to a Riot match simply keeps its category mean.
 */
function matchScore(match) {
  if (!match) return null;
  const g = String(match.grade || '').toUpperCase();
  const base = GRADE_SCORE[g];
  if (typeof base !== 'number') return null;
  const win = String(match.result || '').toLowerCase() === 'victory' ? VICTORY_BONUS : 0;
  return Math.min(100, base + win);
}

/**
 * The overall score for a session.
 *
 * @param scores  { impact, positioning, utility, aim }
 * @param match   the verified scoreboard, or null
 */
function overallScore(scores, match) {
  const mean = categoryMean(scores);
  if (mean === null) return 0;

  const ms = matchScore(match);
  if (ms === null) return Math.round(mean);          // no verified match: habits alone

  const blended = 0.5 * mean + 0.5 * ms;
  // The floor. Never below what the habits earned on their own.
  return Math.round(Math.max(mean, blended));
}

module.exports = { GRADE_SCORE, VICTORY_BONUS, categoryMean, matchScore, overallScore };
