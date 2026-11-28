'use strict';

/**
 * What Home shows, read from the library: the last match and its grade, the
 * focus the review set for the next one, the most repeated mistake, the grade
 * over the last five matches, the newest match's milestone, and the recent
 * matches.
 *
 * NOTHING IS INVENTED HERE. Every figure is one the library already holds,
 * and an empty library gives empty fields rather than zeros: a new player's
 * Home says there is nothing yet, not that they graded 0. The most repeated
 * mistake needs two recorded matches and the average two graded ones, the
 * rules patterns.js keeps.
 *
 * Pure: home.js hands it the index rows, the patterns and the newest review.
 * winLoss counts a record from the same index rows; since 8.9.1 the Matches
 * header no longer shows it (the player's ask), so only its test reads it.
 *
 * And the rank (8.2.1), Valorant's alone: the rank card under the next
 * match's focus and the RR beside each rated recent match, read from the rank
 * history main keeps for Stats (rankModel, rrForRows). It is asked for once
 * Home is painted, so a slow answer never holds the page back, and asked
 * again for a newest rated match Riot had not put in it yet (rrWaiting).
 */

const { noSemicolons, practiceSpelling } = require('./plain-text');
const Tiers = require('./rank-tiers');

const TREND = 5;
const RECENT = 5;

// The result tests the library's rows colour by (matches.js row()), so the
// header never counts a match the row below it does not paint as won or lost.
// A result is matched in whatever case it was saved in.
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
    // A review still being built (8.4.1): its row says it is being checked,
    // not won or lost, so the header does not count the screen's result.
    if (workOfRow(r)) { out.unknown++; continue; }
    const result = String(r.result || '');
    if (WON.test(result)) out.wins++;
    else if (LOST.test(result)) out.losses++;
    else if (DRAWN.test(result)) out.draws++;
    else out.unknown++;
  }
  return out;
}

/**
 * A review still being built (8.4.1, review-work.js workOf, on the row main
 * lists): which way it is finished and the step it is on, or null. Its grade,
 * result and score are the screen's until it is whole, so Home says it is
 * being checked where they would be.
 */
function workOfRow(r) {
  const w = r && r.work;
  if (!w || typeof w !== 'object' || (w.path !== 'riot' && w.path !== 'screen')) return null;
  return { path: w.path, step: typeof w.step === 'string' ? w.step : null };
}

/** A progress line passed through whole, or null: never one without its text. */
function milestoneOf(progress) {
  const l = progress && progress.latest;
  if (!l || typeof l.text !== 'string' || !l.text) return null;
  return { kind: typeof l.kind === 'string' ? l.kind : null, tone: typeof l.tone === 'string' ? l.tone : 'even', text: l.text };
}

function rowOf(r) {
  return {
    id: r.id, title: r.title || null, map: r.map || null, mode: r.mode || null,
    result: r.result || null, score: r.score || null, at: r.at || null,
    grade: r.grade || null, verified: !!r.verified, source: r.source || null,
    imported: r.imported === true, matchId: r.matchId || null,
    // Whether the AI log still holds the match, the one word main puts on a
    // library row (index.js listReviews), for the eye on the last match:
    // 'kept', 'gone', or null when nothing was recorded (shared/log-eye.js).
    aiLog: r.aiLog === 'kept' || r.aiLog === 'gone' ? r.aiLog : null,
    work: workOfRow(r),
    // Why a recent row has no grade, as Matches says it (9.1, GradeView
    // whyUngraded): saved with no games left, or stopped before the end.
    game: r.game || null,
    locked: r.locked === true,
    stoppedLive: !!r.stoppedLive,
  };
}

/*
 * EACH RECENT ROW'S CHANGE (9.1, the owner's item 11: Home's rows are the
 * Matches row): the grade's change on the graded match before it in the
 * whole library, 'first' for the oldest graded one, null for a row with no
 * grade or one still being built. The same arithmetic as the Matches list
 * (matches.js load), over the same rows, so the two pages agree on a match.
 */
function changesOf(list) {
  const graded = list.filter((r) => !workOfRow(r) && r.grade && Number.isFinite(Number(r.grade.score)));
  const out = new Map();
  graded.forEach((r, i) => {
    const older = graded[i + 1];
    out.set(r.id, older ? Number(r.grade.score) - Number(older.grade.score) : 'first');
  });
  return out;
}

