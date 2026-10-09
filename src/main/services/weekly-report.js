'use strict';

/**
 * The weekly report: this week's graded matches, how each grade category moved
 * against the week before, the mistake that keeps repeating, and which tracker
 * stats moved.
 *
 * Pure assembly, no I/O and no electron. The caller gathers the inputs (saved
 * reviews, the patterns across them, the tracker profile and its baseline) and
 * this decides what is worth saying. Kept separate from the main process so
 * the logic that decides what a player is told about their week can be tested
 * directly.
 */

const { repeatTitle, specificOf } = require('../../shared/insights');

// Rank ladder for trend arrows: "Gold 2" -> a comparable number. Unknown -> null.
const RANK_LADDER = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant'];

function rankIndex(r) {
  const l = String(r || '').toLowerCase();
  const i = RANK_LADDER.findIndex((t) => l.startsWith(t));
  if (i < 0) return null;
  const div = parseInt(l.replace(/[^\d]/g, ''), 10);
  return i * 3 + (isNaN(div) ? 2 : div);
}

/** 'up' | 'down' | 'flat', with a deadband so noise is not reported as change. */
function trendDirection(cur, prev, deadband = 2) {
  if (cur == null || prev == null) return 'flat';
  const d = cur - prev;
  return d > deadband ? 'up' : d < -deadband ? 'down' : 'flat';
}

/** ISO-style week key ("2026-W30") so the report shows once per calendar week. */
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));       // nearest Thursday
  const week = Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}


