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
 * A CAUSE'S TREND IS ONE PROMPT'S (8.5.0). The coach's look at a death names
 * a cause, and variant b of its prompt widened what a repeek is: compared
 * across the two, a repeek would read as "rising" because its definition
 * grew, not because the player changed. So a `cause:` key's newer and older
 * halves are compared only across the recorded matches looked at by the same
 * prompt as the newest one looked at (death-causes.js variantOf: a look saved
 * with none was variant a), and it shows no trend until four such matches
 * exist. A match the coach never looked at is no evidence either way. Its
 * counts, in how many matches and how many times, are every match's.
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
const { variantOf } = require('./death-causes');
const { cardSatOut } = require('./sat-out');

const MIN_MATCHES = 2;
const WINDOW = 10;
// How many saved reviews the library hands over (index.js), so the last
// WINDOW recorded ones are found behind the matches graded from Riot's record:
// Connect grades ten of those in one run.
const LOOK_BACK = 40;
// The matches a trend needs, a cause's of one prompt as any other's of all.
const TREND_MATCHES = 4;

/** The prompt a review's looks were asked with, 'a' or 'b'; null for one never looked at, or looked at by both. */
function lookVariant(review) {
  const looks = ((review && review.rounds) || []).map((c) => c && c.forensics).filter((f) => f && f.cause);
  const asked = new Set(looks.map(variantOf));
  return asked.size === 1 ? [...asked][0] : null;
}

/** 'rising', 'falling' or 'steady': seen in `newer` of the first `n / 2` matches and `older` of the rest. */
function trendOf(newer, older, n) {
  if (n < TREND_MATCHES) return null;
  const half = n / 2;
  const newerRate = newer / Math.max(1, Math.ceil(half));
  const olderRate = older / Math.max(1, Math.floor(half));
  return newerRate > olderRate + 0.15 ? 'rising' : newerRate < olderRate - 0.15 ? 'falling' : 'steady';
}

/*
 * THE ROUNDS A SAVED REVIEW SAYS THE PLAYER SAT OUT (8.8, sat-out.js): its
 * cards with Riot's AFK or spawn flag, or the chip that says so. A review
 * saved before the lists left those rounds out still counts them, so the
 * library takes them off an entry here: off its rounds and its count, and an
 * entry left with none of its rounds is no sighting.
 */
const SAT_OUT_CHIPS = new Set(['Riot marked you AFK, not counted', 'Stayed in spawn all round, not counted']);
function satOutRounds(review) {
  const out = new Set();
  for (const c of (review && Array.isArray(review.rounds) ? review.rounds : [])) {
    if (!c || !Number.isInteger(c.n)) continue;
    if (cardSatOut(c) || (Array.isArray(c.facts) && c.facts.some((f) => SAT_OUT_CHIPS.has(f)))) out.add(c.n);
  }
  return out;
}
function withoutSatOut(e, out) {
  const rounds = Array.isArray(e.rounds) ? e.rounds : [];
  if (!out.size || !rounds.length) return e;
  const kept = rounds.filter((n) => !out.has(n));
  if (kept.length === rounds.length) return e;
  if (!kept.length) return null;
  const count = typeof e.count === 'number' ? e.count : rounds.length;
  return { ...e, rounds: kept, count: Math.max(kept.length, count - (rounds.length - kept.length)) };
}

function tally(reviews, list) {
  const map = new Map();
  // A cause's trend: the matches looked at by the newest look's prompt, newest first.
  const current = reviews.map((rv) => lookVariant(rv.review)).find(Boolean) || null;
  const byPrompt = current ? reviews.filter((rv) => lookVariant(rv.review) === current) : [];
  reviews.forEach((rv, i) => {
    const seen = new Set();
    const out = satOutRounds(rv.review);
    for (const raw of countable(rv.review)[list]) {
      const e = raw && raw.key ? withoutSatOut(raw, out) : raw;
      if (!e || !e.key || seen.has(e.key)) continue;
      seen.add(e.key);
      const t = map.get(e.key) || {
        key: e.key, title: e.title, weight: e.weight || 1, matches: 0, total: 0,
        newer: 0, older: 0, examples: [], judged: !!e.judged, fix: e.fix || null, specifics: new Set(), seenIn: new Set(),
      };
      t.specifics.add(specificOf(e, rv.review.game && rv.review.game.map));
      t.seenIn.add(rv);
      t.matches++;
      t.total += e.count || 1;
      if (i < reviews.length / 2) t.newer++; else t.older++;
      // Reviews arrive newest first, so the title, the fix and the first
      // example are the latest sighting's: "Dying at A Site" as it is now.
      if (t.examples.length < 3) t.examples.push({ id: rv.id, at: rv.at, detail: e.detail, rounds: e.rounds || [] });
      map.set(e.key, t);
    }
  });
  return [...map.values()]
    .filter((t) => t.matches >= MIN_MATCHES)
    .map((t) => {
      let trend = trendOf(t.newer, t.older, reviews.length);
      if (String(t.key).startsWith('cause:')) {
        const n = byPrompt.length;
        const at = byPrompt.map((rv) => t.seenIn.has(rv));
        trend = trendOf(at.filter((x, i) => x && i < n / 2).length, at.filter((x, i) => x && i >= n / 2).length, n);
      }
      // The title and fix the count may carry (insights.repeatTitle): the
      // newest one's only when every sighting named the same place or agent.
      const { title, fix } = repeatTitle(t.key, list, t, t.specifics);
      const { specifics, seenIn, ...rest } = t;
      return { ...rest, title, fix, share: t.matches / reviews.length, trend };
    });
}

/**
 * THE AVERAGE LEAVES A PROVISIONAL GRADE OUT once MIN_MATCHES final ones are
 * in the window, as breakdown.js gradeOf does: one verified 80 and two
 * provisional 40s averaged 53 on Home. Below that it is every grade's, and
 * averageProvisional says so. averageOver is how many grades it is over.
 */
function averageOf(grades) {
  const finals = grades.filter((g) => !g.provisional);
  const over = finals.length >= MIN_MATCHES ? finals : grades;
  if (!over.length) return { average: null, averageOver: 0, averageProvisional: false };
  return {
    average: Math.round(over.reduce((a, g) => a + g.score, 0) / over.length),
    averageOver: over.length,
    averageProvisional: over.some((g) => g.provisional),
  };
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
    ...averageOf(grades),
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

/**
 * THE RECURRING KEYS a review request carries (round 4, valorant-review.js
 * requestBody `recurring`): the keys of the mistakes the Patterns page lists,
 * counted exactly as it counts them (summarise), over the saved reviews
 * BEFORE the match being reviewed. The match itself is left out by its id, so
 * "it repeats" means the earlier matches already show it as a habit, never
 * that this match counted once and one older match did too. Empty while the
 * library is still learning the player (fewer than MIN_MATCHES recorded).
 *
 * @param saved   whole saved reviews, newest first, as summarise takes them
 * @param exclude the id of the match being reviewed, if it is already saved
 * @returns up to eight keys, most serious first
 */
function recurringKeys(saved, exclude) {
  const before = (saved || []).filter((s) => s && (!exclude || s.id !== exclude));
  const sum = summarise(before);
  if (!sum.enough) return [];
  return sum.mistakes.map((m) => m.key).filter((k) => typeof k === 'string').slice(0, 8);
}

module.exports = { summarise, recurringKeys, lookVariant, MIN_MATCHES, WINDOW, LOOK_BACK, TREND_MATCHES };