/**
 * @param rows      the library index of the game, newest first (reviewStore.list(game))
 * @param patterns  patterns.summarise() of the same game
 * @param review    the newest whole review of the game, or null
 * @param previous  the review before it, read only while the newest is still
 *                  being written (home-preload.js), or null
 */
function homeModel({ rows, patterns, review, previous }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const p = patterns || {};
  const newest = list[0] || null;
  const whole = review && newest && review.id === newest.id ? review : null;

  const last = newest ? {
    ...rowOf(newest),
    categories: whole && whole.grade && Array.isArray(whole.grade.categories)
      ? whole.grade.categories.map((c) => ({ key: c.key || null, label: c.label, score: typeof c.score === 'number' ? c.score : null }))
      : [],
    // The player's own kills and deaths in it (9.0, the player's ask), from
    // the review's scoreline, which only Riot's record (or League's own end
    // of game numbers) fills: none while the review is still being built,
    // since its numbers are not whole yet.
    kd: workOfRow(newest) ? null : kdOf(whole && whole.scoreline),
    // 9.1, the owner's item 1: a newest match with no grade (a recording
    // stopped after two rounds) says so plainly, and why, where its grade
    // would be. Null for a graded match and one still being built.
    noGrade: noGradeOf(newest, whole),
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
  // Progress v3: the four most repeated, each with how often it happened
  // (its total over the recorded matches) and in how many of them. 9.1, the
  // owner's item 4: and which way it is going (patterns.js trendOf, the newer
  // half of the recorded matches against the older), with the words its
  // arrow's tooltip says.
  const recorded = Number.isFinite(p.recorded) ? p.recorded : null;
  const mistakes = (Array.isArray(p.mistakes) ? p.mistakes : []).slice(0, 4)
    .filter((m) => m && typeof m.title === 'string' && m.title)
    .map((m) => {
      const way = WAYS[m.trend] || null;
      return { title: m.title, total: Number.isFinite(m.total) ? m.total : null, matches: Number.isFinite(m.matches) ? m.matches : null,
        trend: way, trendWords: way ? mistakeTrendWords(m, way, recorded) : null };
    });

  const grades = Array.isArray(p.grades) ? p.grades : [];
  const changes = changesOf(list);
  // 9.1: each point carries what the shared trend chart's tooltip says (the
  // agent, the map, the result and the score, a provisional grade).
  const trend = grades.slice(0, TREND).reverse().map((g) => {
    const row = list.find((r) => r.id === g.id);
    return { id: g.id, score: g.score, at: g.at, provisional: !!g.provisional, map: row ? row.map || null : null,
      agent: row ? row.title || null : null, result: row ? row.result || null : null, scoreline: row ? row.score || null : null };
  });

  // THE FIX NEVER LEAVES THE PAGE (8.7): while the newest review is still
  // being written, the last whole review's fix stands in, and says so
  // (focusPrevious), rather than Home opening on nothing to do. 9.1: and
  // when the newest match has no grade and so no fix (a recording stopped
  // after two rounds), the last graded match's fix stands in the same way.
  const ownFocus = whole && typeof whole.focus === 'string' && whole.focus.trim() ? whole.focus : null;
  const stands = last && (last.work || last.noGrade);
  const prevFocus = !ownFocus && stands && previous && typeof previous.focus === 'string' && previous.focus.trim()
    ? previous.focus : null;

  return {
    last,
    // The model's words: no semicolons, and Practice spelt so (9.1).
    focus: practiceSpelling(noSemicolons(ownFocus || prevFocus)),
    focusPrevious: !!prevFocus,
    // Why the fix is an older one's: 'writing' (the newest is still being
    // built) or 'ungraded' (the newest has no grade), or null.
    focusFrom: prevFocus ? (last.work ? 'writing' : 'ungraded') : null,
    // 9.1, the owner's item 4: the grade's way over the last matches, for
    // the trend card's arrow and its tooltip, or null below four grades.
    gradeTrend: gradeTrendOf(grades),
    top,
    mistakes,
    recorded,
    trend,
    average: grades.length >= 2 && typeof p.average === 'number' ? p.average : null,
    // The newest match's first progress line (8.7, progress.js libraryProgress),
    // as main counted it: { kind, tone, text }, or null.
    milestone: milestoneOf(p.progress),
    // Each recent row's marks (8.7, progress.js libraryProgress marks[id]),
    // the badges the library draws, "Best in 23", "First A", "3 in a row":
    // read whole, as main counted them, and [] where it counted none.
    recent: list.slice(0, RECENT).map((r) => ({ ...rowOf(r), marks: marksOf(p.progress, r.id), delta: changes.has(r.id) ? changes.get(r.id) : null })),
  };
}

/**
 * THE LAST MATCH'S K/D (9.0): the kills and deaths of the review's own
 * scoreline (valorant-review.js build, lol-review.js), and the ratio as Riot
 * writes it, kills over deaths to two places, the kills alone with no death.
 * Null unless both are whole numbers of zero or more: never a guess, and no
 * K/D at all is shown for a review with no scoreline.
 *
 * @returns {{ kills: number, deaths: number, ratio: string } | null}
 */
function kdOf(scoreline) {
  const s = scoreline && typeof scoreline === 'object' ? scoreline : null;
  if (!s) return null;
  const whole = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (!whole(s.kills) || !whole(s.deaths)) return null;
  const ratio = s.deaths > 0 ? s.kills / s.deaths : s.kills;
  return { kills: s.kills, deaths: s.deaths, ratio: ratio.toFixed(2) };
}

/*
 * WHY THE NEWEST MATCH HAS NO GRADE (9.1, the owner's item 1). The owner's
 * Home said "Your last match is graded." over a two round Haven recording
 * that had none. A grade needs enough of the match to speak (grade.js
 * finish), so a recording stopped after a few rounds has none: it says how
 * many rounds were recorded, from the review's own count. Riot's record
 * having the player sit out every round says that. Anything else, plainly,
 * that too little was seen. Null for a graded match or one still being
 * built, whose grade is on its way.
 */
const FEW_ROUNDS = 6;
function noGradeOf(row, review) {
  if (!row || row.grade || workOfRow(row)) return null;
  const w = review && review.watched && typeof review.watched === 'object' ? review.watched : null;
  const n = w && Number.isInteger(w.rounds) && w.rounds >= 0 ? w.rounds : null;
  if (n !== null && n <= FEW_ROUNDS) {
    return { rounds: n, text: n === 0 ? 'No round was recorded, so there is nothing to grade.'
      : `Only ${n} round${n === 1 ? ' was' : 's were'} recorded, too few to grade.` };
  }
  const notes = review && review.grade && Array.isArray(review.grade.notes) ? review.grade.notes : [];
  const said = notes.find((s) => typeof s === 'string' && /nothing to grade/.test(s));
  return { rounds: n, text: said || 'Too little of this match was seen to grade it.' };
}

/*
 * WHICH WAY A REPEATED MISTAKE IS GOING (9.1, the owner's item 4): patterns.js
 * trendOf compares how many of the newer half of the recorded matches it
 * showed up in with the older half ('rising' is more often lately). An arrow
 * up is getting worse, down getting better, a flat line steady, and its
 * tooltip says exactly what was compared. A cause's trend is counted over the
 * matches the coach looked at with one prompt (patterns.js), so its words
 * give no counts that are not its own.
 */
const WAYS = { rising: 'up', falling: 'down', steady: 'flat' };
function mistakeTrendWords(m, way, n) {
  const lead = way === 'up' ? 'Getting worse' : way === 'down' ? 'Getting better' : 'Steady';
  const newer = Number.isInteger(m.newer) ? m.newer : null;
  const older = Number.isInteger(m.older) ? m.older : null;
  const byLook = String(m.key || '').startsWith('cause:');
  if (byLook || !Number.isInteger(n) || n < 4 || newer === null || older === null) {
    return way === 'up' ? `${lead}: it shows up in more of your newer recorded matches than the ones before.`
      : way === 'down' ? `${lead}: it shows up in fewer of your newer recorded matches than the ones before.`
        : `${lead}: it shows up as often in your newer recorded matches as in the ones before.`;
  }
  const a = Math.ceil(n / 2), b = Math.floor(n / 2);
  const now = `in ${newer} of your ${a} newest recorded matches`;
  if (way === 'up') return `${lead}: ${now}, up from ${older} of the ${b} before them.`;
  if (way === 'down') return `${lead}: ${now}, down from ${older} of the ${b} before them.`;
  return `${lead}: ${now}, and ${older} of the ${b} before them.`;
}

/*
 * WHICH WAY THE GRADE IS GOING (9.1, the owner's item 4), for the trend card:
 * the average of the grades its line draws (the last TREND) against the
 * average of the TREND before them, with two or more of those; else, with
 * four or more drawn, the newer half of the line against the older half.
 * Three points either way is steady: one match moves a grade more than that.
 * Null below four grades, where no direction is honest. `words` is the
 * arrow's tooltip, saying exactly what was compared.
 */
const GRADE_STEADY = 3;
function gradeTrendOf(grades) {
  const g = (Array.isArray(grades) ? grades : []).map((x) => Number(x && x.score)).filter((v) => Number.isFinite(v));
  const avg = (xs) => Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);
  const shown = g.slice(0, TREND);
  let a, b, said;
  if (g.length - shown.length >= 2) {
    const before = g.slice(TREND, TREND * 2);
    a = avg(shown); b = avg(before);
    said = `your last ${shown.length} graded matches average ${a}, the ${before.length} before them ${b}.`;
  } else if (shown.length >= 4) {
    const k = Math.ceil(shown.length / 2);
    const newer = shown.slice(0, k), older = shown.slice(k);
    a = avg(newer); b = avg(older);
    said = `your newest ${newer.length} graded matches average ${a}, the ${older.length} before them ${b}.`;
  } else return null;
  const delta = a - b;
  const way = delta >= GRADE_STEADY ? 'up' : delta <= -GRADE_STEADY ? 'down' : 'flat';
  const lead = way === 'up' ? 'Getting better' : way === 'down' ? 'Getting worse' : 'Steady';
  return { way, delta, recent: a, before: b, words: `${lead}: ${said}` };
}

