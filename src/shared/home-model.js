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
 *
 * And the rank (8.2.1), Valorant's alone: the rank card under the next
 * match's focus and the RR beside each rated recent match, read from the rank
 * history main keeps for Stats (rankModel, rrForRows). It is asked for once
 * Home is painted, so a slow answer never holds the page back, and asked
 * again for a newest rated match Riot had not put in it yet (rrWaiting).
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
    // Whether the AI log still holds the match, the one word main puts on a
    // library row (index.js listReviews), for the eye on the last match:
    // 'kept', 'gone', or null when nothing was recorded (shared/log-eye.js).
    aiLog: r.aiLog === 'kept' || r.aiLog === 'gone' ? r.aiLog : null,
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

// ── The rank (8.2.1) ───────────────────────────────────────────────────────
/*
 * WHAT HOME SAYS ABOUT RANK IS WHAT STATS SAYS, by Stats' own rules, from the
 * one rank history main keeps for both (getRankHistory, STATS_RANK_HISTORY:
 * { points: [{ date, elo, change, tier }] }, oldest first, cached five
 * minutes in main):
 *
 *   the rank       the newest rated point's tier
 *   last game RR   the newest point with an elo whose change is one game's,
 *                  60 or less, because placements and act resets move the elo
 *                  by hundreds (rankDelta() in stats.js, the rank tile's RR)
 *   the journey    the rated points from the newest jump of more than 300 on,
 *                  the one stretch the Stats graph draws (renderRankGraph())
 *
 * A rated point has an elo above zero and a tier that is not Unrated or
 * Unranked. A renderer cannot require src/shared, so stats.js keeps its own
 * copies of these rules, and test:surfaces holds Home and Stats to the same
 * answers on the same history.
 */
const UNRATED = /unrated|unranked/i;
const JUMP = 300;
const GAME_RR = 60;

const pointsOf = (history) => (history && !history.error && Array.isArray(history.points)
  ? history.points.filter((p) => p && typeof p === 'object') : []);
const isRated = (p) => typeof p.elo === 'number' && p.elo > 0 && typeof p.tier === 'string' && !!p.tier && !UNRATED.test(p.tier);
const gameRR = (p) => typeof p.elo === 'number' && p.elo > 0 && Number.isFinite(p.change) && Math.abs(p.change) <= GAME_RR;

/**
 * The rank card, or null without a rated point (no Riot ID, no rated game, a
 * history that did not answer): then Home has no rank card at all.
 *
 * @param history  what STATS_RANK_HISTORY answered
 * @returns {{ tier: string, change: number|null, line: number[], games: number, from: string } | null}
 *   change is null when no game's RR is known; line is the journey's elos,
 *   oldest first, and empty below two points, because one point draws no line
 */
function rankModel(history) {
  const points = pointsOf(history);
  const rated = points.filter(isRated);
  if (!rated.length) return null;
  let start = 0;
  for (let i = rated.length - 1; i > 0; i--) {
    if (Math.abs(rated[i].elo - rated[i - 1].elo) > JUMP) { start = i; break; }
  }
  const journey = rated.slice(start);
  let change = null;
  for (let i = points.length - 1; i >= 0 && change === null; i--) if (gameRR(points[i])) change = points[i].change;
  return {
    tier: rated[rated.length - 1].tier,
    change,
    line: journey.length >= 2 ? journey.map((p) => p.elo) : [],
    games: journey.length,
    from: journey[0].tier,
  };
}

/*
 * THE RR A RATED MATCH MOVED, beside its grade in Recent matches: the nearest
 * point of the rank history within 45 minutes of the match's start, the rule
 * Stats joins its own match rows by (rrChangeForMatch() in stats.js), and
 * shown only when it is one game's RR, by the rule above.
 *
 * The rank history dates a game by when it started and a library row by when
 * it ended, so a row is placed by its start: RIOT'S OWN, which a review linked
 * to Riot's record keeps (matchStartedAt), and only without it its end less
 * 100 seconds a round, the length riot-review.js gives a match Riot did not
 * time (real matches run 83 to 103 seconds a round). Measured from its end, a
 * competitive match played straight after another sat nearer the next game's
 * start than its own, and showed that game's RR. And put back from its end, a
 * match the watch ended early, or one Stop was pressed in, landed 20 to 30
 * minutes early: its row's end is the moment the watch ended it or Stop was
 * pressed, while its score, once linked, is Riot's final, so the game before
 * it was the nearer, and its RR was shown.
 *
 * ONE POINT IS ONE GAME, so it goes to the rated row it is nearest of all of
 * them, never to two: the match after one whose own point Riot has not
 * published yet would otherwise show the RR of the match before it. Only a
 * match Riot's record calls Competitive is rated; one the screen alone read
 * is "Standard", and a nearby point is no proof it moved any RR.
 */
