'use strict';

/**
 * WHEN YOU PLAY BEST (9.1, the owner's item 15): the hours of the day a
 * player's graded matches started in, by average grade and win rate, and the
 * best and worst of them, said only once there are enough matches to say it
 * honestly. Pure: no clock, no DOM, no store. Matches calls it on the rows it
 * already lists (REVIEWS_LIST), and test:playtimes holds every rule below.
 *
 * THE TIMES OF DAY are eight windows of three hours (midnight to 3 AM, 3 AM
 * to 6 AM, ... 9 PM to midnight), in the player's own clock. One hour alone
 * holds a match or two; three hours is still one sitting, and holds enough to
 * compare.
 *
 * WHEN A MATCH STARTED. Riot's own start where its review kept one
 * (matchStartedAt, a linked match), else when the recording saw it start
 * (watchedFrom, from the first round the reader kept, screenStartOf, kept on
 * a recorded review since 9.1),
 * else its end less 100 seconds a round of its score (the length
 * riot-review.js gives a match Riot did not time, the rule home-model.js
 * startOf keeps), else its end less half an hour, a typical match, for a row
 * with no score at all.
 *
 * WHAT COUNTS: a row with a grade, not still being checked. A provisional
 * grade counts, as it does in the average Matches shows. The win rate is over
 * the matches with a result (a Victory or a Defeat); a draw or a part with no
 * result is in the average and not the win rate.
 *
 * HONEST, IN THREE RULES:
 *   1. A time of day is compared only with MIN_SLOT graded matches in it.
 *   2. Nothing is said under MIN_TOTAL graded matches in all, or with fewer
 *      than two times of day to compare. Below that the result says what is
 *      missing in words that stay true whenever the player plays next: how
 *      many more at the least, or, for a player whose matches all start in
 *      one time of day (the common case), that a second time of day needs
 *      MIN_SLOT of its own. "4 more graded matches" said to an evening player
 *      stayed "4 more" however many evenings they added.
 *   3. Best and worst are the highest and lowest average grade of the times
 *      compared, and the gap between them is CLEAR only when it is at least
 *      twice the noise of the two averages (the standard error of their
 *      difference, each time of day's own spread, never under SPREAD_FLOOR
 *      points), and at least MIN_GAP. Under that the two are still named, with
 *      their counts, and the line says it is too close to call yet.
 *
 * A plain file in both worlds, like display.js: required in node and loaded
 * by a page as <script src="../../shared/play-times.js"></script>, which sets
 * window.OcclaraPlayTimes.
 */
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraPlayTimes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SLOT_HOURS = 3;
  const SLOTS = 24 / SLOT_HOURS;
  const MIN_SLOT = 4;
  const MIN_TOTAL = 10;
  const MIN_GAP = 4;
  // A time of day with four grades all within a point of each other is not a
  // time of day the player is that steady in; it is four matches. Each spread
  // is held to at least this many points before the noise is worked out.
  const SPREAD_FLOOR = 8;
  const ROUND_MS = 100 * 1000;
  const NO_SCORE_MS = 30 * 60 * 1000;

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /** When a row's match started, in ms, or null without a time. */
  function startOf(row) {
    if (!row) return null;
    if (fin(row.matchStartedAt) && row.matchStartedAt > 0) return row.matchStartedAt;
    if (fin(row.watchedFrom) && row.watchedFrom > 0 && !(fin(row.at) && row.watchedFrom > row.at)) return row.watchedFrom;
    if (!fin(row.at) || row.at <= 0) return null;
    const m = /(\d+)\s*[-:]\s*(\d+)/.exec(String(row.score || ''));
    if (m) return row.at - (Number(m[1]) + Number(m[2])) * ROUND_MS;
    return row.at - NO_SCORE_MS;
  }

  /**
   * WHEN THE SCREEN SAW A MATCH START (9.1), from the rounds the reader kept:
   * the first round it read, less 100 seconds for each round before it, so a
   * recording started in round 6 is put back to round 1. Kept on a recorded
   * review as watchedFrom (index.js buildValorantReview), so a match never
   * linked to Riot's record has a start of its own, not one guessed from its
   * end and its score. Not the engine's matchStartedAt, which is when it
   * began waiting for a match (Start, or the last match's end), lobby and
   * queue included. Null without a round read.
   * @param rounds  the ledger's rounds: [{ n, firstAt }]
   */
  function screenStartOf(rounds) {
    let best = null;
    for (const r of Array.isArray(rounds) ? rounds : []) {
      if (!r || !fin(r.firstAt) || r.firstAt <= 0 || !Number.isInteger(r.n) || r.n < 1) continue;
      const at = r.firstAt - (r.n - 1) * ROUND_MS;
      if (best === null || at < best) best = at;
    }
    return best;
  }

  /** The grade a row counts with, or null. */
  function gradeOf(row) {
    if (!row || row.work) return null;
    const g = row.grade;
    const s = g && typeof g === 'object' ? g.score : g;
    return fin(Number(s)) && s !== null && s !== '' ? Math.max(0, Math.min(100, Number(s))) : null;
  }

  /** 'won', 'lost' or null, from a row's result. */
  function outcomeOf(row) {
    const r = String((row && row.result) || '');
    if (/^(?:victory|win|won)\b/i.test(r)) return 'won';
    if (/^(?:defeat|loss|lost)\b/i.test(r)) return 'lost';
    return null;
  }

  /** "9 PM", "noon", "midnight": an hour of the day as a clock says it. */
  function hourWord(h, lead) {
    const n = ((h % 24) + 24) % 24;
    if (n === 0) return lead ? 'Midnight' : 'midnight';
    if (n === 12) return lead ? 'Noon' : 'noon';
    return `${n % 12} ${n < 12 ? 'AM' : 'PM'}`;
  }

  /** A time of day's name: "6 PM to 9 PM", "Midnight to 3 AM", "9 PM to midnight". */
  function slotLabel(slot) {
    const from = slot * SLOT_HOURS;
    return `${hourWord(from, true)} to ${hourWord(from + SLOT_HOURS, false)}`;
  }

  /** "from 6 PM to 9 PM" inside a sentence. */
  function slotPhrase(slot) {
    const from = slot * SLOT_HOURS;
    return `${hourWord(from, false)} to ${hourWord(from + SLOT_HOURS, false)}`;
  }

  /** "between 6 PM and 9 PM", "between midnight and 3 AM" inside a sentence. */
  function slotBetween(slot) {
    const from = slot * SLOT_HOURS;
    return `between ${hourWord(from, false)} and ${hourWord(from + SLOT_HOURS, false)}`;
  }

  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  function spread(xs) {
    if (xs.length < 2) return SPREAD_FLOOR;
    const m = mean(xs);
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
    return Math.max(SPREAD_FLOOR, Math.sqrt(v));
  }

  /** "won 5 of 7", or "won 5 of 7 with a result" when some had none, or '' with none. */
  function winWords(s) {
    if (!s.decided) return 'no result to count a win rate';
    return `won ${s.won} of ${s.decided}${s.decided < s.n ? ' with a result' : ''}`;
  }

  /** One time of day's line: "Average grade 81 over 7 matches, won 5 of 7." */
  function slotLine(s) {
    return `Average grade ${s.avg} over ${plural(s.n, 'match', 'matches')}, ${winWords(s)}.`;
  }

  /**
   * @param rows  library rows (REVIEWS_LIST), any order
   * @param opts.hourOf  ms -> the hour of the day (0 to 23) in the player's
   *                     clock; the local clock by default
   */
  function playTimes(rows, opts) {
    const o = opts || {};
    const hourOf = typeof o.hourOf === 'function' ? o.hourOf : (ms) => new Date(ms).getHours();
    const slots = Array.from({ length: SLOTS }, (_, slot) => ({
      slot, from: slot * SLOT_HOURS, to: slot * SLOT_HOURS + SLOT_HOURS, label: slotLabel(slot),
      n: 0, avg: null, won: 0, lost: 0, decided: 0, winPct: null, compared: false, grades: [],
    }));
    let counted = 0;
    let undated = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const g = gradeOf(row);
      if (g === null) continue;
      const at = startOf(row);
      const h = at === null ? NaN : Number(hourOf(at));
      if (!Number.isInteger(h) || h < 0 || h > 23) { undated++; continue; }
      const s = slots[Math.floor(h / SLOT_HOURS)];
      s.grades.push(g);
      const out = outcomeOf(row);
      if (out === 'won') s.won++;
      if (out === 'lost') s.lost++;
      counted++;
    }
    for (const s of slots) {
      s.n = s.grades.length;
      s.decided = s.won + s.lost;
      s.avg = s.n ? Math.round(mean(s.grades)) : null;
      s.winPct = s.decided ? Math.round((s.won / s.decided) * 100) : null;
      s.compared = s.n >= MIN_SLOT;
    }
    const compared = slots.filter((s) => s.compared);
    const enough = counted >= MIN_TOTAL && compared.length >= 2;

    // HOW MANY MORE: enough in all, and two times of day at MIN_SLOT, the two
    // fullest being the nearest to it. A match can do both at once, so the
    // larger of the two is the least that is needed (need). Which of the two
    // holds it back (short) decides what the card says: 'total', matches in
    // all; 'second', a second time of day, the first one already full;
    // 'two', two times of day, neither full yet.
    let need = 0, short = null, top = null, next = null, toward = null;
    if (!enough) {
      const fullest = slots.slice().sort((a, b) => (b.n - a.n) || (a.slot - b.slot));
      top = fullest[0];
      next = fullest[1];
      const forTotal = Math.max(0, MIN_TOTAL - counted);
      const forSlots = Math.max(0, MIN_SLOT - top.n) + Math.max(0, MIN_SLOT - next.n);
      need = Math.max(forTotal, forSlots, 1);
      if (!counted || forSlots <= forTotal) {
        short = 'total';
        toward = { have: counted, of: Math.max(MIN_TOTAL, counted + need), label: 'Graded matches so far, toward when you play best' };
      } else if (top.n >= MIN_SLOT) {
        short = 'second';
        toward = { have: next.n, of: MIN_SLOT, label: 'Graded matches at a second time of day' };
      } else {
        short = 'two';
        toward = { have: Math.min(MIN_SLOT, top.n) + Math.min(MIN_SLOT, next.n), of: 2 * MIN_SLOT, label: 'Graded matches at the two fullest times of day' };
      }
    }

    let best = null, worst = null, gap = null, clear = false;
    if (enough) {
      const order = compared.slice().sort((a, b) => (b.avg - a.avg) || ((b.winPct ?? -1) - (a.winPct ?? -1)) || (b.n - a.n) || (a.slot - b.slot));
      best = order[0];
      worst = order[order.length - 1];
      gap = best.avg - worst.avg;
      const se = Math.sqrt((spread(best.grades) ** 2) / best.n + (spread(worst.grades) ** 2) / worst.n);
      clear = gap >= MIN_GAP && gap >= 2 * se;
    }

    const used = slots.filter((s) => s.grades.length).length;
    const text = words({ counted, need, short, top, next, used, enough, best, worst, gap, clear, compared: compared.length });
    // The grades themselves stay in here: a page shows the counts.
    for (const s of slots) delete s.grades;
    return { counted, undated, slots, enough, need, short, toward, best, worst, gap, clear, text,
      rules: { MIN_SLOT, MIN_TOTAL, MIN_GAP, SLOT_HOURS } };
  }

  /**
   * Below the threshold: what is missing, in words that stay true whatever
   * time the player plays next. Never a count that a match at the same time
   * of day as the rest would not bring down.
   */
  function needWords(r) {
    const n = r.counted;
    if (!n) return `Shows once you have ${MIN_TOTAL} graded matches, with at least ${MIN_SLOT} at each of two times of day.`;
    const where = r.top.n === n
      ? `${n === 1 ? 'Your one graded match so far' : n === 2 ? 'Both so far' : `All ${n} so far`} started ${slotBetween(r.top.slot)}.`
      : null;
    if (r.short === 'second') {
      return `Shows once a second time of day has ${MIN_SLOT} graded matches. `
        + (where || `${r.top.n} of your ${n} so far started ${slotBetween(r.top.slot)}, and no other time of day has more than ${r.next.n}.`);
    }
    if (r.short === 'two') {
      return `Shows once two times of day have ${MIN_SLOT} graded matches each. `
        + `Your ${n} so far are spread over ${r.used} times of day, at most ${r.top.n} at one.`;
    }
    return `Shows after at least ${plural(r.need, 'more graded match', 'more graded matches')}, with ${MIN_SLOT} or more at each of two times of day. `
      + (where || `${plural(n, 'graded match', 'graded matches')} so far.`);
  }

  /** What the card says, every line a sentence. */
  function words(r) {
    if (!r.enough) {
      // Nothing is known yet about the best time, so the card is named for
      // what it counts, never "Best time to play" over an empty chart.
      return { title: 'When you play', note: needWords(r), best: null, worst: null };
    }
    const over = `From ${plural(r.counted, 'graded match', 'graded matches')}, by when each started.`;
    if (r.clear) {
      // The title is the finding; the two calls under it keep their kickers.
      return { title: `You play best ${slotBetween(r.best.slot)}`, note: over,
        best: { kicker: 'Best time to play', label: r.best.label, line: slotLine(r.best) },
        worst: { kicker: 'Worst time to play', label: r.worst.label, line: slotLine(r.worst) } };
    }
    // Not clear: the two are named for what they are, the highest and the
    // lowest so far, and never called the best and the worst.
    const best = { kicker: 'Highest so far', label: r.best.label, line: slotLine(r.best) };
    const worst = { kicker: 'Lowest so far', label: r.worst.label, line: slotLine(r.worst) };
    return {
      title: 'No clear best time yet',
      note: `Too close to call yet: your best time is ${plural(r.gap, 'point', 'points')} over your worst across `
        + `${r.best.n} and ${plural(r.worst.n, 'match', 'matches')}, which chance alone can give. More matches will tell.`,
      best, worst,
    };
  }

  return { playTimes, startOf, screenStartOf, slotLabel, slotPhrase, slotBetween, hourWord, MIN_SLOT, MIN_TOTAL, MIN_GAP, SLOT_HOURS, SPREAD_FLOOR };
});