/** One row's marks as main counted them: [{ kind, text }], never one without its text. */
function marksOf(progress, id) {
  const all = progress && progress.marks && typeof progress.marks === 'object' ? progress.marks[id] : null;
  return (Array.isArray(all) ? all : []).filter((k) => k && typeof k.text === 'string' && k.text)
    .map((k) => ({ kind: typeof k.kind === 'string' ? k.kind : null, text: k.text }));
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
/*
 * IRON 1 AT 0 RR IS A RANK (9.1). Its elo is 0 (place 0 times 100 plus 0 RR),
 * the same number an unrated point carries, and read as unrated the card
 * showed the game before it: "+19 RR" after a game that cost 19. An elo of 0
 * is rated only where its tier says Iron 1, the one tier it can be.
 */
const eloRated = (p) => typeof p.elo === 'number' && Number.isFinite(p.elo) && (p.elo > 0 || (p.elo === 0 && Tiers.placeOf(p.tier) === 0));
const isRated = (p) => eloRated(p) && typeof p.tier === 'string' && !!p.tier && !UNRATED.test(p.tier);
const gameRR = (p) => eloRated(p) && Number.isFinite(p.change) && Math.abs(p.change) <= GAME_RR;

/**
 * The rank card, or null without a rated point (no Riot ID, no rated game, a
 * history that did not answer): then Home has no rank card at all.
 *
 * @param history  what STATS_RANK_HISTORY answered
 * @returns {{ tier: string, change: number|null, line: number[], games: number, from: string } | null}
 *   change is null when no game's RR is known; line is the journey's elos,
 *   oldest first, and empty below two points, because one point draws no line
 */
function inTier(p) {
  if (!p || typeof p.elo !== 'number') return null;
  // From Immortal 1 the RR is not capped at 100 (9.1, rank-tiers.js): the
  // RR over the tier's own base, as the game shows it, or nothing.
  if (/immortal|radiant/i.test(String(p.tier || ''))) return Tiers.rrOf(p.tier, p.elo);
  const rr = p.elo % 100;
  return Number.isInteger(rr) && rr >= 0 && rr < 100 ? rr : null;
}

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
    // The RR inside the tier (Progress v3, the rank card's bar): Riot's elo
    // is the tier's place times 100 plus the RR, so below Immortal the RR is
    // its last two digits; from Immortal 1 it is the RR over the tier's base,
    // uncapped (9.1).
    rr: inTier(rated[rated.length - 1]),
    // 9.1, the owner's item 10: the tier after it ("Diamond 2"), null at
    // Radiant, and whether the RR runs in steps of 100 (below Immortal), so
    // the card shows the way to the next rank only where there is a fixed one.
    next: Tiers.nextOf(rated[rated.length - 1].tier),
    capped: Tiers.capped(rated[rated.length - 1].tier),
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
/*
 * BY MATCH ID FIRST (8.7.9). The stored history HenrikDev serves now
 * (server henrik-rank.js storedHistoryV2) names each game's Riot match id,
 * and a review linked to Riot's record keeps the same id (`matchId` on its
 * row), so that pair is matched exactly, with no clock at all. Only what is
 * left is placed by time, as before: a point that names a match some row of
 * the library holds is that row's or nobody's, and a row whose match id the
 * history does not name is given no point that names another match, since
 * that point is by its own id some other game. A history from an older
 * server, with no ids, is placed by time exactly as it always was.
 */
const idOf = (x) => (typeof x === 'string' && x.trim() ? x.trim().toLowerCase() : null);

function rrForRows(rows, history) {
  const all = pointsOf(history);
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  const held = new Set(list.map((r) => idOf(r.matchId)).filter(Boolean));
  const byId = new Map();
  for (const p of all) { const k = idOf(p.matchId); if (k && !byId.has(k)) byId.set(k, p); }
  const out = {};
  const placed = new Set();
  for (const r of list) {
    if (!RATED_MODE.test(String(r.mode || ''))) continue;
    const p = byId.get(idOf(r.matchId));
    if (!p) continue;
    placed.add(r.id);
    if (gameRR(p)) out[r.id] = p.change;
  }
  const dated = all.filter((p) => typeof p.date === 'number' && Number.isFinite(p.date) && !(idOf(p.matchId) && held.has(idOf(p.matchId))));
  const rated = list
    .filter((r) => RATED_MODE.test(String(r.mode || '')) && !placed.has(r.id))
    .map((r) => ({ id: r.id, start: startOf(r), exact: typeof r.matchStartedAt === 'number' && r.matchStartedAt > 0, matchId: idOf(r.matchId) }))
    .filter((r) => r.start !== null);
  const nearest = (xs, at, when, within) => {
    let best = null;
    for (const x of xs) {
      const d = Math.abs(when(x) - at);
      if (d <= within && (!best || d < best.d)) best = { x, d };
    }
    return best ? best.x : null;
  };
  for (const r of rated) {
    // A row with its own match id never takes a point that names another match.
    const pool = r.matchId ? dated.filter((p) => !idOf(p.matchId)) : dated;
    const p = nearest(pool, r.start, (q) => q.date, r.exact ? RR_EXACT_MS : RR_WINDOW_MS);
    if (!p || nearest(rated, p.date, (o) => o.start, RR_WINDOW_MS) !== r || !gameRR(p)) continue;
    out[r.id] = p.change;
  }
  return out;
}

/**
 * The rank history's point for one Riot match id, or null: the RR chip on
 * the review page reads its shield and refund beside the RR (riot-rank.js).
 */
function pointForMatch(history, matchId) {
  const k = idOf(matchId);
  return k ? pointsOf(history).find((p) => idOf(p.matchId) === k) || null : null;
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
  return newest && rrWaitingFor(newest, rr && rr[newest.id], now) ? newest.id : null;
}

/**
 * One row, the review page's own (8.7.9): whether its RR is still to come,
 * so the page asks again later. A Competitive row with no finite RR that
 * ended within the hour.
 * @param row  a library row ({ id, at, mode })
 * @param rr   that row's RR, a number or nothing
 * @param now  the time now
 */
function rrWaitingFor(row, rr, now) {
  if (!row || !row.id || !RATED_MODE.test(String(row.mode || ''))) return false;
  if (Number.isFinite(rr)) return false;
  const end = row.at;
  return typeof end === 'number' && Number.isFinite(end) && now - end <= RR_WAIT_MS;
}

module.exports = { homeModel, kdOf, winLoss, rankModel, rrForRows, pointForMatch, rrWaiting, rrWaitingFor, noGradeOf, gradeTrendOf, mistakeTrendWords,
  TREND, RECENT, RR_WINDOW_MS, RR_EXACT_MS, RR_WAIT_MS };