// Which stats the report tracks. deadband keeps normal week-to-week noise from
// being announced as progress or decline.
const WEEKLY_STATS = [
  { key: 'rank',        label: 'Rank',         fmt: (v) => String(v),           deadband: 0 },
  { key: 'winRate',     label: 'Win rate',     fmt: (v) => Math.round(v) + '%', deadband: 2 },
  { key: 'kd',          label: 'K/D',          fmt: (v) => (+v).toFixed(2),     deadband: 0.05 },
  { key: 'headshotPct', label: 'Headshot %',   fmt: (v) => Math.round(v) + '%', deadband: 1 },
  { key: 'acs',         label: 'Combat score', fmt: (v) => Math.round(v),       deadband: 6 },
  { key: 'adr',         label: 'Damage/round', fmt: (v) => Math.round(v),       deadband: 5 },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the report.
 *
 * input = {
 *   riotId, game,
 *   stats (current tracker profile | null), base (week-ago snapshot | null), snapshotAt,
 *   reviews (saved reviews of the last fortnight, newest first),
 *   patterns (patterns.summarise over the last matches),
 *   now
 * }
 *
 * Returns { hasData:false, reason } when there is not enough to say anything
 * honest, because a report of blanks and invented praise is worse than not
 * opening at all.
 */
function assembleReport(input) {
  const { riotId = '', stats = null, base = null, snapshotAt = null } = input || {};
  const now = input && input.now ? input.now : Date.now();
  const all = Array.isArray(input && input.reviews) ? input.reviews : [];
  const graded = all.filter((e) => e && e.review && e.review.grade && typeof e.review.grade.score === 'number');
  const week = graded.filter((e) => e.at >= now - WEEK_MS);
  const before = graded.filter((e) => e.at < now - WEEK_MS && e.at >= now - 2 * WEEK_MS);
  const patterns = (input && input.patterns) || null;

  if (!stats && !week.length) {
    return { hasData: false, reason: riotId ? 'no-activity' : 'not-connected', riotId };
  }

  // Stat movement against the baseline captured at the start of the week.
  const deltas = [];
  if (stats) {
    for (const d of WEEKLY_STATS) {
      const cur = stats[d.key];
      if (cur == null || cur === '') continue;
      const prev = base ? base[d.key] : null;
      const row  = { label: d.label, value: d.fmt(cur), direction: 'flat', change: null };
      if (d.key === 'rank') {
        row.direction = prev ? trendDirection(rankIndex(cur), rankIndex(prev), 0) : 'flat';
        if (prev && prev !== cur) row.change = String(prev) + ' to ' + String(cur);
      } else if (typeof prev === 'number' && typeof cur === 'number') {
        const diff = cur - prev;
        if (Math.abs(diff) >= d.deadband) {
          row.direction = diff > 0 ? 'up' : 'down';
          const shown = d.key === 'kd' ? Math.abs(diff).toFixed(2) : Math.round(Math.abs(diff));
          row.change = (diff > 0 ? '+' : '-') + shown;
        }
      }
      deltas.push(row);
    }
  }

  // Each grade category this week, against the week before when it had any.
  const avgCat = (rows) => {
    const m = new Map();
    for (const e of rows) {
      for (const c of e.review.grade.categories || []) {
        if (typeof c.score !== 'number') continue;
        const x = m.get(c.key) || { key: c.key, label: c.label, sum: 0, n: 0 };
        x.sum += c.score; x.n++;
        m.set(c.key, x);
      }
    }
    return m;
  };
  const nowCats = avgCat(week);
  const prevCats = avgCat(before);
  const categories = [...nowCats.values()].map((c) => {
    const avg = Math.round(c.sum / c.n);
    const p = prevCats.get(c.key);
    return { key: c.key, label: c.label, avg, direction: p ? trendDirection(avg, Math.round(p.sum / p.n), 3) : 'flat' };
  });
  const rated = categories.slice().sort((a, b) => b.avg - a.avg);
  const best  = rated.length     ? rated[0] : null;
  const worst = rated.length > 1 ? rated[rated.length - 1] : null;

  // What went well and what to fix, from the matches themselves: the entries
  // that showed up most this week.
  // A count across matches carries a title true of all of them
  // (insights.repeatTitle): "Healing up 32%, in 3 matches" pinned one match's
  // figure on three, and "Dying at B Main" one match's place.
  const count = (list) => {
    const m = new Map();
    for (const e of week) {
      const map = e.review.game && e.review.game.map;
      for (const x of ((e.review.insights || {})[list] || [])) {
        const t = m.get(x.key) || { key: x.key, title: x.title, fix: x.fix || null, n: 0, specifics: new Set() };
        t.n++;
        t.specifics.add(specificOf(x, map));
        m.set(x.key, t);
      }
    }
    return [...m.values()]
      .map((t) => (t.n > 1 ? { ...t, ...repeatTitle(t.key, list, t, t.specifics) } : t))
      .sort((a, b) => b.n - a.n);
  };
  const doingWell = count('strengths').slice(0, 3).map((x) => x.n > 1 ? `${x.title}, in ${x.n} matches` : x.title);

  // The repeated mistakes across matches, the same list the library shows, as
  // habits with their fix.
  const habits = patterns && patterns.enough
    ? patterns.mistakes.slice(0, 3).map((p) => ({
      label: p.title,
      sessions: p.matches,
      count: p.total,
      // One match's own sentence under a habit counted across several, so it
      // is labelled as the latest, as the library labels it.
      blurb: p.examples[0] && p.examples[0].detail ? `Latest match: ${p.examples[0].detail}` : '',
      fix: p.fix || '',
    }))
    : [];
  // What to work on, only when there are no repeated mistakes to show below:
  // the same list twice on one page reads as padding.
  const toImprove = habits.length ? []
    : count('mistakes').slice(0, 3).map((x) => x.fix ? `${x.title}. ${x.fix}` : x.title);

  const avgOverall = week.length
    ? Math.round(week.reduce((sum, e) => sum + e.review.grade.score, 0) / week.length) : null;
  const avgBefore = before.length
    ? Math.round(before.reduce((sum, e) => sum + e.review.grade.score, 0) / before.length) : null;

  return {
    hasData: true,
    weekOf: weekKey(new Date(now)),
    since: base ? snapshotAt : null,
    riotId,
    rank: stats ? stats.rank : null,
    matchesTracked: stats ? stats.matches : null,
    sessions: week.length,
    avgOverall,
    avgDirection: avgOverall !== null && avgBefore !== null ? trendDirection(avgOverall, avgBefore, 2) : 'flat',
    deltas,
    categories,
    best,
    worst,
    doingWell,
    toImprove,
    habits,
    // With no baseline we say so, rather than showing flat arrows that read as
    // "no progress" when they really mean "nothing to compare against".
    firstWeek: !base && !before.length,
  };
}

module.exports = { assembleReport, weekKey, rankIndex, trendDirection, WEEK_MS };
