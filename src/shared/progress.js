'use strict';

/**
 * PROGRESS (8.7): what one match did against the ones before it, counted.
 *
 * The review says how a match went. A player who comes back wants to know
 * whether they are getting better, and the answer is a count, never a model's
 * line: up or down on the last match and on the average, a best grade or a
 * first S or A, a run of B or better, a habit cleared for a few matches, and
 * whether last match's top mistake showed up again. One module counts it, so
 * the review, the library and Home say the same thing in the same words.
 *
 *   matchProgress(saved, id)
 *     { id, score, letter, provisional,
 *       vsLast:    { delta, score, letter, at, provisional } | null,
 *       vsAverage: { delta, average, matches, provisional } | null,
 *       best: { grade: { over, matches } | null,
 *               firstLetter: { letter, over, matches } | null,
 *               categories: [{ key, label, score, previous, over, matches }] },
 *       run: { count, floor: 'B' } | null,
 *       cleared: [{ key, title, streak, before }],
 *       focus: { text, key, title, before, now, outcome, last } | null,
 *       lines: [{ kind, tone, text }] }
 *
 *   libraryProgress(saved)
 *     { marks: { [id]: [{ kind, text }] }, run, latest }
 *
 * A BEST NAMES ITS WINDOW. The library hands over the last LOOK_BACK reviews,
 * so a "best grade" is the best of those, never of all time, and every line
 * says how many matches it is over: "Best grade in your last 23 graded
 * matches." A best needs BEST_FLOOR graded matches before it, so the second
 * match a player ever records is not a record.
 *
 * A PROVISIONAL GRADE IS NO RECORD. One graded without Riot's record, or with
 * a category missing, can land ten points from the same match graded whole
 * (grade.js), so it never makes a best or a run, and a run stops at one. Its
 * delta on the last match is still given, and says it is provisional.
 *
 * CLEARED AND THE FOCUS COUNT RECORDED MATCHES ONLY, by the stable keys
 * patterns.js counts (insights.countable): a match graded from Riot's record
 * alone has no list to count. An entry the coach's look judged and a `cause:`
 * key are skipped, because what they mean moves with the prompt variant
 * (patterns.js, "A CAUSE'S TREND IS ONE PROMPT'S").
 *
 * THE FOCUS IS CHECKED BY COUNT, NOT BY ITS WORDS. The model's FOCUS line is
 * free text and cannot be counted, so the check is on the previous recorded
 * review's top counted mistake: how many times then, how many now. Both
 * reviews must be Riot verified, so the two counts are of the same kind. Its
 * line names it as "last match's top mistake" and gives the two counts, never
 * that the focus was done.
 *
 * NO DASH IN ANY LINE, and a sign is a word ("Up 6", "Down 4"), so colour is
 * never the only signal and no line needs a minus. Every number in a line is
 * one of the fields beside it, which test:progress checks.
 *
 * League reviews get the grade parts (deltas, best, run). Their lists are not
 * counted here, so cleared is empty and focus null.
 *
 * Pure, no Electron and no DOM: main reads it (index.js getProgress, and
 * getPatterns' `progress`), the pages show its lines and do no arithmetic.
 */

const { WINDOW, MIN_MATCHES } = require('./patterns');
const { countable } = require('./insights');
const grade = require('./grade');

/** Graded matches a best needs before it. */
const BEST_FLOOR = 3;
/** The letters a run counts as B or better. A renderer never holds this table. */
const RUN_LETTERS = new Set(['S', 'A', 'B']);
const RUN_FLOOR = 'B';
/** The fewest matches in a row a run or a cleared habit needs. */
const STREAK_MIN = 2;
/** The letters a first is worth a line for, best first. */
const FIRSTS = ['S', 'A'];
const ORDER = ['S', 'A', 'B', 'C', 'D'];
/** The most cleared habits one match lists. */
const MAX_CLEARED = 3;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
/** A category as the card shows it: whole, and never above 100 (grade.js finish). */
const shown = (v) => (num(v) === null ? null : Math.max(0, Math.min(100, Math.round(v))));

function gradeOf(s) {
  const g = s && s.review && s.review.grade;
  const score = g ? num(g.score) : null;
  if (score === null) return null;
  const letter = typeof g.letter === 'string' && ORDER.includes(g.letter) ? g.letter : grade.letter(score);
  return { id: s.id, at: num(s.at), score, letter, provisional: !!g.provisional,
    categories: Array.isArray(g.categories) ? g.categories : [] };
}

const isRecorded = (s) => !!(s && s.review && s.review.source !== 'riot');
const isValorant = (s) => !!(s && s.review && (s.review.kind === 'valorant' || s.game === 'valorant'));

/** The counted, unjudged mistakes of one review, by key: { key: { title, count } }. */
function counted(review) {
  const out = new Map();
  for (const e of countable(review).mistakes) {
    if (!e || typeof e.key !== 'string' || !e.key || e.judged || e.key.startsWith('cause:')) continue;
    if (out.has(e.key)) continue;
    const count = num(e.count) !== null ? e.count : Array.isArray(e.rounds) ? e.rounds.length : null;
    out.set(e.key, { key: e.key, title: e.title || e.key, count });
  }
  return out;
}