const RR_WINDOW_MS = 45 * 60 * 1000;
// A row that kept Riot's own start is placed exactly: the rank history dates a
// game by that same start, so its point is within minutes of it or it is not
// in the history yet. Given the 45 minutes, a row whose own game Riot had not
// published took the game before it (a 10-13 loss shown as +21) and was never
// asked for again, since it now had an RR.
const RR_EXACT_MS = 5 * 60 * 1000;
const ROUND_MS = 100 * 1000;
const RATED_MODE = /^competitive$/i;

/**
 * When a row's match started: Riot's start where its review kept one, else
 * put back from its end and its score, or null without both.
 */
function startOf(row) {
  if (!row) return null;
  const riot = row.matchStartedAt;
  if (typeof riot === 'number' && Number.isFinite(riot) && riot > 0) return riot;
  if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return null;
  const m = /(\d+)\s*[-:]\s*(\d+)/.exec(String(row.score || ''));
  return m ? row.at - (Number(m[1]) + Number(m[2])) * ROUND_MS : null;
}

/**
 * @param rows     the library rows of the game (REVIEWS_LIST), every one of
 *                 them, so a point goes to its own match and not a neighbour
 * @param history  what STATS_RANK_HISTORY answered
 * @returns {Object<string, number>}  the RR of each rated row it could place, by row id
 */
function rrForRows(rows, history) {
  const dated = pointsOf(history).filter((p) => typeof p.date === 'number' && Number.isFinite(p.date));
  const rated = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.id && RATED_MODE.test(String(r.mode || '')))
    .map((r) => ({ id: r.id, start: startOf(r), exact: typeof r.matchStartedAt === 'number' && r.matchStartedAt > 0 }))
    .filter((r) => r.start !== null);
  const nearest = (list, at, when, within) => {
    let best = null;
    for (const x of list) {
      const d = Math.abs(when(x) - at);
      if (d <= within && (!best || d < best.d)) best = { x, d };
    }
    return best ? best.x : null;
  };
  const out = {};
  for (const r of rated) {
    const p = nearest(dated, r.start, (q) => q.date, r.exact ? RR_EXACT_MS : RR_WINDOW_MS);
    if (!p || nearest(rated, p.date, (o) => o.start, RR_WINDOW_MS) !== r || !gameRR(p)) continue;
    out[r.id] = p.change;
  }
  return out;
}

/*
 * THE NEWEST RATED MATCH, STILL WAITING FOR ITS RR. Riot puts a game in the
 * rank history minutes after the match, and main and the server each keep the
 * history five minutes, so the read a review's save makes as the match ends,
 * and every save in the minutes after it, came back without that game: the
 * match showed no RR, or the game before's in the rank card, until the next
 * match. Home asks again for it once those minutes are over (home.js). Only
 * for a match that ended within the hour, since an older one's game is not
 * coming any more, and asking for it would be a read at every launch.
 */
const RR_WAIT_MS = 60 * 60 * 1000;

/**
 * @param rows  the library rows of the game, newest first (REVIEWS_LIST)
 * @param rr    rrForRows() of the same rows
 * @param now   the time now
 * @returns {string|null}  the id of the newest Competitive row, when it has no
 *   RR yet and ended within the hour; null otherwise
 */
function rrWaiting(rows, rr, now) {
  const newest = (Array.isArray(rows) ? rows : []).find((r) => r && r.id && RATED_MODE.test(String(r.mode || '')));
  if (!newest || (rr && Number.isFinite(rr[newest.id]))) return null;
  const end = newest.at;
  return typeof end === 'number' && Number.isFinite(end) && now - end <= RR_WAIT_MS ? newest.id : null;
}

module.exports = { homeModel, winLoss, rankModel, rrForRows, rrWaiting, TREND, RECENT, RR_WINDOW_MS, RR_EXACT_MS, RR_WAIT_MS };