function deltaLine(kind, delta, where, provisional) {
  const tail = provisional ? ' Provisional grade.' : '';
  if (delta > 0) return { kind, tone: 'good', text: `Up ${delta} on ${where}.${tail}` };
  if (delta < 0) return { kind, tone: 'bad', text: `Down ${-delta} on ${where}.${tail}` };
  return { kind, tone: 'even', text: `Level with ${where}.${tail}` };
}

function bestOf(me, before) {
  const out = { grade: null, firstLetter: null, categories: [] };
  if (!me || me.provisional || before.length < BEST_FLOOR) return out;
  const over = before.length;
  if (before.every((g) => me.score > g.score)) out.grade = { over, matches: over + 1 };
  // A first S, or a first A with neither an A nor an S before it in the window.
  if (FIRSTS.includes(me.letter)
    && before.every((g) => ORDER.indexOf(g.letter) > ORDER.indexOf(me.letter))) {
    out.firstLetter = { letter: me.letter, over, matches: over + 1 };
  }
  for (const c of me.categories) {
    const score = shown(c && c.score);
    if (score === null || !c.key) continue;
    const prior = before.map((g) => (g.categories.find((x) => x && x.key === c.key) || {}).score)
      .map(shown).filter((v) => v !== null);
    if (prior.length < BEST_FLOOR) continue;
    const previous = Math.max(...prior);
    if (score > previous) {
      out.categories.push({ key: c.key, label: c.label || c.key, score, previous, over: prior.length, matches: prior.length + 1 });
    }
  }
  return out;
}

/** B or better in a row, ending at this match; a provisional grade or a C ends it. */
function runOf(graded, at) {
  let count = 0;
  for (let i = at; i < graded.length; i++) {
    const g = graded[i];
    if (g.provisional || !RUN_LETTERS.has(g.letter)) break;
    count++;
  }
  return count >= STREAK_MIN ? { count, floor: RUN_FLOOR } : null;
}

/**
 * The habits this match is a streak without: a key seen in MIN_MATCHES or
 * more of the recorded matches older than the streak, and absent from every
 * one of the streak, which ends at this match. Over WINDOW recorded matches.
 */
function clearedOf(recorded, at) {
  const span = recorded.slice(at, at + WINDOW).map((s) => counted(s.review));
  const keys = new Map();
  for (const m of span.slice(1)) for (const e of m.values()) if (!keys.has(e.key)) keys.set(e.key, e.title);
  const out = [];
  for (const [key, title] of keys) {
    let streak = 0;
    while (streak < span.length && !span[streak].has(key)) streak++;
    if (streak < STREAK_MIN) continue;
    const before = span.slice(streak).filter((m) => m.has(key)).length;
    if (before < MIN_MATCHES) continue;
    out.push({ key, title, streak, before });
  }
  return out.sort((a, b) => b.streak - a.streak || b.before - a.before).slice(0, MAX_CLEARED);
}

/** Last recorded match's top counted mistake, and how many times it came back. */
function focusOf(me, prev) {
  if (!me || !prev || !me.review.verified || !prev.review.verified) return null;
  const top = [...counted(prev.review).values()].find((e) => num(e.count) !== null && e.count > 0);
  if (!top) return null;
  const mine = counted(me.review).get(top.key);
  const now = mine && num(mine.count) !== null ? mine.count : 0;
  const before = top.count;
  const outcome = now === 0 ? 'gone' : now < before ? 'fewer' : now === before ? 'same' : 'more';
  const text = typeof prev.review.focus === 'string' && prev.review.focus.trim() ? prev.review.focus.trim() : null;
  return { text, key: top.key, title: top.title, before, now, outcome };
}

const FOCUS_TONE = { gone: 'good', fewer: 'good', same: 'even', more: 'bad' };

function linesOf(p) {
  const lines = [];
  const b = p.best;
  if (b.firstLetter) {
    lines.push({ kind: 'first', tone: 'good', text: `First ${b.firstLetter.letter} in your last ${b.firstLetter.matches} graded matches.` });
  } else if (b.grade) {
    lines.push({ kind: 'best', tone: 'good', text: `Best grade in your last ${b.grade.matches} graded matches.` });
  }
  if (p.run) lines.push({ kind: 'run', tone: 'good', text: `${p.run.count} matches in a row at ${p.run.floor} or better.` });
  if (p.vsLast) lines.push(deltaLine('last', p.vsLast.delta, 'your last match', p.vsLast.provisional));
  if (p.vsAverage) {
    lines.push(deltaLine('average', p.vsAverage.delta, `your average of ${p.vsAverage.average} over your last ${p.vsAverage.matches} graded matches`, p.vsAverage.provisional));
  }
  for (const c of b.categories) {
    lines.push({ kind: 'category', tone: 'good', text: `Best ${c.label} in your last ${c.matches} matches: ${c.score}.` });
  }
  for (const c of p.cleared) {
    lines.push({ kind: 'cleared', tone: 'good', text: `${plural(c.streak, 'recorded match', 'recorded matches')} in a row without ${c.title}.` });
  }
  if (p.focus) {
    const f = p.focus;
    const was = f.last ? "last match's" : "last recorded match's";
    const how = {
      gone: `none this match, from ${f.before}`,
      fewer: `down to ${f.now} from ${f.before}`,
      same: `still ${f.now}, as before`,
      more: `up to ${f.now} from ${f.before}`,
    }[f.outcome];
    lines.push({ kind: 'focus', tone: FOCUS_TONE[f.outcome],
      text: `${f.title}, ${was} top mistake: ${how}.` });
  }
  return lines;
}

/**
 * @param saved  whole saved reviews ({ id, at, game, review }), newest first,
 *               as reviewStore.recent(game, LOOK_BACK) returns them
 * @param id     the review to read, one of them
 * @returns the progress above, or null when the id is not among them
 */
function matchProgress(saved, id) {
  const all = (Array.isArray(saved) ? saved : []).filter((s) => s && s.review);
  const at = all.findIndex((s) => s.id === id);
  if (at === -1) return null;
  const s = all[at];
  const me = gradeOf(s);
  const graded = all.map(gradeOf).filter(Boolean);
  const gAt = me ? graded.findIndex((g) => g.id === id) : -1;
  const before = gAt === -1 ? [] : graded.slice(gAt + 1);

  const out = {
    id, score: me ? me.score : null, letter: me ? me.letter : null, provisional: me ? me.provisional : false,
    vsLast: null, vsAverage: null, best: { grade: null, firstLetter: null, categories: [] },
    run: null, cleared: [], focus: null, lines: [],
  };
  if (me && before.length) {
    const last = before[0];
    out.vsLast = { delta: me.score - last.score, score: last.score, letter: last.letter, at: last.at,
      provisional: me.provisional || last.provisional };
  }
  const window = before.slice(0, WINDOW);
  if (me && window.length >= MIN_MATCHES) {
    const average = Math.round(window.reduce((a, g) => a + g.score, 0) / window.length);
    out.vsAverage = { delta: me.score - average, average, matches: window.length, provisional: me.provisional };
  }
  out.best = bestOf(me, before);
  if (me && gAt !== -1) out.run = runOf(graded, gAt);

  if (isValorant(s) && isRecorded(s)) {
    const recorded = all.filter(isRecorded);
    const rAt = recorded.indexOf(s);
    out.cleared = clearedOf(recorded, rAt);
    const prev = recorded[rAt + 1] || null;
    out.focus = focusOf(s, prev);
    // "Last match's" only when it was the match just before; a match graded
    // from Riot's record alone in between makes it the last RECORDED one.
    if (out.focus) out.focus.last = all[at + 1] === prev;
  }
  out.lines = linesOf(out);
  return out;
}

/**
 * The library's badges: one row's best, first S or A, run and cleared habit,
 * a run and a streak marked on the newest match of it only. `run` is the
 * newest match's, `latest` its first line.
 *
 * @param saved  the same list matchProgress reads, newest first
 * @returns {{ marks: Object<string, Array<{kind, text}>>, run: object|null, latest: object|null }}
 */
function libraryProgress(saved) {
  const all = (Array.isArray(saved) ? saved : []).filter((s) => s && s.review && s.id);
  const each = all.map((s) => matchProgress(all, s.id));
  const marks = {};
  // The next newer match a run or a streak could go on in: graded for a run,
  // recorded for a streak.
  const newerOf = (i, keep) => { for (let j = i - 1; j >= 0; j--) if (keep(j)) return each[j]; return null; };
  each.forEach((p, i) => {
    const out = [];
    if (p.best.firstLetter) out.push({ kind: 'first', text: `First ${p.best.firstLetter.letter}` });
    else if (p.best.grade) out.push({ kind: 'best', text: `Best in ${p.best.grade.matches}` });
    const nextGraded = newerOf(i, (j) => each[j].score !== null);
    if (p.run && !(nextGraded && nextGraded.run && nextGraded.run.count === p.run.count + 1)) {
      out.push({ kind: 'run', text: `${p.run.count} in a row` });
    }
    const nextRecorded = newerOf(i, (j) => isRecorded(all[j]));
    const c = p.cleared.find((x) => !(nextRecorded && nextRecorded.cleared.some((y) => y.key === x.key && y.streak === x.streak + 1)));
    if (c) out.push({ kind: 'cleared', text: `${c.streak} without ${c.title}` });
    if (out.length) marks[p.id] = out;
  });
  const newest = each[0] || null;
  return { marks, run: newest ? newest.run : null, latest: newest && newest.lines[0] ? newest.lines[0] : null };
}

module.exports = { matchProgress, libraryProgress, RUN_LETTERS, BEST_FLOOR, STREAK_MIN };
